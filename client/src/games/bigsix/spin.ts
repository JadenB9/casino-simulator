// The wheel's spin, solved backward from the stop the server already chose, and the leather
// clapper that the pegs push aside.
//
// The dealer pulls the wheel up to speed, it slows against the clapper for most of the spin and
// comes to rest with the flap between two pegs: usually with the last peg still leaning into it,
// then rocking back a few degrees as the leather springs straight. Every part is a closed-form
// function of time, so the whole spin is known the moment it is planned: the deceleration is
// scaled so the wheel turns a whole number of extra revolutions plus exactly the angle that
// leaves the clapper on the chosen stop.
//
// Angles are clockwise as the players see the wheel, measured from straight up (where the clapper
// hangs). A wheel turned by θ shows the point it carries at angle a at a + θ. Times are seconds
// since the pull. No three.js here, so the tests can plan thousands of spins.

import { STOPS } from '../../../../shared/src/games/bigsix/rules.ts';

export const TAU = Math.PI * 2;
/** One stop of the wheel, radians. Pegs sit on the boundaries. */
export const SECTOR = TAU / STOPS;

/** The pegs and the clapper, metres in the wheel's plane with the hub at the origin. */
export const GEO = {
  /** The circle the pegs stand on. */
  pegR: 0.752,
  pegRadius: 0.0055,
  /** The clapper's hinge, straight above the hub. */
  pivotR: 0.865,
  /** Hinge to the tip of the leather. */
  flapL: 0.125,
} as const;

/** A peg's angle when it first touches the hanging flap (just before the top). */
export const A_TOUCH = -Math.asin(GEO.pegRadius / GEO.pegR);

/** A peg's angle when it slips off the flap's tip: |peg − hinge|² − ρ² = L². */
export const A_RELEASE = Math.acos(
  (GEO.pegR ** 2 + GEO.pivotR ** 2 - GEO.pegRadius ** 2 - GEO.flapL ** 2) / (2 * GEO.pegR * GEO.pivotR),
);

/** The phase within a stop (see angleFor) below which the next peg is leaning on the flap. */
export const G_TOUCH = (A_RELEASE - A_TOUCH) / SECTOR;

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * The stop the clapper shows with the wheel turned θ. The flap sits between the peg that hasn't
 * slipped past it yet and the one that has, so the boundary is the release angle, not the top.
 */
export function stopAt(theta: number): number {
  return mod(Math.floor((A_RELEASE - theta) / SECTOR), STOPS);
}

/**
 * The wheel angle that leaves the clapper on `stop` at phase g in (0, 1): g near 0 means the next
 * peg is about to slip past, from G_TOUCH up the flap hangs free, near 1 the last peg just went by.
 */
export function angleFor(stop: number, g: number): number {
  return A_RELEASE - (stop + g) * SECTOR;
}

/** The flap's angle (radians, positive = its tip pushed clockwise) while a peg at angle α leans on it. */
export function pushAngle(alpha: number): number {
  const x = GEO.pegR * Math.sin(alpha);
  const down = GEO.pivotR - GEO.pegR * Math.cos(alpha);
  const d = Math.hypot(x, down);
  // the flap lies along the tangent from the hinge to the peg's far side
  return Math.atan2(x, down) + Math.asin(GEO.pegRadius / d);
}

/** How far the flap is pushed by whichever peg touches it with the wheel at θ, or null when none does. */
export function contactAngle(theta: number): number | null {
  const past = mod(theta - A_TOUCH, SECTOR);
  if (past >= A_RELEASE - A_TOUCH) return null;
  return pushAngle(A_TOUCH + past);
}

/** The flap's angle as a peg lets go of it. */
export const PHI_RELEASE = pushAngle(A_RELEASE);
const FLAP_HZ = 7.5;
const FLAP_DECAY_S = 0.07;

/** The flap springing back after a peg lets go, `dt` seconds ago. */
export function springAngle(dt: number): number {
  if (dt < 0 || dt > 0.6) return 0;
  return PHI_RELEASE * Math.exp(-dt / FLAP_DECAY_S) * Math.cos(TAU * FLAP_HZ * dt);
}

/** The flap with the wheel at θ, `sinceRelease` seconds after the last peg let go (null: long ago). */
export function flapAngle(theta: number, sinceRelease: number | null): number {
  const spring = sinceRelease === null ? 0 : springAngle(sinceRelease);
  const push = contactAngle(theta);
  return push === null ? spring : Math.max(push, spring);
}

/** Where the flap's tip is (angle clockwise from the top, as seen from the hub) at flap angle φ. */
export function tipAngle(phi: number): number {
  const x = GEO.flapL * Math.sin(phi);
  const y = GEO.pivotR - GEO.flapL * Math.cos(phi);
  return Math.atan2(x, y);
}

// ---------------------------------------------------------------------------------------------

/** The dealer's pull, and the rock back when the wheel stops against a peg. */
export const PULL_S = 0.45;
export const ROCK_S = 0.7;
/** Every spin turns the wheel at least this many times (58 Pa. Code §619a.2 asks for three). */
export const MIN_REVS = 3;
/** Speed after the pull: w0 (1 − τ)^n over the slow-down; n and a natural w0 set its feel. */
const SHAPE_N = 1.6;
export const NATURAL_W = 0.85 * TAU;

export interface SpinPlan {
  /** Where the wheel stands when the dealer takes hold of it. */
  theta0: number;
  /** Seconds from the pull to rest. */
  duration: number;
  /** The stop the server chose. */
  stop: number;
  /** Phase within the stop where the wheel stops turning forward (see angleFor). */
  gStop: number;
  /** Phase it settles at: above gStop when the leather pushes it back, equal when it stopped clear of the pegs. */
  gRest: number;
}

export class WheelSpin {
  readonly tStop: number;
  readonly tRest: number;
  readonly w0: number;
  readonly thetaStop: number;
  readonly thetaRest: number;
  readonly revolutions: number;
  private readonly tPull: number;
  private readonly tDecay: number;
  private readonly rock: number;

  constructor(readonly plan: SpinPlan) {
    const rocks = plan.gRest > plan.gStop;
    this.tRest = plan.duration;
    this.tStop = plan.duration - (rocks ? ROCK_S : 0);
    this.tPull = Math.min(PULL_S, this.tStop * 0.3);
    this.tDecay = this.tStop - this.tPull;
    // angle turned = w0 · (pull/2 + decay/(n+1)); pick whole extra turns so w0 lands near its natural value
    const k = this.tPull / 2 + this.tDecay / (SHAPE_N + 1);
    const base = mod(angleFor(plan.stop, plan.gStop) - plan.theta0, TAU);
    const turns = Math.max(MIN_REVS, Math.round((NATURAL_W * k - base) / TAU));
    const total = base + turns * TAU;
    this.w0 = total / k;
    this.thetaStop = plan.theta0 + total;
    this.rock = rocks ? (plan.gRest - plan.gStop) * SECTOR : 0;
    this.thetaRest = this.thetaStop - this.rock;
    this.revolutions = total / TAU;
  }

  /** The wheel's angle at time t (clockwise, radians, unwrapped). */
  angle(t: number): number {
    const { theta0 } = this.plan;
    if (t <= 0) return theta0;
    if (t < this.tPull) {
      const u = t / this.tPull;
      return theta0 + this.w0 * this.tPull * (u ** 3 - u ** 4 / 2);
    }
    if (t < this.tStop) {
      const tau = (t - this.tPull) / this.tDecay;
      return theta0 + (this.w0 * this.tPull) / 2 + (this.w0 * this.tDecay * (1 - (1 - tau) ** (SHAPE_N + 1))) / (SHAPE_N + 1);
    }
    if (t < this.tRest) {
      const v = (t - this.tStop) / (this.tRest - this.tStop);
      return this.thetaStop - (this.rock * (1 - Math.cos(Math.PI * v))) / 2;
    }
    return this.thetaRest;
  }

  /** Angular speed at time t, rad/s (negative while it rocks back). */
  speed(t: number): number {
    if (t <= 0 || t >= this.tRest) return 0;
    if (t < this.tPull) {
      const u = t / this.tPull;
      return this.w0 * (3 * u * u - 2 * u ** 3);
    }
    if (t < this.tStop) return this.w0 * (1 - (t - this.tPull) / this.tDecay) ** SHAPE_N;
    const span = this.tRest - this.tStop;
    return (-this.rock * Math.PI * Math.sin((Math.PI * (t - this.tStop)) / span)) / (2 * span);
  }

  /** The times a peg slips past the clapper's tip (one tick each), in order. */
  releases(): number[] {
    return this.crossings(A_RELEASE);
  }

  /** The times a peg first strikes the hanging flap, in order. */
  touches(): number[] {
    return this.crossings(A_TOUCH);
  }

  /** Times the wheel angle passes `at` plus a whole number of stops, while it turns forward. */
  private crossings(at: number): number[] {
    const out: number[] = [];
    const first = Math.floor((this.plan.theta0 - at) / SECTOR) + 1;
    const last = Math.floor((this.thetaStop - at) / SECTOR);
    let lo = 0;
    for (let j = first; j <= last; j++) {
      const target = at + j * SECTOR;
      let a = lo;
      let b = this.tStop;
      for (let i = 0; i < 48; i++) {
        const m = (a + b) / 2;
        if (this.angle(m) < target) a = m;
        else b = m;
      }
      out.push(b);
      lo = b;
    }
    return out;
  }
}

/**
 * Choose how a spin ends. Most stop with the last peg leaning into the leather and rock back as it
 * straightens; some run out of speed between pegs. `rand` gives 0..1 values (tests pass a seeded one).
 */
export function chooseEnding(rand: () => number): { gStop: number; gRest: number } {
  if (rand() < 0.72) {
    const gStop = 0.1 + 0.34 * rand();
    const gRest = G_TOUCH - 0.02 - 0.09 * rand();
    return { gStop, gRest: Math.max(gStop, gRest) };
  }
  const g = G_TOUCH + 0.05 + (0.93 - G_TOUCH - 0.05) * rand();
  return { gStop: g, gRest: g };
}
