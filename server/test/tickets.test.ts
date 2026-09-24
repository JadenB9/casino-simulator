// Socket tickets (server/src/tickets.ts): a WebSocket opens with a single-use ticket for exactly
// its path, made from the token a minute before at most; the token itself never goes in a URL.

import { describe, expect, it } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import { ORIGIN, api, connectRaw, ticketFor, type Client } from './helpers.ts';
import { closedWith, makeLobby, player, table } from './party.ts';
import { TICKET_MS, signTicket } from '../src/tickets.ts';
import { CLOSE } from '../../shared/src/protocol.ts';

const withTicket = (ticket: string) => `&ticket=${encodeURIComponent(ticket)}`;

/** Open a socket with this ticket; resolves once it has either spoken or closed. */
async function open(path: string, ticket: string, first: string, ip?: string): Promise<Client> {
  const { client } = await connectRaw(path, withTicket(ticket), ip);
  const c = client!;
  for (let i = 0; i < 150 && !c.closed && !c.msgs.some((m) => m.t === first); i++) await new Promise((r) => setTimeout(r, 10));
  return c;
}

const newTicket = async (path: string, p: { token: string; ip: string }) => (await ticketFor(path, p.token, p.ip))!;

describe('getting a ticket', () => {
  it('takes the token and names the one socket path it opens, for a minute', async () => {
    const p = await player('tkget');
    const t0 = Date.now();
    const res = await api('ticket', p.token, { method: 'POST', body: JSON.stringify({ target: 'floor' }) });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.ticket).toMatch(/^k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.exp).toBeGreaterThanOrEqual(t0 + TICKET_MS);
    expect(body.exp).toBeLessThanOrEqual(Date.now() + TICKET_MS);
    for (const target of ['lobby', 'table/xyz', 'table/bj-SHOUTING01', 'solo/nope', '../floor', 'floor/x', 'solo/blackjack/x', 'x'.repeat(100), 7, null]) {
      const bad = await api('ticket', p.token, { method: 'POST', body: JSON.stringify({ target }) });
      expect(bad.status, String(target)).toBe(400);
    }
    const anon = await exports.default.fetch(
      new Request('http://casino.test/casino/api/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: '{"target":"floor"}' }),
    );
    expect(anon.status).toBe(401);
  });

  it('a burst of tickets past the limit is refused', async () => {
    const p = await player('tkburst');
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await api('ticket', p.token, { method: 'POST', body: JSON.stringify({ target: 'floor' }) })).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('a ticket is not a token, and a token is not a ticket', async () => {
    const p = await player('tkdomain');
    const ticket = await newTicket('floor', p);
    expect((await api('me', ticket)).status).toBe(401);
    const c = await open('floor', p.token, 'hello', p.ip);
    expect((await closedWith(c)).code).toBe(CLOSE.TICKET);
  });
});

describe('opening a socket', () => {
  it('opens once: the same ticket again is refused, on the floor and at a table', async () => {
    const p = await player('tkonce');
    const floorTicket = await newTicket('floor', p);
    const first = await open('floor', floorTicket, 'hello', p.ip);
    expect(first.msgs.some((m) => m.t === 'hello')).toBe(true);
    const again = await open('floor', floorTicket, 'hello', p.ip);
    expect(await closedWith(again)).toEqual({ code: CLOSE.TICKET, reason: 'ticket used' });
    expect(again.msgs.some((m) => m.t === 'hello')).toBe(false);

    const soloTicket = await newTicket('solo/highcard', p);
    const seat = await open('solo/highcard', soloTicket, 'table', p.ip);
    expect(seat.msgs.some((m) => m.t === 'table')).toBe(true);
    const replay = await open('solo/highcard', soloTicket, 'table', p.ip);
    expect(await closedWith(replay)).toEqual({ code: CLOSE.TICKET, reason: 'ticket used' });
  });

  it('a spent ticket stays spent through a restart of the object it opened', async () => {
    const p = await player('tkrestart');
    const made = await makeLobby(p, 'highcard');
    const path = `table/${made.tableId}`;
    const ticket = await newTicket(path, p);
    const c = await open(path, ticket, 'table', p.ip);
    expect(c.msgs.some((m) => m.t === 'table')).toBe(true);
    await evictDurableObject(table(made.tableId), { webSockets: 'close' });
    const replay = await open(path, ticket, 'table', p.ip);
    expect((await closedWith(replay)).code).toBe(CLOSE.TICKET);
  });

  it('an expired ticket is refused, and one just inside its minute is not', async () => {
    const p = await player('tkexp');
    const stale = (await signTicket(env.CASINO_TOKEN_SECRET, p.id, 'floor', Date.now() - TICKET_MS - 1_000)).ticket;
    expect((await closedWith(await open('floor', stale, 'hello', p.ip))).code).toBe(CLOSE.TICKET);
    const fresh = (await signTicket(env.CASINO_TOKEN_SECRET, p.id, 'floor', Date.now() - TICKET_MS + 5_000)).ticket;
    const c = await open('floor', fresh, 'hello', p.ip);
    expect(c.msgs.some((m) => m.t === 'hello')).toBe(true);
  });

  it('a ticket opens only the path it was made for', async () => {
    const p = await player('tkpath');
    const a = await makeLobby(p, 'highcard');
    const b = await makeLobby(p, 'highcard');
    const cases: [made: string, used: string][] = [
      ['floor', 'solo/highcard'],
      ['solo/highcard', 'floor'],
      ['solo/highcard', 'solo/blackjack'],
      [`table/${a.tableId}`, `table/${b.tableId}`],
      [`table/${a.tableId}`, 'floor'],
    ];
    for (const [made, used] of cases) {
      const ticket = await newTicket(made, p);
      const c = await open(used, ticket, used === 'floor' ? 'hello' : 'table', p.ip);
      expect((await closedWith(c)).code, `${made} -> ${used}`).toBe(CLOSE.TICKET);
    }
  });

  it("speaks only for its own account: a changed account is refused, a gone one too, and a ticket's seat is its account's", async () => {
    const a = await player('tkacct');
    const b = await player('tkacct');
    // Someone rewrites the account in a ticket they hold: the signature no longer matches.
    const [prefix, payload, sig] = (await newTicket('solo/highcard', a)).split('.');
    const claims = JSON.parse(atob(payload!.replace(/-/g, '+').replace(/_/g, '/')));
    const forged = btoa(JSON.stringify({ ...claims, a: b.id })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect((await closedWith(await open('solo/highcard', `${prefix}.${forged}.${sig}`, 'table', a.ip))).code).toBe(CLOSE.TICKET);
    // A genuine ticket for an account that doesn't exist.
    const ghost = (await signTicket(env.CASINO_TOKEN_SECRET, 987_654_322, 'floor', Date.now())).ticket;
    expect((await closedWith(await open('floor', ghost, 'hello', a.ip))).code).toBe(CLOSE.UNAUTHORIZED);
    // A's ticket for a solo game opens A's own table, whoever sends it.
    const mine = await open('solo/highcard', await newTicket('solo/highcard', a), 'table', b.ip);
    const snap = mine.msgs.find((m) => m.t === 'table');
    expect(snap.you.accountId).toBe(a.id);
    expect(snap.meta.tableId).toBe(`solo:highcard:-:${a.id}`);
  });

  it('an old page that still sends its token is told to reload; a socket with nothing is sent to log in', async () => {
    const p = await player('tkold');
    const old = await connectRaw('floor', `&t=${encodeURIComponent(p.token)}`, p.ip);
    expect(await closedWith(old.client!)).toEqual({ code: CLOSE.VERSION, reason: 'please reload' });
    const none = await connectRaw('floor', '', p.ip);
    expect(await closedWith(none.client!)).toEqual({ code: CLOSE.UNAUTHORIZED, reason: 'log in again' });
  });
});
