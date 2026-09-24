import { describe, expect, it } from 'vitest';
import { SPAWN, planFloor, slotVariants, type Footprint, type FloorPlan, type Solid } from '../src/world/layout.ts';
import { SEAT_TOPS, lifePoints, type LifePoints } from '../src/world/life-points.ts';
import { reachFrom, reached, segmentClear, walkGrid, isFree } from '../src/world/reach.ts';
import type { GameId } from '../../shared/src/engine.ts';

const TODAY: Record<GameId, Footprint> = {
  blackjack: { width: 2.3, depth: 1.15 }, baccarat: { width: 2.2, depth: 1.25 }, threecard: { width: 2.5, depth: 1.25 },
  roulette: { width: 2.86, depth: 1.06 }, craps: { width: 3.7, depth: 1.62 }, holdem: { width: 3.68, depth: 2.44 },
  slots: { width: 0.8, depth: 0.8 }, videopoker: { width: 0.74, depth: 1.36 }, highcard: { width: 1.6, depth: 1.6 },
  war: { width: 2.5, depth: 1.25 }, sicbo: { width: 2.5, depth: 1.42 }, bigsix: { width: 2.4, depth: 1.9 },
  plinko: { width: 1.2, depth: 1.6 }, tower: { width: 1.2, depth: 1.6 }, mines: { width: 1.2, depth: 1.6 }, dice: { width: 1.2, depth: 1.6 },
  limbo: { width: 1.2, depth: 1.6 }, keno: { width: 1.2, depth: 1.6 }, hilo: { width: 1.2, depth: 1.6 }, crash: { width: 1.2, depth: 1.6 },
  banditwheel: { width: 4.0, depth: 3.0 },
};

/** Whether a point is inside a solid's footprint (standing on the floor, at body height). */
function inside(s: Solid, x: number, z: number): boolean {
  if (s.y0 >= 1.2) return false;
  if (s.round) return Math.hypot(x - s.x, z - s.z) < s.w / 2;
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  const lx = (x - s.x) * c - (z - s.z) * n;
  const lz = (x - s.x) * n + (z - s.z) * c;
  return Math.abs(lx) < s.w / 2 && Math.abs(lz) < s.d / 2;
}

function inStation(plan: FloorPlan, x: number, z: number): string | null {
  for (const s of plan.stations) {
    const c = Math.cos(s.yaw);
    const n = Math.sin(s.yaw);
    const lx = (x - s.x) * c - (z - s.z) * n;
    const lz = (x - s.x) * n + (z - s.z) * c;
    if (Math.abs(lx) < s.fp.width / 2 && Math.abs(lz) < s.fp.depth / 2) return s.id;
  }
  return null;
}

/** The furniture a seat belongs to may hold it; anything else may not. */
const SEAT_FURNITURE = /^(stool-|lounge-\d+-couch-|seat-)/;

describe('life points', () => {
  const plan = planFloor((g) => TODAY[g], slotVariants());
  const pts: LifePoints = lifePoints(plan);
  const grid = walkGrid(plan);
  const seen = reachFrom(grid, SPAWN.x, SPAWN.z);

  it('has seats with stable, unique, wire-safe ids', () => {
    expect(pts.seats.length).toBeGreaterThan(8);
    const ids = pts.seats.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9._:-]{1,40}$/);
  });

  it('gives every seat the top of the furniture placed there', () => {
    for (const s of pts.seats) {
      if (s.kind === 'stool' && s.room === 'bar') expect(s.top).toBe(SEAT_TOPS.barStool);
      if (s.kind === 'sofa') expect(s.top).toBe(SEAT_TOPS.sofa);
      expect(s.top).toBeGreaterThanOrEqual(0.3);
      expect(s.top).toBeLessThanOrEqual(0.95);
    }
    // a bar stool's hip point is on a stool the plan placed, a sofa's on a couch
    for (const s of pts.seats) {
      const holders = plan.solids.filter((o) => inside(o, s.x, s.z));
      expect(holders.length, `${s.id} sits on nothing`).toBeGreaterThan(0);
    }
  });

  it('puts no seat inside anything but its own furniture, and none in a station', () => {
    for (const s of pts.seats) {
      const bad = plan.solids.filter((o) => inside(o, s.x, s.z) && !SEAT_FURNITURE.test(o.id));
      expect(bad.map((o) => o.id), s.id).toEqual([]);
      expect(inStation(plan, s.x, s.z), s.id).toBeNull();
    }
  });

  it('can walk from the doors to every seat', () => {
    expect(isFree(grid, SPAWN.x, SPAWN.z)).toBe(true);
    for (const s of pts.seats) expect(reached(grid, seen, s.x, s.z, 0.9), s.id).toBe(true);
  });

  it('can walk to every customer point, and staff points stand clear of everything', () => {
    for (const w of pts.bank.windows) {
      expect(reached(grid, seen, w.customer.x, w.customer.z), 'teller window').toBe(true);
      const staff = walkGrid(plan, { radius: 0.24 });
      expect(isFree(staff, w.banker.x, w.banker.z), 'banker').toBe(true);
    }
    expect(reached(grid, seen, pts.bar.pickup.x, pts.bar.pickup.z), 'bar pickup').toBe(true);
    const t = pts.bar.tender;
    const staff = walkGrid(plan, { radius: 0.24 });
    for (const [x, z] of [[(t.x0 + t.x1) / 2, t.z0], [(t.x0 + t.x1) / 2, t.z1], [(t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2]] as const) {
      expect(isFree(staff, x, z), `bartender at ${x},${z}`).toBe(true);
    }
    if (pts.boutique) {
      expect(reached(grid, seen, pts.boutique.customer.x, pts.boutique.customer.z), 'boutique counter').toBe(true);
      expect(isFree(staff, pts.boutique.keeper.x, pts.boutique.keeper.z), 'shopkeeper').toBe(true);
      for (const c of [...pts.boutique.cases, ...pts.boutique.mannequins]) expect(reached(grid, seen, c.x, c.z, 0.3), `case/mannequin at ${c.x},${c.z}`).toBe(true);
    }
  });

  it('runs every waiter loop through clear floor, reachable from the doors', () => {
    for (const route of pts.routes ?? []) {
      expect(route.length).toBeGreaterThanOrEqual(3);
      route.forEach((p, i) => {
        const q = route[(i + 1) % route.length]!;
        expect(reached(grid, seen, p.x, p.z), `route point ${p.x},${p.z}`).toBe(true);
        expect(segmentClear(grid, p, q), `route leg ${p.x},${p.z} -> ${q.x},${q.z}`).toBe(true);
      });
    }
  });
});
