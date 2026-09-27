// v1.1: moving a piece about your apartment. The piece is carried a step in front of you as you
// walk, turned with you (and a further eighth of a turn at a time with the turn key, Shift back),
// over a patch of floor that's green where it fits and red where it doesn't: inside the flat or out
// on the balcony (never across the glass), clear of the walls and the other pieces, and never in
// the way of a door or the elevator. A click (or Set down) leaves it there; Esc (or Cancel) puts
// it back where it was.

import * as THREE from 'three';
import type { Collider } from '../collision.ts';
import { corners, overlaps, pointToPoly } from '../layout.ts';
import { button, el } from '../../ui/kit.ts';
import { yawToByte } from '../../net/presence.ts';
import { isKey, keyLabel } from '../../ui/keys.ts';
import { isTyping, overlayCount } from '../../ui/keyboard.ts';
import { APT, BATH, BEDROOM, TABLET, TERRACE } from './plan.ts';
import './home.css';
import type { HomePlace } from '../../../../shared/src/estate.ts';

/** What's being carried: the object to move about, its half-size on the floor (m), and how to let it go. */
export interface Carried {
  object: THREE.Object3D;
  half: { x: number; z: number };
  dispose(): void;
}

export interface MoverDeps {
  scene: THREE.Object3D;
  ui: HTMLElement;
  collider: Collider;
  /** Where you stand and which way you face. */
  player: () => { x: number; z: number; heading: number };
  /** The walker's clicks (a high priority takes them before a gun or a punch). */
  onClick: (fn: () => boolean, priority: number) => () => void;
  onFrame: (fn: (dt: number) => void) => () => void;
}

/** Floor kept clear for the doors, the elevator and the home tablet (from x0, x1, z0, z1). */
const CLEAR = (
  [
    [APT.x0, APT.x0 + 2.6, 68.3, 71.7], // the elevator's doors and a step out of them
    [BEDROOM.door.x0 - 0.2, BEDROOM.door.x1 + 0.2, BEDROOM.z1 - 0.9, BEDROOM.z1 + 0.9],
    [BATH.door.x0 - 0.2, BATH.door.x1 + 0.2, BATH.z0 - 1.0, BATH.z0 + 0.4],
    [APT.x1 - 1.2, APT.x1 + 1.2, TERRACE.door.z0, TERRACE.door.z1],
    [TABLET.x - 0.7, TABLET.x + 0.7, TABLET.z - 1.0, TABLET.z],
  ] as const
).map(([x0, x1, z0, z1]) => corners((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0));

/** Whether a piece of half-size (hx, hz) fits at (x, z) turned `yaw`, against what `col` holds. */
export function fits(col: Collider, x: number, z: number, hx: number, hz: number, yaw: number): boolean {
  const rect = corners(x, z, hx * 2, hz * 2, yaw);
  const inRect = (x0: number, x1: number, z0: number, z1: number) => rect.every(([cx, cz]) => cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1);
  const m = 0.05;
  if (!inRect(APT.x0 + m, APT.x1 - m, APT.z0 + m, APT.z1 - m) && !inRect(TERRACE.x0 + 0.2, TERRACE.x1 - 0.15, TERRACE.z0 + 0.15, TERRACE.z1 - 0.15)) return false;
  if (CLEAR.some((c) => overlaps(rect, c))) return false;
  const reach = Math.hypot(hx, hz);
  for (const b of col.boxes) {
    // only what stands on the floor and stops a walker (not a lintel over a door, not the walk-through
    // signs), near enough to touch (the collider holds every zone built, the casino's too)
    if (!b.walk || b.bottom > 0.5 || b.top < 0.05) continue;
    const r = reach + b.hx + b.hz;
    if (Math.abs(b.cx - x) > r || Math.abs(b.cz - z) > r) continue;
    if (overlaps(rect, corners(b.cx, b.cz, b.hx * 2, b.hz * 2, b.yaw))) return false;
  }
  for (const p of col.posts) if (p.walk && pointToPoly(p.cx, p.cz, rect) < p.r) return false;
  return true;
}

/** The patch under a carried piece: where it fits, and where it doesn't. */
const FITS = new THREE.Color('#4fdc8a');
const BLOCKED = new THREE.Color('#ff5a4a');

/** An eighth of a turn. */
const STEP = Math.PI / 4;

export class Mover {
  private carried: Carried | null = null;
  private turn = 0;
  private x = 0;
  private z = 0;
  private yaw = 0;
  private ok = false;
  private shownOk: boolean | null = null;
  private done: ((at: HomePlace | null) => void) | null = null;
  private readonly patch: THREE.Mesh;
  private readonly bar = el('div', 'home-move panel');
  private readonly hint = el('div', 'home-move-hint');
  private readonly offs: (() => void)[] = [];

  constructor(private readonly d: MoverDeps) {
    this.patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: FITS, transparent: true, opacity: 0.35, depthWrite: false }));
    this.patch.rotation.x = -Math.PI / 2;
    this.patch.renderOrder = 2;
    this.patch.visible = false;
    this.patch.name = 'home:move-patch';
    d.scene.add(this.patch);
    this.bar.append(this.hint, button('Turn', () => this.rotate(1)), button('Set down', () => this.setDown(), { cls: 'primary' }), button('Cancel', () => this.end(null)));
    // (a press on the bar isn't a click on the floor)
    this.bar.addEventListener('click', (e) => e.stopPropagation());
    this.bar.hidden = true;
    d.ui.append(this.bar);
    this.offs.push(d.onClick(() => (this.carried ? (this.setDown(), true) : false), 20));
    this.offs.push(d.onFrame(() => this.update()));
    addEventListener('keydown', this.onKey, true);
  }

  /** Pick `carried` up; `done` hears where it was set down, or null when it's put back. */
  start(carried: Carried, done: (at: HomePlace | null) => void): void {
    this.end(null);
    this.carried = carried;
    this.done = done;
    this.turn = 0;
    this.d.scene.add(carried.object);
    this.patch.scale.set(carried.half.x * 2 + 0.1, carried.half.z * 2 + 0.1, 1);
    this.patch.visible = true;
    this.hint.textContent = `Walk to carry it · ${keyLabel('turn')} turns it · click sets it down · Esc puts it back`;
    this.bar.hidden = false;
    this.update();
  }

  /** Put it back where it was (a table, the elevator, anything that takes you away). */
  cancel(): void {
    this.end(null);
  }

  private rotate(dir: number): void {
    if (this.carried) this.turn += dir * STEP;
  }

  private setDown(): void {
    if (!this.carried) return;
    this.update();
    if (!this.ok) {
      this.hint.textContent = "It doesn't fit there: keep it clear of the walls, the doors and the other pieces.";
      return;
    }
    this.end({ x: Math.round(this.x * 100), z: Math.round(this.z * 100), r: yawToByte(this.yaw) });
  }

  private end(at: HomePlace | null): void {
    const c = this.carried;
    const done = this.done;
    this.carried = null;
    this.done = null;
    this.patch.visible = false;
    this.bar.hidden = true;
    if (!c) return;
    c.object.removeFromParent();
    c.dispose();
    done?.(at);
  }

  private update(): void {
    const c = this.carried;
    if (!c) return;
    const p = this.d.player();
    // a step ahead of you, clear of your feet, facing you
    const ahead = Math.max(c.half.x, c.half.z) + 0.75;
    this.x = p.x + Math.sin(p.heading) * ahead;
    this.z = p.z + Math.cos(p.heading) * ahead;
    // (turned with you in steps of a sixteenth of a turn, so it sits square as you walk it about)
    const facing = Math.round((p.heading + Math.PI) / (STEP / 2)) * (STEP / 2);
    this.yaw = facing + this.turn;
    c.object.position.set(this.x, 0, this.z);
    c.object.rotation.y = this.yaw;
    this.ok = fits(this.d.collider, this.x, this.z, c.half.x, c.half.z, this.yaw);
    this.patch.position.set(this.x, 0.03, this.z);
    this.patch.rotation.z = this.yaw;
    if (this.ok !== this.shownOk) {
      this.shownOk = this.ok;
      (this.patch.material as THREE.MeshBasicMaterial).color.copy(this.ok ? FITS : BLOCKED);
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.carried || isTyping(e) || overlayCount() > 0) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.end(null);
    } else if (isKey(e, 'turn') && !e.repeat) {
      e.preventDefault();
      this.rotate(e.shiftKey ? -1 : 1);
    }
  };

  dispose(): void {
    this.end(null);
    for (const off of this.offs) off();
    removeEventListener('keydown', this.onKey, true);
    this.patch.geometry.dispose();
    (this.patch.material as THREE.Material).dispose();
    this.patch.removeFromParent();
    this.bar.remove();
  }
}
