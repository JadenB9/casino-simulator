// What paid at Pai Gow Poker, in a few words for the floor's big-win news, from what the table
// showed everyone once the round was over: the hand turned over and how it was set. A hand's own
// `hand` event (its seven before the end) is never read.

import type { GameEvent } from '../../engine.ts';
import { FORTUNE_NAMES, highName, highScore, isPgCard, type Setting, type Settlement } from './rules.ts';

const shown = (e: GameEvent) => e.to === undefined || e.to === 'all';

/** "Fortune, Four of a kind", "Both hands, Five aces"; null if the round didn't show it. */
export function winWhat(events: readonly GameEvent[], spot: number): string | null {
  const show = events.find((e) => e.type === 'show' && shown(e) && e.seat === spot);
  const result = events.find((e) => e.type === 'result' && e.seat === spot)?.result as Settlement | undefined;
  const setting = show?.setting as Setting | undefined;
  if (!result || !setting || !Array.isArray(setting.high) || setting.high.length !== 5 || !setting.high.every(isPgCard)) return null;
  if (result.fortune > 0 && result.fortuneLine >= 0) return `Fortune, ${FORTUNE_NAMES[result.fortuneLine]}`;
  if (result.outcome === 'win') return `Both hands, ${highName(highScore(setting.high))}`;
  return null;
}
