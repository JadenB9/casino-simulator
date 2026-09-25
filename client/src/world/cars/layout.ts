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
// The city lays out the ground floor (world/city/plan.ts): the drive in front of the lobby, the
// valet's stacked rows either side of the plaza, the street. These are the same numbers, for the
// called cars' way round and for the dev page's stand-in lot.

/** The drive's near lane (called cars stop here, at the curb) and its far lane (the way past). */
export const CURB_LANE = CURB[0]!.x;
export const THROUGH_LANE = 135.8;
/** The far end of the drive, where a car turns off for the street, and the street's lane. */
export const EXIT_Z = -44;
export const STREET_X = 156;
/** The aisle between the valet's two stacked rows (a called car comes out of it). */
const STACK_AISLE = 143.8;
const STACK_START = 11.4;
export const STALL_W = 2.7;
export const STALL_D = 5.2;

export interface Stall {
  x: number;
  z: number;
  /** Which way a car parked in it faces (Object3D.rotation.y; 0 faces +z). */
  yaw: number;
}

/** The valet's stacks, as the city lays them: two rows nose to nose either side of the plaza. */
export function stalls(): Stall[] {
  const out: Stall[] = [];
  for (const side of [-1, 1])
    for (let k = 0; k < 10; k++) {
      const z = side * (STACK_START + STALL_W / 2 + k * STALL_W);
      out.push({ x: 140.8, z, yaw: Math.PI / 2 }, { x: 146.8, z, yaw: -Math.PI / 2 });
    }
  return out;
}

/** The cars parked in a set of stalls tonight: most full, a few gaps, the same every time. */
export function parked(list: readonly Stall[] = stalls(), seed = 20260925, fill = 0.82): { stall: Stall; id: string; paint: string }[] {
  // what a guest would drive here, never the top of the range (and nothing longer than a stall)
  const kinds = ['stallard-440', 'aurelian-saloon', 'ardent-overland', 'brenner-rally', 'raffica-v10', 'halden-roadster', 'strale-gt', 'solenne-cabriolet', 'ombra-hyper'];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: { stall: Stall; id: string; paint: string }[] = [];
  for (const stall of list) {
    if (rnd() >= fill) continue;
    const id = kinds[Math.floor(rnd() * kinds.length)]!;
    out.push({ stall, id, paint: LOT_PAINTS[Math.floor(rnd() * LOT_PAINTS.length)]! });
  }
  return out;
}

/** A point on the way (metres). */
export interface Waypoint {
  x: number;
  z: number;
}

/**
 * A called car's way to the curb: out of the stacks' aisle north of the plaza, across to the
 * drive's far lane, down it, and over into its space at the curb, nose south.
 */
export function arrivalPath(slot: number): Waypoint[] {
  const c = CURB[slot] ?? CURB[0]!;
  return [
    { x: STACK_AISLE, z: 26 },
    { x: STACK_AISLE, z: 13 },
    { x: STACK_AISLE - 2.4, z: 10.6 },
    { x: THROUGH_LANE + 1.4, z: 10.6 },
    { x: THROUGH_LANE, z: 9.2 },
    { x: THROUGH_LANE, z: Math.min(8.4, c.z + 7) },
    { x: CURB_LANE + 0.6, z: c.z + 2.6 },
    { x: CURB_LANE, z: c.z },
  ];
}

/** And away: out of the space, down the far lane to the end of the drive, and off along the street. */
export function departurePath(slot: number): Waypoint[] {
  const c = CURB[slot] ?? CURB[0]!;
  return [
    { x: CURB_LANE, z: c.z },
    { x: CURB_LANE + 0.5, z: c.z - 2.5 },
    { x: THROUGH_LANE, z: c.z - 6 },
    { x: THROUGH_LANE, z: EXIT_Z + 2.5 },
    { x: THROUGH_LANE + 2.5, z: EXIT_Z },
    { x: STREET_X - 2.5, z: EXIT_Z },
    { x: STREET_X, z: EXIT_Z - 2.5 },
    { x: STREET_X, z: -60 },
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
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(b.x - a.x, b.z - a.z), done: left >= len - 1e-6 && i === path.length - 2 };
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
/** The door is at the south end, nearest the crosswalk (the city's ENTRANCES.garage); the turntable in the middle. */
export const GARAGE = { x0: 169, x1: 197, z0: 8, z1: 42, height: 5.6, doorZ: 12.4, doorW: 3.4 } as const;
const MIDDLE_Z = (GARAGE.z0 + GARAGE.z1) / 2;

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
  const out: Bay[] = [{ x: (g.x0 + g.x1) / 2 + 1, z: MIDDLE_Z, yaw: -Math.PI / 2 + 0.6, hero: true }];
  const zs = [g.z0 + 3.4, g.z0 + 8.8, g.z0 + 14.2, g.z1 - 14.2, g.z1 - 8.8, g.z1 - 3.4];
  // the back wall's row: all six, facing the door (-x)
  for (const z of zs) out.push({ x: g.x1 - 4.2, z, yaw: -Math.PI / 2, hero: false });
  // the front's row, behind the glass, facing in (+x): the door's aisle stays clear
  for (const z of zs) if (Math.abs(z - g.doorZ) > 4) out.push({ x: g.x0 + 4.2, z, yaw: Math.PI / 2, hero: false });
  // and out on the floor either side of the turntable, angled to the door
  out.push({ x: (g.x0 + g.x1) / 2 - 0.5, z: g.z1 - 6.5, yaw: -Math.PI / 2 + 0.45, hero: false });
  out.push({ x: (g.x0 + g.x1) / 2 + 1, z: g.z0 + 5, yaw: -Math.PI / 2 - 0.3, hero: false });
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
