// The Bandit Wheel: the big wheel from Rust's Bandit Camp as data (docs/rules/table-games.md §9).
// Twenty-five painted slots in the order they sit round the rim, five numbers to bet on, and what
// each pays. Settlement never looks at the wheel's angle: the server draws a slot index uniformly
// and a bet wins when that slot carries the bet's number.
//
// A win returns the stake plus the number times the stake, as in Rust ("you get your original bet
// back plus whatever the number was as a multiplier"), so 1 pays 1 to 1 and 20 pays 20 to 1.

import { type Rng, randInt } from '../../rng.ts';

export const NUMBERS = [1, 3, 5, 10, 20] as const;
export type WheelNumber = (typeof NUMBERS)[number];

export const SLOTS = 25;

/**
 * The wheel, clockwise from the 20 as the players see it. This is the in-game order two separate
 * trackers of the Rust wheel copied off it (docs §9.2): the twelve 1s never touch each other, and
 * the 20 sits between two 1s.
 */
export const WHEEL: readonly WheelNumber[] = [
  20, 1, 3, 1, 5, 1, 3, 1, 10, 1, 3, 1, 5,
  1, 5, 3, 1, 10, 1, 3, 1, 5, 1, 3, 1,
];

export interface Spot {
  key: WheelNumber;
  /** Pays `pays` to 1: the number itself. */
  pays: number;
  /** Slots on the wheel that carry this number (the published count; tests check WHEEL against it). */
  slots: number;
  /** The paint on its slots, as Rust has it. */
  colour: 'yellow' | 'green' | 'blue' | 'purple' | 'red';
}

/** The five bets, lowest first, as they sit on every terminal. */
export const SPOTS: readonly Spot[] = [
  { key: 1, pays: 1, slots: 12, colour: 'yellow' },
  { key: 3, pays: 3, slots: 6, colour: 'green' },
  { key: 5, pays: 5, slots: 4, colour: 'blue' },
  { key: 10, pays: 10, slots: 2, colour: 'purple' },
  { key: 20, pays: 20, slots: 1, colour: 'red' },
];

const BY_KEY = new Map<number, Spot>(SPOTS.map((s) => [s.key, s]));

export function isNumber(x: unknown): x is WheelNumber {
  return typeof x === 'number' && BY_KEY.has(x);
}

export function spotOf(key: number): Spot | null {
  return BY_KEY.get(key) ?? null;
}

/** The spin: a slot index drawn uniformly (rejection sampling in randInt), never a wheel angle. */
export function drawSlot(rng: Rng): number {
  return randInt(rng, SLOTS);
}

export function isSlot(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < SLOTS;
}

export function numberAt(slot: number): WheelNumber {
  return WHEEL[((slot % SLOTS) + SLOTS) % SLOTS]!;
}

/** What comes back for `amount` on `key` when `slot` comes up: the stake plus the win, or nothing. */
export function returnFor(key: WheelNumber, slot: number, amount: number): number {
  return numberAt(slot) === key ? amount * (key + 1) : 0;
}

/**
 * A bet's house edge as an exact fraction of the wager: (25 − slots × (pays + 1)) / 25.
 * 1, 3 and 5 are all 1/25 = 4%; 10 is 3/25 = 12%; 20 is 4/25 = 16%.
 */
export function edgeOf(spot: Spot): { num: number; den: number } {
  return { num: SLOTS - spot.slots * (spot.pays + 1), den: SLOTS };
}

export function edgePercent(spot: Spot): number {
  const e = edgeOf(spot);
  return (100 * e.num) / e.den;
}

export function paysLabel(spot: Spot): string {
  return `${spot.pays} to 1`;
}

/** The call when the wheel stops: "Twenty", "Three". */
export function callFor(key: WheelNumber): string {
  switch (key) {
    case 1:
      return 'One';
    case 3:
      return 'Three';
    case 5:
      return 'Five';
    case 10:
      return 'Ten';
    case 20:
      return 'Twenty';
  }
}
