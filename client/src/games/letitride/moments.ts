// Which Let It Ride hands get a celebration, as a pure function of the settlement, so the rule
// (never for a return at or below what was risked) is unit tested.

import type { Card } from '../../../../shared/src/cards.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import {
  type Paytable,
  type Settlement,
  BONUS_NAMES,
  FLUSH,
  FULL_HOUSE,
  QUADS,
  ROYAL,
  STRAIGHT_FLUSH,
  TRIPS,
  bonusLine,
  handName,
  handPays,
} from '../../../../shared/src/games/letitride/rules.ts';
import type { Moment, Tier } from '../../table/celebrate.ts';

/**
 * A hand worth marking, once the spot has got back more than it risked: three of a kind or
 * better on the bets (a royal or straight flush huge, quads and a full house big, the rest nice),
 * or the 3-Card Bonus on three of a kind or better (big; a straight flush or mini royal huge).
 */
export function handMoment(r: Settlement, five: Card[], pay: Paytable): Omit<Moment, 'glow'> | null {
  if (r.returned <= r.wagered) return null;
  const riding = r.bets.filter((b) => b > 0).length;
  const main = riding > 0 && r.hand >= TRIPS ? r.hand : null;
  const line = r.bonus > 0 ? bonusLine(five.slice(0, 3)) : -1;
  const bonusBig = line >= 0 && line <= 2;
  if (main === null && !bonusBig) return null;
  const pays: string[] = [];
  if (main !== null) pays.push(`${handPays(main, pay)} to 1 on ${riding === 1 ? 'one bet' : riding === 2 ? 'two bets' : 'all three'}`);
  if (line >= 0) pays.push(`Bonus ${pay.bonus[line]} to 1`);
  pays.push(formatMoney(r.returned - r.wagered, { sign: true }));
  let tier: Tier = 'nice';
  if (main === ROYAL || main === STRAIGHT_FLUSH || line === 0 || line === 1) tier = 'huge';
  else if (main === QUADS || main === FULL_HOUSE || bonusBig) tier = 'big';
  else if (main !== null && main >= FLUSH) tier = 'nice';
  const title = main !== null ? handName(five) : BONUS_NAMES[line]!;
  return { title, sub: pays.join(' · '), tier };
}
