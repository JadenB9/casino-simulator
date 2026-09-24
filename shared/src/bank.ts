// The bank's one rule, shared so the cashier's window and the server agree to the cent.
//
// Below $10,000 in all (the balance plus every chip on every table, bets out included), the
// cashier tops a player up to $50,000. The difference is a loan: free, never repaid, recorded
// and counted on the profile. There's no limit on how often; being under the line is the rule.

import { DOLLAR, LOAN_AMOUNT, formatMoney, type Cents } from './money.ts';

/** Under this much in all, the bank tops a player up... */
export const REFILL_BELOW: Cents = 10_000 * DOLLAR;
/** ...to this much. */
export const REFILL_TO: Cents = LOAN_AMOUNT;

/** What the bank adds for a player who has `total` in all: the gap to REFILL_TO, or nothing. */
export function refillFor(total: Cents): Cents {
  return total < REFILL_BELOW ? REFILL_TO - Math.max(0, total) : 0;
}

/** The cashier's answer to someone at or over the line, with the numbers it counted. */
export function notYet(total: Cents, onTables: Cents): string {
  const part = onTables > 0 ? `, ${formatMoney(onTables)} of it in chips on tables` : '';
  return `You have ${formatMoney(total)} in all${part}. The bank tops you up when that is under ${formatMoney(REFILL_BELOW)}.`;
}
