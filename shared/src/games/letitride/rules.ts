// Let It Ride rules: the five-card hand ranks, the pay table, the 3-Card Bonus side bet, the
// pull-back strategy and settlement. Everything here is a pure function of cards, and the engine,
// the exact enumeration and the Monte Carlo test all call the same functions, so the numbers the
// tests check are the numbers the table pays. Rules: docs/rules/table-games.md, Let It Ride.

import type { Card } from '../../cards.ts';
import { newDeck } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import { type Rng, randInt } from '../../rng.ts';
import { CAT as TC_CAT, STRAIGHT_FLUSH as TC_SF, category as tcCategory, score as tcScore } from '../threecard/rules.ts';

// What a five-card hand is, as the pay table sees it, low to high. A pair below tens is worth no
// more than nothing at all, so both are NOTHING (the bets lose).
export const NOTHING = 0;
export const HIGH_PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;
export const ROYAL = 9;
export type Category = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** As printed on the felt, best first after NOTHING's empty slot (index = category). */
export const CATEGORY_NAMES = ['Nothing', 'Pair of 10s or better', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Royal flush'] as const;

const RANK_ORDER = '23456789TJQKA';
const SUIT_ORDER = 'shdc';
/** Rank index of a ten: a pair of these or higher pays. */
export const TEN = 8;

/** 0 for a deuce up to 12 for an ace. */
export function rankIndex(card: Card): number {
  return RANK_ORDER.indexOf(card[0]!);
}

/** A card as a number 0-51, rank * 4 + suit, for the counting code. */
export function codeOf(card: Card): number {
  return rankIndex(card) * 4 + SUIT_ORDER.indexOf(card[1]!);
}

const counts = new Int8Array(13);

/**
 * The category of five cards given as codes (codeOf). Ace plays high (A-K-Q-J-10) or low
 * (5-4-3-2-A) in a straight; a pair only pays from tens up.
 */
export function categoryOfCodes(a: number, b: number, c: number, d: number, e: number): Category {
  const r = [a >> 2, b >> 2, c >> 2, d >> 2, e >> 2];
  const flush = (a & 3) === (b & 3) && (b & 3) === (c & 3) && (c & 3) === (d & 3) && (d & 3) === (e & 3);
  counts.fill(0);
  let distinct = 0;
  let mask = 0;
  for (const x of r) {
    if (counts[x]++ === 0) distinct++;
    mask |= 1 << x;
  }
  if (distinct === 5) {
    let lo = 0;
    while (!(mask & (1 << lo))) lo++;
    const run = mask === (0b11111 << lo);
    const wheel = mask === 0b1000000001111;
    if (run || wheel) {
      if (!flush) return STRAIGHT;
      return run && lo === TEN ? ROYAL : STRAIGHT_FLUSH;
    }
    return flush ? FLUSH : NOTHING;
  }
  let most = 0;
  let pairRank = -1;
  for (let x = 0; x < 13; x++) {
    if (counts[x]! > most) most = counts[x]!;
    if (counts[x] === 2) pairRank = x;
  }
  if (distinct === 4) return pairRank >= TEN ? HIGH_PAIR : NOTHING;
  if (distinct === 3) return most === 3 ? TRIPS : TWO_PAIR;
  return most === 4 ? QUADS : FULL_HOUSE;
}

export function category(cards: readonly Card[]): Category {
  const [a, b, c, d, e] = cards.map(codeOf) as [number, number, number, number, number];
  return categoryOfCodes(a, b, c, d, e);
}

// ---------------------------------------------------------------------------------------------
// Pay tables

/**
 * Pays "to 1". `hand` is indexed by category (index 0, NOTHING, is unused: the bet loses);
 * `bonus` is the 3-Card Bonus, best first: mini royal (A-K-Q suited), straight flush, three of a
 * kind, straight, flush, pair. The table's config carries both.
 */
export interface Paytable {
  hand: readonly number[];
  bonus: readonly number[];
}

/**
 * The Strip's standard Let It Ride table (Wizard of Odds pay table 1, 3.51%) and the 3-Card
 * Bonus's 50-40-30-6-3-1 (Wizard of Odds' Let It Ride 3-Card Bonus, 7.10%).
 */
export const DEFAULT_PAYTABLE: Paytable = { hand: [0, 1, 2, 3, 5, 8, 11, 50, 200, 1000], bonus: [50, 40, 30, 6, 3, 1] };

function isPays(x: unknown, n: number): x is number[] {
  return Array.isArray(x) && x.length === n && x.every((v) => Number.isSafeInteger(v) && v >= 0);
}

/** The pay table from a table's options, falling back to the default for anything malformed. */
export function paytableOf(options: Record<string, unknown>): Paytable {
  return {
    hand: isPays(options.hand, 10) ? options.hand : DEFAULT_PAYTABLE.hand,
    bonus: isPays(options.bonus, 6) ? options.bonus : DEFAULT_PAYTABLE.bonus,
  };
}

/** What a riding bet pays to 1 on this hand; 0 means it loses. */
export function handPays(cat: Category, pay: Paytable): number {
  return cat === NOTHING ? 0 : pay.hand[cat]!;
}

// The 3-Card Bonus on the player's own three cards, ranked as at Three Card Poker (a straight
// beats a flush with three cards).
export const BONUS_NAMES = ['Mini royal', 'Straight flush', 'Three of a kind', 'Straight', 'Flush', 'Pair'] as const;

/** Which line of the 3-Card Bonus three cards hit (0 = mini royal ... 5 = pair), or -1. */
export function bonusLine(cards: readonly Card[]): number {
  const s = tcScore(cards);
  const cat = tcCategory(s);
  if (cat === TC_SF) return s % TC_CAT === 12 ? 0 : 1;
  // Three Card Poker's categories run pair 1, flush 2, straight 3, trips 4
  return cat === 0 ? -1 : 6 - cat;
}

/** The 3-Card Bonus's pay to 1 on three cards; 0 means it loses. */
export function bonusPays(cards: readonly Card[], pay: Paytable): number {
  const line = bonusLine(cards);
  return line < 0 ? 0 : pay.bonus[line]!;
}

// ---------------------------------------------------------------------------------------------
// The strategy: when to pull a bet back

/** Ranks 0-12 of some cards, and whether they share a suit. */
function shape(cards: readonly Card[]): { ranks: number[]; suited: boolean } {
  const ranks = cards.map(rankIndex).sort((x, y) => x - y);
  return { ranks, suited: cards.every((c) => c[1] === cards[0]![1]) };
}

/**
 * How far some distinct ranks are from filling a straight: the number of ranks missing inside the
 * five-card straight they best fit (the ace plays low for 5-4-3-2-A), and how many of them are
 * high (ten or better). -1 when they can't make a straight at all.
 */
function straightDraw(ranks: readonly number[]): { gaps: number; highs: number; top: number } | null {
  let best: { gaps: number; highs: number; top: number } | null = null;
  // every straight, top card 5 (the wheel) to ace
  for (let top = 3; top <= 12; top++) {
    const window = top === 3 ? [12, 0, 1, 2, 3] : [top - 4, top - 3, top - 2, top - 1, top];
    if (!ranks.every((r) => window.includes(r))) continue;
    // The gaps count the missing ranks between the lowest and the highest held, the way the
    // strategy counts them ("spread"): an open draw like 5-6-7 has none.
    const inWindow = ranks.map((r) => window.indexOf(r)).sort((x, y) => x - y);
    const gaps = inWindow[inWindow.length - 1]! - inWindow[0]! + 1 - ranks.length;
    // an ace playing low in 5-4-3-2-A isn't a high card
    const highs = top === 3 ? 0 : ranks.filter((r) => r >= TEN).length;
    if (!best || gaps < best.gaps || (gaps === best.gaps && top > best.top)) best = { gaps, highs, top };
  }
  return best;
}

/**
 * Bet 1, on your three cards: let it ride with a paying hand already (a pair of tens or better,
 * three of a kind), or three to a royal flush, or three suited cards in a row but 2-3-4 and A-2-3,
 * or three to a straight flush with one gap and a high card, or with two gaps and two high cards.
 * Pull it back otherwise. Wizard of Odds' strategy, and every hand of it is the best play by the
 * exact enumeration in letitride-exact.test.ts.
 */
export function rideFirst(cards: readonly Card[]): boolean {
  const { ranks, suited } = shape(cards);
  if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    // a pair (or three) of tens or better; a lower pair only pays if it improves
    return ranks[1]! >= TEN || ranks[0] === ranks[2];
  }
  if (!suited) return false;
  const d = straightDraw(ranks);
  if (!d) return false;
  if (ranks.every((r) => r >= TEN)) return true;
  if (d.gaps === 0) return !(ranks.join() === '0,1,2' || ranks.join() === '0,1,12');
  if (d.gaps === 1) return d.highs >= 1;
  return d.highs >= 2;
}

/**
 * Bet 2, on your three cards and the first community card: let it ride with a paying hand, four
 * to a flush, or four to an open straight with a high card. Pull it back otherwise. Every
 * four-card hand of it is the best play by the exact enumeration in letitride-exact.test.ts. A few
 * hands are an exact tie, riding or not (four to an open straight with no high card, like 5-6-7-8,
 * and four high cards to an inside straight, like 10-J-Q-A): some strategy cards ride those, this
 * one pulls them back, and the house edge is the same either way.
 */
export function rideSecond(cards: readonly Card[]): boolean {
  const { ranks, suited } = shape(cards);
  const distinct = new Set(ranks).size;
  if (distinct < 4) {
    // two pair or better pays already; one pair pays from tens up
    if (distinct < 3) return true;
    const pair = ranks.find((r, i) => ranks.indexOf(r) !== i)!;
    return pair >= TEN || ranks.filter((r) => r === pair).length === 3 || new Set(ranks.filter((r) => r !== pair)).size === 1;
  }
  if (suited) return true;
  const d = straightDraw(ranks);
  if (!d) return false;
  // open at both ends (A-2-3-4 and J-Q-K-A fill only one way) with a high card to pair
  return d.gaps === 0 && !ranks.includes(12) && d.highs >= 1;
}

// ---------------------------------------------------------------------------------------------
// Settlement

export interface Settlement {
  /** The five-card hand. */
  hand: Category;
  /** Which of bets 1 and 2 were pulled back ($ always rides). */
  pulled: [boolean, boolean];
  /** What each circle gives back to the stack, stake included: 0 lost (or pulled), else unit × (pays + 1). */
  bets: [Cents, Cents, Cents];
  /** The 3-Card Bonus back, stake included (0 lost or not bet). */
  bonus: Cents;
  /** Everything left riding plus the bonus: pulled bets were never risked. */
  wagered: Cents;
  returned: Cents;
}

/**
 * Settle one spot: `unit` is each of the three bets, `pulled` says which of the first two came
 * back, `five` is the player's three cards and the two community cards, `bonus` the 3-Card Bonus
 * bet (on the first three of `five`).
 */
export function settle(unit: Cents, pulled: readonly [boolean, boolean], bonus: Cents, five: readonly Card[], pay: Paytable): Settlement {
  const hand = category(five);
  const m = handPays(hand, pay);
  const back = m > 0 ? unit * (m + 1) : 0;
  const bets: [Cents, Cents, Cents] = [pulled[0] ? 0 : back, pulled[1] ? 0 : back, back];
  let bonusBack = 0;
  if (bonus > 0) {
    const b = bonusPays(five.slice(0, 3), pay);
    if (b > 0) bonusBack = bonus * (b + 1);
  }
  const riding = unit * (3 - (pulled[0] ? 1 : 0) - (pulled[1] ? 1 : 0));
  const returned = (unit > 0 ? bets[0] + bets[1] + bets[2] : 0) + bonusBack;
  return { hand, pulled: [pulled[0], pulled[1]], bets: unit > 0 ? bets : [0, 0, 0], bonus: bonusBack, wagered: riding + bonus, returned };
}

// ---------------------------------------------------------------------------------------------
// The deal

const DECK: readonly Card[] = newDeck();

/**
 * A fresh 52-card deck every round: three cards to each spot in order, then the two community
 * cards. The Fisher-Yates shuffle stops once the cards being dealt are in place (as at Three Card
 * Poker): those come out exactly as uniformly as from a full shuffle.
 */
export function dealHands(rng: Rng, spots: number): { hands: Card[][]; board: Card[] } {
  const deck = DECK.slice();
  const dealt: Card[] = [];
  for (let i = deck.length - 1; dealt.length < 3 * spots + 2; i--) {
    const j = randInt(rng, i + 1);
    const card = deck[j]!;
    deck[j] = deck[i]!;
    deck[i] = card;
    dealt.push(card);
  }
  const hands: Card[][] = [];
  for (let s = 0; s < spots; s++) hands.push(dealt.slice(3 * s, 3 * s + 3));
  return { hands, board: dealt.slice(3 * spots) };
}

// ---------------------------------------------------------------------------------------------
// Names, for the dealer's calls and the labels on the felt

const NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

/** What the dealer calls five cards: "Pair of Kings", "Two pair, Jacks and Fours", "Ace high". */
export function handName(cards: readonly Card[]): string {
  const cat = category(cards);
  const byCount = new Map<number, number>();
  for (const c of cards) byCount.set(rankIndex(c), (byCount.get(rankIndex(c)) ?? 0) + 1);
  const ranks = [...byCount.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([r]) => r);
  switch (cat) {
    case ROYAL:
      return 'Royal flush';
    case STRAIGHT_FLUSH:
      return 'Straight flush';
    case QUADS:
      return `Four ${PLURALS[ranks[0]!]}`;
    case FULL_HOUSE:
      return `${PLURALS[ranks[0]!]} full of ${PLURALS[ranks[1]!]}`;
    case FLUSH:
      return 'Flush';
    case STRAIGHT:
      return 'Straight';
    case TRIPS:
      return `Three ${PLURALS[ranks[0]!]}`;
    case TWO_PAIR:
      return `Two pair, ${PLURALS[ranks[0]!]} and ${PLURALS[ranks[1]!]}`;
    case HIGH_PAIR:
      return `Pair of ${PLURALS[ranks[0]!]}`;
    default:
      return byCount.size === 4 ? `Pair of ${PLURALS[ranks[0]!]}` : `${NAMES[ranks[0]!]} high`;
  }
}

/** The name of three or four cards so far: "Pair of Queens", "Three Fives", "King high". */
export function partialName(cards: readonly Card[]): string {
  const byCount = new Map<number, number>();
  for (const c of cards) byCount.set(rankIndex(c), (byCount.get(rankIndex(c)) ?? 0) + 1);
  const ranks = [...byCount.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [top, n] = ranks[0]!;
  if (n === 4) return `Four ${PLURALS[top]}`;
  if (n === 3) return `Three ${PLURALS[top]}`;
  if (n === 2) return ranks[1]![1] === 2 ? `Two pair, ${PLURALS[top]} and ${PLURALS[ranks[1]![0]]}` : `Pair of ${PLURALS[top]}`;
  return `${NAMES[top]} high`;
}
