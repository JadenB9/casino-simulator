// D1 access for accounts, profiles and login rate limits. Money movement lives in transfer.ts.

import { STARTING_BALANCE } from '../../shared/src/money.ts';
import { lookFromJson, type Look } from '../../shared/src/look.ts';
import { HOLD_MS, ITEM_KINDS, shopItem } from '../../shared/src/items.ts';
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
  /** "pbkdf2:<iterations>:<hex>", or null for an account from before passwords (migration 0003) */
  pass_hash: string | null;
  pass_salt: string | null;
}

/** An account by name. Names are case-insensitive through the column's NOCASE collation. */
export async function findAccount(db: D1Database, name: string): Promise<AccountRow | null> {
  return (await db.prepare(`SELECT * FROM casino_accounts WHERE name = ?1`).bind(name).first<AccountRow>()) ?? null;
}

/**
 * Create an account with its password, its starting bankroll and a ledger row recording the
 * grant. Null if the name turned out to be taken ("Ace" and "ace" are one name): the insert
 * then does nothing, and the caller treats the request as a login to that account.
 */
export async function createAccount(db: D1Database, name: string, pass: { hash: string; salt: string }, now: number): Promise<AccountRow | null> {
  const [, , found] = await db.batch([
    db
      .prepare(
        `INSERT INTO casino_accounts (name, balance, created_at, last_seen, pass_hash, pass_salt) VALUES (?1, ?2, ?3, ?3, ?4, ?5)
         ON CONFLICT (name) DO NOTHING`,
      )
      .bind(name, STARTING_BALANCE, now, pass.hash, pass.salt),
    // Record where the starting money came from, for the row this batch made (its salt is new,
    // so it picks out that row and no other). Guarded by NOT EXISTS rather than an
    // ignore-on-conflict clause, which this ledger never uses.
    db
      .prepare(
        `INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at)
         SELECT 'grant:' || id, id, 'grant', ?2, NULL, created_at FROM casino_accounts
          WHERE name = ?1 AND pass_salt = ?3
            AND NOT EXISTS (SELECT 1 FROM casino_ledger WHERE op_id = 'grant:' || casino_accounts.id)`,
      )
      .bind(name, STARTING_BALANCE, pass.salt),
    db.prepare(`SELECT * FROM casino_accounts WHERE name = ?1`).bind(name),
  ]);
  const account = (found!.results as unknown as AccountRow[])[0];
  return account && account.pass_salt === pass.salt ? account : null;
}

/**
 * Give an account from before passwords its first one, which claims the name. False if it
 * already has a password (someone claimed it first).
 */
export async function claimAccount(db: D1Database, id: number, pass: { hash: string; salt: string }, now: number): Promise<boolean> {
  const r = await db
    .prepare(`UPDATE casino_accounts SET pass_hash = ?2, pass_salt = ?3, last_seen = ?4 WHERE id = ?1 AND pass_hash IS NULL`)
    .bind(id, pass.hash, pass.salt, now)
    .run();
  return r.meta.changes === 1;
}

export async function touchAccount(db: D1Database, id: number, now: number): Promise<void> {
  await db.prepare(`UPDATE casino_accounts SET last_seen = ?2 WHERE id = ?1`).bind(id, now).run();
}

export async function getAccount(db: D1Database, id: number): Promise<AccountRow | null> {
  return (await db.prepare(`SELECT * FROM casino_accounts WHERE id = ?1`).bind(id).first<AccountRow>()) ?? null;
}

/**
 * Store a look, keeping only what this account may wear (wornLook). A look wearing a shop item
 * the account doesn't own is refused whole: nothing is stored and the reason comes back.
 */
export async function setLook(db: D1Database, id: number, look: Look, now = Date.now()): Promise<{ look: Look } | { error: string }> {
  const worn = await wornLook(db, id, look, now);
  if ('look' in worn) await db.prepare(`UPDATE casino_accounts SET look = ?2 WHERE id = ?1`).bind(id, JSON.stringify(worn.look)).run();
  return worn;
}

/**
 * Check a look against what the account has paid for. Every shop item on it must be owned (an
 * error names the first that isn't). A held bar order stays only while it is this account's own
 * paid order, of that item, and still in hand; its end time comes from when the order was paid,
 * whatever the client says, and an order that has run out is simply dropped.
 */
export async function wornLook(db: D1Database, accountId: number, look: Look, now: number): Promise<{ look: Look } | { error: string }> {
  const wearing = ITEM_KINDS.flatMap((k) => (look[k] ? [look[k]] : []));
  if (wearing.length === 0 && !look.held) return { look };
  const [owned, order] = await db.batch([
    db.prepare(`SELECT item FROM casino_items WHERE account_id = ?1`).bind(accountId),
    db.prepare(`SELECT item, created_at FROM casino_orders WHERE op_id = ?1`).bind(orderKey(accountId, look.held?.order ?? '')),
  ]);
  const mine = new Set((owned!.results as { item: string }[]).map((r) => r.item));
  const missing = wearing.find((id) => !mine.has(id));
  if (missing) return { error: `You don't own the ${shopItem(missing)?.name ?? 'item'} yet.` };
  if (!look.held) return { look };
  const { held, ...rest } = look;
  const paid = (order!.results as { item: string; created_at: number }[])[0];
  const until = paid ? paid.created_at + HOLD_MS : 0;
  if (!paid || paid.item !== held.item || until <= now) return { look: rest };
  return { look: { ...rest, held: { ...held, until } } };
}

/** Where a bar order is kept: the account is part of the key, so one player's op never matches another's. */
export function orderKey(accountId: number, op: string): string {
  return `bar:${accountId}:${op}`;
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
 * Count an attempt against a window (per IP, or per name for wrong passwords) and say whether it
 * is still allowed. One statement reads, increments and resets the window, so concurrent
 * requests can't all read the same count.
 */
export async function bumpRate(db: D1Database, gate: string, key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO casino_rate (k, n, expires_at) VALUES (?1, 1, ?2)
       ON CONFLICT (k) DO UPDATE SET
         n = CASE WHEN casino_rate.expires_at <= ?3 THEN 1 ELSE casino_rate.n + 1 END,
         expires_at = CASE WHEN casino_rate.expires_at <= ?3 THEN ?2 ELSE casino_rate.expires_at END
       RETURNING n`,
    )
    .bind(`${gate}:${key}`, now + windowMs, now)
    .first<{ n: number }>();
  return (row?.n ?? 1) <= limit;
}

/**
 * Whether any of these counters has already reached its limit in its current window. Read-only
 * (bumpRate moves them), so a locked-out login is refused before any password work is done.
 */
export async function rateReached(db: D1Database, checks: { gate: string; key: string; limit: number }[], now: number): Promise<boolean> {
  const rows = await db.batch<{ n: number }>(
    checks.map((c) => db.prepare(`SELECT n FROM casino_rate WHERE k = ?1 AND expires_at > ?2`).bind(`${c.gate}:${c.key}`, now)),
  );
  return rows.some((r, i) => (r.results[0]?.n ?? 0) >= checks[i]!.limit);
}
