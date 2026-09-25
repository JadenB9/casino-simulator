// Pai Gow Poker rules: a 53-card deck with one joker (the "bug"), the five-card and two-card hand
// ranks, setting a hand, the Trump Plaza house way, settlement with the 5% commission, and the
// Fortune side bet. Everything here is a pure function of cards, and the engine, the tests and
// the Monte Carlo all call the same functions. Rules: docs/rules/table-games.md, Pai Gow Poker.
//
// The joker is a bug, not fully wild: it plays as an ace, or as any card that completes a
// straight, a flush or a straight flush. So joker and ace are a pair of aces, and joker and four
// aces are five aces, the top hand. A-2-3-4-5 is the second-highest straight (as at most Nevada
// tables), under A-K-Q-J-10 and over K-Q-J-10-9.

import type { Card } from '../../cards.ts';
import { newDeck } from '../../cards.ts';
import type { Cents } from '../../money.ts';
import { type Rng, randInt } from '../../rng.ts';

export const JOKER = 'Jk';
export type PgCard = Card | typeof JOKER;

const RANK_ORDER = '23456789TJQKA';
const ACE = 12;
const KING = 11;
const QUEEN = 10;

export function isPgCard(x: unknown): x is PgCard {
  return x === JOKER || (typeof x === 'string' && /^[A2-9TJQK][shdc]$/.test(x));
}

/** 0 for a deuce up to 12 for an ace; the joker counts as an ace. */
export function rankIndex(card: PgCard): number {
  return card === JOKER ? ACE : RANK_ORDER.indexOf(card[0]!);
}

// ---------------------------------------------------------------------------------------------
// Hand ranks

// Categories, low to high. A royal flush is the top straight flush.
export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;
export const FIVE_ACES = 9;
export type Category = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Five tiebreak digits in base 14 fit under this, so category * CAT + tiebreak orders every hand.
 * A two-card hand uses the same scale (its two digits first), so a five-card and a two-card hand
 * compare directly: that is how a hand set with the two cards above the five is caught.
 */
export const CAT = 14 ** 5;

const digits = (ds: readonly number[]): number => {
  let v = 0;
  for (let i = 0; i < 5; i++) v = v * 14 + (ds[i] ?? 0);
  return v;
};

export function category(score: number): Category {
  return Math.floor(score / CAT) as Category;
}

/**
 * A straight's place among straights: 6-high (4) up to king-high (11), then the wheel A-2-3-4-5
 * (12, second best) and A-K-Q-J-10 (13). `mask` is the ranks present (bit r for rank r); `wild`
 * says one rank may be missing (the joker fills it). -1 when there is no straight.
 */
function straightValue(mask: number, wild: boolean): number {
  let best = -1;
  // tops from 6-high (the lowest run 2-6) to ace-high, and the wheel
  for (let top = 4; top <= ACE; top++) {
    const need = 0b11111 << (top - 4);
    const missing = popcount(need & ~mask);
    if (missing === 0 || (wild && missing === 1)) best = Math.max(best, top === ACE ? 13 : top);
  }
  const wheel = 0b1000000001111;
  const missing = popcount(wheel & ~mask);
  if (missing === 0 || (wild && missing === 1)) best = Math.max(best, 12);
  return best;
}

function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

/** The score of a five-card hand (the high hand). */
export function highScore(cards: readonly PgCard[]): number {
  const joker = cards.includes(JOKER);
  const naturals = cards.filter((c): c is Card => c !== JOKER);
  const ranks = naturals.map((c) => RANK_ORDER.indexOf(c[0]!));
  let mask = 0;
  for (const r of ranks) mask |= 1 << r;
  const distinct = popcount(mask) === ranks.length;
  const suited = naturals.every((c) => c[1] === naturals[0]![1]);

  let best = -1;
  // straights and flushes, where the joker may be any card that completes them
  const sv = distinct ? straightValue(mask, joker) : -1;
  if (sv >= 0 && suited) best = STRAIGHT_FLUSH * CAT + digits([sv]);
  else {
    if (suited) {
      // the joker is the highest rank the flush is missing
      const fr = [...ranks];
      if (joker) {
        let r = ACE;
        while (fr.includes(r)) r--;
        fr.push(r);
      }
      best = FLUSH * CAT + digits(fr.sort((a, b) => b - a));
    }
    if (sv >= 0) best = Math.max(best, STRAIGHT * CAT + digits([sv]));
  }

  // everything else, the joker as an ace
  const counts = new Array<number>(13).fill(0);
  for (const r of ranks) counts[r]!++;
  if (joker) counts[ACE]!++;
  if (counts[ACE] === 5) return FIVE_ACES * CAT;
  // ranks by how many, then how high: [rank, count] best first
  const groups: [number, number][] = [];
  for (let r = ACE; r >= 0; r--) if (counts[r]! > 0) groups.push([r, counts[r]!]);
  groups.sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const order = groups.map((g) => g[0]);
  let cat: Category;
  switch (shape) {
    case '41':
      cat = QUADS;
      break;
    case '32':
      cat = FULL_HOUSE;
      break;
    case '311':
      cat = TRIPS;
      break;
    case '221':
      cat = TWO_PAIR;
      break;
    case '2111':
      cat = PAIR;
      break;
    default:
      cat = HIGH_CARD;
  }
  return Math.max(best, cat * CAT + digits(order));
}

/** The score of a two-card hand (the low hand): a pair or two high cards, the joker an ace. */
export function lowScore(cards: readonly PgCard[]): number {
  const a = rankIndex(cards[0]!);
  const b = rankIndex(cards[1]!);
  if (a === b) return PAIR * CAT + digits([a]);
  return digits(a > b ? [a, b] : [b, a]);
}

// ---------------------------------------------------------------------------------------------
// Setting a hand

/** Seven cards split: the five-card high hand ("back") and the two-card low hand ("front"). */
export interface Setting {
  high: PgCard[];
  low: PgCard[];
}

/** The two-card hand may not outrank the five-card hand (a foul). */
export function fouls(s: Setting): boolean {
  return lowScore(s.low) >= highScore(s.high);
}

/** Seven cards with the two at `low` (indexes into `cards`) set as the low hand. */
export function settingOf(cards: readonly PgCard[], low: readonly [number, number]): Setting {
  return { high: cards.filter((_, i) => i !== low[0] && i !== low[1]), low: [cards[low[0]]!, cards[low[1]]!] };
}

/** Where the low hand's two cards sit among the seven, lower index first. */
export function lowIndexes(cards: readonly PgCard[], s: Setting): [number, number] {
  const i = cards.indexOf(s.low[0]!);
  const j = cards.indexOf(s.low[1]!);
  return i < j ? [i, j] : [j, i];
}

// ---------------------------------------------------------------------------------------------
// The house way (Trump Plaza, Atlantic City, as published by the Wizard of Odds)

/** Cards of one rank, the joker counted as an ace, best rank first within a count. */
interface Group {
  rank: number;
  cards: PgCard[];
}

function groupsOf(cards: readonly PgCard[]): Group[] {
  const by = new Map<number, PgCard[]>();
  for (const c of cards) {
    const r = rankIndex(c);
    by.set(r, [...(by.get(r) ?? []), c]);
  }
  return [...by.entries()].map(([rank, cs]) => ({ rank, cards: cs })).sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);
}

const byRank = (a: PgCard, b: PgCard) => rankIndex(b) - rankIndex(a);
const without = (cards: readonly PgCard[], out: readonly PgCard[]) => cards.filter((c) => !out.includes(c));

/** Whether some five of these cards make a straight or a flush (a quick look before trying them all). */
function hasStraightOrFlush(cards: readonly PgCard[]): boolean {
  let mask = 0;
  let wild = 0;
  const suits = [0, 0, 0, 0];
  for (const c of cards) {
    if (c === JOKER) {
      wild = 1;
      continue;
    }
    mask |= 1 << RANK_ORDER.indexOf(c[0]!);
    suits['shdc'.indexOf(c[1]!)]!++;
  }
  return Math.max(...suits) + wild >= 5 || runIn(mask, wild);
}

/** Every five-card subset of seven cards that makes a straight, a flush or a straight flush. */
function straightsAndFlushes(cards: readonly PgCard[]): Setting[] {
  const out: Setting[] = [];
  if (!hasStraightOrFlush(cards)) return out;
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      const s = settingOf(cards, [i, j]);
      const cat = category(highScore(s.high));
      if (cat === STRAIGHT || cat === FLUSH || cat === STRAIGHT_FLUSH) out.push(s);
    }
  return out;
}

/** The low hand as high as it goes, then the high hand as high as it goes. */
function better(a: Setting, b: Setting): Setting {
  const la = lowScore(a.low);
  const lb = lowScore(b.low);
  if (la !== lb) return la > lb ? a : b;
  return highScore(a.high) >= highScore(b.high) ? a : b;
}

/** Keep `back` together in the high hand: the two highest of the rest go in front, the others behind. */
function keep(cards: readonly PgCard[], back: readonly PgCard[]): Setting {
  const rest = without(cards, back).sort(byRank);
  return { low: rest.slice(0, 2), high: [...back, ...rest.slice(2)] };
}

/** Put `front` in the low hand and everything else behind. */
function front(cards: readonly PgCard[], low: readonly PgCard[]): Setting {
  return { low: [...low], high: without(cards, low) };
}

/** Low pairs 2-6, medium 7-10, high jacks to kings, and aces. */
function pairClass(rank: number): 'low' | 'medium' | 'high' | 'aces' {
  if (rank === ACE) return 'aces';
  if (rank >= 9) return 'high';
  if (rank >= 5) return 'medium';
  return 'low';
}

/**
 * How the dealer sets seven cards: the Trump Plaza house way, rule by rule (Wizard of Odds, "The
 * House Way for Pai Gow Poker at the Trump Plaza"; docs/rules/table-games.md lists it). The joker
 * counts as an ace except where it completes a straight or a flush. "King or better" and "an ace"
 * to play in front count the joker as an ace.
 */
export function houseWay(cards: readonly PgCard[]): Setting {
  const groups = groupsOf(cards);
  const shape = groups.map((g) => g.cards.length);
  const singles = groups.filter((g) => g.cards.length === 1).map((g) => g.cards[0]!);
  const pairs = groups.filter((g) => g.cards.length === 2);
  const trips = groups.filter((g) => g.cards.length === 3);
  const topSingle = singles.length ? Math.max(...singles.map(rankIndex)) : -1;

  // Five aces: three in back and two in front, unless there is a pair of kings to play in front.
  if (shape[0] === 5) {
    const aces = groups[0]!.cards;
    if (pairs.length && pairs[0]!.rank === KING) return front(cards, pairs[0]!.cards);
    return front(cards, aces.filter((c) => c !== JOKER).slice(0, 2));
  }

  // Four of a kind.
  if (shape[0] === 4) {
    const quad = groups[0]!;
    // with three of a kind, a pair from it in front; with a pair, the pair in front
    if (trips.length) return front(cards, trips[0]!.cards.slice(0, 2));
    if (pairs.length) return front(cards, pairs[0]!.cards);
    const split = front(cards, quad.cards.slice(0, 2));
    const together = keep(cards, quad.cards);
    if (quad.rank <= 4) return together; // 2 through 6: always together
    if (quad.rank <= 8) return topSingle >= KING ? together : split; // 7 through 10: split unless a king or better
    if (quad.rank <= KING) return topSingle === ACE ? together : split; // jack through king: split unless an ace
    return split; // aces: always split
  }

  // Full houses: three of a kind twice, three of a kind and two pairs, three of a kind and a pair.
  if (trips.length === 2) return front(cards, trips[0]!.cards.slice(0, 2));
  if (trips.length === 1 && pairs.length === 2) return front(cards, pairs[0]!.cards);
  if (trips.length === 1 && pairs.length === 1) {
    const ranks = singles.map(rankIndex).sort((a, b) => b - a);
    // always split, unless the pair is twos with an ace and a king to play in front
    if (pairs[0]!.rank === 0 && ranks[0] === ACE && ranks[1] === KING) return front(cards, singles);
    return front(cards, pairs[0]!.cards);
  }

  // Three of a kind: with a straight or flush to play behind, the pair left over goes in front.
  if (trips.length === 1) {
    const t = trips[0]!;
    const behind = t.cards.map((c) => front(cards, without(t.cards, [c]))).filter((s) => {
      const cat = category(highScore(s.high));
      return cat === STRAIGHT || cat === FLUSH || cat === STRAIGHT_FLUSH;
    });
    if (behind.length) return behind.reduce(better);
    if (t.rank === ACE) {
      // a pair of aces behind and the third ace in front, with the best single
      const ace = t.cards.includes(JOKER) ? JOKER : t.cards[2]!;
      return front(cards, [ace, [...singles].sort(byRank)[0]!]);
    }
    return keep(cards, t.cards);
  }

  // Three pair: the highest pair in front.
  if (pairs.length === 3) return front(cards, pairs[0]!.cards);

  // Two pair: split (the higher pair behind) unless the table says to keep them together.
  if (pairs.length === 2) {
    const [hi, lo] = pairs as [Group, Group];
    const split = front(cards, lo.cards);
    const together = keep(cards, [...hi.cards, ...lo.cards]);
    const a = pairClass(hi.rank);
    const b = pairClass(lo.rank);
    if (a === 'aces') return split;
    if (b === 'low' && (a === 'low' || a === 'medium')) return topSingle >= KING ? together : split;
    if (b === 'low' && a === 'high') return topSingle === ACE ? together : split;
    if (b === 'medium' && a === 'medium') return topSingle === ACE ? together : split;
    return split;
  }

  // One pair: the pair in front only if a straight or flush can be played behind.
  if (pairs.length === 1) {
    const p = pairs[0]!;
    const s = front(cards, p.cards);
    const cat = category(highScore(s.high));
    if (cat === STRAIGHT || cat === FLUSH || cat === STRAIGHT_FLUSH) return s;
    const sf = straightsAndFlushes(cards);
    if (sf.length) return sf.reduce(better);
    return keep(cards, p.cards);
  }

  // No pair: a straight or flush behind, choosing the one that leaves the highest two cards in
  // front; otherwise the highest card behind and the next two in front.
  const sf = straightsAndFlushes(cards);
  if (sf.length) return sf.reduce(better);
  const sorted = [...cards].sort(byRank);
  return { low: [sorted[1]!, sorted[2]!], high: [sorted[0]!, ...sorted.slice(3)] };
}

// ---------------------------------------------------------------------------------------------
// Settlement

/** The two comparisons: high hand to high hand, low to low. A copy (a tie) goes to the dealer. */
export type Outcome = 'win' | 'lose' | 'push';

export interface Settlement {
  outcome: Outcome | null;
  highWins: boolean;
  lowWins: boolean;
  /** The bet back, stake included: 1.95 times it on a win (5% commission), the bet on a push. */
  bet: Cents;
  commission: Cents;
  /** The Fortune bonus back, stake included; 0 lost or not bet. */
  fortune: Cents;
  /** The Fortune line hit (index into FORTUNE_NAMES), or -1. */
  fortuneLine: number;
  wagered: Cents;
  returned: Cents;
}

/** 5% of a win, exactly: bets are whole dollars, so this is a whole number of cents. */
export const COMMISSION_PCT = 5;

/**
 * Settle one hand against the dealer's. The player wins the bet (less 5% commission) only by
 * beating both of the dealer's hands; a copy goes to the dealer; one each pushes.
 */
export function settle(bets: { bet: Cents; fortune: Cents }, player: Setting, dealer: Setting, seven: readonly PgCard[], pay: FortunePays): Settlement {
  const highWins = highScore(player.high) > highScore(dealer.high);
  const lowWins = lowScore(player.low) > lowScore(dealer.low);
  let outcome: Outcome | null = null;
  let bet = 0;
  let commission = 0;
  if (bets.bet > 0) {
    if (highWins && lowWins) {
      outcome = 'win';
      commission = (bets.bet * COMMISSION_PCT) / 100;
      bet = 2 * bets.bet - commission;
    } else if (highWins || lowWins) {
      outcome = 'push';
      bet = bets.bet;
    } else outcome = 'lose';
  }
  let fortune = 0;
  let fortuneLine = -1;
  if (bets.fortune > 0) {
    fortuneLine = fortuneOf(seven);
    const m = fortuneLine >= 0 ? pay[fortuneLine]! : 0;
    if (m > 0) fortune = bets.fortune * (m + 1);
  }
  return { outcome, highWins, lowWins, bet, commission, fortune, fortuneLine, wagered: bets.bet + bets.fortune, returned: bet + fortune };
}

// ---------------------------------------------------------------------------------------------
// The Fortune bonus: the best poker hand in all seven cards, however the hand is set

export const FORTUNE_NAMES = [
  'Seven-card straight flush',
  'Royal flush and royal match',
  'Seven-card straight flush with the joker',
  'Five aces',
  'Royal flush',
  'Straight flush',
  'Four of a kind',
  'Full house',
  'Flush',
  'Three of a kind',
  'Straight',
] as const;

/** To 1, one per FORTUNE_NAMES line. */
export type FortunePays = readonly number[];

/**
 * Wizard of Odds' Fortune pay table 2, which he finds the most common: 8,000, 2,000, 1,000, 400,
 * 150, 50, 25, 5, 4, 3, 2 to 1; three pair and anything less lose. The house edge is exactly
 * 11,970,096 / 154,143,080 = 7.7656% (the 154,143,080 seven-card hands, enumerated in
 * paigow-fortune.exact.mc.test.ts). No Envy Bonus here: see the rules page.
 */
export const DEFAULT_FORTUNE: FortunePays = [8000, 2000, 1000, 400, 150, 50, 25, 5, 4, 3, 2];

function isPays(x: unknown, n: number): x is number[] {
  return Array.isArray(x) && x.length === n && x.every((v) => Number.isSafeInteger(v) && v >= 0);
}

export function fortunePaysOf(options: Record<string, unknown>): FortunePays {
  return isPays(options.fortune, DEFAULT_FORTUNE.length) ? options.fortune : DEFAULT_FORTUNE;
}

/** A card as a number: rank * 4 + suit for the 52, and 52 for the joker. */
export function codeOf(card: PgCard): number {
  return card === JOKER ? 52 : RANK_ORDER.indexOf(card[0]!) * 4 + 'shdc'.indexOf(card[1]!);
}

const ROYAL = 0b1111100000000;
const suitMask = new Int32Array(4);
const rankCount = new Int8Array(13);

/**
 * The Fortune line seven cards hit (0 = seven-card straight flush ... 10 = straight), or -1 for
 * three pair and anything less. Takes codes (codeOf), for the enumeration of every hand.
 */
export function fortuneOfCodes(codes: readonly number[]): number {
  suitMask.fill(0);
  rankCount.fill(0);
  let joker = false;
  let all = 0;
  for (const c of codes) {
    if (c === 52) {
      joker = true;
      continue;
    }
    const r = c >> 2;
    suitMask[c & 3]! |= 1 << r;
    rankCount[r]!++;
    all |= 1 << r;
  }
  const wild = joker ? 1 : 0;

  // seven suited in a row (the ace low in A-7), natural or with the joker in the run
  for (let s = 0; s < 4; s++) {
    const m = suitMask[s]!;
    if (popcount(m) + wild < 7) continue;
    for (let lo = -1; lo <= 6; lo++) {
      const run = lo < 0 ? 0b1000000111111 : 0b1111111 << lo;
      if (popcount(run & ~m) <= wild) return joker ? 2 : 0;
    }
  }
  // a royal flush, and the other two cards a suited king and queen
  let royal = false;
  for (let s = 0; s < 4; s++) {
    const missing = ROYAL & ~suitMask[s]!;
    const n = popcount(missing);
    if (n > wild) continue;
    royal = true;
    // the royal's five cards (the joker standing in for a missing one), then the two left
    const choices: number[][] = [];
    const inRoyal = (c: number) => c !== 52 && (c & 3) === s && ((1 << (c >> 2)) & ROYAL) !== 0;
    if (n === 0) {
      choices.push(codes.filter((c) => !inRoyal(c)));
      // the joker can also stand in for one of them, freeing that card
      if (joker) for (const c of codes) if (inRoyal(c)) choices.push(codes.filter((x) => x === c || (!inRoyal(x) && x !== 52)));
    } else choices.push(codes.filter((c) => !inRoyal(c) && c !== 52));
    for (const left of choices) {
      if (left.length !== 2 || left.includes(52)) continue;
      const [a, b] = left as [number, number];
      if ((a & 3) === (b & 3) && Math.max(a >> 2, b >> 2) === KING && Math.min(a >> 2, b >> 2) === QUEEN) return 1;
    }
  }
  if (joker && rankCount[ACE] === 4) return 3;
  if (royal) return 4;
  // a straight flush: five suited in a row, the joker filling one
  for (let s = 0; s < 4; s++) if (runIn(suitMask[s]!, wild)) return 5;
  // the joker is an ace for everything else
  let quads = false;
  let tripsN = 0;
  let pairsN = 0;
  for (let r = 0; r < 13; r++) {
    const n = rankCount[r]! + (joker && r === ACE ? 1 : 0);
    if (n >= 4) quads = true;
    else if (n === 3) tripsN++;
    else if (n === 2) pairsN++;
  }
  if (quads) return 6;
  if (tripsN >= 2 || (tripsN === 1 && pairsN >= 1)) return 7;
  for (let s = 0; s < 4; s++) if (popcount(suitMask[s]!) + wild >= 5) return 8;
  if (tripsN === 1) return 9;
  if (runIn(all, wild)) return 10;
  return -1;
}

/** Whether ranks `m` hold five in a row, `wild` of them missing. */
function runIn(m: number, wild: number): boolean {
  for (let lo = 0; lo <= 8; lo++) if (popcount((0b11111 << lo) & ~m) <= wild) return true;
  return popcount(0b1000000001111 & ~m) <= wild;
}

export function fortuneOf(cards: readonly PgCard[]): number {
  return fortuneOfCodes(cards.map(codeOf));
}

// ---------------------------------------------------------------------------------------------
// The deal

/** The 52 cards and the joker. */
export const DECK: readonly PgCard[] = [...newDeck(), JOKER];

/**
 * A fresh 53-card deck every round: seven cards to each spot, then seven to the dealer. The
 * Fisher-Yates shuffle stops once the dealt cards are in place (as at Three Card Poker).
 */
export function dealHands(rng: Rng, spots: number): { hands: PgCard[][]; dealer: PgCard[] } {
  const deck = DECK.slice();
  const dealt: PgCard[] = [];
  for (let i = deck.length - 1; dealt.length < 7 * (spots + 1); i--) {
    const j = randInt(rng, i + 1);
    const card = deck[j]!;
    deck[j] = deck[i]!;
    deck[i] = card;
    dealt.push(card);
  }
  const hands: PgCard[][] = [];
  for (let s = 0; s < spots; s++) hands.push(dealt.slice(7 * s, 7 * s + 7));
  return { hands, dealer: dealt.slice(7 * spots) };
}

// ---------------------------------------------------------------------------------------------
// Names

const NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

/** Base-14 digits of a score's tiebreak, most significant first. */
function tiebreak(score: number): number[] {
  let t = score % CAT;
  const out: number[] = [];
  for (let i = 0; i < 5; i++) {
    out.unshift(t % 14);
    t = Math.floor(t / 14);
  }
  return out;
}

/** What the dealer calls a five-card hand: "Kings full of Fours", "Queen high", "Five aces". */
export function highName(score: number): string {
  const d = tiebreak(score);
  switch (category(score)) {
    case FIVE_ACES:
      return 'Five aces';
    case STRAIGHT_FLUSH:
      return d[0] === 13 ? 'Royal flush' : d[0] === 12 ? 'Straight flush, five high' : 'Straight flush';
    case QUADS:
      return `Four ${PLURALS[d[0]!]}`;
    case FULL_HOUSE:
      return `${PLURALS[d[0]!]} full of ${PLURALS[d[1]!]}`;
    case FLUSH:
      return `${NAMES[d[0]!]}-high flush`;
    case STRAIGHT:
      return d[0] === 13 ? 'Ace-high straight' : d[0] === 12 ? 'Wheel, A-2-3-4-5' : `${NAMES[d[0]!]}-high straight`;
    case TRIPS:
      return `Three ${PLURALS[d[0]!]}`;
    case TWO_PAIR:
      return `${PLURALS[d[0]!]} and ${PLURALS[d[1]!]}`;
    case PAIR:
      return `Pair of ${PLURALS[d[0]!]}`;
    default:
      return `${NAMES[d[0]!]} high`;
  }
}

const SHORT = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** A two-card hand: "Pair of Nines", "A-K". */
export function lowName(score: number): string {
  const d = tiebreak(score);
  return category(score) === PAIR ? `Pair of ${PLURALS[d[0]!]}` : `${SHORT[d[0]!]}-${SHORT[d[1]!]}`;
}
