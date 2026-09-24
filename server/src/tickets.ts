// Socket tickets: what a WebSocket connects with instead of the 30-day token, which never goes in
// a URL any more (URLs end up in logs; a ticket that does is already spent or expired).
//
// POST /api/ticket (with the token) gets one: "k1.<payload>.<signature>", HMAC-SHA256 over
// "k1.<payload>" with the token secret. The prefix differs from the token's, so neither can pass
// for the other. It names the account, the one socket path it opens ('floor', 'table/<id>',
// 'solo/<game>'), when it stops working (TICKET_MS after it was made) and a random id.
//
// The Worker checks the signature, the time and the path; the object behind the path spends the
// ticket (spendTicket, in its own SQLite, so a restart doesn't forget), so it opens one socket, once.

import { TABLE_ID_RE, isGameId } from '../../shared/src/games/catalog.ts';
import { b64url, key, unb64url } from './auth.ts';

/** How long a ticket works: the client asks for one right before it connects. */
export const TICKET_MS = 60_000;

const PREFIX = 'k1';
const enc = new TextEncoder();
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export interface TicketClaims {
  /** Account id. */
  a: number;
  /** The socket path this ticket opens. */
  g: string;
  /** Server ms after which it doesn't. */
  exp: number;
  /** Its id, spent by the object it opens. */
  j: string;
}

/** A socket path a ticket may be for, or null. */
export function ticketTarget(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 64) return null;
  if (x === 'floor') return x;
  const table = /^table\/(.+)$/.exec(x);
  if (table && TABLE_ID_RE.test(table[1]!)) return x;
  const solo = /^solo\/([a-z]+)$/.exec(x);
  if (solo && isGameId(solo[1])) return x;
  return null;
}

export async function signTicket(secret: string, accountId: number, target: string, nowMs: number): Promise<{ ticket: string; exp: number }> {
  const claims: TicketClaims = { a: accountId, g: target, exp: nowMs + TICKET_MS, j: b64url(crypto.getRandomValues(new Uint8Array(16))) };
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(`${PREFIX}.${payload}`));
  return { ticket: `${PREFIX}.${payload}.${b64url(new Uint8Array(sig))}`, exp: claims.exp };
}

/** The claims of a genuine, unexpired ticket for this socket path; null for anything else. */
export async function verifyTicket(secret: string, ticket: string | null | undefined, target: string, nowMs: number): Promise<TicketClaims | null> {
  if (!ticket || ticket.length > 512) return null;
  const parts = ticket.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const sig = unb64url(parts[2]!);
  if (!sig) return null;
  if (!(await crypto.subtle.verify('HMAC', await key(secret), sig, enc.encode(`${PREFIX}.${parts[1]}`)))) return null;
  const raw = unb64url(parts[1]!);
  if (!raw) return null;
  let c: TicketClaims;
  try {
    c = JSON.parse(new TextDecoder().decode(raw)) as TicketClaims;
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(c.a) || c.a <= 0 || typeof c.j !== 'string' || !ID_RE.test(c.j)) return null;
  if (c.g !== target || !Number.isFinite(c.exp) || c.exp < nowMs) return null;
  return c;
}

const ready = new WeakSet<SqlStorage>();

/**
 * Spend a ticket in the storage of the object it opens: true the first time, false for a ticket
 * already used (or expired, or malformed). Spent ids are kept until they would have expired anyway.
 */
export function spendTicket(sql: SqlStorage, id: string | null, exp: number, now: number): boolean {
  if (!id || !ID_RE.test(id) || !Number.isFinite(exp) || exp < now) return false;
  if (!ready.has(sql)) {
    sql.exec(`CREATE TABLE IF NOT EXISTS spent_tickets (id TEXT PRIMARY KEY, exp INTEGER NOT NULL) WITHOUT ROWID`);
    ready.add(sql);
  }
  sql.exec(`DELETE FROM spent_tickets WHERE exp < ?1`, now);
  if (sql.exec(`SELECT 1 AS hit FROM spent_tickets WHERE id = ?1`, id).toArray().length > 0) return false;
  sql.exec(`INSERT INTO spent_tickets (id, exp) VALUES (?1, ?2)`, id, exp);
  return true;
}
