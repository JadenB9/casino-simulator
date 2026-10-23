// The calls a craps dealer takes in one breath: "Across" (a place bet on every number but the
// point), "Inside" (5, 6, 8 and 9, but the point) and "Hardways" (all four hard numbers). Each is
// ordinary place and hardway bets sent as one batch, all or nothing, so nothing about the game
// changes: they pay as those bets pay. Sized the way dealers size them from the chip a player
// holds out: $5 on the 4, 5, 9 and 10 and $6 on the 6 and 8 for a red chip, five times that for
// a green one, never under the table's minimums. Pure, so the tests can play it against the engine.

import { HARD_PAYS, POINTS, limitKey, betId, type Bet, type PointNumber } from '../../../../shared/src/games/craps/rules.ts';
import type { BetRequest } from '../../../../shared/src/games/craps/protocol.ts';
import type { TableConfig } from '../../../../shared/src/engine.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';

export type QuickId = 'across' | 'inside' | 'hardways';

export interface Quick {
  id: QuickId;
  name: string;
  /** What it covers, for its button's title. */
  what: string;
}

export const QUICKS: readonly Quick[] = [
  { id: 'across', name: 'Across', what: 'A place bet on every number but the point (all six coming out)' },
  { id: 'inside', name: 'Inside', what: 'Place bets on 5, 6, 8 and 9, but the point' },
  { id: 'hardways', name: 'Hardways', what: 'Hard 4, 6, 8 and 10, one chip each' },
];

const HARDS = Object.keys(HARD_PAYS).map(Number) as (4 | 6 | 8 | 10)[];

function lim(cfg: TableConfig, key: string): BetLimits {
  return cfg.limits[key] ?? cfg.limits.default;
}

/** The numbers a quick call covers with the puck at `point`. */
export function quickNumbers(id: QuickId, point: PointNumber | null): number[] {
  if (id === 'hardways') return [...HARDS];
  const all: readonly number[] = id === 'across' ? POINTS : [5, 6, 8, 9];
  return all.filter((n) => n !== point);
}

/**
 * The bets a quick call sends for a `chip`-sized call, on top of what the player has down, or why
 * it can't go down. A spot already at its maximum is left out; nothing at all left is a refusal.
 */
export function quickBets(id: QuickId, cfg: TableConfig, chip: Cents, point: PointNumber | null, mine: Record<string, Bet>, stack: Cents): { bets: BetRequest[]; total: Cents } | { refusal: string } {
  const kind = id === 'hardways' ? 'hard' : 'place';
  // a call's unit: how many $5 steps the chip is (a hardway's unit is the chip itself)
  const units = Math.max(1, Math.round(chip / lim(cfg, 'place4').step));
  const bets: BetRequest[] = [];
  let total = 0;
  let full = 0;
  for (const n of quickNumbers(id, point)) {
    const l = lim(cfg, limitKey(kind, n));
    const want = kind === 'hard' ? Math.round(chip / l.step) * l.step : units * l.step;
    const cur = mine[betId(kind, n)]?.amount ?? 0;
    let amount = Math.max(want, l.min - cur, l.step);
    amount = Math.ceil(amount / l.step) * l.step;
    if (cur + amount > l.max) amount = Math.floor((l.max - cur) / l.step) * l.step;
    if (amount <= 0 || cur + amount < l.min) {
      full++;
      continue;
    }
    bets.push({ kind, number: n, amount });
    total += amount;
  }
  if (bets.length === 0) return { refusal: full ? 'Those bets are already at the table maximum.' : 'Nothing to put down.' };
  if (total > stack) return { refusal: `That is ${formatMoney(total)}, more than your stack.` };
  return { bets, total };
}
