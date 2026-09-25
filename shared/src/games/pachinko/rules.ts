// Pachinko as data (docs/rules/parlour-games.md §2): what each ball can do and what it pays.
//
// A launch is a batch of 25 balls bought together; a ball is worth a 25th of the batch's price.
// Every ball ends in one of four places, drawn by the server as it is launched:
//   start pocket (the heso, under the screen)  1 in 20   pays 4 balls and spins the screen's reels
//   left or right tulip                        1 in 20 each   pays 3 balls
//   out (the hole at the bottom)               the other 17 in 20   pays nothing
// A spin of the reels hits the jackpot (three of a kind) 1 time in 32. A jackpot opens the
// attacker at the bottom of the board for ten rounds of fifteen balls: 150 balls. The jackpot's
// number decides what follows: odd (1, 3, 5, 7, 9: kakuhen) and the reels go again for a chained
// jackpot, even and the fever ends. A chain stops at eight jackpots.
//
// The power dial only changes how the balls fly; which pocket each one finds is drawn, not
// played, and the balls on the screen are steered onto the draw (as Plinko's are).

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

export const BATCH = 25;
/** Where a ball ends: out, left tulip, right tulip, start pocket. */
export type Pocket = 'out' | 'left' | 'right' | 'start';
export const POCKETS: readonly Pocket[] = ['out', 'left', 'right', 'start'];

/** Balls paid for a ball landing in each pocket (the jackpot is on top of the start pocket's). */
export const POCKET_PAYS: Record<Pocket, number> = { out: 0, left: 3, right: 3, start: 4 };
/** One draw in POCKET_DEN per ball: 0 is the start pocket, 1 the left tulip, 2 the right, the rest out. */
export const POCKET_DEN = 20;
/** A reel spin hits one time in REEL_DEN. */
export const REEL_DEN = 32;
export const ROUNDS = 10;
export const ROUND_BALLS = 15;
/** A jackpot's burst: ten rounds of fifteen. */
export const JACKPOT_BALLS = ROUNDS * ROUND_BALLS;
/** The most jackpots one chain can hold. */
export const MAX_CHAIN = 8;
/** Each jackpot's number is drawn from 0-9; odd ones (half of them) chain. */
export const DIGITS = 10;

export function isKakuhen(digit: number): boolean {
  return digit % 2 === 1;
}

/** What one ball did, before it is dressed for the screen. */
export interface BallOutcome {
  pocket: Pocket;
  /** For a start pocket ball: the jackpot numbers of its chain, in order (empty: the reels missed). */
  chain: number[];
}

/**
 * One ball, drawn: its pocket, then for the start pocket the reels, then while the jackpot's
 * number is odd (and the chain is short of eight) another jackpot. The only draws that decide
 * money.
 */
export function drawBall(rng: Rng): BallOutcome {
  const k = randInt(rng, POCKET_DEN);
  const pocket: Pocket = k === 0 ? 'start' : k === 1 ? 'left' : k === 2 ? 'right' : 'out';
  const chain: number[] = [];
  if (pocket === 'start' && randInt(rng, REEL_DEN) === 0) {
    for (;;) {
      const d = randInt(rng, DIGITS);
      chain.push(d);
      if (!isKakuhen(d) || chain.length >= MAX_CHAIN) break;
    }
  }
  return { pocket, chain };
}

/** Balls a ball pays back: its pocket, plus every jackpot in its chain. */
export function ballsFor(o: BallOutcome): number {
  return POCKET_PAYS[o.pocket] + o.chain.length * JACKPOT_BALLS;
}

/** A batch's price is whole dollars, so a ball (a 25th) is a whole number of cents. */
export function ballValue(bet: Cents): Cents {
  return bet / BATCH;
}

export function payoutFor(bet: Cents, balls: number): Cents {
  return ballValue(bet) * balls;
}

/**
 * The reels on a start pocket ball, for the screen: three digits. A jackpot shows its number three
 * times. A miss shows anything but three of a kind; a quarter of misses are a "reach" (the two
 * outer reels agree and the middle one lets them down). Drawn after the outcome, so they change
 * nothing about it.
 */
export function dressReels(rng: Rng, chain: readonly number[]): [number, number, number] {
  if (chain.length > 0) return [chain[0]!, chain[0]!, chain[0]!];
  const a = randInt(rng, DIGITS);
  if (randInt(rng, 4) === 0) {
    let m = randInt(rng, DIGITS - 1);
    if (m >= a) m++;
    return [a, m, a];
  }
  let c = randInt(rng, DIGITS - 1);
  if (c >= a) c++;
  return [a, randInt(rng, DIGITS), c];
}

// ---------------------------------------------------------------------------------------------
// Exact odds

/** The chance a chain holds exactly n jackpots, given it has at least one: (1/2)^(n-1)·(1/2), and the rest at eight. */
export function chainChance(n: number): { num: number; den: number } {
  if (n < 1 || n > MAX_CHAIN) return { num: 0, den: 1 };
  if (n < MAX_CHAIN) return { num: 1, den: 2 ** n };
  return { num: 1, den: 2 ** (MAX_CHAIN - 1) };
}

/** Expected jackpots in a chain: 1 + 1/2 + ... + 1/2^7 = 255/128. */
export function expectedChain(): { num: number; den: number } {
  const den = 2 ** (MAX_CHAIN - 1);
  let num = 0;
  for (let k = 0; k < MAX_CHAIN; k++) num += den / 2 ** k;
  return { num, den };
}

/**
 * The return per ball, exactly: tulips 2·3/20, the start pocket 4/20, and the jackpots
 * 150·(1/20)(1/32)(255/128). Every denominator is a power of 2 times 5, so it is a terminating
 * decimal: 0.9669189453125.
 */
export function ballReturn(): { num: bigint; den: bigint } {
  const e = expectedChain();
  const den = BigInt(POCKET_DEN * REEL_DEN * e.den);
  const pockets = BigInt((POCKET_PAYS.left + POCKET_PAYS.right + POCKET_PAYS.start) * REEL_DEN * e.den);
  const jackpots = BigInt(JACKPOT_BALLS * e.num);
  return { num: pockets + jackpots, den };
}

export function rtp(): number {
  const r = ballReturn();
  return Number(r.num) / Number(r.den);
}

/** The published return, as printed; the exact fraction is this decimal. */
export const PUBLISHED_RTP = '96.69189453125';

/** A jackpot, per ball: 1 in 640. */
export const JACKPOT_ODDS = POCKET_DEN * REEL_DEN;
