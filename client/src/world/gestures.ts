// The emotes as the body acts them out, and a dealer's motions: poses as functions of time, for
// Person (characters.ts) to solve onto the skeleton each frame.
//
// Everything is in the character's own frame (x to its left, y up, z forward) and given for the
// right side; the left mirrors. An arm is placed by where its hand goes (Hand), a leg by where its
// foot goes (Foot: the knee bends to reach it, so the feet stay on the floor as the hips drop), the
// spine by turns, and the whole body can hop, glide, spin and flip about its middle. Seated, each
// emote gets an upper-body version: nothing below the waist moves on a chair.

import type { EmoteId, FREE_EMOTES } from '../../../shared/src/protocol.ts';

type FreeEmote = (typeof FREE_EMOTES)[number];

export type BoneKey =
  | 'body'
  | 'shoulderR'
  | 'upperR'
  | 'lowerR'
  | 'shoulderL'
  | 'upperL'
  | 'lowerL'
  | 'head'
  | 'neck'
  | 'hips'
  | 'torso'
  | 'chest'
  | 'thighR'
  | 'shinR'
  | 'thighL'
  | 'shinL';

/** Radians about the character's x (left), y (up) and z (forward) axes, applied z, then x, then y. */
export type Turn = [number, number, number];
/** A point or a direction in the character's frame: x to its left, y up, z forward. */
export type Vec = [number, number, number];

/**
 * An arm as an emote holds it, given for the right arm (the left mirrors x: -x is out to the
 * right, +x across the body). Either the wrist goes to `at` (from the middle of the shoulders, in
 * arm lengths: shoulder to wrist, straight) with the elbow bending out toward `elbow`, or to
 * `knee` (metres from the knee on its own side: a hand on the knee), or the upper arm and the
 * forearm lie along `upper` and `fore`. Directions needn't be unit length.
 */
export interface Hand {
  at?: Vec;
  /** Metres further out than `at` (-x for the right hand): a hand's own thickness, which doesn't grow with the arm. */
  out?: number;
  knee?: Vec;
  elbow?: Vec;
  upper?: Vec;
  fore?: Vec;
  /** Which way the palm faces, and the way the fingers point (on along the forearm if not given). */
  palm: Vec;
  fingers?: Vec;
  /** The fingers curled into a fist, 0 to 1. */
  fist?: number;
  /** The thumb straight up along the index finger's side of the hand. */
  thumb?: boolean;
  /** Everything above turns with the chest (a hand kept on the heart through a bow). */
  frame?: 'chest';
}

/** Two arm poses at once, `w` of the way from `a` to `b` (each solved, then blended). */
export interface HandMix {
  a: Hand;
  b: Hand;
  w: number;
}

/**
 * A foot as an emote places it, given for the right foot (the left mirrors x). `at` is where the
 * heel stands, metres from the character's origin on the floor (y lifts it off the floor).
 */
export interface Foot {
  at: Vec;
  /** Toes turned out, radians. */
  toe?: number;
  /** The heel raised about the ball of the foot, radians; below 0 the toes come up off the heel. */
  heel?: number;
  /** Which way the knee bends out toward (default ahead). */
  knee?: Vec;
}

export type PropId = 'bills' | 'trophy';

export type Pose = Partial<Record<BoneKey, Turn>> & {
  handR?: Hand | HandMix;
  handL?: Hand | HandMix;
  /** The hips (and the legs hung from them) moved, metres. Seated poses leave it out. */
  pelvis?: Vec;
  footR?: Foot;
  footL?: Foot;
  /** The whole body: up (a hop), back and forth (a glide), and turned about its middle (a backflip, a spin). */
  hop?: number;
  glide?: number;
  /** Radians about the character's x axis: going over backwards is negative. */
  flip?: number;
  /** Radians about the vertical. */
  spin?: number;
};

export interface Gesture {
  dur: number;
  pose: (t: number, seated: boolean) => Pose;
  /** The dance's beat, seconds (its music keeps it: audio/beat.ts). */
  beat?: number;
  /** Something held while it plays (world/emote-props.ts). */
  prop?: PropId;
}

/** The point the body turns about for a flip or a spin, in the character's frame (metres). */
export const PIVOT: Vec = [0, 0.9, 0.05];

export const DOWN: Vec = [0, -1, 0];

/** The same turn for the left side: x stays, y and z change sign. */
export const mirror = (t: Turn): Turn => [t[0], -t[1], -t[2]];

/** Claps a second, and how long a clap lasts; the hands meet at every 1 / CLAP_RATE s. */
export const CLAP_RATE = 3;
export const CLAP_S = 2;
/** When a clap's hands meet, in seconds from its start (while the arms are fully up): its sound's cues. */
export const CLAP_TIMES: readonly number[] = [1, 2, 3, 4, 5].map((n) => n / CLAP_RATE);
/** How far a wrist is from the middle when the palms touch, in metres (on either body). */
const PALM = 0.054;

export function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/** Up, then down again, between two moments of a gesture (0 outside them). */
export const beat = (t: number, t0: number, t1: number) => (t <= t0 || t >= t1 ? 0 : Math.sin((Math.PI * (t - t0)) / (t1 - t0)));
/** 0 before t0, 1 after t1, eased between. */
const ramp = (t: number, t0: number, t1: number) => smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
const mix = (a: number, b: number, w: number) => a + (b - a) * w;
const mixV = (a: Vec, b: Vec, w: number): Vec => [mix(a[0], b[0], w), mix(a[1], b[1], w), mix(a[2], b[2], w)];
const mixT = mixV as (a: Turn, b: Turn, w: number) => Turn;
/** A triangle wave: -1 at 0, 1 at half a period, -1 again at a whole one. */
const tri = (x: number) => 1 - 4 * Math.abs(x - Math.floor(x) - 0.5);
/** A beat that snaps: 1 on it, falling away fast. */
const snap = (x: number) => Math.abs(Math.sin(Math.PI * x)) ** 0.6;
/** Both arms the same way (the left mirrors itself). */
const both = (h: Hand | HandMix) => ({ handR: h, handL: h });
const blend = (a: Hand, b: Hand, w: number): Hand | HandMix => (w <= 0 ? a : w >= 1 ? b : { a, b, w });

/** Feet under the hips, toes a little out, knees soft. */
const STANCE: Foot = { at: [-0.1, 0, 0.05], toe: 0.14 };
const stance = (x = 0.1, z = 0.05, toe = 0.14): Foot => ({ at: [-x, 0, z], toe });

// --- the free six --------------------------------------------------------------------------------

const FREE: Record<FreeEmote, Gesture> = {
  // the right hand up by the head, palm out, the forearm rocking side to side from the elbow
  wave: {
    dur: 2.4,
    pose: (t) => ({
      handR: { upper: [-1, -0.3, 0.15], fore: [-0.45 * Math.sin(t * 11), 1, 0.15], palm: [0, 0, 1] },
      head: [0, 0, 0.08],
    }),
  },
  // both fists thrown up in a V and shaken, with a couple of hops
  cheer: {
    dur: 1.7,
    pose: (t, seated) => {
      const hand: Hand = { upper: [-0.5, 1, 0.12], fore: [-0.38 + 0.14 * Math.sin(t * 16), 1, 0.15], palm: [0.25, 0, 1], fist: 1 };
      return { handR: hand, handL: hand, hop: !seated && t < 0.9 ? 0.15 * Math.abs(Math.sin((Math.PI * t) / 0.45)) : 0 };
    },
  },
  // palm to palm in front of the chest, elbows out, three claps a second: the hands snap shut
  // and ease apart
  clap: {
    dur: CLAP_S,
    pose: (t) => {
      const open = Math.abs(Math.sin(Math.PI * CLAP_RATE * t)) ** 0.75;
      const hand: Hand = { at: [-0.25 * open, -0.42, 0.62], out: PALM, elbow: [-1, -0.3, -0.15], palm: [1, 0, 0], fingers: [-0.1 * open, 0.6, 1] };
      return { handR: hand, handL: hand, head: [0.04, 0, 0] };
    },
  },
  // a fist held out in front of the chest, thumb up, pushed forward once, and a nod
  thumbs: {
    dur: 1.9,
    pose: (t) => {
      const push = beat(t, 0.1, 0.55);
      return {
        handR: { upper: [-0.22, -0.8, 0.5 + 0.2 * push], fore: [0.1, 0.3, 1], palm: [1, 0, 0], fingers: [0, 0, 1], fist: 1, thumb: true },
        head: [0.07 + 0.05 * push, 0, 0],
      };
    },
  },
  // shoulders up, elbows in at the sides, forearms out with the palms up, head to one side
  shrug: {
    dur: 1.7,
    pose: () => {
      const shoulder: Turn = [0, 0, -0.24];
      const hand: Hand = { upper: [-0.14, -1, -0.04], fore: [-0.8, 0.12, 0.6], palm: [0, 1, 0], fingers: [-0.8, 0, 0.6] };
      return { shoulderR: shoulder, shoulderL: mirror(shoulder), handR: hand, handL: hand, head: [0, 0, 0.2] };
    },
  },
  // "six, seven": both hands out in front, palms up, weighed one against the other while the
  // head bobs to it
  sixseven: {
    dur: 2.1,
    pose: (t, seated) => {
      const w = Math.sin(t * Math.PI * 2 * 1.6);
      const lift = seated ? 0.3 : 0.08;
      const hand = (up: number): Hand => ({ upper: [-0.1, -1, seated ? 0.45 : 0.28], fore: [-0.07, lift + 0.42 * up, 1], palm: [0, 1, 0], fingers: [-0.1, 0, 1] });
      return { handR: hand(w), handL: hand(-w), head: [0.03 + 0.06 * Math.abs(w), 0, 0.06 * w] };
    },
  },
};

// --- the boutique's and the rewards ----------------------------------------------------------

/** The dances keep time at 120 beats a minute. */
const BEAT = 0.5;

// Robot: a pose a beat, snapped to in a tenth of a second and held dead still, a little
// overshoot as it stops. Arms: forearms out level, forearms up, goalposts, straight ahead.
const LEVEL: Hand = { frame: 'chest', upper: [-0.12, -1, 0.02], fore: [0, -0.02, 1], palm: [0, -1, 0], fingers: [0, 0, 1] };
const RAISED: Hand = { frame: 'chest', upper: [-0.12, -1, 0.05], fore: [0, 1, 0.12], palm: [0.15, 0, 1], fingers: [0, 1, 0] };
const POST: Hand = { frame: 'chest', upper: [-1, 0.02, 0.1], fore: [0, 1, 0.05], palm: [0, 0, 1], fingers: [0, 1, 0] };
const POST_DOWN: Hand = { frame: 'chest', upper: [-1, 0.02, 0.1], fore: [0, -1, 0.1], palm: [0, 0, 1], fingers: [0, -1, 0] };
const AHEAD: Hand = { frame: 'chest', upper: [-0.1, 0.02, 1], fore: [-0.05, 0, 1], palm: [0, -1, 0], fingers: [0, 0, 1] };
interface RobotKey {
  r: Hand;
  l: Hand;
  torso: Turn;
  head: Turn;
  dip: number;
}
const ROBOT: RobotKey[] = [
  { r: LEVEL, l: LEVEL, torso: [0, 0, 0], head: [0, 0, 0], dip: 0 },
  { r: RAISED, l: LEVEL, torso: [0, 0, 0], head: [0, 0.5, 0], dip: 0 },
  { r: RAISED, l: RAISED, torso: [0, 0, 0], head: [0, 0, 0], dip: 0.07 },
  { r: POST, l: POST, torso: [0, 0.4, 0], head: [0, -0.4, 0], dip: 0 },
  { r: AHEAD, l: LEVEL, torso: [0, -0.4, 0], head: [0.3, 0, 0], dip: 0 },
  { r: POST_DOWN, l: POST, torso: [0, 0, 0], head: [0, 0, 0.3], dip: 0.07 },
  { r: LEVEL, l: RAISED, torso: [0, 0.2, 0], head: [0, 0.5, 0], dip: 0 },
  { r: LEVEL, l: LEVEL, torso: [0, 0, 0], head: [0, 0, 0], dip: 0 },
];

// The backflip's moments (seconds): down into the crouch, off the floor, landed, stood up.
const FLIP_CROUCH = 0.36;
const FLIP_OFF = 0.46;
const FLIP_LAND = 1.14;
const FLIP_UP = 1.75;
/** How high the flip goes (metres) and, over the time in the air, how hard it falls. */
const FLIP_HIGH = 0.62;

// The moonwalk: gliding back until GLIDE_END, a spin that carries back to the start, a toe stand.
const GLIDE_START = 0.2;
const GLIDE_END = 2.7;
const SPIN_END = 3.35;
/** How far each foot swings either side in a step (metres); the glide is four times that a second. */
const STRIDE = 0.075;

const SHOP: Record<Exclude<EmoteId, FreeEmote>, Gesture> = {
  // Bent over, hands on the knees, and the hips popping back four times a second: the pelvis
  // tips while the shoulders hold still, so only the hips move. Seated: the shoulders bounce.
  throwback: {
    dur: 4,
    beat: BEAT,
    pose: (t, seated) => {
      const p = snap(t * 4);
      const head: Turn = [0, 0.18 * Math.sin((Math.PI * t) / BEAT), 0];
      if (seated) {
        const s: Turn = [0, 0, -0.16 * p];
        return { torso: [0.14 + 0.1 * p, 0, 0], chest: [0.06 * p, 0, 0], shoulderR: s, shoulderL: mirror(s), head: [-0.1, head[1], 0] };
      }
      const foot: Foot = { at: [-0.2, 0, 0.1], toe: 0.4, knee: [-0.75, 0, 1] };
      return {
        pelvis: [0, -0.21 + 0.08 * p, -0.08 - 0.08 * p],
        body: [0.66 + 0.46 * p, 0, 0],
        hips: [0.36 - 0.46 * p, 0, 0],
        chest: [0.12, 0, 0],
        neck: [-0.45, 0, 0],
        head: [-0.55, head[1], 0],
        footR: foot,
        footL: foot,
        ...both({ knee: [0.01, 0.09, -0.05], elbow: [-1, 0.1, -0.1], palm: [0.2, -1, -0.2], fingers: [0.3, -0.45, 1] }),
      };
    },
  },
  // Heels tapped out in front one after the other, arms pumping against them, then the hands up
  // round the eyes like goggles while the heels keep going.
  griddy: {
    dur: 4.4,
    beat: BEAT,
    pose: (t, seated) => {
      const n = Math.floor(t / BEAT);
      const u = t / BEAT - n;
      const right = n % 2 === 0;
      const tap = Math.sin(Math.PI * u);
      // + is the right arm forward: it swings with the left heel
      const w = (right ? -1 : 1) * tap;
      const goggles = ramp(t, 2.25, 2.5);
      const swing = (w: number): Hand => ({ upper: [-0.18, -1, 0.75 * w], fore: [-0.05, -0.35 + 0.75 * Math.max(0, w), 0.9], palm: [1, 0, 0], fist: 0.45 });
      const eye: Hand = { at: [-0.1, 0.4, 0.3], elbow: [-1, 0.35, 0.1], palm: [0, 0, -1], fingers: [0.35, 1, 0], fist: 0.5 };
      const pose: Pose = {
        handR: blend(swing(w), eye, goggles),
        handL: blend(swing(-w), eye, goggles),
        chest: [0, 0.14 * w * (1 - goggles), 0],
        head: [0.07 * tap - 0.1 * goggles, 0, 0],
      };
      if (seated) return pose;
      const kick = (on: boolean): Foot => (on ? { at: [-0.11, 0.01 * tap, 0.02 + 0.36 * tap], heel: -0.75 * tap, toe: 0.1 } : stance(0.11, -0.02));
      return { ...pose, pelvis: [(right ? 0.03 : -0.03) * tap, -0.08 + 0.04 * tap, -0.04 * tap], hips: [0.16 - 0.06 * tap, 0, 0], footR: kick(right), footL: kick(!right) };
    },
  },
  // Straight arms swung past the hips from side to side, the one crossing the body in front and
  // the other behind, the hips swinging the other way. Seated: the forearms swing over the table.
  floss: {
    dur: 3.5,
    beat: BEAT,
    pose: (t, seated) => {
      const x = Math.sin((Math.PI * t) / BEAT);
      // + is swung to the character's left
      const s = Math.sign(x) * Math.abs(x) ** 0.45;
      if (seated) {
        const r: Hand = { upper: [0.05, -1, 0.35], fore: [0.7 * s, 0.1, 1], palm: [0, 0, 1], fist: 0.4 };
        const l: Hand = { upper: [0.05, -1, 0.35], fore: [-0.7 * s, 0.1, 1], palm: [0, 0, 1], fist: 0.4 };
        return { handR: r, handL: l, torso: [0.05, 0.12 * s, 0], head: [0, 0, 0.1 * s] };
      }
      const r: Vec = [0.62 * s, -1, 0.42 * s];
      const l: Vec = [-0.62 * s, -1, -0.42 * s];
      return {
        handR: { upper: r, fore: r, palm: [1, 0, 0] },
        handL: { upper: l, fore: l, palm: [1, 0, 0] },
        pelvis: [-0.07 * s, -0.04, 0],
        hips: [0, 0.14 * s, -0.12 * s],
        head: [0, -0.1 * s, 0.08 * s],
        footR: STANCE,
        footL: STANCE,
      };
    },
  },
  // Snapped into: the face down into the crook of the left elbow, the right arm flung out and
  // up the same way, held.
  dab: {
    dur: 1.8,
    pose: (t, seated) => {
      const hit = beat(t, 0.25, 0.45);
      const pose: Pose = {
        handR: { upper: [-1, 0.72, 0.12], fore: [-1, 0.76, 0.12], palm: [0, -0.3, 1] },
        handL: { upper: [0.78, 0.42, 0.58], fore: [0.6, 0.62, -0.1], palm: [0, -1, 0], fist: 0.5 },
        torso: [0.12, -0.2, 0.06],
        neck: [0.2, -0.2, 0],
        head: [0.42 + 0.05 * hit, -0.5, 0.1],
      };
      if (seated) return pose;
      return { ...pose, pelvis: [0.03, -0.05 - 0.02 * hit, 0], footR: stance(0.14, 0.06, 0.25), footL: stance(0.14, 0.06, 0.25) };
    },
  },
  robot: {
    dur: 4,
    beat: BEAT,
    pose: (t, seated) => {
      const n = Math.min(ROBOT.length - 1, Math.floor(t / BEAT));
      const u = t - n * BEAT;
      const from = ROBOT[(n + ROBOT.length - 1) % ROBOT.length]!;
      const to = ROBOT[n]!;
      const w = ramp(u, 0, 0.1);
      // the stop is a little too hard, and rings
      const ring = 0.04 * Math.exp(-u * 18) * Math.sin(u * 70);
      const pose: Pose = {
        handR: n === 0 && u < 0.1 ? to.r : blend(from.r, to.r, w),
        handL: n === 0 && u < 0.1 ? to.l : blend(from.l, to.l, w),
        torso: mixT(from.torso, to.torso, w),
        head: mixT(from.head, to.head, w).map((v, i) => (i === 0 ? v + ring : v)) as Turn,
        chest: [0, ring, 0],
      };
      if (seated) return pose;
      return { ...pose, pelvis: [0, -mix(from.dip, to.dip, w), 0], footR: stance(0.12), footL: stance(0.12) };
    },
  },
  // Down into a crouch with the arms swung back, thrown up off the floor, tucked, over once
  // backwards about the middle, and landed with the knees taking it.
  backflip: {
    dur: 2.1,
    pose: (t, seated) => {
      if (seated) {
        // leaning back with the arms thrown up and over, a flip mimed from the chair
        const u = ramp(t, 0.1, 0.55) * (1 - ramp(t, 1.1, 1.6));
        const over: Hand = { upper: [-0.3, 1, -0.35], fore: [-0.15, 0.6, -1], palm: [0, 0, -1], fist: 0.5 };
        return { ...both(over), torso: [-0.28 * u, 0, 0], head: [-0.35 * u, 0, 0] };
      }
      const crouch = ramp(t, 0, FLIP_CROUCH) * (1 - ramp(t, FLIP_CROUCH, FLIP_OFF));
      const land = ramp(t, FLIP_LAND - 0.02, FLIP_LAND + 0.1) * (1 - ramp(t, FLIP_LAND + 0.15, FLIP_UP));
      const air = t > FLIP_OFF && t < FLIP_LAND;
      const u = air ? (t - FLIP_OFF) / (FLIP_LAND - FLIP_OFF) : 0;
      const tuck = air ? ramp(u, 0.08, 0.3) * (1 - ramp(u, 0.68, 0.92)) : 0;
      // arms: back in the crouch, up as it leaves, round the shins in the tuck, out ahead to land
      const back: Hand = { upper: [-0.15, -0.55, -0.85], fore: [-0.1, -0.5, -0.85], palm: [0, 0, -1] };
      const up: Hand = { upper: [-0.25, 1, 0.15], fore: [-0.2, 1, 0.25], palm: [0.2, 0, 1] };
      const shins: Hand = { knee: [0.02, -0.1, 0.07], elbow: [-1, 0, 0], palm: [0.2, 0, -1], fist: 0.7 };
      const ahead: Hand = { upper: [-0.3, -0.25, 1], fore: [-0.2, 0, 1], palm: [0, -1, 0] };
      let arms: Hand | HandMix;
      if (t < FLIP_CROUCH) arms = back;
      else if (!air && t < FLIP_LAND) arms = blend(back, up, ramp(t, FLIP_CROUCH, FLIP_OFF));
      else if (air) arms = u < 0.5 ? blend(up, shins, ramp(u, 0.05, 0.25)) : blend(shins, ahead, ramp(u, 0.75, 1));
      else arms = ahead;
      const foot: Foot = { at: [-0.1, 0.52 * tuck, 0.05 + 0.2 * tuck], toe: 0.1, heel: -0.4 * tuck };
      return {
        ...both(arms),
        pelvis: [0, -0.26 * crouch - 0.24 * land, -0.07 * crouch - 0.06 * land],
        body: [0.3 * crouch + 0.3 * land, 0, 0],
        hips: [0.3 * crouch + 0.15 * land + 0.6 * tuck, 0, 0],
        head: [0.2 * tuck - 0.25 * (air ? 1 - tuck : 0), 0, 0],
        footR: foot,
        footL: foot,
        hop: air ? 4 * FLIP_HIGH * u * (1 - u) : 0,
        flip: air ? -2 * Math.PI * smooth(u) : 0,
      };
    },
  },
  // A fan of hundreds held out to show, then fanned at the face, chin up; the other fist on the hip.
  moneyfan: {
    dur: 3.4,
    prop: 'bills',
    pose: (t) => {
      const fan = Math.sin(t * Math.PI * 2 * 2.4);
      const cool = ramp(t, 0.95, 1.25);
      const show: Hand = { at: [-0.22, -0.28, 0.85], elbow: [-0.6, -1, 0], palm: [0, 0.15, 1], fingers: [-0.1, 1, 0.1] };
      const face: Hand = { at: [-0.3, 0.22, 0.46], elbow: [-0.7, -1, 0], palm: [0.75, 0, -0.65], fingers: [0.4 * fan, 1, 0.1] };
      return {
        handR: blend(show, face, cool),
        handL: { at: [-0.44, -0.92, -0.02], elbow: [-1, 0, -0.5], palm: [1, 0, 0], fingers: [0, -1, 0.3], fist: 0.85 },
        head: [-0.14 * cool, 0.18 * cool, -0.06 * cool],
        chest: [-0.05 * cool, 0, 0],
      };
    },
  },
  // One hand to the heart, the other swept out, and a deep bow from the hips with the right foot
  // drawn back.
  bow: {
    dur: 2.6,
    pose: (t, seated) => {
      const b = ramp(t, 0.25, 0.8) * (1 - ramp(t, 1.65, 2.25));
      const pose: Pose = {
        handR: { frame: 'chest', at: [0.1, -0.42, 0.3], elbow: [-1, -0.6, 0], palm: [0, 0, -1], fingers: [1, 0.2, 0] },
        handL: { upper: [-0.6, -0.75, -0.35], fore: [-0.7, -0.45, -0.3], palm: [0, 0, 1] },
        hips: [(seated ? 0.35 : 0.85) * b, 0, 0],
        neck: [0.15 * b, 0, 0],
        head: [0.15 * b, 0, 0],
      };
      if (seated) return pose;
      return {
        ...pose,
        pelvis: [0, -0.02 * b, -0.07 * b],
        footR: { at: [-0.11, 0, 0.05 - 0.2 * b], toe: 0.25, heel: 0.45 * b },
        footL: stance(0.1, 0.07),
      };
    },
  },
  // A gold cup brought up from the chest and held over the head, pumped three times.
  trophy: {
    dur: 3.4,
    prop: 'trophy',
    pose: (t, seated) => {
      const lift = ramp(t, 0.1, 0.6);
      const pump = beat(t, 1.0, 1.35) + beat(t, 1.6, 1.95) + beat(t, 2.2, 2.55);
      const chest: Hand = { at: [-0.34, -0.42, 0.62], elbow: [-1, -0.8, 0], palm: [1, 0, 0.1], fingers: [0, 1, 0.3] };
      const over: Hand = { at: [-0.34, 0.86 + 0.14 * pump, 0.14], elbow: [-1, 0, 0], palm: [1, 0, 0], fingers: [0, 1, 0] };
      return {
        ...both(blend(chest, over, lift)),
        torso: [-0.08 * lift, 0, 0],
        head: [-0.3 * lift, 0, 0],
        hop: seated ? 0 : 0.05 * pump,
      };
    },
  },
  // Back across the floor with the feet sliding under, one flat and sliding back while the other
  // stands on its toes, then switching; then a spin that carries back to the start, and up on the
  // toes. Seated: a hand to the hat brim and the head keeping time.
  moonwalk: {
    dur: 4.2,
    beat: BEAT,
    pose: (t, seated) => {
      const bob = Math.sin((Math.PI * 2 * t) / BEAT);
      const brim: Hand = { at: [-0.14, 0.62, 0.32], elbow: [-1, 0.25, 0], palm: [0, -0.4, 1], fingers: [0.5, 0, 0.6], fist: 0.3 };
      if (seated) {
        return { handR: brim, head: [0.08 * bob, 0.15 * Math.sin((Math.PI * t) / BEAT), 0], shoulderR: [0, 0, -0.08 * Math.max(0, bob)], shoulderL: [0, 0, 0.08 * Math.max(0, -bob)] };
      }
      const spinning = ramp(t, GLIDE_END, SPIN_END);
      const stand = ramp(t, SPIN_END - 0.15, SPIN_END + 0.1);
      const slide = Math.min(GLIDE_END - GLIDE_START, Math.max(0, t - GLIDE_START));
      // each foot runs forward and back under the body; the one going back is flat, the other on its toes
      const a = tri((t - GLIDE_START) / (2 * BEAT));
      const x = (t - GLIDE_START) / (2 * BEAT);
      // the right foot comes forward (on its toes) over the first half of each pair of steps
      const going = x - Math.floor(x) < 0.5 ? 1 : -1;
      const gliding = t < GLIDE_END ? 1 - spinning : 0;
      const walk = (s: number, toes: boolean): Foot => ({
        at: [-0.08, 0, 0.04 + STRIDE * s * gliding],
        toe: 0.05,
        heel: mix(toes ? 0.45 : 0, 0.8, stand) * (t < GLIDE_START ? t / GLIDE_START : 1),
        knee: [0.1, 0, 1],
      });
      const arms: Hand = { upper: [-0.22, -1, 0.1 * a], fore: [-0.1, -0.35, 1], palm: [1, 0, 0], fist: 0.45 };
      const tuck: Hand = { upper: [0.1, -1, 0.3], fore: [0.9, 0.2, 0.3], palm: [0, 0, -1], fist: 0.6 };
      const out: Hand = { upper: [-0.6, -0.8, 0.2], fore: [-0.7, -0.6, 0.3], palm: [0, 0, 1] };
      return {
        handR: spinning < 1 ? blend(arms, tuck, spinning) : blend(tuck, brim, stand),
        handL: spinning < 1 ? blend(arms, tuck, spinning) : blend(tuck, out, stand),
        footR: walk(a, going > 0),
        footL: walk(-a, going < 0),
        pelvis: [0, -0.03 + 0.06 * stand, 0],
        hips: [0.1 * (1 - stand), 0, 0],
        head: [0.08 * bob * gliding, 0, 0],
        // the flat foot slides back as fast as the other one comes forward, so that one stands still
        glide: -((2 * STRIDE) / BEAT) * slide * (1 - spinning),
        spin: t > GLIDE_END && t < SPIN_END ? 2 * Math.PI * spinning : 0,
      };
    },
  },
};

/** Every emote as the body acts it out. */
export const GESTURES: Record<EmoteId, Gesture> = { ...FREE, ...SHOP };

/** A dealer's motions at the table, for the table views to call through the world. */
export type StaffGesture = 'deal' | 'sweep' | 'pay';

// Reaching down over the felt: from the idle arm (upper 14 degrees back and 27 out, forearm 24
// forward) the upper arm swings forward and in and the elbow opens, so the hand comes down to a
// hand's height over a table 0.78 m high, 30-40 cm out.
const STAFF_GESTURES: Record<StaffGesture, { dur: number; pose: (t: number) => Pose }> = {
  // the deck held at the waist in the left hand; the right takes a card and flicks it out
  deal: {
    dur: 1.0,
    pose: (t) => {
      const flick = beat(t, 0.35, 0.7);
      return {
        torso: [0.06, 0, 0],
        upperL: [-0.34, 0, -0.26],
        lowerL: [-0.81, -0.5, 0],
        upperR: [-0.88 - 0.2 * flick, 0.1, 0.26],
        lowerR: [0.67 + 0.15 * flick, 0.15, 0],
      };
    },
  },
  // the right arm reaches across the layout and draws the chips in toward the rack
  sweep: {
    dur: 1.35,
    pose: (t) => {
      const u = smooth(Math.min(1, Math.max(0, (t - 0.2) / 0.85)));
      return {
        torso: [0.14, 0.15 - 0.3 * u, 0],
        upperR: [-1.0 + 0.45 * u, 0.55 - 0.75 * u, 0.26],
        lowerR: [0.55 - 0.45 * u, 0.2, 0],
      };
    },
  },
  // both hands forward, setting a payout down beside a bet
  pay: {
    dur: 1.1,
    pose: (t) => {
      const push = beat(t, 0.3, 0.8);
      const upper: Turn = [-0.8 - 0.15 * push, 0.1, 0.26];
      const lower: Turn = [0.5 + 0.15 * push, 0.2, 0];
      return { torso: [0.1 + 0.04 * push, 0, 0], upperR: upper, lowerR: lower, upperL: mirror(upper), lowerL: mirror(lower) };
    },
  },
};

export function gestureOf(e: EmoteId | StaffGesture): Gesture | undefined {
  return (GESTURES as Partial<Record<string, Gesture>>)[e] ?? (STAFF_GESTURES as Partial<Record<string, Gesture>>)[e];
}

/** How long an emote plays, seconds. */
export function gestureSeconds(e: EmoteId): number {
  return GESTURES[e].dur;
}

/** Whether a pose moves anything below the waist (a walk stops it). */
export function movesLegs(p: Pose): boolean {
  return !!(p.pelvis || p.footR || p.footL || p.body || p.flip || p.glide);
}
