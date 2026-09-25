// Fair play on the server: the evidence each account's play leaves (shared/src/fair.ts has the
// signals, the thresholds and why a person doesn't trip them), and the Quick check a script gets
// asked when it does.
//
//   Evidence  Tables and the floor collect what they see in memory (table-fair.ts, the floor's
//             stops) and report it here in batches: note() merges it into casino_fair and judges
//             it. Two objects reporting at once can lose a batch between them, which only makes
//             this looser. Nothing is ever decided on one batch.
//   Due       A verdict over the line marks the account 'due' (never on the dev stack: its e2e
//             scripts are scripts; POST /api/dev/check forces one there), and never again within
//             CLEAR_MS of a passed check. A table asks at the next natural pause: a round over,
//             nothing of theirs on the layout. From then on the account is 'paused'.
//   Paused    No bets and no buy-ins at any table, no new lobbies; standing up and cashing out
//             work as always and nothing is taken. The check never mentions bots; it's a "Quick
//             check to keep the tables fair".
//   Check     Cloudflare Turnstile when the Worker has TURNSTILE_SITEKEY and TURNSTILE_SECRET
//             (unset, it isn't offered), and always the built-in one: a picture drawn here
//             (fair-image.ts) whose words say which ring the chip goes on. Answers are one-time,
//             expire after CHECK_TTL_MS, and a chip dropped sooner than MIN_ANSWER_MS after the
//             picture was handed out is a miss. Misses in a row double the wait before the next
//             try (MISS_WAIT_MS, at most MISS_WAIT_MAX_MS). Passing clears the pause, starts the
//             evidence over and tells every table the account has chips at.

import {
  CHECK_MSG,
  type CheckAnswerResponse,
  type CheckChallenge,
  type CheckResponse,
  type CheckState,
} from '../../shared/src/protocol.ts';
import { emptyEvidence, evidenceFrom, merge, verdict, type Batch } from '../../shared/src/fair.ts';
import { CHIP_HOME, HIT_PX, IMG_H, IMG_W, chipPuzzle } from './fair-image.ts';
import { fail, json, readJson } from './http.ts';
import { bumpRate } from './db.ts';

/** After a passed check, no other for this long. */
export const CLEAR_MS = 12 * 3_600_000;
/** A challenge answers within this long, and no sooner than MIN_ANSWER_MS (nobody drags that fast). */
export const CHECK_TTL_MS = 2 * 60_000;
export const MIN_ANSWER_MS = 700;
/** The wait after the first miss in a row; it doubles with each one after, to at most the max. */
export const MISS_WAIT_MS = 15_000;
export const MISS_WAIT_MAX_MS = 30 * 60_000;

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The Worker settings this reads; Turnstile's two are production-only and optional. */
export interface FairEnv {
  DB: D1Database;
  CASINO_DEV?: string;
  TURNSTILE_SITEKEY?: string;
  TURNSTILE_SECRET?: string;
}

export interface FairRow {
  state: CheckState;
  clear_until: number;
  fails: number;
  retry_at: number;
}

/** Whether a verdict over the line makes a check due: everywhere but the dev stack. */
export function autoChecks(env: { CASINO_DEV?: string }): boolean {
  return env.CASINO_DEV !== '1';
}

export async function fairOf(db: D1Database, accountId: number): Promise<FairRow> {
  const row = await db.prepare(`SELECT state, clear_until, fails, retry_at FROM casino_fair WHERE account_id = ?1`).bind(accountId).first<FairRow>();
  return row ?? { state: 'ok', clear_until: 0, fails: 0, retry_at: 0 };
}

/**
 * Add what a table or the floor saw and judge it. The evidence is written on its own; the state
 * moves only from 'ok' to 'due', with a guarded UPDATE, so a report can never undo a pause or a
 * pass that landed meanwhile. Returns the state after.
 */
export async function note(db: D1Database, accountId: number, batch: Batch, now: number, auto: boolean): Promise<CheckState> {
  const row = await db.prepare(`SELECT ev, state, clear_until FROM casino_fair WHERE account_id = ?1`).bind(accountId).first<{ ev: string; state: CheckState; clear_until: number }>();
  const ev = merge(evidenceFrom(row?.ev), batch, now);
  const v = verdict(ev, now);
  const due = auto && v.tripped && (row?.state ?? 'ok') === 'ok' && now >= (row?.clear_until ?? 0);
  await db.batch([
    db
      .prepare(
        `INSERT INTO casino_fair (account_id, ev, score, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (account_id) DO UPDATE SET ev = ?2, score = ?3, updated_at = ?4`,
      )
      .bind(accountId, JSON.stringify(ev), v.score, now),
    ...(due ? [db.prepare(`UPDATE casino_fair SET state = 'due' WHERE account_id = ?1 AND state = 'ok' AND clear_until <= ?2`).bind(accountId, now)] : []),
  ]);
  if (due) console.log('fair: check due', accountId, v.score.toFixed(2), JSON.stringify(v.signals));
  return due ? 'due' : (row?.state ?? 'ok');
}

/** Make a due check a waiting one (a table asked it at a pause). Returns whether it's paused now. */
export async function pause(db: D1Database, accountId: number, now: number): Promise<boolean> {
  await db.prepare(`UPDATE casino_fair SET state = 'paused', updated_at = ?2 WHERE account_id = ?1 AND state = 'due'`).bind(accountId, now).run();
  return (await fairOf(db, accountId)).state === 'paused';
}

/** The dev stack's way to a check (POST /api/dev/check): due now, or paused with `paused`. */
export async function forceCheck(db: D1Database, accountId: number, now: number, paused: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO casino_fair (account_id, state, clear_until, fails, retry_at, updated_at) VALUES (?1, ?2, 0, 0, 0, ?3)
       ON CONFLICT (account_id) DO UPDATE SET state = ?2, clear_until = 0, fails = 0, retry_at = 0, updated_at = ?3`,
    )
    .bind(accountId, paused ? 'paused' : 'due', now)
    .run();
}

function missWait(fails: number): number {
  return Math.min(MISS_WAIT_MAX_MS, MISS_WAIT_MS * 2 ** Math.max(0, fails - 1));
}

function rand(): () => number {
  const buf = new Uint32Array(512);
  let i = buf.length;
  return () => {
    if (i === buf.length) {
      crypto.getRandomValues(buf);
      i = 0;
    }
    return buf[i++]! / 4294967296;
  };
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Hand out a challenge: Turnstile when it's set up and not refused (`kind` 'chip'), else the chip. */
export async function issue(env: FairEnv, accountId: number, now: number, kind: 'any' | 'chip'): Promise<CheckChallenge> {
  const id = crypto.randomUUID();
  const expires = now + CHECK_TTL_MS;
  // Old challenges go: one row a try, a few tries a day at most.
  await env.DB.prepare(`DELETE FROM casino_checks WHERE account_id = ?1 AND expires_at < ?2`).bind(accountId, now - 86_400_000).run();
  if (kind === 'any' && env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET) {
    await env.DB.prepare(`INSERT INTO casino_checks (id, account_id, kind, answer, issued_at, expires_at) VALUES (?1, ?2, 'turnstile', '', ?3, ?4)`)
      .bind(id, accountId, now, expires)
      .run();
    return { kind: 'turnstile', id, sitekey: env.TURNSTILE_SITEKEY, expires };
  }
  const p = await chipPuzzle(rand());
  await env.DB.prepare(`INSERT INTO casino_checks (id, account_id, kind, answer, issued_at, expires_at) VALUES (?1, ?2, 'chip', ?3, ?4, ?5)`)
    .bind(id, accountId, JSON.stringify({ x: p.x, y: p.y }), now, expires)
    .run();
  return { kind: 'chip', id, png: b64(p.png), w: IMG_W, h: IMG_H, chip: CHIP_HOME, expires };
}

export type AnswerResult = { ok: true } | { ok: false; why: 'gone' | 'used' | 'expired' | 'wrong' | 'wait' };

/**
 * Check an answer. The challenge is spent first (a guarded UPDATE), so a replay, or two answers
 * racing, get 'used'. A miss counts toward the wait; a pass clears the pause.
 */
export async function answer(
  env: FairEnv,
  accountId: number,
  body: { id?: unknown; x?: unknown; y?: unknown; token?: unknown },
  now: number,
  ip: string | null,
): Promise<AnswerResult> {
  if (typeof body.id !== 'string' || body.id.length > 64) return { ok: false, why: 'gone' };
  const fair = await fairOf(env.DB, accountId);
  if (now < fair.retry_at) return { ok: false, why: 'wait' };
  const row = await env.DB.prepare(`SELECT kind, answer, issued_at, expires_at, used FROM casino_checks WHERE id = ?1 AND account_id = ?2`)
    .bind(body.id, accountId)
    .first<{ kind: 'chip' | 'turnstile'; answer: string; issued_at: number; expires_at: number; used: number }>();
  if (!row) return { ok: false, why: 'gone' };
  const spent = await env.DB.prepare(`UPDATE casino_checks SET used = 1 WHERE id = ?1 AND used = 0`).bind(body.id).run();
  if (row.used || spent.meta.changes !== 1) return { ok: false, why: 'used' };
  if (now > row.expires_at) return { ok: false, why: 'expired' };
  let passed = false;
  if (row.kind === 'chip') {
    const want = JSON.parse(row.answer) as { x: number; y: number };
    const x = Number(body.x);
    const y = Number(body.y);
    passed = now - row.issued_at >= MIN_ANSWER_MS && Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x - want.x, y - want.y) <= HIT_PX;
  } else {
    passed = typeof body.token === 'string' && body.token.length <= 4096 && (await turnstileOk(env, body.token, body.id, ip));
  }
  if (passed) {
    await env.DB.prepare(`UPDATE casino_fair SET state = 'ok', ev = ?2, clear_until = ?3, fails = 0, retry_at = 0, updated_at = ?4 WHERE account_id = ?1`)
      .bind(accountId, JSON.stringify(emptyEvidence()), now + CLEAR_MS, now)
      .run();
    return { ok: true };
  }
  await env.DB.prepare(`UPDATE casino_fair SET fails = fails + 1, retry_at = ?2, updated_at = ?3 WHERE account_id = ?1`)
    .bind(accountId, now + missWait(fair.fails + 1), now)
    .run();
  return { ok: false, why: 'wrong' };
}

/** Ask Cloudflare whether a Turnstile token is good (once: siteverify refuses a token seen before). */
async function turnstileOk(env: FairEnv, token: string, idempotency: string, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('idempotency_key', idempotency);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch (err) {
    console.error('turnstile siteverify failed', err);
    return false;
  }
}

/**
 * GET /api/check (where you stand; a challenge if one waits, ?kind=chip for the built-in one),
 * POST /api/check (an answer), and on the dev stack POST /api/dev/check {paused?} to force one.
 * `refresh` has the tables holding this account's chips read its state again (a pass, a force).
 */
export async function fairApi(
  request: Request,
  env: FairEnv,
  route: string,
  accountId: number,
  cors: Record<string, string>,
  refresh: (accountId: number) => Promise<void>,
): Promise<Response> {
  const now = Date.now();
  if (route === 'dev/check' && request.method === 'POST' && env.CASINO_DEV === '1') {
    const body = (await readJson(request, 256)) as { paused?: unknown } | null;
    await forceCheck(env.DB, accountId, now, body?.paused === true);
    await refresh(accountId);
    return json({ state: body?.paused === true ? 'paused' : 'due' }, 200, cors);
  }
  if (route !== 'check') return fail(404, 'NOT_FOUND', 'Not here.', cors);
  // Each challenge is a picture drawn and a row written; each answer a few reads and writes.
  if (!(await bumpRate(env.DB, 'casino-check', `a${accountId}`, 20, 60_000, now))) return fail(429, 'RATE_LIMITED', 'Give it a minute.', cors);
  if (request.method === 'GET') {
    const fair = await fairOf(env.DB, accountId);
    if (fair.state === 'ok') return json({ state: 'ok' } satisfies CheckResponse, 200, cors);
    if (fair.state === 'due') await pause(env.DB, accountId, now);
    if (now < fair.retry_at) return json({ state: 'paused', wait: fair.retry_at } satisfies CheckResponse, 200, cors);
    const kind = new URL(request.url).searchParams.get('kind') === 'chip' ? 'chip' : 'any';
    return json({ state: 'paused', challenge: await issue(env, accountId, now, kind) } satisfies CheckResponse, 200, cors);
  }
  if (request.method === 'POST') {
    const body = ((await readJson(request, 8192)) ?? {}) as { id?: unknown; x?: unknown; y?: unknown; token?: unknown };
    const r = await answer(env, accountId, body, now, request.headers.get('CF-Connecting-IP'));
    if (r.ok) {
      try {
        await refresh(accountId);
      } catch (err) {
        console.error('fair: telling tables failed', err);
      }
      return json({ ok: true, state: 'ok' } satisfies CheckAnswerResponse, 200, cors);
    }
    const fair = await fairOf(env.DB, accountId);
    return json({ ok: false, state: fair.state, ...(fair.retry_at > now ? { wait: fair.retry_at } : {}) } satisfies CheckAnswerResponse, 200, cors);
  }
  return fail(405, 'BAD_REQUEST', 'Not here.', cors);
}

/** The refusal a paused account gets from the Worker (new lobbies, joining by PIN). */
export function pausedFail(cors: Record<string, string>): Response {
  return fail(403, 'NOT_ELIGIBLE', CHECK_MSG, cors, { check: true });
}
