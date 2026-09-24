// The wheel's spin, solved backward from the slot the server already chose, and the flapper the
// pegs push aside.
//
// The wheel is pulled up to speed, slows against the flapper for most of the spin and comes to
// rest with the flapper between two pegs: usually with the last peg still leaning into it, then
// rocking back a few degrees as the leather straightens. Every part is a closed-form function of
// time, so the whole spin is known the moment it is planned: the slow-down is scaled so the wheel
// turns a whole number of extra revolutions plus exactly the angle that leaves the flapper in the
// chosen slot.
//
// Angles are clockwise as the players see the wheel, measured from straight up (where the flapper
// hangs). A wheel turned by θ shows the point it carries at angle a at a + θ. Slot i spans wheel
// angles [i·S, (i+1)·S) with a peg on each boundary. Times are seconds since the pull. No three.js
// here, so the tests can plan thousands of spins.

import { SLOTS } from '../../../../shared/src/games/banditwheel/rules.ts';
import { PEG_R, PEG_RADIUS, PIVOT_R, FLAP_L } from './layout.ts';

export const TAU = Math.PI * 2;
/** One slot of the wheel, radians. Pegs sit on the boundaries. */
export const SECTOR = TAU / SLOTS;

/** A peg's angle when it first touches the hanging flapper (just before the top). */
export const A_TOUCH = -Math.asin(PEG_RADIUS / PEG_R);

/** A peg's angle when it slips off the flapper's tip: |peg − hinge|² − ρ² = L². */
export const A_RELEASE = Math.acos((PEG_R ** 2 + PIVOT_R ** 2 - PEG_RADIUS ** 2 - FLAP_L ** 2) / (2 * PEG_R * PIVOT_R));

/** The phase within a slot (see angleFor) below which the next peg is leaning on the flapper. */
export const G_TOUCH = (A_RELEASE - A_TOUCH) / SECTOR;

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * The slot the flapper shows with the wheel turned θ. The flapper sits between the peg that hasn't
 * slipped past it yet and the one that has, so the boundary is the release angle, not the top.
 */
export function slotAt(theta: number): number {
  return mod(Math.floor((A_RELEASE - theta) / SECTOR), SLOTS);
}

/**
 * The wheel angle that leaves the flapper in `slot` at phase g in (0, 1): g near 0 means the next
 * peg is about to slip past, from G_TOUCH up the flapper hangs free, near 1 the last peg just went by.
 */
export function angleFor(slot: number, g: number): number {
  return A_RELEASE - (slot + g) * SECTOR;
}

/** The flapper's angle (radians, positive = its tip pushed clockwise) while a peg at angle α leans on it. */
export function pushAngle(alpha: number): number {
  const x = PEG_R * Math.sin(alpha);
  const down = PIVOT_R - PEG_R * Math.cos(alpha);
  const d = Math.hypot(x, down);
  // the flapper lies along the tangent from the hinge to the peg's far side
  return Math.atan2(x, down) + Math.asin(PEG_RADIUS / d);
}

/** How far the flapper is pushed by whichever peg touches it with the wheel at θ, or null when none does. */
export function contactAngle(theta: number): number | null {
  const past = mod(theta - A_TOUCH, SECTOR);
  if (past >= A_RELEASE - A_TOUCH) return null;
  return pushAngle(A_TOUCH + past);
}

/** The flapper's angle as a peg lets go of it. */
export const PHI_RELEASE = pushAngle(A_RELEASE);
const FLAP_HZ = 6;
const FLAP_DECAY_S = 0.08;

/** The flapper springing back after a peg lets go, `dt` seconds ago: past straight, and back. */
export function springAngle(dt: number): number {
  if (dt < 0 || dt > 0.6) return 0;
  return PHI_RELEASE * Math.exp(-dt / FLAP_DECAY_S) * Math.cos(TAU * FLAP_HZ * dt);
}

/** The flapper with the wheel at θ, `sinceRelease` seconds after the last peg let go (null: long ago). */
export function flapAngle(theta: number, sinceRelease: number | null): number {
  const spring = sinceRelease === null ? 0 : springAngle(sinceRelease);
  const push = contactAngle(theta);
  return push === null ? spring : Math.max(push, spring);
}

/** Where the flapper's tip is (angle clockwise from the top, seen from the hub) at flapper angle φ. */
export function tipAngle(phi: number): number {
  const x = FLAP_L * Math.sin(phi);
  const y = PIVOT_R - FLAP_L * Math.cos(phi);
  return Math.atan2(x, y);
}

// ---------------------------------------------------------------------------------------------

/** The pull that starts the wheel, and the rock back when it stops against a peg. */
export const PULL_S = 0.45;
export const ROCK_S = 0.55;
/** Every spin turns the wheel at least twice round. */
export const MIN_REVS = 2;
/** Speed after the pull: w0 (1 − τ)^n over the slow-down; n and a natural w0 set its feel. */
const SHAPE_N = 1.6;
export const NATURAL_W = 1.2 * TAU;

export interface SpinPlan {
  /** Where the wheel stands when it is pulled. */
  theta0: number;
  /** Seconds from the pull to rest. */
  duration: number;
  /** The slot the server chose. */
  slot: number;
  /** Phase within the slot where the wheel stops turning forward (see angleFor). */
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
    this.tStop = plan.duration - (rocks ? Math.min(ROCK_S, plan.duration * 0.15) : 0);
    this.tPull = Math.min(PULL_S, this.tStop * 0.3);
    this.tDecay = this.tStop - this.tPull;
    // angle turned = w0 · (pull/2 + decay/(n+1)); pick whole extra turns so w0 lands near its natural value
    const k = this.tPull / 2 + this.tDecay / (SHAPE_N + 1);
    const base = mod(angleFor(plan.slot, plan.gStop) - plan.theta0, TAU);
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

  /** The times a peg slips past the flapper's tip (one click each), in order. */
  releases(): number[] {
    return this.crossings(A_RELEASE);
  }

  /** The times a peg first strikes the hanging flapper, in order. */
  touches(): number[] {
    return this.crossings(A_TOUCH);
  }

  /** Times the wheel angle passes `at` plus a whole number of slots, while it turns forward. */
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
 * Choose how a spin ends. Most die against a peg that is still bending the leather, and the flapper
 * straightening knocks the wheel back a few degrees until it hangs free just inside the slot; the
 * rest run out of speed with the flapper already hanging between two pegs. Either way the flapper
 * ends clear of both pegs, so the slot it shows is plain to see. `rand` gives 0..1 values.
 */
export function chooseEnding(rand: () => number): { gStop: number; gRest: number } {
  if (rand() < 0.7) {
    const gStop = 0.08 + 0.3 * rand();
    const gRest = G_TOUCH + 0.04 + 0.12 * rand();
    return { gStop, gRest };
  }
  const g = G_TOUCH + 0.1 + (0.9 - G_TOUCH - 0.1) * rand();
  return { gStop: g, gRest: g };
}
