// A celebrity's own motions, laid over the idle and walk clips like the staff's (life/motions.ts,
// life/pose.ts): signing an autograph, a selfie with the phone held up, pointing someone out in the
// crowd, a small bow. The wave, the cheer and the clap are the emote gestures every character has.

import { beat, type Motion } from '../life/motions.ts';
import { mirror, type Turn } from '../life/pose.ts';

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
/** 0 -> 1 over [t0, t1], held, 1 -> 0 over [t2, t3]. */
const hold = (t: number, t0: number, t1: number, t2: number, t3: number) => smooth((t - t0) / (t1 - t0)) * (1 - smooth((t - t2) / (t3 - t2)));
const scale = (p: Turn, k: number): Turn => [p[0] * k, p[1] * k, p[2] * k];

export const CELEB_MOTIONS = {
  /** Signing: a photo held at the chest in the left hand, the right scribbling a name across it. */
  sign: {
    dur: 3.4,
    pose: (t) => {
      const k = hold(t, 0.05, 0.45, 2.9, 3.35);
      const pen = t > 0.5 && t < 2.8 ? Math.sin((t - 0.5) * Math.PI * 5) : 0;
      return {
        torso: [0.1 * k, 0, 0],
        head: [0.36 * k, 0, 0],
        upperL: scale(mirror([-0.9, 0.05, 0.22]), k),
        lowerL: scale(mirror([-0.95, -0.5, 0]), k),
        upperR: scale([-0.95, 0.12 + 0.08 * pen, 0.2], k),
        lowerR: scale([-0.85 + 0.1 * Math.abs(pen), 0.4, 0], k),
        handR: scale([0.2, 0.3 * pen, 0], k),
      };
    },
  },
  /** A selfie: the phone up high in the right hand, a lean toward whoever is in it, a tilt of the head. */
  selfie: {
    dur: 2.6,
    pose: (t) => {
      const k = hold(t, 0.05, 0.5, 2.0, 2.55);
      return {
        torso: [0, 0, 0.1 * k],
        chest: [-0.05 * k, 0, 0.06 * k],
        upperR: scale([-2.25, 0.25, -0.4], k),
        lowerR: scale([-0.55, 0.35, 0], k),
        handR: scale([0.4, 0, 0], k),
        head: [-0.12 * k, 0, 0.16 * k],
      };
    },
  },
  /** Pointing someone out in the crowd: the right arm out and a little up, a nod. */
  point: {
    dur: 1.8,
    pose: (t) => {
      const k = hold(t, 0.05, 0.35, 1.2, 1.75);
      const n = beat(t, 0.4, 1.0);
      return { upperR: scale([-1.45, 0.1, -0.22], k), lowerR: scale([-0.12, 0.1, 0], k), head: [0.12 * n, 0, 0] };
    },
  },
  /** A small bow, one hand to the chest. */
  bow: {
    dur: 1.9,
    pose: (t) => {
      const k = hold(t, 0.05, 0.55, 1.1, 1.85);
      return { torso: [0.42 * k, 0, 0], chest: [0.12 * k, 0, 0], head: [0.2 * k, 0, 0], upperR: scale([-0.55, 0.1, 0.35], k), lowerR: scale([-1.5, 0.6, 0], k) };
    },
  },
} satisfies Record<string, Motion>;

export type CelebMotion = keyof typeof CELEB_MOTIONS;
