// Favourite layouts: the chips a player had on the layout, kept in this browser under a slot,
// and put down again in one placement (so Undo takes the whole layout back). A favourite is
// plain spot keys and amounts; it is checked against the table it goes down on (each spot's
// limits, the table's maximum a spin, the stack) before it is sent, and the server checks it
// again. Storage can be missing or blocked: then favourites last for this visit only.

import { type Variant, spotByKey } from '../../../../shared/src/games/roulette/rules.ts';
import { MAX_BETS_PER_ACTION, type BetInput } from '../../../../shared/src/games/roulette/protocol.ts';
import { checkBet, formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { TableConfig } from '../../../../shared/src/engine.ts';

export const SLOTS = 3;

/** One saved layout: spot key -> cents. */
export type Layout = Record<string, Cents>;

const key = (v: Variant) => `casino.roulette.favourites.${v}`;
const memory = new Map<Variant, (Layout | null)[]>();

/** The slots for this wheel (null: empty), as saved. Junk in storage reads as empty. */
export function loadFavourites(v: Variant): (Layout | null)[] {
  const kept = memory.get(v);
  if (kept) return kept;
  let slots: (Layout | null)[] = Array.from({ length: SLOTS }, () => null);
  try {
    const raw = JSON.parse(localStorage.getItem(key(v)) ?? 'null') as unknown;
    if (Array.isArray(raw)) slots = slots.map((_, i) => clean(v, raw[i]));
  } catch {
    // blocked or corrupt: empty slots
  }
  memory.set(v, slots);
  return slots;
}

/** A saved layout only if every spot is a real one on this wheel with a whole positive amount. */
function clean(v: Variant, x: unknown): Layout | null {
  if (!x || typeof x !== 'object') return null;
  const out: Layout = {};
  for (const [k, a] of Object.entries(x as Record<string, unknown>)) {
    if (!spotByKey(v, k) || typeof a !== 'number' || !Number.isInteger(a) || a <= 0) return null;
    out[k] = a;
  }
  const n = Object.keys(out).length;
  return n > 0 && n <= MAX_BETS_PER_ACTION ? out : null;
}

export function saveFavourite(v: Variant, slot: number, layout: Layout | null): (Layout | null)[] {
  const slots = [...loadFavourites(v)];
  slots[slot] = layout && Object.keys(layout).length ? { ...layout } : null;
  memory.set(v, slots);
  try {
    localStorage.setItem(key(v), JSON.stringify(slots));
  } catch {
    // kept for this visit only
  }
  return slots;
}

export function layoutTotal(layout: Layout): Cents {
  return Object.values(layout).reduce((a, b) => a + b, 0);
}

/** Why the chips on the layout can't be kept as a favourite, or null when they can. */
export function saveRefusal(layout: Layout): string | null {
  const n = Object.keys(layout).length;
  if (n === 0) return 'Put chips on the layout first, then save them.';
  if (n > MAX_BETS_PER_ACTION) return `A favourite keeps up to ${MAX_BETS_PER_ACTION} spots; this layout has ${n}.`;
  return null;
}

/**
 * The chips a favourite sends at this table, on top of what is already down, or why it can't:
 * each spot within its inside or outside limits, the table's maximum a spin, the stack.
 */
export function placeFavourite(v: Variant, layout: Layout, cfg: TableConfig, bets: Record<string, Cents>, stack: Cents): { bets: BetInput[]; total: Cents } | { refusal: string } {
  const out: BetInput[] = [];
  let total = 0;
  for (const [k, amount] of Object.entries(layout)) {
    const spot = spotByKey(v, k);
    if (!spot) return { refusal: "That favourite was saved on the other wheel's layout." };
    const lim = (spot.inside ? cfg.limits.inside : cfg.limits.outside) ?? cfg.limits.default;
    const problem = checkBet((bets[k] ?? 0) + amount, lim);
    if (problem === 'BELOW_MIN') return { refusal: `${spot.inside ? 'Inside' : 'Outside'} bets here start at ${formatMoney(lim.min)}${spot.inside ? ' a spot' : ''}.` };
    if (problem === 'ABOVE_MAX') return { refusal: `${spot.inside ? 'Inside' : 'Outside'} bets here are limited to ${formatMoney(lim.max)}${spot.inside ? ' a spot' : ''}.` };
    if (problem) return { refusal: `Bets here go in steps of ${formatMoney(lim.step)}.` };
    total += amount;
    out.push({ kind: spot.kind, ...(spot.inside ? { numbers: [...spot.numbers] } : {}), amount });
  }
  const down = Object.values(bets).reduce((a, b) => a + b, 0);
  if (down + total > cfg.limits.default.max) return { refusal: `The table maximum is ${formatMoney(cfg.limits.default.max)} a spin.` };
  if (total > stack) return { refusal: `That layout is ${formatMoney(total)}, more than your stack.` };
  return { bets: out, total };
}
