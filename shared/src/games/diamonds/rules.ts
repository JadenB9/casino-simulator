// Diamonds as numbers (docs/rules/online-games.md §12). Five gems are drawn, each one of seven
// colours with equal chance and independently of the others, and the hand pays by how the colours
// group, the way a poker hand does:
//
//   Five of a kind   66.99×          7 of the 16,807 hands
//   Four of a kind    5.00×        210
//   Full house        4.00×        420
//   Three of a kind   3.00×      2,100
//   Two pair          2.00×      3,150
//   Pair              0.10×      8,400
//   Nothing           0          2,520
//
// That is Stake's Diamonds table with five of a kind raised from 50× to 66.99×, which takes the
// return from 98.29% to exactly 99%: 1,663,893 hundredths over 16,807 hands of 100 is 0.99. Every
// hand but five of a kind comes in multiples of 7 × 30 hands, so no rounder figure for it lands on
// 99% exactly.

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

export const COLORS = 7;
export const GEMS = 5;

export const GEM_NAMES = ['Emerald', 'Sapphire', 'Ruby', 'Amethyst', 'Topaz', 'Aquamarine', 'Rose'] as const;

export const PATTERNS = ['five', 'four', 'fullhouse', 'three', 'twopair', 'pair', 'none'] as const;
export type Pattern = (typeof PATTERNS)[number];

export const PATTERN_NAMES: Record<Pattern, string> = {
  five: 'Five of a kind',
  four: 'Four of a kind',
  fullhouse: 'Full house',
  three: 'Three of a kind',
  twopair: 'Two pair',
  pair: 'Pair',
  none: 'No match',
};

/** What each pattern pays, in hundredths of the bet. */
export const PAYS: Record<Pattern, number> = { five: 6_699, four: 500, fullhouse: 400, three: 300, twopair: 200, pair: 10, none: 0 };

/** How many of the 7^5 = 16,807 equally likely hands make each pattern. */
export const WAYS: Record<Pattern, number> = { five: 7, four: 210, fullhouse: 420, three: 2_100, twopair: 3_150, pair: 8_400, none: 2_520 };

export const HANDS = COLORS ** GEMS;

/** Five gems, each a colour 0-6. */
export function drawGems(rng: Rng): number[] {
  return Array.from({ length: GEMS }, () => randInt(rng, COLORS));
}

/** The colours' group sizes, largest first: [3, 2] is a full house. */
export function groups(gems: readonly number[]): number[] {
  const counts = new Array<number>(COLORS).fill(0);
  for (const g of gems) counts[g]!++;
  return counts.filter((c) => c > 0).sort((a, b) => b - a);
}

export function patternOf(gems: readonly number[]): Pattern {
  const [a = 0, b = 0] = groups(gems);
  if (a === 5) return 'five';
  if (a === 4) return 'four';
  if (a === 3) return b === 2 ? 'fullhouse' : 'three';
  if (a === 2) return b === 2 ? 'twopair' : 'pair';
  return 'none';
}

/** The gems that make the pattern (every gem in a group of two or more). */
export function matched(gems: readonly number[]): boolean[] {
  const counts = new Array<number>(COLORS).fill(0);
  for (const g of gems) counts[g]!++;
  return gems.map((g) => counts[g]! >= 2);
}

/** A whole-dollar bet times hundredths is whole cents. */
export function payoutFor(bet: Cents, pattern: Pattern): Cents {
  return (bet / 100) * PAYS[pattern];
}

/** The exact return: Σ ways × pays over 100 × 7^5. */
export function exactReturn(): { num: number; den: number } {
  let num = 0;
  for (const p of PATTERNS) num += WAYS[p] * PAYS[p];
  return { num, den: 100 * HANDS };
}
