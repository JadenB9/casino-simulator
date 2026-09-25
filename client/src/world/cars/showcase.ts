// A short camera move to show something off, the way sitting down at a table flies the camera in:
// your car pulling up at the curb after you call it, and your best car as you walk into your
// garage. The walker is held still while it plays (any movement key, Esc or a panel opening ends
// it at once), and at the end the camera eases back to where the follow camera wants it rather
// than jumping there.

import * as THREE from 'three';
import { overlayCount } from '../../ui/keyboard.ts';

export interface Shot {
  /** Where the camera stands and what it looks at, each frame (the target can move: a car driving up). */
  from(t: number): THREE.Vector3;
  at(t: number): THREE.Vector3;
  /** Seconds, or a test that says it's done. */
  secs: number;
  done?(): boolean;
}

/** The walker, as far as the show needs it. */
export interface Walker {
  setEnabled(on: boolean): void;
}

const EASE_IN = 0.9;
const EASE_OUT = 0.7;
const STOP_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Space']);

export class Showcase {
  private shot: Shot | null = null;
  private t = 0;
  /** Easing back to the follow camera: time left, and where the show left the camera. */
  private back = 0;
  private readonly start = new THREE.Vector3();
  private readonly startQ = new THREE.Quaternion();
  private readonly endQ = new THREE.Quaternion();
  private readonly look = new THREE.Vector3();
  // (a camera, so lookAt points its -z at the target, as the real camera looks)
  private readonly tmp = new THREE.PerspectiveCamera();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly walker: Walker,
    /** Whether the walker is out walking (not at a table, not in a panel): a show only starts then. */
    private readonly free: () => boolean,
  ) {
    addEventListener('keydown', this.onKey);
  }

  get playing(): boolean {
    return this.shot !== null;
  }

  play(shot: Shot): boolean {
    if (this.shot || !this.free()) return false;
    this.shot = shot;
    this.t = 0;
    this.back = 0;
    this.start.copy(this.camera.position);
    this.startQ.copy(this.camera.quaternion);
    this.walker.setEnabled(false);
    return true;
  }

  stop(): void {
    if (!this.shot) return;
    this.shot = null;
    this.back = EASE_OUT;
    this.start.copy(this.camera.position);
    this.startQ.copy(this.camera.quaternion);
    // a panel that opened meanwhile holds the walker itself
    if (overlayCount() === 0) this.walker.setEnabled(true);
  }

  /** After the world's update: the show's camera, or the ease back to the follow camera. */
  update(dt: number): void {
    const s = this.shot;
    if (s) {
      if (overlayCount() > 0) {
        this.shot = null;
        return;
      }
      this.t += dt;
      const pos = s.from(this.t);
      this.look.copy(s.at(this.t));
      this.tmp.position.copy(pos);
      this.tmp.lookAt(this.look);
      // ease in from wherever the camera was
      const k = smooth(Math.min(1, this.t / EASE_IN));
      this.camera.position.lerpVectors(this.start, pos, k);
      this.camera.quaternion.slerpQuaternions(this.startQ, this.tmp.quaternion, k);
      if (this.t >= s.secs || s.done?.()) this.stop();
      return;
    }
    if (this.back > 0) {
      // the follow camera has already placed itself this frame: come to it from where the show left off
      this.back = Math.max(0, this.back - dt);
      const k = smooth(1 - this.back / EASE_OUT);
      this.endQ.copy(this.camera.quaternion);
      this.camera.position.lerpVectors(this.start, this.camera.position, k);
      this.camera.quaternion.slerpQuaternions(this.startQ, this.endQ, k);
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.shot && STOP_KEYS.has(e.code)) this.stop();
  };

  dispose(): void {
    removeEventListener('keydown', this.onKey);
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
