// Tipping the dealer. At a table with someone dealing (a dealer, the stickman at craps, the bingo
// caller) a seated player can toss chips from their stack to the crew. The table's Durable Object
// takes them off the stack like a lost bet, so they simply come off what the player cashes out:
// no ledger row of their own, and no round, so no stats, feats or fair-play signals count them.

import type { GameId, TableConfig } from './engine.ts';
import type { Cents } from './money.ts';
import { limitsOf } from './limits.ts';
import type { ErrorCode } from './protocol.ts';

/** The games with staff to tip (the stations world/npcs.ts posts a dealer at). */
export const TIP_GAMES: readonly GameId[] = ['blackjack', 'roulette', 'craps', 'baccarat', 'threecard', 'war', 'sicbo', 'bigsix', 'holdem', 'letitride', 'paigow', 'bingo'];

export function canTip(game: GameId): boolean {
  return TIP_GAMES.includes(game);
}

/** The usual tip at a table: its minimum bet (Hold'em: the big blind), and twice that. */
export function tipAmounts(cfg: TableConfig): [Cents, Cents] {
  const l = limitsOf(cfg);
  const one = cfg.game === 'holdem' ? l.max : l.min;
  return [one, one * 2];
}

/**
 * Why a tip can't be taken, or null when it can. `live` is what the seat has on the layout;
 * `handOn` is a Hold'em hand in play (a stack changes only between hands there).
 */
export function tipRefusal(amount: number, stack: Cents, live: Cents, handOn: boolean): { code: ErrorCode; msg: string } | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { code: 'BAD_REQUEST', msg: 'A tip is a whole number of chips.' };
  if (live > 0 || handOn) return { code: 'WRONG_PHASE', msg: 'Tip between hands.' };
  if (amount > stack) return { code: 'LIMIT', msg: "You don't have that much here." };
  return null;
}
