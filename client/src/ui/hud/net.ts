// The HUD's session net: what the player has won or lost at play since the HUD came up. Worth
// now (balance, chips on tables, the live stack here) less worth then, less the bank's top-ups
// since (money handed over, not won), plus what went on the boutique and the bar since (money
// spent, not lost): a $250,000 chain isn't a $250,000 loss at the tables. The cash an achievement
// pays is handed over too (v6 feats: shared/src/feats.ts), not won at play.

import type { Cents } from '../../../../shared/src/money.ts';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { featOf } from '../../../../shared/src/feats.ts';

export interface NetStart {
  /** Balance plus chips on tables when the HUD came up. */
  worth: Cents;
  /** loansTaken then. */
  loans: number;
  /** What the session had spent in the boutique and at the bar then. */
  spent: Cents;
  /** The feats earned by then (their cash since is a reward, not winnings). */
  feats?: ReadonlySet<string>;
}

export function netStart(p: Profile | null, spent: Cents): NetStart {
  return { worth: p ? p.balance + p.inPlay : 0, loans: p?.loansTaken ?? 0, spent, feats: new Set((p?.feats ?? []).map((f) => f.feat)) };
}

/**
 * Chips at the current table count at their live stack, other tables at what went in. The bank
 * tops up by whatever reaches $50,000, so each loan since counts at its own amount (the profile
 * lists them newest first).
 */
export function sessionNet(p: Profile, start: NetStart, seat: { stack: Cents; escrow: Cents } | null, spent: Cents): Cents {
  const worth = p.balance + p.inPlay + (seat ? seat.stack - seat.escrow : 0);
  const lent = p.loans.slice(0, Math.max(0, p.loansTaken - start.loans)).reduce((sum, l) => sum + l.amount, 0);
  let rewards = 0;
  // what each paid (it scales with the stake that earned it), else its listed cash
  for (const f of p.feats ?? []) if (!start.feats?.has(f.feat)) rewards += f.paid ?? featOf(f.feat)?.reward.cash ?? 0;
  return worth - start.worth - lent - rewards + (spent - start.spent);
}
