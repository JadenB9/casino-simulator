// Lucky Cherries cell by cell and in full: every line pay (cherries from two), the BONUS rules and
// the Cherry Wheel, the published PAR sheet by exact enumeration of all 30^5 windows through the
// engine's own line scorer plus the wheel in closed form, the unbiased draws, and spins through
// the engine.

import { describe, it, expect } from 'vitest';
import type { Rng } from '../src/rng.ts';
import { engine } from '../src/games/slots/engine.ts';
import { CHERRIES, CHERRY_TABLES, playCherries, scoreCherries, type CherrySymbol } from '../src/games/slots/cherries.ts';
import { lineCredits, lineWins, scatterCount, symbolAt } from '../src/games/slots/lines.ts';
import type { ReelsEvent, ResultEvent, SlotsView } from '../src/games/slots/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

const L = 30;

async function doc(): Promise<Record<string, unknown>> {
  const path = '../../docs/math/slot-e-lucky-cherries.mjs';
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

const at = (reel: number, stop: number, row: number) => symbolAt(CHERRIES.strips, reel, stop, row);

/** A stop that puts `sym` in `row` of `reel`. */
function stopFor(reel: number, row: number, sym: CherrySymbol): number {
  for (let s = 0; s < L; s++) if (at(reel, s, row) === sym) return s;
  throw new Error(`no ${sym} on reel ${reel + 1}`);
}

/** A stop whose `row` is none of `avoid` and shows no BONUS anywhere. */
function stopAvoiding(reel: number, row: number, avoid: CherrySymbol[]): number {
  for (let s = 0; s < L; s++) {
    if (avoid.includes(at(reel, s, row))) continue;
    if ([0, 1, 2].some((k) => at(reel, s, k) === 'BONUS')) continue;
    return s;
  }
  throw new Error('no such stop');
}

const withoutBonus = (reel: number) => stopAvoiding(reel, 0, []);

describe('Lucky Cherries data', () => {
  it('matches the published script stop for stop', async () => {
    const d = await doc();
    expect([...CHERRIES.symbols]).toEqual(d.SYMBOLS);
    expect(CHERRIES.strips).toEqual(d.STRIPS);
    expect(CHERRIES.lineRows).toEqual(d.LINES);
    expect(CHERRIES.linePays).toEqual(d.LINE_PAYS);
    expect(CHERRIES.wheel).toEqual(d.WHEEL);
    expect(CHERRIES.wheelMult).toEqual(d.WHEEL_MULT);
    expect(CHERRIES.trigger).toBe(d.TRIGGER);
  });

  it('five 30-stop strips, one BONUS each, no wild, ten distinct lines', () => {
    for (const s of CHERRIES.strips) {
      expect(s).toHaveLength(30);
      expect(s.filter((x) => x === 'BONUS')).toHaveLength(1);
    }
    expect(CHERRIES.wild).toBeNull();
    expect(new Set(CHERRIES.lineRows.map((l) => l.join(''))).size).toBe(10);
    expect(CHERRIES.wheel).toHaveLength(20);
  });
});

describe('Lucky Cherries lines', () => {
  const PAYING = Object.entries(CHERRIES.linePays) as [CherrySymbol, readonly number[]][];

  for (const [sym, pays] of PAYING) {
    for (const n of [2, 3, 4, 5] as const) {
      const pay = pays[n - 2]!;
      it(`${n} x ${sym} on line 1 pays ${pay}`, () => {
        const stops = [0, 1, 2, 3, 4].map((r) => (r < n ? stopFor(r, 1, sym) : stopAvoiding(r, 1, [sym])));
        const line1 = lineWins(CHERRIES, CHERRY_TABLES, stops).find((w) => w.line === 0);
        if (pay === 0) expect(line1).toBeUndefined();
        else expect(line1).toEqual({ line: 0, symbol: sym, count: n, pay });
      });
    }
  }

  it('a cherry alone pays nothing; two cherries must start on reel 1', () => {
    const one = [stopFor(0, 1, 'CHERRY'), stopAvoiding(1, 1, ['CHERRY']), 0, 0, 0];
    expect(lineWins(CHERRIES, CHERRY_TABLES, one).find((w) => w.line === 0)).toBeUndefined();
    const late = [stopAvoiding(0, 1, ['CHERRY']), stopFor(1, 1, 'CHERRY'), stopFor(2, 1, 'CHERRY'), 0, 0];
    expect(lineWins(CHERRIES, CHERRY_TABLES, late).find((w) => w.line === 0)).toBeUndefined();
  });

  it('BONUS never completes a line and a line starting with it pays nothing', () => {
    const blocked = [stopFor(0, 1, 'CHERRY'), stopFor(1, 1, 'CHERRY'), stopFor(2, 1, 'BONUS'), stopFor(3, 1, 'CHERRY'), stopFor(4, 1, 'CHERRY')];
    expect(lineWins(CHERRIES, CHERRY_TABLES, blocked).find((w) => w.line === 0)).toEqual({ line: 0, symbol: 'CHERRY', count: 2, pay: 3 });
    const starts = [stopFor(0, 1, 'BONUS'), stopFor(1, 1, 'BONUS'), stopFor(2, 1, 'BONUS'), 0, 0];
    expect(lineWins(CHERRIES, CHERRY_TABLES, starts).find((w) => w.line === 0)).toBeUndefined();
  });

  it('each line reads the rows the line table gives', () => {
    const stops = [3, 7, 12, 20, 29];
    CHERRIES.lineRows.forEach((rows, l) => {
      const read = rows.map((row, r) => at(r, stops[r]!, row));
      let n = 1;
      while (n < 5 && read[n] === read[0]) n++;
      const pay = read[0] === 'BONUS' ? 0 : (CHERRIES.linePays[read[0]!]?.[n - 2] ?? 0);
      const wins = lineWins(CHERRIES, CHERRY_TABLES, stops).filter((w) => w.line === l);
      expect(wins.reduce((t, w) => t + w.pay, 0)).toBe(pay);
    });
  });

  it('the detailed line wins always add up to the fast scorer (300,000 random windows)', () => {
    const rng = seededRng(17);
    for (let i = 0; i < 300_000; i++) {
      const s = [0, 1, 2, 3, 4].map(() => rng.next32() % L) as [number, number, number, number, number];
      const detail = lineWins(CHERRIES, CHERRY_TABLES, s).reduce((t, w) => t + w.pay, 0);
      if (detail !== lineCredits(CHERRY_TABLES, ...s)) throw new Error(`mismatch at ${s.join(',')}`);
    }
  });
});

describe('the Cherry Wheel', () => {
  const bonusStop = (r: number) => stopFor(r, 0, 'BONUS');

  it('BONUS counts anywhere in the window; three or more spin the wheel', () => {
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const stops = [0, 1, 2, 3, 4].map((r) => (r < k ? bonusStop(r) : withoutBonus(r)));
      const sp = scoreCherries(stops);
      expect(sp.bonus).toBe(k);
      expect(sp.trigger).toBe(k >= 3);
    }
    const spread = [stopFor(0, 2, 'BONUS'), stopFor(1, 1, 'BONUS'), stopFor(2, 0, 'BONUS'), withoutBonus(3), withoutBonus(4)];
    expect(scatterCount(CHERRY_TABLES, spread)).toBe(3);
  });

  it('pays the segment prize x 1, 2 or 5 for 3, 4 or 5 BONUS, in total bets, on top of the lines', () => {
    for (const [k, mult] of [[3, 1], [4, 2], [5, 5]] as const) {
      for (const segment of [0, 7, 19]) {
        const stops = [0, 1, 2, 3, 4].map((r) => (r < k ? bonusStop(r) : withoutBonus(r)));
        const play = playCherries(scripted([...stops, segment]));
        expect(play.wheel).toEqual({ segment, prize: CHERRIES.wheel[segment], mult });
        expect(play.credits).toBe(scoreCherries(stops).lineCredits + CHERRIES.wheel[segment]! * mult * 10);
      }
    }
  });

  it('no BONUS, no wheel: nothing is drawn after the window', () => {
    const stops = [0, 1, 2, 3, 4].map((r) => withoutBonus(r));
    const play = playCherries(scripted(stops));
    expect(play.wheel).toBeNull();
    expect(play.credits).toBe(scoreCherries(stops).lineCredits);
  });
});

describe('Lucky Cherries exact return', () => {
  it('lines 81.176955% by enumerating all 30^5 windows, wheel 12.851% in closed form, 94.027955% in all', () => {
    const N = L ** 5, BET = CHERRIES.lines;
    // hist[w * 6 + k]: windows paying w line credits with k BONUS symbols
    const hist = new Float64Array(6 * (BET * 5000 + 1));
    const byK = new Float64Array(6);
    const sumWbyK = new Float64Array(6);
    const s = [0, 0, 0, 0, 0];
    let lineSum = 0, top = 0, topWays = 0;
    for (s[0] = 0; s[0] < L; s[0]++)
      for (s[1] = 0; s[1] < L; s[1]++)
        for (s[2] = 0; s[2] < L; s[2]++)
          for (s[3] = 0; s[3] < L; s[3]++)
            for (s[4] = 0; s[4] < L; s[4]++) {
              const w = lineCredits(CHERRY_TABLES, s[0], s[1], s[2], s[3], s[4]);
              const k = scatterCount(CHERRY_TABLES, s);
              lineSum += w;
              byK[k]!++;
              sumWbyK[k]! += w;
              hist[w * 6 + k]!++;
              if (w > top) {
                top = w;
                topWays = 1;
              } else if (w === top) topWays++;
            }
    let EW = 0, EW2 = 0, hits = 0;
    for (let i = 0; i < hist.length; i++) {
      if (!hist[i]) continue;
      const w = Math.floor(i / 6) / BET, k = i % 6;
      EW += w * hist[i]!;
      EW2 += w * w * hist[i]!;
      if (w > 0 || k >= CHERRIES.trigger) hits += hist[i]!;
    }
    EW /= N;
    EW2 /= N;
    const EV = CHERRIES.wheel.reduce((a, b) => a + b, 0) / CHERRIES.wheel.length;
    const EV2 = CHERRIES.wheel.reduce((a, b) => a + b * b, 0) / CHERRIES.wheel.length;
    let wheel = 0, cross = 0, wheel2 = 0, pT = 0;
    for (let k = CHERRIES.trigger; k <= 5; k++) {
      const m = CHERRIES.wheelMult[k]!;
      wheel += (byK[k]! / N) * m * EV;
      cross += (sumWbyK[k]! / BET / N) * m * EV;
      wheel2 += (byK[k]! / N) * m * m * EV2;
      pT += byK[k]! / N;
    }
    const EX = EW + wheel;
    const sd = Math.sqrt(EW2 + 2 * cross + wheel2 - EX * EX);
    const pct = (x: number, d = 6) => (x * 100).toFixed(d);
    console.log(`Lucky Cherries: lines ${pct(EW)}%, wheel ${pct(wheel)}%, total ${pct(EX)}%, hits ${pct(hits / N, 4)}%, SD ${sd.toFixed(4)}`);

    expect(lineSum / BET).toBe(19_726_000); // per line, of 30^5
    expect(pct(EW)).toBe('81.176955');
    expect([...byK]).toEqual([14_348_907, 7_971_615, 1_771_470, 196_830, 10_935, 243]);
    expect(EV).toBe(14.2);
    expect(pct(wheel)).toBe('12.851000');
    expect((1 / pT).toFixed(2)).toBe('116.82');
    expect(pct(EX)).toBe('94.027955');
    expect(pct(hits / N, 4)).toBe('56.2234');
    expect(sd.toFixed(4)).toBe('3.4151');
    expect([top, topWays]).toEqual([5025, 1]);
  }, 120_000);

  it('the line return from symbol counts alone (every line sees the same distribution)', () => {
    const f = (r: number, x: string) => CHERRIES.strips[r]!.filter((y) => y === x).length;
    let num = 0;
    for (const [x, pays] of Object.entries(CHERRIES.linePays)) {
      const ge = [0, f(0, x)];
      for (let r = 1; r < 5; r++) ge.push(ge[r]! * f(r, x));
      for (let n = 2; n <= 5; n++) num += pays![n - 2]! * (ge[n]! * L ** (5 - n) - (n < 5 ? ge[n + 1]! * L ** (4 - n) : 0));
    }
    expect(num).toBe(19_726_000);
  });
});

describe('Lucky Cherries draws', () => {
  it('stops are uniform over 0-29 and wheel segments over 0-19 (chi-square)', () => {
    const rng = seededRng(23);
    const counts = Array.from({ length: 5 }, () => new Array<number>(L).fill(0));
    const segs = new Array<number>(20).fill(0);
    let wheels = 0;
    for (let i = 0; i < 300_000; i++) {
      const p = playCherries(rng);
      p.base.stops.forEach((s, r) => counts[r]![s]!++);
      if (p.wheel) {
        segs[p.wheel.segment]!++;
        wheels++;
      }
    }
    // 29 degrees of freedom: the 99.99th percentile is about 67
    for (const c of counts) expect(chiSquareUniform(c)).toBeLessThan(67);
    expect(wheels).toBeGreaterThan(2000);
    // 19 degrees of freedom: the 99.99th percentile is about 50
    expect(chiSquareUniform(segs)).toBeLessThan(50);
  });
});

describe('Lucky Cherries on the engine', () => {
  const sim = (stack: number, rng: Rng) => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }], engine.config('cherries', 'solo'));

  it('config: 10 lines, 1-5 credits a line at 1, 5 or 25 cents, $1 or $5, or the high-limit $25, $100 and $500', () => {
    const cfg = engine.config('cherries', 'solo');
    // five credits a line on ten lines of $500: $25,000 a spin, and a hundred of those to buy in
    expect(cfg.limits.default).toEqual({ min: 10, max: 2_500_000, step: 10 });
    expect(cfg.buyIn).toEqual({ min: 2_000, max: 250_000_000 });
    expect(cfg.options).toEqual({ machine: 'cherries', denoms: [1, 5, 25, 100, 500, 2500, 10_000, 50_000], maxCoins: 5, lines: 10 });
  });

  it('a wheel spin pays with the spin: lines plus prize x multiplier x total bet', () => {
    const stops = [0, 1, 2, 3].map((r) => stopFor(r, 0, 'BONUS'));
    stops.push(withoutBonus(4));
    const t = sim(100_000, scripted([0, 0, 0, 0, 0, ...stops, 19]));
    t.act(0, { type: 'spin', coins: 2, denom: 5 });
    const [spinEv, reels, result] = t.lastEvents as [unknown, ReelsEvent, ResultEvent];
    expect(spinEv).toMatchObject({ bet: 100 });
    const lines = scoreCherries(stops).lineCredits * 10;
    expect(reels.wheel).toEqual({ segment: 19, prize: 100, mult: 2, win: 100 * 2 * 100 });
    expect(reels).toMatchObject({ scatters: 4, trigger: true, win: lines + 20_000 });
    expect(reels.win).toBe(reels.lines.reduce((a, l) => a + l.win, 0) + reels.wheel!.win);
    expect(result).toMatchObject({ win: lines + 20_000, freeSpins: 0 });
    expect(t.stack(0)).toBe(100_000 - 100 + lines + 20_000);
    expect((t.view(0) as SlotsView).stops).toEqual(stops);
  });

  it('refuses more than 5 credits a line and a coin value it does not take', () => {
    const t = sim(100_000, seededRng(1));
    expect(t.act(0, { type: 'spin', coins: 6, denom: 1 }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    expect(t.act(0, { type: 'spin', coins: 1, denom: 2 }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
  });

  it('money adds up over thousands of spins', () => {
    const t = sim(10_000_000, seededRng(41));
    for (let i = 0; i < 3000; i++) t.act(0, { type: 'spin', coins: 1 + (i % 5), denom: CHERRIES.denoms[i % 3]! });
    const net = t.rounds.reduce((s, r) => s + r.returned - r.wagered, 0);
    expect(t.stack(0)).toBe(10_000_000 + net);
    expect((t.view(0) as SlotsView).stops).toHaveLength(5);
  });
});
