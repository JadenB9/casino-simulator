// Presence: who is on the floor, where they are standing, and where they are sitting.
//
// Movement arrives a few times a second per walking player (client/src/net/send-policy.ts) and is
// coalesced into snapshots as it arrives: at most one every FLUSH_MS, holding only the players who
// moved since the last one, each row with its age (how long ago that position arrived) so clients
// place it at the right moment whatever the flush added. A row that arrives too soon after a
// flush goes out when the interval is up (a stop too): one short timer, only while someone moves,
// so the object still hibernates when nobody walks.
//
// Memory is a cache. What has to survive hibernation lives elsewhere: each socket's attachment
// holds that player's identity and last resting pose (the roster is rebuilt from them on wake),
// and the station each account sits at is a row in SQLite, because tables report it by account
// whether or not that account has a floor socket open at that moment.

import type { FloorClientMsg, FloorServerMsg, PlayerInfo } from '../../../shared/src/protocol.ts';
import { FLOOR_BOUNDS, PROTOCOL_VERSION } from '../../../shared/src/protocol.ts';
import type { Look } from '../../../shared/src/look.ts';

/** Snapshots go out at most this often (rows carry their own age, so a coarser flush costs no smoothness). */
export const FLUSH_MS = 100;
/** Fastest anyone may move, in cm/s: well above a character's walk, so honest jitter never trips it. */
export const MAX_SPEED = 900;
/**
 * Unspent movement a player can bank, in cm. Messages bunch up after a network stall and then
 * arrive all at once; a second's worth of allowance lets that burst through unclamped.
 */
export const MAX_BANK = MAX_SPEED + 50;
/** Where a new arrival stands, facing into the room (yaw 128 = half a turn). */
export const SPAWN = { x: 0, z: 1280, r: 128 } as const;

export interface FloorAtt {
  accountId: number;
  name: string;
  look: Look;
  x: number;
  z: number;
  r: number;
  at: { station: string } | null;
  /** Game whose lobby list this socket wants pushed (directory.ts owns this field). */
  watch: string | null;
  /** Server time of the last accepted position. */
  t: number;
  /** No position has arrived on this connection yet; the first one places the player. */
  fresh?: boolean;
  /**
   * Server time of the last thing this player really did (connected, moved or turned, spoke,
   * waved, opened a lobby list, said `here`); the floor closes a socket IDLE_MS after it.
   */
  active?: number;
}

type Broadcast = (msg: FloorServerMsg, except?: WebSocket) => void;

/** A connected player while the object is awake. */
interface Walker {
  att: FloorAtt;
  moving: boolean;
  /** cm this player may still move before the speed check starts clamping. */
  bank: number;
}

export class Presence {
  private readonly sql: SqlStorage;
  private readonly live = new Map<WebSocket, Walker>();
  private readonly dirty = new Set<WebSocket>();
  private readonly closed = new WeakSet<WebSocket>();
  /** Accounts whose socket closed during this turn; a newer tab can still claim them. */
  private readonly leaving = new Map<number, FloorAtt>();
  private lastFlush = 0;
  private lastTs = 0;
  /** A flush owed to rows that arrived too soon after the last one (see onMessage). */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly broadcast: Broadcast,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS seated (account_id INTEGER PRIMARY KEY, station TEXT NOT NULL)`);
    // After hibernation memory starts empty, but the sockets and their attachments are still there.
    for (const ws of ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as FloorAtt | null;
      if (att && ws.readyState === WebSocket.OPEN) this.live.set(ws, { att, moving: false, bank: MAX_BANK });
    }
  }

  onConnect(ws: WebSocket, who: { accountId: number; name: string; look: Look }): void {
    const now = Date.now();
    // A newer tab taking over from an older one (index.ts closed the old socket a moment ago, in
    // this same turn) goes on standing where the old one stood, and nobody else hears about it.
    const prev = this.leaving.get(who.accountId) ?? this.walkerOf(who.accountId)?.att ?? null;
    this.leaving.delete(who.accountId);
    const station = this.stationOf(who.accountId);
    const att: FloorAtt = {
      ...who,
      x: prev?.x ?? SPAWN.x,
      z: prev?.z ?? SPAWN.z,
      r: prev?.r ?? SPAWN.r,
      at: station ? { station } : null,
      watch: null,
      t: now,
      fresh: true,
      active: now,
    };
    ws.serializeAttachment(att);
    this.live.set(ws, { att, moving: false, bank: MAX_BANK });
    const online = this.onlineCount();
    this.send(ws, { t: 'hello', v: PROTOCOL_VERSION, you: info(att), players: this.roster(who.accountId), online, now });
    if (!prev) {
      this.broadcast({ t: 'join', player: info(att) }, ws);
      this.broadcast({ t: 'online', n: online }, ws);
    } else if (JSON.stringify(prev.look) !== JSON.stringify(att.look)) {
      this.broadcast({ t: 'player', id: who.accountId, look: att.look }, ws);
    }
  }

  onMessage(ws: WebSocket, msg: Extract<FloorClientMsg, { t: 'mv' | 'st' }>): void {
    const w = this.live.get(ws);
    if (!w) return;
    const a = w.att;
    const now = Date.now();
    let x = clamp(msg.x, FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxX);
    let z = clamp(msg.z, FLOOR_BOUNDS.minZ, FLOOR_BOUNDS.maxZ);
    const placing = a.fresh === true;
    if (placing) {
      // The first position on a connection places the player. After a dropped connection the
      // client kept walking on its own and knows where it is; a first visit echoes the spawn.
      a.fresh = false;
    } else {
      // Presence carries no money, so the only checks are the floor bounds and a speed limit:
      // allowance accrues at MAX_SPEED up to MAX_BANK, and a move beyond it stops short on its line.
      w.bank = Math.min(MAX_BANK, w.bank + (MAX_SPEED * Math.max(0, now - a.t)) / 1000);
      const dx = x - a.x;
      const dz = z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist > w.bank) {
        x = Math.round(a.x + (dx * w.bank) / dist);
        z = Math.round(a.z + (dz * w.bank) / dist);
      }
      w.bank = Math.max(0, w.bank - Math.hypot(x - a.x, z - a.z));
    }
    // Moving or turning is activity; the same pose again is not. (Walkers keep the object awake,
    // so this is saved with the pose at the next stop.)
    if (x !== a.x || z !== a.z || msg.r !== a.r) a.active = now;
    a.x = x;
    a.z = z;
    a.r = msg.r;
    a.t = now;
    w.moving = msg.t === 'mv';
    this.dirty.add(ws);
    // Only resting poses need to outlive the object: a walking player keeps it awake anyway.
    if (!w.moving || placing) this.save(ws, a);
    if (now - this.lastFlush >= FLUSH_MS) this.flush(now);
    // Too soon after the last flush (a stop included): send this row when the interval is up,
    // rather than whenever the next message happens to arrive (walkers send only a few times a
    // second, so on a quiet floor that could be a while). Only ever pending while someone moves.
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(Date.now()), FLUSH_MS - (now - this.lastFlush));
  }

  onClose(ws: WebSocket): void {
    // index.ts reports a replaced socket itself, and the runtime reports it again when it closes.
    if (this.closed.has(ws)) return;
    this.closed.add(ws);
    const att = this.live.get(ws)?.att ?? (ws.deserializeAttachment() as FloorAtt | null);
    this.live.delete(ws);
    this.dirty.delete(ws);
    if (!att) return;
    // The leave is settled after this turn. When a newer tab takes over, index.ts closes the old
    // socket and accepts the new one synchronously, so onConnect gets to claim the departure
    // first: a tab switch is then invisible to everyone else instead of a leave and a rejoin.
    this.leaving.set(att.accountId, att);
    queueMicrotask(() => this.settle(att.accountId));
  }

  setStation(accountId: number, station: string | null): void {
    // Tables announce the station on every reconnect; only a change is news.
    if (this.stationOf(accountId) === station) return;
    if (station) this.sql.exec(`INSERT OR REPLACE INTO seated (account_id, station) VALUES (?1, ?2)`, accountId, station);
    else this.sql.exec(`DELETE FROM seated WHERE account_id = ?1`, accountId);
    const at = station ? { station } : null;
    if (this.update(accountId, (a) => (a.at = at))) this.broadcast({ t: 'player', id: accountId, at });
  }

  setLook(accountId: number, look: Look): void {
    if (this.update(accountId, (a) => (a.look = look))) this.broadcast({ t: 'player', id: accountId, look });
  }

  /** Something this player did besides moving (see FloorAtt.active); kept through hibernation. */
  touch(ws: WebSocket, now: number): void {
    const w = this.live.get(ws);
    if (!w) return;
    w.att.active = now;
    this.save(ws, w.att);
  }

  /** When this socket's player last did something, or null for a socket that isn't a player's. */
  activeAt(ws: WebSocket): number | null {
    const w = this.live.get(ws);
    return w ? (w.att.active ?? w.att.t) : null;
  }

  /** Accounts with an open floor connection. */
  onlineCount(): number {
    const ids = new Set<number>();
    for (const [ws, w] of this.live) if (ws.readyState === WebSocket.OPEN) ids.add(w.att.accountId);
    return ids.size;
  }

  private settle(accountId: number): void {
    if (!this.leaving.delete(accountId)) return; // a newer connection claimed it
    if (this.walkerOf(accountId)) return;
    this.broadcast({ t: 'leave', id: accountId });
    this.broadcast({ t: 'online', n: this.onlineCount() });
  }

  private flush(now: number): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty.size === 0) return;
    // Clients drop a sample that isn't newer than the last one, so ts must strictly increase even
    // when a stop is flushed in the same millisecond as the snapshot before it.
    this.lastTs = Math.max(now, this.lastTs + 1);
    const p: [number, number, number, number, 0 | 1, number][] = [];
    for (const ws of this.dirty) {
      const w = this.live.get(ws);
      if (w) p.push([w.att.accountId, w.att.x, w.att.z, w.att.r, w.moving ? 1 : 0, Math.max(0, this.lastTs - w.att.t)]);
    }
    this.dirty.clear();
    this.lastFlush = now;
    if (p.length) this.broadcast({ t: 's', ts: this.lastTs, p });
  }

  /** Everyone else on the floor, once per account. */
  private roster(except: number): PlayerInfo[] {
    const seen = new Set<number>([except]);
    const players: PlayerInfo[] = [];
    for (const [ws, w] of this.live) {
      if (seen.has(w.att.accountId) || ws.readyState !== WebSocket.OPEN) continue;
      seen.add(w.att.accountId);
      players.push(info(w.att));
    }
    return players;
  }

  private walkerOf(accountId: number): Walker | undefined {
    for (const [ws, w] of this.live) if (w.att.accountId === accountId && ws.readyState === WebSocket.OPEN) return w;
    return undefined;
  }

  /** Apply a change to every live socket of an account; false if the account isn't on the floor. */
  private update(accountId: number, change: (a: FloorAtt) => void): boolean {
    let found = false;
    for (const [ws, w] of this.live) {
      if (w.att.accountId !== accountId || ws.readyState !== WebSocket.OPEN) continue;
      change(w.att);
      this.save(ws, w.att);
      found = true;
    }
    return found;
  }

  /** Persist a player's attachment, keeping the lobby watch that directory.ts keeps in it too. */
  private save(ws: WebSocket, att: FloorAtt): void {
    const stored = ws.deserializeAttachment() as FloorAtt | null;
    ws.serializeAttachment({ ...att, watch: stored?.watch ?? null });
  }

  private stationOf(accountId: number): string | null {
    const row = this.sql.exec<{ station: string }>(`SELECT station FROM seated WHERE account_id = ?1`, accountId).toArray()[0];
    return row?.station ?? null;
  }

  private send(ws: WebSocket, msg: FloorServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }
}

function info(a: FloorAtt): PlayerInfo {
  return { id: a.accountId, name: a.name, look: a.look, x: a.x, z: a.z, r: a.r, at: a.at };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
