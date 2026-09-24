// Walking the floor: WASD or the arrow keys move relative to the camera, Shift runs. The
// character turns to face where it walks. On the floor the mouse is held (Pointer Lock): moving it
// turns the camera, walking or not, so W always walks where you look. Entering the floor takes the
// mouse at once (the click on Enter Casino is the gesture the browser asks for), and so does
// standing up from a table. Esc frees the cursor; a click on the floor takes it back. Tables,
// menus, sheets and the chat line need the cursor, so the mouse is let go while any of those is up,
// and one that took it gives it back when it closes. With the lock turned off in Settings, a press
// that drags looks around instead. With the mouse left alone for a few seconds (and not held) the
// follow camera swings back in behind the walker, lazily, so a held A or D walks a wide circle,
// not a spin. Wheel zooms.
// The walker is a circle pushed out of the floor's boxes and posts; the camera backs off the
// player's head along a ray and pulls in wherever that ray would enter a wall, column or bank.

import * as THREE from 'three';
import { isTyping, onOverlayChange, overlayCount } from '../ui/keyboard.ts';
import type { Character } from './contract.ts';
import type { Collider } from './collision.ts';

import { loadMouse, onMouseChange, setMouseSettings, type MouseSettings } from './mouse.ts';

const RADIUS = 0.3;
// A brisk default pace (the floor is 40 m across), and Shift for a run.
const WALK = 2.6;
const RUN = 4.8;
/** The speeds the walk and run cycles were made for; the blend between them follows these. */
const WALK_CYCLE = 1.75;
const RUN_CYCLE = 3.9;
const EYE = 1.5;
/** Radians per pixel: dragging (a hand on the button covers less ground), and held. */
const DRAG_YAW = 0.0055;
const DRAG_PITCH = 0.004;
const LOCK_RATE = 0.0024;
/** Camera pitch: a little below the head (to look up at the wheel and the chandeliers) to high above. */
const PITCH_MIN = -0.3;
const PITCH_MAX = 1.1;
/** Seconds without mouse input before the follow camera swings back behind the walker. */
const RECENTER_AFTER = 3;
/** A press that travels less than this (px) is a click, which takes the mouse. */
const CLICK_SLOP = 5;
/** Some browsers report a jump of hundreds of pixels on the first held move; ignore those. */
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
  /** The mouse was let go for an overlay or typing, and is taken back when that's done. */
  private lent = false;
  private mouse: MouseSettings = loadMouse();
  private readonly offOverlay: () => void;
  private readonly offMouse: () => void;
  private focusTimer = 0;
  private readonly target = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    readonly character: Character,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly col: Collider,
    /** The ceiling's height over a point (rooms differ; the pit's coffers stand higher). */
    private readonly ceilingAt: (x: number, z: number) => number,
    private readonly canvas: HTMLElement,
    /** Extra say on whether the mouse may be held (the app's panels over the floor). */
    private readonly mayCapture: () => boolean = () => true,
  ) {
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    // before anything else hears it: Esc while the mouse is held only lets it go
    addEventListener('keydown', this.onEscape, true);
    addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onLockChange);
    // a sheet, dialog or the editor needs the cursor; one that took it gives it back
    this.offOverlay = onOverlayChange(this.onOverlay);
    // so does typing (the chat line)
    document.addEventListener('focusin', this.onFocus);
    document.addEventListener('focusout', this.onFocus);
    // the Settings sheet changes these while the floor is up
    this.offMouse = onMouseChange((m) => {
      this.mouse = m;
      if (!m.capture) {
        this.lent = false;
        this.release();
      }
    });
  }

  /** True while the mouse is held for looking around. */
  get captured(): boolean {
    return this.locked;
  }

  /**
   * True when the floor would like the mouse and a click would give it: walking about, the lock
   * on in Settings, nothing over the floor, and not held right now (after Esc, say).
   */
  get awaitingClick(): boolean {
    return !this.locked && this.canCapture();
  }

  /** Mouse sensitivity (1 = default) and whether the floor holds the mouse; saved for next time. */
  get mouseSettings(): MouseSettings {
    return { ...this.mouse };
  }

  setMouse(o: Partial<MouseSettings>): void {
    setMouseSettings(o);
  }

  /** Let the mouse go (a table, a panel or the app taking over); a click on the floor takes it back. */
  release(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /**
   * Take the mouse, if the floor may. Browsers only allow it straight after a click or key press
   * (or after the page itself let go); when refused, the next click on the floor takes it.
   */
  capture(): void {
    if (this.locked || !this.canCapture()) return;
    try {
      // A promise in Chrome (it rejects without a gesture, or straight after an Esc), nothing elsewhere.
      const r = this.canvas.requestPointerLock() as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* not allowed right now; the next click tries again */
    }
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

  /**
   * Hand the controls over (a table, a menu) or back. Back on the floor the mouse is taken again
   * straight away: entering from the menu or standing up from a table.
   */
  setEnabled(on: boolean): void {
    const was = this.enabled;
    this.enabled = on;
    this.keys.clear();
    this.vel.set(0, 0);
    this.speed = 0;
    this.drag = null;
    this.character.setMotion(0);
    if (!on) {
      this.lent = false;
      this.release();
    } else if (!was) {
      this.capture();
    }
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
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    // the on-screen stick (see the input API below), when no movement key is down
    let pace = 1;
    if (ix === 0 && iz === 0 && this.stickPace > 0) {
      ix = this.stick.x;
      iz = this.stick.y;
      pace = this.stickPace;
      run = this.stickRun;
    }
    const s = Math.sin(this.camYaw);
    const c = Math.cos(this.camYaw);
    let mx = -s * iz + c * ix;
    let mz = -c * iz - s * ix;
    const len = Math.hypot(mx, mz);
    const speed = len > 0 ? (run ? RUN : WALK * pace) : 0;
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
      // while, and never while it's held: then the mouse alone steers.
      if (!this.locked && this.clock - this.manualAt > RECENTER_AFTER && iz >= 0) this.camYaw = turn(this.camYaw, this.heading + Math.PI, 1 - Math.exp(-dt * 1.4));
    }
    this.speed = moved;
    const motion = moved < 0.05 ? 0 : moved <= WALK_CYCLE ? moved / WALK_CYCLE : Math.min(2, 1 + (moved - WALK_CYCLE) / (RUN_CYCLE - WALK_CYCLE));
    this.character.setMotion(motion);
    this.syncCharacter();
    this.placeCamera(dt);
  }

  // --- input API for the touch controls (world/touch.ts) ----------------------------------------
  // The on-screen stick and drag-to-look feed the same walk and camera as the keys and the mouse.

  private readonly stick = new THREE.Vector2();
  /** How far the stick is pushed, 0..1 of a walk; 0 when it's let go. */
  private stickPace = 0;
  private stickRun = false;

  /**
   * The stick: x to the right, y forward, relative to the camera like WASD. The length (clamped to
   * 1) is the pace, from a creep up to a walk; `run` is a full run. (0, 0) lets go. A movement key
   * held at the same time wins.
   */
  setMoveInput(x: number, y: number, run = false): void {
    const len = Math.hypot(x, y);
    if (!(len > 0)) {
      this.stick.set(0, 0);
      this.stickPace = 0;
      this.stickRun = false;
      return;
    }
    this.stick.set(x / len, y / len);
    this.stickPace = Math.min(1, len);
    this.stickRun = run;
  }

  /** A touch drag turning the camera, in radians: +dx turns right, +dy looks down. */
  addLook(dx: number, dy: number): void {
    if (!this.enabled || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.look(dx, dy);
  }

  // ------------------------------------------------------------------------------------------------

  dispose(): void {
    this.release();
    this.offOverlay();
    this.offMouse();
    clearTimeout(this.focusTimer);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('focusin', this.onFocus);
    document.removeEventListener('focusout', this.onFocus);
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
    const ceiling = Math.min(this.ceilingAt(this.want.x, this.want.z), this.ceilingAt(this.target.x, this.target.z));
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
    // a click (not a drag) with the mouse on the floor view: hold it for looking around
    if (e.type === 'pointerup' && !d.moved && d.mouse) this.capture();
  };

  /** Turn the camera: yaw right for +dx, look down for +dy, pitch clamped. */
  private look(dx: number, dy: number): void {
    this.camYaw -= dx;
    this.camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.camPitch + dy));
    this.manualAt = this.clock;
  }

  private canCapture(): boolean {
    return this.mouse.capture && this.enabled && hasMouse() && overlayCount() === 0 && !textFocused() && this.mayCapture() && typeof this.canvas.requestPointerLock === 'function';
  }

  /** Something needs the cursor for a while: let go, and take it back after if it was held. */
  private lend(): void {
    if (this.locked) this.lent = true;
    this.release();
  }

  /** What needed the cursor is done: take the mouse back if it lent it. */
  private giveBack(): void {
    if (!this.lent || overlayCount() > 0 || textFocused()) return;
    this.lent = false;
    this.capture();
  }

  private onOverlay = (open: number): void => {
    if (open > 0) this.lend();
    else this.giveBack();
  };

  private onFocus = (): void => {
    // After the focus has settled: moving between two fields blurs one before focusing the next.
    clearTimeout(this.focusTimer);
    this.focusTimer = window.setTimeout(() => {
      if (textFocused()) this.lend();
      else this.giveBack();
    }, 0);
  };

  private onLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    this.drag = null;
    // Either way the camera stays where the mouse left it for a while.
    this.manualAt = this.clock;
    // Held behind a panel that came up in the meantime: let go again.
    if (locked && !this.canCapture()) this.lend();
  };

  private onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.locked) return;
    // The browser lets the mouse go; nothing else should also act on this Esc, and the mouse stays
    // free until a click on the floor.
    e.preventDefault();
    e.stopImmediatePropagation();
    this.lent = false;
    this.release();
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    this.camDist = Math.max(1.6, Math.min(6, this.camDist + Math.sign(e.deltaY) * 0.35));
  };
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

/** A mouse or trackpad to hold: touch-only phones and tablets look with a drag (touch.ts) instead. */
const finePointer = typeof matchMedia === 'function' ? matchMedia('(any-pointer: fine)') : null;
function hasMouse(): boolean {
  return finePointer?.matches ?? true;
}

/** Text going into a field (the chat line, a name): the cursor and the keyboard belong to it. */
const TEXT_INPUTS = new Set(['text', 'search', 'password', 'email', 'number', 'tel', 'url']);
function textFocused(): boolean {
  const t = document.activeElement as HTMLElement | null;
  if (!t) return false;
  if (t instanceof HTMLInputElement) return TEXT_INPUTS.has(t.type);
  return t.tagName === 'TEXTAREA' || t.isContentEditable;
}

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
