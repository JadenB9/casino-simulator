// Which blackjack rounds get a celebration, as a pure function of the seat's settled round, so the
// rule (never for a return at or below the stake) is unit tested.

import { formatMoney } from '../../../../shared/src/money.ts';
import type { SpotView } from '../../../../shared/src/games/blackjack/protocol.ts';
import type { Moment } from '../../table/celebrate.ts';

/**
 * The round's moment for a seat, if it is one: a blackjack paid 3 to 2 (big), and a blackjack
 * taken at even money, a double down or a split that came out ahead (nice). Never when the seat
 * got back no more than it put down.
 */
export function roundMoment(sp: SpotView): { m: Omit<Moment, 'glow'>; hands: number[] } | null {
  const net = sp.returned - sp.wagered;
  if (net <= 0) return null;
  const won = formatMoney(net, { sign: true });
  const bj = sp.hands.findIndex((h) => h.outcome === 'blackjack');
  if (bj >= 0) return { m: { title: 'Blackjack', sub: `Pays 3 to 2 · ${won}`, tier: 'big' }, hands: [bj] };
  const even = sp.hands.findIndex((h) => h.outcome === 'evenmoney');
  if (even >= 0) return { m: { title: 'Blackjack', sub: `Even money · ${won}`, tier: 'nice' }, hands: [even] };
  const wins = sp.hands.flatMap((h, i) => (h.outcome === 'win' ? [i] : []));
  if (sp.hands.length > 1 && wins.length) return { m: { title: 'Split', sub: `${wins.length} of ${sp.hands.length} hands win · ${won}`, tier: 'nice' }, hands: wins };
  if (wins.length && sp.hands[0]!.doubled) return { m: { title: 'Double down', sub: `Pays 1 to 1 · ${won}`, tier: 'nice' }, hands: wins };
  return null;
}
