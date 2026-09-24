// Crash as numbers (docs/rules/online-games.md §8).
//
// The curve. From launch the multiplier grows as m(t) = e^(0.00006 t), t in ms (Bustabit's
// curve): 2× at 11.6 s, 10× at 38.4 s, 100× at 76.8 s. What the screen shows and what a cash-out
// pays is m(t) floored to the cent. Both come from one table, timeTo(k): the whole ms at which
// the display first reads k hundredths. multAt(t) is the largest k with timeTo(k) ≤ t, so the
// display, the crash moment and every payout agree to the millisecond on every machine.
//
// The crash point c (in hundredths) is drawn so that for every k from 100 up to the cap
//
//   P(c > k) = 99 / k          i.e. the multiplier gets past k× with probability 0.99 / k
//
// so 1% of rounds crash at 1.00× (P(c > 100) = 99/100) and a cash-out at any k pays k/100 with
// probability 99/k: a return of exactly 99%, whether it comes from an auto cash-out target or a
// click at any moment (a click at time t is paid iff t < timeTo(c), which is iff multAt(t) < c).
// Above the cap nothing is left: the rocket is gone at 10,000× at the latest.
//
// drawCrash samples that distribution exactly, with no floating point: a bisection on
// (lo, hi] whose every step is a coin with an exact integer bias, flipped with an exact uniform
// integer draw. The unit tests walk the whole tree for small caps with exact fractions.

import { type Rng, randInt } from '../../rng.ts';

/** Growth per ms: m(t) = e^(RATE × t). */
export const RATE = 0.00006;
/** The highest crash point, in hundredths (10,000×). */
export const CAP = 1_000_000;
/** Auto cash-out targets, in hundredths. */
export const MIN_AUTO = 101;
export const MAX_AUTO = CAP - 1;

/** The whole ms after launch at which the multiplier first shows k hundredths. */
export function timeTo(k: number): number {
  if (k <= 100) return 0;
  return Math.ceil(Math.log(k / 100) / RATE);
}

/** The multiplier `ms` after launch, in hundredths: the largest k with timeTo(k) ≤ ms. */
export function multAt(ms: number): number {
  if (ms <= 0) return 100;
  let k = Math.min(CAP, Math.max(100, Math.floor(100 * Math.exp(RATE * ms))));
  // The float guess is right or off by one; settle it against the table so it is exact.
  while (k > 100 && timeTo(k) > ms) k--;
  while (k < CAP && timeTo(k + 1) <= ms) k++;
  return k;
}

const TWO_32 = 2 ** 32;
const TWO_53 = 2 ** 53;

/** An integer in [0, n), every value exactly equally likely, for n up to 2^53. */
export function randBelow(rng: Rng, n: number): number {
  if (n <= TWO_32) return randInt(rng, n);
  if (!Number.isSafeInteger(n)) throw new RangeError(`randBelow: bad range ${n}`);
  // 53 random bits (21 + 32); draws at or above the largest multiple of n are redrawn.
  const limit = TWO_53 - (TWO_53 % n);
  for (;;) {
    const x = (rng.next32() >>> 11) * TWO_32 + rng.next32();
    if (x < limit) return x % n;
  }
}

/**
 * The bisection's coin: given lo < c ≤ hi, the chance that c > mid, as num/den. With
 * P(c > x) = 99/x below the cap and 0 at it, this is (99/mid − 99/hi) / (99/lo − 99/hi), which
 * is lo(hi − mid) / (mid(hi − lo)) below the cap and lo / mid when hi is the cap.
 */
export function splitOdds(lo: number, hi: number, mid: number, cap = CAP): [num: number, den: number] {
  return hi >= cap ? [lo, mid] : [lo * (hi - mid), mid * (hi - lo)];
}

/** A crash point in hundredths, 100 to `cap`, with P(c > k) = 99/k for 100 ≤ k < cap. */
export function drawCrash(rng: Rng, cap = CAP): number {
  // P(c > 100) = 99/100: one round in a hundred ends at 1.00×.
  if (randInt(rng, 100) >= 99) return 100;
  let lo = 100;
  let hi = cap;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const [num, den] = splitOdds(lo, hi, mid, cap);
    if (randBelow(rng, den) < num) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** "2.35×" from hundredths. */
export function formatMult(k: number): string {
  return `${(k / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}
