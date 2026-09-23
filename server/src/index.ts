// The gateway Worker (api.j4den.com/casino/*). It holds no game state: it checks the Origin,
// verifies tokens, answers the account HTTP API, and forwards WebSocket upgrades to the right
// Durable Object with headers only it can set.

import { CLOSE, PROTOCOL_VERSION, type CreateTableResponse, type JoinByPinResponse, type LoanResponse, type LoginResponse, type MeResponse } from '../../shared/src/protocol.ts';
import { isValidName } from '../../shared/src/names.ts';
import { PASSWORD_MAX, PASSWORD_MIN, isValidPassword } from '../../shared/src/password.ts';
import { parseLook, lookFromJson } from '../../shared/src/look.ts';
import { CATALOG, isGameId, soloTableName, TABLE_ID_RE, variantOf } from '../../shared/src/games/catalog.ts';
import { LOAN_AMOUNT } from '../../shared/src/money.ts';
import { closeWith, corsHeaders, fail, json, originAllowed, readJson } from './http.ts';
import { bearer, logIn, signToken, verifyToken, type Claims } from './auth.ts';
import { bumpRate, escrowsOf, getAccount, loadProfile, setLook } from './db.ts';
import { takeLoan } from './transfer.ts';
import { leaderboard } from './leaderboard.ts';
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

    if (path.startsWith('/ws/')) return handleSocket(request, env, url, path.slice(4), origin);
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

  if (route === 'login' && request.method === 'POST') {
    if (!(await bumpRate(env.DB, 'casino-login', ip, 30, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Too many logins. Try again in a minute.', cors);
    const body = (await readJson(request)) as { name?: unknown; password?: unknown } | null;
    const name = body?.name;
    if (!isValidName(name)) return fail(400, 'BAD_NAME', 'Names are 3-16 letters, numbers or _.', cors);
    const password = body?.password;
    if (!isValidPassword(password)) return fail(400, 'BAD_REQUEST', `Passwords are ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`, cors);
    const r = await logIn(env.DB, name, password, ip, now);
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
