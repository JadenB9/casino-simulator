// Crash at a shared table, end to end in the real Durable Object: the table starts its own rounds
// from the first seat (no leader, no Start), two players bet, one cashes out and one rides into
// the crash, and a player who drops mid-flight has their bet settled exactly once (by their auto
// cash-out, or by the crash) with the chips reaching D1 when the grace period runs out.
//
// Lobbies are made the way POST /tables makes them (the floor's createLobby, then the table's
// init). The crash point is put in place by giving the table a generator whose draws steer the
// sampler (shared/test/online-rng.ts); time moves by faking Date and running the table's alarm, so
// the real deadline code decides everything, as in lobby.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { ORIGIN, connect, type Client } from './helpers.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import type { CasinoTable } from '../src/table/host.ts';
import { ALL_IN_MS, BETTING_MS, CRASHED_MS } from '../../shared/src/games/crash/engine.ts';
import { timeTo, multAt } from '../../shared/src/games/crash/rules.ts';
import { forcedCrash, queuedRng } from '../../shared/test/online-rng.ts';

interface Player {
  id: number;
  name: string;
  token: string;
}

let seq = 0;
const nextIp = () => `10.77.${(++seq >> 8) & 255}.${seq & 255}`;

async function player(tag: string): Promise<Player> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': nextIp() },
      body: JSON.stringify({ name: `cs${tag}${++seq}` }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { id: body.profile.id, name: body.profile.name, token: body.token };
}

const floor = (): DurableObjectStub<CasinoFloor> => env.FLOOR.get(env.FLOOR.idFromName('main'));
const table = (id: string): DurableObjectStub<CasinoTable> => env.TABLE.get(env.TABLE.idFromName(id));

async function makeCrashLobby(creator: Player): Promise<string> {
  const made = await floor().createLobby({ game: 'crash', visibility: 'public', accountId: creator.id, ip: nextIp() });
  if ('error' in made) throw new Error(`createLobby refused: ${made.error}`);
  await table(made.tableId).init({ name: made.tableId, game: 'crash', variant: '', mode: 'multi', visibility: 'public', pin: null });
  return made.tableId;
}

async function enter(p: Player, tableId: string): Promise<[Client, any]> {
  const { client } = await connect(`table/${tableId}`, p.token);
  const snap = await client!.next<any>((m) => m.t === 'table');
  return [client!, snap];
}

async function buyIn(c: Client, amount: number): Promise<void> {
  c.send({ t: 'buyin', aid: `buy${++seq}`, amount });
  await c.next((m) => m.t === 'seat' && m.status === 'seated');
}

const act = (c: Client, a: unknown) => c.send({ t: 'act', aid: `a${++seq}`, a });

async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function statsOf(id: number): Promise<{ rounds: number; wagered: number; net: number } | null> {
  return env.DB.prepare(`SELECT rounds, wagered, net FROM casino_stats WHERE account_id = ?1 AND game = 'crash'`).bind(id).first<any>();
}

/** The next flight crashes at `c` hundredths. */
async function steer(tableId: string, c: number): Promise<void> {
  await runInDurableObject(table(tableId), (t) => {
    (t as unknown as { rng: unknown }).rng = queuedRng(forcedCrash(c), 5);
  });
}

function clockAt(t: number): void {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(t);
}

/** Move the clock to `t` and run the table's alarm there. */
async function at(tableId: string, t: number): Promise<void> {
  clockAt(t);
  await runDurableObjectAlarm(table(tableId));
}

afterEach(() => {
  vi.useRealTimers();
});

const has = (type: string) => (m: any) => m.t === 'ev' && m.events.some((e: any) => e.type === type);
const ev = (m: any, type: string) => m.events.find((e: any) => e.type === type);

/** Two players seated at a fresh Crash lobby, the first window open. */
async function twoSeated(buy = 100_000) {
  const a = await player('a');
  const b = await player('b');
  const tableId = await makeCrashLobby(a);
  const [ca, snapA] = await enter(a, tableId);
  const [cb] = await enter(b, tableId);
  const before = { a: await money(a.id), b: await money(b.id) };
  await buyIn(ca, buy);
  const open = await ca.next<any>(has('betting'));
  await buyIn(cb, buy);
  return { a, b, ca, cb, tableId, snapA, open, before };
}

describe('crash at a shared table', () => {
  it('starts with its first seat, no leader Start needed, and opens a 7 s window', async () => {
    const { snapA, open } = await twoSeated();
    expect(snapA.meta).toMatchObject({ game: 'crash', mode: 'multi', started: true });
    expect(open.view).toMatchObject({ phase: 'betting', round: 1, crash: null, launchAt: null, bets: [] });
    expect(ev(open, 'betting').deadline - open.now).toBe(BETTING_MS);
  });

  it('two players: one cashes out on an auto target, one rides into the crash; D1 moves exactly at the edges', async () => {
    const { a, b, ca, cb, tableId, before } = await twoSeated();
    await steer(tableId, 250);
    act(ca, { type: 'bet', amount: 2_000, auto: 150 });
    act(cb, { type: 'bet', amount: 1_000, auto: null });
    await ca.next((m) => m.t === 'seat' && m.stack === 98_000);
    await cb.next((m) => m.t === 'seat' && m.stack === 99_000);
    // Everyone is in: the window closes a second later. Both see both bets, and neither sees A's target.
    const closing = await cb.next<any>(has('closing'));
    expect(ev(closing, 'closing').deadline - closing.now).toBe(ALL_IN_MS);
    expect(closing.view.bets.map((x: any) => [x.name, x.amount, x.auto])).toEqual([
      [a.name, 2_000, null],
      [b.name, 1_000, null],
    ]);

    await at(tableId, ev(closing, 'closing').deadline + 1);
    const launch = await ca.next<any>(has('launch'));
    await cb.next(has('launch'));
    const launchAt = ev(launch, 'launch').launchAt as number;
    // In flight, the crash point is nowhere to be seen.
    expect(launch.view).toMatchObject({ phase: 'running', crash: null, deadline: null });
    expect(JSON.stringify(launch)).not.toContain('250');

    await at(tableId, launchAt + timeTo(150));
    const cashed = await cb.next<any>(has('cashout'));
    expect(ev(cashed, 'cashout')).toMatchObject({ seat: 0, name: a.name, at: 150, amount: 2_000, payout: 3_000, how: 'auto' });
    await ca.next((m) => m.t === 'seat' && m.stack === 101_000);

    await at(tableId, launchAt + timeTo(250));
    const crashed = await ca.next<any>(has('crash'));
    await cb.next(has('crash'));
    expect(ev(crashed, 'crash')).toMatchObject({ crash: 250, busted: [1] });
    expect(crashed.view).toMatchObject({ phase: 'crashed', crash: 250, history: [250] });
    expect(crashed.view.bets.map((x: any) => [x.name, x.cashed, x.payout, x.busted])).toEqual([
      [a.name, 150, 3_000, false],
      [b.name, null, 0, true],
    ]);

    // The next window opens after the wreckage has shown for three seconds.
    await at(tableId, ev(crashed, 'crash').deadline + 1);
    const next = await ca.next<any>(has('betting'));
    expect(next.view).toMatchObject({ phase: 'betting', round: 2, bets: [] });

    // Cash out: each balance changes by exactly what happened in the round.
    ca.send({ t: 'cashout', aid: `c${++seq}` });
    cb.send({ t: 'cashout', aid: `c${++seq}` });
    await ca.next((m) => m.t === 'balance' && m.inPlay === 0);
    await cb.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(await money(a.id)).toEqual({ balance: before.a.balance + 1_000, in_play: 0 });
    expect(await money(b.id)).toEqual({ balance: before.b.balance - 1_000, in_play: 0 });
    expect(await statsOf(a.id)).toEqual({ rounds: 1, wagered: 2_000, net: 1_000 });
    expect(await statsOf(b.id)).toEqual({ rounds: 1, wagered: 1_000, net: -1_000 });
  });

  it('a manual cash-out is judged on the server clock: paid at the curve below the crash, too late after it', async () => {
    const { a, ca, cb, tableId } = await twoSeated();
    await steer(tableId, 300);
    act(ca, { type: 'bet', amount: 1_000, auto: null });
    act(cb, { type: 'bet', amount: 1_000, auto: null });
    const closing = await ca.next<any>(has('closing'));
    await at(tableId, ev(closing, 'closing').deadline + 1);
    const launchAt = ev(await ca.next<any>(has('launch')), 'launch').launchAt as number;

    // A clicks 2.5 s past 2×: paid at whatever the curve reads when the table gets it.
    const t = launchAt + timeTo(200) + 2_500;
    clockAt(t);
    act(ca, { type: 'cashout' });
    const paid = ev(await cb.next<any>(has('cashout')), 'cashout');
    expect(paid.name).toBe(a.name);
    expect(paid.at).toBeGreaterThanOrEqual(multAt(t - launchAt));
    expect(paid.at).toBeLessThan(300);
    expect(paid.payout).toBe(10 * paid.at);

    // B's click reaches the table after the crash moment: the crash comes first and B has lost.
    clockAt(launchAt + timeTo(300) + 40);
    act(cb, { type: 'cashout' });
    const crash = ev(await cb.next<any>(has('crash')), 'crash');
    expect(crash).toMatchObject({ crash: 300, busted: [1] });
    await sleep(50);
    expect(cb.msgs.some(has('cashout'))).toBe(false);
  });

  it('a player who drops mid-flight has the bet settled once, by their auto cash-out, and the chips go home after the grace', async () => {
    const { a, b, ca, cb, tableId, before } = await twoSeated();
    await steer(tableId, 400);
    act(ca, { type: 'bet', amount: 1_000, auto: null });
    act(cb, { type: 'bet', amount: 5_000, auto: 200 });
    const closing = await ca.next<any>(has('closing'));
    await at(tableId, ev(closing, 'closing').deadline + 1);
    const launchAt = ev(await ca.next<any>(has('launch')), 'launch').launchAt as number;

    // B drops at 1.5×. Its bet stays in the air: nothing is paid or refunded on the drop.
    clockAt(launchAt + timeTo(150));
    cb.ws.close(1001, 'network');
    await ca.next((m) => m.t === 'members' && m.members.some((x: any) => x.accountId === b.id && !x.connected));
    const live = await runInDurableObject(table(tableId), (t) => (t as any).members.get(b.id).live);
    expect(live).toBe(5_000);

    // B's auto target at 2.00× pays while B is away; A rides into the crash at 4.00×.
    await at(tableId, launchAt + timeTo(200));
    expect(ev(await ca.next<any>(has('cashout')), 'cashout')).toMatchObject({ name: b.name, at: 200, payout: 10_000, how: 'auto' });
    await at(tableId, launchAt + timeTo(400));
    const crashed = await ca.next<any>(has('crash'));
    expect(ev(crashed, 'crash').busted).toEqual([0]);
    const stackB = 100_000 - 5_000 + 10_000;
    expect(await runInDurableObject(table(tableId), (t) => (t as any).members.get(b.id))).toMatchObject({ stack: stackB, live: 0 });

    // The grace runs out: B is cashed out with exactly that stack, once.
    const grace = await runInDurableObject(table(tableId), (_t, state) =>
      state.storage.sql.exec<{ at: number }>(`SELECT at FROM deadlines WHERE name = ?1`, `grace:${b.id}`).one().at,
    );
    ca.msgs.length = 0;
    await at(tableId, grace + 1);
    await ca.next((m) => m.t === 'members' && !m.members.some((x: any) => x.accountId === b.id));
    expect(await money(b.id)).toEqual({ balance: before.b.balance - 100_000 + stackB, in_play: 0 });
    expect(await statsOf(b.id)).toEqual({ rounds: 1, wagered: 5_000, net: 5_000 });
    // The table rolls on for A.
    await at(tableId, Date.now() + CRASHED_MS);
    expect(await statsOf(a.id)).toBeNull();
  });

  it('standing up mid-flight cashes out on the clock, and the crash pays nothing more', async () => {
    const { b, ca, cb, tableId, before } = await twoSeated();
    await steer(tableId, 500);
    act(ca, { type: 'bet', amount: 1_000, auto: null });
    act(cb, { type: 'bet', amount: 3_000, auto: null });
    const closing = await ca.next<any>(has('closing'));
    await at(tableId, ev(closing, 'closing').deadline + 1);
    const launchAt = ev(await ca.next<any>(has('launch')), 'launch').launchAt as number;

    const t = launchAt + timeTo(250) + 100;
    clockAt(t);
    cb.send({ t: 'leave' });
    const left = ev(await ca.next<any>(has('cashout')), 'cashout');
    expect(left).toMatchObject({ name: b.name, how: 'left', amount: 3_000 });
    expect(left.at).toBeGreaterThanOrEqual(multAt(t - launchAt));
    expect(left.at).toBeLessThan(500);
    // B hears the balance once the chips are home.
    await cb.next((m) => m.t === 'balance' && m.inPlay === 0);
    const stackB = 100_000 - 3_000 + left.payout;
    expect(await money(b.id)).toEqual({ balance: before.b.balance - 100_000 + stackB, in_play: 0 });

    await at(tableId, launchAt + timeTo(500));
    const crash = ev(await ca.next<any>(has('crash')), 'crash');
    expect(crash.busted).toEqual([0]);
    expect(await money(b.id)).toEqual({ balance: before.b.balance - 100_000 + stackB, in_play: 0 });
    expect(await statsOf(b.id)).toEqual({ rounds: 1, wagered: 3_000, net: left.payout - 3_000 });
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
