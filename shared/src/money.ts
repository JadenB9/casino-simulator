// Money. Every amount in the game is an integer number of cents: balances, stacks, bets and
// payouts. Nothing here ever holds a fraction of a cent, which is what lets a payout be exact
// and the measured house edge match the published one.

export type Cents = number;

export const DOLLAR: Cents = 100;

/** What a new account starts with, and what the bank lends when you're broke. */
export const STARTING_BALANCE: Cents = 50_000 * DOLLAR;
export const LOAN_AMOUNT: Cents = 50_000 * DOLLAR;

export function isCents(x: unknown): x is Cents {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}

export function dollars(n: number): Cents {
  return Math.round(n * DOLLAR);
}

/**
 * Casino chips, lowest first. Colors follow the usual Las Vegas scheme; the edge spots are
 * this casino's own choice (real casinos pick their own secondary colors). $2.50 and $0.50
 * are payout-only chips, used when a 3:2 or a commission lands on a half dollar.
 */
export interface ChipSpec {
  value: Cents;
  label: string;
  body: string;
  spots: string;
  ink: string;
  payoutOnly?: boolean;
}

export const CHIPS: readonly ChipSpec[] = [
  { value: 50, label: '50¢', body: '#b08d57', spots: '#efe6d2', ink: '#3a2a12', payoutOnly: true },
  { value: 100, label: '1', body: '#f3efe6', spots: '#2f6fd6', ink: '#23407a' },
  { value: 250, label: '2½', body: '#e59bb4', spots: '#f7f2ea', ink: '#6d2140', payoutOnly: true },
  { value: 500, label: '5', body: '#c7262e', spots: '#f7f2ea', ink: '#f7f2ea' },
  { value: 2_500, label: '25', body: '#1f8a4c', spots: '#f7f2ea', ink: '#f7f2ea' },
  { value: 10_000, label: '100', body: '#1d1d20', spots: '#f7f2ea', ink: '#f7f2ea' },
  { value: 50_000, label: '500', body: '#6a3ea1', spots: '#f2d24a', ink: '#f7f2ea' },
  { value: 100_000, label: '1000', body: '#f0b92a', spots: '#1d1d20', ink: '#1d1d20' },
  { value: 500_000, label: '5000', body: '#8f9196', spots: '#c7262e', ink: '#1d1d20' },
  { value: 2_500_000, label: '25K', body: '#c9a24b', spots: '#1d1d20', ink: '#1d1d20' },
  // the high-limit rooms' chips
  { value: 10_000_000, label: '100K', body: '#7a1f2b', spots: '#f2d24a', ink: '#f7f2ea' },
  { value: 100_000_000, label: '1M', body: '#0e3a4a', spots: '#e8c46a', ink: '#f7f2ea' },
];

/** The chips a player can pick from the tray (payout-only chips excluded). */
export const BETTING_CHIPS: readonly ChipSpec[] = CHIPS.filter((c) => !c.payoutOnly);

/**
 * Break an amount into chips, largest first. Whole dollars always come out as chips; a
 * remainder below 50 cents (a 5% commission on an odd amount, say) is returned as `loose` so
 * the renderer can show it as a coin or a label instead of inventing a chip.
 */
export function chipBreakdown(amount: Cents): { stacks: { chip: ChipSpec; count: number }[]; loose: Cents } {
  const stacks: { chip: ChipSpec; count: number }[] = [];
  let left = Math.max(0, Math.floor(amount));
  for (let i = CHIPS.length - 1; i >= 0; i--) {
    const chip = CHIPS[i]!;
    const count = Math.floor(left / chip.value);
    if (count > 0) {
      stacks.push({ chip, count });
      left -= count * chip.value;
    }
  }
  return { stacks, loose: left };
}

/** Table limits for one bet. `step` is the smallest increment a bet must be a multiple of. */
export interface BetLimits {
  min: Cents;
  max: Cents;
  step: Cents;
}

export type BetProblem = 'NOT_CENTS' | 'BELOW_MIN' | 'ABOVE_MAX' | 'OFF_STEP';

/** Why a bet is not allowed under these limits, or null if it is. */
export function checkBet(amount: unknown, limits: BetLimits): BetProblem | null {
  if (!isCents(amount) || amount === 0) return 'NOT_CENTS';
  if (amount < limits.min) return 'BELOW_MIN';
  if (amount > limits.max) return 'ABOVE_MAX';
  if (amount % limits.step !== 0) return 'OFF_STEP';
  return null;
}

/** Buy-in limits for sitting down at a table (or feeding a machine). */
export interface BuyInLimits {
  min: Cents;
  max: Cents;
}

const grouped = new Intl.NumberFormat('en-US');

/** "$1,234", or "$1,234.50" when there are cents. Negative amounts get a leading minus. */
export function formatMoney(amount: Cents, opts: { sign?: boolean } = {}): string {
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / DOLLAR);
  const cents = abs % DOLLAR;
  const body = '$' + grouped.format(whole) + (cents ? '.' + String(cents).padStart(2, '0') : '');
  if (neg) return '−' + body;
  return opts.sign && amount > 0 ? '+' + body : body;
}

/** "$1.2K", "$50K", "$1.5M" for tight spaces; exact below $1,000. */
export function formatCompact(amount: Cents): string {
  const d = amount / DOLLAR;
  const abs = Math.abs(d);
  if (abs < 1000) return formatMoney(amount);
  const sign = d < 0 ? '−' : '';
  if (abs < 1_000_000) return `${sign}$${trim(abs / 1000)}K`;
  return `${sign}$${trim(abs / 1_000_000)}M`;
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Pay `num:den` on a wager, exactly. Callers only get here with wagers in the step that makes
 * the result a whole number of cents; anything else is a bug worth failing loudly on.
 */
export function payOdds(wager: Cents, num: number, den: number): Cents {
  const win = (wager * num) / den;
  if (!Number.isInteger(win)) throw new Error(`payOdds: ${wager} at ${num}:${den} is not a whole number of cents`);
  return win;
}
