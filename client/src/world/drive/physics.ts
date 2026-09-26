// v7: how a car drives, as plain numbers: W and S (throttle, brake and reverse), A and D (steering,
// left +), Space (the handbrake), each car with its own top speed, pull and grip from what it is
// (its price and kind in items.ts, its size in the model kit). A bicycle model: the heading turns
// by the speed over the wheelbase times the steering's tangent, the steering easing toward the keys
// and turning less the faster it goes. Pure, so it's tested without a scene.
//
// Metres, seconds, radians; yaw as Object3D.rotation.y (0 faces +z).

import { CARS } from '../../../../shared/src/items.ts';

export interface CarState {
  x: number;
  z: number;
  yaw: number;
  /** Speed along the heading, m/s (negative reversing). */
  v: number;
  /** The front wheels' turn now, radians (left +). */
  steer: number;
}

export interface CarInput {
  /** -1 (brake / reverse) .. 1 (full throttle). */
  throttle: number;
  /** -1 (right) .. 1 (left). */
  steer: number;
  handbrake: boolean;
}

export interface Handling {
  top: number;
  accel: number;
  brake: number;
  reverse: number;
  /** The front wheels' furthest turn at a crawl (radians). */
  lock: number;
  wheelbase: number;
  /** How much of a turn it holds (1: all of it; the handbrake lets the back out). */
  grip: number;
}

/** A car's handling: the dearer it is the faster and the harder it pulls; big and tall ones less so. */
export function handlingOf(id: string, size: { wheelbase: number; height: number }): Handling {
  const i = Math.max(0, CARS.findIndex((c) => c.id === id));
  const k = CARS.length > 1 ? i / (CARS.length - 1) : 0.5;
  const heavy = size.height > 1.7 ? 0.8 : 1;
  return {
    top: (24 + 16 * k) * heavy,
    accel: (6.5 + 7 * k) * heavy,
    brake: 16,
    reverse: 7,
    lock: 0.58,
    wheelbase: Math.max(2, size.wheelbase),
    grip: heavy < 1 ? 0.9 : 1,
  };
}

/** One step of `dt` seconds. */
export function stepCar(s: CarState, input: CarInput, h: Handling, dt: number): void {
  const t = Math.max(-1, Math.min(1, input.throttle));
  // throttle, braking (against the way it's going), reverse from a standstill
  if (t > 0) {
    if (s.v < -0.3) s.v = Math.min(0, s.v + h.brake * dt);
    else s.v += h.accel * t * (1 - Math.max(0, s.v) / h.top) * dt * 1.6;
  } else if (t < 0) {
    if (s.v > 0.3) s.v = Math.max(0, s.v - h.brake * -t * dt);
    else s.v = Math.max(-h.reverse, s.v - h.accel * 0.6 * -t * dt);
  } else {
    // rolling resistance and the air: it coasts down
    const drag = 0.6 + 0.02 * s.v * s.v;
    s.v = s.v > 0 ? Math.max(0, s.v - drag * dt) : Math.min(0, s.v + drag * dt);
  }
  if (input.handbrake) s.v = s.v > 0 ? Math.max(0, s.v - 11 * dt) : Math.min(0, s.v + 11 * dt);
  s.v = Math.max(-h.reverse, Math.min(h.top, s.v));
  // the steering eases toward the keys, and turns less at speed
  const lock = h.lock / (1 + Math.abs(s.v) / 14);
  const want = Math.max(-1, Math.min(1, input.steer)) * lock;
  s.steer += (want - s.steer) * (1 - Math.exp(-dt * 7));
  const grip = input.handbrake ? h.grip * 1.45 : h.grip;
  s.yaw += ((s.v * Math.tan(s.steer)) / h.wheelbase) * grip * dt;
  s.x += Math.sin(s.yaw) * s.v * dt;
  s.z += Math.cos(s.yaw) * s.v * dt;
}

/** The speed shown on the dial, mph. */
export function mph(v: number): number {
  return Math.round(Math.abs(v) * 2.23694);
}
