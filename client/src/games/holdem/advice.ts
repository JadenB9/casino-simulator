// Tips at the Hold'em seat: what your cards make, how often they win against the players still
// in, and what the price of a call says. The chance comes from dealing the rest of the hand out
// a few hundred times with the bots' own equity routine (random hands for opponents, stronger ones
// for anyone who raised before the flop), so it is an estimate: a guide, not a guarantee.
//
// From the flop on the play is the pot odds: call when your chance beats the share of the final
// pot the call would be. Before the flop the price is a poor guide (most of the players still to
// act will fold, so the chance against all of them undersells a good hand), so the play comes from
// the opening charts by seat the bots use instead (ranges.ts): open the chart for your seat,
// re-raise the top of a raiser's range, call with the next slice when the price is right.

import type { Card } from '../../../../shared/src/cards.ts';
import type { Cents } from '../../../../shared/src/money.ts';
import type { Rng } from '../../../../shared/src/rng.ts';
import { evaluate, cardInt, HIGH_CARD, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH } from '../../../../shared/src/games/holdem/eval.ts';
import { equity, openWidth, sklanskyGroup, type Position } from '../../../../shared/src/games/holdem/bots.ts';
import { strength as handRank } from '../../../../shared/src/games/holdem/ranges.ts';

const ONE = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
const MANY = ['twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A made hand in words: "Pair of kings", "Full house, kings full of nines", "Royal flush". */
export function madeName(value: number): string {
  const a = (value >> 16) & 15;
  const b = (value >> 12) & 15;
  switch (value >> 20) {
    case STRAIGHT_FLUSH:
      return a === 12 ? 'Royal flush' : `Straight flush, ${ONE[a]} high`;
    case QUADS:
      return `Four of a kind, ${MANY[a]}`;
    case FULL_HOUSE:
      return `Full house, ${MANY[a]} full of ${MANY[b]}`;
    case FLUSH:
      return `Flush, ${ONE[a]} high`;
    case STRAIGHT:
      return `Straight, ${ONE[a]} high`;
    case TRIPS:
      return `Three of a kind, ${MANY[a]}`;
    case TWO_PAIR:
      return `Two pair, ${MANY[a]} and ${MANY[b]}`;
    case PAIR:
      return `Pair of ${MANY[a]}`;
    default:
      return `${cap(ONE[a]!)} high`;
  }
}

/** A made hand as a banner prints it: the category, then what it is ("Full house" / "Kings full of nines"). */
export function bannerOf(value: number): { title: string; sub: string | null } {
  const name = madeName(value);
  const comma = name.indexOf(', ');
  return comma < 0 ? { title: name, sub: null } : { title: name.slice(0, comma), sub: cap(name.slice(comma + 2)) };
}

/** Two hole cards the way players say them: "Pocket kings", "Ace-king suited", "Seven-two offsuit". */
export function startName(a: Card, b: Card): string {
  let r1 = cardInt(a) >> 2;
  let r2 = cardInt(b) >> 2;
  if (r1 === r2) return `Pocket ${MANY[r1]}`;
  if (r2 > r1) [r1, r2] = [r2, r1];
  return `${cap(ONE[r1]!)}-${ONE[r2]} ${a[1] === b[1] ? 'suited' : 'offsuit'}`;
}

/** The Sklansky-Malmuth groups in a word. */
function strength(group: number): string {
  return group <= 2 ? 'a premium hand' : group <= 4 ? 'a strong hand' : group <= 6 ? 'a playable hand' : group <= 8 ? 'a marginal hand' : 'a weak hand';
}

function rankMask(cards: readonly number[]): number {
  let m = 0;
  for (const c of cards) m |= 1 << (c >> 2);
  return m;
}

/** Top rank of the best straight in a 13-bit rank mask (the wheel is five-high), or -1. */
function straightTop(mask: number): number {
  for (let t = 12; t >= 4; t--) if (((mask >> (t - 4)) & 31) === 31) return t;
  return (mask & 0x100f) === 0x100f ? 3 : -1;
}

/**
 * The hand is all on the board, so everyone still in has it too: a pair, trips or two pair
 * the hole cards take no part in, or on the river a board that beats both hole cards.
 */
export function onBoard(hole: readonly number[], board: readonly number[], value: number): boolean {
  if (board.length === 5) return evaluate(board) === value;
  const a = (value >> 16) & 15;
  const b = (value >> 12) & 15;
  const holds = (r: number) => hole.some((c) => c >> 2 === r);
  switch (value >> 20) {
    case PAIR:
    case TRIPS:
    case QUADS:
      return !holds(a);
    case TWO_PAIR:
      return !holds(a) && !holds(b);
    default:
      return false;
  }
}

export interface Draws {
  flush: boolean;
  /** 'open': four in a row, eight outs; 'double': two inside draws, eight outs; 'gutshot': four outs. */
  straight: 'open' | 'double' | 'gutshot' | null;
}

/** Draws that use a hole card, on the flop or the turn (a finished board has none). */
export function drawsOf(hole: readonly number[], board: readonly number[]): Draws {
  if (board.length < 3 || board.length > 4) return { flush: false, straight: null };
  const all = [...hole, ...board];
  const cat = evaluate(all) >> 20;
  let flush = false;
  if (cat < FLUSH) {
    for (let s = 0; s < 4; s++) {
      if (all.filter((c) => (c & 3) === s).length === 4 && hole.some((c) => (c & 3) === s)) flush = true;
    }
  }
  let straight: Draws['straight'] = null;
  if (cat < STRAIGHT) {
    const mask = rankMask(all);
    const boardMask = rankMask(board);
    let ranks = 0;
    for (let r = 0; r < 13; r++) {
      const bit = 1 << r;
      if (mask & bit) continue;
      // It counts only if the straight it makes beats the one the board would make with it alone.
      const top = straightTop(mask | bit);
      if (top >= 0 && top > straightTop(boardMask | bit)) ranks++;
    }
    let fourInRow = false;
    for (let t = 0; t <= 9; t++) if (((mask >> t) & 15) === 15) fourInRow = true;
    if (ranks >= 2) straight = fourInRow ? 'open' : 'double';
    else if (ranks === 1) straight = 'gutshot';
  }
  return { flush, straight };
}

function drawText(d: Draws): string | null {
  if (d.flush && d.straight) return 'flush and straight draw';
  if (d.flush) return 'flush draw';
  if (d.straight === 'open') return 'open-ended straight draw';
  if (d.straight === 'double') return 'double gutshot straight draw';
  if (d.straight === 'gutshot') return 'gutshot straight draw';
  return null;
}

/** Your hand in a few words: "Pocket kings", "Pair of kings, flush draw", "Flush draw", "Ace high". */
export function readHand(hole: readonly Card[], board: readonly Card[]): string {
  if (board.length === 0) return startName(hole[0]!, hole[1]!);
  const h = hole.map(cardInt);
  const b = board.map(cardInt);
  const v = evaluate([...h, ...b]);
  const made = madeName(v) + (onBoard(h, b, v) ? ' on the board' : '');
  const draw = drawText(drawsOf(h, b));
  if (!draw) return made;
  return v >> 20 === HIGH_CARD ? cap(draw) : `${made}, ${draw}`;
}

/**
 * Your chance of winning at showdown against these opponents (a split counts its share). At
 * least `min` deals, then more while there's time, so a fast machine gets a steadier number
 * and a slow one still answers in about `budgetMs`.
 */
export function estimateEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: readonly { strong: boolean }[],
  rng: Rng,
  opts: { min?: number; max?: number; budgetMs?: number } = {},
): number {
  if (opponents.length === 0) return 1;
  const min = opts.min ?? 400;
  const max = opts.max ?? 2000;
  const budget = opts.budgetMs ?? 12;
  const h = hole.map(cardInt);
  const b = board.map(cardInt);
  const batch = 200;
  const t0 = performance.now();
  let n = 0;
  let sum = 0;
  while (n < min || (n < max && performance.now() - t0 < budget)) {
    sum += equity(h, b, opponents, batch, rng) * batch;
    n += batch;
  }
  return sum / n;
}

/** The share of the final pot a call is, which is the chance you need to break even by calling. */
export function potOdds(call: Cents, total: Cents): number {
  return call <= 0 ? 0 : call / (total + call);
}

function after(list: readonly number[], seat: number): number {
  for (const s of list) if (s > seat) return s;
  return list[0]!;
}

/** Where a seat acts before the flop, the same way the engine places its bots. */
export function positionOf(seat: number, dealt: readonly number[], button: number, sb: number | null, bb: number | null): Position {
  if (seat === button) return 'late';
  if (seat === sb) return 'sb';
  if (seat === bb) return 'bb';
  const seats = [...dealt].sort((x, y) => x - y);
  const order: number[] = [];
  if (bb !== null && seats.length) {
    for (let x = after(seats, bb); x !== button && order.length < seats.length; x = after(seats, x)) order.push(x);
  }
  const i = order.indexOf(seat);
  const f = order.length <= 1 ? 1 : i / order.length;
  return f < 1 / 3 ? 'early' : f < 2 / 3 ? 'middle' : 'late';
}

/** A seat's place for the charts, the way the engine places its bots: 0 the button, 1 the cutoff...; -1 and -2 the blinds. */
export function distOf(seat: number, dealt: readonly number[], button: number, sb: number | null, bb: number | null): number {
  const seats = [...dealt].sort((x, y) => x - y);
  if (seats.length === 2) return seat === button ? 0 : -2;
  if (seat === sb) return -1;
  if (seat === bb) return -2;
  let d = 0;
  for (let x = seat; x !== button && d < seats.length; x = after(seats, x)) d++;
  return d;
}

export type Pick = 'fold' | 'check' | 'call' | 'raise';

/** One decision, from what the seat can see. */
export interface Spot {
  hole: readonly Card[];
  board: readonly Card[];
  /** Players still in against you. */
  opponents: number;
  /** What a call costs (0: you can check). */
  call: Cents;
  /** Everything committed this hand, the pots and the bets in front of the seats. */
  total: Cents;
  /** Your chips behind. */
  behind: Cents;
  /** A bet or raise is open to you, and whether it would be the first bet of the street. */
  canRaise: boolean;
  opening: boolean;
  position: Position;
  /** Your place before the flop: 0 the button, 1 the cutoff, ...; -1 small blind, -2 big blind (from `position` when missing). */
  dist?: number;
  /** Players dealt in (six when missing). */
  players?: number;
  /** Bets and raises before the flop so far. */
  raises: number;
}

export interface Advice {
  text: string;
  /** The control to ring. */
  pick: Pick;
}

// A seat's place for the charts when only its position is known.
const DIST: Record<Position, number> = { early: 3, middle: 2, late: 0, sb: -1, bb: -2 };

/**
 * The charts' play: open the chart for your seat; against a raise (a middle-position opener's
 * range, about a fifth of hands), re-raise its top eighth and call the next slice at a normal
 * price, wider in the big blind by the price; against a re-raise, only the very top goes on.
 */
function preflopPick(pct: number, s: Spot): Pick {
  const canCheck = s.call === 0;
  const dist = s.dist ?? DIST[s.position];
  if (s.raises === 0) return pct < openWidth(dist, s.players ?? 6) ? 'raise' : canCheck ? 'check' : 'fold';
  const opener = openWidth(2, 6);
  if (s.raises === 1 && pct < opener * 0.14) return 'raise';
  if (s.raises >= 2 && pct < 0.02) return 'raise';
  // Calling a raise that is most of your stack takes one of those hands.
  const cheap = s.call <= s.behind * 0.3;
  if (s.raises === 1 && cheap) {
    if (dist === -2) {
      // The big blind closes the action at a price: defend by it.
      const odds = Math.max(0.08, potOdds(s.call, s.total));
      if (pct < opener * Math.min(1.8, Math.max(0.45, 1.4 * (0.27 / odds)))) return 'call';
    } else if (pct < opener * (dist === -1 ? 0.3 : 0.5)) return 'call';
  }
  if (s.raises >= 2 && cheap && pct < 0.06) return 'call';
  return canCheck ? 'check' : 'fold';
}

/** What to do, with the numbers behind it, in one short line. */
export function advise(s: Spot, eq: number): Advice {
  const read = readHand(s.hole, s.board);
  const have = Math.round(eq * 100);
  const vs = s.opponents > 1 ? ` against ${s.opponents} players` : '';
  const legal = (p: Pick): Pick => (p === 'raise' && !s.canRaise ? (s.call > 0 ? 'call' : 'check') : p === 'fold' && s.call === 0 ? 'check' : p);
  const verb = (p: Pick) => (p === 'raise' && s.opening ? 'bet' : p);

  if (s.board.length === 0) {
    const a = cardInt(s.hole[0]!);
    const b = cardInt(s.hole[1]!);
    const group = sklanskyGroup(a, b);
    const pick = legal(preflopPick(handRank(a, b), s));
    return { text: `${read}, ${strength(group)}. You have about ${have}%${vs}: ${verb(pick)}.`, pick };
  }

  // Thresholds from your fair share of the pot: bet when well ahead of it, raise when far ahead.
  const fair = 1 / (s.opponents + 1);
  if (s.call === 0) {
    const pick = legal(eq >= fair + (1 - fair) * 0.25 ? 'raise' : 'check');
    return { text: `${read}. Nothing to call, you have about ${have}%${vs}: ${verb(pick)}.`, pick };
  }
  // Decided on the rounded numbers, so the line never reads "needs 25%, you have 25%: fold".
  const need = Math.round(potOdds(s.call, s.total) * 100);
  const pick = legal(have < need ? 'fold' : eq >= fair + (1 - fair) * 0.5 ? 'raise' : 'call');
  return { text: `${read}. Calling needs ${need}%, you have about ${have}%${vs}: ${verb(pick)}.`, pick };
}
