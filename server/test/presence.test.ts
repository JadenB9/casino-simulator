import { describe, it, expect } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import { ORIGIN, TEST_PASSWORD, api, connect, type Client } from './helpers.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import { FLUSH_MS, MAX_BANK, SPAWN } from '../src/floor/presence.ts';
import { FLOOR_BOUNDS } from '../../shared/src/protocol.ts';

// Every test here shares the one floor object ("main"), so each uses its own accounts, only
// looks at messages about them, and closes its sockets at the end.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ipSeq = 0;

/** Log in from an address of its own, so this file's many accounts stay under the sign-up limit. */
async function login(name: string): Promise<{ token: string; profile: any }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `10.41.0.${++ipSeq}` },
      body: JSON.stringify({ name, password: TEST_PASSWORD }),
    }),
  );
  if (res.status !== 200) throw new Error(`login ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

function floorStub(): DurableObjectStub<CasinoFloor> {
  const ns = env.FLOOR as unknown as DurableObjectNamespace<CasinoFloor>;
  return ns.get(ns.idFromName('main'));
}

interface Walker {
  id: number;
  token: string;
  c: Client;
  hello: any;
}

async function arrive(name: string, token?: string): Promise<Walker> {
  let id: number;
  if (!token) {
    const l = await login(name);
    token = l.token;
    id = l.profile.id;
  } else {
    id = -1;
  }
  const { client } = await connect('floor', token);
  const hello = await client!.next<any>((m) => m.t === 'hello');
  return { id: id === -1 ? hello.you.id : id, token, c: client!, hello };
}

/** Rows about one player from the snapshots a client has received so far (consumed). */
/** A snapshot row without its age (the sixth element: ms since that position reached the floor). */
const pose = (row: number[]) => row.slice(0, 5);

function rowsFor(c: Client, id: number): { ts: number; row: number[]; age: number }[] {
  const out: { ts: number; row: number[]; age: number }[] = [];
  for (const m of c.msgs.filter((m) => m.t === 's')) {
    for (const row of m.p) if (row[0] === id) out.push({ ts: m.ts, row: pose(row), age: row[5] });
  }
  c.msgs = c.msgs.filter((m) => m.t !== 's');
  return out;
}

function about(c: Client, id: number): any[] {
  return c.msgs.filter((m) => (m.t === 'join' && m.player.id === id) || ((m.t === 'leave' || m.t === 'player') && m.id === id));
}

async function leaveAll(...ws: Walker[]): Promise<void> {
  for (const w of ws) if (!w.c.closed) w.c.ws.close(1000, 'bye');
  await wait(50);
}

describe('floor presence', () => {
  it('two players see each other arrive, walk, stop and leave', async () => {
    const a = await arrive('pr_walk_a');
    expect(a.hello.v).toBe(1);
    expect(a.hello.you).toMatchObject({ id: a.id, name: 'pr_walk_a', x: SPAWN.x, z: SPAWN.z, r: SPAWN.r, at: null });
    expect(a.hello.players.some((p: any) => p.id === a.id)).toBe(false);

    const b = await arrive('pr_walk_b');
    const seenA = b.hello.players.find((p: any) => p.id === a.id);
    expect(seenA).toMatchObject({ name: 'pr_walk_a', x: SPAWN.x, z: SPAWN.z, at: null });
    expect(seenA.look).toMatchObject({ v: 1 });
    expect(b.hello.online).toBeGreaterThanOrEqual(2);
    const joined = await a.c.next<any>((m) => m.t === 'join' && m.player.id === b.id);
    expect(joined.player.name).toBe('pr_walk_b');
    const online = await a.c.next<any>((m) => m.t === 'online');
    expect(online.n).toBe(b.hello.online);

    // Walk from the spawn toward the middle of the room at a normal pace.
    for (let i = 1; i <= 5; i++) {
      a.c.send({ t: 'mv', x: 0, z: SPAWN.z - i * 30, r: 0 });
      await wait(110);
    }
    a.c.send({ t: 'st', x: 0, z: SPAWN.z - 160, r: 3 });
    const stop = await b.c.next<any>((m) => m.t === 's' && m.p.some((row: number[]) => row[0] === a.id && row[4] === 0));
    b.c.msgs.push(stop);
    const rows = rowsFor(b.c, a.id);
    // A snapshot per move (they were sent more than FLUSH_MS apart; on a loaded machine two can
    // still arrive together, and the floor rightly folds those into one), in order, each newer
    // than the last, and the stop at once.
    const moves = [1, 2, 3, 4, 5].map((i) => [a.id, 0, SPAWN.z - i * 30, 0, 1]);
    const walked = rows.slice(0, -1).map((r) => r.row);
    expect(walked.length).toBeGreaterThanOrEqual(3);
    let from = 0;
    for (const row of walked) {
      const at = moves.findIndex((m, k) => k >= from && JSON.stringify(m) === JSON.stringify(row));
      expect(at, JSON.stringify(row)).toBeGreaterThanOrEqual(0);
      from = at + 1;
    }
    expect(rows.at(-1)!.row).toEqual([a.id, 0, SPAWN.z - 160, 3, 0]);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.ts).toBeGreaterThan(rows[i - 1]!.ts);
    // Each row says how long ago its position reached the floor: never negative, never much more
    // than one flush interval, and the moments it gives only move forward.
    for (const r of rows) {
      expect(r.age).toBeGreaterThanOrEqual(0);
      expect(r.age).toBeLessThanOrEqual(FLUSH_MS + 60);
    }
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.ts - rows[i]!.age).toBeGreaterThan(rows[i - 1]!.ts - rows[i - 1]!.age);
    // Snapshots only carry players who moved: b stood still the whole time.
    expect(rowsFor(a.c, b.id)).toEqual([]);

    await leaveAll(a);
    const left = await b.c.next<any>((m) => m.t === 'leave' && m.id === a.id);
    expect(left).toBeTruthy();
    const after = await b.c.next<any>((m) => m.t === 'online');
    expect(after.n).toBe(b.hello.online - 1);
    await leaveAll(b);
  });

  it('coalesces snapshots at least FLUSH_MS apart while people walk, and sends a stop at once', async () => {
    const a = await arrive('pr_flush_a');
    const b = await arrive('pr_flush_b');
    const o = await arrive('pr_flush_o');
    a.c.send({ t: 'st', x: -500, z: 0, r: 0 });
    b.c.send({ t: 'st', x: 500, z: 0, r: 0 });
    await o.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === b.id && r[4] === 0));
    o.c.msgs = [];
    await wait(80);

    // Both walk, sending far more often than the client would, interleaved.
    for (let i = 1; i <= 12; i++) {
      a.c.send({ t: 'mv', x: -500 + i * 10, z: 0, r: 64 });
      await wait(12);
      b.c.send({ t: 'mv', x: 500 - i * 10, z: 0, r: 192 });
      await wait(12);
    }
    await wait(20);
    const tsBeforeStop = Date.now();
    a.c.send({ t: 'st', x: -380, z: 0, r: 64 });
    const stop = await o.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === a.id && r[4] === 0), 1000);
    expect(Date.now() - tsBeforeStop).toBeLessThan(500);

    const snaps = [...o.c.msgs.filter((m) => m.t === 's'), stop].sort((x, y) => x.ts - y.ts);
    const walking = snaps.filter((s) => s !== stop);
    expect(walking.length).toBeGreaterThan(2);
    expect(walking.length).toBeLessThan(24); // 24 moves went in; fewer snapshots came out
    for (let i = 1; i < walking.length; i++) expect(walking[i]!.ts - walking[i - 1]!.ts).toBeGreaterThanOrEqual(FLUSH_MS);
    for (const s of snaps) {
      for (const row of s.p) expect([a.id, b.id]).toContain(row[0]);
      expect(new Set(s.p.map((r: number[]) => r[0])).size).toBe(s.p.length);
    }
    // Some snapshot carried both walkers at once.
    expect(walking.some((s) => s.p.length === 2)).toBe(true);
    await leaveAll(a, b, o);
  });

  it('clamps positions to the floor and to walking speed', async () => {
    const a = await arrive('pr_speed_a');
    const o = await arrive('pr_speed_o');
    // The first position places the player anywhere on the floor, clamped to its bounds.
    a.c.send({ t: 'st', x: 99_999, z: -99_999, r: 10 });
    const placed = await o.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === a.id));
    expect(pose(placed.p.find((r: number[]) => r[0] === a.id))).toEqual([a.id, FLOOR_BOUNDS.maxX, FLOOR_BOUNDS.minZ, 10, 0]);

    // After that, a jump across the room stops short at what could have been walked. (Waiting out
    // FLUSH_MS first, since nothing else would come along to flush a lone move.)
    await wait(FLUSH_MS + 10);
    a.c.send({ t: 'mv', x: FLOOR_BOUNDS.minX, z: FLOOR_BOUNDS.minZ, r: 20 });
    const jumped = await o.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === a.id));
    const x = jumped.p.find((r: number[]) => r[0] === a.id)[1];
    expect(FLOOR_BOUNDS.maxX - x).toBeGreaterThanOrEqual(MAX_BANK - 1);
    expect(FLOOR_BOUNDS.maxX - x).toBeLessThan(MAX_BANK + 200);
    await leaveAll(a, o);
  });

  it('a second tab of the same account replaces the first without a leave or a join', async () => {
    const a1 = await arrive('pr_tabs_a');
    const b = await arrive('pr_tabs_b');
    a1.c.send({ t: 'st', x: 500, z: 600, r: 64 });
    await b.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === a1.id));
    await wait(20);
    b.c.msgs = [];

    const a2 = await arrive('', a1.token);
    expect(a2.id).toBe(a1.id);
    await wait(100);
    expect(a1.c.closed?.code).toBe(4001);
    expect(a2.hello.you).toMatchObject({ id: a1.id, x: 500, z: 600, r: 64 });
    expect(a2.hello.players.some((p: any) => p.id === a1.id)).toBe(false);
    expect(a2.hello.players.some((p: any) => p.id === b.id)).toBe(true);
    expect(a2.hello.online).toBe(b.hello.online);
    // Nobody else saw anything: no leave, no join, no change in the online count.
    expect(about(b.c, a1.id)).toEqual([]);
    expect(b.c.msgs.filter((m) => m.t === 'online')).toEqual([]);

    a2.c.send({ t: 'mv', x: 520, z: 600, r: 64 });
    const moved = await b.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === a1.id));
    expect(pose(moved.p.find((r: number[]) => r[0] === a1.id))).toEqual([a1.id, 520, 600, 64, 1]);

    await leaveAll(a2);
    await b.c.next<any>((m) => m.t === 'leave' && m.id === a1.id);
    await leaveAll(b);
  });

  it('station updates arrive through the playerAt RPC and survive a reconnect', async () => {
    const a = await arrive('pr_seat_a');
    const b = await arrive('pr_seat_b');
    const floor = floorStub();

    await floor.playerAt(a.id, 'bj-1');
    const toB = await b.c.next<any>((m) => m.t === 'player' && m.id === a.id);
    expect(toB).toEqual({ t: 'player', id: a.id, at: { station: 'bj-1' } });
    await a.c.next<any>((m) => m.t === 'player' && m.id === a.id);

    // A table re-announces the station when its socket reconnects; that is not news.
    await floor.playerAt(a.id, 'bj-1');
    await wait(60);
    expect(about(b.c, a.id)).toEqual([]);

    const c = await arrive('pr_seat_c');
    expect(c.hello.players.find((p: any) => p.id === a.id).at).toEqual({ station: 'bj-1' });

    // The floor socket drops and comes back while the player is still seated.
    await leaveAll(a);
    await b.c.next<any>((m) => m.t === 'leave' && m.id === a.id);
    const again = await arrive('', a.token);
    expect(again.hello.you.at).toEqual({ station: 'bj-1' });
    const rejoined = await b.c.next<any>((m) => m.t === 'join' && m.player.id === a.id);
    expect(rejoined.player.at).toEqual({ station: 'bj-1' });

    await floor.playerAt(a.id, null);
    expect(await b.c.next<any>((m) => m.t === 'player' && m.id === a.id)).toEqual({ t: 'player', id: a.id, at: null });

    // Someone who isn't on the floor can sit down; others hear nothing until they arrive.
    const d = await login('pr_seat_d');
    await floor.playerAt(d.profile.id, 'rl-2');
    await wait(60);
    expect(about(b.c, d.profile.id)).toEqual([]);
    const dw = await arrive('', d.token);
    expect(dw.hello.you.at).toEqual({ station: 'rl-2' });
    await floor.playerAt(d.profile.id, null);
    await leaveAll(again, b, c, dw);
  });

  it('a new look reaches everyone on the floor', async () => {
    const a = await arrive('pr_look_a');
    const b = await arrive('pr_look_b');
    const look = { v: 1, body: 'f', outfit: 'dress', skin: 5, hair: '#aa3311', top: '#224466', bottom: '#112233', shoes: '#000000' };
    const res = await api('me/look', a.token, { method: 'PUT', body: JSON.stringify({ look }) });
    expect(res.status).toBe(200);
    expect(await b.c.next<any>((m) => m.t === 'player' && m.id === a.id)).toEqual({ t: 'player', id: a.id, look });
    const c = await arrive('pr_look_c');
    expect(c.hello.players.find((p: any) => p.id === a.id).look).toEqual(look);
    await leaveAll(a, b, c);
  });

  it('ignores malformed messages and closes the socket on a frame over 512 bytes', async () => {
    const a = await arrive('pr_bad_a');
    const o = await arrive('pr_bad_o');
    a.c.send({ t: 'st', x: 10, z: 10, r: 0 });
    await o.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === a.id));

    a.c.ws.send('not json');
    for (const bad of [
      { t: 'mv', x: '20', z: 10, r: 0 },
      { t: 'mv', x: 20.5, z: 10, r: 0 },
      { t: 'mv', x: 20, z: 10, r: 256 },
      { t: 'mv', x: 20, z: 10, r: -1 },
      { t: 'st' },
      { t: 'fly', x: 20, z: 10, r: 0 },
      [1, 2, 3],
      null,
    ]) {
      a.c.send(bad);
    }
    await wait(150);
    expect(rowsFor(o.c, a.id)).toEqual([]);
    expect(a.c.closed).toBeNull();

    // Exactly 512 bytes is still a frame; unknown extra keys are dropped.
    const head = JSON.stringify({ t: 'st', x: 30, z: 10, r: 0, pad: '' });
    const full = JSON.stringify({ t: 'st', x: 30, z: 10, r: 0, pad: 'x'.repeat(512 - head.length) });
    expect(full.length).toBe(512);
    a.c.ws.send(full);
    const ok = await o.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === a.id));
    expect(pose(ok.p.find((r: number[]) => r[0] === a.id))).toEqual([a.id, 30, 10, 0, 0]);

    a.c.ws.send(full + ' ');
    await o.c.next<any>((m) => m.t === 'leave' && m.id === a.id);
    expect(a.c.closed?.code).toBe(1009);
    await leaveAll(o);
  });

  it('rebuilds the roster from socket attachments after hibernating', async () => {
    const a = await arrive('pr_nap_a');
    const b = await arrive('pr_nap_b');
    a.c.send({ t: 'st', x: 100, z: 200, r: 5 });
    b.c.send({ t: 'st', x: -300, z: -400, r: 250 });
    await a.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === b.id));
    const floor = floorStub();
    await floor.playerAt(b.id, 'cr-1');
    await a.c.next<any>((m) => m.t === 'player' && m.id === b.id);

    await evictDurableObject(floor);

    const c = await arrive('pr_nap_c');
    expect(c.hello.players.find((p: any) => p.id === a.id)).toMatchObject({ x: 100, z: 200, r: 5, at: null });
    expect(c.hello.players.find((p: any) => p.id === b.id)).toMatchObject({ x: -300, z: -400, r: 250, at: { station: 'cr-1' } });
    await a.c.next<any>((m) => m.t === 'join' && m.player.id === c.id);

    // The woken object still knows both sockets: moves flow and a close reads as a leave.
    a.c.send({ t: 'mv', x: 120, z: 200, r: 5 });
    const moved = await c.c.next<any>((m) => m.t === 's' && m.p.some((r: number[]) => r[0] === a.id));
    expect(pose(moved.p.find((r: number[]) => r[0] === a.id))).toEqual([a.id, 120, 200, 5, 1]);
    await leaveAll(b);
    await c.c.next<any>((m) => m.t === 'leave' && m.id === b.id);
    const n = await c.c.next<any>((m) => m.t === 'online');
    expect(n.n).toBe(c.hello.online - 1);
    await floor.playerAt(b.id, null);
    await leaveAll(a, c);
  });
});
