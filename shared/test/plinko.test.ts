import { describe, it, expect } from 'vitest';
import { ROWS, RISKS, MULTS, type Rows, type Risk, drawBits, pathOf, binOf, payoutFor, choose, binChance, boardReturn, boardRtp, bestBoard, returnRange } from '../src/games/plinko/rules.ts';
import { engine, RECENT, type PlinkoState, type PlinkoAction, type PlinkoView, type DropEvent } from '../src/games/plinko/engine.ts';
import type { EngineCtx } from '../src/engine.ts';
import { isRefusal } from '../src/engine.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<PlinkoState, PlinkoAction, PlinkoView>;

/** Stake's printed tables, copied a second time from the source so a slip in rules.ts shows up here. */
const STAKE: Record<Rows, Record<Risk, number[]>> = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
  9: { low: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6], medium: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18], high: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43] },
  10: { low: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9], medium: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22], high: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76] },
  11: { low: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4], medium: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24], high: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10], medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33], high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170] },
  13: { low: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1], medium: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43], high: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260] },
  14: { low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1], medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58], high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420] },
  15: { low: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15], medium: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88], high: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620] },
  16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16], medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000] },
};

/**
 * The published return of every board (docs/rules/online-games.md §1.3), as exact percentages:
 * the denominator is 100 · 2^rows, so every one is a terminating decimal.
 */
const PUBLISHED: Record<Rows, Record<Risk, string>> = {
  8: { low: '98.984375', medium: '98.90625', high: '99.0625' },
  9: { low: '98.984375', medium: '99.140625', high: '99.0625' },
  10: { low: '99.00390625', medium: '98.90625', high: '99.0625' },
  11: { low: '99.00390625', medium: '99.0234375', high: '99.16015625' },
  12: { low: '98.9794921875', medium: '98.9892578125', high: '99.1162109375' },
  13: { low: '98.9990234375', medium: '98.994140625', high: '99.0869140625' },
  14: { low: '99.000244140625', medium: '98.994140625', high: '98.978271484375' },
  15: { low: '99.0008544921875', medium: '98.9984130859375', high: '99.0264892578125' },
  16: { low: '98.99871826171875', medium: '98.98834228515625', high: '98.9764404296875' },
};

/** A published percentage as an exact fraction of 1: '98.984375' is 98984375 / 10^8. */
function percentFraction(s: string): [bigint, bigint] {
  const [whole, frac = ''] = s.split('.');
  return [BigInt(whole! + frac), 100n * 10n ** BigInt(frac.length)];
}

/** An Rng whose next draw is `x` (randInt keeps x % n when x is below its rejection limit). */
function forced(x: number): Rng {
  return { next32: () => x };
}

function solo(stack = 1_000_000, rng: Rng = seededRng(11)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]);
}

function ctxWith(rng: Rng, stack = 1_000_000_000): EngineCtx {
  return { rng, now: 0, mode: 'solo', started: true, seats: [{ seat: 0, accountId: 1, name: 'P0', stack, connected: true, ready: false }] };
}

describe('plinko tables', () => {
  it('has Stake\'s 27 boards: rows + 1 bins each, symmetric, in whole hundredths', () => {
    for (const rows of ROWS) {
      for (const risk of RISKS) {
        const m = MULTS[rows][risk];
        expect(m).toHaveLength(rows + 1);
        expect(m).toEqual(STAKE[rows][risk].map((x) => Math.round(x * 100)));
        for (let k = 0; k <= rows; k++) {
          expect(Number.isInteger(m[k])).toBe(true);
          expect(m[k]).toBe(m[rows - k]);
          expect(Math.abs(m[k]! / 100 - STAKE[rows][risk][k]!)).toBeLessThan(1e-9);
        }
      }
    }
    expect(MULTS[16].high[0]).toBe(100_000);
    expect(MULTS[16].high[8]).toBe(20);
    expect(MULTS[8].low[4]).toBe(50);
  });

  it('pays higher toward the edges on every board, and more for more risk at the edge', () => {
    for (const rows of ROWS) {
      for (const risk of RISKS) {
        const m = MULTS[rows][risk];
        for (let k = 1; k <= rows / 2; k++) expect(m[k - 1]).toBeGreaterThanOrEqual(m[k]!);
      }
      expect(MULTS[rows].medium[0]).toBeGreaterThan(MULTS[rows].low[0]!);
      expect(MULTS[rows].high[0]).toBeGreaterThan(MULTS[rows].medium[0]!);
    }
  });
});

describe('plinko paths', () => {
  it('reads row i from bit i and lands in the bin that counts the rights', () => {
    expect(pathOf(0b1011, 8)).toEqual([1, 1, 0, 1, 0, 0, 0, 0]);
    expect(binOf(0b1011)).toBe(3);
    expect(binOf(0)).toBe(0);
    expect(binOf(2 ** 16 - 1)).toBe(16);
    for (let bits = 0; bits < 2 ** 10; bits++) expect(binOf(bits)).toBe(pathOf(bits, 10).reduce((a, b) => a + b, 0));
  });

  it('draws the whole path from one uniform integer below 2^rows', () => {
    for (const rows of ROWS) {
      expect(drawBits(forced(0), rows)).toBe(0);
      expect(drawBits(forced(2 ** rows - 1), rows)).toBe(2 ** rows - 1);
      // 2^rows divides 2^32, so randInt never rejects and keeps the low bits.
      expect(drawBits(forced(2 ** 32 - 1), rows)).toBe(2 ** rows - 1);
    }
  });

  it('gives bin k probability C(rows, k) / 2^rows', () => {
    for (const rows of ROWS) {
      const counts = new Array<number>(rows + 1).fill(0);
      for (let bits = 0; bits < 2 ** rows; bits++) counts[binOf(bits)]!++;
      counts.forEach((c, k) => {
        expect(c).toBe(choose(rows, k));
        expect(binChance(rows, k)).toBe(c / 2 ** rows);
      });
    }
  });
});

describe('plinko returns (exact)', () => {
  it('every board returns Σ C(rows, k) · mult_k / 2^rows, as published', () => {
    for (const rows of ROWS) {
      for (const risk of RISKS) {
        let num = 0n;
        for (let k = 0; k <= rows; k++) num += BigInt(choose(rows, k)) * BigInt(MULTS[rows][risk][k]!);
        const den = 100n * 2n ** BigInt(rows);
        const [pn, pd] = percentFraction(PUBLISHED[rows][risk]);
        expect(num * pd).toBe(pn * den);
        const r = boardReturn(rows, risk);
        expect(BigInt(r.num) * den).toBe(num * BigInt(r.den));
      }
    }
  });

  it('matches through the engine over every path of every board', () => {
    // Every path of every board through engine.act, with the RNG forced to that path: the sum
    // of what came back over all 2^rows paths, per dollar, is the published return exactly.
    for (const rows of ROWS) {
      for (const risk of RISKS) {
        // act() never mutates its input, so every path can start from the same fresh table.
        const state = engine.create(engine.config('', 'solo'), ctxWith(forced(0)));
        let paid = 0;
        for (let bits = 0; bits < 2 ** rows; bits++) {
          const step = engine.act(state, 0, { type: 'drop', bet: 100, rows, risk }, ctxWith(forced(bits)));
          if (isRefusal(step)) throw new Error(step.msg);
          const ev = step.events[0] as unknown as DropEvent;
          if (ev.bin !== binOf(bits) || step.chips![0]!.bet !== 100 || step.chips![0]!.payout !== ev.payout) throw new Error(`path ${bits} settled wrong`);
          paid += ev.payout;
        }
        const [pn, pd] = percentFraction(PUBLISHED[rows][risk]);
        // paid / (100 cents · 2^rows) = pn / pd
        expect(BigInt(paid) * pd).toBe(pn * 100n * 2n ** BigInt(rows));
      }
    }
  });

  it('ranges from 98.91% (8 or 10 rows, Medium) to 99.16% (11 rows, High)', () => {
    const { min, max } = returnRange();
    expect(min).toBeCloseTo(0.9890625, 15);
    expect(max).toBeCloseTo(0.9916015625, 15);
    expect(bestBoard()).toEqual({ rows: 11, risk: 'high', rtp: 0.9916015625 });
    expect(boardRtp(8, 'low')).toBe(0.98984375);
  });

  it('pays whole cents for every whole-dollar bet in every bin', () => {
    for (const rows of ROWS) for (const risk of RISKS) for (let k = 0; k <= rows; k++) {
      for (const bet of [100, 700, 12_300, 100_000]) {
        const p = payoutFor(bet, rows, risk, k);
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBe((bet * MULTS[rows][risk][k]!) / 100);
      }
    }
  });
});

describe('plinko engine', () => {
  it('takes the bet and pays the bin in one step, with the path in the event', () => {
    const sim = solo(50_000, forced(0b1111111111111111));
    sim.act(0, { type: 'drop', bet: 1_000, rows: 16, risk: 'high' });
    const ev = sim.lastEvents[0] as DropEvent;
    expect(ev).toMatchObject({ type: 'drop', seat: 0, round: 1, rows: 16, risk: 'high', bet: 1_000, bin: 16, mult: 100_000, payout: 1_000_000 });
    expect(ev.path).toEqual(new Array(16).fill(1));
    expect(ev.stack).toBe(50_000 - 1_000 + 1_000_000);
    expect(sim.stack(0)).toBe(ev.stack);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 1_000_000 }]);
  });

  it('keeps the last drops newest first, for the results column', () => {
    const sim = solo(1_000_000);
    for (let i = 0; i < RECENT + 5; i++) sim.act(0, { type: 'drop', bet: 100, rows: 8, risk: 'low' });
    const v = sim.view(0);
    expect(v.round).toBe(RECENT + 5);
    expect(v.recent).toHaveLength(RECENT);
    expect(v.recent[0]!.round).toBe(RECENT + 5);
    expect(v.recent.at(-1)!.round).toBe(6);
    for (const d of v.recent) expect(d.payout).toBe(MULTS[8].low[d.bin]!);
  });

  it('refuses bets off the limits, off the dollar, or beyond the stack', () => {
    const sim = solo(5_000);
    const refused = (a: object) => sim.act(0, { type: 'drop', rows: 8, risk: 'low', ...a }, { allowRefusal: true }).refused;
    expect(refused({ bet: 0 })).toBe('LIMIT');
    expect(refused({ bet: 50 })).toBe('LIMIT');
    expect(refused({ bet: 150 })).toBe('LIMIT');
    expect(refused({ bet: 100_100 })).toBe('LIMIT');
    expect(refused({ bet: 5_100 })).toBe('NOT_ENOUGH_CHIPS');
    expect(refused({ bet: 5_000 })).toBeUndefined();
    expect(sim.rounds).toHaveLength(1);
  });

  it('reads the table limits from the config', () => {
    const cfg = engine.config('', 'solo');
    cfg.limits.default = { min: 500, max: 2_000, step: 100 };
    const sim = new TableSim(engine, seededRng(3), 'solo', [{ seat: 0, stack: 100_000 }], cfg);
    expect(sim.act(0, { type: 'drop', bet: 400, rows: 8, risk: 'low' }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'drop', bet: 2_100, rows: 8, risk: 'low' }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'drop', bet: 2_000, rows: 8, risk: 'low' }, { allowRefusal: true }).refused).toBeUndefined();
  });

  it('parses only well-formed drops', () => {
    expect(engine.parseAction({ type: 'drop', bet: 100, rows: 8, risk: 'low' })).toEqual({ type: 'drop', bet: 100, rows: 8, risk: 'low' });
    expect(engine.parseAction({ type: 'drop', bet: 100, rows: 7, risk: 'low' })).toBeNull();
    expect(engine.parseAction({ type: 'drop', bet: 100, rows: 17, risk: 'low' })).toBeNull();
    expect(engine.parseAction({ type: 'drop', bet: 100, rows: 8.5, risk: 'low' })).toBeNull();
    expect(engine.parseAction({ type: 'drop', bet: 100, rows: 8, risk: 'extreme' })).toBeNull();
    expect(engine.parseAction({ type: 'drop', bet: 1.5, rows: 8, risk: 'low' })).toBeNull();
    expect(engine.parseAction({ type: 'drop', bet: '100', rows: 8, risk: 'low' })).toBeNull();
    expect(engine.parseAction({ type: 'spin' })).toBeNull();
    expect(engine.parseAction(null)).toBeNull();
  });

  it('refuses a player who has not bought in', () => {
    const state = engine.create(engine.config('', 'solo'), ctxWith(forced(0)));
    const res = engine.act(state, 0, { type: 'drop', bet: 100, rows: 8, risk: 'low' }, { ...ctxWith(forced(0)), seats: [] });
    expect(isRefusal(res) && res.refuse).toBe('NOT_SEATED');
  });

  it('never leaves chips on the table and never mutates the state it was given', () => {
    const sim = solo();
    const before = structuredClone(sim.state);
    const frozen = sim.state;
    sim.act(0, { type: 'drop', bet: 100, rows: 12, risk: 'medium' });
    expect(frozen).toEqual(before);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.seatLeaving(sim.state, 0, sim.ctx()).events).toEqual([]);
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
    expect(engine.deadline(sim.state)).toBeNull();
  });

  it('keeps every chip: stack changes by payout minus bet on every drop', () => {
    const sim = solo(10_000_000, seededRng(99));
    let expected = sim.stack(0);
    for (let i = 0; i < 2_000; i++) {
      const rows = ROWS[i % ROWS.length]!;
      const risk = RISKS[i % RISKS.length]!;
      sim.act(0, { type: 'drop', bet: 100 * (1 + (i % 7)), rows, risk });
      const ev = sim.lastEvents[0] as DropEvent;
      expected += ev.payout - ev.bet;
      expect(ev.payout).toBe((ev.bet / 100) * MULTS[rows][risk][ev.bin]!);
      expect(ev.path).toHaveLength(rows);
      expect(sim.stack(0)).toBe(expected);
      expect(ev.stack).toBe(expected);
    }
  });
});
