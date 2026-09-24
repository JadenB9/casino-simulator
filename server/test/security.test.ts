// The security review's findings, each with the test that pins it down: floods of any kind of
// frame, reconnect loops, PIN guessing (per /64, and everyone together against one PIN), sign-ups
// per /64, rate limits on the HTTP routes with side effects, CORS for every route, tokens reused
// across tabs, errors that say nothing about the inside, leader handoff when several people drop,
// and the money paths: an op that landed in D1 before the table could record it, a table that
// can't close with money in flight, a socket that drops while its buy-in is in flight.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { ORIGIN, api, connect, type Client } from './helpers.ts';
import { PASSWORD, aid, buyIn, clockAt, closedWith, deadlines, enter, escrow, find, inTable, makeLobby, money, player, sleep, table } from './party.ts';
import { signToken } from '../src/auth.ts';
import { applyTransfer, buyInStatements } from '../src/transfer.ts';
import { CONNECT_BURST, GRACE_MS, LEADER_HANDOFF_MS, PIN_TABLE_MISSES, STRIKES } from '../src/table/host.ts';
import { FLOOR_CONNECT_BURST, FLOOR_STRIKES } from '../src/floor/index.ts';
import { MAX_FLOOR_FRAME, MAX_TABLE_FRAME } from '../../shared/src/protocol.ts';
import { STARTING_BALANCE } from '../../shared/src/money.ts';

afterEach(() => {
  vi.useRealTimers();
});

async function soloHighCard(p: { token: string; ip: string }): Promise<Client> {
  const { client } = await connect('solo/highcard', p.token, '', p.ip);
  await client!.next((m) => m.t === 'table');
  return client!;
}

async function floorSocket(p: { token: string; ip: string }): Promise<Client> {
  const { client } = await connect('floor', p.token, '', p.ip);
  await client!.next((m) => m.t === 'hello');
  return client!;
}

// ---------------------------------------------------------------------------------------------

describe('floods', () => {
  it('a table closes a socket that keeps sending junk (4008), after dropping it without replies', async () => {
    const c = await soloHighCard(await player('junk'));
    c.msgs.length = 0;
    for (let i = 0; i < STRIKES - 1; i++) c.send({ t: 'nope', i });
    await sleep(100);
    expect(c.closed).toBeNull();
    expect(c.msgs.filter((m) => m.t === 'err')).toEqual([]);
    for (let i = 0; i < 10; i++) c.ws.send('not even json');
    expect((await closedWith(c, 5_000)).code).toBe(4008);
  });

  it('a burst of real messages past a limit gets RATE_LIMITED, and the socket lives on at an honest pace', async () => {
    const c = await soloHighCard(await player('burst'));
    c.msgs.length = 0;
    for (let i = 0; i < 20; i++) c.send({ t: 'sync' });
    expect((await c.next<any>((m) => m.t === 'err')).code).toBe('RATE_LIMITED');
    await sleep(150);
    expect(c.msgs.filter((m) => m.t === 'err').every((e) => e.code === 'RATE_LIMITED')).toBe(true);
    expect(c.closed).toBeNull();
    await sleep(600);
    c.msgs.length = 0;
    c.send({ t: 'sync' });
    await c.next((m) => m.t === 'table');
  });

  it('frames over the size caps close the socket (1009)', async () => {
    const p = await player('huge');
    const t = await soloHighCard(p);
    t.ws.send(JSON.stringify({ t: 'sync', pad: 'x'.repeat(MAX_TABLE_FRAME) }));
    expect((await closedWith(t)).code).toBe(1009);
    const f = await floorSocket(p);
    f.ws.send(JSON.stringify({ t: 'watch', game: null, pad: 'x'.repeat(MAX_FLOOR_FRAME) }));
    expect((await closedWith(f)).code).toBe(1009);
  });

  it('the floor closes a socket that keeps sending junk, and quietly drops extra emotes', async () => {
    const p = await player('fjunk');
    const f = await floorSocket(p);
    // Mashing the emote key is not abuse: the extras go, the socket stays.
    for (let i = 0; i < 20; i++) f.send({ t: 'emote', e: 'wave' });
    await sleep(100);
    expect(f.closed).toBeNull();
    // Past the limit with room to spare: strikes are forgiven at one a second while these go out.
    for (let i = 0; i < FLOOR_STRIKES + 60; i++) f.send({ t: 'jump', i });
    // (A busy floor takes a moment to get through them all.)
    expect((await closedWith(f, 5_000)).code).toBe(4008);
  });

  it('a reconnect loop gets a burst of connections, then 4008 (table and floor)', async () => {
    const p = await player('loop');
    const tables: Client[] = [];
    for (let i = 0; i < CONNECT_BURST; i++) tables.push(await soloHighCard(p));
    // Each newer one replaced the one before it.
    expect((await closedWith(tables[0]!)).code).toBe(4001);
    const { client: extra } = await connect('solo/highcard', p.token, '', p.ip);
    expect((await closedWith(extra!)).code).toBe(4008);
    expect(extra!.msgs.some((m) => m.t === 'table')).toBe(false);

    const q = await player('floop');
    for (let i = 0; i < FLOOR_CONNECT_BURST; i++) await floorSocket(q);
    const { client: more } = await connect('floor', q.token, '', q.ip);
    expect((await closedWith(more!)).code).toBe(4008);
    expect(more!.msgs.some((m) => m.t === 'hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

describe('PIN guessing and sign-ups', () => {
  it('wrong PINs from one IPv6 /64 count together, whatever address in it they come from', async () => {
    const lead = await player('pin6');
    const made = await makeLobby(lead, 'highcard', 'private');
    await enter(lead, made.tableId, made.pin);
    const wrong = made.pin === '0000' ? '0001' : '0000';
    for (let i = 1; i <= 5; i++) {
      const g = await player('g6');
      const { client } = await connect(`table/${made.tableId}`, g.token, `&pin=${wrong}`, `2001:db8:aa:1::${i}`);
      expect(await closedWith(client!)).toEqual({ code: 4005, reason: 'wrong pin' });
    }
    const late = await player('g6');
    const { client: locked } = await connect(`table/${made.tableId}`, late.token, `&pin=${made.pin}`, '2001:db8:aa:1:ffff::99');
    expect(await closedWith(locked!)).toEqual({ code: 4005, reason: 'too many tries' });
    // Someone on another /64 with the right PIN still gets in.
    const friend = await player('f6');
    const { client: ok } = await connect(`table/${made.tableId}`, friend.token, `&pin=${made.pin}`, '2001:db8:aa:2::1');
    await ok!.next((m) => m.t === 'table');
  });

  it("everyone's wrong guesses against one PIN count together; the leader's next PIN opens the door again", async () => {
    const lead = await player('pinall');
    const made = await makeLobby(lead, 'highcard', 'private');
    const [cl] = await enter(lead, made.tableId, made.pin);
    const wrong = made.pin === '0000' ? '0001' : '0000';
    for (let i = 0; i < PIN_TABLE_MISSES; i++) {
      const g = await player('sweep');
      const { client } = await connect(`table/${made.tableId}`, g.token, `&pin=${wrong}`, g.ip);
      expect((await closedWith(client!)).reason).toBe('wrong pin');
    }
    const friend = await player('friend');
    const { client: refused } = await connect(`table/${made.tableId}`, friend.token, `&pin=${made.pin}`, friend.ip);
    expect(await closedWith(refused!)).toEqual({ code: 4005, reason: 'too many tries' });

    // A fresh PIN: public, then private again (the old one is cooling down, so it's a new one).
    // Drop what's queued (the join's broadcast still carries the old PIN).
    cl.msgs.length = 0;
    cl.send({ t: 'visibility', visibility: 'public' });
    await cl.next((m) => m.t === 'members' && m.visibility === 'public');
    cl.send({ t: 'visibility', visibility: 'private' });
    const priv = await cl.next<any>((m) => m.t === 'members' && m.visibility === 'private');
    expect(priv.pin).not.toBe(made.pin);
    const [, snap] = await enter(friend, made.tableId, priv.pin);
    expect(find(snap.members, friend.id)).toBeTruthy();
  }, 30_000);

  it('ten new accounts an hour per IPv6 /64, however many addresses in it they come from', async () => {
    const signUp = (name: string, ip: string) =>
      exports.default.fetch(
        new Request('http://casino.test/casino/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': ip },
          body: JSON.stringify({ name, password: PASSWORD }),
        }),
      );
    for (let i = 1; i <= 10; i++) expect((await signUp(`v6_signup_${i}`, `2001:db8:bb:1::${i.toString(16)}`)).status).toBe(200);
    const eleventh = await signUp('v6_signup_11', '2001:db8:bb:1:abcd::1');
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json<any>()).error).toBe('RATE_LIMITED');
    expect((await signUp('v6_signup_12', '2001:db8:bb:2::1')).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------

describe('HTTP routes', () => {
  const routes: [method: string, path: string][] = [
    ['POST', 'login'],
    ['GET', 'health'],
    ['GET', 'me'],
    ['PUT', 'me/look'],
    ['POST', 'bank/loan'],
    ['POST', 'tables'],
    ['POST', 'tables/join'],
    ['GET', 'leaderboard'],
  ];

  it('CORS: every route answers the preflight for its method and headers, and errors are readable', async () => {
    for (const [method, path] of routes) {
      const pre = await exports.default.fetch(
        new Request(`http://casino.test/casino/api/${path}`, {
          method: 'OPTIONS',
          headers: { Origin: ORIGIN, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,content-type' },
        }),
      );
      expect(pre.status, path).toBe(204);
      expect(pre.headers.get('Access-Control-Allow-Origin'), path).toBe(ORIGIN);
      expect(pre.headers.get('Access-Control-Allow-Methods')!.split(/,\s*/), path).toContain(method);
      const allowed = pre.headers.get('Access-Control-Allow-Headers')!.toLowerCase().split(/,\s*/);
      expect(allowed, path).toEqual(expect.arrayContaining(['authorization', 'content-type']));
      expect(pre.headers.get('Vary'), path).toBe('Origin');
      expect(pre.headers.get('Access-Control-Allow-Credentials'), path).toBeNull();
      if (path === 'login' || path === 'health') continue;
      // Without a token: a 401 the page can read (CORS headers on the error too).
      const res = await exports.default.fetch(new Request(`http://casino.test/casino/api/${path}`, { method, headers: { Origin: ORIGIN } }));
      expect(res.status, path).toBe(401);
      expect(res.headers.get('Access-Control-Allow-Origin'), path).toBe(ORIGIN);
      expect(await res.json(), path).toEqual({ error: 'UNAUTHORIZED', msg: 'Log in again.' });
    }
  });

  it('CORS: other sites get no CORS headers and their requests are refused', async () => {
    const evil = 'https://evil.example';
    const pre = await exports.default.fetch(
      new Request('http://casino.test/casino/api/me', { method: 'OPTIONS', headers: { Origin: evil, 'Access-Control-Request-Method': 'GET' } }),
    );
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const p = await player('cors');
    const res = await exports.default.fetch(new Request('http://casino.test/casino/api/me', { headers: { Origin: evil, Authorization: `Bearer ${p.token}` } }));
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    // A near miss on the allowlist's port wildcard isn't a match either.
    const sneaky = await exports.default.fetch(
      new Request('http://casino.test/casino/api/me', { headers: { Origin: 'http://localhost:5173.evil.example', Authorization: `Bearer ${p.token}` } }),
    );
    expect(sneaky.status).toBe(403);
  });

  it('socket upgrades from another site, or with no Origin at all, are refused before anything opens', async () => {
    const p = await player('wsorigin');
    for (const origin of ['https://evil.example', 'http://localhost.evil.example:5173', 'null', undefined]) {
      for (const path of ['floor', 'solo/highcard']) {
        const res = await exports.default.fetch(
          new Request(`http://casino.test/casino/ws/${path}?v=1&t=${encodeURIComponent(p.token)}`, {
            headers: { Upgrade: 'websocket', 'CF-Connecting-IP': p.ip, ...(origin ? { Origin: origin } : {}) },
          }),
        );
        expect(res.status, `${path} ${origin}`).toBe(403);
        expect(res.webSocket, `${path} ${origin}`).toBeFalsy();
      }
    }
    // The same token from the page's own origin gets in.
    const ok = await floorSocket(p);
    ok.ws.close();
  });

  it('look changes and loan requests have per-account limits', async () => {
    const p = await player('lims');
    const look = { v: 1, body: 'f', outfit: 'dress', skin: 5, hair: '#b8894e', top: '#6b1f2a', bottom: '#1f2430', shoes: '#8a5a34' };
    for (let i = 0; i < 20; i++) expect((await api('me/look', p.token, { method: 'PUT', body: JSON.stringify({ look }) })).status).toBe(200);
    const look21 = await api('me/look', p.token, { method: 'PUT', body: JSON.stringify({ look }) });
    expect(look21.status).toBe(429);
    expect((await look21.json<any>()).error).toBe('RATE_LIMITED');
    for (let i = 0; i < 10; i++) expect((await api('bank/loan', p.token, { method: 'POST' })).status).toBe(409);
    const loan11 = await api('bank/loan', p.token, { method: 'POST' });
    expect(loan11.status).toBe(429);
    // Someone else is unaffected.
    const q = await player('lims');
    expect((await api('me/look', q.token, { method: 'PUT', body: JSON.stringify({ look }) })).status).toBe(200);
  });

  it('errors say what went wrong for the player and nothing about the inside', async () => {
    const p = await player('errs');
    const bad = await api('tables', p.token, { method: 'POST', body: '{"game": "roulette", "visibility": ' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'BAD_REQUEST', msg: 'That game has no multiplayer tables.' });
    const nowhere = await api('../../etc/passwd', p.token);
    expect(nowhere.status).toBe(404);
    expect(await nowhere.json()).toEqual({ error: 'NOT_FOUND', msg: 'Not here.' });

    // Something throwing inside a table: the player hears a plain sentence, the log gets the detail.
    const lead = await player('errt');
    const made = await makeLobby(lead, 'highcard');
    const [c] = await enter(lead, made.tableId);
    await inTable(made.tableId, (t: any) => {
      t.handleStart = () => {
        throw new Error('SELECT secret FROM somewhere');
      };
    });
    c.send({ t: 'start' });
    expect(await c.next<any>((m) => m.t === 'err')).toEqual({ t: 'err', code: 'INTERNAL', msg: 'Something went wrong at the table.' });
  });
});

// ---------------------------------------------------------------------------------------------

describe('tokens', () => {
  it('sockets refuse forged, expired, tampered and orphaned tokens with 4003', async () => {
    const p = await player('tok');
    const [v, payload, sig] = p.token.split('.');
    const claims = JSON.parse(atob(payload!.replace(/-/g, '+').replace(/_/g, '/')));
    const tamperedPayload = btoa(JSON.stringify({ ...claims, a: claims.a + 1 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tokens = [
      `${v}.${tamperedPayload}.${sig}`,
      await signToken('another-secret', p.id, p.name, Date.now()),
      await signToken(env.CASINO_TOKEN_SECRET, p.id, p.name, Date.now() - 31 * 86_400_000),
      await signToken(env.CASINO_TOKEN_SECRET, 987_654_321, 'Nobody', Date.now()),
      'v1.x',
      'x'.repeat(5000),
    ];
    for (const token of tokens) {
      for (const path of ['floor', 'solo/highcard']) {
        const { client } = await connect(path, token, '', p.ip);
        expect((await closedWith(client!)).code, `${path} ${token.slice(0, 20)}`).toBe(4003);
      }
    }
  });

  it('the same token in a second tab takes the seat over, and a money action replayed from it lands once', async () => {
    const p = await player('tabs');
    const one = await soloHighCard(p);
    one.send({ t: 'buyin', aid: 'first', amount: 10_000 });
    await one.next((m) => m.t === 'seat' && m.status === 'seated');
    one.send({ t: 'topup', aid: 'same-topup', amount: 5_000 });
    await one.next((m) => m.t === 'seat' && m.stack === 15_000);

    const two = await soloHighCard(p);
    expect((await closedWith(one)).code).toBe(4001);
    two.send({ t: 'topup', aid: 'same-topup', amount: 5_000 });
    await sleep(200);
    two.send({ t: 'sync' });
    const snap = await two.next<any>((m) => m.t === 'table');
    expect(snap.you).toMatchObject({ status: 'seated', stack: 15_000 });
    expect(await money(p.id)).toEqual({ balance: STARTING_BALANCE - 15_000, in_play: 15_000 });
  });
});

// ---------------------------------------------------------------------------------------------

describe('leader handoff with several drops', () => {
  it('when the leader leaves and nobody is connected, the absent successor leads only until someone is back', async () => {
    const [a, b, c] = [await player('ho'), await player('ho'), await player('ho')];
    const made = await makeLobby(a, 'highcard');
    const [ca] = await enter(a, made.tableId);
    const [cb] = await enter(b, made.tableId);
    const [cc] = await enter(c, made.tableId);
    await buyIn(cb, 10_000);
    await buyIn(cc, 10_000);
    cb.ws.close(1001, 'network');
    cc.ws.close(1001, 'network');
    await ca.next((m) => m.t === 'members' && find(m.members, b.id)?.connected === false && find(m.members, c.id)?.connected === false);
    ca.send({ t: 'leave' });
    await closedWith(ca);
    await sleep(50);
    const due = await deadlines(made.tableId);
    expect(await inTable(made.tableId, (t: any) => t.meta.leader)).toBe(b.id);
    expect(due.leader! - Date.now()).toBeGreaterThan(LEADER_HANDOFF_MS - 5_000);

    // C comes back; B doesn't. At the handoff time the lead goes to C, with B's seat still held.
    const [cc2] = await enter(c, made.tableId);
    clockAt(due.leader! + 1);
    await runDurableObjectAlarm(table(made.tableId));
    const handed = await cc2.next<any>((m) => m.t === 'members' && m.leader === c.id);
    expect(find(handed.members, b.id)).toMatchObject({ status: 'seated', connected: false });
  });

  it('a leader the restart dropped hands the lead on if they are not back in time', async () => {
    const [a, b] = [await player('rl'), await player('rl')];
    const made = await makeLobby(a, 'highcard');
    const [ca] = await enter(a, made.tableId);
    const [cb] = await enter(b, made.tableId);
    await buyIn(ca, 10_000);
    await buyIn(cb, 10_000);
    await evictDurableObject(table(made.tableId), { webSockets: 'close' });
    const [cb2, snap] = await enter(b, made.tableId);
    expect(snap.leader).toBe(a.id);
    const due = await deadlines(made.tableId);
    expect(Object.keys(due)).toEqual(expect.arrayContaining(['leader', `grace:${a.id}`]));
    expect(due.leader!).toBeLessThan(due[`grace:${a.id}`]!);
    clockAt(due.leader! + 1);
    await runDurableObjectAlarm(table(made.tableId));
    await cb2.next((m) => m.t === 'members' && m.leader === b.id);
  });
});

// ---------------------------------------------------------------------------------------------

describe('money paths', () => {
  it('a buy-in that landed in D1 just before the table restarted is credited once, not twice', async () => {
    const p = await player('once');
    const made = await makeLobby(p, 'highcard');
    const [c] = await enter(p, made.tableId);
    // The table records the intent and the op reaches D1, then the object dies before it can
    // record the outcome.
    const opId = await inTable(made.tableId, (t: any) => {
      const mem = t.members.get(p.id);
      let id = '';
      t.ctx.storage.transactionSync(() => {
        mem.status = 'buying_in';
        t.sql.exec(`UPDATE members SET status = 'buying_in' WHERE account_id = ?1`, p.id);
        id = t.enqueue('buyin', p.id, 10_000, null, Date.now());
      });
      return id;
    });
    await applyTransfer(env.DB, buyInStatements(env.DB, { opId, accountId: p.id, tableId: made.tableId, amount: 10_000, now: Date.now() }), opId);
    c.ws.close();
    await evictDurableObject(table(made.tableId));

    // After the restart the outbox runs the op again, with the same id: D1 says it already landed.
    const [c2] = await enter(p, made.tableId);
    await runDurableObjectAlarm(table(made.tableId));
    await c2.next((m) => m.t === 'seat' && m.status === 'seated' && m.stack === 10_000);
    expect(await money(p.id)).toEqual({ balance: STARTING_BALANCE - 10_000, in_play: 10_000 });
    expect(await escrow(p.id, made.tableId)).toBe(10_000);
    const rows = await env.DB.prepare(`SELECT count(*) AS n FROM casino_ledger WHERE op_id = ?1`).bind(opId).first<any>();
    expect(rows.n).toBe(1);
  });

  it("a table doesn't close while money is still on its way to D1", async () => {
    const p = await player('close');
    const made = await makeLobby(p, 'highcard');
    // An op D1 keeps refusing (its account doesn't exist), so it stays pending and retries.
    await inTable(made.tableId, (t: any) => t.enqueue('cashout', 987_654_320, 100, null, Date.now()));
    await runDurableObjectAlarm(table(made.tableId));
    const due = await deadlines(made.tableId);
    clockAt(due.close! + 1);
    await runDurableObjectAlarm(table(made.tableId));
    expect(await inTable(made.tableId, (t: any) => t.meta.closed)).toBe(false);
    const later = (await deadlines(made.tableId)).close!;
    expect(later).toBeGreaterThan(Date.now());

    // Once it lands (here: once it's settled by hand), the table closes at the next try.
    await inTable(made.tableId, (t: any) => t.sql.exec(`UPDATE outbox SET state = 'done'`));
    clockAt(later + 1);
    await runDurableObjectAlarm(table(made.tableId));
    expect(await inTable(made.tableId, (t: any) => t.meta.closed)).toBe(true);
  });

  it('a socket that drops while its buy-in is in flight keeps the seat, and the chips go home after the grace period', async () => {
    const [a, b] = [await player('fly'), await player('fly')];
    const made = await makeLobby(b, 'highcard');
    const [cb] = await enter(b, made.tableId);
    const [ca] = await enter(a, made.tableId);
    ca.send({ t: 'buyin', aid: aid(), amount: 25_000 });
    ca.ws.close(1001, 'network');
    const held = await cb.next<any>((m) => m.t === 'members' && find(m.members, a.id)?.status === 'seated' && find(m.members, a.id)?.connected === false);
    expect(find(held.members, a.id).stack).toBe(25_000);
    expect(await money(a.id)).toEqual({ balance: STARTING_BALANCE - 25_000, in_play: 25_000 });
    const grace = (await deadlines(made.tableId))[`grace:${a.id}`]!;
    expect(grace - Date.now()).toBeGreaterThan(GRACE_MS - 5_000);
    cb.msgs.length = 0;
    clockAt(grace + 1);
    await runDurableObjectAlarm(table(made.tableId));
    await cb.next((m) => m.t === 'members' && !find(m.members, a.id));
    expect(await money(a.id)).toEqual({ balance: STARTING_BALANCE, in_play: 0 });
    expect(await escrow(a.id, made.tableId)).toBeNull();
  });

  it('a buy-in refused for funds while its player was leaving lets them go at once', async () => {
    const p = await player('broke');
    const made = await makeLobby(p, 'highcard');
    const [c] = await enter(p, made.tableId);
    await env.DB.prepare(`UPDATE casino_accounts SET balance = 0 WHERE id = ?1`).bind(p.id).run();
    // The buy-in is in flight when the leave arrives (as it would be on a slow link).
    await inTable(made.tableId, async (t: any) => {
      const mem = t.members.get(p.id);
      t.handleBuyIn(t.ctx.getWebSockets()[0], mem, 'buyin', 'poor', 10_000, Date.now());
      t.beginLeave(mem, Date.now());
      await t.pump();
    });
    expect((await c.next<any>((m) => m.t === 'err')).code).toBe('INSUFFICIENT_FUNDS');
    expect(await closedWith(c)).toEqual({ code: 1000, reason: 'left the table' });
    expect(await inTable(made.tableId, (t: any) => t.members.has(p.id))).toBe(false);
    // Nothing keeps them out: they can come straight back.
    const [, snap] = await enter(p, made.tableId);
    expect(snap.you.status).toBe('watching');
  });

  it("after rules change under a stored round, the round is voided and dropped players' seats still get a grace period", async () => {
    const [a, b] = [await player('void'), await player('void')];
    const made = await makeLobby(a, 'highcard');
    const [ca] = await enter(a, made.tableId);
    const [cb] = await enter(b, made.tableId);
    await buyIn(ca, 10_000);
    await buyIn(cb, 10_000);
    ca.send({ t: 'start' });
    await cb.next((m) => m.t === 'ev' && m.view.phase === 'betting');
    cb.send({ t: 'act', aid: aid(), a: { type: 'bet', amount: 2_000 } });
    await cb.next((m) => m.t === 'seat' && m.stack === 8_000);
    await inTable(made.tableId, (t: any) => t.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('engineVersion', '-1')`));
    await evictDurableObject(table(made.tableId), { webSockets: 'close' });

    const [, snap] = await enter(a, made.tableId);
    // B's bet came back to B's stack, and B's seat is held like after any restart.
    expect(find(snap.members, b.id)).toMatchObject({ status: 'seated', stack: 10_000, connected: false });
    const due = await deadlines(made.tableId);
    expect(Object.keys(due)).toContain(`grace:${b.id}`);
    clockAt(due[`grace:${b.id}`]! + 1);
    await runDurableObjectAlarm(table(made.tableId));
    await sleep(50);
    expect(await escrow(b.id, made.tableId)).toBeNull();
    expect((await money(b.id)).in_play).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe('timers', () => {
  it("an engine deadline tick() can't clear is retried with a growing wait, not every 10 ms", async () => {
    const p = await player('stuck');
    const made = await makeLobby(p, 'highcard');
    const [c] = await enter(p, made.tableId);
    await buyIn(c, 10_000);
    c.send({ t: 'start' });
    const open = await c.next<any>((m) => m.t === 'ev' && m.view.phase === 'betting');
    // The table forgets it was started (in memory only): tick() now does nothing, yet the betting
    // deadline stays due.
    await inTable(made.tableId, (t: any) => {
      t.meta.started = false;
    });
    const waits: number[] = [];
    let now = open.view.deadline + 1;
    for (let i = 0; i < 4; i++) {
      clockAt(now);
      await runDurableObjectAlarm(table(made.tableId));
      const at = (await inTable(made.tableId, (_t, state) => state.storage.getAlarm())) as number;
      waits.push(at - Date.now());
      now = at + 1;
    }
    expect(waits[0]!).toBeGreaterThanOrEqual(90);
    for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeGreaterThan(waits[i - 1]!);
  });
});
