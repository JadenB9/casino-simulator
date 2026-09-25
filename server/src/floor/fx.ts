// The shop's marks on the floor: effects people pay for (confetti, a spotlight, a disco night) and
// the lobby's statues.
//
// Effects play in slots, one at a time per slot: a player's own ('you' effects), the room the
// buyer stands in ('room'), and the whole casino ('casino'). A busy slot queues: the effect's `at`
// is when the one ahead of it ends (and a short breath), clients hold it until then, and nothing
// here needs a timer. A purchase goes round the charge in shop.ts in three steps:
//   reserve()  before any money moves: where the buyer stands and when it will play, or why it
//              can't (not on the floor, or the slot booked too far ahead), so nobody pays for an
//              effect that won't play. The slot is held from here.
//   confirm()  the charge landed: it's broadcast to everyone.
//   cancel()   the charge was refused: the slot goes back.
// A reservation the Worker never came back for (it died between the charge and the confirm) is
// settled by the floor's alarm against D1 (settle()): paid for, it plays; not, it goes.
//
// Which room: the server already knows where the buyer stands (presence), so the room comes from
// that position, never from the request, and a room effect can't be aimed at a room its buyer
// isn't in. The room plan itself is the client's (client/src/world/rooms.ts); ROOM_BOUNDS keeps
// just the rooms' walls, and client/test/fx-rooms.test.ts pins it to the plan.
//
// Everything lives in the floor's SQLite, because the floor hibernates whenever nobody moves.

import type { FloorServerMsg } from '../../../shared/src/protocol.ts';
import { FX_GAP_MS, FX_MAX_WAIT_MS, effectItem, STATUE, STATUES, type EffectItem, type FxEvent, type Statue } from '../../../shared/src/items.ts';

export { FX_GAP_MS, FX_MAX_WAIT_MS };
import { lookFromJson, type Look } from '../../../shared/src/look.ts';

/** Rooms by the centre lines of their walls, metres (client/src/world/rooms.ts ROOMS). */
export const ROOM_BOUNDS: readonly { id: string; x0: number; z0: number; x1: number; z1: number }[] = [
  { id: 'lobby', x0: -7, z0: 3, x1: 7, z1: 15 },
  { id: 'pit', x0: -13, z0: -19, x1: 13, z1: 3 },
  { id: 'slots', x0: -31, z0: -19, x1: -13, z1: 3 },
  { id: 'bar', x0: 13, z0: -19, x1: 31, z1: 3 },
  { id: 'lounge', x0: 17, z0: 3, x1: 31, z1: 15 },
  { id: 'poker', x0: 9, z0: -31, x1: 31, z1: -19 },
  { id: 'salon', x0: -9, z0: -31, x1: 9, z1: -19 },
  { id: 'online', x0: -31, z0: -31, x1: -9, z1: -19 },
  { id: 'yard', x0: -31, z0: 3, x1: -17, z1: 15 },
  { id: 'bank', x0: -17, z0: 3, x1: -7, z1: 15 },
  { id: 'boutique', x0: 7, z0: 3, x1: 17, z1: 15 },
];

/** The room a floor position (cm) is in: the one it's inside, or the nearest (the doorstep outside). */
export function roomAt(xCm: number, zCm: number): string {
  const x = xCm / 100;
  const z = zCm / 100;
  let best = ROOM_BOUNDS[0]!.id;
  let bestD = Infinity;
  for (const r of ROOM_BOUNDS) {
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dz = Math.max(r.z0 - z, 0, z - r.z1);
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      best = r.id;
      bestD = d;
      if (d === 0) break;
    }
  }
  return best;
}

/** The slot an effect plays in: one per player, one per room, one for the whole casino. */
export function slotOf(fx: EffectItem, accountId: number, x: number, z: number): string {
  if (fx.reach === 'casino') return 'casino';
  if (fx.reach === 'room') return `room:${roomAt(x, z)}`;
  return `you:${accountId}`;
}

/** A reservation not confirmed or cancelled in this long is settled against D1 by the alarm. */
export const FX_PENDING_MS = 30_000;
/**
 * Played effects are kept this long after they end, so a retried purchase is answered with the
 * effect it bought (shop.ts reads anything older back from D1).
 */
export const FX_KEEP_MS = 60 * 60_000;

/** The purchase's key, the same as its casino_orders op_id: one account's op never answers for another's. */
export function fxKey(accountId: number, op: string): string {
  return `fx:${accountId}:${op}`;
}

type Row = { op: string; account_id: number; name: string; fx: string; at: number; until: number; x: number; z: number; state: string; made: number };

function eventOf(r: Row): FxEvent {
  return { fx: r.fx, id: r.account_id, name: r.name, at: r.at, until: r.until, x: r.x, z: r.z };
}

type Broadcast = (msg: FloorServerMsg) => void;

export type Reserve = { event: FxEvent } | { error: 'BUSY'; wait: number };

export class Effects {
  private readonly sql: SqlStorage;

  constructor(
    ctx: DurableObjectState,
    private readonly broadcast: Broadcast,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fx (
      op TEXT PRIMARY KEY, account_id INTEGER NOT NULL, name TEXT NOT NULL, fx TEXT NOT NULL, slot TEXT NOT NULL,
      at INTEGER NOT NULL, until INTEGER NOT NULL, x INTEGER NOT NULL, z INTEGER NOT NULL,
      state TEXT NOT NULL, made INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS fx_slot ON fx (slot, until)`);
  }

  /**
   * Hold a slot for an effect this player is buying, standing at (x, z) cm. The same key again is
   * the same reservation (a retry), whatever state it's in.
   */
  reserve(key: string, who: { accountId: number; name: string; x: number; z: number }, fx: EffectItem, now: number): Reserve {
    const had = this.row(key);
    if (had) return { event: eventOf(had) };
    this.sql.exec(`DELETE FROM fx WHERE until < ?1`, now - FX_KEEP_MS);
    const slot = slotOf(fx, who.accountId, who.x, who.z);
    const busy = this.sql.exec<{ u: number | null }>(`SELECT MAX(until) AS u FROM fx WHERE slot = ?1 AND until > ?2`, slot, now).one().u;
    const at = busy === null ? now : busy + FX_GAP_MS;
    if (at - now > FX_MAX_WAIT_MS) return { error: 'BUSY', wait: at - now };
    const until = at + fx.secs * 1000;
    this.sql.exec(
      `INSERT INTO fx (op, account_id, name, fx, slot, at, until, x, z, state, made) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'held', ?10)`,
      key, who.accountId, who.name, fx.id, slot, at, until, Math.round(who.x), Math.round(who.z), now,
    );
    return { event: { fx: fx.id, id: who.accountId, name: who.name, at, until, x: Math.round(who.x), z: Math.round(who.z) } };
  }

  /** The charge landed: everyone hears it (once). Null if there's no such reservation. */
  confirm(key: string): FxEvent | null {
    const r = this.row(key);
    if (!r) return null;
    if (r.state === 'held') {
      this.sql.exec(`UPDATE fx SET state = 'on' WHERE op = ?1`, key);
      this.broadcast({ t: 'fx', ...eventOf(r) });
    }
    return eventOf(r);
  }

  /** The charge was refused: the slot goes back. A confirmed effect stays. */
  cancel(key: string): void {
    this.sql.exec(`DELETE FROM fx WHERE op = ?1 AND state = 'held'`, key);
  }

  /** An effect this purchase bought (held or playing), or null. */
  of(key: string): FxEvent | null {
    const r = this.row(key);
    return r ? eventOf(r) : null;
  }

  /** Confirmed effects still playing or yet to play, soonest first. */
  playing(now: number): FxEvent[] {
    return this.sql
      .exec<Row>(`SELECT * FROM fx WHERE state = 'on' AND until > ?1 ORDER BY at, op`, now)
      .toArray()
      .map(eventOf);
  }

  /** Right after hello: what's on and what's coming, so a newcomer sees the disco already going. */
  greet(ws: WebSocket, now: number): void {
    try {
      ws.send(JSON.stringify({ t: 'fxs', list: this.playing(now) } satisfies FloorServerMsg));
    } catch {
      /* closing */
    }
  }

  /** When the oldest unsettled reservation is due for settle(), or null with none. */
  due(): number | null {
    const m = this.sql.exec<{ m: number | null }>(`SELECT MIN(made) AS m FROM fx WHERE state = 'held'`).one().m;
    return m === null ? null : m + FX_PENDING_MS;
  }

  /**
   * Reservations the Worker never came back for: D1 says whether each was paid for. Paid, it plays
   * (late, or what's left of it); not, the slot goes back.
   */
  async settle(db: D1Database, now: number): Promise<void> {
    const stale = this.sql.exec<Row>(`SELECT * FROM fx WHERE state = 'held' AND made <= ?1`, now - FX_PENDING_MS).toArray();
    if (stale.length === 0) return;
    const paid = await db.batch<{ n: number }>(stale.map((r) => db.prepare(`SELECT count(*) AS n FROM casino_orders WHERE op_id = ?1`).bind(r.op)));
    stale.forEach((r, i) => {
      if ((paid[i]?.results[0]?.n ?? 0) > 0) this.confirm(r.op);
      else this.cancel(r.op);
    });
  }

  private row(key: string): Row | null {
    return this.sql.exec<Row>(`SELECT * FROM fx WHERE op = ?1`, key).toArray()[0] ?? null;
  }
}

/** An effect as a retry reads it back from D1 once the floor has let it go: where isn't known any more. */
export function eventFromOrder(accountId: number, name: string, order: { item: string; created_at: number }): FxEvent | null {
  const fx = effectItem(order.item);
  return fx ? { fx: fx.id, id: accountId, name, at: order.created_at, until: order.created_at + fx.secs * 1000, x: 0, z: 0 } : null;
}

// ---------------------------------------------------------------------------------------------
// Statues

/** How long the floor trusts its copy of the statues before reading them from D1 again. */
export const STATUES_FRESH_MS = 10 * 60_000;

export type StatueRow = { account_id: number; name: string; look: string; at: number };

/**
 * The lobby's statues: the STATUES newest buyers, each wearing how they look now. D1 is the
 * truth (casino_items rows for 'statue'); the floor keeps a copy in SQLite so a connect doesn't
 * read D1, refreshed when someone buys one, when a statue's owner changes their look, and every
 * so often in case a refresh was missed.
 */
export class Statues {
  private readonly sql: SqlStorage;

  constructor(
    ctx: DurableObjectState,
    private readonly broadcast: Broadcast,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS statues (account_id INTEGER PRIMARY KEY, name TEXT NOT NULL, look TEXT NOT NULL, at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS statues_meta (k INTEGER PRIMARY KEY CHECK (k = 1), loaded_at INTEGER NOT NULL)`);
  }

  /** The statues, newest first, read from D1 first if the copy is missing or old. */
  async list(db: D1Database, now: number): Promise<Statue[]> {
    const loaded = this.sql.exec<{ loaded_at: number }>(`SELECT loaded_at FROM statues_meta WHERE k = 1`).toArray()[0]?.loaded_at;
    if (loaded === undefined || now - loaded > STATUES_FRESH_MS || loaded > now) await this.load(db, now);
    return this.rows().map(statueOf);
  }

  /** Read them from D1 again (someone bought one); everyone sees the new line-up. */
  async refresh(db: D1Database, now: number): Promise<Statue[]> {
    await this.load(db, now);
    const list = this.rows().map(statueOf);
    this.broadcast({ t: 'statues', list });
    return list;
  }

  /** A player changed their look: a statue of them changes with it. */
  lookChanged(accountId: number, look: Look): void {
    const had = this.sql.exec(`UPDATE statues SET look = ?2 WHERE account_id = ?1`, accountId, JSON.stringify(look)).rowsWritten;
    if (had > 0) this.broadcast({ t: 'statues', list: this.rows().map(statueOf) });
  }

  async greet(ws: WebSocket, db: D1Database, now: number): Promise<void> {
    const list = await this.list(db, now);
    try {
      ws.send(JSON.stringify({ t: 'statues', list } satisfies FloorServerMsg));
    } catch {
      /* closing */
    }
  }

  private async load(db: D1Database, now: number): Promise<void> {
    const rows = await statueRows(db);
    this.sql.exec(`DELETE FROM statues`);
    for (const s of rows) this.sql.exec(`INSERT INTO statues (account_id, name, look, at) VALUES (?1, ?2, ?3, ?4)`, s.account_id, s.name, s.look, s.at);
    this.sql.exec(`INSERT OR REPLACE INTO statues_meta (k, loaded_at) VALUES (1, ?1)`, now);
  }

  private rows(): StatueRow[] {
    return this.sql.exec<StatueRow>(`SELECT * FROM statues ORDER BY at DESC, account_id DESC`).toArray();
  }
}

/** The STATUES newest statue buyers from D1, with their looks as stored now. */
export async function statueRows(db: D1Database): Promise<StatueRow[]> {
  const r = await statuesQuery(db).all<StatueRow>();
  return r.results;
}

/** The query statueRows runs, for a caller that batches it with others. */
export function statuesQuery(db: D1Database): D1PreparedStatement {
  return db
    .prepare(
      `SELECT a.id AS account_id, a.name AS name, a.look AS look, i.bought_at AS at
         FROM casino_items i JOIN casino_accounts a ON a.id = i.account_id
        WHERE i.item = ?1 ORDER BY i.bought_at DESC, a.id DESC LIMIT ?2`,
    )
    .bind(STATUE.id, STATUES);
}

/** A statue wears the look without a drink in its hand: a bar order isn't cast in gold. */
export function statueOf(r: StatueRow): Statue {
  const { held: _held, ...look } = lookFromJson(r.look);
  return { name: r.name, look, at: r.at };
}
