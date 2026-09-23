// Basic strategy for exactly these rules (6 decks, S17, DAS, late surrender, peek), copied from
// the code-ready chart in docs/rules/table-games.md §1.4. The Monte Carlo test plays it to
// measure the house edge; the unit test checks every cell against its own copy of the chart.
//
// One character per dealer up card, in the order 2 3 4 5 6 7 8 9 T A.
//   H hit · S stand · D double, else hit · B double, else stand · R surrender, else hit
//   Pairs: Y split · N play the hand as its total

import type { Card } from '../../cards.ts';
import { cardValue, handTotal, type Move } from './rules.ts';

export const HARD_CHART: readonly (readonly [string, string])[] = [
  ['5-8', 'HHHHHHHHHH'],
  ['9', 'HDDDDHHHHH'],
  ['10', 'DDDDDDDDHH'],
  ['11', 'DDDDDDDDDH'],
  ['12', 'HHSSSHHHHH'],
  ['13', 'SSSSSHHHHH'],
  ['14', 'SSSSSHHHHH'],
  ['15', 'SSSSSHHHRH'],
  ['16', 'SSSSSHHRRR'],
  ['17+', 'SSSSSSSSSS'],
];

export const SOFT_CHART: readonly (readonly [string, string])[] = [
  ['A2', 'HHHDDHHHHH'],
  ['A3', 'HHHDDHHHHH'],
  ['A4', 'HHDDDHHHHH'],
  ['A5', 'HHDDDHHHHH'],
  ['A6', 'HDDDDHHHHH'],
  ['A7', 'SBBBBSSHHH'],
  ['A8', 'SSSSSSSSSS'],
  ['A9', 'SSSSSSSSSS'],
];

export const PAIR_CHART: readonly (readonly [string, string])[] = [
  ['AA', 'YYYYYYYYYY'],
  ['TT', 'NNNNNNNNNN'],
  ['99', 'YYYYYNYYNN'],
  ['88', 'YYYYYYYYYY'],
  ['77', 'YYYYYYNNNN'],
  ['66', 'YYYYYNNNNN'],
  ['55', 'NNNNNNNNNN'],
  ['44', 'NNNYYNNNNN'],
  ['33', 'YYYYYYNNNN'],
  ['22', 'YYYYYYNNNN'],
];

/** Column for a dealer up-card value: 2..9 are columns 0..7, ten is 8, ace (1) is 9. */
export function column(upValue: number): number {
  return upValue === 1 ? 9 : upValue - 2;
}

function row(chart: readonly (readonly [string, string])[], key: string): string {
  const r = chart.find(([k]) => k === key);
  if (!r) throw new Error(`strategy chart has no row ${key}`);
  return r[1];
}

// Rows by total, built once from the chart above so the chart stays the single source.
const HARD_BY_TOTAL: string[] = [];
for (let t = 4; t <= 21; t++) HARD_BY_TOTAL[t] = row(HARD_CHART, t <= 8 ? '5-8' : t >= 17 ? '17+' : String(t));
const SOFT_BY_TOTAL: string[] = [];
for (let t = 13; t <= 20; t++) SOFT_BY_TOTAL[t] = row(SOFT_CHART, `A${t - 11}`);
SOFT_BY_TOTAL[12] = 'HHHHHHHHHH'; // A-A that can't be split: never stand on soft 12
SOFT_BY_TOTAL[21] = 'SSSSSSSSSS';
const PAIR_BY_VALUE: string[] = [];
for (let v = 1; v <= 10; v++) PAIR_BY_VALUE[v] = row(PAIR_CHART, v === 1 ? 'AA' : v === 10 ? 'TT' : `${v}${v}`);

export type ChartCode = 'H' | 'S' | 'D' | 'B' | 'R';

/** The chart's code for a total (hard or soft) against an up card, before any fallback. */
export function chartCode(total: number, soft: boolean, upValue: number): ChartCode {
  const r = soft ? SOFT_BY_TOTAL[total] : HARD_BY_TOTAL[total];
  if (!r) throw new Error(`no chart row for ${soft ? 'soft' : 'hard'} ${total}`);
  return r[column(upValue)] as ChartCode;
}

/** Whether the pairs table says split this pair (by card value) against this up card. */
export function chartSplits(pairValue: number, upValue: number): boolean {
  return PAIR_BY_VALUE[pairValue]![column(upValue)] === 'Y';
}

/**
 * The basic-strategy move for a hand, given which moves the rules allow right now:
 * pairs first (when a split is allowed), then the hard or soft table; a double that isn't
 * allowed falls back to hit (D) or stand (B), a surrender that isn't allowed falls back to hit.
 * Never insurance, never even money.
 */
export function basicStrategy(cards: readonly Card[], up: Card, can: { double: boolean; split: boolean; surrender: boolean }): Move {
  const upValue = cardValue(up);
  if (can.split && cards.length === 2) {
    const v = cardValue(cards[0]!);
    if (v === cardValue(cards[1]!) && chartSplits(v, upValue)) return 'split';
  }
  const { total, soft } = handTotal(cards);
  switch (chartCode(total, soft, upValue)) {
    case 'H':
      return 'hit';
    case 'S':
      return 'stand';
    case 'D':
      return can.double ? 'double' : 'hit';
    case 'B':
      return can.double ? 'double' : 'stand';
    case 'R':
      return can.surrender ? 'surrender' : 'hit';
  }
}
