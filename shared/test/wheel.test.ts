import { describe, it, expect } from 'vitest';
import { SEGMENTS, RISKS, WHEELS, wheelReturn, wheelTable, payoutFor, isRisk, isSegments } from '../src/games/wheel/rules.ts';
import { engine, SPIN_MS, type WheelAction, type WheelEvent, type WheelState, type WheelView } from '../src/games/wheel/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { queuedRng } from './online-rng.ts';

type Sim = TableSim<WheelState, WheelAction, WheelView>;

function solo(queue: number[] = [], stack = 100_000): Sim {
  return new TableSim(engine, queuedRng(queue, 3), 'solo', [{ seat: 0, stack }]);
}

describe('wheel tables', () => {
  it('has fifteen wheels of 10 to 50 segments, every one returning exactly 99%', () => {
    let n = 0;
    for (const risk of RISKS) {
      for (const segs of SEGMENTS) {
        expect(WHEELS[risk][segs]).toHaveLength(segs);
        const r = wheelReturn(risk, segs);
        expect(r.num * 100).toBe(r.den * 99);
        for (const m of WHEELS[risk][segs]) expect(Number.isInteger(m) && m >= 0).toBe(true);
        n++;
      }
    }
    expect(n).toBe(15);
  });

  it('prints the published counts', () => {
    expect(wheelTable('low', 10)).toEqual([{ mult: 150, count: 1 }, { mult: 120, count: 7 }, { mult: 0, count: 2 }]);
    expect(wheelTable('low', 50)).toEqual([{ mult: 150, count: 5 }, { mult: 120, count: 35 }, { mult: 0, count: 10 }]);
    expect(wheelTable('medium', 10)).toEqual([{ mult: 300, count: 1 }, { mult: 200, count: 1 }, { mult: 190, count: 1 }, { mult: 150, count: 2 }, { mult: 0, count: 5 }]);
    expect(wheelTable('medium', 20)).toEqual([{ mult: 300, count: 1 }, { mult: 200, count: 6 }, { mult: 180, count: 1 }, { mult: 150, count: 2 }, { mult: 0, count: 10 }]);
    expect(wheelTable('medium', 30)).toEqual([{ mult: 400, count: 1 }, { mult: 300, count: 1 }, { mult: 200, count: 6 }, { mult: 170, count: 1 }, { mult: 150, count: 6 }, { mult: 0, count: 15 }]);
    expect(wheelTable('medium', 40)).toEqual([{ mult: 300, count: 4 }, { mult: 200, count: 7 }, { mult: 160, count: 1 }, { mult: 150, count: 8 }, { mult: 0, count: 20 }]);
    expect(wheelTable('medium', 50)).toEqual([{ mult: 500, count: 1 }, { mult: 300, count: 3 }, { mult: 200, count: 8 }, { mult: 150, count: 13 }, { mult: 0, count: 25 }]);
    for (const segs of SEGMENTS) expect(wheelTable('high', segs)).toEqual([{ mult: 99 * segs, count: 1 }, { mult: 0, count: segs - 1 }]);
  });

  it('Medium alternates paying and blank segments all the way round', () => {
    for (const segs of SEGMENTS) {
      const w = WHEELS.medium[segs];
      for (let i = 0; i < segs; i++) expect((w[i]! === 0) !== (w[(i + 1) % segs]! === 0)).toBe(true);
    }
  });

  it('validates its choices', () => {
    expect(isRisk('medium') && !isRisk('extreme')).toBe(true);
    expect(isSegments(30) && !isSegments(25)).toBe(true);
    expect(payoutFor(700, 'high', 50, 0)).toBe(34_650);
  });
});

describe('wheel engine', () => {
  it('pays every segment of every wheel exactly what it prints (all 450 segments)', () => {
    for (const risk of RISKS) {
      for (const segs of SEGMENTS) {
        const sim = solo(Array.from({ length: segs }, (_, i) => i), 10_000_000);
        let total = 0;
        for (let i = 0; i < segs; i++) {
          const before = sim.stack(0);
          sim.act(0, { type: 'spin', bet: 300, risk, segments: segs });
          const e = sim.lastEvents[0] as WheelEvent;
          expect(e.segment).toBe(i);
          expect(e.mult).toBe(WHEELS[risk][segs][i]);
          expect(e.payout).toBe(3 * WHEELS[risk][segs][i]!);
          expect(sim.stack(0) - before).toBe(e.payout - 300);
          expect(e.stack).toBe(sim.stack(0));
          expect(e.restAt).toBe(sim.now + SPIN_MS);
          total += e.payout;
        }
        // every segment once: exactly 99% of what went in
        expect(total * 100).toBe(300 * segs * 99);
      }
    }
  });

  it('refuses bets off the limits or the stack, and junk', () => {
    const sim = solo([], 500);
    expect(sim.act(0, { type: 'spin', bet: 50, risk: 'low', segments: 10 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'spin', bet: 150, risk: 'low', segments: 10 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'spin', bet: 600, risk: 'low', segments: 10 }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(engine.parseAction({ type: 'spin', bet: 100, risk: 'low', segments: 15 })).toBeNull();
    expect(engine.parseAction({ type: 'spin', bet: 100, risk: 'wild', segments: 10 })).toBeNull();
    expect(engine.parseAction({ type: 'spin', bet: '100', risk: 'low', segments: 10 })).toBeNull();
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('keeps the last sixteen spins for the page', () => {
    const sim = solo([], 1_000_000);
    for (let i = 0; i < 20; i++) sim.act(0, { type: 'spin', bet: 100, risk: 'medium', segments: 20 });
    expect(sim.view(0).recent).toHaveLength(16);
    expect(sim.view(0).recent[0]!.round).toBe(20);
    expect(sim.rounds).toHaveLength(20);
  });
});
