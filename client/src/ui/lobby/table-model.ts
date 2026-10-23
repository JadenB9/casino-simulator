// Sitting down, without the DOM, so the unit tests can check it: the stakes a lobby is at as the
// list's filter chips name them, whether limits typed into Custom can open a table here (the High
// Limit Salon's rules included), and the buy-in prompt's arithmetic (its quick amounts, its slider,
// what's wrong with what's typed).

import type { GameId } from '../../../../shared/src/engine.ts';
import type { LobbySummary } from '../../../../shared/src/protocol.ts';
import { clampLimits, limitSpec, limitsLabel, limitsProblem, sameLimits, type LimitSpec, type TableLimits } from '../../../../shared/src/limits.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';

// --- the list's stakes -------------------------------------------------------------------------

/** A table's stake: a tier's name ("Standard"), a Hold'em table's blinds ("$1/$2": its tiers have no names), or Custom. */

export const CUSTOM = 'Custom';

// (null when the table says nothing about its limits)
export function stakeOf(game: GameId, lobby: Pick<LobbySummary, 'limits'>): string | null {
  const l = lobby.limits;
  if (!l) return null;
  const tier = limitSpec(game)?.tiers.find((t) => sameLimits(t, l));
  if (!tier) return CUSTOM;
  return tier.name || limitsLabel(game, tier, true);
}

/** The stakes these tables are at, cheapest first, Custom last; each once. */
export function stakesOf(game: GameId, list: readonly Pick<LobbySummary, 'limits'>[]): string[] {
  const have = new Set(list.map((l) => stakeOf(game, l)).filter((s): s is string => s !== null));
  const tiers = (limitSpec(game)?.tiers ?? []).map((t) => t.name || limitsLabel(game, t, true));
  return [...tiers.filter((t) => have.has(t)), ...(have.has(CUSTOM) ? [CUSTOM] : [])];
}

// --- custom limits -------------------------------------------------------------------------------

/**
 * Why these limits can't open a table here, in words, or null: limitsProblem, told when the table
 * is in the High Limit Salon (its games take the same rules up to a far higher ceiling,
 * limitSpec(game, true)). The server clamps with the same spec.
 */
export function problemHere(game: GameId, spec: LimitSpec, l: TableLimits): string | null {
  return limitsProblem(game, l, spec !== limitSpec(game));
}

/** Which of the two custom fields a problem is in: an amount that isn't one, else the minimum if the rules move it, else the maximum. */
export function faultIn(game: GameId, spec: LimitSpec, l: TableLimits): 'min' | 'max' | null {
  if (Number.isNaN(l.min)) return 'min';
  if (Number.isNaN(l.max)) return 'max';
  if (!problemHere(game, spec, l)) return null;
  const fixed = clampLimits(game, l, spec !== limitSpec(game));
  return fixed?.min !== l.min ? 'min' : 'max';
}

// --- the buy-in prompt ---------------------------------------------------------------------------

const D = 100;
/** The slider's notches, end to end. */
export const NOTCHES = 1000;
/** Wider than this many times its minimum, the slider runs on a log scale. */
const LOG_FROM = 20;

/** A round amount at or under `x`: 1, 2 or 5 times a power of ten dollars ($1 at the least). */
function roundDown(x: Cents): Cents {
  const d = Math.floor(x / D);
  if (d < 1) return D;
  const p = 10 ** (String(d).length - 1);
  return (d / p >= 5 ? 5 : d / p >= 2 ? 2 : 1) * p * D;
}

/** The quick amounts: the minimum, round amounts up the range (a hundredth, a tenth, half), and the most. */
export function buyInPicks(min: Cents, max: Cents): Cents[] {
  return [min, roundDown(max / 100), roundDown(max / 10), roundDown(max / 2), max]
    .filter((v) => v >= min && v <= max)
    .sort((a, b) => a - b)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/** Dollars to two significant figures (whole dollars always): what a slider notch lands on. */
function nice(c: Cents): Cents {
  const d = c / D;
  if (d < 10) return Math.round(d) * D;
  const step = 10 ** (Math.floor(Math.log10(d)) - 1);
  return Math.round(d / step) * step * D;
}

function logScale(min: Cents, max: Cents): boolean {
  return min > 0 && max / min > LOG_FROM;
}

/** The amount at notch `n` of the slider over min..max: the ends exact, round amounts between. */
export function amountAt(n: number, min: Cents, max: Cents): Cents {
  if (max <= min || n <= 0) return min;
  if (n >= NOTCHES) return max;
  const k = n / NOTCHES;
  const raw = logScale(min, max) ? min * (max / min) ** k : min + (max - min) * k;
  return Math.min(max, Math.max(min, nice(raw)));
}

/** The notch nearest an amount (the slider follows what's typed). */
export function notchOf(amount: Cents, min: Cents, max: Cents): number {
  if (max <= min || amount <= min) return 0;
  if (amount >= max) return NOTCHES;
  const k = logScale(min, max) ? Math.log(amount / min) / Math.log(max / min) : (amount - min) / (max - min);
  return Math.round(Math.min(1, Math.max(0, k)) * NOTCHES);
}

/** What's typed, in cents (whole dollars), and what's wrong with it in words, or null. */
export function buyInProblem(text: string, min: Cents, max: Cents): { cents: Cents; problem: string | null } {
  const t = text.trim().replace(/[,$\s]/g, '');
  const n = Number(t);
  if (t === '' || !Number.isFinite(n)) return { cents: NaN, problem: 'Type an amount in dollars.' };
  const cents = Math.round(n) * D;
  if (cents < min || cents > max) return { cents, problem: `Choose between ${formatMoney(min)} and ${formatMoney(max)}.` };
  return { cents, problem: null };
}
