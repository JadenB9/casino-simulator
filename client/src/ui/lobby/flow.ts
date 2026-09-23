// What happens after pressing E at a table: play alone or with others. Multiplayer shows the
// open tables for this game as the floor reports them, a way to start one (public, or private
// with a PIN), and a box for a friend's PIN. It resolves with where to sit, and the caller opens
// the table socket. Machines are one player each, so they skip straight to their solo seat.

import type { GameId } from '../../../../shared/src/engine.ts';
import type { LobbySummary } from '../../../../shared/src/protocol.ts';
import { CATALOG, type GameInfo } from '../../../../shared/src/games/catalog.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { ApiError, createTable as apiCreateTable, joinByPin as apiJoinByPin } from '../../net/api.ts';
import type { TableTarget } from '../../app/table-session.ts';
import { el } from '../kit.ts';
import { LobbyWatch, isFull, type LobbyFloor } from './watch.ts';
import { back, crown, lock, unlock } from './icons.ts';
import './lobby.css';

export interface TableFlowOpts {
  game: GameId;
  variant?: string;
  /** The floor socket, for the live list. Without it the list can't load; Create and PIN still work. */
  floor?: LobbyFloor | null;
  /** The table's limits, for the header. */
  limits?: { min: Cents; max: Cents };
  /** Where the panel goes; defaults to #ui. */
  root?: HTMLElement;
  /** The two server calls, replaceable in tests. */
  api?: { createTable: typeof apiCreateTable; joinByPin: typeof apiJoinByPin };
}

/** Where to sit. Spread it into a TableTarget with the station's game, variant and id. */
export type TableChoice = Pick<TableTarget, 'kind' | 'tableId'> & { pin?: string };

/** Resolves with the chosen table, or null if the player walked away. */
export function openTableFlow(opts: TableFlowOpts): Promise<TableChoice | null> {
  if (!CATALOG[opts.game].multiplayer) return Promise.resolve({ kind: 'solo' });
  return new Promise((resolve) => new TableFlow(opts, resolve));
}

/** How the single-player table runs, in the player's words. */
const SOLO_NOTE: Partial<Record<GameId, string>> = {
  roulette: 'You and the croupier. Spin when you are ready.',
  craps: 'You and the stickman. Roll when you are ready.',
  holdem: 'You against bots, each one marked as a bot.',
};

const ERRORS: Record<string, string> = {
  BAD_PIN: 'No table has that PIN.',
  RATE_LIMITED: 'Too many tries. Wait a minute, then try again.',
  UNAUTHORIZED: 'Your session ended. Log in again.',
};

class TableFlow {
  private readonly box = el('section', 'lobby panel');
  private readonly body = el('div', 'lobby-body');
  private readonly info: GameInfo;
  private readonly api: NonNullable<TableFlowOpts['api']>;
  private readonly watch: LobbyWatch | null = null;
  private step: 'choose' | 'browse' = 'choose';
  private busy = false;
  // parts that live updates touch
  private liveCount: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private pinInput: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(
    private readonly opts: TableFlowOpts,
    private readonly done: (c: TableChoice | null) => void,
  ) {
    this.info = CATALOG[opts.game];
    this.api = opts.api ?? { createTable: apiCreateTable, joinByPin: apiJoinByPin };
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-label', `${this.info.name}: how do you want to play?`);
    this.box.append(this.header(), this.body);
    (opts.root ?? document.getElementById('ui')!).append(this.box);
    // Listen from the start, so the Multiplayer row can already say how many tables are open.
    if (opts.floor) {
      this.watch = new LobbyWatch(opts.floor, opts.game);
      this.watch.on((list) => (this.step === 'choose' ? this.renderCount() : this.renderList(list)));
    }
    addEventListener('keydown', this.onKey, true);
    this.showChoose();
  }

  private header(): HTMLElement {
    const head = el('header', 'lobby-head');
    const title = el('div', 'lobby-title');
    title.append(el('span', 'lobby-game', this.info.name));
    const variant = this.info.variants.find((v) => v.id === this.opts.variant);
    if (variant) title.append(el('span', 'lobby-variant', variant.name));
    const meta: string[] = [];
    if (this.opts.limits) meta.push(`${formatMoney(this.opts.limits.min)}–${formatMoney(this.opts.limits.max)}`);
    meta.push(`${this.info.seats.max} seats`);
    head.append(title, el('span', 'lobby-meta', meta.join(' · ')));
    return head;
  }

  // --- step 1: alone or with others -----------------------------------------------------------

  private showChoose(): void {
    this.step = 'choose';
    this.listEl = this.countEl = this.pinInput = this.errorEl = null;
    const solo = this.choice('S', 'Single player', SOLO_NOTE[this.opts.game] ?? 'You and the dealer. Deal when you are ready.', () =>
      this.finish({ kind: 'solo' }),
    );
    this.liveCount = el('span', 'lobby-choice-aside');
    const multi = this.choice('M', 'Multiplayer', 'Sit down with other players at a shared table.', () => this.showBrowse());
    multi.append(this.liveCount);
    const choices = el('div', 'lobby-choices');
    choices.append(solo, multi);
    const foot = el('footer', 'lobby-foot');
    foot.append(el('span', 'keycap', 'Esc'), el('span', '', 'Walk away'));
    this.body.replaceChildren(choices, foot);
    this.renderCount();
    solo.focus();
  }

  private choice(key: string, title: string, note: string, run: () => void): HTMLButtonElement {
    const b = el('button', 'lobby-choice');
    b.type = 'button';
    const text = el('span', 'lobby-choice-text');
    text.append(el('span', 'lobby-choice-title', title), el('span', 'lobby-choice-note', note));
    b.append(el('span', 'keycap', key), text);
    b.addEventListener('click', run);
    return b;
  }

  private renderCount(): void {
    if (!this.liveCount) return;
    let text = '';
    let open = 0;
    if (this.watch && !this.watch.loaded) text = '…';
    else if (this.watch) {
      open = this.watch.list.filter((l) => !isFull(l)).length;
      text = open === 0 ? 'None open' : `${open} open`;
    }
    this.liveCount.textContent = text;
    this.liveCount.classList.toggle('live', open > 0);
  }

  // --- step 2: the open tables, create, join by PIN --------------------------------------------

  private showBrowse(): void {
    this.step = 'browse';
    this.liveCount = null;

    const bar = el('div', 'lobby-bar');
    const backBtn = el('button', 'lobby-back');
    backBtn.type = 'button';
    backBtn.append(back(), document.createTextNode('Back'));
    backBtn.addEventListener('click', () => this.showChoose());
    this.countEl = el('span', 'lobby-count');
    bar.append(backBtn, this.countEl);

    this.listEl = el('div', 'lobby-list');
    this.listEl.setAttribute('aria-label', `Open ${this.info.name} tables`);

    const create = el('div', 'lobby-section');
    const actions = el('div', 'lobby-actions');
    const pub = this.action('Public', unlock(), () => void this.create('public', pub));
    const priv = this.action('Private', lock(), () => void this.create('private', priv));
    actions.append(pub, priv);
    create.append(el('div', 'label', 'Start a table'), actions, el('p', 'lobby-note', 'Public tables appear in this list. Private ones get a PIN to share.'));

    const join = el('div', 'lobby-section');
    const form = el('form', 'lobby-pin');
    const input = el('input', 'lobby-pin-input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 4;
    input.placeholder = '8888';
    input.setAttribute('aria-label', 'Four-digit PIN');
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      this.setError('');
    });
    const go = el('button', 'btn primary');
    go.type = 'submit';
    go.dataset.label = 'Join';
    go.append(el('span', 'txt', 'Join'));
    form.append(input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.joinPin(input.value, go);
    });
    this.pinInput = input;
    this.errorEl = el('p', 'lobby-error');
    this.errorEl.setAttribute('role', 'alert');
    this.errorEl.hidden = true;
    join.append(el('div', 'label', 'Join with a PIN'), form, this.errorEl);

    this.body.replaceChildren(bar, this.listEl, create, join);
    this.renderList(this.watch?.list ?? []);
    (this.listEl.querySelector<HTMLButtonElement>('.lobby-row:not(:disabled)') ?? input).focus();
  }

  private action(label: string, icon: SVGSVGElement, run: () => void): HTMLButtonElement {
    const b = el('button', 'btn');
    b.type = 'button';
    b.dataset.label = label;
    b.append(icon, el('span', 'txt', label));
    b.addEventListener('click', run);
    return b;
  }

  private renderList(list: LobbySummary[]): void {
    if (!this.listEl || !this.countEl) return;
    const focused = this.listEl.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.table : undefined;
    const head = el('div', 'lobby-cols');
    head.append(el('span', '', 'Table'), el('span', '', 'Seats'), el('span', ''));
    const rows: HTMLElement[] = [head, ...list.map((l) => this.row(l))];
    if (list.length === 0) {
      const empty = el('div', 'lobby-empty');
      if (!this.watch) empty.append('The list of open tables is unavailable.', el('span', '', 'You can still start one, or join with a PIN.'));
      else if (!this.watch.loaded) empty.append('Looking for open tables…');
      else empty.append('No open tables right now.', el('span', '', 'Start one below and it shows up here for everyone.'));
      rows.push(empty);
    }
    this.listEl.replaceChildren(...rows);
    if (focused) this.listEl.querySelector<HTMLElement>(`[data-table="${focused}"]`)?.focus();
    const open = list.filter((l) => !isFull(l)).length;
    this.countEl.textContent = this.watch?.loaded ? `${open} open ${open === 1 ? 'table' : 'tables'}` : '';
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
    const pips = el('span', 'pips');
    for (let i = 0; i < l.max; i++) pips.append(el('span', i < l.players ? 'pip on' : 'pip'));
    seats.append(pips, el('span', 'n', `${l.players}/${l.max}`));
    b.append(host, seats, el('span', 'lobby-go', full ? 'Full' : 'Join'));
    b.setAttribute('aria-label', `${l.leader || 'Empty'} table, ${l.players} of ${l.max} seats${l.started ? ', in play' : ''}${full ? ', full' : ''}`);
    b.addEventListener('click', () => {
      if (!full && !this.busy) this.finish({ kind: 'lobby', tableId: l.tableId });
    });
    return b;
  }

  private async create(visibility: 'public' | 'private', btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.setBusy(btn, 'Opening…');
    try {
      const made = await this.api.createTable(this.opts.game, visibility, this.opts.variant);
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
      this.pinInput?.focus();
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
      this.finish({ kind: 'lobby', tableId: found.tableId, pin });
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
    this.renderList(this.watch?.list ?? []);
  }

  private setError(msg: string): void {
    if (!this.errorEl) return;
    this.errorEl.textContent = msg;
    this.errorEl.hidden = !msg;
  }

  // --- keys and closing ------------------------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    let handled = true;
    if (e.key === 'Escape') {
      if (this.step === 'browse' && !this.busy) this.showChoose();
      else if (this.step === 'choose') this.finish(null);
    } else if (this.step === 'choose' && !typing && (e.key === 's' || e.key === 'S')) {
      this.finish({ kind: 'solo' });
    } else if (this.step === 'choose' && !typing && (e.key === 'm' || e.key === 'M')) {
      this.showBrowse();
    } else if (this.step === 'browse' && !typing && /^\d$/.test(e.key) && this.pinInput && !this.busy) {
      // Digits typed anywhere go to the PIN box (the key itself lands there too).
      this.pinInput.focus();
      handled = false;
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
