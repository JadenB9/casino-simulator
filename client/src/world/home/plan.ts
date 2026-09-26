// v7: the apartment's plan, in world metres inside the home zone (shared/src/zones.ts ZONES.home:
// x -160..-120, z 50..90). One plan for everyone; each owner is alone in theirs.
//
//   The elevator opens from the west wall into an entry hall. North of the hall the bedroom
//   (behind a partition with a door by the hall), north-east the kitchen along the glass and the
//   dining table under its light; south-west a games corner, south-east the living room facing a
//   wall for the television, the piano by the east glass. Past the east glass, the terrace (the
//   Penthouse step opens its door). Glass on three sides: the city at night, 31 floors down.
//
// Every piece of furniture has its place (SLOTS, by shared/src/estate.ts HomeSlot), where you walk
// up to it and E offers that slot's pieces.

import type { HomeSlot } from '../../../../shared/src/estate.ts';
import { LIFTS } from '../../../../shared/src/lifts.ts';

/** The flat inside its walls, the ceiling's height, the walls' thickness. */
export const APT = { x0: LIFTS.home.x / 100, x1: -130, z0: 58, z1: 84, height: 3.8, wall: 0.24 } as const;

/** The entry hall by the elevator. */
export const HALL = { x0: APT.x0, x1: -150, z0: 66, z1: 74 } as const;

/** The bedroom's partitions: along z (its south side, a door by the hall) and along x (its east side). */
export const BEDROOM = { x1: -143, z1: 65.8, door: { x0: -153.5, x1: -152 } } as const;

/**
 * v7.4: the en-suite bathroom in the bedroom's south-east corner, inside the bedroom's two
 * partitions (east and south) and two walls of its own (west, and north with the door toward the
 * bed): the room inside its walls, and the door's x range.
 */
export const BATH = { x0: -147.3, x1: -143, z0: 61.2, z1: 65.68, door: { x0: -146.9, x1: -146 }, wall: 0.1 } as const;

/** The south wall is solid this far east (the television's wall), glass the rest of the way. */
export const SOUTH_SOLID_TO = -137.6;

/** The terrace past the east glass, and its door (open from the Penthouse step). */
export const TERRACE = { x0: APT.x1, x1: -121.4, z0: 60, z1: 82, door: { z0: 70.2, z1: 73.8 } } as const;

/** How far below the flat the street is (the city's lights down there). */
export const DEPTH = 104;

export interface SlotPlace {
  x: number;
  z: number;
  /** The way the piece faces (rotation.y: 0 faces +z). */
  yaw: number;
  /** Stand within this of it for E (m). */
  reach: number;
  /** Where the prompt points (the piece's middle, or its front). */
  label?: string;
}

/** Where each slot's piece stands. */
export const SLOTS: Record<HomeSlot, SlotPlace> = {
  bed: { x: -151.9, z: 61.8, yaw: Math.PI / 2, reach: 2.6 },
  safe: { x: -144.1, z: 58.7, yaw: 0, reach: 1.6 },
  kitchen: { x: -136.4, z: 60.2, yaw: 0, reach: 2.8 },
  dining: { x: -137.2, z: 66.4, yaw: 0, reach: 2.4 },
  chandelier: { x: -137.2, z: 66.4, yaw: 0, reach: 0 },
  bar: { x: -147.4, z: 66.35, yaw: 0, reach: 1.9 },
  aquarium: { x: -142.72, z: 62, yaw: Math.PI / 2, reach: 2.2 },
  tv: { x: -141.6, z: 83.7, yaw: Math.PI, reach: 2.4 },
  sofa: { x: -141.6, z: 78.8, yaw: 0, reach: 2 },
  rug: { x: -141.6, z: 80.4, yaw: 0, reach: 0 },
  art: { x: -153.86, z: 79.6, yaw: Math.PI / 2, reach: 2.2 },
  games: { x: -149.6, z: 79.6, yaw: Math.PI / 2, reach: 2.2 },
  arcade: { x: -153.3, z: 75.4, yaw: Math.PI / 2, reach: 1.4 },
  jukebox: { x: -146.4, z: 83.45, yaw: Math.PI, reach: 1.4 },
  piano: { x: -134.2, z: 79.4, yaw: -Math.PI / 2, reach: 2.2 },
  plant: { x: -131, z: 83.1, yaw: 0, reach: 1.2 },
  trophy: { x: -153.62, z: 73.1, yaw: Math.PI / 2, reach: 1.4 },
  sculpture: { x: -138.4, z: 71.8, yaw: 0, reach: 1.6 },
  neon: { x: -147.4, z: 65.9, yaw: 0, reach: 0 },
  telescope: { x: -131.3, z: 60.4, yaw: Math.PI / 2, reach: 1.4 },
  // v7.4: the bathroom (E inside it, or at its door)
  bath: { x: -145.15, z: 63.44, yaw: 0, reach: 2.2 },
};

/** The fireplace (the Grand step) on the living room's wall, beside the television. */
export const FIREPLACE = { x: -134.9, z: 83.7 } as const;

/** Where the home panel is (a wall tablet by the elevator): E opens the whole catalogue and the upgrades. */
export const TABLET = { x: -150.2, z: 73.84, yaw: Math.PI } as const;

/** Inside the flat (not the terrace)? */
export function inFlat(x: number, z: number): boolean {
  return x >= APT.x0 && x <= APT.x1 && z >= APT.z0 && z <= APT.z1;
}

/** On the terrace? */
export function onTerrace(x: number, z: number): boolean {
  return x > APT.x1 && x <= TERRACE.x1 && z >= TERRACE.z0 && z <= TERRACE.z1;
}
