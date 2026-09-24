// The waiters' navigation grid (client/src/world/life/nav.ts): built from the same collision
// shapes the player bumps into, paths that go round tables and through doorways and never pass
// closer to anything than a body's radius, pulled straight across open floor.

import { describe, expect, it } from 'vitest';
import { Collider } from '../src/world/collision.ts';
import { NAV_RADIUS, NavGrid, pathLength, type Pt } from '../src/world/life/nav.ts';

const ROOM = { x0: -10, z0: -8, x1: 10, z1: 8 };

/** A room with walls round it, as room.ts builds them. */
function room(): Collider {
  const c = new Collider();
  c.box(0, ROOM.z0 - 0.15, 20.6, 0.3, 0, 3.4);
  c.box(0, ROOM.z1 + 0.15, 20.6, 0.3, 0, 3.4);
  c.box(ROOM.x0 - 0.15, 0, 0.3, 16.6, 0, 3.4);
  c.box(ROOM.x1 + 0.15, 0, 0.3, 16.6, 0, 3.4);
  return c;
}

/** The distance from a point to the nearest thing that blocks walking. */
function clearance(c: Collider, p: Pt): number {
  let best = Infinity;
  for (const b of c.boxes) {
    if (!b.walk) continue;
    const co = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    const dx = p.x - b.cx;
    const dz = p.z - b.cz;
    const lx = dx * co - dz * s;
    const lz = dx * s + dz * co;
    best = Math.min(best, Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(lz) - b.hz)));
  }
  for (const q of c.posts) if (q.walk) best = Math.min(best, Math.hypot(p.x - q.cx, p.z - q.cz) - q.r);
  return best;
}

/** Every 5 cm along the path keeps at least `min` from everything solid. */
function everywhereClear(c: Collider, path: Pt[], min: number): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
      if (clearance(c, p) < min) return false;
    }
  }
  return true;
}

describe('the nav grid', () => {
  it('walks straight across open floor', () => {
    const c = room();
    const g = NavGrid.build(c, ROOM);
    const path = g.path({ x: -6, z: 0 }, { x: 6, z: 1 })!;
    expect(path).toHaveLength(2);
    expect(pathLength(path)).toBeCloseTo(Math.hypot(12, 1), 5);
  });

  it('goes round a table, never closer than a body to it, and not much further than it must', () => {
    const c = room();
    // a 2.5 x 1.2 table turned a little, right in the way
    c.box(0, 0, 2.5, 1.2, 0.3, 0.8);
    const g = NavGrid.build(c, ROOM);
    const from = { x: -5, z: 0.1 };
    const to = { x: 5, z: -0.1 };
    const path = g.path(from, to)!;
    expect(path.length).toBeGreaterThan(2);
    // the grid's cells keep a body's radius; the lines between them may shave a little off that
    expect(everywhereClear(c, path, NAV_RADIUS - g.cell * 0.75)).toBe(true);
    const straight = Math.hypot(to.x - from.x, to.z - from.z);
    expect(pathLength(path)).toBeGreaterThan(straight);
    expect(pathLength(path)).toBeLessThan(straight * 1.25);
  });

  it('finds the doorway in a wall, and walks through it', () => {
    const c = room();
    // a wall across the room with a 1.4 m gap in it, from z = -1.6 to -0.2
    c.box(0, -4.8, 0.3, 6.4, 0, 3.4);
    c.box(0, 3.9, 0.3, 8.2, 0, 3.4);
    const g = NavGrid.build(c, ROOM);
    const path = g.path({ x: -6, z: 5 }, { x: 6, z: 5 })!;
    expect(path).not.toBeNull();
    const crossing = path.findIndex((p, i) => i > 0 && Math.sign(p.x) !== Math.sign(path[i - 1]!.x));
    expect(crossing).toBeGreaterThan(0);
    // where it crosses x = 0 it is in the gap
    const a = path[crossing - 1]!;
    const b = path[crossing]!;
    const zAtWall = a.z + ((b.z - a.z) * (0 - a.x)) / (b.x - a.x);
    expect(zAtWall).toBeGreaterThan(-1.6);
    expect(zAtWall).toBeLessThan(-0.2);
    expect(everywhereClear(c, path, NAV_RADIUS - g.cell * 0.75)).toBe(true);
  });

  it('keeps clear of posts (stools, staff) as well as boxes', () => {
    const c = room();
    for (let z = -3; z <= 3; z += 0.9) c.post(0, z, 0.21, 0.8);
    const g = NavGrid.build(c, ROOM);
    const path = g.path({ x: -3, z: 0 }, { x: 3, z: 0 })!;
    expect(everywhereClear(c, path, NAV_RADIUS - g.cell * 0.75)).toBe(true);
    // the stools stand 0.48 m apart: too close for a body, so the way is round the end of the row
    expect(Math.max(...path.map((p) => Math.abs(p.z)))).toBeGreaterThan(3);
  });

  it('moves an end that stands in something onto the nearest open floor', () => {
    const c = room();
    c.box(0, 0, 2, 2, 0, 0.8);
    const g = NavGrid.build(c, ROOM);
    const path = g.path({ x: -5, z: 0 }, { x: 0.2, z: 0.1 })!;
    const end = path.at(-1)!;
    expect(g.isClear(end.x, end.z)).toBe(true);
    expect(Math.hypot(end.x - 0.2, end.z - 0.1)).toBeLessThan(1 + NAV_RADIUS + g.cell * 2);
  });

  it('says so when there is no way through', () => {
    const c = room();
    // a closed pen
    c.box(4, -2, 4, 0.3, 0, 2);
    c.box(4, 2, 4, 0.3, 0, 2);
    c.box(2, 0, 0.3, 4.3, 0, 2);
    c.box(6, 0, 0.3, 4.3, 0, 2);
    const g = NavGrid.build(c, ROOM);
    expect(g.path({ x: -5, z: 0 }, { x: 4, z: 0 })).toBeNull();
  });

  it('skips shapes it is told to (things that move)', () => {
    const c = room();
    const moving = c.post(0, 0, 0.28, 1.9);
    const g = NavGrid.build(c, ROOM, { skip: (s) => s === moving });
    expect(g.path({ x: -3, z: 0 }, { x: 3, z: 0 })).toHaveLength(2);
  });

  it('finds the same path every time (every client computes the same rounds)', () => {
    const c = room();
    c.box(0, 0, 2.5, 1.2, 0.3, 0.8);
    c.post(-2, 1, 0.4, 1);
    const a = NavGrid.build(c, ROOM).path({ x: -5, z: 0.1 }, { x: 5, z: -0.1 });
    const b = NavGrid.build(c, ROOM).path({ x: -5, z: 0.1 }, { x: 5, z: -0.1 });
    expect(a).toEqual(b);
  });
});
