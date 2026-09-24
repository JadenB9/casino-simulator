// Which rounds the floor's waiters walk. The building's own loops come first (lifePoints' routes:
// round the lounge's couches); the rest are made from the floor itself, a part of it each: the
// table pit's front row and the Big Six, the back row and the poker room, the slot islands. A
// serving stop stands behind a table's players (or at an island's end, or by a couch) facing it.
//
// Every round lasts the same time, and the waiters start it a share of that apart, so no two ever
// wait at the bar's pickup together: the time a round has to spare goes to the bar (waiting for the
// next tray) and to its tables (a word with the guests).

import type { FloorPlan, Placement } from '../layout.ts';
import type { LifePoints } from '../life-points.ts';
import type { NavGrid, Pt } from './nav.ts';
import { Round, buildRound, type Stop } from './rounds.ts';

/** Seconds at the bar collecting a tray, at least. */
const PICKUP_S = 7;
/** Seconds at a serving stop, at least. */
const SERVE_S = 3.4;
/** Behind a table's players: its edge, their standing room, then a step. */
const BEHIND = 0.95 + 0.5;
/** How many serving stops one round makes, at most. */
const MAX_STOPS = 4;

export interface WaiterRound {
  round: Round;
  /** Seconds to add to the clock for this waiter (so they're spread through the rounds). */
  offset: number;
}

/**
 * Up to `want` rounds, all the same length. Rounds that can't be walked (a stop the grid can't
 * reach) are left out.
 */
export function waiterRounds(points: LifePoints, plan: FloorPlan, grid: NavGrid, want: number): WaiterRound[] {
  const pickup: Stop = { x: points.bar.pickup.x, z: points.bar.pickup.z, face: points.bar.pickup.yaw, dur: PICKUP_S, kind: 'pickup' };
  const plans: { stops: Stop[]; via: Pt[][] }[] = [];
  for (const route of points.routes ?? []) plans.push(fromRoute(route, pickup, points, plan));
  for (const group of floorGroups(plan)) plans.push({ stops: [pickup, ...tour(pickup, group)], via: [] });

  // walk each once to learn its length, then stretch them all to the longest
  const built: { stops: Stop[]; via: Pt[][]; round: Round }[] = [];
  for (const p of plans) {
    if (built.length >= want) break;
    const round = buildRound(grid, p.stops, built.length, p.via);
    if (round) built.push({ ...p, round });
  }
  if (built.length === 0) return [];
  const period = Math.max(...built.map((b) => b.round.period));
  const slot = period / built.length;
  return built.map((b, i) => {
    const spare = period - b.round.period;
    // the bar takes what it can without running into the next waiter's turn there
    const atBar = Math.min(spare, Math.max(0, slot - PICKUP_S - 6));
    const serves = b.round.serveCount;
    const each = serves ? (spare - atBar) / serves : 0;
    const stops = b.stops.map((s) => (s.kind === 'pickup' ? { ...s, dur: s.dur + atBar + (serves ? 0 : spare - atBar) } : { ...s, dur: s.dur + each }));
    const round = buildRound(grid, stops, i, b.via) ?? b.round;
    return { round, offset: (i * slot) % round.period };
  });
}

/** A building loop as stops: its paused points are stops, the rest are ways between them. */
function fromRoute(route: { x: number; z: number; pause?: number }[], pickup: Stop, points: LifePoints, plan: FloorPlan): { stops: Stop[]; via: Pt[][] } {
  const stops: Stop[] = [];
  const via: Pt[][] = [];
  const atBar = (p: Pt) => Math.hypot(p.x - pickup.x, p.z - pickup.z) < 1.5;
  // start at the bar: the loop's own point there, or the pickup put in front of it
  let start = route.findIndex(atBar);
  if (start < 0) {
    stops.push(pickup);
    via.push([]);
    start = 0;
  }
  for (let k = 0; k < route.length; k++) {
    const p = route[(start + k) % route.length]!;
    if (atBar(p) && stops.length === 0) {
      stops.push({ ...pickup, dur: Math.max(PICKUP_S, p.pause ?? 0) });
      via.push([]);
    } else if (p.pause) {
      stops.push({ x: p.x, z: p.z, face: faceFrom(p, points, plan), dur: Math.max(SERVE_S, p.pause), kind: 'serve' });
      via.push([]);
    } else {
      via[via.length - 1]!.push({ x: p.x, z: p.z });
    }
  }
  return { stops, via };
}

/** Which way a stop on a building loop faces: toward the seats (or tables) nearest it. */
function faceFrom(p: Pt, points: LifePoints, plan: FloorPlan): number {
  const near = [...points.seats.map((s) => ({ x: s.x, z: s.z })), ...plan.stations.filter((s) => s.zone !== 'slots').map((s) => ({ x: s.x, z: s.z }))]
    .map((q) => ({ q, d: Math.hypot(q.x - p.x, q.z - p.z) }))
    .filter((o) => o.d < 3.5);
  if (near.length === 0) return 0;
  let x = 0;
  let z = 0;
  for (const o of near) {
    x += o.q.x / o.d;
    z += o.q.z / o.d;
  }
  let sum = 0;
  for (const o of near) sum += 1 / o.d;
  return Math.atan2(x / sum - p.x, z / sum - p.z);
}

/**
 * The floor's own serving stops, a group per round: the pit's front row (and the feature wheel),
 * its back row with the poker room, and the slot islands.
 */
function floorGroups(plan: FloorPlan): Stop[][] {
  const behind = (s: Placement): Stop => {
    const off = s.fp.depth / 2 + BEHIND;
    return { x: s.x + Math.sin(s.yaw) * off, z: s.z + Math.cos(s.yaw) * off, face: s.yaw + Math.PI, dur: SERVE_S, kind: 'serve' };
  };
  const tables = plan.stations.filter((s) => s.zone === 'pit');
  const front = tables.filter((s) => Math.cos(s.yaw) > 0.5).sort((a, b) => a.x - b.x);
  const back = tables.filter((s) => Math.cos(s.yaw) < -0.5).sort((a, b) => a.x - b.x);
  const feature = plan.stations.filter((s) => s.zone === 'feature');
  const poker = plan.stations.filter((s) => s.zone === 'poker');
  const islands: Stop[] = plan.banks.flatMap((b) => {
    const ax = Math.cos(b.yaw);
    const az = -Math.sin(b.yaw);
    const off = b.length / 2 + 0.31 + 0.55;
    return [1, -1].map((e) => ({ x: b.x + ax * off * e, z: b.z + az * off * e, face: Math.atan2(-ax * e, -az * e), dur: SERVE_S, kind: 'serve' as const }));
  });
  return [
    [...spread(front, MAX_STOPS - feature.length).map(behind), ...feature.slice(0, 1).map(behind)],
    [...spread(back, 2).map(behind), ...spread(poker, 2).map(behind)],
    spread(islands, MAX_STOPS),
  ].filter((g) => g.length > 0);
}

/** Up to n of a list, spread evenly through it. */
function spread<T>(list: T[], n: number): T[] {
  if (n <= 0) return [];
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.round(((i + 0.5) * list.length) / n - 0.5)]!);
}

/** The stops in the order a waiter would walk them: always on to the nearest one left. */
function tour(from: Pt, stops: Stop[]): Stop[] {
  const left = [...stops];
  const out: Stop[] = [];
  let at = from;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (Math.hypot(left[i]!.x - at.x, left[i]!.z - at.z) < Math.hypot(left[best]!.x - at.x, left[best]!.z - at.z)) best = i;
    const next = left.splice(best, 1)[0]!;
    out.push(next);
    at = next;
  }
  return out;
}
