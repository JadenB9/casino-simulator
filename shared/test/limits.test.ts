// Table limits (shared/src/limits.ts): the tiers and custom rules per game, the clamp the server
// applies, and the configs they turn into. The Standard tier must be each engine's own config,
// and every other table must keep the Standard table's shape.

import { describe, expect, it } from 'vitest';
import type { GameId, TableConfig } from '../src/engine.ts';
import { ENGINES } from '../src/games/index.ts';
import {
  LIMITS,
  applyLimits,
  clampLimits,
  hasLimitChoice,
  limitsDetail,
  limitsLabel,
  limitsOf,
  limitsParam,
  limitsProblem,
  limitsSpan,
  maxBet,
  parseLimits,
  parseLimitsParam,
  standardLimits,
  type TableLimits,
  holdemStep,
} from '../src/limits.ts';

const D = 100;
const GAMES = Object.keys(LIMITS) as GameId[];

function cfgAt(game: GameId, l: TableLimits, mode: 'solo' | 'multi' = 'multi'): TableConfig {
  return applyLimits(ENGINES[game].config('', mode), l);
}

describe('which games have limits to choose', () => {
  it('every table and online game does; the machines keep their coin values', () => {
    for (const g of ['blackjack', 'roulette', 'craps', 'baccarat', 'threecard', 'holdem', 'war', 'bigsix', 'sicbo', 'banditwheel', 'plinko', 'tower', 'mines', 'dice', 'limbo', 'keno', 'hilo', 'crash'] as GameId[]) {
      expect(hasLimitChoice(g), g).toBe(true);
    }
    expect(hasLimitChoice('slots')).toBe(false);
    expect(hasLimitChoice('videopoker')).toBe(false);
  });
});

describe('the Standard tier is the engine config', () => {
  for (const game of GAMES) {
    it(game, () => {
      for (const mode of ['solo', 'multi'] as const) {
        const cfg = ENGINES[game].config('', mode);
        expect(limitsOf(cfg)).toEqual(standardLimits(game));
        // the same object: nothing is rounded again
        expect(applyLimits(cfg, standardLimits(game)!)).toBe(cfg);
      }
    });
  }
});

describe('every tier', () => {
  for (const game of GAMES) {
    it(`${game}: allowed, kept by the clamp, and a table of the same shape`, () => {
      const spec = LIMITS[game]!;
      const base = ENGINES[game].config('', 'multi');
      expect(spec.tiers.length).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < spec.tiers.length; i++) expect(spec.tiers[i]!.max).toBeGreaterThan(spec.tiers[i - 1]!.max);
      for (const t of spec.tiers) {
        const l = { min: t.min, max: t.max };
        expect(limitsProblem(game, l), `${game} ${limitsLabel(game, l)}`).toBeNull();
        expect(clampLimits(game, l)).toEqual(l);
        const cfg = applyLimits(base, l);
        expect(limitsOf(cfg)).toEqual(l);
        // every bet keeps its key and step, with a sane range on that step
        expect(Object.keys(cfg.limits).sort()).toEqual(Object.keys(base.limits).sort());
        for (const [key, lim] of Object.entries(cfg.limits)) {
          // (Hold'em bets in half dollars at $0.50/$1)
          const step = game === 'holdem' ? holdemStep(l.min, l.max) : base.limits[key]!.step;
          expect(lim.step, key).toBe(step);
          expect(lim.min % step, key).toBe(0);
          // (the Standard config is the engine's as written: craps' lay 5/9 says $10,000 in $3 steps)
          if (cfg !== base) expect(lim.max % step, key).toBe(0);
          expect(lim.min, key).toBeGreaterThanOrEqual(step);
          expect(lim.max, key).toBeGreaterThanOrEqual(lim.min);
        }
        // buy-ins in whole dollars, enough to make the table's smallest bet, and up to a hundred
        // of its biggest (Hold'em: 20 to 250 big blinds)
        expect(cfg.buyIn.min % D).toBe(0);
        expect(cfg.buyIn.max % D).toBe(0);
        expect(cfg.buyIn.max).toBeGreaterThanOrEqual(cfg.buyIn.min);
        if (spec.kind === 'bets') {
          expect(cfg.buyIn.min).toBeGreaterThanOrEqual(l.min);
          expect(cfg.buyIn.max).toBe(100 * l.max);
        } else {
          expect(cfg.buyIn).toEqual({ min: Math.ceil((20 * l.max) / D) * D, max: Math.floor((250 * l.max) / D) * D });
        }
        // the rules and seats are the Standard table's
        expect(cfg.maxSeats).toBe(base.maxSeats);
        expect(cfg.variant).toBe(base.variant);
      }
    });
  }
});

describe('per-spot limits scale with the table', () => {
  it('roulette: inside a tenth of the outside maximum, the spin cap twice it', () => {
    const c = cfgAt('roulette', { min: 25 * D, max: 10_000 * D });
    expect(c.limits.outside).toEqual({ min: 25 * D, max: 10_000 * D, step: D });
    expect(c.limits.inside).toEqual({ min: 5 * D, max: 1_000 * D, step: D });
    expect(c.limits.default).toEqual({ min: 5 * D, max: 20_000 * D, step: D });
    expect(c.buyIn).toEqual({ min: 100 * D, max: 1_000_000 * D });
  });

  it('roulette at $1: the inside minimum stays one whole chip', () => {
    const c = cfgAt('roulette', { min: D, max: 1_000 * D });
    expect(c.limits.inside).toEqual({ min: D, max: 100 * D, step: D });
    expect(c.limits.outside!.min).toBe(D);
  });

  it('craps: odds up to 5x and lay odds 6x the line maximum, so full odds always fit; steps kept', () => {
    const c = cfgAt('craps', { min: 25 * D, max: 10_000 * D });
    expect(c.limits.line).toEqual({ min: 25 * D, max: 10_000 * D, step: D });
    expect(c.limits.odds!.max).toBe(50_000 * D);
    for (const k of ['layOdds4', 'layOdds5', 'layOdds6']) expect(c.limits[k]!.max).toBe(60_000 * D);
    // place bets half the line minimum as at Standard, rounded up to their $6 and $5 steps
    // ($12.50 → $15, $15 → $18); lays and the horn in their steps
    expect(c.limits.place6).toEqual({ min: 18 * D, max: 12_000 * D, step: 6 * D });
    expect(c.limits.place4).toEqual({ min: 15 * D, max: 10_000 * D, step: 5 * D });
    expect(c.limits.lay5!.max % (3 * D)).toBe(0);
    expect(c.limits.horn!.min % (4 * D)).toBe(0);
    expect(c.buyIn).toEqual({ min: 250 * D, max: 1_000_000 * D });
  });

  it('craps at $5: every minimum is at least its step', () => {
    const c = cfgAt('craps', { min: 5 * D, max: 1_000 * D });
    expect(c.limits.place6!.min).toBe(6 * D);
    expect(c.limits.layOdds6!.min).toBe(6 * D);
    expect(c.limits.horn!.min).toBe(4 * D);
    expect(c.limits.ce!.min).toBe(2 * D);
  });

  it('baccarat, Three Card, War: the side bets in proportion', () => {
    const b = cfgAt('baccarat', { min: 100 * D, max: 25_000 * D });
    expect(b.limits.tie).toEqual({ min: 50 * D, max: 5_000 * D, step: D });
    expect(b.limits.pair).toEqual({ min: 50 * D, max: 2_500 * D, step: D });
    const t = cfgAt('threecard', { min: 25 * D, max: 2_500 * D });
    expect(t.limits.ante).toEqual({ min: 25 * D, max: 2_500 * D, step: D });
    expect(t.limits.pairPlus).toEqual({ min: 13 * D, max: 1_250 * D, step: D });
    const w = cfgAt('war', { min: 100 * D, max: 10_000 * D });
    expect(w.limits.bet).toEqual({ min: 100 * D, max: 10_000 * D, step: D });
    expect(w.limits.tie).toEqual({ min: 10 * D, max: 1_000 * D, step: D });
  });

  it('Big Six and Sic Bo: the per-round cap and every class of bet', () => {
    const b = cfgAt('bigsix', { min: 5 * D, max: 1_000 * D });
    expect(b.limits.spot).toEqual({ min: 5 * D, max: 1_000 * D, step: D });
    expect(b.limits.default.max).toBe(5_000 * D);
    const s = cfgAt('sicbo', { min: 25 * D, max: 10_000 * D });
    expect(s.limits.even).toEqual({ min: 25 * D, max: 10_000 * D, step: D });
    expect(s.limits.single).toEqual({ min: 5 * D, max: 2_000 * D, step: D });
    expect(s.limits.prop).toEqual({ min: 5 * D, max: 1_000 * D, step: D });
    expect(s.limits.triple).toEqual({ min: 5 * D, max: 200 * D, step: D });
    expect(s.limits.default.max).toBe(20_000 * D);
  });

  it("Hold'em: the blinds, the big blind as the smallest bet, 20 to 250 big blinds to sit", () => {
    const c = cfgAt('holdem', { min: D, max: 2 * D });
    expect(c.options).toMatchObject({ sb: D, bb: 2 * D });
    expect(c.limits.default.min).toBe(2 * D);
    expect(c.limits.default.step).toBe(D);
    expect(c.buyIn).toEqual({ min: 40 * D, max: 500 * D });
    const high = cfgAt('holdem', { min: 100 * D, max: 200 * D });
    expect(high.buyIn).toEqual({ min: 4_000 * D, max: 50_000 * D });
    // micro: half-dollar bets, a $20 to $250 buy-in
    const micro = cfgAt('holdem', { min: D / 2, max: D });
    expect(micro.options).toMatchObject({ sb: 50, bb: D });
    expect(micro.limits.default).toMatchObject({ min: D, step: 50 });
    expect(micro.buyIn).toEqual({ min: 20 * D, max: 250 * D });
    // the nosebleeds: $100K/$200K, $4M to $50M to sit
    const top = cfgAt('holdem', { min: 100_000 * D, max: 200_000 * D });
    expect(top.buyIn).toEqual({ min: 4_000_000 * D, max: 50_000_000 * D });
    expect(Number.isSafeInteger(top.buyIn.max * 9)).toBe(true);
  });

  it('the online games and the Bandit Wheel: the bet, and the buy-in with it', () => {
    for (const g of ['dice', 'plinko', 'crash', 'banditwheel'] as GameId[]) {
      const c = cfgAt(g, { min: 25 * D, max: 10_000 * D });
      expect(c.limits.default).toEqual({ min: 25 * D, max: 10_000 * D, step: D });
      expect(c.buyIn).toEqual({ min: 250 * D, max: 1_000_000 * D });
    }
  });
});

describe('custom limits', () => {
  it('explains each rule it breaks', () => {
    expect(limitsProblem('blackjack', { min: 50, max: 500_000 })).toMatch(/minimum is \$1 to \$10,000,000,000/);
    expect(limitsProblem('blackjack', { min: 20_000_000_000 * D, max: 200_000_000_000 * D })).toMatch(/minimum is/);
    expect(limitsProblem('blackjack', { min: 25 * D, max: 200 * D })).toBe('The maximum is at least 10 times the minimum ($250).');
    expect(limitsProblem('blackjack', { min: 25 * D, max: 1_500_000 * D })).toBeNull();
    expect(limitsProblem('blackjack', { min: 25 * D, max: 150_000_000_000 * D })).toBe('The maximum here is at most $100,000,000,000.');
    // the high-limit rooms: a $1,000,000 table, and a Big Six spot up to $100,000
    expect(limitsProblem('blackjack', { min: 10_000 * D, max: 1_000_000 * D })).toBeNull();
    expect(limitsProblem('bigsix', { min: 1_000 * D, max: 200_000 * D })).toBeNull();
    expect(limitsProblem('plinko', { min: 1_000 * D, max: 900_000 * D })).toBe('The maximum here is at most $500,000.');
    expect(limitsProblem('blackjack', { min: 25 * D, max: 2_550 })).toMatch(/whole number of dollars/);
    expect(limitsProblem('blackjack', { min: 30 * D, max: 3_000 * D })).toBeNull();
    expect(limitsProblem('slots', { min: D, max: 10 * D })).not.toBeNull();
  });

  it("Hold'em: any blinds from $0.50/$1 to $100,000/$300,000, the big blind two to three times the small", () => {
    expect(limitsProblem('holdem', { min: 2 * D, max: 5 * D })).toBeNull();
    expect(limitsProblem('holdem', { min: 1 * D, max: 3 * D })).toBeNull();
    expect(limitsProblem('holdem', { min: 50, max: D })).toBeNull();
    expect(limitsProblem('holdem', { min: 5_000 * D, max: 10_000 * D })).toBeNull();
    expect(limitsProblem('holdem', { min: 25_000 * D, max: 50_000 * D })).toBeNull();
    expect(limitsProblem('holdem', { min: 100_000 * D, max: 300_000 * D })).toBeNull();
    expect(limitsProblem('holdem', { min: 777 * D, max: 2_000 * D })).toBeNull();
    expect(limitsProblem('holdem', { min: 5 * D, max: 5 * D })).toMatch(/at least twice/);
    expect(limitsProblem('holdem', { min: 10 * D, max: 40 * D })).toMatch(/at most three times/);
    expect(limitsProblem('holdem', { min: 50, max: 150 })).toMatch(/whole number of dollars/);
    expect(limitsProblem('holdem', { min: 25, max: 50 })).toBe('The small blind is $0.50, or whole dollars up to $100,000.');
    expect(limitsProblem('holdem', { min: 150, max: 300 })).toBe('The small blind is $0.50, or whole dollars up to $100,000.');
    expect(limitsProblem('holdem', { min: 200_000 * D, max: 400_000 * D })).toMatch(/small blind is/);
  });

  it('the clamp brings anything to the nearest allowed table', () => {
    expect(clampLimits('blackjack', { min: 1, max: 1 })).toEqual({ min: D, max: 10 * D });
    // (v7.1: a custom table goes to $100 billion a bet)
    expect(clampLimits('blackjack', { min: 9_999_999_999, max: 9_999_999_999 })).toEqual({ min: 99_999_999 * D, max: 999_999_990 * D });
    expect(clampLimits('blackjack', { min: 1e15, max: 1e15 })).toEqual({ min: 10_000_000_000 * D, max: 100_000_000_000 * D });
    expect(clampLimits('blackjack', { min: 2_550, max: 500_099 })).toEqual({ min: 25 * D, max: 5_000 * D });
    expect(clampLimits('blackjack', { min: 25 * D, max: 100 * D })).toEqual({ min: 25 * D, max: 250 * D });
    expect(clampLimits('holdem', { min: 10 * D, max: 500 * D })).toEqual({ min: 10 * D, max: 30 * D });
    expect(clampLimits('holdem', { min: 1, max: 1 })).toEqual({ min: 50, max: D });
    expect(clampLimits('holdem', { min: 99, max: 250 })).toEqual({ min: 50, max: D });
    expect(clampLimits('holdem', { min: 1e12, max: 1e12 })).toEqual({ min: 100_000 * D, max: 300_000 * D });
    expect(clampLimits('slots', { min: D, max: 10 * D })).toBeNull();
    // whatever it gives back is allowed
    for (const game of GAMES) {
      for (const l of [{ min: 1, max: 1 }, { min: 777_77, max: 3 }, { min: 1e12, max: 1e12 }, { min: 12_345, max: 6_789_012 }]) {
        expect(limitsProblem(game, clampLimits(game, l)!), `${game} ${JSON.stringify(l)}`).toBeNull();
      }
    }
  });

  it('a custom table scales like a tier', () => {
    const c = cfgAt('roulette', { min: 10 * D, max: 2_000 * D });
    expect(c.limits.inside).toEqual({ min: 2 * D, max: 200 * D, step: D });
    expect(c.limits.default.max).toBe(4_000 * D);
  });
});

describe('parsing', () => {
  it('shape only: two positive whole numbers of cents', () => {
    expect(parseLimits({ min: 500, max: 50_000 })).toEqual({ min: 500, max: 50_000 });
    expect(parseLimits({ min: 0, max: 50_000 })).toBeNull();
    expect(parseLimits({ min: 1.5, max: 50_000 })).toBeNull();
    expect(parseLimits({ min: '500', max: 50_000 })).toBeNull();
    expect(parseLimits(null)).toBeNull();
    expect(parseLimits([500, 50_000])).toBeNull();
  });

  it('the socket parameter', () => {
    expect(parseLimitsParam(limitsParam({ min: 2_500, max: 500_000 }))).toEqual({ min: 2_500, max: 500_000 });
    expect(parseLimitsParam('25-5000x')).toBeNull();
    expect(parseLimitsParam('-5-5000')).toBeNull();
    expect(parseLimitsParam('99999999999999999-1')).toBeNull();
    expect(parseLimitsParam('9007199254740993-1')).toBeNull();
    expect(parseLimitsParam(null)).toBeNull();
    // the top of every game's custom limits reaches a solo table (v7.1 took them to $100 billion)
    for (const game of GAMES) {
      const spec = LIMITS[game]!;
      const top = { min: spec.min.high, max: spec.max.ceiling };
      expect(parseLimitsParam(limitsParam(top)), game).toEqual(top);
    }
  });
});

describe('words', () => {
  it('labels and spans', () => {
    expect(limitsLabel('blackjack', { min: 25 * D, max: 5_000 * D })).toBe('$25–$5,000');
    expect(limitsLabel('blackjack', { min: 1_000 * D, max: 50_000 * D }, true)).toBe('$1K–$50K');
    expect(limitsLabel('holdem', { min: D, max: 2 * D })).toBe('$1/$2');
    expect(limitsSpan('blackjack')).toBe('$5–$500,000');
    expect(limitsSpan('holdem')).toBe('$0.50/$1 to $100K/$200K');
    expect(limitsSpan('slots')).toBeNull();
  });

  it('the details a picker shows', () => {
    expect(limitsDetail(cfgAt('roulette', { min: 25 * D, max: 10_000 * D }))).toEqual(['Inside $5–$1,000 a number', '$20,000 a spin', 'Buy-in $100–$1,000,000']);
    expect(limitsDetail(ENGINES.blackjack.config('', 'solo'))).toEqual(['Buy-in $100–$500,000']);
  });
});

describe('maxBet', () => {
  const lim = { min: 25 * D, max: 5_000 * D, step: D };
  it('the spot maximum or the stack, whichever is less', () => {
    expect(maxBet({ limits: lim, current: 0, stack: 100_000 * D })).toEqual({ amount: 5_000 * D });
    expect(maxBet({ limits: lim, current: 0, stack: 1_234 * D })).toEqual({ amount: 1_234 * D });
    expect(maxBet({ limits: lim, current: 4_000 * D, stack: 100_000 * D })).toEqual({ amount: 1_000 * D });
  });
  it('a per-round cap, the step, and why nothing fits', () => {
    expect(maxBet({ limits: lim, current: 0, stack: 100_000 * D, room: 300 * D })).toEqual({ amount: 300 * D });
    expect(maxBet({ limits: { min: 6 * D, max: 6_000 * D, step: 6 * D }, current: 0, stack: 100 * D })).toEqual({ amount: 96 * D });
    expect(maxBet({ limits: lim, current: 5_000 * D, stack: 100 * D })).toEqual({ none: 'AT_MAX' });
    expect(maxBet({ limits: lim, current: 0, stack: 24 * D })).toEqual({ none: 'SHORT' });
    expect(maxBet({ limits: lim, current: 0, stack: 100 * D, room: 0 })).toEqual({ none: 'AT_MAX' });
    // adding to a spot already over the minimum only needs chips
    expect(maxBet({ limits: lim, current: 30 * D, stack: 5 * D })).toEqual({ amount: 5 * D });
  });
});
