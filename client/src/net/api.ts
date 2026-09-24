// The account HTTP API. The token lives in sessionStorage, so each tab is its own player (open
// a second tab and log in as someone else); the last name used is remembered in localStorage for
// a one-click "Continue as ...".

import type {
  CreateTableResponse, HttpError, JoinByPinResponse, LoanResponse, LoginResponse, MeResponse, Profile,
} from '../../../shared/src/protocol.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import type { Look } from '../../../shared/src/look.ts';

declare const __API_ORIGIN__: string;
export const API_ORIGIN: string = __API_ORIGIN__;

const TOKEN_KEY = 'casino.token';
const NAME_KEY = 'casino.lastName';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: HttpError) {
    super(body.msg);
  }
}

function store(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

export function savedToken(): string | null {
  return store('session')?.getItem(TOKEN_KEY) ?? null;
}

export function lastName(): string | null {
  return store('local')?.getItem(NAME_KEY) ?? null;
}

export function forgetToken(): void {
  store('session')?.removeItem(TOKEN_KEY);
}

async function call<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = init.token === undefined ? savedToken() : init.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_ORIGIN}/casino/api/${path}`, { ...init, headers });
  const body = (await res.json().catch(() => ({ error: 'INTERNAL', msg: 'The casino is not answering.' }))) as T & HttpError;
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

/**
 * What the dev pages and the headless scripts log in with, so the fixed names they use stay
 * theirs from one run to the next. Players never see it: the login screen sends what was typed.
 */
export const DEV_PASSWORD = 'casino-dev';

/** Log in, or take the name if it's new (or from before passwords): see shared/src/password.ts. */
export async function login(name: string, password: string): Promise<Profile> {
  const r = await call<LoginResponse>('login', { method: 'POST', body: JSON.stringify({ name, password }), token: null });
  store('session')?.setItem(TOKEN_KEY, r.token);
  store('local')?.setItem(NAME_KEY, r.profile.name);
  return r.profile;
}

export const me = async (): Promise<Profile> => (await call<MeResponse>('me')).profile;
export const saveLook = async (look: Look): Promise<Look> => (await call<{ look: Look }>('me/look', { method: 'PUT', body: JSON.stringify({ look }) })).look;
export const takeLoan = (): Promise<LoanResponse> => call<LoanResponse>('bank/loan', { method: 'POST' });
export const createTable = (game: GameId, visibility: 'public' | 'private', variant?: string): Promise<CreateTableResponse> =>
  call<CreateTableResponse>('tables', { method: 'POST', body: JSON.stringify({ game, visibility, variant }) });
export const joinByPin = (pin: string): Promise<JoinByPinResponse> => call<JoinByPinResponse>('tables/join', { method: 'POST', body: JSON.stringify({ pin }) });

/** ws(s):// URL for a socket path, carrying the protocol version and token. */
export function socketUrl(path: string, params: Record<string, string> = {}): string {
  const base = API_ORIGIN || location.origin;
  const u = new URL(`/casino/ws/${path}`, base.replace(/^http/, 'ws'));
  u.searchParams.set('v', '1');
  u.searchParams.set('t', savedToken() ?? '');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
