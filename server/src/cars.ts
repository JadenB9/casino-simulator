// v6 cars6: POST /shop/valet, the valet bringing your car round. Cars are bought through
// POST /shop/buy like everything else you keep (shop.ts); this only moves one you own to the curb
// out front (floor/valet.ts), or sends it back. No money moves here.

import { carItem } from '../../shared/src/items.ts';
import { CALLS_PER_MIN, type CarCallResponse } from '../../shared/src/valet.ts';
import { fail, json, readJson } from './http.ts';
import { bumpRate } from './db.ts';
import type { CasinoFloor } from './floor/index.ts';

export async function valetApi(request: Request, env: Env, accountId: number, cors: Record<string, string>): Promise<Response> {
  const now = Date.now();
  const db = env.DB;
  const body = (await readJson(request)) as { car?: unknown } | null;
  const back = body?.car === null;
  const car = back ? null : carItem(body?.car);
  if (!back && !car) return fail(404, 'NOT_FOUND', "The valet doesn't know that car.", cors);
  if (!(await bumpRate(db, 'casino-valet', `a${accountId}`, CALLS_PER_MIN, 60_000, now))) return fail(429, 'RATE_LIMITED', 'The valet is still running. Give it a minute.', cors);
  const [owns, acct] = await db.batch<{ n: number; name: string }>([
    db.prepare(`SELECT COUNT(*) AS n FROM casino_items WHERE account_id = ?1 AND item = ?2`).bind(accountId, car?.id ?? ''),
    db.prepare(`SELECT name FROM casino_accounts WHERE id = ?1`).bind(accountId),
  ]);
  const name = acct!.results[0]?.name;
  if (!name) return fail(404, 'NOT_FOUND', 'No such account.', cors);
  if (car && !owns!.results[0]?.n) return fail(409, 'NOT_ELIGIBLE', `The ${car.name} isn't yours yet: buy it at the valet first.`, cors);
  const ns = env.FLOOR as unknown as DurableObjectNamespace<CasinoFloor>;
  const r = await ns.get(ns.idFromName('main')).valetCall(accountId, name, car?.id ?? null);
  if ('error' in r) {
    if (r.error === 'AWAY') return fail(409, 'NOT_ELIGIBLE', 'Cars are called from the valet stand, out front by the lobby doors.', cors);
    const s = Math.max(1, Math.ceil((r.wait ?? 0) / 1000));
    return fail(409, 'BUSY', `The curb is full. A space frees up in ${s >= 90 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`, cors);
  }
  return json({ call: r.call } satisfies CarCallResponse, 200, cors);
}
