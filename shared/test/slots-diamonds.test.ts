// Diamond Line cell by cell and in full: every pay glass row with none, one and two diamonds, the
// cherry and lone-diamond rules, the published PAR sheet by exact enumeration of all 262,144
// virtual-stop combinations through spinDiamonds (the function the engine settles with), the
// unbiased draws, and a spin through the engine.

import { describe, it, expect } from 'vitest';
import type { Rng } from '../src/rng.ts';
import { engine } from '../src/games/slots/engine.ts';
import {
  DIAMONDS,
  DIAMOND_ANY_BAR,
  DIAMOND_CHERRIES,
  DIAMOND_THREE,
  DIAMOND_TOP,
  diamondHits,
  diamondsPayAt,
  scoreDiamonds,
  spinDiamonds,
  type DiamondSymbol,
} from '../src/games/slots/diamonds.ts';
import { virtualReel } from '../src/games/slots/rules.ts';
import type { ReelsEvent, ResultEvent, SlotsView } from '../src/games/slots/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

async function doc(): Promise<Record<string, unknown>> {
  const path = '../../docs/math/slot-d-diamond-line.mjs';
  return (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
}

/** Feeds spin number i the virtual stops of combination i, reel by reel, in counting order. */
function countingRng(stopsPerReel: number, reels: number): Rng {
  let draw = 0;
  return {
    next32() {
      const spin = Math.floor(draw / reels);
      const reel = draw % reels;
      draw++;
      return Math.floor(spin / stopsPerReel ** (reels - 1 - reel)) % stopsPerReel;
    },
  };
}

function scripted(words: number[]): Rng {
  let i = 0;
  return {
    next32() {
      if (i >= words.length) throw new Error('scripted rng ran out');
      return words[i++]!;
    },
  };
}

/** The first physical stop on a reel showing `sym`, and a virtual stop that maps to it. */
function stopOf(reel: number, sym: DiamondSymbol): { stop: number; virtual: number } {
  const stop = DIAMONDS.reels[reel]!.findIndex(([s]) => s === sym);
  if (stop < 0) throw new Error(`no ${sym} on reel ${reel + 1}`);
  return { stop, virtual: virtualReel(DIAMONDS.reels[reel]!).indexOf(stop) };
}

describe('Diamond Line data', () => {
  it('matches the published script stop for stop', async () => {
    const d = await doc();
    expect(DIAMONDS.reels).toEqual(d.REELS);
    expect(DIAMONDS.virtualStops).toBe(d.VIRTUAL_STOPS);
    expect(DIAMOND_THREE).toEqual(d.THREE);
    expect([0, ...DIAMOND_CHERRIES, DIAMOND_THREE.CH]).toEqual(d.CHERRIES);
    expect([DIAMOND_ANY_BAR, DIAMOND_TOP, 2]).toEqual([d.ANY_BAR, d.THREE_DIAMONDS, d.MULTIPLIER]);
  });

  it('22 stops a reel, weights to 64, blanks between symbols, no heavy blanks beside the diamond or the seven', () => {
    for (const reel of DIAMONDS.reels) {
      expect(reel).toHaveLength(22);
      expect(reel.reduce((t, [, w]) => t + w, 0)).toBe(64);
      reel.forEach(([s], i) => expect(s === 'BL').toBe(i % 2 === 1));
      const blanks = reel.filter(([s]) => s === 'BL');
      const average = blanks.reduce((t, [, w]) => t + w, 0) / blanks.length;
      reel.forEach(([s], i) => {
        if (s !== 'DI' && s !== '7') return;
        for (const j of [(i + 21) % 22, (i + 1) % 22]) expect(reel[j]![1]).toBeLessThanOrEqual(average);
      });
    }
  });

  it('the pay glass is the rules', () => {
    expect(DIAMONDS.pays.map((p) => [p.combo, p.pay])).toEqual([
      ['threeDI', 1000], ['three7', 80], ['three3B', 40], ['three2B', 25], ['three1B', 10], ['anyBar', 5], ['threeCH', 10], ['twoCH', 5], ['oneCH', 2],
    ]);
  });
});

describe('Diamond Line pays', () => {
  // [line, combo, diamonds in the win, pay per coin]
  const cases: [DiamondSymbol[], string | null, number, number][] = [
    [['DI', 'DI', 'DI'], 'threeDI', 3, 1000],
    [['7', '7', '7'], 'three7', 0, 80],
    [['DI', '7', '7'], 'three7', 1, 160],
    [['7', 'DI', 'DI'], 'three7', 2, 320],
    [['3B', '3B', '3B'], 'three3B', 0, 40],
    [['3B', 'DI', '3B'], 'three3B', 1, 80],
    [['DI', 'DI', '3B'], 'three3B', 2, 160],
    [['2B', '2B', '2B'], 'three2B', 0, 25],
    [['2B', '2B', 'DI'], 'three2B', 1, 50],
    [['DI', '2B', 'DI'], 'three2B', 2, 100],
    [['1B', '1B', '1B'], 'three1B', 0, 10],
    [['1B', 'DI', '1B'], 'three1B', 1, 20],
    [['DI', 'DI', '1B'], 'three1B', 2, 40],
    [['1B', '3B', '2B'], 'anyBar', 0, 5],
    [['3B', '3B', '1B'], 'anyBar', 0, 5],
    [['DI', '1B', '3B'], 'anyBar', 1, 10],
    [['CH', 'CH', 'CH'], 'threeCH', 0, 10],
    [['CH', 'DI', 'CH'], 'threeCH', 1, 20],
    [['DI', 'CH', 'DI'], 'threeCH', 2, 40],
    [['CH', 'CH', 'BL'], 'twoCH', 0, 5],
    [['7', 'CH', 'CH'], 'twoCH', 0, 5],
    [['CH', 'BL', 'CH'], 'twoCH', 0, 5],
    [['CH', 'DI', 'BL'], 'twoCH', 1, 10],
    [['1B', 'CH', 'DI'], 'twoCH', 1, 10],
    [['DI', 'DI', 'BL'], 'twoCH', 2, 20],
    [['7', 'DI', 'DI'], 'three7', 2, 320],
    [['CH', 'BL', 'BL'], 'oneCH', 0, 2],
    [['BL', '7', 'CH'], 'oneCH', 0, 2],
    [['BL', 'BL', 'CH'], 'oneCH', 0, 2],
    [['DI', 'BL', 'BL'], 'oneCH', 1, 4],
    [['7', 'DI', '3B'], 'oneCH', 1, 4],
    [['BL', 'BL', 'DI'], 'oneCH', 1, 4],
    [['7', '7', 'BL'], null, 0, 0],
    [['7', '3B', '3B'], null, 0, 0],
    [['3B', '3B', 'BL'], null, 0, 0],
    [['BL', 'BL', 'BL'], null, 0, 0],
    [['1B', '2B', '7'], null, 0, 0],
  ];
  for (const [line, combo, wilds, pay] of cases) {
    it(`${line.join(' ')} pays ${pay}`, () => expect(scoreDiamonds(line[0]!, line[1]!, line[2]!)).toEqual({ combo, wilds, pay }));
  }

  it('a diamond with a matching pair pays the three of a kind doubled, not any bars or a cherry', () => {
    expect(scoreDiamonds('3B', 'DI', '3B').pay).toBe(80);
    expect(scoreDiamonds('1B', '1B', 'DI').pay).toBe(20);
  });

  it('every row with none, one and two diamonds is reachable on the real reels', () => {
    const lines: [DiamondSymbol[], string, number][] = [
      [['DI', 'DI', 'DI'], 'threeDI', 3],
      [['7', '7', '7'], 'three7', 0], [['7', 'DI', '7'], 'three7', 1], [['DI', 'DI', '7'], 'three7', 2],
      [['3B', '3B', '3B'], 'three3B', 0], [['DI', '3B', '3B'], 'three3B', 1], [['3B', 'DI', 'DI'], 'three3B', 2],
      [['2B', '2B', '2B'], 'three2B', 0], [['2B', '2B', 'DI'], 'three2B', 1], [['DI', '2B', 'DI'], 'three2B', 2],
      [['1B', '1B', '1B'], 'three1B', 0], [['1B', 'DI', '1B'], 'three1B', 1], [['DI', 'DI', '1B'], 'three1B', 2],
      [['3B', '2B', '1B'], 'anyBar', 0], [['DI', '2B', '1B'], 'anyBar', 1],
      [['CH', 'CH', 'CH'], 'threeCH', 0], [['CH', 'CH', 'DI'], 'threeCH', 1], [['DI', 'DI', 'CH'], 'threeCH', 2],
      [['CH', 'BL', 'CH'], 'twoCH', 0], [['BL', 'DI', 'CH'], 'twoCH', 1], [['DI', 'DI', 'BL'], 'twoCH', 2],
      [['BL', 'CH', 'BL'], 'oneCH', 0], [['BL', 'BL', 'DI'], 'oneCH', 1],
    ];
    for (const [syms, combo, wilds] of lines) {
      const got = diamondsPayAt(syms.map((s, r) => stopOf(r, s).stop));
      expect([got.combo, got.wilds]).toEqual([combo, wilds]);
    }
    expect(new Set(lines.map((l) => l[1]))).toEqual(new Set(DIAMONDS.pays.map((p) => p.combo)));
  });

  it('lights the reels that made the win', () => {
    expect(diamondHits(['CH', 'BL', 'DI'], 'twoCH')).toEqual([true, false, true]);
    expect(diamondHits(['BL', 'DI', 'BL'], 'oneCH')).toEqual([false, true, false]);
    expect(diamondHits(['7', '7', 'DI'], 'three7')).toEqual([true, true, true]);
    expect(diamondHits(['7', 'BL', 'DI'], null)).toEqual([false, false, false]);
  });
});

describe('Diamond Line exact return', () => {
  it('248,992 / 262,144 = 94.9829% over every virtual-stop combination, through spinDiamonds', () => {
    const n = 64 ** 3;
    const rng = countingRng(64, 3);
    const counts = new Map<string, number>();
    let sum = 0, sumSq = 0, hits = 0;
    for (let i = 0; i < n; i++) {
      const r = spinDiamonds(rng);
      const key = r.combo ? `${r.combo}:${r.wilds}` : 'none';
      counts.set(key, (counts.get(key) ?? 0) + 1);
      sum += r.pay;
      sumSq += r.pay * r.pay;
      if (r.pay > 0) hits++;
    }
    const rtp = sum / n;
    const sd = Math.sqrt(sumSq / n - rtp * rtp);
    console.log(`Diamond Line: ${sum} / ${n} = ${(rtp * 100).toFixed(4)}%, hits ${hits}, SD ${sd.toFixed(4)}`);
    expect(sum).toBe(248_992);
    expect((rtp * 100).toFixed(4)).toBe('94.9829');
    expect(hits).toBe(55_967);
    expect(((hits / n) * 100).toFixed(4)).toBe('21.3497');
    expect(sd.toFixed(4)).toBe('6.0563');
    // the published combination table, row by row (docs/rules/cards-and-machines.md §3.7)
    expect(Object.fromEntries(counts)).toEqual({
      'threeDI:3': 4,
      'three7:2': 16,
      'three3B:2': 32,
      'three7:1': 20,
      'three2B:2': 44,
      'three3B:1': 80,
      'three7:0': 8,
      'three2B:1': 145,
      'three1B:2': 72,
      'three3B:0': 64,
      'threeCH:2': 20,
      'three2B:0': 150,
      'three1B:1': 405,
      'twoCH:2': 316,
      'threeCH:1': 33,
      'twoCH:1': 1558,
      'anyBar:1': 1062,
      'three1B:0': 729,
      'threeCH:0': 18,
      'anyBar:0': 5213,
      'twoCH:0': 1257,
      'oneCH:1': 16165,
      'oneCH:0': 28556,
      none: 206177,
    });
  });
});

describe('Diamond Line draws', () => {
  it('virtual stops are uniform over 0-63 (chi-square, 640,000 spins)', () => {
    const rng = seededRng(21);
    const counts = Array.from({ length: 3 }, () => new Array<number>(64).fill(0));
    for (let i = 0; i < 640_000; i++) spinDiamonds(rng).virtual.forEach((v, r) => counts[r]![v]!++);
    // 63 degrees of freedom: the 99.99th percentile is about 117
    for (const c of counts) expect(chiSquareUniform(c)).toBeLessThan(117);
  });

  it('virtual stops map to physical stops by weight', () => {
    expect(spinDiamonds(scripted([0, 2, 63])).stops).toEqual([0, 1, 21]);
    expect(spinDiamonds(scripted([1, 1, 0])).symbols).toEqual(['DI', 'DI', 'DI']);
  });
});

describe('Diamond Line on the engine', () => {
  const sim = (stack: number, rng: Rng) => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }], engine.config('diamonds', 'solo'));

  it('config: one seat, $1/$2/$5 coins, 1-3 coins', () => {
    const cfg = engine.config('diamonds', 'solo');
    expect(cfg).toMatchObject({ game: 'slots', variant: 'diamonds', maxSeats: 1, limits: { default: { min: 100, max: 1500, step: 100 } } });
    expect(cfg.options).toEqual({ machine: 'diamonds', denoms: [100, 200, 500], maxCoins: 3, lines: 1 });
  });

  it('three diamonds: the bet goes out, 1,000 x coins x coin value comes back, one round', () => {
    const di = [0, 1, 2].map((r) => stopOf(r, 'DI').virtual);
    const t = sim(10_000, scripted([0, 0, 0, ...di]));
    t.act(0, { type: 'spin', coins: 3, denom: 500 });
    expect(t.stack(0)).toBe(10_000 - 1500 + 1000 * 3 * 500);
    expect(t.rounds).toEqual([{ seat: 0, wagered: 1500, returned: 1_500_000 }]);
    const reels = t.lastEvents[1] as ReelsEvent;
    expect(reels).toMatchObject({ combo: 'threeDI', wilds: 3, hits: [true, true, true], multiplier: 1, win: 1_500_000, lines: [{ line: 0, symbol: 'DI', count: 3, win: 1_500_000 }] });
    expect(t.lastEvents[2] as ResultEvent).toEqual({ type: 'result', seat: 0, bet: 1500, win: 1_500_000, freeSpins: 0, freeWin: 0, credit: 1_508_500 });
    expect((t.view(0) as SlotsView).machine).toBe('diamonds');
  });

  it('a lone diamond pays a cherry doubled and marks x2', () => {
    const v = [stopOf(0, 'BL').virtual, stopOf(1, 'DI').virtual, stopOf(2, 'BL').virtual];
    const t = sim(10_000, scripted([0, 0, 0, ...v]));
    t.act(0, { type: 'spin', coins: 2, denom: 100 });
    expect(t.lastEvents[1]).toMatchObject({ combo: 'oneCH', wilds: 1, multiplier: 2, hits: [false, true, false], win: 800 });
    expect(t.stack(0)).toBe(10_000 - 200 + 800);
  });

  it('money adds up over thousands of spins', () => {
    const t = sim(10_000_000, seededRng(31));
    for (let i = 0; i < 3000; i++) t.act(0, { type: 'spin', coins: 1 + (i % 3), denom: DIAMONDS.denoms[i % 3]! });
    const net = t.rounds.reduce((s, r) => s + r.returned - r.wagered, 0);
    expect(t.stack(0)).toBe(10_000_000 + net);
    expect(engine.liveBets(t.state, 0)).toBe(0);
    expect((t.view(0) as SlotsView).stops).toHaveLength(3);
  });
});
