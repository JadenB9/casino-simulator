// v6 invite6: who to invite to the table you're at. Everyone on the floor but the people already
// here: the ones you've played with or invited first, then the nearest; a search box for names;
// tick a few and Invite, or Invite everyone. What the floor says back lands on the rows
// ("Invited", "Away", "Not taking invites") and in one line under the list. Keys: type to search,
// ↑ ↓ to move, Space to tick, Enter to send, Esc to close.

import type { GameId } from '../../../../shared/src/engine.ts';
import { INVITE_MAX_TO, INVITE_MS, type InviteServerMsg, type InviteSkip } from '../../../../shared/src/protocol.ts';
import { el } from '../kit.ts';
import { clock, rankCandidates, SKIP_TEXT, sentSummary, tableName, type Candidate, type RecentPlayers } from './invite-model.ts';
import { cross, invite as inviteIcon, lock, search, tick } from './icons.ts';
import './invites.css';

/** The table you're inviting to, as the party panel knows it. */
export interface InviteTable {
  tableId: string;
  /** A private table's PIN (members see it); the floor checks it. */
  pin?: string;
  game: GameId;
  variant: string;
  /** Account ids at the table now (they aren't offered). */
  members: number[];
  seatsLeft: number;
}

export interface PickerOpts {
  root: HTMLElement;
  table: InviteTable;
  /** Everyone on the floor (you included; you're left out by id). */
  players: () => Candidate[];
  me: () => { id: number; x: number; z: number } | null;
  recent: RecentPlayers;
  /** A station's name ("Blackjack"), for "At Blackjack". */
  stationName: (id: string) => string | null;
  /** Send the invite on the floor socket; false while it's reconnecting. */
  send: (to: number[] | 'all') => boolean;
  /** When "Invite everyone" opens again for this table (server time), if it's used up. */
  everyoneAgain: () => number;
  now: () => number;
  onClose: () => void;
}

type RowState = { kind: 'invited'; until: number } | { kind: 'skip'; why: InviteSkip };

export class InvitePicker {
  readonly root = el('section', 'inv-picker panel');
  private readonly list = el('div', 'inv-list');
  private readonly query = el('input', 'inv-search-input');
  private readonly note = el('p', 'inv-note');
  private readonly sendBtn = el('button', 'btn primary');
  private readonly allBtn = el('button', 'btn');
  private readonly picked = new Set<number>();
  private readonly states = new Map<number, RowState>();
  /** Names of the players the last invite named, for the summary. */
  private asked: { ids: number[]; names: Map<number, string> } | null = null;
  private pending = false;
  private pendingTimer = 0;
  private tickTimer = 0;
  private closed = false;

  constructor(private readonly opts: PickerOpts) {
    const t = opts.table;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', `Invite players to ${tableName(t.game, t.variant)}`);

    const head = el('header', 'inv-head');
    const title = el('div', 'inv-title');
    title.append(el('span', 'label', 'Invite to'), el('span', 'inv-title-game', tableName(t.game, t.variant)));
    const close = el('button', 'inv-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.append(cross());
    close.addEventListener('click', () => this.close());
    head.append(title, close);

    const facts = el('div', 'inv-facts');
    if (t.pin) {
      const priv = el('span', 'inv-fact');
      priv.append(lock(), el('span', '', 'Private: an invite lets them in without the PIN'));
      facts.append(priv);
    }
    facts.append(el('span', 'inv-fact', t.seatsLeft === 1 ? '1 seat left' : `${t.seatsLeft} seats left`));

    const field = el('label', 'inv-search');
    this.query.type = 'search';
    this.query.placeholder = 'Find a player';
    this.query.autocomplete = 'off';
    this.query.spellcheck = false;
    this.query.maxLength = 24;
    this.query.setAttribute('aria-label', 'Find a player by name');
    this.query.addEventListener('input', () => this.render());
    field.append(search(), this.query);

    this.list.setAttribute('role', 'group');
    this.list.setAttribute('aria-label', 'Players on the floor');
    this.note.setAttribute('role', 'status');
    this.note.hidden = true;

    const foot = el('footer', 'inv-foot');
    this.allBtn.type = 'button';
    this.allBtn.addEventListener('click', () => this.sendTo('all'));
    this.sendBtn.type = 'button';
    this.sendBtn.addEventListener('click', () => this.sendTo([...this.picked]));
    foot.append(this.allBtn, this.sendBtn);

    const keys = el('div', 'inv-keys');
    keys.append(el('span', 'lb-key', 'Space'), el('span', '', 'Pick'), el('span', 'lb-key', 'Enter'), el('span', '', 'Invite'), el('span', 'lb-key', 'Esc'), el('span', '', 'Close'));

    this.root.append(head, facts, field, this.list, this.note, foot, keys);
    opts.root.append(this.root);
    addEventListener('keydown', this.onKey, true);
    this.render();
    // the clocks on invited rows and on "everyone"
    this.tickTimer = window.setInterval(() => this.render(), 1000);
    this.query.focus();
  }

  get table(): InviteTable {
    return this.opts.table;
  }

  /** The floor's answer to this table's invite. */
  onAnswer(msg: Extract<InviteServerMsg, { t: 'invite.sent' | 'invite.no' }>): void {
    if (this.closed || msg.table !== this.opts.table.tableId) return;
    this.settle();
    if (msg.t === 'invite.no') {
      this.say(msg.msg, true);
      return;
    }
    const skipped = new Map(msg.skipped.map((s) => [s.id, s]));
    const names: string[] = [];
    if (!msg.all && this.asked) {
      for (const id of this.asked.ids) {
        const s = skipped.get(id);
        if (s) this.states.set(id, { kind: 'skip', why: s.why });
        else {
          this.states.set(id, { kind: 'invited', until: this.opts.now() + INVITE_MS });
          names.push(this.asked.names.get(id) ?? '');
          this.picked.delete(id);
        }
      }
    }
    this.say(sentSummary(msg, names.filter(Boolean)), false);
    this.render();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.pendingTimer);
    clearInterval(this.tickTimer);
    removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    this.opts.onClose();
  }

  private sendTo(to: number[] | 'all'): void {
    if (this.pending || (to !== 'all' && to.length === 0)) return;
    const ids = to === 'all' ? [] : to.slice(0, INVITE_MAX_TO);
    if (!this.opts.send(to === 'all' ? 'all' : ids)) {
      this.say('Not connected to the floor. Try again in a moment.', true);
      return;
    }
    if (to !== 'all') {
      const byId = new Map(this.opts.players().map((p) => [p.id, p.name]));
      this.asked = { ids, names: new Map(ids.map((id) => [id, byId.get(id) ?? ''])) };
      this.opts.recent.note(ids.map((id) => ({ id, name: byId.get(id) ?? '' })).filter((p) => p.name));
    } else this.asked = null;
    this.pending = true;
    // a lost answer mustn't leave the buttons dead
    this.pendingTimer = window.setTimeout(() => this.settle(), 5000);
    this.render();
  }

  private settle(): void {
    clearTimeout(this.pendingTimer);
    this.pending = false;
    this.render();
  }

  private say(text: string, bad: boolean): void {
    this.note.textContent = text;
    this.note.classList.toggle('bad', bad);
    this.note.hidden = !text;
  }

  private render(): void {
    if (this.closed) return;
    const now = this.opts.now();
    for (const [id, s] of this.states) if (s.kind === 'invited' && s.until <= now) this.states.delete(id);
    const me = this.opts.me();
    const exclude = new Set([...this.opts.table.members, ...(me ? [me.id] : [])]);
    const ranked = rankCandidates(this.opts.players(), me, this.opts.recent.items, exclude, this.query.value);
    const online = new Set(ranked.map((r) => r.id));
    for (const id of [...this.picked]) if (!online.has(id) && !this.query.value) this.picked.delete(id);

    const focused = (document.activeElement as HTMLElement | null)?.dataset?.player;
    const rows: HTMLElement[] = [];
    let section: string | null = null;
    for (const r of ranked) {
      const want = r.recent ? 'Played with you' : 'On the floor';
      if (want !== section && !this.query.value) {
        section = want;
        rows.push(el('div', 'inv-section label', want));
      }
      rows.push(this.row(r.id, r.name, where(r, this.opts.stationName), this.states.get(r.id) ?? null, now));
    }
    if (ranked.length === 0) {
      const empty = el('div', 'inv-empty');
      if (this.query.value) empty.append(`Nobody called "${this.query.value}" is on the floor.`);
      else empty.append('Nobody else is on the floor right now.', el('span', '', 'Invites reach players who are here; try again when someone arrives.'));
      rows.push(empty);
    }
    this.list.replaceChildren(...rows);
    if (focused) this.list.querySelector<HTMLElement>(`[data-player="${focused}"]`)?.focus();

    const n = this.picked.size;
    this.sendBtn.replaceChildren(inviteIcon(), el('span', 'txt', this.pending && this.asked ? 'Inviting…' : n > 0 ? `Invite ${n}` : 'Invite'));
    this.sendBtn.disabled = this.pending || n === 0;
    const again = this.opts.everyoneAgain();
    const others = this.opts.players().filter((p) => !exclude.has(p.id)).length;
    if (again > now) {
      this.allBtn.textContent = `Everyone again in ${clock(again - now)}`;
      this.allBtn.disabled = true;
    } else {
      this.allBtn.textContent = this.pending && !this.asked ? 'Inviting…' : 'Invite everyone';
      this.allBtn.disabled = this.pending || others === 0;
    }
    this.allBtn.title = 'Everyone on the floor gets the invite (once every few minutes).';
  }

  private row(id: number, name: string, place: string, state: RowState | null, now: number): HTMLButtonElement {
    const on = this.picked.has(id);
    const b = el('button', `inv-row${on ? ' on' : ''}`);
    b.type = 'button';
    b.dataset.player = String(id);
    b.setAttribute('role', 'checkbox');
    b.setAttribute('aria-checked', String(on));
    const box = el('span', 'inv-box');
    if (on) box.append(tick());
    const text = el('span', 'inv-who');
    text.append(el('span', 'inv-name', name), el('span', 'inv-where', place));
    const status = el('span', 'inv-status');
    if (state?.kind === 'invited') {
      status.classList.add('sent');
      status.textContent = `Invited ${clock(state.until - now)}`;
    } else if (state?.kind === 'skip') {
      status.textContent = SKIP_TEXT[state.why];
    }
    b.append(box, text, status);
    b.setAttribute('aria-label', `${name}, ${place}${status.textContent ? `, ${status.textContent}` : ''}`);
    b.addEventListener('click', () => this.toggle(id));
    return b;
  }

  private toggle(id: number): void {
    if (this.picked.has(id)) this.picked.delete(id);
    else if (this.picked.size < INVITE_MAX_TO) this.picked.add(id);
    else this.say(`At most ${INVITE_MAX_TO} at a time.`, true);
    this.render();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const inSearch = e.target === this.query;
    let handled = true;
    if (e.key === 'Escape') {
      if (inSearch && this.query.value) {
        this.query.value = '';
        this.render();
      } else this.close();
    } else if (e.key === 'Enter') {
      const row = (document.activeElement as HTMLElement | null)?.dataset?.player;
      // Enter on a row nobody has ticked yet picks it and sends, the quickest way to invite one friend
      if (row && this.picked.size === 0) this.picked.add(Number(row));
      this.sendTo([...this.picked]);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [...this.list.querySelectorAll<HTMLButtonElement>('.inv-row')];
      if (rows.length) {
        const at = rows.indexOf(document.activeElement as HTMLButtonElement);
        if (at < 0) rows[e.key === 'ArrowDown' ? 0 : rows.length - 1]!.focus();
        else if (e.key === 'ArrowUp' && at === 0) this.query.focus();
        else rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]!.focus();
      }
    } else if (e.key === ' ' && !inSearch && (document.activeElement as HTMLElement | null)?.dataset?.player) {
      this.toggle(Number((document.activeElement as HTMLElement).dataset.player));
    } else if (!inSearch && e.key.length === 1 && this.root.contains(document.activeElement)) {
      // letters typed on a row go to the search box
      this.query.focus();
      handled = false;
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else if (this.root.contains(e.target as Node)) {
      // the panel is in front: keys typed here never reach the table behind it
      e.stopPropagation();
    }
  };
}

function where(r: ReturnType<typeof rankCandidates>[number], stationName: (id: string) => string | null): string {
  if (r.away === 'ground') return 'Downstairs';
  if (r.away === 'roof') return 'On the roof';
  const at = r.station ? stationName(r.station) : null;
  if (at) return `At ${at}`;
  if (r.metres === null) return 'On the floor';
  return r.metres < 3 ? 'Right by you' : `${Math.round(r.metres)} m away`;
}
