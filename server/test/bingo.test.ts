// Bingo through the real table host: a hall that runs on its own clock with nobody pressing
// Start, two players buying cards in one sale, the caller calling ball after ball on the alarm,
// a player who stands up with cards in play (held until the game ends, then cashed out with
// what the cards won), and one who stands up during the sale (cards refunded at once).
//
// The server's draw can't be steered here, so every check holds whatever balls come: each prize
// matches the cards and the balls called, stacks move by exactly what was bought and won, and
// D1 moves only at the edges. Time moves by faking Date and running the table's alarm.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { ORIGIN, TEST_PASSWORD, connect, type Client } from './helpers.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import type { CasinoTable } from '../src/table/host.ts';
import { BUY_MS } from '../../shared/src/games/bingo/engine.ts';
import { PATTERNS, completions, prizeFor } from '../../shared/src/games/bingo/rules.ts';
import type { CardView } from '../../shared/src/games/bingo/protocol.ts';
import type { Member } from '../../shared/src/protocol.ts';
import { engineFor } from '../../shared/src/games/index.ts';
import { hasLimitChoice, standardLimits } from '../../shared/src/limits.ts';
import { describeWin } from '../src/floor/wins.ts';

interface Player {
  id: number;
  name: string;
  token: string;
}

let seq = 0;

function nextIp(): string {
  seq++;
  return `10.78.${(seq >> 8) & 255}.${seq & 255}`;
}

async function player(tag: string): Promise<Player> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': nextIp() },
      body: JSON.stringify({ name: `bg${tag}${++seq}`, password: TEST_PASSWORD }),
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

async function makeHall(creator: Player): Promise<string> {
  const made = await floor().createLobby({ game: 'bingo', visibility: 'public', accountId: creator.id, ip: nextIp() });
  if ('error' in made) throw new Error(`createLobby refused: ${made.error}`);
  await table(made.tableId).init({ name: made.tableId, game: 'bingo', variant: '', mode: 'multi', visibility: 'public', pin: null });
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

function clockAt(t: number): void {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(t);
}

async function runClock(tableId: string, t: number): Promise<void> {
  clockAt(t);
  await runDurableObjectAlarm(table(tableId));
}

async function alarmAt(tableId: string): Promise<number | null> {
  return runInDurableObject(table(tableId), async (_t, state) => state.storage.getAlarm());
}

/** The engine's own next deadline (the sale's close, the next ball), from the table's stored state. */
async function engineDeadline(tableId: string): Promise<number | null> {
  return runInDurableObject(table(tableId), (_t, state) => {
    const row = state.storage.sql.exec<{ json: string }>(`SELECT json FROM state WHERE id = 1`).toArray()[0];
    return row ? (JSON.parse(row.json).deadline as number | null) : null;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

const has = (type: string) => (m: any) => m.t === 'ev' && m.events.some((e: any) => e.type === type);
const eventOf = (m: any, type: string) => m.events.find((e: any) => e.type === type);
const find = (members: Member[], id: number) => members.find((m) => m.accountId === id);

/** Every event a client has seen so far, in order (its messages are consumed by next(); keep a copy). */
function allEvents(log: any[]): any[] {
  return log.filter((m) => m.t === 'ev').flatMap((m) => m.events);
}

/** Run the caller's clock until the game ends. Returns the balls called. */
async function callToTheEnd(tableId: string, watch: Client): Promise<number[]> {
  const balls: number[] = [];
  for (let guard = 0; guard < 80; guard++) {
    const at = await engineDeadline(tableId);
    if (at === null) throw new Error('no deadline while calling');
    await runClock(tableId, at + 1);
    const ev = await watch.next<any>((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'ball'));
    balls.push(eventOf(ev, 'ball').ball);
    if (ev.events.some((e: any) => e.type === 'end')) return balls;
  }
  throw new Error('the game never ended');
}

/** What a set of cards wins on these balls. */
function winnings(cards: CardView[], balls: number[]): number {
  const at = new Array<number>(76).fill(Infinity);
  balls.forEach((b, i) => (at[b] = i + 1));
  let won = 0;
  for (const c of cards) {
    const done = completions(c.nums, at);
    for (const p of PATTERNS) if (done[p] <= balls.length) won += prizeFor(p, done[p], c.stake);
  }
  return won;
}

async function twoInTheHall(buy = 50_000) {
  const a = await player('ann');
  const b = await player('bo');
  const tableId = await makeHall(a);
  const [ca, snapA] = await enter(a, tableId);
  const [cb] = await enter(b, tableId);
  const logA: any[] = [];
  const logB: any[] = [];
  ca.ws.addEventListener('message', (e) => typeof e.data === 'string' && e.data !== 'pong' && logA.push(JSON.parse(e.data)));
  cb.ws.addEventListener('message', (e) => typeof e.data === 'string' && e.data !== 'pong' && logB.push(JSON.parse(e.data)));
  const before = { a: await money(a.id), b: await money(b.id) };
  await buyIn(ca, buy);
  const open = await ca.next<any>(has('buying'));
  await buyIn(cb, buy);
  return { a, b, ca, cb, tableId, before, snapA, logA, logB, deadline: eventOf(open, 'buying').deadline as number };
}

describe('bingo at the table host', () => {
  it('opens a sale with its first seat, calls a whole game on the clock, and pays both seats exactly', { timeout: 120_000 }, async () => {
    const { a, b, ca, cb, tableId, before, snapA, logA, logB, deadline } = await twoInTheHall();
    expect(snapA.meta).toMatchObject({ game: 'bingo', mode: 'multi', started: true });
    expect(deadline - Date.now()).toBeLessThanOrEqual(BUY_MS);
    expect(await alarmAt(tableId)).toBe(deadline);

    act(ca, { type: 'buy', count: 3, stake: 500 });
    await ca.next((m) => m.t === 'seat' && m.stack === 48_500);
    act(cb, { type: 'max', count: 4 });
    await cb.next((m) => m.t === 'seat' && m.stack === 0);
    // nobody may start a shared hall; a fifth card is refused
    act(ca, { type: 'call' });

    expect((await ca.next<any>((m) => m.t === 'err')).code).toBe('BAD_REQUEST');
    act(ca, { type: 'buy', count: 2, stake: 100 });
    expect((await ca.next<any>((m) => m.t === 'err')).code).toBe('LIMIT');
    // D1 hasn't moved since the buy-ins
    expect(await money(a.id)).toEqual({ balance: before.a.balance - 50_000, in_play: 50_000 });

    await runClock(tableId, (await engineDeadline(tableId))! + 1);
    const down = await ca.next<any>(has('eyesdown'));
    expect(eventOf(down, 'eyesdown')).toMatchObject({ cards: 7 });
    expect(down.view.called).toEqual([]);
    const balls = await callToTheEnd(tableId, ca);

    // each player saw their own cards' numbers and nobody else's
    const cardsA: CardView[] = allEvents(logA).filter((e) => e.type === 'cards').flatMap((e) => e.cards);
    const cardsB: CardView[] = allEvents(logB).filter((e) => e.type === 'cards').flatMap((e) => e.cards);
    expect(cardsA).toHaveLength(3);
    expect(cardsB).toHaveLength(4);
    expect(allEvents(logA).filter((e) => e.type === 'cards' && e.seat !== 0)).toEqual([]);
    expect(allEvents(logB).filter((e) => e.type === 'cards' && e.seat !== 1)).toEqual([]);
    expect(cardsB.every((c) => c.stake === 12_500)).toBe(true);
    // no message carried a ball before it was called
    let told = 0;
    for (const m of logB) {
      if (m.t !== 'ev') continue;
      told += m.events.filter((e: any) => e.type === 'ball').length;
      expect(m.view.called.length).toBeLessThanOrEqual(told);
      expect(JSON.stringify(m)).not.toContain('"order"');
    }

    const wonA = winnings(cardsA, balls);
    const wonB = winnings(cardsB, balls);
    const end = allEvents(logA).find((e) => e.type === 'end');
    expect(end.seats['0']).toEqual({ wagered: 1_500, returned: wonA });
    expect(end.seats['1']).toEqual({ wagered: 50_000, returned: wonB });

    // cash out: D1 gets exactly the settled stacks
    ca.send({ t: 'cashout', aid: `out${++seq}` });
    await ca.next((m) => m.t === 'balance' && m.inPlay === 0, 5000);
    expect(await money(a.id)).toEqual({ balance: before.a.balance - 1_500 + wonA, in_play: 0 });
    expect(await escrow(a.id, tableId)).toBeNull();
    if (wonB > 0) {
      cb.send({ t: 'cashout', aid: `out${++seq}` });
    }
    await cb.next((m) => m.t === 'balance' && m.inPlay === 0, 5000);
    expect(await money(b.id)).toEqual({ balance: before.b.balance - 50_000 + wonB, in_play: 0 });
    const stats = await env.DB.prepare(`SELECT rounds, wagered FROM casino_stats WHERE account_id = ?1 AND game = 'bingo'`).bind(a.id).first<any>();
    expect(stats).toEqual({ rounds: 1, wagered: 1_500 });
  });

  it('a player who stands up in the sale gets the cards\' price back at once', async () => {
    const { a, ca, cb, tableId, before } = await twoInTheHall();
    act(ca, { type: 'buy', count: 4, stake: 1_000 });
    await ca.next((m) => m.t === 'seat' && m.stack === 46_000);
    ca.send({ t: 'leave' });
    const bal = await ca.next<any>((m) => m.t === 'balance' && m.inPlay === 0, 5000);
    expect(bal.balance).toBe(before.a.balance);
    expect(await escrow(a.id, tableId)).toBeNull();
    await cb.next((m) => m.t === 'members' && !find(m.members, a.id));
    cb.ws.close();
  });

  it('a player who stands up with cards in play is held until the game ends, then paid what they won', { timeout: 120_000 }, async () => {
    const { a, ca, cb, tableId, before, logA, logB } = await twoInTheHall();
    act(ca, { type: 'buy', count: 2, stake: 2_000 });
    await ca.next((m) => m.t === 'seat' && m.stack === 46_000);
    act(cb, { type: 'buy', count: 1, stake: 100 });
    await cb.next((m) => m.t === 'seat' && m.stack === 49_900);
    await runClock(tableId, (await engineDeadline(tableId))! + 1);
    await cb.next(has('eyesdown'));
    const cardsA: CardView[] = allEvents(logA).filter((e) => e.type === 'cards').flatMap((e) => e.cards);
    // the first ball, then up
    await runClock(tableId, (await engineDeadline(tableId))! + 1);
    await cb.next(has('ball'));
    ca.send({ t: 'leave' });
    const held = await cb.next<any>((m) => m.t === 'members' && find(m.members, a.id)?.status === 'seated');
    expect(find(held.members, a.id)).toMatchObject({ status: 'seated' });
    expect((await money(a.id)).in_play).toBe(50_000);
    // the rest of the game on the clock; their cards keep playing
    await callToTheEnd(tableId, cb);
    const balls = allEvents(logB).filter((e) => e.type === 'ball').map((e) => e.ball);
    const won = winnings(cardsA, balls);
    expect(allEvents(logB).find((e) => e.type === 'end').seats['0']).toEqual({ wagered: 4_000, returned: won });
    await cb.next((m) => m.t === 'members' && !find(m.members, a.id), 5000);
    expect(await escrow(a.id, tableId)).toBeNull();
    expect(await money(a.id)).toEqual({ balance: before.a.balance - 4_000 + won, in_play: 0 });
    cb.ws.close();
  });
});

describe('the big-win feed and the limits know the parlour games', () => {
  it('names what paid', () => {
    expect(describeWin('bingo', '', [{ type: 'ball', call: 44, ball: 7 }, { type: 'win', seat: 0, card: 3, pattern: 'blackout', call: 44, mult: 2_000_000, paid: 2_000_000 }, { type: 'win', seat: 0, card: 3, pattern: 'line', call: 44, mult: 40, paid: 40 }], 0, 100, 2_000_040)).toBe('Blackout on ball 44, 20,000x');
    expect(describeWin('bingo', '', [{ type: 'end', round: 1, calls: 40, seats: {} }], 0, 100, 5_000)).toBe('Bingo, 50x');
    expect(describeWin('pachinko', '', [{ type: 'launch', seat: 0, jackpots: 5, balls: 780 }], 0, 2_500, 78_000)).toBe('5-jackpot chain, 780 balls');
    expect(describeWin('pachinko', '', [{ type: 'launch', seat: 0, jackpots: 0, balls: 30 }], 0, 100, 120)).toBe('1x');
  });

  it('their limits are chosen like the online games', () => {
    for (const game of ['bingo', 'pachinko'] as const) {
      expect(hasLimitChoice(game)).toBe(true);
      const cfg = engineFor(game).config('', 'multi').limits.default;
      expect(standardLimits(game)).toEqual({ min: cfg.min, max: cfg.max });
    }
  });
});
