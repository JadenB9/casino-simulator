// The law's picture of the casino against the floor as it's built: the rooms the staff see
// within (shared/src/law/plan.ts) are the rooms' real bounds, and every leg of every patrol loop
// (shared/src/law/patrol.ts) can be walked without going through a table, a wall or anything
// standing on the floor.

import { describe, expect, it } from 'vitest';
import { planFloor } from '../src/world/layout.ts';
import { ROOMS as FLOOR_ROOMS } from '../src/world/rooms.ts';
import { segmentClear, walkGrid } from '../src/world/reach.ts';
import { GAMES } from '../src/games/index.ts';
import { ROOMS } from '../../shared/src/law/plan.ts';
import { STAFF } from '../../shared/src/law/patrol.ts';

describe('the law and the floor plan', () => {
  it('knows every room by its real bounds', () => {
    const real = Object.fromEntries(FLOOR_ROOMS.map((r) => [r.id, { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 }]));
    expect(ROOMS).toEqual(real);
  });

  it('walks the staff only where people can walk', () => {
    const plan = planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
    // a guard is a little narrower than the grid's walker plus its margin
    const grid = walkGrid(plan, { radius: 0.3 });
    const blocked: string[] = [];
    for (const s of STAFF) {
      const r = s.route;
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        if (!segmentClear(grid, a, b)) blocked.push(`${s.id}: (${a.x}, ${a.z}) to (${b.x}, ${b.z})`);
      }
    }
    expect(blocked).toEqual([]);
  });
});
