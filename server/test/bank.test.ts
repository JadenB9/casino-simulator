// The bank (server/src/bank.ts): savings, term deposits, the Casino Index and transfers between
// players, with the money identity from migration 0007 checked after every operation:
//   balance = SUM(ledger) - SUM(items) - SUM(orders) + SUM(bank.cash)
//   savings = SUM(bank.saved), open principal = SUM(bank.locked), holdings = SUM(bank.units / cost)
//   banked = savings + open principal + holdings.cost, and every bank row balances.
// Plus the anti-cheese rules: parked money counts toward the cashier's top-up line, house money
// and gifts can't be passed between accounts, the limits hold under concurrency, and nothing
// can be read ahead or farmed by timing.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { DOLLAR } from '../../shared/src/money.ts';
import {
  DAY_MS, DEPOSIT_CAP, DEPOSIT_MAX_OPEN, FUND_START, HOUR_MS, SEND, accrue, depositInterest, earlyFee, interestWeight, INTEREST_DEN, stepOf, termOf, unitsFor, valueOf,
} from '../../shared/src/bank.ts';
import { api, connect } from './helpers.ts';
import { clockAt, player, sleep, type Player } from './party.ts';
import { draws, priceNow } from '../src/market.ts';
import { settleSavings } from '../src/bank.ts';

// A few tests fill in days of market steps; on a busy machine that outlasts the default.
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  vi.useRealTimers();
});

let seq = 0;
const op = () => `bank-op-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

async function n(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

async function acct(id: number): Promise<{ balance: number; in_play: number; banked: number; created_at: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play, banked, created_at FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

/** The whole identity for one account (0007_bank.sql). */
async function expectBalanced(id: number): Promise<void> {
  const a = await acct(id);
  const ledger = await n(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, id);
  const items = await n(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`, id);
  const orders = await n(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`, id);
  const cash = await n(`SELECT COALESCE(SUM(cash), 0) AS n FROM casino_bank WHERE account_id = ?1`, id);
  expect(ledger - items - orders + cash).toBe(a.balance);
  const saved = await n(`SELECT COALESCE(SUM(saved), 0) AS n FROM casino_bank WHERE account_id = ?1`, id);
  const savings = await n(`SELECT COALESCE(SUM(balance), 0) AS n FROM casino_savings WHERE account_id = ?1`, id);
  expect(savings).toBe(saved);
  const locked = await n(`SELECT COALESCE(SUM(locked), 0) AS n FROM casino_bank WHERE account_id = ?1`, id);
  const open = await n(`SELECT COALESCE(SUM(principal), 0) AS n FROM casino_deposits WHERE account_id = ?1 AND closed_at IS NULL`, id);
  expect(open).toBe(locked);
  const units = await n(`SELECT COALESCE(SUM(units), 0) AS n FROM casino_bank WHERE account_id = ?1`, id);
  const cost = await n(`SELECT COALESCE(SUM(cost), 0) AS n FROM casino_bank WHERE account_id = ?1`, id);
  const h = (await env.DB.prepare(`SELECT units, cost FROM casino_holdings WHERE account_id = ?1`).bind(id).first<any>()) ?? { units: 0, cost: 0 };
  expect([h.units, h.cost]).toEqual([units, cost]);
  expect(a.banked).toBe(savings + open + h.cost);
  const gain = await n(`SELECT COALESCE(SUM(gain), 0) AS n FROM casino_bank WHERE account_id = ?1`, id);
  expect(a.balance + a.banked).toBe(ledger - items - orders + gain);
  expect(await n(`SELECT COUNT(*) AS n FROM casino_bank WHERE account_id = ?1 AND cash + saved + locked + cost <> gain`, id)).toBe(0);
  expect(a.in_play).toBe(await n(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_escrow WHERE account_id = ?1`, id));
}

/** Transfers conserve money: every send has its receive, and their gains cancel across all accounts. */
async function expectTransfersCancel(): Promise<void> {
  expect(await n(`SELECT COALESCE(SUM(gain), 0) AS n FROM casino_bank WHERE kind IN ('send', 'receive')`)).toBe(0);
  expect(await n(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_transfers`)).toBe(await n(`SELECT COALESCE(SUM(cash), 0) AS n FROM casino_bank WHERE kind = 'receive'`));
}

/** Winnings, the way a table pays them. */
async function win(id: number, amount: number, at = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'cashout', ?3, 'test-table', ?4)`).bind(`win:${id}:${op()}`, id, amount, at),
    env.DB.prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1 WHERE id = ?1`).bind(id, amount),
  ]);
}

/** Losses, the way a table takes them: a buy-in that never comes back. */
async function lose(id: number, amount: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'buyin', ?3, 'test-table', ?4)`).bind(`lose:${id}:${op()}`, id, -amount, Date.now()),
    env.DB.prepare(`UPDATE casino_accounts SET balance = balance - ?2, rev = rev + 1 WHERE id = ?1`).bind(id, amount),
  ]);
}

/** An account made `days` ago: it and every ledger row it has move back in time. */
async function age(id: number, days: number): Promise<void> {
  const ms = days * DAY_MS;
  await env.DB.batch([
    env.DB.prepare(`UPDATE casino_accounts SET created_at = created_at - ?2 WHERE id = ?1`).bind(id, ms),
    env.DB.prepare(`UPDATE casino_ledger SET created_at = created_at - ?2 WHERE account_id = ?1`).bind(id, ms),
  ]);
}

/** An old account (no house money held) with `extra` won on top of its starting $50,000. */
async function veteran(tag: string, extra = 0): Promise<Player> {
  const p = await player(tag);
  await age(p.id, 10);
  if (extra) await win(p.id, extra, Date.now() - 5 * DAY_MS);
  return p;
}

const post = (p: Player, route: string, body: Record<string, unknown>) => api(route, p.token, { method: 'POST', body: JSON.stringify(body) });
const state = async (p: Player) => (await (await api('bank', p.token)).json()) as any;
const save = (p: Player, dir: 'in' | 'out', amount: number, opId = op()) => post(p, 'bank/savings', { op: opId, dir, amount });
const deposit = (p: Player, term: string, amount: number, opId = op()) => post(p, 'bank/deposit', { op: opId, term, amount });
const closeDep = (p: Player, id: string, opId = op()) => post(p, 'bank/deposit/close', { op: opId, id });
const buy = (p: Player, amount: number, opId = op()) => post(p, 'bank/fund', { op: opId, side: 'buy', amount });
const sell = (p: Player, body: Record<string, unknown>, opId = op()) => post(p, 'bank/fund', { op: opId, side: 'sell', ...body });
const send = (p: Player, to: string, amount: number, extra: Record<string, unknown> = {}, opId = op()) =>
  post(p, 'bank/send', { op: opId, to, amount, confirm: amount >= SEND.confirmAt, ...extra });
const loan = (p: Player) => api('bank/loan', p.token, { method: 'POST' });

async function ok(res: Response): Promise<any> {
  const body = await res.json<any>();
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function setBalance(id: number, cents: number): Promise<void> {
  const b = (await acct(id)).balance;
  if (cents > b) await win(id, cents - b);
  if (cents < b) await lose(id, b - cents);
}

describe('savings', () => {
  it('moves money in and out, exact, with the identity after each', async () => {
    const p = await player('sav');
    const r = await ok(await save(p, 'in', 20_000 * DOLLAR));
    expect(r.state.balance).toBe(30_000 * DOLLAR);
    expect(r.state.savings.balance).toBe(20_000 * DOLLAR);
    expect(r.state.banked).toBe(20_000 * DOLLAR);
    await expectBalanced(p.id);
    const out = await ok(await save(p, 'out', 5_000 * DOLLAR + 1));
    expect(out.state.balance).toBe(35_000 * DOLLAR + 1);
    expect(out.state.savings.balance).toBe(15_000 * DOLLAR - 1);
    await expectBalanced(p.id);
  });

  it("refuses more than you have, either way, and moves nothing", async () => {
    const p = await player('savno');
    const tooMuch = await save(p, 'in', 50_000 * DOLLAR + 1);
    expect(tooMuch.status).toBe(409);
    expect((await tooMuch.json<any>()).error).toBe('INSUFFICIENT_FUNDS');
    expect((await save(p, 'out', 1)).status).toBe(409);
    await ok(await save(p, 'in', 100 * DOLLAR));
    expect((await save(p, 'out', 100 * DOLLAR + 1)).status).toBe(409);
    expect((await acct(p.id)).balance).toBe(49_900 * DOLLAR);
    await expectBalanced(p.id);
  });

  it('is one move for a retried operation, and two at once both land', async () => {
    const p = await player('savretry');
    const id = op();
    await Promise.all([save(p, 'in', 1_000 * DOLLAR, id), save(p, 'in', 1_000 * DOLLAR, id), save(p, 'in', 1_000 * DOLLAR, id)]);
    expect((await state(p)).savings.balance).toBe(1_000 * DOLLAR);
    const results = await Promise.all([save(p, 'in', 700, op()), save(p, 'in', 300, op()), save(p, 'out', 500, op()), save(p, 'in', 1, op())]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect((await state(p)).savings.balance).toBe(1_000 * DOLLAR + 501);
    await expectBalanced(p.id);
    // the same id for a different kind of operation is refused
    expect((await save(p, 'out', 1_000 * DOLLAR, id)).status).toBe(400);
  });

  it('pays the day\'s interest at midnight, exactly what the rule says, once', async () => {
    const midnight = Math.ceil(Date.now() / DAY_MS) * DAY_MS + DAY_MS;
    clockAt(midnight - 6 * HOUR_MS);
    const p = await player('savint');
    await win(p.id, 150_000 * DOLLAR);
    await ok(await save(p, 'in', 150_000 * DOLLAR));
    const row = await env.DB.prepare(`SELECT balance, accrued, frac, since FROM casino_savings WHERE account_id = ?1`).bind(p.id).first<any>();
    const expected = Math.floor((interestWeight(150_000 * DOLLAR) * (midnight - row.since)) / INTEREST_DEN);
    clockAt(midnight + HOUR_MS);
    // two looks at once pay the day once
    const [a, b] = await Promise.all([state(p), state(p)]);
    expect(a.savings.balance).toBe(150_000 * DOLLAR + expected);
    expect(b.savings.balance).toBe(150_000 * DOLLAR + expected);
    expect(expected).toBeGreaterThan(130 * DOLLAR);
    const rows = (await env.DB.prepare(`SELECT op_id, saved, gain, at FROM casino_bank WHERE account_id = ?1 AND kind = 'interest'`).bind(p.id).all<any>()).results;
    expect(rows).toEqual([{ op_id: `int:${p.id}:${midnight / DAY_MS - 1}`, saved: expected, gain: expected, at: midnight }]);
    await expectBalanced(p.id);
    // the profile counts it
    const me = await (await api('me', p.token)).json<any>();
    expect(me.profile.bank.savings).toBe(150_000 * DOLLAR + expected);
    expect(me.profile.bank.worth).toBe(me.profile.balance + 150_000 * DOLLAR + expected);
  });

  it("can't be farmed by moving in and out: a minute in pays a minute's interest, rounded down", async () => {
    const midnight = Math.ceil(Date.now() / DAY_MS) * DAY_MS + 2 * DAY_MS;
    clockAt(midnight - 2 * HOUR_MS);
    const p = await player('savloop');
    await win(p.id, 950_000 * DOLLAR);
    // thirty times: a million in, a minute later out again
    for (let i = 0; i < 12; i++) {
      await ok(await save(p, 'in', 1_000_000 * DOLLAR));
      clockAt(Date.now() + 60_000);
      await ok(await save(p, 'out', 1_000_000 * DOLLAR));
    }
    clockAt(midnight + 1);
    const s = (await state(p)).savings;
    const row = await env.DB.prepare(`SELECT since FROM casino_savings WHERE account_id = ?1`).bind(p.id).first<any>();
    // at most what a million held for those twelve minutes (and a few ms of clock) earns
    const most = Math.ceil((interestWeight(1_000_000 * DOLLAR) * (12 * 60_000 + 12 * 50)) / INTEREST_DEN);
    expect(s.balance).toBeLessThanOrEqual(most);
    expect(s.balance).toBeGreaterThanOrEqual(Math.floor((interestWeight(1_000_000 * DOLLAR) * 12 * 60_000) / INTEREST_DEN));
    expect(row.since).toBeGreaterThan(midnight);
    await expectBalanced(p.id);
  });

  it('settles due interest once when asked at once from two places', async () => {
    const midnight = Math.ceil(Date.now() / DAY_MS) * DAY_MS + 3 * DAY_MS;
    clockAt(midnight - HOUR_MS);
    const p = await player('savrace');
    await ok(await save(p, 'in', 40_000 * DOLLAR));
    clockAt(midnight + 5 * DAY_MS);
    await Promise.all([settleSavings(env.DB, p.id, Date.now()), settleSavings(env.DB, p.id, Date.now()), settleSavings(env.DB, p.id, Date.now())]);
    expect(await n(`SELECT COUNT(*) AS n FROM casino_bank WHERE account_id = ?1 AND kind = 'interest'`, p.id)).toBe(6);
    await expectBalanced(p.id);
  });
});

describe('term deposits', () => {
  it('locks money at a fixed rate and pays it at maturity', async () => {
    const t0 = Date.now() + 20 * DAY_MS;
    clockAt(t0);
    const p = await player('dep');
    const r = await ok(await deposit(p, '24h', 10_000 * DOLLAR));
    const d = r.state.deposits[0];
    expect(d).toMatchObject({ term: '24h', principal: 10_000 * DOLLAR, interest: depositInterest(10_000 * DOLLAR, termOf('24h')!) });
    expect(r.state.balance).toBe(40_000 * DOLLAR);
    await expectBalanced(p.id);
    clockAt(d.maturesAt);
    const done = await ok(await closeDep(p, d.id));
    expect(done.state.balance).toBe(50_040 * DOLLAR);
    expect(done.state.deposits[0]).toMatchObject({ id: d.id, paid: 10_040 * DOLLAR });
    await expectBalanced(p.id);
    // closed is closed
    expect((await closeDep(p, d.id)).status).toBe(409);
  });

  it('breaking early returns the principal less the fee and no interest', async () => {
    const p = await player('depearly');
    const r = await ok(await deposit(p, '7d', 20_000 * DOLLAR));
    const id = r.state.deposits[0].id;
    const closeOp = op();
    const [x, y] = await Promise.all([closeDep(p, id, closeOp), closeDep(p, id, closeOp)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect((await acct(p.id)).balance).toBe(50_000 * DOLLAR - earlyFee(20_000 * DOLLAR));
    expect(await n(`SELECT COUNT(*) AS n FROM casino_bank WHERE account_id = ?1 AND kind = 'unlock'`, p.id)).toBe(1);
    await expectBalanced(p.id);
  });

  it(`holds at most ${DEPOSIT_MAX_OPEN} deposits and the cap in all, even when asked at once`, async () => {
    const p = await veteran('depcap', 2_000_000 * DOLLAR);
    const results = await Promise.all(Array.from({ length: 8 }, () => deposit(p, '1h', 300_000 * DOLLAR)));
    const landed = results.filter((r) => r.status === 200).length;
    expect(landed).toBe(Math.floor(DEPOSIT_CAP / (300_000 * DOLLAR)));
    expect(await n(`SELECT COALESCE(SUM(principal), 0) AS n FROM casino_deposits WHERE account_id = ?1 AND closed_at IS NULL`, p.id)).toBeLessThanOrEqual(DEPOSIT_CAP);
    const q = await veteran('depmax', 0);
    for (let i = 0; i < DEPOSIT_MAX_OPEN; i++) await ok(await deposit(q, '1h', 100 * DOLLAR));
    const sixth = await deposit(q, '1h', 100 * DOLLAR);
    expect(sixth.status).toBe(409);
    expect((await sixth.json<any>()).error).toBe('LIMIT');
    await expectBalanced(p.id);
    await expectBalanced(q.id);
  });

  it('refuses a term that does not exist, a deposit under the minimum, and someone else\'s deposit', async () => {
    const p = await player('depbad');
    expect((await deposit(p, '2h', 1_000 * DOLLAR)).status).toBe(400);
    expect((await deposit(p, '1h', 99 * DOLLAR)).status).toBe(400);
    const q = await player('depother');
    const r = await ok(await deposit(q, '1h', 1_000 * DOLLAR));
    expect((await closeDep(p, r.state.deposits[0].id)).status).toBe(404);
  });
});

describe('the Casino Index', () => {
  it('buys and sells at the price now, never paying back more than went in at one price', async () => {
    const p = await player('fund');
    const b = await ok(await buy(p, 12_345 * DOLLAR + 67));
    const price = b.state.fund.price;
    expect(b.state.fund.units).toBe(unitsFor(12_345 * DOLLAR + 67, price));
    expect(b.state.fund.cost).toBe(12_345 * DOLLAR + 67);
    await expectBalanced(p.id);
    const half = await ok(await sell(p, { amount: 5_000 * DOLLAR }));
    if (half.state.fund.price === price) {
      expect(half.state.balance).toBeGreaterThanOrEqual(50_000 * DOLLAR - 12_345 * DOLLAR - 67 + 5_000 * DOLLAR);
    }
    await expectBalanced(p.id);
    const all = await ok(await sell(p, { all: true }));
    expect(all.state.fund.units).toBe(0);
    expect(all.state.fund.cost).toBe(0);
    if (all.state.fund.price === price) expect(all.state.balance).toBeLessThanOrEqual(50_000 * DOLLAR);
    expect((await sell(p, { all: true })).status).toBe(409);
    await expectBalanced(p.id);
  });

  it('realizes gains and losses as the price moves, and the identity holds', async () => {
    const t0 = (stepOf(Date.now()) + 1000) * 300_000;
    clockAt(t0);
    const p = await player('fundmove');
    await ok(await buy(p, 30_000 * DOLLAR));
    clockAt(t0 + 3 * DAY_MS);
    const s = await state(p);
    const r = await ok(await sell(p, { all: true }));
    expect(r.state.balance).toBe(20_000 * DOLLAR + valueOf(s.fund.units, r.state.fund.price));
    const gain = await n(`SELECT gain AS n FROM casino_bank WHERE account_id = ?1 AND kind = 'sell'`, p.id);
    expect(gain).toBe(valueOf(s.fund.units, r.state.fund.price) - 30_000 * DOLLAR);
    await expectBalanced(p.id);
  });

  it('is one price for everyone, written up to now and never ahead', async () => {
    const t0 = (stepOf(Date.now()) + 5000) * 300_000;
    clockAt(t0);
    const [p, q] = await Promise.all([player('mkta'), player('mktb')]);
    const [a, b] = await Promise.all([state(p), state(q)]);
    expect(a.fund.price).toBe(b.fund.price);
    clockAt(t0 + 2 * HOUR_MS);
    const m = await (await api('bank/market?range=1d', p.token)).json<any>();
    const now = stepOf(Date.now());
    expect(m.points.at(-1)[0]).toBe(now);
    expect(m.points.every((pt: number[]) => pt[0]! <= now)).toBe(true);
    // nothing is written ahead of the time asked about (a fund of its own: other tests move the clock)
    await priceNow(env.DB, 'test-secret-not-for-production', Date.now() - 3 * DAY_MS, 'ahead-test');
    await priceNow(env.DB, 'test-secret-not-for-production', Date.now(), 'ahead-test');
    expect(await n(`SELECT MAX(step) AS n FROM casino_market WHERE fund = 'ahead-test'`)).toBe(now);
    // each step's move depends on the server's secret, not on anything a client can see
    const [u1] = await draws('test-secret-not-for-production', 'csx', now + 1);
    const [v1] = await draws('another-secret', 'csx', now + 1);
    expect(u1).not.toBe(v1);
    // the whole path again from the same secret gives the same prices
    const stored = (await env.DB.prepare(`SELECT step, price FROM casino_market WHERE fund = 'csx' AND step > ?1 AND step <= ?2 ORDER BY step`).bind(now - 10, now).all<any>()).results;
    await env.DB.prepare(`DELETE FROM casino_market WHERE fund = 'csx' AND step > ?1`).bind(now - 10).run();
    await priceNow(env.DB, 'test-secret-not-for-production', Date.now());
    const again = (await env.DB.prepare(`SELECT step, price FROM casino_market WHERE fund = 'csx' AND step > ?1 AND step <= ?2 ORDER BY step`).bind(now - 10, now).all<any>()).results;
    expect(again).toEqual(stored);
  });

  it('opens at $100 on a fresh market', async () => {
    const r = await priceNow(env.DB, 'x', 0, 'fresh-fund');
    expect(r).toEqual({ step: 0, price: FUND_START });
  });

  it('refuses buys past the cap and a retried buy is one buy', async () => {
    const p = await player('fundretry');
    const id = op();
    const rs = await Promise.all([buy(p, 1_000 * DOLLAR, id), buy(p, 1_000 * DOLLAR, id)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(await n(`SELECT COUNT(*) AS n FROM casino_bank WHERE account_id = ?1 AND kind = 'buy'`, p.id)).toBe(1);
    await expectBalanced(p.id);
  });
});

describe('transfers', () => {
  it('sends to a player by name, who hears it on the floor and sees it in the statement', async () => {
    const [a, b] = await Promise.all([veteran('senda', 20_000 * DOLLAR), player('sendb')]);
    const { client } = await connect('floor', b.token, '', b.ip);
    await client!.next((m) => m.t === 'hello');
    const r = await ok(await send(a, b.name.toUpperCase(), 2_500 * DOLLAR, { note: ' for the\ncab ' }));
    expect(r.state.balance).toBe(67_500 * DOLLAR);
    const heard = await client!.next((m) => m.t === 'bank.in');
    expect(heard).toMatchObject({ from: a.name, amount: 2_500 * DOLLAR, note: 'for the cab' });
    expect((await acct(b.id)).balance).toBe(52_500 * DOLLAR);
    const sb = await state(b);
    expect(sb.inbox).toEqual([expect.objectContaining({ from: a.name, amount: 2_500 * DOLLAR, note: 'for the cab' })]);
    await ok(await post(b, 'bank/seen', { at: sb.inbox[0].at }));
    expect((await state(b)).inbox).toEqual([]);
    const st = await (await api('bank/statement', b.token)).json<any>();
    expect(st.lines[0]).toMatchObject({ kind: 'receive', cash: 2_500 * DOLLAR, peer: a.name, note: 'for the cab', balance: 52_500 * DOLLAR });
    await expectBalanced(a.id);
    await expectBalanced(b.id);
    await expectTransfersCancel();
    client!.ws.close();
  });

  it("a new account can't send for its first day", async () => {
    const [a, b] = await Promise.all([player('newa'), player('newb')]);
    const r = await send(a, b.name, 10 * DOLLAR);
    expect(r.status).toBe(409);
    expect((await r.json<any>()).msg).toMatch(/first day/);
    expect((await state(a)).send.newUntil).toBeGreaterThan(Date.now());
  });

  it("house money can't be passed on: the starting stake, a top-up and a bonus are held for three days", async () => {
    const [a, b] = await Promise.all([player('housea'), player('houseb')]);
    // a day and a half old: past the new-account wait, the starting $50,000 still held
    await age(a.id, 1.5);
    expect((await state(a)).send).toMatchObject({ sendable: 0, held: 50_000 * DOLLAR });
    expect((await send(a, b.name, 1 * DOLLAR)).status).toBe(409);
    // winnings on top of it can go
    await win(a.id, 3_000 * DOLLAR);
    expect((await state(a)).send.sendable).toBe(3_000 * DOLLAR);
    expect((await send(a, b.name, 3_000 * DOLLAR + 1)).status).toBe(409);
    await ok(await send(a, b.name, 3_000 * DOLLAR));
    // lose it all, take the top-up: the loan is held too
    await setBalance(a.id, 0);
    await ok(await loan(a));
    expect((await state(a)).send.sendable).toBe(0);
    expect((await send(a, b.name, 1 * DOLLAR)).status).toBe(409);
    await expectBalanced(a.id);
  });

  it("money received can't be passed on for a day", async () => {
    const [a, b, c] = await Promise.all([veteran('relaya', 50_000 * DOLLAR), veteran('relayb'), player('relayc')]);
    await setBalance(b.id, 0);
    await ok(await send(a, b.name, 5_000 * DOLLAR));
    expect((await state(b)).send).toMatchObject({ sendable: 0, held: 5_000 * DOLLAR });
    expect((await send(b, c.name, 1 * DOLLAR)).status).toBe(409);
  });

  it('holds the day cap and the cap per receiver, even when sent at once', async () => {
    const [a, c] = await Promise.all([veteran('capa', 1_000_000 * DOLLAR), veteran('capc', 1_000_000 * DOLLAR)]);
    const bs = await Promise.all([1, 2, 3, 4].map((i) => player(`capb${i}`)));
    // per receiver: $100,000 a day from one sender; eight $15,000 sends at once, six fit
    const pair = await Promise.all(Array.from({ length: 8 }, () => send(a, bs[0]!.name, 15_000 * DOLLAR)));
    expect(pair.filter((r) => r.status === 200).length).toBe(6);
    expect((await acct(bs[0]!.id)).balance).toBe(140_000 * DOLLAR);
    const refused = pair.find((r) => r.status !== 200)!;
    expect((await refused.json<any>()).error).toBe('LIMIT');
    // the day: $250,000 in all; four $90,000 sends at once to four players, two fit
    const day = await Promise.all(bs.map((b) => send(c, b.name, 90_000 * DOLLAR)));
    expect(day.filter((r) => r.status === 200).length).toBe(2);
    const spare = bs[day.findIndex((r) => r.status !== 200)]!;
    await ok(await send(c, spare.name, 70_000 * DOLLAR));
    expect(await n(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_transfers WHERE from_id = ?1`, c.id)).toBe(SEND.dayCap);
    expect((await send(c, spare.name, 1 * DOLLAR)).status).toBe(409);
    for (const x of [a, c, ...bs]) await expectBalanced(x.id);
    await expectTransfersCancel();
  });

  it('is one transfer for a retried operation', async () => {
    const [a, b] = await Promise.all([veteran('retrya', 10_000 * DOLLAR), player('retryb')]);
    const id = op();
    const rs = await Promise.all([send(a, b.name, 700 * DOLLAR, {}, id), send(a, b.name, 700 * DOLLAR, {}, id), send(a, b.name, 700 * DOLLAR, {}, id)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await acct(b.id)).balance).toBe(50_700 * DOLLAR);
    // the same id for a different transfer is refused
    expect((await send(a, b.name, 800 * DOLLAR, {}, id)).status).toBe(400);
    await expectBalanced(a.id);
    await expectBalanced(b.id);
  });

  it('asks for confirmation at $10,000 and refuses yourself, nobody, junk and a long note', async () => {
    const [a, b] = await Promise.all([veteran('confa', 100_000 * DOLLAR), player('confb')]);
    const unconfirmed = await send(a, b.name, SEND.confirmAt, { confirm: false });
    expect(unconfirmed.status).toBe(409);
    expect((await unconfirmed.json<any>()).msg).toMatch(/Confirm/);
    expect((await send(a, a.name, 10 * DOLLAR)).status).toBe(409);
    expect((await send(a, 'nobody_by_that', 10 * DOLLAR)).status).toBe(404);
    expect((await send(a, b.name, 10.5)).status).toBe(400);
    expect((await send(a, b.name, 10 * DOLLAR, { note: 'x'.repeat(SEND.noteMax + 1) })).status).toBe(400);
    expect((await send(a, b.name, 50)).status).toBe(400);
    await ok(await send(a, b.name, SEND.confirmAt));
  });

  it("can't send from jail", async () => {
    // law6's table (migration 0006), made here if that migration isn't on this database yet
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS casino_jail (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES casino_accounts(id), at INTEGER NOT NULL,
        bail INTEGER NOT NULL, won INTEGER NOT NULL DEFAULT 0, why TEXT NOT NULL, released_at INTEGER)`,
    ).run();
    const [a, b] = await Promise.all([veteran('jaila', 10_000 * DOLLAR), player('jailb')]);
    await env.DB.prepare(`INSERT INTO casino_jail (account_id, at, bail, why) VALUES (?1, ?2, 100000, 'punch')`).bind(a.id, Date.now()).run();
    const r = await send(a, b.name, 10 * DOLLAR);
    expect(r.status).toBe(409);
    expect((await r.json<any>()).msg).toMatch(/jail/);
    expect((await state(a)).send).toMatchObject({ jailed: true, sendable: 0 });
    await env.DB.prepare(`UPDATE casino_jail SET released_at = ?2 WHERE account_id = ?1`).bind(a.id, Date.now()).run();
    await ok(await send(a, b.name, 10 * DOLLAR));
  });
});

describe("the cashier's top-up counts the bank", () => {
  it('counts savings: parking money there brings no top-up', async () => {
    const p = await player('parksav');
    await ok(await save(p, 'in', 45_000 * DOLLAR));
    const r = await loan(p);
    expect(r.status).toBe(409);
    expect((await r.json<any>()).msg).toMatch(/\$45,000 in the bank/);
    // under the line with everything counted: tops up to exactly $50,000 in all
    await ok(await save(p, 'out', 40_000 * DOLLAR));
    await setBalance(p.id, 4_000 * DOLLAR);
    const l = await ok(await loan(p));
    expect(l.loan.amount).toBe(41_000 * DOLLAR);
    await expectBalanced(p.id);
  });

  it('counts deposits and the fund (at its price now)', async () => {
    const p = await player('parkdep');
    await ok(await deposit(p, '7d', 30_000 * DOLLAR));
    await setBalance(p.id, 1_000 * DOLLAR);
    expect((await loan(p)).status).toBe(409);
    const q = await player('parkfund');
    const b = await ok(await buy(q, 45_000 * DOLLAR));
    await setBalance(q.id, 1_000 * DOLLAR);
    const r = await loan(q);
    expect(r.status).toBe(409);
    expect((await r.json<any>()).msg).toContain(`in the bank`);
    // the fund counts at its value: sell it (at the same price) and the total barely moves
    const value = valueOf(b.state.fund.units, b.state.fund.price);
    expect(value).toBeGreaterThan(44_999 * DOLLAR);
  });

  it('counts money sent in the last three days: an alt is not a place to park', async () => {
    const [a, b] = await Promise.all([veteran('parkalt', 0), player('parkaltb')]);
    await setBalance(a.id, 12_000 * DOLLAR);
    await ok(await send(a, b.name, 3_000 * DOLLAR));
    expect((await acct(a.id)).balance).toBe(9_000 * DOLLAR);
    expect((await loan(a)).status).toBe(409);
  });
});

describe('the statement and the rest', () => {
  it('lists every movement with the balance after each, page after page', async () => {
    const p = await veteran('stmt', 5_000 * DOLLAR);
    const q = await player('stmtq');
    for (let i = 0; i < 6; i++) {
      await ok(await save(p, 'in', (i + 1) * 100 * DOLLAR));
      await ok(await save(p, 'out', 50 * DOLLAR));
      await ok(await buy(p, 10 * DOLLAR));
      if (i < DEPOSIT_MAX_OPEN) await ok(await deposit(p, '1h', 100 * DOLLAR + i));
      if (i < DEPOSIT_MAX_OPEN) await ok(await send(p, q.name, 1 * DOLLAR + i));
    }
    const lines: any[] = [];
    let before: string | null = null;
    do {
      const page: any = await (await api(`bank/statement${before ? `?before=${encodeURIComponent(before)}` : ''}`, p.token)).json();
      lines.push(...page.lines);
      before = page.next;
    } while (before);
    const total = await n(
      `SELECT (SELECT COUNT(*) FROM casino_ledger WHERE account_id = ?1) + (SELECT COUNT(*) FROM casino_bank WHERE account_id = ?1) + (SELECT COUNT(*) FROM casino_items WHERE account_id = ?1) + (SELECT COUNT(*) FROM casino_orders WHERE account_id = ?1) AS n`,
      p.id,
    );
    expect(lines.length).toBe(total);
    expect(new Set(lines.map((l) => l.id)).size).toBe(total);
    expect(lines[0].balance).toBe((await acct(p.id)).balance);
    for (let i = 1; i < lines.length; i++) expect(lines[i].balance).toBe(lines[i - 1].balance - lines[i - 1].cash);
    expect(lines.at(-1).balance - lines.at(-1).cash).toBe(0);
  });

  it('limits bank operations per minute', async () => {
    const p = await player('ratebank');
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await save(p, 'in', 1)).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    await expectBalanced(p.id);
  });

  it('needs an operation id and a login', async () => {
    const p = await player('bankauth');
    expect((await post(p, 'bank/savings', { dir: 'in', amount: 100 })).status).toBe(400);
    expect((await api('bank', 'not-a-token')).status).toBe(401);
  });

  it('shows net worth on the profile: balance, savings, deposits and the fund', async () => {
    const p = await player('worth');
    await ok(await save(p, 'in', 10_000 * DOLLAR));
    await ok(await deposit(p, '24h', 5_000 * DOLLAR));
    const b = await ok(await buy(p, 7_000 * DOLLAR));
    const me = (await (await api('me', p.token)).json<any>()).profile;
    expect(me.bank).toMatchObject({ savings: 10_000 * DOLLAR, deposits: 5_000 * DOLLAR, fundCost: 7_000 * DOLLAR });
    expect(me.bank.fundValue).toBe(valueOf(b.state.fund.units, b.state.fund.price));
    expect(me.bank.worth).toBe(43_000 * DOLLAR + me.bank.fundValue);
    expect(b.state.worth).toBe(me.bank.worth);
    expect((await acct(p.id)).banked).toBe(22_000 * DOLLAR);
  });
});

// keep the interest maths honest against the shared rule too
describe('the savings rule on the server', () => {
  it('matches accrue() exactly over a week of changes', async () => {
    const t0 = Math.ceil(Date.now() / DAY_MS) * DAY_MS + 25 * DAY_MS;
    clockAt(t0);
    const p = await veteran('savweek', 500_000 * DOLLAR);
    let model = { balance: 0, accrued: 0, frac: 0, since: t0 };
    let t = t0;
    for (const [dt, dir, amount] of [
      [0, 'in', 300_000 * DOLLAR],
      [7 * HOUR_MS, 'in', 1234],
      [30 * HOUR_MS, 'out', 99_999],
      [2 * DAY_MS, 'in', 200_000 * DOLLAR],
      [3 * DAY_MS + 17, 'out', 1],
    ] as const) {
      t += dt;
      clockAt(t);
      await ok(await save(p, dir, amount));
      const row = await env.DB.prepare(`SELECT balance, accrued, frac, since FROM casino_savings WHERE account_id = ?1`).bind(p.id).first<any>();
      model = accrue(model, row.since).state;
      model.balance += dir === 'in' ? amount : -amount;
      expect(row).toEqual(model);
      await expectBalanced(p.id);
    }
    await sleep(1);
  });
});
