import { describe, expect, it } from 'vitest';
import { LANES, LOOP, laneAt, laneLength, loopDist, onLoopRoad } from '../src/world/city/loop.ts';

describe('the loop road', () => {
  it('measures distance from its centre line', () => {
    expect(loopDist(LOOP.x0, 0)).toBeCloseTo(0);
    expect(loopDist(LOOP.x1, 10)).toBeCloseTo(0);
    expect(loopDist(180, LOOP.z1)).toBeCloseTo(0);
    expect(loopDist(180, 0)).toBeLessThan(-15);
    expect(loopDist(140, 0)).toBeCloseTo(18.5);
    expect(onLoopRoad(156, 0)).toBe(true);
    expect(onLoopRoad(170, 0)).toBe(false);
  });

  it('keeps every lane point at its offset and the heading along the way it goes', () => {
    for (const o of LANES) {
      const L = laneLength(o);
      let prev = laneAt(o, 0);
      for (let s = 0.5; s <= L; s += 0.5) {
        const p = laneAt(o, s);
        expect(loopDist(p.x, p.z)).toBeCloseTo(o, 3);
        // the step taken points the way the heading says
        const dx = p.x - prev.x;
        const dz = p.z - prev.z;
        const step = Math.hypot(dx, dz);
        expect(step).toBeGreaterThan(0.45);
        expect(step).toBeLessThan(0.55);
        const want = Math.atan2(dx, dz);
        const diff = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
        expect(Math.abs(diff)).toBeLessThan(0.06);
        prev = p;
      }
    }
  });

  it('runs down the street the way the southbound lanes go', () => {
    const p = laneAt(3.75, 10);
    expect(p.x).toBeCloseTo(LOOP.x0 - 3.75);
    expect(p.yaw).toBeCloseTo(0);
    expect(laneAt(-3.75, 10, -1).yaw).toBeCloseTo(Math.PI);
  });
});
