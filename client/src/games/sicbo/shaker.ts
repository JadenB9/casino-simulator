// The automated shaker: three dice on a velvet bed under a glass dome, on a lacquered pedestal
// with a ring of lights. At "No more bets" the bed vibrates and the dice hop and tumble under the
// glass; then the shaking dies away and each die bounces to rest on the face the server rolled
// (faces.ts works out that rotation, and the tests check every face ends flat on top).
//
// All the motion runs on the shared tween clock, so a table that falls behind the server can
// snap it to its end like any other animation.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { Sfx } from '../../audio/sfx.ts';
import { tween, ease } from '../../table/tween.ts';
import { SicBoDie, DIE_SIZE, restQuaternion } from './art.ts';

export const SHAKER_NAME = 'sicbo-shaker';
/** Inside radius of the dome, and the height of the bed the dice rest on (shaker-local). */
export const DOME_R = 0.13;
export const BED_Y = 0.036;
const PEDESTAL_R = 0.165;

/** Where the three dice come to rest, before a little per-roll jitter: a loose triangle. */
const REST: [number, number][] = [[-0.033, 0.021], [0.035, 0.017], [0.001, -0.033]];

/** The shaker as it stands on the table, dice included. Its origin sits on the table top. */
export function buildShaker(quality: Quality): THREE.Group {
  const g = new THREE.Group();
  g.name = SHAKER_NAME;
  const lacquer = new THREE.MeshStandardMaterial({ color: '#16110e', roughness: 0.28, metalness: 0.25 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a24b', roughness: 0.28, metalness: 1 });
  const seg = quality === 'high' ? 64 : 36;

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(PEDESTAL_R, PEDESTAL_R + 0.01, BED_Y - 0.004, seg), lacquer);
  pedestal.position.y = (BED_Y - 0.004) / 2;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(PEDESTAL_R - 0.002, 0.0045, 10, seg), brass);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = BED_Y - 0.004;
  // a ring of lights around the bed, lit while the dice are in the air
  const leds = new THREE.Mesh(
    new THREE.RingGeometry(DOME_R + 0.006, DOME_R + 0.022, seg),
    new THREE.MeshStandardMaterial({ color: '#3a2a12', emissive: '#ffcf7a', emissiveIntensity: 0.25, roughness: 0.4 }),
  );
  leds.name = 'sicbo-leds';
  leds.rotation.x = -Math.PI / 2;
  leds.position.y = BED_Y - 0.0035;
  const bed = new THREE.Mesh(new THREE.CircleGeometry(DOME_R + 0.004, seg), new THREE.MeshStandardMaterial({ color: '#5e0f15', roughness: 0.95 }));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = BED_Y - 0.003;

  // the dome: a thin, almost clear shell that catches the light at its edges
  const dome = new THREE.Group();
  dome.name = 'sicbo-dome';
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_R, seg, Math.round(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: '#f4f7fa', roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
  );
  glass.renderOrder = 2;
  glass.position.y = BED_Y - 0.003;
  const band = new THREE.Mesh(new THREE.TorusGeometry(DOME_R + 0.002, 0.004, 10, seg), brass);
  band.rotation.x = Math.PI / 2;
  band.position.y = BED_Y - 0.001;
  dome.add(glass, band);

  g.add(pedestal, collar, leds, bed, dome);
  [2, 5, 6].forEach((face, i) => {
    const die = new SicBoDie();
    die.name = `sicbo-die-${i}`;
    die.position.set(REST[i]![0], BED_Y + DIE_SIZE / 2, REST[i]![1]);
    die.quaternion.copy(restQuaternion(face, i * 0.9 - 0.4));
    g.add(die);
  });
  return g;
}

/** A small repeatable generator, so every client lays the dice out the same way for a round. */
function jitter(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

/** Drives a shaker built by buildShaker (the station's own, or one the view adds). */
export class Shaker {
  readonly dice: THREE.Object3D[];
  private readonly dome: THREE.Object3D;
  private readonly leds: THREE.MeshStandardMaterial;
  rolling = false;

  constructor(readonly group: THREE.Object3D, private readonly sfx: Sfx) {
    this.dice = [0, 1, 2].map((i) => group.getObjectByName(`sicbo-die-${i}`)!);
    this.dome = group.getObjectByName('sicbo-dome')!;
    this.leds = (group.getObjectByName('sicbo-leds') as THREE.Mesh).material as THREE.MeshStandardMaterial;
  }

  /** Where die i rests for a round, and how it's turned: the same on every client. */
  private rest(i: number, round: number, face: number): { at: THREE.Vector3; q: THREE.Quaternion } {
    const r = jitter(round * 3 + i + 1);
    const [x, z] = REST[i]!;
    const at = new THREE.Vector3(x + (r() - 0.5) * 0.014, BED_Y + DIE_SIZE / 2, z + (r() - 0.5) * 0.014);
    return { at, q: restQuaternion(face, (r() - 0.5) * 2.6) };
  }

  /** Show a roll at rest, without animating (joining a table, a reconnect). */
  show(faces: readonly number[], round: number): void {
    this.dice.forEach((die, i) => {
      const { at, q } = this.rest(i, round, faces[i]!);
      die.position.copy(at);
      die.quaternion.copy(q);
    });
    this.dome.position.set(0, 0, 0);
    this.dome.rotation.set(0, 0, 0);
    this.leds.emissiveIntensity = 0.25;
  }

  /**
   * Shake for `shakeMs`, then settle over `settleMs` onto `faces`. Resolves when the dice are
   * still.
   */
  async roll(faces: readonly number[], round: number, shakeMs: number, settleMs: number): Promise<void> {
    this.rolling = true;
    const r = jitter(round * 7919 + 17);
    const T = shakeMs / 1000;
    const paths = this.dice.map((die, i) => {
      const hops = 4 + Math.floor(r() * 3) + (T > 2 ? 1 : 0);
      return {
        die,
        a0: (i * Math.PI * 2) / 3 + r() * 0.8,
        w: (2.4 + r() * 1.6) * (i % 2 ? -1 : 1),
        rr: 0.04 + r() * 0.012,
        wobble: 2 + r() * 3,
        phase: r() * 6,
        hop: hops / T,
        height: 0.035 + r() * 0.03,
        axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        spin: 14 + r() * 10,
        q0: die.quaternion.clone(),
      };
    });
    this.sfx.play('dice-shake', { volume: 0.55, rate: 1.1 });
    if (T > 1.6) this.sfx.play('dice-shake', { volume: 0.45, rate: 1.2, delay: 1.0 });
    const turn = new THREE.Quaternion();
    await tween(shakeMs, (k) => {
      const t = k * T;
      // the vibration builds for a moment and fades away at the end
      const env = Math.min(1, t / 0.25) * Math.min(1, (T - t) / 0.35 + 0.2);
      for (const p of paths) {
        const a = p.a0 + p.w * t;
        const rad = p.rr + 0.012 * Math.sin(p.wobble * t + p.phase);
        const h = p.height * env * Math.abs(Math.sin(Math.PI * p.hop * t));
        p.die.position.set(Math.cos(a) * rad, BED_Y + DIE_SIZE / 2 + h, Math.sin(a) * rad);
        p.die.quaternion.copy(p.q0).multiply(turn.setFromAxisAngle(p.axis, p.spin * t));
      }
      this.dome.position.y = 0.0012 * env * Math.sin(t * Math.PI * 2 * 15);
      this.dome.rotation.z = 0.006 * env * Math.sin(t * Math.PI * 2 * 9);
      this.leds.emissiveIntensity = 0.25 + 1.9 * env * (0.75 + 0.25 * Math.sin(t * 40));
    }, ease.linear);
    this.dome.position.set(0, 0, 0);
    this.dome.rotation.set(0, 0, 0);

    // the vibration stops and each die bounces to rest on its face
    this.sfx.play('dice-throw', { volume: 0.3, rate: 1.5 });
    this.sfx.play('dice-throw', { volume: 0.22, rate: 1.7, delay: 0.25 });
    const glow = tween(settleMs, (k) => (this.leds.emissiveIntensity = 0.25 + 1.2 * (1 - k)), ease.out);
    await Promise.all([glow, ...this.dice.map((die, i) => this.settle(die, this.rest(i, round, faces[i]!), settleMs - i * 90, [1, -1, 0.7][i]!))]);
    this.rolling = false;
  }

  /** Two or three shrinking hops from where the shake left the die, turning onto its face on the last. */
  private settle(die: THREE.Object3D, to: { at: THREE.Vector3; q: THREE.Quaternion }, ms: number, spin: number): Promise<void> {
    const from = die.position.clone().setY(to.at.y);
    const q0 = die.quaternion.clone();
    const tumble = q0.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(5 * spin, 2.5, 3.5 * spin)));
    const q = new THREE.Quaternion();
    return tween(ms, (k) => {
      die.position.lerpVectors(from, to.at, k);
      die.position.y = to.at.y + Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) ** 1.4 * 0.05;
      q.copy(q0).slerp(tumble, Math.min(1, k * 1.6));
      die.quaternion.copy(k < 0.6 ? q : q.slerp(to.q, (k - 0.6) / 0.4));
      if (k >= 1) die.quaternion.copy(to.q);
    }, ease.out);
  }
}
