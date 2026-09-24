// Limbo as data (docs/rules/online-games.md §3). The player names a target multiplier; the server
// draws a result multiplier R on the two-decimal grid, and the bet wins, paying the target, when R
// reaches it. The result is drawn so that
//
//     P(R ≥ x) = 0.99 / x   for every grid point x from 1.01 to 1,000,000,
//
// which makes every target return exactly 99%: a bet on x wins with probability 0.99 / x and pays
// x times the bet.
//
// How. Work in hundredths (X = 100x, so 1.01x is 101). Let U be uniform on (0, 1) and set
// R = floor(99 / U), clamped to [100, 100,000,000]. For an integer X, floor(99 / U) ≥ X exactly
// when 99 / U ≥ X, that is when U ≤ 99 / X, which has probability 99 / X. Clamping only moves
// results below 100 (U > 0.99) up to 1.00x and results above the cap down to it, so it changes
// nothing for 101 ≤ X ≤ 100,000,000. That proves the formula for every target a bet may name.
//
// U is never rounded. Its base-2^32 digits are the Rng's words, read one at a time: after n words
// U lies in [A / 2^32n, (A + 1) / 2^32n), and since floor(99 / U) only falls as U grows it lies
// between floor(99 · 2^32n / (A + 1)) and floor(99 · 2^32n / A). When those two agree (after
// clamping) every U in the interval gives the same result, so the result is exactly floor(99 / U)
// for the U the words will go on to spell out, and no more words are read. One word decides all
// but about 3 draws in 10,000; two words decide the rest but for about one in 10^11.

import type { Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

/** Targets and results in hundredths: 1.01x to 1,000,000.00x for a target. */
export const MIN_TARGET = 101;
export const MAX_TARGET = 100_000_000;
/** The lowest result: 1.00x, which loses to every target. */
export const MIN_RESULT = 100;
/** 99% of fair, in hundredths: a target of T hundredths wins with probability 99 / T. */
export const RETURN_HUNDREDTHS = 99;

const TWO_32 = 2 ** 32;
/** 99 · 2^32, the first word's numerator: 425,201,762,304, exact in a double. */
const FIRST = RETURN_HUNDREDTHS * TWO_32;
const CAP = BigInt(MAX_TARGET);

export function isTarget(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= MIN_TARGET && x <= MAX_TARGET;
}

/** floor(a / b) for non-negative integers below 2^53, exact even where a / b rounds up to a whole number. */
function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  if (q * b > a) q--;
  else if ((q + 1) * b <= a) q++;
  return q;
}

function clamp(x: number): number {
  return x < MIN_RESULT ? MIN_RESULT : x > MAX_TARGET ? MAX_TARGET : x;
}

function clampBig(x: bigint): number {
  return x < BigInt(MIN_RESULT) ? MIN_RESULT : x > CAP ? MAX_TARGET : Number(x);
}

/** The result in hundredths: floor(99 / U) clamped to 1.00x-1,000,000.00x (see the top of this file). */
export function drawResult(rng: Rng): number {
  const a = rng.next32();
  // One word: U in [a / 2^32, (a + 1) / 2^32). a = 0 leaves U below 2^-32, far past the cap.
  const lo = clamp(floorDiv(FIRST, a + 1));
  const hi = a === 0 ? MAX_TARGET : clamp(floorDiv(FIRST, a));
  if (lo === hi) return lo;
  // A boundary 99 / X falls inside this word's interval: read more digits until it doesn't.
  let digits = BigInt(a);
  let num = BigInt(FIRST);
  for (;;) {
    digits = (digits << 32n) | BigInt(rng.next32());
    num <<= 32n;
    const l = clampBig(num / (digits + 1n));
    const h = digits === 0n ? MAX_TARGET : clampBig(num / digits);
    if (l === h) return l;
  }
}

export function wins(result: number, target: number): boolean {
  return result >= target;
}

/** A win pays the bet times the target: a whole-dollar bet times hundredths is whole cents. */
export function winPayout(bet: Cents, target: number): Cents {
  return (bet / 100) * target;
}

/** The chance a target wins, as a fraction: 0.99 / x. */
export function winChance(target: number): number {
  return RETURN_HUNDREDTHS / target;
}

/** The target (in hundredths) whose win chance is nearest `percent`, kept on the grid and in range. */
export function targetForChance(percent: number): number {
  if (!(percent > 0)) return MAX_TARGET;
  return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round((RETURN_HUNDREDTHS * 100) / percent)));
}
