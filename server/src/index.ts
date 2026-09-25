// The gateway Worker (api.j4den.com/casino/*). It holds no game state: it checks the Origin,
// verifies tokens, answers the account HTTP API, and forwards WebSocket upgrades to the right
// Durable Object with headers only it can set.

import { CLOSE, PROTOCOL_VERSION, type CreateTableResponse, type JoinByPinResponse, type LoanResponse, type LoginResponse, type MeResponse, type TicketResponse } from '../../shared/src/protocol.ts';
import { isValidName } from '../../shared/src/names.ts';
import { PASSWORD_MAX, PASSWORD_MIN, isValidPassword } from '../../shared/src/password.ts';
import { parseLook, lookFromJson } from '../../shared/src/look.ts';
import { CATALOG, isGameId, soloTableName, TABLE_ID_RE, variantOf } from '../../shared/src/games/catalog.ts';
import { clampLimits, limitsParam, parseLimits, parseLimitsParam } from '../../shared/src/limits.ts';
import { notYet } from '../../shared/src/bank.ts';
import { closeWith, corsHeaders, fail, json, originAllowed, readJson } from './http.ts';
import { bearer, logIn, signToken, verifyToken } from './auth.ts';
import { signTicket, ticketTarget, verifyTicket } from './tickets.ts';
import { KeyedBuckets } from './ratelimit.ts';
import { bumpRate, escrowsOf, getAccount, loadProfile, ownedOf, setLook } from './db.ts';
import { isFreeEmote, emoteItem } from '../../shared/src/items.ts';
import { takeLoan } from './transfer.ts';
import { shopApi } from './shop.ts';
import { leaderboard } from './leaderboard.ts';
import { ipKey } from './floor/directory.ts';
import type { CasinoFloor } from './floor/index.ts';
import { jailOf } from './law.ts'; // v6 law6
import { isJailGame, jailLimits, jailTableName } from '../../shared/src/law/rules.ts'; // v6 law6
import type { CasinoTable } from './table/host.ts';

export { CasinoFloor } from './floor/index.ts';
export { CasinoTable } from './table/host.ts';

const PREFIX = '/casino';
/** An escrow older than this gets its table asked to reconcile before a profile (the bank asks every table). */
const STALE_ESCROW_MS = 120_000;
const STATION_RE = /^[a-z0-9-]{1,24}$/;
/**
 * Socket tickets per account: plenty for reconnecting everything a page has open, never a flood.
 * Kept per isolate: a burst from one client lands on one, and the objects limit connects anyway.
 */
const ticketLimits = new KeyedBuckets(30, 1);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);
    if (!url.pathname.startsWith(PREFIX + '/')) return fail(404, 'NOT_FOUND', 'Not here.', cors);
    const path = url.pathname.slice(PREFIX.length);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (path === '/api/health') return json({ ok: true, v: PROTOCOL_VERSION }, 200, cors);

    if (path.startsWith('/ws/')) {
      try {
        return await handleSocket(request, env, url, path.slice(4), origin);
      } catch (err) {
        // A transient code, so the client reconnects with backoff; the reason says nothing inside.
        console.error('socket routing failed', path, err);
        return closeWith(1011, 'try again');
      }
    }
    if (path.startsWith('/api/')) {
      // Browsers always send Origin on these (they're cross-origin POST/PUT or credentialed GET);
      // refusing unknown origins keeps other sites from driving the API from a visitor's browser.
      if (origin && !originAllowed(origin, env.ALLOWED_ORIGINS)) return fail(403, 'UNAUTHORIZED', 'Origin not allowed.');
      try {
        return await handleApi(request, env, path.slice(5), cors);
      } catch (err) {
        console.error('api error', path, err);
        return fail(500, 'INTERNAL', 'Something went wrong.', cors);
      }
    }
    return fail(404, 'NOT_FOUND', 'Not here.', cors);
  },
} satisfies ExportedHandler<Env>;

// --------------------------------------------------------------------------------------------
// HTTP API

async function handleApi(request: Request, env: Env, route: string, cors: Record<string, string>): Promise<Response> {
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  // Limits count per address, and per /64 for IPv6: one user can take a fresh address from their
  // /64 for every request, which would make a per-address limit on sign-ups no limit at all.
  const addr = ipKey(ip);

  if (route === 'login' && request.method === 'POST') {
    if (!(await bumpRate(env.DB, 'casino-login', addr, 30, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Too many logins. Try again in a minute.', cors);
    const body = (await readJson(request)) as { name?: unknown; password?: unknown } | null;
    const name = body?.name;
    if (!isValidName(name)) return fail(400, 'BAD_NAME', 'Names are 3-16 letters, numbers or _.', cors);
    const password = body?.password;
    if (!isValidPassword(password)) return fail(400, 'BAD_REQUEST', `Passwords are ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`, cors);
    const r = await logIn(env.DB, name, password, addr, now);
    if (!r.ok) {
      // One message for a wrong password whichever part was wrong, and nothing about the account.
      if (r.why === 'wrong') return fail(401, 'UNAUTHORIZED', 'Wrong name or password.', cors);
      if (r.why === 'locked') return fail(429, 'RATE_LIMITED', 'Too many tries. Wait a few minutes and try again.', cors);
      return fail(429, 'RATE_LIMITED', 'Too many new accounts from here. Try again later.', cors);
    }
    const token = await signToken(env.CASINO_TOKEN_SECRET, r.account.id, r.account.name, now);
    const profile = await loadProfile(env.DB, r.account.id);
    return json({ token, profile: profile! } satisfies LoginResponse, 200, cors);
  }

  const claims = await verifyToken(env.CASINO_TOKEN_SECRET, bearer(request), now);
  if (!claims) return fail(401, 'UNAUTHORIZED', 'Log in again.', cors);

  if (route === 'me' && request.method === 'GET') {
    const stacks = await reconcileStale(env, claims.a, now);
    const profile = await loadProfile(env.DB, claims.a, stacks);
    if (!profile) return fail(401, 'UNAUTHORIZED', 'That account is gone.', cors);
    return json({ profile } satisfies MeResponse, 200, cors);
  }

  // Names and numbers only; the boards are kept for a minute (see leaderboard.ts).
  if (route === 'leaderboard' && request.method === 'GET') {
    return json(await leaderboard(env.DB, { id: claims.a, name: claims.n }, now), 200, cors);
  }

  if (route === 'me/look' && request.method === 'PUT') {
    // Each change is a D1 write and a message to everyone on the floor.
    if (!(await bumpRate(env.DB, 'casino-look', `a${claims.a}`, 20, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
    const look = parseLook((await readJson(request, 1024) as { look?: unknown } | null)?.look);
    if (!look) return fail(400, 'BAD_REQUEST', "That look isn't valid.", cors);
    const stored = await setLook(env.DB, claims.a, look, now);
    if ('error' in stored) return fail(403, 'NOT_ELIGIBLE', stored.error, cors);
    try {
      await floor(env).playerLook(claims.a, stored.look);
    } catch (err) {
      console.error('floor look update failed', err);
    }
    return json({ look: stored.look }, 200, cors);
  }

  // The cashier: under $10,000 in all, chips on tables included, a top-up to $50,000.
  if (route === 'bank/loan' && request.method === 'POST') {
    // Each ask calls every table holding an escrow of yours, so it has a limit of its own.
    if (!(await bumpRate(env.DB, 'casino-loan', `a${claims.a}`, 10, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
    const counted = await chipsOnTables(env, claims.a);
    if (!counted) return fail(409, 'BUSY', STILL_MOVING, cors);
    const loan = await takeLoan(env.DB, { opId: `loan:${claims.a}:${crypto.randomUUID()}`, accountId: claims.a, chips: counted.chips, inPlay: counted.inPlay, now });
    const profile = await loadProfile(env.DB, claims.a, counted.stacks);
    if (!profile) return fail(401, 'UNAUTHORIZED', 'That account is gone.', cors);
    if (!loan.granted) {
      // A buy-in or cash-out landed between the count and the loan: the count is stale.
      if (profile.inPlay !== counted.inPlay) return fail(409, 'BUSY', STILL_MOVING, cors);
      return fail(409, 'NOT_ELIGIBLE', notYet(profile.balance + counted.chips, counted.chips), cors, {
        balance: profile.balance,
        inPlay: profile.inPlay,
      });
    }
    return json({ profile, loan: { amount: loan.amount!, at: now } } satisfies LoanResponse, 200, cors);
  }

  // v6 law6: an inmate plays only the jail's own tables (see handleSocket)
  if ((route === 'tables' || route === 'tables/join') && request.method === 'POST' && (await jailOf(env.DB, claims.a))) {
    return fail(403, 'NOT_ELIGIBLE', IN_JAIL, cors);
  }

  if (route === 'tables' && request.method === 'POST') {
    const body = (await readJson(request)) as { game?: unknown; variant?: unknown; visibility?: unknown; limits?: unknown } | null;
    const game = body?.game;
    const visibility = body?.visibility === 'private' ? 'private' : 'public';
    if (!isGameId(game) || !CATALOG[game].multiplayer || CATALOG[game].dev) return fail(400, 'BAD_REQUEST', 'That game has no multiplayer tables.', cors);
    const variant = variantOf(game, body?.variant);
    // Limits that aren't two amounts are refused; amounts outside the game's rules move to the
    // nearest table it allows (shared/src/limits.ts), and the table's snapshot shows what it got.
    const asked = body?.limits === undefined ? null : parseLimits(body.limits);
    if (body?.limits !== undefined && !asked) return fail(400, 'BAD_REQUEST', 'Limits are a minimum and a maximum in cents.', cors);
    const limits = asked ? clampLimits(game, asked) : null;
    const made = await floor(env).createLobby({ game, visibility, accountId: claims.a, ip });
    if ('error' in made) return fail(429, 'RATE_LIMITED', 'Slow down a little.', cors);
    await table(env, made.tableId).init({ name: made.tableId, game, variant, mode: 'multi', visibility, pin: made.pin, limits });
    return json({ tableId: made.tableId, ...(made.pin ? { pin: made.pin } : {}) } satisfies CreateTableResponse, 201, cors);
  }

  if (route === 'tables/join' && request.method === 'POST') {
    const pin = (await readJson(request) as { pin?: unknown } | null)?.pin;
    if (typeof pin !== 'string') return fail(400, 'BAD_PIN', 'PINs are four digits.', cors);
    const found = await floor(env).joinByPin({ pin, accountId: claims.a, ip });
    if ('error' in found) {
      return found.error === 'RATE_LIMITED'
        ? fail(429, 'RATE_LIMITED', 'Too many tries. Wait a minute.', cors)
        : fail(404, 'BAD_PIN', 'No lobby has that PIN.', cors);
    }
    // What the table is, so the join can show its limits before sitting down.
    let lobby = null;
    try {
      lobby = await table(env, found.tableId).summary();
    } catch (err) {
      console.error('table summary failed', found.tableId, err);
    }
    return json({ tableId: found.tableId, game: found.game, ...(lobby ? { lobby } : {}) } satisfies JoinByPinResponse, 200, cors);
  }

  // A single-use ticket for one socket (tickets.ts): sockets never carry the token itself.
  if (route === 'ticket' && request.method === 'POST') {
    const target = ticketTarget(((await readJson(request, 256)) as { target?: unknown } | null)?.target);
    if (!target) return fail(400, 'BAD_REQUEST', "That isn't a place a socket goes.", cors);
    if (!ticketLimits.take(`a${claims.a}`)) return fail(429, 'RATE_LIMITED', 'Slow down a little.', cors);
    return json((await signTicket(env.CASINO_TOKEN_SECRET, claims.a, target, now)) satisfies TicketResponse, 200, cors);
  }

  // The boutique and the bar (shop.ts): paid from the balance, never from chips on tables.
  if (route === 'shop' || route.startsWith('shop/') || route.startsWith('bar/')) return shopApi(request, env, route, claims.a, cors);

  return fail(404, 'NOT_FOUND', 'Not here.', cors);
}

// v6 law6
const IN_JAIL = "You're in jail. Make bail at the jail's tables first.";

const STILL_MOVING = 'Chips are still moving at one of your tables. Try again in a moment.';

/**
 * What the bank counts on a player's tables. Every table holding one of their escrows is asked
 * (which also cashes out a seat past its grace and refunds an escrow its table lost track of),
 * and each seat counts at its stack plus the bets it has out, so chips put on the felt still
 * count. Null while chips are moving to or from any of those tables, or one doesn't answer:
 * the bank waits rather than guess. `inPlay` is D1's figure read with what's left, for the
 * loan to pin.
 */
async function chipsOnTables(env: Env, accountId: number): Promise<{ chips: number; inPlay: number; stacks: Map<string, number> } | null> {
  const reports = new Map<string, { stack?: number; live?: number; pending?: true }>();
  let unsure = false;
  await Promise.all(
    (await escrowsOf(env.DB, accountId)).map(async (e) => {
      try {
        reports.set(e.table_id, await table(env, e.table_id).reconcile(accountId));
      } catch (err) {
        console.error('reconcile failed', e.table_id, err);
        unsure = true;
      }
    }),
  );
  if (unsure) return null;
  const [acct, left] = await env.DB.batch<{ in_play?: number; table_id?: string }>([
    env.DB.prepare(`SELECT in_play FROM casino_accounts WHERE id = ?1`).bind(accountId),
    env.DB.prepare(`SELECT table_id FROM casino_escrow WHERE account_id = ?1`).bind(accountId),
  ]);
  let chips = 0;
  const stacks = new Map<string, number>();
  for (const { table_id } of left!.results) {
    const r = reports.get(table_id!);
    // Chips in flight, an escrow its table couldn't settle, or a table opened since we asked.
    if (!r || r.pending || r.stack === undefined) return null;
    chips += r.stack + (r.live ?? 0);
    stacks.set(table_id!, r.stack);
  }
  return { chips, inPlay: acct!.results[0]?.in_play ?? 0, stacks };
}

/**
 * Ask each table holding an escrow for this account that has been open a while to report or
 * resolve it. Returns the live stacks it learned, for the profile's "chips on tables".
 */
async function reconcileStale(env: Env, accountId: number, now: number): Promise<Map<string, number>> {
  const stacks = new Map<string, number>();
  const escrows = await escrowsOf(env.DB, accountId);
  await Promise.all(
    escrows
      .filter((e) => now - e.updated_at > STALE_ESCROW_MS)
      .map(async (e) => {
        try {
          const r = await table(env, e.table_id).reconcile(accountId);
          if (r.stack !== undefined) stacks.set(e.table_id, r.stack);
        } catch (err) {
          console.error('reconcile failed', e.table_id, err);
        }
      }),
  );
  return stacks;
}

// --------------------------------------------------------------------------------------------
// WebSockets

async function handleSocket(request: Request, env: Env, url: URL, route: string, origin: string | null): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
  // WebSocket upgrades aren't covered by CORS, so the Origin check is the only thing stopping
  // another site from opening a socket from a visitor's browser.
  if (!originAllowed(origin, env.ALLOWED_ORIGINS)) return new Response('forbidden origin', { status: 403 });
  if (Number(url.searchParams.get('v')) !== PROTOCOL_VERSION) return closeWith(CLOSE.VERSION, 'please reload');
  const now = Date.now();
  // A socket opens with a ticket for exactly this path (tickets.ts), never with the token. A page
  // from before tickets still puts its token here: it needs the new code, so it reloads.
  const raw = url.searchParams.get('ticket');
  if (!raw) return url.searchParams.has('t') ? closeWith(CLOSE.VERSION, 'please reload') : closeWith(CLOSE.UNAUTHORIZED, 'log in again');
  const ticket = await verifyTicket(env.CASINO_TOKEN_SECRET, raw, route, now);
  if (!ticket) return closeWith(CLOSE.TICKET, 'get a new ticket');
  const account = await getAccount(env.DB, ticket.a);
  if (!account) return closeWith(CLOSE.UNAUTHORIZED, 'account not found');

  const station = url.searchParams.get('station');
  const headers = trustedHeaders(request, ticket.a, account.name, account.look, station && STATION_RE.test(station) ? station : null);
  // The object behind this path spends the ticket, so it opens this one socket, once.
  headers.set('x-casino-ticket', ticket.j);
  headers.set('x-casino-ticket-exp', String(ticket.exp));

  if (route === 'floor') {
    // v6: the emotes this account may send besides the free six (the floor drops the rest)
    const owned = await ownedOf(env.DB, ticket.a);
    headers.set('x-casino-emotes', [...owned.items].filter((id) => emoteItem(id) && !isFreeEmote(id)).join(','));
    return floorStub(env).fetch(forward(request, headers));
  }

  // v6 law6: an inmate's only tables are the jail's: no lobby, no other game, and the jail's own
  // table (its name and limits set here) for the games it has
  const jail = route === 'floor' ? null : await jailOf(env.DB, ticket.a);

  const lobby = route.match(/^table\/([a-z0-9-]+)$/);
  if (lobby) {
    if (jail) return closeWith(CLOSE.FORBIDDEN, 'in jail');
    const id = lobby[1]!;
    if (!TABLE_ID_RE.test(id)) return closeWith(CLOSE.NOT_FOUND, 'no such table');
    headers.set('x-casino-table', id);
    // A private lobby checks this against its own PIN before letting a newcomer in.
    const pin = url.searchParams.get('pin');
    if (pin && /^\d{4}$/.test(pin)) headers.set('x-casino-pin', pin);
    return tableStub(env, id).fetch(forward(request, headers));
  }

  const solo = route.match(/^solo\/([a-z]+)$/);
  if (solo) {
    const game = solo[1];
    if (!isGameId(game)) return closeWith(CLOSE.NOT_FOUND, 'no such game');
    if (jail && !isJailGame(game)) return closeWith(CLOSE.FORBIDDEN, 'in jail');
    const variant = variantOf(game, url.searchParams.get('variant'));
    // The name comes from the ticket's account, so nobody can open another player's solo table.
    const name = jail ? jailTableName(game, ticket.a) : soloTableName(game, variant, ticket.a);
    headers.set('x-casino-table', name);
    headers.set('x-casino-solo', `${game}|${variant}`);
    // This sitting's limits, moved to the nearest the game allows (none for the machines).
    const asked = parseLimitsParam(url.searchParams.get('limits'));
    const limits = jail ? jailLimits(game, jail.bail) : asked ? clampLimits(game, asked) : null;
    if (limits) headers.set('x-casino-limits', limitsParam(limits));
    return tableStub(env, name).fetch(forward(request, headers));
  }
  return closeWith(CLOSE.NOT_FOUND, 'no such place');
}

function trustedHeaders(request: Request, accountId: number, name: string, look: string, station: string | null): Headers {
  const h = new Headers();
  h.set('Upgrade', 'websocket');
  for (const k of ['Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Extensions']) {
    const v = request.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set('x-casino-account', String(accountId));
  h.set('x-casino-name', name);
  h.set('x-casino-look', JSON.stringify(lookFromJson(look)));
  h.set('x-casino-ip', request.headers.get('CF-Connecting-IP') ?? '');
  if (station) h.set('x-casino-station', station);
  return h;
}

/** A copy of the upgrade request carrying only headers this Worker set. */
function forward(request: Request, headers: Headers): Request {
  return new Request(request.url, { method: 'GET', headers });
}

function floorStub(env: Env): DurableObjectStub<CasinoFloor> {
  const ns = env.FLOOR as unknown as DurableObjectNamespace<CasinoFloor>;
  return ns.get(ns.idFromName('main'));
}

const floor = floorStub;

function tableStub(env: Env, name: string): DurableObjectStub<CasinoTable> {
  const ns = env.TABLE as unknown as DurableObjectNamespace<CasinoTable>;
  return ns.get(ns.idFromName(name));
}

const table = tableStub;
