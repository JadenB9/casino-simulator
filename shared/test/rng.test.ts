import { describe, it, expect } from 'vitest';
import { randInt, shuffle, cryptoRng, chance, type Rng } from '../src/rng.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';

// Critical values of chi-square at p = 0.001 (so a correct generator fails 1 run in 1000;
// the seeded runs are deterministic, so they never flake).
const CHI2_999 = { 37: 69.35, 51: 87.97, 11: 31.26, 5: 20.52 };

describe('randInt', () => {
  it('stays in range for awkward n', () => {
    const rng = seededRng(1);
    for (const n of [1, 2, 3, 37, 38, 52, 312, 416, 2 ** 31 + 1, 2 ** 32]) {
      for (let i = 0; i < 2000; i++) {
        const x = randInt(rng, n);
        expect(Number.isInteger(x) && x >= 0 && x < n).toBe(true);
      }
    }
  });

  it('rejects draws above the last full multiple instead of folding them (no modulo bias)', () => {
    // A generator that only ever returns the top value: with rejection it must be discarded
    // until a usable value appears; `% n` would have returned it.
    const top = 2 ** 32 - 1;
    const seq = [top, top, 5];
    const rng: Rng = { next32: () => seq.shift()! };
    expect(randInt(rng, 52)).toBe(5);
  });

  it('is uniform over 38 pockets (chi-square)', () => {
    const rng = seededRng(7);
    const counts = new Array(38).fill(0);
    for (let i = 0; i < 380_000; i++) counts[randInt(rng, 38)]++;
    expect(chiSquareUniform(counts)).toBeLessThan(CHI2_999[37]);
  });

  it('rejects nonsense ranges', () => {
    const rng = seededRng(1);
    expect(() => randInt(rng, 0)).toThrow();
    expect(() => randInt(rng, 2.5)).toThrow();
    expect(() => randInt(rng, 2 ** 32 + 1)).toThrow();
  });

  it('chance() is exact for its fraction', () => {
    const rng = seededRng(3);
    let hits = 0;
    for (let i = 0; i < 120_000; i++) if (chance(rng, 1, 6)) hits++;
    expect(Math.abs(hits - 20_000)).toBeLessThan(4 * Math.sqrt(120_000 * (1 / 6) * (5 / 6)));
  });
});

describe('shuffle', () => {
  it('keeps every card exactly once', () => {
    const rng = seededRng(2);
    const a = Array.from({ length: 52 }, (_, i) => i);
    shuffle(rng, a);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });

  it('puts each card in each position equally often (position matrix, 12 cards)', () => {
    // A naive "swap with any index" shuffle or an off-by-one (Sattolo) fails this badly.
    const rng = seededRng(11);
    const n = 12;
    const trials = 120_000;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let t = 0; t < trials; t++) {
      const a = Array.from({ length: n }, (_, i) => i);
      shuffle(rng, a);
      a.forEach((card, pos) => matrix[card]![pos]++);
    }
    for (const row of matrix) expect(chiSquareUniform(row)).toBeLessThan(CHI2_999[11]);
    // Sattolo's algorithm never leaves a card where it started; Fisher-Yates does 1/n of the time.
    const fixed = matrix.reduce((acc, row, i) => acc + row[i]!, 0) / n;
    expect(fixed).toBeGreaterThan(trials / n / 2);
  });
});

describe('cryptoRng', () => {
  it('produces 32-bit values across many buffer refills', () => {
    const rng = cryptoRng();
    let or = 0;
    for (let i = 0; i < 50_000; i++) {
      const x = rng.next32();
      expect(Number.isInteger(x) && x >= 0 && x < 2 ** 32).toBe(true);
      or |= x;
    }
    expect(or >>> 0).toBe(0xffffffff);
  });

  it('is uniform over 6 faces (chi-square)', () => {
    const rng = cryptoRng();
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 120_000; i++) counts[randInt(rng, 6)]++;
    // Not seeded, so allow p = 0.001 (flakes about once in a thousand runs).
    expect(chiSquareUniform(counts)).toBeLessThan(CHI2_999[5]);
  });
});
