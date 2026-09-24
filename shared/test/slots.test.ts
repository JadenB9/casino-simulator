// Slot rules cell by cell and the engine's contract: every pay glass row and every Neon Nights
// line pay, the wild, scatter and free-game rules, the unbiased stop draws, and a spin's chips,
// events, round result and view.

import { describe, it, expect } from 'vitest';
import type { Rng } from '../src/rng.ts';
import { engine, type SlotsState } from '../src/games/slots/engine.ts';
import { MACHINES, NEON, SEVENS, WILD, betOf, type NeonSymbol, type SevensSymbol, type WildSymbol } from '../src/games/slots/machines.ts';
import {
  neonLineCredits,
  neonLineWins,
  neonScatters,
  neonSymbolAt,
  playNeon,
  scoreNeon,
  scoreSevens,
  scoreWild,
  sevensPayAt,
  spinNeon,
  spinSevens,
  spinWild,
  virtualReel,
  wildPayAt,
} from '../src/games/slots/rules.ts';
import type { ReelsEvent, ResultEvent, SlotsView, SpinEvent } from '../src/games/slots/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';

/** An Rng that returns these words in order (randInt(n) of a word below n is the word itself). */
function scripted(words: number[]): Rng {
  let i = 0;
  return {
    next32() {
      if (i >= words.length) throw new Error('scripted rng ran out');
      return words[i++]!;
    },
  };
}

/** The first physical stop on a stepper reel showing `sym`, and a virtual stop that maps to it. */
function stepperStop<S extends string>(m: { reels: readonly (readonly (readonly [S, number])[])[] }, reel: number, sym: S): { stop: number; virtual: number } {
  const stop = m.reels[reel]!.findIndex(([s]) => s === sym);
  if (stop < 0) throw new Error(`no ${sym} on reel ${reel + 1}`);
  return { stop, virtual: virtualReel(m.reels[reel]!).indexOf(stop) };
}

/** A Neon Nights stop that puts `sym` in `row` of `reel`. */
function neonStop(reel: number, row: number, sym: NeonSymbol): number {
  for (let s = 0; s < 32; s++) if (neonSymbolAt(reel, s, row) === sym) return s;
  throw new Error(`no ${sym} on reel ${reel + 1}`);
}

/** A Neon Nights stop whose middle row is none of `avoid`. */
function neonStopAvoiding(reel: number, avoid: NeonSymbol[]): number {
  for (let s = 0; s < 32; s++) if (!avoid.includes(neonSymbolAt(reel, s, 1))) return s;
  throw new Error('no such stop');
}

describe('Classic Sevens pay glass', () => {
  const cases: [SevensSymbol, SevensSymbol, SevensSymbol, string | null, number][] = [
    ['7', '7', '7', 'three7', 1000],
    ['3B', '3B', '3B', 'three3B', 100],
    ['2B', '2B', '2B', 'three2B', 50],
    ['1B', '1B', '1B', 'three1B', 20],
    ['3B', '1B', '2B', 'anyBar', 5],
    ['1B', '1B', '3B', 'anyBar', 5],
    ['CH', 'CH', 'CH', 'threeCH', 20],
    ['CH', 'CH', 'BL', 'twoCH', 5],
    ['CH', 'CH', '7', 'twoCH', 5],
    ['CH', 'BL', 'CH', 'oneCH', 2],
    ['CH', '7', '7', 'oneCH', 2],
    ['BL', 'CH', 'CH', null, 0],
    ['7', '7', 'BL', null, 0],
    ['7', '1B', '1B', null, 0],
    ['3B', '3B', 'CH', null, 0],
    ['BL', 'BL', 'BL', null, 0],
  ];
  for (const [a, b, c, combo, pay] of cases) {
    it(`${a} ${b} ${c} pays ${pay}`, () => expect(scoreSevens(a, b, c)).toEqual({ combo, pay }));
  }

  it('three cherries pay 20, not the 5 for two', () => expect(scoreSevens('CH', 'CH', 'CH').pay).toBe(20));

  it('every glass row is reachable on the real reels', () => {
    for (const row of SEVENS.pays) {
      const syms: Record<string, [SevensSymbol, SevensSymbol, SevensSymbol]> = {
        three7: ['7', '7', '7'], three3B: ['3B', '3B', '3B'], three2B: ['2B', '2B', '2B'], three1B: ['1B', '1B', '1B'],
        anyBar: ['3B', '2B', '1B'], threeCH: ['CH', 'CH', 'CH'], twoCH: ['CH', 'CH', 'BL'], oneCH: ['CH', 'BL', 'BL'],
      };
      const stops = syms[row.combo]!.map((s, r) => stepperStop(SEVENS, r, s).stop);
      expect(sevensPayAt(stops)).toEqual({ combo: row.combo, pay: row.pay });
    }
  });
});

describe('5x Wild pay glass', () => {
  const cases: [WildSymbol, WildSymbol, WildSymbol, string | null, number, number][] = [
    ['WX', 'WX', 'WX', 'threeWX', 3, 5000],
    ['7', '7', '7', 'three7', 0, 100],
    ['WX', '7', '7', 'three7', 1, 500],
    ['7', 'WX', 'WX', 'three7', 2, 2500],
    ['WX', 'WX', '7', 'three7', 2, 2500],
    ['3B', '3B', '3B', 'three3B', 0, 40],
    ['3B', 'WX', '3B', 'three3B', 1, 200],
    ['WX', '3B', 'WX', 'three3B', 2, 1000],
    ['2B', '2B', '2B', 'three2B', 0, 25],
    ['2B', '2B', 'WX', 'three2B', 1, 125],
    ['WX', 'WX', '2B', 'three2B', 2, 625],
    ['1B', '1B', '1B', 'three1B', 0, 10],
    ['1B', 'WX', '1B', 'three1B', 1, 50],
    ['1B', 'WX', 'WX', 'three1B', 2, 250],
    ['1B', '2B', '3B', 'anyBar', 0, 5],
    ['WX', '1B', '3B', 'anyBar', 1, 25],
    ['WX', 'WX', 'BL', 'twoWX', 2, 10],
    ['BL', 'WX', 'WX', 'twoWX', 2, 10],
    ['WX', 'BL', 'BL', 'oneWX', 1, 2],
    ['7', '7', 'WX', 'three7', 1, 500],
    ['WX', '7', '3B', 'oneWX', 1, 2],
    ['7', '7', 'BL', null, 0, 0],
    ['7', '1B', '1B', null, 0, 0],
    ['BL', 'BL', 'BL', null, 0, 0],
  ];
  for (const [a, b, c, combo, wilds, pay] of cases) {
    it(`${a} ${b} ${c} pays ${pay}`, () => expect(scoreWild(a, b, c)).toEqual({ combo, wilds, pay }));
  }

  it('a 5X with two single bars pays the single-bar row x5 (50), not any bars x5 (25)', () => expect(scoreWild('1B', '1B', 'WX').pay).toBe(50));

  it('5X 5X Seven pays 2,500 and 5X 5X blank pays 10 on the real reels', () => {
    const wx = [0, 1, 2].map((r) => stepperStop(WILD, r, 'WX').stop);
    const seven = stepperStop(WILD, 2, '7').stop;
    const blank = stepperStop(WILD, 2, 'BL').stop;
    expect(wildPayAt([wx[0]!, wx[1]!, seven]).pay).toBe(2500);
    expect(wildPayAt([wx[0]!, wx[1]!, blank]).pay).toBe(10);
    expect(wildPayAt(wx).pay).toBe(5000);
  });
});

describe('Neon Nights lines', () => {
  const PAYING = Object.entries(NEON.linePays) as [NeonSymbol, readonly [number, number, number]][];

  it('each line reads the rows the line table gives', () => {
    const stops = [3, 7, 12, 20, 29];
    NEON.lineRows.forEach((rows, l) => {
      const read = rows.map((row, r) => neonSymbolAt(r, stops[r]!, row));
      const wins = neonLineWins(stops).filter((w) => w.line === l);
      // a win on this line is exactly the run of the reel-1 symbol (or WILD) from the left
      let n = 1;
      while (n < 5 && (read[n] === read[0] || read[n] === 'WILD')) n++;
      const pay = n >= 3 && read[0] !== 'SCATTER' ? NEON.linePays[read[0]!]![n - 3]! : 0;
      expect(wins.reduce((t, w) => t + w.pay, 0)).toBe(pay);
    });
  });

  for (const [sym, pays] of PAYING) {
    for (const n of [3, 4, 5] as const) {
      it(`${n} x ${sym} on line 1 pays ${pays[n - 3]}`, () => {
        const stops = [0, 1, 2, 3, 4].map((r) => (r < n ? neonStop(r, 1, sym) : neonStopAvoiding(r, [sym, 'WILD'])));
        const line1 = neonLineWins(stops).find((w) => w.line === 0);
        expect(line1).toEqual({ line: 0, symbol: sym, count: n, pay: pays[n - 3] });
      });
    }
  }

  it('WILD substitutes on reels 2-5 and pays nothing on its own', () => {
    const stops = [neonStop(0, 1, 'BELL'), neonStop(1, 1, 'WILD'), neonStop(2, 1, 'WILD'), neonStop(3, 1, 'WILD'), neonStop(4, 1, 'WILD')];
    expect(neonLineWins(stops).find((w) => w.line === 0)).toEqual({ line: 0, symbol: 'BELL', count: 5, pay: 250 });
    const mixed = [neonStop(0, 1, 'K'), neonStop(1, 1, 'WILD'), neonStop(2, 1, 'K'), neonStopAvoiding(3, ['K', 'WILD']), 0];
    expect(neonLineWins(mixed).find((w) => w.line === 0)).toEqual({ line: 0, symbol: 'K', count: 3, pay: 10 });
  });

  it('a SCATTER never completes a line, and a line starting with one pays nothing', () => {
    const blocked = [neonStop(0, 1, 'Q'), neonStop(1, 1, 'Q'), neonStop(2, 1, 'SCATTER'), neonStop(3, 1, 'Q'), neonStop(4, 1, 'Q')];
    expect(neonLineWins(blocked).find((w) => w.line === 0)).toBeUndefined();
    const starts = [neonStop(0, 1, 'SCATTER'), neonStop(1, 1, 'WILD'), neonStop(2, 1, 'WILD'), neonStop(3, 1, 'WILD'), neonStop(4, 1, 'WILD')];
    expect(neonLineWins(starts).find((w) => w.line === 0)).toBeUndefined();
  });

  it('two of a kind pays nothing', () => {
    const stops = [neonStop(0, 1, 'DIAMOND'), neonStop(1, 1, 'DIAMOND'), neonStopAvoiding(2, ['DIAMOND', 'WILD']), 0, 0];
    expect(neonLineWins(stops).find((w) => w.line === 0)).toBeUndefined();
  });

  it('the detailed line wins always add up to the fast scorer (500,000 random windows)', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 500_000; i++) {
      const s = [0, 1, 2, 3, 4].map(() => rng.next32() % 32) as [number, number, number, number, number];
      const detail = neonLineWins(s).reduce((t, w) => t + w.pay, 0);
      if (detail !== neonLineCredits(...s)) throw new Error(`mismatch at ${s.join(',')}`);
    }
  });
});

describe('Neon Nights scatters and free games', () => {
  const scatterStop = (r: number) => neonStop(r, 0, 'SCATTER');

  it('3, 4 and 5 scatters anywhere pay 2, 10 and 50 x the total bet and start free games', () => {
    // each strip has one SCATTER; stopping 3 past it keeps it out of the window
    const without = (r: number) => (scatterStop(r) + 3) % 32;
    for (const k of [2, 3, 4, 5]) {
      const sp = scoreNeon([0, 1, 2, 3, 4].map((r) => (r < k ? scatterStop(r) : without(r))));
      expect(sp.scatters).toBe(k);
      expect(sp.scatterCredits).toBe((NEON.scatterPays[k] ?? 0) * 20);
      expect(sp.trigger).toBe(k >= 3);
    }
    // anywhere: middle and bottom rows count too
    const spread = scoreNeon([neonStop(0, 2, 'SCATTER'), neonStop(1, 1, 'SCATTER'), neonStop(2, 0, 'SCATTER'), without(3), without(4)]);
    expect(spread.scatters).toBe(3);
    expect(spread.scatterCredits).toBe(40);
  });

  it('10 free games at x3, retriggered by 3 more scatters, with no cap', () => {
    // a window that pays nothing at all
    let dead: number[] | null = null;
    for (let i = 0; i < 32 ** 3 && !dead; i++) {
      const s = [i % 32, (i >> 5) % 32, (i >> 10) % 32, 5, 9];
      if (scoreNeon(s).credits === 0 && scoreNeon(s).scatters === 0) dead = s;
    }
    const trig = [scatterStop(0), scatterStop(1), scatterStop(2), 5, 9];
    const t = scoreNeon(trig);
    expect(t.trigger).toBe(true);
    // paid spin triggers; free game 4 retriggers; the other 19 free games pay nothing
    const words = [...trig];
    for (let i = 1; i <= 20; i++) words.push(...(i === 4 ? trig : dead!));
    const play = playNeon(scripted(words));
    expect(play.free).toHaveLength(20);
    expect(play.credits).toBe(t.credits + 3 * t.credits);
  });

  it('no free games without a trigger', () => {
    const rng = seededRng(3);
    for (let i = 0; i < 2000; i++) {
      const p = playNeon(rng);
      if (!p.base.trigger) expect(p.free).toHaveLength(0);
      else expect(p.free.length).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('stop draws', () => {
  it('Classic Sevens virtual stops are uniform over 0-63 (chi-square, 640,000 spins)', () => {
    const rng = seededRng(11);
    const counts = Array.from({ length: 3 }, () => new Array<number>(64).fill(0));
    for (let i = 0; i < 640_000; i++) spinSevens(rng).virtual.forEach((v, r) => counts[r]![v]!++);
    // 63 degrees of freedom: the 99.99th percentile is about 117
    for (const c of counts) expect(chiSquareUniform(c)).toBeLessThan(117);
  });

  it('Neon Nights stops are uniform over 0-31', () => {
    const rng = seededRng(12);
    const counts = Array.from({ length: 5 }, () => new Array<number>(32).fill(0));
    for (let i = 0; i < 320_000; i++) spinNeon(rng).stops.forEach((s, r) => counts[r]![s]!++);
    // 31 degrees of freedom: the 99.99th percentile is about 70
    for (const c of counts) expect(chiSquareUniform(c)).toBeLessThan(70);
  });

  it('5x Wild rejects the top 40 words of 2^32 instead of folding them (72 does not divide 2^32)', () => {
    const r = spinWild(scripted([2 ** 32 - 1, 2 ** 32 - 40, 5, 6, 7]));
    expect(r.virtual).toEqual([5, 6, 7]);
    const kept = spinWild(scripted([2 ** 32 - 41, 0, 0]));
    expect(kept.virtual[0]).toBe((2 ** 32 - 41) % 72);
  });

  it('virtual stops map to physical stops by weight', () => {
    const map = virtualReel(SEVENS.reels[0]!);
    expect(map).toHaveLength(64);
    expect(map.slice(0, 6)).toEqual([0, 0, 1, 1, 1, 2]);
    expect(spinSevens(scripted([0, 2, 63])).stops).toEqual([0, 1, 21]);
  });
});

describe('engine', () => {
  const sim = (variant: string, stack = 1_000_000, rng: Rng = seededRng(5)) =>
    new TableSim(engine, rng, 'solo', [{ seat: 0, stack }], engine.config(variant, 'solo'));

  it('config: one seat, limits from the machine, unknown variants fall back to Classic Sevens', () => {
    // with the high-limit coins: $25 and $100 at Classic Sevens, $5 at Neon Nights, $100 at 5x Wild
    expect(engine.config('sevens', 'solo')).toMatchObject({ game: 'slots', variant: 'sevens', maxSeats: 1, limits: { default: { min: 25, max: 30_000, step: 25 } } });
    expect(engine.config('neon', 'solo').limits.default).toEqual({ min: 100, max: 50_000, step: 100 });
    expect(engine.config('wild', 'solo').limits.default).toEqual({ min: 100, max: 30_000, step: 100 });
    expect(engine.config('sevens', 'solo').buyIn).toEqual({ min: 2_000, max: 50_000_000 });
    expect(engine.config('nope', 'solo').variant).toBe('sevens');
    expect(engine.seats).toEqual({ min: 1, max: 1, multiplayer: false });
  });

  it('parseAction takes spin with integer coins and denom only', () => {
    expect(engine.parseAction({ type: 'spin', coins: 3, denom: 100 })).toEqual({ type: 'spin', coins: 3, denom: 100 });
    for (const bad of [null, 'spin', { type: 'spin' }, { type: 'spin', coins: '3', denom: 100 }, { type: 'spin', coins: 1.5, denom: 100 }, { type: 'deal', coins: 1, denom: 100 }]) {
      expect(engine.parseAction(bad)).toBeNull();
    }
  });

  it('refuses coin values, coin counts and bets the machine or the stack cannot take', () => {
    const t = sim('sevens', 100);
    expect(t.act(0, { type: 'spin', coins: 1, denom: 10 }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    expect(t.act(0, { type: 'spin', coins: 0, denom: 25 }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    expect(t.act(0, { type: 'spin', coins: 4, denom: 25 }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    expect(t.act(0, { type: 'spin', coins: 1, denom: 500 }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(t.stack(0)).toBe(100);
    const n = sim('neon', 100);
    expect(n.act(0, { type: 'spin', coins: 6, denom: 5 }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    expect(n.act(0, { type: 'spin', coins: 2, denom: 5 }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    const res = engine.act(engine.create(engine.config('sevens', 'solo'), t.ctx()), 3, { type: 'spin', coins: 1, denom: 25 }, t.ctx());
    expect(res).toMatchObject({ refuse: 'NOT_SEATED' });
  });

  it('a jackpot spin: the bet goes out, 1000 x coins x denom comes back, one round recorded', () => {
    const seven = [0, 1, 2].map((r) => stepperStop(SEVENS, r, '7').virtual);
    const t = sim('sevens', 10_000, scripted([0, 0, 0, ...seven]));
    const before = structuredClone(t.state);
    t.act(0, { type: 'spin', coins: 3, denom: 100 });
    expect(t.stack(0)).toBe(10_000 - 300 + 1000 * 3 * 100);
    expect(t.rounds).toEqual([{ seat: 0, wagered: 300, returned: 300_000 }]);
    const [spinEv, reels, result] = t.lastEvents as [SpinEvent, ReelsEvent, ResultEvent];
    expect(spinEv).toMatchObject({ type: 'spin', bet: 300, coins: 3, denom: 100, credit: 9_700 });
    expect(reels).toMatchObject({ type: 'reels', stops: [0, 0, 0], combo: 'three7', hits: [true, true, true], win: 300_000, lines: [{ line: 0, symbol: '7', count: 3, win: 300_000 }] });
    expect(result).toEqual({ type: 'result', seat: 0, bet: 300, win: 300_000, freeSpins: 0, freeWin: 0, credit: 309_700 });
    const v = t.view(0) as SlotsView;
    expect(v).toEqual({ machine: 'sevens', round: 1, denom: 100, coins: 3, stops: [0, 0, 0], last: { bet: 300, win: 300_000, freeSpins: 0 } });
    // act() never touched the state it was given
    expect(before.round).toBe(0);
  });

  it('a losing spin moves only the bet', () => {
    const blank = [0, 1, 2].map((r) => stepperStop(SEVENS, r, 'BL').virtual);
    const t = sim('sevens', 1000, scripted([0, 0, 0, ...blank]));
    t.act(0, { type: 'spin', coins: 1, denom: 25 });
    expect(t.stack(0)).toBe(975);
    expect(t.rounds).toEqual([{ seat: 0, wagered: 25, returned: 0 }]);
    expect((t.lastEvents[1] as ReelsEvent).lines).toEqual([]);
  });

  it('5x Wild pays with the multiplier and marks the wilds for one-5X pays', () => {
    const wx = stepperStop(WILD, 0, 'WX').virtual;
    const bl1 = stepperStop(WILD, 1, 'BL').virtual;
    const bl2 = stepperStop(WILD, 2, 'BL').virtual;
    const t = sim('wild', 10_000, scripted([0, 0, 0, wx, bl1, bl2]));
    t.act(0, { type: 'spin', coins: 2, denom: 500 });
    expect(t.stack(0)).toBe(10_000 - 1000 + 2 * 2 * 500);
    expect(t.lastEvents[1]).toMatchObject({ combo: 'oneWX', wilds: 1, hits: [true, false, false], win: 2000 });
  });

  it('Neon Nights: a feature pays with the paid spin, one reels event per free game', () => {
    const trig = [0, 1, 2].map((r) => neonStop(r, 0, 'SCATTER'));
    const words = [0, 0, 0, 0, 0, ...trig, 5, 9];
    const rng = seededRng(99);
    // after the scripted paid spin, let the free games come from a seeded generator
    const mixed: Rng = { next32: () => (words.length ? words.shift()! : rng.next32()) };
    const t = sim('neon', 100_000, mixed);
    t.act(0, { type: 'spin', coins: 2, denom: 25 });
    const evs = t.lastEvents as (SpinEvent | ReelsEvent | ResultEvent)[];
    const reels = evs.filter((e): e is ReelsEvent => e.type === 'reels');
    const result = evs.at(-1) as ResultEvent;
    expect(evs[0]).toMatchObject({ type: 'spin', bet: 1000 });
    expect(reels[0]).toMatchObject({ spin: 0, trigger: true, multiplier: 1 });
    expect(reels.length - 1).toBe(result.freeSpins);
    expect(result.freeSpins).toBeGreaterThanOrEqual(10);
    reels.slice(1).forEach((r, i) => expect(r).toMatchObject({ spin: i + 1, multiplier: 3, freeLeft: result.freeSpins - i - 1 }));
    expect(result.win).toBe(reels.reduce((s, r) => s + r.win, 0));
    expect(result.freeWin).toBe(result.win - reels[0]!.win);
    for (const r of reels) {
      expect(r.win).toBe(r.lines.reduce((s, l) => s + l.win, 0) + r.scatterWin);
      expect(r.win % 50).toBe(0);
    }
    expect(t.stack(0)).toBe(100_000 - 1000 + result.win);
    expect(t.rounds).toEqual([{ seat: 0, wagered: 1000, returned: result.win }]);
    expect((t.view(0) as SlotsView).stops).toEqual(reels.at(-1)!.stops);
  });

  it('money adds up over thousands of spins on every machine, and nothing is ever left live', () => {
    for (const variant of ['sevens', 'neon', 'wild']) {
      const m = MACHINES[variant as 'sevens'];
      const t = sim(variant, 10_000_000, seededRng(variant.length));
      for (let i = 0; i < 3000; i++) {
        const denom = m.denoms[i % m.denoms.length]!;
        const coins = 1 + (i % m.maxCoins);
        t.act(0, { type: 'spin', coins, denom });
        expect(engine.liveBets(t.state, 0)).toBe(0);
      }
      const net = t.rounds.reduce((s, r) => s + r.returned - r.wagered, 0);
      expect(t.stack(0)).toBe(10_000_000 + net);
      expect(t.rounds).toHaveLength(3000);
      expect((t.view(0) as SlotsView).round).toBe(3000);
    }
  });

  it('bets are coins x denomination, x20 lines on Neon Nights', () => {
    expect(betOf(SEVENS, 3, 500)).toBe(1500);
    expect(betOf(NEON, 5, 100)).toBe(10_000);
    expect(betOf(WILD, 1, 2500)).toBe(2500);
  });

  it('has no timers and nothing to resolve on leaving', () => {
    const t = sim('wild');
    const s: SlotsState = t.state;
    expect(engine.tick(s, t.ctx())).toBeNull();
    expect(engine.deadline(s)).toBeNull();
    expect(engine.shiftDeadlines(s, 1000)).toBe(s);
    expect(engine.seatLeaving(s, 0, t.ctx()).chips ?? []).toEqual([]);
    expect((t.view(null) as SlotsView).stops).toHaveLength(3);
    expect((sim('neon').view(0) as SlotsView).stops).toHaveLength(5);
  });
});
