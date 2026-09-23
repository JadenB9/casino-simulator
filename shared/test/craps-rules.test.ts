import { describe, it, expect } from 'vitest';
import {
  settle, nextPoint, isWorking, layVig, isRemovable, parseId, isBetId, POINTS, ODDS_MAX, LAY_ODDS_MAX,
  type Bet, type BetId, type PointNumber,
} from '../src/games/craps/rules.ts';

// Every bet against every roll in every puck state, checked against an oracle written straight
// from the tables in docs/rules/table-games.md §3.3-3.6 (not from rules.ts), plus exact house
// edges by enumerating the dice.

const W = 6000; // $60: divisible by every step, so every payout below is exact
const STATES: (PointNumber | null)[] = [null, ...POINTS];
const DICE: [number, number][] = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) DICE.push([a, b]);

type Want = { decided: false; move?: number } | { decided: true; net: number; stays: boolean; oddsBack?: number };

const none: Want = { decided: false };
const win = (net: number, stays: boolean): Want => ({ decided: true, net, stays });
const lose = (net = -W): Want => ({ decided: true, net, stays: false });

const TRUE_ODDS: Record<number, number> = { 4: 2, 5: 1.5, 6: 1.2, 8: 1.2, 9: 1.5, 10: 2 };
const PLACE: Record<number, number> = { 4: 9 / 5, 5: 7 / 5, 6: 7 / 6, 8: 7 / 6, 9: 7 / 5, 10: 9 / 5 };

/** What the doc says happens to `id` (flat W, odds `odds`) on (d1, d2) with the puck at `point`. */
function oracle(id: BetId, point: PointNumber | null, d1: number, d2: number, odds = 0, on?: boolean): Want {
  const t = d1 + d2;
  const pair = d1 === d2;
  const { kind, n } = parseId(id);
  switch (kind) {
    case 'field':
      return t === 2 ? win(2 * W, true) : t === 12 ? win(3 * W, true) : [3, 4, 9, 10, 11].includes(t) ? win(W, true) : lose();
    case 'any7':
      return t === 7 ? win(4 * W, true) : lose();
    case 'anycraps':
      return [2, 3, 12].includes(t) ? win(7 * W, true) : lose();
    case 'aces':
      return t === 2 ? win(30 * W, true) : lose();
    case 'boxcars':
      return t === 12 ? win(30 * W, true) : lose();
    case 'acedeuce':
      return t === 3 ? win(15 * W, true) : lose();
    case 'yo':
      return t === 11 ? win(15 * W, true) : lose();
    case 'horn': // 1 unit each on 2, 3, 11, 12; the other three units lose
      return t === 2 || t === 12 ? win((30 * W) / 4 - (3 * W) / 4, true) : t === 3 || t === 11 ? win((15 * W) / 4 - (3 * W) / 4, true) : lose();
    case 'ce': // same as 3:1 on craps and 7:1 on 11, per total bet
      return [2, 3, 12].includes(t) ? win(3 * W, true) : t === 11 ? win(7 * W, true) : lose();
    case 'hard': {
      if (!(on ?? true)) return none; // on during the come-out in Las Vegas
      if (t === 7) return lose();
      if (t !== n) return none;
      return pair ? win((n === 4 || n === 10 ? 7 : 9) * W, true) : lose();
    }
    case 'place':
      if (!(on ?? point !== null)) return none;
      return t === n ? win(PLACE[n!]! * W, true) : t === 7 ? lose() : none;
    case 'buy': // 2:1, less 5% of the bet only when it wins
      if (!(on ?? point !== null)) return none;
      return t === n ? win(2 * W - W / 20, true) : t === 7 ? lose() : none;
    case 'big':
      return t === n ? win(W, true) : t === 7 ? lose() : none;
    case 'lay': { // true odds against, 5% of the possible win paid up front
      if (!(on ?? true)) return none;
      const possible = W / TRUE_ODDS[n!]!;
      const vig = possible / 20;
      return t === 7 ? { decided: true, net: possible - vig, stays: false } : t === n ? lose(-W - vig) : none;
    }
    case 'pass':
    case 'dontpass': {
      const dont = kind === 'dontpass';
      if (point === null) {
        if (dont) return t === 2 || t === 3 ? win(W, true) : t === 12 ? { decided: true, net: 0, stays: true } : t === 7 || t === 11 ? lose() : none;
        return t === 7 || t === 11 ? win(W, true) : [2, 3, 12].includes(t) ? lose() : none;
      }
      const oddsWin = dont ? odds / TRUE_ODDS[point]! : odds * TRUE_ODDS[point]!;
      if (t === (dont ? 7 : point)) return { decided: true, net: W + oddsWin, stays: true };
      if (t === (dont ? point : 7)) return lose(-W - odds);
      return none;
    }
    case 'come':
    case 'dontcome': {
      const dont = kind === 'dontcome';
      if (n === undefined) {
        if (dont) return t === 2 || t === 3 ? win(W, false) : t === 12 ? { decided: true, net: 0, stays: false } : t === 7 || t === 11 ? lose() : { decided: false, move: t };
        return t === 7 || t === 11 ? win(W, false) : [2, 3, 12].includes(t) ? lose() : { decided: false, move: t };
      }
      // come odds are off on the come-out; don't come lay odds are on (§3.4)
      const oddsOn = on ?? (dont ? true : point !== null);
      const oddsWin = dont ? odds / TRUE_ODDS[n]! : odds * TRUE_ODDS[n]!;
      if (t === (dont ? 7 : n)) return oddsOn ? { decided: true, net: W + oddsWin, stays: false } : { decided: true, net: W, stays: false, oddsBack: odds };
      if (t === (dont ? n : 7)) return oddsOn ? lose(-W - odds) : { decided: true, net: -W, stays: false, oddsBack: odds };
      return none;
    }
  }
  throw new Error(`no oracle for ${id}`);
}

const SIMPLE: BetId[] = [
  'field', 'any7', 'anycraps', 'aces', 'acedeuce', 'yo', 'boxcars', 'horn', 'ce',
  'hard4', 'hard6', 'hard8', 'hard10', 'place4', 'place5', 'place6', 'place8', 'place9', 'place10',
  'buy4', 'buy10', 'big6', 'big8', 'lay4', 'lay5', 'lay6', 'lay8', 'lay9', 'lay10',
  'pass', 'dontpass', 'come', 'dontcome',
];

function betFor(id: BetId, point: PointNumber | null, odds: number, on?: boolean): Bet {
  const bet: Bet = { amount: W };
  if (odds) bet.odds = odds;
  if (on !== undefined) bet.on = on;
  const { kind, n } = parseId(id);
  if (kind === 'lay') bet.vig = layVig(W, n!);
  void point;
  return bet;
}

function check(id: BetId, point: PointNumber | null, odds = 0, on?: boolean): void {
  for (const [d1, d2] of DICE) {
    const bet = betFor(id, point, odds, on);
    const got = settle(id, bet, point, d1, d2);
    const want = oracle(id, point, d1, d2, odds, on);
    const where = `${id} odds=${odds} on=${on} point=${point} roll ${d1}-${d2}`;
    if (!want.decided) {
      expect(got.wagered, where).toBe(0);
      expect(got.back, where).toBe(0);
      if (want.move !== undefined) expect(got.moveTo, where).toBe(want.move);
      else expect(got.left, where).toEqual(bet);
      continue;
    }
    // every payout is a whole number of cents
    for (const x of [got.back, got.wagered, got.returned, got.win]) expect(Number.isInteger(x), where).toBe(true);
    expect(got.returned - got.wagered, where).toBeCloseTo(want.net, 6);
    expect(got.left !== null, where).toBe(want.stays);
    // what physically comes back: winnings if the bet stays up, else stake, winnings and any unpaid odds
    const expectBack = want.net < 0 && !want.oddsBack ? 0 : want.stays ? got.returned - W : got.returned + (want.oddsBack ?? 0);
    if (want.net === 0 && want.stays) expect(got.back, where).toBe(0);
    else expect(got.back, where).toBe(expectBack);
    if (want.oddsBack) expect(got.odds, where).toBe('returned');
  }
}

describe('craps rules: every bet, every roll, every puck state', () => {
  for (const id of SIMPLE) {
    it(id, () => {
      for (const p of STATES) check(id, p);
    });
  }

  it('pass and don\'t pass with full odds on every point', () => {
    for (const p of POINTS) {
      check('pass', p, W * ODDS_MAX[p]);
      check('dontpass', p, W * LAY_ODDS_MAX);
    }
  });

  it('come and don\'t come bets on every number, odds working or off, in every state', () => {
    for (const n of POINTS) {
      for (const p of STATES) {
        for (const on of [undefined, true, false]) {
          check(`come${n}`, p, W * ODDS_MAX[n], on);
          check(`dontcome${n}`, p, W * LAY_ODDS_MAX, on);
          check(`come${n}`, p, 0, on);
        }
      }
    }
  });

  it('place, buy, lay and hardway bets called on or off', () => {
    for (const id of ['place4', 'place6', 'place9', 'buy4', 'buy10', 'hard6', 'hard10', 'lay5', 'lay8']) {
      for (const p of STATES) for (const on of [true, false]) check(id, p, 0, on);
    }
  });

  it('the puck: on from the come-out, off on the point or a seven', () => {
    for (const p of STATES) {
      for (let t = 2; t <= 12; t++) {
        const want = p === null ? ([4, 5, 6, 8, 9, 10].includes(t) ? t : null) : t === p || t === 7 ? null : p;
        expect(nextPoint(p, t), `point ${p} roll ${t}`).toBe(want);
      }
    }
  });

  it('working defaults on the come-out and with a point (§3.4)', () => {
    const b = { amount: W };
    expect(isWorking('place6', b, null)).toBe(false);
    expect(isWorking('place6', b, 8)).toBe(true);
    expect(isWorking('buy4', b, null)).toBe(false);
    expect(isWorking('lay4', b, null)).toBe(true);
    expect(isWorking('hard8', b, null)).toBe(true);
    expect(isWorking('come6', b, null)).toBe(false); // the odds
    expect(isWorking('come6', b, 5)).toBe(true);
    expect(isWorking('dontcome6', b, null)).toBe(true);
    expect(isWorking('big6', b, null)).toBe(true);
    expect(isWorking('place6', { amount: W, on: true }, null)).toBe(true);
    expect(isWorking('hard8', { amount: W, on: false }, 6)).toBe(false);
  });

  it('contract bets: pass and come stay up once they have a point (§3.6.2)', () => {
    expect(isRemovable('pass', null)).toBe(true);
    expect(isRemovable('pass', 6)).toBe(false);
    expect(isRemovable('pass', 6, 'odds')).toBe(true);
    expect(isRemovable('come', 6)).toBe(true); // still in the box
    expect(isRemovable('come8', 6)).toBe(false);
    expect(isRemovable('dontpass', 6)).toBe(true);
    expect(isRemovable('dontcome8', 6)).toBe(true);
    for (const id of ['place6', 'buy4', 'hard8', 'field', 'big6', 'horn']) expect(isRemovable(id, 6)).toBe(true);
  });

  it('bet ids', () => {
    for (const id of [...SIMPLE, 'come4', 'dontcome10']) expect(isBetId(id), id).toBe(true);
    for (const id of ['buy5', 'big5', 'hard5', 'place7', 'come', 'lay11', 'field2', 'pass4', '', 'hard']) expect(isBetId(id), id).toBe(id === 'come');
  });

  it('bet steps from the doc give exact cents at their smallest size', () => {
    // place 6/8 $6 -> $7; lay 4/10 $2 -> win $1, vig 5c; lay 5/9 $3 -> $2, 10c; lay 6/8 $6 -> $5, 25c
    expect(settle('place6', { amount: 600 }, 6, 3, 3).win).toBe(700);
    expect(settle('place4', { amount: 500 }, 6, 1, 3).win).toBe(900);
    expect(settle('place5', { amount: 500 }, 6, 1, 4).win).toBe(700);
    expect(layVig(200, 4)).toBe(5);
    expect(layVig(300, 9)).toBe(10);
    expect(layVig(600, 8)).toBe(25);
    expect(settle('buy10', { amount: 100 }, 6, 4, 6).win).toBe(195);
    expect(settle('horn', { amount: 400 }, null, 1, 1).win).toBe(2700);
    expect(settle('ce', { amount: 200 }, null, 5, 6).win).toBe(1400);
    expect(settle('pass', { amount: 100, odds: 100 }, 5, 1, 4).win).toBe(250);
    expect(settle('pass', { amount: 100, odds: 100 }, 8, 2, 6).win).toBe(220);
    expect(settle('dontpass', { amount: 100, odds: 300 }, 9, 3, 4).win).toBe(300);
    expect(settle('dontpass', { amount: 100, odds: 600 }, 6, 3, 4).win).toBe(600);
    expect(settle('dontpass', { amount: 100, odds: 100 }, 10, 3, 4).win).toBe(150);
  });
});

// ---------------------------------------------------------------------------------------------
// Exact house edges: roll every outcome, follow the bet until it is decided (per bet resolved,
// pushes counted), in exact rational arithmetic.

class Q {
  constructor(readonly n: bigint, readonly d: bigint) {
    if (d < 0n) {
      this.n = -n;
      this.d = -d;
    }
    const g = gcd(this.n < 0n ? -this.n : this.n, this.d);
    if (g > 1n) {
      this.n /= g;
      this.d /= g;
    }
  }
  static of(n: number, d = 1): Q {
    return new Q(BigInt(n), BigInt(d));
  }
  add(o: Q): Q {
    return new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  mul(o: Q): Q {
    return new Q(this.n * o.n, this.d * o.d);
  }
  div(o: Q): Q {
    return new Q(this.n * o.d, this.d * o.n);
  }
  eq(o: Q): boolean {
    return this.n === o.n && this.d === o.d;
  }
  toString(): string {
    return `${this.n}/${this.d}`;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Expected net per unit of the flat bet until `id` is decided. `withOdds` adds full odds as soon
 * as a line or come bet gets its point. Rolls that leave the bet alone don't count.
 */
function exactEV(id: BetId, point: PointNumber | null, withOdds = false, bet: Bet = { amount: W }): Q {
  let sum = Q.of(0);
  let idle = 0;
  const { kind } = parseId(id);
  for (const [d1, d2] of DICE) {
    const r = settle(id, bet, point, d1, d2);
    const t = d1 + d2;
    if (r.wagered > 0) sum = sum.add(Q.of(r.returned - r.wagered, W * 36));
    else if (r.moveTo !== undefined) {
      const to = `${kind}${r.moveTo}`;
      const odds = withOdds ? W * (kind === 'come' ? ODDS_MAX[r.moveTo] : LAY_ODDS_MAX) : 0;
      sum = sum.add(exactEV(to, 6, false, odds ? { amount: W, odds } : { amount: W }).div(Q.of(36)));
    } else if ((id === 'pass' || id === 'dontpass') && point === null && nextPoint(null, t) !== null) {
      const p = t as PointNumber;
      const odds = withOdds ? W * (id === 'pass' ? ODDS_MAX[p] : LAY_ODDS_MAX) : 0;
      sum = sum.add(exactEV(id, p, false, odds ? { amount: W, odds } : { amount: W }).div(Q.of(36)));
    } else idle++;
  }
  return sum.div(Q.of(36 - idle, 36));
}

describe('craps exact edges by enumeration (per bet resolved)', () => {
  const cases: [string, BetId, PointNumber | null, Q][] = [
    ['pass 1.414%', 'pass', null, Q.of(-7, 495)],
    ["don't pass 1.364%", 'dontpass', null, Q.of(-3, 220)],
    ['come 1.414%', 'come', 6, Q.of(-7, 495)],
    ["don't come 1.364%", 'dontcome', 6, Q.of(-3, 220)],
    ['place 6 1.515%', 'place6', 6, Q.of(-1, 66)],
    ['place 8 1.515%', 'place8', 6, Q.of(-1, 66)],
    ['place 5 4.000%', 'place5', 6, Q.of(-1, 25)],
    ['place 9 4.000%', 'place9', 6, Q.of(-1, 25)],
    ['place 4 6.667%', 'place4', 6, Q.of(-1, 15)],
    ['place 10 6.667%', 'place10', 6, Q.of(-1, 15)],
    ['buy 4, commission on a win, 1.667%', 'buy4', 6, Q.of(-1, 60)],
    ['buy 10, commission on a win, 1.667%', 'buy10', 6, Q.of(-1, 60)],
    ['big 6 9.091%', 'big6', null, Q.of(-1, 11)],
    ['big 8 9.091%', 'big8', 6, Q.of(-1, 11)],
    ['field 2.778%', 'field', null, Q.of(-1, 36)],
    ['hard 4 11.111%', 'hard4', 6, Q.of(-1, 9)],
    ['hard 10 11.111%', 'hard10', null, Q.of(-1, 9)],
    ['hard 6 9.091%', 'hard6', 6, Q.of(-1, 11)],
    ['hard 8 9.091%', 'hard8', 5, Q.of(-1, 11)],
    ['any 7 16.667%', 'any7', null, Q.of(-1, 6)],
    ['any craps 11.111%', 'anycraps', 6, Q.of(-1, 9)],
    ['aces 13.889%', 'aces', null, Q.of(-5, 36)],
    ['boxcars 13.889%', 'boxcars', 8, Q.of(-5, 36)],
    ['ace-deuce 11.111%', 'acedeuce', null, Q.of(-1, 9)],
    ['yo 11.111%', 'yo', 4, Q.of(-1, 9)],
    ['horn 12.5%', 'horn', null, Q.of(-1, 8)],
    ['C & E 11.111%', 'ce', 9, Q.of(-1, 9)],
  ];
  for (const [label, id, point, want] of cases) {
    it(label, () => {
      const got = exactEV(id, point);
      expect(got.toString(), label).toBe(want.toString());
    });
  }

  it('lay bets, commission up front: 2.439%, 3.226%, 4.000% of lay plus commission', () => {
    for (const [n, want] of [[4, Q.of(-1, 41)], [10, Q.of(-1, 41)], [5, Q.of(-1, 31)], [9, Q.of(-1, 31)], [6, Q.of(-1, 25)], [8, Q.of(-1, 25)]] as const) {
      const vig = layVig(W, n);
      const perLay = exactEV(`lay${n}`, 6, false, { amount: W, vig });
      // per unit of (lay + commission), the doc's convention for this bet
      const got = perLay.mul(Q.of(W, W + vig));
      expect(got.toString(), `lay ${n}`).toBe(want.toString());
    }
  });

  it('free odds add nothing: pass and don\'t pass with full odds keep 1.414% and 1.364% per flat unit', () => {
    expect(exactEV('pass', null, true).toString()).toBe(Q.of(-7, 495).toString());
    expect(exactEV('dontpass', null, true).toString()).toBe(Q.of(-3, 220).toString());
    expect(exactEV('come', 6, true).toString()).toBe(Q.of(-7, 495).toString());
    expect(exactEV('dontcome', 6, true).toString()).toBe(Q.of(-3, 220).toString());
  });

  it('odds alone are a fair bet on every point (0%)', () => {
    for (const p of POINTS) {
      const withOdds = exactEV('pass', p, false, { amount: W, odds: W * ODDS_MAX[p] });
      const flat = exactEV('pass', p, false, { amount: W });
      expect(withOdds.eq(flat), `take odds on ${p}`).toBe(true);
      const layed = exactEV('dontpass', p, false, { amount: W, odds: W * LAY_ODDS_MAX });
      const dflat = exactEV('dontpass', p, false, { amount: W });
      expect(layed.eq(dflat), `lay odds on ${p}`).toBe(true);
    }
  });
});
