// The law: punches (seen by everyone, hurting nobody), the staff's catches, warnings, jail across
// the street and bail. Money never moves through any of it: taken to jail, your tables stand you
// up the normal way and the chips go home; every cent is still accounted for:
//   SUM(ledger) - SUM(items.price) - SUM(orders.price) = balance.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { api, connect, type Client } from './helpers.ts';
import { clockAt, closedWith, floor, player, sleep, type Player } from './party.ts';
import { CLOSE } from '../../shared/src/protocol.ts';
import { DOLLAR } from '../../shared/src/money.ts';
import { STAFF, loopPose, staffSpec, type StaffId, type StaffSpec } from '../../shared/src/law/patrol.ts';
import { sees } from '../../shared/src/law/sight.ts';
import { roomAt } from '../../shared/src/law/plan.ts';
import { JAIL, JAIL_RECT, STRIKE_QUIET_MS, STRIKE_WINDOW_MS, bailFor, jailLimits } from '../../shared/src/law/rules.ts';
import { inRect } from '../../shared/src/zones.ts';
import { SPAWN } from '../src/floor/presence.ts';
import { TableLaw } from '../src/law-table.ts';
import type { CasinoFloor } from '../src/floor/index.ts';

afterEach(() => {
  vi.useRealTimers();
});

async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

async function expectBalanced(id: number): Promise<void> {
  const ledger = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, id);
  const items = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`, id);
  const orders = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`, id);
  expect(ledger - items - orders).toBe((await money(id)).balance);
}

async function jailRow(id: number): Promise<{ bail: number; won: number; released_at: number | null } | null> {
  return env.DB.prepare(`SELECT bail, won, released_at FROM casino_jail WHERE account_id = ?1 ORDER BY id DESC LIMIT 1`).bind(id).first<any>();
}

/** Onto the floor, standing at (x, z) metres facing `yaw` (a connection's first position places you). */
async function onFloor(p: Player, x: number, z: number, yaw = 0): Promise<Client> {
  const { client } = await connect('floor', p.token, '', p.ip);
  await client!.next((m) => m.t === 'hello');
  client!.send({ t: 'st', x: Math.round(x * 100), z: Math.round(z * 100), r: yawByte(yaw) });
  await sleep(60);
  return client!;
}

function yawByte(yaw: number): number {
  return ((Math.round((yaw / (Math.PI * 2)) * 256) % 256) + 256) % 256;
}

async function leave(...cs: Client[]): Promise<void> {
  for (const c of cs) if (!c.closed) c.ws.close(1000, 'bye');
  await sleep(80);
}

async function busyStaff(): Promise<Set<StaffId>> {
  return runInDurableObject(floor(), (f: CasinoFloor) => new Set(f.law.active(Date.now()).map((d) => d.staff)));
}

/**
 * A spot `ahead` metres in front of a staff member who will see it for the next several seconds
 * (in his cone, in his room), and the way he faces. The clock moves to the next moment he stands
 * still at one of his stops long enough; staff busy on a detour are passed over.
 */
async function inView(kind: StaffSpec['kind'], ahead = 2.2): Promise<{ spec: StaffSpec; x: number; z: number; yaw: number }> {
  const busy = await busyStaff();
  const now = Date.now() + 20_000;
  for (let dt = 0; dt < 240_000; dt += 500) {
    const t = now + dt;
    for (const spec of STAFF) {
      if (spec.kind !== kind || busy.has(spec.id)) continue;
      const p = loopPose(spec, t);
      if (p.moving) continue;
      const x = p.x + Math.sin(p.yaw) * ahead;
      const z = p.z + Math.cos(p.yaw) * ahead;
      const victim = { x: x + Math.sin(p.yaw) * 0.8, z: z + Math.cos(p.yaw) * 0.8 };
      let ok = roomAt(victim.x, victim.z) !== null;
      for (let u = t; ok && u < t + 5_000; u += 200) ok = sees(spec, loopPose(spec, u), x, z);
      if (!ok) continue;
      clockAt(t);
      return { spec, x, z, yaw: p.yaw };
    }
  }
  throw new Error(`no ${kind} free to see anything`);
}

/** A spot in the casino no member of staff can see for the next few seconds. */
function outOfSight(): { x: number; z: number } {
  const now = Date.now();
  const spots = [
    { x: -29, z: 13 },
    { x: 29, z: -29 },
    { x: -29, z: -29 },
    { x: 29, z: 13 },
    { x: -15, z: 13 },
    { x: 15, z: 13 },
  ];
  for (const s of spots) {
    let hidden = true;
    for (let t = now; hidden && t < now + 5_000; t += 200) hidden = STAFF.every((spec) => !sees(spec, loopPose(spec, t), s.x, s.z) && !sees(spec, loopPose(spec, t), s.x, s.z + 0.8));
    if (hidden) return s;
  }
  throw new Error('every spot is watched');
}

async function positionOf(id: number): Promise<{ x: number; z: number } | null> {
  return runInDurableObject(floor(), (f: CasinoFloor) => f.presence.positionOf(id));
}

/** Take this player to jail: two catches, the second after the quiet time (the clock moved). */
async function arrest(p: Player): Promise<void> {
  await runInDurableObject(floor(), async (f: CasinoFloor) => {
    const now = Date.now();
    await f.law.strike(p.id, p.name, 'g1', 'punch', now);
    await f.law.strike(p.id, p.name, 'g1', 'punch', now + STRIKE_QUIET_MS + 1);
  });
}

describe('punches', { timeout: 20_000 }, () => {
  it('land on the player in front for everyone to see, and hurt nobody', async () => {
    const spot = outOfSight();
    const a = await player('lw_pa');
    const b = await player('lw_pb');
    const before = await money(b.id);
    const ca = await onFloor(a, spot.x, spot.z, 0);
    const cb = await onFloor(b, spot.x, spot.z + 0.8, Math.PI);
    ca.send({ t: 'punch', r: 0 });
    const seen = await cb.next((m) => m.t === 'punch' && m.id === a.id);
    expect(seen.hit).toBe(b.id);
    await ca.next((m) => m.t === 'punch' && m.id === a.id);
    // nobody saw it: no warning
    await sleep(150);
    expect([...ca.msgs, ...cb.msgs].some((m) => m.t === 'law' && m.ev.id === a.id)).toBe(false);
    expect(await money(b.id)).toEqual(before);
    await leave(ca, cb);
  });

  it("swing at the air when nobody is in reach, and come no faster than a fist can", async () => {
    const spot = outOfSight();
    const a = await player('lw_air');
    const ca = await onFloor(a, spot.x, spot.z, Math.PI / 2);
    ca.send({ t: 'punch', r: 64 });
    ca.send({ t: 'punch', r: 64 });
    ca.send({ t: 'punch', r: 64 });
    const m = await ca.next((m) => m.t === 'punch' && m.id === a.id);
    expect(m.hit).toBeNull();
    await sleep(200);
    expect(ca.msgs.filter((x) => x.t === 'punch' && x.id === a.id)).toHaveLength(0);
    await leave(ca);
  });

  it('are refused from a table: sitting down, you keep your hands to yourself', async () => {
    const spot = outOfSight();
    const a = await player('lw_seat');
    const b = await player('lw_seatb');
    const ca = await onFloor(a, spot.x, spot.z, 0);
    const cb = await onFloor(b, spot.x, spot.z + 0.8, Math.PI);
    await floor().playerAt(a.id, 'bj-1');
    ca.send({ t: 'punch', r: 0 });
    await sleep(200);
    expect(cb.msgs.some((m) => m.t === 'punch' && m.id === a.id)).toBe(false);
    await floor().playerAt(a.id, null);
    await leave(ca, cb);
  });

  it('seen by a guard, get you a word from him: a warning, and his walk over for everyone', async () => {
    const v = await inView('guard');
    const a = await player('lw_warn');
    const b = await player('lw_warnb');
    const ca = await onFloor(a, v.x, v.z, v.yaw);
    const cb = await onFloor(b, v.x + Math.sin(v.yaw) * 0.8, v.z + Math.cos(v.yaw) * 0.8, v.yaw + Math.PI);
    ca.send({ t: 'punch', r: yawByte(v.yaw) });
    const law = await cb.next((m) => m.t === 'law' && m.ev.id === a.id);
    expect(law.ev).toMatchObject({ k: 'warn', name: a.name, why: 'punch' });
    expect(law.ev.until).toBeGreaterThan(Date.now() + STRIKE_WINDOW_MS - 5_000);
    const d = await ca.next((m) => m.t === 'detour' && m.d.who === a.id);
    expect(d.d.kind).toBe('warn');
    // somebody arriving now hears about the walk under way
    const late = await player('lw_late');
    const { client: cl } = await connect('floor', late.token, '', late.ip);
    const list = await cl!.next((m) => m.t === 'detours');
    expect(list.list.some((x: any) => x.who === a.id)).toBe(true);
    // not jail: a warning
    expect(await jailRow(a.id)).toBeNull();
    await leave(ca, cb, cl!);
  });
});

describe('punching staff', { timeout: 20_000 }, () => {
  it('lands on him, he shrugs it off, and he saw it: a warning from him', async () => {
    const v = await inView('guard', 0.9);
    const a = await player('lw_staff');
    // right in front of him, facing him
    const ca = await onFloor(a, v.x, v.z, v.yaw + Math.PI);
    ca.send({ t: 'punch', r: yawByte(v.yaw + Math.PI) });
    const m = await ca.next((m) => m.t === 'punch' && m.id === a.id);
    expect(m.hit).toBe(v.spec.id);
    const law = await ca.next((m) => m.t === 'law' && m.ev.id === a.id);
    expect(law.ev).toMatchObject({ k: 'warn', staff: v.spec.id, why: 'punch' });
    await leave(ca);
  });
});

describe('the pit boss', { timeout: 20_000 }, () => {
  it('catches someone winning too much where he can see them, and nobody out of his sight', async () => {
    const v = await inView('boss');
    const a = await player('lw_hot');
    const ca = await onFloor(a, v.x, v.z, v.yaw);
    expect(await floor().lawHot({ accountId: a.id, name: a.name, amount: 900_000 })).toBe('warned');
    const law = await ca.next((m) => m.t === 'law' && m.ev.id === a.id);
    expect(law.ev).toMatchObject({ k: 'warn', staff: 'boss', why: 'win' });
    // reported again straight away: he's on his way over already, busy with you
    expect(await floor().lawHot({ accountId: a.id, name: a.name, amount: 900_000 })).toBe('unseen');
    await leave(ca);

    const hidden = outOfSight();
    const b = await player('lw_hid');
    const cb = await onFloor(b, hidden.x, hidden.z);
    expect(await floor().lawHot({ accountId: b.id, name: b.name, amount: 900_000 })).toBe('unseen');
    // and someone not on the floor at all
    const c = await player('lw_away');
    expect(await floor().lawHot({ accountId: c.id, name: c.name, amount: 900_000 })).toBe('unseen');
    await leave(cb);
  });
});

describe('strikes', { timeout: 20_000 }, () => {
  it("on the dev stack, the pit boss's catch on demand (the e2e's catch at a table)", async () => {
    const a = await player('lw_dev');
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    const res = await api('dev/law/catch', a.token, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).result).toBe('warned');
    await leave(ca);
  });

  it('run out: a catch after the window is a fresh warning, not jail', async () => {
    const a = await player('lw_exp');
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    const r = await runInDurableObject(floor(), async (f: CasinoFloor) => {
      const now = Date.now();
      return [await f.law.strike(a.id, a.name, 'g2', 'punch', now), await f.law.strike(a.id, a.name, 'g2', 'punch', now + STRIKE_WINDOW_MS + 1)];
    });
    expect(r).toEqual(['warned', 'warned']);
    expect(await jailRow(a.id)).toBeNull();
    await leave(ca);
  });
});

describe('jail', { timeout: 20_000 }, () => {
  it('takes a player caught twice across the street, keeps them there, and lets them out on bail', async () => {
    const a = await player('lw_jail');
    const worth = await money(a.id);
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    await arrest(a);
    const bail = bailFor(worth.balance + worth.in_play);
    expect(await jailRow(a.id)).toMatchObject({ bail, won: 0, released_at: null });
    const jailMsg = await ca.next((m) => m.t === 'jail' && m.jail);
    expect(jailMsg.jail).toMatchObject({ bail, won: 0 });
    await ca.next((m) => m.t === 'law' && m.ev.id === a.id && m.ev.k === 'jail');
    // the guard walks over, then across the street
    const tp = await ca.next((m) => m.t === 'tp', 10_000);
    expect(inRect(JAIL_RECT, tp.x, tp.z)).toBe(true);
    expect(tp.x).toBe(Math.round(JAIL.spawn.x * 100));
    // walking back to the casino gets nowhere: the jail keeps you
    ca.send({ t: 'mv', x: tp.x - 600, z: tp.z, r: 0 });
    await sleep(80);
    ca.send({ t: 'st', x: 0, z: 0, r: 0 });
    await sleep(80);
    expect(inRect(JAIL_RECT, (await positionOf(a.id))!.x, (await positionOf(a.id))!.z)).toBe(true);
    expect(await runInDurableObject(floor(), (f: CasinoFloor) => f.law.isConfined(a.id))).toBe(true);

    // reconnecting doesn't get you out: back inside, confined, told your bail
    await leave(ca);
    const { client: again } = await connect('floor', a.token, '', a.ip);
    await again!.next((m) => m.t === 'hello');
    await again!.next((m) => m.t === 'jail' && m.jail?.bail === bail);
    const back = await again!.next((m) => m.t === 'tp');
    expect(inRect(JAIL_RECT, back.x, back.z)).toBe(true);
    again!.send({ t: 'st', x: 0, z: 1280, r: 0 });
    await sleep(120);
    const pos = (await positionOf(a.id))!;
    expect(inRect(JAIL_RECT, pos.x, pos.z)).toBe(true);

    // progress: losses never take it below nothing; reaching bail lets you out
    await floor().jailRound(a.id, -50_000);
    expect((await jailRow(a.id))!.won).toBe(0);
    await floor().jailRound(a.id, bail / 2);
    expect((await jailRow(a.id))!.won).toBe(bail / 2);
    const update = await again!.next((m) => m.t === 'jail' && m.jail?.won === bail / 2);
    expect(update.jail.bail).toBe(bail);
    await floor().jailRound(a.id, -bail);
    expect((await jailRow(a.id))!.won).toBe(0);
    await floor().jailRound(a.id, bail + 100);
    const row = (await jailRow(a.id))!;
    expect(row.released_at).not.toBeNull();
    await again!.next((m) => m.t === 'jail' && m.jail === null);
    await again!.next((m) => m.t === 'law' && m.ev.k === 'free' && m.ev.id === a.id);
    const out = await again!.next((m) => m.t === 'tp', 6_000);
    expect({ x: out.x, z: out.z }).toEqual({ x: SPAWN.x, z: SPAWN.z });
    expect(await runInDurableObject(floor(), (f: CasinoFloor) => f.law.isConfined(a.id))).toBe(false);
    // free again: strikes cleared, so the next catch is only a warning
    const r = await runInDurableObject(floor(), (f: CasinoFloor) => f.law.strike(a.id, a.name, 'g3', 'punch', Date.now()));
    expect(r).toBe('warned');
    await expectBalanced(a.id);
    await leave(again!);
  });

  it('stands you up from your table first: the chips go home, not a cent lost', async () => {
    const a = await player('lw_evict');
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    const { client } = await connect('solo/highcard', a.token, '', a.ip);
    const t = client!;
    await t.next((m) => m.t === 'table');
    t.send({ t: 'buyin', aid: 'b1', amount: 20_000 });
    await t.next((m) => m.t === 'seat' && m.status === 'seated');
    t.send({ t: 'act', aid: 'bet1', a: { type: 'bet', amount: 1_000 } });
    await t.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'bet'));
    const before = await money(a.id);
    expect(before.in_play).toBe(20_000);
    await arrest(a);
    expect((await closedWith(t, 5_000)).code).toBe(CLOSE.FORBIDDEN);
    for (let i = 0; i < 50 && (await money(a.id)).in_play > 0; i++) await sleep(100);
    const after = await money(a.id);
    // the undealt bet came back with the rest of the stack
    expect(after).toEqual({ balance: before.balance + 20_000, in_play: 0 });
    await expectBalanced(a.id);
    await leave(ca);
  });

  it("keeps an inmate to the jail's own tables, at the jail's limits", async () => {
    const a = await player('lw_tables');
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    await arrest(a);
    const bail = (await jailRow(a.id))!.bail;
    // no other game, no lobby, no new lobby
    const { client: other } = await connect('solo/roulette', a.token, '', a.ip);
    expect((await closedWith(other!)).code).toBe(CLOSE.FORBIDDEN);
    const { client: lobby } = await connect('table/bj-abcdefghij', a.token, '', a.ip);
    expect((await closedWith(lobby!)).code).toBe(CLOSE.FORBIDDEN);
    const made = await api('tables', a.token, { method: 'POST', body: JSON.stringify({ game: 'blackjack' }) });
    expect(made.status).toBe(403);
    const joined = await api('tables/join', a.token, { method: 'POST', body: JSON.stringify({ pin: '1234' }) });
    expect(joined.status).toBe(403);
    // the jail's blackjack: a table of its own, at a quarter of the bail
    const { client: bj } = await connect('solo/blackjack', a.token, '&limits=100-100000000', a.ip);
    const snap = await bj!.next((m) => m.t === 'table');
    const lim = jailLimits('blackjack', bail)!;
    expect(snap.meta.config.limits.default).toMatchObject({ min: lim.min, max: lim.max });
    bj!.send({ t: 'buyin', aid: 'jb1', amount: 10_000 });
    await bj!.next((m) => m.t === 'seat' && m.status === 'seated');
    expect(await count(`SELECT count(*) AS n FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2`, a.id, `solo:blackjack:jail:${a.id}`)).toBe(1);
    // made bail: the jail table stands you up, and you keep what's on it
    await floor().jailRound(a.id, bail);
    expect((await closedWith(bj!, 5_000)).code).toBe(CLOSE.FORBIDDEN);
    for (let i = 0; i < 50 && (await money(a.id)).in_play > 0; i++) await sleep(100);
    expect((await money(a.id)).in_play).toBe(0);
    await expectBalanced(a.id);
    // and free, any table again
    const { client: free } = await connect('solo/roulette', a.token, '', a.ip);
    await free!.next((m) => m.t === 'table');
    await leave(ca, free!);
  });

  it('outlasts the floor sleeping: woken, it still knows who is inside', async () => {
    const a = await player('lw_nap');
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    await arrest(a);
    await ca.next((m) => m.t === 'tp', 10_000);
    await leave(ca);
    await evictDurableObject(floor());
    expect(await runInDurableObject(floor(), (f: CasinoFloor) => f.law.isConfined(a.id) || f.law.jailOf(a.id) !== null)).toBe(true);
    const { client } = await connect('floor', a.token, '', a.ip);
    await client!.next((m) => m.t === 'jail' && m.jail);
    const tp = await client!.next((m) => m.t === 'tp');
    expect(inRect(JAIL_RECT, tp.x, tp.z)).toBe(true);
    await leave(client!);
  });

  it("counts a real round at the jail's Sic Bo toward bail: its net, never below nothing", async () => {
    const a = await player('lw_round');
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    await arrest(a);
    const { client } = await connect('solo/sicbo', a.token, '', a.ip);
    const t = client!;
    await t.next((m) => m.t === 'table');
    t.send({ t: 'buyin', aid: 'sb1', amount: 20_000 });
    await t.next((m) => m.t === 'seat' && m.status === 'seated');
    t.send({ t: 'act', aid: 'bet1', a: { type: 'bet', bets: [{ spot: 'big', amount: 2_000 }] } });
    await t.next((m) => m.t === 'seat' && m.stack === 18_000);
    t.send({ t: 'act', aid: 'roll1', a: { type: 'roll' } });
    const settled = await t.next((m) => m.t === 'seat' && m.stack !== 18_000, 5_000).catch(() => null);
    const stack = settled?.stack ?? 18_000;
    const net = stack - 20_000;
    let won = -1;
    for (let i = 0; i < 40; i++) {
      won = (await jailRow(a.id))!.won;
      if (won === Math.max(0, net)) break;
      await sleep(50);
    }
    expect(won).toBe(Math.max(0, net));
    await leave(ca, t);
  });

  it('is only ever one open stay: a second arrest while inside changes nothing', async () => {
    const a = await player('lw_once');
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    await arrest(a);
    await runInDurableObject(floor(), (f: CasinoFloor) => f.law.arrest(a.id, a.name, 'boss', 'win', Date.now()));
    expect(await count(`SELECT count(*) AS n FROM casino_jail WHERE account_id = ?1 AND released_at IS NULL`, a.id)).toBe(1);
    expect(await runInDurableObject(floor(), (f: CasinoFloor) => f.law.strike(a.id, a.name, 'g1', 'punch', Date.now()))).toBe('jailed');
    await leave(ca);
  });

  it('survives a clock far in the future: an open stay never runs out by itself', async () => {
    const a = await player('lw_clock');
    const hidden = outOfSight();
    const ca = await onFloor(a, hidden.x, hidden.z);
    await arrest(a);
    await leave(ca);
    clockAt(Date.now() + 24 * 3600_000);
    const { client } = await connect('floor', a.token, '', a.ip);
    await client!.next((m) => m.t === 'jail' && m.jail);
    await leave(client!);
  });
});

describe('a table, for the law', { timeout: 20_000 }, () => {
  const who = (seat: number) => (seat === 0 ? { accountId: 1, name: 'ann' } : seat === 1 ? { accountId: 2, name: 'bob' } : undefined);
  const limits = { min: 5 * DOLLAR, max: 500 * DOLLAR }; // hot at $2,000

  it('reports a player whose winnings here in the last few minutes pass the hot amount, then waits', () => {
    const law = new TableLaw('bj-abcdefghij');
    const t = 1_000_000;
    expect(law.rounds([{ seat: 0, wagered: 50_000, returned: 100_000 }], who, limits, t)).toEqual([]);
    expect(law.rounds([{ seat: 0, wagered: 50_000, returned: 100_000 }], who, limits, t + 1_000)).toEqual([]);
    expect(law.rounds([{ seat: 0, wagered: 50_000, returned: 150_000 }], who, limits, t + 2_000)).toEqual([{ kind: 'hot', accountId: 1, name: 'ann', amount: 200_000 }]);
    // not again straight away, even still hot
    expect(law.rounds([{ seat: 0, wagered: 10_000, returned: 20_000 }], who, limits, t + 3_000)).toEqual([]);
    // caught: the streak starts again
    law.caught(1);
    expect(law.rounds([{ seat: 0, wagered: 10_000, returned: 20_000 }], who, limits, t + 60_000)).toEqual([]);
  });

  it('never reports a player who is down: a big win among bigger losses, or after a run of them', () => {
    const t = 1_000_000;
    // one spot pays big, the others lose more: down on the round
    const a = new TableLaw('bj-abcdefghij');
    expect(a.rounds([{ seat: 0, wagered: 10_000, returned: 1_000_000 }, { seat: 0, wagered: 2_000_000, returned: 0 }], who, limits, t)).toEqual([]);
    // a run of big losses, then a big win that doesn't get them back up
    const b = new TableLaw('bj-abcdefghij');
    b.rounds([{ seat: 0, wagered: 5_000_000, returned: 0 }], who, limits, t);
    expect(b.rounds([{ seat: 0, wagered: 100_000, returned: 2_000_000 }], who, limits, t + 1_000)).toEqual([]);
    // and losing, however much, never is
    const c = new TableLaw('bj-abcdefghij');
    expect(c.rounds([{ seat: 0, wagered: 50_000_000, returned: 0 }], who, limits, t)).toEqual([]);
  });

  it('forgets winnings older than the window, and counts losses against them', () => {
    const law = new TableLaw('bj-abcdefghij');
    const t = 1_000_000;
    law.rounds([{ seat: 0, wagered: 50_000, returned: 200_000 }], who, limits, t);
    expect(law.rounds([{ seat: 0, wagered: 50_000, returned: 100_000 }], who, limits, t + 6 * 60_000)).toEqual([]);
    const l2 = new TableLaw('bj-abcdefghij');
    l2.rounds([{ seat: 0, wagered: 50_000, returned: 200_000 }], who, limits, t);
    expect(l2.rounds([{ seat: 0, wagered: 50_000, returned: 0 }, { seat: 1, wagered: 100, returned: 0 }], who, limits, t + 1_000)).toEqual([]);
  });

  it('reports a single big hit at once', () => {
    const law = new TableLaw('sl-abcdefghij');
    expect(law.rounds([{ seat: 0, wagered: 100, returned: 600_000 }], who, null, 5)).toEqual([{ kind: 'hot', accountId: 1, name: 'ann', amount: 599_900 }]);
  });

  it("at a jail table, reports every round's net toward bail (a player's spots together), and no streaks", () => {
    const law = new TableLaw('solo:blackjack:jail:1');
    expect(
      law.rounds(
        [
          { seat: 0, wagered: 1_000, returned: 2_000 },
          { seat: 0, wagered: 1_000, returned: 0, spot: 1 },
          { seat: 1, wagered: 100, returned: 900_000 },
        ],
        who,
        limits,
        5,
      ),
    ).toEqual([{ kind: 'jail', accountId: 2, net: 899_900 }]);
  });
});
