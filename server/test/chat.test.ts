// Chat end to end: the floor's room and lobby tables' rooms. What a line may be (cleaned, masked,
// signed by the server), the limits (a burst of three, then one a second; strikes earn a mute
// that outlasts a reconnect and hibernation), the backlog a newcomer gets, and which room hears
// what: a table's room is its members' alone.
//
// Special characters are built with fromCharCode so none of them sits in this file invisibly.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { ORIGIN, connect, type Client } from './helpers.ts';
import type { CasinoFloor } from '../src/floor/index.ts';
import type { CasinoTable } from '../src/table/host.ts';
import { CHAT_BURST, FLOOD, MUTE_MS, STRIKES, maskWords } from '../src/floor/chat.ts';
import { CHAT_HISTORY, CHAT_MAX, type ChatLine } from '../../shared/src/protocol.ts';

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Player {
  id: number;
  name: string;
  token: string;
}

let seq = 0;

async function player(tag: string): Promise<Player> {
  seq++;
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': `198.51.100.${seq}` },
      body: JSON.stringify({ name: `ch${tag}${seq}` }),
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

/** A floor socket, past its hello and the room's backlog. */
async function onFloor(p: Player): Promise<{ c: Client; backlog: ChatLine[] }> {
  const { client } = await connect('floor', p.token);
  const c = client!;
  await c.next((m) => m.t === 'hello');
  const log = await c.next<any>((m) => m.t === 'chat');
  expect(log.backlog).toBe(true);
  return { c, backlog: log.lines };
}

/** What POST /tables does (High Card: a real multiplayer engine the HTTP route refuses). */
async function makeLobby(creator: Player, visibility: 'public' | 'private'): Promise<{ tableId: string; pin: string | null }> {
  const made = await floor().createLobby({ game: 'highcard', visibility, accountId: creator.id, ip: `203.0.113.${++seq % 250}` });
  if ('error' in made) throw new Error(`createLobby refused: ${made.error}`);
  await table(made.tableId).init({ name: made.tableId, game: 'highcard', variant: '', mode: 'multi', visibility, pin: made.pin });
  return made;
}

/** A table socket, past the snapshot and the room's backlog. */
async function atTable(p: Player, tableId: string, pin?: string | null): Promise<{ c: Client; backlog: ChatLine[] }> {
  const { client } = await connect(`table/${tableId}`, p.token, pin ? `&pin=${pin}` : '');
  const c = client!;
  await c.next((m) => m.t === 'table');
  const log = await c.next<any>((m) => m.t === 'chat');
  expect(log.backlog).toBe(true);
  return { c, backlog: log.lines };
}

/** Every line a socket has heard since joining (not its backlog), in order. */
const linesIn = (c: Client) => c.msgs.filter((m) => m.t === 'chat' && !m.backlog).flatMap((m) => m.lines as ChatLine[]);
const textsIn = (c: Client) => linesIn(c).map((l) => l.text);
const noticesIn = (c: Client) => c.msgs.filter((m) => m.t === 'chat.no').map((m) => m.code as string);
const notice = (c: Client) => c.next<any>((m) => m.t === 'chat.no');

/** Wait until `c` has heard a line saying `text`, leaving it in place for later checks. */
async function heard(c: Client, text: string, ms = 3000): Promise<ChatLine> {
  for (let waited = 0; waited < ms; waited += 10) {
    const line = linesIn(c).find((l) => l.text === text);
    if (line) return line;
    await sleep(10);
  }
  throw new Error(`never heard "${text.slice(0, 40)}"; heard ${JSON.stringify(textsIn(c))}`);
}

async function closedWith(c: Client, ms = 1500): Promise<{ code: number; reason: string }> {
  for (let waited = 0; waited < ms; waited += 10) {
    if (c.closed) return c.closed;
    await sleep(10);
  }
  throw new Error('socket stayed open');
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------

describe('what a line may be', () => {
  it('is cleaned, signed with the account behind the token, and sent to everyone on the floor', async () => {
    const a = await player('val');
    const b = await player('val');
    const fa = await onFloor(a);
    const fb = await onFloor(b);
    // A client can't pick the name or id a line goes out under: extra keys are dropped.
    fa.c.send({ t: 'say', text: `  hi${ch(0)} there${ch(7)}\n\n\tfriend${ch(0x202e)}  `, name: 'the_dealer', id: b.id });
    const line = await heard(fb.c, 'hi there friend');
    expect(line).toMatchObject({ id: a.id, name: a.name, text: 'hi there friend' });
    expect(typeof line.n).toBe('number');
    expect(textsIn(fb.c)).toEqual(['hi there friend']);
    // The sender hears it too, as the same line.
    expect(await heard(fa.c, 'hi there friend')).toEqual(line);
    fa.c.ws.close();
    fb.c.ws.close();
  });

  it('is 1 to 200 characters once cleaned; anything else is refused to the sender alone', async () => {
    const a = await player('len');
    const b = await player('len');
    const fa = await onFloor(a);
    const fb = await onFloor(b);
    fa.c.send({ t: 'say', text: 'x'.repeat(CHAT_MAX + 1) });
    expect(await notice(fa.c)).toMatchObject({ code: 'BAD_REQUEST' });
    fa.c.send({ t: 'say', text: ` \n\t${ch(0x200b, 0x202e, 0)} ` });
    expect(await notice(fa.c)).toMatchObject({ code: 'BAD_REQUEST' });
    // Not a string: not a say at all, so no reply (like any malformed frame).
    fa.c.send({ t: 'say', text: 42 });
    await sleep(1_100);
    fa.c.send({ t: 'say', text: 'x'.repeat(CHAT_MAX) });
    await heard(fb.c, 'x'.repeat(CHAT_MAX));
    expect(noticesIn(fa.c)).toEqual([]);
    expect(textsIn(fb.c)).toEqual(['x'.repeat(CHAT_MAX)]);
    fa.c.ws.close();
    fb.c.ws.close();
  });

  it('has a short list of words masked, and innocent words that contain them left alone', async () => {
    const a = await player('mask');
    const fa = await onFloor(a);
    // Masked letter for letter, stretched or not.
    fa.c.send({ t: 'say', text: 'what the FUUUCK, sh1t happens' });
    await heard(fa.c, 'what the F*****, s*** happens');
    fa.c.ws.close();

    expect(maskWords('motherfucker')).toBe('motherf***er');
    expect(maskWords('you a$$hole')).toBe('you a******');
    expect(maskWords('Dickhead!')).toBe('D*******!');
    expect(maskWords('bitches and bullshit')).toBe('b****es and b*******');
    expect(maskWords('asssss')).toBe('a*****');
    // Whole words only for most: the class assassin from Scunthorpe ordered a spicy cocktail. And
    // exactly two of a letter is a spelling, not a stretch (the rest came up in a dictionary run).
    for (const fine of ['class', 'assassin', 'Scunthorpe', 'spicy', 'cocktail', 'Dickens', 'passing', 'snigger', 'Shiite', 'shiitake', 'Cushite', 'brushite', 'shittah', 'Washita', 'hello']) {
      expect(maskWords(fine)).toBe(fine);
    }
    expect(maskWords('nice hand, well played')).toBe('nice hand, well played');
  });
});

describe('limits', () => {
  it('lets three through in a burst, refuses the rest, then one a second', async () => {
    const a = await player('burst');
    const b = await player('burst');
    const fa = await onFloor(a);
    const fb = await onFloor(b);
    for (let i = 0; i < 5; i++) fa.c.send({ t: 'say', text: `burst ${i}` });
    await heard(fb.c, 'burst 2');
    await sleep(300);
    expect(textsIn(fb.c)).toEqual(['burst 0', 'burst 1', 'burst 2']);
    // The refusals go to the sender alone.
    expect(noticesIn(fa.c)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
    expect(noticesIn(fb.c)).toEqual([]);

    await sleep(1_050);
    fa.c.send({ t: 'say', text: 'a second later' });
    fa.c.send({ t: 'say', text: 'too soon again' });
    await heard(fb.c, 'a second later');
    await sleep(200);
    expect(textsIn(fb.c)).toEqual(['burst 0', 'burst 1', 'burst 2', 'a second later']);
    expect(noticesIn(fa.c)).toEqual(['RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED']);
    expect(fa.c.closed).toBeNull();
    fa.c.ws.close();
    fb.c.ws.close();
  });

  it('mutes after repeated strikes; the mute outlasts a reconnect and hibernation, then ends', async () => {
    const a = await player('mute');
    const b = await player('mute');
    const fa = await onFloor(a);
    const fb = await onFloor(b);
    for (let i = 0; i < CHAT_BURST + STRIKES; i++) fa.c.send({ t: 'say', text: `spam ${i}` });
    const muted = await fa.c.next<any>((m) => m.t === 'chat.no' && m.code === 'MUTED');
    expect(muted.until - muted.now).toBe(MUTE_MS);
    expect(noticesIn(fa.c)).toEqual(['RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED']);
    await sleep(200);
    expect(textsIn(fb.c)).toEqual(['spam 0', 'spam 1', 'spam 2']);

    // A fresh socket for the same account is still muted, even with a full bucket's worth of time.
    fa.c.ws.close();
    await sleep(1_100);
    const again = await onFloor(a);
    again.c.send({ t: 'say', text: 'new tab, same mouth' });
    expect(await notice(again.c)).toMatchObject({ code: 'MUTED', until: muted.until });

    // And after the floor has slept.
    again.c.ws.close();
    await evictDurableObject(floor());
    const woke = await onFloor(a);
    woke.c.send({ t: 'say', text: 'after a nap' });
    expect(await notice(woke.c)).toMatchObject({ code: 'MUTED', until: muted.until });

    // Once the minute is up, lines go out again (fb slept through it and still hears them).
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(muted.until + 1_000);
    woke.c.send({ t: 'say', text: 'reformed' });
    await heard(fb.c, 'reformed');
    woke.c.ws.close();
    fb.c.ws.close();
  });

  it('closes the socket of a client that keeps sending while muted', async () => {
    const a = await player('flood');
    const fa = await onFloor(a);
    for (let i = 0; i < CHAT_BURST + STRIKES; i++) fa.c.send({ t: 'say', text: `spam ${i}` });
    await fa.c.next((m) => m.t === 'chat.no' && m.code === 'MUTED');
    for (let i = 0; i <= FLOOD; i++) fa.c.send({ t: 'say', text: `still ${i}` });
    expect((await closedWith(fa.c)).code).toBe(4008);
  });
});

describe('the backlog', () => {
  it('a newcomer gets the last 30 lines, oldest first, and they survive hibernation', async () => {
    // Filled straight into the room (36 lines from 12 speakers), past the per-account limit.
    await runInDurableObject(floor(), (f: CasinoFloor) => {
      for (let i = 0; i < 36; i++) f.chat.room.say({ id: 7_000_000 + Math.floor(i / 3), name: `filler${Math.floor(i / 3)}` }, `backlog ${i}`);
    });
    const a = await player('late');
    const first = await onFloor(a);
    expect(first.backlog).toHaveLength(CHAT_HISTORY);
    expect(first.backlog.map((l) => l.text)).toEqual(Array.from({ length: 30 }, (_, i) => `backlog ${i + 6}`));
    expect(first.backlog.at(-1)).toMatchObject({ id: 7_000_011, name: 'filler11' });
    const ns = first.backlog.map((l) => l.n);
    expect(ns).toEqual([...ns].sort((x, y) => x - y));
    expect(new Set(ns).size).toBe(ns.length);
    first.c.ws.close();

    await evictDurableObject(floor());
    const again = await onFloor(a);
    expect(again.backlog).toEqual(first.backlog);
    again.c.ws.close();
  });
});

describe('table rooms', () => {
  it("are their members' alone: another table, the floor and outsiders hear nothing", async () => {
    const a = await player('ta');
    const b = await player('tb');
    const c = await player('tc');
    const d = await player('td');
    const one = await makeLobby(a, 'private');
    const two = await makeLobby(c, 'public');
    const ta = await atTable(a, one.tableId, one.pin);
    const tb = await atTable(b, one.tableId, one.pin);
    const tc = await atTable(c, two.tableId);
    const fd = await onFloor(d);

    ta.c.send({ t: 'say', text: 'table one only' });
    expect(await heard(tb.c, 'table one only')).toMatchObject({ id: a.id, name: a.name });
    await heard(ta.c, 'table one only');
    tc.c.send({ t: 'say', text: 'table two only' });
    await heard(tc.c, 'table two only');
    fd.c.send({ t: 'say', text: 'the floor only' });
    await heard(fd.c, 'the floor only');
    await sleep(200);
    expect(textsIn(ta.c)).toEqual(['table one only']);
    expect(textsIn(tb.c)).toEqual(['table one only']);
    expect(textsIn(tc.c)).toEqual(['table two only']);
    expect(textsIn(fd.c)).toEqual(['the floor only']);

    // Without the PIN there is no way in, so no backlog either.
    const { client: outsider } = await connect(`table/${one.tableId}`, d.token);
    expect((await closedWith(outsider!)).code).toBe(4005);
    expect(outsider!.msgs.filter((m) => m.t === 'chat')).toEqual([]);

    // Whoever joins later (with the PIN) gets the room's backlog.
    const late = await atTable(d, one.tableId, one.pin);
    expect(late.backlog.map((l) => l.text)).toEqual(['table one only']);
    for (const x of [ta, tb, tc, fd, late]) x.c.ws.close();
  });

  it('stop reaching a player who left, and a socket that is no longer a member can post nothing', async () => {
    const a = await player('la');
    const b = await player('lb');
    const lobby = await makeLobby(a, 'public');
    const ta = await atTable(a, lobby.tableId);
    const tb = await atTable(b, lobby.tableId);
    tb.c.send({ t: 'leave' });
    await closedWith(tb.c);
    ta.c.send({ t: 'say', text: 'after b left' });
    await heard(ta.c, 'after b left');
    expect(linesIn(tb.c)).toEqual([]);

    // A socket still open for an account the table no longer counts as a member (a race with
    // leaving): its lines go nowhere and it hears no one.
    const tb2 = await atTable(b, lobby.tableId);
    await runInDurableObject(table(lobby.tableId), (t: CasinoTable) => {
      (t as unknown as { members: Map<number, unknown> }).members.delete(b.id);
    });
    tb2.c.send({ t: 'say', text: 'ghost line' });
    ta.c.send({ t: 'say', text: 'members only' });
    await heard(ta.c, 'members only');
    await sleep(200);
    expect(textsIn(ta.c)).toEqual(['after b left', 'members only']);
    expect(linesIn(tb2.c)).toEqual([]);
    expect(noticesIn(tb2.c)).toEqual([]);
    ta.c.ws.close();
    tb2.c.ws.close();
  });

  it('keep their backlog through a restart of the table', async () => {
    const a = await player('ra');
    const lobby = await makeLobby(a, 'public');
    const ta = await atTable(a, lobby.tableId);
    ta.c.send({ t: 'say', text: 'before the restart' });
    await heard(ta.c, 'before the restart');
    await evictDurableObject(table(lobby.tableId), { webSockets: 'close' });
    const again = await atTable(a, lobby.tableId);
    expect(again.backlog.map((l) => l.text)).toEqual(['before the restart']);
    again.c.ws.close();
  });

  it("don't exist at solo tables", async () => {
    const a = await player('solo');
    const { client } = await connect('solo/highcard', a.token);
    const c = client!;
    await c.next((m) => m.t === 'table');
    c.send({ t: 'say', text: 'anyone here?' });
    await sleep(300);
    expect(c.msgs.filter((m) => m.t === 'chat' || m.t === 'chat.no')).toEqual([]);
    c.ws.close();
  });
});
