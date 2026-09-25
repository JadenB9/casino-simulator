// Chosen table limits, end to end: the lobby route checks and clamps them and the table keeps
// them, the directory lists them, a PIN join shows them before sitting, bets and buy-ins are held
// to them, and a solo table takes new limits each sitting unless chips are still on it.

import { describe, expect, it } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { ORIGIN, TEST_PASSWORD, api, connect, type Client } from './helpers.ts';
import type { LobbySummary } from '../../shared/src/protocol.ts';

interface Player {
  id: number;
  name: string;
  token: string;
}

let seq = 0;

/** A fresh address per call, so no test trips another's per-address limits. */
function nextIp(): string {
  seq++;
  return `10.77.${(seq >> 8) & 255}.${seq & 255}`;
}

async function player(tag: string): Promise<Player> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': nextIp() },
      body: JSON.stringify({ name: `lim${tag}${++seq}`, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { id: body.profile.id, name: body.profile.name, token: body.token };
}

function createTable(p: Player, body: Record<string, unknown>): Promise<Response> {
  return api('tables', p.token, { method: 'POST', body: JSON.stringify(body), headers: { 'CF-Connecting-IP': nextIp() } });
}

async function enter(p: Player, path: string, extra = ''): Promise<[Client, any]> {
  const { client } = await connect(path, p.token, extra);
  const snap = await client!.next<any>((m) => m.t === 'table');
  return [client!, snap];
}

async function watcher(p: Player, game: string): Promise<{ w: Client; list: LobbySummary[] }> {
  const { client } = await connect('floor', p.token);
  const w = client!;
  await w.next((m) => m.t === 'hello');
  w.send({ t: 'watch', game });
  const first = await w.next<any>((m) => m.t === 'lobbies' && m.game === game);
  return { w, list: first.list };
}

let aids = 0;
const aid = () => `a${++aids}`;

async function buyIn(c: Client, amount: number): Promise<void> {
  c.send({ t: 'buyin', aid: aid(), amount });
  await c.next((m) => m.t === 'seat' && m.status === 'seated');
}

/** Send a bet and wait for its refusal, or null when it went down. */
async function refusal(c: Client, a: unknown): Promise<{ code: string; msg: string } | null> {
  const ref = aid();
  // only what answers this action
  c.msgs.length = 0;
  c.send({ t: 'act', aid: ref, a });
  const m = await c.next<any>((x) => (x.t === 'err' && x.ref === ref) || (x.t === 'ev' && x.events.some((e: any) => e.type === 'bet')));
  return m.t === 'err' ? { code: m.code, msg: m.msg } : null;
}

async function balance(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

describe('a lobby at chosen limits', () => {
  it('keeps them, lists them, and holds a second player to them', async () => {
    const a = await player('lead');
    const b = await player('mate');
    const { w } = await watcher(b, 'blackjack');

    const res = await createTable(a, { game: 'blackjack', visibility: 'public', limits: { min: 10_000, max: 1_000_000 } });
    expect(res.status).toBe(201);
    const { tableId } = await res.json<any>();
    const [ca, snapA] = await enter(a, `table/${tableId}`);
    expect(snapA.meta.config.limits.default).toEqual({ min: 10_000, max: 1_000_000, step: 100 });
    // the buy-in scales with them: four times the minimum to a hundred times the maximum
    expect(snapA.meta.config.buyIn).toEqual({ min: 40_000, max: 100_000_000 });

    // The second player sees the limits in the list before joining.
    const listed = await w.next<any>((m) => m.t === 'lobby' && m.lobby.tableId === tableId);
    expect(listed.lobby.limits).toEqual({ min: 10_000, max: 1_000_000 });
    expect((await watcher(b, 'blackjack')).list.find((l) => l.tableId === tableId)?.limits).toEqual({ min: 10_000, max: 1_000_000 });

    const [cb, snapB] = await enter(b, `table/${tableId}`);
    expect(snapB.meta.config.limits.default).toEqual({ min: 10_000, max: 1_000_000, step: 100 });

    // ... and is held to them: the buy-in range, then the bets.
    cb.send({ t: 'buyin', aid: 'short', amount: 30_000 });
    expect(await cb.next<any>((m) => m.t === 'err' && m.ref === 'short')).toMatchObject({ code: 'LIMIT' });
    cb.send({ t: 'buyin', aid: 'over', amount: 100_000_100 });
    expect(await cb.next<any>((m) => m.t === 'err' && m.ref === 'over')).toMatchObject({ code: 'LIMIT' });
    await buyIn(cb, 2_000_000);
    await buyIn(ca, 200_000);
    ca.send({ t: 'start' });
    await cb.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'betting'));
    expect(await refusal(cb, { type: 'bet', amount: 1_000_100 })).toEqual({ code: 'LIMIT', msg: 'The table maximum is $10,000.' });
    expect(await refusal(cb, { type: 'bet', amount: 1_000_000 })).toBeNull();
    // over the maximum in total
    expect(await refusal(cb, { type: 'bet', amount: 100 })).toMatchObject({ code: 'LIMIT' });
    for (const c of [ca, cb, w]) c.ws.close();
  });

  it('limits that are not two amounts are refused; amounts outside the rules move to the nearest table', async () => {
    const a = await player('odd');
    for (const limits of ['cheap', { min: 500 }, { min: 500, max: 1.5 }, { min: -500, max: 50_000 }, [500, 50_000]]) {
      const res = await createTable(a, { game: 'blackjack', visibility: 'public', limits });
      expect(res.status, JSON.stringify(limits)).toBe(400);
      expect((await res.json<any>()).error).toBe('BAD_REQUEST');
    }
    const cases: [unknown, { min: number; max: number }][] = [
      [{ min: 1, max: 1 }, { min: 100, max: 1_000 }],
      [{ min: 1e15, max: 1e15 }, { min: 10_000_000, max: 100_000_000 }],
      [{ min: 2_550, max: 100_000 }, { min: 2_500, max: 100_000 }],
      [{ min: 10_000, max: 20_000 }, { min: 10_000, max: 100_000 }],
    ];
    for (const [limits, want] of cases) {
      const res = await createTable(a, { game: 'blackjack', visibility: 'private', limits });
      expect(res.status).toBe(201);
      const { tableId, pin } = await res.json<any>();
      const [c, snap] = await enter(a, `table/${tableId}`, `&pin=${pin}`);
      expect({ min: snap.meta.config.limits.default.min, max: snap.meta.config.limits.default.max }, JSON.stringify(limits)).toEqual(want);
      c.send({ t: 'leave' });
      c.ws.close();
    }
    // Left out, a table is Standard.
    const res = await createTable(a, { game: 'blackjack', visibility: 'private' });
    const { tableId, pin } = await res.json<any>();
    const [c, snap] = await enter(a, `table/${tableId}`, `&pin=${pin}`);
    expect(snap.meta.config.limits.default).toEqual({ min: 2_500, max: 500_000, step: 100 });
    c.ws.close();
  });

  it("per-spot limits follow the table's: roulette's inside bets and its cap a spin", async () => {
    const a = await player('rl');
    const res = await createTable(a, { game: 'roulette', variant: 'european', visibility: 'private', limits: { min: 2_500, max: 1_000_000 } });
    const { tableId, pin } = await res.json<any>();
    const [c, snap] = await enter(a, `table/${tableId}`, `&pin=${pin}`);
    expect(snap.meta.config.limits).toMatchObject({
      outside: { min: 2_500, max: 1_000_000 },
      inside: { min: 500, max: 100_000 },
      default: { max: 2_000_000 },
    });
    c.ws.close();
  });

  it("a PIN join says what the table is, limits included, before sitting down", async () => {
    const a = await player('pinlead');
    const b = await player('pinmate');
    const res = await createTable(a, { game: 'war', visibility: 'private', limits: { min: 2_500, max: 250_000 } });
    const { tableId, pin } = await res.json<any>();
    const [ca] = await enter(a, `table/${tableId}`, `&pin=${pin}`);
    const join = await api('tables/join', b.token, { method: 'POST', body: JSON.stringify({ pin }), headers: { 'CF-Connecting-IP': nextIp() } });
    expect(join.status).toBe(200);
    const body = await join.json<any>();
    expect(body).toMatchObject({ tableId, game: 'war', lobby: { tableId, leader: a.name, players: 1, max: 6, limits: { min: 2_500, max: 250_000 } } });
    ca.ws.close();
  });

  it("Hold'em: the stakes are the blinds, the buy-in 20 to 250 big blinds", async () => {
    const a = await player('he');
    const res = await createTable(a, { game: 'holdem', visibility: 'private', limits: { min: 2_500, max: 5_000 } });
    const { tableId, pin } = await res.json<any>();
    const [c, snap] = await enter(a, `table/${tableId}`, `&pin=${pin}`);
    expect(snap.meta.config.options).toMatchObject({ sb: 2_500, bb: 5_000 });
    expect(snap.meta.config.buyIn).toEqual({ min: 100_000, max: 1_250_000 });
    c.ws.close();
  });
});

describe('a solo table', () => {
  it('takes the limits of each sitting, and keeps them while chips are on it', async () => {
    const p = await player('solo');
    const [c1, s1] = await enter(p, 'solo/highcard', '&limits=500-500000');
    expect(s1.meta.config.limits.default).toEqual({ min: 500, max: 500_000, step: 100 });
    expect(s1.meta.config.buyIn).toEqual({ min: 5_000, max: 50_000_000 });
    c1.send({ t: 'buyin', aid: 'low', amount: 4_900 });
    expect(await c1.next<any>((m) => m.t === 'err' && m.ref === 'low')).toMatchObject({ code: 'LIMIT' });
    await buyIn(c1, 100_000);
    expect(await refusal(c1, { type: 'bet', amount: 400 })).toMatchObject({ code: 'LIMIT' });
    expect(await refusal(c1, { type: 'bet', amount: 500_100 })).toMatchObject({ code: 'LIMIT' });
    expect(await refusal(c1, { type: 'bet', amount: 500 })).toBeNull();

    // Opened again with other limits while the chips are still here: the table keeps its own.
    const [c2, s2] = await enter(p, 'solo/highcard', '&limits=10000-2500000');
    expect(s2.meta.config.limits.default).toEqual({ min: 500, max: 500_000, step: 100 });
    expect(s2.you.stack).toBe(99_500);

    // Cashed out and gone: the next sitting brings its own.
    c2.send({ t: 'leave' });
    await c2.next((m) => m.t === 'balance' && m.inPlay === 0);
    await c2.next((m) => m.t === 'seat' && m.status === 'watching');
    expect((await balance(p.id)).in_play).toBe(0);
    const [c3, s3] = await enter(p, 'solo/highcard', '&limits=10000-2500000');
    expect(s3.meta.config.limits.default).toEqual({ min: 10_000, max: 2_500_000, step: 100 });
    expect(s3.meta.config.buyIn).toEqual({ min: 100_000, max: 250_000_000 });
    await buyIn(c3, 100_000);
    expect(await refusal(c3, { type: 'bet', amount: 5_000 })).toMatchObject({ code: 'LIMIT' });
    expect(await refusal(c3, { type: 'bet', amount: 10_000 })).toBeNull();

    // Without limits, a sitting keeps whatever the table has.
    c3.send({ t: 'leave' });
    await c3.next((m) => m.t === 'seat' && m.status === 'watching');
    const [c4, s4] = await enter(p, 'solo/highcard');
    expect(s4.meta.config.limits.default).toEqual({ min: 10_000, max: 2_500_000, step: 100 });
    c4.ws.close();
  });

  it('the socket route clamps what it is given; the machines have no limits to choose', async () => {
    const p = await player('clamp');
    const [c, snap] = await enter(p, 'solo/highcard', '&limits=1-1');
    expect(snap.meta.config.limits.default).toEqual({ min: 100, max: 1_000, step: 100 });
    c.ws.close();
    const [c2, snap2] = await enter(p, 'solo/dice', '&limits=junk');
    expect(snap2.meta.config.limits.default).toEqual({ min: 100, max: 100_000, step: 100 });
    c2.ws.close();
    const [c3, snap3] = await enter(p, 'solo/slots', '&variant=sevens&limits=10000-1000000');
    expect(snap3.meta.config.limits.default).toEqual({ min: 25, max: 30_000, step: 25 });
    c3.ws.close();
  });
});
