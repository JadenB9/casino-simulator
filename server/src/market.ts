// The Casino Index's price: one step every five minutes, the same for everyone. Each step's move
// comes from two numbers drawn from HMAC-SHA256(secret, "<fund>:<step>") (shared/src/bank.ts
// nextPrice turns them into the price), so the path is fixed and repeatable but nobody without the
// Worker's secret can work out a step before it happens. Steps are written to casino_market as
// they come due, never ahead of now: the chart is read from there, and whoever asks first after a
// quiet spell fills in the steps since (two at once write the same numbers, which is harmless).

import { FUND_ID, FUND_START, STEPS_PER_DAY, nextPrice, stepOf } from '../../shared/src/bank.ts';
import { needSecret } from './auth.ts';

const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(secret: string): Promise<CryptoKey> {
  needSecret(secret); // no secret must never mean a walk anyone can work out
  let k = keys.get(secret);
  if (!k) {
    // its own key, so the market's numbers say nothing about the token secret's other uses
    k = crypto.subtle
      .importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then((base) => crypto.subtle.sign('HMAC', base, new TextEncoder().encode('casino-market')))
      .then((raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
    keys.set(secret, k);
  }
  return k;
}

/** The step's two uniform numbers in [0, 1). */
export async function draws(secret: string, fund: string, step: number): Promise<[number, number]> {
  const mac = new DataView(await crypto.subtle.sign('HMAC', await keyFor(secret), new TextEncoder().encode(`${fund}:${step}`)));
  return [mac.getUint32(0) / 2 ** 32, mac.getUint32(4) / 2 ** 32];
}

/** Rows per insert: two bound values each, within D1's hundred. */
const ROWS = 50;

/**
 * The price now, with every step up to now written. The market opens at FUND_START on the step
 * it is first asked about.
 */
export async function priceNow(db: D1Database, secret: string, now: number, fund = FUND_ID): Promise<{ step: number; price: number }> {
  const step = stepOf(now);
  let last = await db
    .prepare(`SELECT step, price FROM casino_market WHERE fund = ?1 AND step <= ?2 ORDER BY step DESC LIMIT 1`)
    .bind(fund, step)
    .first<{ step: number; price: number }>();
  if (!last) {
    await db.prepare(`INSERT INTO casino_market (fund, step, price) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING`).bind(fund, step, FUND_START).run();
    last = await db.prepare(`SELECT step, price FROM casino_market WHERE fund = ?1 AND step <= ?2 ORDER BY step DESC LIMIT 1`).bind(fund, step).first();
    if (!last) throw new Error('market: no price');
  }
  if (last.step === step) return last;
  const rows: [number, number][] = [];
  let price = last.price;
  for (let s = last.step + 1; s <= step; s++) {
    const [u1, u2] = await draws(secret, fund, s);
    price = nextPrice(price, u1, u2);
    rows.push([s, price]);
  }
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += ROWS) {
    const chunk = rows.slice(i, i + ROWS);
    stmts.push(
      db
        .prepare(`INSERT INTO casino_market (fund, step, price) VALUES ${chunk.map((_, j) => `('${fund}', ?${j * 2 + 1}, ?${j * 2 + 2})`).join(', ')} ON CONFLICT DO NOTHING`)
        .bind(...chunk.flat()),
    );
  }
  await db.batch(stmts);
  return { step, price };
}

/** The price a day before `step` (or the market's first, if it is younger). */
export async function priceDayAgo(db: D1Database, step: number, fund = FUND_ID): Promise<number | null> {
  const row = await db
    .prepare(`SELECT price FROM casino_market WHERE fund = ?1 AND step >= ?2 AND step <= ?3 ORDER BY step LIMIT 1`)
    .bind(fund, step - STEPS_PER_DAY, step)
    .first<{ price: number }>();
  return row?.price ?? null;
}

/** [step, price] from `from` to `to` (inclusive), every `every`th step and always the last. */
export async function history(db: D1Database, from: number, to: number, every = 1, fund = FUND_ID): Promise<[number, number][]> {
  const rows = await db
    .prepare(`SELECT step, price FROM casino_market WHERE fund = ?1 AND step >= ?2 AND step <= ?3 AND ((step - ?2) % ?4 = 0 OR step = ?3) ORDER BY step`)
    .bind(fund, from, to, every)
    .all<{ step: number; price: number }>();
  return rows.results.map((r) => [r.step, r.price]);
}
