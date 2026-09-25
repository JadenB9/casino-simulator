// The bank behind the cage (shared/src/bank.ts has the rules): savings, term deposits, the Casino
// Index, transfers between players, and the statement. Every route is paid from or into the
// balance; chips on tables stay where they are.
//
// Each operation is one D1 batch whose first statement decides and records it: a casino_bank row
// (or, for a transfer, the casino_transfers row) inserted only if the operation's precondition
// holds, read in the same transaction. Every later statement in the batch runs only if that row
// exists, and it can only exist because this batch wrote it (a row from before collides on its key
// and rolls the batch back). So a batch either does everything or nothing: when the precondition
// no longer holds (someone else changed the savings, the holding or the limits in between) the
// first insert writes nothing and neither does the rest; the caller reads again and tries again.
// A retry of an operation that landed collides on its key and is answered with the bank as it
// stands. The migration (0007_bank.sql) states the money identity these batches keep.

import { formatMoney, isCents, type Cents } from '../../shared/src/money.ts';
import {
  DAY_MS, DEPOSIT_CAP, DEPOSIT_MAX_OPEN, DEPOSIT_MIN, FUND_CAP, FUND_ID, FUND_MIN, FUND_NAME, SEND, STEPS_PER_DAY, accrue, cleanNote, costOf,
  depositInterest, depositPayout, sendable, stepOf, termOf, unitsFor, valueOf,
  type BankResponse, type BankState, type DepositView, type InterestPayment, type MarketResponse, type Received, type SavingsState, type SavingsView,
  type SendRules, type StatementLine, type StatementResponse, type Term,
} from '../../shared/src/bank.ts';
import { isOp } from '../../shared/src/items.ts';
import type { ErrorCode, FloorServerMsg, ProfileBank } from '../../shared/src/protocol.ts';
import { bumpRate, findAccount } from './db.ts';
import { fail, json, readJson } from './http.ts';
import { history, priceDayAgo, priceNow } from './market.ts';
import type { CasinoFloor } from './floor/index.ts';

/** Bank operations per account per minute (savings, deposits, the fund). */
const LIMIT = 30;
/** Transfers per account per minute, refused ones included. */
const SEND_LIMIT = 10;
/** Reads again and tries again this many times when another request changed things in between. */
const TRIES = 4;

export interface Refusal {
  status: number;
  code: ErrorCode;
  msg: string;
}

const refuse = (status: number, code: ErrorCode, msg: string): Refusal => ({ status, code, msg });
const BUSY = refuse(409, 'BUSY', 'The bank is busy with another request of yours. Try again in a moment.');

// ---------------------------------------------------------------------------------------------
// The journal and the batch

type Kind = 'save' | 'unsave' | 'interest' | 'lock' | 'unlock' | 'buy' | 'sell' | 'send' | 'receive';

interface Move {
  opId: string;
  accountId: number;
  kind: Kind;
  cash?: Cents;
  saved?: Cents;
  locked?: Cents;
  cost?: Cents;
  units?: number;
  peer?: number;
  ref?: string;
  at: number;
  /** Set on a batch's first row only: the batch's own random mark (see Lead). */
  nonce?: string;
}

/**
 * A batch's first row, as the rest of the batch finds it: its key and a random mark only this
 * batch knows. A key alone isn't enough: a request running alongside can have written the same
 * key (a retry of the same operation, a day's interest), and then this batch's first insert
 * writes nothing while the row is there all the same.
 */
interface Lead {
  id: string;
  nonce: string;
}

const lead = (id: string): Lead => ({ id, nonce: crypto.randomUUID() });

/** SQL: the batch's first row is there, and it's this batch's. */
const ours = (id: number, nonce: number) => `EXISTS (SELECT 1 FROM casino_bank WHERE op_id = ?${id} AND nonce = ?${nonce})`;

/**
 * A casino_bank row, written only `where` (SQL whose own values start at ?14). Its gain is what
 * it moves in all, which the migration's bank_balanced check holds it to.
 */
function journal(db: D1Database, m: Move, where: string, ...args: unknown[]): D1PreparedStatement {
  const [cash, saved, locked, cost] = [m.cash ?? 0, m.saved ?? 0, m.locked ?? 0, m.cost ?? 0];
  return db
    .prepare(
      `INSERT INTO casino_bank (op_id, account_id, kind, cash, saved, locked, cost, units, gain, peer, ref, at, nonce)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13 WHERE ${where}`,
    )
    .bind(m.opId, m.accountId, m.kind, cash, saved, locked, cost, m.units ?? 0, cash + saved + locked + cost, m.peer ?? null, m.ref ?? null, m.at, m.nonce ?? null, ...args);
}

/** The balance and banked moved by one operation, if this batch's first row landed. */
function moveMoney(db: D1Database, accountId: number, cash: Cents, banked: Cents, l: Lead, now: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE casino_accounts SET balance = balance + ?2, banked = banked + ?3, rev = rev + 1, last_seen = ?5
        WHERE id = ?1 AND ${ours(4, 6)}
        RETURNING balance, in_play, rev, banked`,
    )
    .bind(accountId, cash, banked, l.id, now, l.nonce);
}

type Ran = 'done' | 'dup' | 'raced' | 'short' | 'short-savings';

/**
 * Run a batch whose first statement decides. 'raced' when it wrote nothing (the precondition
 * didn't hold) or a row it needed collided (another request paid that day's interest first).
 */
async function run(db: D1Database, stmts: D1PreparedStatement[], landed: () => Promise<boolean>): Promise<Ran> {
  try {
    const results = await db.batch(stmts);
    return (results[0]?.meta.changes ?? 0) > 0 ? 'done' : 'raced';
  } catch (err) {
    if (await landed()) return 'dup';
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes('balance_nonneg')) return 'short';
    if (msg.includes('savings_nonneg')) return 'short-savings';
    if (msg.includes('UNIQUE')) return 'raced';
    throw err;
  }
}

async function opLanded(db: D1Database, opId: string, table: 'casino_bank' | 'casino_transfers' = 'casino_bank'): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS n FROM ${table} WHERE op_id = ?1`).bind(opId).first()) !== null;
}

/** A retried operation id: fine if it was this kind of operation, a mistake if it was another. */
async function sameOp(db: D1Database, opId: string, kinds: Kind[]): Promise<Refusal | null> {
  const row = await db.prepare(`SELECT kind FROM casino_bank WHERE op_id = ?1`).bind(opId).first<{ kind: Kind }>();
  return row && kinds.includes(row.kind) ? null : refuse(400, 'BAD_REQUEST', 'That operation id was used for something else.');
}

function short(balance: Cents, amount: Cents): Refusal {
  return refuse(409, 'INSUFFICIENT_FUNDS', `Not enough: that's ${formatMoney(amount)} and your balance is ${formatMoney(balance)}.`);
}

async function balanceOf(db: D1Database, accountId: number): Promise<Cents> {
  return (await db.prepare(`SELECT balance FROM casino_accounts WHERE id = ?1`).bind(accountId).first<{ balance: number }>())?.balance ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Savings

interface SavingsRow extends SavingsState {
  earned: Cents;
}

async function savingsRow(db: D1Database, accountId: number): Promise<SavingsRow | null> {
  return (await db.prepare(`SELECT balance, accrued, frac, since, earned FROM casino_savings WHERE account_id = ?1`).bind(accountId).first<SavingsRow>()) ?? null;
}

/** The key of a day's interest: each day is paid once. */
const interestId = (accountId: number, day: number) => `int:${accountId}:${day}`;

/** "2026-09-25", the day a payment was for. */
function dayRef(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** The interest rows, the money and the savings row after the batch's first row, `l`. */
function savingsTail(db: D1Database, accountId: number, l: Lead, since: number, paid: InterestPayment[], state: SavingsState, moved: Cents, cash: Cents, now: number, skipFirst = false): D1PreparedStatement[] {
  const interest = paid.reduce((s, p) => s + p.amount, 0);
  return [
    ...paid
      .slice(skipFirst ? 1 : 0)
      .map((p) => journal(db, { opId: interestId(accountId, p.day), accountId, kind: 'interest', saved: p.amount, ref: dayRef(p.day), at: (p.day + 1) * DAY_MS }, ours(14, 15), l.id, l.nonce)),
    moveMoney(db, accountId, cash, moved + interest, l, now),
    db
      .prepare(
        `UPDATE casino_savings SET balance = balance + ?2, accrued = ?3, frac = ?4, since = ?5, earned = earned + ?6
          WHERE account_id = ?1 AND since = ?9 AND ${ours(7, 8)}`,
      )
      .bind(accountId, moved + interest, state.accrued, state.frac, state.since, interest, l.id, l.nonce, since),
  ];
}

/**
 * Pay whatever interest is due (a midnight has passed since the savings were last brought up to
 * date). Nothing is written when nothing is due.
 */
export async function settleSavings(db: D1Database, accountId: number, now: number): Promise<void> {
  for (let i = 0; i < TRIES; i++) {
    const row = await savingsRow(db, accountId);
    if (!row) return;
    const { state, paid } = accrue(row, now);
    if (paid.length === 0) return;
    const first = paid[0]!;
    const l = lead(interestId(accountId, first.day));
    const stmts = [
      journal(db, { opId: l.id, nonce: l.nonce, accountId, kind: 'interest', saved: first.amount, ref: dayRef(first.day), at: (first.day + 1) * DAY_MS }, `(SELECT since FROM casino_savings WHERE account_id = ?14) = ?15`, accountId, row.since),
      ...savingsTail(db, accountId, l, row.since, paid, state, 0, 0, now, true),
    ];
    const r = await run(db, stmts, async () => false);
    if (r === 'done') return;
  }
}

/** Into savings from the balance ('in'), or back out ('out'). */
export async function moveSavings(db: D1Database, accountId: number, op: string, dir: 'in' | 'out', amount: Cents, now: number): Promise<Refusal | null> {
  const opId = `bank:${accountId}:${op}`;
  for (let i = 0; i < TRIES; i++) {
    if (dir === 'in') await db.prepare(`INSERT INTO casino_savings (account_id, since) VALUES (?1, ?2) ON CONFLICT DO NOTHING`).bind(accountId, now).run();
    const row = await savingsRow(db, accountId);
    const { state, paid } = accrue(row ?? { balance: 0, accrued: 0, frac: 0, since: now }, now);
    if (dir === 'out' && (!row || amount > state.balance)) {
      if (await opLanded(db, opId)) return sameOp(db, opId, ['unsave']);
      return refuse(409, 'INSUFFICIENT_FUNDS', `Your savings hold ${formatMoney(state.balance)}.`);
    }
    const x = dir === 'in' ? amount : -amount;
    const l = lead(opId);
    const stmts = [
      journal(db, { opId, nonce: l.nonce, accountId, kind: dir === 'in' ? 'save' : 'unsave', cash: -x, saved: x, at: now }, `(SELECT since FROM casino_savings WHERE account_id = ?14) = ?15`, accountId, row!.since),
      ...savingsTail(db, accountId, l, row!.since, paid, state, x, -x, now),
    ];
    const r = await run(db, stmts, () => opLanded(db, opId));
    if (r === 'done') return null;
    if (r === 'dup') return sameOp(db, opId, [dir === 'in' ? 'save' : 'unsave']);
    if (r === 'short') return short(await balanceOf(db, accountId), amount);
    if (r === 'short-savings') continue;
  }
  return BUSY;
}

// ---------------------------------------------------------------------------------------------
// Term deposits

interface DepositRow {
  op_id: string;
  term: string;
  principal: number;
  interest: number;
  opened_at: number;
  matures_at: number;
  closed_at: number | null;
  close_op: string | null;
  paid: number | null;
}

export async function openDeposit(db: D1Database, accountId: number, op: string, term: Term, amount: Cents, now: number): Promise<Refusal | null> {
  const opId = `bank:${accountId}:${op}`;
  const depId = `dep:${accountId}:${op}`;
  const l = lead(opId);
  const stmts = [
    journal(
      db,
      { opId, nonce: l.nonce, accountId, kind: 'lock', cash: -amount, locked: amount, ref: depId, at: now },
      `(SELECT COALESCE(SUM(principal), 0) FROM casino_deposits WHERE account_id = ?14 AND closed_at IS NULL) + ?15 <= ?16
       AND (SELECT COUNT(*) FROM casino_deposits WHERE account_id = ?14 AND closed_at IS NULL) < ?17`,
      accountId,
      amount,
      DEPOSIT_CAP,
      DEPOSIT_MAX_OPEN,
    ),
    db
      .prepare(
        `INSERT INTO casino_deposits (op_id, account_id, term, principal, interest, opened_at, matures_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${ours(8, 9)}`,
      )
      .bind(depId, accountId, term.id, amount, depositInterest(amount, term), now, now + term.ms, l.id, l.nonce),
    moveMoney(db, accountId, -amount, amount, l, now),
  ];
  const r = await run(db, stmts, () => opLanded(db, opId));
  if (r === 'done') return null;
  if (r === 'dup') return sameOp(db, opId, ['lock']);
  if (r === 'short') return short(await balanceOf(db, accountId), amount);
  const open = await db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(principal), 0) AS p FROM casino_deposits WHERE account_id = ?1 AND closed_at IS NULL`)
    .bind(accountId)
    .first<{ n: number; p: number }>();
  if ((open?.n ?? 0) >= DEPOSIT_MAX_OPEN) return refuse(409, 'LIMIT', `You can have ${DEPOSIT_MAX_OPEN} deposits open at once.`);
  return refuse(409, 'LIMIT', `Deposits hold up to ${formatMoney(DEPOSIT_CAP)} in all; you have ${formatMoney(open?.p ?? 0)} locked.`);
}

/** Close a deposit: principal and interest once it has matured, or principal less the fee before. */
export async function closeDeposit(db: D1Database, accountId: number, op: string, depId: string, now: number): Promise<Refusal | null> {
  const opId = `bank:${accountId}:${op}`;
  for (let i = 0; i < TRIES; i++) {
    const d = await db.prepare(`SELECT * FROM casino_deposits WHERE op_id = ?1 AND account_id = ?2`).bind(depId, accountId).first<DepositRow>();
    if (!d) return refuse(404, 'NOT_FOUND', 'No such deposit.');
    if (d.closed_at !== null) return d.close_op === opId ? null : refuse(409, 'NOT_ELIGIBLE', 'That deposit is already closed.');
    const out = depositPayout({ principal: d.principal, interest: d.interest, maturesAt: d.matures_at }, now);
    const l = lead(opId);
    const stmts = [
      journal(
        db,
        { opId, nonce: l.nonce, accountId, kind: 'unlock', cash: out.paid, locked: -d.principal, ref: depId, at: now },
        `EXISTS (SELECT 1 FROM casino_deposits WHERE op_id = ?14 AND account_id = ?15 AND closed_at IS NULL AND (matures_at <= ?16) = ?17)`,
        depId,
        accountId,
        now,
        out.matured ? 1 : 0,
      ),
      db
        .prepare(`UPDATE casino_deposits SET closed_at = ?2, close_op = ?3, paid = ?4 WHERE op_id = ?1 AND ${ours(3, 5)}`)
        .bind(depId, now, opId, out.paid, l.nonce),
      moveMoney(db, accountId, out.paid, -d.principal, l, now),
    ];
    const r = await run(db, stmts, () => opLanded(db, opId));
    if (r === 'done') return null;
    if (r === 'dup') return sameOp(db, opId, ['unlock']);
  }
  return BUSY;
}

// ---------------------------------------------------------------------------------------------
// The Casino Index

interface Holding {
  units: number;
  cost: number;
}

async function holdingOf(db: D1Database, accountId: number): Promise<Holding> {
  return (await db.prepare(`SELECT units, cost FROM casino_holdings WHERE account_id = ?1 AND fund = ?2`).bind(accountId, FUND_ID).first<Holding>()) ?? { units: 0, cost: 0 };
}

export async function buyFund(db: D1Database, secret: string, accountId: number, op: string, amount: Cents, now: number): Promise<Refusal | null> {
  const opId = `bank:${accountId}:${op}`;
  if (await opLanded(db, opId)) return sameOp(db, opId, ['buy']);
  const { step, price } = await priceNow(db, secret, now);
  const units = unitsFor(amount, price);
  const l = lead(opId);
  const stmts = [
    journal(
      db,
      { opId, nonce: l.nonce, accountId, kind: 'buy', cash: -amount, cost: amount, units, ref: `${step}:${price}`, at: now },
      `COALESCE((SELECT cost FROM casino_holdings WHERE account_id = ?14 AND fund = ?15), 0) + ?16 <= ?17`,
      accountId,
      FUND_ID,
      amount,
      FUND_CAP,
    ),
    db
      .prepare(
        `INSERT INTO casino_holdings (account_id, fund, units, cost)
         SELECT ?1, ?2, ?3, ?4 WHERE ${ours(5, 6)}
         ON CONFLICT (account_id, fund) DO UPDATE SET units = units + excluded.units, cost = cost + excluded.cost`,
      )
      .bind(accountId, FUND_ID, units, amount, l.id, l.nonce),
    moveMoney(db, accountId, -amount, amount, l, now),
  ];
  const r = await run(db, stmts, () => opLanded(db, opId));
  if (r === 'done') return null;
  if (r === 'dup') return sameOp(db, opId, ['buy']);
  if (r === 'short') return short(await balanceOf(db, accountId), amount);
  const h = await holdingOf(db, accountId);
  return refuse(409, 'LIMIT', `The ${FUND_NAME} takes up to ${formatMoney(FUND_CAP)} per player, at cost; you have ${formatMoney(h.cost)} in it.`);
}

/** Sell `amount` worth (at least that much, or everything you hold if less), or everything. */
export async function sellFund(db: D1Database, secret: string, accountId: number, op: string, sell: { amount: Cents } | { all: true }, now: number): Promise<Refusal | null> {
  const opId = `bank:${accountId}:${op}`;
  if (await opLanded(db, opId)) return sameOp(db, opId, ['sell']);
  const { step, price } = await priceNow(db, secret, now);
  for (let i = 0; i < TRIES; i++) {
    const h = await holdingOf(db, accountId);
    if (h.units === 0) return refuse(409, 'NOT_ELIGIBLE', `You don't hold any of the ${FUND_NAME}.`);
    let units = h.units;
    if ('amount' in sell) {
      units = unitsFor(sell.amount, price);
      if (valueOf(units, price) < sell.amount) units += 1;
      units = Math.min(units, h.units);
    }
    const proceeds = valueOf(units, price);
    const cost = costOf(units, h);
    const l = lead(opId);
    const stmts = [
      journal(
        db,
        { opId, nonce: l.nonce, accountId, kind: 'sell', cash: proceeds, cost: -cost, units: -units, ref: `${step}:${price}`, at: now },
        `EXISTS (SELECT 1 FROM casino_holdings WHERE account_id = ?14 AND fund = ?15 AND units = ?16 AND cost = ?17)`,
        accountId,
        FUND_ID,
        h.units,
        h.cost,
      ),
      db
        .prepare(`UPDATE casino_holdings SET units = units - ?3, cost = cost - ?4 WHERE account_id = ?1 AND fund = ?2 AND ${ours(5, 6)}`)
        .bind(accountId, FUND_ID, units, cost, l.id, l.nonce),
      moveMoney(db, accountId, proceeds, -cost, l, now),
    ];
    const r = await run(db, stmts, () => opLanded(db, opId));
    if (r === 'done') return null;
    if (r === 'dup') return sameOp(db, opId, ['sell']);
  }
  return BUSY;
}

// ---------------------------------------------------------------------------------------------
// Transfers

/**
 * law6's jail (casino_jail, migration 0006): no sending while locked up. Before that migration
 * is on a database there is no jail, and nobody is in it.
 */
export async function inJail(db: D1Database, accountId: number): Promise<boolean> {
  try {
    return (await db.prepare(`SELECT 1 AS n FROM casino_jail WHERE account_id = ?1 AND released_at IS NULL`).bind(accountId).first()) !== null;
  } catch (err) {
    if (String((err as Error)?.message ?? err).includes('no such table')) return false;
    throw err;
  }
}

/** Where an account stands with the transfer rules (shared/src/bank.ts SEND), as of `now`. */
export async function sendRules(db: D1Database, accountId: number, now: number): Promise<SendRules & { balance: Cents }> {
  const [acct, house, gifts, sent] = await db.batch<{ n?: number; balance?: number; created_at?: number }>([
    db.prepare(`SELECT balance, created_at FROM casino_accounts WHERE id = ?1`).bind(accountId),
    db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1 AND kind IN ('grant', 'loan') AND created_at > ?2`)
      .bind(accountId, now - SEND.houseHoldMs),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_transfers WHERE to_id = ?1 AND at > ?2`).bind(accountId, now - SEND.giftHoldMs),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_transfers WHERE from_id = ?1 AND at > ?2`).bind(accountId, now - DAY_MS),
  ]);
  const a = acct!.results[0] ?? { balance: 0, created_at: now };
  const held = (house!.results[0]?.n ?? 0) + (gifts!.results[0]?.n ?? 0);
  const sentToday = sent!.results[0]?.n ?? 0;
  const newUntil = a.created_at! + SEND.newAccountMs > now ? a.created_at! + SEND.newAccountMs : 0;
  const jailed = await inJail(db, accountId);
  const can = newUntil || jailed ? 0 : sendable(a.balance!, held, sentToday);
  return { balance: a.balance!, sendable: can, held, sentToday, newUntil, jailed };
}

function when(ms: number): string {
  const h = Math.ceil(ms / 3_600_000);
  return h >= 2 ? `${h} hours` : `${Math.ceil(ms / 60_000)} minutes`;
}

export interface Sent {
  id: string;
  to: { id: number; name: string };
  from: string;
  amount: Cents;
  note: string | null;
  at: number;
}

/** Send `amount` from the balance to the player called `to`. */
export async function sendMoney(
  db: D1Database,
  from: { id: number; name: string },
  op: string,
  req: { to: string; amount: Cents; note: string | null; confirm: boolean },
  now: number,
): Promise<Refusal | Sent> {
  const id = `xfer:${from.id}:${op}`;
  const target = await findAccount(db, req.to);
  if (!target) return refuse(404, 'NOT_FOUND', `Nobody here goes by ${req.to}.`);
  if (target.id === from.id) return refuse(409, 'NOT_ELIGIBLE', "You can't send money to yourself.");
  const done = async (): Promise<Sent | Refusal> => {
    const t = await db.prepare(`SELECT to_id, amount, note, at FROM casino_transfers WHERE op_id = ?1`).bind(id).first<{ to_id: number; amount: number; note: string | null; at: number }>();
    if (!t || t.to_id !== target.id || t.amount !== req.amount) return refuse(400, 'BAD_REQUEST', 'That operation id was used for something else.');
    return { id, to: { id: target.id, name: target.name }, from: from.name, amount: t.amount, note: t.note, at: t.at };
  };
  if (await opLanded(db, id, 'casino_transfers')) return done();
  if (req.amount < SEND.min) return refuse(400, 'BAD_REQUEST', `Transfers start at ${formatMoney(SEND.min)}.`);
  if (req.amount >= SEND.confirmAt && !req.confirm) return refuse(409, 'NOT_ELIGIBLE', `Confirm sending ${formatMoney(req.amount)} to ${target.name}.`);

  for (let i = 0; i < 2; i++) {
    const rules = await sendRules(db, from.id, now);
    if (rules.jailed) return refuse(409, 'NOT_ELIGIBLE', "You can't send money from jail.");
    if (rules.newUntil) return refuse(409, 'NOT_ELIGIBLE', `New accounts can send money after their first day: in ${when(rules.newUntil - now)}.`);
    if (req.amount > rules.balance) return short(rules.balance, req.amount);
    if (req.amount > rules.balance - rules.held) {
      return refuse(
        409,
        'NOT_ELIGIBLE',
        `You can send up to ${formatMoney(Math.max(0, rules.balance - rules.held))} now: ${formatMoney(rules.held)} of your balance came from the house or other players in the last few days and stays with you for now.`,
      );
    }
    if (rules.sentToday + req.amount > SEND.dayCap) {
      return refuse(409, 'LIMIT', `You can send ${formatMoney(SEND.dayCap)} in any 24 hours; ${formatMoney(Math.max(0, SEND.dayCap - rules.sentToday))} is left.`);
    }
    const pair = (await db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_transfers WHERE from_id = ?1 AND to_id = ?2 AND at > ?3`).bind(from.id, target.id, now - DAY_MS).first<{ n: number }>())!.n;
    if (pair + req.amount > SEND.pairCap) {
      return refuse(409, 'LIMIT', `One player can receive ${formatMoney(SEND.pairCap)} from you in any 24 hours; ${formatMoney(Math.max(0, SEND.pairCap - pair))} is left for ${target.name}.`);
    }
    // Every rule again inside the batch, so two sends at once can't both fit under one limit.
    const first = db
      .prepare(
        `INSERT INTO casino_transfers (op_id, from_id, to_id, amount, note, at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 FROM casino_accounts s
          WHERE s.id = ?2 AND s.created_at <= ?7
            AND (SELECT COALESCE(SUM(amount), 0) FROM casino_transfers WHERE from_id = ?2 AND at > ?8) + ?4 <= ?9
            AND (SELECT COALESCE(SUM(amount), 0) FROM casino_transfers WHERE from_id = ?2 AND to_id = ?3 AND at > ?8) + ?4 <= ?10
            AND s.balance
                - (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger WHERE account_id = ?2 AND kind IN ('grant', 'loan') AND created_at > ?11)
                - (SELECT COALESCE(SUM(amount), 0) FROM casino_transfers WHERE to_id = ?2 AND at > ?12) >= ?4`,
      )
      .bind(id, from.id, target.id, req.amount, req.note, now, now - SEND.newAccountMs, now - DAY_MS, SEND.dayCap, SEND.pairCap, now - SEND.houseHoldMs, now - SEND.giftHoldMs);
    // The two sides follow the transfer row; their keys are the transfer's, so a request running
    // alongside with the same op collides on them and nothing here lands twice.
    const sent = `EXISTS (SELECT 1 FROM casino_transfers WHERE op_id = ?14)`;
    const nonce = crypto.randomUUID();
    const out: Lead = { id: `${id}:out`, nonce };
    const stmts = [
      first,
      journal(db, { opId: out.id, nonce, accountId: from.id, kind: 'send', cash: -req.amount, peer: target.id, ref: id, at: now }, sent, id),
      journal(db, { opId: `${id}:in`, nonce, accountId: target.id, kind: 'receive', cash: req.amount, peer: from.id, ref: id, at: now }, sent, id),
      moveMoney(db, from.id, -req.amount, 0, out, now),
      db
        .prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1 WHERE id = ?1 AND ${ours(3, 4)}`)
        .bind(target.id, req.amount, `${id}:in`, nonce),
    ];
    const r = await run(db, stmts, () => opLanded(db, id, 'casino_transfers'));
    if (r === 'done') return { id, to: { id: target.id, name: target.name }, from: from.name, amount: req.amount, note: req.note, at: now };
    if (r === 'dup') return done();
    if (r === 'short') return short(await balanceOf(db, from.id), req.amount);
    // 'raced': something changed since the checks above; check again and say what
  }
  return BUSY;
}

// ---------------------------------------------------------------------------------------------
// What the bank shows

const SEEN_KEY = 'bank-seen';

export async function bankState(db: D1Database, secret: string, accountId: number, now: number): Promise<BankState> {
  await settleSavings(db, accountId, now);
  const { step, price } = await priceNow(db, secret, now);
  const [[acct, sav, deps, hold, seen, gain], rules, dayAgo] = await Promise.all([
    db.batch([
      db.prepare(`SELECT balance, in_play, rev, banked FROM casino_accounts WHERE id = ?1`).bind(accountId),
      db.prepare(`SELECT balance, accrued, frac, since, earned FROM casino_savings WHERE account_id = ?1`).bind(accountId),
      db
        .prepare(`SELECT * FROM casino_deposits WHERE account_id = ?1 AND (closed_at IS NULL OR closed_at > ?2) ORDER BY closed_at IS NOT NULL, opened_at DESC LIMIT 20`)
        .bind(accountId, now - DAY_MS),
      db.prepare(`SELECT units, cost FROM casino_holdings WHERE account_id = ?1 AND fund = ?2`).bind(accountId, FUND_ID),
      db.prepare(`SELECT n FROM casino_tally WHERE account_id = ?1 AND key = ?2`).bind(accountId, SEEN_KEY),
      db.prepare(`SELECT COALESCE(SUM(gain), 0) AS n FROM casino_bank WHERE account_id = ?1`).bind(accountId),
    ]),
    sendRules(db, accountId, now),
    priceDayAgo(db, step),
  ]);
  const a = (acct!.results[0] as { balance: number; in_play: number; rev: number; banked: number } | undefined) ?? { balance: 0, in_play: 0, rev: 0, banked: 0 };
  const s = sav!.results[0] as SavingsRow | undefined;
  const savings: SavingsView = s ? { ...accrue(s, now).state, earned: s.earned } : { balance: 0, accrued: 0, frac: 0, since: now, earned: 0 };
  const deposits: DepositView[] = (deps!.results as unknown as DepositRow[]).map((d) => ({
    id: d.op_id,
    term: d.term as DepositView['term'],
    principal: d.principal,
    interest: d.interest,
    openedAt: d.opened_at,
    maturesAt: d.matures_at,
    ...(d.closed_at !== null ? { closedAt: d.closed_at, paid: d.paid ?? 0 } : {}),
  }));
  const h = (hold!.results[0] as Holding | undefined) ?? { units: 0, cost: 0 };
  const value = valueOf(h.units, price);
  const locked = deposits.filter((d) => d.closedAt === undefined).reduce((sum, d) => sum + d.principal, 0);
  const inbox = await inboxOf(db, accountId, (seen!.results[0] as { n: number } | undefined)?.n ?? 0);
  const { balance: _b, ...send } = rules;
  return {
    now,
    balance: a.balance,
    inPlay: a.in_play,
    rev: a.rev,
    banked: a.banked,
    savings,
    deposits,
    fund: { id: FUND_ID, name: FUND_NAME, price, step, dayAgo: dayAgo ?? price, units: h.units, cost: h.cost, value },
    send,
    inbox,
    worth: a.balance + a.in_play + savings.balance + locked + value,
    gain: (gain!.results[0] as { n: number } | undefined)?.n ?? 0,
  };
}

async function inboxOf(db: D1Database, accountId: number, seen: number): Promise<Received[]> {
  const rows = await db
    .prepare(
      `SELECT t.op_id, t.amount, t.note, t.at, a.name FROM casino_transfers t JOIN casino_accounts a ON a.id = t.from_id
        WHERE t.to_id = ?1 AND t.at > ?2 ORDER BY t.at DESC LIMIT 20`,
    )
    .bind(accountId, seen)
    .all<{ op_id: string; amount: number; note: string | null; at: number; name: string }>();
  return rows.results.map((r) => ({ id: r.op_id, from: r.name, amount: r.amount, note: r.note, at: r.at }));
}

/** The bank on the profile: one batch, the fund at the latest price written. */
export async function bankSummary(db: D1Database, accountId: number, balance: Cents, inPlay: Cents): Promise<ProfileBank> {
  const [sav, deps, hold, price, gain] = await db.batch<{ n?: number; units?: number; cost?: number; price?: number }>([
    db.prepare(`SELECT balance AS n FROM casino_savings WHERE account_id = ?1`).bind(accountId),
    db.prepare(`SELECT COALESCE(SUM(principal), 0) AS n FROM casino_deposits WHERE account_id = ?1 AND closed_at IS NULL`).bind(accountId),
    db.prepare(`SELECT units, cost FROM casino_holdings WHERE account_id = ?1 AND fund = ?2`).bind(accountId, FUND_ID),
    db.prepare(`SELECT price FROM casino_market WHERE fund = ?1 AND step <= ?2 ORDER BY step DESC LIMIT 1`).bind(FUND_ID, stepOf(Date.now())),
    db.prepare(`SELECT COALESCE(SUM(gain), 0) AS n FROM casino_bank WHERE account_id = ?1`).bind(accountId),
  ]);
  const savings = sav!.results[0]?.n ?? 0;
  const deposits = deps!.results[0]?.n ?? 0;
  const h = hold!.results[0] ?? { units: 0, cost: 0 };
  const p = price!.results[0]?.price;
  const fundValue = p ? valueOf(h.units ?? 0, p) : (h.cost ?? 0);
  return { savings, deposits, fundCost: h.cost ?? 0, fundValue, gain: gain!.results[0]?.n ?? 0, worth: balance + inPlay + savings + deposits + fundValue };
}

// ---------------------------------------------------------------------------------------------
// The statement

const PAGE = 40;

const LINES = `
  SELECT created_at AS at, op_id AS id, 'ledger' AS src, kind, amount AS cash, 0 AS banked, 0 AS units, 0 AS gain, table_id AS ref, NULL AS peer, NULL AS note
    FROM casino_ledger WHERE account_id = ?1
  UNION ALL
  SELECT bought_at, op_id, 'item', 'item', -price, 0, 0, 0, item, NULL, NULL FROM casino_items WHERE account_id = ?1
  UNION ALL
  SELECT created_at, op_id, 'order', CASE WHEN op_id LIKE 'fx:%' THEN 'fx' ELSE 'bar' END, -price, 0, 0, 0, item, NULL, NULL FROM casino_orders WHERE account_id = ?1
  UNION ALL
  SELECT b.at, b.op_id, 'bank', b.kind, b.cash, b.saved + b.locked + b.cost, b.units, b.gain, b.ref, p.name, t.note
    FROM casino_bank b LEFT JOIN casino_accounts p ON p.id = b.peer LEFT JOIN casino_transfers t ON t.op_id = b.ref
   WHERE b.account_id = ?1`;

/** Every movement of an account's money, newest first, a page at a time, with the balance after each. */
export async function statement(db: D1Database, accountId: number, before: string | null): Promise<StatementResponse> {
  const cut = parseCursor(before);
  const [acct, rows, newer] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT balance FROM casino_accounts WHERE id = ?1`).bind(accountId),
    db
      .prepare(`SELECT * FROM (${LINES}) WHERE at < ?2 OR (at = ?2 AND id < ?3) ORDER BY at DESC, id DESC LIMIT ?4`)
      .bind(accountId, cut.at, cut.id, PAGE),
    db.prepare(`SELECT COALESCE(SUM(cash), 0) AS n FROM (${LINES}) WHERE at > ?2 OR (at = ?2 AND id >= ?3)`).bind(accountId, cut.at, cut.id),
  ]);
  let balance = ((acct!.results[0]?.balance as number | undefined) ?? 0) - (before ? ((newer!.results[0]?.n as number | undefined) ?? 0) : 0);
  const lines: StatementLine[] = [];
  for (const r of rows!.results) {
    const cash = r.cash as number;
    lines.push({
      id: r.id as string,
      at: r.at as number,
      src: r.src as StatementLine['src'],
      kind: r.kind as string,
      cash,
      banked: r.banked as number,
      ...(r.units ? { units: r.units as number } : {}),
      ...(r.gain ? { gain: r.gain as number } : {}),
      ref: (r.ref as string | null) ?? null,
      peer: (r.peer as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      balance,
    });
    balance -= cash;
  }
  const last = lines.at(-1);
  return { lines, next: lines.length === PAGE && last ? `${last.at}:${last.id}` : null };
}

function parseCursor(raw: string | null): { at: number; id: string } {
  const i = raw ? raw.indexOf(':') : -1;
  const at = i > 0 ? Number(raw!.slice(0, i)) : NaN;
  return Number.isSafeInteger(at) ? { at, id: raw!.slice(i + 1) } : { at: Number.MAX_SAFE_INTEGER, id: '' };
}

// ---------------------------------------------------------------------------------------------
// HTTP

/** A per-account clock offset on the dev stack only, so the headless checks can let a day pass. */
const CLOCK_KEY = 'bank-clock';

async function bankNow(env: Env, accountId: number): Promise<number> {
  if (env.CASINO_DEV !== '1') return Date.now();
  const row = await env.DB.prepare(`SELECT n FROM casino_tally WHERE account_id = ?1 AND key = ?2`).bind(accountId, CLOCK_KEY).first<{ n: number }>();
  return Date.now() + (row?.n ?? 0);
}

function floorOf(env: Env): DurableObjectStub<CasinoFloor> {
  const ns = env.FLOOR as unknown as DurableObjectNamespace<CasinoFloor>;
  return ns.get(ns.idFromName('main'));
}

function amountOf(x: unknown): Cents | null {
  return isCents(x) && x > 0 && x <= Number.MAX_SAFE_INTEGER / 1_000 ? x : null;
}

export async function bankApi(request: Request, env: Env, route: string, account: { id: number; name: string }, cors: Record<string, string>): Promise<Response> {
  const db = env.DB;
  const a = account.id;
  const secret = env.CASINO_TOKEN_SECRET;
  const answer = async (now: number, r: Refusal | null) =>
    r ? fail(r.status, r.code, r.msg, cors) : json({ state: await bankState(db, secret, a, now) } satisfies BankResponse, 200, cors);

  if (request.method === 'GET') {
    const now = await bankNow(env, a);
    if (route === 'bank') return json(await bankState(db, secret, a, now), 200, cors);
    if (route === 'bank/market') {
      const days = { '1d': 1, '7d': 7, '30d': 30 }[new URL(request.url).searchParams.get('range') ?? '1d'] ?? 1;
      const { step } = await priceNow(db, secret, now);
      const points = await history(db, step - days * STEPS_PER_DAY, step, days);
      return json({ fund: FUND_ID, name: FUND_NAME, points } satisfies MarketResponse, 200, cors);
    }
    if (route === 'bank/statement') return json(await statement(db, a, new URL(request.url).searchParams.get('before')), 200, cors);
    return fail(404, 'NOT_FOUND', 'Not here.', cors);
  }
  if (request.method !== 'POST') return fail(404, 'NOT_FOUND', 'Not here.', cors);

  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (route === 'dev/bank/clock') {
    if (env.CASINO_DEV !== '1') return fail(404, 'NOT_FOUND', 'Not here.', cors);
    const ms = body?.ms;
    if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 0 || ms > 400 * DAY_MS) return fail(400, 'BAD_REQUEST', 'ms: 0 to 400 days.', cors);
    await db
      .prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, ?2, ?3) ON CONFLICT (account_id, key) DO UPDATE SET n = excluded.n`)
      .bind(a, CLOCK_KEY, ms)
      .run();
    return answer(await bankNow(env, a), null);
  }
  if (route === 'bank/seen') {
    const at = body?.at;
    if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) return fail(400, 'BAD_REQUEST', 'at: a time in ms.', cors);
    await db
      .prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, ?2, ?3) ON CONFLICT (account_id, key) DO UPDATE SET n = MAX(n, excluded.n)`)
      .bind(a, SEEN_KEY, at)
      .run();
    return json({ ok: true }, 200, cors);
  }

  const op = body?.op;
  if (!isOp(op)) return fail(400, 'BAD_REQUEST', 'Every bank operation needs an operation id.', cors);

  if (route === 'bank/send') {
    if (!(await bumpRate(db, 'casino-send', `a${a}`, SEND_LIMIT, 60_000, Date.now()))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
    const amount = amountOf(body?.amount);
    const note = cleanNote(body?.note);
    if (typeof body?.to !== 'string' || body.to.length > 32) return fail(400, 'BAD_NAME', 'Send to a player by name.', cors);
    if (amount === null) return fail(400, 'BAD_REQUEST', 'An amount is whole cents.', cors);
    if (note === undefined) return fail(400, 'BAD_REQUEST', `A note is one line of up to ${SEND.noteMax} characters.`, cors);
    const now = await bankNow(env, a);
    const r = await sendMoney(db, account, op, { to: body.to, amount, note, confirm: body?.confirm === true }, now);
    if ('status' in r) return answer(now, r);
    try {
      await floorOf(env).bankNote(r.to.id, { t: 'bank.in', id: r.id, from: r.from, amount: r.amount, note: r.note, at: r.at });
    } catch (err) {
      // they see it in their statement and inbox anyway
      console.error('bank note failed', err);
    }
    return answer(now, null);
  }

  if (!(await bumpRate(db, 'casino-bank', `a${a}`, LIMIT, 60_000, Date.now()))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
  const now = await bankNow(env, a);

  if (route === 'bank/savings') {
    const amount = amountOf(body?.amount);
    const dir = body?.dir;
    if (amount === null || (dir !== 'in' && dir !== 'out')) return fail(400, 'BAD_REQUEST', 'Savings moves are in or out, in whole cents.', cors);
    return answer(now, await moveSavings(db, a, op, dir, amount, now));
  }
  if (route === 'bank/deposit') {
    const amount = amountOf(body?.amount);
    const term = termOf(body?.term);
    if (amount === null || !term) return fail(400, 'BAD_REQUEST', 'A deposit is a term and an amount in whole cents.', cors);
    if (amount < DEPOSIT_MIN) return fail(400, 'BAD_REQUEST', `Deposits start at ${formatMoney(DEPOSIT_MIN)}.`, cors);
    return answer(now, await openDeposit(db, a, op, term, amount, now));
  }
  if (route === 'bank/deposit/close') {
    const id = body?.id;
    if (typeof id !== 'string' || id.length > 80) return fail(400, 'BAD_REQUEST', 'Which deposit?', cors);
    return answer(now, await closeDeposit(db, a, op, id, now));
  }
  if (route === 'bank/fund') {
    const side = body?.side;
    if (side === 'buy') {
      const amount = amountOf(body?.amount);
      if (amount === null) return fail(400, 'BAD_REQUEST', 'An amount is whole cents.', cors);
      if (amount < FUND_MIN) return fail(400, 'BAD_REQUEST', `Buys start at ${formatMoney(FUND_MIN)}.`, cors);
      return answer(now, await buyFund(db, secret, a, op, amount, now));
    }
    if (side === 'sell') {
      if (body?.all === true) return answer(now, await sellFund(db, secret, a, op, { all: true }, now));
      const amount = amountOf(body?.amount);
      if (amount === null) return fail(400, 'BAD_REQUEST', 'An amount is whole cents.', cors);
      return answer(now, await sellFund(db, secret, a, op, { amount }, now));
    }
    return fail(400, 'BAD_REQUEST', 'Buy or sell.', cors);
  }
  return fail(404, 'NOT_FOUND', 'Not here.', cors);
}
