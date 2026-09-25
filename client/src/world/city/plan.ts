// The ground floor and the roof as data, in world metres (x east, z south, like the casino). The
// ground zone (shared/src/zones.ts) runs x 100-220, z -60..60: the valet lobby at its west end
// (LOTS.lobby), the drive, the valet's parking and a plaza (LOTS.valet), the street (LOTS.street),
// and across it the jail and the garage (LOTS.jail, LOTS.garage: the law's and the cars' to
// build). The big surface lots north and south of the lobby are the valet's too. The roof zone
// runs x -160..-110, z -20..20: a terrace on top of the tower, facing west over the city.
//
// ground.ts and roof.ts build from this; the map draws it; cars6 and law6 can read where the
// valet stand is, where the parking stalls are, and where their lots' front doors meet the
// sidewalk.

import { LIFTS } from '../../../../shared/src/lifts.ts';
import { LOTS } from '../../../../shared/src/zones.ts';

export interface Area {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const m = (cm: number) => cm / 100;
const area = (r: { minX: number; maxX: number; minZ: number; maxZ: number }): Area => ({ x0: m(r.minX), x1: m(r.maxX), z0: m(r.minZ), z1: m(r.maxZ) });

export const GROUND = {
  /** The whole zone, and where anyone can walk in it (the backdrop starts past it). */
  zone: { x0: 100, x1: 220, z0: -60, z1: 60 },
  walk: { x0: 100.6, x1: 199.5, z0: -58, z1: 58 },
  /** The valet lobby's hall (inside faces of its walls) and the building round it. */
  hall: { x0: m(LIFTS.ground.x), x1: 127.6, z0: -12.6, z1: 12.6 },
  hallHeight: 6.2,
  building: { x0: 102.6, x1: 127.8, z0: -13, z1: 13 },
  /** The glass front's doorway (z) and its sliding doors. */
  doors: { z0: -2.2, z1: 2.2 },
  /** The sidewalk in front of the lobby, the drive, the porte-cochere's roof over both. */
  curb: { x0: 127.8, x1: 130.2, z0: -46, z1: 46 },
  drive: { x0: 130.2, x1: 137.8, z0: -46, z1: 46 },
  canopy: { x0: 127.8, x1: 139.4, z0: -9.6, z1: 9.6 },
  canopyY: 5.0,
  /** The plaza between the drive and the street, the walk across it to the crosswalk. */
  plaza: { x0: 137.8, x1: 150, z0: -9.6, z1: 9.6 },
  walkway: { z0: -2, z1: 2 },
  /** The street: its sidewalks and the roadway, and the crosswalk over it. */
  walkWest: { x0: 150, x1: 153.5 },
  road: { x0: 153.5, x1: 163.5 },
  walkEast: { x0: 163.5, x1: m(LOTS.jail.minX) },
  crosswalk: { z0: -2, z1: 2 },
  /** The lots across the street (for the map; their insides are the law's and the cars'). */
  jail: area(LOTS.jail),
  garage: area(LOTS.garage),
  lobbyLot: area(LOTS.lobby),
  valetLot: area(LOTS.valet),
} as const;

/**
 * The valet stand: a podium on the sidewalk under the porte-cochere, its front (the guest's
 * side) facing the lobby's doors. `guest` is where someone stands to talk to the valet; `valet`
 * where the attendant stands behind it. cars6 puts its prompt and panel here.
 */
export const VALET_STAND = { x: 129.0, z: 4.4, yaw: -Math.PI / 2, guest: { x: 128.2, z: 4.4 }, valet: { x: 129.8, z: 4.4 } };

/** Where a car pulls up for its owner: in the drive's near lane, under the porte-cochere. */
export const PICKUP = { x: 132.2, z: 2.0, yaw: Math.PI };

/**
 * The lots' front doors on the east sidewalk (the jail's and the garage's buildings put theirs
 * here, facing the street): the garage's by the plaza's crosswalk, the jail's with a crosswalk of
 * its own.
 */
export const ENTRANCES = {
  jail: { x: m(LOTS.jail.minX), z: -25, yaw: -Math.PI / 2 },
  garage: { x: m(LOTS.garage.minX), z: 8, yaw: -Math.PI / 2 },
};

/** A parking stall: where a car's middle stands and the way its nose points. */
export interface Stall {
  x: number;
  z: number;
  yaw: number;
}

/** The stall's size (m). */
export const STALL = { w: 2.7, d: 5.2 };

/**
 * Every stall: the valet's stacked rows either side of the plaza (nose to nose), and the two big
 * surface lots north and south of the lobby, four rows each off two aisles.
 */
export function stalls(): Stall[] {
  const out: Stall[] = [];
  // the stacks: rows at x 140.8 (nose east) and 146.8 (nose west), from z 11.4 out
  for (const side of [-1, 1]) {
    for (let k = 0; k < 10; k++) {
      const z = side * (11.4 + STALL.w / 2 + k * STALL.w);
      out.push({ x: 140.8, z, yaw: Math.PI / 2 });
      out.push({ x: 146.8, z, yaw: -Math.PI / 2 });
    }
  }
  // the surface lots: rows along x, 9 stalls each
  for (const side of [-1, 1]) {
    const rows = [
      { z: 17 + STALL.d / 2, yaw: 0 },
      { z: 28.8 + STALL.d / 2, yaw: Math.PI },
      { z: 34 + STALL.d / 2, yaw: 0 },
      { z: 45.8 + STALL.d / 2, yaw: Math.PI },
    ];
    for (const r of rows) {
      for (let k = 0; k < 9; k++) {
        const x = 102.8 + STALL.w / 2 + k * STALL.w;
        // (a car's nose toward the aisle: on the north side the rows mirror)
        out.push({ x, z: side * r.z, yaw: side > 0 ? r.yaw : Math.PI - r.yaw });
      }
    }
  }
  return out;
}

/** The surface lots' aisles (z bands), for the markings and the map. */
export const AISLES = [
  { z0: 22.2, z1: 28.8 },
  { z0: 39.2, z1: 45.8 },
];
/** The surface lots' extent (x, and |z| from the lobby out). */
export const SURFACE = { x0: 102.2, x1: 128.0, z0: 16.2, z1: 51.6 };

export const ROOF = {
  zone: { x0: -160, x1: -110, z0: -20, z1: 20 },
  /** The deck inside the glass railing. */
  deck: { x0: -147, x1: m(LIFTS.roof.x), z0: -13, z1: 13 },
  /** The stair-and-lift pavilion at the east end, and its roof reaching out over the arrivals. */
  pavilion: { x0: m(LIFTS.roof.x), x1: -110.4, z0: -6, z1: 6 },
  canopy: { x0: -121, x1: m(LIFTS.roof.x), z0: -7, z1: 7 },
  canopyY: 3.6,
  /** How far below the deck the streets are. */
  depth: 140,
} as const;
