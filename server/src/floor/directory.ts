// The lobby directory: public lobbies per game, and the PIN -> table map for private ones.
//
// It is a hint, not the truth. Tables upsert their summary whenever it changes and every minute
// while they have players; entries not refreshed for STALE_MS are dropped; and the table itself
// re-checks capacity when someone actually joins. Everything lives in this object's SQLite so the
// list doesn't vanish when the floor hibernates.

import type { FloorServerMsg, LobbySummary } from '../../../shared/src/protocol.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import { CATALOG, isGameId } from '../../../shared/src/games/catalog.ts';
import type { FloorAtt } from './presence.ts';

export const STALE_MS = 150_000;
/** A released PIN isn't handed out again for this long, so an old invite can't land in a new lobby. */
export const PIN_COOLDOWN_MS = 10 * 60_000;

type ToWatchers = (msg: FloorServerMsg, game: GameId) => void;

interface Attempts {
  n: number;
  until: number;
}

export class Directory {
  private sql: SqlStorage;
  /** Guess and create counters. In memory on purpose: losing them on eviction only resets a limit. */
  private attempts = new Map<string, Attempts>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly toWatchers: ToWatchers,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lobbies (
      table_id TEXT PRIMARY KEY, game TEXT NOT NULL, summary TEXT NOT NULL, updated_at INTEGER NOT NULL) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pins (
      pin TEXT PRIMARY KEY, table_id TEXT, game TEXT, released_at INTEGER) WITHOUT ROWID`);
  }

  watch(ws: WebSocket, game: GameId | null): void {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    if (!att) return;
    att.watch = game;
    ws.serializeAttachment(att);
    if (game) this.send(ws, { t: 'lobbies', game, list: this.list(game, Date.now()) });
  }

  unwatch(_ws: WebSocket): void {
    // Nothing to clean up: the watch lives in the socket's attachment and goes with it.
  }

  list(game: GameId, now: number): LobbySummary[] {
    this.sql.exec(`DELETE FROM lobbies WHERE updated_at < ?1`, now - STALE_MS);
    return this.sql
      .exec<{ summary: string }>(`SELECT summary FROM lobbies WHERE game = ?1 ORDER BY updated_at DESC LIMIT 50`, game)
      .toArray()
      .map((r) => JSON.parse(r.summary) as LobbySummary);
  }

  upsert(summary: LobbySummary, now: number): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO lobbies (table_id, game, summary, updated_at) VALUES (?1, ?2, ?3, ?4)`,
      summary.tableId, summary.game, JSON.stringify(summary), now,
    );
    this.toWatchers({ t: 'lobby', game: summary.game, lobby: summary }, summary.game);
  }

  remove(tableId: string, game: GameId): void {
    const had = this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM lobbies WHERE table_id = ?1`, tableId).one().n;
    this.sql.exec(`DELETE FROM lobbies WHERE table_id = ?1`, tableId);
    if (had) this.toWatchers({ t: 'lobby.gone', game, tableId }, game);
  }

  allocatePin(tableId: string, game: GameId, now: number): string | null {
    const existing = this.sql.exec<{ pin: string }>(`SELECT pin FROM pins WHERE table_id = ?1`, tableId).toArray()[0];
    if (existing) return existing.pin;
    for (let i = 0; i < 50; i++) {
      const pin = String(randomBelow(10_000)).padStart(4, '0');
      const row = this.sql.exec<{ table_id: string | null; released_at: number | null }>(`SELECT table_id, released_at FROM pins WHERE pin = ?1`, pin).toArray()[0];
      if (row && (row.table_id !== null || (row.released_at !== null && now - row.released_at < PIN_COOLDOWN_MS))) continue;
      this.sql.exec(`INSERT OR REPLACE INTO pins (pin, table_id, game, released_at) VALUES (?1, ?2, ?3, NULL)`, pin, tableId, game);
      return pin;
    }
    return null;
  }

  releasePin(tableId: string, now: number): void {
    this.sql.exec(`UPDATE pins SET table_id = NULL, game = NULL, released_at = ?1 WHERE table_id = ?2`, now, tableId);
  }

  createLobby(p: { game: GameId; visibility: 'public' | 'private'; accountId: number; ip: string }, now: number): { tableId: string; pin: string | null } | { error: 'RATE_LIMITED' } {
    if (!this.allow(`create:a:${p.accountId}`, 6, 60_000, now) || !this.allow(`create:ip:${p.ip}`, 20, 60_000, now)) {
      return { error: 'RATE_LIMITED' };
    }
    const tableId = `${CATALOG[p.game].prefix}-${randomId(10)}`;
    const pin = p.visibility === 'private' ? this.allocatePin(tableId, p.game, now) : null;
    return { tableId, pin };
  }

  joinByPin(p: { pin: string; accountId: number; ip: string }, now: number): { tableId: string; game: GameId } | { error: 'BAD_PIN' | 'RATE_LIMITED' } {
    // Four digits is only 10,000 PINs, so guesses are limited per account and per address.
    if (
      !this.allow(`pin:a:${p.accountId}`, 5, 60_000, now) ||
      !this.allow(`pin:ah:${p.accountId}`, 30, 3_600_000, now) ||
      !this.allow(`pin:ip:${p.ip}`, 10, 60_000, now) ||
      !this.allow(`pin:iph:${p.ip}`, 60, 3_600_000, now)
    ) {
      return { error: 'RATE_LIMITED' };
    }
    if (!/^\d{4}$/.test(p.pin)) return { error: 'BAD_PIN' };
    const row = this.sql.exec<{ table_id: string | null; game: string | null }>(`SELECT table_id, game FROM pins WHERE pin = ?1`, p.pin).toArray()[0];
    if (!row?.table_id || !isGameId(row.game)) return { error: 'BAD_PIN' };
    return { tableId: row.table_id, game: row.game };
  }

  private allow(key: string, limit: number, windowMs: number, now: number): boolean {
    const a = this.attempts.get(key);
    if (!a || a.until <= now) {
      this.attempts.set(key, { n: 1, until: now + windowMs });
      return true;
    }
    a.n++;
    return a.n <= limit;
  }

  private send(ws: WebSocket, msg: FloorServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }
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
