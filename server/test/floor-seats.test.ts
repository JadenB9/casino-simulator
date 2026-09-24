import { describe, it, expect } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import type { CasinoFloor } from '../src/floor/index.ts';
import { ORIGIN, TEST_PASSWORD, connect, type Client } from './helpers.ts';
import { SEAT_KEEP_CM } from '../../shared/src/seats.ts';

// Floor seats through the real floor object: the first to sit gets the seat, a second is told
// who beat them to it, and the seat comes free when its sitter stands, walks off or leaves.
// Every test shares the one floor ("main"), so each uses its own accounts and its own seat ids.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ipSeq = 0;

async function login(name: string): Promise<{ token: string; profile: any }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `10.43.0.${++ipSeq}` },
      body: JSON.stringify({ name, password: TEST_PASSWORD }),
    }),
  );
  if (res.status !== 200) throw new Error(`login ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

interface Walker {
  id: number;
  name: string;
  token: string;
  c: Client;
  hello: any;
}

/** Log in, open the floor and stand at (x, z) cm. */
async function arrive(name: string, x = 0, z = 1200, token?: string): Promise<Walker> {
  const l = token ? null : await login(name);
  const t = token ?? l!.token;
  const { client } = await connect('floor', t);
  const hello = await client!.next<any>((m) => m.t === 'hello');
  client!.send({ t: 'st', x, z, r: 0 });
  return { id: hello.you.id, name, token: t, c: client!, hello };
}

/** The seat news about one player, oldest first (consumed). */
async function seatNews(c: Client, id: number): Promise<any> {
  return c.next<any>((m) => m.t === 'player' && m.id === id && m.seat !== undefined);
}

async function leaveAll(...ws: Walker[]): Promise<void> {
  for (const w of ws) if (!w.c.closed) w.c.ws.close(1000, 'bye');
  await wait(50);
}

describe('floor seats', () => {
  it('two players race for one seat: the first sits, the second is told who got there first', async () => {
    const a = await arrive('fs_race_a', 40, 1200);
    const b = await arrive('fs_race_b', -40, 1200);
    const o = await arrive('fs_race_o', 0, 1300);
    await wait(30);
    // both ask at once; the floor takes them one at a time
    a.c.send({ t: 'sit', seat: 'race-stool-1', x: 0, z: 1150, r: 64 });
    b.c.send({ t: 'sit', seat: 'race-stool-1', x: 0, z: 1150, r: 64 });
    const sat = await o.c.next<any>((m) => m.t === 'player' && (m.id === a.id || m.id === b.id) && m.seat === 'race-stool-1');
    const [winner, loser] = sat.id === a.id ? [a, b] : [b, a];
    // the winner hears it too, and the loser gets a friendly no naming the winner
    expect((await seatNews(winner.c, winner.id)).seat).toBe('race-stool-1');
    const no = await loser.c.next<any>((m) => m.t === 'seat.no');
    expect(no).toEqual({ t: 'seat.no', seat: 'race-stool-1', msg: `${winner.name} got there first.` });
    await wait(80);
    // nobody ever heard of the loser sitting
    for (const w of [a, b, o]) expect(w.c.msgs.some((m) => m.t === 'player' && m.id === loser.id && m.seat)).toBe(false);
    // a newcomer's roster says who sits where
    const n = await arrive('fs_race_n', 0, 1300);
    expect(n.hello.players.find((p: any) => p.id === winner.id)?.seat).toBe('race-stool-1');
    expect(n.hello.players.find((p: any) => p.id === loser.id)?.seat).toBeNull();
    await leaveAll(a, b, o, n);
  });

  it('disconnecting frees the seat for the next person', async () => {
    const a = await arrive('fs_drop_a', 0, 1200);
    const b = await arrive('fs_drop_b', 30, 1200);
    await wait(30);
    a.c.send({ t: 'sit', seat: 'drop-sofa-1-a', x: 0, z: 1160, r: 0 });
    expect((await seatNews(b.c, a.id)).seat).toBe('drop-sofa-1-a');
    b.c.send({ t: 'sit', seat: 'drop-sofa-1-a', x: 0, z: 1160, r: 0 });
    expect((await b.c.next<any>((m) => m.t === 'seat.no')).msg).toBe('fs_drop_a got there first.');

    a.c.ws.close(1000, 'bye');
    expect((await seatNews(b.c, a.id)).seat).toBeNull();
    await b.c.next<any>((m) => m.t === 'leave' && m.id === a.id);
    b.c.send({ t: 'sit', seat: 'drop-sofa-1-a', x: 0, z: 1160, r: 0 });
    expect((await seatNews(b.c, b.id)).seat).toBe('drop-sofa-1-a');
    await leaveAll(b);
  });

  it('standing up, or walking off the seat, frees it; shifting on it does not', async () => {
    const a = await arrive('fs_walk_a', 0, 1200);
    const o = await arrive('fs_walk_o', 100, 1300);
    await wait(30);
    a.c.send({ t: 'sit', seat: 'walk-stool-1', x: 0, z: 1150, r: 0 });
    expect((await seatNews(o.c, a.id)).seat).toBe('walk-stool-1');
    // the client's own move onto the seat, and a turn in place, keep you sitting
    a.c.send({ t: 'mv', x: 10, z: 1150, r: 30 });
    a.c.send({ t: 'st', x: 10, z: 1150, r: 40 });
    await o.c.next<any>((m) => m.t === 's' && m.p.some((row: number[]) => row[0] === a.id && row[3] === 40));
    expect(o.c.msgs.some((m) => m.t === 'player' && m.id === a.id && m.seat !== undefined)).toBe(false);
    // stand: freed
    a.c.send({ t: 'stand' });
    expect((await seatNews(o.c, a.id)).seat).toBeNull();

    // sit again, then walk away without a stand: the walk frees it
    a.c.send({ t: 'sit', seat: 'walk-stool-1', x: 0, z: 1150, r: 0 });
    expect((await seatNews(o.c, a.id)).seat).toBe('walk-stool-1');
    await wait(120);
    a.c.send({ t: 'mv', x: 0, z: 1150 - SEAT_KEEP_CM - 30, r: 0 });
    expect((await seatNews(o.c, a.id)).seat).toBeNull();
    await leaveAll(a, o);
  });

  it('moving to another seat gives up the first; a seat out of reach is refused', async () => {
    const a = await arrive('fs_move_a', 0, 1200);
    const o = await arrive('fs_move_o', 100, 1300);
    await wait(30);
    a.c.send({ t: 'sit', seat: 'move-sofa-1-a', x: 0, z: 1160, r: 0 });
    expect((await seatNews(o.c, a.id)).seat).toBe('move-sofa-1-a');
    a.c.send({ t: 'sit', seat: 'move-sofa-1-b', x: 50, z: 1160, r: 0 });
    expect((await seatNews(o.c, a.id)).seat).toBe('move-sofa-1-b');
    // the first seat is free: someone else can have it
    o.c.send({ t: 'sit', seat: 'move-sofa-1-a', x: 0, z: 1160, r: 0 });
    expect((await seatNews(a.c, o.id)).seat).toBe('move-sofa-1-a');
    // nobody sits down across the room
    a.c.send({ t: 'sit', seat: 'far-stool-9', x: 1500, z: -1400, r: 0 });
    expect(await a.c.next<any>((m) => m.t === 'seat.no')).toEqual({ t: 'seat.no', seat: 'far-stool-9', msg: 'Walk up to it first.' });
    await leaveAll(a, o);
  });

  it('a second tab starts standing, and frees the seat the first tab sat on', async () => {
    const a1 = await arrive('fs_tabs_a', 0, 1200);
    const o = await arrive('fs_tabs_o', 100, 1300);
    await wait(30);
    a1.c.send({ t: 'sit', seat: 'tabs-stool-1', x: 0, z: 1160, r: 0 });
    expect((await seatNews(o.c, a1.id)).seat).toBe('tabs-stool-1');
    const a2 = await arrive('', 0, 1160, a1.token);
    expect(a2.hello.you.seat).toBeNull();
    expect((await seatNews(o.c, a1.id)).seat).toBeNull();
    o.c.send({ t: 'sit', seat: 'tabs-stool-1', x: 0, z: 1160, r: 0 });
    expect((await seatNews(a2.c, o.id)).seat).toBe('tabs-stool-1');
    await leaveAll(a2, o);
  });

  it('a refused sit changes nothing: the loser stays where they stood, the sitter keeps the seat', async () => {
    const a = await arrive('fs_keep_a', 0, 1200);
    const b = await arrive('fs_keep_b', 20, 1200);
    await wait(30);
    a.c.send({ t: 'sit', seat: 'keep-stool-1', x: 0, z: 1160, r: 0 });
    expect((await seatNews(b.c, a.id)).seat).toBe('keep-stool-1');
    b.c.send({ t: 'sit', seat: 'keep-stool-1', x: 0, z: 1160, r: 0 });
    await b.c.next<any>((m) => m.t === 'seat.no');
    // b's position didn't jump onto a seat it didn't get, and a still sits
    const n = await arrive('fs_keep_n', 0, 1300);
    const seenB = n.hello.players.find((p: any) => p.id === b.id);
    expect(seenB).toMatchObject({ x: 20, z: 1200, seat: null });
    expect(n.hello.players.find((p: any) => p.id === a.id)?.seat).toBe('keep-stool-1');
    await leaveAll(a, b, n);
  });

  it('the book survives the floor object sleeping: the sitter keeps the seat, and it is still theirs alone', async () => {
    const a = await arrive('fs_nap_a', 0, 1200);
    const b = await arrive('fs_nap_b', 20, 1200);
    await wait(30);
    a.c.send({ t: 'sit', seat: 'nap-stool-1', x: 0, z: 1160, r: 0 });
    expect((await seatNews(b.c, a.id)).seat).toBe('nap-stool-1');

    await evictDurableObject(floorStub());

    const n = await arrive('fs_nap_n', 0, 1300);
    expect(n.hello.players.find((p: any) => p.id === a.id)?.seat).toBe('nap-stool-1');
    b.c.send({ t: 'sit', seat: 'nap-stool-1', x: 0, z: 1160, r: 0 });
    expect((await b.c.next<any>((m) => m.t === 'seat.no')).msg).toBe('fs_nap_a got there first.');
    a.c.send({ t: 'stand' });
    expect((await seatNews(n.c, a.id)).seat).toBeNull();
    await leaveAll(a, b, n);
  });
});

function floorStub(): DurableObjectStub<CasinoFloor> {
  const ns = env.FLOOR as unknown as DurableObjectNamespace<CasinoFloor>;
  return ns.get(ns.idFromName('main'));
}
