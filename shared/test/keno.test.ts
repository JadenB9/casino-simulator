import { describe, it, expect } from 'vitest';
import { NUMBERS, DRAWN, MAX_PICKS, RISKS, PAYS, type Risk, isPicks, drawNumbers, countHits, multFor, payoutFor, choose, hitWays, DRAWS, tableReturn, tableRtp, returnRange } from '../src/games/keno/rules.ts';
import { engine, RECENT, type KenoState, type KenoAction, type KenoView, type KenoEvent } from '../src/games/keno/engine.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<KenoState, KenoAction, KenoView>;

/** Stake's printed paytables, copied a second time from the source so a slip in rules.ts shows up here. */
const STAKE: Record<Risk, number[][]> = {
  classic: [[0, 3.96], [0, 1.9, 4.5], [0, 1, 3.1, 10.4], [0, 0.8, 1.8, 5, 22.5], [0, 0.25, 1.4, 4.1, 16.5, 36], [0, 0, 1, 3.68, 7, 16.5, 40], [0, 0, 0.47, 3, 4.5, 14, 31, 60], [0, 0, 0, 2.2, 4, 13, 22, 55, 70], [0, 0, 0, 1.55, 3, 8, 15, 44, 60, 85], [0, 0, 0, 1.4, 2.25, 4.5, 8, 17, 50, 80, 100]],
  low: [[0.7, 1.85], [0, 2, 3.8], [0, 1.1, 1.38, 26], [0, 0, 2.2, 7.9, 90], [0, 0, 1.5, 4.2, 13, 300], [0, 0, 1.1, 2, 6.2, 100, 700], [0, 0, 1.1, 1.6, 3.5, 15, 225, 700], [0, 0, 1.1, 1.5, 2, 5.5, 39, 100, 800], [0, 0, 1.1, 1.3, 1.7, 2.5, 7.5, 50, 250, 1000], [0, 0, 1.1, 1.2, 1.3, 1.8, 3.5, 13, 50, 250, 1000]],
  medium: [[0.4, 2.75], [0, 1.8, 5.1], [0, 0, 2.8, 50], [0, 0, 1.7, 10, 100], [0, 0, 1.4, 4, 14, 390], [0, 0, 0, 3, 9, 180, 710], [0, 0, 0, 2, 7, 30, 400, 800], [0, 0, 0, 2, 4, 11, 67, 400, 900], [0, 0, 0, 2, 2.5, 5, 15, 100, 500, 1000], [0, 0, 0, 1.6, 2, 4, 7, 26, 100, 500, 1000]],
  high: [[0, 3.96], [0, 0, 17.1], [0, 0, 0, 81.5], [0, 0, 0, 10, 259], [0, 0, 0, 4.5, 48, 450], [0, 0, 0, 0, 11, 350, 710], [0, 0, 0, 0, 7, 90, 400, 800], [0, 0, 0, 0, 5, 20, 270, 600, 900], [0, 0, 0, 0, 4, 11, 56, 500, 800, 1000], [0, 0, 0, 0, 3.5, 8, 13, 63, 500, 800, 1000]],
};

/**
 * The published return of every table (docs/rules/online-games.md §4.3) as reduced fractions:
 * Σ C(p, h) · C(40 - p, 10 - h) · mult_h over C(40, 10), with the multipliers as printed.
 */
const PUBLISHED: Record<Risk, [number, number][]> = {
  classic: [[99, 100], [103, 104], [9783, 9880], [476, 481], [144741, 146224], [180891, 182780], [3618369, 3655600], [650882, 657305], [13531853, 13671944], [1679001083, 1695321056]],
  low: [[79, 80], [257, 260], [1221, 1235], [18081, 18278], [36155, 36556], [72387, 73112], [6148569, 6214520], [3383949, 3417986], [33861599, 34179860], [8371473091, 8476605280]],
  medium: [[79, 80], [513, 520], [489, 494], [36111, 36556], [18085, 18278], [18065, 18278], [153750, 155363], [130046, 131461], [27054595, 27343888], [419483099, 423830264]],
  high: [[99, 100], [513, 520], [489, 494], [9039, 9139], [18075, 18278], [18095, 18278], [153750, 155363], [130090, 131461], [13530365, 13671944], [76295861, 77060048]],
};

/** An Rng that returns these words in turn, then 0 forever. */
function words(list: number[]): Rng {
  let i = 0;
  return { next32: () => (i < list.length ? list[i++]! : 0) };
}

function solo(stack = 1_000_000, rng: Rng = seededRng(41)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]);
}

const big = (n: number) => BigInt(n);
function chooseBig(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * big(n - k + i)) / big(i);
  return r;
}

describe('keno paytables', () => {
  it('has Stake\'s four tables: picks + 1 pays per row, in whole hundredths', () => {
    for (const risk of RISKS) {
      expect(PAYS[risk]).toHaveLength(MAX_PICKS);
      for (let p = 1; p <= MAX_PICKS; p++) {
        const row = PAYS[risk][p - 1]!;
        expect(row).toHaveLength(p + 1);
        expect(row).toEqual(STAKE[risk][p - 1]!.map((m) => Math.round(m * 100)));
        for (let h = 0; h <= p; h++) expect(Math.abs(row[h]! / 100 - STAKE[risk][p - 1]![h]!)).toBeLessThan(1e-9);
      }
    }
    expect(multFor('classic', 1, 1)).toBe(396);
    expect(multFor('high', 10, 10)).toBe(100_000);
    expect(multFor('low', 1, 0)).toBe(70);
  });

  it('never pays less for more hits', () => {
    for (const risk of RISKS) for (let p = 1; p <= MAX_PICKS; p++) {
      const row = PAYS[risk][p - 1]!;
      for (let h = 1; h <= p; h++) expect(row[h]).toBeGreaterThanOrEqual(row[h - 1]!);
    }
  });
});

describe('keno returns (exact)', () => {
  it('counts every set of ten drawn: the hit counts of each pick size add up to C(40, 10)', () => {
    expect(DRAWS).toBe(847_660_528);
    expect(big(DRAWS)).toBe(chooseBig(40, 10));
    for (let p = 1; p <= MAX_PICKS; p++) {
      let total = 0n;
      for (let h = 0; h <= p; h++) {
        expect(big(hitWays(p, h))).toBe(chooseBig(p, h) * chooseBig(NUMBERS - p, DRAWN - h));
        total += big(hitWays(p, h));
      }
      expect(total).toBe(chooseBig(40, 10));
    }
  });

  it('every table returns the hypergeometric sum, as published', () => {
    for (const risk of RISKS) {
      for (let p = 1; p <= MAX_PICKS; p++) {
        let num = 0n;
        for (let h = 0; h <= p; h++) num += chooseBig(p, h) * chooseBig(NUMBERS - p, DRAWN - h) * big(multFor(risk, p, h));
        const den = chooseBig(40, 10) * 100n;
        const [pn, pd] = PUBLISHED[risk][p - 1]!;
        expect(num * big(pd)).toBe(big(pn) * den);
        const r = tableReturn(risk, p);
        expect(big(r.num) * den).toBe(num * big(r.den));
      }
    }
  });

  it('runs from 98.65% (2 picks, Medium or High) to 99.07% (9 picks, Low)', () => {
    const { min, max, best } = returnRange();
    expect(min).toBeCloseTo(513 / 520, 15);
    expect(max).toBeCloseTo(33861599 / 34179860, 15);
    expect(best).toEqual({ risk: 'low', picks: 9 });
    expect(tableRtp('classic', 1)).toBeCloseTo(0.99, 15);
  });

  it('matches the hit counts of every draw on a board small enough to enumerate', () => {
    // The same counting on 12 numbers with 4 drawn: every one of the C(12, 4) draws, against
    // picks {1..p}, lands on the hypergeometric count for its hits. rules.ts uses the same formula.
    const n = 12;
    const d = 4;
    for (let p = 1; p <= 6; p++) {
      const counts = new Array<number>(p + 1).fill(0);
      for (let mask = 0; mask < 1 << n; mask++) {
        let bits = 0;
        let hits = 0;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) {
          bits++;
          if (i < p) hits++;
        }
        if (bits === d) counts[hits]!++;
      }
      counts.forEach((c, h) => expect(c).toBe(choose(p, h) * choose(n - p, d - h)));
    }
  });

  it('pays whole cents for every whole-dollar bet', () => {
    for (const risk of RISKS) for (let p = 1; p <= MAX_PICKS; p++) for (let h = 0; h <= p; h++) {
      for (const bet of [100, 300, 12_300, 100_000]) {
        const pay = payoutFor(bet, risk, p, h);
        expect(Number.isInteger(pay)).toBe(true);
        expect(pay).toBe((bet * multFor(risk, p, h)) / 100);
      }
    }
  });
});

describe('keno draw', () => {
  it('draws ten different numbers from 1 to 40', () => {
    const rng = seededRng(9);
    for (let i = 0; i < 2_000; i++) {
      const d = drawNumbers(rng);
      expect(d).toHaveLength(DRAWN);
      expect(new Set(d).size).toBe(DRAWN);
      for (const x of d) expect(x >= 1 && x <= NUMBERS).toBe(true);
    }
  });

  it('is a partial Fisher-Yates: draw i picks among the 40 - i numbers left', () => {
    expect(drawNumbers(words([]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(drawNumbers(words([39, 38]))).toEqual([40, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(drawNumbers(words([1]))).toEqual([2, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('gives every ordered pair of first two numbers exactly once over the 40 x 39 first draws', () => {
    const seen = new Set<string>();
    for (let a = 0; a < 40; a++) for (let b = 0; b < 39; b++) {
      const d = drawNumbers(words([a, b]));
      seen.add(`${d[0]}-${d[1]}`);
    }
    expect(seen.size).toBe(40 * 39);
  });

  it('counts the picks that were drawn', () => {
    expect(countHits([1, 2, 3], [3, 4, 5, 6, 7, 8, 9, 10, 11, 1])).toBe(2);
    expect(countHits([40], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(0);
  });

  it('checks picks: 1 to 10 different whole numbers from 1 to 40', () => {
    expect(isPicks([1])).toBe(true);
    expect(isPicks([1, 2, 3, 4, 5, 6, 7, 8, 9, 40])).toBe(true);
    expect(isPicks([])).toBe(false);
    expect(isPicks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(false);
    expect(isPicks([0])).toBe(false);
    expect(isPicks([41])).toBe(false);
    expect(isPicks([3, 3])).toBe(false);
    expect(isPicks([1.5])).toBe(false);
    expect(isPicks('1,2')).toBe(false);
  });
});

describe('keno engine', () => {
  it('draws, counts the hits and pays in one step', () => {
    // Words of zero draw 1 to 10 in order.
    const sim = solo(10_000, words([]));
    sim.act(0, { type: 'bet', bet: 200, picks: [2, 4, 6, 40], risk: 'classic' });
    const ev = sim.lastEvents[0] as KenoEvent;
    expect(ev).toMatchObject({ type: 'draw', seat: 0, round: 1, bet: 200, risk: 'classic', picks: [2, 4, 6, 40], drawn: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], hits: 3, mult: 500, payout: 1_000 });
    expect(ev.stack).toBe(10_000 - 200 + 1_000);
    expect(sim.stack(0)).toBe(ev.stack);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 200, returned: 1_000 }]);
  });

  it('pays Low one pick even on a miss (0.7x)', () => {
    const sim = solo(10_000, words([]));
    sim.act(0, { type: 'bet', bet: 1_000, picks: [40], risk: 'low' });
    const ev = sim.lastEvents[0] as KenoEvent;
    expect(ev.hits).toBe(0);
    expect(ev.payout).toBe(700);
    expect(sim.stack(0)).toBe(9_700);
  });

  it('keeps the last games newest first', () => {
    const sim = solo();
    for (let i = 0; i < RECENT + 2; i++) sim.act(0, { type: 'bet', bet: 100, picks: [1, 2, 3], risk: 'high' });
    const v = sim.view(0);
    expect(v.recent).toHaveLength(RECENT);
    expect(v.recent[0]!.round).toBe(RECENT + 2);
    for (const g of v.recent) expect(g.hits).toBe(countHits(g.picks, g.drawn));
  });

  it('refuses bets off the limits or the dollar, and bets beyond the stack', () => {
    const sim = solo(5_000);
    const refused = (a: object) => sim.act(0, { type: 'bet', bet: 100, picks: [1, 2], risk: 'low', ...a }, { allowRefusal: true }).refused;
    expect(refused({ bet: 0 })).toBe('LIMIT');
    expect(refused({ bet: 150 })).toBe('LIMIT');
    expect(refused({ bet: 100_100 })).toBe('LIMIT');
    expect(refused({ bet: 5_100 })).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.rounds).toHaveLength(0);
  });

  it('parses only well-formed bets', () => {
    expect(engine.parseAction({ type: 'bet', bet: 100, picks: [5, 1], risk: 'high' })).toEqual({ type: 'bet', bet: 100, picks: [5, 1], risk: 'high' });
    expect(engine.parseAction({ type: 'bet', bet: 100, picks: [], risk: 'high' })).toBeNull();
    expect(engine.parseAction({ type: 'bet', bet: 100, picks: [1, 1], risk: 'high' })).toBeNull();
    expect(engine.parseAction({ type: 'bet', bet: 100, picks: [1], risk: 'wild' })).toBeNull();
    expect(engine.parseAction({ type: 'bet', bet: 100, risk: 'low' })).toBeNull();
  });

  it('never leaves chips on the table and never mutates its input', () => {
    const sim = solo();
    const frozen = sim.state;
    const before = structuredClone(frozen);
    sim.act(0, { type: 'bet', bet: 100, picks: [7, 8, 9], risk: 'medium' });
    expect(frozen).toEqual(before);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
  });
});
