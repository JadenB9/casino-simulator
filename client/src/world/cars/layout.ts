// Where everything of the cars' goes on the ground floor, in metres (zones.ts has the lots in
// centimetres): the valet lot's stalls and which of them have a car in, the drive a called car
// takes to the curb and away, and the garage across the street with its bays. Pure data and
// functions, so the layout can be checked without drawing it.

import { CARS } from '../../../../shared/src/items.ts';
import { CURB } from '../../../../shared/src/valet.ts';
import { LOTS, type Rect } from '../../../../shared/src/zones.ts';
import { LOT_PAINTS } from './specs.ts';

/** A lot (cm) in metres. */
export function metres(r: Rect): { x0: number; x1: number; z0: number; z1: number } {
  return { x0: r.minX / 100, x1: r.maxX / 100, z0: r.minZ / 100, z1: r.maxZ / 100 };
}

export const VALET = metres(LOTS.valet);
export const GARAGE_LOT = metres(LOTS.garage);

// --- the valet lot -------------------------------------------------------------------------

/** The drive under the porte-cochère: the curb lane (called cars stop here) and the lane past it. */
export const CURB_LANE = CURB[0]!.x;
export const THROUGH_LANE = CURB_LANE + 2.7;
/** Where the drive leaves for the street, south of the porte-cochère, and where a car is out of sight. */
export const EXIT_Z = -11.5;
export const STREET_X = 158;

/** The parking: two blocks either side of the porte-cochère, rows of stalls across them. */
export const STALL_W = 2.5;
export const STALL_D = 5.4;
export const BLOCKS = [
  { z0: 13, z1: 39.5, north: true },
  { z0: -39.5, z1: -13, north: false },
] as const;
/** The first stall's centre x (the lanes of the drive run up the west side of each block). */
const STALL_X0 = 138.75;
const STALLS_PER_ROW = 5;

export interface Stall {
  x: number;
  z: number;
  /** Which way a car parked in it faces (Object3D.rotation.y; 0 faces +z). */
  yaw: number;
}

/**
 * Every stall: in each block a row facing the aisle, the aisle, then two rows back to back. Rows
 * run along x; cars park nose out towards the aisle (valets back in).
 */
export function stalls(): Stall[] {
  const out: Stall[] = [];
  for (const b of BLOCKS) {
    // from the porte-cochère outwards: a row, the aisle (7 m), two rows back to back
    const s = b.north ? 1 : -1;
    const near = b.north ? b.z0 : b.z1;
    const rows = [
      { z: near + s * (STALL_D / 2), faces: s },
      { z: near + s * (STALL_D + 7 + STALL_D / 2), faces: -s },
      { z: near + s * (2 * STALL_D + 7 + STALL_D / 2), faces: s },
    ];
    for (const r of rows)
      for (let i = 0; i < STALLS_PER_ROW; i++) out.push({ x: STALL_X0 + i * STALL_W, z: r.z, yaw: r.faces > 0 ? 0 : Math.PI });
  }
  return out;
}

/** The aisle between a block's first row and the rest (z of its middle). */
export function aisleZ(north: boolean): number {
  const b = BLOCKS[north ? 0 : 1];
  return north ? b.z0 + STALL_D + 3.5 : b.z1 - STALL_D - 3.5;
}

/** The cars parked in the lot tonight: most stalls full, a few gaps, deterministic. */
export function parked(): { stall: Stall; id: string; paint: string }[] {
  // the lot shows cars a guest would drive here, never the top of the range
  const kinds = ['stallard-440', 'aurelian-saloon', 'ardent-overland', 'brenner-rally', 'raffica-v10', 'halden-roadster', 'strale-gt', 'solenne-cabriolet', 'ombra-hyper'];
  let seed = 20260925;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: { stall: Stall; id: string; paint: string }[] = [];
  for (const stall of stalls()) {
    if (rnd() < 0.2) continue;
    const id = kinds[Math.floor(rnd() * kinds.length)]!;
    out.push({ stall, id, paint: LOT_PAINTS[Math.floor(rnd() * LOT_PAINTS.length)]! });
  }
  return out;
}

/** A point on the way (metres) and the heading there. */
export interface Waypoint {
  x: number;
  z: number;
}

/**
 * A called car's way to the curb: out of the north block's aisle, down the through lane, and over
 * into its space at the curb, nose south. Distances in metres along it are what the animation moves.
 */
export function arrivalPath(slot: number): Waypoint[] {
  const c = CURB[slot] ?? CURB[0]!;
  const az = aisleZ(true);
  return [
    { x: 147, z: az },
    { x: THROUGH_LANE + 2.5, z: az },
    { x: THROUGH_LANE, z: az - 2.5 },
    { x: THROUGH_LANE, z: c.z + 7 },
    { x: CURB_LANE + 0.6, z: c.z + 2.6 },
    { x: CURB_LANE, z: c.z },
  ];
}

/** And away: out of the space, down the drive, and off along the street. */
export function departurePath(slot: number): Waypoint[] {
  const c = CURB[slot] ?? CURB[0]!;
  return [
    { x: CURB_LANE, z: c.z },
    { x: CURB_LANE + 0.5, z: c.z - 2.5 },
    { x: THROUGH_LANE, z: c.z - 6 },
    { x: THROUGH_LANE, z: EXIT_Z + 2.5 },
    { x: THROUGH_LANE + 2.5, z: EXIT_Z },
    { x: STREET_X, z: EXIT_Z },
    { x: STREET_X + 2.5, z: EXIT_Z - 2.5 },
    { x: STREET_X + 2.5, z: -60 },
  ];
}

/** A path's length and a point `d` metres along it, with the heading (yaw) there. */
export function along(path: readonly Waypoint[], d: number): { x: number; z: number; yaw: number; done: boolean } {
  let left = Math.max(0, d);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === path.length - 2) {
      const k = len > 0 ? Math.min(1, left / len) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(b.x - a.x, b.z - a.z), done: left >= len && i === path.length - 2 };
    }
    left -= len;
  }
  const last = path.at(-1)!;
  return { x: last.x, z: last.z, yaw: 0, done: true };
}

export function pathLength(path: readonly Waypoint[]): number {
  let n = 0;
  for (let i = 0; i < path.length - 1; i++) n += Math.hypot(path[i + 1]!.x - path[i]!.x, path[i + 1]!.z - path[i]!.z);
  return n;
}

// --- the garage ----------------------------------------------------------------------------

/** The showroom building across the street: its walls (metres) and the door in its glass front. */
export const GARAGE = { x0: 169, x1: 197, z0: 8, z1: 42, height: 5.6, doorZ: 25, doorW: 3.4 } as const;

export interface Bay {
  /** Where the car stands and faces. */
  x: number;
  z: number;
  yaw: number;
  /** The centre turntable. */
  hero: boolean;
}

/**
 * The bays: the turntable in the middle, then a row down each side wall facing the aisle (the
 * glass front's row leaves the door clear). As many as there are cars, so a full collection fits.
 */
export function bays(): Bay[] {
  const g = GARAGE;
  const out: Bay[] = [{ x: (g.x0 + g.x1) / 2 + 1, z: g.doorZ, yaw: -Math.PI / 2 + 0.6, hero: true }];
  const zs = [g.z0 + 3.4, g.z0 + 8.8, g.z0 + 14.2, g.z1 - 14.2, g.z1 - 8.8, g.z1 - 3.4];
  // the back wall's row: all six, facing the door (-x)
  for (const z of zs) out.push({ x: g.x1 - 4.2, z, yaw: -Math.PI / 2, hero: false });
  // the front's row, behind the glass, facing in (+x): the door's aisle stays clear
  for (const z of zs) if (Math.abs(z - g.doorZ) > 4) out.push({ x: g.x0 + 4.2, z, yaw: Math.PI / 2, hero: false });
  // and two out on the floor either side of the turntable, angled to the door
  out.push({ x: (g.x0 + g.x1) / 2 - 0.5, z: g.z0 + 6, yaw: -Math.PI / 2 - 0.45, hero: false });
  out.push({ x: (g.x0 + g.x1) / 2 - 0.5, z: g.z1 - 6, yaw: -Math.PI / 2 + 0.45, hero: false });
  return out.slice(0, CARS.length);
}

/** What stands in each bay for a collection: your cars dearest first (the dearest on the turntable), then the ones you don't have yet, cheapest first, as empty bays. */
export function collection(owned: Iterable<string>): { bay: Bay; car: string; owned: boolean }[] {
  const have = new Set(owned);
  const mine = CARS.filter((c) => have.has(c.id)).sort((a, b) => b.price - a.price);
  const rest = CARS.filter((c) => !have.has(c.id));
  const order = [...mine.map((c) => ({ car: c.id, owned: true })), ...rest.map((c) => ({ car: c.id, owned: false }))];
  return bays().map((bay, i) => ({ bay, ...order[i]! }));
}
