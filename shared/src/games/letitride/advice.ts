// Tips at the Let It Ride table: let the bet ride or pull it back, by the strategy in rules.ts,
// with the reason in a few words. The decision is firstReason()/secondReason(), the play the exact
// enumeration measures at 3.51% of a unit, so the tip is exactly the play behind that number.

import type { Card } from '../../cards.ts';
import { firstReason, partialName, secondReason, type RideReason } from './rules.ts';

const WHY: Record<RideReason, string> = {
  pays: '',
  royal: 'three to a royal flush',
  run: 'three suited in a row',
  'one-gap': 'three to a straight flush, one gap, a high card',
  'two-gaps': 'three to a straight flush, two gaps, two high cards',
  'flush-draw': 'four to a flush',
  'open-straight': 'four to an outside straight',
  'inside-high': 'four high cards to an inside straight',
};

/** "Let it ride: a Pair of Queens pays already" or "Pull it back: King high, no draw worth it". */
export function rideAdvice(cards: readonly Card[]): { ride: boolean; text: string } {
  const reason = cards.length === 3 ? firstReason(cards) : secondReason(cards);
  const name = partialName(cards);
  const a = (n: string) => (n.startsWith('Pair') ? `a ${n}` : n);
  if (reason === 'pays') return { ride: true, text: `Let it ride: ${a(name)} pays already` };
  if (reason) return { ride: true, text: `Let it ride: ${WHY[reason]}` };
  return { ride: false, text: `Pull it back: ${a(name)}, ${cards.length === 3 ? 'not enough to ride on three cards' : 'no draw worth the bet'}` };
}
