import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, connect } from './helpers.ts';
import { aid, buyIn, inTable, player, type Player } from './party.ts';
import { CHECK_MSG } from '../../shared/src/protocol.ts';
import { MIN_RT } from '../../shared/src/fair.ts';
import { CLEAR_MS, MISS_WAIT_MS, answer, fairOf, issue, note } from '../src/fair.ts';
import { IMG_H, IMG_W } from '../src/fair-image.ts';

const post = (p: Player, path: string, body: unknown) => api(path, p.token, { method: 'POST', body: JSON.stringify(body), headers: { 'CF-Connecting-IP': p.ip } });
const get = (p: Player, path: string) => api(path, p.token, { headers: { 'CF-Connecting-IP': p.ip } });

/** The answer the Worker keeps for a chip challenge, and an issue time far enough back to answer. */
async function solution(id: string): Promise<{ x: number; y: number }> {
  await env.DB.prepare(`UPDATE casino_checks SET issued_at = issued_at - 5000 WHERE id = ?1`).bind(id).run();
  const row = await env.DB.prepare(`SELECT answer FROM casino_checks WHERE id = ?1`).bind(id).first<{ answer: string }>();
  return JSON.parse(row!.answer);
}

/** A script's reactions: a quick fixed delay, every time. */
const scripted = (n: number) => ({ rt: Array.from({ length: n }, (_, i) => 100 + (i % 5)) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fair: evidence and the line', () => {
  it('a scripted account is due once there is enough evidence, never on the dev stack, never again soon after a pass', async () => {
    const p = await player('fair_note');
    const now = Date.now();
    expect(await note(env.DB, p.id, scripted(MIN_RT - 1), now, true)).toBe('ok');
    // The dev stack keeps the score but never makes a check due.
    expect(await note(env.DB, p.id, scripted(1), now, false)).toBe('ok');
    expect((await env.DB.prepare(`SELECT score FROM casino_fair WHERE account_id = ?1`).bind(p.id).first<{ score: number }>())!.score).toBeGreaterThanOrEqual(2);
    expect(await note(env.DB, p.id, scripted(1), now, true)).toBe('due');

    const q = await player('fair_clear');
    await env.DB.prepare(`INSERT INTO casino_fair (account_id, clear_until, updated_at) VALUES (?1, ?2, ?3)`).bind(q.id, now + CLEAR_MS, now).run();
    expect(await note(env.DB, q.id, scripted(300), now, true)).toBe('ok');
    expect(await note(env.DB, q.id, scripted(1), now + CLEAR_MS, true)).toBe('due');
  });

  it('a report never undoes a pause', async () => {
    const p = await player('fair_keep');
    await post(p, 'dev/check', { paused: true });
    expect(await note(env.DB, p.id, { rt: [2000] }, Date.now(), true)).toBe('paused');
    expect((await fairOf(env.DB, p.id)).state).toBe('paused');
  });
});

describe('fair: the check', () => {
  it('nothing to do when all is well', async () => {
    const p = await player('fair_ok');
    expect(await (await get(p, 'check')).json()).toEqual({ state: 'ok' });
  });

  it('hands out a picture, passes the right drop once, and refuses a replay', async () => {
    const p = await player('fair_pass');
    await post(p, 'dev/check', { paused: true });
    const res = await (await get(p, 'check')).json<any>();
    expect(res.state).toBe('paused');
    const ch = res.challenge;
    expect(ch.kind).toBe('chip');
    expect([ch.w, ch.h]).toEqual([IMG_W, IMG_H]);
    const png = Uint8Array.from(atob(ch.png), (c) => c.charCodeAt(0));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // The answer is only on the server.
    expect(JSON.stringify(res)).not.toMatch(/GOLD|RED|BLUE|WHITE|BLACK|PURPLE/);

    const at = await solution(ch.id);
    const ok = await (await post(p, 'check', { id: ch.id, x: at.x + 5, y: at.y - 5 })).json<any>();
    expect(ok).toEqual({ ok: true, state: 'ok' });
    const f = await fairOf(env.DB, p.id);
    expect(f.state).toBe('ok');
    expect(f.clear_until).toBeGreaterThan(Date.now() + CLEAR_MS - 60_000);
    // The same answer again: spent.
    await post(p, 'dev/check', { paused: true });
    expect((await (await post(p, 'check', { id: ch.id, x: at.x, y: at.y })).json<any>()).ok).toBe(false);
  });

  it('a miss pauses on, and the wait doubles with each miss in a row', async () => {
    const p = await player('fair_miss');
    await post(p, 'dev/check', { paused: true });
    const ch = (await (await get(p, 'check')).json<any>()).challenge;
    const at = await solution(ch.id);
    const miss = await (await post(p, 'check', { id: ch.id, x: at.x + 60, y: at.y })).json<any>();
    expect(miss.ok).toBe(false);
    expect(miss.state).toBe('paused');
    expect(miss.wait).toBeGreaterThan(Date.now() + MISS_WAIT_MS - 2000);
    // Waiting: no picture, just when.
    const waiting = await (await get(p, 'check')).json<any>();
    expect(waiting.challenge).toBeUndefined();
    expect(waiting.wait).toBe(miss.wait);

    await env.DB.prepare(`UPDATE casino_fair SET retry_at = 0 WHERE account_id = ?1`).bind(p.id).run();
    const ch2 = (await (await get(p, 'check')).json<any>()).challenge;
    await solution(ch2.id);
    const miss2 = await (await post(p, 'check', { id: ch2.id, x: -100, y: -100 })).json<any>();
    expect(miss2.wait).toBeGreaterThan(Date.now() + 2 * MISS_WAIT_MS - 2000);
    expect((await fairOf(env.DB, p.id)).fails).toBe(2);
  });

  it('too quick to be a hand, too late, or someone else\'s: a miss', async () => {
    const p = await player('fair_fast');
    await post(p, 'dev/check', { paused: true });
    const now = Date.now();
    const quick = await issue(env, p.id, now, 'chip');
    const want = JSON.parse((await env.DB.prepare(`SELECT answer FROM casino_checks WHERE id = ?1`).bind(quick.id).first<{ answer: string }>())!.answer);
    expect(await answer(env, p.id, { id: quick.id, ...want }, now + 200, null)).toEqual({ ok: false, why: 'wrong' });

    await env.DB.prepare(`UPDATE casino_fair SET retry_at = 0 WHERE account_id = ?1`).bind(p.id).run();
    const late = await issue(env, p.id, now, 'chip');
    const lateAt = JSON.parse((await env.DB.prepare(`SELECT answer FROM casino_checks WHERE id = ?1`).bind(late.id).first<{ answer: string }>())!.answer);
    expect(await answer(env, p.id, { id: late.id, ...lateAt }, late.expires + 1, null)).toEqual({ ok: false, why: 'expired' });

    const q = await player('fair_other');
    const theirs = await issue(env, q.id, now, 'chip');
    expect(await answer(env, p.id, { id: theirs.id, x: 1, y: 1 }, now + 2000, null)).toEqual({ ok: false, why: 'gone' });
  });

  it('Turnstile when the Worker has its keys: the token is checked with Cloudflare, once', async () => {
    const p = await player('fair_ts');
    await post(p, 'dev/check', { paused: true });
    const tsEnv = { DB: env.DB, TURNSTILE_SITEKEY: '1x00000000000000000000AA', TURNSTILE_SECRET: 'test-secret' };
    const seen: FormData[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      seen.push(init!.body as FormData);
      return new Response(JSON.stringify({ success: (init!.body as FormData).get('response') === 'good' }));
    });
    const now = Date.now();
    const bad = await issue(tsEnv, p.id, now, 'any');
    expect(bad).toMatchObject({ kind: 'turnstile', sitekey: tsEnv.TURNSTILE_SITEKEY });
    expect(await answer(tsEnv, p.id, { id: bad.id, token: 'bad' }, now + 1000, '1.2.3.4')).toEqual({ ok: false, why: 'wrong' });
    await env.DB.prepare(`UPDATE casino_fair SET retry_at = 0 WHERE account_id = ?1`).bind(p.id).run();
    const good = await issue(tsEnv, p.id, now, 'any');
    expect(await answer(tsEnv, p.id, { id: good.id, token: 'good' }, now + 1000, '1.2.3.4')).toEqual({ ok: true });
    expect(seen[1]!.get('secret')).toBe('test-secret');
    expect(seen[1]!.get('idempotency_key')).toBe(good.id);
    expect(seen[1]!.get('remoteip')).toBe('1.2.3.4');
    // The built-in one is always there too (kind chip), and without the keys it's all there is.
    expect((await issue(tsEnv, p.id, now, 'chip')).kind).toBe('chip');
    expect((await issue({ DB: env.DB }, p.id, now, 'any')).kind).toBe('chip');
  });

  it('the dev route is the dev stack\'s alone', async () => {
    const p = await player('fair_dev');
    const res = await exports_fetchDevCheckWithoutDev(p);
    expect(res.status).toBe(404);
  });
});

describe('fair: the pause', () => {
  it('a waiting check stops new rounds, not cashing out; passing it lets play on', async () => {
    const p = await player('fair_hold');
    const c = (await connect('solo/highcard', p.token, '', p.ip)).client!;
    const tableId: string = (await c.next((m) => m.t === 'table')).meta.tableId;
    await buyIn(c, 10_000);
    await post(p, 'dev/check', { paused: true });
    await c.next((m) => m.t === 'check');

    c.send({ t: 'act', aid: aid(), a: { type: 'bet', amount: 100 } });
    const refused = await c.next((m) => m.t === 'err');
    expect(refused).toMatchObject({ code: 'NOT_ELIGIBLE', msg: CHECK_MSG });
    expect(JSON.stringify(refused)).not.toMatch(/bot/i);
    // No new lobby either.
    const lobby = await post(p, 'tables', { game: 'blackjack' });
    expect(lobby.status).toBe(403);
    expect(await lobby.json()).toMatchObject({ check: true, msg: CHECK_MSG });

    // Pass: the table hears it and play goes on.
    const ch = (await (await get(p, 'check')).json<any>()).challenge;
    const at = await solution(ch.id);
    expect((await (await post(p, 'check', { id: ch.id, ...at })).json<any>()).ok).toBe(true);
    c.send({ t: 'act', aid: aid(), a: { type: 'bet', amount: 100 } });
    await c.next((m) => m.t === 'seat' || m.t === 'ev');
    expect(c.msgs.some((m) => m.t === 'err' && m.code === 'NOT_ELIGIBLE')).toBe(false);

    // Paused again: cashing out still works.
    await post(p, 'dev/check', { paused: true });
    await c.next((m) => m.t === 'check');
    c.send({ t: 'act', aid: aid(), a: { type: 'deal' } });
    c.send({ t: 'cashout', aid: aid() });
    await c.next((m) => m.t === 'seat' && m.status === 'watching', 5000);
    expect(await inTable(tableId, (t) => t.members.get(p.id)?.stack ?? 0)).toBe(0);
  });

  it('a due check is asked only once nothing of theirs is on the layout', async () => {
    const p = await player('fair_due');
    const c = (await connect('solo/highcard', p.token, '', p.ip)).client!;
    await c.next((m) => m.t === 'table');
    await buyIn(c, 10_000);
    c.send({ t: 'act', aid: aid(), a: { type: 'bet', amount: 100 } });
    await c.next((m) => m.t === 'seat');
    // Due mid-round (chips out): nothing is asked yet, and the round plays out.
    await post(p, 'dev/check', {});
    await new Promise((r) => setTimeout(r, 100));
    expect(c.msgs.some((m) => m.t === 'check')).toBe(false);
    c.send({ t: 'act', aid: aid(), a: { type: 'deal' } });
    await c.next((m) => m.t === 'check', 5000);
    expect((await fairOf(env.DB, p.id)).state).toBe('paused');
  });

  it('a buy-in while a check is due asks it and is refused', async () => {
    const p = await player('fair_buy');
    const c = (await connect('solo/highcard', p.token, '', p.ip)).client!;
    await c.next((m) => m.t === 'table');
    await post(p, 'dev/check', {});
    c.send({ t: 'buyin', aid: aid(), amount: 10_000 });
    expect(await c.next((m) => m.t === 'err')).toMatchObject({ code: 'NOT_ELIGIBLE', msg: CHECK_MSG });
    await c.next((m) => m.t === 'check');
    expect((await fairOf(env.DB, p.id)).state).toBe('paused');
  });

  it("a table's reactions reach D1 in batches (the dev stack scores but never asks)", async () => {
    const p = await player('fair_rt');
    const c = (await connect('solo/highcard', p.token, '', p.ip)).client!;
    await c.next((m) => m.t === 'table');
    await buyIn(c, 100_000);
    for (let i = 0; i < 12; i++) {
      c.send({ t: 'act', aid: aid(), a: { type: 'bet', amount: 100 } });
      await c.next((m) => m.t === 'seat');
      await new Promise((r) => setTimeout(r, 150));
      c.send({ t: 'act', aid: aid(), a: { type: 'deal' } });
      await c.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result'), 5000);
      await new Promise((r) => setTimeout(r, 150));
    }
    // Leaving sends what's left.
    c.ws.close(1000, 'bye');
    await new Promise((r) => setTimeout(r, 300));
    const row = await env.DB.prepare(`SELECT ev, state FROM casino_fair WHERE account_id = ?1`).bind(p.id).first<{ ev: string; state: string }>();
    const ev = JSON.parse(row!.ev);
    expect(ev.bets).toHaveLength(12);
    expect(ev.rt.length).toBeGreaterThanOrEqual(11);
    expect(Math.min(...ev.rt)).toBeGreaterThanOrEqual(100);
    expect(row!.state).toBe('ok');
  }, 30_000);
});

/** POST /api/dev/check against a Worker whose env has no CASINO_DEV (production). */
async function exports_fetchDevCheckWithoutDev(p: Player): Promise<Response> {
  const { fairApi } = await import('../src/fair.ts');
  return fairApi(new Request('http://casino.test/casino/api/dev/check', { method: 'POST', body: '{}' }), { DB: env.DB }, 'dev/check', p.id, {}, async () => {});
}

describe('fair: the floor', () => {
  it('counts a stop only when it ends a walk and the player walks on; a seat or a teleport is not a stop', async () => {
    const { FloorFair } = await import('../src/floor/fair.ts');
    const p = await player('fair_walk');
    const waits: Promise<unknown>[] = [];
    const f = new FloorFair(() => env.DB, false, (w) => waits.push(w));
    const now = Date.now();
    const walk = (x0: number, z: number) => {
      for (let i = 1; i <= 4; i++) f.position(p.id, x0 + i * 100, z, false, now);
    };
    walk(0, 0);
    f.position(p.id, 425, 0, true, now); // a stop after a walk...
    walk(425, 0); // ...that counts once they walk on
    f.position(p.id, 830, 0, true, now); // a stop by a seat they then sit on
    f.sat(p.id, 850, 0);
    walk(830, 0);
    f.position(p.id, 3000, 1000, true, now); // an elevator's landing
    f.position(p.id, 3000, 1100, false, now);
    f.position(p.id, 1300, 0, true, now); // the last stop before leaving
    f.gone(p.id, now);
    await Promise.all(waits);
    const row = await env.DB.prepare(`SELECT ev FROM casino_fair WHERE account_id = ?1`).bind(p.id).first<{ ev: string }>();
    expect(JSON.parse(row!.ev).stops).toEqual([[425, 0]]);
  });
});
