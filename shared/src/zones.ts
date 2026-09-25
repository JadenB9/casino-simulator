// The places you can be. The casino floor is one zone; the elevator in the lobby goes down to the
// ground floor (the valet lobby, the valet parking, the street, and across it the garage and the
// jail) and up to the roof terrace. Each zone is its own patch of the same world, far enough apart
// that one never shows in another, so positions stay plain (x, z) centimetres everywhere and the
// floor's presence works unchanged. You walk inside a zone; only the server moves you between
// zones (the elevator, being taken to jail, being let out), so a client can't walk through walls
// to get somewhere.
//
// Rects are integer centimetres, like presence positions. The lots inside the ground zone are
// fixed here because three slices build on them: the city (streets, valet lobby, roof), the cars
// (the garage lot) and the law (the jail lot).

import { FLOOR_BOUNDS } from './protocol.ts';

export type ZoneId = 'casino' | 'ground' | 'roof';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const ZONES: Record<ZoneId, Rect> = {
  casino: { ...FLOOR_BOUNDS },
  ground: { minX: 10_000, maxX: 22_000, minZ: -6_000, maxZ: 6_000 },
  roof: { minX: -16_000, maxX: -11_000, minZ: -2_000, maxZ: 2_000 },
};

/** Lots on the ground floor (inside ZONES.ground). */
export const LOTS = {
  /** The valet lobby, where the elevator arrives (x 100-128 m). */
  lobby: { minX: 10_000, maxX: 12_800, minZ: -1_500, maxZ: 1_500 },
  /** The valet stand, the drive and the parking (x 128-150 m). */
  valet: { minX: 12_800, maxX: 15_000, minZ: -4_000, maxZ: 4_000 },
  /** The street (x 150-166 m), running the length of the zone. */
  street: { minX: 15_000, maxX: 16_600, minZ: -6_000, maxZ: 6_000 },
  /** Across the street: the jail (south) and the garage (north). */
  jail: { minX: 16_600, maxX: 19_600, minZ: -4_500, maxZ: -500 },
  garage: { minX: 16_600, maxX: 20_000, minZ: 500, maxZ: 4_500 },
} as const satisfies Record<string, Rect>;

export function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

/** The zone a point is in, or null (between zones). */
export function zoneOf(x: number, z: number): ZoneId | null {
  for (const id of Object.keys(ZONES) as ZoneId[]) if (inRect(ZONES[id], x, z)) return id;
  return null;
}

export function clampTo(r: Rect, x: number, z: number): { x: number; z: number } {
  return { x: Math.min(r.maxX, Math.max(r.minX, x)), z: Math.min(r.maxZ, Math.max(r.minZ, z)) };
}
