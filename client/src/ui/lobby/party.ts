// The party panel at a lobby table: who is here (in join order, the leader crowned), who has
// chips down and who is ready, the PIN for a private table, and the leader's two controls,
// public/private and Start. It draws only what the table sends ('table' and 'members'); every
// button sends a table message and waits for the server's answer to change anything.

import type { GameId } from '../../../../shared/src/engine.ts';
import type { Member, TableClientMsg } from '../../../../shared/src/protocol.ts';
import { CATALOG } from '../../../../shared/src/games/catalog.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { hasLimitChoice, limitsLabel, limitsOf } from '../../../../shared/src/limits.ts';
import type { GameClientModule, MembersMsg, TableSnapshot, TableView } from '../../games/contract.ts';
import { el, toast } from '../kit.ts';
import { chevron, crown, lock, unlock } from './icons.ts';
import './lobby.css';

export interface PartyPanelOpts {
  /** My account id. */
  me: number;
  game: GameId;
  /** Send on the table socket (TableSession.send). */
  send: (msg: TableClientMsg) => void;
  /** Leave the table (TableSession.leave, then back to the floor). */
  leave: () => void;
  /** Open the buy-in prompt (TableSession.promptBuyIn). Without it there is no Sit down button. */
  sit?: () => void;
  /** Where the panel goes; defaults to #ui. */
  root?: HTMLElement;
}

interface Party {
  members: Member[];
  leader: number | null;
  visibility: 'public' | 'private';
  pin?: string;
  started: boolean;
  maxSeats: number;
  /** "$25–$5,000": what the table was opened at. */
  limits: string;
}

export class PartyPanel {
  readonly root = el('section', 'party panel');
  private readonly head = el('button', 'party-head');
  private readonly body = el('div', 'party-body');
  private party: Party | null = null;
  private collapsed = false;
  /** A control waiting for the server's answer: its buttons stay disabled until it comes. */
  private pending = false;
  private pendingTimer = 0;

  constructor(private readonly opts: PartyPanelOpts) {
    this.root.setAttribute('aria-label', 'Party');
    this.head.type = 'button';
    this.head.setAttribute('aria-expanded', 'true');
    this.head.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.root.append(this.head, this.body);
    this.root.hidden = true;
    (opts.root ?? document.getElementById('ui')!).append(this.root);
  }

  onTable(snap: TableSnapshot): void {
    const m = snap.meta;
    if (m.mode !== 'multi') {
      this.root.hidden = true;
      return;
    }
    this.update({
      members: snap.members,
      leader: snap.leader,
      visibility: m.visibility,
      ...(m.pin ? { pin: m.pin } : {}),
      started: m.started,
      maxSeats: m.config.maxSeats,
      limits: hasLimitChoice(m.game) ? limitsLabel(m.game, limitsOf(m.config)) : '',
    });
  }

  onMembers(msg: MembersMsg): void {
    this.update({
      members: msg.members,
      leader: msg.leader,
      visibility: msg.visibility,
      ...(msg.pin ? { pin: msg.pin } : {}),
      started: msg.started,
      maxSeats: this.party?.maxSeats ?? CATALOG[this.opts.game].seats.max,
      limits: this.party?.limits ?? '',
    });
  }

  /** The table refused something (TableSession passes every 'err' on): let the controls go. */
  onError(): void {
    if (this.pending) this.settle();
  }

  dispose(): void {
    clearTimeout(this.pendingTimer);
    this.root.remove();
  }

  private ask(msg: TableClientMsg): void {
    if (this.pending) return;
    this.pending = true;
    this.opts.send(msg);
    // A lost answer mustn't leave the buttons dead.
    this.pendingTimer = window.setTimeout(() => this.settle(), 4000);
    this.render();
  }

  private settle(): void {
    clearTimeout(this.pendingTimer);
    this.pending = false;
    this.render();
  }

  private update(next: Party): void {
    // Once the game starts (or on arriving at one already running) the panel folds down to its
    // header, out of the way of the table.
    if (next.started && !this.party?.started) this.setCollapsed(true, false);
    this.party = next;
    this.root.hidden = false;
    this.settle();
  }

  private setCollapsed(on: boolean, render = true): void {
    this.collapsed = on;
    this.root.classList.toggle('collapsed', on);
    this.head.setAttribute('aria-expanded', String(!on));
    if (render) this.render();
  }

  private render(): void {
    const p = this.party;
    if (!p) return;
    const me = this.opts.me;
    const leader = p.members.find((m) => m.accountId === p.leader);
    const mine = p.members.find((m) => m.accountId === me);
    const isLeader = p.leader === me;

    // header: what this party is at a glance, also when folded
    const vis = el('span', `party-vis ${p.visibility}`);
    vis.append(p.visibility === 'private' ? lock() : unlock(), el('span', '', p.visibility === 'private' ? 'Private' : 'Public'));
    const title = el('span', 'label', p.started ? 'In play' : 'Party');
    const count = el('span', 'party-count', `${p.members.length}/${p.maxSeats}`);
    const headParts: (HTMLElement | SVGSVGElement)[] = [title, vis];
    if (p.limits) {
      const lim = el('span', 'party-limits', p.limits);
      lim.title = `Table limits ${p.limits}`;
      headParts.push(lim);
    }
    if (p.pin && this.collapsed) headParts.push(el('span', 'party-pin-mini', p.pin));
    headParts.push(count, chevron());
    this.head.replaceChildren(...headParts);
    this.head.title = this.collapsed ? 'Show the party' : 'Fold the party away';

    const parts: HTMLElement[] = [];

    if (p.pin) {
      const pin = el('div', 'party-pin');
      const digits = el('span', 'party-pin-digits lb-seg');
      digits.append(el('span', 'lb-seg-ghost', '8'.repeat(p.pin.length)), el('span', 'lb-seg-lit', p.pin));
      digits.setAttribute('aria-label', `PIN ${p.pin.split('').join(' ')}`);
      const copy = el('button', 'btn ghost', 'Copy');
      copy.type = 'button';
      copy.addEventListener('click', () => void copyPin(p.pin!));
      pin.append(el('span', 'label', 'PIN'), digits, copy, el('p', 'party-pin-note', `Friends enter it at any ${CATALOG[this.opts.game].name} table.`));
      parts.push(pin);
    }

    const list = el('ol', 'party-members');
    for (const m of p.members) list.append(this.memberRow(m, m.accountId === p.leader, m.accountId === me));
    parts.push(list);

    const controls = el('div', 'party-controls');
    if (isLeader) {
      const seg = el('div', 'party-seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Who can join');
      for (const v of ['public', 'private'] as const) {
        const b = el('button', '');
        b.type = 'button';
        b.append(v === 'private' ? lock() : unlock(), el('span', '', v === 'private' ? 'Private' : 'Public'));
        b.setAttribute('aria-pressed', String(p.visibility === v));
        b.disabled = this.pending;
        b.addEventListener('click', () => {
          if (p.visibility !== v) this.ask({ t: 'visibility', visibility: v });
        });
        seg.append(b);
      }
      controls.append(seg);
    }

    const row = el('div', 'party-row');
    if (this.opts.sit && mine?.status === 'watching') {
      const sit = el('button', 'btn', 'Sit down');
      sit.type = 'button';
      sit.addEventListener('click', () => this.opts.sit?.());
      row.append(sit);
    }
    if (!p.started && isLeader) {
      const need = CATALOG[this.opts.game].seats.min;
      const start = el('button', 'btn primary', 'Start');
      start.type = 'button';
      start.disabled = this.pending || p.members.length < need;
      start.title = p.members.length < need ? `This game needs at least ${need} players.` : 'Start the game for everyone here.';
      start.addEventListener('click', () => this.ask({ t: 'start' }));
      row.append(start);
    }
    const leave = el('button', 'btn ghost', 'Leave');
    leave.type = 'button';
    leave.addEventListener('click', () => this.opts.leave());
    row.append(leave);

    if (!p.started && !isLeader) {
      controls.append(el('p', 'party-wait', leader ? `Waiting for ${leader.name} to start.` : 'Waiting for the leader to start.'));
    }
    controls.append(row);
    parts.push(controls);
    this.body.replaceChildren(...parts);
  }

  private memberRow(m: Member, isLeader: boolean, isMe: boolean): HTMLLIElement {
    const li = el('li', `party-member${isMe ? ' me' : ''}${m.connected ? '' : ' away'}`);
    const mark = el('span', 'party-mark');
    if (isLeader) {
      const c = crown();
      mark.append(c);
      mark.title = 'Party leader';
    } else if (m.seat !== null) {
      mark.textContent = String(m.seat + 1);
      mark.title = `Seat ${m.seat + 1}`;
    }
    const name = el('span', 'party-name', m.name);
    if (isMe) name.append(el('span', 'party-you', 'you'));
    const ready = el('span', 'party-ready', m.ready && m.status === 'seated' && m.connected ? 'Ready' : '');
    const st = statusOf(m);
    li.append(mark, name, ready, el('span', `party-status ${st.cls}`, st.text));
    return li;
  }
}

function statusOf(m: Member): { text: string; cls: string } {
  if (!m.connected) return { text: 'Away', cls: 'word' };
  switch (m.status) {
    case 'buying_in':
      return { text: 'Buying in', cls: 'word' };
    case 'cashing_out':
      return { text: 'Cashing out', cls: 'word' };
    case 'watching':
      return { text: 'Watching', cls: 'word' };
    default:
      return { text: formatMoney(m.stack), cls: 'money' };
  }
}

async function copyPin(pin: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(pin);
    toast(`PIN ${pin} copied.`);
  } catch {
    toast(`The PIN is ${pin}.`);
  }
}

/**
 * The game module with the party panel listening in: the table's 'table' and 'members' messages
 * go to the panel as well as to the game's view, so TableSession needs no changes.
 */
export function withParty(module: GameClientModule, party: PartyPanel): GameClientModule {
  return {
    ...module,
    mount(ctx) {
      const view = module.mount(ctx);
      const wrapped: TableView = {
        onTable: (snap) => {
          party.onTable(snap);
          view.onTable(snap);
        },
        onEvents: (events, v) => view.onEvents(events, v),
        onSeat: (msg) => view.onSeat(msg),
        onMembers: (msg) => {
          party.onMembers(msg);
          view.onMembers?.(msg);
        },
        update: (dt) => view.update(dt),
        dispose: () => {
          party.dispose();
          view.dispose();
        },
      };
      wrapped.onError = (code, msg) => {
        party.onError();
        view.onError?.(code, msg);
      };
      if (view.keydown) wrapped.keydown = (e) => view.keydown!(e);
      return wrapped;
    },
  };
}
