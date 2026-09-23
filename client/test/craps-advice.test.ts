import { describe, it, expect } from 'vitest';
import { settle, nextPoint, layVig, parseId, POINTS, ODDS_MAX, LAY_ODDS_MAX, type Bet, type PointNumber } from '../../shared/src/games/craps/rules.ts';
import {
  edgeOf, edgeLine, spotEdge, crapsAdvice, crapsMoment,
  TAKE_ODDS, LAY_ODDS, BEST_COME_OUT, BEST_POINT, type Decided,
} from '../src/games/craps/advice.ts';

// The house edges Tips quotes, rolled out against the table's own settle(): every outcome of the
// dice, following the bet until it is decided, per bet resolved (pushes count), as the enumeration
// in shared/test/craps-rules.test.ts does in exact arithmetic.

const W = 6000;
const DICE: [number, number][] = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) DICE.push([a, b]);

function ev(id: string, point: PointNumber | null, bet: Bet = { amount: W }, withOdds = false): number {
  let sum = 0;
  let idle = 0;
  const { kind } = parseId(id);
  for (const [d1, d2] of DICE) {
    const r = settle(id, bet, point, d1, d2);
    const t = d1 + d2;
    if (r.wagered > 0) sum += (r.returned - r.wagered) / W / 36;
    else if (r.moveTo !== undefined) {
      const odds = withOdds ? W * (kind === 'come' ? ODDS_MAX[r.moveTo] : LAY_ODDS_MAX) : 0;
      sum += ev(`${kind}${r.moveTo}`, 6, odds ? { amount: W, odds } : { amount: W }) / 36;
    } else if ((id === 'pass' || id === 'dontpass') && point === null && nextPoint(null, t) !== null) {
      const p = t as PointNumber;
      const odds = withOdds ? W * (id === 'pass' ? ODDS_MAX[p] : LAY_ODDS_MAX) : 0;
      sum += ev(id, p, odds ? { amount: W, odds } : { amount: W }) / 36;
    } else idle++;
  }
  return sum / ((36 - idle) / 36);
}

const frac = (id: string) => {
  const e = edgeOf(id)!;
  return e[0] / e[1];
};

describe('craps Tips: house edges match the table', () => {
  const ids: [string, PointNumber | null][] = [
    ['pass', null], ['dontpass', null], ['come', 6], ['dontcome', 6], ['field', null], ['big6', null], ['big8', 6],
    ['any7', null], ['anycraps', 6], ['aces', null], ['boxcars', 8], ['acedeuce', null], ['yo', 4], ['horn', null], ['ce', 9],
    ...POINTS.map((n) => [`place${n}`, 6] as [string, PointNumber]),
    ['buy4', 6], ['buy10', 6],
    ...([4, 6, 8, 10] as const).map((n) => [`hard${n}`, 5] as [string, PointNumber]),
  ];
  for (const [id, point] of ids) {
    it(`${id}: ${edgeLine(edgeOf(id)!)}`, () => {
      expect(-ev(id, point)).toBeCloseTo(frac(id), 12);
    });
  }

  it('lay bets, per unit of lay plus the commission', () => {
    for (const n of POINTS) {
      const vig = layVig(W, n);
      expect(-ev(`lay${n}`, 6, { amount: W, vig }) * (W / (W + vig))).toBeCloseTo(frac(`lay${n}`), 12);
    }
  });

  it('odds are free: full odds leave the line bets at their own edge', () => {
    expect(-ev('pass', null, { amount: W }, true)).toBeCloseTo(frac('pass'), 12);
    expect(-ev('dontpass', null, { amount: W }, true)).toBeCloseTo(frac('dontpass'), 12);
  });

  it('prints the numbers the rules doc publishes', () => {
    expect(edgeLine(edgeOf('pass')!)).toBe('House edge 1.414% (7/495)');
    expect(edgeLine(edgeOf('dontcome5')!)).toBe('House edge 1.364% (3/220)');
    expect(edgeLine(edgeOf('place8')!)).toBe('House edge 1.515% (1/66)');
    expect(edgeLine(edgeOf('any7')!)).toBe('House edge 16.667% (1/6)');
    expect(edgeLine(edgeOf('horn')!)).toBe('House edge 12.500% (1/8)');
    expect(edgeLine(edgeOf('lay4')!)).toBe('House edge 2.439% (1/41)');
  });
});

describe('craps Tips: what a click on a spot would bet', () => {
  it('the box is a place bet, or odds over a come bet', () => {
    expect(spotEdge('box6', {}, 5, false)).toEqual([1, 66]);
    expect(spotEdge('box6', { come6: { amount: 500 } }, 5, false)).toEqual([0, 1]);
  });
  it('the line with a point and a bet on it takes odds', () => {
    expect(spotEdge('pass', {}, null, false)).toEqual([7, 495]);
    expect(spotEdge('pass', { pass: { amount: 500 } }, 8, false)).toEqual([0, 1]);
    expect(spotEdge('dontpass', { dontpass: { amount: 500 } }, 8, false)).toEqual([0, 1]);
    expect(spotEdge('passodds', {}, 8, false)).toEqual([0, 1]);
  });
  it("the don't come strip lays odds, or is a lay bet only when lays are on", () => {
    expect(spotEdge('dc9', { dontcome9: { amount: 500 } }, 4, false)).toEqual([0, 1]);
    expect(spotEdge('dc9', {}, 4, false)).toBeNull();
    expect(spotEdge('dc9', {}, 4, true)).toEqual([1, 31]);
  });
  it('props and the field', () => {
    expect(spotEdge('yo', {}, null, false)).toEqual([1, 9]);
    expect(spotEdge('field', {}, 6, false)).toEqual([1, 36]);
    expect(spotEdge('hard10', {}, 6, false)).toEqual([1, 9]);
  });
});

describe('craps Tips: the advice line', () => {
  const step = () => 100;
  it('come-out with nothing down: the best bets, ringing the pass line', () => {
    expect(crapsAdvice(null, {}, step)).toEqual({ text: BEST_COME_OUT, pick: 'pass' });
    expect(crapsAdvice(null, { pass: { amount: 1000 } }, step)).toEqual({ text: BEST_COME_OUT, pick: null });
  });
  it('a line bet with a point: take odds, until they are full', () => {
    expect(crapsAdvice(6, { pass: { amount: 1000 } }, step)).toEqual({ text: TAKE_ODDS, pick: 'passodds' });
    expect(crapsAdvice(6, { pass: { amount: 1000, odds: 2000 } }, step).pick).toBe('passodds');
    expect(crapsAdvice(6, { pass: { amount: 1000, odds: 5000 } }, step)).toEqual({ text: BEST_POINT, pick: null });
    expect(crapsAdvice(4, { dontpass: { amount: 1000 } }, step)).toEqual({ text: LAY_ODDS, pick: 'dontpass' });
    expect(crapsAdvice(4, { dontpass: { amount: 1000, odds: 6000 } }, step).text).toBe(BEST_POINT);
  });
  it('come bets on a number take odds on their box', () => {
    expect(crapsAdvice(4, { pass: { amount: 500, odds: 1500 }, come9: { amount: 500 } }, step)).toEqual({ text: TAKE_ODDS, pick: 'box9' });
    expect(crapsAdvice(4, { dontcome5: { amount: 600 } }, step)).toEqual({ text: LAY_ODDS, pick: 'dc5' });
  });
  it('room smaller than the odds step does not count', () => {
    expect(crapsAdvice(6, { pass: { amount: 1000, odds: 4950 } }, () => 100).text).toBe(BEST_POINT);
  });
  it('the line is short enough for one line above the controls', () => {
    for (const t of [TAKE_ODDS, LAY_ODDS, BEST_COME_OUT, BEST_POINT]) expect(t.length).toBeLessThanOrEqual(96);
  });
});

describe('craps celebrations', () => {
  const d = (id: string, flat: string, win: number, bet: Bet, odds?: string): Decided => ({ id, flat, win, bet, ...(odds ? { odds } : {}) });
  it('point made with full odds is big, with single odds nice', () => {
    expect(crapsMoment([d('pass', 'win', 7000, { amount: 1000, odds: 5000 }, 'win')], 6, 7000)).toMatchObject({ tier: 'big', title: 'Point made · Six', sub: 'Pass line and odds · +$70' });
    expect(crapsMoment([d('pass', 'win', 2200, { amount: 1000, odds: 1000 }, 'win')], 8, 2200)).toMatchObject({ tier: 'nice' });
    expect(crapsMoment([d('come9', 'win', 7000, { amount: 1000, odds: 4000 }, 'win')], 9, 7000)).toMatchObject({ tier: 'big', sub: 'Come 9 and odds · +$70' });
  });
  it('a point made without odds, or a come-out winner, is not a moment', () => {
    expect(crapsMoment([d('pass', 'win', 1000, { amount: 1000 })], 6, 1000)).toBeNull();
    expect(crapsMoment([d('pass', 'win', 1000, { amount: 1000 })], 7, 1000)).toBeNull();
  });
  it('hardways and the high props are big', () => {
    expect(crapsMoment([d('hard8', 'win', 4500, { amount: 500 })], 8, 4500)).toMatchObject({ tier: 'big', title: 'Hard eight', sub: 'Pays 9 to 1 · +$45' });
    expect(crapsMoment([d('yo', 'win', 1500, { amount: 100 })], 11, 1500)).toMatchObject({ tier: 'big', title: 'Yo-leven', sub: 'Pays 15 to 1 · +$15' });
    expect(crapsMoment([d('horn', 'win', 2700, { amount: 400 })], 12, 2700)).toMatchObject({ tier: 'big', title: 'Boxcars', sub: 'On the horn · +$27' });
    expect(crapsMoment([d('any7', 'win', 400, { amount: 100 })], 7, 400)).toBeNull();
    expect(crapsMoment([d('field', 'win', 300, { amount: 100 })], 12, 300)).toBeNull();
  });
  it('never when the roll gave back no more than it took', () => {
    expect(crapsMoment([d('hard6', 'win', 900, { amount: 100 })], 6, 0)).toBeNull();
    expect(crapsMoment([d('hard6', 'win', 900, { amount: 100 })], 6, -100)).toBeNull();
  });
  it('the bigger moment wins when one roll makes two', () => {
    const m = crapsMoment([d('pass', 'win', 2200, { amount: 1000, odds: 1000 }, 'win'), d('hard8', 'win', 4500, { amount: 500 })], 8, 6700);
    expect(m).toMatchObject({ id: 'hard8', tier: 'big' });
  });
});
