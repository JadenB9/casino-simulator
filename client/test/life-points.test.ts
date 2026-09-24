import { describe, expect, it } from 'vitest';
import { SPAWN, planFloor, type FloorPlan, type Solid } from '../src/world/layout.ts';
import { SEAT_TOPS, lifePoints, type LifePoints } from '../src/world/life-points.ts';
import { FURNITURE } from '../src/world/furniture-spec.ts';
import { reachFrom, reached, segmentClear, walkGrid, isFree } from '../src/world/reach.ts';
import { GAMES } from '../src/games/index.ts';

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
const SEAT_FURNITURE = /^(stool-|lounge-\d+-couch-|[a-z]+-(sofa|armchair|tub|bench|banquette|hightop|crate|plank-bench)-\d+)/;

describe('life points', () => {
  const plan = planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
  const pts: LifePoints = lifePoints(plan);
  const grid = walkGrid(plan);
  const seen = reachFrom(grid, SPAWN.x, SPAWN.z);
  const staff = walkGrid(plan, { radius: 0.24 });

  it('has seats with stable, unique, wire-safe ids, in every room that has somewhere to sit', () => {
    expect(pts.seats.length).toBeGreaterThan(80);
    const ids = pts.seats.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9._:-]{1,40}$/);
    const rooms = new Set(pts.seats.map((s) => s.room));
    for (const r of ['bar', 'lounge', 'lobby', 'bank', 'salon', 'poker', 'online', 'yard', 'pit', 'boutique']) expect(rooms.has(r), r).toBe(true);
    const kinds = new Set(pts.seats.map((s) => s.kind));
    for (const k of ['chair', 'stool', 'sofa', 'bench']) expect(kinds.has(k as 'chair'), k).toBe(true);
  });

  it('lists every online desk chair with its station', () => {
    const desks = pts.seats.filter((s) => s.station);
    expect(desks).toHaveLength(16);
    for (const d of desks) {
      expect(plan.stations.find((s) => s.id === d.station)?.zone).toBe('online');
      expect(d.top).toBe(SEAT_TOPS.desk);
    }
  });

  it('gives every seat the top of the furniture placed there', () => {
    for (const s of pts.seats) {
      if (s.station) continue;
      const kind = s.id.split('.')[1]!;
      if (kind === 'stool') expect(s.top, s.id).toBe(SEAT_TOPS.barStool);
      else if (kind === 'sofa') expect(s.top, s.id).toBe(SEAT_TOPS.sofa);
      else expect(s.top, s.id).toBe(FURNITURE[kind as keyof typeof FURNITURE].top);
      expect(s.top).toBeGreaterThanOrEqual(0.3);
      expect(s.top).toBeLessThanOrEqual(0.95);
    }
    // a seat's hip point is on a piece the plan placed
    for (const s of pts.seats) {
      if (s.station) continue;
      const holders = plan.solids.filter((o) => inside(o, s.x, s.z) && SEAT_FURNITURE.test(o.id));
      expect(holders.length, `${s.id} sits on nothing`).toBeGreaterThan(0);
    }
  });

  it('puts no seat inside anything but its own furniture, and none in a station but a desk chair in its desk', () => {
    for (const s of pts.seats) {
      const bad = plan.solids.filter((o) => inside(o, s.x, s.z) && !SEAT_FURNITURE.test(o.id));
      expect(bad.map((o) => o.id), s.id).toEqual([]);
      expect(inStation(plan, s.x, s.z), s.id).toBe(s.station ?? null);
    }
  });

  it('can walk from the doors to every seat', () => {
    expect(isFree(grid, SPAWN.x, SPAWN.z)).toBe(true);
    const far = pts.seats.filter((s) => !reached(grid, seen, s.x, s.z, 1.0)).map((s) => s.id);
    expect(far).toEqual([]);
  });

  it('can walk to every customer point, and staff points stand clear of everything', () => {
    expect(pts.bank.windows).toHaveLength(3);
    for (const w of pts.bank.windows) {
      expect(reached(grid, seen, w.customer.x, w.customer.z), 'teller window').toBe(true);
      expect(isFree(staff, w.banker.x, w.banker.z), 'banker').toBe(true);
    }
    expect(reached(grid, seen, pts.bar.pickup.x, pts.bar.pickup.z), 'bar pickup').toBe(true);
    const t = pts.bar.tender;
    for (const [x, z] of [[(t.x0 + t.x1) / 2, t.z0], [(t.x0 + t.x1) / 2, t.z1], [(t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2]] as const) {
      expect(isFree(staff, x, z), `bartender at ${x},${z}`).toBe(true);
    }
    const b = pts.boutique!;
    expect(b).not.toBeNull();
    expect(reached(grid, seen, b.customer.x, b.customer.z), 'boutique counter').toBe(true);
    expect(isFree(staff, b.keeper.x, b.keeper.z), 'shopkeeper').toBe(true);
    expect(b.cases.length).toBeGreaterThanOrEqual(2);
    expect(b.mannequins.length).toBeGreaterThanOrEqual(4);
    for (const c of [...b.cases, ...b.mannequins]) expect(reached(grid, seen, c.x, c.z, 0.3), `case/mannequin at ${c.x},${c.z}`).toBe(true);
    for (const m of b.mannequins) expect(m.item, 'a mannequin opens the shop at its piece').toBeTruthy();
  });

  it('runs every waiter loop through clear floor, reachable from the doors', () => {
    expect(pts.routes?.length).toBeGreaterThanOrEqual(3);
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
