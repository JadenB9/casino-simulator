// The daily bonus: one claim per Las Vegas day, growing for seven days in a row and starting again
// after a missed day, paid as a 'grant' keyed daily:<account>:<day> so a second tab, a retry or a
// race can never take it twice; and every cent still accounted for.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { DAILY_AMOUNTS } from '../../shared/src/celebs.ts';
import { STARTING_BALANCE } from '../../shared/src/money.ts';
import { dayEndsAt } from '../src/daily.ts';
import { casinoDay } from '../src/floor/wins.ts';
import { api } from './helpers.ts';
import { clockAt, player, type Player } from './party.ts';

afterEach(() => {
  vi.useRealTimers();
});

const status = async (p: Player) => {
  const res = await api('daily', p.token);
  expect(res.status).toBe(200);
  return res.json<any>();
};
const claim = (p: Player) => api('daily/claim', p.token, { method: 'POST', body: '{}' });

async function balance(id: number): Promise<number> {
  return (await env.DB.prepare(`SELECT balance FROM casino_accounts WHERE id = ?1`).bind(id).first<{ balance: number }>())!.balance;
}

async function expectBalanced(id: number): Promise<void> {
  const n = async (sql: string) => (await env.DB.prepare(sql).bind(id).first<{ n: number }>())!.n;
  const ledger = await n(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`);
  const items = await n(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`);
  const orders = await n(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`);
  expect(ledger - items - orders).toBe(await balance(id));
}

/** A moment in Las Vegas: `iso` is the local wall time there, `offset` its UTC offset ('-07:00' in summer). */
const vegas = (iso: string, offset = '-07:00') => Date.parse(`${iso}${offset}`);

describe('GET /daily', () => {
  it('starts a new account at day one of seven, unclaimed', async () => {
    const p = await player('day_new');
    const s = await status(p);
    expect(s).toMatchObject({ day: casinoDay(Date.now()), streak: 0, claimed: false, next: 1, amount: DAILY_AMOUNTS[0], amounts: DAILY_AMOUNTS, met: {} });
    expect(s.resetAt).toBeGreaterThan(Date.now());
    expect(s.resetAt - Date.now()).toBeLessThanOrEqual(25 * 3_600_000);
  });

  it('needs a login', async () => {
    expect((await api('daily', 'nope')).status).toBe(401);
    expect((await api('daily/claim', 'nope', { method: 'POST' })).status).toBe(401);
  });
});

describe('POST /daily/claim', () => {
  it("pays today's bonus once, with the streak and the day kept in the tally", async () => {
    clockAt(vegas('2026-09-25T12:00:00'));
    const p = await player('day_once');
    const res = await claim(p);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body).toMatchObject({ amount: DAILY_AMOUNTS[0], streak: 1, balance: STARTING_BALANCE + DAILY_AMOUNTS[0]!, inPlay: 0 });
    expect(body.status).toMatchObject({ day: '2026-09-25', streak: 1, claimed: true, next: 2, amount: DAILY_AMOUNTS[1] });
    expect(await balance(p.id)).toBe(STARTING_BALANCE + DAILY_AMOUNTS[0]!);
    const row = await env.DB.prepare(`SELECT kind, amount, account_id FROM casino_ledger WHERE op_id = ?1`).bind(`daily:${p.id}:2026-09-25`).first<any>();
    expect(row).toEqual({ kind: 'grant', amount: DAILY_AMOUNTS[0], account_id: p.id });
    const tally = await env.DB.prepare(`SELECT key, n FROM casino_tally WHERE account_id = ?1 ORDER BY key`).bind(p.id).all<any>();
    expect(tally.results).toEqual([{ key: 'daily-last', n: 20260925 }, { key: 'daily-streak', n: 1 }]);

    // again the same day (a second tab, a retry after a lost answer): refused, nothing paid
    const again = await claim(p);
    expect(again.status).toBe(409);
    expect(await again.json<any>()).toMatchObject({ error: 'NOT_ELIGIBLE', balance: STARTING_BALANCE + DAILY_AMOUNTS[0]! });
    expect(await balance(p.id)).toBe(STARTING_BALANCE + DAILY_AMOUNTS[0]!);
    expect((await status(p)).claimed).toBe(true);
    await expectBalanced(p.id);
  });

  it('grows day after day up to the seventh, which every later day pays', async () => {
    clockAt(vegas('2026-10-01T09:30:00'));
    const p = await player('day_seven');
    let total = 0;
    for (let d = 0; d < 9; d++) {
      clockAt(vegas('2026-10-01T09:30:00') + d * 86_400_000);
      const body = await (await claim(p)).json<any>();
      const want = DAILY_AMOUNTS[Math.min(d, 6)]!;
      expect(body.streak).toBe(d + 1);
      expect(body.amount).toBe(want);
      total += want;
    }
    expect(await balance(p.id)).toBe(STARTING_BALANCE + total);
    expect((await status(p)).next).toBe(7);
    await expectBalanced(p.id);
  });

  it('a missed day starts the streak again', async () => {
    clockAt(vegas('2026-11-02T10:00:00', '-08:00'));
    const p = await player('day_miss');
    await claim(p);
    clockAt(vegas('2026-11-03T22:00:00', '-08:00'));
    expect((await (await claim(p)).json<any>()).streak).toBe(2);
    // the 4th goes by
    clockAt(vegas('2026-11-05T08:00:00', '-08:00'));
    const s = await status(p);
    expect(s).toMatchObject({ streak: 0, claimed: false, next: 1, amount: DAILY_AMOUNTS[0] });
    const body = await (await claim(p)).json<any>();
    expect(body).toMatchObject({ streak: 1, amount: DAILY_AMOUNTS[0] });
    await expectBalanced(p.id);
  });

  it('counts days in Las Vegas time, not UTC', async () => {
    // 4:30 pm in Las Vegas is 23:30 UTC; 11:30 pm the same evening is already tomorrow in UTC
    clockAt(vegas('2026-09-10T16:30:00'));
    const p = await player('day_tz');
    expect((await claim(p)).status).toBe(200);
    clockAt(vegas('2026-09-10T23:30:00'));
    expect((await claim(p)).status).toBe(409);
    // an hour later it's the 11th in Las Vegas: the streak goes on
    clockAt(vegas('2026-09-11T00:30:00'));
    const next = await (await claim(p)).json<any>();
    expect(next).toMatchObject({ streak: 2, amount: DAILY_AMOUNTS[1] });
    expect(next.status.day).toBe('2026-09-11');
    expect(await env.DB.prepare(`SELECT count(*) AS n FROM casino_ledger WHERE op_id LIKE ?1`).bind(`daily:${p.id}:%`).first<any>()).toEqual({ n: 2 });
  });

  it('carries a streak over the clocks changing, and knows when each day ends', async () => {
    // spring forward: 2027-03-14 has 23 hours in Las Vegas
    clockAt(vegas('2027-03-13T23:00:00', '-08:00'));
    const p = await player('day_dst');
    await claim(p);
    clockAt(vegas('2027-03-14T12:00:00'));
    const body = await (await claim(p)).json<any>();
    expect(body.streak).toBe(2);
    expect(body.status.resetAt).toBe(vegas('2027-03-15T00:00:00'));
    expect(dayEndsAt(vegas('2027-03-14T00:30:00', '-08:00')) - vegas('2027-03-14T00:00:00', '-08:00')).toBe(23 * 3_600_000);
    // fall back: 2026-11-01 has 25
    expect(dayEndsAt(vegas('2026-11-01T00:10:00')) - vegas('2026-11-01T00:00:00')).toBe(25 * 3_600_000);
    expect(dayEndsAt(vegas('2026-09-25T23:59:59'))).toBe(vegas('2026-09-26T00:00:00'));
  });

  it('two claims at once pay once', async () => {
    const p = await player('day_race');
    const answers = await Promise.all([claim(p), claim(p), claim(p)]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await balance(p.id)).toBe(STARTING_BALANCE + DAILY_AMOUNTS[0]!);
    await expectBalanced(p.id);
  });

  it('is rate limited', async () => {
    const p = await player('day_limit');
    let limited = false;
    for (let i = 0; i < 25 && !limited; i++) limited = (await claim(p)).status === 429;
    expect(limited).toBe(true);
  });
});
