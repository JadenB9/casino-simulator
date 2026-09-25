// The elevators. Each zone (zones.ts) has one bank of elevator doors; a ride starts from beside
// the doors of the zone you're in and ends in front of the doors of the other zone, facing out
// into it. The server checks the start and moves you (server/src/floor/lift.ts); the client
// builds the banks here and plays the ride (client/src/world/city/).
//
// Positions are integer centimetres like presence's, yaw as the wire's byte (0 faces +z, 64 +x,
// 128 -z, 192 -x). A bank's front is the face its doors are in; its cars stand behind it.

import { ZONES, inRect, type ZoneId } from './zones.ts';

export interface LiftBank {
  zone: ZoneId;
  /** The middle of the bank's front, where the doors are (cm). */
  x: number;
  z: number;
  /** Which way someone walking out of the doors faces (yaw byte): the front's normal. */
  r: number;
  /** Cars side by side along the front. */
  cars: number;
  /** Where a ride into this zone leaves you: in front of the doors, facing out (cm, yaw byte). */
  arrive: { x: number; z: number; r: number };
}

/** A car's door opening and its spacing along the front (cm), and how deep a car is. */
export const CAR_DOOR_CM = 120;
export const CAR_PITCH_CM = 190;
export const CAR_DEPTH_CM = 190;

/**
 * How far from the middle of a bank's front (cm) you may be and still call a car: inside a car at
 * its back wall, or a couple of steps out in front of the doors, plus a stride of lag.
 */
export const LIFT_REACH_CM = 360;

function bank(zone: ZoneId, x: number, z: number, r: number, cars: number): LiftBank {
  const b: LiftBank = { zone, x, z, r, cars, arrive: { x, z, r } };
  // a ride ends standing in the middle car (the left of two), facing its doors
  const c = carCentre(b, Math.floor((cars - 1) / 2));
  b.arrive = { x: c.x, z: c.z, r };
  return b;
}

/** Out of a bank's doors (n) and along its front, to the right looking out (a): unit vectors. */
export function bankAxes(b: LiftBank): { nx: number; nz: number; ax: number; az: number } {
  const yaw = (b.r / 256) * Math.PI * 2;
  const nx = Math.sin(yaw);
  const nz = Math.cos(yaw);
  return { nx, nz, ax: -nz, az: nx };
}

/** The middle of car `i`'s floor (cm), counted from the left looking in (+ 0 keeps -0 off the wire). */
export function carCentre(b: LiftBank, i: number): { x: number; z: number } {
  const { nx, nz, ax, az } = bankAxes(b);
  const along = (i - (b.cars - 1) / 2) * CAR_PITCH_CM;
  const back = -CAR_DEPTH_CM / 2;
  return { x: Math.round(b.x + ax * along + nx * back) + 0, z: Math.round(b.z + az * along + nz * back) + 0 };
}

/**
 * The three banks. The casino's stands against the lobby's south wall east of the street doors
 * (its cars' back in front of the wall's wainscot and rail), its doors facing north into the lobby; the valet lobby's in its back (west) wall, facing the glass doors to the drive; the
 * terrace's in the stair-and-lift pavilion at its east end, facing west over the city.
 */
export const LIFTS: Record<ZoneId, LiftBank> = {
  casino: bank('casino', 0, 1500, 128, 1),
  ground: bank('ground', 10_500, 0, 64, 3),
  roof: bank('roof', -11_300, 0, 192, 2),
};

/** The floors on the elevator's panel, top to bottom, with the numbers its indicator counts through. */
export const FLOORS: { zone: ZoneId; key: string; name: string; level: number }[] = [
  { zone: 'roof', key: 'R', name: 'Sky Terrace', level: 38 },
  { zone: 'casino', key: 'C', name: 'Casino', level: 2 },
  { zone: 'ground', key: 'G', name: 'Valet & Street', level: 0 },
];

export function floorOf(zone: ZoneId): { zone: ZoneId; key: string; name: string; level: number } {
  return FLOORS.find((f) => f.zone === zone)!;
}

/** What the indicator shows at a level: G for the ground floor, R at the top, else the number. */
export function levelLabel(level: number): string {
  if (level <= 0) return 'G';
  if (level >= FLOORS[0]!.level) return 'R';
  return String(level);
}

/** Whether (x, z) cm is close enough to a zone's elevator doors to call a car. */
export function atLift(zone: ZoneId, x: number, z: number): boolean {
  const b = LIFTS[zone];
  return inRect(ZONES[zone], x, z) && Math.hypot(x - b.x, z - b.z) <= LIFT_REACH_CM;
}

export type LiftRefusal = 'here' | 'table' | 'held' | 'far';

/** Why the floor won't send someone to `to`, or null to go (server/src/floor/lift.ts says it in words). */
export function liftRefusal(p: { x: number; z: number; at: unknown; confine?: unknown }, to: ZoneId): LiftRefusal | null {
  if (p.confine) return 'held';
  if (p.at) return 'table';
  const zone = (Object.keys(ZONES) as ZoneId[]).find((id) => inRect(ZONES[id], p.x, p.z)) ?? null;
  if (zone === to) return 'here';
  if (!zone || !atLift(zone, p.x, p.z)) return 'far';
  return null;
}
