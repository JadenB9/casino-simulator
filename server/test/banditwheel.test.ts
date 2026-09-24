// The Bandit Wheel through the real table host: a wheel that runs on its own clock with nobody
// pressing Start or Spin, two players betting into one window, a player who drops while the wheel
// turns, one who stands up with chips down, and a restart in the middle of a window.
//
// The server's draw can't be steered here (the host uses the crypto generator), so every check
// holds whatever number comes up: each seat's settlement matches its bets, stacks move by exactly
// what was wagered and returned, and D1 moves only at the edges. Time moves by faking Date (the
// Durable Objects share the test's isolate) and then running the table's alarm.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { ORIGIN, TEST_PASSWORD, connect, type Client } from './helpers.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import { GRACE_MS, RESTART_SHIFT_MS, type CasinoTable } from '../src/table/host.ts';
import { BETTING_MS, SOLO_BETTING_MS, SPIN_MS, SETTLE_MS } from '../../shared/src/games/banditwheel/engine.ts';
import { returnFor, type WheelNumber } from '../../shared/src/games/banditwheel/rules.ts';
import type { Member } from '../../shared/src/protocol.ts';

interface Player {
  id: number;
  name: string;
  token: string;
}

let seq = 0;

/** A fresh address per login, so no test trips another's per-address limits. */
function nextIp(): string {
  seq++;
  return `10.77.${(seq >> 8) & 255}.${seq & 255}`;
}

async function player(tag: string): Promise<Player> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': nextIp() },
      body: JSON.stringify({ name: `bw${tag}${++seq}`, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { id: body.profile.id, name: body.profile.name, token: body.token };
}

function floor(): DurableObjectStub<CasinoFloor> {
  return env.FLOOR.get(env.FLOOR.idFromName('main'));
}

function table(id: string): DurableObjectStub<CasinoTable> {
  return env.TABLE.get(env.TABLE.idFromName(id));
}

/** What POST /tables does. */
async function makeWheel(creator: Player): Promise<string> {
  const made = await floor().createLobby({ game: 'banditwheel', visibility: 'public', accountId: creator.id, ip: nextIp() });
  if ('error' in made) throw new Error(`createLobby refused: ${made.error}`);
  await table(made.tableId).init({ name: made.tableId, game: 'banditwheel', variant: '', mode: 'multi', visibility: 'public', pin: null });
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

function act(c: Client, a: unknown): void {
  c.send({ t: 'act', aid: `act${++seq}`, a });
}

async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function escrow(id: number, tableId: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT amount FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2`).bind(id, tableId).first<any>();
  return row ? row.amount : null;
}

async function deadlines(tableId: string): Promise<Record<string, number>> {
  return runInDurableObject(table(tableId), (_t, state) =>
    Object.fromEntries(state.storage.sql.exec<{ name: string; at: number }>(`SELECT name, at FROM deadlines`).toArray().map((r) => [r.name, r.at])),
  );
}

/** Move the clock (it keeps running from there); deadlines are then run with runDurableObjectAlarm. */
function clockAt(t: number): void {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(t);
}

async function runClock(tableId: string, t: number): Promise<void> {
  clockAt(t);
  await runDurableObjectAlarm(table(tableId));
}

afterEach(() => {
  vi.useRealTimers();
});

const has = (type: string) => (m: any) => m.t === 'ev' && m.events.some((e: any) => e.type === type);
const eventOf = (m: any, type: string) => m.events.find((e: any) => e.type === type);
const find = (members: Member[], id: number) => members.find((m) => m.accountId === id);

/** What a seat's bets bring back on the number that came up. */
function expected(bets: [WheelNumber, number][], slot: number): { wagered: number; returned: number } {
  let wagered = 0;
  let returned = 0;
  for (const [key, amount] of bets) {
    wagered += amount;
    returned += returnFor(key, slot, amount);
  }
  return { wagered, returned };
}

/** Two players seated at a fresh wheel with $500 each; the first window is open. */
async function twoAtTheWheel(buy = 50_000) {
  const a = await player('ann');
  const b = await player('bo');
  const tableId = await makeWheel(a);
  const [ca, snapA] = await enter(a, tableId);
  const [cb] = await enter(b, tableId);
  const before = { a: await money(a.id), b: await money(b.id) };
  await buyIn(ca, buy);
  const open = await ca.next<any>(has('betting'));
  await buyIn(cb, buy);
  return { a, b, ca, cb, tableId, before, snapA, deadline: eventOf(open, 'betting').deadline as number };
}

// ---------------------------------------------------------------------------------------------

describe('bandit wheel at the table host', () => {
  it('starts with its first seat, with nobody pressing Start, and runs a window on its own clock', async () => {
    const { ca, snapA, deadline, tableId } = await twoAtTheWheel();
    expect(snapA.meta).toMatchObject({ game: 'banditwheel', mode: 'multi', started: true });
    expect(snapA.view).toMatchObject({ phase: 'idle', window: BETTING_MS });
    expect(deadline - Date.now()).toBeGreaterThan(BETTING_MS - 5_000);
    expect(deadline - Date.now()).toBeLessThanOrEqual(BETTING_MS);
    // the table's alarm is set for the close
    expect(await runInDurableObject(table(tableId), async (_t, state) => state.storage.getAlarm())).toBe(deadline);
    ca.ws.close();
  });

  it('two players bet into one window; the clock spins the wheel and settles both', async () => {
    const { a, b, ca, cb, tableId, before, deadline } = await twoAtTheWheel();
    act(ca, { type: 'bet', bets: [{ spot: 1, amount: 1_000 }, { spot: 20, amount: 500 }] });
    await ca.next((m) => m.t === 'seat' && m.stack === 48_500);
    // Max with a $500 stack under the $1,000 limit is the whole stack
    act(cb, { type: 'max', spot: 3 });
    await cb.next((m) => m.t === 'seat' && m.stack === 0);
    // every seat sees every bet
    const seen = await ca.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'bet' && e.seat === 1));
    expect(seen.view.bets).toEqual({ 0: { 1: 1_000, 20: 500 }, 1: { 3: 50_000 } });
    // a number that isn't on the wheel, and more than a number takes, are refused
    act(ca, { type: 'bet', bets: [{ spot: 2, amount: 100 }] });
    act(ca, { type: 'bet', bets: [{ spot: 5, amount: 100_100 }] });
    const errs = [await ca.next<any>((m) => m.t === 'err'), await ca.next<any>((m) => m.t === 'err')].map((m) => m.code);
    expect(errs.sort()).toEqual(['BAD_REQUEST', 'LIMIT']);
    // nobody may spin a shared wheel
    act(ca, { type: 'spin' });
    expect((await ca.next<any>((m) => m.t === 'err')).code).toBe('BAD_REQUEST');

    // D1 hasn't moved since the buy-ins
    expect(await money(a.id)).toEqual({ balance: before.a.balance - 50_000, in_play: 50_000 });

    // the window is still open a moment before the deadline...
    await runClock(tableId, deadline - 50);
    expect(ca.msgs.some(has('spin'))).toBe(false);
    // ...and closes on it
    await runClock(tableId, deadline + 1);
    const evA = await ca.next<any>(has('spin'));
    const evB = await cb.next<any>(has('spin'));
    const spin = eventOf(evA, 'spin');
    const settle = eventOf(evA, 'settle');
    expect(eventOf(evB, 'spin')).toEqual(spin);
    expect(spin.restAt - spin.startAt).toBe(SPIN_MS);
    expect(settle.slot).toBe(spin.slot);
    const wantA = expected([[1, 1_000], [20, 500]], spin.slot);
    const wantB = expected([[3, 50_000]], spin.slot);
    expect(settle.seats['0']).toMatchObject(wantA);
    expect(settle.seats['1']).toMatchObject(wantB);
    expect(evA.view).toMatchObject({ phase: 'results', bets: {}, deadline: spin.restAt + SETTLE_MS, history: [spin.slot] });

    // the stacks move by exactly what came back
    const stackA = 48_500 + wantA.returned;
    const stackB = wantB.returned;
    if (wantA.returned > 0) await ca.next((m) => m.t === 'seat' && m.stack === stackA);
    if (wantB.returned > 0) await cb.next((m) => m.t === 'seat' && m.stack === stackB);
    ca.send({ t: 'sync' });
    expect((await ca.next<any>((m) => m.t === 'table')).you.stack).toBe(stackA);

    // no more bets while the wheel turns and pays
    ca.msgs.length = 0;
    act(ca, { type: 'bet', bets: [{ spot: 1, amount: 100 }] });
    expect((await ca.next<any>((m) => m.t === 'err')).code).toBe('WRONG_PHASE');

    // the next window opens by itself when the result has stood
    await runClock(tableId, spin.restAt + SETTLE_MS + 1);
    const next = await ca.next<any>(has('betting'));
    expect(next.view).toMatchObject({ phase: 'betting', round: 2, settled: {} });

    // cash out: D1 gets exactly the settled stacks
    ca.send({ t: 'cashout', aid: `out${++seq}` });
    await ca.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(await money(a.id)).toEqual({ balance: before.a.balance - 50_000 + stackA, in_play: 0 });
    expect(await escrow(a.id, tableId)).toBeNull();
    if (stackB === 0) {
      // lost it all: the busted seat is cashed out at $0 straight away
      await cb.next((m) => m.t === 'seat' && m.status === 'watching');
    } else {
      cb.send({ t: 'cashout', aid: `out${++seq}` });
    }
    await cb.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(await money(b.id)).toEqual({ balance: before.b.balance - 50_000 + stackB, in_play: 0 });
    const stats = await env.DB.prepare(`SELECT rounds, wagered FROM casino_stats WHERE account_id = ?1 AND game = 'banditwheel'`).bind(a.id).first<any>();
    expect(stats).toEqual({ rounds: 1, wagered: 1_500 });
  });

  it('a player who drops while the wheel turns is already paid, held, and sees the result on coming back', async () => {
    const { a, ca, cb, tableId, deadline } = await twoAtTheWheel();
    act(ca, { type: 'bet', bets: [{ spot: 1, amount: 2_000 }, { spot: 5, amount: 1_000 }, { spot: 10, amount: 500 }] });
    await ca.next((m) => m.t === 'seat' && m.stack === 46_500);
    await runClock(tableId, deadline + 1);
    const ev = await ca.next<any>(has('spin'));
    const spin = eventOf(ev, 'spin');
    const want = expected([[1, 2_000], [5, 1_000], [10, 500]], spin.slot);
    const stack = 46_500 + want.returned;

    // mid-spin: the socket goes
    clockAt(spin.startAt + 2_500);
    ca.ws.close(1001, 'network');
    const held = await cb.next<any>((m) => m.t === 'members' && find(m.members, a.id)?.connected === false);
    expect(find(held.members, a.id)).toMatchObject({ status: 'seated', stack });
    expect(Object.keys(await deadlines(tableId))).toContain(`grace:${a.id}`);

    // back before the wheel stops: the seat, the settled stack, and the spin to finish watching
    clockAt(spin.restAt - 1_000);
    const [again, snap] = await enter(a, tableId);
    expect(snap.you).toMatchObject({ seat: 0, status: 'seated', stack });
    const { type: _type, ...info } = spin;
    expect(snap.view).toMatchObject({ phase: 'results', spin: info, settled: { 0: { wagered: want.wagered, returned: want.returned } } });
    expect(Object.keys(await deadlines(tableId))).not.toContain(`grace:${a.id}`);

    // the wheel didn't wait for anyone: the next window opens on time for both
    await runClock(tableId, spin.restAt + SETTLE_MS + 1);
    await again.next(has('betting'));
    await cb.next(has('betting'));
    again.ws.close();
    cb.ws.close();
  });

  it('a player who drops mid-spin and never comes back is cashed out with what the spin paid', async () => {
    const { a, ca, cb, tableId, before, deadline } = await twoAtTheWheel();
    act(ca, { type: 'bet', bets: [{ spot: 3, amount: 5_000 }, { spot: 20, amount: 1_000 }] });
    await ca.next((m) => m.t === 'seat' && m.stack === 44_000);
    await runClock(tableId, deadline + 1);
    const spin = eventOf(await ca.next<any>(has('spin')), 'spin');
    const want = expected([[3, 5_000], [20, 1_000]], spin.slot);
    clockAt(spin.startAt + 1_000);
    ca.ws.close(1001, 'network');
    await cb.next((m) => m.t === 'members' && find(m.members, a.id)?.connected === false);
    // nothing of theirs is live after "No more bets", so only the grace period holds the seat
    const grace = (await deadlines(tableId))[`grace:${a.id}`]!;
    expect(grace - Date.now()).toBeGreaterThan(GRACE_MS - 5_000);
    // the wheel keeps going without them through the grace period
    await runClock(tableId, spin.restAt + SETTLE_MS + 1);
    await cb.next(has('betting'));
    await runClock(tableId, grace + 1);
    await cb.next((m) => m.t === 'members' && !find(m.members, a.id));
    expect(await escrow(a.id, tableId)).toBeNull();
    expect(await money(a.id)).toEqual({ balance: before.a.balance - 50_000 + 44_000 + want.returned, in_play: 0 });
  });

  it('a player who stands up with chips down gets them back, and the wheel spins on for the rest', async () => {
    const { a, ca, cb, tableId, before, deadline } = await twoAtTheWheel();
    act(ca, { type: 'bet', bets: [{ spot: 1, amount: 3_000 }, { spot: 10, amount: 2_000 }] });
    act(ca, { type: 'max', spot: 20 });
    await ca.next((m) => m.t === 'seat' && m.stack === 0);
    act(cb, { type: 'bet', bets: [{ spot: 5, amount: 700 }] });
    await cb.next((m) => m.t === 'seat' && m.stack === 49_300);

    ca.send({ t: 'leave' });
    // everyone sees the chips come off the terminal...
    const off = await cb.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'bet' && e.seat === 0 && Object.keys(e.bets).length === 0));
    expect(eventOf(off, 'bet').bets).toEqual({});
    expect(off.view.bets).toEqual({ 1: { 5: 700 } });
    // ...and every cent goes home
    const bal = await ca.next<any>((m) => m.t === 'balance' && m.inPlay === 0);
    expect(bal.balance).toBe(before.a.balance);
    expect(await escrow(a.id, tableId)).toBeNull();
    await cb.next((m) => m.t === 'members' && !find(m.members, a.id));

    // the other player's bet still plays when the clock runs out
    await runClock(tableId, deadline + 1);
    const ev = await cb.next<any>(has('spin'));
    const settle = eventOf(ev, 'settle');
    expect(Object.keys(settle.seats)).toEqual(['1']);
    expect(settle.seats['1']).toMatchObject(expected([[5, 700]], settle.slot));
    cb.ws.close();
  });

  it('a restart in the middle of a window keeps the chips down and pushes the close back', async () => {
    const { a, b, ca, tableId, deadline } = await twoAtTheWheel();
    act(ca, { type: 'bet', bets: [{ spot: 3, amount: 1_000 }] });
    await ca.next((m) => m.t === 'seat' && m.stack === 49_000);
    await evictDurableObject(table(tableId), { webSockets: 'close' });

    const [again, snap] = await enter(a, tableId);
    expect(snap.you).toMatchObject({ seat: 0, status: 'seated', stack: 49_000 });
    expect(snap.view).toMatchObject({ phase: 'betting', bets: { 0: { 3: 1_000 } }, deadline: deadline + RESTART_SHIFT_MS });
    expect(find(snap.members, b.id)).toMatchObject({ status: 'seated', connected: false });

    // the old close passes without a spin; the new one spins
    await runClock(tableId, deadline + 1);
    expect(again.msgs.some(has('spin'))).toBe(false);
    await runClock(tableId, deadline + RESTART_SHIFT_MS + 1);
    const settle = eventOf(await again.next<any>(has('spin')), 'settle');
    expect(settle.seats['0']).toMatchObject(expected([[3, 1_000]], settle.slot));
    again.ws.close();
  });

  it('spins with nobody betting, and rests once everyone has gone', async () => {
    const { ca, cb, tableId, deadline } = await twoAtTheWheel();
    await runClock(tableId, deadline + 1);
    const ev = await ca.next<any>(has('spin'));
    expect(eventOf(ev, 'settle').seats).toEqual({});
    expect(ev.view.history).toHaveLength(1);
    ca.send({ t: 'leave' });
    cb.send({ t: 'leave' });
    await ca.next((m) => m.t === 'balance' && m.inPlay === 0);
    await cb.next((m) => m.t === 'balance' && m.inPlay === 0);
    const spin = eventOf(ev, 'spin');
    await runClock(tableId, spin.restAt + SETTLE_MS + 1);
    const phase = await runInDurableObject(table(tableId), (_t, state) => JSON.parse(state.storage.sql.exec<{ json: string }>(`SELECT json FROM state`).one().json).phase);
    expect(phase).toBe('idle');
  });
});

describe('bandit wheel alone', () => {
  it('runs the same loop with a shorter window, and Spin now spins at once', async () => {
    const p = await player('solo');
    const { client } = await connect('solo/banditwheel', p.token);
    const c = client!;
    const hello = await c.next<any>((m) => m.t === 'table');
    expect(hello.meta).toMatchObject({ game: 'banditwheel', mode: 'solo' });
    c.send({ t: 'buyin', aid: 'b1', amount: 20_000 });
    const open = await c.next<any>(has('betting'));
    expect(eventOf(open, 'betting').deadline - Date.now()).toBeGreaterThan(SOLO_BETTING_MS - 5_000);
    expect(open.view.window).toBe(SOLO_BETTING_MS);
    act(c, { type: 'spin' });
    expect((await c.next<any>((m) => m.t === 'err')).code).toBe('WRONG_PHASE');
    act(c, { type: 'bet', bets: [{ spot: 10, amount: 1_000 }] });
    await c.next((m) => m.t === 'seat' && m.stack === 19_000);
    act(c, { type: 'spin' });
    const ev = await c.next<any>(has('spin'));
    const spin = eventOf(ev, 'spin');
    expect(spin.restAt - spin.startAt).toBe(SPIN_MS);
    expect(eventOf(ev, 'settle').seats['0']).toMatchObject(expected([[10, 1_000]], spin.slot));
    c.send({ t: 'cashout', aid: 'c1' });
    await c.next((m) => m.t === 'balance' && m.inPlay === 0);
  });
});
