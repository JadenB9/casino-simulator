// What the slot machines send and accept. One action: spin. The server settles the spin (and
// any free games or bonus it starts) before anything is shown, then sends the stops for the
// client to spin the reels to.
//
// Events for one paid spin, in order:
//   spin    the bet leaves the credit meter (`credit` is the stack right after the bet)
//   reels   the paid spin's stops and what it paid (Lucky Cherries: and its Cherry Wheel spin;
//           Straw, Sticks & Bricks: and its Blowdown)
//   reels   ...one per free game on Neon Nights and Gold Rush, in play order (`spin` 1, 2, ...)
//   result  the total paid for the spin, free games included, and the stack after it
//
// Free games play out inside the paid spin's round: the server draws them one after another
// with the same unbiased draws and pays their total with the spin, so the round's RoundResult is
// the whole feature (the way the published RTP counts it) and nothing is left live on the
// machine between spins. The machine is solo and no choice depends on a free game's outcome, so
// sending them together gives nothing away.

import type { Cents } from '../../money.ts';
import type { SlotId } from './lineup.ts';

export type SlotsAction = {
  type: 'spin';
  /** Coins (3-reel, 1-3) or credits per line (5-reel, 1-5). */
  coins: number;
  /** Coin value in cents; one of the machine's denominations. */
  denom: Cents;
};

/** One paying line. */
export interface LineWinView {
  /** 0-based line index (Neon Nights line 1 is 0); always 0 on the 3-reel machines. */
  line: number;
  /** Symbol that paid ('7', '3B', 'CH', 'WX' ... or a Neon Nights symbol name). */
  symbol: string;
  /** Reels that took part, from reel 1 (the 3-reel cherry pays count 1 or 2). */
  count: number;
  /** Cents this line paid, multipliers included. */
  win: Cents;
}

export type SpinEvent = {
  type: 'spin';
  seat: number;
  round: number;
  denom: Cents;
  coins: number;
  bet: Cents;
  /** The seat's stack right after the bet. */
  credit: Cents;
};

export type ReelsEvent = {
  type: 'reels';
  /** 3-reel: the physical stop on the payline (0-21). 5-reel: the top-row stop (0 to the strip length - 1). */
  stops: number[];
  /** 0 for the paid spin, then 1, 2, ... for free games. */
  spin: number;
  /** Free games still to play after this one. */
  freeLeft: number;
  lines: LineWinView[];
  /** On the 3-reel machines: which reels' payline symbols made the win. */
  hits: boolean[];
  /** 3-reel: the pay glass row that paid, if any. */
  combo: string | null;
  /** 5x Wild and Diamond Line: how many wilds multiplied the win (3 is the top award). */
  wilds: number;
  scatters: number;
  scatterWin: Cents;
  /** Everything this spin paid, multiplier included. */
  win: Cents;
  /** Free games were started (or added to) by this spin. */
  trigger: boolean;
  /** What each win was multiplied by: 3 on Neon Nights free games, 2 or 4 for Diamond Line diamonds, else 1. */
  multiplier: number;
  /** Gold Rush free games: the cells held WILD through this game (reel * 4 + row), not counting any that land in it. */
  held?: number[];
  /** Lucky Cherries: the Cherry Wheel this spin's BONUS symbols started. */
  wheel?: WheelSpin;
  /** Straw, Sticks & Bricks: the Blowdown this spin's houses started (its win is in `win`). */
  blowdown?: BlowdownView;
};

/**
 * Straw, Sticks & Bricks' Blowdown, spin by spin. Cells are reel * 3 + row; grades 0 straw, 1
 * sticks, 2 brick, 3 the gold mansion.
 */
export interface BlowdownView {
  /** The houses that started it: [cell, grade]. */
  start: [cell: number, grade: number][];
  spins: {
    /** Houses rebuilt one grade up before the spin. */
    rebuilt: number[];
    /** Houses built on the spin: [cell, grade]. */
    landed: [cell: number, grade: number][];
    /** Spins left after it. */
    left: number;
  }[];
  /** Every house the wolf blew down, in cell order: [cell, final grade, cents it paid]. */
  houses: [cell: number, grade: number, win: Cents][];
  /** The Whole Street's cents when every cell was built, else 0. */
  street: Cents;
  /** Everything the Blowdown paid. */
  win: Cents;
}

/** One spin of the Cherry Wheel. */
export interface WheelSpin {
  /** The segment under the pointer, 0-19 clockwise from the top. */
  segment: number;
  /** That segment's prize, in total bets. */
  prize: number;
  /** 1, 2 or 5 for three, four or five BONUS symbols. */
  mult: number;
  /** Cents: prize x mult x the total bet. Included in the event's `win`. */
  win: Cents;
}

export type ResultEvent = {
  type: 'result';
  seat: number;
  bet: Cents;
  /** Total paid: the paid spin plus every free game. */
  win: Cents;
  freeSpins: number;
  freeWin: Cents;
  /** The seat's stack after the win. */
  credit: Cents;
};

export type SlotsEvent = SpinEvent | ReelsEvent | ResultEvent;

/** What a machine's settle function hands the engine for one paid spin (the newer machines). */
export interface SpinSettlement {
  /** The paid spin's reels event, then one per free game. */
  reels: ReelsEvent[];
  /** Everything the spin paid, free games included. */
  win: Cents;
  freeSpins: number;
  freeWin: Cents;
  /** What the reels show once it's all over. */
  stops: number[];
}

export interface SlotsView {
  machine: SlotId;
  round: number;
  /** The last spin's coin value and coins, so a reload keeps the bet. */
  denom: Cents;
  coins: number;
  /** The reels as they last stopped (the final free game when the last spin had a feature). */
  stops: number[];
  last: { bet: Cents; win: Cents; freeSpins: number } | null;
}
