// Celebrities and the gift box through the real floor object: a visit everyone hears about, one
// tip per account per visit and only beside the celebrity, a box the first finder keeps, every
// payment a keyed grant that a retry or a race can't pay twice, and every cent accounted for:
//   SUM(ledger) - SUM(items.price) - SUM(orders.price) = balance (+ in_play).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import worker from '../src/index.ts';
import { CELEBS, FIRST_VISIT_MS, GIFT_SPOTS, TALK_REACH_M, TIP_MAX, TIP_MIN, celebAt, celebOf, routeOfVisit, type GiftBox, type Visit } from '../../shared/src/celebs.ts';
import { STARTING_BALANCE } from '../../shared/src/money.ts';
import { ORIGIN, api, connect, type Client } from './helpers.ts';
import { clockAt, floor, player, sleep, type Player } from './party.ts';

afterEach(() => {
  vi.useRealTimers();
});

interface Walker {
  p: Player;
  c: Client;
}

/** Log in (a fresh name and address) and open the floor. */
async function arrive(tag: string): Promise<Walker> {
  const p = await player(tag);
  const { client } = await connect('floor', p.token, '', p.ip);
  await client!.next((m) => m.t === 'hello');
  return { p, c: client! };
}

/** Stand at (x, z) metres: a first position places you wherever you say (presence.ts). */
async function standAt(w: Walker, x: number, z: number): Promise<void> {
  w.c.send({ t: 'st', x: Math.round(x * 100), z: Math.round(z * 100), r: 0 });
  await sleep(40);
}

async function count(sql: string, ...args: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

async function money(id: number): Promise<{ balance: number; in_play: number; rev: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play, rev FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function expectBalanced(id: number): Promise<void> {
  const ledger = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ?1`, id);
  const items = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_items WHERE account_id = ?1`, id);
  const orders = await count(`SELECT COALESCE(SUM(price), 0) AS n FROM casino_orders WHERE account_id = ?1`, id);
  const m = await money(id);
  expect(ledger - items - orders).toBe(m.balance);
  expect(m.in_play).toBe(0);
}

async function tally(id: number, key: string): Promise<number> {
  return (await env.DB.prepare(`SELECT n FROM casino_tally WHERE account_id = ?1 AND key = ?2`).bind(id, key).first<{ n: number }>())?.n ?? 0;
}

/** A celebrity walks in now (the dev trigger, which the floor's RPC runs). */
async function visitBy(celeb: string): Promise<Visit> {
  return (await floor().celebDev('celeb', celeb)) as Visit;
}

/** The first stop on the visit's route, and the moment (ms) a few seconds into it. */
function firstStop(v: Visit): { x: number; z: number; at: number } {
  const tl = routeOfVisit(v);
  const seg = tl.segs.find((s) => s.kind === 'stop')!;
  const [x, z] = tl.route.pts[tl.route.stops[0]!.at]!;
  return { x, z, at: v.start + (seg.t0 + 3) * 1000 };
}

const leave = async (...ws: Walker[]) => {
  for (const w of ws) if (!w.c.closed) w.c.ws.close(1000, 'bye');
  await sleep(30);
};

describe('celebrity visits', () => {
  it('a newcomer hears the visit planned (a few minutes off) and everyone hears one walk in', async () => {
    const t0 = Date.now();
    const p = await player('cel_greet');
    const { client } = await connect('floor', p.token, '', p.ip);
    const c = client!;
    const hi = await c.next<any>((m) => m.t === 'celebs');
    // whatever was planned is someone real, and nobody walks in the moment you arrive
    if (hi.visit) {
      expect(celebOf(hi.visit.celeb)).not.toBeNull();
      if (hi.visit.start > t0) expect(hi.visit.start).toBeLessThanOrEqual(Date.now() + FIRST_VISIT_MS[1] + 40 * 60_000);
    }
    const o = await arrive('cel_greet_o');
    const v = await visitBy('vale');
    for (const w of [c, o.c]) expect((await w.next<any>((m) => m.t === 'celeb' && m.visit.id === v.id)).visit).toEqual(v);
    expect(v.celeb).toBe('vale');
    expect(v.start).toBeGreaterThan(Date.now());
    // a newcomer now is told about it straight after hello
    const n = await arrive('cel_greet_n');
    expect((await n.c.next<any>((m) => m.t === 'celebs')).visit).toEqual(v);
    c.ws.close();
    await leave(o, n);
  });

  it('pays one tip per visit, beside the celebrity, as a keyed grant; everyone sees the word', { timeout: 20_000 }, async () => {
    const a = await arrive('cel_tip_a');
    const o = await arrive('cel_tip_o');
    const v = await visitBy('maddox');
    const stop = firstStop(v);
    clockAt(stop.at);
    await standAt(a, stop.x, stop.z + 1.2);
    const before = await money(a.p.id);
    a.c.send({ t: 'celeb.talk', visit: v.id });
    const tip = await a.c.next<any>((m) => m.t === 'celeb.tip');
    expect(tip.visit).toBe(v.id);
    expect(tip.amount).toBeGreaterThanOrEqual(TIP_MIN);
    expect(tip.amount).toBeLessThanOrEqual(TIP_MAX);
    expect(tip.amount % 10_000).toBe(0);
    expect(tip.line).toBeGreaterThanOrEqual(0);
    expect(tip.line).toBeLessThan(celebOf('maddox')!.lines.hello.length);
    expect(tip.met).toBe(1);
    const after = await money(a.p.id);
    expect(after.balance).toBe(before.balance + tip.amount);
    expect({ balance: tip.balance, inPlay: tip.inPlay, rev: tip.rev }).toEqual({ balance: after.balance, inPlay: after.in_play, rev: after.rev });
    const row = await env.DB.prepare(`SELECT kind, amount, account_id FROM casino_ledger WHERE op_id = ?1`).bind(`celeb:${a.p.id}:${v.id}`).first<any>();
    expect(row).toEqual({ kind: 'grant', amount: tip.amount, account_id: a.p.id });
    expect(await tally(a.p.id, 'celeb:maddox')).toBe(1);
    // the room sees the champ turn and say it to this player
    expect(await o.c.next<any>((m) => m.t === 'celeb.talk')).toEqual({ t: 'celeb.talk', visit: v.id, id: a.p.id, line: tip.line });

    // again: already met, nothing more paid
    await sleep(2100);
    a.c.send({ t: 'celeb.talk', visit: v.id });
    const no = await a.c.next<any>((m) => m.t === 'celeb.no');
    expect(no.code).toBe('MET');
    expect(no.msg).toContain('Maddox');
    expect((await money(a.p.id)).balance).toBe(after.balance);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE op_id LIKE ?1`, `celeb:${a.p.id}:%`)).toBe(1);
    await expectBalanced(a.p.id);
    await leave(a, o);
  });

  it('a double press, or a retry, pays once', { timeout: 20_000 }, async () => {
    const a = await arrive('cel_twice');
    const v = await visitBy('quill');
    const stop = firstStop(v);
    clockAt(stop.at);
    await standAt(a, stop.x + 0.8, stop.z + 0.8);
    const before = await money(a.p.id);
    a.c.send({ t: 'celeb.talk', visit: v.id });
    a.c.send({ t: 'celeb.talk', visit: v.id });
    a.c.send({ t: 'celeb.talk', visit: v.id });
    const tip = await a.c.next<any>((m) => m.t === 'celeb.tip');
    await sleep(200);
    expect(a.c.msgs.filter((m) => m.t === 'celeb.tip')).toHaveLength(0);
    expect((await money(a.p.id)).balance).toBe(before.balance + tip.amount);
    // the floor forgets everything in memory (hibernation): the ledger still says it was paid
    await evictDurableObject(floor());
    await sleep(2100);
    a.c.send({ t: 'celeb.talk', visit: v.id });
    expect((await a.c.next<any>((m) => m.t === 'celeb.no')).code).toBe('MET');
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE op_id = ?1`, `celeb:${a.p.id}:${v.id}`)).toBe(1);
    await expectBalanced(a.p.id);
    await leave(a);
  });

  it('refuses a word from across the room, before they arrive, after they leave, and for another visit', { timeout: 20_000 }, async () => {
    const a = await arrive('cel_far');
    const v = await visitBy('harlow');
    const stop = firstStop(v);
    const before = await money(a.p.id);
    // not in yet (the dev trigger starts a visit a moment from now)
    await standAt(a, 0, 13.8);
    a.c.send({ t: 'celeb.talk', visit: v.id });
    expect((await a.c.next<any>((m) => m.t === 'celeb.no')).code).toBe('GONE');
    clockAt(stop.at);
    // just out of reach
    a.c.send({ t: 'st', x: Math.round(stop.x * 100), z: Math.round((stop.z + TALK_REACH_M + 0.4) * 100), r: 0 });
    await sleep(2100);
    a.c.send({ t: 'celeb.talk', visit: v.id });
    const far = await a.c.next<any>((m) => m.t === 'celeb.no');
    expect(far).toMatchObject({ code: 'FAR', visit: v.id });
    expect(far.msg).toContain('Dex Harlow');
    // some other visit's id
    await sleep(2100);
    a.c.send({ t: 'celeb.talk', visit: v.id - 1 });
    expect((await a.c.next<any>((m) => m.t === 'celeb.no')).code).toBe('GONE');
    // gone: past the end of the route
    clockAt(v.start + routeOfVisit(v).secs * 1000 + 5_000);
    await sleep(2100);
    a.c.send({ t: 'celeb.talk', visit: v.id });
    expect((await a.c.next<any>((m) => m.t === 'celeb.no')).code).toBe('GONE');
    expect((await money(a.p.id)).balance).toBe(before.balance);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE op_id LIKE ?1`, `celeb:${a.p.id}:%`)).toBe(0);
    await leave(a);
  });

  it('checks where the celebrity is on the route at that moment, walking or stopped', async () => {
    const a = await arrive('cel_walk');
    const v = await visitBy('castellan');
    // halfway down the first walk, between the doors and the lobby stop
    const t = v.start + 3_000;
    clockAt(t);
    const at = celebAt(v, t)!;
    expect(at.walking).toBe(true);
    await standAt(a, at.x + 1, at.z);
    a.c.send({ t: 'celeb.talk', visit: v.id });
    const tip = await a.c.next<any>((m) => m.t === 'celeb.tip');
    expect(tip.amount).toBeGreaterThan(0);
    await expectBalanced(a.p.id);
    await leave(a);
  });

  it('a new visit is a new tip; the tally counts who you have met', { timeout: 20_000 }, async () => {
    const a = await arrive('cel_again');
    for (const celeb of ['nightjar', 'nightjar', 'vale']) {
      const v = await visitBy(celeb);
      const stop = firstStop(v);
      clockAt(stop.at);
      await standAt(a, stop.x, stop.z + 1);
      await sleep(2100);
      a.c.send({ t: 'celeb.talk', visit: v.id });
      await a.c.next<any>((m) => m.t === 'celeb.tip' && m.visit === v.id);
      vi.useRealTimers();
    }
    expect(await tally(a.p.id, 'celeb:nightjar')).toBe(2);
    expect(await tally(a.p.id, 'celeb:vale')).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE op_id LIKE ?1`, `celeb:${a.p.id}:%`)).toBe(3);
    await expectBalanced(a.p.id);
    // GET /daily lists them
    const daily = await (await api('daily', a.p.token)).json<any>();
    expect(daily.met).toEqual({ nightjar: 2, vale: 1 });
    await leave(a);
  });

  it('rate limits asking', async () => {
    const a = await arrive('cel_slow');
    const v = await visitBy('vale');
    await standAt(a, 0, 13.9);
    for (let i = 0; i < 6; i++) a.c.send({ t: 'celeb.talk', visit: v.id });
    await a.c.next<any>((m) => m.t === 'celeb.no' && m.code === 'SLOW');
    await leave(a);
  });

  it('plans the next visit when one ends, with somebody new', async () => {
    const a = await arrive('cel_next');
    const v = await visitBy('quill');
    clockAt(v.start + routeOfVisit(v).secs * 1000 + 1_000);
    a.c.send({ t: 'here' });
    const next = (await a.c.next<any>((m) => m.t === 'celeb' && m.visit.id !== v.id)).visit as Visit;
    expect(next.celeb).not.toBe('quill');
    expect(next.start).toBeGreaterThan(Date.now());
    expect(CELEBS.some((c) => c.id === next.celeb)).toBe(true);
    const state = await runInDurableObject(floor(), (f) => f.celebs.visit);
    expect(state).toEqual(next);
    await leave(a);
  });
});

describe('the gift box', () => {
  async function leaveBox(spot: number): Promise<GiftBox> {
    return (await floor().celebDev('gift', spot)) as GiftBox;
  }

  it('everyone sees where it is, never what is inside; the first to open it keeps it', { timeout: 20_000 }, async () => {
    const a = await arrive('gift_a');
    const b = await arrive('gift_b');
    const box = await leaveBox(4);
    const [x, z] = GIFT_SPOTS[4]!;
    for (const w of [a, b]) {
      const seen = await w.c.next<any>((m) => m.t === 'gift' && m.gift.id === box.id);
      expect(seen.gift).toEqual({ id: box.id, x, z, until: box.until });
    }
    // too far
    await standAt(a, x, z - 3.5);
    await standAt(b, x + 0.5, z);
    a.c.send({ t: 'gift.open', id: box.id });
    expect((await a.c.next<any>((m) => m.t === 'gift.no')).code).toBe('FAR');
    // b opens it
    const before = await money(b.p.id);
    b.c.send({ t: 'gift.open', id: box.id });
    const won = await b.c.next<any>((m) => m.t === 'gift.won');
    expect(won.amount).toBeGreaterThanOrEqual(100_000);
    expect(won.amount).toBeLessThanOrEqual(500_000);
    expect((await money(b.p.id)).balance).toBe(before.balance + won.amount);
    expect(await a.c.next<any>((m) => m.t === 'gift.gone' && m.id === box.id)).toEqual({ t: 'gift.gone', id: box.id, name: b.p.name });
    expect(await env.DB.prepare(`SELECT account_id, kind FROM casino_ledger WHERE op_id = ?1`).bind(`gift:${box.id}`).first<any>()).toEqual({ account_id: b.p.id, kind: 'grant' });
    expect(await tally(b.p.id, 'gifts')).toBe(1);
    // a, now beside it, is too late; b asking again (a lost answer) hears the same, paid once
    await sleep(2100);
    a.c.send({ t: 'st', x: Math.round(x * 100), z: Math.round(z * 100), r: 0 });
    await sleep(40);
    a.c.send({ t: 'gift.open', id: box.id });
    expect(await a.c.next<any>((m) => m.t === 'gift.no')).toMatchObject({ code: 'GONE', msg: 'Someone got there first.' });
    b.c.send({ t: 'gift.open', id: box.id });
    expect((await b.c.next<any>((m) => m.t === 'gift.won')).amount).toBe(won.amount);
    expect((await money(b.p.id)).balance).toBe(before.balance + won.amount);
    await expectBalanced(a.p.id);
    await expectBalanced(b.p.id);
    await leave(a, b);
  });

  it('two players opening it at once: exactly one is paid', async () => {
    const a = await arrive('gift_race_a');
    const b = await arrive('gift_race_b');
    const box = await leaveBox(0);
    const [x, z] = GIFT_SPOTS[0]!;
    await standAt(a, x, z);
    await standAt(b, x, z);
    a.c.send({ t: 'gift.open', id: box.id });
    b.c.send({ t: 'gift.open', id: box.id });
    const answers = await Promise.all([a, b].map((w) => w.c.next<any>((m) => m.t === 'gift.won' || m.t === 'gift.no')));
    expect(answers.filter((m) => m.t === 'gift.won')).toHaveLength(1);
    expect(answers.filter((m) => m.t === 'gift.no')).toHaveLength(1);
    expect(await count(`SELECT count(*) AS n FROM casino_ledger WHERE op_id = ?1`, `gift:${box.id}`)).toBe(1);
    const total = (await money(a.p.id)).balance + (await money(b.p.id)).balance;
    expect(total).toBe(2 * STARTING_BALANCE + answers.find((m) => m.t === 'gift.won')!.amount);
    await expectBalanced(a.p.id);
    await expectBalanced(b.p.id);
    await leave(a, b);
  });

  it('runs out unfound, and the next one is planned', { timeout: 20_000 }, async () => {
    const a = await arrive('gift_out');
    const box = await leaveBox(7);
    clockAt(box.until + 1_000);
    a.c.send({ t: 'here' });
    expect(await a.c.next<any>((m) => m.t === 'gift.gone' && m.id === box.id)).toEqual({ t: 'gift.gone', id: box.id, name: null });
    await sleep(2100);
    a.c.send({ t: 'gift.open', id: box.id });
    expect((await a.c.next<any>((m) => m.t === 'gift.no')).code).toBe('GONE');
    const s = await runInDurableObject(floor(), (f) => ({ gift: f.celebs.gift }));
    expect(s.gift).toBeNull();
    await leave(a);
  });
});

describe('the dev trigger', () => {
  it('answers only on the dev stack, and only when logged in', async () => {
    const a = await player('cel_dev');
    const ask = (e: Env) =>
      worker.fetch(
        new Request('http://casino.test/casino/api/dev/celeb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Authorization: `Bearer ${a.token}` },
          body: JSON.stringify({ celeb: 'vale' }),
        }),
        e,
      );
    expect((await ask({ ...env, CASINO_DEV: '0' } as Env)).status).toBe(404);
    expect((await ask({ ...env, CASINO_DEV: undefined } as unknown as Env)).status).toBe(404);
    const ok = await ask(env);
    expect(ok.status).toBe(200);
    expect((await ok.json<any>()).visit.celeb).toBe('vale');
    expect((await api('dev/celeb', 'not-a-token', { method: 'POST', body: '{}' })).status).toBe(401);
  });
});
