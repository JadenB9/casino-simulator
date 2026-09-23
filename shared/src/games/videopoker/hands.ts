// Jacks or Better hands: the evaluator, the 9/6 pay table, and the card numbering the machine
// uses inside. Cards travel as codes ("As", "Td"); here a card is a number, rank * 4 + suit, with
// ranks 0-12 for 2 through ace. A hand's category then comes from a few bit operations with no
// arrays or strings, which is what lets the Monte Carlo test play tens of millions of hands.

import type { Card } from '../../cards.ts';

// Categories, lowest to highest. The numbers index the pay table.
export const NOTHING = 0;
export const JACKS_OR_BETTER = 1;
export const TWO_PAIR = 2;
export const THREE_OF_A_KIND = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const FOUR_OF_A_KIND = 7;
export const STRAIGHT_FLUSH = 8;
export const ROYAL_FLUSH = 9;

export type HandRank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const HAND_NAMES: readonly string[] = [
  'Nothing',
  'Jacks or Better',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
  'Royal Flush',
];

export const MAX_COINS = 5;

/** Credits back per coin bet (a winning pair of jacks returns the bet). The 9/6 "full pay" table. */
export const PAY_PER_COIN: readonly number[] = [0, 1, 2, 3, 4, 6, 9, 25, 50, 250];

/** A royal on a full five-coin bet pays 4,000 (800 a coin) instead of 1,250. */
export const ROYAL_MAX_BET = 4000;

/** Credits paid for a final hand at 1-5 coins. */
export function payCredits(rank: number, coins: number): number {
  if (rank === ROYAL_FLUSH && coins === MAX_COINS) return ROYAL_MAX_BET;
  return PAY_PER_COIN[rank]! * coins;
}

/** The pay glass, royal first: each paying hand with its pays at 1 to 5 coins. */
export const PAYTABLE: readonly { rank: HandRank; pays: readonly number[] }[] = ([9, 8, 7, 6, 5, 4, 3, 2, 1] as HandRank[]).map((rank) => ({
  rank,
  pays: [1, 2, 3, 4, 5].map((coins) => payCredits(rank, coins)),
}));

// ---------------------------------------------------------------------------------------------
// Card numbers

const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'shdc';

export const RANK_T = 8;
export const RANK_J = 9;
export const RANK_Q = 10;
export const RANK_K = 11;
export const RANK_A = 12;

/** "As" -> 51. Ranks 2..A are 0..12; the suit is the low two bits. */
export function cardNumber(card: Card): number {
  return RANK_CHARS.indexOf(card[0]!) * 4 + SUIT_CHARS.indexOf(card[1]!);
}

export function cardCode(n: number): Card {
  return `${RANK_CHARS[n >> 2]}${SUIT_CHARS[n & 3]}` as Card;
}

// ---------------------------------------------------------------------------------------------
// The evaluator

const HIGH_RANKS = 0b1111 << RANK_J; // J Q K A
const ROYAL_RANKS = 0b11111 << RANK_T; // T J Q K A
const WHEEL = (1 << RANK_A) | 0b1111; // A 2 3 4 5

/** The category of five card numbers. */
export function rank5(a: number, b: number, c: number, d: number, e: number): HandRank {
  // Each card's rank bit climbs one level per copy: afterwards `one` holds every rank present,
  // `two` the ranks seen at least twice, `three` at least three times, `four` all four.
  let bit = 1 << (a >> 2);
  let one = bit;
  let two = 0;
  let three = 0;
  let four = 0;
  bit = 1 << (b >> 2);
  two |= one & bit;
  one |= bit;
  bit = 1 << (c >> 2);
  three |= two & bit;
  two |= one & bit;
  one |= bit;
  bit = 1 << (d >> 2);
  four |= three & bit;
  three |= two & bit;
  two |= one & bit;
  one |= bit;
  bit = 1 << (e >> 2);
  four |= three & bit;
  three |= two & bit;
  two |= one & bit;
  one |= bit;

  // Any repeated rank rules out straights and flushes (five cards of one suit are five ranks).
  if (four) return FOUR_OF_A_KIND;
  if (three) return two & ~three ? FULL_HOUSE : THREE_OF_A_KIND;
  if (two) {
    if (two & (two - 1)) return TWO_PAIR;
    return two & HIGH_RANKS ? JACKS_OR_BETTER : NOTHING;
  }
  const flush = (((a ^ b) | (a ^ c) | (a ^ d) | (a ^ e)) & 3) === 0;
  // Five different ranks: a straight is five adjacent bits, or the wheel with the ace low.
  const straight = one === WHEEL || one / (one & -one) === 31;
  if (straight && flush) return one === ROYAL_RANKS ? ROYAL_FLUSH : STRAIGHT_FLUSH;
  if (flush) return FLUSH;
  if (straight) return STRAIGHT;
  return NOTHING;
}

/** The category of five cards given as codes. */
export function rankHand(cards: readonly Card[]): HandRank {
  if (cards.length !== 5) throw new Error('rankHand: a hand is five cards');
  const n = cards.map(cardNumber);
  return rank5(n[0]!, n[1]!, n[2]!, n[3]!, n[4]!);
}
