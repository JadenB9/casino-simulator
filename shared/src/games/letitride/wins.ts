// What paid at Let It Ride, in a few words for the floor's big-win news, from what the table showed
// everyone once the round was over: the hand turned over to be paid and the two community cards.
// A hand's own `hand` event (its cards before the end) is never read.

import type { GameEvent } from '../../engine.ts';
import { isCard, type Card } from '../../cards.ts';
import { BONUS_NAMES, NOTHING, bonusLine, handName, type Settlement } from './rules.ts';

const shown = (e: GameEvent) => e.to === undefined || e.to === 'all';

/** "Royal flush", "Full house, Kings full of Fours", "3-Card Bonus, Mini royal"; null if the round didn't show it. */
export function winWhat(events: readonly GameEvent[], spot: number): string | null {
  const show = events.find((e) => e.type === 'show' && shown(e) && e.seat === spot);
  const board = events.filter((e) => e.type === 'board' && shown(e)).map((e) => e.card);
  const result = events.find((e) => e.type === 'result' && e.seat === spot)?.result as Settlement | undefined;
  const cards = show?.cards;
  if (!Array.isArray(cards) || cards.length !== 3 || !cards.every(isCard) || board.length !== 2 || !board.every(isCard) || !result) return null;
  const five = [...(cards as Card[]), ...(board as Card[])];
  const main = result.hand !== NOTHING && result.bets.some((b) => b > 0);
  if (main) return handName(five);
  if (result.bonus > 0) return `3-Card Bonus, ${BONUS_NAMES[bonusLine(cards as Card[])]}`;
  return null;
}
