// D1 access for accounts, profiles and login rate limits. Money movement lives in transfer.ts.

import { STARTING_BALANCE } from '../../shared/src/money.ts';
import { lookFromJson, type Look } from '../../shared/src/look.ts';
import type { GameId, } from '../../shared/src/engine.ts';
import type { GameStats, Profile } from '../../shared/src/protocol.ts';
import { CATALOG, isGameId } from '../../shared/src/games/catalog.ts';

export interface AccountRow {
  id: number;
  name: string;
  balance: number;
  in_play: number;
  rev: number;
  loans_taken: number;
  look: string;
  created_at: number;
  last_seen: number;
}

/**
 * Log in by name: create the account on first use (with its starting bankroll and a ledger row
 * recording the grant), or open the existing one. Names are case-insensitive through the
 * column's NOCASE collation, so "Ace" and "ace" land on the same row.
 */
export async function loginAccount(db: D1Database, name: string, now: number): Promise<{ account: AccountRow; created: boolean }> {
  const [, , found] = await db.batch([
    db
      .prepare(
        `INSERT INTO casino_accounts (name, balance, created_at, last_seen) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (name) DO UPDATE SET last_seen = excluded.last_seen`,
      )
      .bind(name, STARTING_BALANCE, now),
    // Record where the starting money came from, once. Guarded by NOT EXISTS rather than an
    // ignore-on-conflict clause, which this ledger never uses.
    db
      .prepare(
        `INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at)
         SELECT 'grant:' || id, id, 'grant', ?2, NULL, created_at FROM casino_accounts
          WHERE name = ?1 AND created_at = ?3
            AND NOT EXISTS (SELECT 1 FROM casino_ledger WHERE op_id = 'grant:' || casino_accounts.id)`,
      )
      .bind(name, STARTING_BALANCE, now),
    db.prepare(`SELECT * FROM casino_accounts WHERE name = ?1`).bind(name),
  ]);
  const account = (found!.results as unknown as AccountRow[])[0];
  if (!account) throw new Error('login: account row missing after upsert');
  return { account, created: account.created_at === now };
}

export async function getAccount(db: D1Database, id: number): Promise<AccountRow | null> {
  return (await db.prepare(`SELECT * FROM casino_accounts WHERE id = ?1`).bind(id).first<AccountRow>()) ?? null;
}

export async function setLook(db: D1Database, id: number, look: Look): Promise<void> {
  await db.prepare(`UPDATE casino_accounts SET look = ?2 WHERE id = ?1`).bind(id, JSON.stringify(look)).run();
}

export interface EscrowRow {
  table_id: string;
  amount: number;
  opened_at: number;
  updated_at: number;
}

export async function escrowsOf(db: D1Database, id: number): Promise<EscrowRow[]> {
  const r = await db
    .prepare(`SELECT table_id, amount, opened_at, updated_at FROM casino_escrow WHERE account_id = ?1 ORDER BY opened_at`)
    .bind(id)
    .all<EscrowRow>();
  return r.results;
}

/** The game a table name belongs to ("bj-..." lobbies, "solo:blackjack:-:17" sessions). */
export function gameOfTable(tableId: string): GameId | null {
  if (tableId.startsWith('solo:')) {
    const g = tableId.split(':')[1];
    return isGameId(g) ? g : null;
  }
  // Lobby ids start with the game's catalog prefix, so every game (new ones included) maps here.
  const prefix = tableId.slice(0, 2);
  return Object.values(CATALOG).find((g) => g.prefix === prefix)?.id ?? null;
}

/** Everything the profile screen shows, in three reads. */
export async function loadProfile(db: D1Database, id: number, liveStacks: Map<string, number> = new Map()): Promise<Profile | null> {
  const [acct, stats, loans, escrows] = await db.batch([
    db.prepare(`SELECT * FROM casino_accounts WHERE id = ?1`).bind(id),
    db.prepare(`SELECT game, rounds, wagered, net, biggest_win FROM casino_stats WHERE account_id = ?1`).bind(id),
    db.prepare(`SELECT amount, created_at FROM casino_loans WHERE account_id = ?1 ORDER BY created_at DESC LIMIT 100`).bind(id),
    db.prepare(`SELECT table_id, amount FROM casino_escrow WHERE account_id = ?1 ORDER BY opened_at`).bind(id),
  ]);
  const a = (acct!.results as unknown as AccountRow[])[0];
  if (!a) return null;
  const games: Partial<Record<GameId, GameStats>> = {};
  const total: GameStats = { rounds: 0, wagered: 0, net: 0, biggestWin: 0 };
  for (const r of stats!.results as { game: string; rounds: number; wagered: number; net: number; biggest_win: number }[]) {
    if (!isGameId(r.game)) continue;
    games[r.game] = { rounds: r.rounds, wagered: r.wagered, net: r.net, biggestWin: r.biggest_win };
    total.rounds += r.rounds;
    total.wagered += r.wagered;
    total.net += r.net;
    total.biggestWin = Math.max(total.biggestWin, r.biggest_win);
  }
  return {
    id: a.id,
    name: a.name,
    look: lookFromJson(a.look),
    createdAt: a.created_at,
    balance: a.balance,
    inPlay: a.in_play,
    rev: a.rev,
    tables: (escrows!.results as { table_id: string; amount: number }[]).map((e) => {
      const stack = liveStacks.get(e.table_id);
      return { tableId: e.table_id, game: gameOfTable(e.table_id), escrow: e.amount, ...(stack !== undefined ? { stack } : {}) };
    }),
    loansTaken: a.loans_taken,
    loans: (loans!.results as { amount: number; created_at: number }[]).map((l) => ({ amount: l.amount, at: l.created_at })),
    stats: { total, games },
  };
}

/**
 * Count an attempt against a per-IP window and say whether it is still allowed. One statement
 * reads, increments and resets the window, so concurrent requests can't all read the same count.
 */
export async function bumpRate(db: D1Database, gate: string, ip: string, limit: number, windowMs: number, now: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO casino_rate (k, n, expires_at) VALUES (?1, 1, ?2)
       ON CONFLICT (k) DO UPDATE SET
         n = CASE WHEN casino_rate.expires_at <= ?3 THEN 1 ELSE casino_rate.n + 1 END,
         expires_at = CASE WHEN casino_rate.expires_at <= ?3 THEN ?2 ELSE casino_rate.expires_at END
       RETURNING n`,
    )
    .bind(`${gate}:${ip}`, now + windowMs, now)
    .first<{ n: number }>();
  return (row?.n ?? 1) <= limit;
}
