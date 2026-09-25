// Max at the Let It Ride table: the three bets are always equal, so one more chip costs three, and
// the most they can go up is a third of the stack (in the table's step, to its maximum).

import type { BetLimits, Cents } from '../../../../shared/src/money.ts';
import { maxBet, type MaxBet } from '../../../../shared/src/limits.ts';

/** The most each of the three bets can go up by, from `current` each, with `stack` behind them. */
export function unitMax(limits: BetLimits, current: Cents, stack: Cents): MaxBet {
  return maxBet({ limits, current, stack: Math.floor(stack / 3) });
}
