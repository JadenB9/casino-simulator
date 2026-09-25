import { describe, it, expect } from 'vitest';
import { LOTS, ZONES, clampTo, inRect, zoneOf } from '../src/zones.ts';
import { FLOOR_BOUNDS } from '../src/protocol.ts';

describe('zones', () => {
  it('keeps the casino where it always was and the zones apart', () => {
    expect(ZONES.casino).toEqual({ ...FLOOR_BOUNDS });
    const ids = Object.keys(ZONES) as (keyof typeof ZONES)[];
    for (const a of ids)
      for (const b of ids) {
        if (a === b) continue;
        const A = ZONES[a];
        const B = ZONES[b];
        expect(A.maxX < B.minX || B.maxX < A.minX || A.maxZ < B.minZ || B.maxZ < A.minZ, `${a}/${b}`).toBe(true);
      }
  });

  it('puts every ground lot inside the ground zone, the jail and the garage across the street', () => {
    for (const [id, r] of Object.entries(LOTS)) {
      expect(inRect(ZONES.ground, r.minX, r.minZ) && inRect(ZONES.ground, r.maxX, r.maxZ), id).toBe(true);
      expect(zoneOf((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2), id).toBe('ground');
    }
    expect(LOTS.jail.minX).toBeGreaterThanOrEqual(LOTS.street.maxX);
    expect(LOTS.garage.minX).toBeGreaterThanOrEqual(LOTS.street.maxX);
    expect(LOTS.jail.maxZ).toBeLessThan(LOTS.garage.minZ);
  });

  it('finds the zone of a point and clamps into a rect', () => {
    expect(zoneOf(0, 0)).toBe('casino');
    expect(zoneOf(-13_000, 0)).toBe('roof');
    expect(zoneOf(5_000, 0)).toBeNull();
    expect(clampTo(LOTS.jail, 0, 0)).toEqual({ x: LOTS.jail.minX, z: LOTS.jail.maxZ });
  });
});
