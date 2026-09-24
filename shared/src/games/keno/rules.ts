// Keno as data (docs/rules/online-games.md §4): a board of 40 numbers, 1 to 10 of them picked by
// the player, 10 drawn by the server. The pay depends on how many picks were drawn ("hits") and
// on the risk level, from Stake's four paytables: Classic, Low, Medium and High.
//
// The draw is a partial Fisher-Yates shuffle of 1-40 that stops after ten numbers, so every ordered
// draw of ten is equally likely and the numbers come out in the order the page reveals them. With
// p picks, the chance of h hits is hypergeometric: C(p, h) · C(40 - p, 10 - h) / C(40, 10).

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

export const NUMBERS = 40;
export const DRAWN = 10;
export const MAX_PICKS = 10;

export const RISKS = ['classic', 'low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

export const RISK_NAMES: Record<Risk, string> = { classic: 'Classic', low: 'Low', medium: 'Medium', high: 'High' };

/** Multipliers by picks (row 0 is one pick), indexed by hits, as Stake prints them. */
const PRINTED: Record<Risk, readonly (readonly number[])[]> = {
  classic: [
    [0, 3.96],
    [0, 1.9, 4.5],
    [0, 1, 3.1, 10.4],
    [0, 0.8, 1.8, 5, 22.5],
    [0, 0.25, 1.4, 4.1, 16.5, 36],
    [0, 0, 1, 3.68, 7, 16.5, 40],
    [0, 0, 0.47, 3, 4.5, 14, 31, 60],
    [0, 0, 0, 2.2, 4, 13, 22, 55, 70],
    [0, 0, 0, 1.55, 3, 8, 15, 44, 60, 85],
    [0, 0, 0, 1.4, 2.25, 4.5, 8, 17, 50, 80, 100],
  ],
  low: [
    [0.7, 1.85],
    [0, 2, 3.8],
    [0, 1.1, 1.38, 26],
    [0, 0, 2.2, 7.9, 90],
    [0, 0, 1.5, 4.2, 13, 300],
    [0, 0, 1.1, 2, 6.2, 100, 700],
    [0, 0, 1.1, 1.6, 3.5, 15, 225, 700],
    [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800],
    [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000],
    [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000],
  ],
  medium: [
    [0.4, 2.75],
    [0, 1.8, 5.1],
    [0, 0, 2.8, 50],
    [0, 0, 1.7, 10, 100],
    [0, 0, 1.4, 4, 14, 390],
    [0, 0, 0, 3, 9, 180, 710],
    [0, 0, 0, 2, 7, 30, 400, 800],
    [0, 0, 0, 2, 4, 11, 67, 400, 900],
    [0, 0, 0, 2, 2.5, 5, 15, 100, 500, 1000],
    [0, 0, 0, 1.6, 2, 4, 7, 26, 100, 500, 1000],
  ],
  high: [
    [0, 3.96],
    [0, 0, 17.1],
    [0, 0, 0, 81.5],
    [0, 0, 0, 10, 259],
    [0, 0, 0, 4.5, 48, 450],
    [0, 0, 0, 0, 11, 350, 710],
    [0, 0, 0, 0, 7, 90, 400, 800],
    [0, 0, 0, 0, 5, 20, 270, 600, 900],
    [0, 0, 0, 0, 4, 11, 56, 500, 800, 1000],
    [0, 0, 0, 0, 3.5, 8, 13, 63, 500, 800, 1000],
  ],
};

/** The paytables in hundredths (3.96x is 396): whole-dollar bets are then paid in whole cents. */
export const PAYS = {} as Record<Risk, readonly (readonly number[])[]>;
for (const risk of RISKS) PAYS[risk] = PRINTED[risk].map((row) => row.map((m) => Math.round(m * 100)));

export function isRisk(x: unknown): x is Risk {
  return typeof x === 'string' && (RISKS as readonly string[]).includes(x);
}

/** 1 to 10 different numbers from 1 to 40. */
export function isPicks(x: unknown): x is number[] {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_PICKS) return false;
  const seen = new Set<number>();
  for (const n of x) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > NUMBERS || seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}

/** Ten different numbers from 1 to 40, in the order they are drawn. */
export function drawNumbers(rng: Rng): number[] {
  const pool = Array.from({ length: NUMBERS }, (_, i) => i + 1);
  for (let i = 0; i < DRAWN; i++) {
    const j = i + randInt(rng, NUMBERS - i);
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  return pool.slice(0, DRAWN);
}

export function countHits(picks: readonly number[], drawn: readonly number[]): number {
  let n = 0;
  for (const d of drawn) if (picks.includes(d)) n++;
  return n;
}

/** The multiplier (hundredths) for `hits` with `picks` numbers picked at this risk. */
export function multFor(risk: Risk, picks: number, hits: number): number {
  return PAYS[risk][picks - 1]![hits]!;
}

export function payoutFor(bet: Cents, risk: Risk, picks: number, hits: number): Cents {
  return (bet / 100) * multFor(risk, picks, hits);
}

/** C(n, k) exactly (every one here is below 2^53). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Draws of ten (as sets) in which `picks` numbers score `hits`: C(p, h) · C(40 - p, 10 - h). */
export function hitWays(picks: number, hits: number): number {
  return choose(picks, hits) * choose(NUMBERS - picks, DRAWN - hits);
}

/** C(40, 10) = 847,660,528 sets of ten. */
export const DRAWS = choose(NUMBERS, DRAWN);

export function hitChance(picks: number, hits: number): number {
  return hitWays(picks, hits) / DRAWS;
}

/** A paytable's exact return as a fraction of the bet: Σ ways(h) · mult_h over C(40, 10) · 100. */
export function tableReturn(risk: Risk, picks: number): { num: number; den: number } {
  let num = 0;
  for (let h = 0; h <= picks; h++) num += hitWays(picks, h) * multFor(risk, picks, h);
  return { num, den: DRAWS * 100 };
}

export function tableRtp(risk: Risk, picks: number): number {
  const { num, den } = tableReturn(risk, picks);
  return num / den;
}

/** The best and worst tables over every risk and pick count, for the tips. */
export function returnRange(): { min: number; max: number; best: { risk: Risk; picks: number } } {
  let min = Infinity;
  let max = 0;
  let best = { risk: RISKS[0] as Risk, picks: 1 };
  for (const risk of RISKS) for (let p = 1; p <= MAX_PICKS; p++) {
    const r = tableRtp(risk, p);
    min = Math.min(min, r);
    if (r > max) {
      max = r;
      best = { risk, picks: p };
    }
  }
  return { min, max, best };
}
