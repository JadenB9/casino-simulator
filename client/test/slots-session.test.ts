import { describe, it, expect } from 'vitest';
import { NEON } from '../../shared/src/games/slots/machines.ts';
import { SessionLog, clock, netText } from '../src/games/slots/session.ts';
import { countEase } from '../src/games/slots/moments.ts';
import { lineCells } from '../src/games/slots/glass.ts';
import { winCells, type OverlaySpec } from '../src/games/slots/skin.ts';

describe('the session at a slot machine', () => {
  it('adds up what the spins were bet and paid, and keeps the biggest win with its bet', () => {
    const s = new SessionLog(0);
    expect([s.spins, s.bet, s.paid, s.net, s.best]).toEqual([0, 0, 0, 0, 0]);
    s.add(100, 0);
    s.add(100, 250);
    s.add(200, 0);
    expect([s.spins, s.bet, s.paid, s.net]).toEqual([3, 400, 250, -150]);
    expect([s.best, s.bestBet]).toEqual([250, 100]);
    // a later win of the same size doesn't take its place; a bigger one does, with its own bet
    s.add(50, 250);
    expect([s.best, s.bestBet]).toEqual([250, 100]);
    s.add(500, 4100);
    expect([s.best, s.bestBet, s.net]).toEqual([4100, 500, 3650]);
  });

  it('says the time at the machine as m:ss, and h:mm:ss past the hour', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(7_999)).toBe('0:07');
    expect(clock(247_000)).toBe('4:07');
    expect(clock(3_765_000)).toBe('1:02:45');
    expect(clock(-5)).toBe('0:00');
  });

  it('says the net with its sign, and nothing for even', () => {
    expect(netText(450)).toBe('+$4.50');
    expect(netText(-125)).toBe('−$1.25');
    expect(netText(0)).toBe('$0');
  });
});

describe('the big-win count-up', () => {
  it('runs from nothing to the total, quick off the mark and slowing into it', () => {
    expect(countEase(0)).toBe(0);
    expect(countEase(1)).toBe(1);
    expect(countEase(0.5)).toBe(0.75);
    let last = 0;
    for (let k = 0.05; k <= 1; k += 0.05) {
      const v = countEase(k);
      expect(v).toBeGreaterThan(last);
      last = v;
    }
  });
});

describe('the cells a line win lights', () => {
  it('Neon Nights: the first `count` reels along the line, reel * 3 + row', () => {
    // line 1 is the middle row, so three of a kind are cells 1, 4 and 7
    expect(NEON.lineRows[0]).toEqual([1, 1, 1, 1, 1]);
    expect(lineCells(0, 3)).toEqual([1, 4, 7]);
    expect(lineCells(0, 5)).toEqual([1, 4, 7, 10, 13]);
    for (let l = 0; l < NEON.lineRows.length; l++) {
      const cells = lineCells(l, 5);
      expect(cells.map((c) => Math.floor(c / 3))).toEqual([0, 1, 2, 3, 4]);
      expect(cells.map((c) => c % 3)).toEqual(NEON.lineRows[l]);
    }
  });

  it('the newer machines: the same, on their own number of rows', () => {
    const spec = { rows: 4, lineRows: [[0, 1, 2, 3, 3]] } as unknown as OverlaySpec;
    expect(winCells(spec, 0, 4)).toEqual([0, 5, 10, 15]);
  });
});
