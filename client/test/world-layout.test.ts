import { describe, expect, it } from 'vitest';
import { checkLayout, planFloor, setVpMode, slotVariants, type Footprint } from '../src/world/layout.ts';
import type { GameId } from '../../shared/src/engine.ts';

// Today's footprints (each game module's), and typical bigger ones (tables with their chairs), so
// the floor stays sound when a model grows.
const TODAY: Record<GameId, Footprint> = {
  blackjack: { width: 2.3, depth: 1.15 }, baccarat: { width: 2.2, depth: 1.25 }, threecard: { width: 2.5, depth: 1.25 },
  roulette: { width: 2.86, depth: 1.06 }, craps: { width: 3.7, depth: 1.62 }, holdem: { width: 3.68, depth: 2.44 },
  slots: { width: 0.8, depth: 0.8 }, videopoker: { width: 0.74, depth: 1.36 }, highcard: { width: 1.6, depth: 1.6 },
  war: { width: 2.5, depth: 1.25 }, sicbo: { width: 2.5, depth: 1.42 }, bigsix: { width: 2.4, depth: 1.9 },
};
const REAL: Record<GameId, Footprint> = {
  blackjack: { width: 2.5, depth: 2.0 }, baccarat: { width: 2.8, depth: 2.1 }, threecard: { width: 2.5, depth: 2.0 },
  roulette: { width: 3.1, depth: 2.2 }, craps: { width: 4.3, depth: 2.4 }, holdem: { width: 3.7, depth: 2.5 },
  slots: { width: 0.8, depth: 0.9 }, videopoker: { width: 0.7, depth: 0.8 }, highcard: { width: 1.6, depth: 1.6 },
  war: { width: 2.5, depth: 2.0 }, sicbo: { width: 2.6, depth: 2.1 }, bigsix: { width: 2.6, depth: 1.8 },
};
const SIX = ['sevens', 'neon', 'wild', 'diamonds', 'cherries', 'goldrush'];

describe('floor plan', () => {
  it.each([
    ['today', TODAY, slotVariants()],
    ['today, six islands', TODAY, SIX],
    ['real models', REAL, slotVariants()],
    ['real models, six islands', REAL, SIX],
  ] as const)('%s: nothing overlaps or clips', (_name, fps, slots) => {
    const plan = planFloor((g) => fps[g], slots);
    expect(checkLayout(plan)).toEqual([]);
  });

  it('still sound with bar-top video poker', () => {
    const plan = planFloor((g) => TODAY[g]);
    setVpMode(plan, 'bartop');
    expect(plan.bar.segments).toHaveLength(1);
    expect(plan.bar.stools.length).toBeGreaterThan(8);
    expect(checkLayout(plan)).toEqual([]);
  });

  it('has no rope barriers: only real things are solid', () => {
    const plan = planFloor((g) => TODAY[g]);
    expect('ropes' in plan).toBe(false);
    expect(plan.solids.some((s) => /rope|stanchion/.test(s.id))).toBe(false);
  });

  it('keeps plants, palms and signs off the walls and under the ceiling', () => {
    const plan = planFloor((g) => TODAY[g], SIX);
    expect(plan.plants.length).toBeGreaterThanOrEqual(7);
    expect(plan.palms).toHaveLength(2);
    for (const p of plan.palms) expect(0.55 + p.size).toBeLessThan(3.4);
  });

  it('catches something passing through something else', () => {
    const plan = planFloor((g) => TODAY[g]);
    const stool = plan.solids.find((s) => s.id === 'stool-1')!;
    // a stool pushed into the bar's foot rail and counter
    stool.x = plan.bar.front - 0.1;
    // a sign hung too high goes through the ceiling
    const sign = plan.solids.find((s) => s.id === 'sign-poker')!;
    sign.y1 = 3.5;
    // a plant in a table
    const bj = plan.stations.find((s) => s.id === 'bj-1')!;
    plan.solids.push({ id: 'stray-plant', group: 'stray', x: bj.x, z: bj.z, w: 1.2, d: 1.2, yaw: 0, y0: 0.4, y1: 1.5, round: true });
    const problems = checkLayout(plan);
    expect(problems.some((p) => p.includes('stool-1') && p.includes('bar-rail'))).toBe(true);
    expect(problems).toContain('sign-poker pokes through the ceiling');
    expect(problems).toContain('stray-plant clips bj-1');
    // and only those
    expect(problems.every((p) => /stool-1|sign-poker|stray-plant/.test(p))).toBe(true);
  });
});
