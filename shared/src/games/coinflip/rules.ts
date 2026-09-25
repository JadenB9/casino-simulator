// Coinflip as numbers (docs/rules/online-games.md §9). Call heads or tails; the server flips a
// fair coin. A right call pays 1.98×, and the round stays open: call again to double what rides,
// or cash out. After k right calls in a row the multiplier is
//
//   0.99 × 2^k        (0.99 / P(k right calls in a row))
//
// which in hundredths is 99 × 2^k, a whole number, so nothing is ever rounded. Every stop returns
// exactly 99% of the bet, and so does any plan for when to stop: from k right calls, flipping on
// is worth ½ × 0.99 × 2^(k+1) = 0.99 × 2^k, exactly what cashing out pays.

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

export const SIDES = ['heads', 'tails'] as const;
export type Side = (typeof SIDES)[number];

/** The longest streak: twenty right calls pay 1,038,090.24× and cash out on their own. */
export const MAX_STREAK = 20;

export function isSide(x: unknown): x is Side {
  return x === 'heads' || x === 'tails';
}

/** What k right calls pay, in hundredths of the bet (0 before the first). */
export function streakMult(k: number): number {
  if (k < 1) return 0;
  return 99 * 2 ** Math.min(k, MAX_STREAK);
}

/** A whole-dollar bet times a whole number of hundredths: whole cents. */
export function streakPayout(bet: Cents, k: number): Cents {
  return (bet / 100) * streakMult(k);
}

/** One fair flip. */
export function flip(rng: Rng): Side {
  return randInt(rng, 2) === 0 ? 'heads' : 'tails';
}

/** The exact return of cashing out after k right calls: P = 2^-k, pays 99 × 2^k hundredths. */
export function returnAt(k: number): { num: number; den: number } {
  return { num: streakMult(k), den: 100 * 2 ** k };
}
