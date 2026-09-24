// Hi-Lo as numbers (docs/rules/online-games-b.md §3). Every card is drawn uniformly from a full
// 52-card deck, with replacement, so only its rank matters: ace low (1) to king high (13), each
// 1 in 13. On any card from 2 to queen the two guesses are "higher or same" and "lower or same".
// On an ace nothing is lower, so the second guess is "same" and the first becomes strictly
// "higher"; on a king it's the other way round (Stake's Hi-Lo does the same, so neither button
// is ever a sure thing).
//
// A guess that wins with `count` ranks out of 13 multiplies what's riding by
// 0.99 / (count / 13) = 12.87 / count, kept exact as 1287 / (100 × count). The product of the
// guesses won so far is floored to the cent only when it is paid.

import { type Rng, randInt } from '../../rng.ts';
import { type Card, newDeck, rankNumber } from '../../cards.ts';

export type Guess = 'hi' | 'lo';

export const RANKS = 13;
/** Guesses beyond this would take the multiplier past 1,000,000×; cash out first. */
export const MAX_MULT = 100_000_000;
/** Skips allowed in one round. */
export const MAX_SKIPS = 52;

const DECK = newDeck();

/** A card drawn uniformly from 52. */
export function drawCard(rng: Rng): Card {
  return DECK[randInt(rng, 52)]!;
}

/** Ranks out of 13 that win guess `g` on a card of rank `r` (ace 1 ... king 13). */
export function winCount(r: number, g: Guess): number {
  if (g === 'hi') return r === 1 ? 12 : r === 13 ? 1 : 14 - r;
  return r === 1 ? 1 : r === 13 ? 12 : r;
}

/** Whether guess `g` on rank `r` wins when the next card has rank `next`. */
export function wins(r: number, g: Guess, next: number): boolean {
  if (g === 'hi') return r === 1 ? next > 1 : r === 13 ? next === 13 : next >= r;
  return r === 1 ? next === 1 : r === 13 ? next < 13 : next <= r;
}

/** What the button says for guess `g` on rank `r`. */
export function guessLabel(r: number, g: Guess): string {
  if (g === 'hi') return r === 1 ? 'Higher' : r === 13 ? 'Same' : 'Higher or same';
  return r === 1 ? 'Same' : r === 13 ? 'Lower' : 'Lower or same';
}

export function rankOfCard(card: Card): number {
  return rankNumber(card);
}

/**
 * The multiplier riding after winning guesses with these counts, as an exact fraction:
 * 1287^n / (100^n × Π counts).
 */
export function exact(counts: readonly number[]): { num: bigint; den: bigint } {
  let num = 1n;
  let den = 1n;
  for (const c of counts) {
    num *= 1287n;
    den *= 100n * BigInt(c);
  }
  return { num, den };
}

/** What cashing out pays after these wins, in hundredths: the exact product floored to the cent. */
export function payMult(counts: readonly number[]): number {
  if (counts.length === 0) return 0;
  const { num, den } = exact(counts);
  return Number((100n * num) / den);
}

/** Whether one more win at `count` would still be under the 1,000,000× ceiling. */
export function guessAllowed(counts: readonly number[], count: number): boolean {
  const { num, den } = exact([...counts, count]);
  return 100n * num <= BigInt(MAX_MULT) * den;
}

/**
 * The exact return of a one-guess round (bet, guess once, cash out): floor(1287 / count) / 100
 * paid with probability count / 13, i.e. floor(1287 / count) × count / 1300.
 */
export function singleReturn(count: number): { num: number; den: number } {
  return { num: Math.floor(1287 / count) * count, den: 1300 };
}

/**
 * The guess the Tips line points at before the first win: the one whose one-guess round returns
 * the most (they differ only by the cent the floor takes), the likelier one on a tie.
 */
export function bestFirstGuess(r: number): Guess {
  const hi = winCount(r, 'hi');
  const lo = winCount(r, 'lo');
  const rh = singleReturn(hi).num;
  const rl = singleReturn(lo).num;
  if (rh !== rl) return rh > rl ? 'hi' : 'lo';
  return hi >= lo ? 'hi' : 'lo';
}
