// The bank's rules, shared so the teller's screen and the server agree to the cent.
//
// The cashier's top-up: below $10,000 in all (the balance, every chip on every table with bets
// out, everything in the bank, and what you sent other players in the last three days), the
// cashier tops a player up to $50,000. The difference is a loan: free, never repaid, recorded and
// counted on the profile. There's no limit on how often; being under the line is the rule.
//
// v6 bank6: the private bank behind the cage. Checking is the balance. Savings pays simple
// interest by the millisecond, paid at each midnight UTC, on up to $1,000,000. Term deposits lock
// money for an hour, a day or a week at a rate fixed when opened. The Casino Index is a fund whose
// price takes a step every five minutes, the same for everyone, drifting slightly up with real
// swings. Transfers send money to another player, within limits that keep the house's own money
// (the starting stake, top-ups, bonuses) from being passed between accounts.
//
// Nothing here can be farmed by timing: interest is exact (a cent's fractions are carried, never
// rounded up), so splitting a span into many requests pays exactly what one request would; it is
// only paid at fixed midnights, so how often you look can't compound it; and the fund's next step
// is decided by the server from a secret, so nobody can know it before it happens.

import { DOLLAR, LOAN_AMOUNT, formatMoney, type Cents } from './money.ts';

/** Under this much in all, the bank tops a player up... */
export const REFILL_BELOW: Cents = 10_000 * DOLLAR;
/** ...to this much. */
export const REFILL_TO: Cents = LOAN_AMOUNT;

/** What the bank adds for a player who has `total` in all: the gap to REFILL_TO, or nothing. */
export function refillFor(total: Cents): Cents {
  return total < REFILL_BELOW ? REFILL_TO - Math.max(0, total) : 0;
}

/** The cashier's answer to someone at or over the line, with the numbers it counted. */
export function notYet(total: Cents, onTables: Cents, inBank: Cents = 0): string {
  const parts = [onTables > 0 ? `${formatMoney(onTables)} of it in chips on tables` : '', inBank > 0 ? `${formatMoney(inBank)} in the bank` : ''].filter(Boolean);
  const part = parts.length ? `, ${parts.join(' and ')}` : '';
  return `You have ${formatMoney(total)} in all${part}. The bank tops you up when that is under ${formatMoney(REFILL_BELOW)}.`;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------------------------
// Savings

/** Interest per day in basis points (1/100 of a percent) on each slice of the savings balance. */
export const SAVINGS_TIERS: readonly { upTo: Cents; bp: number }[] = [
  { upTo: 100_000 * DOLLAR, bp: 50 }, // 0.5% a day on the first $100,000
  { upTo: 1_000_000 * DOLLAR, bp: 10 }, // 0.1% a day on the next $900,000; nothing above $1,000,000
];

/** Most a savings account can earn in a day: $500 + $900. */
export const SAVINGS_MAX_DAY: Cents = 1_400 * DOLLAR;

/** Interest is counted in 1/INTEREST_DEN of a cent: basis points times milliseconds in a day. */
export const INTEREST_DEN = 10_000 * DAY_MS;
const DEN = BigInt(INTEREST_DEN);

/** A balance's interest weight, in cent-basis-points per day: each tier's slice times its rate. */
export function interestWeight(balance: Cents): number {
  let w = 0;
  let from = 0;
  for (const t of SAVINGS_TIERS) {
    if (balance <= from) break;
    w += (Math.min(balance, t.upTo) - from) * t.bp;
    from = t.upTo;
  }
  return w;
}

export interface SavingsState {
  /** Paid in, and interest paid (cents). */
  balance: Cents;
  /** Whole cents earned since the last midnight UTC, paid at the next one. */
  accrued: Cents;
  /** And the fraction of a cent beyond them, in 1/INTEREST_DEN. */
  frac: number;
  /** Counted up to here (unix ms). */
  since: number;
}

/** A day's interest, paid at the midnight that ends it; `day` is its UTC day number (ms / DAY_MS). */
export interface InterestPayment {
  day: number;
  amount: Cents;
}

/**
 * Savings brought up to `now`: the interest earned since `since` added to what the day has
 * earned, and each midnight passed pays its day into the balance. Exact: a span counted in two
 * pieces comes out the same as counted once, to the fraction of a cent, so there's nothing to
 * gain by asking often. `now` before `since` (another server's clock) changes nothing.
 */
export function accrue(s: SavingsState, now: number): { state: SavingsState; paid: InterestPayment[] } {
  const paid: InterestPayment[] = [];
  if (now <= s.since) return { state: s, paid };
  let { balance, accrued, frac } = s;
  let t = s.since;
  while (t < now) {
    const day = Math.floor(t / DAY_MS);
    const end = (day + 1) * DAY_MS;
    const upTo = Math.min(now, end);
    const q = BigInt(interestWeight(balance)) * BigInt(upTo - t) + BigInt(frac);
    accrued += Number(q / DEN);
    frac = Number(q % DEN);
    t = upTo;
    if (t === end) {
      if (accrued > 0) {
        paid.push({ day, amount: accrued });
        balance += accrued;
      }
      accrued = 0;
    }
  }
  return { state: { balance, accrued, frac, since: now }, paid };
}

/** When the interest being earned now is paid: the next midnight UTC. */
export function nextPayday(now: number): number {
  return (Math.floor(now / DAY_MS) + 1) * DAY_MS;
}

// ---------------------------------------------------------------------------------------------
// Term deposits

export type TermId = '1h' | '24h' | '7d';

export interface Term {
  id: TermId;
  label: string;
  ms: number;
  /** Interest for the whole term, in parts per million of the principal. */
  ppm: number;
}

export const TERMS: readonly Term[] = [
  { id: '1h', label: '1 hour', ms: HOUR_MS, ppm: 150 }, // 0.015%
  { id: '24h', label: '24 hours', ms: DAY_MS, ppm: 4_000 }, // 0.4%
  { id: '7d', label: '7 days', ms: 7 * DAY_MS, ppm: 35_000 }, // 3.5%
];

export function termOf(id: unknown): Term | null {
  return TERMS.find((t) => t.id === id) ?? null;
}

/** Smallest deposit. */
export const DEPOSIT_MIN: Cents = 100 * DOLLAR;
/** Most principal locked at once, across every open deposit. */
export const DEPOSIT_CAP: Cents = 1_000_000 * DOLLAR;
/** Most deposits open at once. */
export const DEPOSIT_MAX_OPEN = 5;
/** Breaking a deposit before it matures: no interest, and this much of the principal (0.5%). */
export const EARLY_FEE_PPM = 5_000;

/** What a deposit pays at maturity, fixed when it opens (rounded down to the cent). */
export function depositInterest(principal: Cents, term: Term): Cents {
  return Math.floor((principal * term.ppm) / 1_000_000);
}

/** The fee for breaking a deposit early (rounded down to the cent). */
export function earlyFee(principal: Cents): Cents {
  return Math.floor((principal * EARLY_FEE_PPM) / 1_000_000);
}

/** What closing a deposit pays back now: principal and interest once matured, else principal less the fee. */
export function depositPayout(d: { principal: Cents; interest: Cents; maturesAt: number }, now: number): { paid: Cents; gain: Cents; matured: boolean } {
  if (now >= d.maturesAt) return { paid: d.principal + d.interest, gain: d.interest, matured: true };
  const fee = earlyFee(d.principal);
  return { paid: d.principal - fee, gain: -fee, matured: false };
}

// ---------------------------------------------------------------------------------------------
// The Casino Index

export const FUND_ID = 'csx';
export const FUND_NAME = 'Casino Index';
/** The price takes one step every five minutes (a step is unix ms / FUND_STEP_MS). */
export const FUND_STEP_MS = 5 * 60_000;
export const STEPS_PER_DAY = DAY_MS / FUND_STEP_MS;
/** Prices are integer ten-thousandths of a dollar ("ticks"). */
export const TICKS_PER_DOLLAR = 10_000;
/** Where the price starts the first time the market is opened: $100.00. */
export const FUND_START: number = 100 * TICKS_PER_DOLLAR;
/** Units are held in millionths. */
export const UNIT = 1_000_000;
/** Expected growth about +0.1% a day, with about 2% a day of swing either way. */
export const FUND_DAY_DRIFT = 0.001;
export const FUND_DAY_VOL = 0.02;
/** Per step: the log-return's spread, and its centre (so a step's expected growth is the drift's share). */
export const FUND_SIGMA = FUND_DAY_VOL / Math.sqrt(STEPS_PER_DAY);
export const FUND_MU = Math.log(1 + FUND_DAY_DRIFT) / STEPS_PER_DAY - (FUND_SIGMA * FUND_SIGMA) / 2;
/** A step's shock is held within this many standard deviations. */
export const FUND_Z_MAX = 4;
/** Smallest buy. */
export const FUND_MIN: Cents = 1 * DOLLAR;
/** Most one account may have in the fund, at cost. */
export const FUND_CAP: Cents = 10_000_000 * DOLLAR;

export function stepOf(ms: number): number {
  return Math.floor(ms / FUND_STEP_MS);
}

/**
 * The next step's price from this one and two uniform numbers in [0, 1) (the server draws them
 * from its secret; see server/src/market.ts): a normal shock by Box-Muller, held to FUND_Z_MAX,
 * then price x exp(mu + sigma z), rounded to the tick and never below one tick.
 */
export function nextPrice(price: number, u1: number, u2: number): number {
  const z = Math.max(-FUND_Z_MAX, Math.min(FUND_Z_MAX, Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2)));
  return Math.max(1, Math.round(price * Math.exp(FUND_MU + FUND_SIGMA * z)));
}

/** Cents times this over a price in ticks is units in millionths. */
const SCALE = BigInt(UNIT * (TICKS_PER_DOLLAR / DOLLAR));

/** Units (millionths) that `cents` buys at `price`, rounded down. */
export function unitsFor(cents: Cents, price: number): number {
  return Number((BigInt(cents) * SCALE) / BigInt(price));
}

/** What `units` (millionths) are worth at `price`, rounded down to the cent. */
export function valueOf(units: number, price: number): Cents {
  return Number((BigInt(units) * BigInt(price)) / SCALE);
}

/** The cost that goes with selling `units` of a holding: in proportion, and all of it with the last unit. */
export function costOf(sold: number, held: { units: number; cost: Cents }): Cents {
  if (sold >= held.units) return held.cost;
  return Number((BigInt(held.cost) * BigInt(sold)) / BigInt(held.units));
}

/** "$104.2517" */
export function formatPrice(ticks: number): string {
  const whole = Math.floor(ticks / TICKS_PER_DOLLAR);
  return `$${whole.toLocaleString('en-US')}.${String(ticks % TICKS_PER_DOLLAR).padStart(4, '0')}`;
}

/** "12.345678" units */
export function formatUnits(units: number): string {
  const whole = Math.floor(units / UNIT);
  const rest = String(units % UNIT).padStart(6, '0').replace(/0+$/, '');
  return whole.toLocaleString('en-US') + (rest ? `.${rest}` : '');
}

// ---------------------------------------------------------------------------------------------
// Transfers

export const SEND = {
  /** Smallest transfer. */
  min: 1 * DOLLAR,
  /** At or over this, the sender confirms (the server refuses an unconfirmed one). */
  confirmAt: 10_000 * DOLLAR,
  /** A new account waits this long before it can send. */
  newAccountMs: DAY_MS,
  /** Money from the house (the starting stake, top-ups, bonuses, tips, gift boxes, feat cash) can't be sent for this long. */
  houseHoldMs: 3 * DAY_MS,
  /** Money from other players can't be passed on for this long. */
  giftHoldMs: DAY_MS,
  /** Most one account may send in any 24 hours. */
  dayCap: 250_000 * DOLLAR,
  /** Most one account may send any one other account in any 24 hours. */
  pairCap: 100_000 * DOLLAR,
  /** What you sent in this long still counts toward the cashier's top-up line. */
  refillCountsMs: 3 * DAY_MS,
  /** A note is at most this many characters. */
  noteMax: 80,
} as const;

/** What can be sent now: the balance less money held back, within what's left of the day's cap. */
export function sendable(balance: Cents, held: Cents, sentToday: Cents): Cents {
  return Math.max(0, Math.min(balance - held, SEND.dayCap - sentToday));
}

// ---------------------------------------------------------------------------------------------
// HTTP (GET /bank, /bank/market, /bank/statement; POST /bank/savings, /bank/deposit,
// /bank/deposit/close, /bank/fund, /bank/send, /bank/seen)

export interface SavingsView extends SavingsState {
  /** Interest paid in all. */
  earned: Cents;
}

export interface DepositView {
  id: string;
  term: TermId;
  principal: Cents;
  interest: Cents;
  openedAt: number;
  maturesAt: number;
  closedAt?: number;
  paid?: Cents;
}

export interface FundView {
  id: string;
  name: string;
  /** The price now (ticks), and the step it's for. */
  price: number;
  step: number;
  /** The price a day ago (the first step's, if the market is younger). */
  dayAgo: number;
  units: number;
  cost: Cents;
  /** Units at today's price. */
  value: Cents;
}

export interface SendRules {
  /** What a transfer can be right now. */
  sendable: Cents;
  /** House money and gifts held back from the balance. */
  held: Cents;
  /** Sent in the last 24 hours. */
  sentToday: Cents;
  /** Until when a new account waits to send (0 if it doesn't). */
  newUntil: number;
  /** Locked up (law6): no sending from jail. */
  jailed: boolean;
}

/** Money another player sent you. */
export interface Received {
  id: string;
  from: string;
  amount: Cents;
  note: string | null;
  at: number;
}

export interface BankState {
  /** Server time these figures are for. */
  now: number;
  balance: Cents;
  inPlay: Cents;
  rev: number;
  /** Savings, open deposits and the fund at cost (casino_accounts.banked). */
  banked: Cents;
  savings: SavingsView;
  /** Open deposits, then any closed in the last day, newest first. */
  deposits: DepositView[];
  fund: FundView;
  send: SendRules;
  /** Transfers received since you last looked. */
  inbox: Received[];
  /** Balance, chips on tables, savings, deposits and the fund at today's price. */
  worth: Cents;
  /** What the bank has made or taken in all (SUM of casino_bank.gain): interest, the fund, transfers in less out. */
  gain: Cents;
}

/** Every POST answers with the bank as it now stands. */
export interface BankResponse {
  state: BankState;
}

export interface MarketResponse {
  fund: string;
  name: string;
  /** [step, price] from oldest to newest, the newest being now. */
  points: [number, number][];
}

export type StatementSource = 'ledger' | 'item' | 'order' | 'bank';

export interface StatementLine {
  id: string;
  at: number;
  src: StatementSource;
  /** The ledger's or the bank's kind; 'item' / 'bar' / 'fx' for purchases. */
  kind: string;
  /** Change to the balance (checking). */
  cash: Cents;
  /** Change to the bank's side: savings, a deposit, or the fund at cost. */
  banked: Cents;
  units?: number;
  gain?: Cents;
  /** A table, an item, a deposit term, a fund price, an interest day... */
  ref?: string | null;
  /** The other player of a transfer. */
  peer?: string | null;
  note?: string | null;
  /** The balance after this line. */
  balance: Cents;
}

export interface StatementResponse {
  lines: StatementLine[];
  /** Pass back as `before` for the page after this one. */
  next: string | null;
}

/** A transfer's note as it's kept: one line, no invisible characters, SEND.noteMax at most; empty is none. */
export function cleanNote(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > SEND.noteMax * 4) return undefined;
  const out = raw
    .normalize('NFC')
    .replace(/[\s\u0085]/gu, ' ')
    .replace(/[\p{Cc}\p{Cs}­؜᠎​‎‏‪-‮⁠-⁤⁦-⁯￹-￻]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (out === '') return null;
  return [...out].length <= SEND.noteMax ? out : undefined;
}
