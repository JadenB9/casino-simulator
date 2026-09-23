import { describe, it, expect } from 'vitest';
import { FACE_ORDER, faceNormal, faceUp, restRotation, topFace, rotate, mul, type Quat } from '../../client/src/games/sicbo/faces.ts';

// The shaker lands each die on the face the server rolled. These check the rotation it lands on:
// every face ends flat on top whatever the spin, and the dice are built like real ones.

describe('sic bo dice orientation', () => {
  it('numbers the faces so opposite sides add up to 7', () => {
    expect([...FACE_ORDER].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (let f = 1; f <= 6; f++) {
      const n = faceNormal(f);
      const o = faceNormal(7 - f);
      expect(n.map((v, i) => v + o[i]!)).toEqual([0, 0, 0]);
    }
  });

  it('puts every face flat on top, at any spin about the vertical', () => {
    for (let f = 1; f <= 6; f++) {
      expect(topFace(faceUp(f))).toEqual({ face: f, up: expect.closeTo(1, 12) });
      for (let k = 0; k < 64; k++) {
        const yaw = (k / 64) * Math.PI * 2 - Math.PI + 0.013;
        const q = restRotation(f, yaw);
        expect(Math.hypot(...q)).toBeCloseTo(1, 12);
        const top = topFace(q);
        expect(top.face, `face ${f} yaw ${yaw.toFixed(3)}`).toBe(f);
        expect(top.up).toBeCloseTo(1, 12);
      }
    }
  });

  it('spins about the vertical after the face is up, not before', () => {
    // the other order (spin about the die's own axis, then turn the face up) tips faces 2-5 over
    const yaw = 1.3;
    const spinFirst = (f: number) => mul(faceUp(f), [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as Quat);
    expect(topFace(spinFirst(2)).up).toBeLessThan(0.97);
    expect(topFace(restRotation(2, yaw)).up).toBeCloseTo(1, 12);
  });

  it('turns vectors the way a rotation should', () => {
    const quarter: Quat = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]; // 90 degrees about +y
    const v = rotate(quarter, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[2]).toBeCloseTo(-1, 12);
  });
});
