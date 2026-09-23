// The leaderboard route: who may ask, what comes back (names and numbers, never ids), the order
// and shared places, the asker's own place further down, the minute-long cache, and that each
// read goes through the index it names.
//
// Storage is shared by every test in this file, and other players sit on the same boards, so
// each test gives its own players values far above any real bankroll, asserts only about them,
// and zeroes them afterwards.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { signToken } from '../src/auth.ts';
import { CACHE_MS, SQL, WIN_ROWS, clearLeaderboardCache, leaderboard } from '../src/leaderboard.ts';
import { CATALOG } from '../../shared/src/games/catalog.ts';
import { LEADERBOARD_TOP, LEADERBOARDS, type LeaderboardResponse } from '../../shared/src/protocol.ts';
import { ORIGIN, api } from './helpers.ts';

/** Far above anything a real account holds, so these players own the top of every board. */
const HUGE = 9_000_000_000_000;
const T = 1_800_000_000_000;
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
      body: JSON.stringify({ name }),
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

async function setStat(p: Player, game: string, rounds: number, biggestWin: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO casino_stats (account_id, game, rounds, wagered, net, biggest_win) VALUES (?1, ?2, ?3, 0, 0, ?4)
     ON CONFLICT (account_id, game) DO UPDATE SET rounds = excluded.rounds, biggest_win = excluded.biggest_win`,
  )
    .bind(p.id, game, rounds, biggestWin)
    .run();
}

const ask = (p: Player, now = T) => leaderboard(env.DB, { id: p.id, name: p.name }, now);

/** The top rows as [rank, name, value], and marked rows. */
const rows = (r: LeaderboardResponse, b: (typeof LEADERBOARDS)[number]) => r.boards[b].top.map((x) => [x.rank, x.name, x.value]);

beforeEach(() => {
  clearLeaderboardCache();
  made = [];
});

afterEach(async () => {
  // Off the boards again: no money, no stats.
  for (const id of made) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE casino_accounts SET balance = 0, in_play = 0 WHERE id = ?1`).bind(id),
      env.DB.prepare(`DELETE FROM casino_stats WHERE account_id = ?1`).bind(id),
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

  it('sends names and numbers, never an account id', async () => {
    const ps = await players('lb_shape_', 3);
    await setWorth(ps[0]!, HUGE + 3);
    await setStat(ps[0]!, 'blackjack', 40, HUGE + 3);
    await setWorth(ps[1]!, HUGE + 2);
    const res = await api('leaderboard', ps[2]!.token);
    const body = await res.json<LeaderboardResponse>();
    expect(Object.keys(body).sort()).toEqual(['age', 'boards']);
    expect(Object.keys(body.boards)).toEqual([...LEADERBOARDS]);
    expect(body.age).toBeGreaterThanOrEqual(0);
    for (const b of LEADERBOARDS) {
      const board = body.boards[b];
      expect(Object.keys(board).sort()).toEqual(['top', 'you']);
      expect(board.top.length).toBeLessThanOrEqual(LEADERBOARD_TOP);
      for (const row of board.top) {
        expect(Object.keys(row).filter((k) => k !== 'you').sort()).toEqual(['name', 'rank', 'value']);
        expect(typeof row.name).toBe('string');
      }
      if (board.you) expect(Object.keys(board.you).sort()).toEqual(['name', 'rank', 'value']);
    }
    expect(JSON.stringify(body)).not.toMatch(/"(id|accountId|account_id)"/);
  });

  it('keeps its boards between opens', async () => {
    const ps = await players('lb_route_', 2);
    await setWorth(ps[0]!, HUGE + 5);
    const first = await (await api('leaderboard', ps[1]!.token)).json<LeaderboardResponse>();
    expect(first.boards.richest.top[0]).toEqual({ rank: 1, name: 'lb_route_00', value: HUGE + 5 });
    // Someone new takes first place; the route keeps answering with what it read.
    await setWorth(ps[1]!, HUGE + 9);
    const again = await (await api('leaderboard', ps[1]!.token)).json<LeaderboardResponse>();
    expect(again.boards.richest.top).toEqual(first.boards.richest.top);
    expect(again.age).toBeGreaterThanOrEqual(first.age);
  });
});

describe('leaderboard boards', () => {
  it('lists the ten richest by balance plus chips on tables, with shared places on a tie', async () => {
    const ps = await players('lb_rich_', 12);
    const worth = [120, 110, 100, 100, 90, 80, 70, 60, 50, 40, 30, 20];
    for (const [i, p] of ps.entries()) await setWorth(p, HUGE + worth[i]! - (i === 1 ? 10 : 0), i === 1 ? 10 : 0);

    const outside = await ask(ps[10]!);
    expect(rows(outside, 'richest')).toEqual(
      [1, 2, 3, 3, 5, 6, 7, 8, 9, 10].map((rank, i) => [rank, ps[i]!.name, HUGE + worth[i]!]),
    );
    expect(outside.boards.richest.top.some((r) => r.you)).toBe(false);
    expect(outside.boards.richest.you).toEqual({ rank: 11, name: 'lb_rich_10', value: HUGE + 30 });

    // Tied third: listed in the order the accounts were made, both marked third.
    const tied = await ask(ps[3]!);
    expect(tied.boards.richest.top[3]).toEqual({ rank: 3, name: 'lb_rich_03', value: HUGE + 100, you: true });
    expect(tied.boards.richest.top.filter((r) => r.you)).toHaveLength(1);
    expect(tied.boards.richest.you).toBeNull();
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
    expect(r.boards.biggestWin.top.filter((x) => x.name === 'lb_win_00')).toHaveLength(1);
    expect(rows(r, 'biggestWin').map((x) => x[1])).toEqual(ps.slice(0, 10).map((p) => p.name));
    expect(r.boards.biggestWin.you).toEqual({ rank: 11, name: 'lb_win_10', value: HUGE + 310 });

    // Never won anything, never played: on neither board yet.
    const none = await ask(rest[10]!);
    expect(none.boards.biggestWin.you).toEqual({ rank: null, name: 'lb_win_11', value: 0 });
    expect(none.boards.rounds.you).toEqual({ rank: null, name: 'lb_win_11', value: 0 });
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
    expect(rows(r, 'biggestWin')).toEqual([
      ...ps.slice(0, 9).map((p, i) => [i + 1, p.name, HUGE + 10_000 - i * 100]),
      [10, 'lb_fill_09', HUGE + 50],
    ]);
    expect(r.boards.biggestWin.you).toEqual({ rank: 11, name: 'lb_fill_10', value: HUGE + 40 });
  });

  it('adds up rounds over every game', async () => {
    const ps = await players('lb_rounds_', 12);
    for (let i = 0; i < 12; i++) {
      const total = HUGE + 1_000 - i * 10;
      // Some play one game, some split the same total over three.
      if (i % 2) await setStat(ps[i]!, 'blackjack', total, 0);
      else {
        await setStat(ps[i]!, 'blackjack', total - 300, 0);
        await setStat(ps[i]!, 'roulette', 200, 0);
        await setStat(ps[i]!, 'slots', 100, 0);
      }
    }
    const r = await ask(ps[11]!);
    expect(rows(r, 'rounds')).toEqual(ps.slice(0, 10).map((p, i) => [i + 1, p.name, HUGE + 1_000 - i * 10]));
    expect(r.boards.rounds.you).toEqual({ rank: 12, name: 'lb_rounds_11', value: HUGE + 890 });
    const inside = await ask(ps[4]!);
    expect(inside.boards.rounds.top[4]).toMatchObject({ name: 'lb_rounds_04', you: true });
    expect(inside.boards.rounds.you).toBeNull();
  });

  it('reads the boards, and your place, at most once a minute', async () => {
    const ps = await players('lb_cache_', 12);
    for (let i = 0; i < 11; i++) await setWorth(ps[i]!, HUGE + 1_000 - i * 10);
    const asker = ps[11]!;
    await setWorth(asker, HUGE + 1);

    const first = await ask(asker, T);
    expect(first.age).toBe(0);
    expect(first.boards.richest.top[0]!.name).toBe('lb_cache_00');
    expect(first.boards.richest.you).toEqual({ rank: 12, name: 'lb_cache_11', value: HUGE + 1 });

    // Both would move: someone new on top, and the asker up a place.
    await setWorth(ps[10]!, HUGE + 5_000);
    await setWorth(asker, HUGE + 915);
    const later = await ask(asker, T + CACHE_MS - 1);
    expect(later.age).toBe(CACHE_MS - 1);
    expect(later.boards).toEqual(first.boards);

    const fresh = await ask(asker, T + CACHE_MS);
    expect(fresh.age).toBe(0);
    expect(fresh.boards.richest.top[0]).toEqual({ rank: 1, name: 'lb_cache_10', value: HUGE + 5_000 });
    expect(fresh.boards.richest.you).toEqual({ rank: 11, name: 'lb_cache_11', value: HUGE + 915 });
  });
});

describe('leaderboard reads', () => {
  const plan = async (sql: string, ...args: unknown[]) =>
    (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>()).results.map((r) => r.detail).join('\n');

  it('go through the index each one names', async () => {
    const richestTop = await plan(SQL.richestTop, LEADERBOARD_TOP);
    expect(richestTop).toMatch(/SEARCH casino_accounts USING INDEX idx_casino_accounts_worth/);
    expect(richestTop).not.toMatch(/TEMP B-TREE/);
    expect(await plan(SQL.richestPlace, 1)).toMatch(/SEARCH o USING COVERING INDEX idx_casino_accounts_worth/);

    expect(await plan(SQL.biggestWinTop, LEADERBOARD_TOP, WIN_ROWS)).toMatch(/SEARCH casino_stats USING COVERING INDEX idx_casino_stats_biggest_win/);
    expect(await plan(SQL.biggestWinPlace, 1)).toMatch(/SEARCH casino_stats USING COVERING INDEX idx_casino_stats_biggest_win/);

    // A sum per player can't be indexed: one pass in primary-key order, grouped without sorting.
    for (const sql of [SQL.roundsTop, SQL.roundsTotals]) {
      const p = await plan(sql, ...(sql === SQL.roundsTop ? [LEADERBOARD_TOP] : []));
      expect(p).toMatch(/SCAN casino_stats/);
      expect(p).not.toMatch(/TEMP B-TREE FOR GROUP BY/);
    }
    expect(await plan(SQL.roundsPlace, 1)).toMatch(/SEARCH casino_stats USING PRIMARY KEY \(account_id=\?\)/);
  });

  it("read a bounded number of rows however many players there are", async () => {
    // Enough players and stats that a scan would show.
    const stmts = [];
    for (let i = 0; i < 400; i++) {
      stmts.push(env.DB.prepare(`INSERT INTO casino_accounts (name, balance, created_at, last_seen) VALUES (?1, ?2, 0, 0)`).bind(`lb_bulk_${i}`, 1_000 + i));
    }
    await env.DB.batch(stmts);
    const ids = (await env.DB.prepare(`SELECT id FROM casino_accounts WHERE name LIKE 'lb_bulk_%'`).all<{ id: number }>()).results.map((r) => r.id);
    made.push(...ids);
    await env.DB.batch(ids.flatMap((id, i) => ['blackjack', 'craps'].map((g) => env.DB.prepare(
      `INSERT INTO casino_stats (account_id, game, rounds, wagered, net, biggest_win) VALUES (?1, ?2, 3, 0, 0, ?3)`,
    ).bind(id, g, 100 + i))));

    const read = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all()).meta.rows_read;
    expect(await read(SQL.richestTop, LEADERBOARD_TOP)).toBeLessThanOrEqual(LEADERBOARD_TOP);
    // (The stats table holds 800 rows here; the top ten read a fixed prefix of the index.)
    expect(await read(SQL.biggestWinTop, LEADERBOARD_TOP, WIN_ROWS)).toBeLessThanOrEqual(3 * WIN_ROWS);
    expect(await read(SQL.roundsPlace, ids[0]!)).toBeLessThanOrEqual(GAMES.length);
    // The place counts read only the index entries above you: the richest here has nobody.
    const top = ids[ids.length - 1]!;
    await env.DB.prepare(`UPDATE casino_accounts SET balance = ?2 WHERE id = ?1`).bind(top, HUGE).run();
    expect(await read(SQL.richestPlace, top)).toBeLessThanOrEqual(2);
  });
});
