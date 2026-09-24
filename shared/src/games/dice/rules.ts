// Dice as data (docs/rules/online-games.md §2). The roll is one of 10,000 numbers, 0.00 to 99.99,
// all equally likely; the server draws it as an integer 0-9999 (hundredths). The player picks a
// target and a side: Roll Over T wins on a roll above T, Roll Under T wins on a roll below T. A roll
// equal to the target loses either way.
//
// The multiplier is 99% of fair: with c winning rolls out of 10,000 it is 9,900 / c (2.0000x at
// 4,950). A win pays the bet times that, floored to the cent, so the return is exactly
// c · floor(bet · 9900 / c) / (10,000 · bet): 99% whenever c divides bet · 9900 (in cents), and
// never more than one cent per win below it. Chances run from 0.01% (9,900x) to 98% (1.0102x).

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

/** Rolls 0.00 to 99.99, as hundredths. */
export const GRID = 10_000;
/** Fewest and most winning rolls a bet may have: 0.01% to 98.00%. */
export const MIN_CHANCE = 1;
export const MAX_CHANCE = 9_800;
/** 99% of the 10,000 rolls: the multiplier is RETURN_ROLLS / chance. */
export const RETURN_ROLLS = 9_900;

export function drawRoll(rng: Rng): number {
  return randInt(rng, GRID);
}

/** How many of the 10,000 rolls win: above T for Roll Over, below T for Roll Under. */
export function winCount(target: number, over: boolean): number {
  return over ? GRID - 1 - target : target;
}

/** The target that gives `chance` winning rolls on this side. */
export function targetFor(chance: number, over: boolean): number {
  return over ? GRID - 1 - chance : chance;
}

export function isTarget(target: unknown, over: boolean): target is number {
  if (typeof target !== 'number' || !Number.isInteger(target)) return false;
  const c = winCount(target, over);
  return c >= MIN_CHANCE && c <= MAX_CHANCE;
}

export function wins(roll: number, target: number, over: boolean): boolean {
  return over ? roll > target : roll < target;
}

/** floor(a / b) for non-negative integers, exact even where a / b rounds up to a whole number. */
export function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  if (q * b > a) q--;
  else if ((q + 1) * b <= a) q++;
  return q;
}

/** What a winning bet pays back (stake included): bet · 9900 / chance, floored to the cent. */
export function winPayout(bet: Cents, chance: number): Cents {
  return floorDiv(bet * RETURN_ROLLS, chance);
}

/** The multiplier the page shows: 9900 / chance, before any cent is floored away. */
export function multiplierOf(chance: number): number {
  return RETURN_ROLLS / chance;
}

/**
 * The exact return of a bet as a fraction: the winning rolls times the floored payout, over
 * 10,000 rolls times the bet. It is 99/100 exactly when chance divides bet · 9900.
 */
export function exactReturn(bet: Cents, chance: number): { num: number; den: number } {
  return { num: chance * winPayout(bet, chance), den: GRID * bet };
}

export function rtpOf(bet: Cents, chance: number): number {
  const { num, den } = exactReturn(bet, chance);
  return num / den;
}

/**
 * The nearest chance to `chance` whose win pays exactly 99% at this bet (no cent floored away),
 * for the tips; ties go to the higher chance.
 */
export function nearestExactChance(bet: Cents, chance: number): number {
  for (let d = 0; d < MAX_CHANCE; d++) {
    for (const c of [chance + d, chance - d]) {
      if (c >= MIN_CHANCE && c <= MAX_CHANCE && (bet * RETURN_ROLLS) % c === 0) return c;
    }
  }
  return chance;
}
