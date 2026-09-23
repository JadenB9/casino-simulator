// Tips at the machine: the hold the strategy list gives for this deal (the same list the exact
// enumeration test proves optimal over all 2,598,960 deals), and before a deal the one bet worth
// making, five coins, since only the fifth coin brings the royal's 4,000.

import type { Card } from '../../../../shared/src/cards.ts';
import { cardNumber, MAX_COINS } from '../../../../shared/src/games/videopoker/hands.ts';
import { HOLD_LIST, FOOTNOTES, bestHold, bestLine } from '../../../../shared/src/games/videopoker/strategy.ts';
import { cardText } from '../../../../shared/src/games/holdem/eval.ts';

/** The list line a hold sits on, in words (a footnote's half line reads as the hold it moved). */
export function holdName(line: number): string {
  const whole = Number.isInteger(line) ? line : (FOOTNOTES.find((f) => f.to === line)?.from ?? Math.round(line));
  return HOLD_LIST[whole - 1]?.hold ?? '';
}

/** The best hold for five dealt cards: which to keep (bit i is card i) and the line for the Tips row. */
export function holdAdvice(hand: readonly Card[]): { mask: number; text: string } {
  const nums = hand.map(cardNumber);
  const mask = bestHold(nums);
  const name = holdName(bestLine(nums));
  if (mask === 0) return { mask, text: `Best hold: none · ${name}` };
  if (mask === 31) return { mask, text: `Best hold: all five · ${name}` };
  const kept = hand.filter((_, i) => mask & (1 << i)).map(cardText);
  return { mask, text: `Best hold: ${kept.join(' ')} · ${name}` };
}

/** Before the deal: short of five coins, say what the fifth is worth (null at five). */
export function betAdvice(coins: number): string | null {
  if (coins >= MAX_COINS) return null;
  return 'Bet 5 coins: the royal pays 4,000, not 1,250, and the game returns 99.54%, not 98.37%.';
}
