// A waiter's round: a closed walk through the floor with stops on the way, timed so that where a
// waiter is depends only on the clock. Every client builds the same rounds from the same floor and
// reads them at the same server time, so everyone sees each waiter at the same place.
//
// A round starts at the bar, where the waiter waits for a tray of drinks (the pickup), then walks
// to each stop in turn (a coffee table in the lounge, the players behind a table, a slot island),
// sets a drink down at each, and walks back to the bar. Walks speed up and slow down at their
// ends; on the way the waiter faces where they walk, rounding corners; at a stop they turn to face
// what they serve and turn back to the way on before they set off.

import type { NavGrid, Pt } from './nav.ts';
import type { BarModel } from '../../../../shared/src/items.ts';

export type StopKind = 'pickup' | 'serve';

export interface Stop {
  x: number;
  z: number;
  /** The way to face while there (rotation.y). */
  face: number;
  /** Seconds spent there. */
  dur: number;
  kind: StopKind;
}

export interface RoundState {
  x: number;
  z: number;
  /** The way the body faces (rotation.y). */
  heading: number;
  /** m/s along the path right now. */
  speed: number;
  /** The stop they're at, and how far into it (seconds); null while walking. */
  stop: Stop | null;
  stopT: number;
  /** The drinks on the tray, in the order they'll be served. */
  tray: BarModel[];
  /** 0-1 through the stop's serving reach (the arm out and back), when serving now. */
  serving: number;
}

/** A waiter's pace (m/s): brisk, a tray in hand. */
export const WAITER_SPEED = 1.15;
/** How quickly a waiter gets up to pace and slows down (m/s²). */
const ACCEL = 1.4;
/** Tangent smoothing either side of a point on the path (m): corners become short arcs. */
const TURN_REACH = 0.35;
/** Seconds to turn from the way in to face the stop, and to turn back to the way on. */
const TURN_IN = 0.7;
const TURN_OUT = 0.6;
/** Where in a pickup the tray is loaded, and where in a serving stop the glass goes down (share of the stop). */
const LOAD_AT = 0.55;
const SERVE_FROM = 0.35;
const SERVE_TO = 0.85;
const SERVE_AT = 0.6;

/** What's served, round by round: the bar's glasses and bottles (a plate needs its own hands). */
const DRINKS: BarModel[] = ['martini', 'wine', 'flute', 'rocks', 'bottle', 'flute', 'martini', 'wine', 'cup'];

interface Walk {
  kind: 'walk';
  pts: Pt[];
  /** Distance along the path at each point. */
  cum: number[];
  len: number;
  t0: number;
  dur: number;
  /** Peak speed and the time spent speeding up (short walks never reach full pace). */
  peak: number;
  ramp: number;
}

interface Pause {
  kind: 'stop';
  stop: Stop;
  t0: number;
  dur: number;
  /** Headings coming in and going out. */
  inH: number;
  outH: number;
  /** Serving stops only: which drink goes down here (index among the round's serves). */
  serve: number;
}

type Part = Walk | Pause;

export class Round {
  readonly period: number;
  private readonly parts: Part[];
  private readonly serves: number;
  private readonly drinks: BarModel[];

  /**
   * `stops[0]` should be the pickup; `paths[i]` runs from stop i to stop i + 1 (the last one back
   * to the first). `seed` picks the drinks.
   */
  constructor(stops: Stop[], paths: Pt[][], seed = 0) {
    const parts: Part[] = [];
    let t = 0;
    let serve = 0;
    stops.forEach((stop, i) => {
      const pause: Pause = { kind: 'stop', stop, t0: t, dur: stop.dur, inH: stop.face, outH: stop.face, serve: stop.kind === 'serve' ? serve++ : -1 };
      parts.push(pause);
      t += stop.dur;
      const pts = paths[i]!;
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1]! + Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.z - pts[k - 1]!.z));
      const len = cum[cum.length - 1]!;
      // a trapezoid of speed: up to pace, along at pace, down to a stop
      const full = (WAITER_SPEED * WAITER_SPEED) / ACCEL;
      const peak = len >= full ? WAITER_SPEED : Math.sqrt(ACCEL * len);
      const ramp = peak / ACCEL;
      const dur = len >= full ? 2 * ramp + (len - full) / WAITER_SPEED : 2 * ramp;
      if (len > 1e-6) {
        parts.push({ kind: 'walk', pts, cum, len, t0: t, dur, peak, ramp });
        t += dur;
      }
    });
    // headings into and out of each stop, from the walks either side
    parts.forEach((p, i) => {
      if (p.kind !== 'stop') return;
      const before = parts[(i - 1 + parts.length) % parts.length]!;
      const after = parts[(i + 1) % parts.length]!;
      if (before.kind === 'walk') p.inH = tangent(before, before.len);
      if (after.kind === 'walk') p.outH = tangent(after, 0);
    });
    this.parts = parts;
    this.period = Math.max(1e-3, t);
    this.serves = serve;
    this.drinks = Array.from({ length: serve }, (_, k) => DRINKS[(seed * 5 + k * 3) % DRINKS.length]!);
  }

  /** Where the waiter is at `t` seconds on the shared clock (any real number; rounds repeat). */
  at(t: number): RoundState {
    const u = ((t % this.period) + this.period) % this.period;
    const part = this.find(u);
    const tray = this.trayAt(u);
    if (part.kind === 'stop') {
      const k = u - part.t0;
      const s = part.stop;
      // turn in to face the stop, hold, then turn back to the way on
      let h = s.face;
      if (k < TURN_IN) h = lerpAngle(part.inH, s.face, smooth(k / TURN_IN));
      else if (k > part.dur - TURN_OUT) h = lerpAngle(s.face, part.outH, smooth((k - (part.dur - TURN_OUT)) / TURN_OUT));
      const serving = s.kind === 'serve' ? band(k / part.dur, SERVE_FROM, SERVE_TO) : 0;
      return { x: s.x, z: s.z, heading: h, speed: 0, stop: s, stopT: k, tray, serving };
    }
    const k = u - part.t0;
    const { d, v } = travel(part, k);
    const p = pointAt(part, d);
    return { x: p.x, z: p.z, heading: tangent(part, d), speed: v, stop: null, stopT: 0, tray, serving: 0 };
  }

  /** The drinks on the tray at loop time `u`: loaded at the pickup, one fewer after each serve. */
  private trayAt(u: number): BarModel[] {
    const first = this.parts[0]!;
    if (first.kind !== 'stop' || first.stop.kind !== 'pickup') return [];
    if (u < first.t0 + first.dur * LOAD_AT) return [];
    let served = 0;
    for (const p of this.parts) {
      if (p.kind === 'stop' && p.serve >= 0 && u >= p.t0 + p.dur * SERVE_AT) served++;
    }
    return this.drinks.slice(served);
  }

  private find(u: number): Part {
    // a handful of parts: a straight search is plenty
    let found = this.parts[0]!;
    for (const p of this.parts) {
      if (p.t0 <= u) found = p;
      else break;
    }
    return found;
  }

  /** Every serving stop's drink count (for checks). */
  get serveCount(): number {
    return this.serves;
  }
}

/**
 * A round through `stops` (the first should be the pickup), each walk found on `grid`, by way of
 * `via[i]` (points to pass on the way from stop i to the next, if any). Stops the grid can't
 * reach are left out (with their ways); null when fewer than two remain or a way is shut.
 */
export function buildRound(grid: NavGrid, stops: Stop[], seed = 0, via: Pt[][] = []): Round | null {
  const kept: Stop[] = [];
  const ways: Pt[][] = [];
  stops.forEach((s, i) => {
    const at = grid.nearestClear(s.x, s.z, 0.6);
    if (!at) return;
    // stand exactly where the grid can take them
    kept.push({ ...s, x: at.x, z: at.z });
    ways.push(via[i] ?? []);
  });
  if (kept.length < 2) return null;
  const paths: Pt[][] = [];
  for (let i = 0; i < kept.length; i++) {
    const pts: Pt[] = [kept[i]!, ...ways[i]!, kept[(i + 1) % kept.length]!];
    const path: Pt[] = [];
    for (let k = 1; k < pts.length; k++) {
      const leg = grid.path(pts[k - 1]!, pts[k]!);
      if (!leg) return null;
      path.push(...(path.length ? leg.slice(1) : leg));
    }
    paths.push(path);
  }
  return new Round(kept, paths, seed);
}

// --- walking a path -----------------------------------------------------------------------------

/** Distance walked and speed, `k` seconds into a walk. */
function travel(w: Walk, k: number): { d: number; v: number } {
  const a = ACCEL;
  const r = w.ramp;
  if (k <= 0) return { d: 0, v: 0 };
  if (k >= w.dur) return { d: w.len, v: 0 };
  if (k < r) return { d: 0.5 * a * k * k, v: a * k };
  if (k > w.dur - r) {
    const left = w.dur - k;
    return { d: w.len - 0.5 * a * left * left, v: a * left };
  }
  return { d: 0.5 * a * r * r + w.peak * (k - r), v: w.peak };
}

function pointAt(w: Walk, d: number): Pt {
  const dd = Math.max(0, Math.min(w.len, d));
  let i = 1;
  while (i < w.cum.length - 1 && w.cum[i]! < dd) i++;
  const a = w.pts[i - 1]!;
  const b = w.pts[i]!;
  const seg = w.cum[i]! - w.cum[i - 1]!;
  const f = seg > 1e-9 ? (dd - w.cum[i - 1]!) / seg : 0;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

/** The way along the path at distance d, smoothed over TURN_REACH either side (rotation.y). */
function tangent(w: Walk, d: number): number {
  const a = pointAt(w, d - TURN_REACH);
  const b = pointAt(w, d + TURN_REACH);
  if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) {
    const p = w.pts[0]!;
    const q = w.pts[w.pts.length - 1]!;
    return Math.atan2(q.x - p.x, q.z - p.z);
  }
  return Math.atan2(b.x - a.x, b.z - a.z);
}

// --- small maths --------------------------------------------------------------------------------

export function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** From a to b by k, the short way round. */
export function lerpAngle(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/** 0 outside [a, b], rising to 1 in the middle and back: an arm reaching out and back. */
function band(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0;
  return Math.sin((Math.PI * (x - a)) / (b - a));
}
