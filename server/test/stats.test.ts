// GET /stats and the tallies behind it, end to end: rounds played at a real table reach D1 as the
// leaderboards' keys (lost, the worst round, wins, rounds per game, the run of wins, today's net)
// with the feats' own flush, and the stats sheet reads them beside the lifetime figures from the
// cash-outs. Only the asker's own record is ever sent.

import { describe, expect, it } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { CasinoTable } from '../src/table/host.ts';
import type { Step } from '../../shared/src/engine.ts';
import { DOLLAR, STARTING_BALANCE } from '../../shared/src/money.ts';
import type { LeaderboardResponse, StatsResponse } from '../../shared/src/protocol.ts';
import { STATS_DAYS, addDays, dayKey, vegasDay } from '../../shared/src/stats.ts';
import { clearLeaderboardCache } from '../src/leaderboard.ts';
import { ORIGIN, TEST_PASSWORD, api, connect, featsHad, type Client } from './helpers.ts';

let ipSeq = 0;
let aidSeq = 0;
async function account(name: string): Promise<{ token: string; id: number }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `198.51.100.${++ipSeq}` },
      body: JSON.stringify({ name, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { token: body.token, id: body.profile.id };
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
}

type Table = { state: unknown; commit(s: Step<unknown>, now: number): boolean };

function soloStub(game: string, id: number): DurableObjectStub<CasinoTable> {
  return env.TABLE.get(env.TABLE.idFromName(`solo:${game}:-:${id}`)) as DurableObjectStub<CasinoTable>;
}

async function sit(token: string, game: string, chips = 20_000 * DOLLAR): Promise<Client> {
  const c = (await connect(`solo/${game}`, token, '&station=dc-1')).client!;
  await c.next((m) => m.t === 'table');
  c.send({ t: 'buyin', aid: `b${++aidSeq}`, amount: chips });
  await c.next((m) => m.t === 'seat' && m.status === 'seated');
  return c;
}

/** Rounds as an engine would report them, committed at the table one step each. */
async function play(stub: DurableObjectStub<CasinoTable>, rounds: [wagered: number, returned: number][]): Promise<void> {
  for (const [wagered, returned] of rounds) {
    const ok = await runInDurableObject(stub, (t) => {
      const table = t as unknown as Table;
      return table.commit({ state: table.state, events: [], chips: [{ seat: 0, bet: wagered, payout: returned }], rounds: [{ seat: 0, wagered, returned }] }, Date.now());
    });
    expect(ok).toBe(true);
  }
}

async function cashOut(c: Client): Promise<void> {
  c.send({ t: 'cashout', aid: `c${++aidSeq}` });
  await c.next((m) => m.t === 'seat' && m.status === 'watching', 5_000);
}

const stats = async (token: string) => (await api('stats', token)).json<StatsResponse>();

describe('GET /stats', () => {
  it('needs a login and answers GET only', async () => {
    const me = await account('st_auth');
    expect((await exports.default.fetch(new Request('http://casino.test/casino/api/stats', { headers: { Origin: ORIGIN } }))).status).toBe(401);
    expect((await api('stats', 'v1.not.a-token')).status).toBe(401);
    expect((await api('stats', me.token, { method: 'POST' })).status).toBe(404);
    const ok = await api('stats', me.token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
  });

  it("a new player's sheet: their money, nothing played, fourteen quiet days ending today", async () => {
    const me = await account('st_new');
    const s = await stats(me.token);
    expect(s.name).toBe('st_new');
    expect(s.worth).toEqual({ balance: STARTING_BALANCE, inPlay: 0, total: STARTING_BALANCE });
    expect(s.total).toEqual({ rounds: 0, wagered: 0, net: 0, biggestWin: 0, counted: 0, wins: 0, won: 0, lost: 0, biggestLoss: 0 });
    expect(s.games).toEqual({});
    expect(s.days).toHaveLength(STATS_DAYS);
    const today = vegasDay(Date.now());
    expect(s.days.at(-1)).toEqual({ day: today, net: 0 });
    expect(s.days[0]!.day).toBe(addDays(today, -(STATS_DAYS - 1)));
    expect([s.streak, s.feats, s.celebs, s.collection]).toEqual([0, 0, 0, 0]);
  });

  it('counts rounds played at a table: won, lost, the worst round, the run of wins, today, and the lifetime line', async () => {
    const me = await account('st_play');
    // feats already had, so no feat is paid and nothing but the tallies moves
    await featsHad(me.id);
    const c = await sit(me.token, 'dice');
    const stub = soloStub('dice', me.id);
    // win, lose, push, win, win, win, lose: a run of three
    await play(stub, [[1_000, 2_000], [1_000, 0], [1_000, 1_000], [500, 900], [500, 1_000], [2_000, 2_100], [3_000, 500]]);
    await cashOut(c);

    const s = await until(() => stats(me.token), (x) => x.total.counted >= 7 && x.total.rounds >= 7);
    const won = 1_000 + 400 + 500 + 100;
    const lost = 1_000 + 2_500;
    const line = { rounds: 7, wagered: 9_000, net: won - lost, biggestWin: 1_000, counted: 7, wins: 4, won, lost, biggestLoss: 2_500 };
    expect(s.games.dice).toEqual(line);
    expect(s.total).toEqual(line);
    expect(s.streak).toBe(3);
    expect(s.days.at(-1)).toEqual({ day: vegasDay(Date.now()), net: won - lost });
    expect(s.worth.total).toBe(STARTING_BALANCE + won - lost + (await featCash(me.id)));
    expect(s.feats).toBeGreaterThan(0);
    c.ws.close(1000, 'bye');

    // ...and the boards see it: today's losers, the lost board.
    clearLeaderboardCache();
    const lb = await (await api('leaderboard', me.token)).json<LeaderboardResponse>();
    const onBoard = (b: 'lost' | 'biggestLoss' | 'todayDown') => lb.boards[b]!.you ?? lb.boards[b]!.top.find((r) => r.you);
    expect(onBoard('lost')).toMatchObject({ value: lost });
    expect(onBoard('biggestLoss')).toMatchObject({ value: 2_500 });
    expect(onBoard('todayDown')).toMatchObject({ value: won - lost });
    expect(onBoard('todayDown')!.rank).not.toBeNull();
  }, 30_000);

  it('adds up the celebrities met, the things kept and the feats, and reads no one else', async () => {
    const me = await account('st_extra');
    const other = await account('st_other');
    const today = vegasDay(Date.now());
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, 'celeb:maddox', 2), (?1, 'celeb:rhea', 1), (?1, 'celeb:zed', 0), (?1, ?2, -700), (?1, ?3, 400)`).bind(
        me.id,
        dayKey(today),
        dayKey(addDays(today, -3)),
      ),
      env.DB.prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, 'celeb:maddox', 5), (?1, ?2, 99999), (?1, 'won', 12345)`).bind(other.id, dayKey(today)),
      env.DB.prepare(`INSERT INTO casino_items (account_id, item, price, bought_at, op_id) VALUES (?1, 'grill', 5000, 0, 'st:1'), (?1, 'top-hat', 700, 0, 'st:2')`).bind(me.id),
      env.DB.prepare(`INSERT INTO casino_feats (account_id, feat, at) VALUES (?1, 'first-win', 1), (?1, 'won-10k', 2)`).bind(me.id),
      env.DB.prepare(`INSERT INTO casino_stats (account_id, game, rounds, wagered, net, biggest_win) VALUES (?1, 'roulette', 40, 9000, -1200, 3500)`).bind(me.id),
    ]);
    const s = await stats(me.token);
    expect(s.celebs).toBe(2);
    expect(s.collection).toBe(5_700);
    expect(s.feats).toBe(2);
    expect(s.days.at(-1)!.net).toBe(-700);
    expect(s.days.at(-4)!.net).toBe(400);
    // pre-tally history: lifetime from the cash-outs, nothing counted yet
    expect(s.games.roulette).toEqual({ rounds: 40, wagered: 9_000, net: -1_200, biggestWin: 3_500, counted: 0, wins: 0, won: 0, lost: 0, biggestLoss: 0 });
    expect(s.total.won).toBe(0);
    expect(JSON.stringify(s)).not.toContain('st_other');
    expect(JSON.stringify(s)).not.toMatch(/"(id|accountId|account_id)"/);
  });
});

/** Cash the feats already had paid this account (featsHad grants no cash, but be exact). */
async function featCash(id: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1 AND kind = 'grant' AND op_id LIKE 'feat:%'`).bind(id).first<{ n: number }>();
  return r!.n;
}
