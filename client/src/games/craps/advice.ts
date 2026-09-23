// What Tips says at the craps table, and which rolls earn a celebration. The house edges are the
// exact per-bet-resolved figures of docs/rules/table-games.md §3.3; client/test/craps-advice.test.ts
// checks every one of them against the table's own settle() by rolling out all 36 outcomes.
// Pure data and functions, so the tests can run them without a table.

import { type Bet, type PointNumber, POINTS, HARD_PAYS, PROPS, maxOdds, parseId } from '../../../../shared/src/games/craps/rules.ts';
import { numberWord } from '../../../../shared/src/games/craps/calls.ts';
import { formatMoney } from '../../../../shared/src/money.ts';

/** A house edge as an exact fraction of each bet resolved: [numerator, denominator]. */
export type Edge = readonly [number, number];

const ODDS: Edge = [0, 1];

/** House edge by bet id (the ids of rules.ts: 'pass', 'place6', 'hard8', 'come5'...). */
export function edgeOf(id: string): Edge | null {
  const { kind, n } = parseId(id);
  switch (kind) {
    case 'pass':
    case 'come':
      return [7, 495];
    case 'dontpass':
    case 'dontcome':
      return [3, 220];
    case 'place':
      return n === 6 || n === 8 ? [1, 66] : n === 5 || n === 9 ? [1, 25] : [1, 15];
    case 'buy':
      return [1, 60];
    case 'lay':
      // per unit of lay plus the commission paid up front, as the rules doc quotes it
      return n === 4 || n === 10 ? [1, 41] : n === 5 || n === 9 ? [1, 31] : [1, 25];
    case 'big':
      return [1, 11];
    case 'hard':
      return n === 4 || n === 10 ? [1, 9] : [1, 11];
    case 'field':
      return [1, 36];
    case 'any7':
      return [1, 6];
    case 'anycraps':
    case 'acedeuce':
    case 'yo':
    case 'ce':
      return [1, 9];
    case 'aces':
    case 'boxcars':
      return [5, 36];
    case 'horn':
      return [1, 8];
  }
  return null;
}

/** 1.515 for [1, 66]: the percentage, to `digits` places. */
export function edgePercent(e: Edge, digits = 3): string {
  return ((e[0] / e[1]) * 100).toFixed(digits);
}

/** The hover card's line: "House edge 1.515% (1/66)", or the free odds. */
export function edgeLine(e: Edge): string {
  return e[0] === 0 ? 'No house edge: pays true odds' : `House edge ${edgePercent(e)}% (${e[0]}/${e[1]})`;
}

/**
 * The edge of what a click on a felt spot would put down (the view's place() decides the same
 * way): the box over a come bet takes odds, the pass line with a point on takes odds, and so on.
 */
export function spotEdge(spot: string, mine: Record<string, Bet>, point: PointNumber | null, layOn: boolean): Edge | null {
  const m = /^(box|dc|buy|big|hard)(\d+)$/.exec(spot);
  if (m) {
    const n = m[2];
    if (m[1] === 'box') return mine[`come${n}`] ? ODDS : edgeOf(`place${n}`);
    if (m[1] === 'dc') return mine[`dontcome${n}`] ? ODDS : layOn ? edgeOf(`lay${n}`) : null;
    return edgeOf(`${m[1]}${n}`);
  }
  if (spot === 'passodds') return ODDS;
  if ((spot === 'pass' || spot === 'dontpass') && point !== null && mine[spot]) return ODDS;
  return edgeOf(spot);
}

// ---------------------------------------------------------------------------------------------
// The Tips line

export const TAKE_ODDS = 'Take odds: the only bet with no house edge';
export const LAY_ODDS = 'Lay odds: the only bet with no house edge';
export const BEST_COME_OUT = "Best bets: pass or don't pass with full odds; place 6 or 8 at 1.52%. The props are the worst.";
export const BEST_POINT = "Best bets: come or don't come with full odds; place 6 or 8 at 1.52%. The props are the worst.";

export interface Advice {
  text: string;
  /** The felt spot to ring: 'pass', 'box6'... (null: nothing in particular). */
  pick: string | null;
}

/**
 * The advice for this moment. A line or come bet with a point and room for more odds gets the
 * odds nudge (on the spot a click adds them); otherwise the best bets. `step` is the table's odds
 * step for a point, so a few cents of room that no chip can fill doesn't count.
 */
export function crapsAdvice(point: PointNumber | null, mine: Record<string, Bet>, step: (lay: boolean, n: PointNumber) => number): Advice {
  const room = (id: string, flatKind: 'pass' | 'dontpass' | 'come' | 'dontcome', n: PointNumber) => {
    const b = mine[id];
    if (!b) return false;
    const left = maxOdds(flatKind, b.amount, n) - (b.odds ?? 0);
    const s = step(flatKind === 'dontpass' || flatKind === 'dontcome', n);
    return Math.floor(left / s) * s > 0;
  };
  if (point !== null) {
    // a click on the line itself takes the odds (the strip behind it hides under the rail)
    if (room('pass', 'pass', point)) return { text: TAKE_ODDS, pick: 'pass' };
    if (room('dontpass', 'dontpass', point)) return { text: LAY_ODDS, pick: 'dontpass' };
  }
  for (const n of POINTS) {
    if (room(`come${n}`, 'come', n)) return { text: TAKE_ODDS, pick: `box${n}` };
    if (room(`dontcome${n}`, 'dontcome', n)) return { text: LAY_ODDS, pick: `dc${n}` };
  }
  if (point === null) return { text: BEST_COME_OUT, pick: mine.pass || mine.dontpass ? null : 'pass' };
  return { text: BEST_POINT, pick: null };
}

// ---------------------------------------------------------------------------------------------
// Celebrations

export type Tier = 'nice' | 'big' | 'huge';

/** One decided bet of this player's, as the roll's result event and the bet before it describe it. */
export interface Decided {
  id: string;
  flat: string;
  odds?: string;
  /** Net winnings on the bet (flat and odds together). */
  win: number;
  bet: Bet;
}

export interface CrapsMoment {
  id: string;
  tier: Tier;
  title: string;
  sub: string;
}

/** A win with full odds behind it pays at least this many flat bets (7x at 3-4-5x); single odds 2.2-3x. */
const BIG_POINT = 5;
/** Props this high up the paytable count as a big hit: 2, 3, 11, 12 and the horn. */
const HIGH_PROPS = new Set(['aces', 'acedeuce', 'yo', 'boxcars', 'horn']);
const PROP_NAMES: Record<number, string> = { 2: 'Aces', 3: 'Ace-deuce', 11: 'Yo-leven', 12: 'Boxcars' };
const TIER_RANK: Record<Tier, number> = { nice: 0, big: 1, huge: 2 };

const ratio = (r: readonly [number, number]) => `${r[0]} to ${r[1]}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The roll's moment for this player, if it has one: a point made with odds behind it (nice, or
 * big with full odds), a hardway, or a 2, 3, 11, 12 or horn hit (big). `net` is what the whole
 * roll did for the player; a roll that gave back no more than it took is never celebrated.
 */
export function crapsMoment(decided: Decided[], total: number, net: number): CrapsMoment | null {
  const money = (c: number) => formatMoney(c, { sign: true });
  if (net <= 0) return null;
  let best: (CrapsMoment & { win: number }) | null = null;
  for (const d of decided) {
    if (d.flat !== 'win' || d.win <= 0) continue;
    const { kind, n } = parseId(d.id);
    let m: CrapsMoment | null = null;
    if ((kind === 'pass' || (kind === 'come' && n !== undefined)) && d.odds === 'win' && (d.bet.odds ?? 0) > 0 && (n === undefined || n === total)) {
      const tier: Tier = d.win >= BIG_POINT * d.bet.amount ? 'big' : 'nice';
      const what = kind === 'pass' ? 'Pass line and odds' : `Come ${n} and odds`;
      m = { id: d.id, tier, title: `Point made · ${cap(numberWord(total))}`, sub: `${what} · ${money(d.win)}` };
    } else if (kind === 'hard' && n !== undefined) {
      m = { id: d.id, tier: 'big', title: `Hard ${numberWord(n)}`, sub: `Pays ${ratio(HARD_PAYS[n as 4 | 6 | 8 | 10])} · ${money(d.win)}` };
    } else if (HIGH_PROPS.has(kind) && PROP_NAMES[total]) {
      const pays = kind === 'horn' ? 'On the horn' : `Pays ${ratio(PROPS[kind as keyof typeof PROPS].pays)}`;
      m = { id: d.id, tier: 'big', title: PROP_NAMES[total]!, sub: `${pays} · ${money(d.win)}` };
    }
    if (m && (!best || TIER_RANK[m.tier] > TIER_RANK[best.tier] || (m.tier === best.tier && d.win > best.win))) best = { ...m, win: d.win };
  }
  if (!best) return null;
  const { win: _w, ...moment } = best;
  return moment;
}
