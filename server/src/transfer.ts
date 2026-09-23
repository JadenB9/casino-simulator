// Money between an account's balance and a table: buy-in, top-up, cash-out, orphan refund, and
// the bank's loan. Each is one D1 batch, which D1 runs as a single transaction, so a ledger row
// and its balance change land together or not at all.
//
// The schema turns every way this could go wrong into an error (see the migration): an overdraft
// breaks balance_nonneg, a retried op collides on the ledger's primary key, a missing account
// breaks a foreign key, a missing escrow makes in_play NULL. A failed statement rolls the whole
// batch back. applyTransfer() then asks the ledger what actually happened.

import type { Cents } from '../../shared/src/money.ts';
import { LOAN_AMOUNT } from '../../shared/src/money.ts';
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

/** Buy-in and top-up: balance -> chips at the table. */
export function buyInStatements(db: D1Database, op: { opId: string; accountId: number; tableId: string; amount: Cents; now: number }): D1PreparedStatement[] {
  return [
    db
      .prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'buyin', ?3, ?4, ?5)`)
      .bind(op.opId, op.accountId, -op.amount, op.tableId, op.now),
    db
      .prepare(
        `UPDATE casino_accounts SET balance = balance - ?2, in_play = in_play + ?2, rev = rev + 1, last_seen = ?3
          WHERE id = ?1 RETURNING balance, in_play, rev`,
      )
      .bind(op.accountId, op.amount, op.now),
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

/**
 * The loan: all three statements share the "truly broke" guard, and the first one runs before the
 * balance changes, so either all three happen or none do. A second click finds balance > 0.
 */
export function loanStatements(db: D1Database, op: { opId: string; accountId: number; now: number }): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO casino_loans (op_id, account_id, amount, created_at)
         SELECT ?1, id, ?3, ?4 FROM casino_accounts WHERE id = ?2 AND balance = 0 AND in_play = 0`,
      )
      .bind(op.opId, op.accountId, LOAN_AMOUNT, op.now),
    db
      .prepare(
        `UPDATE casino_accounts SET balance = balance + ?3, loans_taken = loans_taken + 1, rev = rev + 1
          WHERE id = ?2 AND balance = 0 AND in_play = 0 AND EXISTS (SELECT 1 FROM casino_loans WHERE op_id = ?1)
          RETURNING balance, in_play, rev`,
      )
      .bind(op.opId, op.accountId, LOAN_AMOUNT),
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

/** The loan batch, reported as granted or not. */
export async function takeLoan(db: D1Database, accountId: number, now: number, opId: string): Promise<{ granted: boolean; money?: MoneyRow }> {
  const results = await db.batch<MoneyRow>(loanStatements(db, { opId, accountId, now }));
  const granted = (results[0]?.meta.changes ?? 0) === 1;
  return { granted, money: results[1]?.results?.[0] };
}

export async function moneyOf(db: D1Database, accountId: number): Promise<MoneyRow | null> {
  return (await db.prepare(`SELECT balance, in_play, rev FROM casino_accounts WHERE id = ?1`).bind(accountId).first<MoneyRow>()) ?? null;
}
