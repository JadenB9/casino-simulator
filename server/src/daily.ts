// The daily bonus: GET /daily (where your streak stands) and POST /daily/claim. One claim per
// Las Vegas day, growing for seven days in a row (shared/src/celebs.ts DAILY_AMOUNTS); a missed
// day starts the streak again. The streak lives in casino_tally ('daily-streak', and 'daily-last',
// the last day claimed as 20260925).
//
// Also the grant every retention payment goes through (a celebrity's tip, a gift box, the daily
// bonus): a 'grant' row in the ledger and the balance change in one D1 batch, with any tally rows
// beside them. The op id is the payment's own key, so a retry, a second tab or a race collides on
// the ledger's primary key, rolls the whole batch back, and is answered with the payment that
// already landed. The money identity holds throughout:
//   SUM(casino_ledger.amount) - SUM(casino_items.price) - SUM(casino_orders.price) = balance (+ in_play).

import type { Cents } from '../../shared/src/money.ts';
import { CELEB_IDS, DAILY_AMOUNTS, dailyAmount, dailyState, dayNumber, numberDay, streakAfterClaim, type CelebId, type DailyClaimResponse, type DailyStatus } from '../../shared/src/celebs.ts';
import { bumpRate } from './db.ts';
import { casinoDay } from './floor/wins.ts';
import { fail, json } from './http.ts';

/** Claims (and refused claims) per account per minute. */
const CLAIM_LIMIT = 20;

export interface Money {
  balance: Cents;
  inPlay: Cents;
  rev: number;
}

export type GrantOutcome = ({ kind: 'paid' } & Money) | { kind: 'dup'; accountId: number; amount: Cents };

/** A tally row set to `n`, or (add) moved by it: for the grant's batch. */
export function tallyStatement(db: D1Database, accountId: number, key: string, n: number, mode: 'set' | 'add'): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO casino_tally (account_id, key, n) VALUES (?1, ?2, ?3)
       ON CONFLICT (account_id, key) DO UPDATE SET n = ${mode === 'add' ? 'n + excluded.n' : 'excluded.n'}`,
    )
    .bind(accountId, key, n);
}

/**
 * Pay `amount` to an account as a grant keyed `opId`, with `extra` statements in the same batch.
 * 'dup' means that op id has already been paid (to whichever account it names).
 */
export async function grant(db: D1Database, op: { opId: string; accountId: number; amount: Cents; now: number; extra?: D1PreparedStatement[] }): Promise<GrantOutcome> {
  if (!Number.isSafeInteger(op.amount) || op.amount <= 0) throw new Error('grant: amount must be positive whole cents');
  try {
    const results = await db.batch<{ balance: number; in_play: number; rev: number }>([
      db
        .prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'grant', ?3, NULL, ?4)`)
        .bind(op.opId, op.accountId, op.amount, op.now),
      db
        .prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1, last_seen = ?3 WHERE id = ?1 RETURNING balance, in_play, rev`)
        .bind(op.accountId, op.amount, op.now),
      ...(op.extra ?? []),
    ]);
    const m = results[1]?.results?.[0];
    // No account row: the foreign key would already have failed the ledger insert.
    if (!m) throw new Error('grant: account not found');
    return { kind: 'paid', balance: m.balance, inPlay: m.in_play, rev: m.rev };
  } catch (err) {
    const landed = await db
      .prepare(`SELECT account_id, amount FROM casino_ledger WHERE op_id = ?1`)
      .bind(op.opId)
      .first<{ account_id: number; amount: number }>();
    if (landed) return { kind: 'dup', accountId: landed.account_id, amount: landed.amount };
    throw err;
  }
}

async function moneyOf(db: D1Database, accountId: number): Promise<Money> {
  const m = await db.prepare(`SELECT balance, in_play, rev FROM casino_accounts WHERE id = ?1`).bind(accountId).first<{ balance: number; in_play: number; rev: number }>();
  return { balance: m?.balance ?? 0, inPlay: m?.in_play ?? 0, rev: m?.rev ?? 0 };
}

/** When the casino's day that `now` falls in ends (ms): the next midnight in Las Vegas. */
export function dayEndsAt(now: number): number {
  const day = casinoDay(now);
  // an hour at a time until the date turns (a day is 23 to 25 hours), then halve down to the ms
  let lo = now;
  let hi = now + 3_600_000;
  while (casinoDay(hi) === day) {
    lo = hi;
    hi += 3_600_000;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (casinoDay(mid) === day) lo = mid;
    else hi = mid;
  }
  return hi;
}

interface Tally {
  last: string | null;
  streak: number;
  met: Partial<Record<CelebId, number>>;
}

async function tallyOf(db: D1Database, accountId: number): Promise<Tally> {
  const rows = await db
    .prepare(`SELECT key, n FROM casino_tally WHERE account_id = ?1 AND (key IN ('daily-streak', 'daily-last') OR key LIKE 'celeb:%')`)
    .bind(accountId)
    .all<{ key: string; n: number }>();
  const t: Tally = { last: null, streak: 0, met: {} };
  for (const r of rows.results) {
    if (r.key === 'daily-last') t.last = numberDay(r.n);
    else if (r.key === 'daily-streak') t.streak = r.n;
    else {
      const id = r.key.slice('celeb:'.length) as CelebId;
      if ((CELEB_IDS as readonly string[]).includes(id) && r.n > 0) t.met[id] = r.n;
    }
  }
  return t;
}

function statusFrom(t: Tally, now: number): DailyStatus {
  const day = casinoDay(now);
  const s = dailyState(t.last, t.streak, day);
  return { day, streak: s.streak, claimed: s.claimed, next: s.next, amount: dailyAmount(s.next), amounts: DAILY_AMOUNTS, resetAt: dayEndsAt(now), met: t.met };
}

export async function dailyStatus(db: D1Database, accountId: number, now: number): Promise<DailyStatus> {
  return statusFrom(await tallyOf(db, accountId), now);
}

export type ClaimOutcome = { kind: 'claimed'; amount: Cents; streak: number; money: Money; status: DailyStatus } | { kind: 'already'; status: DailyStatus };

/** Take today's bonus: the grant, the streak and the day it was taken, together. */
export async function claimDaily(db: D1Database, accountId: number, now: number): Promise<ClaimOutcome> {
  const today = casinoDay(now);
  const t = await tallyOf(db, accountId);
  const streak = streakAfterClaim(t.last, t.streak, today);
  if (streak === null) return { kind: 'already', status: statusFrom(t, now) };
  const amount = dailyAmount(streak);
  const paid = await grant(db, {
    opId: `daily:${accountId}:${today}`,
    accountId,
    amount,
    now,
    extra: [tallyStatement(db, accountId, 'daily-streak', streak, 'set'), tallyStatement(db, accountId, 'daily-last', dayNumber(today), 'set')],
  });
  // a second tab (or a retry) got there first: today's bonus is already in
  if (paid.kind === 'dup') return { kind: 'already', status: await dailyStatus(db, accountId, now) };
  const status = statusFrom({ ...t, last: today, streak }, now);
  return { kind: 'claimed', amount, streak, money: { balance: paid.balance, inPlay: paid.inPlay, rev: paid.rev }, status };
}

export async function dailyApi(request: Request, env: Env, route: string, accountId: number, cors: Record<string, string>): Promise<Response> {
  const now = Date.now();
  if (route === 'daily' && request.method === 'GET') return json((await dailyStatus(env.DB, accountId, now)) satisfies DailyStatus, 200, cors);
  if (route === 'daily/claim' && request.method === 'POST') {
    if (!(await bumpRate(env.DB, 'casino-daily', `a${accountId}`, CLAIM_LIMIT, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
    const r = await claimDaily(env.DB, accountId, now);
    if (r.kind === 'already') {
      const m = await moneyOf(env.DB, accountId);
      return fail(409, 'NOT_ELIGIBLE', "You've had today's bonus. Come back tomorrow.", cors, { balance: m.balance, inPlay: m.inPlay });
    }
    return json({ amount: r.amount, streak: r.streak, ...r.money, status: r.status } satisfies DailyClaimResponse, 200, cors);
  }
  return fail(404, 'NOT_FOUND', 'Not here.', cors);
}
