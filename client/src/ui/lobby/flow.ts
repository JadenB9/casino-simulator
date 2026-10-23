// What happens after pressing E at a table: play alone or with others, and at what limits.
// The limits picker is part of the first screen (for a table of your own) and of Start a table
// (for a new lobby), with your last pick for this game already chosen, so one key still sits you
// down. Multiplayer shows the open tables for this game as the floor reports them, each with its
// limits (and, once there are a few, chips to narrow them to a stake or leave out the full ones),
// a way to start one (public, or private with a PIN), and a box for a friend's PIN, which shows
// the table it opens before you join it. It resolves with where to sit, and the caller opens the
// table socket. Machines are one player each and keep their coin values, so they skip straight to
// their seat; the online games are one player each but have limits to pick.

import type { GameId } from '../../../../shared/src/engine.ts';
import type { LobbySummary } from '../../../../shared/src/protocol.ts';
import { CATALOG, type GameInfo } from '../../../../shared/src/games/catalog.ts';
import { ENGINES } from '../../../../shared/src/games/index.ts';
import { applyLimits, hasLimitChoice, limitSpec, limitsDetail, limitsLabel } from '../../../../shared/src/limits.ts';
import { ApiError, createTable as apiCreateTable, joinByPin as apiJoinByPin } from '../../net/api.ts';
import type { TableTarget } from '../../app/table-session.ts';
import { calm } from '../../app/comfort.ts';
import { el } from '../kit.ts';
import { LobbyWatch, isFull, type LobbyFloor } from './watch.ts';
import { back, crown, forward, lock, party, seat, unlock } from './icons.ts';
import { LimitsPicker } from './limits.ts';
import { soloNote } from './notes.ts';
import { stakeOf, stakesOf } from './table-model.ts';
import './lobby.css';

export interface TableFlowOpts {
  game: GameId;
  variant?: string;
  /** The floor socket, for the live list. Without it the list can't load; Create and PIN still work. */
  floor?: LobbyFloor | null;
  /** Where the panel goes; defaults to #ui. */
  root?: HTMLElement;
  /** The limits tier a table here opens at by default (the high limit salon's), by its name. */
  prefer?: string;
  /** v7.2: a table in the High Limit Salon (its custom limits go higher). */
  salon?: boolean;
  /** The two server calls, replaceable in tests. */
  api?: { createTable: typeof apiCreateTable; joinByPin: typeof apiJoinByPin };
}

/** Where to sit. Spread it into a TableTarget with the station's game, variant and id. */
export type TableChoice = Pick<TableTarget, 'kind' | 'tableId' | 'limits'> & { pin?: string };

/** Resolves with the chosen table, or null if the player walked away. */
export function openTableFlow(opts: TableFlowOpts): Promise<TableChoice | null> {
  if (!CATALOG[opts.game].multiplayer && !hasLimitChoice(opts.game)) return Promise.resolve({ kind: 'solo' });
  return new Promise((resolve) => new TableFlow(opts, resolve));
}

/** v6 invite6: the panels open now, so joining an invite can close one as if Esc were pressed. */
const openFlows = new Set<TableFlow>();

/** v6 invite6: close any open station panel as walking away does (its promise resolves null). */
export function closeTableFlows(): boolean {
  const had = openFlows.size > 0;
  for (const f of [...openFlows]) f.cancel();
  return had;
}

const ERRORS: Record<string, string> = {
  BAD_PIN: 'No table has that PIN.',
  RATE_LIMITED: 'Too many tries. Wait a minute, then try again.',
  UNAUTHORIZED: 'Your session ended. Log in again.',
};

type Step = 'choose' | 'browse' | 'confirm';
/** Steps in the order they go: a step further on slides in from the right, one back from the left. */
const DEPTH: Record<Step, number> = { choose: 0, browse: 1, confirm: 2 };

/** A touch screen: no keyboard hints, and no field focused on its own (that raises the keyboard). */
const touch = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

class TableFlow {
  private readonly box = el('section', 'lobby panel');
  private readonly body = el('div', 'lobby-body');
  /** The keys that work on this step (hidden on a touch screen). */
  private readonly foot = el('footer', 'lobby-foot');
  private readonly info: GameInfo;
  private readonly api: NonNullable<TableFlowOpts['api']>;
  private readonly watch: LobbyWatch | null = null;
  /** The limits for a table you start (null for a game without a choice of limits). */
  private readonly picker: LimitsPicker | null;
  private step: Step = 'choose';
  private busy = false;
  // parts that live updates touch
  private liveCount: HTMLElement | null = null;
  private soloBtn: HTMLButtonElement | null = null;
  private soloAside: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private filterEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private pinInput: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  /** A PIN's table, waiting for the player to say yes. */
  private found: { lobby: LobbySummary; pin: string } | null = null;
  /** The list narrowed to one stake (a tier's name, or Custom), and whether full tables show. */
  private filter: { stake: string | null; hideFull: boolean } = { stake: null, hideFull: false };

  constructor(
    private readonly opts: TableFlowOpts,
    private readonly done: (c: TableChoice | null) => void,
  ) {
    this.info = CATALOG[opts.game];
    this.api = opts.api ?? { createTable: apiCreateTable, joinByPin: apiJoinByPin };
    this.picker = hasLimitChoice(opts.game) ? new LimitsPicker(opts.game, opts.variant ?? '', { prefer: opts.prefer, salon: opts.salon }) : null;
    this.picker?.onChange(() => this.limitsChanged());
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-label', `${this.info.name}: how do you want to play?`);
    // focus can rest on the panel itself (a touch screen's list step), without a ring
    this.box.tabIndex = -1;
    this.box.append(this.header(), this.body, this.foot);
    (opts.root ?? document.getElementById('ui')!).append(this.box);
    // Listen from the start, so the Multiplayer row can already say how many tables are open.
    if (opts.floor && this.info.multiplayer) {
      this.watch = new LobbyWatch(opts.floor, opts.game);
      this.watch.on((list) => (this.step === 'choose' ? this.renderCount() : this.renderList(this.sameVariant(list))));
    }
    addEventListener('keydown', this.onKey, true);
    openFlows.add(this);
    this.showChoose();
  }

  /** v6 invite6: walk away (closeTableFlows). */
  cancel(): void {
    this.finish(null);
  }

  private header(): HTMLElement {
    const head = el('header', 'lobby-head');
    const title = el('div', 'lobby-title');
    title.append(el('span', 'lobby-game', this.info.name));
    const variant = this.info.variants.find((v) => v.id === this.opts.variant);
    if (variant) title.append(el('span', 'lobby-variant', variant.name));
    const meta = this.info.online ? 'At this computer' : this.info.multiplayer ? `${this.info.seats.max} seats` : '';
    head.append(title, el('span', 'lobby-meta', meta));
    return head;
  }

  /** Show a step's parts, sliding in from the side it comes from (just swapped while calm). */
  private swap(step: Step, parts: HTMLElement[]): void {
    const from = this.step;
    this.step = step;
    // (a phone on its side lays each step out in two columns, by this)
    this.body.dataset.step = step;
    this.body.replaceChildren(...parts);
    this.body.scrollTop = 0;
    if (from === step || calm() || typeof this.body.animate !== 'function') return;
    const dx = DEPTH[step] > DEPTH[from] ? 18 : -18;
    this.body.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }

  /** The keys that work here: each as its cap and what it does. */
  private keys(...pairs: [cap: string, does: string][]): void {
    const parts: HTMLElement[] = [];
    for (const [cap, does] of pairs) {
      const item = el('span', 'lobby-foot-key');
      item.append(el('span', 'lb-key', cap), el('span', '', does));
      parts.push(item);
    }
    this.foot.replaceChildren(...parts);
  }

  /** The picked limits changed: what they open at, and whether they can be used yet. */
  private limitsChanged(): void {
    const ok = !this.picker || this.picker.value !== null;
    if (this.soloAside && this.picker) this.soloAside.textContent = this.picker.label;
    if (this.soloBtn) this.soloBtn.disabled = !ok;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('.lobby-actions .btn')) b.disabled = this.busy || !ok;
  }

  /** Sit down at a table of your own, at the picked limits. */
  private sitSolo(): void {
    const limits = this.picker?.value;
    if (this.picker && !limits) return;
    this.picker?.commit();
    this.finish(limits ? { kind: 'solo', limits } : { kind: 'solo' });
  }

  // --- step 1: alone or with others -----------------------------------------------------------

  private showChoose(): void {
    this.listEl = this.filterEl = this.countEl = this.pinInput = this.errorEl = null;
    this.found = null;
    const online = !this.info.multiplayer;
    this.soloAside = this.picker ? el('span', 'lobby-choice-aside lobby-choice-limits') : null;
    const solo = online
      ? this.choice('S', 'Play', 'At this computer, on your own.', seat(), () => this.sitSolo(), this.soloAside)
      : this.choice('S', 'Single player', soloNote(this.opts.game), seat(), () => this.sitSolo(), this.soloAside);
    // the way most people sit down, and what Enter does from here
    solo.classList.add('main');
    this.soloBtn = solo;
    const choices = el('div', 'lobby-choices');
    choices.append(solo);
    this.liveCount = null;
    if (!online) {
      this.liveCount = el('span', 'lobby-choice-aside');
      const multi = this.choice('M', 'Multiplayer', 'Sit down with other players at a shared table.', party(), () => this.showBrowse(), this.liveCount, forward());
      choices.append(multi);
    }
    const keys: [string, string][] = [['Esc', 'Walk away']];
    if (this.picker) keys.push(['← →', 'Limits']);
    keys.push(['S', online ? 'Play' : 'Alone']);
    if (!online) keys.push(['M', 'With others']);
    this.keys(...keys);
    const parts: HTMLElement[] = [];
    if (this.picker) {
      this.picker.setTitle(limitSpec(this.opts.game)?.kind === 'blinds' ? 'Blinds' : 'Table limits');
      const block = el('div', 'lobby-limits');
      block.append(this.picker.root);
      parts.push(block);
    }
    this.swap('choose', [...parts, choices]);
    this.renderCount();
    this.limitsChanged();
    solo.focus({ preventScroll: true });
  }

  private choice(key: string, title: string, note: string, icon: SVGSVGElement, run: () => void, aside: HTMLElement | null, end?: SVGSVGElement): HTMLButtonElement {
    const b = el('button', 'lobby-choice');
    b.type = 'button';
    const mark = el('span', 'lobby-choice-icon');
    mark.append(icon);
    const text = el('span', 'lobby-choice-text');
    text.append(el('span', 'lobby-choice-title', title), el('span', 'lobby-choice-note', note));
    const side = el('span', 'lobby-choice-end');
    if (aside) side.append(aside);
    side.append(el('span', 'lb-key', key));
    if (end) side.append(end);
    b.append(mark, text, side);
    b.addEventListener('click', run);
    return b;
  }

  private renderCount(): void {
    if (!this.liveCount) return;
    let text = '';
    let open = 0;
    if (this.watch && !this.watch.loaded) text = '…';
    else if (this.watch) {
      open = this.sameVariant(this.watch.list).filter((l) => !isFull(l)).length;
      text = open === 0 ? 'None open' : `${open} open`;
    }
    this.liveCount.textContent = text;
    this.liveCount.classList.toggle('live', open > 0);
  }

  // --- step 2: the open tables, create, join by PIN --------------------------------------------

  private showBrowse(): void {
    this.liveCount = null;

    const bar = el('div', 'lobby-bar');
    const backBtn = el('button', 'lobby-back');
    backBtn.type = 'button';
    backBtn.append(back(), document.createTextNode('Back'));
    backBtn.addEventListener('click', () => this.showChoose());
    this.countEl = el('span', 'lobby-count');
    bar.append(backBtn, this.countEl);

    this.filterEl = el('div', 'lobby-filter');
    this.filterEl.setAttribute('role', 'group');
    this.filterEl.setAttribute('aria-label', 'Show tables');
    this.filterEl.hidden = true;
    this.listEl = el('div', 'lobby-list');
    this.listEl.setAttribute('aria-label', `Open ${this.info.name} tables`);

    const create = el('div', 'lobby-section');
    const actions = el('div', 'lobby-actions');
    const pub = this.action('Public', unlock(), () => void this.create('public', pub));
    const priv = this.action('Private', lock(), () => void this.create('private', priv));
    actions.append(pub, priv);
    // the same picker as the first screen, with the same pick, heading the section
    if (this.picker) {
      this.picker.setTitle('Start a table');
      create.append(this.picker.root);
    } else create.append(el('div', 'label lobby-section-head', 'Start a table'));
    create.append(actions, el('p', 'lobby-note', 'Public tables appear in this list. Private ones get a PIN to share.'));

    const join = el('div', 'lobby-section lobby-join');
    const form = el('form', 'lobby-pin');
    // The display's unlit segments sit behind the digits, like the machines' meters.
    const field = el('span', 'lobby-pin-field');
    const input = el('input', 'lobby-pin-input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 4;
    input.setAttribute('aria-label', 'Four-digit PIN');
    field.append(el('span', 'lb-seg-ghost', '8888'), input);
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      this.setError('');
    });
    const go = el('button', 'btn primary');
    go.type = 'submit';
    go.dataset.label = 'Join';
    go.append(el('span', 'txt', 'Join'));
    form.append(field, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.joinPin(input.value, go);
    });
    this.pinInput = input;
    this.errorEl = el('p', 'lobby-error');
    this.errorEl.setAttribute('role', 'alert');
    this.errorEl.hidden = true;
    join.append(el('div', 'label lobby-section-head', 'Join with a PIN'), form, this.errorEl);

    this.keys(['Esc', 'Back'], ['↑ ↓', 'Tables'], ['0–9', 'PIN']);
    this.swap('browse', [bar, this.filterEl, this.listEl, create, join]);
    this.renderList(this.sameVariant(this.watch?.list ?? []));
    this.limitsChanged();
    // The first open table; failing that the PIN box, except on a touch screen, where focusing a
    // field throws the keyboard up over the list (there the panel holds focus instead).
    const row = this.listEl.querySelector<HTMLButtonElement>('.lobby-row:not(:disabled)');
    if (row) row.focus({ preventScroll: true });
    else if (touch()) this.box.focus({ preventScroll: true });
    else input.focus({ preventScroll: true });
  }

  // --- a PIN's table, before joining it ---------------------------------------------------------

  private showConfirm(lobby: LobbySummary, pin: string): void {
    this.found = { lobby, pin };
    this.listEl = this.filterEl = this.countEl = this.pinInput = this.errorEl = null;
    const bar = el('div', 'lobby-bar');
    const backBtn = el('button', 'lobby-back');
    backBtn.type = 'button';
    backBtn.append(back(), document.createTextNode('Back'));
    backBtn.addEventListener('click', () => this.showBrowse());
    bar.append(backBtn, el('span', 'lobby-count', 'Private table'));

    const card = el('div', 'lobby-found');
    const host = el('div', 'lobby-host');
    host.append(crown(), el('span', 'name', lobby.leader ? `${lobby.leader}'s table` : 'A private table'));
    const variant = this.info.variants.find((v) => v.id === lobby.variant);
    if (variant) host.append(el('span', 'lobby-tag', variant.name));
    if (lobby.started) host.append(el('span', 'lobby-tag live', 'In play'));
    const facts = el('dl', 'lobby-facts');
    const fact = (k: string, v: string) => {
      const row = el('div', '');
      row.append(el('dt', 'label', k), el('dd', '', v));
      facts.append(row);
    };
    if (lobby.limits) fact(limitSpec(this.opts.game)?.kind === 'blinds' ? 'Blinds' : 'Limits', limitsLabel(this.opts.game, lobby.limits));
    fact('Seats', `${lobby.players} of ${lobby.max} taken`);
    card.append(host, facts);
    if (lobby.limits) {
      const cfg = applyLimits(ENGINES[this.opts.game].config(lobby.variant, 'multi'), lobby.limits);
      card.append(el('p', 'lim-detail', limitsDetail(cfg).join(' · ')));
    }
    const full = isFull(lobby);
    const go = el('button', 'btn primary lobby-go-btn', full ? 'Table full' : 'Join this table');
    go.type = 'button';
    go.disabled = full;
    go.append(el('span', 'key', 'Enter'));
    go.addEventListener('click', () => this.joinFound());
    card.append(go);
    this.keys(['Esc', 'Back'], ['Enter', 'Join']);
    this.swap('confirm', [bar, card]);
    go.focus({ preventScroll: true });
  }

  private joinFound(): void {
    const f = this.found;
    if (!f || isFull(f.lobby)) return;
    this.finish({ kind: 'lobby', tableId: f.lobby.tableId, pin: f.pin });
  }

  private action(label: string, icon: SVGSVGElement, run: () => void): HTMLButtonElement {
    const b = el('button', 'btn');
    b.type = 'button';
    b.dataset.label = label;
    b.append(icon, el('span', 'txt', label));
    b.addEventListener('click', run);
    return b;
  }

  /** Lobbies at this station's kind of table (an American wheel's list shows American wheels). */
  private sameVariant(list: LobbySummary[]): LobbySummary[] {
    const v = this.opts.variant;
    return v ? list.filter((l) => !l.variant || l.variant === v) : list;
  }

  /**
   * The chips over the list, once there's a choice to make: All and each stake the tables are at,
   * and Hide full when any are. A stake no table is at any more lets go of the filter. Returns the
   * tables the chips let through.
   */
  private renderFilter(list: LobbySummary[]): LobbySummary[] {
    const f = this.filter;
    const stakes = stakesOf(this.opts.game, list);
    if (f.stake !== null && !stakes.includes(f.stake)) f.stake = null;
    const anyFull = list.some(isFull);
    if (!anyFull) f.hideFull = false;
    const show = stakes.length > 1 || anyFull;
    if (this.filterEl) {
      this.filterEl.hidden = !show;
      if (show) {
        const chip = (label: string, on: boolean, run: () => void, cls = '') => {
          const b = el('button', `lobby-chip${cls}`, label);
          b.type = 'button';
          b.setAttribute('aria-pressed', String(on));
          b.addEventListener('click', run);
          return b;
        };
        const parts: HTMLElement[] = [];
        if (stakes.length > 1) {
          parts.push(chip('All', f.stake === null, () => this.setFilter({ stake: null })));
          for (const s of stakes) parts.push(chip(s, f.stake === s, () => this.setFilter({ stake: f.stake === s ? null : s })));
        }
        if (anyFull) parts.push(chip('Hide full', f.hideFull, () => this.setFilter({ hideFull: !f.hideFull }), ' toggle'));
        this.filterEl.replaceChildren(...parts);
      }
    }
    return list.filter((l) => (f.stake === null || stakeOf(this.opts.game, l) === f.stake) && !(f.hideFull && isFull(l)));
  }

  private setFilter(next: Partial<TableFlow['filter']>): void {
    this.filter = { ...this.filter, ...next };
    this.renderList(this.sameVariant(this.watch?.list ?? []));
  }

  private renderList(all: LobbySummary[]): void {
    if (!this.listEl || !this.countEl) return;
    const focused = this.listEl.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.table : undefined;
    // a chip keeps focus across the redraw it causes (found again by its words)
    const chipFocus = this.filterEl?.contains(document.activeElement) ? (document.activeElement as HTMLElement).textContent : null;
    const list = this.renderFilter(all);
    if (chipFocus !== null) [...(this.filterEl?.querySelectorAll<HTMLButtonElement>('.lobby-chip') ?? [])].find((b) => b.textContent === chipFocus)?.focus();
    const rows: HTMLElement[] = list.map((l) => this.row(l));
    if (list.length > 0) {
      const head = el('div', 'lobby-cols');
      head.append(el('span', '', 'Table'), el('span', '', limitSpec(this.opts.game)?.kind === 'blinds' ? 'Blinds' : 'Limits'), el('span', '', 'Seats'), el('span', ''));
      rows.unshift(head);
    } else {
      const empty = el('div', 'lobby-empty');
      if (!this.watch) empty.append('The list of open tables is unavailable.', el('span', '', 'You can still start one, or join with a PIN.'));
      else if (!this.watch.loaded) empty.append('Looking for open tables…');
      else if (all.length > 0) {
        const clear = el('button', 'lobby-link', 'Show every table');
        clear.type = 'button';
        clear.addEventListener('click', () => this.setFilter({ stake: null, hideFull: false }));
        empty.append('No tables like that right now.', clear);
      } else empty.append('No open tables right now.', el('span', '', 'Start one below and it shows up here for everyone.'));
      rows.push(empty);
    }
    this.listEl.replaceChildren(...rows);
    if (focused) this.listEl.querySelector<HTMLElement>(`[data-table="${focused}"]`)?.focus();
    const open = list.filter((l) => !isFull(l)).length;
    this.countEl.textContent = this.watch?.loaded && all.length > 0 ? `${open} open ${open === 1 ? 'table' : 'tables'}` : '';
  }

  private row(l: LobbySummary): HTMLButtonElement {
    const full = isFull(l);
    const b = el('button', 'lobby-row');
    b.type = 'button';
    b.dataset.table = l.tableId;
    b.disabled = full || this.busy;
    const host = el('span', 'lobby-host');
    host.append(crown(), el('span', 'name', l.leader || 'Empty table'));
    const variant = this.info.variants.find((v) => v.id === l.variant);
    if (variant) host.append(el('span', 'lobby-tag', variant.name));
    if (l.started) host.append(el('span', 'lobby-tag live', 'In play'));
    const seats = el('span', 'lobby-seats');
    const pips = el('span', 'lb-pips');
    for (let i = 0; i < l.max; i++) pips.append(el('span', i < l.players ? 'lb-pip on' : 'lb-pip'));
    seats.append(pips, el('span', 'n', `${l.players}/${l.max}`));
    // in full when it fits the column ("$25–$2,500"), short when it doesn't ("$1K–$100K")
    const range = l.limits ? limitsLabel(this.opts.game, l.limits) : '';
    const limits = el('span', 'lobby-limits-cell', range.length <= 11 ? range : limitsLabel(this.opts.game, l.limits!, true));
    if (range) limits.title = range;
    b.append(host, limits, seats, el('span', 'lobby-go', full ? 'Full' : 'Join'));
    const said = l.limits ? `, limits ${limitsLabel(this.opts.game, l.limits)}` : '';
    b.setAttribute('aria-label', `${l.leader || 'Empty'} table${said}, ${l.players} of ${l.max} seats${l.started ? ', in play' : ''}${full ? ', full' : ''}`);
    b.addEventListener('click', () => {
      if (!full && !this.busy) this.finish({ kind: 'lobby', tableId: l.tableId });
    });
    return b;
  }

  private async create(visibility: 'public' | 'private', btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    const limits = this.picker?.value ?? undefined;
    if (this.picker && !limits) return;
    this.setBusy(btn, 'Opening…');
    try {
      const made = await this.api.createTable(this.opts.game, visibility, this.opts.variant, limits);
      this.picker?.commit();
      this.finish({ kind: 'lobby', tableId: made.tableId, ...(made.pin ? { pin: made.pin } : {}) });
    } catch (err) {
      this.setBusy(null);
      this.setError(errorText(err, "Couldn't open a table. Try again."));
    }
  }

  private async joinPin(pin: string, btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    if (!/^\d{4}$/.test(pin)) {
      this.setError('PINs are four digits.');
      if (!touch()) this.pinInput?.focus();
      return;
    }
    this.setBusy(btn, 'Joining…');
    try {
      const found = await this.api.joinByPin(pin);
      if (found.game !== this.opts.game) {
        this.setBusy(null);
        this.setError(`That PIN is for a ${CATALOG[found.game].name} table. Enter it there.`);
        return;
      }
      this.setBusy(null);
      // Show what the PIN opens (its limits above all) before sitting down at it.
      if (found.lobby) this.showConfirm(found.lobby, pin);
      else this.finish({ kind: 'lobby', tableId: found.tableId, pin });
    } catch (err) {
      this.setBusy(null);
      this.setError(errorText(err, "Couldn't reach the casino. Try again."));
      this.pinInput?.select();
    }
  }

  /** Lock the panel while a request is out; `btn` says what it is doing. Null unlocks. */
  private setBusy(btn: HTMLButtonElement | null, label = ''): void {
    this.busy = btn !== null;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('.lobby-section button')) b.disabled = this.busy;
    if (this.pinInput) this.pinInput.disabled = this.busy;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('.lobby-section button')) {
      const txt = b.querySelector('.txt');
      if (txt) txt.textContent = b === btn ? label : (b.dataset.label ?? '');
    }
    this.renderList(this.sameVariant(this.watch?.list ?? []));
    if (!this.busy) this.limitsChanged();
  }

  private setError(msg: string): void {
    if (!this.errorEl) return;
    this.errorEl.textContent = msg;
    this.errorEl.hidden = !msg;
    this.errorEl.closest('.lobby-join')?.classList.toggle('bad', !!msg);
  }

  // --- keys and closing ------------------------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    let handled = true;
    if (e.key === 'Escape') {
      if (this.step === 'browse' && !this.busy) this.showChoose();
      else if (this.step === 'confirm') this.showBrowse();
      else if (this.step === 'choose') this.finish(null);
    } else if (this.step === 'confirm' && e.key === 'Enter') {
      this.joinFound();
    } else if (this.step === 'choose' && !typing && (e.key === 's' || e.key === 'S')) {
      this.sitSolo();
    } else if (this.step === 'choose' && !typing && this.info.multiplayer && (e.key === 'm' || e.key === 'M')) {
      this.showBrowse();
    } else if ((this.step === 'choose' || this.step === 'browse') && !typing && this.picker && !this.busy && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      this.picker.step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (this.step === 'browse' && !typing && /^\d$/.test(e.key) && this.pinInput && !this.busy) {
      // Digits typed anywhere go to the PIN box.
      const input = this.pinInput;
      input.focus();
      if (input.value.length < 4) input.value += e.key;
      this.setError('');
    } else if (this.step === 'browse' && !typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && this.listEl) {
      const rows = [...this.listEl.querySelectorAll<HTMLButtonElement>('.lobby-row:not(:disabled)')];
      if (rows.length) {
        const at = rows.indexOf(document.activeElement as HTMLButtonElement);
        const next = at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
        rows[next]!.focus();
      }
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else if (!typing && e.key.length === 1) {
      // The panel is in front: letters don't walk the character or reach the table behind it.
      e.stopPropagation();
    }
  };

  private finish(choice: TableChoice | null): void {
    openFlows.delete(this);
    removeEventListener('keydown', this.onKey, true);
    this.watch?.close();
    this.box.remove();
    this.done(choice);
  }
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return ERRORS[err.body.error] ?? err.body.msg ?? fallback;
  return fallback;
}
