// The gateway Worker (api.j4den.com/casino/*). It holds no game state: it checks the Origin,
// verifies tokens, answers the account HTTP API, and forwards WebSocket upgrades to the right
// Durable Object with headers only it can set.

import { CLOSE, PROTOCOL_VERSION, type CreateTableResponse, type JoinByPinResponse, type LoanResponse, type LoginResponse, type MeResponse } from '../../shared/src/protocol.ts';
import { isValidName } from '../../shared/src/names.ts';
import { parseLook, lookFromJson } from '../../shared/src/look.ts';
import { CATALOG, isGameId, soloTableName, TABLE_ID_RE, variantOf } from '../../shared/src/games/catalog.ts';
import { LOAN_AMOUNT } from '../../shared/src/money.ts';
import { closeWith, corsHeaders, fail, json, originAllowed, readJson } from './http.ts';
import { bearer, signToken, verifyToken, type Claims } from './auth.ts';
import { bumpRate, escrowsOf, getAccount, loadProfile, loginAccount, setLook } from './db.ts';
import { takeLoan } from './transfer.ts';
import { leaderboard } from './leaderboard.ts';
import { ipKey } from './floor/directory.ts';
import type { CasinoFloor } from './floor/index.ts';
import type { CasinoTable } from './table/host.ts';

export { CasinoFloor } from './floor/index.ts';
export { CasinoTable } from './table/host.ts';

const PREFIX = '/casino';
/** An escrow older than this gets its table asked to reconcile before a profile or loan. */
const STALE_ESCROW_MS = 120_000;
const STATION_RE = /^[a-z0-9-]{1,24}$/;

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
    const body = await readJson(request);
    const name = (body as { name?: unknown } | null)?.name;
    if (!isValidName(name)) return fail(400, 'BAD_NAME', 'Names are 3-16 letters, numbers or _.', cors);
    const existing = await env.DB.prepare(`SELECT 1 AS hit FROM casino_accounts WHERE name = ?1`).bind(name).first();
    if (!existing && !(await bumpRate(env.DB, 'casino-new', addr, 10, 3_600_000, now))) {
      return fail(429, 'RATE_LIMITED', 'Too many new accounts from here. Try again later.', cors);
    }
    const { account } = await loginAccount(env.DB, name, now);
    const token = await signToken(env.CASINO_TOKEN_SECRET, account.id, account.name, now);
    const profile = await loadProfile(env.DB, account.id);
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
    await setLook(env.DB, claims.a, look);
    try {
      await floor(env).playerLook(claims.a, look);
    } catch (err) {
      console.error('floor look update failed', err);
    }
    return json({ look }, 200, cors);
  }

  if (route === 'bank/loan' && request.method === 'POST') {
    // Each ask calls every table holding an escrow of yours, so it has a limit of its own.
    if (!(await bumpRate(env.DB, 'casino-loan', `a${claims.a}`, 10, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
    await reconcileStale(env, claims.a, now, true);
    const { granted } = await takeLoan(env.DB, claims.a, now, `loan:${claims.a}:${crypto.randomUUID()}`);
    const profile = await loadProfile(env.DB, claims.a);
    if (!profile) return fail(401, 'UNAUTHORIZED', 'That account is gone.', cors);
    if (!granted) {
      return fail(409, 'NOT_ELIGIBLE', 'The bank only lends when you have nothing left, on the tables included.', cors, {
        balance: profile.balance,
        inPlay: profile.inPlay,
      });
    }
    return json({ profile, loan: { amount: LOAN_AMOUNT, at: now } } satisfies LoanResponse, 200, cors);
  }

  if (route === 'tables' && request.method === 'POST') {
    const body = (await readJson(request)) as { game?: unknown; variant?: unknown; visibility?: unknown } | null;
    const game = body?.game;
    const visibility = body?.visibility === 'private' ? 'private' : 'public';
    if (!isGameId(game) || !CATALOG[game].multiplayer || CATALOG[game].dev) return fail(400, 'BAD_REQUEST', 'That game has no multiplayer tables.', cors);
    const variant = variantOf(game, body?.variant);
    const made = await floor(env).createLobby({ game, visibility, accountId: claims.a, ip });
    if ('error' in made) return fail(429, 'RATE_LIMITED', 'Slow down a little.', cors);
    await table(env, made.tableId).init({ name: made.tableId, game, variant, mode: 'multi', visibility, pin: made.pin });
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
    return json({ tableId: found.tableId, game: found.game } satisfies JoinByPinResponse, 200, cors);
  }

  return fail(404, 'NOT_FOUND', 'Not here.', cors);
}

/**
 * Ask each table holding an escrow for this account that has been open a while to report or
 * resolve it. Returns the live stacks it learned, for the profile's "chips on tables".
 */
async function reconcileStale(env: Env, accountId: number, now: number, all = false): Promise<Map<string, number>> {
  const stacks = new Map<string, number>();
  const escrows = await escrowsOf(env.DB, accountId);
  await Promise.all(
    escrows
      .filter((e) => all || now - e.updated_at > STALE_ESCROW_MS)
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
  const claims = await verifyToken(env.CASINO_TOKEN_SECRET, url.searchParams.get('t'), now);
  if (!claims) return closeWith(CLOSE.UNAUTHORIZED, 'log in again');
  const account = await getAccount(env.DB, claims.a);
  if (!account) return closeWith(CLOSE.UNAUTHORIZED, 'account not found');

  const station = url.searchParams.get('station');
  const headers = trustedHeaders(request, claims, account.name, account.look, station && STATION_RE.test(station) ? station : null);

  if (route === 'floor') return floorStub(env).fetch(forward(request, headers));

  const lobby = route.match(/^table\/([a-z0-9-]+)$/);
  if (lobby) {
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
    const variant = variantOf(game, url.searchParams.get('variant'));
    // The name comes from the token, so nobody can open another player's solo table.
    const name = soloTableName(game, variant, claims.a);
    headers.set('x-casino-table', name);
    headers.set('x-casino-solo', `${game}|${variant}`);
    return tableStub(env, name).fetch(forward(request, headers));
  }
  return closeWith(CLOSE.NOT_FOUND, 'no such place');
}

function trustedHeaders(request: Request, claims: Claims, name: string, look: string, station: string | null): Headers {
  const h = new Headers();
  h.set('Upgrade', 'websocket');
  for (const k of ['Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Extensions']) {
    const v = request.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set('x-casino-account', String(claims.a));
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
