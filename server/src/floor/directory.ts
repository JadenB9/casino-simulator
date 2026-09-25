// The lobby directory: public lobbies per game, and the PIN -> table map for private ones.
//
// It is a hint, not the truth. Tables upsert their summary whenever it changes and every minute
// while they have players; entries not refreshed for STALE_MS are dropped; and the table itself
// re-checks capacity when someone actually joins.
//
// Everything lives in this object's SQLite, the guess counters included. The floor hibernates
// whenever nobody on it is moving, and a limit kept in memory would reset every time it slept:
// someone guessing PINs would only have to pause for ten seconds between bursts.

import type { FloorServerMsg, LobbySummary } from '../../../shared/src/protocol.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import { CATALOG, isGameId } from '../../../shared/src/games/catalog.ts';
import type { FloorAtt } from './presence.ts';

export const STALE_MS = 150_000;
/** A released PIN isn't handed out again for this long, so an old invite can't land in a new lobby. */
export const PIN_COOLDOWN_MS = 10 * 60_000;
/**
 * A private table reports in on every change and every minute while anyone is there (it calls
 * remove(), since it is never listed). One silent for this long died without releasing its PIN
 * (an init that failed after the PIN was drawn, a close whose floor call failed), so the PIN
 * goes back into the pool, cooldown first.
 */
export const PIN_STALE_MS = 30 * 60_000;
const PIN_SPACE = 10_000;
const LIST_MAX = 50;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Attempts allowed per window, counted separately for creating lobbies and for PIN joins.
 * Four digits is only 10,000 PINs and accounts are free, so the per-address limits are the ones
 * that matter; the per-account limits stop one tab from using up a shared address's budget.
 */
export const LIMITS: Record<'account' | 'ip', readonly (readonly [attempts: number, windowMs: number])[]> = {
  account: [[5, MINUTE], [30, HOUR]],
  ip: [[10, MINUTE], [60, HOUR]],
};

type ToWatchers = (msg: FloorServerMsg, game: GameId) => void;

export class Directory {
  private sql: SqlStorage;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly toWatchers: ToWatchers,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lobbies (
      table_id TEXT PRIMARY KEY, game TEXT NOT NULL, summary TEXT NOT NULL, updated_at INTEGER NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS lobbies_game ON lobbies (game, updated_at)`);
    // One row per PIN ever issued: held by a table, or free since released_at.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lobby_pins (
      pin TEXT PRIMARY KEY, table_id TEXT UNIQUE, game TEXT, released_at INTEGER, touched_at INTEGER NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lobby_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS lobby_limits_until ON lobby_limits (until)`);
  }

  // --- the public list -------------------------------------------------------------------------

  watch(ws: WebSocket, game: GameId | null, now = Date.now()): void {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    if (!att) return;
    att.watch = game;
    ws.serializeAttachment(att);
    if (game) this.send(ws, { t: 'lobbies', game, list: this.list(game, now) });
  }

  unwatch(_ws: WebSocket): void {
    // Nothing to clean up: the watch lives in the socket's attachment and goes with it.
  }

  list(game: GameId, now: number): LobbySummary[] {
    this.dropStale(now);
    return this.sql
      .exec<{ summary: string }>(`SELECT summary FROM lobbies WHERE game = ?1 ORDER BY updated_at DESC LIMIT ?2`, game, LIST_MAX)
      .toArray()
      .map((r) => JSON.parse(r.summary) as LobbySummary);
  }

  upsert(summary: LobbySummary, now: number): void {
    // Nobody at the table: either its creator hasn't sat down yet (listing it would let a stranger
    // walk in first and take the lead) or everyone left and it is about to close. Not a lobby to show.
    if (summary.players === 0) return this.remove(summary.tableId, summary.game, now);
    this.dropStale(now);
    const json = JSON.stringify(summary);
    const before = this.sql.exec<{ summary: string }>(`SELECT summary FROM lobbies WHERE table_id = ?1`, summary.tableId).toArray()[0];
    this.sql.exec(
      `INSERT OR REPLACE INTO lobbies (table_id, game, summary, updated_at) VALUES (?1, ?2, ?3, ?4)`,
      summary.tableId, summary.game, json, now,
    );
    this.touchPin(summary.tableId, now);
    // A heartbeat that changes nothing only refreshes the timestamp; watchers already have it.
    if (before?.summary !== json) this.toWatchers({ t: 'lobby', game: summary.game, lobby: summary }, summary.game);
  }

  remove(tableId: string, game: GameId, now = Date.now()): void {
    this.dropStale(now);
    const had = this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM lobbies WHERE table_id = ?1`, tableId).one().n;
    if (had) {
      this.sql.exec(`DELETE FROM lobbies WHERE table_id = ?1`, tableId);
      this.toWatchers({ t: 'lobby.gone', game, tableId }, game);
    }
    // Private tables call this as their heartbeat: it is how their PIN stays theirs.
    this.touchPin(tableId, now);
  }

  /** Tables that stopped reporting in: forget them, and tell watchers they're gone. */
  private dropStale(now: number): void {
    const stale = this.sql
      .exec<{ table_id: string; game: string }>(`SELECT table_id, game FROM lobbies WHERE updated_at < ?1`, now - STALE_MS)
      .toArray();
    if (stale.length === 0) return;
    this.sql.exec(`DELETE FROM lobbies WHERE updated_at < ?1`, now - STALE_MS);
    for (const s of stale) if (isGameId(s.game)) this.toWatchers({ t: 'lobby.gone', game: s.game, tableId: s.table_id }, s.game);
  }

  // --- PINs ------------------------------------------------------------------------------------

  /** The table's PIN, drawing a new one if it has none. Null only if all 10,000 are in use or cooling down. */
  allocatePin(tableId: string, game: GameId, now: number): string | null {
    const mine = this.sql.exec<{ pin: string }>(`SELECT pin FROM lobby_pins WHERE table_id = ?1`, tableId).toArray()[0];
    if (mine) {
      this.touchPin(tableId, now);
      return mine.pin;
    }
    // A table with a PIN is private, so it must not stay on the public list (a later remove()
    // from the table would do this too, but it might never arrive).
    if (this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM lobbies WHERE table_id = ?1`, tableId).one().n) {
      this.sql.exec(`DELETE FROM lobbies WHERE table_id = ?1`, tableId);
      this.toWatchers({ t: 'lobby.gone', game, tableId }, game);
    }
    this.sql.exec(
      `UPDATE lobby_pins SET table_id = NULL, game = NULL, released_at = ?1 WHERE table_id IS NOT NULL AND touched_at < ?2`,
      now, now - PIN_STALE_MS,
    );
    const taken = new Set(
      this.sql
        .exec<{ pin: string }>(`SELECT pin FROM lobby_pins WHERE table_id IS NOT NULL OR released_at > ?1`, now - PIN_COOLDOWN_MS)
        .toArray()
        .map((r) => Number(r.pin)),
    );
    if (taken.size >= PIN_SPACE) return null;
    // Uniform over the free PINs: a PIN says nothing about when it was issued or what's near it.
    let k = randomBelow(PIN_SPACE - taken.size);
    for (let n = 0; n < PIN_SPACE; n++) {
      if (taken.has(n) || k-- > 0) continue;
      const pin = String(n).padStart(4, '0');
      this.sql.exec(
        `INSERT OR REPLACE INTO lobby_pins (pin, table_id, game, released_at, touched_at) VALUES (?1, ?2, ?3, NULL, ?4)`,
        pin, tableId, game, now,
      );
      return pin;
    }
    return null;
  }

  /** v6 invite6: the PIN a table holds now, or null (a public table, or none at all). */
  pinOf(tableId: string): string | null {
    return this.sql.exec<{ pin: string }>(`SELECT pin FROM lobby_pins WHERE table_id = ?1`, tableId).toArray()[0]?.pin ?? null;
  }

  releasePin(tableId: string, now: number): void {
    this.sql.exec(`UPDATE lobby_pins SET table_id = NULL, game = NULL, released_at = ?1 WHERE table_id = ?2`, now, tableId);
  }

  private touchPin(tableId: string, now: number): void {
    this.sql.exec(`UPDATE lobby_pins SET touched_at = ?1 WHERE table_id = ?2`, now, tableId);
  }

  // --- the Worker's requests ---------------------------------------------------------------------

  createLobby(p: { game: GameId; visibility: 'public' | 'private'; accountId: number; ip: string }, now: number): { tableId: string; pin: string | null } | { error: 'RATE_LIMITED' } {
    if (!this.allow('create', p.accountId, p.ip, now)) return { error: 'RATE_LIMITED' };
    const tableId = `${CATALOG[p.game].prefix}-${randomId(10)}`;
    if (p.visibility === 'public') return { tableId, pin: null };
    const pin = this.allocatePin(tableId, p.game, now);
    // Every PIN taken is practically impossible; "try again shortly" is the honest answer.
    return pin ? { tableId, pin } : { error: 'RATE_LIMITED' };
  }

  joinByPin(p: { pin: string; accountId: number; ip: string }, now: number): { tableId: string; game: GameId } | { error: 'BAD_PIN' | 'RATE_LIMITED' } {
    // Every attempt counts, malformed ones too: a flood of junk is still someone guessing.
    if (!this.allow('pin', p.accountId, p.ip, now)) return { error: 'RATE_LIMITED' };
    if (!/^\d{4}$/.test(p.pin)) return { error: 'BAD_PIN' };
    const row = this.sql
      .exec<{ table_id: string | null; game: string | null }>(`SELECT table_id, game FROM lobby_pins WHERE pin = ?1`, p.pin)
      .toArray()[0];
    if (!row?.table_id || !isGameId(row.game)) return { error: 'BAD_PIN' };
    return { tableId: row.table_id, game: row.game };
  }

  /**
   * Fixed-window counters per account and per address. All windows are checked before any is
   * counted, so an attempt refused by one limit doesn't use up the others.
   */
  private allow(action: 'create' | 'pin', accountId: number, ip: string, now: number): boolean {
    const addr = ipKey(ip);
    const rules = [
      ...LIMITS.account.map(([limit, ms]) => ({ key: `${action}:a:${accountId}:${ms}`, limit, ms })),
      ...LIMITS.ip.map(([limit, ms]) => ({ key: `${action}:ip:${addr}:${ms}`, limit, ms })),
    ];
    this.sql.exec(`DELETE FROM lobby_limits WHERE until <= ?1`, now);
    for (const r of rules) {
      const used = this.sql.exec<{ n: number }>(`SELECT n FROM lobby_limits WHERE key = ?1`, r.key).toArray()[0]?.n ?? 0;
      if (used >= r.limit) return false;
    }
    for (const r of rules) {
      this.sql.exec(
        `INSERT INTO lobby_limits (key, n, until) VALUES (?1, 1, ?2) ON CONFLICT (key) DO UPDATE SET n = n + 1`,
        r.key, now + r.ms,
      );
    }
    return true;
  }

  private send(ws: WebSocket, msg: FloorServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }
}

/**
 * The address a limit is keyed on. An IPv6 user normally holds a whole /64 and can pick a new
 * address from it for every request, so IPv6 counts per /64.
 */
export function ipKey(ip: string): string {
  const s = ip.trim().toLowerCase();
  if (!s.includes(':')) return s || 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1]!;
  const [head = '', tail] = s.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function randomBelow(n: number): number {
  const buf = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % n);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

function randomId(len: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[randomBelow(36)];
  return s;
}
