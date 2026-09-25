// Machine F, "Gold Rush": five reels by four rows, 40 fixed lines, WILD on reels 2-5 and NUGGET
// scatters. Three, four or five NUGGETs anywhere start 8, 10 or 15 free games with sticky wilds:
// a WILD that lands during the free games stays in its cell until they end. The free games spin
// their own strips (one WILD on reels 2-5, no NUGGET), so they never retrigger. The strips, lines
// and pays are docs/math/slot-f-gold-rush.mjs, the published PAR sheet
// (docs/rules/cards-and-machines.md §3.9).

import type { Cents } from '../../money.ts';
import { randInt, type Rng } from '../../rng.ts';
import { cellBit, lineCredits, lineTables, lineWins, scatterCount, type LineMachine } from './lines.ts';
import type { ReelsEvent, SpinSettlement } from './protocol.ts';

export const GOLD_SYMBOLS = ['WILD', 'NUGGET', 'CART', 'PICK', 'LANTERN', 'PAN', 'A', 'K', 'Q', 'J', '10'] as const;
export type GoldSymbol = (typeof GOLD_SYMBOLS)[number];

export interface GoldRushMachine extends LineMachine<GoldSymbol, 'goldrush'> {
  /** The strips the free games spin. */
  freeStrips: readonly (readonly GoldSymbol[])[];
  /** Free games by NUGGET count (index = count). */
  freeGames: readonly number[];
  trigger: number;
}

export const GOLDRUSH: GoldRushMachine = {
  kind: 'lines',
  id: 'goldrush',
  name: 'Gold Rush',
  // 1¢, 5¢, 10¢, 25¢ and $1, and the high-limit room's $25, $100 and $250 ($50,000 a spin: 5 a line on 40 lines)
  denoms: [1, 5, 10, 25, 100, 2500, 10_000, 25_000],
  maxCoins: 5,
  lines: 40,
  rows: 4,
  symbols: GOLD_SYMBOLS,
  strips: [
    ['CART', '10', 'A', 'J', 'PAN', 'K', 'Q', 'LANTERN', '10', 'A', 'PICK', 'J', 'K', '10', 'Q', 'PAN', 'NUGGET', 'A', 'LANTERN', 'J', 'K', 'CART', 'Q', '10', 'PAN', 'A', 'J', 'PICK', 'K', 'LANTERN', 'Q', '10'],
    ['WILD', 'Q', 'A', 'PAN', 'J', 'K', 'CART', '10', 'A', 'LANTERN', 'Q', 'J', 'PICK', 'K', 'NUGGET', 'A', 'WILD', '10', 'PAN', 'Q', 'LANTERN', 'J', 'K', 'CART', 'A', '10', 'Q', 'PICK', 'J', 'PAN', 'K', 'LANTERN'],
    ['K', 'A', 'WILD', 'J', 'LANTERN', 'Q', '10', 'PICK', 'A', 'K', 'PAN', 'J', 'CART', 'Q', 'A', '10', 'LANTERN', 'K', 'WILD', 'J', 'PAN', 'NUGGET', 'Q', 'A', 'PICK', 'K', '10', 'J', 'CART', 'Q', 'PAN', 'LANTERN'],
    ['J', 'PAN', 'K', 'A', 'NUGGET', 'Q', 'WILD', '10', 'CART', 'J', 'LANTERN', 'K', 'A', 'PICK', 'Q', 'PAN', '10', 'J', 'K', 'LANTERN', 'A', 'Q', 'WILD', 'CART', 'J', '10', 'PAN', 'K', 'A', 'PICK', 'Q', 'LANTERN'],
    ['A', 'LANTERN', 'Q', 'K', '10', 'WILD', 'J', 'PAN', 'A', 'PICK', 'Q', 'K', 'CART', 'J', 'LANTERN', '10', 'A', 'NUGGET', 'Q', 'PAN', 'K', 'WILD', 'J', 'A', '10', 'PICK', 'Q', 'LANTERN', 'K', 'CART', 'J', 'PAN'],
  ],
  freeStrips: [
    ['CART', 'J', 'A', 'Q', 'PAN', '10', 'K', 'LANTERN', 'J', 'Q', 'PICK', 'A', '10', 'K', 'J', 'PAN', 'Q', 'LANTERN', 'A', 'CART', 'J', '10', 'K', 'Q', 'PICK', 'PAN', 'A', 'J', 'LANTERN', 'K', 'Q', '10'],
    ['WILD', 'J', 'K', 'PAN', 'A', '10', 'Q', 'CART', 'J', 'LANTERN', 'K', 'A', 'PICK', '10', 'J', 'Q', 'PAN', 'A', 'LANTERN', 'K', 'J', '10', 'CART', 'Q', 'A', 'PICK', 'J', 'K', 'PAN', '10', 'Q', 'LANTERN'],
    ['Q', 'A', 'J', 'LANTERN', '10', 'K', 'PICK', 'J', 'A', 'PAN', 'Q', 'WILD', '10', 'K', 'J', 'CART', 'A', 'LANTERN', 'Q', 'PAN', 'J', '10', 'K', 'PICK', 'A', 'Q', 'LANTERN', 'J', 'CART', 'K', '10', 'PAN'],
    ['K', '10', 'J', 'A', 'CART', 'Q', 'LANTERN', 'J', 'PAN', 'K', '10', 'A', 'PICK', 'J', 'Q', 'LANTERN', 'K', 'A', '10', 'J', 'WILD', 'Q', 'PAN', 'A', 'CART', 'K', 'J', 'PICK', '10', 'Q', 'LANTERN', 'PAN'],
    ['J', 'PAN', 'Q', 'A', '10', 'LANTERN', 'K', 'J', 'CART', 'Q', 'A', 'PICK', '10', 'J', 'K', 'PAN', 'Q', 'LANTERN', 'A', 'J', '10', 'K', 'CART', 'Q', 'PICK', 'J', 'A', 'WILD', '10', 'K', 'LANTERN', 'PAN'],
  ],
  lineRows: [
    [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3], [0, 1, 2, 1, 0],
    [3, 2, 1, 2, 3], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2], [0, 1, 1, 1, 0], [3, 2, 2, 2, 3],
    [1, 0, 0, 0, 1], [2, 3, 3, 3, 2], [1, 2, 2, 2, 1], [2, 1, 1, 1, 2], [0, 0, 1, 0, 0],
    [3, 3, 2, 3, 3], [1, 1, 0, 1, 1], [2, 2, 3, 2, 2], [1, 1, 2, 1, 1], [2, 2, 1, 2, 2],
    [0, 1, 0, 1, 0], [3, 2, 3, 2, 3], [1, 0, 1, 0, 1], [2, 3, 2, 3, 2], [1, 2, 1, 2, 1],
    [2, 1, 2, 1, 2], [0, 0, 1, 2, 3], [3, 3, 2, 1, 0], [0, 1, 2, 3, 3], [3, 2, 1, 0, 0],
    [1, 0, 1, 2, 1], [2, 3, 2, 1, 2], [0, 1, 2, 2, 2], [3, 2, 1, 1, 1], [1, 1, 1, 0, 0],
    [2, 2, 2, 3, 3], [0, 0, 0, 1, 2], [3, 3, 3, 2, 1], [1, 2, 1, 0, 1], [2, 1, 2, 3, 2],
  ],
  linePays: {
    CART: [0, 75, 250, 1000],
    PICK: [0, 50, 150, 500],
    LANTERN: [0, 30, 100, 400],
    PAN: [0, 25, 75, 250],
    A: [0, 12, 40, 150],
    K: [0, 12, 35, 125],
    Q: [0, 5, 25, 100],
    J: [0, 5, 20, 80],
    '10': [0, 5, 15, 60],
  },
  wild: 'WILD',
  scatter: 'NUGGET',
  freeGames: [0, 0, 0, 8, 10, 15],
  trigger: 3,
  published: [
    ['Return to player', '92.9936% (free games included)'],
    ['Base game', '66.9024%'],
    ['Free games', '26.0911%, started 1 in 62.30 paid spins'],
    ['Hit frequency', '47.1153% (1 in 2.12 spins)'],
    ['Standard deviation', 'about 3.7 x the bet per spin (simulated)'],
  ],
};

export const GOLD_TABLES = lineTables(GOLDRUSH);
export const GOLD_FREE_TABLES = lineTables(GOLDRUSH, GOLDRUSH.freeStrips);

export interface GoldSpin {
  /** Top-row stop per reel (0-31). */
  stops: number[];
  /** Line credits at one credit per line. */
  credits: number;
  nuggets: number;
  trigger: boolean;
}

export function scoreGoldRush(stops: readonly number[]): GoldSpin {
  const [a, b, c, d, e] = stops as [number, number, number, number, number];
  const nuggets = scatterCount(GOLD_TABLES, stops);
  return { stops: [a, b, c, d, e], credits: lineCredits(GOLD_TABLES, a, b, c, d, e), nuggets, trigger: nuggets >= GOLDRUSH.trigger };
}

/** The cells (as a held mask) where a free-game window shows WILD. */
export function wildsLanding(stops: readonly number[]): number {
  let mask = 0;
  for (let r = 1; r < 5; r++) {
    const strip = GOLDRUSH.freeStrips[r]!;
    for (let row = 0; row < GOLDRUSH.rows; row++) if (strip[(stops[r]! + row) % strip.length] === 'WILD') mask |= cellBit(GOLDRUSH.rows, r, row);
  }
  return mask;
}

export interface GoldFreeGame {
  stops: number[];
  /** Cells held WILD from earlier free games (a mask of cellBit). */
  held: number;
  /** Cells where a WILD landed in this game; they stick from here on. */
  landed: number;
  /** Line credits at one credit per line, the held and landed wilds counted. */
  credits: number;
}

export interface GoldPlay {
  base: GoldSpin;
  free: GoldFreeGame[];
  /** Base credits plus every free game's, at one credit per line. */
  credits: number;
}

/**
 * A paid spin and the free games it starts, drawn one after another so the spin settles in one
 * step. Each free game: a uniform stop on each free strip; any WILD it shows joins the held cells,
 * and the game pays with every held cell reading WILD.
 */
export function playGoldRush(rng: Rng): GoldPlay {
  const stops: number[] = [];
  for (let r = 0; r < 5; r++) stops.push(randInt(rng, GOLDRUSH.strips[r]!.length));
  const base = scoreGoldRush(stops);
  const free: GoldFreeGame[] = [];
  let credits = base.credits;
  if (base.trigger) {
    let held = 0;
    for (let g = 0; g < GOLDRUSH.freeGames[base.nuggets]!; g++) {
      const fs: number[] = [];
      for (let r = 0; r < 5; r++) fs.push(randInt(rng, GOLDRUSH.freeStrips[r]!.length));
      const landed = wildsLanding(fs) & ~held;
      const now = held | landed;
      const c = lineCredits(GOLD_FREE_TABLES, fs[0]!, fs[1]!, fs[2]!, fs[3]!, fs[4]!, now);
      free.push({ stops: fs, held, landed, credits: c });
      credits += c;
      held = now;
    }
  }
  return { base, free, credits };
}

/** A held mask as the cell list the protocol sends (reel * 4 + row). */
export function heldCells(mask: number): number[] {
  const cells: number[] = [];
  for (let i = 0; i < 5 * GOLDRUSH.rows; i++) if (mask & (1 << i)) cells.push(i);
  return cells;
}

/** Settle one paid spin: `unit` is one credit per line of the bet's denomination times the credits. */
export function settleGoldRush(rng: Rng, unit: Cents): SpinSettlement {
  const play = playGoldRush(rng);
  const n = play.free.length;
  const reels: ReelsEvent[] = [
    {
      type: 'reels',
      stops: play.base.stops,
      spin: 0,
      freeLeft: n,
      lines: lineWins(GOLDRUSH, GOLD_TABLES, play.base.stops).map((w) => ({ line: w.line, symbol: w.symbol, count: w.count, win: w.pay * unit })),
      hits: [],
      combo: null,
      wilds: 0,
      scatters: play.base.nuggets,
      scatterWin: 0,
      win: play.base.credits * unit,
      trigger: play.base.trigger,
      multiplier: 1,
    },
  ];
  let freeWin = 0;
  play.free.forEach((g, i) => {
    const win = g.credits * unit;
    freeWin += win;
    reels.push({
      type: 'reels',
      stops: g.stops,
      spin: i + 1,
      freeLeft: n - i - 1,
      lines: lineWins(GOLDRUSH, GOLD_FREE_TABLES, g.stops, g.held | g.landed).map((w) => ({ line: w.line, symbol: w.symbol, count: w.count, win: w.pay * unit })),
      hits: [],
      combo: null,
      wilds: 0,
      scatters: 0,
      scatterWin: 0,
      win,
      trigger: false,
      multiplier: 1,
      held: heldCells(g.held),
    });
  });
  // the reels go back to the base game's strips when the free games end
  return { reels, win: play.credits * unit, freeSpins: n, freeWin, stops: play.base.stops };
}
