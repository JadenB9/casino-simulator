// The casino's elevator is the lobby's own double doors, under the Casino Simulator sign: the
// same two leaves (door.glb, split down its middle seam), now sliding apart into the wall for
// anyone who walks up to them, and behind them a car built just outside the south wall, panelled
// like the other banks' cars, with the floor panel inside beside the door. It answers the city
// the way a bank does (the Lift interface in bank.ts), so the ride, the prompts and the sensor
// work the same as on the ground floor and the roof.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Quality } from '../../render/engine3d.ts';
import type { Batch } from '../batch.ts';
import type { GlowMerge } from '../lighting.ts';
import type { Mats } from '../materials.ts';
import type { Box, Collider } from '../collision.ts';
import { GLOW } from '../lighting.ts';
import { MODEL_BASE } from '../characters.ts';
import { modelBytes } from '../../render/model-bytes.ts';
import { carCentre, type LiftBank } from '../../../../shared/src/lifts.ts';
import type { CarBox, Lift } from './bank.ts';

/** The doorway (from the floor plan): its middle along x, its width and height, the wall's line. */
export interface Doorway {
  x: number;
  z: number;
  width: number;
  height: number;
}

/** The wall's half thickness either side of its line, and the car behind it (m). */
const WALL = 0.15;
const CAR_D = 1.85;
const CAR_H = 2.98;
const SIDE = 0.15;
const SENSE = 1.3;
const OPEN_S = 1.2;
const CLOSE_S = 1.4;
const DWELL_S = 1.6;

/**
 * The plan's box that keeps the street doors shut (collide.ts): the one standing on the floor in
 * the doorway. The wall's piece over the door (the lintel, from the doors' top up to the ceiling)
 * has the same footprint and comes first, so the height is what tells them apart: open the lintel
 * and the doorway stays shut.
 */
export function doorwayBox(col: Collider, door: Doorway): Box | null {
  return (
    col.boxes.find(
      (b) =>
        b.bottom === 0 &&
        b.top >= door.height - 0.05 &&
        Math.abs(b.cx - door.x) < 0.05 &&
        Math.abs(b.cz - door.z) < 0.25 &&
        b.hx > door.width / 2 - 0.2 &&
        b.hx < door.width / 2 + 0.3,
    ) ?? null
  );
}

export class EntranceLift implements Lift {
  readonly group = new THREE.Group();
  readonly yaw: number;
  readonly cars: CarBox[];
  readonly ceiling = CAR_H;
  held = -1;
  onDoor: ((car: number, opening: boolean) => void) | null = null;
  private open = 0;
  private want = 0;
  private dwell = 0;
  private called = 0;
  private readonly leaves: THREE.Object3D[] = [];
  private readonly doorBox: Box | null;
  private readonly centreAt: { x: number; z: number };

  constructor(
    readonly spec: LiftBank,
    private readonly door: Doorway,
    batch: Batch,
    glow: GlowMerge,
    mats: Mats,
    col: Collider,
    panels: THREE.Texture,
    private quality: Quality,
  ) {
    this.group.name = 'lifts:casino';
    this.yaw = (spec.r / 256) * Math.PI * 2;
    const x0 = door.x - door.width / 2 - SIDE;
    const x1 = door.x + door.width / 2 + SIDE;
    const z0 = door.z + WALL;
    const z1 = z0 + CAR_D;
    const box = (m: string, a: number, b: number, y0: number, y1: number, c: number, d: number, uv?: number) => batch.box(mats.get(m), (a + b) / 2, (y0 + y1) / 2, (c + d) / 2, b - a, y1 - y0, d - c, uv);
    // the car: floor, walls panelled in the wainscot, a mirror and a rail on the back, a lit ceiling
    box('lift-floor', x0 + SIDE, x1 - SIDE, 0, 0.012, z0 + 0.005, z1, 0.9);
    box('wainscot', x0, x0 + SIDE, 0, CAR_H, z0, z1 + 0.1, 1.4);
    box('wainscot', x1 - SIDE, x1, 0, CAR_H, z0, z1 + 0.1, 1.4);
    box('wainscot', x0 + SIDE, x1 - SIDE, 0, CAR_H, z1, z1 + 0.1, 1.4);
    box('marble-black', x0, x1, CAR_H, CAR_H + 0.1, z0, z1 + 0.1, 1.2);
    box('mirror', door.x - 0.9, door.x + 0.9, 0.95, 2.25, z1 - 0.008, z1);
    box('steel', door.x - 1.0, door.x + 1.0, 0.9, 0.94, z1 - 0.09, z1 - 0.05);
    for (const s of [-1, 1]) box('steel', door.x + s * 0.98 - 0.02, door.x + s * 0.98 + 0.02, 0.9, 0.94, z1 - 0.05, z1);
    glow.add(new THREE.BoxGeometry(door.width - 0.8, 0.012, CAR_D - 0.6), GLOW.soft, { x: door.x, y: CAR_H - 0.006, z: (z0 + z1) / 2 });
    // the car's floor panel, on the wall's inside beside the door
    const cop = new THREE.PlaneGeometry(0.25, 0.35);
    const uv = cop.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.36, uv.getY(i) * 0.5);
    const copMesh = new THREE.Mesh(cop, new THREE.MeshBasicMaterial({ map: panels, color: new THREE.Color(1, 1, 1).multiplyScalar(1.35) }));
    copMesh.position.set(door.x + door.width / 2 - 0.02 + 0.0, 1.28, z0 + 0.006);
    copMesh.position.x = x1 - SIDE - 0.2;
    copMesh.name = 'lift-panel';
    this.group.add(copMesh);
    // what the walker and the camera bump into: the car's walls, and the doors while shut (the
    // plan's own box in the doorway, which kept the street doors closed, now follows the leaves)
    col.box(x0 + SIDE / 2, (z0 + z1) / 2, SIDE, CAR_D + 0.1, 0, CAR_H);
    col.box(x1 - SIDE / 2, (z0 + z1) / 2, SIDE, CAR_D + 0.1, 0, CAR_H);
    col.box(door.x, z1 + 0.05, x1 - x0, 0.1, 0, CAR_H);
    this.doorBox = doorwayBox(col, door);
    if (!this.doorBox) console.warn('the entrance doors found no box in their doorway: they will never let anyone through');
    const c = carCentre(spec, 0);
    this.centreAt = { x: c.x / 100, z: c.z / 100 };
    this.cars = [{ x0: x0 + SIDE, x1: x1 - SIDE, z0, z1 }];
  }

  /** The two leaves of the street doors' model, split at their seam; resolves when they stand. */
  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(await modelBytes(MODEL_BASE + 'door.glb'), MODEL_BASE);
    gltf.scene.updateMatrixWorld(true);
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // read everything out as plain floats first: the model's positions are quantized (normalized
      // shorts), and a matrix applied to them in place would overflow
      const geo = mesh.geometry;
      const index = geo.index;
      const total = index ? index.count : geo.getAttribute('position').count;
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: total, materialIndex: 0 }];
      const normalM = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const v = new THREE.Vector3();
      for (const g of groups) {
        const part = new THREE.BufferGeometry();
        const pos = new Float32Array(g.count * 3);
        const nor = new Float32Array(g.count * 3);
        const uvs = new Float32Array(g.count * 2);
        const P = geo.getAttribute('position');
        const N = geo.getAttribute('normal');
        const U = geo.getAttribute('uv');
        for (let i = 0; i < g.count; i++) {
          const k = index ? index.getX(g.start + i) : g.start + i;
          v.set(P.getX(k), P.getY(k), P.getZ(k)).applyMatrix4(mesh.matrixWorld);
          pos.set([v.x, v.y, v.z], i * 3);
          if (N) {
            v.set(N.getX(k), N.getY(k), N.getZ(k)).applyMatrix3(normalM).normalize();
            nor.set([v.x, v.y, v.z], i * 3);
          }
          if (U) uvs.set([U.getX(k), U.getY(k)], i * 2);
        }
        part.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        if (N) part.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        else part.computeVertexNormals();
        if (U) part.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        parts.push({ geo: part, mat: mats[g.materialIndex ?? 0]! });
      }
    });
    // stood on its base, centred, the doorway's height, turned to face the lobby (as the floor had it)
    const bb = new THREE.Box3();
    for (const p of parts) {
      p.geo.computeBoundingBox();
      bb.union(p.geo.boundingBox!);
    }
    const s = this.door.height / (bb.max.y - bb.min.y);
    const place = new THREE.Matrix4()
      .makeRotationY(Math.PI)
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
    for (const side of [-1, 1] as const) {
      const leaf = new THREE.Group();
      leaf.name = `entrance-leaf-${side < 0 ? 'west' : 'east'}`;
      for (const p of parts) {
        const g = p.geo.clone().applyMatrix4(place);
        const pos = g.getAttribute('position');
        // this leaf's triangles: those whose middle is on its side of the seam
        const keep: number[] = [];
        for (let i = 0; i < pos.count; i += 3) {
          const mx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
          if (mx * side >= 0) keep.push(i, i + 1, i + 2);
        }
        const out = new THREE.BufferGeometry();
        for (const name of Object.keys(g.attributes)) {
          const a = g.getAttribute(name);
          const arr = new Float32Array(keep.length * a.itemSize);
          keep.forEach((v, j) => {
            for (let k = 0; k < a.itemSize; k++) arr[j * a.itemSize + k] = a.getComponent(v, k);
          });
          out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
        }
        g.dispose();
        if (keep.length === 0) continue;
        const mesh = new THREE.Mesh(out, this.materialFor(p.mat));
        mesh.userData.source = p.mat;
        leaf.add(mesh);
      }
      leaf.userData.side = side;
      this.leaves.push(leaf);
      this.group.add(leaf);
    }
    for (const p of parts) p.geo.dispose();
    this.place();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    for (const leaf of this.leaves) leaf.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.source) mesh.material = this.materialFor(mesh.userData.source as THREE.Material);
    });
  }

  private readonly lambert = new Map<THREE.Material, THREE.Material>();

  private materialFor(src: THREE.Material): THREE.Material {
    if (this.quality === 'high') return src;
    let m = this.lambert.get(src);
    if (!m) {
      const s = src as THREE.MeshStandardMaterial;
      m = new THREE.MeshLambertMaterial({ color: s.color, map: s.map ?? null });
      this.lambert.set(src, m);
    }
    return m;
  }

  carAt(x: number, z: number, margin = 0): number {
    const c = this.cars[0]!;
    return x >= c.x0 - margin && x <= c.x1 + margin && z >= c.z0 - margin && z <= c.z1 + margin ? 0 : -1;
  }

  centre(): { x: number; z: number } {
    return this.centreAt;
  }

  doorway(): { x: number; z: number } {
    return { x: this.door.x, z: this.door.z - WALL - 0.1 };
  }

  nearest(x: number, z: number): { car: number; d: number } {
    const w = this.doorway();
    return { car: 0, d: Math.hypot(w.x - x, w.z - z) };
  }

  call(): void {
    this.called = 4;
  }

  isOpen(): boolean {
    return this.open >= 0.72;
  }

  isShut(): boolean {
    return this.open <= 0.001;
  }

  shut(): void {
    this.open = 0;
    this.want = 0;
    this.dwell = 0;
    this.place();
  }

  update(dt: number, people: Iterable<{ x: number; z: number }>): void {
    const w = this.doorway();
    let near = false;
    for (const p of people) if (this.carAt(p.x, p.z, 0.05) >= 0 || Math.hypot(w.x - p.x, w.z - p.z) < SENSE) near = true;
    this.called = Math.max(0, this.called - dt);
    this.dwell = near || this.called > 0 ? DWELL_S : Math.max(0, this.dwell - dt);
    const want = this.held === 0 ? 0 : this.dwell > 0 ? 1 : 0;
    if (want !== this.want) {
      this.want = want;
      this.onDoor?.(0, want === 1);
    }
    const next = want > this.open ? Math.min(1, this.open + dt / OPEN_S) : Math.max(0, this.open - dt / CLOSE_S);
    if (next === this.open) return;
    this.open = next;
    if (this.doorBox) {
      this.doorBox.walk = next < 0.72;
      this.doorBox.cam = next < 0.3;
    }
    this.place();
  }

  /** The leaves slide apart into the wall, eased like a real operator. */
  private place(): void {
    const k = this.open * this.open * (3 - 2 * this.open);
    for (const leaf of this.leaves) leaf.position.set(this.door.x + (leaf.userData.side as number) * k * (this.door.width / 2 - 0.04), 0, this.door.z + 0.05);
  }

  dispose(): void {
    for (const leaf of this.leaves) leaf.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
    for (const m of this.lambert.values()) m.dispose();
    this.group.removeFromParent();
  }
}
