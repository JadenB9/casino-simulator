// Max at every table: the most one more bet can put on a spot, worked out from the table's own
// limits, what is already down and the chips in front of you. Each is exactly what that game's
// engine accepts (client/test/max.test.ts plays them against the engines): the spot's maximum,
// any per-round table maximum, and at Three Card Poker and War the match a Play bet or a war
// raise will need. The server checks every bet again, so a stale view only costs a refusal.

import type { TableConfig } from '../../../shared/src/engine.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../shared/src/money.ts';
import { maxBet, type MaxBet } from '../../../shared/src/limits.ts';
import type { Spot as RouletteSpot } from '../../../shared/src/games/roulette/rules.ts';
import { limitKey as baccaratKey, type Spot as BaccaratSpot } from '../../../shared/src/games/baccarat/rules.ts';
import type { Spot as SicBoSpot } from '../../../shared/src/games/sicbo/rules.ts';
import { layVig, limitKey as crapsKey, maxOdds, oddsLimitKey, type Bet, type BetKind, type PointNumber } from '../../../shared/src/games/craps/rules.ts';

export type { MaxBet } from '../../../shared/src/limits.ts';

function lim(cfg: TableConfig, key: string): BetLimits {
  return cfg.limits[key] ?? cfg.limits.default;
}

const sum = (bets: Record<string, Cents | undefined>): Cents => Object.values(bets).reduce<number>((a, b) => a + (b ?? 0), 0);

/** Why Max can't put anything down, in a few words for a toast. */
export function maxRefusal(m: Exclude<MaxBet, { amount: Cents }>, limits: BetLimits): string {
  return m.none === 'AT_MAX' ? `That bet is already at the table maximum, ${formatMoney(limits.max)}.` : `Not enough chips for the ${formatMoney(limits.min)} minimum there.`;
}

/** Blackjack: the main bet. */
export function blackjackMax(cfg: TableConfig, current: Cents, stack: Cents): MaxBet {
  return maxBet({ limits: cfg.limits.default, current, stack });
}

/** Roulette: one spot, under its inside or outside limit and the table's maximum a spin. */
export function rouletteMax(cfg: TableConfig, spot: RouletteSpot, bets: Record<string, Cents>, stack: Cents): MaxBet {
  const limits = lim(cfg, spot.inside ? 'inside' : 'outside');
  return maxBet({ limits, current: bets[spot.key] ?? 0, stack, room: cfg.limits.default.max - sum(bets) });
}

/** The Big Six wheel: one of the seven spots, and the table's maximum a spin. */
export function bigSixMax(cfg: TableConfig, key: string, bets: Record<string, Cents | undefined>, stack: Cents): MaxBet {
  return maxBet({ limits: lim(cfg, 'spot'), current: bets[key] ?? 0, stack, room: cfg.limits.default.max - sum(bets) });
}

/** Sic Bo: one box, under its class's limit and the table's maximum a roll. */
export function sicBoMax(cfg: TableConfig, spot: SicBoSpot, bets: Record<string, Cents>, stack: Cents): MaxBet {
  return maxBet({ limits: lim(cfg, spot.limit), current: bets[spot.key] ?? 0, stack, room: cfg.limits.default.max - sum(bets) });
}

/** Baccarat: Player, Banker, Tie or a pair. */
export function baccaratMax(cfg: TableConfig, spot: BaccaratSpot, bets: Partial<Record<BaccaratSpot, Cents>>, stack: Cents): MaxBet {
  return maxBet({ limits: lim(cfg, baccaratKey(spot)), current: bets[spot] ?? 0, stack });
}

/**
 * Three Card Poker: the Ante keeps its match back for the Play bet, so it goes up by half of what
 * is left over the Ante already down; Pair Plus can use everything but the Play's match.
 */
export function threeCardMax(cfg: TableConfig, kind: 'ante' | 'pairPlus', bets: { ante: Cents; pairPlus: Cents }, stack: Cents): MaxBet {
  if (kind === 'ante') return maxBet({ limits: lim(cfg, 'ante'), current: bets.ante, stack: Math.floor((stack - bets.ante) / 2) });
  return maxBet({ limits: lim(cfg, 'pairPlus'), current: bets.pairPlus, stack: stack - bets.ante });
}

/** Casino War: the bet keeps its match back for a war's raise. */
export function warMax(cfg: TableConfig, bets: { bet: Cents; tie: Cents }, stack: Cents): MaxBet {
  return maxBet({ limits: lim(cfg, 'bet'), current: bets.bet, stack: Math.floor((stack - bets.bet) / 2) });
}

/**
 * Craps, a flat bet: its spot's maximum, or your chips. A lay bet pays its commission up front,
 * so the most it can be is the largest amount whose total cost still fits.
 */
export function crapsMax(cfg: TableConfig, kind: BetKind, n: number | undefined, current: Bet | undefined, stack: Cents): MaxBet {
  const limits = lim(cfg, crapsKey(kind, n));
  const cur = current?.amount ?? 0;
  if (kind !== 'lay') return maxBet({ limits, current: cur, stack });
  const point = n as PointNumber;
  const paid = current?.vig ?? 0;
  const first = maxBet({ limits, current: cur, stack });
  if ('none' in first) return first;
  // the commission is 5% of what the lay wins, so trimming a step at a time finds it in a few tries
  for (let add = first.amount; add > 0; add -= limits.step) {
    if (add + layVig(cur + add, point) - paid <= stack) return cur + add >= limits.min ? { amount: add } : { none: 'SHORT' };
  }
  return { none: 'SHORT' };
}

/** Craps, odds behind a line or come bet on `point`: up to 3-4-5x (6x laid) and the odds limit. */
export function crapsOddsMax(cfg: TableConfig, flatKind: 'pass' | 'dontpass' | 'come' | 'dontcome', flat: Bet, point: PointNumber, stack: Cents): MaxBet {
  const lay = flatKind === 'dontpass' || flatKind === 'dontcome';
  const limits = lim(cfg, oddsLimitKey(lay, point));
  const current = flat.odds ?? 0;
  return maxBet({ limits, current, stack, room: maxOdds(flatKind, flat.amount, point) - current });
}
