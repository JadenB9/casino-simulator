// Poker hand evaluation for Hold'em: the best five of up to seven cards, as one integer where a
// bigger number is a better hand and equal numbers split the pot.
//
// Cards here are small integers, 0..51: rank = c >> 2 (0 = deuce ... 12 = ace), suit = c & 3.
// The wire and the view use the two-character codes from cards.ts; the engine converts at the
// edges. Integers let the bots run a few thousand evaluations per decision without allocating.
//
// The value packs the category in bits 20-23 and up to five ranks below it, most significant
// first, four bits each. Only the ranks that decide ties are packed (a straight packs its top
// card, quads pack the four and the kicker), so there are exactly 7,462 distinct values over all
// five-card hands, the number every correct evaluator must produce.

import type { Card } from '../../cards.ts';

export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;

const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'shdc';

export function cardInt(c: Card): number {
  return RANK_CHARS.indexOf(c[0]!) * 4 + SUIT_CHARS.indexOf(c[1]!);
}

export function intCard(n: number): Card {
  return `${RANK_CHARS[n >> 2]}${SUIT_CHARS[n & 3]}` as Card;
}

// STRAIGHT_TOP[mask] is the top rank of the best straight in a 13-bit rank mask, or -1.
// The wheel (A-2-3-4-5) counts as five-high; there is no wraparound (Q-K-A-2-3 is nothing).
const STRAIGHT_TOP = new Int8Array(8192);
for (let m = 0; m < 8192; m++) {
  let top = -1;
  for (let t = 12; t >= 4; t--) {
    if (((m >> (t - 4)) & 31) === 31) {
      top = t;
      break;
    }
  }
  if (top < 0 && (m & 0b1000000001111) === 0b1000000001111) top = 3;
  STRAIGHT_TOP[m] = top;
}

function hi(m: number): number {
  return 31 - Math.clz32(m);
}

/** The `n` highest ranks in `m`, packed four bits each with the first at bit `shift`. */
function packTop(m: number, n: number, shift: number): number {
  let v = 0;
  for (let i = 0; i < n && m !== 0; i++) {
    const r = hi(m);
    v |= r << (shift - 4 * i);
    m &= ~(1 << r);
  }
  return v;
}

/** Value of the best five-card hand among the first `count` cards (5 to 7 of them). */
export function evaluate(cards: ArrayLike<number>, count: number = cards.length): number {
  // m1..m4: ranks held at least once, twice, three and four times.
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let n0 = 0;
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  for (let i = 0; i < count; i++) {
    const c = cards[i]!;
    const bit = 1 << (c >> 2);
    m4 |= m3 & bit;
    m3 |= m2 & bit;
    m2 |= m1 & bit;
    m1 |= bit;
    switch (c & 3) {
      case 0:
        s0 |= bit;
        n0++;
        break;
      case 1:
        s1 |= bit;
        n1++;
        break;
      case 2:
        s2 |= bit;
        n2++;
        break;
      default:
        s3 |= bit;
        n3++;
    }
  }
  // With seven cards a flush rules out quads and full houses (they would need eight cards), so
  // the flush check can come first.
  const fm = n0 >= 5 ? s0 : n1 >= 5 ? s1 : n2 >= 5 ? s2 : n3 >= 5 ? s3 : 0;
  if (fm !== 0) {
    const sf = STRAIGHT_TOP[fm]!;
    if (sf >= 0) return (STRAIGHT_FLUSH << 20) | (sf << 16);
    return (FLUSH << 20) | packTop(fm, 5, 16);
  }
  if (m4 !== 0) {
    const q = hi(m4);
    return (QUADS << 20) | (q << 16) | (hi(m1 & ~(1 << q)) << 12);
  }
  if (m3 !== 0) {
    const t = hi(m3);
    const pair = (m2 & ~(1 << t)) | 0;
    if (pair !== 0) return (FULL_HOUSE << 20) | (t << 16) | (hi(pair) << 12);
  }
  const st = STRAIGHT_TOP[m1]!;
  if (st >= 0) return (STRAIGHT << 20) | (st << 16);
  if (m3 !== 0) {
    const t = hi(m3);
    return (TRIPS << 20) | (t << 16) | packTop(m1 & ~(1 << t), 2, 12);
  }
  if (m2 !== 0) {
    const p1 = hi(m2);
    const rest = m2 & ~(1 << p1);
    if (rest !== 0) {
      const p2 = hi(rest);
      return (TWO_PAIR << 20) | (p1 << 16) | (p2 << 12) | (hi(m1 & ~(1 << p1) & ~(1 << p2)) << 8);
    }
    return (PAIR << 20) | (p1 << 16) | packTop(m1 & ~(1 << p1), 3, 12);
  }
  return (HIGH_CARD << 20) | packTop(m1, 5, 16);
}

export function categoryOf(value: number): number {
  return value >> 20;
}

const ONE = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const MANY = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

export const CATEGORY_NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

/** "Two Pair, Kings and Nines", "Full House, Tens full of Fours", "Royal Flush". */
export function handName(value: number): string {
  const a = (value >> 16) & 15;
  const b = (value >> 12) & 15;
  switch (value >> 20) {
    case STRAIGHT_FLUSH:
      return a === 12 ? 'Royal Flush' : `Straight Flush, ${ONE[a]} high`;
    case QUADS:
      return `Four of a Kind, ${MANY[a]}`;
    case FULL_HOUSE:
      return `Full House, ${MANY[a]} full of ${MANY[b]}`;
    case FLUSH:
      return `Flush, ${ONE[a]} high`;
    case STRAIGHT:
      return `Straight, ${ONE[a]} high`;
    case TRIPS:
      return `Three of a Kind, ${MANY[a]}`;
    case TWO_PAIR:
      return `Two Pair, ${MANY[a]} and ${MANY[b]}`;
    case PAIR:
      return `Pair of ${MANY[a]}`;
    default:
      return `${ONE[a]} High`;
  }
}

const scratch = new Int32Array(7);

/**
 * The five cards that make the best hand, for highlighting at showdown. Tries every five-card
 * subset (21 for seven cards), so it's for the few hands shown per round, not for bots.
 */
export function bestFive(cards: readonly number[]): number[] {
  const n = cards.length;
  if (n <= 5) return [...cards];
  let best = -1;
  let pick: number[] = [];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            scratch[0] = cards[a]!;
            scratch[1] = cards[b]!;
            scratch[2] = cards[c]!;
            scratch[3] = cards[d]!;
            scratch[4] = cards[e]!;
            const v = evaluate(scratch, 5);
            if (v > best) {
              best = v;
              pick = [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!];
            }
          }
  return pick;
}
