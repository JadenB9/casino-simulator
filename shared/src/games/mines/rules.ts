// Mines as numbers: a 5 × 5 board with 1 to 24 mines on it, placed uniformly at random. Every
// safe tile turned over is a gem. After k gems with m mines on the board the multiplier is
//
//   0.99 × C(25, k) / C(25 − m, k)        (0.99 / P(the first k tiles turned are all safe))
//
// floored to the cent. In hundredths that is floor(99 × C(25, k) / C(25 − m, k)), all integers,
// so cashing out after any number of gems returns at most 99% of the bet, exactly
// (docs/rules/online-games.md §6).

import { type Rng, randInt } from '../../rng.ts';

export const TILES = 25;
export const MIN_MINES = 1;
export const MAX_MINES = 24;

/** C(n, k); exact for the board's sizes (C(25, 12) = 5,200,300 is the largest). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  // c × (n − i) / (i + 1) stays a whole number at every step
  for (let i = 0; i < Math.min(k, n - k); i++) c = (c * (n - i)) / (i + 1);
  return c;
}

/** Gems there are to find with `mines` on the board. */
export function gemsOf(mines: number): number {
  return TILES - mines;
}

function idiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/** What k gems pay with `mines` mines, in hundredths of the bet. No gems yet pays nothing. */
export function multiplier(mines: number, k: number): number {
  if (k < 1) return 0;
  return idiv(99 * choose(TILES, k), choose(TILES - mines, k));
}

/** The exact return of cashing out after k gems: m × C(25 − mines, k) / (100 × C(25, k)). */
export function returnAt(mines: number, k: number): { num: number; den: number } {
  return { num: multiplier(mines, k) * choose(TILES - mines, k), den: 100 * choose(TILES, k) };
}

/** Where the mines are: a uniform choice of `mines` tiles out of 25 (partial Fisher-Yates), sorted. */
export function drawField(rng: Rng, mines: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < TILES; i++) order.push(i);
  for (let i = 0; i < mines; i++) {
    const j = i + randInt(rng, TILES - i);
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  return order.slice(0, mines).sort((a, b) => a - b);
}

/**
 * How many gems to stop at for the best exact return, having found `found` already: the k ≥
 * max(found, 1) with the highest return (the fewest on a tie). The floor to the cent is the
 * only thing that separates them.
 */
export function bestStop(mines: number, found: number): number {
  let best = Math.max(1, found);
  for (let k = best + 1; k <= gemsOf(mines); k++) {
    const a = returnAt(mines, k);
    const b = returnAt(mines, best);
    // a.num / a.den > b.num / b.den; the products can pass 2^53, so compare exactly
    if (BigInt(a.num) * BigInt(b.den) > BigInt(b.num) * BigInt(a.den)) best = k;
  }
  return best;
}
