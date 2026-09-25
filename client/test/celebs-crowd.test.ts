// The crowd round a celebrity (client/src/world/celebs/crowd.ts) on the real floor: two bodyguards
// and four to six fans, the same for everyone from the visit's seed, never standing in anything
// solid, never across the table from a celebrity playing it, and gathered close at every stop.

import { describe, expect, it } from 'vitest';
import { planFloor } from '../src/world/layout.ts';
import { walkGrid } from '../src/world/reach.ts';
import { NAV_CELL, NAV_RADIUS, NavGrid } from '../src/world/life/nav.ts';
import { GAMES } from '../src/games/index.ts';
import { followersOf, placeFollower, stopStart } from '../src/world/celebs/crowd.ts';
import { fanLook } from '../src/world/celebs/index.ts';
import { CELEBS, poseOn, routeOfVisit, type Visit } from '../../shared/src/celebs.ts';
import { parseLook } from '../../shared/src/look.ts';

const plan = planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
const grid = NavGrid.fromWalk(walkGrid(plan, { radius: NAV_RADIUS, cell: NAV_CELL }));
// "in something solid": a body's centre closer than a hand's width to it
const solid = NavGrid.fromWalk(walkGrid(plan, { radius: 0.12, cell: 0.05 }));

const visits: Visit[] = CELEBS.map((c, i) => ({ id: 1_790_000_000_000 + i, celeb: c.id, start: 1_790_000_000_000 + i, seed: 1000 + i * 7919 }));

describe('the crowd', () => {
  it('is two bodyguards and four to six fans, the same for the same visit', () => {
    for (const v of visits) {
      const tl = routeOfVisit(v);
      const f = followersOf(v, tl);
      expect(f.filter((x) => x.role === 'guard')).toHaveLength(2);
      const fans = f.filter((x) => x.role === 'fan').length;
      expect(fans).toBeGreaterThanOrEqual(4);
      expect(fans).toBeLessThanOrEqual(6);
      expect(followersOf({ ...v }, tl)).toEqual(f);
      // every fan joins before the doors on the way out
      for (const x of f) expect(x.joins).toBeLessThan(tl.route.stops.length - 1);
    }
  });

  it('fans are dressed as someone could be, the same on every screen', () => {
    for (let k = 0; k < 6; k++) {
      const look = fanLook(4242, k);
      expect(parseLook(look)).toEqual(look);
      expect(fanLook(4242, k)).toEqual(look);
    }
  });

  it('never stands anyone inside something solid, walking or at a stop', () => {
    for (const v of visits) {
      const tl = routeOfVisit(v);
      const f = followersOf(v, tl);
      for (let t = 0; t <= tl.secs; t += 0.5) {
        for (const x of f) {
          const p = placeFollower(x, f, tl, t, grid);
          if (!p.here) continue;
          expect(solid.isClear(p.x, p.z), `${v.celeb} ${x.role} ${x.k} at ${t}s (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(true);
        }
      }
    }
  });

  it('gathers everyone close at each stop, with nothing between them and the celebrity', () => {
    for (const v of visits) {
      const tl = routeOfVisit(v);
      const f = followersOf(v, tl);
      for (const s of tl.segs) {
        if (s.kind !== 'stop') continue;
        // the middle of the stop: everyone has had time to find their place
        const t = (s.t0 + s.t1) / 2;
        const star = poseOn(tl, t);
        for (const x of f) {
          const p = placeFollower(x, f, tl, t, grid);
          if (!p.here) continue;
          const d = Math.hypot(p.x - star.x, p.z - star.z);
          expect(d, `${v.celeb} stop ${s.stop} ${x.role} ${x.k}`).toBeLessThan(x.role === 'guard' ? 2.2 : 4.4);
          expect(grid.lineClear({ x: star.x, z: star.z }, { x: p.x, z: p.z }) || d < 1.2, `${v.celeb} stop ${s.stop} ${x.role} ${x.k} has a clear line to them`).toBe(true);
        }
      }
    }
  });

  it('fans turn up at the stop they join at, not before', () => {
    for (const v of visits) {
      const tl = routeOfVisit(v);
      const f = followersOf(v, tl);
      for (const x of f.filter((q) => q.role === 'fan')) {
        const start = stopStart(tl, x.joins);
        expect(placeFollower(x, f, tl, start - 0.5, grid).here).toBe(false);
        expect(placeFollower(x, f, tl, start + 0.5, grid).here).toBe(true);
      }
      // the guards are there from the doors
      for (const x of f.filter((q) => q.role === 'guard')) expect(placeFollower(x, f, tl, 0.1, grid).here).toBe(true);
    }
  });
});
