import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { CasinoFloor } from '../src/floor/index.ts';
import { connect, login, type Client } from './helpers.ts';
import { LIFTS } from '../../shared/src/lifts.ts';
import { LOTS, ZONES, inRect } from '../../shared/src/zones.ts';

// The elevator through the real floor object: a ride only from beside the doors of the zone you're
// in, never from a table or while held, and it lands you in front of the other zone's doors, where
// everyone hears you are. Every test shares the one floor ("main"), so each uses its own accounts.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const floor = (): DurableObjectStub<CasinoFloor> => env.FLOOR.get(env.FLOOR.idFromName('main'));

interface Walker {
  id: number;
  c: Client;
}

/** Log in, open the floor and stand at (x, z) cm (the first position places you, in any zone). */
async function arrive(name: string, x: number, z: number): Promise<Walker> {
  const { token } = await login(name);
  const { client } = await connect('floor', token);
  const hello = await client!.next<any>((m) => m.t === 'hello');
  client!.send({ t: 'st', x, z, r: 0 });
  return { id: hello.you.id, c: client! };
}

/** Where `watcher` last heard `id` is (the newest snapshot row). */
async function seenAt(watcher: Client, id: number, pred: (x: number, z: number) => boolean): Promise<{ x: number; z: number }> {
  const s = await watcher.next<any>((m) => m.t === 's' && m.p.some((row: number[]) => row[0] === id && pred(row[1]!, row[2]!)));
  const row = s.p.find((r: number[]) => r[0] === id);
  return { x: row[1], z: row[2] };
}

async function leaveAll(...ws: Walker[]): Promise<void> {
  for (const w of ws) if (!w.c.closed) w.c.ws.close(1000, 'bye');
  await wait(50);
}

const casino = LIFTS.casino;
const ground = LIFTS.ground;
const roof = LIFTS.roof;

describe('the elevator', () => {
  it('rides from the casino down to the valet lobby, up to the roof and back, and everyone sees where you are', async () => {
    const a = await arrive('lift_ride_a', casino.x + 100, casino.z);
    const o = await arrive('lift_ride_o', 0, 1300);
    await wait(40);
    a.c.send({ t: 'lift', to: 'ground' });
    const tp = await a.c.next<any>((m) => m.t === 'tp');
    expect(tp).toEqual({ t: 'tp', ...ground.arrive });
    expect(inRect(LOTS.lobby, tp.x, tp.z)).toBe(true);
    expect(await seenAt(o.c, a.id, (x) => x === ground.arrive.x)).toEqual({ x: ground.arrive.x, z: ground.arrive.z });

    // walking about down there stays down there
    a.c.send({ t: 'st', x: ground.arrive.x + 200, z: ground.arrive.z, r: 64 });
    await seenAt(o.c, a.id, (x) => x === ground.arrive.x + 200);
    // back to the doors, up to the roof
    a.c.send({ t: 'st', x: ground.x + 60, z: ground.z, r: 64 });
    await seenAt(o.c, a.id, (x) => x === ground.x + 60);
    a.c.send({ t: 'lift', to: 'roof' });
    expect(await a.c.next<any>((m) => m.t === 'tp')).toEqual({ t: 'tp', ...roof.arrive });
    await seenAt(o.c, a.id, (x) => x === roof.arrive.x);
    // and home
    a.c.send({ t: 'lift', to: 'casino' });
    expect(await a.c.next<any>((m) => m.t === 'tp')).toEqual({ t: 'tp', ...casino.arrive });
    await seenAt(o.c, a.id, (x) => x === casino.arrive.x);
    expect(a.c.msgs.some((m) => m.t === 'lift.no')).toBe(false);
    await leaveAll(a, o);
  });

  it('refuses a ride from across the room, to the floor you are on, and a made-up floor', async () => {
    const a = await arrive('lift_far_a', 0, 1300);
    await wait(40);
    a.c.send({ t: 'lift', to: 'roof' });
    expect(await a.c.next<any>((m) => m.t === 'lift.no')).toEqual({ t: 'lift.no', to: 'roof', msg: 'Walk up to the elevator first.' });
    a.c.send({ t: 'st', x: casino.x + 80, z: casino.z, r: 64 });
    await wait(40);
    a.c.send({ t: 'lift', to: 'casino' });
    expect((await a.c.next<any>((m) => m.t === 'lift.no')).msg).toBe('You’re already on this floor.');
    a.c.send({ t: 'lift', to: 'moon' });
    await wait(80);
    expect(a.c.msgs.some((m) => m.t === 'tp')).toBe(false);
    expect(a.c.closed).toBeNull();
    await leaveAll(a);
  });

  it('refuses while you sit at a table, and while security holds you', async () => {
    const a = await arrive('lift_held_a', casino.x + 100, casino.z);
    await wait(40);
    await floor().playerAt(a.id, 'bj-1');
    a.c.send({ t: 'lift', to: 'ground' });
    expect((await a.c.next<any>((m) => m.t === 'lift.no')).msg).toBe('Stand up from the table first.');
    await floor().playerAt(a.id, null);

    const jail = LOTS.jail;
    await runInDurableObject(floor(), (f: CasinoFloor) => f.presence.confine(a.id, jail));
    a.c.send({ t: 'lift', to: 'ground' });
    expect((await a.c.next<any>((m) => m.t === 'lift.no')).msg).toBe('Security has you. Not now.');
    await runInDurableObject(floor(), (f: CasinoFloor) => f.presence.confine(a.id, null));

    a.c.send({ t: 'lift', to: 'ground' });
    expect(await a.c.next<any>((m) => m.t === 'tp')).toEqual({ t: 'tp', ...ground.arrive });
    await leaveAll(a);
  });

  it('a move still on its way from before the ride stays on the new floor', async () => {
    const a = await arrive('lift_stale_a', casino.x + 100, casino.z);
    const o = await arrive('lift_stale_o', 0, 1300);
    await wait(40);
    a.c.send({ t: 'lift', to: 'roof' });
    await a.c.next<any>((m) => m.t === 'tp');
    // the old floor's position arrives after the ride: the roof keeps you
    a.c.send({ t: 'mv', x: casino.x + 120, z: casino.z, r: 64 });
    await wait(150);
    const pos = await runInDurableObject(floor(), (f: CasinoFloor) => f.presence.positionOf(a.id));
    expect(inRect(ZONES.roof, pos!.x, pos!.z)).toBe(true);
    await leaveAll(a, o);
  });

  it('coming back on a new connection puts you where you were, whatever the floor', async () => {
    const o = await arrive('lift_back_o', 0, 1300);
    const a = await arrive('lift_back_a', roof.arrive.x - 300, roof.arrive.z + 150);
    expect(await seenAt(o.c, a.id, (x) => x < ZONES.roof.maxX)).toEqual({ x: roof.arrive.x - 300, z: roof.arrive.z + 150 });
    // but only the first position does: walking on stays on the roof
    a.c.send({ t: 'mv', x: 0, z: 1300, r: 0 });
    await wait(150);
    const pos = await runInDurableObject(floor(), (f: CasinoFloor) => f.presence.positionOf(a.id));
    expect(inRect(ZONES.roof, pos!.x, pos!.z)).toBe(true);
    await leaveAll(a, o);
  });
});
