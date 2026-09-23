// Big wins: which rounds count, what the floor says about them and when, its rate limits, the
// history a newcomer is shown, and the whole path from a table's round to a floor socket.
// The floor object is shared with other files' tests, so every limit check here runs at its own
// point in (fake) time, well clear of the others.

import { describe, it, expect } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import type { CasinoFloor } from '../src/floor/index.ts';
import type { CasinoTable } from '../src/table/host.ts';
import {
  ACCOUNT_GAP_MS,
  BIG_AMOUNT,
  FLOOR_MAX,
  FLOOR_WINDOW_MS,
  HISTORY,
  bigWinsIn,
  casinoDay,
  describeWin,
  isBigWin,
  revealAt,
  type BigWinReport,
} from '../src/floor/wins.ts';
import type { GameEvent, Step } from '../../shared/src/engine.ts';
import { ORIGIN, connect, type Client } from './helpers.ts';

function floor(): DurableObjectStub<CasinoFloor> {
  return env.FLOOR.get(env.FLOOR.idFromName('main'));
}

let ipSeq = 0;
async function arrive(name: string): Promise<{ id: number; token: string }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `198.51.100.${++ipSeq}` },
      body: JSON.stringify({ name }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { id: body.profile.id, token: body.token };
}

let accountSeq = 7_000_000;
function report(over: Partial<BigWinReport> = {}): BigWinReport {
  return { accountId: ++accountSeq, name: 'lucky_one', game: 'roulette', wagered: 1_000, amount: 35_000, what: 'Straight 17', at: 0, station: 'rl-us', ...over };
}

/** Report through the floor's own storage at a chosen time. */
const reportAt = (r: BigWinReport, now: number) => runInDurableObject(floor(), (f) => f.wins.report({ ...r, at: r.at || now }, now));

const step = (events: GameEvent[], rounds: Step<unknown>['rounds']): Step<unknown> => ({ state: null, events, rounds });
const seat0 = (seat: number) => (seat === 0 ? { accountId: 42, name: 'winner', station: 'rl-us' } : undefined);

describe('what counts as a big win', () => {
  it('25 times the stake with $100 or more won, or $5,000 won at any odds', () => {
    // 25x on a $10 bet: $240 won
    expect(isBigWin(1_000, 25_000)).toBe(true);
    // a hair under 25x
    expect(isBigWin(1_000, 24_999)).toBe(false);
    // 25x on a $1 bet is only $24: not news
    expect(isBigWin(100, 2_500)).toBe(false);
    // exactly $100 won at 26x counts
    expect(isBigWin(400, 10_400)).toBe(true);
    // $5,000 won at even money
    expect(isBigWin(BIG_AMOUNT, 2 * BIG_AMOUNT)).toBe(true);
    // a cent short of $5,000 at even money
    expect(isBigWin(BIG_AMOUNT - 1, 2 * BIG_AMOUNT - 2)).toBe(false);
    // pushes and losses never, whatever the size
    expect(isBigWin(1_000_000, 1_000_000)).toBe(false);
    expect(isBigWin(1_000_000, 0)).toBe(false);
    // nothing staked but $5,000 paid still counts; nothing staked and a little paid doesn't
    expect(isBigWin(0, BIG_AMOUNT)).toBe(true);
    expect(isBigWin(0, 20_000)).toBe(false);
    // junk
    expect(isBigWin(-5, 100_000_000)).toBe(false);
    expect(isBigWin(1.5, 100)).toBe(false);
  });

  it('a step reports only the seats that won big, with the net win and who they are', () => {
    const s = step([], [
      { seat: 0, wagered: 1_000, returned: 36_000 },
      { seat: 1, wagered: 1_000, returned: 36_000 },
      { seat: 2, wagered: 1_000, returned: 2_000 },
    ]);
    const who = (seat: number) => (seat === 2 ? { accountId: 3, name: 'modest', station: null } : seat0(seat));
    const out = bigWinsIn('highcard', '', s, who, 1_000);
    // seat 1 has nobody at it (a bot, or gone): skipped; seat 2 only doubled
    expect(out).toEqual([{ accountId: 42, name: 'winner', game: 'highcard', wagered: 1_000, amount: 35_000, what: '36x', at: 2_500, station: 'rl-us' }]);
  });
});

describe('what the floor says about a win, and when', () => {
  it('roulette names the bet that paid and waits for the ball', () => {
    const restAt = 50_000;
    const events: GameEvent[] = [
      { type: 'spin', round: 3, pocket: 17, launchAt: 40_000, restAt },
      { type: 'settle', round: 3, pocket: 17, seats: { 0: { wagered: 1_100, returned: 36_000, bets: [['red', 100, 0], ['straight:17', 1_000, 36_000]] } } },
    ];
    expect(describeWin('roulette', 'american', events, 0, 1_100, 36_000)).toBe('Straight 17');
    // bets are settled the moment the ball is launched; the news waits until it lands
    expect(revealAt('roulette', events, 40_000)).toBe(restAt + 1_500);
  });

  it('slots name the machine, the free games and the multiple, and wait for the free games too', () => {
    const events: GameEvent[] = [
      { type: 'spin', seat: 0 },
      { type: 'reels', spin: 0, freeLeft: 2 },
      { type: 'reels', spin: 1, freeLeft: 1 },
      { type: 'reels', spin: 2, freeLeft: 0 },
      { type: 'result', seat: 0 },
    ];
    expect(describeWin('slots', 'neon', events, 0, 500, 50_000)).toBe('Neon Nights, free games 100x');
    expect(describeWin('slots', 'sevens', [{ type: 'reels', spin: 0 }], 0, 300, 30_000)).toBe('Classic Sevens, 100x');
    expect(revealAt('slots', events, 10_000)).toBe(10_000 + 3_200 + 2 * 2_400);
  });

  it('every game has words for its win', () => {
    expect(describeWin('videopoker', '', [{ type: 'result', seat: 0, name: 'Royal Flush' }], 0, 500, 400_000)).toBe('Royal Flush');
    expect(describeWin('bigsix', '', [{ type: 'settle', seats: { 0: { bets: [['star', 1_000, 41_000]] } } }], 0, 1_000, 41_000)).toBe('Star, 40 to 1');
    expect(describeWin('sicbo', '', [{ type: 'settle', seats: { 0: { bets: [['triple:5', 1_000, 181_000]] } } }], 0, 1_000, 181_000)).toMatch(/^Triple 5/);
    expect(describeWin('craps', '', [{ type: 'result', seat: 0, id: 'pass', win: 1_000 }, { type: 'result', seat: 0, id: 'hard8', win: 90_000 }], 0, 11_000, 111_000)).toBe('Hard 8');
    expect(describeWin('craps', '', [{ type: 'result', seat: 0, id: 'boxcars', win: 300_000 }], 0, 10_000, 310_000)).toBe('Boxcars');
    expect(describeWin('baccarat', '', [{ type: 'result', seat: 0, spots: { banker: { returned: 0 }, tie: { returned: 90_000 } } }], 0, 20_000, 90_000)).toBe('Tie wins');
    expect(describeWin('blackjack', '', [{ type: 'result', seat: 0, hand: 0, outcome: 'blackjack' }], 0, 400_000, 1_000_000)).toBe('Blackjack');
    expect(describeWin('blackjack', '', [{ type: 'result', seat: 0, hand: 0, outcome: 'win' }, { type: 'result', seat: 0, hand: 1, outcome: 'win' }], 0, 600_000, 1_200_000)).toBe('2 hands won');
    expect(describeWin('blackjack', '', [{ type: 'dealer', bust: true }, { type: 'result', seat: 0, hand: 0, outcome: 'win' }], 0, 500_000, 1_000_000)).toBe('Dealer busts');
    expect(describeWin('war', '', [{ type: 'result', seat: 0, result: { outcome: 'win', tie: 110_000 } }], 0, 10_000, 110_000)).toBe('Tie bet, 10 to 1');
    expect(describeWin('threecard', '', [{ type: 'hand', to: 0, seat: 0, cards: ['9h', 'Th', 'Jh'] }, { type: 'result', seat: 0, result: { pairPlus: 41_000, bonus: 0 } }], 0, 1_000, 41_000)).toBe('Straight flush');
  });

  it("Hold'em names only a hand that was shown down", () => {
    const shown: GameEvent[] = [{ type: 'win', pot: 0, amount: 900_000, winners: [{ seat: 3, amount: 900_000 }], hand: 'Full house', best: [] }];
    const folded: GameEvent[] = [{ type: 'win', pot: 0, amount: 900_000, winners: [{ seat: 3, amount: 900_000 }], hand: null, best: null }];
    expect(describeWin('holdem', '', shown, 3, 200_000, 900_000)).toBe('Full house');
    expect(describeWin('holdem', '', folded, 3, 200_000, 900_000)).toBe('Took the pot');
  });

  it('keeps the day in Las Vegas time', () => {
    // 03:00 UTC on 23 September is still the 22nd in Las Vegas (UTC-7 in summer time)
    expect(casinoDay(Date.UTC(2026, 8, 23, 3, 0))).toBe('2026-09-22');
    expect(casinoDay(Date.UTC(2026, 8, 23, 12, 0))).toBe('2026-09-23');
    // and UTC-8 in winter
    expect(casinoDay(Date.UTC(2026, 11, 25, 7, 59))).toBe('2026-12-24');
  });
});

describe('the floor announces big wins', () => {
  it('one per player a minute; the day still counts the ones it held back', async () => {
    const t = Date.UTC(2031, 0, 5, 20, 0);
    const a = report({ amount: 50_000, what: 'Straight 17' });
    const before = await runInDurableObject(floor(), (f) => f.wins.today(t));
    expect(await reportAt(a, t)).toBe('sent');
    expect(await reportAt({ ...a, amount: 80_000 }, t + 30_000)).toBe('limited');
    expect(await reportAt({ ...a, amount: 60_000 }, t + ACCOUNT_GAP_MS + 1)).toBe('sent');
    const after = await runInDurableObject(floor(), (f) => f.wins.today(t + ACCOUNT_GAP_MS + 1));
    expect(after.count - before.count).toBe(3);
    expect(after.total - before.total).toBe(190_000);
  });

  it(`at most ${FLOOR_MAX} a minute across the floor`, async () => {
    const t = Date.UTC(2031, 0, 6, 20, 0);
    for (let i = 0; i < FLOOR_MAX; i++) expect(await reportAt(report(), t + i * 1_000)).toBe('sent');
    expect(await reportAt(report(), t + FLOOR_MAX * 1_000)).toBe('limited');
    // a minute after the first one, there's room again
    expect(await reportAt(report(), t + FLOOR_WINDOW_MS + 1)).toBe('sent');
  });

  it('a win stamped ahead of the clock (a clock that jumped back) holds nobody else off', async () => {
    const t = Date.UTC(2031, 0, 9, 20, 0);
    for (let i = 0; i < FLOOR_MAX; i++) expect(await reportAt(report(), t + 10 * 60_000 + i)).toBe('sent');
    // ten minutes "earlier", the window is empty as far as now can tell
    expect(await reportAt(report(), t)).toBe('sent');
  });

  it('refuses reports that are not big wins or not well formed, and tidies the words', async () => {
    const t = Date.UTC(2031, 0, 7, 20, 0);
    expect(await reportAt(report({ wagered: 1_000, amount: 1_000 }), t)).toBe('refused');
    expect(await reportAt(report({ name: 'no spaces allowed' }), t)).toBe('refused');
    expect(await reportAt(report({ game: 'poker' as never }), t)).toBe('refused');
    expect(await reportAt(report({ amount: 12.5 }), t)).toBe('refused');
    const r = report({ what: '<b>Royal</b> \u{1F451} Flush!!', station: 'Not A Station' });
    expect(await reportAt(r, t)).toBe('sent');
    const [top] = await runInDurableObject(floor(), (f) => f.wins.recent());
    expect(top).toMatchObject({ name: 'lucky_one', game: 'roulette', amount: 35_000, what: 'b Royal /b Flush' });
    expect(top).not.toHaveProperty('station');
  });

  it(`keeps the last ${HISTORY} and shows them, newest first, to whoever arrives`, async () => {
    const t = Date.UTC(2031, 0, 8, 20, 0);
    for (let i = 0; i < HISTORY + 5; i++) {
      // one a minute apart: under every limit
      expect(await reportAt(report({ name: `winner_${i}`, wagered: 400, amount: 10_000 + i, what: `Win ${i}` }), t + i * FLOOR_WINDOW_MS)).toBe('sent');
    }
    const recent = await runInDurableObject(floor(), (f) => f.wins.recent());
    expect(recent).toHaveLength(HISTORY);
    expect(recent[0]!.name).toBe(`winner_${HISTORY + 4}`);
    expect(recent[HISTORY - 1]!.name).toBe('winner_5');

    // The floor forgets nothing it needs when it's evicted: the history is in its storage.
    await evictDurableObject(floor());
    const who = await arrive('bw_newcomer');
    const c = (await connect('floor', who.token)).client!;
    await c.next((m) => m.t === 'hello');
    const hi = await c.next((m) => m.t === 'bigwins');
    expect(hi.list).toHaveLength(HISTORY);
    expect(hi.list[0].name).toBe(`winner_${HISTORY + 4}`);
    expect(hi.today).toMatchObject({ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    c.ws.close(1000, 'bye');
  });
});

describe('from a table round to everyone on the floor', () => {
  it('a round that paid big at a table reaches the floor, named, placed and timed', async () => {
    const winner = await arrive('bw_table_win');
    const watcher = await arrive('bw_watching');
    const w = (await connect('floor', watcher.token)).client!;
    await w.next((m) => m.t === 'hello');

    const c = (await connect('solo/highcard', winner.token, '&station=bj-2')).client!;
    await c.next((m) => m.t === 'table');
    c.send({ t: 'buyin', aid: 'b1', amount: 100_000 });
    await c.next((m) => m.t === 'seat' && m.status === 'seated');

    // A round as an engine would report it: $10 staked, $360 back.
    const stub = env.TABLE.get(env.TABLE.idFromName(`solo:highcard:-:${winner.id}`)) as DurableObjectStub<CasinoTable>;
    const before = Date.now();
    const ok = await runInDurableObject(stub, (t) => {
      const table = t as unknown as { state: unknown; commit(s: Step<unknown>, now: number): boolean };
      return table.commit({ state: table.state, events: [], chips: [{ seat: 0, bet: 1_000, payout: 36_000 }], rounds: [{ seat: 0, wagered: 1_000, returned: 36_000 }] }, Date.now());
    });
    expect(ok).toBe(true);

    const news = await w.next((m) => m.t === 'bigwin' && m.name === 'bw_table_win', 5_000);
    expect(news).toMatchObject({ t: 'bigwin', name: 'bw_table_win', game: 'highcard', amount: 35_000, what: '36x', station: 'bj-2' });
    expect(news.at).toBeGreaterThanOrEqual(before);
    expect(news.today.count).toBeGreaterThan(0);

    // A win that only doubles the stake is no news.
    await runInDurableObject(stub, (t) => {
      const table = t as unknown as { state: unknown; commit(s: Step<unknown>, now: number): boolean };
      return table.commit({ state: table.state, events: [], chips: [{ seat: 0, bet: 1_000, payout: 2_000 }], rounds: [{ seat: 0, wagered: 1_000, returned: 2_000 }] }, Date.now());
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(w.msgs.filter((m: any) => m.t === 'bigwin' && m.name === 'bw_table_win')).toHaveLength(0);
    c.ws.close(1000, 'bye');
    w.ws.close(1000, 'bye');
  }, 30_000);
});

export type { Client };
