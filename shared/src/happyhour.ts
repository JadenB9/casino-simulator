// Happy hour: a quarter of an hour, roughly every hour and three quarters, when everything at the
// bar is half price. When it falls is the server's to say: the Worker prices each bar order at the
// moment it's paid (server/src/shop.ts), and the floor tells everyone when the next one is
// (server/src/floor/celebs.ts), so a client only ever shows what it was told.
//
// The windows come from the clock alone: time is cut into cycles of HAPPY_CYCLE_MS, and each
// cycle's happy hour starts somewhere in its first HAPPY_SPREAD_MS, at a minute picked by hashing
// the cycle's number. Every Worker isolate and the floor work out the same windows with nothing to
// share, and consecutive ones fall 75 to 135 minutes apart.

import type { Cents } from './money.ts';

/** How long happy hour lasts. */
export const HAPPY_MS = 15 * 60_000;
export const HAPPY_CYCLE_MS = 105 * 60_000;
/** How far into its cycle a happy hour may start. */
export const HAPPY_SPREAD_MS = 30 * 60_000;
/** Mixed into the hash, so the minutes aren't the plain cycle numbers. */
const SALT = 0x5eed_4a11;

export interface HappyHour {
  /** Server time (ms) it starts, and ends (not included). */
  start: number;
  end: number;
}

/** A 32-bit integer hash (Chris Wellons' lowbias32). */
function hash(n: number): number {
  let x = (n ^ SALT) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** The happy hour of cycle `k`. */
export function happyHourOf(k: number): HappyHour {
  const minutes = hash(k) % (HAPPY_SPREAD_MS / 60_000 + 1);
  const start = k * HAPPY_CYCLE_MS + minutes * 60_000;
  return { start, end: start + HAPPY_MS };
}

/** The happy hour going on at `now`, or null. */
export function happyHourAt(now: number): HappyHour | null {
  const h = happyHourOf(Math.floor(now / HAPPY_CYCLE_MS));
  return now >= h.start && now < h.end ? h : null;
}

/** The happy hour going on at `now`, or else the next one. */
export function nextHappyHour(now: number): HappyHour {
  const k = Math.floor(now / HAPPY_CYCLE_MS);
  const h = happyHourOf(k);
  return now < h.end ? h : happyHourOf(k + 1);
}

/** Half price, to the cent below (every bar price is whole dollars, so it's exact). */
export function halfPrice(price: Cents): Cents {
  return Math.max(1, Math.floor(price / 2));
}

/** What a bar order costs at `now`. */
export function barPriceAt(price: Cents, now: number): Cents {
  return happyHourAt(now) ? halfPrice(price) : price;
}
