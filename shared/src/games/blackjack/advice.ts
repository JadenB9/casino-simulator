// Tips at the blackjack table: the basic-strategy move for a hand, in a few words. The move is
// basicStrategy() from strategy.ts, the chart the unit test checks cell by cell and the Monte Carlo
// test plays, so a tip is exactly the play the measured house edge assumes.

import type { Card } from '../../cards.ts';
import { cardValue, handTotal, type Move } from './rules.ts';
import { basicStrategy, chartCode, chartSplits } from './strategy.ts';

/** What the table will take on this hand right now (the rules, and the chips to pay for it). */
export interface Can {
  double: boolean;
  split: boolean;
  surrender: boolean;
}

export interface Advice {
  move: Move;
  /** One short line: "Basic strategy: double 11 against a 6". */
  text: string;
}

const VERB: Record<Move, string> = { hit: 'hit', stand: 'stand on', double: 'double', split: 'split', surrender: 'surrender' };

/** The up card the way a dealer says it: "a 6", "an 8", "a 10", "an ace". */
export function upCardWords(up: Card): string {
  const v = cardValue(up);
  if (v === 1) return 'an ace';
  return v === 8 ? 'an 8' : `a ${v}`;
}

/** The hand the way the chart reads it: "11" or "soft 17", and "8s" or "aces" when splitting. */
function handWords(cards: readonly Card[], move: Move): string {
  if (move === 'split') {
    const v = cardValue(cards[0]!);
    return v === 1 ? 'aces' : `${v}s`;
  }
  const { total, soft } = handTotal(cards);
  return soft ? `soft ${total}` : String(total);
}

/**
 * Why the move isn't the chart's first choice, when it isn't: the chart splits this pair, or
 * doubles or surrenders this total, but the table won't take that move on this hand now.
 */
function fallback(cards: readonly Card[], up: Card, can: Can): string | null {
  const upValue = cardValue(up);
  if (cards.length === 2) {
    const v = cardValue(cards[0]!);
    if (v === cardValue(cards[1]!) && chartSplits(v, upValue)) return can.split ? null : "can't split now";
  }
  const { total, soft } = handTotal(cards);
  const code = chartCode(total, soft, upValue);
  if ((code === 'D' || code === 'B') && !can.double) return "can't double now";
  if (code === 'R' && !can.surrender) return "can't surrender now";
  return null;
}

/** The basic-strategy move for a hand against the dealer's up card, and the line that says it. */
export function advise(cards: readonly Card[], up: Card, can: Can): Advice {
  const move = basicStrategy(cards, up, can);
  const note = fallback(cards, up, can);
  const text = `Basic strategy: ${VERB[move]} ${handWords(cards, move)} against ${upCardWords(up)}${note ? ` (${note})` : ''}`;
  return { move, text };
}

/** Basic strategy never insures, and even money is the same bet on a blackjack. */
export function insuranceAdvice(evenMoney: boolean): string {
  return evenMoney ? 'Basic strategy never takes even money' : 'Basic strategy never takes insurance';
}
