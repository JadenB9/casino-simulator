// Let It Ride and Pai Gow Poker at the table: which hands are celebrated (never a return at or
// below what was risked), and Max, played against the engines: what it puts down is accepted and
// a dollar more is refused.

import { describe, expect, it } from 'vitest';
import type { Card } from '../../shared/src/cards.ts';
import { isRefusal } from '../../shared/src/engine.ts';
import { applyLimits, maxBet } from '../../shared/src/limits.ts';
import { engine as letitride } from '../../shared/src/games/letitride/engine.ts';
import { DEFAULT_PAYTABLE, settle as lirSettle } from '../../shared/src/games/letitride/rules.ts';
import { engine as paigow } from '../../shared/src/games/paigow/engine.ts';
import { DEFAULT_FORTUNE, houseWay, settle as pgSettle, type PgCard } from '../../shared/src/games/paigow/rules.ts';
import { handMoment as lirMoment } from '../src/games/letitride/moments.ts';
import { handMoment as pgMoment } from '../src/games/paigow/moments.ts';
import { unitMax } from '../src/games/letitride/max.ts';
import { TableSim } from '../../shared/test/helpers/table-sim.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';

const cards = (s: string) => s.split(' ').map((c) => (c.length === 3 ? `T${c[2]}` : c)) as Card[];
const pg = (s: string) => s.split(' ').map((c) => (c.length === 3 ? `T${c[2]}` : c)) as PgCard[];
const D = 100;

describe('let it ride celebrations', () => {
  const moment = (five: string, pulled: [boolean, boolean], bonus = 0) => {
    const c = cards(five);
    return lirMoment(lirSettle(1_000, pulled, bonus, c, DEFAULT_PAYTABLE), c, DEFAULT_PAYTABLE);
  };
  it('three of a kind and up on the bets, by what it is', () => {
    expect(moment('7s 7h 7d Kc 2s', [false, false])).toEqual({ title: 'Three Sevens', sub: '3 to 1 on all three · +$90', tier: 'nice' });
    expect(moment('7s 7h 7d Kc Ks', [true, true])).toEqual({ title: 'Sevens full of Kings', sub: '11 to 1 on one bet · +$110', tier: 'big' });
    expect(moment('As Ks Qs Js 10s', [true, false])?.tier).toBe('huge');
  });
  it('a big 3-Card Bonus on its own', () => {
    expect(moment('As Ks Qs 4d 2c', [true, true], 500)).toEqual({ title: 'Mini royal', sub: 'Bonus 50 to 1 · +$240', tier: 'huge' });
    expect(moment('4s 4h 4d 9d 2c', [true, true], 500)?.tier).toBe('big');
  });
  it('never for a pair or two pair, nor for a hand that gives back no more than it risked', () => {
    expect(moment('Ks Kh 4d 3c 2s', [false, false])).toBeNull();
    expect(moment('Ks Kh 4d 4c 2s', [false, false])).toBeNull();
    // a bonus pair paid, the bets lost: behind overall
    expect(moment('2s 2h 9d 5c Js', [false, false], 500)).toBeNull();
  });
});

describe('pai gow celebrations', () => {
  const moment = (seven: string, bet: number, fortune: number, against = 'Kh Kc 8d 7s 5d 4h 3c') => {
    const c = pg(seven);
    const s = houseWay(c);
    return pgMoment(pgSettle({ bet, fortune }, s, houseWay(pg(against)), c, DEFAULT_FORTUNE), s, DEFAULT_FORTUNE);
  };
  it('a Fortune of three of a kind and up, by the line', () => {
    expect(moment('8s 8h 8c 8d Ah 9s 2c', 1_000, 500)?.tier).toBe('big');
    expect(moment('As Ks Qs Js 10s 2d 9c', 1_000, 500)).toMatchObject({ title: 'Royal flush', tier: 'huge' });
  });
  it('both hands won with four of a kind behind', () => {
    expect(moment('8s 8h 8c 8d Kh 9s 2c', 1_000, 0)).toEqual({ title: 'Four Eights', sub: 'Both hands win · +$9.50', tier: 'big' });
  });
  it('never a plain win, a straight on the Fortune, or anything that gives back no more than it risked', () => {
    expect(moment('As Ah Kd Qc 9h 5s 2c', 1_000, 0)).toBeNull();
    expect(moment('9s 10h Jc Qd Kh 3s 3c', 1_000, 500)).toBeNull();
    // the Fortune paid 3 to 1, the bet lost to four kings: behind
    expect(moment('2s 2h 2c 5d 7h 9s Jc', 10_000, 500, 'Ks Kh Kc Kd Ah Qs 3c')).toBeNull();
  });
});

describe('Max at Let It Ride and Pai Gow', () => {
  const L = { min: 25 * D, max: 2_500 * D };
  it('Let It Ride: each of the three bets to its maximum, or a third of the stack', () => {
    for (const stack of [20_000 * D, 901 * D]) {
      const cfg = applyLimits(letitride.config('', 'solo'), L);
      const sim = new TableSim(letitride, seededRng(3), 'solo', [{ seat: 0, stack }], cfg);
      const m = unitMax(cfg.limits.bet!, 0, stack);
      if ('none' in m) throw new Error('no max');
      expect(m.amount).toBe(stack > 10_000 * D ? 2_500 * D : 300 * D);
      const refuse = (unit: number) => {
        const r = letitride.act(sim.state, 0, letitride.parseAction({ type: 'bet', unit, bonus: 0 })!, sim.ctx());
        return isRefusal(r);
      };
      expect(refuse(m.amount + D)).toBe(true);
      expect(refuse(m.amount)).toBe(false);
    }
  });
  it('Pai Gow: the bet, then the Fortune with what is left', () => {
    const cfg = applyLimits(paigow.config('', 'solo'), L);
    const sim = new TableSim(paigow, seededRng(3), 'solo', [{ seat: 0, stack: 2_600 * D }], cfg);
    const bet = maxBet({ limits: cfg.limits.bet!, current: 0, stack: sim.stack(0) });
    expect(bet).toEqual({ amount: 2_500 * D });
    sim.act(0, { type: 'bet', bet: 2_500 * D, fortune: 0 });
    const fortune = maxBet({ limits: cfg.limits.fortune!, current: 0, stack: sim.stack(0) });
    expect(fortune).toEqual({ amount: 100 * D });
    expect(isRefusal(paigow.act(sim.state, 0, { type: 'bet', bet: 2_500 * D, fortune: 101 * D }, sim.ctx()))).toBe(true);
    sim.act(0, { type: 'bet', bet: 2_500 * D, fortune: 100 * D });
  });
});
