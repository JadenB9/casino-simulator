// Money between an account's balance and a table: buy-in, top-up, cash-out, orphan refund, and
// the bank's top-up (a loan). Each is one D1 batch, which D1 runs as a single transaction, so a
// ledger row and its balance change land together or not at all.
//
// The schema turns every way this could go wrong into an error (see the migration): an overdraft
// breaks balance_nonneg, a retried op collides on the ledger's primary key, a missing account
// breaks a foreign key, a missing escrow makes in_play NULL. A failed statement rolls the whole
// batch back. applyTransfer() then asks the ledger what actually happened.

import { isCents, type Cents } from '../../shared/src/money.ts';
import { REFILL_BELOW, REFILL_TO, SEND } from '../../shared/src/bank.ts';
import type { GameId } from '../../shared/src/engine.ts';

export type TransferOutcome =
  | { kind: 'applied'; balance?: Cents; inPlay?: Cents; rev?: number }
  | { kind: 'insufficient' };

export interface SeatStats {
  game: GameId;
  rounds: number;
  wagered: Cents;
  net: Cents;
  biggestWin: Cents;
}

/**
 * Money that may not go to a multiplayer Hold'em table yet, for account ?1 as of ?4: what transfers
 * hold back (bank.ts sendRules: the house's money from the last few days, other players' from the
 * last day), less the starting stake. The cashier's top-up has no end, so without this one account
 * could take top-up after top-up and lose each on purpose to another at a private table. A new
 * player's first $50,000 can go (sign-ups are limited per address), so friends who just joined can
 * sit down together.
 */
const HELD = `(SELECT COALESCE(SUM(amount), 0) FROM casino_ledger
       WHERE account_id = ?1 AND kind IN ('grant', 'loan') AND created_at > ?4 - ${SEND.houseHoldMs} AND op_id <> 'grant:' || account_id)
    + (SELECT COALESCE(SUM(amount), 0) FROM casino_transfers WHERE to_id = ?1 AND at > ?4 - ${SEND.giftHoldMs})`;

/**
 * Buy-in and top-up: balance -> chips at the table. `held` (a multiplayer Hold'em table, where
 * chips go from player to player) keeps HELD off the table: the buy-in must leave at least that
 * much on the balance, or the balance check refuses the batch as it would an overdraft.
 */
export function buyInStatements(db: D1Database, op: { opId: string; accountId: number; tableId: string; amount: Cents; now: number; held?: boolean }): D1PreparedStatement[] {
  return [
    db
      .prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'buyin', ?3, ?4, ?5)`)
      .bind(op.opId, op.accountId, -op.amount, op.tableId, op.now),
    db
      .prepare(
        `UPDATE casino_accounts SET balance = ${op.held ? `CASE WHEN balance - ?2 >= ${HELD} THEN balance - ?2 ELSE -1 END` : 'balance - ?2'},
                in_play = in_play + ?2, rev = rev + 1, last_seen = ?3
          WHERE id = ?1 RETURNING balance, in_play, rev`,
      )
      .bind(op.accountId, op.amount, op.now, ...(op.held ? [op.now] : [])),
    db
      .prepare(
        `INSERT INTO casino_escrow (account_id, table_id, amount, opened_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (account_id, table_id) DO UPDATE SET amount = amount + excluded.amount, updated_at = excluded.updated_at`,
      )
      .bind(op.accountId, op.tableId, op.amount, op.now),
  ];
}

/**
 * Cash-out: the whole stack back to the balance, the escrow closed, and the seat's stats folded
 * into the player's profile. `in_play` drops by what went in (the escrow), not by the stack.
 */
export function cashOutStatements(
  db: D1Database,
  op: { opId: string; accountId: number; tableId: string; stack: Cents; now: number; stats: SeatStats | null },
): D1PreparedStatement[] {
  const stmts = [
    db
      .prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'cashout', ?3, ?4, ?5)`)
      .bind(op.opId, op.accountId, op.stack, op.tableId, op.now),
    db
      .prepare(
        `UPDATE casino_accounts
            SET balance = balance + ?3,
                in_play = in_play - (SELECT amount FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2),
                rev = rev + 1, last_seen = ?4
          WHERE id = ?1 RETURNING balance, in_play, rev`,
      )
      .bind(op.accountId, op.tableId, op.stack, op.now),
    db.prepare(`DELETE FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2`).bind(op.accountId, op.tableId),
  ];
  if (op.stats && op.stats.rounds > 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO casino_stats (account_id, game, rounds, wagered, net, biggest_win) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (account_id, game) DO UPDATE SET
             rounds = rounds + excluded.rounds,
             wagered = wagered + excluded.wagered,
             net = net + excluded.net,
             biggest_win = MAX(biggest_win, excluded.biggest_win)`,
        )
        .bind(op.accountId, op.stats.game, op.stats.rounds, op.stats.wagered, op.stats.net, op.stats.biggestWin),
    );
  }
  return stmts;
}

/**
 * Give back an escrow the table has no record of (its storage was lost). The amount comes from
 * the escrow row itself, so nobody has to know it.
 */
export function refundStatements(db: D1Database, op: { opId: string; accountId: number; tableId: string; now: number }): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at)
         SELECT ?1, ?2, 'refund', amount, ?3, ?4 FROM casino_escrow WHERE account_id = ?2 AND table_id = ?3`,
      )
      .bind(op.opId, op.accountId, op.tableId, op.now),
    db
      .prepare(
        `UPDATE casino_accounts
            SET balance = balance + (SELECT amount FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2),
                in_play = in_play - (SELECT amount FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2),
                rev = rev + 1
          WHERE id = ?1 RETURNING balance, in_play, rev`,
      )
      .bind(op.accountId, op.tableId),
    db.prepare(`DELETE FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2`).bind(op.accountId, op.tableId),
  ];
}

export interface LoanOp {
  opId: string;
  accountId: number;
  /** Chips on the player's tables as those tables reported them (stacks and bets out). */
  chips: Cents;
  /** What D1 held on tables (casino_accounts.in_play) when those reports were read. */
  inPlay: Cents;
  now: number;
  /** v6 bank6: the Casino Index's price now (ticks), so the fund counts at what it's worth. */
  fundPrice?: number;
}

/**
 * v6 bank6: what the bank holds for the account in the loan's row (`casino_accounts.id`), read in
 * the same batch: savings, open deposits, the fund at price ?8, and what it sent other players
 * since ?9 (shared/src/bank.ts SEND.refillCountsMs). Parked money counts, so parking it can't
 * bring a top-up.
 */
const IN_BANK = `(SELECT COALESCE(SUM(balance), 0) FROM casino_savings WHERE account_id = casino_accounts.id)
    + (SELECT COALESCE(SUM(principal), 0) FROM casino_deposits WHERE account_id = casino_accounts.id AND closed_at IS NULL)
    + (SELECT COALESCE(SUM(CAST(units * ?8 / 100000000 AS INTEGER)), 0) FROM casino_holdings WHERE account_id = casino_accounts.id)
    + (SELECT COALESCE(SUM(amount), 0) FROM casino_transfers WHERE from_id = casino_accounts.id AND at > ?9)`;

/** v6 bank6: IN_BANK on its own, for the cashier's answer when there's no top-up (?1 and ?3-?7 unused). */
export async function refillCounted(db: D1Database, accountId: number, fundPrice: number, now: number): Promise<Cents> {
  const row = await db
    .prepare(`SELECT ${IN_BANK} AS n FROM casino_accounts WHERE id = ?2`)
    .bind(null, accountId, null, null, null, null, null, fundPrice, now - SEND.refillCountsMs)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The bank's top-up, recorded as a loan: under REFILL_BELOW in all, the balance goes up by
 * exactly what brings the player to REFILL_TO. "In all" is the balance and everything in the bank
 * (IN_BANK), read inside this batch, plus the chips the tables reported a moment before.
 * `inPlay` pins what D1 held on tables when they were asked: a buy-in, top-up or cash-out landing
 * in between changes it, and then nothing happens rather than a loan worked out from numbers that
 * no longer hold.
 *
 * The first statement decides and records the amount; the other two only follow a loan row with
 * no ledger row yet (the one this batch just wrote), so all three happen or none do, and a
 * second request finds the player at $50,000.
 */
export function loanStatements(db: D1Database, op: LoanOp): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO casino_loans (op_id, account_id, amount, created_at)
         SELECT ?1, id, ?5 - (balance + ?3 + ${IN_BANK}), ?6 FROM casino_accounts
          WHERE id = ?2 AND in_play = ?4 AND balance + ?3 + ${IN_BANK} < ?7
         RETURNING amount`,
      )
      .bind(op.opId, op.accountId, op.chips, op.inPlay, REFILL_TO, op.now, REFILL_BELOW, op.fundPrice ?? 0, op.now - SEND.refillCountsMs),
    db
      .prepare(
        `UPDATE casino_accounts
            SET balance = balance + (SELECT amount FROM casino_loans WHERE op_id = ?1),
                loans_taken = loans_taken + 1, rev = rev + 1
          WHERE id = ?2 AND EXISTS (SELECT 1 FROM casino_loans WHERE op_id = ?1)
            AND NOT EXISTS (SELECT 1 FROM casino_ledger WHERE op_id = ?1)
          RETURNING balance, in_play, rev`,
      )
      .bind(op.opId, op.accountId),
    db
      .prepare(
        `INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at)
         SELECT op_id, account_id, 'loan', amount, NULL, created_at FROM casino_loans
          WHERE op_id = ?1 AND NOT EXISTS (SELECT 1 FROM casino_ledger WHERE op_id = ?1)`,
      )
      .bind(op.opId),
  ];
}

interface MoneyRow {
  balance: number;
  in_play: number;
  rev: number;
}

/**
 * Run a transfer batch. The ledger, not the error text, decides whether it happened: a retry of
 * a batch that already landed fails on the ledger's key, and that is success. The only error we
 * read is the overdraft check. Anything else is unknown, and the caller retries with the same op
 * id later.
 */
export async function applyTransfer(db: D1Database, statements: D1PreparedStatement[], opId: string): Promise<TransferOutcome> {
  try {
    const results = await db.batch<MoneyRow>(statements);
    const money = results[1]?.results?.[0];
    return { kind: 'applied', balance: money?.balance, inPlay: money?.in_play, rev: money?.rev };
  } catch (err) {
    const landed = await db.prepare(`SELECT 1 AS hit FROM casino_ledger WHERE op_id = ?1`).bind(opId).first<{ hit: number }>();
    if (landed) return { kind: 'applied' };
    if (String((err as Error)?.message ?? err).includes('balance_nonneg')) return { kind: 'insufficient' };
    throw err;
  }
}

/**
 * The top-up batch, reported as granted (with the amount) or not. The same op id twice is one
 * loan: a repeat finds the player topped up, or collides on the loan's key, and either way
 * reports the loan that already landed.
 */
export async function takeLoan(db: D1Database, op: LoanOp): Promise<{ granted: boolean; amount?: Cents; money?: MoneyRow }> {
  if (!isCents(op.chips) || !isCents(op.inPlay)) throw new Error('takeLoan: chips and inPlay must be whole cents');
  let results: D1Result<MoneyRow & { amount: number }>[];
  try {
    results = await db.batch<MoneyRow & { amount: number }>(loanStatements(db, op));
  } catch (err) {
    const landed = await loanMade(db, op.opId);
    if (landed !== null) return { granted: true, amount: landed };
    throw err;
  }
  const made = results[0]?.results?.[0]?.amount;
  if (made === undefined) {
    const landed = await loanMade(db, op.opId);
    return landed !== null ? { granted: true, amount: landed } : { granted: false };
  }
  return { granted: true, amount: made, money: results[1]?.results?.[0] };
}

async function loanMade(db: D1Database, opId: string): Promise<Cents | null> {
  return (await db.prepare(`SELECT amount FROM casino_loans WHERE op_id = ?1`).bind(opId).first<{ amount: number }>())?.amount ?? null;
}

export async function moneyOf(db: D1Database, accountId: number): Promise<MoneyRow | null> {
  return (await db.prepare(`SELECT balance, in_play, rev FROM casino_accounts WHERE id = ?1`).bind(accountId).first<MoneyRow>()) ?? null;
}
