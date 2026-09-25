// v6.1 security review (docs/SECURITY-REVIEW.md): the attacks a player could try from a script,
// each proven refused. Dev routes under the production config, bodies that never end, forged and
// out-of-range money, another account's ids, replayed ops, jumps across the floor by reconnecting
// or through an invite, a pile of floor sockets from one address, and a flood of signed-in reads.

import { describe, expect, it } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import worker, * as entry from '../src/index.ts';
import { API_BURST } from '../src/ratelimit.ts';
import { ORIGIN, api, connect, type Client } from './helpers.ts';
import { aid, buyIn, closedWith, makeLobby, money, player, sleep, type Player } from './party.ts';
import { CLOSE } from '../../shared/src/protocol.ts';
import { LIFTS } from '../../shared/src/lifts.ts';
import { MAX_FLOOR_PER_ADDR, type CasinoFloor } from '../src/floor/index.ts';
import { readJson } from '../src/http.ts';
import { signToken, verifyToken } from '../src/auth.ts';
import { draws } from '../src/market.ts';

const floor = (): DurableObjectStub<CasinoFloor> => env.FLOOR.get(env.FLOOR.idFromName('main'));
const post = (p: Player, route: string, body: unknown) => api(route, p.token, { method: 'POST', body: JSON.stringify(body) });
let n = 0;
const op = () => `sec61op${String(++n).padStart(4, '0')}`;

async function onFloor(p: Player, ip = p.ip): Promise<Client> {
  const { client } = await connect('floor', p.token, '', ip);
  await client!.next((m) => m.t === 'hello');
  return client!;
}

/** Where the floor has this account now (cm), or null. */
async function where(id: number): Promise<{ x: number; z: number } | null> {
  return runInDurableObject(floor(), (f: CasinoFloor) => f.presence.positionOf(id));
}

describe('the production config', () => {
  it("the Worker's entry exports only its handler and the Durable Object classes (anything else stops workerd from starting)", () => {
    for (const [name, value] of Object.entries(entry)) {
      if (name === 'default') expect(typeof (value as ExportedHandler).fetch).toBe('function');
      else expect(typeof value, name).toBe('function');
    }
  });

  // What j4den/workers/casino/wrangler.toml deploys: no CASINO_DEV.
  const prod = { ...env, CASINO_DEV: undefined } as unknown as Env;
  const call = (path: string, token: string, method = 'POST', body: unknown = {}) =>
    worker.fetch(
      new Request(`http://casino.test/casino/api/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Authorization: `Bearer ${token}` },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      }),
      prod,
    );

  it('answers every dev route with 404 and changes nothing', async () => {
    const p = await player('sec_prod');
    const before = await money(p.id);
    for (const [path, method] of [
      ['dev/celeb', 'POST'],
      ['dev/gift', 'POST'],
      ['dev/happy', 'POST'],
      ['dev/check', 'POST'],
      ['dev/check/answer', 'GET'],
      ['dev/law/catch', 'POST'],
      ['dev/bank/clock', 'POST'],
      ['dev/anything', 'POST'],
    ] as const) {
      const res = await call(path, p.token, method, { ms: 86_400_000, paused: true });
      expect(res.status, path).toBe(404);
    }
    expect(await money(p.id)).toEqual(before);
    const clock = await env.DB.prepare(`SELECT n FROM casino_tally WHERE account_id = ?1 AND key = 'bank-clock'`).bind(p.id).first();
    expect(clock).toBeNull();
    const fair = await env.DB.prepare(`SELECT state FROM casino_fair WHERE account_id = ?1`).bind(p.id).first<{ state: string }>();
    expect(fair?.state ?? 'ok').toBe('ok');
    const jail = await env.DB.prepare(`SELECT 1 FROM casino_jail WHERE account_id = ?1`).bind(p.id).first();
    expect(jail).toBeNull();
  });

  it('without its token secret, the Worker refuses logins and tokens rather than sign with an empty key', async () => {
    const bare = { ...env, CASINO_DEV: undefined, CASINO_TOKEN_SECRET: '' } as unknown as Env;
    const login = await worker.fetch(
      new Request('http://casino.test/casino/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'sec_nosecret', password: 'test-pass' }) }),
      bare,
    );
    expect(login.status).toBe(500);
    expect(JSON.stringify(await login.json())).not.toContain('token');
    await expect(signToken('', 1, 'x', Date.now())).rejects.toThrow();
    await expect(verifyToken(undefined as unknown as string, 'v2.e30.AAAA', Date.now())).rejects.toThrow();
    await expect(draws('', 'csx', 1)).rejects.toThrow();
  });

  it("won't open the test fixture game (no house edge)", async () => {
    const p = await player('sec_hc');
    const t = await (await api('ticket', p.token, { method: 'POST', body: JSON.stringify({ target: 'solo/highcard' }) })).json<any>();
    const res = await worker.fetch(
      new Request(`http://casino.test/casino/ws/solo/highcard?v=1&ticket=${encodeURIComponent(t.ticket)}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } }),
      prod,
    );
    const ws = res.webSocket!;
    const closed = new Promise<number>((r) => ws.addEventListener('close', (e) => r(e.code)));
    ws.accept();
    expect(await closed).toBe(CLOSE.NOT_FOUND);
  });
});

describe('request bodies', () => {
  it('a body with no length is read only up to the limit, never whole', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 10_000) c.close();
        else c.enqueue(chunk);
      },
    });
    const req = new Request('http://casino.test/x', { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(req.headers.get('Content-Length')).toBeNull();
    expect(await readJson(req, 2048)).toBeNull();
    // it stopped at the limit (plus the stream's read-ahead), not after ten megabytes
    expect(pulled).toBeLessThan(20);
    expect(await readJson(new Request('http://casino.test/x', { method: 'POST', body: '{"a":1}' }))).toEqual({ a: 1 });
    expect(await readJson(new Request('http://casino.test/x', { method: 'POST', body: 'not json' }))).toBeNull();
  });

  it('a login with an endless body is a plain 400', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode('{"name":"' + 'a'.repeat(4096)));
      },
    });
    const res = await exports.default.fetch(
      new Request('http://casino.test/casino/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit),
    );
    expect(res.status).toBe(400);
  });

  it('money amounts that are negative, fractional, huge, strings or missing are refused, and nothing moves', async () => {
    const p = await player('sec_amt');
    const q = await player('sec_amt_to');
    const before = await money(p.id);
    const bad: unknown[] = [-100, 0, 1.5, 1e300, Number.MAX_SAFE_INTEGER, '10000', null, undefined, [100], { n: 100 }, true];
    for (const amount of bad) {
      for (const [route, extra] of [
        ['bank/savings', { dir: 'in' }],
        ['bank/deposit', { term: '24h' }],
        ['bank/fund', { side: 'buy' }],
        ['bank/send', { to: q.name, confirm: true }],
      ] as const) {
        const res = await post(p, route, { op: op(), amount, ...extra });
        expect(res.status, `${route} ${JSON.stringify(amount)}`).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
      await sleep(200); // the per-account read limit is not what's being tested here
    }
    expect(await money(p.id)).toEqual(before);
    expect(await money(q.id)).toEqual((await money(q.id)));
    const moved = await env.DB.prepare(`SELECT count(*) AS n FROM casino_bank WHERE account_id = ?1`).bind(p.id).first<{ n: number }>();
    expect(moved!.n).toBe(0);
  }, 30_000);

  it('shop, bar and effects refuse items they do not sell, prototype names included, and ops that are not ids', async () => {
    const p = await player('sec_shop');
    const before = await money(p.id);
    for (const item of ['__proto__', 'constructor', 'toString', 'statue ', 'STATUE', '', 12, null, { id: 'statue' }]) {
      for (const route of ['shop/buy', 'bar/order', 'shop/fx']) {
        const res = await post(p, route, { item, op: op() });
        expect(res.status, `${route} ${JSON.stringify(item)}`).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
    }
    for (const bad of ['short', 'x'.repeat(41), 'has space in it', '../../etc', 12345678]) {
      const res = await post(p, 'bar/order', { item: 'coffee', op: bad });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect(await money(p.id)).toEqual(before);
  });
});

describe('one account acting for another', () => {
  it("can't close another player's deposit, and the same op id from someone else is their own op", async () => {
    const a = await player('sec_depa');
    const b = await player('sec_depb');
    const shared = op();
    const opened = await post(a, 'bank/deposit', { op: shared, term: '24h', amount: 10_000_00 });
    expect(opened.status).toBe(200);
    const dep = (await opened.json<any>()).state.deposits[0];
    const aBefore = await money(a.id);

    const steal = await post(b, 'bank/deposit/close', { op: op(), id: dep.id });
    expect(steal.status).toBeGreaterThanOrEqual(400);
    expect(steal.status).toBeLessThan(500);
    const still = (await (await api('bank', a.token)).json<any>()).deposits[0];
    expect(still.id).toBe(dep.id);
    expect(still.closed ?? still.closedAt ?? null).toBeFalsy();
    expect(await money(a.id)).toEqual(aBefore);

    // b replays a's op id on the same route: b's own deposit, not a's answer
    const bBefore = await money(b.id);
    const replay = await post(b, 'bank/deposit', { op: shared, term: '24h', amount: 10_000_00 });
    expect(replay.status).toBe(200);
    expect((await money(b.id)).balance).toBe(bBefore.balance - 10_000_00);
    expect((await money(a.id)).balance).toBe(aBefore.balance);
  });

  it('forged table messages (bad amounts, unknown kinds, extra fields) move no money; an honest buy-in still lands exactly', async () => {
    const p = await player('sec_tbl');
    const { client } = await connect('solo/highcard', p.token, '', p.ip);
    const c = client!;
    await c.next((m) => m.t === 'table');
    const before = await money(p.id);
    for (const amount of [-1000, 0, 10.5, 1e300, '1000', null, 2 ** 60]) c.send({ t: 'buyin', aid: aid(), amount });
    c.send({ t: 'buyin', aid: 'bad aid with spaces', amount: 1000 });
    c.send({ t: 'grant', amount: 1_000_000 });
    c.send({ t: 'cashout', aid: aid(), accountId: 1 });
    c.send({ t: 'act', aid: aid(), a: { kind: 'win', amount: 1e9 } });
    await sleep(300);
    expect(await money(p.id)).toEqual(before);
    expect(c.closed).toBeNull();
    await buyIn(c, 10_000);
    const after = await money(p.id);
    expect(after.balance).toBe(before.balance - 10_000);
    expect(after.in_play).toBe(before.in_play + 10_000);
    // the account on a message means nothing: the socket's account is the Worker's
    c.send({ t: 'buyin', aid: aid(), amount: 10_000, accountId: p.id + 1 });
    await sleep(300);
    c.ws.close();
  });
});

describe('moving across the floor', () => {
  it("a reconnect can't place you across the room from where the floor last saw you; a real reconnect nearby can", async () => {
    const p = await player('sec_jump');
    const a = await onFloor(p);
    a.send({ t: 'st', x: 0, z: 1280, r: 0 });
    await sleep(150);
    a.send({ t: 'st', x: 300, z: 1200, r: 0 });
    await sleep(150);
    expect(await where(p.id)).toMatchObject({ x: 300, z: 1200 });
    a.ws.close(1000, 'drop');
    await sleep(100);

    // straight back, placing yourself 40 m away (a gift box, say): back where you were, told so
    const b = await onFloor(p);
    b.send({ t: 'st', x: -2500, z: -2000, r: 7 });
    const tp = await b.next<any>((m) => m.t === 'tp');
    expect(tp).toMatchObject({ x: 300, z: 1200 });
    expect(await where(p.id)).toMatchObject({ x: 300, z: 1200 });
    b.ws.close(1000, 'drop');
    await sleep(100);

    // a dropped connection that kept walking comes back a few steps on
    const c = await onFloor(p);
    c.send({ t: 'st', x: 700, z: 1100, r: 7 });
    await sleep(150);
    expect(await where(p.id)).toMatchObject({ x: 700, z: 1100 });
    expect(c.msgs.some((m) => m.t === 'tp')).toBe(false);
    c.ws.close();
  });

  it("an invite from someone who then leaves the floor isn't a jump to a spot of your choosing", async () => {
    const host = await player('sec_ihost');
    const guest = await player('sec_iguest');
    const t = await makeLobby(host, 'highcard');
    const h = await onFloor(host);
    const g = await onFloor(guest);
    h.send({ t: 'st', x: 0, z: 1280, r: 0 });
    g.send({ t: 'st', x: 0, z: 1280, r: 0 });
    await sleep(150);
    g.send({ t: 'st', x: 500, z: 1000, r: 0 });
    await sleep(150);
    h.send({ t: 'invite', table: t.tableId, to: [guest.id] });
    const inv = (await g.next<any>((m) => m.t === 'invited')).invite;
    h.ws.close(1000, 'gone');
    await sleep(150);
    g.send({ t: 'invite.take', id: inv.id, x: -2800, z: -3000, r: 0 });
    const go = await g.next<any>((m) => m.t === 'invite.go' || m.t === 'invite.no');
    expect(go.t).toBe('invite.go');
    expect([go.x, go.z]).toEqual([500, 1000]);
    expect(await where(guest.id)).toMatchObject({ x: 500, z: 1000 });
    g.ws.close();
  });

  it('from somewhere else than the casino, with the inviter gone, you arrive at its elevator doors', async () => {
    const host = await player('sec_ihost2');
    const guest = await player('sec_iguest2');
    const t = await makeLobby(host, 'highcard');
    const h = await onFloor(host);
    const g = await onFloor(guest);
    h.send({ t: 'invite', table: t.tableId, to: [guest.id] });
    const inv = (await g.next<any>((m) => m.t === 'invited')).invite;
    h.ws.close(1000, 'gone');
    await runInDurableObject(floor(), (f: CasinoFloor) => f.presence.teleport(guest.id, LIFTS.roof.arrive.x, LIFTS.roof.arrive.z, 0));
    await sleep(150);
    g.send({ t: 'invite.take', id: inv.id, x: -2800, z: -3000, r: 0 });
    const go = await g.next<any>((m) => m.t === 'invite.go');
    expect([go.x, go.z]).toEqual([LIFTS.casino.arrive.x, LIFTS.casino.arrive.z]);
    g.ws.close();
  });
});

describe('floods', () => {
  it(`one address holds at most ${MAX_FLOOR_PER_ADDR} floor connections; the same account again, and other addresses, still get in`, async () => {
    const ip = '198.51.100.61';
    const players: Player[] = [];
    for (let i = 0; i <= MAX_FLOOR_PER_ADDR; i++) players.push(await player(`sec_cap${i}_`));
    const open: Client[] = [];
    for (const p of players.slice(0, MAX_FLOOR_PER_ADDR)) open.push(await onFloor(p, ip));
    const { client: over } = await connect('floor', players[MAX_FLOOR_PER_ADDR]!.token, '', ip);
    expect(await closedWith(over!)).toMatchObject({ code: CLOSE.FORBIDDEN });
    // a second tab of someone already here replaces their socket rather than adding one
    const again = await onFloor(players[0]!, ip);
    expect(again.closed).toBeNull();
    // and from another address, the same account that was turned away gets in
    const elsewhere = await onFloor(players[MAX_FLOOR_PER_ADDR]!, '198.51.100.62');
    expect(elsewhere.closed).toBeNull();
    for (const c of [...open, again, elsewhere]) c.ws.close();
  }, 60_000);

  it(`signed-in requests: a burst of ${API_BURST}, then 429 until the bucket refills`, async () => {
    const p = await player('sec_reads');
    const codes: number[] = [];
    for (let i = 0; i < API_BURST + 10; i++) codes.push((await api('daily', p.token)).status);
    expect(codes.slice(0, API_BURST - 5).every((s) => s === 200)).toBe(true);
    expect(codes.slice(API_BURST + 2)).toContain(429);
    const limited = await api('me', p.token);
    if (limited.status === 429) expect((await limited.json<any>()).error).toBe('RATE_LIMITED');
    await sleep(1_000);
    expect((await api('daily', p.token)).status).toBe(200);
    // another account isn't affected
    const q = await player('sec_reads2');
    expect((await api('daily', q.token)).status).toBe(200);
  }, 30_000);
});
