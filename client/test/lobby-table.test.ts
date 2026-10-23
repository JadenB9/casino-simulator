// Sitting down without the DOM (ui/lobby/table-model.ts): the stakes the list's chips offer, custom
// limits at a High Limit Salon table, and the buy-in prompt's quick amounts, slider and checks.

import { describe, expect, it } from 'vitest';
import { NOTCHES, amountAt, buyInPicks, buyInProblem, faultIn, notchOf, problemHere, stakeOf, stakesOf } from '../src/ui/lobby/table-model.ts';
import { limitSpec, limitsProblem } from '../../shared/src/limits.ts';

const $ = (d: number) => d * 100;

describe('the stakes a lobby is at', () => {
  const bj = limitSpec('blackjack')!;
  const tier = (name: string) => bj.tiers.find((t) => t.name === name)!;

  it("names a tier, Hold'em's blinds, or Custom", () => {
    expect(stakeOf('blackjack', { limits: { min: tier('High').min, max: tier('High').max } })).toBe('High');
    expect(stakeOf('blackjack', { limits: { min: $(30), max: $(3_000) } })).toBe('Custom');
    expect(stakeOf('blackjack', {})).toBeNull();
    const he = limitSpec('holdem')!.tiers[1]!;
    expect(stakeOf('holdem', { limits: { min: he.min, max: he.max } })).toBe('$1/$2');
  });

  it('lists each stake once, cheapest first, Custom last', () => {
    const list = [
      { limits: { min: tier('Penthouse').min, max: tier('Penthouse').max } },
      { limits: { min: $(30), max: $(3_000) } },
      { limits: { min: tier('Low').min, max: tier('Low').max } },
      { limits: { min: tier('Penthouse').min, max: tier('Penthouse').max } },
      {},
    ];
    expect(stakesOf('blackjack', list)).toEqual(['Low', 'Penthouse', 'Custom']);
    expect(stakesOf('blackjack', [])).toEqual([]);
  });
});

describe('custom limits at the table in front of you', () => {
  const floor = limitSpec('blackjack')!;
  const salon = limitSpec('blackjack', true)!;

  it("on the floor, says what the shared rules say", () => {
    for (const l of [{ min: $(30), max: $(3_000) }, { min: $(30), max: $(200) }, { min: $(200_000), max: $(2_000_000) }]) {
      expect(problemHere('blackjack', floor, l)).toBe(limitsProblem('blackjack', l));
    }
  });

  it('in the High Limit Salon, takes limits over the floor ceiling up to its own', () => {
    const big = { min: $(200_000), max: $(2_000_000) };
    expect(limitsProblem('blackjack', big)).not.toBeNull();
    expect(problemHere('blackjack', salon, big)).toBeNull();
    expect(problemHere('blackjack', salon, { min: $(100_000_000_000), max: $(1_000_000_000_000) })).toBeNull();
  });

  it('in the salon, words each rule broken the way the floor does', () => {
    expect(problemHere('blackjack', salon, { min: $(200_000), max: $(1_000_000) })).toBe('The maximum is at least 10 times the minimum ($2,000,000).');
    expect(problemHere('blackjack', salon, { min: $(200_000_000_000), max: $(1_000_000_000_000) })).toMatch(/^The minimum is \$1 to \$100,000,000,000/);
    expect(problemHere('blackjack', salon, { min: $(100), max: $(2_000_000_000_000) })).toBe('The maximum here is at most $1,000,000,000,000.');
    expect(problemHere('blackjack', salon, { min: 150, max: $(3_000) })).toMatch(/^The minimum/);
  });

  it('a game the salon has no tables for keeps the floor rules there', () => {
    expect(limitSpec('craps', true)).toBe(limitSpec('craps'));
    const l = { min: $(200_000), max: $(2_000_000) };
    expect(problemHere('craps', limitSpec('craps', true)!, l)).toBe(limitsProblem('craps', l));
  });

  it('points at the field at fault', () => {
    expect(faultIn('blackjack', floor, { min: NaN, max: $(500) })).toBe('min');
    expect(faultIn('blackjack', floor, { min: $(5), max: NaN })).toBe('max');
    expect(faultIn('blackjack', floor, { min: $(30), max: $(200) })).toBe('max');
    expect(faultIn('blackjack', floor, { min: $(500_000), max: $(1_000_000) })).toBe('min');
    expect(faultIn('blackjack', floor, { min: $(30), max: $(3_000) })).toBeNull();
  });
});

describe('the buy-in prompt', () => {
  it('offers the minimum, round amounts up the range and the most', () => {
    expect(buyInPicks($(100), $(50_000))).toEqual([$(100), $(500), $(5_000), $(20_000), $(50_000)]);
    expect(buyInPicks($(200), $(2_500))).toEqual([$(200), $(1_000), $(2_500)]);
    expect(buyInPicks($(20), $(20))).toEqual([$(20)]);
  });

  it('runs its slider from the minimum to the most, exactly, through round amounts', () => {
    for (const [min, max] of [[$(100), $(500_000)], [$(200), $(2_500)], [$(1), $(1_000_000)]] as const) {
      expect(amountAt(0, min, max)).toBe(min);
      expect(amountAt(NOTCHES, min, max)).toBe(max);
      let last = 0;
      for (let n = 0; n <= NOTCHES; n += 10) {
        const a = amountAt(n, min, max);
        expect(a).toBeGreaterThanOrEqual(last);
        expect(a % 100).toBe(0);
        // two significant figures between the ends
        if (n > 0 && n < NOTCHES && a > $(100)) expect(String(a / 100).replace(/0+$/, '').length).toBeLessThanOrEqual(2);
        last = a;
      }
    }
  });

  it('puts a wide range on a log scale, so its middle is near the geometric middle', () => {
    const mid = amountAt(NOTCHES / 2, $(100), $(1_000_000));
    expect(mid).toBeGreaterThan($(5_000));
    expect(mid).toBeLessThan($(20_000));
    // and a narrow one in a straight line
    expect(amountAt(NOTCHES / 2, $(200), $(2_000))).toBe($(1_100));
  });

  it('follows a typed amount back to its notch', () => {
    for (const n of [0, 137, 500, 812, NOTCHES]) {
      const a = amountAt(n, $(100), $(500_000));
      expect(Math.abs(notchOf(a, $(100), $(500_000)) - n)).toBeLessThanOrEqual(12);
    }
    expect(notchOf($(1), $(100), $(500_000))).toBe(0);
    expect(notchOf($(10_000_000), $(100), $(500_000))).toBe(NOTCHES);
    expect(notchOf($(20), $(20), $(20))).toBe(0);
  });

  it('says what is wrong with a typed amount', () => {
    expect(buyInProblem('2,000', $(100), $(50_000))).toEqual({ cents: $(2_000), problem: null });
    expect(buyInProblem(' $750 ', $(100), $(50_000))).toEqual({ cents: $(750), problem: null });
    expect(buyInProblem('', $(100), $(50_000)).problem).toBe('Type an amount in dollars.');
    expect(buyInProblem('lots', $(100), $(50_000)).problem).toBe('Type an amount in dollars.');
    expect(buyInProblem('50', $(100), $(50_000)).problem).toBe('Choose between $100 and $50,000.');
    expect(buyInProblem('60000', $(100), $(50_000)).problem).toBe('Choose between $100 and $50,000.');
    // whole dollars, as before
    expect(buyInProblem('100.4', $(100), $(50_000))).toEqual({ cents: $(100), problem: null });
  });
});
