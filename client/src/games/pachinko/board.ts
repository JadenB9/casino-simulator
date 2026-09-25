// The pachinko board as a flat 2D world: the brass rail round the field, the nails, the screen's
// frame in the middle, the start pocket under it, two tulips, the attacker and the out hole. And
// the physics a ball runs through it: gravity down the glass, bounces off nails and the rail.
//
// The server has already decided where each ball goes. The view never plays a ball live: it
// replays a flight recorded here that ended in the pocket the server named. Flights are simulated
// ahead of time for the power the dial is at (a little noise on every launch, so no two are
// alike) and kept in pools by where they ended; a ball fired takes one from the right pool. So
// the ball on the screen is real physics that happens to land where the server said, the way
// Plinko's balls follow the path they were sent.
//
// Coordinates are metres on the board's face: u across (0 in the middle), v up from the bottom.

export const BOARD_W = 0.46;
export const BOARD_H = 0.58;
/** The field: a disc inside the outer rail. */
export const CENTRE = { u: 0, v: 0.3 } as const;
export const RAIL_R = 0.215;
/** The inner rail that walls the launch lane off the field, up the left side to the top. */
export const INNER_R = RAIL_R - 0.0145;
/** The inner rail runs from low on the left (LANE_FROM) round to near the top (LANE_TO), radians. */
export const LANE_FROM = (234 * Math.PI) / 180;
export const LANE_TO = (116 * Math.PI) / 180;
/** The rubber stop on the right of the top rail that turns the strongest shots back into the field. */
export const BUMPER = (38 * Math.PI) / 180;
export const BALL_R = 0.0055;
export const PIN_R = 0.0012;
/** The screen's frame (the centre piece): a rounded box the balls go round. */
export const FRAME = { u: 0, v: 0.345, hw: 0.088, hh: 0.072, round: 0.02 } as const;
/** The start pocket (heso), the tulips and the attacker: where a ball is caught, and its mouth. */
export const HESO = { u: 0, v: 0.212, w: 0.0065 } as const;
export const TULIPS = [
  { u: -0.098, v: 0.168, w: 0.0065 },
  { u: 0.098, v: 0.168, w: 0.0065 },
] as const;
export const ATTACKER = { u: 0, v: 0.13, hw: 0.034, hh: 0.008 } as const;
/** The warp: a hole in each side of the frame, this far above its centre, into a channel down to the stage. */
export const WARP = { from: 0.02, to: 0.05, secs: 1.1 } as const;
/** The stage: the ledge under the screen that drops balls toward the heso. */
export const STAGE_V = FRAME.v - FRAME.hh - BALL_R - 0.001;
/** Anything below this is out. */
export const OUT_V = 0.1;

/** Where a flight ended. `attacker` only while it is open (a fever). */
export type Catch = 'out' | 'left' | 'right' | 'start' | 'attacker';

const G = 5.2;
/** Speed lost per second riding the outer rail outside the lane. */
const RAIL_DRAG = 5;
const SUB = 1200;
/** Frames recorded per second. */
export const FPS = 60;
const PER_FRAME = SUB / FPS;
/** A flight that hasn't ended by now is thrown away (a ball resting on a nail). */
const MAX_S = 9;

export interface Pin {
  u: number;
  v: number;
}

/**
 * The nails, laid out from rules rather than by hand: staggered rows across the field, kept out
 * of the lane by the rail, off the screen's frame and clear of the pockets' mouths, plus the pairs
 * that guard each pocket (the heso's are the famous ones).
 */
export function pins(): Pin[] {
  const out: Pin[] = [];
  const guard = (u: number, v: number) => out.push({ u, v });
  // the pockets' own nails: a pair over each mouth, the gap just wider than a ball
  const pair = (u: number, v: number, half: number) => {
    guard(u - half, v + 0.004);
    guard(u + half, v + 0.004);
    guard(u - half - 0.004, v - 0.006);
    guard(u + half + 0.004, v - 0.006);
  };
  pair(HESO.u, HESO.v, 0.0102);
  for (const t of TULIPS) pair(t.u, t.v, 0.0102);
  // a funnel of nails over the heso: two short diagonals
  for (let i = 1; i <= 3; i++) {
    guard(HESO.u - 0.0102 - i * 0.0105, HESO.v + 0.004 + i * 0.011);
    guard(HESO.u + 0.0102 + i * 0.0105, HESO.v + 0.004 + i * 0.011);
  }
  const clearOf = (u: number, v: number) => {
    const dc = Math.hypot(u - CENTRE.u, v - CENTRE.v);
    if (dc > RAIL_R - 0.017) return false;
    const a = angleOf(u - CENTRE.u, v - CENTRE.v);
    if (a > LANE_TO - 0.12 && a < LANE_FROM + 0.05 && dc > INNER_R - 0.013) return false;
    if (Math.abs(u - FRAME.u) < FRAME.hw + 0.016 && Math.abs(v - FRAME.v) < FRAME.hh + 0.016) return false;
    if (Math.abs(u - ATTACKER.u) < ATTACKER.hw + 0.014 && Math.abs(v - ATTACKER.v) < ATTACKER.hh + 0.016) return false;
    if (v < OUT_V + 0.018) return false;
    for (const p of out) if (Math.hypot(p.u - u, p.v - v) < 0.0142) return false;
    return true;
  };
  let row = 0;
  for (let v = 0.126; v < 0.5; v += 0.0156, row++) {
    const off = row % 2 ? 0.0088 : 0;
    for (let u = -0.2 + off; u <= 0.2; u += 0.0176) if (clearOf(u, v)) guard(u, v);
  }
  return out;
}

/** Angle round the centre in [-pi/2, 3pi/2), so the whole left side is one run of numbers. */
export function angleOf(du: number, dv: number): number {
  let a = Math.atan2(dv, du);
  if (a < -Math.PI / 2) a += 2 * Math.PI;
  return a;
}

export const PINS: readonly Pin[] = pins();

/** Nails by grid cell, for the collision test. */
const CELL = 0.02;
const grid = new Map<number, Pin[]>();
const key = (i: number, j: number) => i * 1000 + j;
for (const p of PINS) {
  const k = key(Math.floor((p.u + 0.3) / CELL), Math.floor(p.v / CELL));
  let list = grid.get(k);
  if (!list) grid.set(k, (list = []));
  list.push(p);
}

/** The launch: the dial's 0-100 to the ball's speed up the rail, m/s. */
export function launchSpeed(power: number): number {
  return 1.98 + (Math.max(0, Math.min(100, power)) / 100) * 0.5;
}

/** Where balls come up the rail: low on the left, heading up. */
export const LAUNCH_ANGLE = (225 * Math.PI) / 180;

/** Where the last flight that never ended was left (for tuning the board). */
export const stuckAt = { u: 0, v: 0 };

export interface Flight {
  /** u, v per frame at FPS. */
  pts: Float32Array;
  frames: number;
  end: Catch;
  power: number;
}

/** A tiny seeded generator for the launch noise: flights are reproducible from their seed. */
export function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Fly one ball from the launcher with this power and seed, and record it until it is caught.
 * Null for a flight that never ends (resting on a nail) or leaves the field.
 */
export function fly(power: number, seed: number, attackerOpen = false): Flight | null {
  const rnd = noise(seed);
  const a = LAUNCH_ANGLE + (rnd() - 0.5) * 0.02;
  const rr = RAIL_R - BALL_R;
  let u = CENTRE.u + Math.cos(a) * rr;
  let v = CENTRE.v + Math.sin(a) * rr;
  // clockwise along the rail (up the left side)
  const speed = launchSpeed(power) * (1 + (rnd() - 0.5) * 0.03);
  let vu = Math.sin(a) * speed;
  let vv = -Math.cos(a) * speed;
  const dt = 1 / SUB;
  const maxFrames = MAX_S * FPS;
  const pts = new Float32Array(maxFrames * 2 + 2);
  let frames = 0;
  const rec = () => {
    pts[frames * 2] = u;
    pts[frames * 2 + 1] = v;
    frames++;
  };
  rec();
  const pinHit = BALL_R + PIN_R;
  const launchV = v;
  let lane = true;
  /** The substep the ball went into the warp (null: never, -1: already came out of it). */
  let warpAt: number | null = null;
  let warpSide = 1;
  const foul = (): Flight => {
    rec();
    return { pts: pts.slice(0, frames * 2), frames, end: 'out', power };
  };
  for (let step = 1; step <= MAX_S * SUB; step++) {
    vv -= G * dt;
    u += vu * dt;
    v += vv * dt;

    // the rails: in the lane between the outer and inner rail until the ball clears the inner
    // rail's end; after that the field, walled by the outer rail, the inner rail's far side and
    // the rubber stop on the right
    const du = u - CENTRE.u;
    const dv = v - CENTRE.v;
    const d = Math.hypot(du, dv);
    const nu = du / d;
    const nv = dv / d;
    const ang = angleOf(du, dv);
    if (lane) {
      if (ang < LANE_TO) lane = false;
      else if (v < launchV - 0.03) return foul();
      else if (d < INNER_R + BALL_R) wall(nu, nv, INNER_R + BALL_R - d, 0.2);
    }
    if (d > rr) {
      wall(-nu, -nv, d - rr, 0.25);
      // the top rail drags: a fast shot rides it, a slow one lets go and falls into the nails
      if (!lane) {
        vu *= 1 - RAIL_DRAG * dt;
        vv *= 1 - RAIL_DRAG * dt;
      }
    }
    if (!lane && ang > LANE_TO && ang < LANE_FROM && d > INNER_R - BALL_R - 0.0015 && d < INNER_R + 0.004) wall(-nu, -nv, d - (INNER_R - BALL_R - 0.0015), 0.3);
    if (!lane && Math.abs(ang - BUMPER) < 0.05 && d > rr - 0.003) {
      // moving clockwise into the rubber: kicked back and in
      const tu = nv;
      const tv = -nu;
      const vt = vu * tu + vv * tv;
      if (vt > 0) {
        vu -= 1.4 * vt * tu + 0.25 * nu;
        vv -= 1.4 * vt * tv + 0.25 * nv;
      }
    }

    // the screen's frame
    const fx = Math.max(-FRAME.hw, Math.min(FRAME.hw, u - FRAME.u));
    const fy = Math.max(-FRAME.hh, Math.min(FRAME.hh, v - FRAME.v));
    let cu = u - FRAME.u - fx;
    let cv = v - FRAME.v - fy;
    let cd = Math.hypot(cu, cv);
    if (cd < BALL_R && warpAt === null && Math.abs(u - FRAME.u) > FRAME.hw && v - FRAME.v > WARP.from && v - FRAME.v < WARP.to) {
      // into the warp in the frame's side, out onto the stage under the screen
      warpAt = step;
      warpSide = Math.sign(u - FRAME.u);
    }
    if (warpAt !== null && warpAt >= 0) {
      const k = (step - warpAt) / (WARP.secs * SUB);
      if (k < 1) {
        // down the inside of the frame, then rocking on the stage, all on rails
        const side = warpSide;
        if (k < 0.35) {
          const q = k / 0.35;
          u = FRAME.u + side * (FRAME.hw - 0.004);
          v = FRAME.v + WARP.from + 0.01 - q * (WARP.from + 0.01 + FRAME.hh + BALL_R + 0.002);
        } else {
          const q = (k - 0.35) / 0.65;
          u = FRAME.u + side * (FRAME.hw - 0.012) * Math.cos(q * Math.PI * 1.5) * (1 - q * 0.9);
          v = STAGE_V + 0.004 * Math.abs(Math.sin(q * Math.PI * 3));
        }
        vu = 0;
        vv = 0;
        if (step % PER_FRAME === 0) rec();
        continue;
      }
      // off the front of the stage
      warpAt = -1;
      u = FRAME.u + (rnd() - 0.5) * 0.02;
      v = STAGE_V - 0.004;
      vu = (rnd() - 0.5) * 0.25;
      vv = -0.15;
    }
    if (cd < BALL_R) {
      if (cd === 0) {
        cu = 0;
        cv = 1;
        cd = 1;
      }
      bounce(cu / cd, cv / cd, BALL_R - cd, 0.35);
      // the frame's roof is pitched: a ball on it rolls off to the nearer side
      if (cv > 0 && fy >= FRAME.hh) vu += Math.sign(u - FRAME.u || 1) * 2.5 * dt;
    }

    // the attacker's lid while it's shut, and the pockets' bodies
    if (!attackerOpen) {
      const ax = Math.max(-ATTACKER.hw, Math.min(ATTACKER.hw, u - ATTACKER.u));
      const ay = Math.max(-ATTACKER.hh, Math.min(ATTACKER.hh, v - ATTACKER.v));
      const au = u - ATTACKER.u - ax;
      const av = v - ATTACKER.v - ay;
      const ad = Math.hypot(au, av);
      if (ad < BALL_R && ad > 0) {
        bounce(au / ad, av / ad, BALL_R - ad, 0.3);
        // the shut lid leans forward: whatever lands on it rolls off an end
        if (av > 0 && ay >= ATTACKER.hh) vu += Math.sign(u - ATTACKER.u || 1) * 2.5 * dt;
      }
    }

    // nails
    const ci = Math.floor((u + 0.3) / CELL);
    const cj = Math.floor(v / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = grid.get(key(i, j));
        if (!list) continue;
        for (const p of list) {
          const pu = u - p.u;
          const pv = v - p.v;
          const pd = Math.hypot(pu, pv);
          if (pd < pinHit && pd > 0) {
            bounce(pu / pd, pv / pd, pinHit - pd, 0.42);
            // a nail is never quite round: a whisker of noise keeps balls off their tops
            vu += (rnd() - 0.5) * 0.04;
          }
        }
      }
    }

    // caught?
    let end: Catch | null = null;
    if (vv < 0 && Math.abs(v - HESO.v) < 0.005 && Math.abs(u - HESO.u) < HESO.w) end = 'start';
    else if (vv < 0 && Math.abs(v - TULIPS[0].v) < 0.005 && Math.abs(u - TULIPS[0].u) < TULIPS[0].w) end = 'left';
    else if (vv < 0 && Math.abs(v - TULIPS[1].v) < 0.005 && Math.abs(u - TULIPS[1].u) < TULIPS[1].w) end = 'right';
    else if (attackerOpen && vv < 0 && Math.abs(v - ATTACKER.v) < ATTACKER.hh && Math.abs(u - ATTACKER.u) < ATTACKER.hw) end = 'attacker';
    else if (v < OUT_V) end = 'out';
    if (step % PER_FRAME === 0 || end) rec();
    if (end) return { pts: pts.slice(0, frames * 2), frames, end, power };
  }
  stuckAt.u = u;
  stuckAt.v = v;
  return null;

  /** Push out along (nu, nv) and bounce whatever velocity goes against it. */
  function wall(nu: number, nv: number, depth: number, e: number): void {
    u += nu * depth;
    v += nv * depth;
    const vn = vu * nu + vv * nv;
    if (vn < 0) {
      vu -= (1 + e) * vn * nu;
      vv -= (1 + e) * vn * nv;
    }
  }

  function bounce(nu: number, nv: number, depth: number, e: number): void {
    u += nu * depth;
    v += nv * depth;
    const vn = vu * nu + vv * nv;
    if (vn < 0) {
      vu -= (1 + e) * vn * nu;
      vv -= (1 + e) * vn * nv;
      // a little grip on the tangent
      const tu = -nv;
      const tv = nu;
      const vt = vu * tu + vv * tv;
      vu -= vt * 0.04 * tu;
      vv -= vt * 0.04 * tv;
    }
  }
}

/** Where a flight is at time t seconds (clamped to its end). */
export function flightAt(f: Flight, t: number, out: { u: number; v: number }): { u: number; v: number } {
  const x = Math.max(0, Math.min(f.frames - 1, t * FPS));
  const i = Math.floor(x);
  const k = x - i;
  const j = Math.min(f.frames - 1, i + 1);
  out.u = f.pts[i * 2]! + (f.pts[j * 2]! - f.pts[i * 2]!) * k;
  out.v = f.pts[i * 2 + 1]! + (f.pts[j * 2 + 1]! - f.pts[i * 2 + 1]!) * k;
  return out;
}

export function flightSeconds(f: Flight): number {
  return (f.frames - 1) / FPS;
}

/** Power buckets the pools are kept in: flights within a bucket look alike. */
export const BUCKETS = 11;
export function bucketOf(power: number): number {
  return Math.max(0, Math.min(BUCKETS - 1, Math.round((power / 100) * (BUCKETS - 1))));
}
function powerOf(bucket: number, rnd: () => number): number {
  return Math.max(0, Math.min(100, (bucket / (BUCKETS - 1)) * 100 + (rnd() - 0.5) * (100 / (BUCKETS - 1))));
}

/**
 * Pools of recorded flights by bucket and by where they ended. `fill` simulates within a time
 * budget; `take` hands one over, searching harder (then in the nearest buckets, then with the
 * attacker's fever lane) when its pool is dry.
 */
export class FlightPools {
  private pools = new Map<string, Flight[]>();
  private seed = 1;
  /** How many of each ending a bucket keeps ready. */
  keep = 3;
  simulated = 0;

  constructor(seed = 0x5eed) {
    this.seed = seed;
  }

  private pool(bucket: number, end: Catch): Flight[] {
    const k = `${bucket}:${end}`;
    let p = this.pools.get(k);
    if (!p) this.pools.set(k, (p = []));
    return p;
  }

  /** One more simulated flight in this bucket, into its pool (unless that pool is full). */
  private simulate(bucket: number, fever: boolean): Flight | null {
    const rnd = noise(this.seed++ * 2654435761);
    const f = fly(powerOf(bucket, rnd), this.seed * 7919, fever);
    this.simulated++;
    if (!f) return null;
    const p = this.pool(bucket, f.end);
    if (p.length < this.keep * (f.end === 'out' ? 3 : 1)) p.push(f);
    return f;
  }

  ready(bucket: number, end: Catch): number {
    return this.pool(bucket, end).length;
  }

  /** Top up this bucket's pools for `ms` of the frame. */
  fill(bucket: number, ms: number, fever = false): void {
    const t0 = performance.now();
    const ends: Catch[] = fever ? ['attacker'] : ['start', 'left', 'right', 'out'];
    while (performance.now() - t0 < ms) {
      if (ends.every((e) => this.ready(bucket, e) >= this.keep)) return;
      this.simulate(bucket, fever);
    }
  }

  /** A flight ending in `end`, for this power: from the pool, or searched for now. */
  take(power: number, end: Catch): Flight {
    const fever = end === 'attacker';
    const home = fever ? bucketOf(Math.max(power, 80)) : bucketOf(power);
    const order = [home, ...Array.from({ length: BUCKETS }, (_, i) => i).filter((b) => b !== home).sort((a, b) => Math.abs(a - home) - Math.abs(b - home))];
    for (const b of order) {
      const p = this.pool(b, end);
      if (p.length) return p.shift()!;
      // search this bucket a while before moving on
      for (let n = 0; n < (b === home ? 400 : 120); n++) {
        const f = this.simulate(b, fever);
        if (f && f.end === end) {
          const pool = this.pool(b, end);
          const i = pool.indexOf(f);
          if (i >= 0) pool.splice(i, 1);
          return f;
        }
      }
    }
    return straightDrop(end);
  }
}

/** The last resort, never expected: a ball dropped straight down into its pocket. */
export function straightDrop(end: Catch): Flight {
  const at = end === 'start' ? HESO : end === 'left' ? TULIPS[0] : end === 'right' ? TULIPS[1] : end === 'attacker' ? ATTACKER : { u: 0.05, v: OUT_V };
  const frames = 60;
  const pts = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    const k = i / (frames - 1);
    pts[i * 2] = at.u;
    pts[i * 2 + 1] = at.v + (1 - k * k) * 0.12;
  }
  return { pts, frames, end, power: 50 };
}
