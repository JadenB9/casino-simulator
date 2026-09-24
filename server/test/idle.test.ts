// Idle timeouts (IDLE_MS in shared/src/protocol.ts). The floor closes a socket nothing real has
// come from for a quarter of an hour; a table stands an idle player up the way Leave does and
// lets a watcher go; both close with CLOSE.IDLE. Tests move the clock past the deadline and run
// the object's alarm there (the suite's usual way with timers), so the real constant is tested.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { CLOSE, IDLE_MS } from '../../shared/src/protocol.ts';
import { connect, type Client } from './helpers.ts';
import { aid, buyIn, clockAt, closedWith, deadlines, enter, escrow, find, floor, makeLobby, money, player, sleep, table, type Player } from './party.ts';
import { IDLE_SWEEP_MS } from '../src/floor/index.ts';

afterEach(() => {
  vi.useRealTimers();
});

const AWAY = { code: CLOSE.IDLE, reason: 'away' };

async function onFloor(p: Player): Promise<{ c: Client; you: { x: number; z: number; r: number } }> {
  const { client } = await connect('floor', p.token, '', p.ip);
  const hello = await client!.next((m) => m.t === 'hello');
  return { c: client!, you: hello.you };
}

/** Messages on one socket are handled in order, but nothing answers these: give them a moment. */
const settle = () => sleep(80);

describe('the floor', () => {
  it('closes a socket nothing real has come from for IDLE_MS; moving, turning, talking, waving, a lobby list and `here` all count', async () => {
    const t0 = Date.now();
    const arrive = async (tag: string) => {
      const p = await player(`f${tag}`);
      return { p, ...(await onFloor(p)) };
    };
    const idle = await arrive('idle');
    const same = await arrive('same');
    const here = await arrive('here');
    const walk = await arrive('walk');
    const turn = await arrive('turn');
    const talk = await arrive('talk');
    const wave = await arrive('wave');
    const list = await arrive('list');

    // A minute before the quarter hour is up...
    clockAt(t0 + IDLE_MS - 60_000);
    same.c.send({ t: 'st', x: same.you.x, z: same.you.z, r: same.you.r }); // where it already was
    here.c.send({ t: 'here' });
    walk.c.send({ t: 'st', x: walk.you.x + 40, z: walk.you.z, r: walk.you.r });
    turn.c.send({ t: 'st', x: turn.you.x, z: turn.you.z, r: (turn.you.r + 64) % 256 });
    talk.c.send({ t: 'say', text: 'still here' });
    wave.c.send({ t: 'emote', e: 'wave' });
    list.c.send({ t: 'watch', game: 'blackjack' });
    await list.c.next((m) => m.t === 'lobbies');
    await settle();

    // ...and just after it, for everyone who has been here since t0.
    clockAt(t0 + IDLE_MS + 1_000);
    expect(await runDurableObjectAlarm(floor())).toBe(true);
    expect(await closedWith(idle.c)).toEqual(AWAY);
    expect(await closedWith(same.c)).toEqual(AWAY);
    for (const x of [here, walk, turn, talk, wave, list]) expect(x.c.closed).toBeNull();
    // Everyone still here sees them go.
    await here.c.next((m) => m.t === 'leave' && m.id === idle.p.id);
    await here.c.next((m) => m.t === 'leave' && m.id === same.p.id);

    // The next sweep is due when the first of the rest could be, not before.
    const next = await runInDurableObject(floor(), (_f, state) => state.storage.getAlarm());
    expect(next).toBeGreaterThanOrEqual(t0 + 2 * IDLE_MS - 60_000);
    expect(next).toBeGreaterThanOrEqual(t0 + IDLE_MS + 1_000 + IDLE_SWEEP_MS);

    // A quarter of an hour after they last did anything, they go too; then the sweep stops.
    clockAt(t0 + 2 * IDLE_MS);
    await runDurableObjectAlarm(floor());
    for (const x of [here, walk, turn, talk, wave, list]) expect(await closedWith(x.c)).toEqual(AWAY);
    expect(await runInDurableObject(floor(), (_f, state) => state.storage.getAlarm())).toBeNull();
  });

  it('what a player last did outlives the floor hibernating', async () => {
    const t0 = Date.now();
    const p = await player('fnap');
    const me = await onFloor(p);
    clockAt(t0 + 10 * 60_000);
    me.c.send({ t: 'here' });
    await settle();
    await evictDurableObject(floor()); // hibernation: the socket stays open, memory goes
    clockAt(t0 + IDLE_MS + 1_000);
    await runDurableObjectAlarm(floor());
    await settle();
    expect(me.c.closed).toBeNull();
    clockAt(t0 + 10 * 60_000 + IDLE_MS + 1_000);
    await runDurableObjectAlarm(floor());
    expect(await closedWith(me.c)).toEqual(AWAY);
  });

  it('a new arrival sets the sweep if none is set, and never pushes one back', async () => {
    const t0 = Date.now();
    const a = await player('fsweep');
    const first = await onFloor(a);
    const set = await runInDurableObject(floor(), (_f, state) => state.storage.getAlarm());
    expect(set).toBeGreaterThanOrEqual(t0 + IDLE_MS);
    clockAt(t0 + 5 * 60_000);
    const b = await player('fsweep');
    const second = await onFloor(b);
    expect(await runInDurableObject(floor(), (_f, state) => state.storage.getAlarm())).toBe(set);
    first.c.ws.close();
    second.c.ws.close();
  });
});

describe('a table', () => {
  it('stands a seated player up after IDLE_MS the way Leave does: the hand in play is settled, then the seat cashes out', async () => {
    const p = await player('tidle');
    const before = await money(p.id);
    const { client } = await connect('solo/blackjack', p.token, '', p.ip);
    const c = client!;
    const snap = await c.next((m) => m.t === 'table');
    const tableId: string = snap.meta.tableId;
    await buyIn(c, 100_000);
    c.send({ t: 'act', aid: aid(), a: { type: 'bet', amount: 2_500 } });
    c.send({ t: 'act', aid: aid(), a: { type: 'deal' } });
    // Solo blackjack has no turn clock: the hand waits for the player (or it ended on the deal).
    await c.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'turn' || e.type === 'insurance' || e.type === 'done'));
    const due = (await deadlines(tableId))[`idle:${p.id}`]!;
    expect(due).toBeGreaterThanOrEqual(Date.now() + IDLE_MS - 1_000);

    // Not a moment early.
    clockAt(due - 5_000);
    await runDurableObjectAlarm(table(tableId));
    await settle();
    expect(c.closed).toBeNull();

    clockAt(due + 1);
    await runDurableObjectAlarm(table(tableId));
    expect(await closedWith(c)).toEqual(AWAY);
    for (let i = 0; i < 100 && (await money(p.id)).in_play !== 0; i++) await sleep(20);
    // The round was played out (stood and settled, not handed back), and the chips came home.
    const stats = await env.DB.prepare(`SELECT rounds, wagered, net FROM casino_stats WHERE account_id = ?1 AND game = 'blackjack'`).bind(p.id).first<any>();
    expect(stats).toMatchObject({ rounds: 1, wagered: 2_500 });
    expect(await money(p.id)).toEqual({ balance: before.balance + stats.net, in_play: 0 });
    expect(await escrow(p.id, tableId)).toBeNull();

    // Back from the away screen: a new socket, as a newcomer.
    const back = (await connect('solo/blackjack', p.token, '', p.ip)).client!;
    const again = await back.next((m) => m.t === 'table');
    expect(again.you).toMatchObject({ status: 'watching', stack: 0 });
    back.ws.close();
  });

  it("anything the player asks for pushes the deadline back, `here` included, at most one write a minute; the client's own `sync` doesn't", async () => {
    const t0 = Date.now();
    const p = await player('tkeep');
    const c = (await connect('solo/highcard', p.token, '', p.ip)).client!;
    const tableId: string = (await c.next((m) => m.t === 'table')).meta.tableId;
    const key = `idle:${p.id}`;
    const first = (await deadlines(tableId))[key]!;
    expect(first).toBeGreaterThanOrEqual(t0 + IDLE_MS);

    // Straight away it is still far enough off: nothing is written.
    c.send({ t: 'here' });
    await settle();
    expect((await deadlines(tableId))[key]).toBe(first);

    // Five minutes on, `sync` doesn't move it; `here` does.
    clockAt(t0 + 5 * 60_000);
    c.send({ t: 'sync' });
    await c.next((m) => m.t === 'table');
    expect((await deadlines(tableId))[key]).toBe(first);
    c.send({ t: 'here' });
    await settle();
    expect((await deadlines(tableId))[key]).toBeGreaterThanOrEqual(t0 + 5 * 60_000 + IDLE_MS);

    // Ten minutes on, sitting down does.
    clockAt(t0 + 10 * 60_000);
    await buyIn(c, 10_000);
    const pushed = (await deadlines(tableId))[key]!;
    expect(pushed).toBeGreaterThanOrEqual(t0 + 10 * 60_000 + IDLE_MS);

    // So when the first deadline would have come, the player is still at the table.
    clockAt(first + 1);
    await runDurableObjectAlarm(table(tableId));
    await settle();
    expect(c.closed).toBeNull();
    c.send({ t: 'cashout', aid: aid() });
    await c.next((m) => m.t === 'balance' && m.inPlay === 0);
    c.ws.close();
  });

  it('a lobby member who only watches is let go, and the lead passes to someone still here', async () => {
    const a = await player('tlead');
    const b = await player('tstay');
    const made = await makeLobby(a, 'highcard');
    const [ca] = await enter(a, made.tableId);
    const [cb] = await enter(b, made.tableId);
    const t0 = Date.now();
    clockAt(t0 + 10 * 60_000);
    cb.send({ t: 'here' });
    await settle();
    const due = (await deadlines(made.tableId))[`idle:${a.id}`]!;
    clockAt(due + 1);
    await runDurableObjectAlarm(table(made.tableId));
    expect(await closedWith(ca)).toEqual(AWAY);
    const after = await cb.next((m) => m.t === 'members' && !find(m.members, a.id));
    expect(after.leader).toBe(b.id);
    expect(cb.closed).toBeNull();
    cb.ws.close();
  });
});
