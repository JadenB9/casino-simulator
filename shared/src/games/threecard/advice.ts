// Tips at the Three Card Poker table: Play or Fold by the Q-6-4 rule, with the reason in a few
// words. The decision is shouldPlay() from rules.ts, the rule the exact enumeration measures at
// 3.37% of the Ante, so the tip is exactly the play behind that number.

import type { Card } from '../../cards.ts';
import { HIGH_CARD, Q64, category, handName, handRanks, score, shouldPlay } from './rules.ts';

/** "K-9-3" for a high-card hand (the kickers decide it), "a Pair of Kings", "a Flush", "Three Sevens". */
function handWords(s: number): string {
  if (category(s) === HIGH_CARD) return handRanks(s);
  const name = handName(s);
  return name.startsWith('Three ') ? name : `a ${name}`;
}

export function playAdvice(cards: readonly Card[]): { play: boolean; text: string } {
  const s = score(cards);
  const play = shouldPlay(s);
  if (!play) return { play, text: `Fold: ${handWords(s)} is below Q-6-4` };
  if (s === Q64) return { play, text: 'Play: Q-6-4 is the lowest hand worth playing' };
  return { play, text: `Play: ${handWords(s)} beats Q-6-4` };
}
