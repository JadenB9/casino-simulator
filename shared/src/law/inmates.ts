// v7: the county jail's inmates. Five of them walk their own loops through the day room and out in
// the yard, the way the casino's guards walk theirs (patrol.ts): where each one is is a pure
// function of the time, so the server (which decides what they do) and every client (which draws
// them) agree with nothing on the wire.
//
// Every so often one of them goes over to someone inside with him (an inmate, or a visitor who
// asked to see the day room), throws a punch and takes some of their money: the floor decides who,
// when and how much (server/src/law.ts `jailTick`) and says so with a `law` event of kind 'theft';
// the clients walk that inmate over and play it out. Metres and server milliseconds.

import { loopPose, type Pose, type StaffSpec, type Stop } from './patrol.ts';
import { DOLLAR, type Cents } from '../money.ts';

export type InmateId = 'i0' | 'i1' | 'i2' | 'i3' | 'i4';
export const INMATE_IDS: readonly InmateId[] = ['i0', 'i1', 'i2', 'i3', 'i4'];

const N = Math.PI; // facing -z
const S = 0; // facing +z
const E = Math.PI / 2;
const W = -Math.PI / 2;

interface InmateSpec {
  id: InmateId;
  speed: number;
  offset: number;
  route: readonly Stop[];
}

/**
 * The loops: along the day room in front of the cells, round the yard, through the yard door and
 * back past booking, pacing by the cells, and lifting in the yard's corner. Every leg keeps clear
 * of the tables (z -24.2..-21.8), the booking counter and the cell fronts.
 */
export const INMATES: readonly InmateSpec[] = [
  {
    id: 'i0',
    speed: 0.9,
    offset: 0,
    route: [
      { x: 174.6, z: -17.4, wait: 5, face: E, sweep: 0.6 },
      { x: 183.4, z: -17.6 },
      { x: 193.2, z: -17.4, wait: 6, face: W, sweep: 0.6 },
      { x: 183.4, z: -19.4 },
    ],
  },
  {
    id: 'i1',
    speed: 1.0,
    offset: 17_000,
    route: [
      { x: 177.4, z: -33.2 },
      { x: 192.6, z: -33.2 },
      { x: 192.6, z: -38.8, wait: 4, face: N, sweep: 0.5 },
      { x: 177.4, z: -38.8 },
    ],
  },
  {
    id: 'i2',
    speed: 0.95,
    offset: 5_000,
    route: [
      { x: 183.5, z: -26.4 },
      { x: 183.5, z: -32.4 },
      { x: 188.6, z: -36.2, wait: 5, face: S, sweep: 0.6 },
      { x: 183.5, z: -32.4 },
      { x: 183.5, z: -26.4 },
      { x: 178.2, z: -26.2, wait: 4, face: N, sweep: 0.4 },
    ],
  },
  {
    id: 'i3',
    speed: 0.8,
    offset: 31_000,
    route: [
      { x: 186.4, z: -16.2, wait: 7, face: S, sweep: 0.8 },
      { x: 192.4, z: -16.2, wait: 5, face: N, sweep: 0.6 },
    ],
  },
  {
    id: 'i4',
    speed: 0.85,
    offset: 9_000,
    route: [
      { x: 190.4, z: -36.8, wait: 9, face: E, sweep: 0.3 },
      { x: 185.6, z: -39.2, wait: 6, face: S, sweep: 0.5 },
      { x: 180.2, z: -36.4 },
    ],
  },
];

function spec(i: InmateSpec): StaffSpec {
  // (the patrol's walker, which keeps each loop's timeline by id: the inmate's own, so none is
  // mistaken for a guard's; range and cone are unused here)
  return { id: i.id as unknown as StaffSpec['id'], kind: 'guard', name: 'an inmate', speed: i.speed, offset: i.offset, range: 0, half: 0, route: i.route };
}

const SPECS = new Map(INMATES.map((i) => [i.id, spec(i)]));

export function isInmateId(x: unknown): x is InmateId {
  return typeof x === 'string' && SPECS.has(x as InmateId);
}

/** Where an inmate is on his loop at server time `t`. */
export function inmatePose(id: InmateId, t: number): Pose {
  return loopPose(SPECS.get(id)!, t);
}

/** The first theft after someone is seen inside, and the gap between one and the next (ms). */
export const THEFT_FIRST_MS: readonly [number, number] = [45_000, 90_000];
export const THEFT_GAP_MS: readonly [number, number] = [120_000, 240_000];
/** How long the inmate takes to get to you and the punch to land, from the event (ms). */
export const THEFT_WALK_MS = 2_600;

/** What one theft takes: a few per cent of the balance, $25 to $2,500; nothing from under $25. */
export function theftAmount(balance: Cents): Cents {
  if (balance < 25 * DOLLAR) return 0;
  const k = Math.round(balance * 0.04);
  return Math.max(25 * DOLLAR, Math.min(2_500 * DOLLAR, k));
}

/** The inmate nearest (x, z) at time `t`. */
export function nearestInmate(x: number, z: number, t: number): InmateId {
  let best: InmateId = 'i0';
  let bestD = Infinity;
  for (const id of INMATE_IDS) {
    const p = inmatePose(id, t);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

