// The hold strategy for 9/6 Jacks or Better at five coins (docs/rules/cards-and-machines.md §2.4).
//
// The list is data: 36 lines, highest first, each with its EV and a deal whose best hold lands on
// it, plus the six penalty-card footnotes A-F. To play a deal, every one of the 32 ways to hold it
// is placed on the list and the highest wins. With the footnotes this is optimal play on all
// 2,598,960 deals (99.543904%), which the exact enumeration test re-derives. The machine never
// plays for anyone: the Monte Carlo test and the hold tests use it.

import { rank5, RANK_T, RANK_J, RANK_K, RANK_A, ROYAL_FLUSH, STRAIGHT_FLUSH, FULL_HOUSE, FLUSH, STRAIGHT, type HandRank } from './hands.ts';

export interface HoldLine {
  line: number;
  hold: string;
  /** Average return per unit bet of the hands on this line (WoO), as printed in the rules. */
  ev: string;
  /** A deal whose correct hold is on this line, and the cards to keep. */
  deal: string;
  keep: string;
}

export const HOLD_LIST: readonly HoldLine[] = [
  { line: 1, hold: 'Dealt royal flush', ev: '800.0000', deal: 'Ts Js Qs Ks As', keep: 'Ts Js Qs Ks As' },
  { line: 2, hold: 'Dealt straight flush', ev: '50.0000', deal: '5h 6h 7h 8h 9h', keep: '5h 6h 7h 8h 9h' },
  { line: 3, hold: 'Dealt four of a kind', ev: '25.0000', deal: '9c 9d 9h 9s 2c', keep: '9c 9d 9h 9s' },
  { line: 4, hold: '4 to a royal flush', ev: '18.3617', deal: 'As Ks Qs Js 5s', keep: 'As Ks Qs Js' },
  { line: 5, hold: 'Dealt full house', ev: '9.0000', deal: '3c 3d 3h 8s 8c', keep: '3c 3d 3h 8s 8c' },
  { line: 6, hold: 'Dealt flush', ev: '6.0000', deal: '2d 5d 8d Jd Kd', keep: '2d 5d 8d Jd Kd' },
  { line: 7, hold: 'Three of a kind', ev: '4.3025', deal: '7c 7d 7h Ks 2c', keep: '7c 7d 7h' },
  { line: 8, hold: 'Dealt straight', ev: '4.0000', deal: '5c 6d 7h 8s 9c', keep: '5c 6d 7h 8s 9c' },
  { line: 9, hold: '4 to a straight flush', ev: '3.5319', deal: '9h Th Jh Qh Jd', keep: '9h Th Jh Qh' },
  { line: 10, hold: 'Two pair', ev: '2.5957', deal: 'Jc Jd 4h 4s 9c', keep: 'Jc Jd 4h 4s' },
  { line: 11, hold: 'High pair (jacks or better)', ev: '1.5365', deal: 'Jh Js Qh Kh 2c', keep: 'Jh Js' },
  { line: 12, hold: '3 to a royal flush', ev: '1.2868', deal: 'Kh Qh Jh 5h 2c', keep: 'Kh Qh Jh' },
  { line: 13, hold: '4 to a flush', ev: '1.2766', deal: '5c 5d 7d Jd Qd', keep: '5d 7d Jd Qd' },
  { line: 14, hold: 'Unsuited 10-J-Q-K', ev: '0.8723', deal: 'Tc Jd Qh Ks 3s', keep: 'Tc Jd Qh Ks' },
  { line: 15, hold: 'Low pair (2s through 10s)', ev: '0.8237', deal: '5c 6d 7h 8c 8s', keep: '8c 8s' },
  { line: 16, hold: '4 to an outside straight with 0-2 high cards', ev: '0.6809', deal: '2c 5d 6h 7s 8c', keep: '5d 6h 7s 8c' },
  { line: 17, hold: '3 to a straight flush, type 1', ev: '0.6207 to 0.6429', deal: '8h 9h Th 2c 4s', keep: '8h 9h Th' },
  { line: 18, hold: 'Suited Q-J', ev: '0.6004', deal: 'Qd Jd 5c 7h 2s', keep: 'Qd Jd' },
  { line: 19, hold: '4 to an inside straight with 4 high cards (J-Q-K-A)', ev: '0.5957', deal: 'Js Qh Kd Ac 3s', keep: 'Js Qh Kd Ac' },
  { line: 20, hold: 'Suited K-Q or K-J', ev: '0.5821', deal: 'Kc Qc 3d 6h 8s', keep: 'Kc Qc' },
  { line: 21, hold: 'Suited A-K, A-Q or A-J', ev: '0.5678', deal: 'Ah Kh 3d 6c 9s', keep: 'Ah Kh' },
  { line: 22, hold: '4 to an inside straight with 3 high cards', ev: '0.5319', deal: '9c Jd Qh Ks 3c', keep: '9c Jd Qh Ks' },
  { line: 23, hold: '3 to a straight flush, type 2', ev: '0.5097 to 0.5227', deal: '5h 6h 8h 2c Ts', keep: '5h 6h 8h' },
  { line: 24, hold: 'Unsuited J-Q-K', ev: '0.5005', deal: 'Jc Qd Kh 3s 5c', keep: 'Jc Qd Kh' },
  { line: 25, hold: 'Unsuited J-Q', ev: '0.4980', deal: 'Jc Qd 4h 6s 8c', keep: 'Jc Qd' },
  { line: 26, hold: 'Suited 10-J', ev: '0.4968', deal: 'Th Jh 2c 5d 8s', keep: 'Th Jh' },
  { line: 27, hold: '2 unsuited high cards, king highest', ev: '0.4862', deal: 'Kc Jd 3h 6s 8c', keep: 'Kc Jd' },
  { line: 28, hold: 'Suited 10-Q', ev: '0.4825', deal: 'Td Qd 2c 5h 7s', keep: 'Td Qd' },
  { line: 29, hold: '2 unsuited high cards, ace highest', ev: '0.4743', deal: 'Jc Ad 3d 5h 8s', keep: 'Jc Ad' },
  { line: 30, hold: 'J alone', ev: '0.4713', deal: 'Js 2c 5d 7h 9c', keep: 'Js' },
  { line: 31, hold: 'Suited 10-K', ev: '0.4682', deal: 'Tc Kc 2d 5h 7s', keep: 'Tc Kc' },
  { line: 32, hold: 'Q alone', ev: '0.4681', deal: 'Qs 2c 5d 7h 9c', keep: 'Qs' },
  { line: 33, hold: 'K alone', ev: '0.4649', deal: 'Ks 2c 5d 7h 9c', keep: 'Ks' },
  { line: 34, hold: 'A alone', ev: '0.4640', deal: 'As 2c 5d 7h 9c', keep: 'As' },
  { line: 35, hold: '3 to a straight flush, type 3', ev: '0.4431', deal: '4h 5h 8h 2c 9s', keep: '4h 5h 8h' },
  { line: 36, hold: 'Discard everything', ev: '0.3597', deal: '2c 3d 7h 8s Tc', keep: '' },
];

export interface Footnote {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  /** The line the hold normally sits on, and where the footnote moves it for the hands it covers. */
  from: number;
  to: number;
  rule: string;
  deal: string;
  keep: string;
  /** What the plain list would hold. */
  not: string;
}

// Each footnote moves a hold to a point between two lines, so the rest of the list still decides.
export const FOOTNOTES: readonly Footnote[] = [
  {
    id: 'A', from: 12, to: 13.5,
    rule: '3 to a royal with both the 10 and the ace loses to 4 to a flush when the off-suit card is a 10 or a royal rank not held',
    deal: '2c Tc Td Jc Ac', keep: '2c Tc Jc Ac', not: 'Tc Jc Ac',
  },
  {
    id: 'B', from: 18, to: 19.5,
    rule: 'Suited Q-J with an off-suit K and A: hold J-Q-K-A when the fifth card is a 9 or of the Q-J suit',
    deal: '2d Jd Qd Kc Ac', keep: 'Jd Qd Kc Ac', not: 'Jd Qd',
  },
  {
    id: 'C', from: 23, to: 21.5,
    rule: '3 to a straight flush spanning five ranks with one high card beats 4 to an inside straight with 3 high cards, unless a discard fills the draw',
    deal: '7h 9h Jh Qd Kc', keep: '7h 9h Jh', not: '9h Jh Qd Kc',
  },
  {
    id: 'D', from: 26, to: 27.5,
    rule: 'Suited 10-J with an off-suit K: hold J-K when any discard is of the 10-J suit',
    deal: '2d 3c Td Jd Kc', keep: 'Jd Kc', not: 'Td Jd',
  },
  {
    id: 'E', from: 28, to: 29.5,
    rule: 'Suited 10-Q with an off-suit A: hold Q-A when any discard is of the 10-Q suit',
    deal: '2d 3c Td Qd Ac', keep: 'Qd Ac', not: 'Td Qd',
  },
  {
    id: 'F', from: 31, to: 33.5,
    rule: 'Suited 10-K: hold the K alone when the discards include a 9 and a card of the 10-K suit',
    deal: '3d 6c 9s Tc Kc', keep: 'Kc', not: 'Tc Kc',
  },
];

/** A hold that never appears on the list. */
export const NEVER = 999;

const JQ = (1 << RANK_J) | (1 << (RANK_J + 1));
const JK = (1 << RANK_J) | (1 << RANK_K);
const QK = (1 << (RANK_J + 1)) | (1 << RANK_K);
const JA = (1 << RANK_J) | (1 << RANK_A);
const QA = (1 << (RANK_J + 1)) | (1 << RANK_A);
const KA = (1 << RANK_K) | (1 << RANK_A);
const TJ = (1 << RANK_T) | (1 << RANK_J);
const TQ = (1 << RANK_T) | (1 << (RANK_J + 1));
const TK = (1 << RANK_T) | (1 << RANK_K);
const TJQK = 0b1111 << RANK_T;
const JQKA = 0b1111 << RANK_J;
const JQK = 0b111 << RANK_J;
const ACE = 1 << RANK_A;
const NINE = 7;
const POP = Array.from({ length: 32 }, (_, m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1));

function lowBit(x: number): number {
  return 31 - Math.clz32(x & -x);
}

function highBit(x: number): number {
  return 31 - Math.clz32(x);
}

/** Distinct ranks that fit one five-rank straight window, the ace playing low if it must. */
function inWindow(ranks: number): boolean {
  return highBit(ranks) - lowBit(ranks) <= 4 || ((ranks & ACE) !== 0 && (ranks & ~ACE) < 16);
}

/** Three suited ranks inside a window: 1, 2 or 3 as the rules define the types. */
function straightFlushType(ranks: number): 1 | 2 | 3 {
  const lo = lowBit(ranks);
  const hi = highBit(ranks);
  if ((ranks & ACE) !== 0 && hi - lo > 4) return 2; // ace low: A-2-3 through A-4-5
  if (ranks === 0b111) return 2; // 2-3-4
  const gaps = hi - lo - 2;
  const high = POP[ranks >> RANK_J]!;
  if (high >= gaps) return 1;
  if ((gaps === 1 && high === 0) || (gaps === 2 && high === 1)) return 2;
  return 3;
}

/**
 * Where holding `mask` (bit i = card i) of a deal sits on the list, footnotes included; NEVER
 * for a hold the list never makes. `r` and `s` are the five cards' ranks (0-12) and suits, and
 * `dealt` the deal's own category.
 */
export function holdLine(mask: number, r: ArrayLike<number>, s: ArrayLike<number>, dealt: HandRank): number {
  const n = POP[mask]!;
  if (n === 0) return 36;
  if (n === 5) {
    if (dealt === ROYAL_FLUSH) return 1;
    if (dealt === STRAIGHT_FLUSH) return 2;
    if (dealt === FULL_HOUSE) return 5;
    if (dealt === FLUSH) return 6;
    if (dealt === STRAIGHT) return 8;
    return NEVER;
  }
  let ranks = 0;
  let paired = 0;
  let tripled = 0;
  let suit = -1;
  let suited = true;
  for (let i = 0; i < 5; i++) {
    if (!(mask & (1 << i))) continue;
    const bit = 1 << r[i]!;
    tripled |= paired & bit;
    paired |= ranks & bit;
    ranks |= bit;
    if (suit < 0) suit = s[i]!;
    else if (s[i] !== suit) suited = false;
  }
  const distinct = POP[ranks & 31]! + POP[(ranks >> 5) & 31]! + POP[ranks >> 10]!;

  if (distinct < n) {
    // A pair, two pair, trips or quads, held with no kicker.
    if (n === 4) {
      if (distinct === 1) return 3;
      return distinct === 2 && !tripled ? 10 : NEVER;
    }
    if (n === 3) return distinct === 1 ? 7 : NEVER;
    if (n === 2) return ranks >= 1 << RANK_J ? 11 : 15;
    return NEVER;
  }

  const lo = lowBit(ranks);
  const high = POP[ranks >> RANK_J]!;
  let line = NEVER;
  if (n === 4) {
    if (suited && lo >= RANK_T) line = 4;
    else if (suited && inWindow(ranks)) line = 9;
    else if (suited) line = 13;
    else if (ranks === TJQK) line = 14;
    else if (highBit(ranks) - lo === 3 && !(ranks & ACE)) line = 16;
    else if (ranks === JQKA) line = 19;
    else if (inWindow(ranks) && high === 3) line = 22;
    return line;
  }
  if (n === 3) {
    if (suited && lo >= RANK_T) line = 12;
    else if (suited && inWindow(ranks)) {
      const type = straightFlushType(ranks);
      line = type === 1 ? 17 : type === 2 ? 23 : 35;
    } else if (ranks === JQK) line = 24;
  } else if (n === 2) {
    if (suited) {
      if (ranks === JQ) line = 18;
      else if (ranks === QK || ranks === JK) line = 20;
      else if (ranks === KA || ranks === QA || ranks === JA) line = 21;
      else if (ranks === TJ) line = 26;
      else if (ranks === TQ) line = 28;
      else if (ranks === TK) line = 31;
    } else if (ranks === JQ) line = 25;
    else if (ranks === QK || ranks === JK) line = 27;
    else if (ranks === KA || ranks === QA || ranks === JA) line = 29;
  } else {
    if (lo === RANK_J) line = 30;
    else if (lo === RANK_J + 1) line = 32;
    else if (lo === RANK_K) line = 33;
    else if (lo === RANK_A) line = 34;
  }
  if (line === 12 || line === 18 || line === 23 || line === 26 || line === 28 || line === 31) return footnote(line, mask, ranks, suit, r, s);
  return line;
}

/** Footnotes A-F: the penalty cards among the discards that move a hold between two lines. */
function footnote(line: number, mask: number, held: number, suit: number, r: ArrayLike<number>, s: ArrayLike<number>): number {
  let sameSuit = 0;
  let otherSuitRank = -1;
  let otherSuit = 0;
  let nine = false;
  let discardRanks = 0;
  let fifthRank = -1;
  let fifthSuit = -1;
  for (let i = 0; i < 5; i++) {
    if (mask & (1 << i)) continue;
    const rank = r[i]!;
    discardRanks |= 1 << rank;
    if (s[i] === suit) sameSuit++;
    else {
      otherSuit++;
      otherSuitRank = rank;
    }
    if (rank === NINE) nine = true;
    if (rank !== RANK_K && rank !== RANK_A && fifthRank < 0) {
      fifthRank = rank;
      fifthSuit = s[i]!;
    }
  }
  const penalty = sameSuit > 0;

  if (line === 12) {
    // A: 10-x-A of a royal, one flush card and one off-suit 10 or missing royal rank thrown away.
    if (!(held & (1 << RANK_T)) || !(held & ACE) || sameSuit !== 1 || otherSuit !== 1) return line;
    const r5 = otherSuitRank;
    const missingRoyal = r5 >= RANK_J && r5 <= RANK_K && !(held & (1 << r5));
    return r5 === RANK_T || missingRoyal ? 13.5 : line;
  }
  if (line === 18) {
    // B: Q-J suited with an off-suit K and A: J-Q-K-A when the fifth card is a 9 or a flush card.
    if (!(discardRanks & (1 << RANK_K)) || !(discardRanks & ACE)) return line;
    return fifthRank >= 0 && (fifthRank === NINE || fifthSuit === suit) ? 19.5 : line;
  }
  if (line === 23) {
    // C: a five-rank straight flush draw with one high card moves above line 22 unless a
    // discard is one of the ranks that would fill it.
    const lo = lowBit(held);
    const hi = highBit(held);
    if (hi - lo !== 4 || POP[held >> RANK_J] !== 1) return line;
    for (let i = 0; i < 5; i++) {
      if (mask & (1 << i)) continue;
      const rank = r[i]!;
      if (rank > lo && rank < hi && !(held & (1 << rank))) return line;
    }
    return 21.5;
  }
  if (line === 26) return penalty ? 27.5 : line; // D
  if (line === 28) return penalty ? 29.5 : line; // E
  return penalty && nine ? 33.5 : line; // F (line 31)
}

const rs = new Int8Array(5);
const ss = new Int8Array(5);

/** The best hold of a deal of five card numbers, as a bit mask over the five positions. */
export function bestHold(cards: ArrayLike<number>): number {
  for (let i = 0; i < 5; i++) {
    rs[i] = cards[i]! >> 2;
    ss[i] = cards[i]! & 3;
  }
  const dealt = rank5(cards[0]!, cards[1]!, cards[2]!, cards[3]!, cards[4]!);
  let best = 0;
  let bestLine = NEVER + 1;
  for (let m = 0; m < 32; m++) {
    const line = holdLine(m, rs, ss, dealt);
    if (line < bestLine) {
      bestLine = line;
      best = m;
    }
  }
  return best;
}

/** The list line of the best hold (footnotes may give a half line). */
export function bestLine(cards: ArrayLike<number>): number {
  const m = bestHold(cards);
  return holdLine(m, rs, ss, rank5(cards[0]!, cards[1]!, cards[2]!, cards[3]!, cards[4]!));
}
