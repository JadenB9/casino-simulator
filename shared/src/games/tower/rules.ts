// Tower as numbers: nine rows to climb, one tile picked per row. The difficulty sets how many
// tiles a row has and how many of them hide the dragon; the rest hold an egg. The five
// difficulties are Stake's Dragon Tower ones (docs/rules/online-games.md §5).
//
// The multiplier after k safe rows is 0.99 / P(surviving k rows), floored to the cent. In
// hundredths that is floor(99 × tiles^k / eggs^k), all in integers, so the published table is
// exactly what the engine pays and cashing out on any row returns at most 99% of the bet.

import { type Rng, randInt } from '../../rng.ts';

export const LEVELS = 9;

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert', 'master'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface DifficultySpec {
  id: Difficulty;
  name: string;
  /** Tiles in a row. */
  tiles: number;
  /** Of those, how many hide the dragon. */
  bad: number;
}

export const SPECS: Record<Difficulty, DifficultySpec> = {
  easy: { id: 'easy', name: 'Easy', tiles: 4, bad: 1 },
  medium: { id: 'medium', name: 'Medium', tiles: 3, bad: 1 },
  hard: { id: 'hard', name: 'Hard', tiles: 2, bad: 1 },
  expert: { id: 'expert', name: 'Expert', tiles: 3, bad: 2 },
  master: { id: 'master', name: 'Master', tiles: 4, bad: 3 },
};

export function isDifficulty(x: unknown): x is Difficulty {
  return typeof x === 'string' && (DIFFICULTIES as readonly string[]).includes(x);
}

/** Safe tiles (eggs) in a row. */
export function eggs(d: Difficulty): number {
  return SPECS[d].tiles - SPECS[d].bad;
}

/** floor(a / b) for non-negative integers, without a floating-point division. */
function idiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/** What k safe rows pay, in hundredths of the bet (132 = 1.32×). Row 0 pays nothing. */
export function multiplier(d: Difficulty, k: number): number {
  if (k < 1) return 0;
  return idiv(99 * SPECS[d].tiles ** k, eggs(d) ** k);
}

/** The whole ladder for a difficulty, rows 1 to 9. */
export function ladder(d: Difficulty): number[] {
  return Array.from({ length: LEVELS }, (_, i) => multiplier(d, i + 1));
}

/**
 * The exact return of cashing out after k safe rows, as a fraction of the bet:
 * multiplier × P(k safe rows) = m × eggs^k / (100 × tiles^k).
 */
export function returnAt(d: Difficulty, k: number): { num: number; den: number } {
  return { num: multiplier(d, k) * eggs(d) ** k, den: 100 * SPECS[d].tiles ** k };
}

/**
 * A fresh tower: for each row, bottom first, the tiles that hide the dragon (sorted). Each row
 * is an independent uniform choice of `bad` tiles out of `tiles` (a partial Fisher-Yates). The
 * engine always builds all nine; the Monte Carlo test builds only the rows a plan can reach.
 */
export function drawTower(rng: Rng, d: Difficulty, levels = LEVELS): number[][] {
  const { tiles, bad } = SPECS[d];
  const rows: number[][] = [];
  for (let r = 0; r < levels; r++) {
    const order: number[] = [];
    for (let i = 0; i < tiles; i++) order.push(i);
    for (let i = 0; i < bad; i++) {
      const j = i + randInt(rng, tiles - i);
      const t = order[i]!;
      order[i] = order[j]!;
      order[j] = t;
    }
    rows.push(order.slice(0, bad).sort((a, b) => a - b));
  }
  return rows;
}

/**
 * Where to cash out for the best exact return, given `level` rows already climbed: the row
 * j ≥ max(level, 1) whose return is highest (the lowest row on a tie). Every row returns just
 * under 99%, so this only ever moves the choice by the cent the floor takes off; the Tips line
 * says so.
 */
export function bestStop(d: Difficulty, level: number): number {
  let best = Math.max(1, level);
  for (let j = best + 1; j <= LEVELS; j++) {
    const a = returnAt(d, j);
    const b = returnAt(d, best);
    // a.num / a.den > b.num / b.den, in integers (both sides stay far below 2^53)
    if (a.num * b.den > b.num * a.den) best = j;
  }
  return best;
}
