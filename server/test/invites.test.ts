// v6 invite6: invites to a lobby table, end to end through the floor (server/src/floor/invites.ts).
// Who an invite reaches (online, at the keyboard, taking invites), what it carries (never a
// private table's PIN), what a join checks (the invite is yours and still good, the table open
// with room, you're free to go), and the limits (per sender, per pair, per receiver, "everyone").
//
// Every test shares the one floor object, so each makes its own accounts and closes its sockets.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { ORIGIN, TEST_PASSWORD, connect, type Client } from './helpers.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import type { CasinoTable } from '../src/table/host.ts';
import { AWAY_MS, EVERYONE_MS, SEND_LIMITS, TARGET_PER_MIN, gameOfTable } from '../src/floor/invites.ts';
import { INVITE_MS } from '../../shared/src/protocol.ts';
import { LOTS } from '../../shared/src/zones.ts';

let seq = 0;
const open: Client[] = [];

interface Player {
  id: number;
  name: string;
  token: string;
  floor: Client;
}

async function player(tag: string): Promise<Player> {
  seq++;
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `10.61.${seq >> 8}.${seq & 255}` },
      body: JSON.stringify({ name: `iv${tag}${seq}`, password: TEST_PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json<any>();
  const { client } = await connect('floor', body.token);
  await client!.next((m) => m.t === 'hello');
  open.push(client!);
  return { id: body.profile.id, name: body.profile.name, token: body.token, floor: client! };
}

function floor(): DurableObjectStub<CasinoFloor> {
  return env.FLOOR.get(env.FLOOR.idFromName('main'));
}

function table(id: string): DurableObjectStub<CasinoTable> {
  return env.TABLE.get(env.TABLE.idFromName(id));
}

/** A lobby the way POST /tables makes one, with its creator sat at it. */
async function lobby(creator: Player, visibility: 'public' | 'private'): Promise<{ tableId: string; pin: string | null }> {
  const made = await floor().createLobby({ game: 'highcard', visibility, accountId: creator.id, ip: `10.62.0.${++seq & 255}` });
  if ('error' in made) throw new Error(made.error);
  await table(made.tableId).init({ name: made.tableId, game: 'highcard', variant: '', mode: 'multi', visibility, pin: made.pin });
  await enter(creator, made.tableId, made.pin);
  return made;
}

async function enter(p: Player, tableId: string, pin?: string | null): Promise<Client> {
  const { client } = await connect(`table/${tableId}`, p.token, pin ? `&pin=${pin}` : '');
  open.push(client!);
  await client!.next((m) => m.t === 'table');
  return client!;
}

/** Try a table socket; the close code if it was refused, null if it let us in. */
async function tryEnter(p: Player, tableId: string, pin?: string): Promise<number | null> {
  const { client } = await connect(`table/${tableId}`, p.token, pin ? `&pin=${pin}` : '');
  open.push(client!);
  for (let i = 0; i < 100; i++) {
    if (client!.msgs.some((m) => m.t === 'table')) return null;
    if (client!.closed) return client!.closed.code;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('no answer from the table');
}

const invited = (c: Client) => c.next<any>((m) => m.t === 'invited');
const answer = (c: Client) => c.next<any>((m) => m.t === 'invite.sent' || m.t === 'invite.no');
const joined = (c: Client) => c.next<any>((m) => m.t === 'invite.go' || m.t === 'invite.no');

async function nothing(c: Client, t: string, ms = 150): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  expect(c.msgs.filter((m) => m.t === t)).toEqual([]);
}

afterEach(() => {
  vi.useRealTimers();
  for (const c of open.splice(0)) if (!c.closed) c.ws.close(1000, 'bye');
});

describe('invites', () => {
  it('reads the game from a lobby id and nothing else', () => {
    expect(gameOfTable('hc-abcdefghij')).toBe('highcard');
    expect(gameOfTable('bj-0123456789')).toBe('blackjack');
    expect(gameOfTable('hc-short')).toBeNull();
    expect(gameOfTable('zz-abcdefghij')).toBeNull();
    expect(gameOfTable('blackjack:solo:1')).toBeNull();
  });

  it('brings a player to a public table: the card, then the table and a place beside it', async () => {
    const a = await player('pubA');
    const b = await player('pubB');
    const t = await lobby(a, 'public');
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    const sent = await answer(a.floor);
    expect(sent).toMatchObject({ t: 'invite.sent', table: t.tableId, all: false, sent: 1, skipped: [] });
    const inv = (await invited(b.floor)).invite;
    expect(inv).toMatchObject({ from: { id: a.id, name: a.name }, tableId: t.tableId, game: 'highcard', private: false, all: false });
    expect(inv.lobby).toMatchObject({ tableId: t.tableId, players: 1, leader: a.name });
    expect(inv.until - inv.at).toBe(INVITE_MS);
    await nothing(a.floor, 'invited');

    b.floor.send({ t: 'invite.take', id: inv.id, x: 150, z: 200, r: 64 });
    const go = await joined(b.floor);
    expect(go).toMatchObject({ t: 'invite.go', id: inv.id, tableId: t.tableId, game: 'highcard', r: 64 });
    expect(go.pin).toBeUndefined();
    // the floor moved them (their client hears where)
    const tp = await b.floor.next<any>((m) => m.t === 'tp');
    expect([tp.x, tp.z]).toEqual([go.x, go.z]);
    expect(await tryEnter(b, t.tableId)).toBeNull();
  });

  it('opens a private table to an invitee only, and never sends its PIN in the invite', async () => {
    const a = await player('prvA');
    const b = await player('prvB');
    const c = await player('prvC');
    const t = await lobby(a, 'private');
    expect(t.pin).toMatch(/^\d{4}$/);
    a.floor.send({ t: 'invite', table: t.tableId, pin: t.pin!, to: [b.id] });
    expect((await answer(a.floor)).sent).toBe(1);
    const msg = await invited(b.floor);
    expect(msg.invite.private).toBe(true);
    expect(JSON.stringify(msg)).not.toContain(t.pin);
    expect(JSON.stringify(msg)).not.toContain('"pin"');
    await nothing(c.floor, 'invited');

    // Someone else with the invite's id gets nothing from it.
    c.floor.send({ t: 'invite.take', id: msg.invite.id, x: 0, z: 0, r: 0 });
    expect(await joined(c.floor)).toMatchObject({ t: 'invite.no', id: msg.invite.id, code: 'NOT_FOUND' });
    expect(c.floor.msgs.some((m) => m.t === 'tp')).toBe(false);
    // and without the PIN the table itself still says no
    expect(await tryEnter(c, t.tableId)).toBe(4005);

    b.floor.send({ t: 'invite.take', id: msg.invite.id, x: 0, z: 0, r: 0 });
    const go = await joined(b.floor);
    expect(go).toMatchObject({ t: 'invite.go', tableId: t.tableId, pin: t.pin });
    expect(await tryEnter(b, t.tableId, go.pin)).toBeNull();
  });

  it("won't invite to a private table without its PIN, to a made-up table, or join with a made-up invite", async () => {
    const a = await player('frgA');
    const b = await player('frgB');
    const t = await lobby(a, 'private');
    const wrong = t.pin === '0000' ? '0001' : '0000';
    a.floor.send({ t: 'invite', table: t.tableId, pin: wrong, to: [b.id] });
    expect(await answer(a.floor)).toMatchObject({ t: 'invite.no', code: 'BAD_PIN', table: t.tableId });
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    expect(await answer(a.floor)).toMatchObject({ t: 'invite.no', code: 'BAD_PIN' });
    a.floor.send({ t: 'invite', table: 'hc-zzzzzzzzzz', to: [b.id] });
    expect(await answer(a.floor)).toMatchObject({ t: 'invite.no', code: 'NOT_FOUND' });
    // a solo table's name isn't a lobby
    a.floor.send({ t: 'invite', table: `highcard::${a.id}`, to: [b.id] });
    expect(await answer(a.floor)).toMatchObject({ t: 'invite.no', code: 'NOT_FOUND' });
    await nothing(b.floor, 'invited');

    b.floor.send({ t: 'invite.take', id: 'abcdefghijkl', x: 0, z: 0, r: 0 });
    expect(await joined(b.floor)).toMatchObject({ t: 'invite.no', code: 'NOT_FOUND' });
    // malformed invites are dropped like any junk frame
    b.floor.send({ t: 'invite.take', id: 'nope', x: 0, z: 0, r: 0 });
    a.floor.send({ t: 'invite', table: t.tableId, to: [] });
    a.floor.send({ t: 'invite', table: t.tableId, to: Array.from({ length: 11 }, (_, i) => i + 1) });
    await nothing(b.floor, 'invite.no');
    await nothing(a.floor, 'invite.no');
  });

  it('runs out after two minutes', async () => {
    const a = await player('expA');
    const b = await player('expB');
    const t = await lobby(a, 'public');
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    const inv = (await invited(b.floor)).invite;
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(inv.until + 1);
    b.floor.send({ t: 'invite.take', id: inv.id, x: 0, z: 0, r: 0 });
    expect(await joined(b.floor)).toMatchObject({ t: 'invite.no', id: inv.id, code: 'NOT_FOUND', msg: 'That invite has run out.' });
  });

  it('says a closed table has closed', async () => {
    const a = await player('clsA');
    const b = await player('clsB');
    const t = await lobby(a, 'public');
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    const inv = (await invited(b.floor)).invite;
    await runInDurableObject(table(t.tableId), (host: any) => {
      host.meta.closed = true;
    });
    b.floor.send({ t: 'invite.take', id: inv.id, x: 0, z: 0, r: 0 });
    expect(await joined(b.floor)).toMatchObject({ t: 'invite.no', code: 'NOT_FOUND', msg: 'That table has closed.' });
  });

  it("can't take someone out of the jail", async () => {
    const a = await player('jlA');
    const b = await player('jlB');
    const t = await lobby(a, 'public');
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    const inv = (await invited(b.floor)).invite;
    await runInDurableObject(floor(), (f: CasinoFloor) => {
      f.presence.confine(b.id, LOTS.jail);
    });
    b.floor.send({ t: 'invite.take', id: inv.id, x: 0, z: 0, r: 0 });
    expect(await joined(b.floor)).toMatchObject({ t: 'invite.no', code: 'NOT_ELIGIBLE' });
    expect(b.floor.msgs.some((m) => m.t === 'tp')).toBe(false);
  });

  it('puts the invitee next to the inviter when asked for somewhere far from them', async () => {
    const a = await player('farA');
    const b = await player('farB');
    const t = await lobby(a, 'public');
    a.floor.send({ t: 'st', x: 400, z: -300, r: 0 });
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    const inv = (await invited(b.floor)).invite;
    const host = await runInDurableObject(floor(), (f: CasinoFloor) => f.presence.positionOf(a.id));
    b.floor.send({ t: 'invite.take', id: inv.id, x: -2500, z: 1000, r: 10 });
    const go = await joined(b.floor);
    expect([go.x, go.z]).toEqual([host!.x, host!.z]);
    // near the inviter, it's where they asked
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    await answer(a.floor);
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 60_000); // past the pair limit
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    const again = (await invited(b.floor)).invite;
    b.floor.send({ t: 'invite.take', id: again.id, x: host!.x + 300, z: host!.z, r: 10 });
    const go2 = await joined(b.floor);
    expect([go2.x, go2.z]).toEqual([host!.x + 300, host!.z]);
  });

  it('invites everyone else on the floor, once in a while per player and per table', async () => {
    const a = await player('allA');
    const b = await player('allB');
    const c = await player('allC');
    const t = await lobby(a, 'public');
    a.floor.send({ t: 'invite', table: t.tableId, to: 'all' });
    const sent = await answer(a.floor);
    expect(sent).toMatchObject({ t: 'invite.sent', all: true, skipped: [] });
    expect(sent.sent).toBeGreaterThanOrEqual(2);
    expect(sent.again - Date.now()).toBeGreaterThan(EVERYONE_MS - 5000);
    expect((await invited(b.floor)).invite.all).toBe(true);
    expect((await invited(c.floor)).invite.all).toBe(true);
    await nothing(a.floor, 'invited');

    a.floor.send({ t: 'invite', table: t.tableId, to: 'all' });
    const no = await answer(a.floor);
    expect(no).toMatchObject({ t: 'invite.no', code: 'RATE_LIMITED' });
    expect(no.again).toBe(sent.again);
    // the table's turn is used up too: another player there can't invite everyone again yet
    await enter(b, t.tableId);
    b.floor.send({ t: 'invite', table: t.tableId, to: 'all' });
    expect(await answer(b.floor)).toMatchObject({ t: 'invite.no', code: 'RATE_LIMITED' });
    // by name still works
    const d = await player('allD');
    a.floor.send({ t: 'invite', table: t.tableId, to: [d.id] });
    expect(await answer(a.floor)).toMatchObject({ t: 'invite.sent', sent: 1 });

    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(sent.again + 1);
    a.floor.send({ t: 'here' });
    c.floor.send({ t: 'here' });
    a.floor.send({ t: 'invite', table: t.tableId, to: 'all' });
    expect(await answer(a.floor)).toMatchObject({ t: 'invite.sent', all: true });
  });

  it('skips players who are offline, away, not taking invites, or were just asked', async () => {
    const a = await player('skA');
    const b = await player('skB');
    const c = await player('skC');
    const gone = await player('skGone');
    gone.floor.ws.close(1000, 'bye');
    await new Promise((r) => setTimeout(r, 50));
    const t = await lobby(a, 'public');

    c.floor.send({ t: 'invite.dnd', on: true });
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id, c.id, gone.id] });
    const sent = await answer(a.floor);
    expect(sent.sent).toBe(1);
    expect(sent.skipped).toEqual(
      expect.arrayContaining([
        { id: c.id, name: c.name, why: 'dnd' },
        { id: gone.id, name: '', why: 'offline' },
      ]),
    );
    await nothing(c.floor, 'invited');
    // asked a moment ago
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    expect((await answer(a.floor)).skipped).toEqual([{ id: b.id, name: b.name, why: 'recent' }]);
    // do not disturb off again
    c.floor.send({ t: 'invite.dnd', on: false });
    a.floor.send({ t: 'invite', table: t.tableId, to: [c.id] });
    expect(await answer(a.floor)).toMatchObject({ sent: 1, skipped: [] });

    // away: nothing from b for AWAY_MS (a keeps busy)
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + AWAY_MS + 1000);
    a.floor.send({ t: 'here' });
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    expect((await answer(a.floor)).skipped).toEqual([{ id: b.id, name: b.name, why: 'away' }]);
    b.floor.send({ t: 'here' });
    await new Promise((r) => setTimeout(r, 30));
    a.floor.send({ t: 'invite', table: t.tableId, to: [b.id] });
    expect(await answer(a.floor)).toMatchObject({ sent: 1, skipped: [] });
  });

  it('limits what one player sends, and what one player receives', async () => {
    const a = await player('rlA');
    const t = await lobby(a, 'public');
    const others = await Promise.all(Array.from({ length: SEND_LIMITS[0]![0] + 2 }, (_, i) => player(`rl${i}`)));
    for (let i = 0; i < SEND_LIMITS[0]![0]; i++) {
      a.floor.send({ t: 'invite', table: t.tableId, to: [others[i]!.id] });
      expect(await answer(a.floor)).toMatchObject({ t: 'invite.sent', sent: 1 });
    }
    a.floor.send({ t: 'invite', table: t.tableId, to: [others.at(-1)!.id] });
    const no = await answer(a.floor);
    expect(no).toMatchObject({ t: 'invite.no', code: 'RATE_LIMITED' });
    expect(no.again).toBeGreaterThan(Date.now());

    // one receiver, many senders: past TARGET_PER_MIN a minute they're busy
    const target = others.at(-1)!;
    const senders = others.slice(0, TARGET_PER_MIN + 1);
    const tables = await Promise.all(senders.map((s) => lobby(s, 'public')));
    const results: any[] = [];
    for (let i = 0; i < senders.length; i++) {
      senders[i]!.floor.send({ t: 'invite', table: tables[i]!.tableId, to: [target.id] });
      results.push(await answer(senders[i]!.floor));
    }
    expect(results.slice(0, TARGET_PER_MIN).every((r) => r.sent === 1)).toBe(true);
    expect(results.at(-1)).toMatchObject({ sent: 0, skipped: [{ id: target.id, why: 'busy' }] });
  });
});
