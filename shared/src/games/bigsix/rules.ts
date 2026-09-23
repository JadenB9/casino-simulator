// Big Six (the money wheel) as data: the 54 stops of the standard Las Vegas wheel in the order
// they sit round the rim, the seven spots on the layout, and what each pays
// (docs/rules/table-games.md §7). Settlement never looks at the wheel's angle: the server draws a
// stop index uniformly and a bet wins when that stop carries the bet's symbol.
//
// The two picture stops are a joker and the house logo on a real wheel. Here they are a Star and
// a Crown, and each pays 40 to 1 on its own symbol only: a Star bet loses when the Crown comes up.

import { type Rng, randInt } from '../../rng.ts';

export const SYMBOLS = ['one', 'two', 'five', 'ten', 'twenty', 'star', 'crown'] as const;
export type SymbolId = (typeof SYMBOLS)[number];

export const STOPS = 54;

/**
 * The wheel, clockwise from the Star, as the players see it. The order is the one written in
 * 58 Pa. Code §619a.1 for a 23 × $1 / 8 × $5 wheel, with its one $5 that sits between two $2s
 * printed as a $1, which gives the Las Vegas counts (24 × $1, 7 × $5) and still never puts two
 * $1 stops side by side. The Star and the Crown sit opposite each other, as do the two $20s.
 */
export const WHEEL: readonly SymbolId[] = [
  'star', 'one', 'two', 'one', 'five', 'two', 'one', 'ten', 'one', 'five',
  'one', 'two', 'one', 'twenty', 'one', 'two', 'one', 'five', 'two', 'one',
  'ten', 'one', 'two', 'five', 'one', 'two', 'one', 'crown', 'two', 'one',
  'two', 'one', 'two', 'one', 'ten', 'one', 'five', 'one', 'two', 'one',
  'twenty', 'one', 'two', 'one', 'five', 'two', 'one', 'ten', 'one', 'two',
  'five', 'one', 'two', 'one',
];

export interface Spot {
  key: SymbolId;
  /** On the layout and in the dealer's mouth: "$20", "Star". */
  name: string;
  /** Pays `pays` to 1. */
  pays: number;
  /** Stops on the wheel that carry this symbol (the published count; tests check WHEEL against it). */
  stops: number;
}

/** The layout, left to right: the bills in rising order, then the two pictures. */
export const SPOTS: readonly Spot[] = [
  { key: 'one', name: '$1', pays: 1, stops: 24 },
  { key: 'two', name: '$2', pays: 2, stops: 15 },
  { key: 'five', name: '$5', pays: 5, stops: 7 },
  { key: 'ten', name: '$10', pays: 10, stops: 4 },
  { key: 'twenty', name: '$20', pays: 20, stops: 2 },
  { key: 'star', name: 'Star', pays: 40, stops: 1 },
  { key: 'crown', name: 'Crown', pays: 40, stops: 1 },
];

const BY_KEY = new Map<string, Spot>(SPOTS.map((s) => [s.key, s]));

export function isSymbol(x: unknown): x is SymbolId {
  return typeof x === 'string' && BY_KEY.has(x);
}

export function spotOf(key: string): Spot | null {
  return BY_KEY.get(key) ?? null;
}

/** The spin: a stop index drawn uniformly (rejection sampling in randInt), never a wheel angle. */
export function drawStop(rng: Rng): number {
  return randInt(rng, STOPS);
}

export function isStop(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < STOPS;
}

export function symbolAt(stop: number): SymbolId {
  return WHEEL[((stop % STOPS) + STOPS) % STOPS]!;
}

/** What comes back to the player for `amount` on `key` when `stop` comes up: the stake plus the win, or nothing. */
export function returnFor(key: SymbolId, stop: number, amount: number): number {
  return symbolAt(stop) === key ? amount * (BY_KEY.get(key)!.pays + 1) : 0;
}

/**
 * A bet's house edge as an exact fraction of the wager, from the stop counts:
 * (54 − stops × (pays + 1)) / 54. $1 is 6/54 = 11.11%; the Star and Crown 13/54 = 24.07%.
 */
export function edgeOf(spot: Spot): { num: number; den: number } {
  return { num: STOPS - spot.stops * (spot.pays + 1), den: STOPS };
}

export function edgePercent(spot: Spot): number {
  const e = edgeOf(spot);
  return (100 * e.num) / e.den;
}

// ---------------------------------------------------------------------------------------------
// Words for the felt, the tooltips and the dealer

export function paysLabel(spot: Spot): string {
  return `${spot.pays} to 1`;
}

/** The dealer's call when the clapper stops: "Twenty dollars", "The Star". */
export function callFor(key: SymbolId): string {
  switch (key) {
    case 'one':
      return 'One dollar';
    case 'two':
      return 'Two dollars';
    case 'five':
      return 'Five dollars';
    case 'ten':
      return 'Ten dollars';
    case 'twenty':
      return 'Twenty dollars';
    case 'star':
      return 'The Star';
    case 'crown':
      return 'The Crown';
  }
}
