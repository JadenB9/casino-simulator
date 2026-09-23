// The slot machines checked against their published PAR sheets (docs/rules/cards-and-machines.md
// §3), by exact enumeration through the engine's own code:
//   - the data here is the data in docs/math/slot-*.mjs, stop for stop;
//   - Classic Sevens and 5x Wild: every virtual stop combination is fed to spinSevens/spinWild
//     (the functions the engine settles with) through a counting Rng, so the draw, the virtual
//     reel mapping and the scoring are all under test;
//   - Neon Nights: every one of the 32^5 windows is scored with the engine's line and scatter
//     functions, and the free games are added with the closed form from §3.4.

import { describe, it, expect } from 'vitest';
import type { Rng } from '../src/rng.ts';
import { NEON, NEON_SYMBOLS, SEVENS, WILD } from '../src/games/slots/machines.ts';
import { neonLineCredits, neonScatterCredits, neonScatters, spinSevens, spinWild } from '../src/games/slots/rules.ts';

declare const console: { log(...args: unknown[]): void };

// Read the doc scripts at run time (they are plain .mjs with no types).
async function doc(file: string): Promise<Record<string, unknown>> {
  const path = `../../docs/math/${file}`;
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

describe('the data matches the published scripts', () => {
  it('Classic Sevens reels and pays', async () => {
    const a = await doc('slot-a-classic-3reel.mjs');
    expect(SEVENS.reels).toEqual(a.REELS);
    expect(SEVENS.virtualStops).toBe(a.VIRTUAL_STOPS);
    const pays = a.PAYS as Record<string, number>;
    expect(SEVENS.pays.map((p) => p.pay)).toEqual(Object.values(pays));
  });

  it('5x Wild reels and pays', async () => {
    const c = await doc('slot-c-wild-3reel.mjs');
    expect(WILD.reels).toEqual(c.REELS);
    expect(WILD.virtualStops).toBe(c.VIRTUAL_STOPS);
    const base = c.BASE as Record<string, number>;
    expect(WILD.pays.map((p) => p.pay)).toEqual([c.THREE_WILDS, base['7'], base['3B'], base['2B'], base['1B'], c.ANY_BAR, c.TWO_WILDS_ONLY, c.ONE_WILD_ONLY]);
  });

  it('Neon Nights strips, lines and pays', async () => {
    const b = await doc('slot-b-video-5reel.mjs');
    const names = b.SYMBOLS as string[];
    expect(names).toEqual([...NEON_SYMBOLS]);
    expect(NEON.strips).toEqual((b.STRIPS as number[][]).map((s) => s.map((i) => names[i])));
    expect(NEON.lineRows).toEqual(b.LINES);
    const pays = b.LINE_PAYS as Record<string, number[]>;
    expect(NEON.linePays).toEqual(Object.fromEntries(Object.entries(pays).map(([k, v]) => [names[Number(k)], v])));
    expect(NEON.scatterPays).toEqual(b.SCATTER_PAYS);
    expect([NEON.freeSpins, NEON.freeMultiplier, NEON.trigger]).toEqual([b.FREE_SPINS, b.FREE_SPIN_MULTIPLIER, b.TRIGGER]);
  });

  it('strip shapes: 22 stops, weights to 64 and 72, 32-stop video strips, no wild on reel 1', () => {
    for (const r of SEVENS.reels) {
      expect(r).toHaveLength(22);
      expect(r.reduce((t, [, w]) => t + w, 0)).toBe(64);
    }
    for (const r of WILD.reels) {
      expect(r).toHaveLength(22);
      expect(r.reduce((t, [, w]) => t + w, 0)).toBe(72);
    }
    for (const s of NEON.strips) expect(s).toHaveLength(32);
    expect(NEON.strips[0]).not.toContain('WILD');
    // blanks alternate with symbols on the steppers, and the weights next to the top symbols are not raised
    for (const m of [SEVENS, WILD]) for (const r of m.reels) r.forEach(([s], i) => expect(s === 'BL').toBe(i % 2 === 1));
  });
});

describe('exact return by enumeration', () => {
  it('Classic Sevens: 247,536 / 262,144 = 94.4275%', () => {
    const n = 64 ** 3;
    const rng = countingRng(64, 3);
    const counts = new Map<string, number>();
    let sum = 0, sumSq = 0, hits = 0;
    for (let i = 0; i < n; i++) {
      const r = spinSevens(rng);
      const key = r.combo ?? 'none';
      counts.set(key, (counts.get(key) ?? 0) + 1);
      sum += r.pay;
      sumSq += r.pay * r.pay;
      if (r.pay > 0) hits++;
    }
    const rtp = sum / n;
    const sd = Math.sqrt(sumSq / n - rtp * rtp);
    console.log(`Classic Sevens: ${sum} / ${n} = ${(rtp * 100).toFixed(4)}%, hits ${hits}, SD ${sd.toFixed(4)}`);
    expect(sum).toBe(247_536);
    expect((rtp * 100).toFixed(4)).toBe('94.4275');
    expect(hits).toBe(61_810);
    expect(((hits / n) * 100).toFixed(4)).toBe('23.5786');
    expect(sd.toFixed(4)).toBe('6.6640');
    expect(Object.fromEntries(counts)).toEqual({
      three7: 8, three3B: 150, three2B: 448, three1B: 1100, anyBar: 10952, threeCH: 576, twoCH: 5568, oneCH: 43008, none: 200334,
    });
  });

  it('5x Wild: 335,253 / 373,248 = 89.8204%', () => {
    const n = 72 ** 3;
    const rng = countingRng(72, 3);
    const counts = new Map<string, number>();
    let sum = 0, sumSq = 0, hits = 0;
    for (let i = 0; i < n; i++) {
      const r = spinWild(rng);
      const key = r.combo ? `${r.combo}:${r.wilds}` : 'none';
      counts.set(key, (counts.get(key) ?? 0) + 1);
      sum += r.pay;
      sumSq += r.pay * r.pay;
      if (r.pay > 0) hits++;
    }
    const rtp = sum / n;
    const sd = Math.sqrt(sumSq / n - rtp * rtp);
    console.log(`5x Wild: ${sum} / ${n} = ${(rtp * 100).toFixed(4)}%, hits ${hits}, SD ${sd.toFixed(4)}`);
    expect(sum).toBe(335_253);
    expect((rtp * 100).toFixed(4)).toBe('89.8204');
    expect(hits).toBe(32_576);
    expect(((hits / n) * 100).toFixed(4)).toBe('8.7277');
    expect(sd.toFixed(4)).toBe('26.7169');
    // the published combination table, row by row
    expect(Object.fromEntries(counts)).toEqual({
      'threeWX:3': 4,
      'three7:2': 16,
      'three3B:2': 30,
      'three2B:2': 48,
      'three7:1': 20,
      'three1B:2': 78,
      'three3B:1': 68,
      'three2B:1': 180,
      'three7:0': 8,
      'three1B:1': 470,
      'three3B:0': 48,
      'anyBar:1': 1163,
      'three2B:0': 216,
      'three1B:0': 900,
      'twoWX:2': 392,
      'anyBar:0': 6056,
      'oneWX:1': 22879,
      none: 340672,
    });
  });

  it('Neon Nights: base game 77.531755% by enumeration, 95.374145% with free games (closed form)', () => {
    const L = 32, N = L ** 5, BET = NEON.lines;
    const hist = new Float64Array(8192);
    const histT = new Float64Array(8192);
    let lineSum = 0, scatterSum = 0, triggers = 0;
    for (let a = 0; a < L; a++)
      for (let b = 0; b < L; b++)
        for (let c = 0; c < L; c++)
          for (let d = 0; d < L; d++)
            for (let e = 0; e < L; e++) {
              const lw = neonLineCredits(a, b, c, d, e);
              const sc = neonScatters(a, b, c, d, e);
              const w = lw + neonScatterCredits(sc);
              lineSum += lw;
              scatterSum += w - lw;
              hist[w]!++;
              if (sc >= NEON.trigger) {
                histT[w]!++;
                triggers++;
              }
            }
    let EW = 0, EW2 = 0, EWT = 0, pT = 0, hits = 0, top = 0;
    for (let w = 0; w < hist.length; w++) {
      if (!hist[w]) continue;
      EW += w * hist[w]!;
      EW2 += w * w * hist[w]!;
      EWT += w * histT[w]!;
      pT += histT[w]!;
      if (w > 0) hits += hist[w]!;
      top = w;
    }
    EW /= N; EW2 /= N; EWT /= N; pT /= N;

    // §3.4: a free spin with everything it retriggers is worth A = mW + T(A_1 + ... + A_F).
    const m = NEON.freeMultiplier, F = NEON.freeSpins;
    const EA = (m * EW) / (1 - F * pT);
    const EA2 = (m * m * EW2 + 2 * m * F * EWT * EA + pT * F * (F - 1) * EA * EA) / (1 - F * pT);
    const EF = F * EA, EF2 = F * EA2 + F * (F - 1) * EA * EA;
    const EX = EW + pT * EF, EX2 = EW2 + 2 * EWT * EF + pT * EF2;
    const pct = (x: number, digits = 6) => ((x / BET) * 100).toFixed(digits);
    console.log(`Neon Nights: lines ${pct(lineSum / N)}%, scatters ${pct(scatterSum / N)}%, base ${pct(EW)}%, free games ${pct(pT * EF)}%, total ${pct(EX)}%`);

    expect(pct(lineSum / N)).toBe('75.792074');
    expect(lineSum / BET).toBe(25_431_600); // per line, of 32^5
    expect(pct(scatterSum / N)).toBe('1.739681');
    expect(pct(EW)).toBe('77.531755');
    expect(triggers).toBe(239_058);
    expect(((hits / N) * 100).toFixed(4)).toBe('44.3851');
    expect((F / (1 - F * pT)).toFixed(4)).toBe('10.7671');
    expect((EF / BET).toFixed(4)).toBe('25.0438');
    expect(pct(pT * EF)).toBe('17.842390');
    expect(pct(EX)).toBe('95.374145');
    expect((Math.sqrt(EX2 - EX * EX) / BET).toFixed(4)).toBe('3.7849');
    expect((Math.sqrt(EW2 - EW * EW) / BET).toFixed(4)).toBe('2.2741');
    expect(top).toBe(2440);
    expect(hist[2440]).toBe(1);
  }, 120_000);

  it('Neon Nights line return from symbol counts alone (every line sees the same distribution)', () => {
    const L = 32;
    const count = (r: number, s: string) => NEON.strips[r]!.filter((x) => x === s).length;
    let num = 0;
    for (const [sym, pays] of Object.entries(NEON.linePays)) {
      const ge = [0, count(0, sym)];
      for (let r = 1; r < 5; r++) ge.push(ge[r]! * (count(r, sym) + count(r, 'WILD')));
      for (let n = 3; n <= 5; n++) num += pays![n - 3]! * (ge[n]! * L ** (5 - n) - (n < 5 ? ge[n + 1]! * L ** (4 - n) : 0));
    }
    expect(num).toBe(25_431_600);
  });
});
