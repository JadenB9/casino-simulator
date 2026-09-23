// What the slot machines send and accept. One action: spin. The server settles the spin (and
// any free games it starts) before anything is shown, then sends the stops for the client to
// spin the reels to.
//
// Events for one paid spin, in order:
//   spin    the bet leaves the credit meter (`credit` is the stack right after the bet)
//   reels   the paid spin's stops and what it paid
//   reels   ...one per free game on Neon Nights, in play order (`spin` 1, 2, ...)
//   result  the total paid for the spin, free games included, and the stack after it
//
// Free games play out inside the paid spin's round: the server draws them one after another
// with the same unbiased draws and pays their total with the spin, so the round's RoundResult is
// the whole feature (the way the published RTP counts it) and nothing is left live on the
// machine between spins. The machine is solo and no choice depends on a free game's outcome, so
// sending them together gives nothing away.

import type { Cents } from '../../money.ts';
import type { MachineId } from './machines.ts';

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
  /** 3-reel: the physical stop on the payline (0-21). 5-reel: the top-row stop (0-31). */
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
  /** 5x Wild: how many 5X multiplied the win. */
  wilds: number;
  scatters: number;
  scatterWin: Cents;
  /** Everything this spin paid, multiplier included. */
  win: Cents;
  /** Free games were started (or added to) by this spin. */
  trigger: boolean;
  /** 3 on free games, 1 otherwise. */
  multiplier: number;
};

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

export interface SlotsView {
  machine: MachineId;
  round: number;
  /** The last spin's coin value and coins, so a reload keeps the bet. */
  denom: Cents;
  coins: number;
  /** The reels as they last stopped (the final free game when the last spin had a feature). */
  stops: number[];
  last: { bet: Cents; win: Cents; freeSpins: number } | null;
}
