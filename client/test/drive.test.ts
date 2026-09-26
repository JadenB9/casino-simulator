import { describe, expect, it } from 'vitest';
import { handlingOf, mph, stepCar, type CarState } from '../src/world/drive/physics.ts';

const h = handlingOf('raffica-v10', { wheelbase: 2.65, height: 1.2 });

function run(s: CarState, input: { throttle: number; steer: number; handbrake: boolean }, secs: number): void {
  for (let t = 0; t < secs; t += 1 / 60) stepCar(s, input, h, 1 / 60);
}

describe('driving', () => {
  it('pulls away, tops out, and coasts down', () => {
    const s: CarState = { x: 0, z: 0, yaw: 0, v: 0, steer: 0 };
    run(s, { throttle: 1, steer: 0, handbrake: false }, 2);
    expect(s.v).toBeGreaterThan(8);
    expect(s.z).toBeGreaterThan(5);
    run(s, { throttle: 1, steer: 0, handbrake: false }, 20);
    expect(s.v).toBeLessThanOrEqual(h.top + 1e-9);
    expect(s.v).toBeGreaterThan(h.top * 0.9);
    const top = s.v;
    run(s, { throttle: 0, steer: 0, handbrake: false }, 3);
    expect(s.v).toBeLessThan(top);
    expect(s.x).toBeCloseTo(0);
  });

  it('brakes to a stop, then reverses', () => {
    const s: CarState = { x: 0, z: 0, yaw: 0, v: 20, steer: 0 };
    run(s, { throttle: -1, steer: 0, handbrake: false }, 1.5);
    expect(s.v).toBeLessThanOrEqual(0.3);
    run(s, { throttle: -1, steer: 0, handbrake: false }, 3);
    expect(s.v).toBeLessThan(-3);
    expect(s.v).toBeGreaterThanOrEqual(-h.reverse);
  });

  it('turns left with A (yaw up) and right with D', () => {
    const l: CarState = { x: 0, z: 0, yaw: 0, v: 10, steer: 0 };
    run(l, { throttle: 0.3, steer: 1, handbrake: false }, 1);
    expect(l.yaw).toBeGreaterThan(0.3);
    expect(l.x).toBeGreaterThan(0);
    const r: CarState = { x: 0, z: 0, yaw: 0, v: 10, steer: 0 };
    run(r, { throttle: 0.3, steer: -1, handbrake: false }, 1);
    expect(r.yaw).toBeLessThan(-0.3);
  });

  it('never turns standing still, and reads in mph', () => {
    const s: CarState = { x: 0, z: 0, yaw: 0, v: 0, steer: 0 };
    run(s, { throttle: 0, steer: 1, handbrake: false }, 1);
    expect(s.yaw).toBe(0);
    expect(mph(26.8)).toBe(60);
  });

  it('gives dearer cars more speed', () => {
    const cheap = handlingOf('halden-roadster', { wheelbase: 2.3, height: 1.1 });
    const dear = handlingOf('ombra-oro', { wheelbase: 2.75, height: 1.1 });
    expect(dear.top).toBeGreaterThan(cheap.top);
    expect(dear.top).toBeLessThanOrEqual(40);
  });
});
