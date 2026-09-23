// Accounts: passwords, the login decision, and signed tokens.
//
// Names are first come, first served, and a password keeps one yours. A new name is created
// with the password it arrives with; a name that has a password needs it; an account from
// before passwords existed takes the first one it is given and is claimed from then on.
//
// Passwords go through PBKDF2-HMAC-SHA256 in WebCrypto with a random 16-byte salt per account
// and 100,000 iterations, the most the Workers runtime allows, and are compared in constant
// time. Nothing here logs a password, and no hash leaves the Worker.
//
// Tokens are "v2.<payload>.<signature>", HMAC-SHA256 over "v2.<payload>". A token binds a
// connection to the account id the server issued after checking the password, and keys the
// rate limits. v1 tokens came from the name-only login, so they are refused: every session
// logs in once with a password.

import { normalizePassword } from '../../shared/src/password.ts';
import { bumpRate, claimAccount, createAccount, findAccount, rateReached, touchAccount, type AccountRow } from './db.ts';

const TOKEN_VERSION = 'v2';
const TOKEN_DAYS = 30;
const enc = new TextEncoder();

export interface Claims {
  /** account id */
  a: number;
  /** account name, as it was when the token was issued */
  n: string;
  /** issued / expires, unix seconds */
  iat: number;
  exp: number;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const keys = new Map<string, Promise<CryptoKey>>();

function key(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keys.set(secret, k);
  }
  return k;
}

export async function signToken(secret: string, accountId: number, name: string, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const claims: Claims = { a: accountId, n: name, iat, exp: iat + TOKEN_DAYS * 86_400 };
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(`${TOKEN_VERSION}.${payload}`));
  return `${TOKEN_VERSION}.${payload}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyToken(secret: string, token: string | null | undefined, nowMs: number): Promise<Claims | null> {
  if (!token || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const payload = parts[1]!;
  const sig = unb64url(parts[2]!);
  if (!sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await key(secret), sig, enc.encode(`${TOKEN_VERSION}.${payload}`));
  if (!ok) return null;
  const raw = unb64url(payload);
  if (!raw) return null;
  let claims: Claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(raw)) as Claims;
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(claims.a) || claims.a <= 0 || typeof claims.n !== 'string') return null;
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 < nowMs) return null;
  return claims;
}

export function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

// --------------------------------------------------------------------------------------------
// Passwords

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

/** What an account stores: "pbkdf2:<iterations>:<hex>" and its salt, hex. */
export interface PassHash {
  hash: string;
  salt: string;
}

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function unhex(s: string): Uint8Array | null {
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** PBKDF2-HMAC-SHA256 of the normalized password, 32 bytes. */
export async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', enc.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

/** Hash a password under a fresh salt, for a new account or a claim. */
export async function hashPassword(password: string): Promise<PassHash> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const dk = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash: `pbkdf2:${PBKDF2_ITERATIONS}:${hex(dk)}`, salt: hex(salt) };
}

/**
 * Whether a password matches what an account stored. The stored iteration count is used (up to
 * the runtime's limit), so a later change of count keeps older accounts working; anything
 * malformed is simply a mismatch.
 */
export async function verifyPassword(password: string, stored: PassHash): Promise<boolean> {
  const m = /^pbkdf2:(\d{1,6}):([0-9a-f]{64})$/.exec(stored.hash);
  const salt = unhex(stored.salt);
  if (!m || !salt || salt.length === 0) return false;
  const iterations = Number(m[1]);
  if (iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const got = await pbkdf2(password, salt, iterations);
  // Both are 32 bytes (the pattern above pins the stored length), as timingSafeEqual requires.
  return crypto.subtle.timingSafeEqual(got, unhex(m[2]!)!);
}

// --------------------------------------------------------------------------------------------
// Logging in

/**
 * Wrong passwords one address may send, and one name may receive, in a window before logins
 * from there (or to it) wait the window out. A name takes more than any one address can send,
 * so nobody can lock another player out from a single connection, while guessing one name
 * from many addresses still stops at a few a minute.
 */
export const MISSES_PER_IP = 20;
export const MISSES_PER_NAME = 60;
export const MISS_WINDOW_MS = 15 * 60_000;
/** New accounts per address per hour. */
export const NEW_PER_IP = 10;
const NEW_WINDOW_MS = 3_600_000;

export type LoginOutcome =
  | { ok: true; account: AccountRow; created: boolean; claimed: boolean }
  | { ok: false; why: 'wrong' | 'locked' | 'too-many-new' };

/**
 * Decide a login for a name and password that have already passed their rules. New name:
 * create it with this password. A name with a password: check it. An account from before
 * passwords: this password becomes its own. Races (two people taking one name at once) end
 * with the second treated as a login to the first one's account.
 */
export async function logIn(db: D1Database, name: string, password: string, ip: string, now: number): Promise<LoginOutcome> {
  const nameKey = name.toLowerCase();
  const locked = await rateReached(db, [
    { gate: 'casino-miss-ip', key: ip, limit: MISSES_PER_IP },
    { gate: 'casino-miss-name', key: nameKey, limit: MISSES_PER_NAME },
  ], now);
  if (locked) return { ok: false, why: 'locked' };

  let account = await findAccount(db, name);
  if (!account) {
    if (!(await bumpRate(db, 'casino-new', ip, NEW_PER_IP, NEW_WINDOW_MS, now))) return { ok: false, why: 'too-many-new' };
    const made = await createAccount(db, name, await hashPassword(password), now);
    if (made) return { ok: true, account: made, created: true, claimed: false };
    // Someone else made it between the look-up and the insert, so it's theirs: check this
    // password against the one they set.
    account = await findAccount(db, name);
    if (!account) throw new Error('login: account missing after a lost race');
  }
  if (account.pass_hash === null || account.pass_salt === null) {
    if (await claimAccount(db, account.id, await hashPassword(password), now)) {
      return { ok: true, account, created: false, claimed: true };
    }
    // Claimed by someone else a moment ago.
    account = await findAccount(db, name);
    if (!account || account.pass_hash === null || account.pass_salt === null) throw new Error('login: claim lost to nobody');
  }
  if (await verifyPassword(password, { hash: account.pass_hash, salt: account.pass_salt })) {
    await touchAccount(db, account.id, now);
    return { ok: true, account, created: false, claimed: false };
  }
  await Promise.all([
    bumpRate(db, 'casino-miss-ip', ip, MISSES_PER_IP, MISS_WINDOW_MS, now),
    bumpRate(db, 'casino-miss-name', nameKey, MISSES_PER_NAME, MISS_WINDOW_MS, now),
  ]);
  return { ok: false, why: 'wrong' };
}
