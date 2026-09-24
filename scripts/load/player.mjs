// A simulated player at a lobby table: keeps the table's view the way the client does (snapshots,
// event batches in seq order, its own seat), plays with the shared bots (bots.ts), presses Ready
// once it has bet, and can drop and come back like a phone going through a tunnel.

import { BUY_IN, ENGINE_READY, botDoneBetting, botMove } from './bots.ts';

/** A per-game counter that moves once per round, to know how much has been played. */
export function roundOf(game, view) {
  if (!view) return 0;
  switch (game) {
    case 'baccarat':
      return view.window ?? 0;
    case 'holdem':
      return view.handId ?? 0;
    case 'craps':
      return view.rolls ?? 0;
    default:
      return view.round ?? 0;
  }
}

let aidSeq = 0;

export class TablePlayer {
  constructor(server, meter, account, game, tableId, rand, opts = {}) {
    this.server = server;
    this.meter = meter;
    this.account = account;
    this.game = game;
    this.tableId = tableId;
    this.rand = rand;
    this.pin = opts.pin ?? null;
    this.log = opts.log ?? (() => {});
    this.conn = null;
    this.view = null;
    this.seat = null;
    this.status = 'watching';
    this.stack = 0;
    this.seq = null;
    this.members = [];
    this.leader = null;
    this.balance = null;
    this.errors = {};
    this.playing = false;
    this.leaving = false;
    this.readyFor = null;
    this.lastMove = null;
    this.quietUntil = 0;
    this.timer = null;
    this.rounds = 0;
    this.firstRound = null;
  }

  /** Open (or reopen) the table socket; resolves with the snapshot. */
  async connect() {
    const extra = this.pin ? `&pin=${this.pin}` : '';
    const conn = this.server.connect(`table/${this.tableId}`, this.account, this.meter, extra);
    this.conn = conn;
    conn.on((m) => this.receive(m, conn));
    const snap = await conn.next((m) => m.t === 'table', 15_000);
    return snap;
  }

  receive(m, conn) {
    if (conn !== this.conn) return;
    switch (m.t) {
      case 'table':
        this.meta = m.meta;
        this.view = m.view;
        this.seat = m.you.seat;
        this.status = m.you.status;
        this.stack = m.you.stack;
        this.seq = m.seq;
        this.members = m.members;
        this.leader = m.leader;
        break;
      case 'ev':
        // The protocol's rule: a gap in seq means something was missed, so ask for the table.
        if (this.seq !== null && m.seq !== this.seq + 1) {
          this.meter.gaps++;
          conn.send({ t: 'sync' });
        }
        this.seq = m.seq;
        this.view = m.view;
        break;
      case 'seat':
        this.status = m.status;
        this.stack = m.stack;
        if (m.seat !== null && m.seat !== undefined) this.seat = m.seat;
        break;
      case 'members':
        this.members = m.members;
        this.leader = m.leader;
        break;
      case 'balance':
        this.balance = m.balance;
        break;
      case 'err':
        this.errors[m.code] = (this.errors[m.code] ?? 0) + 1;
        // Told to slow down: do.
        if (m.code === 'RATE_LIMITED') this.quietUntil = Date.now() + 1_000;
        break;
    }
    const r = roundOf(this.game, this.view);
    if (this.firstRound === null && this.status === 'seated') this.firstRound = r;
    if (this.firstRound !== null) this.rounds = Math.max(this.rounds, r - this.firstRound);
    this.schedule();
  }

  /** Think a moment after anything changes, like a person would (and so a burst isn't a flood). */
  schedule() {
    if (!this.playing || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.think();
    }, 40 + Math.floor(this.rand() * 160));
  }

  think() {
    if (!this.playing || this.leaving || this.status !== 'seated' || this.seat === null || !this.conn || Date.now() < this.quietUntil) return;
    const move = botMove(this.game, this.view, { seat: this.seat, stack: this.stack }, this.rand);
    if (move) {
      // One try per move per table state: a refused move isn't hammered.
      const key = `${this.seq}:${JSON.stringify(move)}`;
      if (key !== this.lastMove) {
        this.lastMove = key;
        this.act(move);
        return;
      }
    }
    if (botDoneBetting(this.game, this.view, this.seat)) {
      const window = `${roundOf(this.game, this.view)}`;
      if (this.readyFor !== window) {
        this.readyFor = window;
        if (ENGINE_READY.has(this.game)) this.act({ type: 'ready', on: true });
        else this.conn.send({ t: 'ready', on: true });
      }
    }
    // Craps: the pause after a roll closes early once everyone but the shooter is ready.
    if (this.game === 'craps' && this.view?.phase === 'open') {
      const window = `c${this.view.rolls}`;
      if (this.readyFor !== window) {
        this.readyFor = window;
        this.conn.send({ t: 'ready', on: true });
      }
    }
  }

  act(a) {
    return this.conn?.send({ t: 'act', aid: `ld${(++aidSeq).toString(36)}`, a });
  }

  async buyIn(amount = BUY_IN[this.game]) {
    this.conn.send({ t: 'buyin', aid: `ld${(++aidSeq).toString(36)}`, amount });
    await this.conn.next((m) => (m.t === 'seat' && m.status === 'seated') || (m.t === 'err' && ['INSUFFICIENT_FUNDS', 'BUSY', 'LIMIT'].includes(m.code)), 15_000);
    return this.status === 'seated';
  }

  topUp(amount) {
    return this.conn?.send({ t: 'topup', aid: `ld${(++aidSeq).toString(36)}`, amount });
  }

  start() {
    this.playing = true;
    this.schedule();
  }

  /** Stand up and cash out; resolves once the table has let go (it closes the socket). */
  async leave(ms = 60_000) {
    this.leaving = true;
    this.playing = false;
    const conn = this.conn;
    if (!conn || conn.closed) return null;
    conn.send({ t: 'leave' });
    const timeout = new Promise((r) => setTimeout(() => r({ code: -1, reason: 'still seated' }), ms));
    return Promise.race([conn.done, timeout]);
  }

  /** The network drops (the server sees a close it didn't ask for). */
  drop() {
    const conn = this.conn;
    this.conn = null;
    conn?.close(4999, 'simulated drop');
  }
}
