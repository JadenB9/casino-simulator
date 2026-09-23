// Walking the floor: WASD or the arrow keys move relative to the camera, Shift runs. The
// character turns to face where it walks. A click on the floor captures the mouse (Pointer Lock)
// and moving it then turns the camera, walking or not, so W always walks where you look; Esc lets
// it go. A press that drags looks around without capture, for anyone who'd rather keep the
// cursor. With the mouse left alone for a few seconds (and not captured) the follow camera swings
// back in behind the walker, lazily, so a held A or D walks a wide circle, not a spin. Wheel zooms.
// The walker is a circle pushed out of the floor's boxes and posts; the camera backs off the
// player's head along a ray and pulls in wherever that ray would enter a wall, column or bank.

import * as THREE from 'three';
import { isTyping, onOverlayChange, overlayCount } from '../ui/keyboard.ts';
import type { Character } from './contract.ts';
import type { Collider } from './collision.ts';
import { CEILING, PIT_CEILING, inRect, type Rect } from './layout.ts';
import { clampSensitivity, loadMouse, saveMouse, type MouseSettings } from './mouse.ts';

const RADIUS = 0.3;
// A brisk default pace (the floor is 40 m across), and Shift for a run.
const WALK = 2.6;
const RUN = 4.8;
/** The speeds the walk and run cycles were made for; the blend between them follows these. */
const WALK_CYCLE = 1.75;
const RUN_CYCLE = 3.9;
const EYE = 1.5;
/** Radians per pixel: dragging (a hand on the button covers less ground), and captured. */
const DRAG_YAW = 0.0055;
const DRAG_PITCH = 0.004;
const LOCK_RATE = 0.0024;
/** Camera pitch: a little below the head (to look up at the wheel and the chandeliers) to high above. */
const PITCH_MIN = -0.3;
const PITCH_MAX = 1.1;
/** Seconds without mouse input before the follow camera swings back behind the walker. */
const RECENTER_AFTER = 3;
/** A press that travels less than this (px) is a click, which captures the mouse. */
const CLICK_SLOP = 5;
/** Some browsers report a jump of hundreds of pixels on the first captured move; ignore those. */
const MAX_STEP = 250;
/** The camera never goes lower than this over the floor. */
const CAM_FLOOR = 0.3;

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
  private drag: { id: number; x: number; y: number; x0: number; y0: number; moved: boolean; mouse: boolean } | null = null;
  private locked = false;
  private mouse: MouseSettings = loadMouse();
  private readonly offOverlay: () => void;
  private readonly target = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    readonly character: Character,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly col: Collider,
    private readonly pit: Rect,
    private readonly canvas: HTMLElement,
    /** Extra say on whether a click may capture the mouse (the app's panels over the floor). */
    private readonly mayCapture: () => boolean = () => true,
  ) {
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    // before anything else hears it: Esc while captured only lets the mouse go
    addEventListener('keydown', this.onEscape, true);
    addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onLockChange);
    // a sheet, dialog or the editor coming up needs the cursor
    this.offOverlay = onOverlayChange((n) => n > 0 && this.release());
  }

  /** True while the mouse is captured for looking around. */
  get captured(): boolean {
    return this.locked;
  }

  /** Mouse sensitivity (1 = default) and whether a click captures the mouse; saved for next time. */
  get mouseSettings(): MouseSettings {
    return { ...this.mouse };
  }

  setMouse(o: Partial<MouseSettings>): void {
    this.mouse = {
      sensitivity: clampSensitivity(o.sensitivity ?? this.mouse.sensitivity),
      capture: o.capture ?? this.mouse.capture,
    };
    saveMouse(this.mouse);
    if (!this.mouse.capture) this.release();
  }

  /** Let the mouse go (a table, a panel or the app taking over). */
  release(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
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
    if (!on) this.release();
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
      // The camera drifts round behind the walker only once the mouse has been left alone for a
      // while, and never while it's captured: then the mouse alone steers.
      if (!this.locked && this.clock - this.manualAt > RECENTER_AFTER && iz >= 0) this.camYaw = turn(this.camYaw, this.heading + Math.PI, 1 - Math.exp(-dt * 1.4));
    }
    this.speed = moved;
    const motion = moved < 0.05 ? 0 : moved <= WALK_CYCLE ? moved / WALK_CYCLE : Math.min(2, 1 + (moved - WALK_CYCLE) / (RUN_CYCLE - WALK_CYCLE));
    this.character.setMotion(motion);
    this.syncCharacter();
    this.placeCamera(dt);
  }

  dispose(): void {
    this.release();
    this.offOverlay();
    document.removeEventListener('pointerlockchange', this.onLockChange);
    removeEventListener('keydown', this.onEscape, true);
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
    this.want.y = Math.max(CAM_FLOOR, Math.min(this.want.y, ceiling - 0.2));
    this.lastAllowed = allowed;
  }

  private lastAllowed = 3.3;

  private placeCamera(dt: number): void {
    this.computeCamera();
    // pull in fast when blocked, ease back out when clear
    const d = this.lastAllowed;
    this.dist += (d - this.dist) * (1 - Math.exp(-dt * (d < this.dist ? 22 : 3)));
    const pos = this.target.clone().addScaledVector(this.dir, this.dist);
    pos.y = Math.max(CAM_FLOOR, Math.min(pos.y, this.want.y));
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
    if (!this.enabled || e.button !== 0 || this.locked) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, mouse: e.pointerType === 'mouse' };
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.locked) {
      if (!this.enabled) return;
      const k = LOCK_RATE * this.mouse.sensitivity;
      this.look(clampStep(e.movementX) * k, clampStep(e.movementY) * k);
      return;
    }
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const d = this.drag;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > CLICK_SLOP) d.moved = true;
    const k = this.mouse.sensitivity;
    this.look(dx * DRAG_YAW * k, dy * DRAG_PITCH * k);
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    // a click (not a drag) with the mouse on the floor view: capture it for looking around
    if (e.type === 'pointerup' && !d.moved && d.mouse && this.canCapture()) this.capture();
  };

  /** Turn the camera: yaw right for +dx, look down for +dy, pitch clamped. */
  private look(dx: number, dy: number): void {
    this.camYaw -= dx;
    this.camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.camPitch + dy));
    this.manualAt = this.clock;
  }

  private canCapture(): boolean {
    return this.mouse.capture && this.enabled && overlayCount() === 0 && this.mayCapture() && typeof this.canvas.requestPointerLock === 'function';
  }

  private capture(): void {
    try {
      // A promise in Chrome (it rejects if the user let go with Esc a moment ago), nothing elsewhere.
      const r = this.canvas.requestPointerLock() as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* not allowed right now; the next click tries again */
    }
  }

  private onLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    this.drag = null;
    // Either way the camera stays where the mouse left it for a while.
    this.manualAt = this.clock;
    // Captured behind a panel that came up in the meantime: let go again.
    if (locked && !this.canCapture()) this.release();
  };

  private onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.locked) return;
    // The browser lets the mouse go; nothing else should also act on this Esc.
    e.preventDefault();
    e.stopImmediatePropagation();
    this.release();
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    this.camDist = Math.max(1.6, Math.min(6, this.camDist + Math.sign(e.deltaY) * 0.35));
  };
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

function clampStep(px: number): number {
  return Number.isFinite(px) && Math.abs(px) <= MAX_STEP ? px : 0;
}

/** Step angle `a` toward `b` by fraction k, the short way round. */
function turn(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
