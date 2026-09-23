// Which Three Card Poker hands get a celebration, as a pure function of the settlement, so the
// rule (never for a return at or below the stake) is unit tested.

import type { Card } from '../../../../shared/src/cards.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import {
  type Paytable,
  type Settlement,
  CAT,
  STRAIGHT,
  STRAIGHT_FLUSH,
  TRIPS,
  anteBonusPays,
  category,
  handName,
  pairPlusPays,
  score,
} from '../../../../shared/src/games/threecard/rules.ts';
import type { Moment, Tier } from '../../table/celebrate.ts';

/**
 * A hand worth marking, once the seat has got back more than it put down: Pair Plus on a straight
 * or better (big; a straight flush huge, the suited A-K-Q called a mini royal), or an Ante Bonus
 * (a straight nice, three of a kind big, a straight flush huge).
 */
export function handMoment(r: Settlement, cards: Card[], pay: Paytable): Omit<Moment, 'glow'> | null {
  if (r.returned <= r.wagered) return null;
  const s = score(cards);
  const cat = category(s);
  const pp = r.pairPlus > 0 && cat >= STRAIGHT ? pairPlusPays(cat, pay) : 0;
  if (!pp && r.bonus === 0) return null;
  const pays: string[] = [];
  if (pp) pays.push(`Pair Plus ${pp} to 1`);
  if (r.bonus > 0) pays.push(`Ante Bonus ${anteBonusPays(cat, pay)} to 1`);
  pays.push(formatMoney(r.returned - r.wagered, { sign: true }));
  const tier: Tier = cat === STRAIGHT_FLUSH ? 'huge' : pp || cat === TRIPS ? 'big' : 'nice';
  const mini = cat === STRAIGHT_FLUSH && s % CAT === 12;
  return { title: mini ? 'Mini royal' : handName(s), sub: pays.join(' · '), tier };
}
