// Who walks with a celebrity, and where: two bodyguards at their shoulders and a few fans who join
// along the way. Everything here is worked out from the visit (its route, its seed) and the clock,
// like the celebrity themselves, so everyone sees the same crowd in the same places.
//
// Walking, each follows the route some way behind, a little to one side; at a stop, the guards
// step up beside the celebrity and the fans gather in an arc in front, easing into their places
// as the stop begins and back into line before it ends. A fan joins at a stop of their own,
// walking up from a few metres off. The grid (the waiters' walkable floor, nav.ts) keeps every
// place on open floor: a side step that would put someone in a table is taken in, a place at a
// stop with no room is skipped.

import { pointAt, poseOn, faceYaw, type Timeline, type Visit } from '../../../../shared/src/celebs.ts';
import type { NavGrid } from '../life/nav.ts';
import { lerpAngle, smooth } from '../life/rounds.ts';

export type Role = 'guard' | 'fan';

export interface Follower {
  role: Role;
  /** Index among its kind. */
  k: number;
  /** Metres behind on the route, and to the side (+ is the celebrity's right) while walking. */
  lag: number;
  side: number;
  /** The stop they join at (index into the route's stops); guards are there from the start. */
  joins: number;
}

export interface Placed {
  x: number;
  z: number;
  yaw: number;
  /** Here at all (a fan before joining isn't). */
  here: boolean;
  /** At a stop, in their place (0-1). */
  settled: number;
}

/** Seconds to step into place at a stop, and back into line before it ends. */
const IN_S = 2.2;
const OUT_S = 1.6;
/** How far off a fan walks up from, and how long it takes. */
const JOIN_M = 5;
const JOIN_S = 4.5;
/** How close behind the celebrity someone steps up the route before crossing to their place. */
const CLOSE_M = 0.7;

/** A small deterministic generator (the same on every client for the same seed). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The entourage and the fans for a visit: two guards, and four to six fans joining at the stops before the doors. */
export function followersOf(v: Visit, tl: Timeline): Follower[] {
  const r = seeded(v.seed);
  const out: Follower[] = [
    { role: 'guard', k: 0, lag: 1.3, side: 0.62, joins: 0 },
    { role: 'guard', k: 1, lag: 1.5, side: -0.62, joins: 0 },
  ];
  const stops = tl.route.stops.length - 1; // not at the doors on the way out
  const fans = 4 + Math.floor(r() * 3);
  for (let k = 0; k < fans; k++) {
    // the first few are there to meet them in the lobby; the rest pick them up on the way
    const joins = k < 2 ? 0 : Math.min(stops - 1, 1 + Math.floor(r() * Math.max(1, stops - 1)));
    out.push({ role: 'fan', k, lag: 2.5 + k * 0.75 + r() * 0.3, side: (k % 2 ? 0.5 : -0.5) * (0.6 + r() * 0.6), joins });
  }
  return out;
}

/**
 * A place at a stop, relative to the celebrity there: guards at the shoulders, fans in an arc in
 * front (behind, at a table they're playing: the fans watch over their shoulder).
 */
export function slotOf(f: Follower, present: readonly Follower[], sx: number, sz: number, face: number, grid: NavGrid, behind = false): { x: number; z: number; yaw: number } | null {
  const fx = Math.sin(face);
  const fz = Math.cos(face);
  // the celebrity's right hand is on -x when they face +z
  const rx = -Math.cos(face);
  const rz = Math.sin(face);
  const star = { x: sx, z: sz };
  if (f.role === 'guard') {
    const s = f.k === 0 ? 1 : -1;
    const want = { x: sx + rx * 1.05 * s - fx * 0.45, z: sz + rz * 1.05 * s - fz * 0.45 };
    const at = clearNear(grid, want.x, want.z, 0.6);
    return at && grid.lineClear(star, at) ? { ...at, yaw: face + s * 0.55 } : null;
  }
  const fans = present.filter((p) => p.role === 'fan');
  const i = fans.indexOf(f);
  const n = fans.length;
  // their place in the arc, or a little nearer or further if something stands there
  for (const dr of [0, -0.4, 0.4]) {
    const a = face + (behind ? Math.PI : 0) + (i - (n - 1) / 2) * (behind ? 0.5 : 0.42);
    const r = (behind ? 1.7 : 2.1) + (i % 2) * 0.6 + dr;
    const at = clearNear(grid, sx + Math.sin(a) * r, sz + Math.cos(a) * r, 0.5);
    if (at && Math.hypot(at.x - sx, at.z - sz) >= 1.3 && grid.lineClear(star, at)) return { ...at, yaw: Math.atan2(sx - at.x, sz - at.z) };
  }
  return null;
}

/** Where a follower is, `t` seconds into the visit. */
export function placeFollower(f: Follower, all: readonly Follower[], tl: Timeline, t: number, grid: NavGrid): Placed {
  const star = poseOn(tl, t);
  // a fan is there from the moment the celebrity reaches the stop they join at
  if (f.role === 'fan' && t < stopStart(tl, f.joins)) return { x: 0, z: 0, yaw: 0, here: false, settled: 0 };
  const follow = followPoint(tl, star.arc, f, grid);
  if (star.stop < 0) return { ...follow, here: true, settled: 0 };
  const stop = tl.route.stops[star.stop]!;
  const seg = tl.segs.find((s) => s.kind === 'stop' && s.stop === star.stop)!;
  const len = seg.t1 - seg.t0;
  const present = all.filter((p) => p.joins <= star.stop);
  const [sx, sz] = tl.route.pts[stop.at]!;
  const slot = slotOf(f, present, sx, sz, faceYaw(stop.face), grid, stop.kind === 'table');
  // a fan joining here walks up from a few metres off, straight to their place
  if (f.role === 'fan' && f.joins === star.stop && slot && star.stopT < JOIN_S) {
    const from = entryFor(slot, sx, sz, grid);
    if (from) {
      const k = smooth(star.stopT / JOIN_S);
      const heading = Math.atan2(slot.x - from.x, slot.z - from.z);
      return { x: from.x + (slot.x - from.x) * k, z: from.z + (slot.z - from.z) * k, yaw: k > 0.85 ? lerpAngle(heading, slot.yaw, (k - 0.85) / 0.15) : heading, here: true, settled: k };
    }
  }
  if (!slot) return { ...follow, here: true, settled: 0 };
  const w = Math.min(smooth(star.stopT / IN_S), smooth((len - star.stopT) / OUT_S));
  // into their place: straight across where nothing stands in the way, else up the route to just
  // behind the celebrity first and across from there
  if (grid.lineClear(follow, slot)) return { x: follow.x + (slot.x - follow.x) * w, z: follow.z + (slot.z - follow.z) * w, yaw: lerpAngle(follow.yaw, slot.yaw, w), here: true, settled: w };
  const near = followPoint(tl, star.arc, { ...f, lag: CLOSE_M, side: 0 }, grid);
  if (!grid.lineClear(near, slot)) return { ...follow, here: true, settled: 0 };
  if (w < 0.5) {
    const k = w * 2;
    const p = followPoint(tl, star.arc, { ...f, lag: f.lag + (CLOSE_M - f.lag) * k, side: f.side * (1 - k) }, grid);
    return { ...p, here: true, settled: w };
  }
  const k = (w - 0.5) * 2;
  return { x: near.x + (slot.x - near.x) * k, z: near.z + (slot.z - near.z) * k, yaw: lerpAngle(near.yaw, slot.yaw, k), here: true, settled: w };
}

/** Seconds into the visit that a stop begins. */
export function stopStart(tl: Timeline, stop: number): number {
  for (const s of tl.segs) if (s.kind === 'stop' && s.stop === stop) return s.t0;
  return Infinity;
}

/** Some way behind on the route, to one side where there's room. */
function followPoint(tl: Timeline, arc: number, f: Follower, grid: NavGrid): { x: number; z: number; yaw: number } {
  const p = pointAt(tl, arc - f.lag);
  const rx = -Math.cos(p.heading);
  const rz = Math.sin(p.heading);
  // step in toward the line where the side is blocked
  for (const k of [1, 0.6, 0.3, 0]) {
    const x = p.x + rx * f.side * k;
    const z = p.z + rz * f.side * k;
    if (k === 0 || grid.isClear(x, z)) return { x, z, yaw: p.heading };
  }
  return { x: p.x, z: p.z, yaw: p.heading };
}

/** Where a fan walks up from: a few metres further out from the celebrity than their place. */
function entryFor(slot: { x: number; z: number }, sx: number, sz: number, grid: NavGrid): { x: number; z: number } | null {
  const dx = slot.x - sx;
  const dz = slot.z - sz;
  const d = Math.hypot(dx, dz) || 1;
  for (const turn of [0, 0.5, -0.5, 1, -1]) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const ux = (dx * c - dz * s) / d;
    const uz = (dx * s + dz * c) / d;
    const from = { x: slot.x + ux * JOIN_M, z: slot.z + uz * JOIN_M };
    if (grid.isClear(from.x, from.z) && grid.lineClear(from, slot)) return from;
  }
  return null;
}

function clearNear(grid: NavGrid, x: number, z: number, reach: number): { x: number; z: number } | null {
  return grid.nearestClear(x, z, reach);
}
