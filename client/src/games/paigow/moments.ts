// Which Pai Gow hands get a celebration, as a pure function of the settlement, so the rule (never
// for a return at or below what was risked) is unit tested.

import { formatMoney } from '../../../../shared/src/money.ts';
import { type FortunePays, type Setting, type Settlement, FIVE_ACES, FORTUNE_NAMES, QUADS, STRAIGHT_FLUSH, category, highName, highScore } from '../../../../shared/src/games/paigow/rules.ts';
import type { Moment, Tier } from '../../table/celebrate.ts';

/**
 * A hand worth marking, once the spot got back more than it risked: the Fortune on three of a kind
 * or better (a straight flush or better huge, four of a kind or a full house big, the rest nice),
 * or both hands won with four of a kind or better behind (five aces or a straight flush huge).
 */
export function handMoment(r: Settlement, setting: Setting, pay: FortunePays): Omit<Moment, 'glow'> | null {
  if (r.returned <= r.wagered) return null;
  const net = formatMoney(r.returned - r.wagered, { sign: true });
  // a straight (2 to 1) is too common a Fortune to mark
  const line = r.fortune > 0 && r.fortuneLine >= 0 && r.fortuneLine <= 9 ? r.fortuneLine : -1;
  if (line >= 0) {
    const tier: Tier = line <= 5 ? 'huge' : line <= 7 ? 'big' : 'nice';
    const sub = [`Fortune ${pay[line]} to 1`, ...(r.outcome === 'win' ? ['both hands win'] : []), net];
    return { title: FORTUNE_NAMES[line]!, sub: sub.join(' · '), tier };
  }
  const high = highScore(setting.high);
  if (r.outcome !== 'win' || category(high) < QUADS) return null;
  const tier: Tier = category(high) === FIVE_ACES || category(high) === STRAIGHT_FLUSH ? 'huge' : 'big';
  return { title: highName(high), sub: `Both hands win · ${net}`, tier };
}
