// Two old yardsticks for starting hands: Bill Chen's formula and the Sklansky-Malmuth groups.
// The bots rank hands with the charts in ranges.ts; Tips still names a hand's group, and the
// charts break ties inside a tier with the Chen score.

export interface Yardstick {
  preflop: 'chen' | 'sklansky';
}

const CHEN_HIGH = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10]; // deuce .. ace

/** Bill Chen's formula, rounded half up (AA 20, AKs 12, TT 10, 57s 6, 72o -1). */
export function chen(a: number, b: number): number {
  let r1 = a >> 2;
  let r2 = b >> 2;
  if (r2 > r1) [r1, r2] = [r2, r1];
  const suited = (a & 3) === (b & 3);
  let score = CHEN_HIGH[r1]!;
  if (r1 === r2) return Math.ceil(Math.max(5, score * 2));
  if (suited) score += 2;
  const gap = r1 - r2 - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  // Q is rank 10: both cards below a queen
  if (gap <= 1 && r1 < 10) score += 1;
  return Math.ceil(score);
}

// Sklansky-Malmuth groups (1999 list, 4.9). "Axs" is A9s-A2s and "Kxs" is K8s-K2s.
const GROUPS: string[][] = [
  ['AA', 'KK', 'QQ', 'JJ', 'AKs'],
  ['TT', 'AQs', 'AJs', 'KQs', 'AK'],
  ['99', 'JTs', 'QJs', 'KJs', 'ATs', 'AQ'],
  ['T9s', 'KQ', '88', 'QTs', '98s', 'J9s', 'AJ', 'KTs'],
  ['77', '87s', 'Q9s', 'T8s', 'KJ', 'QJ', 'JT', '76s', '97s', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s', '65s'],
  ['66', 'AT', '55', '86s', 'KT', 'QT', '54s', 'K9s', 'J8s', '75s'],
  ['44', 'J9', '64s', 'T9', '53s', '33', '98', '43s', '22', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s', 'T7s', 'Q8s'],
  ['87', 'A9', 'Q9', '76', '42s', '32s', '96s', '85s', 'J8', 'J7s', '65', '54', '74s', 'K9', 'T8'],
];
const GROUP_OF = new Map<string, number>();
GROUPS.forEach((hands, i) => hands.forEach((h) => GROUP_OF.set(h, i + 1)));

const RANK_CHARS = '23456789TJQKA';

/** Sklansky-Malmuth group 1-8, or 9 for a hand in none of them. */
export function sklanskyGroup(a: number, b: number): number {
  let r1 = a >> 2;
  let r2 = b >> 2;
  if (r2 > r1) [r1, r2] = [r2, r1];
  const key = RANK_CHARS[r1]! + RANK_CHARS[r2]! + (r1 !== r2 && (a & 3) === (b & 3) ? 's' : '');
  return GROUP_OF.get(key) ?? 9;
}

// The groups on the Chen scale, so both yardsticks share one set of thresholds.
const GROUP_SCORE = [0, 15, 11, 10, 9, 8, 7, 6, 5, 2];

export function preflopScore(a: number, b: number, how: Yardstick['preflop']): number {
  return how === 'chen' ? chen(a, b) : GROUP_SCORE[sklanskyGroup(a, b)]!;
}
