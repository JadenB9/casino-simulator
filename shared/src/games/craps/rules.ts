// Craps as this casino deals it (docs/rules/table-games.md §3): every bet's payout, when it is
// working, and what one roll does to it. Pure functions over integer cents, shared by the engine,
// the unit tests and the Monte Carlo runs, so the numbers the tests check are the numbers the
// table pays.

import { type Cents, payOdds } from '../../money.ts';

export type PointNumber = 4 | 5 | 6 | 8 | 9 | 10;
export const POINTS: readonly PointNumber[] = [4, 5, 6, 8, 9, 10];

export function isPoint(n: unknown): n is PointNumber {
  return n === 4 || n === 5 || n === 6 || n === 8 || n === 9 || n === 10;
}

/** A payout `a:b`: net win of `a` for every `b` staked, stake returned on top. */
export type Ratio = readonly [number, number];

/** Taking odds behind pass and come: true odds. */
export const ODDS_PAYS: Record<PointNumber, Ratio> = { 4: [2, 1], 5: [3, 2], 6: [6, 5], 8: [6, 5], 9: [3, 2], 10: [2, 1] };
/** Laying odds behind don't pass and don't come, and lay bets: true odds against. */
export const LAY_PAYS: Record<PointNumber, Ratio> = { 4: [1, 2], 5: [2, 3], 6: [5, 6], 8: [5, 6], 9: [2, 3], 10: [1, 2] };
export const PLACE_PAYS: Record<PointNumber, Ratio> = { 4: [9, 5], 5: [7, 5], 6: [7, 6], 8: [7, 6], 9: [7, 5], 10: [9, 5] };
/** 3-4-5x odds: the most a player may take behind a flat bet, by point. */
export const ODDS_MAX: Record<PointNumber, number> = { 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 };
/** Lay odds may be up to 6x the flat bet on any point. */
export const LAY_ODDS_MAX = 6;
/** Buy bets pay true odds (2:1) and are offered on 4 and 10 only. */
export const BUY_NUMBERS: readonly PointNumber[] = [4, 10];
export const BUY_PAYS: Ratio = [2, 1];
/** 5% commission: on a buy bet's stake when it wins; on a lay bet's possible win, up front. */
export const COMMISSION: Ratio = [1, 20];
export const HARD_PAYS: Record<4 | 6 | 8 | 10, Ratio> = { 4: [7, 1], 6: [9, 1], 8: [9, 1], 10: [7, 1] };
export const FIELD_NUMBERS = [2, 3, 4, 9, 10, 11, 12] as const;
export const FIELD_PAYS: Record<number, Ratio> = { 2: [2, 1], 3: [1, 1], 4: [1, 1], 9: [1, 1], 10: [1, 1], 11: [1, 1], 12: [3, 1] };
export const BIG_PAYS: Ratio = [1, 1];

/** One-roll proposition bets in the middle of the table, by what wins them. */
export const PROPS = {
  any7: { totals: [7], pays: [4, 1] as Ratio },
  anycraps: { totals: [2, 3, 12], pays: [7, 1] as Ratio },
  aces: { totals: [2], pays: [30, 1] as Ratio },
  acedeuce: { totals: [3], pays: [15, 1] as Ratio },
  yo: { totals: [11], pays: [15, 1] as Ratio },
  boxcars: { totals: [12], pays: [30, 1] as Ratio },
} as const;
export type PropKind = keyof typeof PROPS;

export const BET_KINDS = [
  'pass', 'dontpass', 'come', 'dontcome',
  'place', 'buy', 'lay', 'big', 'hard',
  'field', 'any7', 'anycraps', 'aces', 'acedeuce', 'yo', 'boxcars', 'horn', 'ce',
] as const;
export type BetKind = (typeof BET_KINDS)[number];

/** Kinds that sit on a number: the number is part of the bet. */
export const NUMBERED: Partial<Record<BetKind, readonly number[]>> = {
  place: POINTS,
  buy: BUY_NUMBERS,
  lay: POINTS,
  big: [6, 8],
  hard: [4, 6, 8, 10],
};

/**
 * A bet on the layout. `odds` is the odds behind a line or come bet (taken for pass and come,
 * laid for don't pass and don't come). `on` is the player's working call: for place, buy, lay
 * and hardway bets it covers the bet, for a come or don't come bet on a number it covers the
 * odds (the flat bet always works). Undefined means the house default (§3.4).
 */
export interface Bet {
  amount: Cents;
  odds?: Cents;
  on?: boolean;
  /** Lay bets: the commission paid up front (handed back if the bet is taken down). */
  vig?: Cents;
}

/**
 * Where a bet sits. Line and come bets: `pass`, `dontpass`, `come` / `dontcome` (the boxes,
 * waiting for their own come-out roll), `come6` / `dontcome6` (moved to a number). The rest:
 * `place6`, `buy4`, `lay9`, `big8`, `hard10`, `field`, `any7`, `horn`...
 */
export type BetId = string;

const ID_RE = /^(pass|dontpass|come|dontcome|field|any7|anycraps|aces|acedeuce|yo|boxcars|horn|ce)$|^(come|dontcome|place|buy|lay|big|hard)(4|5|6|8|9|10)$/;

export function isBetId(x: unknown): x is BetId {
  if (typeof x !== 'string' || !ID_RE.test(x)) return false;
  const p = parseId(x);
  const nums = p.n === undefined ? undefined : p.kind === 'come' || p.kind === 'dontcome' ? POINTS : NUMBERED[p.kind];
  return p.n === undefined || (nums?.includes(p.n) ?? false);
}

export function betId(kind: BetKind, n?: number): BetId {
  return NUMBERED[kind] ? `${kind}${n}` : kind;
}

/** `come6` -> { kind: 'come', n: 6 }; `field` -> { kind: 'field' }. */
export function parseId(id: BetId): { kind: BetKind; n?: PointNumber } {
  const m = /^(come|dontcome|place|buy|lay|big|hard)(4|5|6|8|9|10)$/.exec(id);
  return m ? { kind: m[1] as BetKind, n: Number(m[2]) as PointNumber } : { kind: id as BetKind };
}

/** A come or don't come bet that has travelled to its number. */
export function isComeOnNumber(id: BetId): boolean {
  return /^(come|dontcome)(4|5|6|8|9|10)$/.test(id);
}

/** Which table limit (TableConfig.limits key) governs a flat bet. */
export function limitKey(kind: BetKind, n?: number): string {
  switch (kind) {
    case 'pass':
    case 'dontpass':
    case 'come':
    case 'dontcome':
      return 'line';
    case 'place':
      return n === 6 || n === 8 ? 'place6' : 'place4';
    case 'lay':
      return n === 4 || n === 10 ? 'lay4' : n === 5 || n === 9 ? 'lay5' : 'lay6';
    case 'any7':
    case 'anycraps':
    case 'aces':
    case 'acedeuce':
    case 'yo':
    case 'boxcars':
      return 'prop';
    default:
      return kind;
  }
}

/** The limit key for odds behind a flat bet on point `n`. Lay odds on 5/9 and 6/8 need $3 and $6 steps. */
export function oddsLimitKey(lay: boolean, n: PointNumber): string {
  if (!lay) return 'odds';
  return n === 4 || n === 10 ? 'layOdds4' : n === 5 || n === 9 ? 'layOdds5' : 'layOdds6';
}

/** The most odds a flat bet may carry. */
export function maxOdds(flatKind: 'pass' | 'dontpass' | 'come' | 'dontcome', flat: Cents, n: PointNumber): Cents {
  return flatKind === 'pass' || flatKind === 'come' ? flat * ODDS_MAX[n] : flat * LAY_ODDS_MAX;
}

/** Lay bets pay 5% of the possible win up front. */
export function layVig(amount: Cents, n: PointNumber): Cents {
  const [a, b] = LAY_PAYS[n];
  return payOdds(payOdds(amount, a, b), COMMISSION[0], COMMISSION[1]);
}

/**
 * Is this bet working on the next roll? The house defaults (§3.4): place and buy bets and the
 * odds on come bets are off on the come-out; lay bets, don't come lay odds, hardways and big 6/8
 * always work; line, come and one-roll bets act on every roll. A player's call (`on`) overrides.
 */
export function isWorking(id: BetId, bet: Bet, point: PointNumber | null): boolean {
  const { kind, n } = parseId(id);
  switch (kind) {
    case 'place':
    case 'buy':
      return bet.on ?? point !== null;
    case 'lay':
    case 'hard':
      return bet.on ?? true;
    case 'come':
      // the flat bet always works; this answers for the odds on a come bet that has moved
      return n === undefined ? true : (bet.on ?? point !== null);
    case 'dontcome':
      return n === undefined ? true : (bet.on ?? true);
    default:
      return true;
  }
}

/** Bets a player may call on or off: the multi-roll ones that aren't contracts. */
export function canToggle(id: BetId): boolean {
  const { kind, n } = parseId(id);
  if (kind === 'place' || kind === 'buy' || kind === 'lay' || kind === 'hard') return true;
  return (kind === 'come' || kind === 'dontcome') && n !== undefined;
}

export type Outcome = 'win' | 'lose' | 'push';

/** What one roll did to one bet. */
export interface Settled {
  /** Chips that go back to the player's stack now (stakes coming down plus winnings). */
  back: Cents;
  /** The stake this roll decided (won, lost or pushed): the round's "wagered". */
  wagered: Cents;
  /** Stake plus winnings on the decided part: the round's "returned". */
  returned: Cents;
  /** Winnings only. */
  win: Cents;
  /** What stays on the layout afterwards; null clears the spot. */
  left: Bet | null;
  flat?: Outcome;
  /** Odds paid, lost, or handed back unpaid because they were off. */
  odds?: Outcome | 'returned';
  /** A come or don't come bet in the box travels to this number. */
  moveTo?: PointNumber;
}

const NONE = (bet: Bet): Settled => ({ back: 0, wagered: 0, returned: 0, win: 0, left: bet });

/** A bet that wins and stays up where it is: only the winnings come back. */
function winStays(bet: Bet, win: Cents): Settled {
  return { back: win, wagered: bet.amount, returned: bet.amount + win, win, left: bet, flat: 'win' };
}

function lose(bet: Bet): Settled {
  return { back: 0, wagered: bet.amount + (bet.odds ?? 0), returned: 0, win: 0, left: null, flat: 'lose', ...(bet.odds ? { odds: 'lose' as const } : {}) };
}

function pay(amount: Cents, r: Ratio): Cents {
  return payOdds(amount, r[0], r[1]);
}

/**
 * Settle one bet against one roll, from the table state before the roll (`point` null = puck
 * OFF, the come-out). Winning bets stay up where casinos leave them (line bets for the next
 * come-out, place/buy/big/hardway/field/prop bets on their spot); come and don't come bets and
 * all odds come back with their winnings; lay bets come down once decided.
 */
export function settle(id: BetId, bet: Bet, point: PointNumber | null, d1: number, d2: number): Settled {
  const t = d1 + d2;
  const { kind, n } = parseId(id);
  const w = bet.amount;
  switch (kind) {
    case 'field': {
      const r = FIELD_PAYS[t];
      return r ? winStays(bet, pay(w, r)) : lose(bet);
    }
    case 'any7':
    case 'anycraps':
    case 'aces':
    case 'acedeuce':
    case 'yo':
    case 'boxcars': {
      const p = PROPS[kind];
      return (p.totals as readonly number[]).includes(t) ? winStays(bet, pay(w, p.pays)) : lose(bet);
    }
    case 'horn': {
      // One unit each on 2, 3, 11 and 12: the winning unit is paid at its own odds, the other
      // three lose (and are replaced out of the win to keep the bet up).
      const u = w / 4;
      if (t === 2 || t === 12) return winStays(bet, pay(u, PROPS.aces.pays) - 3 * u);
      if (t === 3 || t === 11) return winStays(bet, pay(u, PROPS.yo.pays) - 3 * u);
      return lose(bet);
    }
    case 'ce': {
      // Half on any craps (7:1), half on 11 (15:1), settled as the two parts.
      const h = w / 2;
      if (t === 2 || t === 3 || t === 12) return winStays(bet, pay(h, PROPS.anycraps.pays) - h);
      if (t === 11) return winStays(bet, pay(h, PROPS.yo.pays) - h);
      return lose(bet);
    }
    case 'hard': {
      if (!isWorking(id, bet, point)) return NONE(bet);
      if (t === 7) return lose(bet);
      if (t !== n) return NONE(bet);
      return d1 === d2 ? winStays(bet, pay(w, HARD_PAYS[n as 4 | 6 | 8 | 10])) : lose(bet);
    }
    case 'place': {
      if (!isWorking(id, bet, point)) return NONE(bet);
      if (t === 7) return lose(bet);
      return t === n ? winStays(bet, pay(w, PLACE_PAYS[n!])) : NONE(bet);
    }
    case 'buy': {
      if (!isWorking(id, bet, point)) return NONE(bet);
      if (t === 7) return lose(bet);
      return t === n ? winStays(bet, pay(w, BUY_PAYS) - pay(w, COMMISSION)) : NONE(bet);
    }
    case 'big': {
      if (t === 7) return lose(bet);
      return t === n ? winStays(bet, pay(w, BIG_PAYS)) : NONE(bet);
    }
    case 'lay': {
      if (!isWorking(id, bet, point)) return NONE(bet);
      // The commission paid up front is part of what this decision cost.
      const vig = bet.vig ?? 0;
      if (t === 7) {
        const win = pay(w, LAY_PAYS[n!]);
        return { back: w + win, wagered: w + vig, returned: w + win, win, left: null, flat: 'win' };
      }
      return t === n ? { ...lose(bet), wagered: w + vig } : NONE(bet);
    }
    case 'pass':
      return settleLine(bet, point, t, false);
    case 'dontpass':
      return settleLine(bet, point, t, true);
    case 'come':
    case 'dontcome': {
      const dont = kind === 'dontcome';
      if (n === undefined) return settleComeBox(bet, t, dont);
      return settleOnNumber(bet, n, t, dont, isWorking(id, bet, point));
    }
  }
}

/** Pass and don't pass. Their flat bet stays on the line after a win or a bar-12 push. */
function settleLine(bet: Bet, point: PointNumber | null, t: number, dont: boolean): Settled {
  const w = bet.amount;
  if (point === null) {
    const win = dont ? t === 2 || t === 3 : t === 7 || t === 11;
    const loses = dont ? t === 7 || t === 11 : t === 2 || t === 3 || t === 12;
    if (win) return winStays(bet, w);
    if (loses) return lose(bet);
    if (dont && t === 12) return { back: 0, wagered: w, returned: w, win: 0, left: bet, flat: 'push' };
    return NONE(bet); // a point is set; the bet rides on it
  }
  const decided = dont ? t === 7 : t === point;
  const lost = dont ? t === point : t === 7;
  if (lost) return lose(bet);
  if (!decided) return NONE(bet);
  const odds = bet.odds ?? 0;
  const oddsWin = odds ? pay(odds, (dont ? LAY_PAYS : ODDS_PAYS)[point]) : 0;
  return {
    back: w + odds + oddsWin,
    wagered: w + odds,
    returned: 2 * w + odds + oddsWin,
    win: w + oddsWin,
    left: { amount: w },
    flat: 'win',
    ...(odds ? { odds: 'win' as const } : {}),
  };
}

/** A come or don't come bet in its box: this roll is its own come-out. It comes down when decided. */
function settleComeBox(bet: Bet, t: number, dont: boolean): Settled {
  const w = bet.amount;
  const win = dont ? t === 2 || t === 3 : t === 7 || t === 11;
  const loses = dont ? t === 7 || t === 11 : t === 2 || t === 3 || t === 12;
  if (win) return { back: 2 * w, wagered: w, returned: 2 * w, win: w, left: null, flat: 'win' };
  if (loses) return lose(bet);
  if (dont && t === 12) return { back: w, wagered: w, returned: w, win: 0, left: null, flat: 'push' };
  return { ...NONE(bet), moveTo: t as PointNumber };
}

/** A come or don't come bet on its number, with odds that may be off (§3.6 cases 4 and 5). */
function settleOnNumber(bet: Bet, n: PointNumber, t: number, dont: boolean, oddsWork: boolean): Settled {
  const w = bet.amount;
  const odds = bet.odds ?? 0;
  const wins = dont ? t === 7 : t === n;
  const loses = dont ? t === n : t === 7;
  if (!wins && !loses) return NONE(bet);
  if (loses) {
    if (odds && !oddsWork) return { back: odds, wagered: w, returned: 0, win: 0, left: null, flat: 'lose', odds: 'returned' };
    return lose(bet);
  }
  const oddsWin = odds && oddsWork ? pay(odds, (dont ? LAY_PAYS : ODDS_PAYS)[n]) : 0;
  const decidedOdds = oddsWork ? odds : 0;
  return {
    back: 2 * w + odds + oddsWin,
    wagered: w + decidedOdds,
    returned: 2 * w + decidedOdds + oddsWin,
    win: w + oddsWin,
    left: null,
    flat: 'win',
    ...(odds ? { odds: oddsWork ? ('win' as const) : ('returned' as const) } : {}),
  };
}

/** The puck after a roll: set on a point number from the come-out, off when the point is made or on a seven-out. */
export function nextPoint(point: PointNumber | null, total: number): PointNumber | null {
  if (point === null) return isPoint(total) ? total : null;
  return total === point || total === 7 ? null : point;
}

/**
 * The order bets settle in (§3.2 step 2): one-roll bets, then multi-roll bets and come bets on
 * numbers, then come bets in the box, then the line. Also the order the dealers work in.
 */
export function settleRank(id: BetId): number {
  const { kind, n } = parseId(id);
  if (kind === 'field' || kind === 'horn' || kind === 'ce' || kind in PROPS) return 0;
  if (kind === 'pass' || kind === 'dontpass') return 3;
  if ((kind === 'come' || kind === 'dontcome') && n === undefined) return 2;
  return 1;
}

/**
 * Can this bet (or its odds, `part: 'odds'`) come down now? Pass and come flat bets are
 * contracts once they have a point (§3.6 case 2); everything else can be taken down between rolls.
 */
export function isRemovable(id: BetId, point: PointNumber | null, part: 'flat' | 'odds' = 'flat'): boolean {
  if (part === 'odds') return true;
  const { kind, n } = parseId(id);
  if (kind === 'pass') return point === null;
  if (kind === 'come') return n === undefined;
  return true;
}
