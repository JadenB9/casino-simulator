// Gold Rush cell by cell and in full: every line pay, the WILD and NUGGET rules, the sticky wilds
// of the free games, the published PAR sheet (the base game by exact enumeration of all 32^5
// windows through the engine's own line scorer; the free games in closed form, with the per-reel
// probabilities it rests on checked by brute force over every stop sequence; the Monte Carlo
// plays whole features against it), the unbiased draws, and spins through the engine.

import { describe, it, expect } from 'vitest';
import type { Rng } from '../src/rng.ts';
import { engine } from '../src/games/slots/engine.ts';
import { GOLDRUSH, GOLD_FREE_TABLES, GOLD_TABLES, heldCells, playGoldRush, scoreGoldRush, wildsLanding, type GoldSymbol } from '../src/games/slots/goldrush.ts';
import { cellBit, lineCredits, lineWins, scatterCount, symbolAt } from '../src/games/slots/lines.ts';
import type { ReelsEvent, ResultEvent, SlotsView } from '../src/games/slots/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

const L = 32;
const ROWS = 4;

async function doc(): Promise<Record<string, unknown>> {
  const path = '../../docs/math/slot-f-gold-rush.mjs';
  return (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
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

const at = (reel: number, stop: number, row: number, free = false) => symbolAt(free ? GOLDRUSH.freeStrips : GOLDRUSH.strips, reel, stop, row);

function stopFor(reel: number, row: number, sym: GoldSymbol, free = false): number {
  for (let s = 0; s < L; s++) if (at(reel, s, row, free) === sym) return s;
  throw new Error(`no ${sym} on reel ${reel + 1}`);
}

/** A stop whose `row` is none of `avoid` and shows no NUGGET and no WILD anywhere. */
function plainStop(reel: number, row: number, avoid: GoldSymbol[], free = false): number {
  for (let s = 0; s < L; s++) {
    if (avoid.includes(at(reel, s, row, free))) continue;
    if ([0, 1, 2, 3].some((k) => at(reel, s, k, free) === 'NUGGET' || at(reel, s, k, free) === 'WILD')) continue;
    return s;
  }
  throw new Error('no such stop');
}

/** Closed form (§3.9): expected line credits per line in free game t, per the published formula. */
function freeLine(t: number): number {
  const f = (r: number, x: string) => GOLDRUSH.freeStrips[r]!.filter((y) => y === x).length / L;
  const q = [0, 1, 2, 3, 4].map((r) => f(r, 'WILD'));
  const a = (r: number, x: string) => 1 - (1 - q[r]!) ** t + (1 - q[r]!) ** (t - 1) * f(r, x);
  let ret = 0;
  for (const [x, pays] of Object.entries(GOLDRUSH.linePays)) {
    let p = f(0, x);
    for (let n = 2; n <= 5; n++) {
      p *= a(n - 1, x);
      ret += pays![n - 2]! * p * (n < 5 ? 1 - a(n, x) : 1);
    }
  }
  return ret;
}

const featureValue = (games: number) => Array.from({ length: games }, (_, i) => freeLine(i + 1)).reduce((a, b) => a + b, 0);

describe('Gold Rush data', () => {
  it('matches the published script stop for stop', async () => {
    const d = await doc();
    expect([...GOLDRUSH.symbols]).toEqual(d.SYMBOLS);
    expect(GOLDRUSH.strips).toEqual(d.STRIPS);
    expect(GOLDRUSH.freeStrips).toEqual(d.FREE_STRIPS);
    expect(GOLDRUSH.lineRows).toEqual(d.LINES);
    const pays = d.LINE_PAYS as Record<string, number[]>;
    expect(GOLDRUSH.linePays).toEqual(Object.fromEntries(Object.entries(pays).map(([k, v]) => [k, [0, ...v]])));
    expect(GOLDRUSH.freeGames).toEqual(d.FREE_GAMES);
    expect(GOLDRUSH.trigger).toBe(d.TRIGGER);
  });

  it('32-stop strips; a NUGGET on each base strip and none on the free ones; WILD off reel 1; 40 distinct lines that step one row at most', () => {
    for (const s of [...GOLDRUSH.strips, ...GOLDRUSH.freeStrips]) expect(s).toHaveLength(32);
    for (const s of GOLDRUSH.strips) expect(s.filter((x) => x === 'NUGGET')).toHaveLength(1);
    for (const s of GOLDRUSH.freeStrips) expect(s).not.toContain('NUGGET');
    expect(GOLDRUSH.strips[0]).not.toContain('WILD');
    expect(GOLDRUSH.freeStrips[0]).not.toContain('WILD');
    GOLDRUSH.freeStrips.slice(1).forEach((s) => expect(s.filter((x) => x === 'WILD')).toHaveLength(1));
    expect(new Set(GOLDRUSH.lineRows.map((l) => l.join(''))).size).toBe(40);
    for (const l of GOLDRUSH.lineRows) for (let r = 1; r < 5; r++) expect(Math.abs(l[r]! - l[r - 1]!)).toBeLessThanOrEqual(1);
  });
});

describe('Gold Rush lines', () => {
  const PAYING = Object.entries(GOLDRUSH.linePays) as [GoldSymbol, readonly number[]][];

  for (const [sym, pays] of PAYING) {
    for (const n of [2, 3, 4, 5] as const) {
      const pay = pays[n - 2]!;
      it(`${n} x ${sym} on line 1 pays ${pay}`, () => {
        const stops = [0, 1, 2, 3, 4].map((r) => (r < n ? stopFor(r, 1, sym) : plainStop(r, 1, [sym])));
        const line1 = lineWins(GOLDRUSH, GOLD_TABLES, stops).find((w) => w.line === 0);
        if (pay === 0) expect(line1).toBeUndefined();
        else expect(line1).toEqual({ line: 0, symbol: sym, count: n, pay });
      });
    }
  }

  it('WILD stands in on reels 2-5 and pays nothing itself', () => {
    const stops = [stopFor(0, 1, 'CART'), stopFor(1, 1, 'WILD'), stopFor(2, 1, 'WILD'), stopFor(3, 1, 'WILD'), stopFor(4, 1, 'WILD')];
    expect(lineWins(GOLDRUSH, GOLD_TABLES, stops).find((w) => w.line === 0)).toEqual({ line: 0, symbol: 'CART', count: 5, pay: 1000 });
    const mixed = [stopFor(0, 1, 'K'), stopFor(1, 1, 'K'), stopFor(2, 1, 'WILD'), plainStop(3, 1, ['K']), 0];
    expect(lineWins(GOLDRUSH, GOLD_TABLES, mixed).find((w) => w.line === 0)).toEqual({ line: 0, symbol: 'K', count: 3, pay: 12 });
  });

  it('a NUGGET never completes a line, and a line starting with one pays nothing', () => {
    const blocked = [stopFor(0, 1, 'PAN'), stopFor(1, 1, 'PAN'), stopFor(2, 1, 'NUGGET'), stopFor(3, 1, 'PAN'), stopFor(4, 1, 'PAN')];
    expect(lineWins(GOLDRUSH, GOLD_TABLES, blocked).find((w) => w.line === 0)).toBeUndefined();
    const starts = [stopFor(0, 1, 'NUGGET'), stopFor(1, 1, 'WILD'), stopFor(2, 1, 'WILD'), stopFor(3, 1, 'WILD'), stopFor(4, 1, 'WILD')];
    expect(lineWins(GOLDRUSH, GOLD_TABLES, starts).find((w) => w.line === 0)).toBeUndefined();
  });

  it('each line reads the rows the line table gives', () => {
    const stops = [3, 7, 12, 20, 29];
    GOLDRUSH.lineRows.forEach((rows, l) => {
      const read = rows.map((row, r) => at(r, stops[r]!, row));
      let n = 1;
      while (n < 5 && (read[n] === read[0] || read[n] === 'WILD')) n++;
      const pay = read[0] === 'NUGGET' ? 0 : (GOLDRUSH.linePays[read[0]!]?.[n - 2] ?? 0);
      expect(lineWins(GOLDRUSH, GOLD_TABLES, stops).filter((w) => w.line === l).reduce((t, w) => t + w.pay, 0)).toBe(pay);
    });
  });

  it('the detailed line wins add up to the fast scorer, held cells or not (200,000 random windows)', () => {
    const rng = seededRng(29);
    for (let i = 0; i < 200_000; i++) {
      const s = [0, 1, 2, 3, 4].map(() => rng.next32() % L) as [number, number, number, number, number];
      const held = i % 2 ? (rng.next32() & rng.next32() & 0xffff0) : 0; // reels 2-5 only
      const t = i % 4 < 2 ? GOLD_TABLES : GOLD_FREE_TABLES;
      const detail = lineWins(GOLDRUSH, t, s, held).reduce((a, w) => a + w.pay, 0);
      if (detail !== lineCredits(t, ...s, held)) throw new Error(`mismatch at ${s.join(',')} held ${held}`);
    }
  });

  it('a held cell reads WILD whatever the reel shows', () => {
    const stops = [stopFor(0, 1, 'PICK', true), plainStop(1, 1, ['PICK'], true), plainStop(2, 1, ['PICK'], true), plainStop(3, 1, ['PICK'], true), 0];
    expect(lineCredits(GOLD_FREE_TABLES, stops[0]!, stops[1]!, stops[2]!, stops[3]!, stops[4]!)).toBe(0);
    const held = cellBit(ROWS, 1, 1) | cellBit(ROWS, 2, 1) | cellBit(ROWS, 3, 1);
    const line1 = lineWins(GOLDRUSH, GOLD_FREE_TABLES, stops, held).find((w) => w.line === 0);
    expect(line1).toMatchObject({ symbol: 'PICK', pay: GOLDRUSH.linePays.PICK![at(4, 0, 1, true) === 'PICK' ? 3 : 2] });
    expect(heldCells(held)).toEqual([5, 9, 13]);
  });
});

describe('Gold Rush free games', () => {
  const nuggetStop = (r: number) => stopFor(r, 0, 'NUGGET');
  const noNugget = (r: number) => plainStop(r, 0, []);

  it('3, 4 and 5 NUGGETs anywhere start 8, 10 and 15 free games; fewer start none', () => {
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const stops = [0, 1, 2, 3, 4].map((r) => (r < k ? nuggetStop(r) : noNugget(r)));
      expect(scoreGoldRush(stops).nuggets).toBe(k);
      const rng = seededRng(k);
      const play = playGoldRush({ next32: (() => { const w = [...stops]; return () => (w.length ? w.shift()! : rng.next32()); })() });
      expect(play.free).toHaveLength(GOLDRUSH.freeGames[k]!);
    }
    const spread = [stopFor(0, 3, 'NUGGET'), stopFor(1, 2, 'NUGGET'), stopFor(2, 0, 'NUGGET'), noNugget(3), noNugget(4)];
    expect(scatterCount(GOLD_TABLES, spread)).toBe(3);
  });

  it('a WILD that lands sticks for every later free game, and the game pays with the held cells as WILD', () => {
    const trig = [0, 1, 2].map(nuggetStop).concat([noNugget(3), noNugget(4)]);
    // free game 1 lands the WILD of reel 3 in row 2; games 2-8 land nothing
    const plain = [0, 1, 2, 3, 4].map((r) => plainStop(r, 0, [], true));
    const land = [...plain];
    land[2] = stopFor(2, 2, 'WILD', true);
    const words = [...trig, ...land];
    for (let g = 2; g <= 8; g++) words.push(...plain);
    const play = playGoldRush(scripted(words));
    expect(play.free).toHaveLength(8);
    const bit = cellBit(ROWS, 2, 2);
    expect(play.free[0]).toMatchObject({ held: 0, landed: bit });
    for (const g of play.free.slice(1)) expect(g).toMatchObject({ held: bit, landed: 0 });
    for (const g of play.free) expect(g.credits).toBe(lineCredits(GOLD_FREE_TABLES, g.stops[0]!, g.stops[1]!, g.stops[2]!, g.stops[3]!, g.stops[4]!, g.held | g.landed));
    expect(play.credits).toBe(play.base.credits + play.free.reduce((a, g) => a + g.credits, 0));
    expect(wildsLanding(land)).toBe(bit);
  });

  it('the per-reel chance a cell reads a symbol or WILD in free game t matches brute force over every stop sequence', () => {
    // the closed form's building block: 1 - (1-q)^t + (1-q)^(t-1) f(X), for t = 1, 2, 3
    for (const r of [1, 2]) {
      const strip = GOLDRUSH.freeStrips[r]!;
      const q = strip.filter((x) => x === 'WILD').length / L;
      for (const t of [1, 2, 3]) {
        for (const x of ['CART', 'Q'] as const) {
          const f = strip.filter((y) => y === x).length / L;
          const row = 1;
          let hit = 0;
          const total = L ** t;
          for (let seq = 0; seq < total; seq++) {
            let stuck = false;
            let last = '';
            for (let g = 0, v = seq; g < t; g++, v = Math.floor(v / L)) {
              last = strip[(v % L + row) % L]!;
              if (last === 'WILD') stuck = true;
            }
            if (stuck || last === x) hit++;
          }
          expect(hit / total).toBeCloseTo(1 - (1 - q) ** t + (1 - q) ** (t - 1) * f, 12);
        }
      }
    }
  });
});

describe('Gold Rush exact return', () => {
  it('base game 66.902405% by enumerating all 32^5 windows; free games 26.091148% in closed form; 92.993553% in all', () => {
    const N = L ** 5, BET = GOLDRUSH.lines;
    const byK = new Float64Array(6);
    const s = [0, 0, 0, 0, 0];
    let lineSum = 0, sumSq = 0, hits = 0, top = 0, topWays = 0;
    for (s[0] = 0; s[0] < L; s[0]++)
      for (s[1] = 0; s[1] < L; s[1]++)
        for (s[2] = 0; s[2] < L; s[2]++)
          for (s[3] = 0; s[3] < L; s[3]++)
            for (s[4] = 0; s[4] < L; s[4]++) {
              const w = lineCredits(GOLD_TABLES, s[0], s[1], s[2], s[3], s[4]);
              const k = scatterCount(GOLD_TABLES, s);
              lineSum += w;
              sumSq += w * w;
              byK[k]!++;
              if (w > 0 || k >= GOLDRUSH.trigger) hits++;
              if (w > top) {
                top = w;
                topWays = 1;
              } else if (w === top) topWays++;
            }
    const EW = lineSum / N / BET;
    const sdBase = Math.sqrt(sumSq / N / BET / BET - EW * EW);
    let feature = 0, pT = 0;
    const values = GOLDRUSH.freeGames.map((g) => featureValue(g));
    for (let k = GOLDRUSH.trigger; k <= 5; k++) {
      feature += (byK[k]! / N) * values[k]!;
      pT += byK[k]! / N;
    }
    const pct = (x: number, d = 6) => (x * 100).toFixed(d);
    console.log(`Gold Rush: base ${pct(EW)}%, free games ${pct(feature)}%, total ${pct(EW + feature)}%, hits ${pct(hits / N, 4)}%, base SD ${sdBase.toFixed(4)}`);

    expect(lineSum / BET).toBe(22_448_722); // per line, of 32^5
    expect(pct(EW)).toBe('66.902405');
    expect([...byK]).toEqual([17_210_368, 12_293_120, 3_512_320, 501_760, 35_840, 1_024]);
    expect((1 / pT).toFixed(2)).toBe('62.30');
    expect(values.slice(3).map((v) => v.toFixed(6))).toEqual(['15.397699', '26.508102', '76.891374']);
    expect(pct(feature)).toBe('26.091148');
    expect(pct(EW + feature)).toBe('92.993553');
    expect(pct(hits / N, 4)).toBe('47.1153');
    expect(sdBase.toFixed(4)).toBe('1.6239');
    expect([top, topWays]).toEqual([2367, 1]);
  }, 180_000);

  it('the base line return from symbol counts alone (every line sees the same distribution)', () => {
    const f = (r: number, x: string) => GOLDRUSH.strips[r]!.filter((y) => y === x).length;
    let num = 0;
    for (const [x, pays] of Object.entries(GOLDRUSH.linePays)) {
      const ge = [0, f(0, x)];
      for (let r = 1; r < 5; r++) ge.push(ge[r]! * (f(r, x) + f(r, 'WILD')));
      for (let n = 3; n <= 5; n++) num += pays![n - 2]! * (ge[n]! * L ** (5 - n) - (n < 5 ? ge[n + 1]! * L ** (4 - n) : 0));
    }
    expect(num).toBe(22_448_722);
  });
});

describe('Gold Rush draws', () => {
  it('base and free stops are uniform over 0-31 (chi-square)', () => {
    const rng = seededRng(37);
    const base = Array.from({ length: 5 }, () => new Array<number>(L).fill(0));
    const free = Array.from({ length: 5 }, () => new Array<number>(L).fill(0));
    for (let i = 0; i < 200_000; i++) {
      const p = playGoldRush(rng);
      p.base.stops.forEach((s, r) => base[r]![s]!++);
      for (const g of p.free) g.stops.forEach((s, r) => free[r]![s]!++);
    }
    // 31 degrees of freedom: the 99.99th percentile is about 70
    for (const c of [...base, ...free]) expect(chiSquareUniform(c)).toBeLessThan(70);
  });
});

describe('Gold Rush on the engine', () => {
  const sim = (stack: number, rng: Rng) => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }], engine.config('goldrush', 'solo'));

  it('config: 40 lines, 1-5 credits a line at 1, 5 or 10 cents', () => {
    const cfg = engine.config('goldrush', 'solo');
    expect(cfg.limits.default).toEqual({ min: 40, max: 2000, step: 40 });
    expect(cfg.options).toEqual({ machine: 'goldrush', denoms: [1, 5, 10], maxCoins: 5, lines: 40 });
  });

  it('a feature pays with the paid spin: one reels event per free game, the held cells growing, the base window back after', () => {
    const trig = [0, 1, 2, 3, 4].map((r) => stopFor(r, 0, 'NUGGET'));
    const rng = seededRng(99);
    const words = [0, 0, 0, 0, 0, ...trig];
    const mixed: Rng = { next32: () => (words.length ? words.shift()! : rng.next32()) };
    const t = sim(1_000_000, mixed);
    t.act(0, { type: 'spin', coins: 3, denom: 5 });
    const evs = t.lastEvents as (ReelsEvent | ResultEvent)[];
    const reels = evs.filter((e): e is ReelsEvent => e.type === 'reels');
    const result = evs.at(-1) as ResultEvent;
    expect(reels[0]).toMatchObject({ spin: 0, trigger: true, scatters: 5, freeLeft: 15 });
    expect(result.freeSpins).toBe(15);
    expect(reels).toHaveLength(16);
    let held = new Set<number>();
    reels.slice(1).forEach((r, i) => {
      expect(r).toMatchObject({ spin: i + 1, freeLeft: 15 - i - 1, multiplier: 1 });
      const now = new Set(r.held);
      for (const c of held) expect(now.has(c)).toBe(true);
      for (const c of now) expect(c).toBeGreaterThanOrEqual(ROWS); // never on reel 1
      held = now;
    });
    for (const r of reels) {
      expect(r.win).toBe(r.lines.reduce((a, l) => a + l.win, 0));
      expect(r.win % 15).toBe(0);
    }
    expect(result.win).toBe(reels.reduce((a, r) => a + r.win, 0));
    expect(result.freeWin).toBe(result.win - reels[0]!.win);
    expect(t.stack(0)).toBe(1_000_000 - 600 + result.win);
    expect(t.rounds).toEqual([{ seat: 0, wagered: 600, returned: result.win }]);
    expect((t.view(0) as SlotsView).stops).toEqual(trig);
  });

  it('money adds up over thousands of spins', () => {
    const t = sim(10_000_000, seededRng(43));
    for (let i = 0; i < 2000; i++) t.act(0, { type: 'spin', coins: 1 + (i % 5), denom: GOLDRUSH.denoms[i % 3]! });
    const net = t.rounds.reduce((s, r) => s + r.returned - r.wagered, 0);
    expect(t.stack(0)).toBe(10_000_000 + net);
    expect(engine.liveBets(t.state, 0)).toBe(0);
  });
});
