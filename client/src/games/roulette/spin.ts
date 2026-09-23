// The ball's flight, solved backward from the pocket the server already chose.
//
// The wheel head turns counterclockwise (seen from above) and the ball is launched clockwise on
// the track. It slows, leaves the track, runs down the bowl, lands on the spinning rotor, hops
// over frets and settles. Every part is a closed-form function of time, so the whole flight is
// known the moment it is planned: the entry into the rotor is placed exactly far enough ahead of
// the target pocket that the ball, slowing against the rotor, stops in it. The only free
// quantity is how the ball decelerates on the track, and that is chosen so the entry angle
// comes out right (by picking a whole number of extra revolutions and a curve shape to match).
//
// Angles use three.js lathe convention: a point at angle a sits at (r·sin a, r·cos a), and
// increasing a is counterclockwise from above. Times are seconds since the ball was launched.
// No three.js here, so the tests can fly thousands of spins.

export const TAU = Math.PI * 2;

/** Wheel dimensions the flight needs (metres, heights above the wheel's base on the table). */
export const DIMS = {
  ballR: 0.0095,
  /** Where the ball rides on the track, against the bowl wall. */
  trackR: 0.368,
  trackY: 0.053,
  /** The bowl's slope from the track down to the rotor, as (radius, height) points outside-in. */
  apron: [
    [0.372, 0.044],
    [0.35, 0.04],
    [0.3, 0.026],
    [0.285, 0.02],
  ] as [number, number][],
  deflectorR: 0.322,
  /** The rotor: number ring (outside) and pockets (inside), separated by frets. */
  ringOutR: 0.274,
  ringOutY: 0.019,
  ringInR: 0.247,
  ringInY: 0.013,
  pocketOutR: 0.245,
  pocketInR: 0.197,
  pocketY: 0.0035,
  fretTop: 0.0135,
  /** Where the ball first lands on the rotor, and where it comes to rest. */
  enterR: 0.262,
  restR: 0.222,
};

const G = 9.81;

/** Seconds from landing on the rotor to rest, and from leaving the track to landing. */
export const BOUNCE_S = 1.8;
export const FALL_S = 0.95;
/** Ball speed (rad/s, clockwise is negative) at launch and as it lands on the rotor. */
export const LAUNCH_W = -2.9 * TAU;
export const ENTER_W = -1.05 * TAU;
/** A pre-launched ball waiting for "No more bets" never circles slower than this. */
export const FLOOR_W = -1.45 * TAU;
/** How sharply the ball's speed against the rotor dies away after landing. */
const BOUNCE_P = 2.6;
const SHAPE_N = 1.6;

/**
 * The wheel head's angle over time. Idle it creeps round; the dealer gives it a push when the
 * ball goes in and it eases back toward idle. Closed form, so a flight can ask where the rotor
 * will be when the ball lands.
 */
export class Rotor {
  base = 0;
  idle = 0.1 * TAU;
  push = 0.4 * TAU;
  tau = 9;
  pushed = false;

  angle(t: number): number {
    if (!this.pushed) return this.base + this.idle * t;
    return this.base + this.idle * t + (this.push - this.idle) * this.tau * (1 - Math.exp(-t / this.tau));
  }

  speed(t: number): number {
    if (!this.pushed) return this.idle;
    return this.idle + (this.push - this.idle) * Math.exp(-t / this.tau);
  }

  /** The dealer pushes the wheel as the ball goes in; the clock restarts at 0 from this angle. */
  kick(fromAngle: number): void {
    this.base = fromAngle;
    this.pushed = true;
  }
}

/**
 * Ball speed decaying from w0 to w1 over [t0, t0+T]: w(t) = w1 + (w0 − w1)(1 − τ)^n, plus an
 * optional correction spread smoothly over the same span.
 */
interface Profile {
  t0: number;
  T: number;
  theta0: number;
  w0: number;
  w1: number;
  n: number;
  fix: number;
}

function profileAngle(p: Profile, t: number): number {
  const tau = Math.min(1, Math.max(0, (t - p.t0) / p.T));
  const decay = (p.w0 - p.w1) * p.T * (1 - (1 - tau) ** (p.n + 1)) / (p.n + 1);
  const smooth = tau * tau * (3 - 2 * tau);
  const base = p.theta0 + p.w1 * (Math.min(t, p.t0 + p.T) - p.t0) + decay + p.fix * smooth;
  // past the end the ball keeps its final speed
  return t > p.t0 + p.T ? base + p.w1 * (t - p.t0 - p.T) : base;
}

function profileSpeed(p: Profile, t: number): number {
  const tau = Math.min(1, Math.max(0, (t - p.t0) / p.T));
  return p.w1 + (p.w0 - p.w1) * (1 - tau) ** p.n;
}

export interface BallState {
  /** World (bowl) angle, radius and height of the ball's centre. */
  theta: number;
  r: number;
  y: number;
  /** Angle relative to the rotor, once the ball is on it. */
  rel: number | null;
  phase: 'track' | 'fall' | 'bounce' | 'rest';
  /** Ball speed along the track, rad/s (negative = clockwise). */
  w: number;
}

interface Hop {
  t0: number;
  dur: number;
  h: number;
}

/** Height of the bowl's surface at radius r (the apron), for the ball running down it. */
export function apronY(r: number): number {
  const a = DIMS.apron;
  if (r >= a[0]![0]) return a[0]![1];
  for (let i = 1; i < a.length; i++) {
    const [r0, y0] = a[i - 1]!;
    const [r1, y1] = a[i]!;
    if (r >= r1) return y1 + ((r - r1) / (r0 - r1)) * (y0 - y1);
  }
  // between the apron's edge and the rotor: fall onto the number ring
  const [rl, yl] = a[a.length - 1]!;
  const k = Math.min(1, (rl - r) / (rl - DIMS.enterR));
  return yl + k * (rotorY(DIMS.enterR) - yl);
}

/** Height of the rotor's surface at radius r: the sloped number ring, then the pocket floors. */
export function rotorY(r: number): number {
  const d = DIMS;
  if (r >= d.ringInR) return d.ringInY + ((r - d.ringInR) / (d.ringOutR - d.ringInR)) * (d.ringOutY - d.ringInY);
  if (r >= d.pocketOutR) return d.pocketY + ((r - d.pocketOutR) / (d.ringInR - d.pocketOutR)) * (d.ringInY - d.pocketY);
  return d.pocketY;
}

export interface FlightPlan {
  /** Rotor-frame angle of the target pocket's centre. */
  pocketAngle: number;
  /** Seconds since launch at which the ball must be at rest. */
  tRest: number;
  /** The ball's state when planning (launch, or where a pre-launched ball has got to). */
  from: { t: number; theta: number; w: number };
  rotor: Rotor;
  /** Angles of the bowl's deflectors, for the odd bump on the way down. */
  deflectors?: number[];
  /** Pocket width in radians (frets sit at multiples of it in the rotor frame). */
  sector: number;
  /** 0..1 values for small variety (hop heights); tests pass fixed ones. */
  jitter?: () => number;
}

/** A planned flight: angle and position of the ball at any time from planning to rest and after. */
export class Flight {
  readonly tEnter: number;
  readonly tDrop: number;
  readonly tRest: number;
  readonly t0: number;
  private readonly profile: Profile;
  private readonly D: number;
  private readonly hops: Hop[] = [];
  private readonly deflectHop: Hop | null = null;
  /** Whole revolutions the ball makes on the track and down the bowl (for the ≥ 4 rule). */
  readonly revolutions: number;
  /** Radians the solver had to spread over the track because deceleration alone couldn't reach the pocket (normally 0). */
  readonly correction: number;

  constructor(readonly plan: FlightPlan) {
    const { rotor, from } = plan;
    const jitter = plan.jitter ?? Math.random;
    this.t0 = from.t;
    this.tRest = plan.tRest;
    this.tEnter = plan.tRest - BOUNCE_S;
    this.tDrop = this.tEnter - FALL_S;
    // How far ahead of the pocket (against the rotor) the ball lands, so that its speed relative
    // to the rotor, dying away as (1 − τ)^p, carries it exactly onto the pocket.
    const rel0 = rotor.speed(this.tEnter) - ENTER_W;
    this.D = (rel0 * BOUNCE_S) / BOUNCE_P;
    const thetaEnter = rotor.angle(this.tEnter) + plan.pocketAngle + this.D;
    this.profile = solveTrack(from, this.tEnter, thetaEnter);
    this.revolutions = Math.abs(profileAngle(this.profile, this.tEnter) - profileAngle(this.profile, this.t0)) / TAU;
    this.correction = this.profile.fix;
    // hops as it lands and skitters across the frets
    let t = this.tEnter;
    for (const h of [0.017, 0.011, 0.0075, 0.0045, 0.0025]) {
      const hh = h * (0.75 + 0.5 * jitter());
      const dur = Math.sqrt((8 * hh) / G);
      this.hops.push({ t0: t, dur, h: hh });
      t += dur + 0.04 + 0.08 * jitter();
    }
    // a deflector strike on the way down, if one is near where the ball crosses its radius
    const uCross = Math.sqrt((DIMS.trackR - DIMS.deflectorR) / (DIMS.trackR - DIMS.enterR));
    const tCross = this.tDrop + uCross * FALL_S;
    const at = profileAngle(this.profile, tCross);
    const near = (plan.deflectors ?? []).some((d) => Math.abs(wrapPi(at - d)) < 0.2);
    if (near) this.deflectHop = { t0: tCross, dur: 0.14, h: 0.009 };
  }

  /** Where the ball is at time t (seconds since launch). */
  at(t: number): BallState {
    const { rotor } = this.plan;
    if (t >= this.tRest) {
      const rel = this.plan.pocketAngle;
      return { theta: rotor.angle(t) + rel, r: DIMS.restR, y: DIMS.pocketY + DIMS.ballR, rel, phase: 'rest', w: rotor.speed(t) };
    }
    if (t >= this.tEnter) {
      const tau = (t - this.tEnter) / BOUNCE_S;
      const rel = this.plan.pocketAngle + this.D * (1 - tau) ** BOUNCE_P;
      const k = Math.max(0, 1 - tau / 0.55);
      const r = DIMS.restR + (DIMS.enterR - DIMS.restR) * k * k;
      let y = rotorY(r) + DIMS.ballR;
      if (r < DIMS.ringInR) y = Math.max(y, fretBump(rel, r, this.plan.sector));
      y += hopHeight(this.hops, t);
      const w = rotor.speed(t) - (this.D * BOUNCE_P * (1 - tau) ** (BOUNCE_P - 1)) / BOUNCE_S;
      return { theta: rotor.angle(t) + rel, r, y, rel, phase: 'bounce', w };
    }
    const theta = profileAngle(this.profile, t);
    const w = profileSpeed(this.profile, t);
    if (t >= this.tDrop) {
      const u = (t - this.tDrop) / FALL_S;
      const r = DIMS.trackR + (DIMS.enterR - DIMS.trackR) * u * u;
      let y = Math.min(DIMS.trackY, apronY(r) + DIMS.ballR);
      if (this.deflectHop) y += hopHeight([this.deflectHop], t);
      return { theta, r, y, rel: null, phase: 'fall', w };
    }
    return { theta, r: DIMS.trackR, y: DIMS.trackY, rel: null, phase: 'track', w };
  }

  /** Times the ball lands from a hop (for the clack). */
  landings(): { t: number; h: number }[] {
    const out = this.hops.map((h) => ({ t: h.t0 + h.dur, h: h.h }));
    if (this.deflectHop) out.push({ t: this.deflectHop.t0, h: this.deflectHop.h });
    return out.sort((a, b) => a.t - b.t);
  }
}

/**
 * A ball put in before "No more bets" circles on the track, slowing toward FLOOR_W, until the
 * result is known and a Flight takes over from wherever it has got to.
 */
export class OpenTrack {
  private readonly profile: Profile;
  constructor(theta0: number, expectedEnter: number) {
    this.profile = { t0: 0, T: Math.max(1, expectedEnter), theta0, w0: LAUNCH_W, w1: FLOOR_W, n: SHAPE_N, fix: 0 };
  }

  at(t: number): BallState {
    return { theta: profileAngle(this.profile, t), r: DIMS.trackR, y: DIMS.trackY, rel: null, phase: 'track', w: profileSpeed(this.profile, t) };
  }
}

/**
 * Choose the track deceleration from the ball's state `from` so that it reaches `thetaEnter`
 * (mod a whole turn) at `tEnter` with speed ENTER_W. Speed follows w1 + (w0 − w1)(1 − τ)^n; the
 * turn count and the exponent n are picked together, keeping n near its natural value.
 */
export function solveTrack(from: { t: number; theta: number; w: number }, tEnter: number, thetaEnter: number): Profile {
  const T = Math.max(0.05, tEnter - from.t);
  const w0 = Math.min(from.w, ENTER_W - 0.2); // always faster (more negative) than the entry speed
  const A = (w0 - ENTER_W) * T; // < 0
  const B = ENTER_W * T; // < 0
  const natural = B + A / (SHAPE_N + 1);
  // candidate rotations: thetaEnter − theta0 − k·2π for whole k, nearest to the natural one first
  const want = thetaEnter - from.theta;
  const k0 = Math.round((want - natural) / TAU);
  let best: Profile | null = null;
  let bestScore = Infinity;
  for (let dk = -3; dk <= 3; dk++) {
    const R = want - (k0 + dk) * TAU;
    const denom = R - B;
    if (denom >= 0) continue;
    const n = A / denom - 1;
    if (n < 0.35 || n > 6) continue;
    const score = Math.abs(Math.log((n + 1) / (SHAPE_N + 1)));
    if (score < bestScore) {
      bestScore = score;
      best = { t0: from.t, T, theta0: from.theta, w0, w1: ENTER_W, n, fix: 0 };
    }
  }
  if (best) return best;
  // Too little time to steer by deceleration alone: keep the natural curve and spread the
  // remaining difference (under half a turn) over the track.
  const R = want - k0 * TAU;
  return { t0: from.t, T, theta0: from.theta, w0, w1: ENTER_W, n: SHAPE_N, fix: R - natural };
}

function hopHeight(hops: Hop[], t: number): number {
  for (const h of hops) {
    if (t >= h.t0 && t <= h.t0 + h.dur) {
      const u = (t - h.t0) / h.dur;
      return h.h * 4 * u * (1 - u);
    }
  }
  return 0;
}

/** The ball riding over a fret: its centre stays a ball radius clear of the fret's top edge. */
function fretBump(rel: number, r: number, sector: number): number {
  const k = Math.round(rel / sector);
  const d = Math.abs(rel - k * sector) * r;
  const br = DIMS.ballR;
  if (d >= br) return 0;
  return DIMS.fretTop + Math.sqrt(br * br - d * d);
}

export function wrapPi(a: number): number {
  return a - TAU * Math.round(a / TAU);
}
