// The celebrities' routes and the gift box's spots (shared/src/celebs.ts) against the building:
// every leg a straight walk through open floor, a body's width from anything solid, never through
// a table; every stop in a room with somewhere to stand round it; every table stop at a table;
// every gift spot on open floor you can walk to from the doors. The server checks nearness
// against these same routes, so they must be where the clients draw the walk.
//
// If the building changes and a leg is blocked, the failure prints the waiters' A* path between
// its ends (nav.ts) to put in its place.

import { describe, expect, it } from 'vitest';
import { SPAWN, planFloor, roomAt } from '../src/world/layout.ts';
import { reachFrom, reached, walkGrid } from '../src/world/reach.ts';
import { NAV_CELL, NAV_RADIUS, NavGrid } from '../src/world/life/nav.ts';
import { GAMES } from '../src/games/index.ts';
import { GIFT_SPOTS, ROUTES, ROUTE_IDS, faceYaw } from '../../shared/src/celebs.ts';

const plan = planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
const grid = NavGrid.fromWalk(walkGrid(plan, { radius: NAV_RADIUS, cell: NAV_CELL }));
const walk = walkGrid(plan);
const seen = reachFrom(walk, SPAWN.x, SPAWN.z);

describe('celebrity routes', () => {
  for (const id of ROUTE_IDS) {
    it(`${id}: every leg is open floor`, () => {
      const pts = ROUTES[id].pts.map(([x, z]) => ({ x, z }));
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (!grid.lineClear(a, b)) {
          const fix = grid.path(a, b)?.map((p) => `[${p.x.toFixed(2)}, ${p.z.toFixed(2)}]`).join(', ');
          expect.fail(`${id} leg ${i - 1}->${i} (${a.x},${a.z})->(${b.x},${b.z}) is blocked; walkable: ${fix ?? 'none'}`);
        }
      }
      for (const p of pts) expect(reached(walk, seen, p.x, p.z), `${id} (${p.x}, ${p.z}) reachable from the doors`).toBe(true);
    });

    it(`${id}: stops are in rooms, with room round them for the crowd`, () => {
      for (const s of ROUTES[id].stops) {
        const [x, z] = ROUTES[id].pts[s.at]!;
        expect(roomAt(plan, x, z), `${id} stop at (${x}, ${z})`).not.toBeNull();
        // somewhere to stand in front of them for at least three people
        const yaw = faceYaw(s.face);
        let open = 0;
        for (const da of [-0.8, -0.4, 0, 0.4, 0.8]) {
          const fx = x + Math.sin(yaw + da) * 1.8;
          const fz = z + Math.cos(yaw + da) * 1.8;
          if (grid.isClear(fx, fz) || s.kind === 'table') open++;
        }
        expect(open, `${id} ${s.kind} at (${x}, ${z})`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${id}: a table stop is at a table, facing it`, () => {
      for (const s of ROUTES[id].stops.filter((q) => q.kind === 'table')) {
        const [x, z] = ROUTES[id].pts[s.at]!;
        const yaw = faceYaw(s.face);
        // two metres ahead of them is a station (or the Bandit Wheel's yard)
        const ax = x + Math.sin(yaw) * 2;
        const az = z + Math.cos(yaw) * 2;
        const near = plan.stations.filter((st) => Math.hypot(st.x - ax, st.z - az) < 2.6);
        expect(near.length, `${id} table stop at (${x}, ${z})`).toBeGreaterThan(0);
      }
    });
  }
});

describe('gift box spots', () => {
  it('are on open floor you can walk to, spread over the building', () => {
    const rooms = new Set<string>();
    for (const [x, z] of GIFT_SPOTS) {
      expect(grid.isClear(x, z), `(${x}, ${z}) clear`).toBe(true);
      expect(reached(walk, seen, x, z), `(${x}, ${z}) reachable`).toBe(true);
      rooms.add(roomAt(plan, x, z)!.id);
    }
    expect(rooms.size).toBeGreaterThanOrEqual(10);
  });
});
