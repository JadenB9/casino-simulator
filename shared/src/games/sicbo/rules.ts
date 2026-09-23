// Sic Bo rules as data: three dice, every place on the layout a chip can go, and what each one
// pays (docs/rules/table-games.md, Sic Bo). Settlement only looks at the three faces, so the same
// few functions settle the engine's rounds, the Monte Carlo runs and the exact enumeration.
//
// The pays are the usual US table (the Wizard of Odds "Atlantic City" column): 180 to 1 on a
// specific triple, 30 to 1 any triple, 10 to 1 a double, 60 to 1 on 4 and 17, 5 to 1 a two-dice
// combination, and 1, 2 or 3 to 1 on a single number by how many dice show it. Small, Big, Odd and
// Even pay even money and lose to any triple.

import { type Rng, randInt } from '../../rng.ts';
import type { Cents } from '../../money.ts';

/** Three faces, in the order the dice came out. */
export type Dice = [number, number, number];

export type BetKind = 'small' | 'big' | 'odd' | 'even' | 'total' | 'triple' | 'anytriple' | 'double' | 'combo' | 'single';

/** Which table limit a bet falls under (TableConfig.limits). */
export type LimitKey = 'even' | 'single' | 'prop' | 'triple';

/** One place a chip can go. */
export interface Spot {
  /** 'small', 'total:10', 'triple:6', 'double:5', 'combo:2-5', 'single:4', 'anytriple' ... */
  key: string;
  kind: BetKind;
  /** total: the sum; triple, double, single: the face; combo: the two faces, low first; else none. */
  numbers: readonly number[];
  /** Pays `pays` to 1. A single number pays this for one die, and more for two or three (SINGLE_PAYS). */
  pays: number;
  limit: LimitKey;
}

/** Total bets, 4 through 17 (3 and 18 are only ever triples, and no layout offers them). */
export const TOTAL_PAYS: Readonly<Record<number, number>> = {
  4: 60, 5: 30, 6: 17, 7: 12, 8: 8, 9: 6, 10: 6,
  11: 6, 12: 6, 13: 8, 14: 12, 15: 17, 16: 30, 17: 60,
};

/** A single number pays by how many of the three dice show it. */
export const SINGLE_PAYS: Readonly<Record<number, number>> = { 1: 1, 2: 2, 3: 3 };

export const TRIPLE_PAYS = 180;
export const ANY_TRIPLE_PAYS = 30;
export const DOUBLE_PAYS = 10;
export const COMBO_PAYS = 5;

function buildSpots(): Map<string, Spot> {
  const spots = new Map<string, Spot>();
  const add = (key: string, kind: BetKind, numbers: number[], pays: number, limit: LimitKey) => spots.set(key, { key, kind, numbers, pays, limit });
  add('small', 'small', [], 1, 'even');
  add('big', 'big', [], 1, 'even');
  add('odd', 'odd', [], 1, 'even');
  add('even', 'even', [], 1, 'even');
  for (let t = 4; t <= 17; t++) add(`total:${t}`, 'total', [t], TOTAL_PAYS[t]!, 'prop');
  for (let f = 1; f <= 6; f++) add(`triple:${f}`, 'triple', [f], TRIPLE_PAYS, 'triple');
  add('anytriple', 'anytriple', [], ANY_TRIPLE_PAYS, 'prop');
  for (let f = 1; f <= 6; f++) add(`double:${f}`, 'double', [f], DOUBLE_PAYS, 'prop');
  for (let a = 1; a <= 5; a++) for (let b = a + 1; b <= 6; b++) add(`combo:${a}-${b}`, 'combo', [a, b], COMBO_PAYS, 'prop');
  for (let f = 1; f <= 6; f++) add(`single:${f}`, 'single', [f], SINGLE_PAYS[1]!, 'single');
  return spots;
}

const SPOTS = buildSpots();

/** Every bet on the layout, by key (52 of them). */
export function spots(): ReadonlyMap<string, Spot> {
  return SPOTS;
}

export function spotByKey(key: unknown): Spot | null {
  return typeof key === 'string' ? (SPOTS.get(key) ?? null) : null;
}

// ---------------------------------------------------------------------------------------------
// The dice

/** One roll: each die drawn uniformly (rejection sampling in randInt), independently. */
export function rollDice(rng: Rng): Dice {
  return [randInt(rng, 6) + 1, randInt(rng, 6) + 1, randInt(rng, 6) + 1];
}

export function isFace(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 6;
}

export function diceTotal(d: readonly number[]): number {
  return d[0]! + d[1]! + d[2]!;
}

export function isTriple(d: readonly number[]): boolean {
  return d[0] === d[1] && d[1] === d[2];
}

export function countOf(d: readonly number[], face: number): number {
  return (d[0] === face ? 1 : 0) + (d[1] === face ? 1 : 0) + (d[2] === face ? 1 : 0);
}

/** Lowest first, the way the dealer calls them and the board shows them. */
export function sorted(d: readonly number[]): Dice {
  return [...d].sort((a, b) => a - b) as Dice;
}

/** All 216 ordered rolls, each equally likely. */
export function allRolls(): Dice[] {
  const out: Dice[] = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) out.push([a, b, c]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Settlement

/** The k of "k to 1" a bet wins on this roll, or null when it loses. */
export function winPays(spot: Spot, d: readonly number[]): number | null {
  const t = diceTotal(d);
  const triple = isTriple(d);
  switch (spot.kind) {
    case 'small':
      return !triple && t >= 4 && t <= 10 ? 1 : null;
    case 'big':
      return !triple && t >= 11 && t <= 17 ? 1 : null;
    case 'odd':
      return !triple && t % 2 === 1 ? 1 : null;
    case 'even':
      return !triple && t % 2 === 0 ? 1 : null;
    case 'total':
      // a triple makes its total like any other roll (2-2-2 is a 6)
      return t === spot.numbers[0] ? spot.pays : null;
    case 'triple':
      return triple && d[0] === spot.numbers[0] ? spot.pays : null;
    case 'anytriple':
      return triple ? spot.pays : null;
    case 'double':
      // two or three of the face: a triple also makes every double of its number
      return countOf(d, spot.numbers[0]!) >= 2 ? spot.pays : null;
    case 'combo':
      // paid once, however many of either face show
      return countOf(d, spot.numbers[0]!) > 0 && countOf(d, spot.numbers[1]!) > 0 ? spot.pays : null;
    case 'single': {
      const n = countOf(d, spot.numbers[0]!);
      return n > 0 ? SINGLE_PAYS[n]! : null;
    }
  }
}

/** What comes back to the player for `amount` on `spot`: the stake plus the win, or nothing. */
export function returnFor(spot: Spot, d: readonly number[], amount: Cents): Cents {
  const k = winPays(spot, d);
  return k === null ? 0 : amount * (k + 1);
}

/** Units returned on a 1-unit bet, summed over all 216 rolls. The house edge is (216 − this) / 216. */
export function returnOver216(spot: Spot): number {
  let sum = 0;
  for (const d of allRolls()) sum += returnFor(spot, d, 1);
  return sum;
}

const edges = new Map<string, number>();

/** The exact house edge of a bet, from all 216 rolls (0.0278 for Small). */
export function houseEdge(spot: Spot): number {
  let e = edges.get(spot.key);
  if (e === undefined) {
    e = (216 - returnOver216(spot)) / 216;
    edges.set(spot.key, e);
  }
  return e;
}

// ---------------------------------------------------------------------------------------------
// Words for the felt, the tooltips and the dealer

const FACE_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
const FACE_PLURALS = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const TOTAL_WORDS = ['', '', '', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function facePlural(face: number): string {
  return FACE_PLURALS[face]!;
}

/** "Small 4-10", "Total 10", "Triple 6-6-6", "Double 5-5", "Two dice 2-5", "Single 4". */
export function spotName(spot: Spot): string {
  const [a, b] = spot.numbers;
  switch (spot.kind) {
    case 'small':
      return 'Small 4-10';
    case 'big':
      return 'Big 11-17';
    case 'odd':
      return 'Odd';
    case 'even':
      return 'Even';
    case 'total':
      return `Total ${a}`;
    case 'triple':
      return `Triple ${a}-${a}-${a}`;
    case 'anytriple':
      return 'Any triple';
    case 'double':
      return `Double ${a}-${a}`;
    case 'combo':
      return `Two dice ${a}-${b}`;
    case 'single':
      return `Single ${a}`;
  }
}

/** "1 to 1", "60 to 1", "1, 2 or 3 to 1". */
export function paysLabel(spot: Spot): string {
  return spot.kind === 'single' ? '1, 2 or 3 to 1' : `${spot.pays} to 1`;
}

/** What wins a bet, in a line: for the tooltips and the rules panel. */
export function spotRule(spot: Spot): string {
  const [a, b] = spot.numbers;
  switch (spot.kind) {
    case 'small':
      return 'Wins on a total of 4 to 10. Loses to any triple.';
    case 'big':
      return 'Wins on a total of 11 to 17. Loses to any triple.';
    case 'odd':
      return 'Wins on an odd total. Loses to any triple.';
    case 'even':
      return 'Wins on an even total. Loses to any triple.';
    case 'total':
      return `Wins when the three dice add up to ${a}.`;
    case 'triple':
      return `Wins when all three dice show ${a}.`;
    case 'anytriple':
      return 'Wins when all three dice match.';
    case 'double':
      return `Wins when at least two dice show ${a}.`;
    case 'combo':
      return `Wins when a ${a} and a ${b} both show.`;
    case 'single':
      return `Pays 1 to 1 for each die showing ${a}: one pays 1, two pay 2, three pay 3.`;
  }
}

/**
 * The dealer's call, faces lowest first: "Two, three, five. Ten, small." A triple is called as
 * one: "Three, three, three. Triple threes."
 */
export function callRoll(d: readonly number[]): string {
  const s = sorted(d);
  const faces = `${cap(FACE_WORDS[s[0]]!)}, ${FACE_WORDS[s[1]]}, ${FACE_WORDS[s[2]]}.`;
  if (isTriple(s)) return `${faces} Triple ${FACE_PLURALS[s[0]]}.`;
  const t = diceTotal(s);
  return `${faces} ${cap(TOTAL_WORDS[t]!)}, ${t <= 10 ? 'small' : 'big'}.`;
}

/** The result board: "14", "BIG · EVEN", or for a triple "TRIPLE 3s" and what it beat. */
export function describeRoll(d: readonly number[]): { total: number; tag: string; detail: string } {
  const t = diceTotal(d);
  if (isTriple(d)) return { total: t, tag: `TRIPLE ${d[0]}s`, detail: 'Small, Big, Odd and Even lose' };
  return { total: t, tag: t <= 10 ? 'SMALL' : 'BIG', detail: `${t <= 10 ? 'SMALL' : 'BIG'} · ${t % 2 ? 'ODD' : 'EVEN'}` };
}
