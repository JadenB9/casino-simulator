import { describe, it, expect } from 'vitest';
import { wheelStats, shares } from '../src/games/roulette/stats.ts';

describe('the roulette board: colours, hot and cold', () => {
  it('counts the colours, the zeros green', () => {
    const s = wheelStats('american', [1, 2, 0, 37, 3, 1]);
    expect([s.red, s.black, s.green, s.spins]).toEqual([3, 1, 2, 6]);
  });
  it('hot: seen twice or more, most first, the latest first on a tie', () => {
    const s = wheelStats('european', [5, 17, 5, 17, 22, 17, 9]);
    expect(s.hot).toEqual([{ n: 17, count: 3 }, { n: 5, count: 2 }]);
    expect(wheelStats('european', [1, 2, 3]).hot).toEqual([]);
  });
  it('cold: the least seen, the longest gone first, never-seen numbers before any', () => {
    const log = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
    // 36 never came up; then the rest once each, 35 the oldest
    expect(wheelStats('european', log, 3).cold.map((c) => c.n)).toEqual([36, 35, 34]);
    expect(wheelStats('european', []).cold).toEqual([]);
  });
  it('shares add up to 100', () => {
    expect(shares({ red: 1, black: 1, green: 1 })).toEqual({ red: 34, black: 33, green: 33 });
    expect(shares({ red: 101, black: 0, green: 99 })).toEqual({ red: 51, black: 0, green: 49 });
    expect(shares({ red: 0, black: 0, green: 0 })).toEqual({ red: 0, black: 0, green: 0 });
    for (let r = 0; r < 12; r++) for (let b = 0; b < 12; b++) for (let g = 0; g < 4; g++) {
      if (r + b + g === 0) continue;
      const s = shares({ red: r, black: b, green: g });
      expect(s.red + s.black + s.green).toBe(100);
    }
  });
});
