// A waiter's round (client/src/world/life/rounds.ts): where the waiter is follows from the clock
// alone, so it must be continuous, repeat exactly, keep to a walking pace, hold still at stops,
// keep off everything solid, and carry the right drinks.

import { describe, expect, it } from 'vitest';
import { Collider } from '../src/world/collision.ts';
import { NavGrid } from '../src/world/life/nav.ts';
import { WAITER_SPEED, buildRound, type Stop } from '../src/world/life/rounds.ts';

const ROOM = { x0: -10, z0: -8, x1: 10, z1: 8 };

function floor(): Collider {
  const c = new Collider();
  c.box(0, ROOM.z0 - 0.15, 20.6, 0.3, 0, 3.4);
  c.box(0, ROOM.z1 + 0.15, 20.6, 0.3, 0, 3.4);
  c.box(ROOM.x0 - 0.15, 0, 0.3, 16.6, 0, 3.4);
  c.box(ROOM.x1 + 0.15, 0, 0.3, 16.6, 0, 3.4);
  // a bar along the east wall, a table in the middle, a couch
  c.box(8, 0, 1.2, 10, 0, 1.1);
  c.box(0, 0, 2.5, 1.2, 0, 0.8);
  c.box(-5, 4, 2.2, 0.9, 0, 0.9);
  return c;
}

const STOPS: Stop[] = [
  { x: 6.8, z: -3, face: Math.PI / 2, dur: 6, kind: 'pickup' },
  { x: 0, z: 1.2, face: Math.PI, dur: 3, kind: 'serve' },
  { x: -5, z: 3, face: 0, dur: 3, kind: 'serve' },
  { x: -6, z: -5, face: -Math.PI / 2, dur: 2.5, kind: 'serve' },
];

describe('a waiter round', () => {
  const c = floor();
  const grid = NavGrid.build(c, ROOM);
  const round = buildRound(grid, STOPS, 3)!;

  it('repeats exactly, whatever the clock reads', () => {
    for (const t of [0, 1.3, 17.25, 44.1]) {
      const a = round.at(t);
      const b = round.at(t + round.period * 7);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.z).toBeCloseTo(a.z, 6);
      expect(b.heading).toBeCloseTo(a.heading, 6);
      expect(round.at(t - round.period * 3).x).toBeCloseTo(a.x, 6);
    }
  });

  it('moves continuously, never faster than a waiter walks, and keeps to open floor', () => {
    const dt = 0.02;
    let prev = round.at(0);
    let maxStep = 0;
    for (let t = dt; t <= round.period + dt; t += dt) {
      const s = round.at(t);
      maxStep = Math.max(maxStep, Math.hypot(s.x - prev.x, s.z - prev.z));
      expect(s.speed).toBeLessThanOrEqual(WAITER_SPEED + 1e-9);
      expect(grid.isClear(s.x, s.z)).toBe(true);
      // the heading turns smoothly too (no snap round)
      const turn = Math.abs(Math.atan2(Math.sin(s.heading - prev.heading), Math.cos(s.heading - prev.heading)));
      expect(turn).toBeLessThan(0.25);
      prev = s;
    }
    expect(maxStep).toBeLessThanOrEqual(WAITER_SPEED * dt + 1e-6);
  });

  it('holds still at each stop for its time, turning to face it', () => {
    let t = 0;
    // find the start of the second stop (the first serve)
    while (round.at(t).stop?.kind !== 'serve') t += 0.01;
    const s0 = round.at(t);
    const mid = round.at(t + 1.5);
    expect(mid.x).toBeCloseTo(s0.x, 9);
    expect(mid.z).toBeCloseTo(s0.z, 9);
    expect(mid.speed).toBe(0);
    expect(Math.cos(mid.heading - mid.stop!.face)).toBeCloseTo(1, 6);
    expect(mid.serving).toBeGreaterThan(0.5);
  });

  it('loads the tray at the bar and sets one drink down at each serving stop', () => {
    expect(round.serveCount).toBe(3);
    const trays: number[] = [];
    for (let t = 0; t < round.period; t += 0.05) trays.push(round.at(t).tray.length);
    // empty while waiting at the bar, then 3, 2, 1 and empty again
    const runs = trays.filter((n, i) => i === 0 || n !== trays[i - 1]);
    expect(runs).toEqual([0, 3, 2, 1, 0]);
  });

  it('is the same round on every client', () => {
    const again = buildRound(NavGrid.build(floor(), ROOM), STOPS, 3)!;
    expect(again.period).toBe(round.period);
    for (const t of [2, 9.5, 31]) expect(again.at(t)).toEqual(round.at(t));
  });
});
