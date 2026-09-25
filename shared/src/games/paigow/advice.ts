// Tips at the Pai Gow Poker table: the house way, the setting the dealer would use for your seven
// cards and the one behind the published odds, in a few words.

import { highName, highScore, houseWay, lowName, lowScore, type PgCard } from './rules.ts';

/** "House way: Pair of Kings behind, A-Q in front". */
export function houseWayAdvice(cards: readonly PgCard[]): { low: PgCard[]; text: string } {
  const s = houseWay(cards);
  return { low: s.low, text: `House way: ${highName(highScore(s.high))} behind, ${lowName(lowScore(s.low))} in front` };
}
