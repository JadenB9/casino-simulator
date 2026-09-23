// Opponents for single-player tables (4.9): believable and different from one another, not a
// solver. Before the flop a bot scores its hand with the Chen formula or the Sklansky-Malmuth
// groups and plays it by position; after the flop it estimates its equity by dealing out the
// rest of the hand a few hundred times against the players still in, and compares that with the
// pot odds. Sizing and bluffing follow the starting points in the rules doc.
//
// A bot decides from what its own seat could see at a real table (its two cards, the board, the
// bets, the stacks and who raised) plus a random source. It never sees the deck or anyone's
// hole cards; the engine builds its situation from public state and the bot's own hand.

import type { Cents } from '../../money.ts';
import { type Rng, randInt, randUnit } from '../../rng.ts';
import { evaluate } from './eval.ts';
import type { Legal, MoveKind } from './rules.ts';

export interface Persona {
  id: string;
  /** Which preflop yardstick this bot uses. */
  preflop: 'chen' | 'sklansky';
  /** Added to every preflop threshold: positive is tighter. */
  open: number;
  /** Extra equity wanted over the pot odds before calling: positive is tighter. */
  call: number;
  /** How often it bets or raises without the goods. */
  bluff: number;
  /** How often it bets its value hands instead of checking them; also sizes up a little. */
  aggro: number;
  /** Typical think time, ms. */
  think: number;
}

export const PERSONAS: Record<string, Persona> = {
  rock: { id: 'rock', preflop: 'sklansky', open: 1.5, call: 0.07, bluff: 0.04, aggro: 0.45, think: 1700 },
  tag: { id: 'tag', preflop: 'chen', open: 0, call: 0.03, bluff: 0.12, aggro: 0.75, think: 1400 },
  lag: { id: 'lag', preflop: 'chen', open: -2, call: 0, bluff: 0.22, aggro: 0.9, think: 1000 },
  station: { id: 'station', preflop: 'sklansky', open: -1, call: -0.06, bluff: 0.05, aggro: 0.3, think: 1200 },
  reg: { id: 'reg', preflop: 'sklansky', open: 0, call: 0.02, bluff: 0.15, aggro: 0.65, think: 1500 },
};

export const PERSONA_IDS = Object.keys(PERSONAS);

// ---------------------------------------------------------------------------------------------
// Preflop hand strength

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

export function preflopScore(a: number, b: number, how: Persona['preflop']): number {
  return how === 'chen' ? chen(a, b) : GROUP_SCORE[sklanskyGroup(a, b)]!;
}

// ---------------------------------------------------------------------------------------------
// Equity

const pool = new Int32Array(52);
const seen = new Uint8Array(52);
const seven = new Int32Array(7);

/**
 * Chance of winning at showdown against the opponents still in (a k-way tie counts 1/k), by
 * dealing random hands and the rest of the board `samples` times. An opponent who raised before
 * the flop is dealt from stronger hands (Chen 8 or more, by rejection) instead of any two cards.
 */
export function equity(hole: readonly number[], board: readonly number[], opponents: readonly { strong: boolean }[], samples: number, rng: Rng): number {
  seen.fill(0);
  for (const c of hole) seen[c] = 1;
  for (const c of board) seen[c] = 1;
  let n = 0;
  for (let c = 0; c < 52; c++) if (seen[c] === 0) pool[n++] = c;
  const need = 5 - board.length;
  const opp = new Int32Array(opponents.length * 2);
  let k = 0;
  // A partial Fisher-Yates shuffle: each draw swaps a random undrawn card into place.
  const draw = () => {
    const j = k + randInt(rng, n - k);
    const t = pool[k]!;
    pool[k] = pool[j]!;
    pool[j] = t;
    return pool[k++]!;
  };
  let total = 0;
  for (let s = 0; s < samples; s++) {
    k = 0;
    for (let o = 0; o < opponents.length; o++) {
      let a = draw();
      let b = draw();
      if (opponents[o]!.strong) {
        for (let tries = 0; tries < 6 && chen(a, b) < 8; tries++) {
          k -= 2; // put them back and deal again
          a = draw();
          b = draw();
        }
      }
      opp[2 * o] = a;
      opp[2 * o + 1] = b;
    }
    for (let i = 0; i < board.length; i++) seven[2 + i] = board[i]!;
    for (let i = 0; i < need; i++) seven[2 + board.length + i] = draw();
    seven[0] = hole[0]!;
    seven[1] = hole[1]!;
    const mine = evaluate(seven, 7);
    let best = -1;
    let count = 0;
    for (let o = 0; o < opponents.length; o++) {
      seven[0] = opp[2 * o]!;
      seven[1] = opp[2 * o + 1]!;
      const v = evaluate(seven, 7);
      if (v > best) {
        best = v;
        count = 1;
      } else if (v === best) count++;
    }
    if (mine > best) total += 1;
    else if (mine === best) total += 1 / (count + 1);
  }
  return total / samples;
}

// ---------------------------------------------------------------------------------------------
// Decisions

export type Position = 'early' | 'middle' | 'late' | 'sb' | 'bb';

/** Everything a bot knows when it has to act. */
export interface BotSituation {
  hole: [number, number];
  board: number[];
  street: 0 | 1 | 2 | 3;
  bb: Cents;
  step: Cents;
  /** All chips committed this hand, including the bets in front of the seats. */
  pot: Cents;
  /** The bet to match on this street (a street total). */
  bet: Cents;
  legal: Legal;
  position: Position;
  /** Opponents still in the hand; `strong` if they raised before the flop. */
  opponents: { strong: boolean }[];
  /** Bets and raises before the flop so far (the blinds don't count). */
  preRaises: number;
  /** Players who just called the big blind before anyone raised. */
  limpers: number;
  /** Bets and raises on this street so far. */
  streetRaises: number;
  /** This bot made the last bet or raise on the previous street (a continuation-bet spot). */
  aggressor: boolean;
}

export interface BotDecision {
  kind: MoveKind;
  to?: Cents;
}

export const EQUITY_SAMPLES = 300;

export function decide(sit: BotSituation, persona: Persona, rng: Rng): BotDecision {
  return sit.street === 0 ? preflop(sit, persona, rng) : postflop(sit, persona, rng);
}

function passive(sit: BotSituation): BotDecision {
  return sit.legal.canCheck ? { kind: 'check' } : { kind: 'fold' };
}

/** A bet or raise to about `target` (a street total), made legal: clamped, in whole steps, all-in when it is most of the stack. */
function aggressive(sit: BotSituation, target: Cents): BotDecision {
  const l = sit.legal;
  if (!l.canBet && !l.canRaise) return l.toCall > 0 ? { kind: 'call' } : { kind: 'check' };
  let to = Math.max(l.minTo, Math.round(target / sit.step) * sit.step);
  if (to >= l.maxTo * 0.8 || to >= l.maxTo) return { kind: 'allin' };
  to = Math.min(to, l.maxTo);
  return { kind: sit.bet === 0 ? 'bet' : 'raise', to };
}

function call(sit: BotSituation): BotDecision {
  return sit.legal.toCall > 0 ? { kind: 'call' } : { kind: 'check' };
}

const OPEN_AT: Record<Position, number> = { early: 9, middle: 8, late: 7, sb: 8, bb: 9 };

function preflop(sit: BotSituation, p: Persona, rng: Rng): BotDecision {
  const l = sit.legal;
  // A little randomness on every threshold so a bot can't be read exactly.
  const jitter = randUnit(rng) < 0.5 ? 0 : randUnit(rng) < 0.5 ? -1 : 1;
  const score = preflopScore(sit.hole[0], sit.hole[1], p.preflop) + jitter;
  const bbs = l.maxTo / sit.bb; // chips this bot can play this hand, in big blinds
  const openAt = OPEN_AT[sit.position] + p.open;
  const suitedOrConnected = (sit.hole[0] & 3) === (sit.hole[1] & 3) || Math.abs((sit.hole[0] >> 2) - (sit.hole[1] >> 2)) === 1;

  // Short stacked: move in or get out.
  if (bbs <= 12) {
    if (sit.preRaises === 0 && score >= openAt - 1) return { kind: 'allin' };
    if (sit.preRaises > 0 && score >= 10 + p.open / 2) return { kind: 'allin' };
    return passive(sit);
  }

  if (sit.preRaises === 0) {
    if (score >= openAt) {
      const size = (2.5 + randUnit(rng) * 0.5 + sit.limpers) * sit.bb;
      return aggressive(sit, size);
    }
    if (l.canCheck) {
      // The big blind's option: raise the limpers with a good hand now and then, else check.
      if (score >= openAt - 1 && randUnit(rng) < p.aggro * 0.5) return aggressive(sit, (3 + sit.limpers) * sit.bb);
      return { kind: 'check' };
    }
    // Complete the small blind or limp behind with speculative hands, if that's this bot's style.
    const limpAt = openAt - (sit.position === 'sb' ? 2 : 3) + (p.aggro > 0.6 ? 1 : 0);
    if (score >= limpAt && l.toCall <= sit.bb && randUnit(rng) < 0.75) return call(sit);
    return passive(sit);
  }

  const potOdds = l.toCall / (sit.pot + l.toCall);
  const deep = l.toCall < l.behind * 0.3;
  if (sit.preRaises === 1) {
    if (score >= 12 + p.open / 2) return aggressive(sit, sit.bet * (sit.position === 'sb' || sit.position === 'bb' ? 3.5 : 3));
    if (score >= 10 + p.open / 2 && deep) return call(sit);
    // In the blinds against a small raise the price is good: defend wider.
    if ((sit.position === 'bb' || sit.position === 'sb') && potOdds < 0.3 && score >= 7 + p.open) return call(sit);
    if (deep && suitedOrConnected && score >= 6 && randUnit(rng) < p.bluff * 0.35) return aggressive(sit, sit.bet * 3);
    if (!deep && score >= 12) return { kind: 'allin' };
    return passive(sit);
  }
  // Facing a re-raise or more.
  if (score >= 14) return l.toCall > l.behind * 0.35 ? { kind: 'allin' } : aggressive(sit, sit.bet * 2.3);
  if (score >= 12 + Math.max(0, p.open) && l.toCall <= l.behind * 0.4) return call(sit);
  return passive(sit);
}

/** How connected and suited the board is: small bets on dry boards, bigger on wet ones. */
function wetness(board: readonly number[]): number {
  const suits = [0, 0, 0, 0];
  let mask = 0;
  for (const c of board) {
    suits[c & 3]!++;
    mask |= 1 << (c >> 2);
  }
  let w = Math.max(...suits) >= 3 ? 0.5 : Math.max(...suits) === 2 ? 0.25 : 0;
  for (let t = 0; t <= 8; t++) {
    const bits = (mask >> t) & 31;
    let n = 0;
    for (let b = bits; b; b &= b - 1) n++;
    if (n >= 3) {
      w += 0.4;
      break;
    }
  }
  return Math.min(1, w);
}

function postflop(sit: BotSituation, p: Persona, rng: Rng): BotDecision {
  const l = sit.legal;
  const n = Math.max(1, sit.opponents.length);
  const eq = equity(sit.hole, sit.board, sit.opponents, EQUITY_SAMPLES, rng);
  const fair = 1 / (n + 1);
  const valueAt = fair + (1 - fair) * (0.28 - p.aggro * 0.08);
  const raiseAt = fair + (1 - fair) * 0.5;
  const wet = wetness(sit.board);
  const u = randUnit(rng);

  if (l.canCheck) {
    if (!l.canBet && !l.canRaise) return { kind: 'check' };
    const fraction = 0.5 + wet * 0.25 + (p.aggro - 0.5) * 0.1;
    if (eq >= valueAt) {
      // Mostly bet for value; now and then check a monster to let others catch up.
      if (eq >= raiseAt && u < 0.12) return { kind: 'check' };
      if (u < 0.35 + p.aggro * 0.6) return aggressive(sit, sit.pot * fraction);
      return { kind: 'check' };
    }
    const drawing = sit.street < 3 && eq >= fair + 0.08;
    if (drawing && u < p.bluff * 1.6) return aggressive(sit, sit.pot * 0.5);
    if (sit.aggressor && sit.street === 1 && u < 0.25 + p.bluff * 1.5) return aggressive(sit, sit.pot * (0.45 + wet * 0.2));
    // Pure bluffs, most often on the river, where a half-pot bluff should be a quarter of bets.
    if (sit.street === 3 && n === 1 && u < p.bluff) return aggressive(sit, sit.pot * 0.5);
    return { kind: 'check' };
  }

  const potOdds = l.toCall / (sit.pot + l.toCall);
  if (eq >= raiseAt && l.canRaise && u < 0.55 + p.aggro * 0.4) {
    return aggressive(sit, sit.bet * 3 + (sit.pot - sit.bet) * 0.25);
  }
  if (eq >= potOdds + p.call) return call(sit);
  // Minimum defense: fold a hand this weak most of the time, but not always, against a small bet.
  if (potOdds < 0.25 && eq >= potOdds * 0.8 && u < 0.3) return call(sit);
  if (l.canRaise && sit.street < 3 && sit.streetRaises === 1 && u < p.bluff * 0.12) return aggressive(sit, sit.bet * 3);
  return { kind: 'fold' };
}

/** How long a bot takes to act, ms: quick folds, longer over big decisions. */
export function thinkTime(sit: BotSituation, p: Persona, rng: Rng): number {
  const big = sit.legal.toCall > sit.pot * 0.5 || sit.street >= 2 ? 1.3 : 1;
  return Math.round((p.think * (0.55 + randUnit(rng) * 0.9)) * big);
}
