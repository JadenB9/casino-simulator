// Straw, Sticks & Bricks cell by cell and in full: the line pays, the WOLF and the houses on the
// lines, the Blowdown step by step from a script, the published PAR sheet (the base game by exact
// enumeration of all 30^5 windows through the engine's own line scorer; the Blowdown by the exact
// recursion, itself checked against an exhaustive walk of every draw sequence on small grids),
// the unbiased draws, and spins through the engine settled to the cent.

import { describe, it, expect } from 'vitest';
import type { Rng } from '../src/rng.ts';
import { engine } from '../src/games/slots/engine.ts';
import { PIGS, PIG_TABLES, blowdownExact, housesIn, playBlowdown, playPigs, scorePigs, type BlowdownRules, type Grade, type PigSymbol } from '../src/games/slots/pigs.ts';
import { lineCredits, lineWins, symbolAt } from '../src/games/slots/lines.ts';
import type { ReelsEvent, ResultEvent } from '../src/games/slots/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

const L = 30;

async function doc(): Promise<Record<string, unknown>> {
  const path = '../../docs/math/slot-g-straw-sticks-bricks.mjs';
  return (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
}

const at = (reel: number, stop: number, row: number) => symbolAt(PIGS.strips, reel, stop, row);
const HOUSE = new Set<string>(['STRAW', 'STICKS', 'BRICK']);

function stopFor(reel: number, row: number, sym: PigSymbol): number {
  for (let s = 0; s < L; s++) if (at(reel, s, row) === sym) return s;
  throw new Error(`no ${sym} on reel ${reel + 1}`);
}

/** A stop whose `row` is none of `avoid` and shows no house and no WOLF anywhere. */
function plainStop(reel: number, row: number, avoid: PigSymbol[]): number {
  for (let s = 0; s < L; s++) {
    if (avoid.includes(at(reel, s, row))) continue;
    if ([0, 1, 2].some((k) => HOUSE.has(at(reel, s, k)) || at(reel, s, k) === 'WOLF')) continue;
    return s;
  }
  throw new Error('no such stop');
}

/** Draws from a list, then fails loudly. */
function script(words: number[]): (n: number) => number {
  let i = 0;
  return (n) => {
    if (i >= words.length) throw new Error('script ran out');
    const x = words[i++]!;
    if (x >= n) throw new Error(`scripted ${x} for a draw below ${n}`);
    return x;
  };
}

class Branch {
  constructor(readonly n: number) {}
}

/** Every draw sequence playBlowdown can take from `start`, weighted exactly: mean total and street chance. */
function walkAll(start: (Grade | null)[], b: BlowdownRules): { mean: number; street: number; leaves: number } {
  let mean = 0, street = 0, leaves = 0;
  const walk = (path: number[], prob: number) => {
    let i = 0;
    let play;
    try {
      play = playBlowdown((n) => {
        if (i < path.length) return path[i++]!;
        throw new Branch(n);
      }, start, b);
    } catch (e) {
      if (!(e instanceof Branch)) throw e;
      for (let x = 0; x < e.n; x++) walk([...path, x], prob / e.n);
      return;
    }
    leaves++;
    mean += prob * play.total;
    if (play.street) street += prob;
  };
  walk([], 1);
  return { mean, street, leaves };
}

describe('Straw, Sticks & Bricks data', () => {
  it('matches the published script stop for stop', async () => {
    const d = await doc();
    expect([...PIGS.symbols]).toEqual(d.SYMBOLS);
    expect(PIGS.strips).toEqual(d.STRIPS);
    expect(PIGS.lineRows).toEqual(d.LINES);
    const pays = d.LINE_PAYS as Record<string, number[]>;
    expect(PIGS.linePays).toEqual(Object.fromEntries(Object.entries(pays).map(([k, v]) => [k, [0, ...v]])));
    expect(PIGS.trigger).toBe(d.TRIGGER);
    expect(PIGS.bonus).toEqual(d.BONUS);
  });

  it('30-stop strips; no WOLF on reel 1; 20 distinct lines; grades land as straw, sticks or brick and rebuild up to the mansion', () => {
    for (const s of PIGS.strips) expect(s).toHaveLength(30);
    expect(PIGS.strips[0]).not.toContain('WOLF');
    expect(new Set(PIGS.lineRows.map((l) => l.join(''))).size).toBe(20);
    const b = PIGS.bonus;
    expect(b.grade.reduce((a, x) => a + x, 0)).toBe(b.gradeDen);
    expect(b.upgrade).toHaveLength(b.prizes.length);
    expect(b.upgrade.at(-1)).toBe(0);
    for (const u of b.upgrade) expect(u).toBeLessThan(b.upgradeDen);
  });
});

describe('Straw, Sticks & Bricks lines', () => {
  for (const [sym, pays] of Object.entries(PIGS.linePays) as [PigSymbol, readonly number[]][]) {
    for (const n of [3, 4, 5] as const) {
      it(`${n} x ${sym} on line 1 pays ${pays[n - 2]}`, () => {
        const stops = [0, 1, 2, 3, 4].map((r) => (r < n ? stopFor(r, 1, sym) : plainStop(r, 1, [sym])));
        expect(lineWins(PIGS, PIG_TABLES, stops).find((w) => w.line === 0)).toEqual({ line: 0, symbol: sym, count: n, pay: pays[n - 2] });
      });
    }
  }

  it('the WOLF stands in for a pig or a picture on reels 2-5 and pays nothing itself', () => {
    const stops = [stopFor(0, 1, 'BRICKPIG'), stopFor(1, 1, 'WOLF'), stopFor(2, 1, 'WOLF'), stopFor(3, 1, 'WOLF'), stopFor(4, 1, 'WOLF')];
    expect(lineWins(PIGS, PIG_TABLES, stops).find((w) => w.line === 0)).toEqual({ line: 0, symbol: 'BRICKPIG', count: 5, pay: 800 });
  });

  it('a house never pays on a line and ends one, and the WOLF never makes a house pay', () => {
    const broken = [stopFor(0, 1, 'POT'), stopFor(1, 1, 'POT'), stopFor(2, 1, 'STRAW'), stopFor(3, 1, 'POT'), stopFor(4, 1, 'POT')];
    expect(lineWins(PIGS, PIG_TABLES, broken).find((w) => w.line === 0)).toBeUndefined();
    for (const h of ['STRAW', 'STICKS'] as const) {
      const starts = [stopFor(0, 1, h), stopFor(1, 1, 'WOLF'), stopFor(2, 1, 'WOLF'), stopFor(3, 1, 'WOLF'), stopFor(4, 1, 'WOLF')];
      expect(lineWins(PIGS, PIG_TABLES, starts).find((w) => w.line === 0)).toBeUndefined();
    }
  });

  it('the detailed line wins add up to the fast scorer (100,000 random windows)', () => {
    const rng = seededRng(71);
    for (let i = 0; i < 100_000; i++) {
      const s = [0, 1, 2, 3, 4].map(() => rng.next32() % L) as [number, number, number, number, number];
      const detail = lineWins(PIGS, PIG_TABLES, s).reduce((a, w) => a + w.pay, 0);
      if (detail !== lineCredits(PIG_TABLES, ...s)) throw new Error(`mismatch at ${s.join(',')}`);
    }
  });
});

describe('the Blowdown', () => {
  it('six houses anywhere start it; five do not', () => {
    // reel 1 at stop 3 shows STRAW STRAW STICKS and reel 3 STRAW STRAW BRICK: six houses
    const six = [3, plainStop(1, 0, []), 3, plainStop(3, 0, []), plainStop(4, 0, [])];
    expect(housesIn(six)).toEqual([0, 0, 1, null, null, null, 0, 0, 2, null, null, null, null, null, null]);
    expect(scorePigs(six)).toMatchObject({ houses: 6, trigger: true });
    const five = [4, plainStop(1, 0, []), 3, plainStop(3, 0, []), plainStop(4, 0, [])];
    expect(scorePigs(five)).toMatchObject({ houses: 5, trigger: false });
  });

  it('plays a script: rebuilds before the spin, a house landing puts the count back to three, the wolf blows each down for its prize', () => {
    const start: (Grade | null)[] = [0, 0, 1, 2, 0, 0, ...new Array<null>(9).fill(null)];
    const words: number[] = [];
    // spin 1: house 0 rebuilt (straw -> sticks), the others not; cell 6 builds a brick, the rest nothing
    words.push(0, 199, 199, 199, 199, 199);
    words.push(0, 9); // cell 6 lands, grade draw 9 -> brick
    for (let c = 7; c < 15; c++) words.push(24);
    // spins 2-4: nothing rebuilt, nothing built (7 houses, 8 empty)
    for (let s = 0; s < 3; s++) {
      for (let h = 0; h < 7; h++) words.push(199);
      for (let c = 0; c < 8; c++) words.push(24);
    }
    // prizes in cell order: 7 houses
    words.push(5, 0, 0, 0, 1, 5, 5);
    const play = playBlowdown(script(words), start);
    expect(play.spins).toEqual([
      { rebuilt: [0], landed: [[6, 2]], left: 3 },
      { rebuilt: [], landed: [], left: 2 },
      { rebuilt: [], landed: [], left: 1 },
      { rebuilt: [], landed: [], left: 0 },
    ]);
    // cell 0 sticks (list[5] = 8), cell 1 straw (1), cell 2 sticks (2), cell 3 brick (5), cell 4 straw (1), cell 5 straw (3), cell 6 brick (20)
    expect(play.houses).toEqual([[0, 1, 8], [1, 0, 1], [2, 1, 2], [3, 2, 5], [4, 0, 1], [5, 0, 3], [6, 2, 20]]);
    expect(play.total).toBe(40);
    expect(play.street).toBe(false);
  });

  it('a brick is rebuilt into the gold mansion, and all fifteen built pays the Whole Street on top, ending at once', () => {
    const start: (Grade | null)[] = [2, ...new Array<Grade>(13).fill(0), null];
    const words: number[] = [0]; // the brick: rebuilt
    for (let h = 1; h < 14; h++) words.push(199);
    words.push(0, 0); // cell 14 builds a straw house: the street is full
    for (let h = 0; h < 15; h++) words.push(0); // prizes: each list's first
    const play = playBlowdown(script(words), start);
    expect(play.spins).toEqual([{ rebuilt: [0], landed: [[14, 0]], left: 3 }]);
    expect(play.houses[0]).toEqual([0, 3, 50]);
    expect(play.street).toBe(true);
    expect(play.total).toBe(50 + 14 * 1 + 1000);
  });

  it('the recursion matches an exhaustive walk of every draw sequence on small grids', () => {
    const tiny: BlowdownRules = {
      cells: 3,
      respins: 2,
      land: [1, 3],
      grade: [1, 1],
      gradeDen: 2,
      upgrade: [1, 1, 0],
      upgradeDen: 3,
      prizes: [[1, 2], [3, 5], [9]],
      street: 7,
    };
    const x = blowdownExact(tiny);
    const starts: (Grade | null)[][] = [[0, null, null], [null, 1, null], [0, 1, null], [2, null, 0], [1, 1, null]];
    for (const start of starts) {
      const w = walkAll(start, tiny);
      const n = [0, 1, 2].map((g) => start.filter((s) => s === g).length);
      expect(x.value(n)).toBeCloseTo(w.mean, 10);
      expect(x.street(n[0]! + n[1]! + n[2]!)).toBeCloseTo(w.street, 10);
      expect(w.leaves).toBeGreaterThan(100);
    }
  });
});

describe('Straw, Sticks & Bricks exact return', () => {
  it('line wins 63.7104%, the Blowdown 30.9748%, 94.6852% in all, by every one of the 30^5 windows', () => {
    const N = L ** 5, BET = PIGS.lines;
    const X = blowdownExact();
    const per = PIGS.strips.map((_, r) => Array.from({ length: L }, (_, s) => {
      const c = [0, 0, 0];
      for (const g of housesIn([0, 0, 0, 0, 0].map((z, rr) => (rr === r ? s : z))).slice(r * 3, r * 3 + 3)) if (g !== null) c[g]!++;
      return c;
    }));
    const s = [0, 0, 0, 0, 0];
    let lineSum = 0, hits = 0, triggers = 0, bonus = 0, street = 0, top = 0;
    const n = [0, 0, 0];
    for (s[0] = 0; s[0] < L; s[0]++)
      for (s[1] = 0; s[1] < L; s[1]++)
        for (s[2] = 0; s[2] < L; s[2]++)
          for (s[3] = 0; s[3] < L; s[3]++)
            for (s[4] = 0; s[4] < L; s[4]++) {
              const w = lineCredits(PIG_TABLES, s[0], s[1], s[2], s[3], s[4]);
              lineSum += w;
              if (w > top) top = w;
              n[0] = n[1] = n[2] = 0;
              for (let r = 0; r < 5; r++) {
                const c = per[r]![s[r]!]!;
                n[0] += c[0]!;
                n[1] += c[1]!;
                n[2] += c[2]!;
              }
              const k = n[0] + n[1] + n[2];
              if (k >= PIGS.trigger) {
                triggers++;
                bonus += X.value(n);
                street += X.street(k);
              }
              if (w > 0 || k >= PIGS.trigger) hits++;
            }
    const base = lineSum / N / BET;
    const pct = (x: number, d = 6) => (x * 100).toFixed(d);
    console.log(`Straw, Sticks & Bricks: lines ${pct(base)}%, Blowdown ${pct(bonus / N)}%, total ${pct(base + bonus / N)}%, hits ${pct(hits / N, 4)}%, street 1 in ${Math.round(N / street)}`);
    expect(lineSum / BET).toBe(15_481_630); // per line, of 30^5
    expect(pct(base)).toBe('63.710412');
    expect(pct(bonus / N)).toBe('30.974758');
    expect(pct(base + bonus / N)).toBe('94.685170');
    expect(triggers).toBe(212_112);
    expect((N / triggers).toFixed(2)).toBe('114.56');
    expect(pct(hits / N, 4)).toBe('51.7180');
    expect(Math.round(N / street)).toBe(235_070);
    expect(top).toBe(1900);
    // the machine's published figures say the same
    const pub = Object.fromEntries(PIGS.published);
    expect(pub['Return to player']).toBe('94.6852% (Blowdown included)');
    expect(pub['Line wins']).toBe('63.7104%');
    expect(pub['Blowdown']).toBe('30.9748%, started 1 in 114.56 paid spins');
    expect(pub['Hit frequency']).toBe('51.7180% (1 in 1.93 spins)');
    expect(pub['Whole Street']).toBe('1 in 235,070 paid spins');
  }, 180_000);

  it('the line return from symbol counts alone, and from the published script', async () => {
    const d = await doc();
    expect(((d.baseLineFromCounts as () => number)() * 100).toFixed(6)).toBe('63.710412');
    // the script's own recursion agrees with the engine's
    const bd = (d.blowdown as () => { h: number[][][]; v: number[][]; f: number[][] })();
    const X = blowdownExact();
    for (let k = 6; k <= 15; k++) {
      expect(bd.v[k]![3]).toBeCloseTo(X.v(k, 3), 12);
      expect(bd.f[k]![3]).toBeCloseTo(X.f(k, 3), 15);
      bd.h[k]![3]!.forEach((h, g) => expect(h).toBeCloseTo(X.h(k, 3)[g]!, 12));
    }
  });
});

describe('Straw, Sticks & Bricks draws', () => {
  it('stops are uniform over 0-29 (chi-square), and the Blowdown\'s own draws land houses 1 in 25', () => {
    const rng = seededRng(73);
    const counts = Array.from({ length: 5 }, () => new Array<number>(L).fill(0));
    let tries = 0, built = 0;
    for (let i = 0; i < 150_000; i++) {
      const p = playPigs(rng);
      p.base.stops.forEach((s, r) => counts[r]![s]!++);
      if (p.bonus) {
        let empty = 15 - p.bonus.start.length;
        for (const s of p.bonus.spins) {
          tries += empty;
          built += s.landed.length;
          empty -= s.landed.length;
        }
      }
    }
    // 29 degrees of freedom: the 99.99th percentile is about 66
    for (const c of counts) expect(chiSquareUniform(c)).toBeLessThan(66);
    const rate = built / tries;
    expect(Math.abs(rate - 1 / 25)).toBeLessThan(4 * Math.sqrt((1 / 25) * (24 / 25) / tries));
  });
});

describe('Straw, Sticks & Bricks on the engine', () => {
  const sim = (stack: number, rng: Rng) => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }], engine.config('pigs', 'solo'));

  it('config: 20 lines, 1-5 credits a line at 1, 5 or 25 cents, $1 or $5, or the high-limit $25, $100 and $500', () => {
    const cfg = engine.config('pigs', 'solo');
    // five credits a line on twenty lines of $500: $50,000 a spin
    expect(cfg.limits.default).toEqual({ min: 20, max: 5_000_000, step: 20 });
    expect(cfg.options).toEqual({ machine: 'pigs', denoms: [1, 5, 25, 100, 500, 2500, 10_000, 50_000], maxCoins: 5, lines: 20 });
  });

  it('a Blowdown pays with the paid spin: every house and the street in whole bets, to the cent', () => {
    // a window with six houses, then the rest of the draws from a seeded generator
    const trig = [3, plainStop(1, 0, []), 3, plainStop(3, 0, []), plainStop(4, 0, [])];
    const rng = seededRng(5);
    const words = [0, 0, 0, 0, 0, ...trig];
    const mixed: Rng = { next32: () => (words.length ? words.shift()! : rng.next32()) };
    const t = sim(10_000_000, mixed);
    t.act(0, { type: 'spin', coins: 3, denom: 25 });
    const bet = 20 * 3 * 25;
    const evs = t.lastEvents as (ReelsEvent | ResultEvent)[];
    const reels = evs.filter((e): e is ReelsEvent => e.type === 'reels');
    const result = evs.at(-1) as ResultEvent;
    expect(reels).toHaveLength(1);
    const e = reels[0]!;
    expect(e).toMatchObject({ trigger: true, scatters: 6, stops: trig });
    const bd = e.blowdown!;
    expect(bd.start).toEqual([[0, 0], [1, 0], [2, 1], [6, 0], [7, 0], [8, 2]]);
    expect(bd.houses.length).toBeGreaterThanOrEqual(6);
    for (const [, grade, win] of bd.houses) {
      expect(win % bet).toBe(0);
      expect(PIGS.bonus.prizes[grade]).toContain(win / bet);
    }
    expect(bd.win).toBe(bd.houses.reduce((a, [, , w]) => a + w, 0) + bd.street);
    expect(e.win).toBe(e.lines.reduce((a, l) => a + l.win, 0) + bd.win);
    expect(result.win).toBe(e.win);
    expect(t.stack(0)).toBe(10_000_000 - bet + result.win);
    expect(t.rounds).toEqual([{ seat: 0, wagered: bet, returned: result.win }]);
    // the spins count down to the end, back to three after each house built
    let left = PIGS.bonus.respins;
    for (const s of bd.spins) {
      expect(s.left).toBe(s.landed.length ? 3 : left - 1);
      left = s.left;
    }
    expect(left === 0 || bd.street > 0).toBe(true);
  });

  it('money adds up over thousands of spins', () => {
    const t = sim(100_000_000, seededRng(79));
    for (let i = 0; i < 3000; i++) t.act(0, { type: 'spin', coins: 1 + (i % 5), denom: PIGS.denoms[i % 4]! });
    const net = t.rounds.reduce((s, r) => s + r.returned - r.wagered, 0);
    expect(t.stack(0)).toBe(100_000_000 + net);
    expect(engine.liveBets(t.state, 0)).toBe(0);
  });
});
