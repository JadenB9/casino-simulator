// Plinko as data: boards of 8 to 16 rows of pegs, three risk levels, and the multiplier printed on
// each bin (docs/rules/online-games.md §1). The tables are Stake's, bin for bin.
//
// A drop is `rows` bounces, each left or right with probability 1/2, and the bin is the number of
// rights. The server draws the whole path as one integer below 2^rows (bit i is row i's bounce),
// so every path is equally likely and bin k comes up with probability C(rows, k) / 2^rows. The
// ball on the screen follows that path peg by peg; nothing about it is physics.

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

export const ROWS = [8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
export type Rows = (typeof ROWS)[number];

export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

export const RISK_NAMES: Record<Risk, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** Multipliers, left bin to right, as Stake prints them. Every table is symmetric. */
const PRINTED: Record<Rows, Record<Risk, readonly number[]>> = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  9: {
    low: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6],
    medium: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18],
    high: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43],
  },
  10: {
    low: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
    medium: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
    high: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
  },
  11: {
    low: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4],
    medium: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24],
    high: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  13: {
    low: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1],
    medium: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43],
    high: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260],
  },
  14: {
    low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
    medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
    high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
  },
  15: {
    low: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15],
    medium: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88],
    high: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

/**
 * The same tables in hundredths (5.6x is 560), which is what the engine pays with: a whole-dollar
 * bet times a whole number of hundredths is a whole number of cents, so no payout is ever rounded.
 */
export const MULTS = {} as Record<Rows, Record<Risk, readonly number[]>>;
for (const rows of ROWS) {
  const hundredths = (risk: Risk) => PRINTED[rows][risk].map((m) => Math.round(m * 100));
  MULTS[rows] = { low: hundredths('low'), medium: hundredths('medium'), high: hundredths('high') };
}

export function isRows(x: unknown): x is Rows {
  return typeof x === 'number' && (ROWS as readonly number[]).includes(x);
}

export function isRisk(x: unknown): x is Risk {
  return typeof x === 'string' && (RISKS as readonly string[]).includes(x);
}

/** One drop's path as an integer below 2^rows: bit i set means row i bounced the ball right. */
export function drawBits(rng: Rng, rows: number): number {
  return randInt(rng, 2 ** rows);
}

export function pathOf(bits: number, rows: number): number[] {
  return Array.from({ length: rows }, (_, i) => (bits >>> i) & 1);
}

/** The bin a path ends in: how many times it went right. */
export function binOf(bits: number): number {
  let n = 0;
  for (let b = bits; b; b &= b - 1) n++;
  return n;
}

/** What a bet comes back as in `bin` (0 counts: the lowest bins pay back less than the bet). */
export function payoutFor(bet: Cents, rows: Rows, risk: Risk, bin: number): Cents {
  return (bet / 100) * MULTS[rows][risk][bin]!;
}

/** C(n, k), exact for the small n here. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** The chance of landing in `bin`: C(rows, bin) / 2^rows. */
export function binChance(rows: number, bin: number): number {
  return choose(rows, bin) / 2 ** rows;
}

/**
 * A board's exact return as a fraction of the bet: Σ C(rows, k) · mult_k over 2^rows (the
 * multipliers in hundredths, so the denominator carries the 100).
 */
export function boardReturn(rows: Rows, risk: Risk): { num: number; den: number } {
  const m = MULTS[rows][risk];
  let num = 0;
  for (let k = 0; k <= rows; k++) num += choose(rows, k) * m[k]!;
  return { num, den: 2 ** rows * 100 };
}

/** The board's return as a number (0.98984375 for 8 rows, Low). */
export function boardRtp(rows: Rows, risk: Risk): number {
  const { num, den } = boardReturn(rows, risk);
  return num / den;
}

/** The board with the highest return, for the tips: 11 rows, High (99.16%). */
export function bestBoard(): { rows: Rows; risk: Risk; rtp: number } {
  let best = { rows: ROWS[0] as Rows, risk: RISKS[0] as Risk, rtp: 0 };
  for (const rows of ROWS) for (const risk of RISKS) {
    const rtp = boardRtp(rows, risk);
    if (rtp > best.rtp) best = { rows, risk, rtp };
  }
  return best;
}

/** Lowest and highest return over all 27 boards. */
export function returnRange(): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  for (const rows of ROWS) for (const risk of RISKS) {
    const rtp = boardRtp(rows, risk);
    min = Math.min(min, rtp);
    max = Math.max(max, rtp);
  }
  return { min, max };
}
