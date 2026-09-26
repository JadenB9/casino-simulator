// The valet lobby's sliding glass doors: two tall panes in bronze frames that part for anyone
// walking up to them from either side, and close behind them. One instanced mesh for the glass,
// one for the frames.

import * as THREE from 'three';
import type { Mats } from '../materials.ts';
import type { Box, Collider } from '../collision.ts';

// v7: they sense you from further off and open quicker, so a walk (or a run: 4.8 m/s covers the
// sensing distance in about a second) never reaches the glass before there's room to pass.
const SENSE = 4.6;
const OPEN_S = 0.55;
const CLOSE_S = 1.2;
const DWELL_S = 1.6;
/** Open this far (0..1) there's room to walk through (each pane has slid well over a metre). */
const PASSABLE = 0.32;

export class SlidingDoors {
  readonly group = new THREE.Group();
  private open = 0;
  private dwell = 0;
  private readonly glass: THREE.InstancedMesh;
  private readonly frames: THREE.InstancedMesh;
  private readonly box: Box;
  private readonly m = new THREE.Matrix4();

  /** A doorway in a wall along z at `x` (the doors slide along z), from z0 to z1, this tall. */
  constructor(
    private readonly at: { x: number; z0: number; z1: number; height: number },
    mats: Mats,
    col: Collider,
  ) {
    const w = (at.z1 - at.z0) / 2;
    this.glass = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, at.height - 0.1, w - 0.1), mats.get('glass'), 2);
    // a frame: the rails round each pane, as one geometry
    const parts = [
      new THREE.BoxGeometry(0.05, 0.08, w).translate(0, -(at.height - 0.1) / 2 + 0.0, 0),
      new THREE.BoxGeometry(0.05, 0.08, w).translate(0, (at.height - 0.1) / 2, 0),
      new THREE.BoxGeometry(0.05, at.height - 0.1, 0.05).translate(0, 0, -w / 2 + 0.025),
      new THREE.BoxGeometry(0.05, at.height - 0.1, 0.05).translate(0, 0, w / 2 - 0.025),
    ].map((g) => g.toNonIndexed());
    const pos: number[] = [];
    const nor: number[] = [];
    for (const p of parts) {
      pos.push(...(p.getAttribute('position').array as Float32Array));
      nor.push(...(p.getAttribute('normal').array as Float32Array));
      p.dispose();
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    this.frames = new THREE.InstancedMesh(fg, mats.get('brass'), 2);
    this.glass.name = 'glass-doors';
    this.frames.name = 'glass-door-frames';
    for (const mesh of [this.glass, this.frames]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    this.box = col.box(at.x, (at.z0 + at.z1) / 2, 0.12, at.z1 - at.z0, 0, at.height);
    this.write();
    for (const mesh of [this.glass, this.frames]) mesh.computeBoundingSphere();
  }

  update(dt: number, people: Iterable<{ x: number; z: number }>): void {
    const mid = (this.at.z0 + this.at.z1) / 2;
    let near = false;
    for (const p of people) if (Math.hypot(p.x - this.at.x, p.z - mid) < SENSE) near = true;
    this.dwell = near ? DWELL_S : Math.max(0, this.dwell - dt);
    const want = this.dwell > 0 ? 1 : 0;
    const next = want > this.open ? Math.min(1, this.open + dt / OPEN_S) : Math.max(0, this.open - dt / CLOSE_S);
    if (next === this.open) return;
    this.open = next;
    this.box.walk = next < PASSABLE;
    this.box.cam = next < 0.3;
    this.write();
  }

  private write(): void {
    const w = (this.at.z1 - this.at.z0) / 2;
    const k = this.open * this.open * (3 - 2 * this.open);
    const y = (this.at.height - 0.1) / 2 + 0.02;
    for (const side of [-1, 1]) {
      const z = (this.at.z0 + this.at.z1) / 2 + side * (w / 2 + k * (w - 0.08));
      // the panes slide just outside the fixed glass (a hand's width toward the drive)
      this.m.makeTranslation(this.at.x + 0.09, y, z);
      const i = side < 0 ? 0 : 1;
      this.glass.setMatrixAt(i, this.m);
      this.frames.setMatrixAt(i, this.m);
    }
    this.glass.instanceMatrix.needsUpdate = true;
    this.frames.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.glass, this.frames]) mesh.geometry.dispose();
    this.group.removeFromParent();
  }
}
