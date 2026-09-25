// Feats at the tables, end to end: a round earns a feat, the table pays it once in one D1 batch
// (the feat row, a 'grant' ledger row, the balance) and says so to the player and the floor;
// tallies build up at the table and reach D1 at cash-out, once, surviving an eviction; two tables
// reaching one challenge together pay it once; nothing is earned with nothing staked; and every
// cent is still accounted for:
//   SUM(ledger) - SUM(items.price) - SUM(orders.price) = balance + in_play (with no chips out).

import { describe, it, expect } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import type { CasinoTable } from '../src/table/host.ts';
import type { GameEvent, Step } from '../../shared/src/engine.ts';
import { DOLLAR, STARTING_BALANCE } from '../../shared/src/money.ts';
import { featOf } from '../../shared/src/feats.ts';
import { DEFAULT_LOOK } from '../../shared/src/look.ts';
import { featOpId, flushStatements, unlockFeat } from '../src/feats.ts';
import { ORIGIN, TEST_PASSWORD, api, connect, type Client } from './helpers.ts';

let ipSeq = 0;
let aidSeq = 0;
async function account(name: string): Promise<{ token: string; id: number }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `192.0.2.${++ipSeq}` },
      body: JSON.stringify({ name, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { token: body.token, id: body.profile.id };
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function tally(id: number): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(`SELECT key, n FROM casino_tally WHERE account_id = ?1`).bind(id).all<{ key: string; n: number }>();
  return Object.fromEntries(rows.results.map((r) => [r.key, r.n]));
}

async function expectBalanced(id: number): Promise<void> {
  const ledger = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, id);
  const items = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`, id);
  const orders = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`, id);
  const m = await money(id);
  expect(m.in_play).toBe(0);
  expect(ledger - items - orders).toBe(m.balance);
}

/** Wait for a condition the table reaches on its own time (a waitUntil, an alarm). */
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

/** Sit down at a solo table with `chips`. */
async function sit(token: string, game: string, chips = 20_000 * DOLLAR): Promise<Client> {
  const c = (await connect(`solo/${game}`, token, '&station=dc-1')).client!;
  await c.next((m) => m.t === 'table');
  c.send({ t: 'buyin', aid: `b${++aidSeq}`, amount: chips });
  await c.next((m) => m.t === 'seat' && m.status === 'seated');
  return c;
}

/** A round as an engine would report it, committed at the table. */
function play(stub: DurableObjectStub<CasinoTable>, wagered: number, returned: number, events: GameEvent[] = []): Promise<boolean> {
  return runInDurableObject(stub, (t) => {
    const table = t as unknown as Table;
    return table.commit({ state: table.state, events, chips: [{ seat: 0, bet: wagered, payout: returned }], rounds: [{ seat: 0, wagered, returned }] }, Date.now());
  });
}

const longRoll = (win: boolean): GameEvent => ({ type: 'roll', seat: 0, round: 1, bet: 100, target: 400, over: false, chance: 400, roll: 120, win, payout: 0, stack: 0 });

async function cashOut(c: Client): Promise<void> {
  c.send({ t: 'cashout', aid: `c${++aidSeq}` });
  await c.next((m) => m.t === 'seat' && m.status === 'watching', 5_000);
}

describe('a feat earned at a table', () => {
  it('is paid once, in one batch, and the player and the floor both hear of it', async () => {
    const me = await account('ft_first_win');
    const watcher = await account('ft_watcher');
    const w = (await connect('floor', watcher.token)).client!;
    await w.next((m) => m.t === 'hello');
    const c = await sit(me.token, 'dice');
    const stub = soloStub('dice', me.id);

    // a 4% roll that won: first-win and dc-long
    const rolled = Date.now();
    expect(await play(stub, 100, 2_475, [longRoll(true)])).toBe(true);
    const first = await c.next((m) => m.t === 'feat' && m.feat === 'first-win', 5_000);
    const long = await c.next((m) => m.t === 'feat' && m.feat === 'dc-long', 5_000);
    expect(first.at).toBeGreaterThan(0);
    // each comes with the money after it
    const paid = featOf('first-win')!.reward.cash! + featOf('dc-long')!.reward.cash!;
    // the second paid carries both
    expect(Math.max(first.balance.balance, long.balance.balance)).toBe(STARTING_BALANCE - 20_000 * DOLLAR + paid);
    expect(long.balance.inPlay).toBe(20_000 * DOLLAR);

    // the feed
    const feed = await w.next((m) => m.t === 'feat' && m.name === 'ft_first_win' && m.feat === 'dc-long', 5_000);
    expect(feed.id).toBe(me.id);
    // not before the player has seen the roll (a dice result shows for about a second)
    expect(Date.now() - rolled).toBeGreaterThanOrEqual(900);

    // D1: a row per feat, a grant per cash reward, keyed by the feat
    expect(await count(`SELECT count(*) AS n FROM casino_feats WHERE account_id = ?1`, me.id)).toBe(2);
    const grants = await env.DB.prepare(`SELECT op_id, amount, kind FROM casino_ledger WHERE account_id = ?1 AND op_id LIKE 'feat:%' ORDER BY op_id`).bind(me.id).all<any>();
    expect(grants.results).toEqual([
      { op_id: featOpId(me.id, 'dc-long'), amount: featOf('dc-long')!.reward.cash, kind: 'grant' },
      { op_id: featOpId(me.id, 'first-win'), amount: featOf('first-win')!.reward.cash, kind: 'grant' },
    ]);

    // the same moment again pays nothing more
    expect(await play(stub, 100, 2_475, [longRoll(true)])).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(c.msgs.filter((m: any) => m.t === 'feat')).toHaveLength(0);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE account_id = ?1 AND op_id LIKE 'feat:%'`, me.id)).toBe(2);

    await cashOut(c);
    await expectBalanced(me.id);
    c.ws.close(1000, 'bye');
    w.ws.close(1000, 'bye');
  }, 30_000);

  it('the profile and GET /feats show it, and a title earned can be worn (one not earned cannot)', async () => {
    const me = await account('ft_profile');
    const c = await sit(me.token, 'limbo');
    const stub = soloStub('limbo', me.id);
    // a 100x limbo win: first-win, lb-10x, lb-100x; the $10,000 challenge too ($9,900 won... not yet)
    await play(stub, 10_000, 1_000_000, [{ type: 'result', seat: 0, round: 1, bet: 10_000, target: 10_000, result: 12_000, win: true, payout: 1_000_000, stack: 0 }]);
    await c.next((m) => m.t === 'feat' && m.feat === 'lb-100x', 5_000);
    await cashOut(c);

    const got = await until(
      async () => (await (await api('feats', me.token)).json<any>()),
      (b) => (b.tally?.rounds ?? 0) === 1,
    );
    expect(got.feats.map((f: any) => f.feat).sort()).toEqual(['first-win', 'lb-100x', 'lb-10x']);
    expect(got.tally).toEqual({ rounds: 1, won: 990_000, 'won:limbo': 990_000, 'wins:limbo': 1, best: 990_000 });
    // $9,900 won: not yet the $10,000 challenge
    expect(got.feats.some((f: any) => f.feat === 'won-10k')).toBe(false);

    const profile = (await (await api('me', me.token)).json<any>()).profile;
    expect(profile.feats.map((f: any) => f.feat)).toEqual(got.feats.map((f: any) => f.feat));
    expect(profile.owned).toEqual([]);

    // no title has been earned: wearing one is refused
    const put = (look: unknown) => api('me/look', me.token, { method: 'PUT', body: JSON.stringify({ look }) });
    expect((await put({ ...DEFAULT_LOOK, title: 'won-1m' })).status).toBe(403);
    // earn Millionaire the way the table does it, then wear it
    await unlockFeat(env.DB, me.id, 'won-1m', Date.now());
    const worn = await put({ ...DEFAULT_LOOK, outfit: 'suit', title: 'won-1m' });
    expect(worn.status).toBe(200);
    expect((await worn.json<any>()).look.title).toBe('won-1m');
    // the trophy emote comes with it
    expect((await (await api('me', me.token)).json<any>()).profile.owned).toContain('trophy');
    await expectBalanced(me.id);
    c.ws.close(1000, 'bye');
  }, 30_000);

  it('a challenge counts what D1 already has plus what this table has made', async () => {
    const me = await account('ft_challenge');
    // $9,999.99 won somewhere else, already in D1
    await env.DB.prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, 'won', 999_999)`).bind(me.id).run();
    await unlockFeat(env.DB, me.id, 'first-win', 1);
    const start = await money(me.id);
    const c = await sit(me.token, 'dice');
    const stub = soloStub('dice', me.id);
    await play(stub, 100, 200);
    const won = await c.next((m) => m.t === 'feat' && m.feat === 'won-10k', 5_000);
    expect(won.balance.balance).toBe(start.balance - 20_000 * DOLLAR + featOf('won-10k')!.reward.cash!);
    // first-win was had already: not paid again
    await new Promise((r) => setTimeout(r, 200));
    expect(c.msgs.filter((m: any) => m.t === 'feat')).toEqual([]);
    // the unlock sent the tallies first: D1 has the round
    expect((await tally(me.id)).won).toBe(1_000_099);
    await cashOut(c);
    await expectBalanced(me.id);
    c.ws.close(1000, 'bye');
  }, 30_000);

  it('nothing staked earns nothing, and the test game none of it', async () => {
    const me = await account('ft_nothing');
    const c = await sit(me.token, 'dice');
    await play(soloStub('dice', me.id), 0, 0, [longRoll(true)]);
    const h = await sit(me.token, 'highcard');
    await play(soloStub('highcard', me.id), 1_000, 50_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(c.msgs.filter((m: any) => m.t === 'feat')).toHaveLength(0);
    expect(h.msgs.filter((m: any) => m.t === 'feat')).toHaveLength(0);
    await cashOut(c);
    await cashOut(h);
    await new Promise((r) => setTimeout(r, 300));
    expect(await count(`SELECT count(*) AS n FROM casino_feats WHERE account_id = ?1`, me.id)).toBe(0);
    expect(await tally(me.id)).toEqual({});
    c.ws.close(1000, 'bye');
    h.ws.close(1000, 'bye');
  }, 30_000);
});

describe('tallies', () => {
  it('build up at the table, survive an eviction, and land in D1 once at cash-out', async () => {
    const me = await account('ft_tallies');
    // first-win already earned, so these rounds pay nothing and nothing flushes early
    await unlockFeat(env.DB, me.id, 'first-win', 1);
    const c = await sit(me.token, 'dice');
    const stub = soloStub('dice', me.id);
    await play(stub, 1_000, 1_900);
    await play(stub, 1_000, 0);
    await play(stub, 500, 5_000);
    await new Promise((r) => setTimeout(r, 200));
    // nothing in D1 yet but the marker-free nothing
    expect(await tally(me.id)).toEqual({});

    await evictDurableObject(stub);
    // the socket went with the eviction: back again, then stand up
    c.ws.close(1000, 'bye');
    const c2 = (await connect('solo/dice', me.token)).client!;
    await c2.next((m) => m.t === 'table');
    await play(stub, 1_000, 3_000);
    await cashOut(c2);

    const t = await until(() => tally(me.id), (x) => (x.rounds ?? 0) >= 4);
    const marker = Object.keys(t).filter((k) => k.startsWith('flush:'));
    expect(marker).toHaveLength(1);
    delete t[marker[0]!];
    expect(t).toEqual({ rounds: 4, won: 900 + 4_500 + 2_000, 'won:dice': 7_400, 'wins:dice': 3, best: 4_500 });
    // GET /feats never shows the marker
    expect(Object.keys((await (await api('feats', me.token)).json<any>()).tally).some((k) => k.startsWith('flush:'))).toBe(false);
    c2.ws.close(1000, 'bye');
  }, 30_000);

  it('a flush sent twice (its answer lost) counts once; a later one counts', async () => {
    const me = await account('ft_flush_twice');
    const marker = 'flush:test-table';
    const delta = { rounds: 2, won: 500, best: 400 };
    await env.DB.batch(flushStatements(env.DB, me.id, marker, 1, delta));
    await env.DB.batch(flushStatements(env.DB, me.id, marker, 1, delta));
    expect(await tally(me.id)).toEqual({ rounds: 2, won: 500, best: 400, [marker]: 1 });
    await env.DB.batch(flushStatements(env.DB, me.id, marker, 2, { rounds: 1, won: 100, best: 100 }));
    expect(await tally(me.id)).toEqual({ rounds: 3, won: 600, best: 400, [marker]: 2 });
    // an old one arriving late changes nothing
    await env.DB.batch(flushStatements(env.DB, me.id, marker, 1, delta));
    expect((await tally(me.id)).rounds).toBe(3);
    // another table's flushes are fenced on their own
    await env.DB.batch(flushStatements(env.DB, me.id, 'flush:other', 1, { rounds: 1 }));
    expect((await tally(me.id)).rounds).toBe(4);
  });
});

describe('paying a feat', () => {
  it('a retry with the same stamp is one payment, reported as paid both times', async () => {
    const me = await account('ft_idem');
    const before = await money(me.id);
    const a = await unlockFeat(env.DB, me.id, 'won-100k', 42);
    const b = await unlockFeat(env.DB, me.id, 'won-100k', 42, true);
    expect(a.kind).toBe('applied');
    expect(b.kind).toBe('applied');
    const cash = featOf('won-100k')!.reward.cash!;
    expect((await money(me.id)).balance).toBe(before.balance + cash);
    expect(b.kind === 'applied' && b.money?.balance).toBe(before.balance + cash);
    // a first try that finds it paid, even at the same stamp, is some other table that got there first
    expect((await unlockFeat(env.DB, me.id, 'won-100k', 42)).kind).toBe('taken');
    expect((await unlockFeat(env.DB, me.id, 'won-100k', 43, true)).kind).toBe('taken');
    expect((await money(me.id)).balance).toBe(before.balance + cash);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE op_id = ?1`, featOpId(me.id, 'won-100k'))).toBe(1);
    await expectBalanced(me.id);
  });

  it('two tables at once: one pays, the other is told it is taken', async () => {
    const me = await account('ft_race');
    const before = await money(me.id);
    const results = await Promise.all([unlockFeat(env.DB, me.id, 'round-10k', 100), unlockFeat(env.DB, me.id, 'round-10k', 100)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['applied', 'taken']);
    expect((await money(me.id)).balance).toBe(before.balance + featOf('round-10k')!.reward.cash!);
    await expectBalanced(me.id);
  });

  it('two real tables reaching the same challenge together pay it once', async () => {
    const me = await account('ft_two_tables');
    await unlockFeat(env.DB, me.id, 'first-win', 1);
    const dice = await sit(me.token, 'dice', 20_000 * DOLLAR);
    const limbo = await sit(me.token, 'limbo', 20_000 * DOLLAR);
    // $12,000 won in one round at each, at the same moment: round-10k twice over
    await Promise.all([play(soloStub('dice', me.id), 1_000 * DOLLAR, 13_000 * DOLLAR), play(soloStub('limbo', me.id), 1_000 * DOLLAR, 13_000 * DOLLAR)]);
    const rows = await until(
      () => count(`SELECT count(*) AS n FROM casino_feats WHERE account_id = ?1 AND feat = 'round-10k'`, me.id),
      (n) => n > 0,
    );
    expect(rows).toBe(1);
    await new Promise((r) => setTimeout(r, 400));
    const told = [...dice.msgs, ...limbo.msgs].filter((m: any) => m.t === 'feat' && m.feat === 'round-10k');
    expect(told).toHaveLength(1);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE op_id = ?1`, featOpId(me.id, 'round-10k'))).toBe(1);
    await cashOut(dice);
    await cashOut(limbo);
    await expectBalanced(me.id);
    dice.ws.close(1000, 'bye');
    limbo.ws.close(1000, 'bye');
  }, 30_000);

  it('a reward with no cash writes no ledger row', async () => {
    const me = await account('ft_no_cash');
    const before = await money(me.id);
    expect((await unlockFeat(env.DB, me.id, 'round-50k', 7)).kind).toBe('applied');
    expect((await money(me.id)).balance).toBe(before.balance);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE account_id = ?1 AND op_id LIKE 'feat:%'`, me.id)).toBe(0);
    expect((await (await api('me', me.token)).json<any>()).profile.owned).toContain('moonwalk');
  });

  it('an unknown feat is never paid', async () => {
    const me = await account('ft_unknown');
    await expect(unlockFeat(env.DB, me.id, 'not-a-feat', 1)).rejects.toThrow();
    expect(await count(`SELECT count(*) AS n FROM casino_feats WHERE account_id = ?1`, me.id)).toBe(0);
  });
});

describe('GET /feats', () => {
  it('needs a login', async () => {
    const res = await exports.default.fetch(new Request('http://casino.test/casino/api/feats', { headers: { Origin: ORIGIN } }));
    expect(res.status).toBe(401);
  });
});
