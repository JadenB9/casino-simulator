// Roulette rules as data: the two wheels, the colours, and every legal bet on each layout as a
// fixed table (docs/rules/table-games.md §2). Settlement never does arithmetic on pocket numbers;
// it asks whether a bet's list of covered pockets contains the one that came up. That matters
// because 00 travels as 37, and 37 is odd, above 18 and in a column, none of which 00 is.

import { type Rng, randInt } from '../../rng.ts';

export type Variant = 'american' | 'european';

/** 00 on the wire and in state. */
export const DOUBLE_ZERO = 37;

/** Pocket order, clockwise, starting from 0 (58 Pa. Code §617a.1). */
export const WHEEL: Record<Variant, readonly number[]> = {
  american: [
    0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, DOUBLE_ZERO,
    27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
  ],
  european: [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
  ],
};

export const RED: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function asVariant(v: unknown): Variant {
  return v === 'european' ? 'european' : 'american';
}

export function pocketCount(v: Variant): number {
  return v === 'american' ? 38 : 37;
}

/** The spin: a pocket index drawn uniformly (rejection sampling in randInt), never a wheel angle. */
export function drawPocket(rng: Rng, v: Variant): number {
  return randInt(rng, pocketCount(v));
}

export function isPocket(v: Variant, p: unknown): p is number {
  return typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < pocketCount(v);
}

export function pocketLabel(p: number): string {
  return p === DOUBLE_ZERO ? '00' : String(p);
}

export type PocketColor = 'red' | 'black' | 'green';

export function colorOf(p: number): PocketColor {
  if (p === 0 || p === DOUBLE_ZERO) return 'green';
  return RED.has(p) ? 'red' : 'black';
}

// ---------------------------------------------------------------------------------------------
// Bets

export const INSIDE_KINDS = ['straight', 'split', 'street', 'corner', 'sixline', 'topline', 'firstfour'] as const;
export const OUTSIDE_KINDS = [
  'red', 'black', 'odd', 'even', 'low', 'high',
  'dozen1', 'dozen2', 'dozen3', 'column1', 'column2', 'column3',
] as const;
export const BET_KINDS = [...INSIDE_KINDS, ...OUTSIDE_KINDS] as const;

export type InsideKind = (typeof INSIDE_KINDS)[number];
export type OutsideKind = (typeof OUTSIDE_KINDS)[number];
export type BetKind = InsideKind | OutsideKind;

/** One place a chip can go. `numbers` are the pockets it covers, ascending (so 00, as 37, is last). */
export interface Spot {
  key: string;
  kind: BetKind;
  numbers: readonly number[];
  /** Pays `pays` to 1. */
  pays: number;
  inside: boolean;
}

export function isInsideKind(k: string): k is InsideKind {
  return (INSIDE_KINDS as readonly string[]).includes(k);
}

export function isBetKind(k: unknown): k is BetKind {
  return typeof k === 'string' && (BET_KINDS as readonly string[]).includes(k);
}

export function spotKey(kind: BetKind, numbers: readonly number[] = []): string {
  return isInsideKind(kind) ? `${kind}:${numbers.join('-')}` : kind;
}

const range = (from: number, to: number, step = 1): number[] => {
  const out: number[] = [];
  for (let n = from; n <= to; n += step) out.push(n);
  return out;
};

/** What an inside bet covering k numbers pays: 36/k − 1, except the five-number top line (6, not 6.2). */
const INSIDE_PAYS: Record<InsideKind, number> = { straight: 35, split: 17, street: 11, corner: 8, sixline: 5, topline: 6, firstfour: 8 };

const OUTSIDE_NUMBERS: Record<OutsideKind, number[]> = {
  red: range(1, 36).filter((n) => RED.has(n)),
  black: range(1, 36).filter((n) => !RED.has(n)),
  odd: range(1, 35, 2),
  even: range(2, 36, 2),
  low: range(1, 18),
  high: range(19, 36),
  dozen1: range(1, 12),
  dozen2: range(13, 24),
  dozen3: range(25, 36),
  column1: range(1, 34, 3),
  column2: range(2, 35, 3),
  column3: range(3, 36, 3),
};

function buildSpots(v: Variant): Map<string, Spot> {
  const spots = new Map<string, Spot>();
  const addInside = (kind: InsideKind, nums: number[]) => {
    const numbers = [...nums].sort((a, b) => a - b);
    const key = spotKey(kind, numbers);
    spots.set(key, { key, kind, numbers, pays: INSIDE_PAYS[kind], inside: true });
  };
  const zeros = v === 'american' ? [0, DOUBLE_ZERO] : [0];
  for (const z of zeros) addInside('straight', [z]);
  for (let n = 1; n <= 36; n++) addInside('straight', [n]);
  // splits: side by side in a row (not across the column 3 edge), one above the other, and the zeros
  for (let n = 1; n <= 35; n++) if (n % 3 !== 0) addInside('split', [n, n + 1]);
  for (let n = 1; n <= 33; n++) addInside('split', [n, n + 3]);
  const zeroSplits = v === 'american' ? [[0, 1], [0, 2], [DOUBLE_ZERO, 2], [DOUBLE_ZERO, 3], [0, DOUBLE_ZERO]] : [[0, 1], [0, 2], [0, 3]];
  for (const s of zeroSplits) addInside('split', s);
  // streets, and the trios that include a zero (they pay 11 to 1 like any street)
  for (let r = 1; r <= 12; r++) addInside('street', [3 * r - 2, 3 * r - 1, 3 * r]);
  const trios = v === 'american' ? [[0, 1, 2], [0, DOUBLE_ZERO, 2], [DOUBLE_ZERO, 2, 3]] : [[0, 1, 2], [0, 2, 3]];
  for (const t of trios) addInside('street', t);
  for (let n = 1; n <= 32; n++) if (n % 3 !== 0) addInside('corner', [n, n + 1, n + 3, n + 4]);
  for (let r = 1; r <= 11; r++) addInside('sixline', range(3 * r - 2, 3 * r + 3));
  if (v === 'american') addInside('topline', [0, DOUBLE_ZERO, 1, 2, 3]);
  else addInside('firstfour', [0, 1, 2, 3]);
  for (const kind of OUTSIDE_KINDS) {
    const pays = kind.startsWith('dozen') || kind.startsWith('column') ? 2 : 1;
    spots.set(kind, { key: kind, kind, numbers: OUTSIDE_NUMBERS[kind], pays, inside: false });
  }
  return spots;
}

const SPOTS: Record<Variant, Map<string, Spot>> = { american: buildSpots('american'), european: buildSpots('european') };

/** Every legal bet on this layout, by key. */
export function spotsOf(v: Variant): ReadonlyMap<string, Spot> {
  return SPOTS[v];
}

export function spotByKey(v: Variant, key: string): Spot | null {
  return SPOTS[v].get(key) ?? null;
}

/**
 * A bet as a client describes it (kind plus the numbers it covers) to the one legal spot it names,
 * or null. Numbers may come in any order but not repeated; outside bets carry none. A list that
 * isn't in the table (a "split" of 1 and 5, a top line on a single-zero wheel) is simply not found.
 */
export function normalizeBet(v: Variant, kind: unknown, numbers: unknown): Spot | null {
  if (!isBetKind(kind)) return null;
  if (!isInsideKind(kind)) {
    if (numbers !== undefined && !(Array.isArray(numbers) && numbers.length === 0)) return null;
    return SPOTS[v].get(kind) ?? null;
  }
  if (!Array.isArray(numbers) || numbers.length === 0 || numbers.length > 6) return null;
  if (!numbers.every((n) => isPocket(v, n))) return null;
  const sorted = [...(numbers as number[])].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) return null;
  return SPOTS[v].get(spotKey(kind, sorted)) ?? null;
}

/** What comes back to the player for `amount` on `spot` when `pocket` hits: the stake plus the win, or nothing. */
export function returnFor(spot: Spot, pocket: number, amount: number): number {
  return spot.numbers.includes(pocket) ? amount * (spot.pays + 1) : 0;
}

// ---------------------------------------------------------------------------------------------
// Words for the felt, the tooltips and the dealer

/** Display order puts 00 right after 0. */
function labelOrder(a: number, b: number): number {
  const k = (n: number) => (n === DOUBLE_ZERO ? 0.5 : n);
  return k(a) - k(b);
}

export function numbersLabel(numbers: readonly number[]): string {
  return [...numbers].sort(labelOrder).map(pocketLabel).join('-');
}

const OUTSIDE_NAMES: Record<OutsideKind, string> = {
  red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1 to 18', high: '19 to 36',
  dozen1: '1st 12', dozen2: '2nd 12', dozen3: '3rd 12', column1: 'Column 1', column2: 'Column 2', column3: 'Column 3',
};

/** "Split 17-20", "Trio 0-00-2", "Top line 0-00-1-2-3", "Red", "2nd 12". Named by the numbers covered. */
export function spotName(spot: Spot): string {
  if (!isInsideKind(spot.kind)) return OUTSIDE_NAMES[spot.kind];
  const nums = spot.numbers;
  switch (spot.kind) {
    case 'straight':
      return `Straight ${pocketLabel(nums[0]!)}`;
    case 'split':
      return `Split ${numbersLabel(nums)}`;
    case 'street':
      return nums.includes(0) || nums.includes(DOUBLE_ZERO) ? `Trio ${numbersLabel(nums)}` : `Street ${numbersLabel(nums)}`;
    case 'corner':
      return `Corner ${numbersLabel(nums)}`;
    case 'sixline':
      return `Six line ${nums[0]}-${nums[nums.length - 1]}`;
    case 'topline':
      return `Top line ${numbersLabel(nums)}`;
    case 'firstfour':
      return `First four ${numbersLabel(nums)}`;
  }
}

export function paysLabel(spot: Spot): string {
  return `${spot.pays} to 1`;
}

/** The dealer's call and the outside results: "17 BLACK" and "ODD · 1-18 · 2nd 12 · Column 2". */
export function describePocket(p: number): { call: string; detail: string; color: PocketColor } {
  const color = colorOf(p);
  const call = `${pocketLabel(p)} ${color.toUpperCase()}`;
  if (color === 'green') return { call, detail: 'Outside bets lose', color };
  const parts = [
    p % 2 === 1 ? 'ODD' : 'EVEN',
    p <= 18 ? '1-18' : '19-36',
    p <= 12 ? '1st 12' : p <= 24 ? '2nd 12' : '3rd 12',
    `Column ${((p - 1) % 3) + 1}`,
  ];
  return { call, detail: parts.join(' · '), color };
}

/** Where each pocket sits on the wheel (index into WHEEL[v]). */
export function wheelIndex(v: Variant, p: number): number {
  return WHEEL[v].indexOf(p);
}
