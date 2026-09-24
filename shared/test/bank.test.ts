import { describe, it, expect } from 'vitest';
import { REFILL_BELOW, REFILL_TO, refillFor } from '../src/bank.ts';

describe('bank refill rule', () => {
  it('tops up to $50,000 below $10,000 in all', () => {
    expect([REFILL_BELOW, REFILL_TO]).toEqual([1_000_000, 5_000_000]);
    expect(refillFor(0)).toBe(5_000_000);
    expect(refillFor(1)).toBe(4_999_999);
    expect(refillFor(350_050)).toBe(4_649_950);
  });

  it('lends at $9,999.99 and not at $10,000.00', () => {
    expect(refillFor(999_999)).toBe(4_000_001);
    expect(refillFor(1_000_000)).toBe(0);
    expect(refillFor(1_000_001)).toBe(0);
    expect(refillFor(5_000_000)).toBe(0);
  });

  it('always lands the player on exactly $50,000', () => {
    for (const total of [0, 1, 99, 12_345, 500_000, 999_999]) expect(total + refillFor(total)).toBe(REFILL_TO);
  });
});
