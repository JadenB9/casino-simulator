// The leaderboard route: who may ask, what comes back (names and numbers, never ids), each board's
// order and shared places, the thresholds, the asker's own place further down, one game's boards,
// the minute-long cache, the clearing of old day rows, and that each read goes through the index
// it names.
//
// Storage is shared by every test in this file, and other players sit on the same boards, so
// each test gives its own players values far above any real bankroll (or far below, on the
// losers' boards), asserts only about them, and clears them afterwards.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { signToken } from '../src/auth.ts';
import { CACHE_MS, SQL, WIN_ROWS, clearLeaderboardCache, leaderboard } from '../src/leaderboard.ts';
import { CATALOG } from '../../shared/src/games/catalog.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { GAME_LEADERBOARDS, LEADERBOARD_TOP, LEADERBOARDS, type Leaderboard, type LeaderboardId, type LeaderboardResponse } from '../../shared/src/protocol.ts';
import { WIN_RATE_MIN, WIN_RATE_MIN_GAME, addDays, dayKey, vegasDay, weekKey, weekOf } from '../../shared/src/stats.ts';
import { ORIGIN, TEST_PASSWORD, api } from './helpers.ts';

/** Far above anything a real account holds, so these players own the top of every board. */
const HUGE = 9_000_000_000_000;
const T = 1_800_000_000_000;
const TODAY = vegasDay(T);
const GAMES = Object.keys(CATALOG);

interface Player {
  id: number;
  name: string;
  token: string;
}

let ipSeq = 0;
let made: number[] = [];

async function player(name: string): Promise<Player> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      // an address per login keeps this file under the new-account limit
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `203.0.113.${++ipSeq}` },
      body: JSON.stringify({ name, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  made.push(body.profile.id);
  return { id: body.profile.id, name: body.profile.name, token: body.token };
}

/** One after another, so account ids (the tie-break) follow the names. */
async function players(prefix: string, n: number): Promise<Player[]> {
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(await player(`${prefix}${String(i).padStart(2, '0')}`));
  return out;
}

async function setWorth(p: Player, balance: number, inPlay = 0): Promise<void> {
  await env.DB.prepare(`UPDATE casino_accounts SET balance = ?2, in_play = ?3 WHERE id = ?1`).bind(p.id, balance, inPlay).run();
}

async function setStat(p: Player, game: string, rounds: number, biggestWin: number, net = 0, wagered = 0): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO casino_stats (account_id, game, rounds, wagered, net, biggest_win) VALUES (?1, ?2, ?3, ?5, ?6, ?4)
     ON CONFLICT (account_id, game) DO UPDATE SET rounds = excluded.rounds, biggest_win = excluded.biggest_win, net = excluded.net, wagered = excluded.wagered`,
  )
    .bind(p.id, game, rounds, biggestWin, wagered, net)
    .run();
}

async function setTally(p: Player, key: string, n: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, ?2, ?3) ON CONFLICT (account_id, key) DO UPDATE SET n = excluded.n`)
    .bind(p.id, key, n)
    .run();
}

async function setItem(p: Player, item: string, price: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO casino_items (account_id, item, price, bought_at, op_id) VALUES (?1, ?2, ?3, 0, ?4)`)
    .bind(p.id, item, price, `lb:${p.id}:${item}`)
    .run();
}

const ask = (p: Player, now = T, game: GameId | null = null) => leaderboard(env.DB, { id: p.id, name: p.name }, now, game);

const board = (r: LeaderboardResponse, b: LeaderboardId): Leaderboard => {
  const x = r.boards[b];
  if (!x) throw new Error(`no ${b} board`);
  return x;
};

/** The top rows as [rank, name, value]. */
const rows = (r: LeaderboardResponse, b: LeaderboardId) => board(r, b).top.map((x) => [x.rank, x.name, x.value]);
/** Only the rows of these players (others in the database may share a board). */
const mine = (r: LeaderboardResponse, b: LeaderboardId, ps: Player[]) => rows(r, b).filter((x) => ps.some((p) => p.name === x[1]));

beforeEach(() => {
  clearLeaderboardCache();
  made = [];
});

afterEach(async () => {
  // Off the boards again: no money, no stats, no tallies, no items.
  for (const id of made) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE casino_accounts SET balance = 0, in_play = 0 WHERE id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM casino_stats WHERE account_id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM casino_tally WHERE account_id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM casino_items WHERE account_id = ?1`).bind(id),
    ]);
  }
});

describe('leaderboard route', () => {
  it('answers a logged-in player from an allowed origin, and nobody else', async () => {
    const p = await player('lb_auth');
    const bare = await exports.default.fetch(new Request('http://casino.test/casino/api/leaderboard', { headers: { Origin: ORIGIN } }));
    expect(bare.status).toBe(401);
    expect((await bare.json<any>()).error).toBe('UNAUTHORIZED');

    expect((await api('leaderboard', 'v1.not.a-token')).status).toBe(401);
    expect((await api('leaderboard', await signToken('some-other-secret', p.id, p.name, Date.now()))).status).toBe(401);
    const expired = await signToken(env.CASINO_TOKEN_SECRET, p.id, p.name, Date.now() - 31 * 86_400_000);
    expect((await api('leaderboard', expired)).status).toBe(401);

    expect((await api('leaderboard', p.token, { headers: { Origin: 'https://elsewhere.example' } })).status).toBe(403);
    expect((await api('leaderboard', p.token, { method: 'POST' })).status).toBe(404);

    const ok = await api('leaderboard', p.token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
  });

  it("takes a game on the floor, and refuses one that isn't", async () => {
    const p = await player('lb_game_q');
    const ok = await api('leaderboard?game=blackjack', p.token);
    expect(ok.status).toBe(200);
    const body = await ok.json<LeaderboardResponse>();
    expect(body.game).toBe('blackjack');
    expect(Object.keys(body.boards)).toEqual([...GAME_LEADERBOARDS]);
    for (const bad of ['nope', 'highcard', '', '__proto__']) {
      const r = await api(`leaderboard?game=${bad}`, p.token);
      expect(r.status).toBe(400);
      expect((await r.json<any>()).error).toBe('BAD_REQUEST');
    }
  });

  it('sends names and numbers, never an account id', async () => {
    const ps = await players('lb_shape_', 3);
    await setWorth(ps[0]!, HUGE + 3);
    await setStat(ps[0]!, 'blackjack', 40, HUGE + 3, HUGE, HUGE);
    await setWorth(ps[1]!, HUGE + 2);
    await setTally(ps[1]!, 'rounds', 500);
    await setTally(ps[1]!, 'wins', 400);
    for (const path of ['leaderboard', 'leaderboard?game=blackjack']) {
      const res = await api(path, ps[2]!.token);
      const body = await res.json<LeaderboardResponse>();
      expect(Object.keys(body).filter((k) => k !== 'game').sort()).toEqual(['age', 'boards']);
      expect(body.age).toBeGreaterThanOrEqual(0);
      for (const b of Object.keys(body.boards) as LeaderboardId[]) {
        const x = board(body, b);
        expect(Object.keys(x).sort()).toEqual(['top', 'you']);
        expect(x.top.length).toBeLessThanOrEqual(LEADERBOARD_TOP);
        for (const row of x.top) {
          expect(Object.keys(row).filter((k) => k !== 'you' && k !== 'of').sort()).toEqual(['name', 'rank', 'value']);
          expect(typeof row.name).toBe('string');
        }
        if (x.you) expect(Object.keys(x.you).filter((k) => k !== 'of').sort()).toEqual(['name', 'rank', 'value']);
      }
      expect(JSON.stringify(body)).not.toMatch(/"(id|accountId|account_id)"/);
    }
    const all = await (await api('leaderboard', ps[2]!.token)).json<LeaderboardResponse>();
    expect(Object.keys(all.boards)).toEqual([...LEADERBOARDS]);
    expect(all.game).toBeUndefined();
  });

  it('keeps its boards between opens', async () => {
    const ps = await players('lb_route_', 2);
    await setWorth(ps[0]!, HUGE + 5);
    const first = await (await api('leaderboard', ps[1]!.token)).json<LeaderboardResponse>();
    expect(board(first, 'richest').top[0]).toEqual({ rank: 1, name: 'lb_route_00', value: HUGE + 5 });
    // Someone new takes first place; the route keeps answering with what it read.
    await setWorth(ps[1]!, HUGE + 9);
    const again = await (await api('leaderboard', ps[1]!.token)).json<LeaderboardResponse>();
    expect(board(again, 'richest').top).toEqual(board(first, 'richest').top);
    expect(again.age).toBeGreaterThanOrEqual(first.age);
  });
});

describe('leaderboard boards', () => {
  it('lists the ten richest by balance plus chips on tables, with shared places on a tie', async () => {
    const ps = await players('lb_rich_', 12);
    const worth = [120, 110, 100, 100, 90, 80, 70, 60, 50, 40, 30, 20];
    for (const [i, p] of ps.entries()) await setWorth(p, HUGE + worth[i]! - (i === 1 ? 10 : 0), i === 1 ? 10 : 0);

    const outside = await ask(ps[10]!);
    expect(rows(outside, 'richest')).toEqual([1, 2, 3, 3, 5, 6, 7, 8, 9, 10].map((rank, i) => [rank, ps[i]!.name, HUGE + worth[i]!]));
    expect(board(outside, 'richest').top.some((r) => r.you)).toBe(false);
    expect(board(outside, 'richest').you).toEqual({ rank: 11, name: 'lb_rich_10', value: HUGE + 30 });

    // Tied third: listed in the order the accounts were made, both marked third.
    const tied = await ask(ps[3]!);
    expect(board(tied, 'richest').top[3]).toEqual({ rank: 3, name: 'lb_rich_03', value: HUGE + 100, you: true });
    expect(board(tied, 'richest').top.filter((r) => r.you)).toHaveLength(1);
    expect(board(tied, 'richest').you).toBeNull();
  });

  it("takes each player's biggest win over all their games, once", async () => {
    const ps = await players('lb_win_', 12);
    const [best, ...rest] = ps;
    await setStat(best!, 'blackjack', 5, HUGE + 5);
    await setStat(best!, 'roulette', 5, HUGE + 500);
    await setStat(best!, 'craps', 5, HUGE + 7);
    for (let i = 0; i < 10; i++) await setStat(rest[i]!, 'baccarat', 1, HUGE + 400 - i * 10);

    const r = await ask(rest[9]!);
    expect(rows(r, 'biggestWin')[0]).toEqual([1, 'lb_win_00', HUGE + 500]);
    expect(board(r, 'biggestWin').top.filter((x) => x.name === 'lb_win_00')).toHaveLength(1);
    expect(rows(r, 'biggestWin').map((x) => x[1])).toEqual(ps.slice(0, 10).map((p) => p.name));
    expect(board(r, 'biggestWin').you).toEqual({ rank: 11, name: 'lb_win_10', value: HUGE + 310 });

    // Never won anything, never played: on none of the boards yet.
    const none = await ask(rest[10]!);
    for (const b of LEADERBOARDS.filter((x) => x !== 'richest')) expect(board(none, b).you).toEqual({ rank: null, name: 'lb_win_11', value: 0 });
  });

  it('finds the ten biggest winners even when nine of them have a win in every game', async () => {
    // 9 players x every game fill the first 9 x GAMES rows of the index; the tenth player's one
    // row comes right after them, the furthest into the index the top ten can ever reach.
    expect(WIN_ROWS).toBe(LEADERBOARD_TOP * GAMES.length);
    const ps = await players('lb_fill_', 11);
    for (let i = 0; i < 9; i++) {
      for (const [g, game] of GAMES.entries()) await setStat(ps[i]!, game, 1, HUGE + 10_000 - i * 100 - g);
    }
    await setStat(ps[9]!, 'slots', 1, HUGE + 50);
    await setStat(ps[10]!, 'slots', 1, HUGE + 40);

    const r = await ask(ps[10]!);
    expect(rows(r, 'biggestWin')).toEqual([...ps.slice(0, 9).map((p, i) => [i + 1, p.name, HUGE + 10_000 - i * 100]), [10, 'lb_fill_09', HUGE + 50]]);
    expect(board(r, 'biggestWin').you).toEqual({ rank: 11, name: 'lb_fill_10', value: HUGE + 40 });
  });

  it('adds up rounds, wagered and net over every game', async () => {
    const ps = await players('lb_rounds_', 12);
    for (let i = 0; i < 12; i++) {
      const total = HUGE + 1_000 - i * 10;
      // Some play one game, some split the same total over three.
      if (i % 2) await setStat(ps[i]!, 'blackjack', total, 0, total, total);
      else {
        await setStat(ps[i]!, 'blackjack', total - 300, 0, total - 300, total - 300);
        await setStat(ps[i]!, 'roulette', 200, 0, 200, 200);
        await setStat(ps[i]!, 'slots', 100, 0, 100, 100);
      }
    }
    const r = await ask(ps[11]!);
    for (const b of ['rounds', 'wagered', 'netUp'] as const) {
      expect(rows(r, b)).toEqual(ps.slice(0, 10).map((p, i) => [i + 1, p.name, HUGE + 1_000 - i * 10]));
      expect(board(r, b).you).toEqual({ rank: 12, name: 'lb_rounds_11', value: HUGE + 890 });
    }
    // Up on the year: not on the losers' board.
    expect(board(r, 'netDown').you).toEqual({ rank: null, name: 'lb_rounds_11', value: 0 });
    const inside = await ask(ps[4]!);
    expect(board(inside, 'rounds').top[4]).toMatchObject({ name: 'lb_rounds_04', you: true });
    expect(board(inside, 'rounds').you).toBeNull();
  });

  it('lists the biggest losers most-down first, and nobody who is up or even', async () => {
    const ps = await players('lb_down_', 13);
    for (let i = 0; i < 12; i++) await setStat(ps[i]!, 'craps', 10, 0, -HUGE - 1_000 + i * 10 + (i === 3 ? 10 : 0));
    await setStat(ps[12]!, 'craps', 10, 0, 0);
    const r = await ask(ps[11]!);
    const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => -HUGE - 1_000 + i * 10 + (i === 3 ? 10 : 0));
    // Third and fourth tie (both down the same): one place each, shared.
    expect(mine(r, 'netDown', ps).map((x) => x[2])).toEqual(expected);
    expect(mine(r, 'netDown', ps).map((x) => x[0])).toEqual([1, 2, 3, 4, 4, 6, 7, 8, 9, 10]);
    expect(board(r, 'netDown').you).toEqual({ rank: 12, name: 'lb_down_11', value: -HUGE - 890 });
    expect(board(r, 'netUp').you).toEqual({ rank: null, name: 'lb_down_11', value: 0 });
    const even = await ask(ps[12]!);
    expect(board(even, 'netDown').you).toEqual({ rank: null, name: 'lb_down_12', value: 0 });
  });

  it('ranks the tally boards: won, lost, biggest loss, streak, achievements', async () => {
    const ps = await players('lb_tally_', 12);
    const boards = { won: 'won', lost: 'lost', biggestLoss: 'worst', streak: 'streak', feats: 'feats' } as const;
    for (const [i, p] of ps.entries()) {
      for (const key of Object.values(boards)) await setTally(p, key, HUGE + 1_000 - i * 10 - (i === 2 ? 10 : 0));
    }
    const r = await ask(ps[11]!);
    for (const b of Object.keys(boards) as (keyof typeof boards)[]) {
      expect(rows(r, b).map((x) => x[1])).toEqual(ps.slice(0, 10).map((p) => p.name));
      // third and fourth tie
      expect(rows(r, b).map((x) => x[0])).toEqual([1, 2, 3, 3, 5, 6, 7, 8, 9, 10]);
      expect(board(r, b).you).toEqual({ rank: 12, name: 'lb_tally_11', value: HUGE + 890 });
    }
    // The table's flush markers and other keys are not these boards.
    await setTally(ps[11]!, 'flush:abc', HUGE * 2);
    await setTally(ps[11]!, 'won:blackjack', HUGE * 2);
    clearLeaderboardCache();
    expect(rows(await ask(ps[11]!), 'won')[0]![1]).toBe('lb_tally_00');
  });

  it("ranks today's and this week's net by the casino's day, winners and losers", async () => {
    const ps = await players('lb_day_', 4);
    const week = weekKey(weekOf(TODAY));
    await setTally(ps[0]!, dayKey(TODAY), HUGE + 30);
    await setTally(ps[1]!, dayKey(TODAY), HUGE + 20);
    await setTally(ps[2]!, dayKey(TODAY), -HUGE - 50);
    // yesterday's big day is not today's
    await setTally(ps[3]!, dayKey(addDays(TODAY, -1)), HUGE * 2);
    for (const [i, p] of ps.entries()) await setTally(p, week, [HUGE + 30, HUGE + 20, -HUGE - 50, HUGE + 40][i]!);

    const r = await ask(ps[1]!);
    expect(mine(r, 'today', ps)).toEqual([[1, 'lb_day_00', HUGE + 30], [2, 'lb_day_01', HUGE + 20]]);
    expect(board(r, 'today').top[1]).toMatchObject({ you: true });
    expect(mine(r, 'todayDown', ps)).toEqual([[1, 'lb_day_02', -HUGE - 50]]);
    expect(board(r, 'todayDown').you).toEqual({ rank: null, name: 'lb_day_01', value: 0 });
    expect(mine(r, 'week', ps)).toEqual([[1, 'lb_day_03', HUGE + 40], [2, 'lb_day_00', HUGE + 30], [3, 'lb_day_01', HUGE + 20]]);
    expect(mine(r, 'weekDown', ps)).toEqual([[1, 'lb_day_02', -HUGE - 50]]);
    const loser = await ask(ps[2]!);
    expect(board(loser, 'todayDown').you).toBeNull();
    expect(board(loser, 'today').you).toEqual({ rank: null, name: 'lb_day_02', value: 0 });

    // A day later the same rows are yesterday's.
    clearLeaderboardCache();
    const tomorrow = await ask(ps[1]!, T + 86_400_000);
    expect(mine(tomorrow, 'today', ps)).toEqual([]);
  });

  it('ranks the win rate over enough rounds, best rate first, then more rounds', async () => {
    const ps = await players('lb_rate_', 5);
    // 60%, 60% over more rounds, 75%, one round short of qualifying (at 90%), and 0%
    const set = [[1_000, 600], [2_000, 1_200], [WIN_RATE_MIN, 75], [WIN_RATE_MIN - 1, 89], [WIN_RATE_MIN, 0]] as const;
    for (const [i, [rounds, wins]] of set.entries()) {
      await setTally(ps[i]!, 'rounds', rounds);
      if (wins) await setTally(ps[i]!, 'wins', wins);
    }
    const r = await ask(ps[4]!);
    const got = board(r, 'winRate').top.filter((x) => x.name.startsWith('lb_rate_'));
    expect(got.map((x) => [x.name, x.value, x.of])).toEqual([
      ['lb_rate_02', 7_500, WIN_RATE_MIN],
      ['lb_rate_01', 6_000, 2_000],
      ['lb_rate_00', 6_000, 1_000],
      ['lb_rate_04', 0, WIN_RATE_MIN],
    ]);
    expect(got[1]!.rank).toBe(got[2]!.rank);
    const short = await ask(ps[3]!);
    expect(board(short, 'winRate').you).toEqual({ rank: null, name: 'lb_rate_03', value: 0 });
  });

  it('counts the celebrities each player has met, and what the things they keep cost', async () => {
    const ps = await players('lb_celeb_', 3);
    await setTally(ps[0]!, 'celeb:maddox', 3);
    await setTally(ps[0]!, 'celeb:rhea', 1);
    await setTally(ps[1]!, 'celeb:maddox', 9);
    await setTally(ps[1]!, 'celeb:zed', 0);
    // not a celebrity row
    await setTally(ps[2]!, 'celebrate', 5);
    await setItem(ps[0]!, 'gold-chain', HUGE);
    await setItem(ps[0]!, 'grill', 500);
    await setItem(ps[1]!, 'statue', HUGE + 1_000);
    const r = await ask(ps[2]!);
    expect(mine(r, 'celebs', ps)).toEqual([[expect.any(Number), 'lb_celeb_00', 2], [expect.any(Number), 'lb_celeb_01', 1]]);
    expect(board(r, 'celebs').you).toEqual({ rank: null, name: 'lb_celeb_02', value: 0 });
    expect(mine(r, 'collection', ps)).toEqual([[1, 'lb_celeb_01', HUGE + 1_000], [2, 'lb_celeb_00', HUGE + 500]]);
  });
});

describe("one game's boards", () => {
  it('rank that game alone: earners, losers, biggest win, rounds, won, lost, worst round, win rate', async () => {
    const ps = await players('lb_g_', 4);
    const [a, b, c, d] = ps as [Player, Player, Player, Player];
    await setStat(a, 'roulette', HUGE + 3, HUGE + 30, HUGE + 300);
    await setStat(b, 'roulette', HUGE + 2, HUGE + 20, -HUGE - 200);
    await setStat(c, 'roulette', HUGE + 1, HUGE + 10, -HUGE - 400);
    // a big day at another game shows nowhere here
    await setStat(d, 'blackjack', HUGE * 2, HUGE * 2, HUGE * 2);
    await setTally(a, 'won:roulette', HUGE + 1);
    await setTally(b, 'won:roulette', HUGE + 2);
    await setTally(c, 'lost:roulette', HUGE + 5);
    await setTally(c, 'worst:roulette', HUGE + 6);
    await setTally(d, 'won:blackjack', HUGE * 3);
    await setTally(a, 'rounds:roulette', WIN_RATE_MIN_GAME);
    await setTally(a, 'wins:roulette', 25);
    await setTally(b, 'rounds:roulette', WIN_RATE_MIN_GAME - 1);
    await setTally(b, 'wins:roulette', WIN_RATE_MIN_GAME - 1);

    const r = await ask(d, T, 'roulette');
    expect(r.game).toBe('roulette');
    expect(Object.keys(r.boards)).toEqual([...GAME_LEADERBOARDS]);
    expect(mine(r, 'netUp', ps)).toEqual([[1, 'lb_g_00', HUGE + 300]]);
    expect(mine(r, 'netDown', ps)).toEqual([[1, 'lb_g_02', -HUGE - 400], [2, 'lb_g_01', -HUGE - 200]]);
    expect(mine(r, 'biggestWin', ps)).toEqual([[1, 'lb_g_00', HUGE + 30], [2, 'lb_g_01', HUGE + 20], [3, 'lb_g_02', HUGE + 10]]);
    expect(mine(r, 'rounds', ps)).toEqual([[1, 'lb_g_00', HUGE + 3], [2, 'lb_g_01', HUGE + 2], [3, 'lb_g_02', HUGE + 1]]);
    expect(mine(r, 'won', ps)).toEqual([[1, 'lb_g_01', HUGE + 2], [2, 'lb_g_00', HUGE + 1]]);
    expect(mine(r, 'lost', ps)).toEqual([[1, 'lb_g_02', HUGE + 5]]);
    expect(mine(r, 'biggestLoss', ps)).toEqual([[1, 'lb_g_02', HUGE + 6]]);
    expect(board(r, 'winRate').top.filter((x) => x.name.startsWith('lb_g_')).map((x) => [x.name, x.value, x.of])).toEqual([['lb_g_00', 5_000, WIN_RATE_MIN_GAME]]);
    for (const id of GAME_LEADERBOARDS) expect(board(r, id).you).toEqual({ rank: null, name: 'lb_g_03', value: 0 });

    // The loser's own places, from outside the top of a crowded board.
    const own = await ask(b, T, 'roulette');
    expect(board(own, 'netDown').top.find((x) => x.name === 'lb_g_01')).toMatchObject({ rank: 2, you: true });
    expect(board(own, 'winRate').you).toEqual({ rank: null, name: 'lb_g_01', value: 0 });

    // The casino-wide boards are their own snapshot.
    const all = await ask(d);
    expect(all.game).toBeUndefined();
    expect(mine(all, 'netUp', ps)[0]).toEqual([1, 'lb_g_03', HUGE * 2]);
  });

  it("keeps each game's boards a minute, apart from the others", async () => {
    const ps = await players('lb_gc_', 2);
    await setStat(ps[0]!, 'keno', 5, HUGE + 1);
    const first = await ask(ps[1]!, T, 'keno');
    expect(mine(first, 'biggestWin', ps)).toEqual([[1, 'lb_gc_00', HUGE + 1]]);
    await setStat(ps[1]!, 'keno', 5, HUGE + 9);
    await setStat(ps[1]!, 'mines', 5, HUGE + 9);
    expect(mine(await ask(ps[1]!, T + CACHE_MS - 1, 'keno'), 'biggestWin', ps)).toEqual([[1, 'lb_gc_00', HUGE + 1]]);
    // another game reads its own, fresh
    expect(mine(await ask(ps[1]!, T + CACHE_MS - 1, 'mines'), 'biggestWin', ps)).toEqual([[1, 'lb_gc_01', HUGE + 9]]);
    expect(mine(await ask(ps[1]!, T + CACHE_MS, 'keno'), 'biggestWin', ps)[0]).toEqual([1, 'lb_gc_01', HUGE + 9]);
  });
});

describe('leaderboard upkeep', () => {
  it('reads the boards, and your place, at most once a minute', async () => {
    const ps = await players('lb_cache_', 12);
    for (let i = 0; i < 11; i++) await setWorth(ps[i]!, HUGE + 1_000 - i * 10);
    const asker = ps[11]!;
    await setWorth(asker, HUGE + 1);

    const first = await ask(asker, T);
    expect(first.age).toBe(0);
    expect(board(first, 'richest').top[0]!.name).toBe('lb_cache_00');
    expect(board(first, 'richest').you).toEqual({ rank: 12, name: 'lb_cache_11', value: HUGE + 1 });

    // Both would move: someone new on top, and the asker up a place.
    await setWorth(ps[10]!, HUGE + 5_000);
    await setWorth(asker, HUGE + 915);
    const later = await ask(asker, T + CACHE_MS - 1);
    expect(later.age).toBe(CACHE_MS - 1);
    expect(later.boards).toEqual(first.boards);

    const fresh = await ask(asker, T + CACHE_MS);
    expect(fresh.age).toBe(0);
    expect(board(fresh, 'richest').top[0]).toEqual({ rank: 1, name: 'lb_cache_10', value: HUGE + 5_000 });
    expect(board(fresh, 'richest').you).toEqual({ rank: 11, name: 'lb_cache_11', value: HUGE + 915 });
  });

  it("clears day and week rows older than the boards look back, and nothing else", async () => {
    const [p] = await players('lb_prune_', 1);
    const old = addDays(TODAY, -50);
    const recent = addDays(TODAY, -3);
    const keep = ['won', 'wins', 'worst', 'daily-streak', 'daily-last', `d:${old}:won`, dayKey(recent), dayKey(TODAY), weekKey(weekOf(recent)), 'w', 'n'];
    for (const k of [...keep, dayKey(old), weekKey(weekOf(old))]) await setTally(p!, k, 5);
    await ask(p!);
    const left = (await env.DB.prepare(`SELECT key FROM casino_tally WHERE account_id = ?1`).bind(p!.id).all<{ key: string }>()).results.map((r) => r.key);
    expect(left.sort()).toEqual(keep.sort());
  });
});

describe('leaderboard reads', () => {
  const plan = async (sql: string, ...args: unknown[]) =>
    (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>()).results.map((r) => r.detail).join('\n');

  it('go through the index each one names', async () => {
    const richestTop = await plan(SQL.richestTop, LEADERBOARD_TOP);
    expect(richestTop).toMatch(/SEARCH casino_accounts USING COVERING INDEX idx_casino_accounts_networth/);
    expect(richestTop).not.toMatch(/TEMP B-TREE/);
    expect(await plan(SQL.richestPlace, 1)).toMatch(/SEARCH o USING COVERING INDEX idx_casino_accounts_networth/);

    expect(await plan(SQL.biggestWinTop, WIN_ROWS, LEADERBOARD_TOP)).toMatch(/SEARCH casino_stats USING COVERING INDEX idx_casino_stats_biggest_win/);
    expect(await plan(SQL.biggestWinPlace, 1)).toMatch(/SEARCH casino_stats USING COVERING INDEX idx_casino_stats_biggest_win/);

    // One tally key: the top ten in index order, both ways, and places counted in the index.
    for (const sql of [SQL.tallyTop, SQL.tallyBottom]) {
      const p = await plan(sql, 'won', LEADERBOARD_TOP);
      expect(p).toMatch(/SEARCH casino_tally USING COVERING INDEX idx_casino_tally_key_n \(key=\? AND n[<>]\?\)/);
      expect(p).not.toMatch(/TEMP B-TREE/);
    }
    for (const sql of [SQL.tallyPlace, SQL.tallyPlaceDown]) {
      const p = await plan(sql, 1, 'won');
      expect(p).toMatch(/SEARCH casino_tally USING COVERING INDEX idx_casino_tally_key_n/);
      expect(p).toMatch(/SEARCH casino_tally USING PRIMARY KEY \(account_id=\? AND key=\?\)/);
    }
    const rate = await plan(SQL.rateRows, 'rounds', 'wins', WIN_RATE_MIN);
    expect(rate).toMatch(/SEARCH r USING COVERING INDEX idx_casino_tally_key_n \(key=\? AND n>\?\)/);
    expect(rate).toMatch(/SEARCH w USING PRIMARY KEY \(account_id=\? AND key=\?\)/);
    expect(await plan(SQL.celebs)).toMatch(/SEARCH casino_tally USING COVERING INDEX idx_casino_tally_key_n \(key>\? AND key<\?\)/);
    expect(await plan(SQL.prune, 'n:2026-01-01', 'w:2026-01-01')).toMatch(/idx_casino_tally_key_n/);

    // A game's boards: its slice of each stats index, in order, both ways for net.
    const game: [string, string, RegExp][] = [
      [SQL.gameNetTop, SQL.gameNetPlace, /idx_casino_stats_game_net/],
      [SQL.gameNetBottom, SQL.gameNetPlaceDown, /idx_casino_stats_game_net/],
      [SQL.gameWinTop, SQL.gameWinPlace, /idx_casino_stats_game_win/],
      [SQL.gameRoundsTop, SQL.gameRoundsPlace, /idx_casino_stats_game_rounds/],
    ];
    for (const [top, place, index] of game) {
      const p = await plan(top, 'roulette', LEADERBOARD_TOP);
      expect(p).toMatch(/SEARCH casino_stats USING COVERING INDEX/);
      expect(p).toMatch(index);
      expect(p).not.toMatch(/TEMP B-TREE/);
      const q = await plan(place, 1, 'roulette');
      expect(q).toMatch(index);
      expect(q).toMatch(/SEARCH casino_stats USING PRIMARY KEY \(account_id=\? AND game=\?\)/);
    }

    // Sums per player can't be indexed: one pass in primary-key order, grouped without sorting.
    for (const sql of [SQL.statsTotals, SQL.collection]) {
      const p = await plan(sql);
      expect(p).toMatch(/SCAN casino_(stats|items)/);
      expect(p).not.toMatch(/TEMP B-TREE FOR GROUP BY/);
    }
    expect(await plan(SQL.names, '[1,2]')).toMatch(/SEARCH casino_accounts USING INTEGER PRIMARY KEY/);
  });

  it('read a bounded number of rows however many players there are', async () => {
    // Enough players, stats and tallies that a scan would show.
    const stmts = [];
    for (let i = 0; i < 400; i++) {
      stmts.push(env.DB.prepare(`INSERT INTO casino_accounts (name, balance, created_at, last_seen) VALUES (?1, ?2, 0, 0)`).bind(`lb_bulk_${i}`, 1_000 + i));
    }
    await env.DB.batch(stmts);
    const ids = (await env.DB.prepare(`SELECT id FROM casino_accounts WHERE name LIKE 'lb_bulk_%'`).all<{ id: number }>()).results.map((r) => r.id);
    made.push(...ids);
    await env.DB.batch(
      ids.flatMap((id, i) => [
        ...['blackjack', 'craps'].map((g) =>
          env.DB.prepare(`INSERT INTO casino_stats (account_id, game, rounds, wagered, net, biggest_win) VALUES (?1, ?2, 3, 0, ?3, ?3)`).bind(id, g, 100 + i),
        ),
        ...['won', 'lost', 'rounds', 'won:craps'].map((k) => env.DB.prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, ?2, ?3)`).bind(id, k, 100 + i)),
      ]),
    );

    const read = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all()).meta.rows_read;
    expect(await read(SQL.richestTop, LEADERBOARD_TOP)).toBeLessThanOrEqual(LEADERBOARD_TOP);
    // (The stats table holds 800 rows here; the top ten read a fixed prefix of the index.)
    expect(await read(SQL.biggestWinTop, WIN_ROWS, LEADERBOARD_TOP)).toBeLessThanOrEqual(3 * WIN_ROWS);
    expect(await read(SQL.tallyTop, 'won', LEADERBOARD_TOP)).toBeLessThanOrEqual(LEADERBOARD_TOP + 1);
    expect(await read(SQL.tallyTop, 'won:craps', LEADERBOARD_TOP)).toBeLessThanOrEqual(LEADERBOARD_TOP + 1);
    expect(await read(SQL.gameNetTop, 'craps', LEADERBOARD_TOP)).toBeLessThanOrEqual(LEADERBOARD_TOP + 1);
    expect(await read(SQL.gameWinTop, 'blackjack', LEADERBOARD_TOP)).toBeLessThanOrEqual(LEADERBOARD_TOP + 1);
    // Only the players over the threshold, and each one's wins beside them.
    expect(await read(SQL.rateRows, 'rounds', 'wins', 450)).toBeLessThanOrEqual(2 * 50 + 1);
    // The place counts read only the index entries above you: the richest here has nobody.
    const top = ids[ids.length - 1]!;
    await env.DB.prepare(`UPDATE casino_accounts SET balance = ?2 WHERE id = ?1`).bind(top, HUGE).run();
    expect(await read(SQL.richestPlace, top)).toBeLessThanOrEqual(2);
    expect(await read(SQL.tallyPlace, top, 'won')).toBeLessThanOrEqual(3);
  });
});
