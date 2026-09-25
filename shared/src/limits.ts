// Table limits: the smallest and largest bet at a table, chosen by whoever starts it (a solo
// table each time you sit down, a lobby when it is created). The server clamps every choice with
// the rules here and the client uses the same rules to explain them, so they are written once.
//
// Each engine's config() is the Standard table. A table at other limits keeps the rules and the
// shape of the Standard one: every per-bet limit (roulette's inside and outside, the craps odds
// and props, a side bet) and the buy-in scale from the chosen minimum and maximum in the same
// proportion the Standard table has, rounded to that bet's step. Every Standard table takes a
// buy-in of up to a hundred times its maximum bet, so every table does (Hold'em keeps poker's
// 20 to 100 big blinds). Only how much may be bet changes, never what a bet pays, so the
// published odds hold at every table.

import type { GameId, TableConfig } from './engine.ts';
import { type BetLimits, type Cents, DOLLAR, formatCompact, formatMoney } from './money.ts';

/** A table's limits as a player picks them: its minimum and maximum bet (Hold'em: the blinds). */
export interface TableLimits {
  min: Cents;
  max: Cents;
}

export interface LimitTier extends TableLimits {
  /** "Low", "High limit"; empty for Hold'em, whose stakes name themselves. */
  name: string;
}

export interface LimitSpec {
  /** 'bets': a minimum and a maximum bet. 'blinds': Hold'em's small blind (min) and big blind (max). */
  kind: 'bets' | 'blinds';
  /** The TableConfig.limits entry that is the table's headline bet (the one on its sign). */
  key: string;
  /** Offered in this order, cheapest first. */
  tiers: readonly LimitTier[];
  /** The tier that is the engine's own config(). */
  standard: number;
  /** A custom choice: the minimum from `low` to `high` in `step`s ... */
  min: { low: Cents; high: Cents; step: Cents };
  /** ... and the maximum at least `ratio` (at most `ratioMax`) times it, never above `ceiling`. */
  max: { ratio: number; ratioMax?: number; ceiling: Cents; step: Cents };
}

const D = DOLLAR;

function tiers(...list: [name: string, min: number, max: number][]): LimitTier[] {
  return list.map(([name, min, max]) => ({ name, min: min * D, max: max * D }));
}

const NAMES = ['Low', 'Standard', 'High', 'High limit', 'Salon', 'Penthouse'] as const;

/** Six tiers named Low to Penthouse, Standard second. */
function ladder(...pairs: [min: number, max: number][]): LimitTier[] {
  return tiers(...pairs.map(([min, max], i) => [NAMES[i]!, min, max] as [string, number, number]));
}

/**
 * A game of bets: its tiers, and a custom minimum from $1 up to a tenth of `ceiling` with a
 * maximum at least ten times it, never above `ceiling`.
 */
function bets(key: string, tierList: LimitTier[], ceiling: number): LimitSpec {
  return {
    kind: 'bets',
    key,
    tiers: tierList,
    standard: 1,
    min: { low: D, high: (ceiling / 10) * D, step: D },
    max: { ratio: 10, ceiling: ceiling * D, step: D },
  };
}

/** Table games go up to $500,000 a bet as a tier and $1,000,000 as custom limits. */
const TABLE_CEILING = 1_000_000;
/** The Big Six wheel, the Bandit Wheel and the online games stop at $100,000. */
const WHEEL_CEILING = 100_000;

/** The online games and the Bandit Wheel: $1 to $1,000 a bet at Standard. */
const ONLINE = (): LimitSpec => bets('default', ladder([1, 100], [1, 1_000], [5, 5_000], [25, 10_000], [100, 50_000], [1_000, 100_000]), WHEEL_CEILING);

export const LIMITS: Partial<Record<GameId, LimitSpec>> = {
  blackjack: bets('default', ladder([5, 500], [25, 5_000], [100, 10_000], [500, 50_000], [1_000, 100_000], [5_000, 500_000]), TABLE_CEILING),
  // the headline is the outside bet; inside bets are a tenth of its maximum a number
  roulette: bets('outside', ladder([1, 1_000], [5, 5_000], [25, 10_000], [100, 50_000], [1_000, 100_000], [5_000, 500_000]), TABLE_CEILING),
  // the headline is the line bet
  craps: bets('line', ladder([5, 1_000], [10, 5_000], [25, 10_000], [100, 50_000], [1_000, 100_000], [5_000, 500_000]), TABLE_CEILING),
  baccarat: bets('default', ladder([5, 1_000], [10, 5_000], [50, 10_000], [100, 50_000], [1_000, 100_000], [5_000, 500_000]), TABLE_CEILING),
  threecard: bets('ante', ladder([5, 500], [10, 1_000], [25, 5_000], [100, 10_000], [1_000, 100_000], [5_000, 500_000]), TABLE_CEILING),
  war: bets('bet', ladder([5, 500], [10, 1_000], [25, 5_000], [100, 10_000], [1_000, 100_000], [5_000, 500_000]), TABLE_CEILING),
  // v6 tables6: each of Let It Ride's three circles (a royal pays 1,000 to 1 on all three, so its
  // top tiers stop lower than the other card tables')
  letitride: bets('bet', ladder([5, 500], [10, 1_000], [25, 2_500], [100, 5_000], [500, 25_000], [1_000, 50_000]), WHEEL_CEILING),
  // v6 tables6: the Pai Gow Poker bet; the Fortune bonus scales from it
  paigow: bets('bet', ladder([5, 500], [10, 1_000], [25, 5_000], [100, 10_000], [1_000, 100_000], [5_000, 500_000]), TABLE_CEILING),
  // each spot; the most on the layout a spin is five times it
  bigsix: bets('spot', ladder([1, 100], [1, 500], [5, 1_000], [25, 5_000], [100, 25_000], [1_000, 100_000]), WHEEL_CEILING),
  // Small, Big, Odd and Even; the other bets scale from them
  sicbo: bets('even', ladder([1, 500], [5, 5_000], [25, 10_000], [100, 50_000], [1_000, 100_000], [5_000, 500_000]), TABLE_CEILING),
  holdem: {
    kind: 'blinds',
    key: 'default',
    tiers: tiers(['', 1, 2], ['', 2, 5], ['', 5, 10], ['', 10, 20], ['', 25, 50], ['', 50, 100], ['', 100, 200], ['', 500, 1_000], ['', 1_000, 2_000]),
    standard: 2,
    min: { low: D, high: 5_000 * D, step: D },
    max: { ratio: 2, ratioMax: 3, ceiling: 10_000 * D, step: D },
  },
  banditwheel: ONLINE(),
  plinko: ONLINE(),
  tower: ONLINE(),
  mines: ONLINE(),
  dice: ONLINE(),
  limbo: ONLINE(),
  keno: ONLINE(),
  hilo: ONLINE(),
  crash: ONLINE(),
  // v6 online6:
  coinflip: ONLINE(),
  wheel: ONLINE(),
  cases: ONLINE(),
  diamonds: ONLINE(),
  // v6 parlor6: a bingo card, a pachinko batch of 25 balls
  bingo: ONLINE(),
  pachinko: ONLINE(),
  // the test fixture, so the host's limits can be tested on the simplest engine
  highcard: ONLINE(),
};

export function limitSpec(game: GameId): LimitSpec | null {
  return LIMITS[game] ?? null;
}

/** Whether a table of this game has limits to choose (machines keep their coin values instead). */
export function hasLimitChoice(game: GameId): boolean {
  return limitSpec(game) !== null;
}

/** The Standard tier: what engine.config() already is. */
export function standardLimits(game: GameId): TableLimits | null {
  const spec = limitSpec(game);
  if (!spec) return null;
  const t = spec.tiers[spec.standard]!;
  return { min: t.min, max: t.max };
}

export function sameLimits(a: TableLimits | null | undefined, b: TableLimits | null | undefined): boolean {
  return !!a && !!b && a.min === b.min && a.max === b.max;
}

/** Untrusted input to limits, by shape only (two positive whole numbers of cents); the rules are clampLimits'. */
export function parseLimits(raw: unknown): TableLimits | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { min, max } = raw as { min?: unknown; max?: unknown };
  const ok = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0;
  return ok(min) && ok(max) ? { min, max } : null;
}

/** "min-max" in cents, as a socket URL carries a solo table's limits. */
export function limitsParam(l: TableLimits): string {
  return `${l.min}-${l.max}`;
}

export function parseLimitsParam(s: string | null): TableLimits | null {
  const m = s ? /^(\d{1,12})-(\d{1,12})$/.exec(s) : null;
  return m ? parseLimits({ min: Number(m[1]), max: Number(m[2]) }) : null;
}

/** The range a custom maximum may take for this minimum. */
export function maxRange(spec: LimitSpec, min: Cents): { low: Cents; high: Cents } {
  const step = spec.max.step;
  const low = Math.ceil((min * spec.max.ratio) / step) * step;
  const cap = spec.max.ratioMax ? Math.min(spec.max.ceiling, min * spec.max.ratioMax) : spec.max.ceiling;
  return { low, high: Math.max(low, Math.floor(cap / step) * step) };
}

/**
 * Why these limits can't be a table of this game, in words for the player, or null if they can.
 * The wording names the rule broken, so the picker can show it under the fields.
 */
export function limitsProblem(game: GameId, l: TableLimits): string | null {
  const spec = limitSpec(game);
  if (!spec) return 'This game has no limits to choose.';
  const blinds = spec.kind === 'blinds';
  const minWord = blinds ? 'The small blind' : 'The minimum';
  const maxWord = blinds ? 'The big blind' : 'The maximum';
  const { low, high, step } = spec.min;
  if (!Number.isSafeInteger(l.min) || l.min < low || l.min > high || l.min % step !== 0) {
    return `${minWord} is ${formatMoney(low)} to ${formatMoney(high)}, in whole dollars.`;
  }
  const r = maxRange(spec, l.min);
  if (!Number.isSafeInteger(l.max) || l.max % spec.max.step !== 0) return `${maxWord} is a whole number of dollars.`;
  if (l.max < r.low) {
    return blinds ? `The big blind is at least twice the small blind (${formatMoney(r.low)}).` : `The maximum is at least ${spec.max.ratio} times the minimum (${formatMoney(r.low)}).`;
  }
  if (l.max > r.high) {
    if (blinds && l.max <= spec.max.ceiling) return `The big blind is at most three times the small blind (${formatMoney(r.high)}).`;
    return `${maxWord} here is at most ${formatMoney(r.high)}.`;
  }
  return null;
}

/**
 * The nearest limits this game allows: the minimum into its range and step, the maximum into
 * the range that minimum allows. What the server does with every choice a client sends.
 */
export function clampLimits(game: GameId, l: TableLimits): TableLimits | null {
  const spec = limitSpec(game);
  if (!spec) return null;
  const { low, high, step } = spec.min;
  const min = Math.min(high, Math.max(low, Math.floor(l.min / step) * step));
  const r = maxRange(spec, min);
  const max = Math.min(r.high, Math.max(r.low, Math.floor(l.max / spec.max.step) * spec.max.step));
  return { min, max };
}

// ---------------------------------------------------------------------------------------------
// From chosen limits to a table's config

function scale(base: BetLimits, kmin: number, kmax: number): BetLimits {
  const step = base.step;
  // round first: 100 * 0.2 is 20.000000000000004 in floating point
  const min = Math.max(step, Math.ceil(Math.round(base.min * kmin) / step) * step);
  const max = Math.max(min, Math.floor(Math.round(base.max * kmax) / step) * step);
  return { min, max, step };
}

function wholeDollars(x: number, up: boolean): Cents {
  const d = Math.round(x) / D;
  return (up ? Math.ceil(d) : Math.floor(d)) * D;
}

/**
 * The config for a table at these limits, from the Standard config of its game. The limits must
 * already be allowed (clampLimits); the Standard tier gives back the config unchanged.
 */
export function applyLimits(cfg: TableConfig, l: TableLimits): TableConfig {
  const spec = limitSpec(cfg.game);
  // The Standard table as it is: rounding every limit to its step again would trim a few maxima
  // that aren't a multiple of their step (a $3-step lay bet's $10,000 takes $9,999 either way).
  if (!spec || sameLimits(l, limitsOf(cfg))) return cfg;
  if (spec.kind === 'blinds') {
    const sb = l.min;
    const bb = l.max;
    return {
      ...cfg,
      // 20 to 100 big blinds, as at the Standard table
      buyIn: { min: 20 * bb, max: 100 * bb },
      limits: { ...cfg.limits, default: { ...cfg.limits.default, min: bb } },
      options: { ...cfg.options, sb, bb },
    };
  }
  const base = cfg.limits[spec.key] ?? cfg.limits.default;
  const kmin = l.min / base.min;
  const kmax = l.max / base.max;
  const limits = {} as TableConfig['limits'];
  for (const [key, lim] of Object.entries(cfg.limits)) limits[key] = scale(lim, kmin, kmax);
  // the headline is exactly what was chosen
  limits[spec.key] = { min: l.min, max: l.max, step: base.step };
  const buyMin = Math.max(D, wholeDollars(cfg.buyIn.min * kmin, true));
  const buyIn = { min: buyMin, max: Math.max(buyMin, wholeDollars(cfg.buyIn.max * kmax, false)) };
  return { ...cfg, limits, buyIn };
}

/** A table's limits read back from its config (what applyLimits was given). */
export function limitsOf(cfg: TableConfig): TableLimits {
  const spec = limitSpec(cfg.game);
  if (spec?.kind === 'blinds') return { min: Number(cfg.options.sb), max: Number(cfg.options.bb) };
  const lim = (spec && cfg.limits[spec.key]) || cfg.limits.default;
  return { min: lim.min, max: lim.max };
}

// ---------------------------------------------------------------------------------------------
// Words

/** "$25–$5,000", or Hold'em's "$1/$2". */
export function limitsLabel(game: GameId, l: TableLimits, compact = false): string {
  const f = compact ? formatCompact : formatMoney;
  return limitSpec(game)?.kind === 'blinds' ? `${f(l.min)}/${f(l.max)}` : `${f(l.min)}–${f(l.max)}`;
}

/** Everything a game's tables can be, cheapest tier to dearest: "$1–$50,000", "$1/$2 to $100/$200". */
export function limitsSpan(game: GameId): string | null {
  const spec = limitSpec(game);
  if (!spec) return null;
  const lo = spec.tiers[0]!;
  const hi = spec.tiers[spec.tiers.length - 1]!;
  return spec.kind === 'blinds' ? `${limitsLabel(game, lo)} to ${limitsLabel(game, hi)}` : `${formatMoney(lo.min)}–${formatMoney(hi.max)}`;
}

const range = (b: BetLimits | undefined): string => (b ? `${formatMoney(b.min)}–${formatMoney(b.max)}` : '');

/**
 * The limits a table at `cfg` has beyond its headline, a few words each, for the picker and the
 * party panel: "Inside $1–$500 a number", "Odds up to $25,000", "Buy-in $100–$50,000".
 */
export function limitsDetail(cfg: TableConfig): string[] {
  const l = cfg.limits;
  const out: string[] = [];
  switch (cfg.game) {
    case 'roulette':
      out.push(`Inside ${range(l.inside)} a number`, `${formatMoney(l.default.max)} a spin`);
      break;
    case 'craps':
      out.push(`Odds up to ${formatMoney(l.odds?.max ?? 0)}`, `Props ${range(l.prop)}`);
      break;
    case 'baccarat':
      out.push(`Tie ${range(l.tie)}`, `Pairs ${range(l.pair)}`);
      break;
    case 'threecard':
      out.push(`Pair Plus ${range(l.pairPlus)}`);
      break;
    case 'war':
      out.push(`Tie bet ${range(l.tie)}`);
      break;
    case 'letitride':
      out.push('Three equal bets', `3-Card Bonus ${range(l.bonus)}`);
      break;
    case 'paigow':
      out.push(`Fortune ${range(l.fortune)}`, '5% commission on wins');
      break;
    case 'bigsix':
      out.push(`${formatMoney(l.default.max)} a spin`);
      break;
    case 'sicbo':
      out.push(`Numbers ${range(l.single)}`, `Triples ${range(l.triple)}`, `${formatMoney(l.default.max)} a roll`);
      break;
    case 'holdem':
      out.push('No limit', '20 to 100 big blinds to sit');
      break;
  }
  out.push(`Buy-in ${range({ ...cfg.buyIn, step: D })}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Max: the most one more bet can put on a spot

export type MaxBet = { amount: Cents } | { none: 'AT_MAX' | 'SHORT' };

/**
 * The most one more bet can add to a spot that already holds `current`: up to that spot's
 * maximum (and `room`, what a per-round table maximum leaves), and no more than `stack`, in the
 * spot's step. `none` says why nothing fits: the spot is at its maximum, or the chips you have
 * don't reach its minimum.
 */
export function maxBet(o: { limits: BetLimits; current: Cents; stack: Cents; room?: Cents }): MaxBet {
  const { limits: lim, current } = o;
  const space = Math.min(lim.max - current, o.room ?? Infinity);
  if (space <= 0 || space < lim.step) return { none: 'AT_MAX' };
  let amount = Math.min(space, o.stack);
  amount -= amount % lim.step;
  if (amount <= 0 || current + amount < lim.min) return { none: 'SHORT' };
  return { amount };
}
