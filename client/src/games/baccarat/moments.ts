// Which baccarat coups get a celebration for a seat, as a pure function of its result and the coup,
// so the rule (never for a return at or below the stake) is unit tested: a pair bet that hits
// (big), or a winning bet on a hand that won with a natural (nice).

import { formatMoney } from '../../../../shared/src/money.ts';
import type { Coup, Hand, SeatResult } from '../../../../shared/src/games/baccarat/rules.ts';
import type { Moment } from '../../table/celebrate.ts';

const cap = (h: Hand) => (h === 'player' ? 'Player' : 'Banker');

/** The moment, and the hands whose first two cards made it. */
export function coupMoment(r: SeatResult, coup: Coup): { m: Omit<Moment, 'glow'>; hands: Hand[] } | null {
  if (r.returned <= r.wagered) return null;
  const won = formatMoney(r.returned - r.wagered, { sign: true });
  const pairs = (['player', 'banker'] as const).filter((h) => r.spots[h === 'player' ? 'playerPair' : 'bankerPair']?.outcome === 'win');
  if (pairs.length) {
    const title = pairs.length === 2 ? 'Both pairs' : `${cap(pairs[0]!)} pair`;
    return { m: { title, sub: `Pays 11 to 1 · ${won}`, tier: 'big' }, hands: pairs };
  }
  const w = coup.winner;
  if (w === 'tie' || !coup.natural || r.spots[w]?.outcome !== 'win') return null;
  // A natural stops the drawing, so the winner's total is its two-card total.
  const total = w === 'player' ? coup.playerTotal : coup.bankerTotal;
  if (total < 8) return null;
  return { m: { title: `Natural ${total}`, sub: `${cap(w)} wins · ${won}`, tier: 'nice' }, hands: [w] };
}
