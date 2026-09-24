// The floor staff's motions, as poses over time (pose.ts): what a waiter's arms do with a tray,
// handing a drink over, a banker's greeting, nod and counted notes, a shopkeeper polishing a case
// or straightening a mannequin, a bartender shaking and pouring. Each is short and eases in and
// out (Crew plays them on top of the idle and walk clips).

import { mirror, type Pose, type Turn } from './pose.ts';

export interface Motion {
  /** Seconds. */
  dur: number;
  pose(t: number): Pose;
}

/** Up, then down again, between two moments (0 outside them). */
export const beat = (t: number, t0: number, t1: number) => (t <= t0 || t >= t1 ? 0 : Math.sin((Math.PI * (t - t0)) / (t1 - t0)));
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
/** 0 → 1 over [t0, t1], held, 1 → 0 over [t2, t3]. */
const hold = (t: number, t0: number, t1: number, t2: number, t3: number) => smooth((t - t0) / (t1 - t0)) * (1 - smooth((t - t2) / (t3 - t2)));
const scale = (p: Turn, k: number): Turn => [p[0] * k, p[1] * k, p[2] * k];

// --- the tray -----------------------------------------------------------------------------------

/**
 * A cocktail tray carried on the left hand: the elbow in by the waist, the forearm forward and a
 * little out, the palm up under the tray's middle at about the height of the lowest rib.
 */
export const TRAY_UPPER_L: Turn = mirror([-0.36, 0.05, -0.18]);
export const TRAY_LOWER_L: Turn = mirror([-1.28, -0.34, 0]);
export const TRAY_HAND_L: Turn = mirror([0.3, 0, 0.9]);
export const TRAY: Pose = { upperL: TRAY_UPPER_L, lowerL: TRAY_LOWER_L, handL: TRAY_HAND_L };

// --- motions ------------------------------------------------------------------------------------

export const MOTIONS = {
  /** A small nod: yes, of course. */
  nod: {
    dur: 0.9,
    pose: (t) => {
      const k = beat(t, 0.05, 0.45) + 0.6 * beat(t, 0.45, 0.8);
      return { head: [0.26 * k, 0, 0], neck: [0.08 * k, 0, 0] };
    },
  },
  /** A no: the head turns side to side. */
  shake: {
    dur: 1.0,
    pose: (t) => {
      const env = beat(t, 0, 1.0);
      return { head: [0.04 * env, 0.22 * Math.sin(t * 15) * env, 0], neck: [0, 0.06 * Math.sin(t * 15) * env, 0] };
    },
  },
  /** A greeting across a counter: a nod and an open right hand, palm up, toward the guest. */
  greet: {
    dur: 1.5,
    pose: (t) => {
      const k = hold(t, 0.05, 0.4, 1.0, 1.45);
      const n = beat(t, 0.1, 0.65);
      return {
        head: [0.2 * n, 0, 0],
        neck: [0.06 * n, 0, 0],
        torso: [0.06 * n, 0, 0],
        upperR: scale([-0.55, 0.1, -0.32], k),
        lowerR: scale([-0.62, 0.5, 0], k),
      };
    },
  },
  /** Handing something over: the right arm reaches out at chest height and comes back. */
  handOver: {
    dur: 1.4,
    pose: (t) => {
      const k = hold(t, 0.05, 0.5, 0.85, 1.35);
      return {
        torso: [0.1 * k, 0, 0],
        upperR: scale([-1.12, 0.12, 0.12], k),
        lowerR: scale([-0.28, 0.3, 0], k),
        head: [0.12 * k, 0, 0],
      };
    },
  },
  /** Counting notes out onto the counter: the stack in the left hand, the right laying them down. */
  count: {
    dur: 2.4,
    pose: (t) => {
      const k = hold(t, 0.05, 0.35, 2.0, 2.35);
      const flick = t > 0.35 && t < 2.0 ? Math.abs(Math.sin((t - 0.35) * Math.PI * 2.4)) : 0;
      return {
        torso: [0.12 * k, 0, 0],
        head: [0.3 * k, 0, 0],
        upperL: scale([-0.4, 0, 0.24], k),
        lowerL: scale([-0.9, -0.5, 0], k),
        upperR: scale([-0.78 - 0.14 * flick, 0.12, 0.24], k),
        lowerR: scale([-0.25 + 0.3 * flick, 0.35, 0], k),
      };
    },
  },
  /** Setting a drink down on a table in front: the right arm reaches forward and down. */
  serve: {
    dur: 1.2,
    pose: (t) => {
      const k = hold(t, 0.05, 0.45, 0.75, 1.15);
      return {
        torso: [0.16 * k, 0, 0],
        head: [0.2 * k, 0, 0],
        upperR: scale([-0.72, 0.1, 0.22], k),
        lowerR: scale([0.35, 0.2, 0], k),
      };
    },
  },
  /** A welcome with both hands: palms up, a little apart (the shopkeeper). */
  welcome: {
    dur: 1.6,
    pose: (t) => {
      const k = hold(t, 0.05, 0.45, 1.1, 1.55);
      const n = beat(t, 0.15, 0.7);
      const upper: Turn = [-0.5, 0.1, -0.3];
      const lower: Turn = [-0.7, 0.45, 0];
      return { head: [0.18 * n, 0, 0], torso: [0.05 * n, 0, 0], upperR: scale(upper, k), lowerR: scale(lower, k), upperL: scale(mirror(upper), k), lowerL: scale(mirror(lower), k) };
    },
  },
  /** Polishing a glass case: leaning over it, the right hand going round in small circles. */
  polish: {
    dur: 4.2,
    pose: (t) => {
      const k = hold(t, 0.05, 0.6, 3.6, 4.15);
      const a = t * 7.5;
      return {
        torso: [0.28 * k, 0, 0],
        head: [0.32 * k, 0, 0],
        upperR: scale([-0.95 + 0.07 * Math.sin(a), 0.1 + 0.1 * Math.cos(a), 0.18], k),
        lowerR: scale([0.1, 0.25, 0], k),
        upperL: scale(mirror([-0.5, 0, 0.2]), k),
        lowerL: scale(mirror([-0.6, 0.3, 0]), k),
      };
    },
  },
  /** Straightening a mannequin's jacket: both hands up at its shoulders, small tugs. */
  adjust: {
    dur: 3.4,
    pose: (t) => {
      const k = hold(t, 0.05, 0.6, 2.8, 3.35);
      const tug = Math.sin(t * 5.5) * 0.06;
      const upper: Turn = [-1.2 + tug, 0.2, -0.05];
      const lower: Turn = [-0.55, 0.45, 0];
      return { head: [0.05 * k, 0, 0], upperR: scale(upper, k), lowerR: scale(lower, k), upperL: scale(mirror([-1.2 - tug, 0.2, -0.05]), k), lowerL: scale(mirror(lower), k) };
    },
  },
  /** Shaking a cocktail over the right shoulder, then pouring it out in front. */
  mix: {
    dur: 3.0,
    pose: (t) => {
      const shaking = hold(t, 0.05, 0.4, 1.6, 1.9);
      const pouring = hold(t, 1.7, 2.0, 2.6, 2.95);
      const s = Math.sin(t * 22) * 0.16 * (t < 1.7 ? 1 : 0);
      const shakeU: Turn = [-0.75 + s, 0.25, -0.3];
      const shakeL: Turn = [-1.45 + s, 0.4, 0];
      const pourU: Turn = [-0.95, 0.15, 0.12];
      const pourL: Turn = [-0.35, 0.3, 0];
      return {
        upperR: [shakeU[0] * shaking + pourU[0] * pouring, shakeU[1] * shaking + pourU[1] * pouring, shakeU[2] * shaking + pourU[2] * pouring],
        lowerR: [shakeL[0] * shaking + pourL[0] * pouring, shakeL[1] * shaking + pourL[1] * pouring, 0],
        upperL: scale(mirror([-0.6, 0.2, -0.1]), shaking),
        lowerL: scale(mirror([-1.35, 0.5, 0]), shaking),
        head: [0.22 * pouring, 0, 0],
      };
    },
  },
  /** Turning to the shelf behind for a plate or a bottle: a reach up and back, head following. */
  fetch: {
    dur: 1.6,
    pose: (t) => {
      const k = hold(t, 0.05, 0.5, 1.0, 1.55);
      return { upperR: scale([-1.5, 0.1, -0.2], k), lowerR: scale([-0.3, 0.2, 0], k), head: [-0.15 * k, 0, 0] };
    },
  },
} satisfies Record<string, Motion>;

export type MotionId = keyof typeof MOTIONS;
