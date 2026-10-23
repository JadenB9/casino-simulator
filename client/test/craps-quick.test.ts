import { describe, it, expect } from 'vitest';
import { engine } from '../../shared/src/games/craps/engine.ts';
import type { CrapsView } from '../../shared/src/games/craps/protocol.ts';
import type { PointNumber } from '../../shared/src/games/craps/rules.ts';
import { applyLimits } from '../../shared/src/limits.ts';
import { quickBets, quickNumbers, QUICKS } from '../src/games/craps/quick.ts';
import { TableSim } from '../../shared/test/helpers/table-sim.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';

const D = 100;
const std = engine.config('', 'solo');

describe('craps quick calls', () => {
  it('Across is every number but the point; Inside the 5, 6, 8 and 9 but the point; the Hardways all four', () => {
    expect(quickNumbers('across', null)).toEqual([4, 5, 6, 8, 9, 10]);
    expect(quickNumbers('across', 6)).toEqual([4, 5, 8, 9, 10]);
    expect(quickNumbers('inside', null)).toEqual([5, 6, 8, 9]);
    expect(quickNumbers('inside', 9)).toEqual([5, 6, 8]);
    expect(quickNumbers('hardways', 4)).toEqual([4, 6, 8, 10]);
  });

  it('sizes a call as dealers do: $5 and $6 for a red chip, five times that for a green one', () => {
    const red = quickBets('across', std, 5 * D, null, {}, 10_000 * D);
    expect('bets' in red && red.bets.map((b) => [b.number, b.amount / D])).toEqual([[4, 5], [5, 5], [6, 6], [8, 6], [9, 5], [10, 5]]);
    expect('bets' in red && red.total).toBe(32 * D);
    const green = quickBets('inside', std, 25 * D, null, {}, 10_000 * D);
    expect('bets' in green && green.total).toBe(110 * D);
    const hard = quickBets('hardways', std, 5 * D, 8, {}, 10_000 * D);
    expect('bets' in hard && hard.bets.map((b) => b.amount)).toEqual([500, 500, 500, 500]);
  });

  it('never under a table minimum, never over a spot maximum', () => {
    const high = applyLimits(std, { min: 25 * D, max: 5_000 * D });
    const r = quickBets('across', high, 5 * D, null, {}, 100_000 * D);
    expect('bets' in r).toBe(true);
    if ('bets' in r) for (const b of r.bets) expect(b.amount).toBe(b.number === 6 || b.number === 8 ? high.limits.place6!.min : high.limits.place4!.min);
    const full = quickBets('hardways', std, 500 * D, null, { hard4: { amount: 1_000 * D } }, 100_000 * D);
    expect('bets' in full && full.bets.map((b) => b.number)).toEqual([6, 8, 10]);
    expect(quickBets('across', std, 5 * D, null, {}, 10 * D)).toMatchObject({ refusal: expect.stringMatching(/more than your stack/) });
  });

  it('the engine takes every call at every point, as one batch', () => {
    for (const point of [null, 4, 5, 6, 8, 9, 10] as (PointNumber | null)[]) {
      for (const q of QUICKS) {
        for (const chip of [D, 5 * D, 25 * D, 100 * D, 500 * D]) {
          const sim = new TableSim(engine, seededRng(9), 'solo', [{ seat: 0, stack: 50_000 * D }], std);
          // the puck set by hand, as a roll that made the point would leave it
          if (point !== null) (sim.state as { point: PointNumber | null }).point = point;
          const view = engine.view(sim.state, 0) as CrapsView;
          const r = quickBets(q.id, std, chip, view.point, view.bets[0] ?? {}, sim.stack(0));
          expect('bets' in r, `${q.id} ${point} ${chip}`).toBe(true);
          if (!('bets' in r)) continue;
          sim.act(0, { type: 'bet', bets: r.bets });
          expect(sim.stack(0)).toBe(50_000 * D - r.total);
        }
      }
    }
  });
});
