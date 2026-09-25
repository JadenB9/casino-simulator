// Machine E, "Lucky Cherries": five reels by three rows, 10 fixed lines, fruit and no wild. Cherries
// pay from two on a line. Three or more BONUS symbols anywhere spin the Cherry Wheel on the
// topper: 20 equal segments, each a prize in total bets, multiplied by 1, 2 or 5 for three, four
// or five BONUS symbols. The strips, lines and pays are docs/math/slot-e-lucky-cherries.mjs, the
// published PAR sheet (docs/rules/cards-and-machines.md §3.8).

import type { Cents } from '../../money.ts';
import { randInt, type Rng } from '../../rng.ts';
import { lineCredits, lineTables, lineWins, scatterCount, type LineMachine } from './lines.ts';
import type { ReelsEvent, SpinSettlement, WheelSpin } from './protocol.ts';

export const CHERRY_SYMBOLS = ['SEVEN', 'BELL', 'MELON', 'GRAPES', 'PLUM', 'ORANGE', 'LEMON', 'CHERRY', 'BONUS'] as const;
export type CherrySymbol = (typeof CHERRY_SYMBOLS)[number];

export interface CherriesMachine extends LineMachine<CherrySymbol, 'cherries'> {
  /** Prizes in total bets, clockwise from segment 0 (at the pointer when the wheel is at rest). */
  wheel: readonly number[];
  /** Wheel multiplier by BONUS count (index = count). */
  wheelMult: readonly number[];
  /** BONUS symbols that spin the wheel. */
  trigger: number;
}

export const CHERRIES: CherriesMachine = {
  kind: 'lines',
  id: 'cherries',
  name: 'Lucky Cherries',
  // 1¢, 5¢, 25¢, $1 and $5, and the high-limit room's $25, $100 and $500 ($25,000 a spin: 5 a line on 10 lines)
  denoms: [1, 5, 25, 100, 500, 2500, 10_000, 50_000],
  maxCoins: 5,
  lines: 10,
  rows: 3,
  symbols: CHERRY_SYMBOLS,
  strips: [
    ['CHERRY', 'LEMON', 'SEVEN', 'PLUM', 'CHERRY', 'ORANGE', 'MELON', 'GRAPES', 'CHERRY', 'LEMON', 'BELL', 'CHERRY', 'PLUM', 'ORANGE', 'BONUS', 'CHERRY', 'GRAPES', 'LEMON', 'MELON', 'CHERRY', 'PLUM', 'ORANGE', 'BELL', 'CHERRY', 'GRAPES', 'LEMON', 'CHERRY', 'MELON', 'ORANGE', 'PLUM'],
    ['CHERRY', 'ORANGE', 'PLUM', 'CHERRY', 'GRAPES', 'LEMON', 'BELL', 'CHERRY', 'MELON', 'ORANGE', 'LEMON', 'CHERRY', 'PLUM', 'SEVEN', 'GRAPES', 'CHERRY', 'ORANGE', 'MELON', 'CHERRY', 'LEMON', 'BONUS', 'PLUM', 'CHERRY', 'BELL', 'GRAPES', 'ORANGE', 'CHERRY', 'LEMON', 'MELON', 'PLUM'],
    ['SEVEN', 'LEMON', 'CHERRY', 'ORANGE', 'GRAPES', 'PLUM', 'LEMON', 'MELON', 'CHERRY', 'ORANGE', 'BELL', 'GRAPES', 'LEMON', 'PLUM', 'CHERRY', 'ORANGE', 'BONUS', 'MELON', 'LEMON', 'GRAPES', 'CHERRY', 'PLUM', 'ORANGE', 'BELL', 'LEMON', 'GRAPES', 'CHERRY', 'ORANGE', 'MELON', 'PLUM'],
    ['BELL', 'ORANGE', 'LEMON', 'GRAPES', 'CHERRY', 'PLUM', 'MELON', 'ORANGE', 'LEMON', 'BONUS', 'GRAPES', 'BELL', 'PLUM', 'CHERRY', 'ORANGE', 'LEMON', 'MELON', 'SEVEN', 'GRAPES', 'PLUM', 'ORANGE', 'CHERRY', 'BELL', 'LEMON', 'MELON', 'GRAPES', 'ORANGE', 'PLUM', 'CHERRY', 'LEMON'],
    ['LEMON', 'PLUM', 'BELL', 'ORANGE', 'GRAPES', 'LEMON', 'CHERRY', 'PLUM', 'MELON', 'ORANGE', 'SEVEN', 'LEMON', 'GRAPES', 'PLUM', 'BELL', 'ORANGE', 'CHERRY', 'LEMON', 'MELON', 'PLUM', 'GRAPES', 'BONUS', 'ORANGE', 'BELL', 'LEMON', 'PLUM', 'CHERRY', 'GRAPES', 'ORANGE', 'MELON'],
  ],
  lineRows: [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
  ],
  linePays: {
    SEVEN: [0, 150, 750, 5000],
    BELL: [0, 60, 250, 1000],
    MELON: [0, 50, 200, 750],
    GRAPES: [0, 40, 150, 500],
    PLUM: [0, 25, 75, 250],
    ORANGE: [0, 20, 60, 200],
    LEMON: [0, 15, 50, 150],
    CHERRY: [3, 10, 50, 200],
  },
  wild: null,
  scatter: 'BONUS',
  wheel: [5, 10, 6, 15, 5, 10, 6, 20, 5, 12, 6, 25, 5, 10, 6, 15, 5, 12, 6, 100],
  wheelMult: [0, 0, 0, 1, 2, 5],
  trigger: 3,
  published: [
    ['Return to player', '94.0280% (wheel included)'],
    ['Line wins', '81.1770%'],
    ['Cherry Wheel', '12.8510%, spun 1 in 116.82 paid spins'],
    ['Hit frequency', '56.2234% (1 in 1.78 spins)'],
    ['Standard deviation', '3.42 x the bet per spin'],
  ],
};

export const CHERRY_TABLES = lineTables(CHERRIES);

export interface CherrySpin {
  /** Top-row stop per reel (0-29). */
  stops: number[];
  /** Line credits at one credit per line. */
  lineCredits: number;
  bonus: number;
  /** Three or more BONUS symbols: the wheel spins. */
  trigger: boolean;
}

export function scoreCherries(stops: readonly number[]): CherrySpin {
  const [a, b, c, d, e] = stops as [number, number, number, number, number];
  const bonus = scatterCount(CHERRY_TABLES, stops);
  return { stops: [a, b, c, d, e], lineCredits: lineCredits(CHERRY_TABLES, a, b, c, d, e), bonus, trigger: bonus >= CHERRIES.trigger };
}

export interface CherryPlay {
  base: CherrySpin;
  /** The wheel spin, when the BONUS symbols started one. */
  wheel: { segment: number; prize: number; mult: number } | null;
  /** Line credits plus the wheel's prize x multiplier x 10 (the total bet in credits). */
  credits: number;
}

/**
 * One paid spin: a uniform stop on each reel, then (on three or more BONUS) a uniform segment of
 * the wheel, drawn after the window so the two are independent.
 */
export function playCherries(rng: Rng): CherryPlay {
  const stops: number[] = [];
  for (let r = 0; r < 5; r++) stops.push(randInt(rng, CHERRIES.strips[r]!.length));
  const base = scoreCherries(stops);
  let credits = base.lineCredits;
  let wheel: CherryPlay['wheel'] = null;
  if (base.trigger) {
    const segment = randInt(rng, CHERRIES.wheel.length);
    const prize = CHERRIES.wheel[segment]!;
    const mult = CHERRIES.wheelMult[base.bonus]!;
    wheel = { segment, prize, mult };
    credits += prize * mult * CHERRIES.lines;
  }
  return { base, wheel, credits };
}

/** Settle one paid spin: `unit` is one credit per line of the bet's denomination times the credits. */
export function settleCherries(rng: Rng, unit: Cents): SpinSettlement {
  const play = playCherries(rng);
  const lines = lineWins(CHERRIES, CHERRY_TABLES, play.base.stops).map((w) => ({ line: w.line, symbol: w.symbol, count: w.count, win: w.pay * unit }));
  const wheel: WheelSpin | undefined = play.wheel ? { ...play.wheel, win: play.wheel.prize * play.wheel.mult * CHERRIES.lines * unit } : undefined;
  const win = play.credits * unit;
  const ev: ReelsEvent = {
    type: 'reels',
    stops: play.base.stops,
    spin: 0,
    freeLeft: 0,
    lines,
    hits: [],
    combo: null,
    wilds: 0,
    scatters: play.base.bonus,
    scatterWin: 0,
    win,
    trigger: play.base.trigger,
    multiplier: 1,
    ...(wheel ? { wheel } : {}),
  };
  return { reels: [ev], win, freeSpins: 0, freeWin: 0, stops: play.base.stops };
}
