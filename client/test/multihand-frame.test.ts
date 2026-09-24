import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Pose } from '../src/table/stage.ts';
import { fitWidth } from '../src/games/multihand/frame.ts';
import { fovFor } from '../src/render/engine3d.ts';
import * as BJ from '../src/games/blackjack/layout.ts';
import * as TC from '../src/games/threecard/layout.ts';
import * as WR from '../src/games/war/layout.ts';

// The camera for a solo player on several spots has to take in every one of them, on a laptop and
// on a phone held upright (which sees about half as wide). Each case puts a camera at the pose,
// projects the outer spots' cards and bets, and checks they land on the screen.

const LAPTOP = 1280 / 800;
const PHONE = 390 / 844;

function cameraAt(pose: Pose, aspect: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(fovFor(aspect), aspect, 0.05, 50);
  c.position.set(...pose.position);
  c.lookAt(new THREE.Vector3(...pose.target));
  c.updateMatrixWorld();
  return c;
}

/** Whether a table point is on the screen, with a margin (in normalised device units). */
function onScreen(c: THREE.PerspectiveCamera, p: THREE.Vector3, margin = 0.02): boolean {
  const q = p.clone().project(c);
  return q.z < 1 && Math.abs(q.x) <= 1 - margin && Math.abs(q.y) <= 1 - margin;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('framing several spots', () => {
  it('fitWidth leaves a pose that already fits alone, and otherwise backs off along its own line of sight', () => {
    const pose: Pose = { position: [0, 1.4, 0.8], target: [0, 0.78, 0] };
    expect(fitWidth(pose, 0.3, LAPTOP)).toEqual(pose);
    const wide = fitWidth(pose, 0.6, PHONE);
    expect(wide.target).toEqual(pose.target);
    const target = new THREE.Vector3(...pose.target);
    const was = new THREE.Vector3(...pose.position).sub(target);
    const now = new THREE.Vector3(...wide.position).sub(target);
    expect(now.length()).toBeGreaterThan(was.length());
    expect(now.clone().normalize().distanceTo(was.clone().normalize())).toBeLessThan(1e-9);
    // at the new distance exactly 0.6 m either side of the target fits across the screen
    const across = Math.tan(THREE.MathUtils.degToRad(fovFor(PHONE)) / 2) * PHONE;
    expect(now.length() * across).toBeCloseTo(0.6, 9);
  });

  for (const [aspect, screen] of [[LAPTOP, 'a laptop'], [PHONE, 'a phone held upright']] as const) {
    it(`blackjack: every circle of two to five, with its cards, is on ${screen}`, () => {
      for (let n = 2; n <= 5; n++) {
        const spots = range(n);
        const c = cameraAt(BJ.spotsPose(spots, aspect), aspect);
        for (const s of spots) {
          expect(onScreen(c, BJ.spotAt(s)), `circle of spot ${s}, ${n} spots`).toBe(true);
          expect(onScreen(c, BJ.handCard(s, 0, 1, 2, false).pos), `cards of spot ${s}, ${n} spots`).toBe(true);
        }
      }
    });

    it(`Three Card Poker and Casino War: every hand's spots and cards are on ${screen}`, () => {
      for (let n = 2; n <= 3; n++) {
        const spots = range(n);
        const tc = cameraAt(TC.spotsPose(spots, aspect), aspect);
        const wr = cameraAt(WR.spotsPose(spots, aspect), aspect);
        for (const s of spots) {
          for (const kind of ['pairPlus', 'ante', 'play'] as const) expect(onScreen(tc, TC.spotPoint(s, kind)), `3CP ${kind} ${s}/${n}`).toBe(true);
          for (const i of [0, 2]) expect(onScreen(tc, TC.handSlot(s, i).pos), `3CP card ${i} of ${s}/${n}`).toBe(true);
          for (const kind of ['tie', 'bet', 'war'] as const) expect(onScreen(wr, WR.spotPoint(s, kind)), `War ${kind} ${s}/${n}`).toBe(true);
          expect(onScreen(wr, WR.cardSlot(s, false).pos), `War card of ${s}/${n}`).toBe(true);
        }
      }
    });
  }

  it('one spot keeps the seat pose it always had', () => {
    expect(BJ.spotsPose([0], PHONE)).toEqual(BJ.seatPose(0));
    expect(TC.spotsPose([0], PHONE)).toEqual(TC.cameraPose(0));
    expect(WR.spotsPose([0], PHONE)).toEqual(WR.cameraPose(0));
  });
});
