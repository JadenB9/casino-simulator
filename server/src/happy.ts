// Happy hour's price at the bar (shared/src/happyhour.ts has the windows): what a bar order costs
// at the moment it's paid. On the dev stack only (CASINO_DEV), POST /api/dev/happy starts one now,
// kept as a row in casino_rate that every Worker isolate reads, so the checks can order in one.

import type { Cents } from '../../shared/src/money.ts';
import { HAPPY_MS, halfPrice, happyHourAt, type HappyHour } from '../../shared/src/happyhour.ts';

const DEV_KEY = 'dev:happy';

/** The dev stack's happy hour going on now, if one was started. */
async function devHappy(db: D1Database, now: number): Promise<HappyHour | null> {
  const row = await db.prepare(`SELECT n, expires_at FROM casino_rate WHERE k = ?1 AND n <= ?2 AND expires_at > ?2`).bind(DEV_KEY, now).first<{ n: number; expires_at: number }>();
  return row ? { start: row.n, end: row.expires_at } : null;
}

/** The happy hour going on at `now`: the schedule's, or on the dev stack one started by hand. */
export async function happyNow(env: Env, now: number): Promise<HappyHour | null> {
  return happyHourAt(now) ?? (env.CASINO_DEV === '1' ? await devHappy(env.DB, now) : null);
}

/** What a bar order priced `price` costs if it's paid at `now`: half during happy hour. */
export async function barPrice(env: Env, price: Cents, now: number): Promise<Cents> {
  return (await happyNow(env, now)) ? halfPrice(price) : price;
}

/** Dev stack: a happy hour from now for HAPPY_MS (or `ms`). */
export async function startDevHappy(db: D1Database, now: number, ms = HAPPY_MS): Promise<HappyHour> {
  const h = { start: now, end: now + ms };
  await db.prepare(`INSERT OR REPLACE INTO casino_rate (k, n, expires_at) VALUES (?1, ?2, ?3)`).bind(DEV_KEY, h.start, h.end).run();
  return h;
}
