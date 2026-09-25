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
//
// First person (F on the floor, or Settings): the camera is at the character's eyes, over its head
// bone as last drawn, so it stands as tall as the body, sinks onto a seat with it and rises with
// anything that lifts it; the eyes sit a little ahead of the walker's middle, well inside its
// circle, so no wall or column comes nearer than the camera's near plane. The body turns with the
// look (a seat holds it still), the look reaches from the chandeliers down to your own shoes, and
// your own head, hair and hat are shrunk away while the camera is inside them. Emoting swings the
// camera out in front for as long as the bubble is up so you see yourself do it; walking or looking
// brings it straight back. The same yaw and pitch serve both views (pitch > 0 looks down), so the
// seats' and tables' camera moves, the stick and the drags work the same in either.

import * as THREE from 'three';
import { isTyping, onOverlayChange, overlayCount } from '../ui/keyboard.ts';
import type { Character } from './contract.ts';
import type { Collider } from './collision.ts';

import { loadMouse, onMouseChange, setMouseSettings, type MouseSettings, type View } from './mouse.ts';
import { EMOTE_S } from './emotes.ts';
import { ridePace } from './rides.ts';
import { EMOTES } from '../../../shared/src/protocol.ts';

const RADIUS = 0.3;
// A brisk default pace (the floor is 40 m across), and Shift for a run.
const WALK = 2.6;
const RUN = 4.8;
/** A factor on walking and running speed from outside the walker (an espresso at the bar, consumables/); 1 = none. */
export const paceBoost = { k: 1 };
/** Nothing the walker does goes faster than this (m/s): the floor server allows 9. */
const MAX_PACE = 8.5;
/** The speeds the walk and run cycles were made for; the blend between them follows these. */
const WALK_CYCLE = 1.75;
const RUN_CYCLE = 3.9;
/** The follow camera's target over the walker's feet (m). */
export const EYE = 1.5;
/** Radians per pixel: dragging (a hand on the button covers less ground), and held. */
const DRAG_YAW = 0.0055;
const DRAG_PITCH = 0.004;
const LOCK_RATE = 0.0024;
/** Camera pitch: a little below the head (to look up at the wheel and the chandeliers) to high above. */
const PITCH_MIN = -0.3;
const PITCH_MAX = 1.1;
/** Through your own eyes the look goes further: up at the chandeliers, down at your shoes or the felt. */
const EYES_PITCH_MIN = -1.35;
const EYES_PITCH_MAX = 1.4;
/**
 * The head bone's joint (the top of the neck) over the feet: 1.55 m on both bodies as they stand
 * (measured), used until the model has loaded; it stands a little ahead of the walker's middle.
 * Looking level the eyes are this much over it and ahead of it, about where the face is. The
 * head nods with the look (NECK of it): the camera never gets more than 0.21 m ahead of the
 * walker's middle, 0.09 m inside its circle, which the near plane's corners (0.05 m out, under
 * 0.09 m across) never reach past.
 */
export const HEAD_Y = 1.55;
/** A head drawn outside these (m over the feet) isn't one: a model not drawn yet. */
const HEAD_MIN = 0.6;
const HEAD_MAX = 3;
const HEAD_AHEAD = 0.06;
const EYES_OVER_HEAD = 0.11;
const EYES_AHEAD = 0.1;
const NECK = 0.85;
/** Seconds to swing between the two views. */
const SWITCH_S = 0.45;
/** Your own head is left out while the camera is this close to the eyes. */
const HEADLESS_NEAR = 0.32;
/** A bone this small draws its vertices (and a hat, shades, hair) into its joint. */
const SHRUNK = 1e-3;
/**
 * Showing yourself an emote in first person: the camera stands this far out in front, a little
 * above, at a three-quarter angle with room enough (the ways round to try, nearest first), for as
 * long as the bubble is up.
 */
const SHOW_DIST = 2.8;
const SHOW_PITCH = 0.14;
/** The emote view looks at this share of the head's height. */
const SHOW_AT = 0.74;
const SHOW_ROOM = 1.8;
const SHOW_TRIES = [0.55, -0.55, 0.95, -0.95, 0.2, -0.2, 1.4, -1.4, 1.9, -1.9];
const SHOW_S = EMOTE_S + 0.2;
/**
 * A punch (world/law/, the 'punch' gesture) is thrown at the character's own head height, a little
 * under the eyes: for its length the look dips this much and comes back, so the fist swings into
 * view in first person (the look itself is left where it was).
 */
const JAB_S = 0.62;
const JAB_DIP = 0.12;
/** Looking this far (radians) while an emote is shown brings the eyes back. */
const SHOW_CANCEL = 0.03;
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
  // --- first person ---
  /** 0 behind you .. 1 at your eyes, swung between over SWITCH_S. */
  private eyesK = 0;
  /** The eyes this frame, and the head joint's eased height over the floor (NaN: snap to it). */
  private readonly eye = new THREE.Vector3();
  private headY = Number.NaN;
  /** The walker's own height last frame (the floor the head was drawn over). */
  private floorY = 0;
  /** The head bone (found again when a new outfit brings new bones), and the one shrunk now. */
  private head: THREE.Object3D | null = null;
  private shrunk: THREE.Object3D | null = null;
  /** An emote being shown from out in front: the camera's yaw, and until when. */
  private showing: { yaw: number; until: number } | null = null;
  private showLook = 0;
  /** Seconds left of a punch you threw: the eyes follow the fist down a little and back. */
  private jab = 0;
  /** A seat holds the body (the character was sat down): the look doesn't turn it. */
  private sitting = false;
  private readonly posQ = new THREE.Quaternion();
  private readonly eyeQ = new THREE.Quaternion();
  private readonly lookM = new THREE.Matrix4();
  private readonly lookAt = new THREE.Vector3();

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
      const was = this.mouse.view;
      this.mouse = m;
      if (!m.capture) {
        this.lent = false;
        this.release();
      }
      if (m.view !== was) this.viewChanged();
    });
    this.hear(character);
  }

  /**
   * The walker hears two things others tell the character: an emote (world/emotes.ts), which in
   * first person swings the camera out to show it, and sitting down on a floor seat
   * (world/life/sitting.ts), after which the seat, not the look, turns the body. Other motions
   * through the same call (a punch thrown or taken, world/law/) are quick and happen in front of
   * you: the eyes stay put and your own arm swings into view.
   */
  private hear(ch: Character): void {
    const gesture = ch.gesture?.bind(ch);
    if (gesture) {
      ch.gesture = (e) => {
        gesture(e);
        if (showsFromFront(e)) this.showEmote();
        else if ((e as string) === 'punch') this.jab = JAB_S;
      };
    }
    const sit = ch.sit?.bind(ch);
    if (sit) {
      ch.sit = (top) => {
        sit(top);
        this.sitting = top !== null;
      };
    }
  }

  /** First or third person; F toggles it on the floor, Settings sets it, and it's kept for next time. */
  get view(): View {
    return this.mouse.view;
  }

  setView(view: View): void {
    setMouseSettings({ view });
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
    this.headY = Number.NaN;
    this.showing = null;
    this.syncCharacter();
    // While the controls are lent out (the look editor, the shop, a table) the camera is theirs:
    // the floor's first hello lands during a new player's "Pick your look" and used to pull the
    // camera off the dressing room onto the lobby. The next enabled frame places it anyway.
    if (this.enabled) this.placeCamera(1);
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
    this.showing = null;
    if (!on) {
      this.lent = false;
      this.release();
      // the dressing room, the showroom and the tables show the whole character
      this.shrinkHead(false);
    } else if (!was) {
      // back from a table (the fly-out ended at followPose()) or the menu: no swing
      this.eyesK = this.mouse.view === 'first' ? 1 : 0;
      this.headY = Number.NaN;
      this.capture();
    }
  }

  /** Where the camera would be right now, behind you or at your eyes (for flying back from a table). */
  followPose(): { position: THREE.Vector3; target: THREE.Vector3 } {
    if (this.mouse.view === 'first') {
      this.computeEyes(0);
      const d = this.lookDir(this.lookAt);
      return { position: this.eye.clone(), target: this.eye.clone().addScaledVector(d, 3) };
    }
    this.computeCamera(this.camYaw, clampPitch(this.camPitch, 'third'), this.camDist);
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
    // walking off brings the eyes back from showing an emote
    if (this.showing && (len > 0 || this.clock > this.showing.until)) this.showing = null;
    // v6 looks6: on a ride, its own speeds; it gets going and rolls to a stop more slowly
    const ride = ridePace(this.character);
    // v6 dine6: an espresso's quicker pace, on foot only (a ride keeps its own speeds)
    const boost = ride ? 1 : paceBoost.k;
    const speed = len > 0 ? Math.min(MAX_PACE, (run ? (ride?.run ?? RUN) : (ride?.walk ?? WALK) * pace) * boost) : 0;
    if (len > 0) {
      mx /= len;
      mz /= len;
    }
    if (ride && len > 0) {
      // a ride goes where it points, and swings round to where you steer at its own pace: it carves
      this.heading = turn(this.heading, Math.atan2(mx, mz), 1 - Math.exp(-dt * ride.turn));
      mx = Math.sin(this.heading);
      mz = Math.cos(this.heading);
    }
    const a = 1 - Math.exp(-dt * (len > 0 ? (ride?.accel ?? 9) : (ride?.coast ?? 12)));
    this.vel.x += (mx * speed - this.vel.x) * a;
    this.vel.y += (mz * speed - this.vel.y) * a;
    const p = { x: this.position.x + this.vel.x * dt, z: this.position.z + this.vel.y * dt };
    this.col.resolve(p, ride?.radius ?? RADIUS);
    // speed actually achieved (sliding along a wall is slower than pushing into it)
    const moved = Math.hypot(p.x - this.position.x, p.z - this.position.z) / Math.max(dt, 1e-4);
    this.position.x = p.x;
    this.position.z = p.z;
    if (this.mouse.view === 'first' && !this.showing) {
      // through your eyes the body faces where you look, walking or not, unless a seat holds it
      // (a ride keeps its own heading: it carves where you steer, whatever you look at)
      if (!this.sitting && !ride) this.heading = turn(this.heading, this.camYaw + Math.PI, 1 - Math.exp(-dt * 20));
    } else if (len > 0) {
      const want = Math.atan2(mx, mz);
      this.heading = turn(this.heading, want, 1 - Math.exp(-dt * 12));
      // The camera drifts round behind the walker only once the mouse has been left alone for a
      // while, and never while it's held: then the mouse alone steers.
      if (!this.locked && this.mouse.view === 'third' && this.clock - this.manualAt > RECENTER_AFTER && iz >= 0) this.camYaw = turn(this.camYaw, this.heading + Math.PI, 1 - Math.exp(-dt * 1.4));
    }
    this.speed = moved;
    const motion = moved < 0.05 ? 0 : moved <= WALK_CYCLE ? moved / WALK_CYCLE : Math.min(2, 1 + (moved - WALK_CYCLE) / (RUN_CYCLE - WALK_CYCLE));
    this.character.setMotion(motion);
    this.syncCharacter();
    this.placeCamera(dt);
    this.floorY = this.position.y;
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
    this.shrinkHead(false);
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

  /**
   * The follow camera looking at a point over the walker (the head, unless `at` says how high) from
   * `yaw` and `pitch`, `far` away or nearer where something's in the way.
   */
  private computeCamera(yaw: number, pitch: number, far: number, at = EYE): void {
    // (a ride lifts the walker, and the head with it)
    this.target.set(this.position.x, at + this.position.y, this.position.z);
    const cp = Math.cos(pitch);
    this.dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    // back off along the ray until something solid is in the way
    const hit = this.col.raycast(this.target, this.dir, far + 0.3) - 0.3;
    const allowed = Math.max(0.45, Math.min(far, hit));
    this.want.copy(this.target).addScaledVector(this.dir, allowed);
    const ceiling = Math.min(this.ceilingAt(this.want.x, this.want.z), this.ceilingAt(this.target.x, this.target.z));
    this.want.y = Math.max(CAM_FLOOR, Math.min(this.want.y, ceiling - 0.2));
    this.lastAllowed = allowed;
  }

  private lastAllowed = 3.3;

  private placeCamera(dt: number): void {
    const cam = this.camera;
    const first = this.mouse.view === 'first';
    // where the camera was drawn last frame, after anyone else moved it (a banker's window does)
    const drawnNear = first && cam.position.distanceTo(this.eye) < HEADLESS_NEAR;
    const toEyes = first && !this.showing ? 1 : 0;
    this.eyesK = stepToward(this.eyesK, toEyes, dt / SWITCH_S);
    this.jab = Math.max(0, this.jab - dt);
    const k = smooth(this.eyesK);
    if (k < 1) {
      // behind you, or out in front while an emote is shown
      const s = this.showing;
      if (s) this.computeCamera(s.yaw, SHOW_PITCH, SHOW_DIST, this.showAt());
      else this.computeCamera(this.camYaw, clampPitch(this.camPitch, 'third'), this.camDist);
      // pull in fast when blocked, ease back out when clear
      const d = this.lastAllowed;
      this.dist += (d - this.dist) * (1 - Math.exp(-dt * (d < this.dist ? 22 : 3)));
      cam.position.copy(this.target).addScaledVector(this.dir, this.dist);
      cam.position.y = Math.max(CAM_FLOOR, Math.min(cam.position.y, this.want.y));
      cam.lookAt(this.target.x, this.target.y - 0.12, this.target.z);
    }
    if (first || k > 0) this.computeEyes(dt);
    if (k > 0) {
      this.lookM.lookAt(this.eye, this.lookDir(this.lookAt).add(this.eye), cam.up);
      this.eyeQ.setFromRotationMatrix(this.lookM);
      if (k >= 1) {
        cam.position.copy(this.eye);
        cam.quaternion.copy(this.eyeQ);
      } else {
        this.posQ.copy(cam.quaternion);
        cam.position.lerp(this.eye, k);
        cam.quaternion.slerpQuaternions(this.posQ, this.eyeQ, k);
      }
    }
    // the head goes once the camera is in it, and comes back the moment it leaves
    this.shrinkHead(drawnNear && cam.position.distanceTo(this.eye) < HEADLESS_NEAR);
  }

  /** Where the eyes are this frame: from the head bone as last drawn, the way you look. */
  private computeEyes(dt: number): void {
    const bone = this.headBone();
    // (a model just put on hasn't been drawn yet: its bones are all still at the floor)
    const drawn = bone ? bone.matrixWorld.elements[13]! - this.floorY : Number.NaN;
    const y = headHeight(drawn > HEAD_MIN && drawn < HEAD_MAX ? drawn : null, this.position.y);
    // eased (a walk's bob, getting onto a seat), snapped after a jump
    if (!(Math.abs(y - this.headY) < 0.5) || dt <= 0) this.headY = y;
    else this.headY += (y - this.headY) * (1 - Math.exp(-dt * 12));
    const o = eyeOffset(this.camPitch);
    this.eye.set(this.position.x - Math.sin(this.camYaw) * o.ahead, this.headY + o.up, this.position.z - Math.cos(this.camYaw) * o.ahead);
  }

  /** Which way the eyes look (unit length): straight away from where the follow camera would be. */
  private lookDir(out: THREE.Vector3): THREE.Vector3 {
    const p = clampPitch(this.camPitch + jabDip(JAB_S - this.jab), 'first');
    const cp = Math.cos(p);
    return out.set(-Math.sin(this.camYaw) * cp, -Math.sin(p), -Math.cos(this.camYaw) * cp);
  }

  /** The character's head bone, found again when a new outfit's model brings bones of its own. */
  private headBone(): THREE.Object3D | null {
    let o = this.head;
    while (o && o !== this.character.root) o = o.parent;
    if (!o) this.head = this.character.root.getObjectByName('Head') ?? null;
    return this.head;
  }

  /** Shrink your own head away (the camera is inside it), or give it back. */
  private shrinkHead(on: boolean): void {
    const bone = on ? this.headBone() : null;
    if (bone === this.shrunk) return;
    this.shrunk?.scale.setScalar(1);
    bone?.scale.setScalar(SHRUNK);
    this.shrunk = bone;
  }

  /** The view changed (F, or Settings): swing to it; the follow camera keeps to its own pitch range. */
  private viewChanged(): void {
    this.showing = null;
    if (this.mouse.view === 'third') this.camPitch = clampPitch(this.camPitch, 'third');
    if (!this.enabled) this.eyesK = this.mouse.view === 'first' ? 1 : 0;
  }

  /** You emoted: in first person, the camera goes out in front to show you doing it. */
  private showEmote(): void {
    if (this.mouse.view !== 'first' || !this.enabled) return;
    this.showing = { yaw: this.showYaw(), until: this.clock + SHOW_S };
    this.showLook = 0;
  }

  /** Where an emote is framed: the middle of the body, from the feet to hands thrown up, standing or seated. */
  private showAt(): number {
    return (Number.isFinite(this.headY) ? this.headY - this.position.y : HEAD_Y) * SHOW_AT;
  }

  /** Out in front for an emote: a three-quarter view with room to stand back, or the roomiest way round. */
  private showYaw(): number {
    const o = { x: this.position.x, y: this.showAt() + this.position.y, z: this.position.z };
    const cp = Math.cos(SHOW_PITCH);
    let best = this.heading;
    let most = -Infinity;
    for (const off of SHOW_TRIES) {
      const yaw = this.heading + off;
      const room = this.col.raycast(o, { x: Math.sin(yaw) * cp, y: Math.sin(SHOW_PITCH), z: Math.cos(yaw) * cp }, SHOW_DIST + 0.3) - 0.3;
      if (room >= SHOW_ROOM) return yaw;
      if (room > most + 0.05) {
        most = room;
        best = yaw;
      }
    }
    return best;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (isTyping(e)) return;
    if (e.type === 'keydown') {
      // nothing walks while a panel holds the keyboard (a key typed into the map's panel still
      // bubbles up to here)
      if (!this.enabled || overlayCount() > 0) return;
      if (MOVE_KEYS.has(e.code)) {
        this.keys.add(e.code);
        if (e.code.startsWith('Arrow')) e.preventDefault();
      } else if (e.code === 'KeyF' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // (at a table the controls are lent out and F is the game's: Fold)
        this.setView(this.mouse.view === 'first' ? 'third' : 'first');
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

  /** Turn the camera: yaw right for +dx, look down for +dy, pitch clamped to the view's range. */
  private look(dx: number, dy: number): void {
    this.camYaw -= dx;
    this.camPitch = clampPitch(this.camPitch + dy, this.mouse.view);
    this.manualAt = this.clock;
    // looking about while an emote is shown: back to the eyes
    if (this.showing && (this.showLook += Math.abs(dx) + Math.abs(dy)) > SHOW_CANCEL) this.showing = null;
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
    if (open > 0) {
      // the map, the emotes, a sheet: stop where you are rather than walk on blind behind it
      this.keys.clear();
      this.lend();
    } else {
      this.giveBack();
    }
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
    if (!this.enabled || this.mouse.view === 'first') return;
    this.camDist = Math.max(1.6, Math.min(6, this.camDist + Math.sign(e.deltaY) * 0.35));
  };
}

/** The pitch a view allows: through the eyes you look further up and down than the follow camera swings. */
export function clampPitch(pitch: number, view: View): number {
  const [lo, hi] = view === 'first' ? [EYES_PITCH_MIN, EYES_PITCH_MAX] : [PITCH_MIN, PITCH_MAX];
  return Number.isFinite(pitch) ? Math.max(lo, Math.min(hi, pitch)) : Math.max(lo, Math.min(hi, 0.26));
}

/**
 * The head bone's joint over the ground for a walker whose feet are at `floor`: drawn `head` over
 * them (the body's own height, lower on a seat, higher on a ride), or before the model is in,
 * where a standing head is.
 */
export function headHeight(head: number | null, floor: number): number {
  return floor + (head ?? HEAD_Y);
}

/**
 * The eyes from the head joint, looking `pitch` down (negative: up): ahead of the walker's middle
 * and up. Level, they're over the joint and a little ahead, where the face is; looking down the
 * head tips forward over the chest, as a neck lets it (so a shirt collar isn't all you see), and
 * looking up it tips back.
 */
export function eyeOffset(pitch: number): { ahead: number; up: number } {
  const a = clampPitch(pitch, 'first') * NECK;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { ahead: HEAD_AHEAD + EYES_AHEAD * c + EYES_OVER_HEAD * s, up: EYES_OVER_HEAD * c - EYES_AHEAD * s };
}

/** How far the look dips `t` seconds into a punch you threw (0 before and after it). */
export function jabDip(t: number): number {
  if (!(t > 0) || t >= JAB_S) return 0;
  return JAB_DIP * Math.sin((Math.PI * t) / JAB_S);
}

/** Move `a` toward `b` by at most `step`. */
export function stepToward(a: number, b: number, step: number): number {
  if (!(step > 0)) return a;
  return a < b ? Math.min(b, a + step) : Math.max(b, a - step);
}

/** Ease in and out over 0..1. */
function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

const EMOTE_IDS: ReadonlySet<string> = new Set(EMOTES);

/** Whether a gesture of your own swings the first-person camera out to show it: an emote does, a punch doesn't. */
export function showsFromFront(gesture: string): boolean {
  return EMOTE_IDS.has(gesture);
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
