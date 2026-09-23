// What Tips says at the roulette table, and which spins earn a celebration. Every bet on a wheel
// costs the same, (pockets - 36) / pockets, except the American top line, which pays 6 to 1 for
// five numbers; the figures come from the spots table the engine settles with, not from constants
// (client/test/roulette-advice.test.ts checks them against docs/rules/table-games.md §2).

import { type Spot, type Variant, pocketCount, spotByKey, spotName, spotsOf, pocketLabel } from '../../../../shared/src/games/roulette/rules.ts';
import type { SeatSettle } from '../../../../shared/src/games/roulette/protocol.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';

/** A spot's house edge as an exact fraction: what the house keeps of the pockets, over the pockets. */
export function spotEdge(v: Variant, spot: Spot): [number, number] {
  const n = pocketCount(v);
  return [n - (spot.pays + 1) * spot.numbers.length, n];
}

const pct = (e: readonly [number, number]) => `${((e[0] / e[1]) * 100).toFixed(2)}%`;

function edges(v: Variant): { usual: string; top: string | null } {
  const spots = [...spotsOf(v).values()];
  const usual = spots.find((s) => s.kind === 'straight')!;
  const top = spots.find((s) => s.kind === 'topline');
  return { usual: pct(spotEdge(v, usual)), top: top ? pct(spotEdge(v, top)) : null };
}

/** The Tips line: the one bet to avoid on a double-zero wheel (loudly, once it's down), else that no bet beats another. */
export function rouletteAdvice(v: Variant, mine: Record<string, Cents>): string {
  const e = edges(v);
  if (!e.top) return `Every bet here costs ${e.usual}, about half the American wheel's ${edges('american').usual}.`;
  if (Object.keys(mine).some((k) => k.startsWith('topline'))) return `Top line: ${e.top} house edge, the worst bet on the table. Every other bet costs ${e.usual}.`;
  return `${e.usual} on every bet but the top line (${e.top}): skip that one. A European wheel costs about half.`;
}

export type Tier = 'nice' | 'big' | 'huge';

export interface RouletteMoment {
  key: string;
  tier: Tier;
  title: string;
  sub: string;
}

const RANK: Partial<Record<Spot['kind'], Tier>> = { straight: 'big', split: 'nice', street: 'nice' };

/**
 * A straight-up hit is big, a split or street (or trio) nice; other winners aren't a moment. Only
 * when the spin returned more than the player staked on it, across every bet they had down.
 */
export function rouletteMoment(v: Variant, st: SeatSettle): RouletteMoment | null {
  if (st.returned <= st.wagered) return null;
  let best: (RouletteMoment & { win: number }) | null = null;
  for (const [key, amount, returned] of st.bets) {
    if (returned <= amount) continue;
    const spot = spotByKey(v, key);
    const tier = spot && RANK[spot.kind];
    if (!spot || !tier) continue;
    const win = returned - amount;
    if (best && (best.tier === 'big' && tier !== 'big' || (best.tier === tier && best.win >= win))) continue;
    const title = spot.kind === 'straight' ? `Straight up ${pocketLabel(spot.numbers[0]!)}` : spotName(spot);
    best = { key, tier, title, sub: `Pays ${spot.pays} to 1 · ${formatMoney(win, { sign: true })}`, win };
  }
  if (!best) return null;
  const { win: _w, ...m } = best;
  return m;
}
