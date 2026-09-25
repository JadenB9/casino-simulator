// CasinoTable: one Durable Object per lobby or solo session. It is the record of every seat's
// stack while that seat plays, hosts the game's engine, and is the only thing that moves money
// between a table and D1.
//
// The shape of every change:
//   message -> validate -> engine (pure, synchronous) -> one storage transaction -> alarm -> send
// Nothing awaits between reading a stack and writing it. The only awaited work is the outbox
// (buy-ins and cash-outs against D1) and best-effort notes to the floor, and a seat that is
// buying in or cashing out can't bet, so nothing a transition reads is changed under it.

import { DurableObject } from 'cloudflare:workers';
import type { GameEngine, GameEvent, EngineCtx, SeatCtx, Step, TableConfig, TableMode, GameId } from '../../../shared/src/engine.ts';
import { isRefusal } from '../../../shared/src/engine.ts';
import { engineFor } from '../../../shared/src/games/index.ts';
import { gameInfo, isGameId, variantOf } from '../../../shared/src/games/catalog.ts';
import { cryptoRng, type Rng } from '../../../shared/src/rng.ts';
import { lookFromJson } from '../../../shared/src/look.ts';
import { formatMoney, type Cents } from '../../../shared/src/money.ts';
import { applyLimits, clampLimits, hasLimitChoice, limitsOf, parseLimitsParam, sameLimits, type TableLimits } from '../../../shared/src/limits.ts';
import {
  CLOSE,
  IDLE_MS,
  MAX_TABLE_FRAME,
  PROTOCOL_VERSION,
  parseTableMsg,
  parseSay,
  type ChatServerMsg,
  type ErrorCode,
  type LobbySummary,
  type Member,
  type SeatStatus,
  type TableMeta,
  type TableServerMsg,
} from '../../../shared/src/protocol.ts';
import { applyTransfer, buyInStatements, cashOutStatements, refundStatements, moneyOf, type SeatStats } from '../transfer.ts';
import { Bucket, KeyedBuckets } from '../ratelimit.ts';
import { closeWith } from '../http.ts';
import { ipKey } from '../floor/directory.ts';
import { spendTicket } from '../tickets.ts';
import type { CasinoFloor } from '../floor/index.ts';
import { ChatRoom } from '../floor/chat.ts';
import { bigWinsIn, type BigWinReport } from '../floor/wins.ts'; // features: big wins
import { TableLaw, type LawNote } from '../law-table.ts'; // v6 law6
import { FeatBook, stepFacts } from '../feats.ts'; // v6 feats: achievements and challenges
import { RunBook } from '../stats.ts'; // v6 stats6: win runs, day and week nets

/** How long a dropped player keeps their seat before being cashed out. */
export const GRACE_MS = 120_000;
/** After a restart, turn timers get this much extra so reconnecting players aren't timed out. */
export const RESTART_SHIFT_MS = 20_000;
/** Lobby tables tell the floor they're alive this often. */
const HEARTBEAT_MS = 60_000;
/** An empty lobby table closes after this long. */
const EMPTY_CLOSE_MS = 120_000;
/** A leader who drops keeps the lead this long before it passes to someone still here. */
export const LEADER_HANDOFF_MS = 20_000;
const RETRY_MAX_MS = 60_000;
/** Wrong PINs one account may try at a private table before it is refused for a while. */
const PIN_MISSES = 5;
const PIN_LOCK_MS = 10 * 60_000;
/**
 * Wrong PINs the whole world may try against one PIN of one table in that window. Accounts are
 * free and addresses are cheap, so without this many hands could still sweep 10,000 PINs; the
 * leader can draw a fresh PIN (private, public, private) to open the door again.
 */
export const PIN_TABLE_MISSES = 30;
/**
 * Connections one account may open to this table: a burst, then one every few seconds. Each
 * connect sends a whole snapshot and tells everyone, so a reconnect loop is a broadcast loop.
 */
export const CONNECT_BURST = 10;
const CONNECT_PER_SEC = 1 / 3;
/** What an honest client never gets near: a burst of frames of any kind, then a steady rate. */
const FRAME_BURST = 60;
const FRAME_PER_SEC = 30;
/** Dropped or refused frames a socket may run up before it is closed; they're forgiven slowly. */
export const STRIKES = 40;
const STRIKE_FORGIVE_PER_SEC = 0.2;
/** Longest the alarm waits before retrying an engine deadline that tick() couldn't clear. */
const OVERDUE_MAX_MS = 5_000;
/**
 * A member's idle deadline (IDLE_MS after their last real message) is written with this much to
 * spare, so it is written at most once a minute however busy they are, and never falls due early.
 */
const IDLE_SLACK_MS = 60_000;

type MemberRow = {
  account_id: number;
  name: string;
  look: string;
  station: string | null;
  joined_at: number;
  seat: number | null;
  status: SeatStatus;
  stack: number;
  escrow: number;
  live: number;
  ready: number;
  leaving: number;
  disconnected_at: number | null;
  rounds: number;
  wagered: number;
  net: number;
  biggest_win: number;
};

type OutboxRow = {
  op_id: string;
  kind: 'buyin' | 'topup' | 'cashout' | 'refund';
  account_id: number;
  amount: number;
  payload: string | null;
  state: 'pending' | 'done' | 'failed';
  attempts: number;
  next_at: number;
  created_at: number;
};

interface Meta {
  name: string;
  game: GameId;
  variant: string;
  mode: TableMode;
  visibility: 'public' | 'private';
  pin: string | null;
  started: boolean;
  leader: number | null;
  incarnation: string;
  seq: number;
  opSeq: number;
  config: TableConfig;
  engineVersion: number;
  createdAt: number;
  closed: boolean;
  /**
   * Seats given up while a round was in play. The engine may still hold the last occupant's
   * round under that number, so nobody new buys into one until the table is quiet again.
   * (Absent in tables made before this existed.)
   */
  held?: number[];
}

interface Att {
  accountId: number;
}

/** Per-socket limits: every frame, then per kind of message, and the strikes that close it. */
interface SocketLimits {
  frames: Bucket;
  act: Bucket;
  misc: Bucket;
  money: Bucket;
  strikes: Bucket;
}

/** A card code as the engines write them ("As", "Td"). */
const CARD_RE = /^[2-9TJQKA][shdc]$/;

/** Every card code anywhere in a view. */
function cardsIn(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') {
    if (CARD_RE.test(x)) out.push(x);
  } else if (Array.isArray(x)) {
    for (const v of x) cardsIn(v, out);
  } else if (typeof x === 'object' && x !== null) {
    for (const v of Object.values(x)) cardsIn(v, out);
  }
  return out;
}

type Engine = GameEngine<unknown, unknown, unknown>;

export interface InitParams {
  name: string;
  game: GameId;
  variant: string;
  mode: TableMode;
  visibility: 'public' | 'private';
  pin: string | null;
  /** The table's limits as chosen (clamped again here); Standard when left out. */
  limits?: TableLimits | null;
}

/** A game's Standard config, at the given limits when there are any to choose. */
function configAt(engine: Engine, p: { game: GameId; variant: string; mode: TableMode; limits?: TableLimits | null }): TableConfig {
  const cfg = engine.config(p.variant, p.mode);
  const l = p.limits ? clampLimits(p.game, p.limits) : null;
  return l ? applyLimits(cfg, l) : cfg;
}

export class CasinoTable extends DurableObject<Env> {
  private sql: SqlStorage;
  private meta: Meta | null = null;
  private engine: Engine | null = null;
  private state: unknown = null;
  private members = new Map<number, MemberRow>();
  private rng: Rng = cryptoRng();
  private pumping: Promise<void> | null = null;
  private alarmAt: number | null = null;
  private buckets = new Map<WebSocket, SocketLimits>();
  private connects = new KeyedBuckets(CONNECT_BURST, CONNECT_PER_SEC);
  /** Alarms in a row that found the engine's deadline still due after running it. */
  private overdue = 0;
  /** Each member's `idle:` deadline as last written (a cache: a restart just writes it again). */
  private idleDue = new Map<number, number>();
  /** v6 law6: hot streaks for the pit boss, and a jail table's rounds toward bail (law-table.ts). */
  private law: TableLaw | null = null;
  /** v6 feats: tallies and feats earned here, on their way to D1 (server/src/feats.ts). */
  private feats: FeatBook;
  /** v6 stats6: each player's run of winning rounds here (server/src/stats.ts). */
  private runs: RunBook;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS members (
      account_id INTEGER PRIMARY KEY, name TEXT NOT NULL, look TEXT NOT NULL, station TEXT,
      joined_at INTEGER NOT NULL, seat INTEGER, status TEXT NOT NULL,
      stack INTEGER NOT NULL DEFAULT 0 CHECK (stack >= 0), escrow INTEGER NOT NULL DEFAULT 0,
      live INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0, leaving INTEGER NOT NULL DEFAULT 0,
      disconnected_at INTEGER,
      rounds INTEGER NOT NULL DEFAULT 0, wagered INTEGER NOT NULL DEFAULT 0, net INTEGER NOT NULL DEFAULT 0,
      biggest_win INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS aids (account_id INTEGER NOT NULL, aid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (account_id, aid)) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS outbox (
      op_id TEXT PRIMARY KEY, kind TEXT NOT NULL, account_id INTEGER NOT NULL, amount INTEGER NOT NULL,
      payload TEXT, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS deadlines (name TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID`);
    // Wrong PINs per account and per address, stored so an eviction doesn't reset the count.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pin_misses (who TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL) WITHOUT ROWID`);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.feats = new FeatBook(this.sql, () => `flush:${this.meta?.incarnation ?? ''}`, (fn) => ctx.storage.transactionSync(fn));
    this.runs = new RunBook(this.sql); // v6 stats6
    this.load();
  }

  // ------------------------------------------------------------------------------------------
  // Loading and restart recovery

  private load(): void {
    const rows = this.sql.exec<{ k: string; v: string }>(`SELECT k, v FROM meta`).toArray();
    if (rows.length === 0) return;
    const m = Object.fromEntries(rows.map((r) => [r.k, JSON.parse(r.v)])) as unknown as Meta;
    this.meta = m;
    this.engine = engineFor(m.game) as Engine;
    for (const r of this.sql.exec<MemberRow>(`SELECT * FROM members`).toArray()) this.members.set(r.account_id, { ...r });
    const st = this.sql.exec<{ json: string }>(`SELECT json FROM state WHERE id = 1`).toArray()[0];
    this.state = st ? JSON.parse(st.json) : null;

    const now = Date.now();
    const voided = m.engineVersion !== this.engine.stateVersion || this.state === null;
    // The stored round was written by a different version of the rules. Void it: every seat
    // gets back what it had on the layout, and a fresh game state starts. The seats themselves
    // are still held below like after any restart (returning here left dropped players' seats,
    // and their escrows, open with no grace period to close them).
    if (voided) this.voidRound(now);
    // Sockets don't survive a restart and no close events arrive for them, so anyone seated
    // without a socket has just been dropped by us, not by their network. Start their grace
    // period now and give the table's timers the same breathing room, once.
    const live = new Set(this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Att | null)?.accountId));
    let dropped = false;
    for (const mem of this.members.values()) {
      if (!live.has(mem.account_id) && mem.disconnected_at === null) {
        dropped = true;
        mem.disconnected_at = now;
        this.sql.exec(`UPDATE members SET disconnected_at = ?1 WHERE account_id = ?2`, now, mem.account_id);
        this.setDeadline(`grace:${mem.account_id}`, now + GRACE_MS);
      }
    }
    // A leader the restart dropped hands on the lead like one whose network dropped, rather than
    // keeping it through the whole grace period while everyone else waits to press Start.
    if (m.mode === 'multi' && m.leader !== null && !live.has(m.leader) && !this.hasDeadline('leader')) {
      this.setDeadline('leader', now + LEADER_HANDOFF_MS);
    }
    if (!voided && dropped && this.engine.deadline(this.state) !== null) {
      this.state = this.engine.shiftDeadlines(this.state, RESTART_SHIFT_MS);
      this.sql.exec(`INSERT OR REPLACE INTO state (id, json) VALUES (1, ?1)`, JSON.stringify(this.state));
    }
  }

  private voidRound(now: number): void {
    const m = this.meta!;
    const engine = this.engine!;
    this.ctx.storage.transactionSync(() => {
      for (const mem of this.members.values()) {
        if (mem.live > 0) {
          mem.stack += mem.live;
          mem.live = 0;
          this.sql.exec(`UPDATE members SET stack = ?1, live = 0 WHERE account_id = ?2`, mem.stack, mem.account_id);
        }
      }
      this.state = engine.create(m.config, this.engineCtx(now));
      m.engineVersion = engine.stateVersion;
      this.sql.exec(`INSERT OR REPLACE INTO state (id, json) VALUES (1, ?1)`, JSON.stringify(this.state));
      this.putMeta('engineVersion', m.engineVersion);
      // A fresh state remembers nobody's round.
      m.held = [];
      this.putMeta('held', m.held);
    });
  }

  private putMeta<K extends keyof Meta>(k: K, v: Meta[K]): void {
    this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)`, k, JSON.stringify(v));
  }

  // ------------------------------------------------------------------------------------------
  // RPC from the Worker and the floor

  /** Create a lobby table. Called once by the Worker right after the floor allocates the id. */
  async init(p: InitParams): Promise<{ ok: true }> {
    if (this.meta) return { ok: true };
    this.create(p, Date.now());
    await this.syncDirectory();
    return { ok: true };
  }

  private create(p: InitParams, now: number): void {
    const engine = engineFor(p.game) as Engine;
    const config = configAt(engine, p);
    const meta: Meta = {
      name: p.name,
      game: p.game,
      variant: p.variant,
      mode: p.mode,
      visibility: p.visibility,
      pin: p.pin,
      started: p.mode === 'solo' || gameInfo(p.game).autoStart === true,
      leader: null,
      incarnation: crypto.randomUUID(),
      seq: 0,
      opSeq: 0,
      config,
      engineVersion: engine.stateVersion,
      createdAt: now,
      closed: false,
    };
    this.meta = meta;
    this.engine = engine;
    this.state = engine.create(config, this.engineCtx(now));
    this.ctx.storage.transactionSync(() => {
      for (const [k, v] of Object.entries(meta)) this.putMeta(k as keyof Meta, v as never);
      this.sql.exec(`INSERT OR REPLACE INTO state (id, json) VALUES (1, ?1)`, JSON.stringify(this.state));
    });
    if (p.mode === 'multi') {
      this.setDeadline('heartbeat', now + HEARTBEAT_MS);
      // Nobody may ever come: a lobby that stays empty closes like one that empties.
      this.setDeadline('close', now + EMPTY_CLOSE_MS);
    }
    this.scheduleAlarm();
  }

  /**
   * A solo table takes the limits it is opened with. Chips still on it (a seat held through a
   * dropped connection, a buy-in or cash-out on its way, bets out) keep the limits they were
   * bought in at until they are cashed out: the player sees the table's real limits in the
   * snapshot, and the client says why they differ. A new game state starts at the new limits.
   */
  private relimit(asked: TableLimits | null, now: number): void {
    const m = this.meta!;
    const engine = this.engine!;
    const want = asked ? clampLimits(m.game, asked) : null;
    if (!want || sameLimits(want, limitsOf(m.config))) return;
    for (const mem of this.members.values()) if (mem.status !== 'watching' || mem.stack > 0 || mem.live > 0) return;
    if (this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE state = 'pending'`).one().n > 0) return;
    const config = applyLimits(engine.config(m.variant, m.mode), want);
    this.ctx.storage.transactionSync(() => {
      m.config = config;
      this.state = engine.create(config, this.engineCtx(now));
      this.putMeta('config', config);
      this.sql.exec(`INSERT OR REPLACE INTO state (id, json) VALUES (1, ?1)`, JSON.stringify(this.state));
      // A fresh state remembers nobody's round.
      if (m.held?.length) {
        m.held = [];
        this.putMeta('held', m.held);
      }
    });
  }

  /** What the lobby list shows. */
  summary(): LobbySummary | null {
    const m = this.meta;
    if (!m || m.mode !== 'multi' || m.closed) return null;
    const leader = m.leader !== null ? this.members.get(m.leader)?.name ?? '' : '';
    return {
      tableId: m.name,
      game: m.game,
      variant: m.variant,
      leader,
      players: this.members.size,
      max: m.config.maxSeats,
      started: m.started,
      ...(hasLimitChoice(m.game) ? { limits: limitsOf(m.config) } : {}),
    };
  }

  /**
   * Called by /me and /bank/loan for an escrow that has been open a while: report the live stack
   * and the bets it has out, cash out a seat nobody is using, or refund an escrow this table has
   * no record of. `pending` means chips are still moving to or from D1 (a buy-in, a top-up, a
   * cash-out), so the bank waits rather than count them.
   */
  async reconcile(accountId: number): Promise<{ stack?: Cents; live?: Cents; pending?: true; refunded?: true }> {
    const mem = this.members.get(accountId);
    const now = Date.now();
    if (mem) {
      if (mem.status === 'seated' && mem.disconnected_at !== null && now - mem.disconnected_at > GRACE_MS) {
        this.beginLeave(mem, now);
        await this.pump();
      }
      const again = this.members.get(accountId);
      if (!again) return { pending: true };
      const moving = again.status !== 'seated' || this.topUpPending(accountId);
      return { stack: again.stack, live: again.live, pending: moving ? true : undefined };
    }
    const pending = this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE account_id = ?1 AND state = 'pending'`, accountId).one().n;
    if (pending > 0) {
      await this.pump();
      return { pending: true };
    }
    // No seat and nothing in flight: whatever escrow D1 holds for us is orphaned. Refund it.
    this.enqueue('refund', accountId, 0, null, now);
    await this.pump();
    return { refunded: true };
  }

  // ------------------------------------------------------------------------------------------
  // Sockets

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const accountId = Number(request.headers.get('x-casino-account'));
    const name = request.headers.get('x-casino-name') ?? '';
    const look = request.headers.get('x-casino-look') ?? '{}';
    const tableName = request.headers.get('x-casino-table') ?? '';
    const station = request.headers.get('x-casino-station');
    const solo = request.headers.get('x-casino-solo');
    const now = Date.now();

    // Before anything is written or sent: a reconnect loop gets a burst, then waits (4008 makes
    // the client back off).
    if (!this.connects.take(`a:${accountId}`)) return closeWith(CLOSE.RATE_LIMITED, 'slow down');
    if (!this.meta && solo) {
      const [game, variant] = solo.split('|');
      if (!isGameId(game)) return new Response('bad game', { status: 400 });
      this.create({ name: tableName, game, variant: variantOf(game, variant), mode: 'solo', visibility: 'private', pin: null, limits: parseLimitsParam(request.headers.get('x-casino-limits')) }, now);
    }
    const m = this.meta;
    if (!m || m.closed) return closeWith(CLOSE.NOT_FOUND, 'no such table');
    if (m.mode === 'solo' && !tableName.endsWith(`:${accountId}`)) return closeWith(CLOSE.FORBIDDEN, 'not your table');
    // The ticket that let this socket through the Worker opens it once (tickets.ts). Spent only
    // once the table is known to exist, so probing a made-up id still writes nothing.
    if (!spendTicket(this.sql, request.headers.get('x-casino-ticket'), Number(request.headers.get('x-casino-ticket-exp')), now)) {
      return closeWith(CLOSE.TICKET, 'ticket used');
    }
    // Each sitting at a solo table brings its own limits (kept while chips are still on it).
    if (m.mode === 'solo' && solo) this.relimit(parseLimitsParam(request.headers.get('x-casino-limits')), now);
    let mem = this.members.get(accountId);
    if (!mem) {
      if (this.members.size >= m.config.maxSeats) return closeWith(CLOSE.FORBIDDEN, 'table full');
      // A private lobby lets in only people who bring its PIN. Members already inside when it
      // went private stay members; everyone else, even someone who saw it listed, needs the PIN.
      if (m.mode === 'multi' && m.visibility === 'private') {
        const refused = this.checkPin(accountId, request.headers.get('x-casino-ip') ?? '', request.headers.get('x-casino-pin'), now);
        // FORBIDDEN either way: the client must not keep retrying a lobby it can't enter.
        if (refused) return closeWith(CLOSE.FORBIDDEN, refused === 'locked' ? 'too many tries' : 'wrong pin');
      }
      mem = this.addMember(accountId, name, look, station, now);
      this.markActive(accountId, now);
    } else if (mem.leaving) {
      // Still settling the bets left behind when they stood up (a craps point, say): the seat is
      // on its way out and can't be reopened until that's done and it has cashed out.
      return closeWith(CLOSE.FORBIDDEN, 'still leaving');
    } else {
      mem.name = name || mem.name;
      mem.look = look;
      mem.station = station;
      mem.disconnected_at = null;
      this.sql.exec(
        `UPDATE members SET name = ?1, look = ?2, station = ?3, disconnected_at = NULL WHERE account_id = ?4`,
        mem.name, mem.look, mem.station, accountId,
      );
      this.clearDeadline(`grace:${accountId}`);
      if (m.leader === accountId) this.clearDeadline('leader');
      // Coming back isn't activity (a flaky network reconnects on its own), but a player whose
      // idle deadline passed while they were away gets a whole new one.
      if (!this.hasDeadline(`idle:${accountId}`)) this.markActive(accountId, now);
    }
    // Newest connection wins: an older socket for this account is told why it's being closed.
    for (const old of this.ctx.getWebSockets(`a:${accountId}`)) {
      try {
        old.close(CLOSE.REPLACED, 'opened elsewhere');
      } catch {
        /* already gone */
      }
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [`a:${accountId}`]);
    server.serializeAttachment({ accountId } satisfies Att);
    this.send(server, this.snapshotFor(accountId, now));
    this.chatJoin(server);
    this.broadcastMembers();
    this.runTicks(now);
    this.ctx.waitUntil(this.noteFloor(accountId, station));
    this.ctx.waitUntil(this.syncDirectory());
    this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Null if this PIN opens the table; otherwise why not. */
  private checkPin(accountId: number, ip: string, pin: string | null, now: number): 'wrong' | 'locked' | null {
    // Names are free, so the address counts too (when the edge gave us one), per /64 for IPv6
    // since one user can pick a new address from theirs for every try. And everyone's misses
    // against this PIN count together, so many accounts on many addresses can't sweep it either.
    const keys: [string, number][] = [[`a:${accountId}`, PIN_MISSES], [`pin:${this.meta!.pin}`, PIN_TABLE_MISSES]];
    if (ip) keys.push([`ip:${ipKey(ip)}`, PIN_MISSES]);
    this.sql.exec(`DELETE FROM pin_misses WHERE until <= ?1`, now);
    const misses = (who: string) => this.sql.exec<{ n: number }>(`SELECT n FROM pin_misses WHERE who = ?1`, who).toArray()[0]?.n ?? 0;
    if (keys.some(([k, limit]) => misses(k) >= limit)) return 'locked';
    if (pin !== null && pin === this.meta!.pin) return null;
    for (const [k] of keys) {
      this.sql.exec(`INSERT INTO pin_misses (who, n, until) VALUES (?1, 1, ?2) ON CONFLICT(who) DO UPDATE SET n = n + 1`, k, now + PIN_LOCK_MS);
    }
    return 'wrong';
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Att | null;
    if (!att || !this.meta) return;
    if (typeof raw !== 'string' || raw.length > MAX_TABLE_FRAME) {
      ws.close(1009, 'frame too large');
      return;
    }
    const b = this.bucketsFor(ws);
    // Every frame counts, junk and chat included: a flood that fails to parse costs the table as
    // much as one that doesn't. Junk and overflow are dropped without a reply and count as strikes.
    let data: unknown;
    if (b.frames.take()) {
      try {
        data = JSON.parse(raw);
      } catch {
        /* not JSON */
      }
    }
    // Chat keeps its own limits and mutes (floor/chat.ts) on top of the frame count.
    const say = parseSay(data);
    if (say) {
      if (this.members.has(att.accountId)) this.markActive(att.accountId, Date.now());
      this.chatSay(ws, att.accountId, say.text);
      this.scheduleAlarm();
      return;
    }
    const msg = parseTableMsg(data);
    if (!msg) {
      this.strike(ws, b);
      return;
    }
    const bucket = msg.t === 'act' ? b.act : msg.t === 'buyin' || msg.t === 'topup' || msg.t === 'cashout' ? b.money : b.misc;
    if (!bucket.take()) {
      if (this.strike(ws, b)) this.send(ws, { t: 'err', code: 'RATE_LIMITED', msg: 'Too fast.' });
      return;
    }
    const mem = this.members.get(att.accountId);
    if (!mem) return;
    const now = Date.now();
    // Anything the player asked for is activity, `here` included; `sync` is the client's own.
    if (msg.t !== 'sync') this.markActive(mem.account_id, now);
    try {
      switch (msg.t) {
        case 'act':
          this.handleAct(ws, mem, msg.aid, msg.a, now);
          break;
        case 'buyin':
        case 'topup':
          this.handleBuyIn(ws, mem, msg.t, msg.aid, msg.amount, now);
          await this.pump();
          break;
        case 'cashout':
          this.handleCashOut(ws, mem, msg.aid, now);
          await this.pump();
          break;
        case 'ready':
          mem.ready = msg.on ? 1 : 0;
          this.sql.exec(`UPDATE members SET ready = ?1 WHERE account_id = ?2`, mem.ready, mem.account_id);
          this.broadcastMembers();
          this.runTicks(now);
          break;
        case 'visibility':
          await this.handleVisibility(ws, mem, msg.visibility);
          break;
        case 'start':
          this.handleStart(ws, mem, now);
          break;
        case 'leave':
          this.beginLeave(mem, now);
          await this.pump();
          break;
        case 'sync':
          this.send(ws, this.snapshotFor(mem.account_id, now));
          break;
        case 'here':
          break;
      }
    } catch (err) {
      console.error('table message failed', this.meta.name, msg.t, err);
      this.send(ws, { t: 'err', code: 'INTERNAL', msg: 'Something went wrong at the table.' });
    }
    this.scheduleAlarm();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
    this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onSocketGone(ws);
  }

  private onSocketGone(ws: WebSocket): void {
    this.buckets.delete(ws);
    const att = ws.deserializeAttachment() as Att | null;
    if (!att) return;
    const stillHere = this.ctx.getWebSockets(`a:${att.accountId}`).some((w) => w !== ws);
    if (stillHere) return;
    const mem = this.members.get(att.accountId);
    if (!mem) return;
    const now = Date.now();
    if (mem.status === 'watching' && mem.leaving === 0 && this.meta?.mode === 'multi') {
      // Never bought in: nothing to hold for them.
      this.removeMember(mem, now);
      return;
    }
    mem.disconnected_at = now;
    this.sql.exec(`UPDATE members SET disconnected_at = ?1 WHERE account_id = ?2`, now, mem.account_id);
    this.setDeadline(`grace:${mem.account_id}`, now + GRACE_MS);
    // The seat is held for the whole grace period, but a party can't wait that long for someone
    // to press Start or change the lobby, so the lead moves on sooner.
    if (this.meta?.mode === 'multi' && this.meta.leader === mem.account_id) this.setDeadline('leader', now + LEADER_HANDOFF_MS);
    this.broadcastMembers();
    this.runTicks(now);
    this.scheduleAlarm();
  }

  // ------------------------------------------------------------------------------------------
  // Alarm: deadlines, engine timers, the outbox

  async alarm(): Promise<void> {
    const now = Date.now();
    try {
      for (const d of this.sql.exec<{ name: string; at: number }>(`SELECT name, at FROM deadlines WHERE at <= ?1`, now).toArray()) {
        this.clearDeadline(d.name);
        if (d.name.startsWith('grace:')) {
          const mem = this.members.get(Number(d.name.slice(6)));
          if (mem && mem.disconnected_at !== null) this.beginLeave(mem, now);
        } else if (d.name === 'heartbeat') {
          if (this.members.size > 0) this.setDeadline('heartbeat', now + HEARTBEAT_MS);
          await this.syncDirectory();
        } else if (d.name === 'close') {
          if (this.members.size === 0) await this.closeTable();
        } else if (d.name === 'leader') {
          this.handOffLead();
        } else if (d.name.startsWith('idle:')) {
          const id = Number(d.name.slice(5));
          this.idleDue.delete(id);
          const mem = this.members.get(id);
          // Someone who dropped is the grace period's business; they get a new deadline if they return.
          if (mem && this.isConnected(id)) this.idleOut(mem, now);
        }
      }
      this.runTicks(now);
      this.sweepLeavers(now);
      await this.pump();
      const feats = this.feats.due();
      if (feats !== null && feats <= now) await this.runFeats();
      this.sql.exec(`DELETE FROM aids WHERE at < ?1`, now - 15 * 60_000);
    } catch (err) {
      console.error('table alarm failed', this.meta?.name, err);
    }
    // An engine deadline still due after running it (tick() had nothing to do, or its step was
    // refused) would bring the alarm straight back, every 10 ms, for as long as it lasts. Retry
    // with a growing wait instead, and say so once.
    const due = this.engine && this.state !== null ? this.engine.deadline(this.state) : null;
    if (due !== null && due <= now) {
      if (++this.overdue === 3) console.error('engine deadline stuck; backing off', this.meta?.name, due);
    } else {
      this.overdue = 0;
    }
    this.alarmAt = null;
    this.scheduleAlarm();
  }

  // ------------------------------------------------------------------------------------------
  // Idle members

  /** The member did something: their idle deadline stays at least IDLE_MS away. */
  private markActive(accountId: number, now: number): void {
    if ((this.idleDue.get(accountId) ?? 0) >= now + IDLE_MS) return;
    const at = now + IDLE_MS + IDLE_SLACK_MS;
    this.idleDue.set(accountId, at);
    this.setDeadline(`idle:${accountId}`, at);
  }

  /**
   * Nothing from a connected member for IDLE_MS: they're told why and stood up the way Leave does
   * it (live bets settle first, then the seat cashes out). The close goes first, so what the
   * leave says and does on its way (a watcher is removed at once) doesn't replace the reason.
   */
  private idleOut(mem: MemberRow, now: number): void {
    for (const ws of this.ctx.getWebSockets(`a:${mem.account_id}`)) {
      try {
        ws.close(CLOSE.IDLE, 'away');
      } catch {
        /* already closing */
      }
    }
    this.beginLeave(mem, now);
  }

  // ------------------------------------------------------------------------------------------
  // Members and the party

  private addMember(accountId: number, name: string, look: string, station: string | null, now: number): MemberRow {
    const m = this.meta!;
    const taken = new Set([...this.members.values()].map((x) => x.seat));
    // The lowest free seat, passing over seats held since someone left mid-round (a newcomer
    // could only watch from one of those until the round ends) unless no other is free.
    // (The caller has checked the table isn't full, so a seat below maxSeats is free.)
    const free: number[] = [];
    for (let s = 0; s < m.config.maxSeats; s++) if (!taken.has(s)) free.push(s);
    const held = new Set(m.held ?? []);
    const seat = free.find((s) => !held.has(s)) ?? free[0]!;
    // joined_at orders the party (who leads next), so two joins in one millisecond still get
    // distinct, increasing times.
    const last = Math.max(0, ...[...this.members.values()].map((x) => x.joined_at));
    const joinedAt = Math.max(now, last + 1);
    const row: MemberRow = {
      account_id: accountId, name, look, station, joined_at: joinedAt, seat, status: 'watching', stack: 0, escrow: 0, live: 0,
      ready: 0, leaving: 0, disconnected_at: null, rounds: 0, wagered: 0, net: 0, biggest_win: 0,
    };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO members (account_id, name, look, station, joined_at, seat, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'watching')`,
        accountId, name, look, station, joinedAt, seat,
      );
      this.members.set(accountId, row);
      if (m.leader === null) {
        m.leader = accountId;
        this.putMeta('leader', accountId);
      }
      this.clearDeadline('close');
      // A heartbeat that found the table empty stopped; someone is here again, so restart it.
      if (m.mode === 'multi' && !this.hasDeadline('heartbeat')) this.setDeadline('heartbeat', now + HEARTBEAT_MS);
    });
    return row;
  }

  /** Who leads after `except`: whoever has been here longest, someone connected if possible. */
  private nextLeader(except: number): MemberRow | undefined {
    const rank = (x: MemberRow) => (this.isConnected(x.account_id) ? 0 : 1);
    return [...this.members.values()].filter((x) => x.account_id !== except).sort((a, b) => rank(a) - rank(b) || a.joined_at - b.joined_at)[0];
  }

  /** Pass the lead from a leader who dropped to whoever has been here longest and still is. */
  private handOffLead(): void {
    const m = this.meta!;
    if (m.mode !== 'multi' || m.leader === null || this.isConnected(m.leader)) return;
    const next = this.nextLeader(m.leader);
    if (!next || !this.isConnected(next.account_id)) {
      // Nobody here to take it yet: look again in a while rather than never.
      this.setDeadline('leader', Date.now() + LEADER_HANDOFF_MS);
      return;
    }
    m.leader = next.account_id;
    this.putMeta('leader', m.leader);
    this.broadcastMembers();
    this.ctx.waitUntil(this.syncDirectory());
  }

  private removeMember(mem: MemberRow, now: number): void {
    const m = this.meta!;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM members WHERE account_id = ?1`, mem.account_id);
      this.members.delete(mem.account_id);
      this.clearDeadline(`grace:${mem.account_id}`);
      this.clearDeadline(`idle:${mem.account_id}`);
      this.idleDue.delete(mem.account_id);
      if (m.leader === mem.account_id) {
        const next = this.nextLeader(mem.account_id);
        m.leader = next ? next.account_id : null;
        this.putMeta('leader', m.leader);
        this.clearDeadline('leader');
        // Nobody else was connected, so the lead went to someone who is away: they keep it only
        // as long as any dropped leader would before it moves to whoever is here by then.
        if (next && !this.isConnected(next.account_id)) this.setDeadline('leader', now + LEADER_HANDOFF_MS);
      }
      // The engine may still hold this seat's part of the round in play (a folded hand, say), so
      // the number isn't handed to anyone new until the table is quiet.
      const held = m.held ?? [];
      let next = held;
      if (this.roundInPlay()) {
        if (mem.seat !== null && !held.includes(mem.seat)) next = [...held, mem.seat];
      } else if (held.length) {
        next = [];
      }
      if (next !== held) {
        m.held = next;
        this.putMeta('held', next);
      }
      if (this.members.size === 0 && m.mode === 'multi') this.setDeadline('close', now + EMPTY_CLOSE_MS);
    });
    // Say so, then close: someone who has left the table sees nothing more of it (its PIN,
    // who is at it, its play) through a socket left open.
    for (const ws of this.ctx.getWebSockets(`a:${mem.account_id}`)) {
      this.send(ws, { t: 'seat', status: 'watching', stack: 0, escrow: 0, seat: null });
      try {
        ws.close(1000, 'left the table');
      } catch {
        /* already closing */
      }
    }
    this.broadcastMembers();
    this.ctx.waitUntil(this.noteFloor(mem.account_id, null));
    this.ctx.waitUntil(this.syncDirectory());
  }

  private async handleVisibility(ws: WebSocket, mem: MemberRow, visibility: 'public' | 'private'): Promise<void> {
    const m = this.meta!;
    if (m.mode !== 'multi') return;
    if (m.leader !== mem.account_id) return this.err(ws, 'NOT_LEADER', 'Only the party leader can change that.');
    if (m.visibility === visibility) return;
    let pin: string | null = null;
    try {
      const floor = this.floor();
      pin = visibility === 'private' ? await floor.allocatePin(m.name, m.game) : null;
      if (visibility === 'public') await floor.releasePin(m.name);
    } catch (err) {
      console.error('pin allocation failed', err);
      return this.err(ws, 'INTERNAL', "Couldn't change the lobby right now.");
    }
    if (visibility === 'private' && !pin) return this.err(ws, 'INTERNAL', 'No PIN available right now.');
    m.visibility = visibility;
    m.pin = pin;
    this.ctx.storage.transactionSync(() => {
      this.putMeta('visibility', visibility);
      this.putMeta('pin', pin);
    });
    this.broadcastMembers();
    await this.syncDirectory();
  }

  private handleStart(ws: WebSocket, mem: MemberRow, now: number): void {
    const m = this.meta!;
    if (m.mode !== 'multi' || m.started) return;
    if (m.leader !== mem.account_id) return this.err(ws, 'NOT_LEADER', 'Only the party leader can start.');
    const need = this.engine!.seats.min;
    if (this.members.size < need) return this.err(ws, 'WRONG_PHASE', `This game needs at least ${need} players.`);
    m.started = true;
    this.putMeta('started', true);
    this.broadcastMembers();
    this.runTicks(now);
    this.ctx.waitUntil(this.syncDirectory());
  }

  // ------------------------------------------------------------------------------------------
  // Money at the edges: buy-in, top-up, cash-out

  private handleBuyIn(ws: WebSocket, mem: MemberRow, kind: 'buyin' | 'topup', aid: string, amount: Cents, now: number): void {
    if (this.seenAid(mem.account_id, aid)) return;
    const cfg = this.meta!.config;
    if (mem.leaving) return this.err(ws, 'WRONG_PHASE', "You're leaving this table.", aid);
    if (kind === 'buyin' && mem.status !== 'watching') return this.err(ws, 'BUSY', "You're already sitting down.", aid);
    if (kind === 'topup' && mem.status !== 'seated') return this.err(ws, 'NOT_SEATED', 'Sit down first.', aid);
    if (kind === 'topup' && this.topUpPending(mem.account_id)) return this.err(ws, 'BUSY', 'Your last chips are still on the way.', aid);
    if (kind === 'buyin' && this.seatNotReady(mem, now)) return this.err(ws, 'BUSY', 'This seat opens when the round in play ends.', aid);
    const after = mem.stack + amount;
    if (amount % 100 !== 0) return this.err(ws, 'LIMIT', 'Chips come in whole dollars.', aid);
    if (kind === 'buyin' && (amount < cfg.buyIn.min || after > cfg.buyIn.max)) {
      return this.err(ws, 'LIMIT', `This table takes ${formatMoney(cfg.buyIn.min)} to ${formatMoney(cfg.buyIn.max)}.`, aid);
    }
    if (kind === 'topup' && (amount < 100 || after > cfg.buyIn.max)) {
      // Say how much more fits, not the buy-in range: the stack already counts toward it.
      const room = Math.max(0, cfg.buyIn.max - mem.stack);
      return this.err(
        ws,
        'LIMIT',
        room >= 100
          ? `This table takes ${formatMoney(cfg.buyIn.max)} at most: you can add up to ${formatMoney(room - (room % 100))}.`
          : `This table takes ${formatMoney(cfg.buyIn.max)} at most, and you have ${formatMoney(mem.stack)} here.`,
        aid,
      );
    }
    this.ctx.storage.transactionSync(() => {
      this.rememberAid(mem.account_id, aid, now);
      // A top-up doesn't stand the seat up: bets stay working (craps bets can stay up for many
      // rolls) and the chips join the stack when D1 confirms them. Cash-out waits for it.
      if (kind === 'buyin') {
        mem.status = 'buying_in';
        this.sql.exec(`UPDATE members SET status = 'buying_in' WHERE account_id = ?1`, mem.account_id);
      }
      this.enqueue(kind, mem.account_id, amount, null, now);
    });
    this.sendSeat(mem);
  }

  private topUpPending(accountId: number): boolean {
    return this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE account_id = ?1 AND kind = 'topup' AND state = 'pending'`, accountId).one().n > 0;
  }

  private handleCashOut(ws: WebSocket, mem: MemberRow, aid: string, now: number): void {
    if (this.seenAid(mem.account_id, aid)) return;
    if (mem.status !== 'seated') return this.err(ws, 'NOT_SEATED', "You don't have chips here.", aid);
    if (this.topUpPending(mem.account_id)) return this.err(ws, 'BUSY', 'Your last chips are still on the way.', aid);
    this.rememberAid(mem.account_id, aid, now);
    this.startCashOut(mem, now, false);
  }

  /** Stand the seat up: resolve its live bets, then cash out whatever is left, then leave. */
  private beginLeave(mem: MemberRow, now: number): void {
    if (!mem.leaving) {
      mem.leaving = 1;
      this.sql.exec(`UPDATE members SET leaving = 1 WHERE account_id = ?1`, mem.account_id);
    }
    if (mem.status === 'watching') {
      this.removeMember(mem, now);
      return;
    }
    if (mem.status === 'seated') this.startCashOut(mem, now, true);
  }

  private startCashOut(mem: MemberRow, now: number, leaving: boolean): void {
    if (mem.status !== 'seated' || mem.seat === null) return;
    // Cashing out before a top-up lands would close the escrow the top-up is adding to. The
    // sweep after the top-up finishes picks a leaving seat up again.
    if (this.topUpPending(mem.account_id)) return;
    const engine = this.engine!;
    // Let the game resolve what this seat has on the layout (stand, fold, return bets).
    const step = engine.seatLeaving(this.state, mem.seat, this.engineCtx(now));
    // A seat with nothing on the layout gets its state back untouched: nothing to store or send.
    if (step.state !== this.state || step.events.length || step.chips?.length || step.rounds?.length) this.commit(step, now);
    const live = engine.liveBets(this.state, mem.seat);
    if (live > 0) {
      // Contract bets still working (a craps line bet with a point, say). The sweep cashes the
      // seat out as soon as they resolve.
      if (leaving) this.sendSeat(mem);
      return;
    }
    const stats: SeatStats = {
      game: this.meta!.game,
      rounds: mem.rounds,
      wagered: mem.wagered,
      net: mem.net,
      biggestWin: mem.biggest_win,
    };
    this.ctx.storage.transactionSync(() => {
      mem.status = 'cashing_out';
      this.sql.exec(`UPDATE members SET status = 'cashing_out' WHERE account_id = ?1`, mem.account_id);
      this.enqueue('cashout', mem.account_id, mem.stack, JSON.stringify(stats), now);
    });
    this.sendSeat(mem);
    this.broadcastMembers();
  }

  /** Leaving seats whose last bets have now resolved, and busted seats, get cashed out. */
  private sweepLeavers(now: number): void {
    for (const mem of this.members.values()) {
      if (mem.status !== 'seated' || mem.seat === null) continue;
      const live = this.engine!.liveBets(this.state, mem.seat);
      if (live > 0) continue;
      // A busted seat is cashed out at $0 straight away: that closes its escrow, so a player
      // who has lost everything can go to the bank. They stay at the table and can buy in again.
      if (mem.leaving) this.startCashOut(mem, now, true);
      else if (mem.stack === 0) this.startCashOut(mem, now, false);
    }
  }

  private enqueue(kind: OutboxRow['kind'], accountId: number, amount: Cents, payload: string | null, now: number): string {
    const m = this.meta!;
    m.opSeq += 1;
    const opId = `${m.name}:${m.incarnation}:${m.opSeq}`;
    this.putMeta('opSeq', m.opSeq);
    this.sql.exec(
      `INSERT INTO outbox (op_id, kind, account_id, amount, payload, state, attempts, next_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, ?6)`,
      opId, kind, accountId, amount, payload, now,
    );
    return opId;
  }

  /** Apply pending outbox ops to D1, one at a time, at most a few per event. */
  private pump(): Promise<void> {
    if (this.pumping) return this.pumping;
    this.pumping = (async () => {
      try {
        await this.ctx.storage.sync();
        for (let n = 0; n < 5; n++) {
          const job = this.sql
            .exec<OutboxRow>(`SELECT * FROM outbox WHERE state = 'pending' AND next_at <= ?1 ORDER BY created_at LIMIT 1`, Date.now())
            .toArray()[0];
          if (!job) break;
          await this.runJob(job);
        }
      } finally {
        this.pumping = null;
        this.scheduleAlarm();
      }
    })();
    return this.pumping;
  }

  private async runJob(job: OutboxRow): Promise<void> {
    const m = this.meta!;
    const db = this.env.DB;
    const now = Date.now();
    try {
      if (job.kind === 'buyin' || job.kind === 'topup') {
        const out = await applyTransfer(db, buyInStatements(db, { opId: job.op_id, accountId: job.account_id, tableId: m.name, amount: job.amount, now }), job.op_id);
        this.finishBuyIn(job, out.kind === 'applied', Date.now());
        if (out.kind === 'applied') await this.sendBalance(job.account_id, out);
      } else if (job.kind === 'cashout') {
        const stats = job.payload ? (JSON.parse(job.payload) as SeatStats) : null;
        const out = await applyTransfer(
          db,
          cashOutStatements(db, { opId: job.op_id, accountId: job.account_id, tableId: m.name, stack: job.amount, now, stats }),
          job.op_id,
        );
        if (out.kind !== 'applied') throw new Error('cash-out refused');
        // The balance first: finishing a leaving seat's cash-out closes its socket.
        await this.sendBalance(job.account_id, out);
        this.finishCashOut(job, Date.now());
      } else {
        try {
          await applyTransfer(db, refundStatements(db, { opId: job.op_id, accountId: job.account_id, tableId: m.name, now }), job.op_id);
        } catch (err) {
          // NOT NULL here means there was no escrow left to refund; nothing to do.
          if (!String((err as Error)?.message ?? err).includes('NOT NULL')) throw err;
        }
        this.sql.exec(`UPDATE outbox SET state = 'done' WHERE op_id = ?1`, job.op_id);
      }
    } catch (err) {
      const attempts = job.attempts + 1;
      const wait = Math.min(RETRY_MAX_MS, 1000 * 2 ** Math.min(attempts, 6));
      console.error('outbox op failed; will retry', job.op_id, attempts, err);
      this.sql.exec(`UPDATE outbox SET attempts = ?1, next_at = ?2 WHERE op_id = ?3`, attempts, now + wait, job.op_id);
    }
  }

  private finishBuyIn(job: OutboxRow, applied: boolean, now: number): void {
    const mem = this.members.get(job.account_id);
    const engine = this.engine!;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`UPDATE outbox SET state = ?1 WHERE op_id = ?2`, applied ? 'done' : 'failed', job.op_id);
      if (!mem) {
        // They left while the buy-in was in flight: the chips landed on a seat nobody holds, so
        // send them straight back.
        if (applied) this.enqueue('cashout', job.account_id, job.amount, null, now);
        return;
      }
      if (applied) {
        mem.stack += job.amount;
        mem.escrow += job.amount;
      }
      if (job.kind === 'buyin') mem.status = applied ? 'seated' : 'watching';
      // Builds before this one parked a topping-up seat in 'buying_in'; bring it back.
      else if (mem.status === 'buying_in') mem.status = 'seated';
      this.sql.exec(`UPDATE members SET stack = ?1, escrow = ?2, status = ?3 WHERE account_id = ?4`, mem.stack, mem.escrow, mem.status, mem.account_id);
    });
    if (!mem) return;
    if (!applied) {
      for (const ws of this.ctx.getWebSockets(`a:${mem.account_id}`)) this.err(ws, 'INSUFFICIENT_FUNDS', "Your balance doesn't cover that.");
      // They asked to leave while it was in flight and there are no chips to cash out: go now,
      // rather than staying a member nobody can remove until a grace period runs out (and who
      // can't come back to the table until then).
      if (job.kind === 'buyin' && mem.leaving) {
        this.removeMember(mem, now);
        return;
      }
    }
    this.sendSeat(mem);
    this.broadcastMembers();
    if (applied && job.kind === 'buyin') {
      // v6 feats: a new sitting reads the player's progress again (they may have played elsewhere)
      this.feats.forget(mem.account_id);
      this.commit(engine.seatJoined(this.state, mem.seat!, this.engineCtx(now)), now);
      this.runTicks(now);
    } else if (job.kind === 'topup') {
      // A seat that stood up while this was in flight leaves now, bets and all (the sweep alone
      // would wait on bets nobody took down); one that went bust is picked up by the sweep.
      if (mem.leaving) this.startCashOut(mem, now, true);
      else this.sweepLeavers(now);
    }
  }

  private finishCashOut(job: OutboxRow, now: number): void {
    const mem = this.members.get(job.account_id);
    // v6 feats: the chips are home, and so is the progress made with them
    this.feats.flushSoon(job.account_id, now);
    this.ctx.waitUntil(this.runFeats());
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`UPDATE outbox SET state = 'done' WHERE op_id = ?1`, job.op_id);
      if (!mem) return;
      mem.stack = Math.max(0, mem.stack - job.amount);
      mem.escrow = 0;
      mem.status = 'watching';
      mem.rounds = mem.wagered = mem.net = mem.biggest_win = 0;
      this.sql.exec(
        `UPDATE members SET stack = ?1, escrow = 0, status = 'watching', rounds = 0, wagered = 0, net = 0, biggest_win = 0 WHERE account_id = ?2`,
        mem.stack, mem.account_id,
      );
    });
    if (!mem) return;
    if (mem.leaving) this.removeMember(mem, now);
    else {
      this.sendSeat(mem);
      this.broadcastMembers();
    }
  }

  private async sendBalance(accountId: number, out: { balance?: number; inPlay?: number; rev?: number }): Promise<void> {
    let money = out.balance !== undefined ? { balance: out.balance, in_play: out.inPlay!, rev: out.rev! } : null;
    if (!money) money = await moneyOf(this.env.DB, accountId);
    if (!money) return;
    for (const ws of this.ctx.getWebSockets(`a:${accountId}`)) {
      this.send(ws, { t: 'balance', balance: money.balance, inPlay: money.in_play, rev: money.rev });
    }
  }

  // ------------------------------------------------------------------------------------------
  // The game

  private handleAct(ws: WebSocket, mem: MemberRow, aid: string, raw: unknown, now: number): void {
    const engine = this.engine!;
    if (this.seenAid(mem.account_id, aid)) return;
    if (mem.status !== 'seated' || mem.seat === null) return this.err(ws, mem.status === 'watching' ? 'NOT_SEATED' : 'BUSY', 'Buy in to play.', aid);
    if (mem.leaving) return this.err(ws, 'WRONG_PHASE', "You're leaving this table.", aid);
    if (this.meta!.mode === 'multi' && !this.meta!.started) return this.err(ws, 'WRONG_PHASE', 'Waiting for the leader to start.', aid);
    const action = engine.parseAction(raw);
    if (action === null) return this.err(ws, 'BAD_REQUEST', "That move isn't allowed.", aid);
    const res = engine.act(this.state, mem.seat, action, this.engineCtx(now));
    if (isRefusal(res)) return this.err(ws, res.refuse, res.msg, aid);
    this.rememberAid(mem.account_id, aid, now);
    if (!this.commit(res, now)) return this.err(ws, 'INTERNAL', 'The table refused that move.', aid);
    this.runTicks(now);
  }

  /** Run tick() while it has something due, e.g. a betting window that just closed. */
  private runTicks(now: number): void {
    const engine = this.engine;
    if (!engine || !this.meta || this.state === null) return;
    for (let i = 0; i < 50; i++) {
      const step = engine.tick(this.state, this.engineCtx(now));
      if (!step) break;
      if (!this.commit(step, now)) break;
      const next = engine.deadline(this.state);
      if (next === null || next > now) break;
    }
    this.sweepLeavers(now);
  }

  /**
   * Apply a step: chips to stacks, stats, the new state, all in one storage transaction, then tell
   * each socket what it may see. Refuses (and changes nothing) if any stack would go negative.
   */
  private commit(step: Step<unknown>, now: number): boolean {
    const m = this.meta!;
    const engine = this.engine!;
    const bySeat = new Map<number, MemberRow>();
    for (const mem of this.members.values()) if (mem.seat !== null && mem.status === 'seated') bySeat.set(mem.seat, mem);
    const stacks = new Map<number, number>();
    let readyCleared = false;
    for (const mv of step.chips ?? []) {
      const mem = bySeat.get(mv.seat);
      const bet = mv.bet ?? 0;
      const payout = mv.payout ?? 0;
      if (!mem || !Number.isSafeInteger(bet) || !Number.isSafeInteger(payout) || bet < 0 || payout < 0) {
        console.error('engine step rejected: bad chip move', m.name, mv);
        return false;
      }
      const next = (stacks.get(mv.seat) ?? mem.stack) - bet + payout;
      if (next < 0) {
        console.error('engine step rejected: overdraft', m.name, mv);
        return false;
      }
      stacks.set(mv.seat, next);
    }
    // v6 feats: what the finished rounds did toward achievements and challenges (worked out first,
    // stored with the round)
    const facts = step.rounds?.length ? stepFacts(m.game, m.variant, step, (seat) => {
      const mem = bySeat.get(seat);
      return mem ? { accountId: mem.account_id, name: mem.name } : undefined;
    }, now) : [];
    let featWork = false;
    this.ctx.storage.transactionSync(() => {
      for (const [seat, stack] of stacks) {
        const mem = bySeat.get(seat)!;
        mem.stack = stack;
      }
      for (const r of step.rounds ?? []) {
        const mem = bySeat.get(r.seat);
        if (!mem) continue;
        mem.rounds += 1;
        mem.wagered += r.wagered;
        mem.net += r.returned - r.wagered;
        mem.biggest_win = Math.max(mem.biggest_win, r.returned - r.wagered);
      }
      // A finished round ends everyone's "ready": the next betting window waits for each player
      // again instead of closing on the first chip because of a click made last round.
      if (step.rounds?.length) {
        for (const mem of this.members.values()) {
          if (mem.ready) readyCleared = true;
          mem.ready = 0;
        }
        if (readyCleared) this.sql.exec(`UPDATE members SET ready = 0`);
      }
      this.state = step.state;
      for (const mem of bySeat.values()) {
        mem.live = engine.liveBets(this.state, mem.seat!);
        this.sql.exec(
          `UPDATE members SET stack = ?1, live = ?2, rounds = ?3, wagered = ?4, net = ?5, biggest_win = ?6 WHERE account_id = ?7`,
          mem.stack, mem.live, mem.rounds, mem.wagered, mem.net, mem.biggest_win, mem.account_id,
        );
      }
      this.sql.exec(`INSERT OR REPLACE INTO state (id, json) VALUES (1, ?1)`, JSON.stringify(this.state));
      m.seq += 1;
      this.putMeta('seq', m.seq);
      if (facts.length) this.runs.apply(facts, now); // v6 stats6: streaks, day and week nets, sent with the tallies
      if (facts.length) featWork = this.feats.record(facts, now);
    });
    this.overdue = 0;
    this.broadcastEvents(step.events, now);
    for (const seat of stacks.keys()) this.sendSeat(bySeat.get(seat)!);
    if (readyCleared) this.broadcastMembers();
    if (step.rounds?.length) this.announceBigWins(step, bySeat, now); // features: big wins
    if (step.rounds?.length) this.tellLaw(step, bySeat, now); // v6 law6
    if (featWork) this.ctx.waitUntil(this.runFeats());
    // Nothing on the layout anywhere: the round a seat was given up in is over.
    if (m.held?.length && !this.roundInPlay()) {
      m.held = [];
      this.putMeta('held', m.held);
    }
    return true;
  }

  /** Someone seated still has chips on the layout: a round is in play. */
  private roundInPlay(): boolean {
    for (const mem of this.members.values()) if (mem.status === 'seated' && mem.live > 0) return true;
    return false;
  }

  /**
   * Whether a newcomer can't buy into this seat yet: it was given up mid-round and the table
   * hasn't been quiet since, or the engine would show whoever sits there a card nobody else at the
   * table can see (nobody new has been dealt anything, so it can only be the last occupant's).
   */
  private seatNotReady(mem: MemberRow, now: number): boolean {
    if (mem.seat === null) return false;
    if ((this.meta!.held ?? []).includes(mem.seat)) return true;
    try {
      const engine = this.engine!;
      const ctx = this.engineCtx(now);
      const seats = [...ctx.seats.filter((x) => x.seat !== mem.seat), { seat: mem.seat, accountId: mem.account_id, name: mem.name, stack: 0, connected: true, ready: false }];
      seats.sort((a, b) => a.seat - b.seat);
      const probe = engine.seatJoined(this.state, mem.seat, { ...ctx, seats });
      const open = new Set(cardsIn(engine.view(probe.state, null)));
      return cardsIn(engine.view(probe.state, mem.seat)).some((c) => !open.has(c));
    } catch (err) {
      console.error('seat probe failed', this.meta!.name, err);
      return false;
    }
  }

  private engineCtx(now: number): EngineCtx {
    const m = this.meta!;
    const seats: SeatCtx[] = [];
    for (const mem of this.members.values()) {
      if (mem.status !== 'seated' || mem.seat === null) continue;
      seats.push({
        seat: mem.seat,
        accountId: mem.account_id,
        name: mem.name,
        stack: mem.stack,
        connected: this.isConnected(mem.account_id),
        ready: mem.ready === 1,
      });
    }
    seats.sort((a, b) => a.seat - b.seat);
    return { rng: this.rng, now, mode: m.mode, started: m.started, seats };
  }

  // ------------------------------------------------------------------------------------------
  // Deadlines and the alarm

  private setDeadline(name: string, at: number): void {
    this.sql.exec(`INSERT OR REPLACE INTO deadlines (name, at) VALUES (?1, ?2)`, name, at);
  }

  private clearDeadline(name: string): void {
    this.sql.exec(`DELETE FROM deadlines WHERE name = ?1`, name);
  }

  private hasDeadline(name: string): boolean {
    return this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM deadlines WHERE name = ?1`, name).one().n > 0;
  }

  private scheduleAlarm(): void {
    const times: number[] = [];
    const d = this.sql.exec<{ at: number | null }>(`SELECT min(at) AS at FROM deadlines`).one().at;
    if (d !== null) times.push(d);
    const o = this.sql.exec<{ at: number | null }>(`SELECT min(next_at) AS at FROM outbox WHERE state = 'pending'`).one().at;
    if (o !== null) times.push(o);
    const f = this.feats.due();
    if (f !== null) times.push(f);
    if (this.engine && this.state !== null) {
      const e = this.engine.deadline(this.state);
      if (e !== null) times.push(this.overdue > 0 ? Math.max(e, Date.now() + Math.min(OVERDUE_MAX_MS, 50 * 2 ** this.overdue)) : e);
    }
    if (times.length === 0) return;
    const at = Math.max(Math.min(...times), Date.now() + 10);
    if (this.alarmAt !== null && Math.abs(this.alarmAt - at) < 5) return;
    this.alarmAt = at;
    this.ctx.storage.setAlarm(at);
  }

  // ------------------------------------------------------------------------------------------
  // Outgoing messages

  private send(ws: WebSocket, msg: TableServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closing */
    }
  }

  private err(ws: WebSocket, code: ErrorCode, msg: string, ref?: string): void {
    this.send(ws, ref ? { t: 'err', ref, code, msg } : { t: 'err', code, msg });
  }

  private isConnected(accountId: number): boolean {
    return this.ctx.getWebSockets(`a:${accountId}`).length > 0;
  }

  private memberList(): Member[] {
    return [...this.members.values()]
      .sort((a, b) => a.joined_at - b.joined_at)
      .map((mem) => ({
        accountId: mem.account_id,
        name: mem.name,
        look: lookFromJson(mem.look),
        seat: mem.seat,
        joinedAt: mem.joined_at,
        connected: this.isConnected(mem.account_id),
        ready: mem.ready === 1,
        status: mem.status,
        stack: mem.stack,
      }));
  }

  private tableMeta(forMember: boolean): TableMeta {
    const m = this.meta!;
    return {
      tableId: m.name,
      game: m.game,
      variant: m.variant,
      mode: m.mode,
      visibility: m.visibility,
      ...(forMember && m.pin ? { pin: m.pin } : {}),
      started: m.started,
      config: m.config,
    };
  }

  private snapshotFor(accountId: number, now: number): TableServerMsg {
    const m = this.meta!;
    const mem = this.members.get(accountId);
    return {
      t: 'table',
      v: PROTOCOL_VERSION,
      meta: this.tableMeta(true),
      members: this.memberList(),
      leader: m.leader,
      you: { accountId, seat: mem?.seat ?? null, status: mem?.status ?? 'watching', stack: mem?.stack ?? 0 },
      view: this.engine!.view(this.state, this.viewerSeat(mem)),
      seq: m.seq,
      now,
    };
  }

  private broadcastMembers(): void {
    const m = this.meta!;
    const msg = JSON.stringify({
      t: 'members',
      members: this.memberList(),
      leader: m.leader,
      visibility: m.visibility,
      ...(m.pin ? { pin: m.pin } : {}),
      started: m.started,
    } satisfies TableServerMsg);
    for (const ws of this.ctx.getWebSockets()) {
      // Only members hear the party (the PIN included).
      const att = ws.deserializeAttachment() as Att | null;
      if (!att || !this.members.has(att.accountId)) continue;
      try {
        ws.send(msg);
      } catch {
        /* closing */
      }
    }
  }

  private broadcastEvents(events: GameEvent[], now: number): void {
    const m = this.meta!;
    const engine = this.engine!;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Att | null;
      if (!att) continue;
      const mem = this.members.get(att.accountId);
      if (!mem) continue;
      const seat = this.viewerSeat(mem);
      const mine = events.filter((e) => e.to === undefined || e.to === 'all' || e.to === seat);
      this.send(ws, { t: 'ev', seq: m.seq, events: mine, view: engine.view(this.state, seat), now });
    }
  }

  /**
   * The seat whose private view (and events addressed to it) a member gets: only once their chips
   * have landed. Someone still buying in holds a seat number the engine hasn't given them yet, and
   * whatever the engine keeps under that number belongs to whoever sat there before.
   */
  private viewerSeat(mem: MemberRow | undefined): number | null {
    return mem && (mem.status === 'seated' || mem.status === 'cashing_out') ? mem.seat : null;
  }

  private sendSeat(mem: MemberRow): void {
    for (const ws of this.ctx.getWebSockets(`a:${mem.account_id}`)) {
      this.send(ws, { t: 'seat', status: mem.status, stack: mem.stack, escrow: mem.escrow, seat: mem.seat });
    }
  }

  private bucketsFor(ws: WebSocket): SocketLimits {
    let b = this.buckets.get(ws);
    if (!b) {
      b = {
        frames: new Bucket(FRAME_BURST, FRAME_PER_SEC),
        act: new Bucket(24, 12),
        misc: new Bucket(8, 4),
        money: new Bucket(3, 1),
        strikes: new Bucket(STRIKES, STRIKE_FORGIVE_PER_SEC),
      };
      this.buckets.set(ws, b);
    }
    return b;
  }

  /** Count a dropped or refused frame; false (and the socket closed) once there are too many. */
  private strike(ws: WebSocket, b: SocketLimits): boolean {
    if (b.strikes.take()) return true;
    try {
      ws.close(CLOSE.RATE_LIMITED, 'slow down');
    } catch {
      /* already closing */
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------
  // Replays and the floor

  private seenAid(accountId: number, aid: string): boolean {
    return this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM aids WHERE aid = ?1 AND account_id = ?2`, aid, accountId).one().n > 0;
  }

  private rememberAid(accountId: number, aid: string, now: number): void {
    this.sql.exec(`INSERT OR REPLACE INTO aids (account_id, aid, at) VALUES (?1, ?2, ?3)`, accountId, aid, now);
  }

  private floor(): DurableObjectStub<CasinoFloor> {
    const ns = this.env.FLOOR as unknown as DurableObjectNamespace<CasinoFloor>;
    return ns.get(ns.idFromName('main'));
  }

  private async noteFloor(accountId: number, station: string | null): Promise<void> {
    try {
      await this.floor().playerAt(accountId, station);
    } catch (err) {
      console.error('floor playerAt failed', err);
    }
  }

  // features: rounds that paid big go to the floor's sign (floor/wins.ts decides what counts)
  private announceBigWins(step: Step<unknown>, bySeat: Map<number, MemberRow>, now: number): void {
    const m = this.meta!;
    const who = (seat: number) => {
      const mem = bySeat.get(seat);
      return mem ? { accountId: mem.account_id, name: mem.name, station: mem.station } : undefined;
    };
    for (const w of bigWinsIn(m.game, m.variant, step, who, now)) this.ctx.waitUntil(this.tellBigWin(w));
  }

  // v6 law6: finished rounds, as the law needs them (law-table.ts), off to the floor
  private tellLaw(step: Step<unknown>, bySeat: Map<number, MemberRow>, now: number): void {
    const m = this.meta!;
    this.law ??= new TableLaw(m.name);
    const who = (seat: number) => {
      const mem = bySeat.get(seat);
      return mem ? { accountId: mem.account_id, name: mem.name } : undefined;
    };
    for (const n of this.law.rounds(step.rounds ?? [], who, hasLimitChoice(m.game) ? limitsOf(m.config) : null, now)) this.ctx.waitUntil(this.sendLaw(n));
  }

  private async sendLaw(n: LawNote): Promise<void> {
    try {
      if (n.kind === 'jail') {
        await this.floor().jailRound(n.accountId, n.net);
        return;
      }
      const r = await this.floor().lawHot(n);
      if (r !== 'unseen') this.law?.caught(n.accountId);
    } catch (err) {
      console.error('floor law failed', err);
    }
  }

  /**
   * v6 law6: stand a player up now (taken to jail, or out of it): their sockets are told why and
   * the seat leaves the way Leave does it (bets in play settle, then the chips go home).
   */
  async evict(accountId: number): Promise<void> {
    const mem = this.members.get(accountId);
    if (!mem || !this.meta) return;
    for (const ws of this.ctx.getWebSockets(`a:${accountId}`)) {
      try {
        ws.close(CLOSE.FORBIDDEN, 'escorted out');
      } catch {
        /* already closing */
      }
    }
    this.beginLeave(mem, Date.now());
    await this.pump();
    this.scheduleAlarm();
  }

  private async tellBigWin(w: BigWinReport): Promise<void> {
    try {
      await this.floor().bigWin(w);
    } catch (err) {
      console.error('floor bigWin failed', err);
    }
  }

  // v6 feats: pay what was earned here, send progress to D1 (server/src/feats.ts decides what)
  private async runFeats(): Promise<void> {
    await this.feats.run(this.env.DB, {
      send: (accountId, msg) => {
        for (const ws of this.ctx.getWebSockets(`a:${accountId}`)) this.send(ws, msg);
      },
      // the floor hears once the player has seen the round (a spin still turning keeps it quiet)
      featEarned: async (accountId, name, feat, showAt) => {
        const wait = Math.min(showAt - Date.now(), 90_000);
        const tell = async () => {
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          try {
            await this.floor().featEarned(accountId, name, feat);
          } catch (err) {
            console.error('floor featEarned failed', err);
          }
        };
        this.ctx.waitUntil(tell());
      },
      grant: (accountId, emotes) => this.floor().grant(accountId, emotes),
    });
    this.scheduleAlarm();
  }

  private async syncDirectory(): Promise<void> {
    const m = this.meta;
    if (!m || m.mode !== 'multi') return;
    try {
      const s = this.summary();
      if (s && m.visibility === 'public') await this.floor().lobbyUpsert(s);
      else await this.floor().lobbyRemove(m.name, m.game);
    } catch (err) {
      console.error('floor directory sync failed', err);
    }
  }

  private async closeTable(): Promise<void> {
    const m = this.meta!;
    const pending = this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE state = 'pending'`).one().n;
    if (pending > 0 || !this.feats.idle()) {
      // Money (or progress) is still on its way to D1; close once it has landed.
      this.setDeadline('close', Date.now() + 30_000);
      return;
    }
    m.closed = true;
    this.putMeta('closed', true);
    try {
      await this.floor().lobbyRemove(m.name, m.game);
      if (m.pin) await this.floor().releasePin(m.name);
    } catch (err) {
      console.error('floor close failed', err);
    }
    try {
      await this.feats.cleanup(this.env.DB);
    } catch (err) {
      console.error('feats cleanup failed', err);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Chat: a lobby table's own room, heard and used by its members only. The room and its rules
  // (cleaning, the word mask, limits, mutes, the stored backlog) are floor/chat.ts; this is
  // just who may read and post here. Solo tables have no room.

  private chatRoom: ChatRoom | null = null;

  private chat(): ChatRoom | null {
    const m = this.meta;
    if (!m || m.mode !== 'multi' || m.closed) return null;
    return (this.chatRoom ??= new ChatRoom(this.sql));
  }

  /** A member's new socket gets the room's last lines, after the table snapshot. */
  private chatJoin(ws: WebSocket): void {
    const room = this.chat();
    if (room) this.send(ws, { t: 'chat', lines: room.backlog(), backlog: true });
  }

  private chatSay(ws: WebSocket, accountId: number, text: string): void {
    const room = this.chat();
    const mem = this.members.get(accountId);
    if (!room || !mem) return;
    // Signed with the name the table holds for this member, which came from their token.
    const out = room.say({ id: accountId, name: mem.name }, text);
    if (!out.ok) {
      this.send(ws, out.notice);
      if (out.close) ws.close(CLOSE.RATE_LIMITED, 'slow down');
      return;
    }
    const msg = JSON.stringify({ t: 'chat', lines: [out.line] } satisfies ChatServerMsg);
    for (const other of this.ctx.getWebSockets()) {
      const att = other.deserializeAttachment() as Att | null;
      if (!att || !this.members.has(att.accountId)) continue;
      try {
        other.send(msg);
      } catch {
        /* closing */
      }
    }
  }
}

export const HOST_CONSTANTS = { GRACE_MS, RESTART_SHIFT_MS, HEARTBEAT_MS, EMPTY_CLOSE_MS };
