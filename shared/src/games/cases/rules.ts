// Cases as data (docs/rules/online-games.md §11). A case costs the bet and holds one item, drawn
// by the server from the case's list: each item has a weight out of 1,000,000 and a multiplier,
// and the item's multiplier times the bet comes back. Four cases, from a Starter case that keeps
// most of the stake most of the time to a Vault with a 1,000× briefcase in it.
//
// Every case returns exactly 99%: Σ weight × multiplier (in hundredths) is 99 × 1,000,000 for each
// one. The weights of the two cheapest items were solved for that; the rest follow a smooth
// curve down to the top item.

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

/** Every case's weights add to this: an item's chance is its weight in a million. */
export const WEIGHT = 1_000_000;

export const CASES = ['starter', 'classic', 'highroller', 'vault'] as const;
export type CaseId = (typeof CASES)[number];

/** What an item looks like: the page draws one picture per kind. */
export type ItemKind = 'chip' | 'dice' | 'card' | 'horseshoe' | 'cherry' | 'coin' | 'watch' | 'ring' | 'bar' | 'seven' | 'gem' | 'crown' | 'trophy' | 'briefcase';

export interface CaseItem {
  name: string;
  kind: ItemKind;
  /** Hundredths of the bet. */
  mult: number;
  weight: number;
}

export interface CaseInfo {
  id: CaseId;
  name: string;
  /** One line under the name on the page. */
  about: string;
  /** Cheapest item first. */
  items: readonly CaseItem[];
}

const item = (name: string, kind: ItemKind, mult: number, weight: number): CaseItem => ({ name, kind, mult, weight });

export const CASE_INFO: Record<CaseId, CaseInfo> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    about: 'Up to 10×, and more than the stake a third of the time',
    items: [
      item('Clay Chip', 'chip', 20, 215_925),
      item('Pair of Dice', 'dice', 50, 216_824),
      item('Ace of Spades', 'card', 80, 226_900),
      item('Lucky Horseshoe', 'horseshoe', 120, 136_140),
      item('Cherries', 'cherry', 150, 90_760),
      item('Silver Dollar', 'coin', 200, 56_725),
      item('Pocket Watch', 'watch', 300, 34_035),
      item('Gold Ring', 'ring', 500, 17_018),
      item('Gold Bar', 'bar', 1_000, 5_673),
    ],
  },
  classic: {
    id: 'classic',
    name: 'Classic',
    about: 'Up to 50×: a Lucky Seven in every 680 cases',
    items: [
      item('Clay Chip', 'chip', 10, 300_215),
      item('Pair of Dice', 'dice', 30, 233_795),
      item('Ace of Spades', 'card', 60, 176_400),
      item('Lucky Horseshoe', 'horseshoe', 100, 117_600),
      item('Cherries', 'cherry', 150, 78_400),
      item('Silver Dollar', 'coin', 250, 49_000),
      item('Pocket Watch', 'watch', 500, 27_440),
      item('Gold Ring', 'ring', 1_000, 11_760),
      item('Gold Bar', 'bar', 2_500, 3_920),
      item('Lucky Seven', 'seven', 5_000, 1_470),
    ],
  },
  highroller: {
    id: 'highroller',
    name: 'High Roller',
    about: 'Up to 250×: the Champion Trophy in every 4,386',
    items: [
      item('Clay Chip', 'chip', 10, 376_340),
      item('Pair of Dice', 'dice', 25, 249_004),
      item('Ace of Spades', 'card', 50, 171_180),
      item('Silver Dollar', 'coin', 100, 91_296),
      item('Pocket Watch', 'watch', 200, 57_060),
      item('Gold Ring', 'ring', 400, 34_236),
      item('Gold Bar', 'bar', 1_000, 13_694),
      item('Lucky Seven', 'seven', 2_500, 4_565),
      item('Blue Diamond', 'gem', 5_000, 1_712),
      item('Gold Crown', 'crown', 10_000, 685),
      item('Champion Trophy', 'trophy', 25_000, 228),
    ],
  },
  vault: {
    id: 'vault',
    name: 'Vault',
    about: 'Up to 1,000×: the Briefcase in every 17,544',
    items: [
      item('Clay Chip', 'chip', 5, 390_800),
      item('Pair of Dice', 'dice', 20, 262_850),
      item('Ace of Spades', 'card', 50, 158_564),
      item('Silver Dollar', 'coin', 100, 90_608),
      item('Pocket Watch', 'watch', 200, 56_630),
      item('Gold Ring', 'ring', 500, 28_315),
      item('Gold Bar', 'bar', 1_500, 9_061),
      item('Lucky Seven', 'seven', 5_000, 2_265),
      item('Blue Diamond', 'gem', 15_000, 680),
      item('Gold Crown', 'crown', 50_000, 170),
      item('Briefcase of Cash', 'briefcase', 100_000, 57),
    ],
  },
};

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exotic'] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_NAMES: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
  exotic: 'Exotic',
};

/** An item's rarity follows from what it pays: under the stake is common, 500× and up exotic. */
export function rarityOf(mult: number): Rarity {
  if (mult < 100) return 'common';
  if (mult < 200) return 'uncommon';
  if (mult < 500) return 'rare';
  if (mult < 2_000) return 'epic';
  if (mult < 10_000) return 'legendary';
  if (mult < 50_000) return 'mythic';
  return 'exotic';
}

export function isCase(x: unknown): x is CaseId {
  return typeof x === 'string' && (CASES as readonly string[]).includes(x);
}

/** The item at a draw below WEIGHT: the items laid end to end, cheapest first. */
export function itemAt(id: CaseId, r: number): number {
  const items = CASE_INFO[id].items;
  for (let i = 0; i < items.length; i++) {
    r -= items[i]!.weight;
    if (r < 0) return i;
  }
  return items.length - 1;
}

/** The item in the case: weight in a million. */
export function drawItem(rng: Rng, id: CaseId): number {
  return itemAt(id, randInt(rng, WEIGHT));
}

/** A whole-dollar bet times hundredths is whole cents. */
export function payoutFor(bet: Cents, id: CaseId, index: number): Cents {
  return (bet / 100) * CASE_INFO[id].items[index]!.mult;
}

/** A case's exact return: Σ weight × multiplier over 100 × WEIGHT. */
export function caseReturn(id: CaseId): { num: number; den: number } {
  let num = 0;
  for (const it of CASE_INFO[id].items) num += it.weight * it.mult;
  return { num, den: 100 * WEIGHT };
}
