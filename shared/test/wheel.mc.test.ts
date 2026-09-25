import { describe, it, expect } from 'vitest';
import { RISKS, SEGMENTS, WHEELS, drawSegment } from '../src/games/wheel/rules.ts';
import { engine, type WheelAction, type WheelEvent, type WheelState, type WheelView } from '../src/games/wheel/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// Two million spins of each of the fifteen wheels from the engine's drawSegment: every wheel
// returns exactly 99% (docs/rules/online-games.md §10).

describe('wheel (Monte Carlo)', () => {
  it('returns 99% on all fifteen wheels', () => {
    const n = mcRounds(2_000_000);
    const rng = mcRng(20260929);
    for (const risk of RISKS) {
      for (const segs of SEGMENTS) {
        const w = WHEELS[risk][segs];
        const t = new Tally();
        for (let i = 0; i < n; i++) t.add(w[drawSegment(rng, segs)]! / 100 - 1);
        console.log(t.summary(`wheel ${risk} ${segs}`, 0.01));
        expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
      }
    }
  });

  it('matches through the whole engine', () => {
    const n = mcRounds(300_000);
    const sim = new TableSim<WheelState, WheelAction, WheelView>(engine, mcRng(20260930), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'spin', bet: 100, risk: 'medium', segments: 30 });
      const e = sim.lastEvents[0] as WheelEvent;
      expect(sim.stack(0) - before).toBe(e.payout - 100);
      t.add(e.payout / 100 - 1);
    }
    console.log(t.summary('wheel engine medium 30', 0.01));
    expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
  });
});
