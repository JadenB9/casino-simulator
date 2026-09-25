// The waiters' rounds on today's floor (client/src/world/life/routes.ts): the building's loop and
// rounds through the pit, the poker room and the slots, all the same length, walkable, and timed
// so that no two waiters are ever at the bar's pickup together.

import { describe, expect, it } from 'vitest';
import { planFloor, slotVariants, type Footprint } from '../src/world/layout.ts';
import { lifePoints } from '../src/world/life-points.ts';
import { walkGrid } from '../src/world/reach.ts';
import { NAV_CELL, NAV_RADIUS, NavGrid } from '../src/world/life/nav.ts';
import { waiterRounds } from '../src/world/life/routes.ts';
import type { GameId } from '../../shared/src/engine.ts';

const TODAY: Record<GameId, Footprint> = {
  blackjack: { width: 2.3, depth: 1.15 }, baccarat: { width: 2.2, depth: 1.25 }, threecard: { width: 2.5, depth: 1.25 },
  roulette: { width: 2.86, depth: 1.06 }, craps: { width: 3.7, depth: 1.62 }, holdem: { width: 3.68, depth: 2.44 },
  slots: { width: 0.8, depth: 0.8 }, videopoker: { width: 0.74, depth: 1.36 }, highcard: { width: 1.6, depth: 1.6 },
  war: { width: 2.5, depth: 1.25 }, sicbo: { width: 2.5, depth: 1.42 }, bigsix: { width: 2.4, depth: 1.9 },
  plinko: { width: 1.2, depth: 1.6 }, tower: { width: 1.2, depth: 1.6 }, mines: { width: 1.2, depth: 1.6 }, dice: { width: 1.2, depth: 1.6 },
  limbo: { width: 1.2, depth: 1.6 }, keno: { width: 1.2, depth: 1.6 }, hilo: { width: 1.2, depth: 1.6 }, crash: { width: 1.2, depth: 1.6 },
  banditwheel: { width: 4.0, depth: 3.0 },
  coinflip: { width: 1.2, depth: 1.6 }, wheel: { width: 1.2, depth: 1.6 }, cases: { width: 1.2, depth: 1.6 }, diamonds: { width: 1.2, depth: 1.6 },
  letitride: { width: 2.72, depth: 1.4 }, paigow: { width: 2.72, depth: 1.4 }, bingo: { width: 4.8, depth: 6.6 }, pachinko: { width: 0.6, depth: 0.52 },
};

describe("the waiters' rounds on today's floor", () => {
  const plan = planFloor((g) => TODAY[g], slotVariants());
  const points = lifePoints(plan);
  const grid = NavGrid.fromWalk(walkGrid(plan, { radius: NAV_RADIUS, cell: NAV_CELL }));
  const rounds = waiterRounds(points, plan, grid, 4);

  it('makes four rounds of the same length', () => {
    expect(rounds).toHaveLength(4);
    const p = rounds[0]!.round.period;
    for (const r of rounds) expect(r.round.period).toBeCloseTo(p, 6);
    // long enough to be a real round of the floor, short enough to see the waiters come by
    expect(p).toBeGreaterThan(40);
    expect(p).toBeLessThan(200);
  });

  it('keeps every waiter on open floor, and never two at the pickup at once', () => {
    const pickup = points.bar.pickup;
    const p = rounds[0]!.round.period;
    for (let t = 0; t < p; t += 0.25) {
      const at = rounds.map((r) => r.round.at(t + r.offset));
      for (const s of at) expect(grid.isClear(s.x, s.z)).toBe(true);
      const there = at.filter((s) => Math.hypot(s.x - pickup.x, s.z - pickup.z) < 0.9);
      expect(there.length).toBeLessThanOrEqual(1);
    }
  });

  it('serves somewhere on every round, and collects at the bar first', () => {
    for (const r of rounds) {
      expect(r.round.serveCount).toBeGreaterThan(0);
      let t = 0;
      while (!r.round.at(t).stop && t < r.round.period) t += 0.1;
      expect(r.round.at(0).stop?.kind).toBe('pickup');
    }
  });
});
