// Walking the floor: WASD or the arrow keys move relative to the camera, Shift runs. The
// character turns to face where it walks and the follow camera swings in behind it (lazily, so a
// held A or D walks a wide circle, not a spin). Drag with the mouse to look around, wheel to zoom.
// The walker is a circle pushed out of the floor's boxes and posts; the camera backs off the
// player's head along a ray and pulls in wherever that ray would enter a wall, column or bank.

import * as THREE from 'three';
import { isTyping } from '../ui/keyboard.ts';
import type { Character } from './contract.ts';
import type { Collider } from './collision.ts';
import { CEILING, PIT_CEILING, inRect, type Rect } from './layout.ts';

const RADIUS = 0.3;
const WALK = 1.75;
const RUN = 3.9;
const EYE = 1.5;

export class Player {
  readonly position = new THREE.Vector3();
  heading = Math.PI;
  /** Ground speed this frame, m/s. */
  speed = 0;
  camYaw = 0;
  camPitch = 0.26;
  camDist = 3.3;
  private enabled = true;
  private vel = new THREE.Vector2();
  private keys = new Set<string>();
  private manualAt = -10;
  private clock = 0;
  private dist = 3.3;
  private drag: { id: number; x: number; y: number } | null = null;
  private readonly target = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    readonly character: Character,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly col: Collider,
    private readonly pit: Rect,
    private readonly canvas: HTMLElement,
  ) {
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  /** Place the player (and snap the camera behind them). */
  spawn(x: number, z: number, heading: number): void {
    this.position.set(x, 0, z);
    this.heading = heading;
    this.camYaw = heading + Math.PI;
    this.vel.set(0, 0);
    this.dist = this.camDist;
    this.syncCharacter();
    this.placeCamera(1);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.keys.clear();
    this.vel.set(0, 0);
    this.speed = 0;
    this.drag = null;
    this.character.setMotion(0);
  }

  /** Where the follow camera would be right now (for flying back from a table). */
  followPose(): { position: THREE.Vector3; target: THREE.Vector3 } {
    this.computeCamera();
    return { position: this.want.clone(), target: this.target.clone() };
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.enabled) return;
    // input, relative to the camera's heading
    let ix = 0;
    let iz = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) iz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const s = Math.sin(this.camYaw);
    const c = Math.cos(this.camYaw);
    let mx = -s * iz + c * ix;
    let mz = -c * iz - s * ix;
    const len = Math.hypot(mx, mz);
    const speed = len > 0 ? (run ? RUN : WALK) : 0;
    if (len > 0) {
      mx /= len;
      mz /= len;
    }
    const a = 1 - Math.exp(-dt * (len > 0 ? 9 : 12));
    this.vel.x += (mx * speed - this.vel.x) * a;
    this.vel.y += (mz * speed - this.vel.y) * a;
    const p = { x: this.position.x + this.vel.x * dt, z: this.position.z + this.vel.y * dt };
    this.col.resolve(p, RADIUS);
    // speed actually achieved (sliding along a wall is slower than pushing into it)
    const moved = Math.hypot(p.x - this.position.x, p.z - this.position.z) / Math.max(dt, 1e-4);
    this.position.x = p.x;
    this.position.z = p.z;
    if (len > 0) {
      const want = Math.atan2(mx, mz);
      this.heading = turn(this.heading, want, 1 - Math.exp(-dt * 12));
      // the camera drifts round behind the walker unless the mouse has been steering it
      if (this.clock - this.manualAt > 1.5 && iz >= 0) this.camYaw = turn(this.camYaw, this.heading + Math.PI, 1 - Math.exp(-dt * 1.4));
    }
    this.speed = moved;
    const motion = moved < 0.05 ? 0 : moved <= WALK ? moved / WALK : 1 + (moved - WALK) / (RUN - WALK);
    this.character.setMotion(motion);
    this.syncCharacter();
    this.placeCamera(dt);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private syncCharacter(): void {
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.heading;
  }

  private computeCamera(): void {
    this.target.set(this.position.x, EYE, this.position.z);
    const cp = Math.cos(this.camPitch);
    this.dir.set(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);
    // back off along the ray until something solid is in the way
    const hit = this.col.raycast(this.target, this.dir, this.camDist + 0.3) - 0.3;
    const allowed = Math.max(0.45, Math.min(this.camDist, hit));
    this.want.copy(this.target).addScaledVector(this.dir, allowed);
    const ceiling = inRect(this.pit, this.want.x, this.want.z, -0.3) ? PIT_CEILING : CEILING;
    this.want.y = Math.min(this.want.y, ceiling - 0.2);
    this.lastAllowed = allowed;
  }

  private lastAllowed = 3.3;

  private placeCamera(dt: number): void {
    this.computeCamera();
    // pull in fast when blocked, ease back out when clear
    const d = this.lastAllowed;
    this.dist += (d - this.dist) * (1 - Math.exp(-dt * (d < this.dist ? 22 : 3)));
    const pos = this.target.clone().addScaledVector(this.dir, this.dist);
    pos.y = Math.min(pos.y, this.want.y);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target.x, this.target.y - 0.12, this.target.z);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (isTyping(e)) return;
    if (e.type === 'keydown') {
      if (!this.enabled) return;
      if (MOVE_KEYS.has(e.code)) {
        this.keys.add(e.code);
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
    } else {
      this.keys.delete(e.code);
    }
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || e.button !== 0) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.camYaw -= dx * 0.0055;
    this.camPitch = Math.max(-0.15, Math.min(1.1, this.camPitch + dy * 0.004));
    this.manualAt = this.clock;
  };

  private onUp = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.id) this.drag = null;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    this.camDist = Math.max(1.6, Math.min(6, this.camDist + Math.sign(e.deltaY) * 0.35));
  };
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

/** Step angle `a` toward `b` by fraction k, the short way round. */
function turn(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
