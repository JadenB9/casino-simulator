// Lobby tables end to end: the floor's directory (the public list, pushes to watchers, PINs,
// guess limits) and the party rules a lobby table enforces (leader, visibility, Start, seat
// limits, drops and the grace period).
//
// High Card is the game because it is a real multiplayer engine. The HTTP /tables route refuses
// dev games, so lobbies are made the way that route makes them: the floor's createLobby, then the
// table's init. Time moves by faking Date (the Durable Objects share the test's isolate) and then
// running the table's alarm, so the real deadline code decides what happens.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { ORIGIN, TEST_PASSWORD, api, connect, type Client } from './helpers.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import { GRACE_MS, HOST_CONSTANTS, LEADER_HANDOFF_MS, RESTART_SHIFT_MS, type CasinoTable } from '../src/table/host.ts';
import { PIN_COOLDOWN_MS, PIN_STALE_MS, STALE_MS, ipKey } from '../src/floor/directory.ts';
import { BETTING_MS } from '../../shared/src/games/highcard/engine.ts';
import type { LobbySummary, Member } from '../../shared/src/protocol.ts';

// ---------------------------------------------------------------------------------------------
// helpers

interface Player {
  id: number;
  name: string;
  token: string;
}

let seq = 0;

/** A fresh address per call, so no test trips another's per-address limits. */
function nextIp(): string {
  seq++;
  return `10.${(seq >> 16) & 255}.${(seq >> 8) & 255}.${seq & 255}`;
}

async function player(tag: string): Promise<Player> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': nextIp() },
      body: JSON.stringify({ name: `lb${tag}${++seq}`, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  return { id: body.profile.id, name: body.profile.name, token: body.token };
}

function floor(): DurableObjectStub<CasinoFloor> {
  return env.FLOOR.get(env.FLOOR.idFromName('main'));
}

function table(id: string): DurableObjectStub<CasinoTable> {
  return env.TABLE.get(env.TABLE.idFromName(id));
}

/** What POST /tables does for a game it allows. */
async function makeLobby(creator: Player, visibility: 'public' | 'private'): Promise<{ tableId: string; pin: string | null }> {
  const made = await floor().createLobby({ game: 'highcard', visibility, accountId: creator.id, ip: nextIp() });
  if ('error' in made) throw new Error(`createLobby refused: ${made.error}`);
  await table(made.tableId).init({ name: made.tableId, game: 'highcard', variant: '', mode: 'multi', visibility, pin: made.pin });
  return made;
}

/** Open a table socket and wait for the snapshot. A private lobby needs its PIN from newcomers. */
async function enter(p: Player, tableId: string, pin?: string | null): Promise<[Client, any]> {
  const { client } = await connect(`table/${tableId}`, p.token, pin ? `&pin=${pin}` : '');
  const snap = await client!.next<any>((m) => m.t === 'table');
  return [client!, snap];
}

async function buyIn(c: Client, amount: number): Promise<void> {
  c.send({ t: 'buyin', aid: `buy${++seq}`, amount });
  await c.next((m) => m.t === 'seat' && m.status === 'seated');
}

function bet(c: Client, amount: number): void {
  c.send({ t: 'act', aid: `bet${++seq}`, a: { type: 'bet', amount } });
}

async function joinByPin(p: Player, pin: string, ip = nextIp()): Promise<Response> {
  return api('tables/join', p.token, { method: 'POST', body: JSON.stringify({ pin }), headers: { 'CF-Connecting-IP': ip } });
}

/** A floor socket watching High Card's lobby list. */
async function watcher(): Promise<{ w: Client; list: LobbySummary[] }> {
  const p = await player('w');
  const { client } = await connect('floor', p.token);
  const w = client!;
  await w.next((m) => m.t === 'hello');
  w.send({ t: 'watch', game: 'highcard' });
  const first = await w.next<any>((m) => m.t === 'lobbies');
  return { w, list: first.list };
}

async function money(id: number): Promise<{ balance: number; in_play: number }> {
  return (await env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<any>())!;
}

async function escrow(id: number, tableId: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT amount FROM casino_escrow WHERE account_id = ?1 AND table_id = ?2`).bind(id, tableId).first<any>();
  return row ? row.amount : null;
}

async function deadlines(tableId: string): Promise<Record<string, number>> {
  return runInDurableObject(table(tableId), (_t, state) =>
    Object.fromEntries(state.storage.sql.exec<{ name: string; at: number }>(`SELECT name, at FROM deadlines`).toArray().map((r) => [r.name, r.at])),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function closedWith(c: Client, ms = 1500): Promise<{ code: number; reason: string }> {
  for (let waited = 0; waited < ms; waited += 10) {
    if (c.closed) return c.closed;
    await sleep(10);
  }
  throw new Error('socket stayed open');
}

/** Move the clock (it keeps running from there). Deadlines are then run with runDurableObjectAlarm. */
function clockAt(t: number): void {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(t);
}

afterEach(() => {
  vi.useRealTimers();
});

const isResult = (m: any) => m.t === 'ev' && m.events.some((e: any) => e.type === 'result');
const isBetting = (m: any) => m.t === 'ev' && m.events.some((e: any) => e.type === 'betting');
const find = (members: Member[], id: number) => members.find((m) => m.accountId === id);

/** Two players at a started public lobby, both bought in, the first betting window open. */
async function startedTable(buy = 10_000) {
  const a = await player('lead');
  const b = await player('mate');
  const made = await makeLobby(a, 'public');
  const [ca] = await enter(a, made.tableId);
  const [cb] = await enter(b, made.tableId);
  const before = { a: await money(a.id), b: await money(b.id) };
  await buyIn(ca, buy);
  await buyIn(cb, buy);
  ca.send({ t: 'start' });
  const open = await cb.next<any>(isBetting);
  await ca.next(isBetting);
  return { a, b, ca, cb, tableId: made.tableId, deadline: open.view.deadline as number, before };
}

// ---------------------------------------------------------------------------------------------

describe('the lobby list', () => {
  it('a public lobby is pushed to watchers once its creator sits down, with them as leader', async () => {
    const { w } = await watcher();
    const a = await player('pub');
    const made = await makeLobby(a, 'public');
    expect(made.pin).toBeNull();
    expect(made.tableId).toMatch(/^hc-[a-z0-9]{10}$/);
    // Empty, it isn't listed: nobody else can get there first and take the lead.
    await sleep(100);
    expect(w.msgs.some((m) => m.t === 'lobby' && m.lobby.tableId === made.tableId)).toBe(false);

    const [, snap] = await enter(a, made.tableId);
    expect(snap.leader).toBe(a.id);
    expect(snap.meta).toMatchObject({ mode: 'multi', visibility: 'public', started: false });
    expect(snap.meta.pin).toBeUndefined();
    const listed = await w.next<any>((m) => m.t === 'lobby' && m.lobby.tableId === made.tableId);
    expect(listed.game).toBe('highcard');
    expect(listed.lobby).toMatchObject({ game: 'highcard', variant: '', leader: a.name, players: 1, max: 6, started: false });

    // Someone who starts watching now gets it in the list itself.
    const later = await watcher();
    expect(later.list.find((l) => l.tableId === made.tableId)).toMatchObject({ leader: a.name, players: 1, max: 6 });
  });

  it('a lobby drops off the list the moment its last member leaves', async () => {
    const a = await player('last');
    const made = await makeLobby(a, 'public');
    const [ca] = await enter(a, made.tableId);
    const { w, list } = await watcher();
    expect(list.some((l) => l.tableId === made.tableId)).toBe(true);
    ca.send({ t: 'leave' });
    await w.next((m) => m.t === 'lobby.gone' && m.tableId === made.tableId);
    expect((await watcher()).list.some((l) => l.tableId === made.tableId)).toBe(false);
  });

  it('a private lobby gets a PIN and never appears on the list', async () => {
    const { w } = await watcher();
    const a = await player('priv');
    const made = await makeLobby(a, 'private');
    expect(made.pin).toMatch(/^\d{4}$/);
    const [, snap] = await enter(a, made.tableId, made.pin);
    expect(snap.meta).toMatchObject({ visibility: 'private', pin: made.pin });
    await sleep(100);
    expect(w.msgs.some((m) => m.t === 'lobby' && m.lobby.tableId === made.tableId)).toBe(false);
    expect((await watcher()).list.some((l) => l.tableId === made.tableId)).toBe(false);
  });

  it('an entry that stops reporting in drops off after 150 s, and watchers hear it go', async () => {
    const { w } = await watcher();
    const t0 = Date.now();
    const s: LobbySummary = { tableId: 'hc-stale00001', game: 'highcard', variant: '', leader: 'ghost', players: 1, max: 6, started: false };
    await runInDurableObject(floor(), (f) => f.directory.upsert(s, t0));
    await w.next((m) => m.t === 'lobby' && m.lobby.tableId === s.tableId);
    const listedAt = (t: number) => runInDurableObject(floor(), (f) => f.directory.list('highcard', t).some((l) => l.tableId === s.tableId));
    expect(await listedAt(t0 + STALE_MS - 1)).toBe(true);
    expect(await listedAt(t0 + STALE_MS + 1)).toBe(false);
    await w.next((m) => m.t === 'lobby.gone' && m.tableId === s.tableId && m.game === 'highcard');
  });

  it('a heartbeat that changes nothing keeps the entry fresh without pushing it again', async () => {
    const { w } = await watcher();
    const t0 = Date.now();
    const s: LobbySummary = { tableId: 'hc-beat000001', game: 'highcard', variant: '', leader: 'x', players: 1, max: 6, started: false };
    await runInDurableObject(floor(), (f) => f.directory.upsert(s, t0));
    await w.next((m) => m.t === 'lobby' && m.lobby.tableId === s.tableId);
    await runInDurableObject(floor(), (f) => f.directory.upsert(s, t0 + 60_000));
    await sleep(50);
    expect(w.msgs.some((m) => m.t === 'lobby' && m.lobby.tableId === s.tableId)).toBe(false);
    const listed = await runInDurableObject(floor(), (f) => f.directory.list('highcard', t0 + 60_000 + STALE_MS - 1).some((l) => l.tableId === s.tableId));
    expect(listed).toBe(true);
    await runInDurableObject(floor(), (f) => f.directory.upsert({ ...s, players: 2 }, t0 + 61_000));
    await w.next((m) => m.t === 'lobby' && m.lobby.tableId === s.tableId && m.lobby.players === 2);
    await runInDurableObject(floor(), (f) => f.directory.remove(s.tableId, 'highcard', t0 + 62_000));
    await w.next((m) => m.t === 'lobby.gone' && m.tableId === s.tableId);
  });
});

// ---------------------------------------------------------------------------------------------

/**
 * Park every real PIN row and hold all 10,000 PINs but `free` with filler tables, so the allocator
 * has exactly one choice. restorePins() puts the real rows back.
 */
let parked: Record<string, unknown>[] = [];

async function holdAllPinsBut(free: string, touchedAt: number): Promise<void> {
  parked = await runInDurableObject(floor(), (_f, state) => {
    const sql = state.storage.sql;
    const rows = sql.exec(`SELECT * FROM lobby_pins`).toArray() as Record<string, unknown>[];
    sql.exec(`DELETE FROM lobby_pins`);
    sql.exec(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 9999)
       INSERT INTO lobby_pins (pin, table_id, game, released_at, touched_at)
       SELECT printf('%04d', i), 'filler-' || i, 'highcard', NULL, ?1 FROM n WHERE printf('%04d', i) <> ?2`,
      touchedAt, free,
    );
    return rows;
  });
}

async function restorePins(): Promise<void> {
  const rows = parked;
  await runInDurableObject(floor(), (_f, state) => {
    const sql = state.storage.sql;
    sql.exec(`DELETE FROM lobby_pins`);
    for (const r of rows) {
      sql.exec(`INSERT INTO lobby_pins (pin, table_id, game, released_at, touched_at) VALUES (?1, ?2, ?3, ?4, ?5)`, r.pin, r.table_id, r.game, r.released_at, r.touched_at);
    }
  });
}

/** A well-formed PIN that no lobby holds right now. */
async function unusedPin(): Promise<string> {
  return runInDurableObject(floor(), (_f, state) => {
    const held = new Set(state.storage.sql.exec<{ pin: string }>(`SELECT pin FROM lobby_pins WHERE table_id IS NOT NULL`).toArray().map((r) => r.pin));
    for (let n = 1234; ; n = (n + 1) % 10_000) if (!held.has(String(n).padStart(4, '0'))) return String(n).padStart(4, '0');
  });
}

const allocAt = (tableId: string, t: number) => runInDurableObject(floor(), (f) => f.directory.allocatePin(tableId, 'highcard', t));
const lookupAt = (pin: string, t: number) => runInDurableObject(floor(), (f) => f.directory.joinByPin({ pin, accountId: 900_000 + ++seq, ip: nextIp() }, t));

describe('PINs', () => {
  it('a second account joins a private lobby by PIN, and the creator leads', async () => {
    const a = await player('host');
    const b = await player('guest');
    const made = await makeLobby(a, 'private');
    const [ca] = await enter(a, made.tableId, made.pin);

    const res = await joinByPin(b, made.pin!);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tableId: made.tableId, game: 'highcard' });
    const [, snap] = await enter(b, made.tableId, made.pin);
    expect(snap.leader).toBe(a.id);
    expect(snap.members.map((m: Member) => m.accountId)).toEqual([a.id, b.id]);
    // Members see the PIN, so anyone at the table can invite a friend.
    expect(snap.meta.pin).toBe(made.pin);

    const seen = await ca.next<any>((m) => m.t === 'members' && m.members.length === 2);
    expect(seen).toMatchObject({ leader: a.id, visibility: 'private', pin: made.pin, started: false });
    expect(find(seen.members, b.id)).toMatchObject({ name: b.name, seat: 1, status: 'watching', connected: true, ready: false, stack: 0 });

    // A PIN that isn't in use leads nowhere.
    const wrong = await joinByPin(b, await unusedPin());
    expect(wrong.status).toBe(404);
    expect(await wrong.json()).toMatchObject({ error: 'BAD_PIN' });
  });

  it('PINs are unique among live lobbies and wait 10 minutes after release before reuse', async () => {
    const t0 = Date.now();
    const free = '4321';
    await holdAllPinsBut(free, t0 + 3_600_000);
    try {
      expect(await allocAt('hc-pinuniq0001', t0)).toBe(free);
      // Asking again gives the same PIN back rather than drawing a second one.
      expect(await allocAt('hc-pinuniq0001', t0)).toBe(free);
      // Nothing is left for anyone else, and a private lobby can't be made.
      expect(await allocAt('hc-pinuniq0002', t0)).toBeNull();
      const refused = await runInDurableObject(floor(), (f) =>
        f.directory.createLobby({ game: 'highcard', visibility: 'private', accountId: 900_000 + ++seq, ip: nextIp() }, t0),
      );
      expect(refused).toEqual({ error: 'RATE_LIMITED' });

      await runInDurableObject(floor(), (f) => f.directory.releasePin('hc-pinuniq0001', t0 + 1_000));
      expect(await lookupAt(free, t0 + 2_000)).toEqual({ error: 'BAD_PIN' });
      expect(await allocAt('hc-pinuniq0002', t0 + 1_000 + PIN_COOLDOWN_MS - 1)).toBeNull();
      expect(await allocAt('hc-pinuniq0002', t0 + 1_000 + PIN_COOLDOWN_MS)).toBe(free);
      expect(await lookupAt(free, t0 + 1_000 + PIN_COOLDOWN_MS)).toEqual({ tableId: 'hc-pinuniq0002', game: 'highcard' });
    } finally {
      await restorePins();
    }
  });

  it('a PIN whose table went silent for 30 minutes is taken back, cooldown first', async () => {
    const t0 = Date.now();
    const free = '0042';
    await holdAllPinsBut(free, t0 + 10 * 3_600_000);
    try {
      expect(await allocAt('hc-pinsilent01', t0)).toBe(free);
      // A private table reports in through remove(); that keeps its PIN.
      const t1 = t0 + 20 * 60_000;
      await runInDurableObject(floor(), (f) => f.directory.remove('hc-pinsilent01', 'highcard', t1));
      expect(await allocAt('hc-pinsilent02', t1 + PIN_STALE_MS - 1)).toBeNull();
      expect(await lookupAt(free, t1 + PIN_STALE_MS - 1)).toEqual({ tableId: 'hc-pinsilent01', game: 'highcard' });
      // Silent past the limit: released, then held back like any other released PIN.
      const t2 = t1 + PIN_STALE_MS + 1;
      expect(await allocAt('hc-pinsilent02', t2)).toBeNull();
      expect(await lookupAt(free, t2)).toEqual({ error: 'BAD_PIN' });
      expect(await allocAt('hc-pinsilent02', t2 + PIN_COOLDOWN_MS)).toBe(free);
    } finally {
      await restorePins();
    }
  });

  it('guessing over HTTP is refused after 5 tries a minute from one account', async () => {
    const g = await player('guess');
    const ip = nextIp();
    const pin = await unusedPin();
    for (let i = 0; i < 5; i++) {
      const r = await joinByPin(g, pin, ip);
      expect(r.status).toBe(404);
      expect((await r.json<any>()).error).toBe('BAD_PIN');
    }
    const r = await joinByPin(g, pin, ip);
    expect(r.status).toBe(429);
    expect((await r.json<any>()).error).toBe('RATE_LIMITED');
    // The same account from another address is still over its own limit.
    expect((await joinByPin(g, pin)).status).toBe(429);
  });

  it('an account gets 5 guesses a minute and 30 an hour', async () => {
    const counts = await runInDurableObject(floor(), (f) => {
      const t0 = Date.now();
      const account = 910_001;
      const tally: number[] = [];
      // 7 minutes of 6 tries each, every try from a different address.
      for (let minute = 0; minute < 7; minute++) {
        let allowed = 0;
        for (let i = 0; i < 6; i++) {
          const r = f.directory.joinByPin({ pin: '9x9x', accountId: account, ip: `198.18.${minute}.${i}` }, t0 + minute * 60_000 + i);
          if (!('error' in r) || r.error !== 'RATE_LIMITED') allowed++;
        }
        tally.push(allowed);
      }
      const nextHour = f.directory.joinByPin({ pin: '9x9x', accountId: account, ip: '198.18.9.9' }, t0 + 3_600_000 + 1);
      return { tally, nextHour };
    });
    expect(counts.tally).toEqual([5, 5, 5, 5, 5, 5, 0]);
    expect(counts.nextHour).toEqual({ error: 'BAD_PIN' });
  });

  it('an address gets 10 guesses a minute and 60 an hour, and IPv6 counts per /64', async () => {
    const out = await runInDurableObject(floor(), (f) => {
      const t0 = Date.now();
      let account = 920_000;
      const tally: number[] = [];
      for (let minute = 0; minute < 7; minute++) {
        let allowed = 0;
        for (let i = 0; i < 11; i++) {
          const r = f.directory.joinByPin({ pin: '9x9x', accountId: ++account, ip: '198.19.7.7' }, t0 + minute * 60_000 + i);
          if (!('error' in r) || r.error !== 'RATE_LIMITED') allowed++;
        }
        tally.push(allowed);
      }
      // Eleven addresses from one /64 are one address; the neighbouring /64 is another.
      let v6 = 0;
      for (let i = 1; i <= 11; i++) {
        const r = f.directory.joinByPin({ pin: '9x9x', accountId: ++account, ip: `2001:db8:77:1::${i.toString(16)}` }, t0);
        if (!('error' in r) || r.error !== 'RATE_LIMITED') v6++;
      }
      const neighbour = f.directory.joinByPin({ pin: '9x9x', accountId: ++account, ip: '2001:db8:77:2::1' }, t0);
      return { tally, v6, neighbour };
    });
    expect(out.tally).toEqual([10, 10, 10, 10, 10, 10, 0]);
    expect(out.v6).toBe(10);
    expect(out.neighbour).toEqual({ error: 'BAD_PIN' });
  });

  it('addresses are keyed sensibly', () => {
    expect(ipKey('203.0.113.5')).toBe('203.0.113.5');
    expect(ipKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:DB8:0001:0002::9')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
    expect(ipKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(ipKey('')).toBe('unknown');
  });

  it('creating lobbies has its own limits, apart from PIN guesses', async () => {
    const out = await runInDurableObject(floor(), (f) => {
      const t0 = Date.now();
      const account = 930_001;
      const made: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = f.directory.createLobby({ game: 'highcard', visibility: 'public', accountId: account, ip: `198.20.0.${i}` }, t0 + i);
        made.push('error' in r ? r.error : 'ok');
      }
      const guess = f.directory.joinByPin({ pin: '9x9x', accountId: account, ip: '198.20.1.1' }, t0 + 10);
      // Per address: ten creates a minute, whoever asks.
      let fromOne = 0;
      for (let i = 0; i < 11; i++) {
        const r = f.directory.createLobby({ game: 'highcard', visibility: 'public', accountId: 930_100 + i, ip: '198.20.2.2' }, t0 + i);
        if (!('error' in r)) fromOne++;
      }
      return { made, guess, fromOne };
    });
    expect(out.made).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'RATE_LIMITED']);
    expect(out.guess).toEqual({ error: 'BAD_PIN' });
    expect(out.fromOne).toBe(10);
  });

  it('the limits survive the floor going to sleep', async () => {
    const account = 940_001;
    for (let i = 0; i < 5; i++) {
      expect(await floor().joinByPin({ pin: '9x9x', accountId: account, ip: nextIp() })).toEqual({ error: 'BAD_PIN' });
    }
    await evictDurableObject(floor());
    expect(await floor().joinByPin({ pin: '9x9x', accountId: account, ip: nextIp() })).toEqual({ error: 'RATE_LIMITED' });
  });
});

// ---------------------------------------------------------------------------------------------

describe('the party', () => {
  it('the leader switches visibility: public frees the PIN and lists the lobby, private draws a new PIN', async () => {
    const a = await player('vis');
    const b = await player('vis');
    const made = await makeLobby(a, 'private');
    const [ca] = await enter(a, made.tableId, made.pin);
    const [cb] = await enter(b, made.tableId, made.pin);
    const { w } = await watcher();

    cb.send({ t: 'visibility', visibility: 'public' });
    expect((await cb.next<any>((m) => m.t === 'err')).code).toBe('NOT_LEADER');

    // Drop what's already queued (the join broadcasts) so only the toggle's own messages match.
    cb.msgs.length = 0;
    ca.send({ t: 'visibility', visibility: 'public' });
    const pub = await cb.next<any>((m) => m.t === 'members' && m.visibility === 'public');
    expect(pub.pin).toBeUndefined();
    const listed = await w.next<any>((m) => m.t === 'lobby' && m.lobby.tableId === made.tableId);
    expect(listed.lobby).toMatchObject({ leader: a.name, players: 2 });
    expect((await joinByPin(b, made.pin!)).status).toBe(404);

    cb.msgs.length = 0;
    ca.send({ t: 'visibility', visibility: 'private' });
    const priv = await cb.next<any>((m) => m.t === 'members' && m.visibility === 'private');
    expect(priv.pin).toMatch(/^\d{4}$/);
    // The old PIN is cooling down, so the lobby gets a different one.
    expect(priv.pin).not.toBe(made.pin);
    await w.next((m) => m.t === 'lobby.gone' && m.tableId === made.tableId);
    expect(await (await joinByPin(b, priv.pin)).json()).toEqual({ tableId: made.tableId, game: 'highcard' });
    // A fresh snapshot carries the new PIN for members.
    cb.send({ t: 'sync' });
    expect((await cb.next<any>((m) => m.t === 'table')).meta.pin).toBe(priv.pin);
  });

  it('only the leader starts, and a started table runs rounds: betting window, deal at the deadline, results', async () => {
    const a = await player('deal');
    const b = await player('punt');
    const made = await makeLobby(a, 'public');
    const [ca] = await enter(a, made.tableId);
    const [cb] = await enter(b, made.tableId);
    await buyIn(ca, 10_000);
    await buyIn(cb, 10_000);

    bet(ca, 500);
    expect((await ca.next<any>((m) => m.t === 'err')).code).toBe('WRONG_PHASE');
    cb.send({ t: 'start' });
    expect((await cb.next<any>((m) => m.t === 'err')).code).toBe('NOT_LEADER');

    ca.send({ t: 'start' });
    await cb.next((m) => m.t === 'members' && m.started === true);
    const open = await cb.next<any>(isBetting);
    await ca.next(isBetting);
    expect(open.view).toMatchObject({ phase: 'betting', round: 1 });
    expect(open.view.deadline - open.now).toBe(BETTING_MS);

    bet(ca, 1_000);
    bet(cb, 2_000);
    await ca.next((m) => m.t === 'seat' && m.stack === 9_000);
    await cb.next((m) => m.t === 'seat' && m.stack === 8_000);

    // Before the deadline the alarm has nothing to do...
    await runDurableObjectAlarm(table(made.tableId));
    await sleep(30);
    expect(ca.msgs.some(isResult)).toBe(false);

    // ...at the deadline the dealer deals and settles every seat that bet.
    clockAt(open.view.deadline + 1);
    expect(await runDurableObjectAlarm(table(made.tableId))).toBe(true);
    const dealtA = await ca.next<any>(isResult);
    const dealtB = await cb.next<any>(isResult);
    expect(dealtA.view.phase).toBe('results');
    expect(Object.keys(dealtA.view.results).sort()).toEqual(['0', '1']);
    expect(dealtB.view.cards).toEqual(dealtA.view.cards);
    const payA = dealtA.view.results['0'].payout as number;
    const payB = dealtA.view.results['1'].payout as number;
    expect([0, 1_000, 2_000]).toContain(payA);
    expect([0, 2_000, 4_000]).toContain(payB);
    ca.send({ t: 'sync' });
    expect((await ca.next<any>((m) => m.t === 'table')).you.stack).toBe(9_000 + payA);

    // Results stay up for a moment, then the next window opens.
    clockAt(dealtA.view.deadline + 1);
    expect(await runDurableObjectAlarm(table(made.tableId))).toBe(true);
    const next = await cb.next<any>(isBetting);
    expect(next.view).toMatchObject({ phase: 'betting', round: 2 });
    expect(next.view.bets).toEqual({});
  });

  it('a betting window closes early once everyone who bet is ready', async () => {
    const { ca, cb } = await startedTable();
    bet(ca, 1_000);
    bet(cb, 1_000);
    await cb.next((m) => m.t === 'seat' && m.stack === 9_000);
    ca.send({ t: 'ready', on: true });
    await cb.next((m) => m.t === 'members' && m.members.some((x: Member) => x.ready));
    await sleep(30);
    expect(ca.msgs.some(isResult)).toBe(false);
    cb.send({ t: 'ready', on: true });
    await ca.next(isResult);
  });

  it('when the leader leaves, the earliest-joined member leads', async () => {
    const a = await player('one');
    const b = await player('two');
    const c = await player('three');
    const made = await makeLobby(a, 'public');
    const [ca] = await enter(a, made.tableId);
    const [cb] = await enter(b, made.tableId);
    const [cc] = await enter(c, made.tableId);
    const { w } = await watcher();
    await buyIn(ca, 10_000);

    // The leader has chips, so leaving cashes them out first.
    ca.send({ t: 'leave' });
    const after = await cc.next<any>((m) => m.t === 'members' && !find(m.members, a.id));
    expect(after.leader).toBe(b.id);
    expect(after.members.map((m: Member) => m.accountId)).toEqual([b.id, c.id]);
    await ca.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(await escrow(a.id, made.tableId)).toBeNull();
    const relisted = await w.next<any>((m) => m.t === 'lobby' && m.lobby.tableId === made.tableId && m.lobby.leader === b.name);
    expect(relisted.lobby.players).toBe(2);

    cb.send({ t: 'leave' });
    const last = await cc.next<any>((m) => m.t === 'members' && m.members.length === 1);
    expect(last.leader).toBe(c.id);
  });

  it('a member who never sat down is dropped at once, and the lead moves on', async () => {
    const a = await player('drop');
    const b = await player('stay');
    const made = await makeLobby(a, 'public');
    const [ca] = await enter(a, made.tableId);
    const [cb] = await enter(b, made.tableId);
    ca.ws.close(1001, 'gone');
    const m = await cb.next<any>((x) => x.t === 'members' && x.members.length === 1);
    expect(m.leader).toBe(b.id);
  });

  it('a full table refuses a seventh member with 4005, but a member can always come back', async () => {
    const ps: Player[] = [];
    for (let i = 0; i < 7; i++) ps.push(await player('full'));
    const made = await makeLobby(ps[0]!, 'public');
    const clients: Client[] = [];
    for (const p of ps.slice(0, 6)) clients.push((await enter(p, made.tableId))[0]);

    const { client: seventh } = await connect(`table/${made.tableId}`, ps[6]!.token);
    expect(await closedWith(seventh!)).toEqual({ code: 4005, reason: 'table full' });
    expect(seventh!.msgs.some((m) => m.t === 'table')).toBe(false);

    // A member reconnecting to the full table gets in; their old socket is told why it closed.
    const [, snap] = await enter(ps[3]!, made.tableId);
    expect(snap.members).toHaveLength(6);
    expect((await closedWith(clients[3]!)).code).toBe(4001);
  });
});

// ---------------------------------------------------------------------------------------------

describe('drops and the grace period', () => {
  it('a dropped seat is held; reconnecting restores the seat, the stack and the live bet', async () => {
    const { b, ca, cb, tableId } = await startedTable();
    bet(cb, 1_500);
    await cb.next((m) => m.t === 'seat' && m.stack === 8_500);
    cb.ws.close(1001, 'network');

    const held = await ca.next<any>((m) => m.t === 'members' && find(m.members, b.id)?.connected === false);
    expect(find(held.members, b.id)).toMatchObject({ seat: 1, status: 'seated', stack: 8_500 });
    expect(Object.keys(await deadlines(tableId))).toContain(`grace:${b.id}`);

    const [, snap] = await enter(b, tableId);
    expect(snap.you).toEqual({ accountId: b.id, seat: 1, status: 'seated', stack: 8_500 });
    expect(snap.view).toMatchObject({ phase: 'betting', bets: { 1: 1_500 } });
    await ca.next((m) => m.t === 'members' && find(m.members, b.id)?.connected === true);
    expect(Object.keys(await deadlines(tableId))).not.toContain(`grace:${b.id}`);
  });

  it("the table deals a dropped player's bet at the deadline instead of waiting for them", async () => {
    const { b, ca, cb, tableId, deadline } = await startedTable();
    bet(ca, 1_000);
    bet(cb, 2_000);
    await cb.next((m) => m.t === 'seat' && m.stack === 8_000);
    cb.ws.close(1001, 'network');
    await ca.next((m) => m.t === 'members' && find(m.members, b.id)?.connected === false);

    clockAt(deadline + 1);
    await runDurableObjectAlarm(table(tableId));
    const dealt = await ca.next<any>(isResult);
    const payB = dealt.view.results['1'].payout as number;

    const [, snap] = await enter(b, tableId);
    expect(snap.you.stack).toBe(8_000 + payB);
    expect(snap.view.results['1']).toEqual(dealt.view.results['1']);
  });

  it('when the grace period runs out the seat is cashed out and the escrow closed', async () => {
    const { b, ca, cb, tableId, deadline, before } = await startedTable();
    bet(ca, 1_000);
    bet(cb, 2_000);
    await ca.next((m) => m.t === 'seat' && m.stack === 9_000);
    await cb.next((m) => m.t === 'seat' && m.stack === 8_000);
    clockAt(deadline + 1);
    await runDurableObjectAlarm(table(tableId));
    const dealt = await cb.next<any>(isResult);
    const stackB = 8_000 + (dealt.view.results['1'].payout as number);
    expect(await escrow(b.id, tableId)).toBe(10_000);

    cb.ws.close(1001, 'network');
    await ca.next((m) => m.t === 'members' && find(m.members, b.id)?.connected === false);
    const grace = (await deadlines(tableId))[`grace:${b.id}`]!;
    expect(grace - Date.now()).toBeGreaterThan(GRACE_MS - 5_000);

    clockAt(grace + 1);
    await runDurableObjectAlarm(table(tableId));
    await ca.next((m) => m.t === 'members' && !find(m.members, b.id));
    expect(await escrow(b.id, tableId)).toBeNull();
    expect(await money(b.id)).toEqual({ balance: before.b.balance - 10_000 + stackB, in_play: 0 });
    const stats = await env.DB.prepare(`SELECT rounds, wagered FROM casino_stats WHERE account_id = ?1 AND game = 'highcard'`).bind(b.id).first<any>();
    expect(stats).toEqual({ rounds: 1, wagered: 2_000 });
  });

  it('a dropped leader keeps the lead for 20 s, then hands it on while their seat is still held', async () => {
    const { a, b, ca, cb, tableId } = await startedTable();
    ca.ws.close(1001, 'network');
    const held = await cb.next<any>((m) => m.t === 'members' && find(m.members, a.id)?.connected === false);
    expect(held.leader).toBe(a.id);
    const due = await deadlines(tableId);
    expect(due.leader! - Date.now()).toBeGreaterThan(LEADER_HANDOFF_MS - 5_000);

    clockAt(due.leader! + 1);
    await runDurableObjectAlarm(table(tableId));
    const handed = await cb.next<any>((m) => m.t === 'members' && m.leader === b.id);
    expect(find(handed.members, a.id)).toMatchObject({ status: 'seated', connected: false });

    clockAt(due[`grace:${a.id}`]! + 1);
    await runDurableObjectAlarm(table(tableId));
    await cb.next((m) => m.t === 'members' && !find(m.members, a.id));
    expect(await escrow(a.id, tableId)).toBeNull();
  });

  it('a leader who comes back inside 20 s keeps the lead', async () => {
    const { a, cb, ca, tableId } = await startedTable();
    ca.ws.close(1001, 'network');
    await cb.next((m) => m.t === 'members' && find(m.members, a.id)?.connected === false);
    const [again] = await enter(a, tableId);
    expect(Object.keys(await deadlines(tableId))).not.toContain('leader');
    const back = await cb.next<any>((m) => m.t === 'members' && find(m.members, a.id)?.connected === true);
    expect(back.leader).toBe(a.id);
    again.ws.close();
  });

  it('an undealt bet comes back when a player leaves', async () => {
    const { b, ca, cb, tableId, before } = await startedTable();
    bet(cb, 2_500);
    await cb.next((m) => m.t === 'seat' && m.stack === 7_500);
    cb.send({ t: 'leave' });
    // Everyone sees the chips come off the layout...
    await ca.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'bet' && e.seat === 1 && e.total === 0));
    // ...and all of it goes home.
    const bal = await cb.next<any>((m) => m.t === 'balance' && m.inPlay === 0);
    expect(bal.balance).toBe(before.b.balance);
    expect(await escrow(b.id, tableId)).toBeNull();
    expect(await money(b.id)).toEqual({ balance: before.b.balance, in_play: 0 });
  });

  it('a restart holds every seat and pushes the betting deadline back', async () => {
    const { a, b, ca, tableId, deadline } = await startedTable();
    bet(ca, 1_000);
    await ca.next((m) => m.t === 'seat' && m.stack === 9_000);
    await evictDurableObject(table(tableId), { webSockets: 'close' });

    const [again, snap] = await enter(a, tableId);
    expect(snap.you).toMatchObject({ seat: 0, status: 'seated', stack: 9_000 });
    expect(snap.view).toMatchObject({ phase: 'betting', bets: { 0: 1_000 }, deadline: deadline + RESTART_SHIFT_MS });
    // The player who hasn't come back yet is held, not dropped.
    expect(find(snap.members, b.id)).toMatchObject({ status: 'seated', connected: false });
    expect(Object.keys(await deadlines(tableId))).toEqual(expect.arrayContaining([`grace:${b.id}`]));
    expect(Object.keys(await deadlines(tableId))).not.toContain(`grace:${a.id}`);
    again.ws.close();
  });
});

// ---------------------------------------------------------------------------------------------
// Gaps in server/src/table/host.ts found while writing these tests, now fixed there.

describe('host.ts gaps', () => {
  it('a lobby stays listed while it is played, even when its first heartbeat found it empty', async () => {
    const a = await player('beat');
    const made = await makeLobby(a, 'public');
    // The creator takes a minute to sit down, so the first heartbeat finds nobody and stops.
    clockAt(Date.now() + 61_000);
    await runDurableObjectAlarm(table(made.tableId));
    await enter(a, made.tableId);
    for (let i = 0; i < 4; i++) {
      clockAt(Date.now() + 61_000);
      await runDurableObjectAlarm(table(made.tableId));
    }
    expect((await watcher()).list.some((l) => l.tableId === made.tableId)).toBe(true);
  });

  it('a stranger who saw a lobby listed cannot walk in after it goes private', async () => {
    const a = await player('shut');
    const s = await player('strange');
    const made = await makeLobby(a, 'public');
    const [ca] = await enter(a, made.tableId);
    ca.send({ t: 'visibility', visibility: 'private' });
    await ca.next((m) => m.t === 'members' && m.visibility === 'private');
    const { client } = await connect(`table/${made.tableId}`, s.token);
    expect((await closedWith(client!, 400)).code).toBe(4005);
  });

  it('ready is cleared when a round ends, so the next window waits for everyone again', async () => {
    const { ca, cb, tableId } = await startedTable();
    bet(ca, 1_000);
    bet(cb, 1_000);
    ca.send({ t: 'ready', on: true });
    cb.send({ t: 'ready', on: true });
    const dealt = await ca.next<any>(isResult);
    clockAt(dealt.view.deadline + 1);
    await runDurableObjectAlarm(table(tableId));
    await ca.next(isBetting);
    // Round two: one chip from the first player must not deal the hand over the second's head.
    ca.msgs.length = 0;
    bet(ca, 1_000);
    await ca.next((m) => m.t === 'ev' && m.events.some((e: any) => e.type === 'bet' && e.seat === 0));
    await sleep(50);
    expect(ca.msgs.some(isResult)).toBe(false);
  });

  it('a private lobby lets in the right PIN, refuses a wrong one, and locks out a guesser', async () => {
    const a = await player('lock');
    const b = await player('friend');
    const g = await player('guess');
    const made = await makeLobby(a, 'private');
    await enter(a, made.tableId, made.pin);
    const wrong = made.pin === '0000' ? '0001' : '0000';
    for (let i = 0; i < 5; i++) {
      const { client } = await connect(`table/${made.tableId}`, g.token, `&pin=${wrong}`);
      expect(await closedWith(client!, 400)).toEqual({ code: 4005, reason: 'wrong pin' });
    }
    // The sixth try is refused even with the right PIN, for a while.
    const { client: locked } = await connect(`table/${made.tableId}`, g.token, `&pin=${made.pin}`);
    expect(await closedWith(locked!, 400)).toEqual({ code: 4005, reason: 'too many tries' });
    const [, snap] = await enter(b, made.tableId, made.pin);
    expect(snap.members.map((m: Member) => m.accountId)).toContain(b.id);
  });

  it('a lobby nobody ever enters closes and gives up its PIN', async () => {
    const a = await player('empty');
    const made = await makeLobby(a, 'private');
    const due = await deadlines(made.tableId);
    expect(due.close! - Date.now()).toBeGreaterThan(HOST_CONSTANTS.EMPTY_CLOSE_MS - 5_000);
    clockAt(due.close! + 1);
    await runDurableObjectAlarm(table(made.tableId));
    const { client } = await connect(`table/${made.tableId}`, a.token, `&pin=${made.pin}`);
    expect((await closedWith(client!, 400)).code).toBe(4004);
    expect(await floor().joinByPin({ pin: made.pin!, accountId: a.id, ip: nextIp() })).toEqual({ error: 'BAD_PIN' });
  });

  it('a top-up lands while a bet is working, and the seat keeps playing', async () => {
    const { a, ca, tableId } = await startedTable();
    bet(ca, 1_000);
    await ca.next((m) => m.t === 'seat' && m.stack === 9_000);
    ca.send({ t: 'topup', aid: `top${++seq}`, amount: 5_000 });
    const topped = await ca.next<any>((m) => m.t === 'seat' && m.stack === 14_000);
    expect(topped).toMatchObject({ status: 'seated', escrow: 15_000 });
    expect(await escrow(a.id, tableId)).toBe(15_000);
    // The bet is still on the layout and still plays.
    const snap = await (async () => {
      ca.send({ t: 'sync' });
      return ca.next<any>((m) => m.t === 'table');
    })();
    expect(snap.view.bets).toMatchObject({ 0: 1_000 });
  });

  it('two joins in the same millisecond keep their order across a restart', async () => {
    const a = await player('tie');
    const c = await player('tie'); // the older account...
    const b = await player('tie'); // ...joins after this one
    const made = await makeLobby(a, 'public');
    const [ca] = await enter(a, made.tableId);
    vi.useFakeTimers({ toFake: ['Date'] }); // frozen: both joins get the same timestamp
    vi.setSystemTime(Date.now());
    const [cb] = await enter(b, made.tableId);
    await enter(c, made.tableId);
    vi.useRealTimers();
    await evictDurableObject(table(made.tableId));
    ca.send({ t: 'leave' });
    const after = await cb.next<any>((m) => m.t === 'members' && !find(m.members, a.id));
    expect(after.leader).toBe(b.id);
  });
});
