// Photo mode (P on the floor, v8): the screen to yourself and your character to frame. The panels,
// the HUD and the name tags go; the camera leaves your shoulder and circles you, dragged round
// (a finger on a phone, two to zoom), with the arrow keys, or the wheel to come closer or stand
// back. Save takes the picture as the frame is drawn, lights and glow and all, and saves it as a
// PNG. Esc, P or Done puts everything back as it was.
//
// The camera eases toward where it's sent (critically damped springs, player.ts spring()) and
// stops short of any wall between it and you, the way the follow camera does. Nothing drifts or
// turns on its own, and while calm the shutter's flash is a soft fade.

import * as THREE from 'three';
import './photo.css';
import { el, toast } from '../ui/kit.ts';
import { holdKeyboard, isTyping, overlayCount } from '../ui/keyboard.ts';
import { isKey, keyLabel, modified } from '../ui/keys.ts';
import { calm } from '../app/comfort.ts';
import { spring, type Player } from './player.ts';
import type { Collider } from './collision.ts';

export interface PhotoDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  onFrame(fn: (dt: number) => void): () => void;
  player: Player;
  /** Where the bar goes (#ui), and the name tags' layer (hidden while a photo is framed). */
  ui: HTMLElement;
  labels: HTMLElement | null;
  collider: Collider;
  /** Whether a photo may be framed now: on the floor, walking, nothing open over it. */
  canStart: () => boolean;
}

/** How far the camera stands from you (m) to start, at the closest and at the furthest. */
const DIST = 2.9;
const DIST_MIN = 1.1;
const DIST_MAX = 7;
/** How high on the body it looks (m over the feet), and the most it looks up from below or down from above. */
const AT_Y = 1.05;
const PITCH_MIN = -0.25;
const PITCH_MAX = 1.2;
/** Radians a pixel of drag turns it, and a press of an arrow key. */
const DRAG = 0.0065;
const KEY_TURN = 0.18;
/** The springs it rides (rad/s). */
const EASE = 9;
/** It stops this short of a wall between it and you (m). */
const PAD = 0.3;

export class PhotoMode {
  private root: HTMLElement | null = null;
  private release: (() => void) | null = null;
  private offFrame: (() => void) | null = null;
  private readonly yaw = { x: 0, v: 0 };
  private readonly pitch = { x: 0.2, v: 0 };
  private readonly dist = { x: DIST, v: 0 };
  private want = { yaw: 0, pitch: 0.2, dist: DIST };
  private drags = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private readonly at = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly deps: PhotoDeps) {
    addEventListener('keydown', this.onKey);
  }

  /** True while a photo is being framed. */
  get active(): boolean {
    return this.root !== null;
  }

  toggle(): void {
    if (this.root) this.stop();
    else this.start();
  }

  /** Frame a photo of yourself; false when that can't happen now (at a table, a panel open). */
  start(): boolean {
    if (this.root || !this.deps.canStart() || overlayCount() > 0) return false;
    const { player, camera } = this.deps;
    player.setEnabled(false);
    // from where the camera is now, round you
    const p = player.position;
    const dx = camera.position.x - p.x;
    const dz = camera.position.z - p.z;
    const flat = Math.hypot(dx, dz);
    this.want = {
      yaw: flat > 0.2 ? Math.atan2(dx, dz) : player.heading,
      pitch: THREE.MathUtils.clamp(Math.atan2(camera.position.y - (p.y + AT_Y), Math.max(0.2, flat)), PITCH_MIN, PITCH_MAX),
      dist: THREE.MathUtils.clamp(flat > 0.2 ? Math.hypot(flat, camera.position.y - (p.y + AT_Y)) : DIST, DIST_MIN + 0.6, DIST_MAX),
    };
    this.yaw.x = this.want.yaw;
    this.pitch.x = this.want.pitch;
    this.dist.x = this.want.dist;
    this.yaw.v = this.pitch.v = this.dist.v = 0;
    this.root = this.build();
    this.deps.ui.append(this.root);
    this.deps.ui.classList.add('photo-mode');
    if (this.deps.labels) this.deps.labels.style.visibility = 'hidden';
    this.release = holdKeyboard(this.root, () => this.stop());
    (this.root.querySelector<HTMLElement>('.photo-save') ?? this.root).focus({ preventScroll: true });
    this.offFrame = this.deps.onFrame((dt) => this.frame(dt));
    this.frame(0);
    return true;
  }

  /** Back to the floor, everything as it was. */
  stop(): void {
    if (!this.root) return;
    this.offFrame?.();
    this.offFrame = null;
    this.release?.();
    this.release = null;
    this.root.remove();
    this.root = null;
    this.drags.clear();
    this.deps.ui.classList.remove('photo-mode');
    if (this.deps.labels) this.deps.labels.style.visibility = '';
    this.deps.player.setEnabled(true);
  }

  /**
   * Take the picture: the frame drawn once more (with whatever glow the floor's drawing adds) and
   * read off the canvas straight away, in the same task, then saved as a PNG.
   */
  save(): void {
    const { renderer, scene, camera } = this.deps;
    try {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      renderer.domElement.toBlob((blob) => {
        if (!blob) {
          toast('The photo could not be saved.');
          return;
        }
        download(blob, photoName(new Date()));
      }, 'image/png');
    } catch {
      toast('The photo could not be saved.');
      return;
    }
    this.flash();
  }

  dispose(): void {
    this.stop();
    removeEventListener('keydown', this.onKey);
  }

  /** The camera each frame, eased toward where it's been sent, short of any wall. */
  private frame(dt: number): void {
    const { player, camera, collider } = this.deps;
    // (the app cleared the screen meanwhile: not a photo any more)
    if (dt > 0 && !this.root?.isConnected) {
      this.stop();
      return;
    }
    const w = this.want;
    if (dt > 0) {
      spring(this.yaw, w.yaw, EASE, dt);
      spring(this.pitch, w.pitch, EASE, dt);
      spring(this.dist, w.dist, EASE, dt);
    }
    const p = player.position;
    this.at.set(p.x, p.y + AT_Y, p.z);
    const cp = Math.cos(this.pitch.x);
    this.dir.set(Math.sin(this.yaw.x) * cp, Math.sin(this.pitch.x), Math.cos(this.yaw.x) * cp);
    const room = collider.raycast(this.at, this.dir, this.dist.x + PAD) - PAD;
    const d = Math.max(0.4, Math.min(this.dist.x, room));
    camera.position.copy(this.at).addScaledVector(this.dir, d);
    camera.position.y = Math.max(0.25, camera.position.y);
    camera.lookAt(this.at);
  }

  private build(): HTMLElement {
    const root = el('div', 'photo');
    root.tabIndex = -1;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Photo mode');
    // the view itself: drag to turn round, the wheel (or two fingers) to come closer
    const view = el('div', 'photo-view');
    view.tabIndex = -1;
    view.addEventListener('pointerdown', this.onDown);
    view.addEventListener('pointermove', this.onMove);
    view.addEventListener('pointerup', this.onUp);
    view.addEventListener('pointercancel', this.onUp);
    view.addEventListener('wheel', this.onWheel, { passive: false });
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    const bar = el('div', 'photo-bar');
    const hint = el('p', 'photo-hint', 'Drag to turn round you, the wheel to come closer');
    const save = el('button', 'btn primary photo-save', 'Save photo');
    save.type = 'button';
    save.addEventListener('click', () => this.save());
    const done = el('button', 'btn photo-done');
    done.type = 'button';
    done.append('Done ', el('span', 'key', 'Esc'));
    done.setAttribute('aria-label', `Leave photo mode (Esc or ${keyLabel('photo')})`);
    done.addEventListener('click', () => this.stop());
    bar.append(hint, save, done);
    root.append(view, bar, el('div', 'photo-flash'));
    root.addEventListener('keydown', this.onPanelKey);
    return root;
  }

  private flash(): void {
    const f = this.root?.querySelector<HTMLElement>('.photo-flash');
    if (!f) return;
    f.classList.remove('go', 'soft');
    // (restart the animation)
    void f.offsetWidth;
    f.classList.add(calm() ? 'soft' : 'go');
    const hint = this.root?.querySelector<HTMLElement>('.photo-hint');
    if (hint) hint.textContent = 'Saved. Find it with your downloads.';
  }

  private turn(dx: number, dy: number): void {
    this.want.yaw -= dx;
    this.want.pitch = THREE.MathUtils.clamp(this.want.pitch + dy, PITCH_MIN, PITCH_MAX);
  }

  private zoom(k: number): void {
    this.want.dist = THREE.MathUtils.clamp(this.want.dist * k, DIST_MIN, DIST_MAX);
  }

  private onDown = (e: PointerEvent): void => {
    this.drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pinch = this.spread();
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.drags.get(e.pointerId);
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (this.drags.size >= 2) {
      // two fingers: closer as they spread, further as they pinch
      const s = this.spread();
      if (this.pinch > 0 && s > 0) this.zoom(this.pinch / s);
      this.pinch = s;
      return;
    }
    this.turn(dx * DRAG, dy * DRAG * 0.7);
  };

  private onUp = (e: PointerEvent): void => {
    this.drags.delete(e.pointerId);
    this.pinch = this.spread();
  };

  /** How far apart the two fingers on the view are (0 with fewer). */
  private spread(): number {
    const [a, b] = [...this.drags.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
  };

  /** Keys while framing: the arrows turn, + and - come closer and stand back, the photo key or Esc leaves. */
  private onPanelKey = (e: KeyboardEvent): void => {
    if (isTyping(e) || modified(e)) return;
    const turns: Record<string, [number, number]> = { ArrowLeft: [-KEY_TURN, 0], ArrowRight: [KEY_TURN, 0], ArrowUp: [0, -KEY_TURN * 0.6], ArrowDown: [0, KEY_TURN * 0.6] };
    const t = turns[e.key];
    if (t) {
      e.preventDefault();
      this.turn(t[0], t[1]);
    } else if (e.key === '+' || e.key === '=' || e.key === 'PageUp') {
      e.preventDefault();
      this.zoom(1 / 1.15);
    } else if (e.key === '-' || e.key === '_' || e.key === 'PageDown') {
      e.preventDefault();
      this.zoom(1.15);
    } else if (isKey(e, 'photo') && !e.repeat) {
      e.preventDefault();
      this.stop();
    }
  };

  /** The photo key on the floor (with nothing open over it) frames a photo. */
  private onKey = (e: KeyboardEvent): void => {
    if (!isKey(e, 'photo') || e.repeat || e.defaultPrevented || modified(e) || isTyping(e)) return;
    if (this.root) return; // the panel's own listener leaves
    if (overlayCount() > 0 || !this.deps.canStart()) return;
    e.preventDefault();
    this.start();
  };
}

/** casino-photo-2026-10-23-1832.png: the local date and time it was taken. */
export function photoName(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `casino-photo-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.png`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // (long enough for the download to have started)
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
