// Three Card Poker rules: hand ranks, the pay tables, the dealer's qualifier, the Q-6-4 playing
// strategy and settlement. Everything here is a pure function of cards or scores, and the engine,
// the exact enumeration and the Monte Carlo test all call the same functions, so the numbers the
// tests check are the numbers the table pays. Rules: docs/rules/cards-and-machines.md section 1.

import type { Card } from '../../cards.ts';
import { newDeck } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import { type Rng, randInt } from '../../rng.ts';

// Categories, low to high. With three cards a straight is rarer than a flush (720 hands against
// 1,096), so it ranks above it, and three of a kind ranks above both.
export const HIGH_CARD = 0;
export const PAIR = 1;
export const FLUSH = 2;
export const STRAIGHT = 3;
export const TRIPS = 4;
export const STRAIGHT_FLUSH = 5;
export type Category = 0 | 1 | 2 | 3 | 4 | 5;

/** 13^3: every tiebreak fits below it, so category * CAT + tiebreak orders all hands. */
export const CAT = 2197;

const RANK_ORDER = '23456789TJQKA';

/** 0 for a deuce up to 12 for an ace. */
export function rankIndex(card: Card): number {
  return RANK_ORDER.indexOf(card[0]!);
}

/**
 * A hand's strength as one integer: category * 13^3 + tiebreak. A higher number is a better
 * hand and equal numbers tie, because suits never break ties. The same scheme as
 * docs/math/three-card-poker.mjs, so thresholds like Q-6-4 are the same numbers there and here.
 */
export function score(cards: readonly Card[]): number {
  const a = cards[0]!;
  const b = cards[1]!;
  const c = cards[2]!;
  return scoreRanks(rankIndex(a), rankIndex(b), rankIndex(c), a[1] === b[1] && b[1] === c[1]);
}

/** The score of three ranks (0-12, any order) that do or don't share a suit. */
export function scoreRanks(x: number, y: number, z: number, suited: boolean): number {
  let hi = x;
  let mid = y;
  let lo = z;
  let t: number;
  if (mid > hi) (t = hi), (hi = mid), (mid = t);
  if (lo > mid) (t = mid), (mid = lo), (lo = t);
  if (mid > hi) (t = hi), (hi = mid), (mid = t);
  // A straight is ranked by its top card. The ace plays high (A-K-Q) or low in A-2-3 only,
  // which counts as 3-high and is the lowest straight; K-A-2 is just ace high.
  let top = -1;
  if (hi - mid === 1 && mid - lo === 1) top = hi;
  else if (hi === 12 && mid === 1 && lo === 0) top = 1;
  if (top >= 0) return (suited ? STRAIGHT_FLUSH : STRAIGHT) * CAT + top;
  if (hi === lo) return TRIPS * CAT + hi;
  if (suited) return FLUSH * CAT + hi * 169 + mid * 13 + lo;
  if (hi === mid) return PAIR * CAT + hi * 13 + lo;
  if (mid === lo) return PAIR * CAT + mid * 13 + hi;
  return hi * 169 + mid * 13 + lo;
}

export function category(s: number): Category {
  return Math.floor(s / CAT) as Category;
}

/** Q-3-2, the lowest queen-high hand: the dealer needs this or better to open. */
export const QUALIFIER = scoreRanks(10, 1, 0, false);
/** Q-6-4, the weakest hand worth a Play bet (Wizard of Odds' strategy, confirmed by enumeration). */
export const Q64 = scoreRanks(10, 4, 2, false);

/** The dealer plays (qualifies) with queen high or better. */
export function qualifies(dealer: number): boolean {
  return dealer >= QUALIFIER;
}

/** Play Q-6-4 or better, fold the rest. The table never plays for anyone; tests and hints use this. */
export function shouldPlay(player: number): boolean {
  return player >= Q64;
}

// ---------------------------------------------------------------------------------------------
// Pay tables

/**
 * Pays "to 1". `anteBonus` is straight flush, three of a kind, straight; `pairPlus` is straight
 * flush, three of a kind, straight, flush, pair. The table's config carries them, so a table can
 * switch Pair Plus to 40-30-6-4-1 (2.32%) without touching the code.
 */
export interface Paytable {
  anteBonus: readonly number[];
  pairPlus: readonly number[];
}

/** 1-4-5 Ante Bonus (WoO table 1, PA Paytable A) and 40-30-6-3-1 Pair Plus (WoO table 8, PA Paytable C). */
export const DEFAULT_PAYTABLE: Paytable = { anteBonus: [5, 4, 1], pairPlus: [40, 30, 6, 3, 1] };

function isPays(x: unknown, n: number): x is number[] {
  return Array.isArray(x) && x.length === n && x.every((v) => Number.isSafeInteger(v) && v >= 0);
}

/** The pay table from a table's options, falling back to the default for anything malformed. */
export function paytableOf(options: Record<string, unknown>): Paytable {
  return {
    anteBonus: isPays(options.anteBonus, 3) ? options.anteBonus : DEFAULT_PAYTABLE.anteBonus,
    pairPlus: isPays(options.pairPlus, 5) ? options.pairPlus : DEFAULT_PAYTABLE.pairPlus,
  };
}

/** Ante Bonus for a hand, to 1 (0 below a straight). */
export function anteBonusPays(cat: Category, pay: Paytable): number {
  return cat >= STRAIGHT ? pay.anteBonus[STRAIGHT_FLUSH - cat]! : 0;
}

/** Pair Plus for a hand, to 1 (0 means the bet loses: anything below a pair). */
export function pairPlusPays(cat: Category, pay: Paytable): number {
  return cat >= PAIR ? pay.pairPlus[STRAIGHT_FLUSH - cat]! : 0;
}

// ---------------------------------------------------------------------------------------------
// Settlement

/** How the Ante and Play fared against the dealer. */
export type Outcome = 'win' | 'lose' | 'push' | 'noqualify' | 'fold';

export interface Settlement {
  /** Ante and Play against the dealer; null when the seat only bet Pair Plus. */
  outcome: Outcome | null;
  /** What each spot gives back to the stack, stake included; 0 means the bet lost. */
  ante: Cents;
  play: Cents;
  /** Ante Bonus winnings (paid on the Ante; there is no separate stake). */
  bonus: Cents;
  pairPlus: Cents;
  wagered: Cents;
  returned: Cents;
}

/**
 * Settle one seat. `play` is 0 for a player who folded (or bet no Ante) and equal to the Ante for
 * one who played. `player` and `dealer` are scores.
 *
 * - Folding loses the Ante, and under 58 Pa. Code 649a.11(b)(1) the Pair Plus too; no Ante Bonus.
 * - A dealer below queen high pays the Ante 1 to 1 and pushes the Play.
 * - A qualifying dealer is compared: higher wins both 1 to 1, a tie pushes both.
 * - The Ante Bonus is paid to anyone who played, whatever the dealer holds.
 * - Pair Plus is settled on the player's own three cards, whatever the dealer holds.
 */
export function settle(bets: { ante: Cents; play: Cents; pairPlus: Cents }, player: number, dealer: number, pay: Paytable): Settlement {
  const cat = category(player);
  const folded = bets.ante > 0 && bets.play === 0;
  let outcome: Outcome | null = null;
  let ante = 0;
  let play = 0;
  let bonus = 0;
  let pairPlus = 0;
  if (bets.ante > 0) {
    if (folded) {
      outcome = 'fold';
    } else {
      bonus = bets.ante * anteBonusPays(cat, pay);
      if (!qualifies(dealer)) {
        outcome = 'noqualify';
        ante = 2 * bets.ante;
        play = bets.play;
      } else if (player > dealer) {
        outcome = 'win';
        ante = 2 * bets.ante;
        play = 2 * bets.play;
      } else if (player === dealer) {
        outcome = 'push';
        ante = bets.ante;
        play = bets.play;
      } else {
        outcome = 'lose';
      }
    }
  }
  if (bets.pairPlus > 0 && !folded) {
    const m = pairPlusPays(cat, pay);
    if (m > 0) pairPlus = bets.pairPlus * (m + 1);
  }
  return { outcome, ante, play, bonus, pairPlus, wagered: bets.ante + bets.play + bets.pairPlus, returned: ante + play + bonus + pairPlus };
}

// ---------------------------------------------------------------------------------------------
// The deal

const DECK: readonly Card[] = newDeck();

/**
 * A fresh 52-card deck every round: three cards to each seat in order, then three to the dealer.
 * Nothing carries over between rounds, so there is no shoe to track. The Fisher-Yates shuffle
 * (each position from the top swaps with a uniformly chosen one at or below it) stops once the
 * cards being dealt are in place: those come out exactly as uniformly as from a full shuffle, and
 * the rest of the deck is never looked at.
 */
export function dealHands(rng: Rng, seats: number): { hands: Card[][]; dealer: Card[] } {
  const deck = DECK.slice();
  const dealt: Card[] = [];
  for (let i = deck.length - 1; dealt.length < 3 * (seats + 1); i--) {
    const j = randInt(rng, i + 1);
    const card = deck[j]!;
    deck[j] = deck[i]!;
    deck[i] = card;
    dealt.push(card);
  }
  const hands: Card[][] = [];
  for (let s = 0; s < seats; s++) hands.push(dealt.slice(3 * s, 3 * s + 3));
  return { hands, dealer: dealt.slice(3 * seats) };
}

// ---------------------------------------------------------------------------------------------
// Names, for the dealer's calls and the labels on the felt

const NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
const SHORT = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** As printed on the pay tables. */
export const CATEGORY_NAMES = ['High card', 'Pair', 'Flush', 'Straight', 'Three of a kind', 'Straight flush'] as const;

/** What the dealer calls a hand: "Pair of Kings", "Ace high", "Three Sevens", "Straight flush". */
export function handName(s: number): string {
  const t = s % CAT;
  switch (category(s)) {
    case STRAIGHT_FLUSH:
      return 'Straight flush';
    case TRIPS:
      return `Three ${PLURALS[t]}`;
    case STRAIGHT:
      return 'Straight';
    case FLUSH:
      return 'Flush';
    case PAIR:
      return `Pair of ${PLURALS[Math.floor(t / 13)]}`;
    default:
      return `${NAMES[Math.floor(t / 169)]} high`;
  }
}

/** The ranks best first ("A-K-9", "3-2-A"), to tell two hands with the same name apart. */
export function handRanks(s: number): string {
  const t = s % CAT;
  let r: number[];
  switch (category(s)) {
    case STRAIGHT_FLUSH:
    case STRAIGHT:
      r = t === 1 ? [1, 0, 12] : [t, t - 1, t - 2];
      break;
    case TRIPS:
      r = [t, t, t];
      break;
    case PAIR: {
      const p = Math.floor(t / 13);
      const k = t % 13;
      r = p > k ? [p, p, k] : [k, p, p];
      break;
    }
    default:
      r = [Math.floor(t / 169), Math.floor(t / 13) % 13, t % 13];
  }
  return r.map((x) => SHORT[x]).join('-');
}
