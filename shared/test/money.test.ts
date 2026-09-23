import { describe, it, expect } from 'vitest';
import { formatMoney, formatCompact, checkBet, chipBreakdown, payOdds, isCents, STARTING_BALANCE, LOAN_AMOUNT } from '../src/money.ts';

describe('money', () => {
  it('starts and lends $50,000', () => {
    expect(STARTING_BALANCE).toBe(5_000_000);
    expect(LOAN_AMOUNT).toBe(5_000_000);
  });

  it('formats', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(5_000_000)).toBe('$50,000');
    expect(formatMoney(-250)).toBe('−$2.50');
    expect(formatMoney(3750, { sign: true })).toBe('+$37.50');
    expect(formatCompact(5_000_000)).toBe('$50K');
    expect(formatCompact(150_000_000)).toBe('$1.5M');
    expect(formatCompact(99_900)).toBe('$999');
  });

  it('checks bets against limits and steps', () => {
    const lim = { min: 500, max: 500_000, step: 100 };
    expect(checkBet(500, lim)).toBeNull();
    expect(checkBet(400, lim)).toBe('BELOW_MIN');
    expect(checkBet(500_100, lim)).toBe('ABOVE_MAX');
    expect(checkBet(550, lim)).toBe('OFF_STEP');
    expect(checkBet(12.5, lim)).toBe('NOT_CENTS');
    expect(checkBet(0, lim)).toBe('NOT_CENTS');
    // place 6/8 must be in $6 units so 7:6 lands on whole cents
    expect(checkBet(1200, { min: 600, max: 600_000, step: 600 })).toBeNull();
    expect(checkBet(1000, { min: 600, max: 600_000, step: 600 })).toBe('OFF_STEP');
  });

  it('pays exact odds or refuses', () => {
    expect(payOdds(1000, 3, 2)).toBe(1500);
    expect(payOdds(600, 7, 6)).toBe(700);
    expect(() => payOdds(100, 7, 6)).toThrow();
  });

  it('breaks amounts into chips', () => {
    const b = chipBreakdown(3750);
    expect(b.stacks.map((s) => [s.chip.value, s.count])).toEqual([[2500, 1], [500, 2], [250, 1]]);
    expect(b.loose).toBe(0);
    expect(chipBreakdown(125).loose).toBe(25);
  });

  it('knows what cents are', () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(-1)).toBe(false);
    expect(isCents(1.5)).toBe(false);
    expect(isCents('5')).toBe(false);
  });
});
