import { describe, it, expect } from 'vitest';
import { nearestFree } from '../src/world/fx/dev.ts';
import { planFloor } from '../src/world/layout.ts';
import { isFree, walkGrid } from '../src/world/reach.ts';
import { GAMES } from '../src/games/index.ts';

// The dev floor's stranger (fx6's e2e) is stood where a walker could stand: never in the pit's
// fountain, a statue's plinth or a wall.

const plan = planFloor((g) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
const grid = walkGrid(plan);

describe('nearestFree', () => {
  it('leaves a free spot where it is', () => {
    expect(nearestFree(grid, 0, 12.8)).toEqual([0, 12.8]);
  });

  it('moves a spot in a fountain out of the water, close by', () => {
    for (const f of plan.fountains) {
      expect(isFree(grid, f.x, f.z)).toBe(false);
      const [x, z] = nearestFree(grid, f.x, f.z);
      expect(isFree(grid, x, z)).toBe(true);
      expect(Math.hypot(x - f.x, z - f.z)).toBeLessThan(3);
    }
  });

  it('moves a spot on a statue plinth off it', () => {
    for (const s of plan.statues) {
      const [x, z] = nearestFree(grid, s.x, s.z);
      expect(isFree(grid, x, z)).toBe(true);
    }
  });
});
