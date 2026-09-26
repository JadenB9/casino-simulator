// A bank of elevators (shared/src/lifts.ts says where): a front of black marble with a bronze
// portal round each car's opening, a floor indicator over each door and a call plate between
// them; behind each opening a car panelled in wood with a mirror, a brass rail and a lit ceiling;
// and the doors, two panels to a car that part in the middle and slide into the piers.
//
// The static pieces go into the zone's Batch (for the casino, the floor's own, in the lobby's
// room, so they cost no draw calls of their own and hide with the lobby); the door panels are one
// instanced mesh for the bank, and the indicators and the cars' button panels one mesh with one
// canvas. Each car's doors open for anyone standing at them or in the car (a sensor, as real ones
// have), unless the car is taking someone somewhere.

import * as THREE from 'three';
import type { Batch } from '../batch.ts';
import type { GlowMerge } from '../lighting.ts';
import type { Mats } from '../materials.ts';
import type { Collider, Box } from '../collision.ts';
import { GLOW } from '../lighting.ts';
import { CAR_DEPTH_CM, CAR_DOOR_CM, CAR_PITCH_CM, carCentre, floorOf, type LiftBank } from '../../../../shared/src/lifts.ts';

/** Metres: the pitch of the cars, their door openings, how deep they are. */
export const PITCH = CAR_PITCH_CM / 100;
export const DOOR_W = CAR_DOOR_CM / 100;
export const DEPTH = CAR_DEPTH_CM / 100;
/** The front wall's thickness, the doors' height, the car's ceiling. */
const FRONT = 0.25;
export const DOOR_H = 2.25;
export const CAR_H = 2.45;
/** The end piers either side of the bank. */
const END = 0.4;
/** Doors this open (or more) let people through (v7: sooner, so a walk in never stops at the doors). */
const PASSABLE = 0.55;
/** Standing this near a car's doorway (m, either side) or inside the car opens its doors (v7: a stride sooner). */
const SENSE = 2.4;
const OPEN_S = 0.7;
const CLOSE_S = 1.3;
/** A door the sensor opened stays open this long after nobody is there. */
const DWELL_S = 1.6;

export interface CarBox {
  /** The car's floor, world metres (a rect, axis-aligned since banks face along x or z). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface BankOpts {
  /** How tall the front stands (the room's ceiling, or less for a free-standing bank). */
  height: number;
  /** The front's cladding and its portal trims (materials.ts names). */
  clad: string;
  trim: string;
  /** The doors' finish. */
  door: string;
}

/** Local (bank) to world: +z out of the doors, +x to the left looking out. */
function frame(b: LiftBank): THREE.Matrix4 {
  const yaw = (b.r / 256) * Math.PI * 2;
  return new THREE.Matrix4().makeRotationY(yaw).setPosition(b.x / 100, 0, b.z / 100);
}

/** What the city asks of an elevator: a bank of cars, or the casino's entrance doors (entrance.ts). */
export interface Lift {
  readonly spec: LiftBank;
  readonly group: THREE.Group;
  readonly yaw: number;
  readonly cars: CarBox[];
  /** The cars' ceiling (m), for the follow camera. */
  readonly ceiling: number;
  held: number;
  onDoor: ((car: number, opening: boolean) => void) | null;
  carAt(x: number, z: number, margin?: number): number;
  centre(i: number): { x: number; z: number };
  doorway(i: number): { x: number; z: number };
  nearest(x: number, z: number): { car: number; d: number };
  call(i: number): void;
  isOpen(i: number): boolean;
  isShut(i: number): boolean;
  shut(i: number): void;
  update(dt: number, people: Iterable<{ x: number; z: number }>): void;
  dispose(): void;
}

export class Bank implements Lift {
  readonly ceiling = CAR_H;
  readonly group = new THREE.Group();
  readonly yaw: number;
  readonly cars: CarBox[] = [];
  /** Each car's doors: how open (0..1), where they're going, and who holds them shut. */
  private readonly open: number[] = [];
  private readonly want: number[] = [];
  private readonly dwell: number[] = [];
  /** A car that's taking someone somewhere: its doors stay shut whoever stands there. */
  held = -1;
  /** A car whose doors were opened by a call (E): it stays open a while. */
  private called: number[] = [];
  private readonly doorBoxes: Box[] = [];
  private readonly doors: THREE.InstancedMesh;
  private readonly local: THREE.Matrix4;
  private readonly centres: { x: number; z: number }[] = [];
  private readonly m = new THREE.Matrix4();
  /** The doors' sliding hum and their chime (sound.ts), when there are ears. */
  onDoor: ((car: number, opening: boolean) => void) | null = null;

  constructor(
    readonly spec: LiftBank,
    batch: Batch,
    glow: GlowMerge,
    mats: Mats,
    col: Collider,
    opts: BankOpts,
    panels: THREE.Texture,
  ) {
    this.group.name = `lifts:${spec.zone}`;
    this.yaw = (spec.r / 256) * Math.PI * 2;
    this.local = frame(spec);
    const N = spec.cars;
    const span = N * PITCH + 2 * END;
    const clad = mats.get(opts.clad);
    const trim = mats.get(opts.trim);
    // the cars are panelled in the casino's wainscot
    const wood = mats.get('wainscot');
    const H = opts.height;
    const L = this.local;
    // a box in bank space: x from a to b, y, z
    const box = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, uv?: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      batch.add(g, mat, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).premultiply(L), uv);
    };
    // the cars' back wall; the end piers reach a little further, so no two backs share a plane
    const back = -DEPTH - 0.05;
    // car i's middle along the front, in bank space (+x is to the left looking out)
    const cx = (i: number) => -(i - (N - 1) / 2) * PITCH;
    // the ends: solid piers the full depth
    box(clad, span / 2 - END, span / 2, 0, H, back - 0.03, 0, 1.2);
    box(clad, -span / 2, -span / 2 + END, 0, H, back - 0.03, 0, 1.2);
    // the piers between the openings, and the lintel over them
    for (let i = 0; i <= N; i++) {
      const a = i === 0 ? -span / 2 + END : cx(N - i) + DOOR_W / 2;
      const c = i === N ? span / 2 - END : cx(N - 1 - i) - DOOR_W / 2;
      if (c - a > 0.01) box(clad, a, c, 0, DOOR_H, -FRONT, 0, 1.2);
    }
    box(clad, -span / 2 + END, span / 2 - END, DOOR_H, H, -FRONT, 0, 1.2);
    // a bronze cornice along the top, and the top closed over the cars
    box(trim, -span / 2 - 0.04, span / 2 + 0.04, H - 0.14, H, 0, 0.05);
    box(clad, -span / 2 + END, span / 2 - END, H - 0.1, H, back, -FRONT, 1.2);
    // the cars: walls between them (up to the ceiling slab), the back, the ceiling, the floor
    for (let i = 0; i <= N; i++) {
      const x = -(i - N / 2) * PITCH;
      box(wood, x - 0.1, x + 0.1, 0, CAR_H, back, -FRONT, 1.4);
    }
    box(wood, -N * PITCH / 2, N * PITCH / 2, 0, CAR_H, back, -DEPTH, 1.4);
    box(clad, -N * PITCH / 2, N * PITCH / 2, CAR_H, CAR_H + 0.1, back, -FRONT, 1.2);
    const mirror = mats.get('mirror');
    // matte in the car: a polished floor or chrome sill under the lobby's lights and the zone's sun
    // throws a specular hot spot at your feet, and the glow blooms it into a blob
    const steel = mats.get('steel');
    const floor = mats.get('lift-floor');
    for (let i = 0; i < N; i++) {
      const c = cx(i);
      const w = PITCH - 0.2;
      box(floor, c - w / 2, c + w / 2, 0, 0.012, -DEPTH, -FRONT + 0.001, 0.9);
      // the threshold plate in the doorway
      box(steel, c - DOOR_W / 2, c + DOOR_W / 2, 0, 0.014, -FRONT, 0.01);
      // bronze linings in the opening, over the piers' cut faces
      box(trim, c - DOOR_W / 2, c - DOOR_W / 2 + 0.025, 0, DOOR_H, -FRONT - 0.004, 0.035);
      box(trim, c + DOOR_W / 2 - 0.025, c + DOOR_W / 2, 0, DOOR_H, -FRONT - 0.004, 0.035);
      box(trim, c - DOOR_W / 2, c + DOOR_W / 2, DOOR_H - 0.025, DOOR_H, -FRONT - 0.004, 0.035);
      // the portal: a bronze architrave standing proud of the marble
      box(trim, c - DOOR_W / 2 - 0.12, c - DOOR_W / 2, 0, DOOR_H + 0.12, 0, 0.035);
      box(trim, c + DOOR_W / 2, c + DOOR_W / 2 + 0.12, 0, DOOR_H + 0.12, 0, 0.035);
      box(trim, c - DOOR_W / 2, c + DOOR_W / 2, DOOR_H, DOOR_H + 0.12, 0, 0.035);
      // inside: the mirror on the back wall, the rail, the lit ceiling
      box(mirror, c - 0.62, c + 0.62, 0.95, 2.2, -DEPTH, -DEPTH + 0.008);
      box(steel, c - 0.7, c + 0.7, 0.9, 0.94, -DEPTH + 0.05, -DEPTH + 0.09);
      box(steel, c - 0.66, c - 0.62, 0.9, 0.94, -DEPTH, -DEPTH + 0.05);
      box(steel, c + 0.62, c + 0.66, 0.9, 0.94, -DEPTH, -DEPTH + 0.05);
      glow.add(new THREE.BoxGeometry(w - 0.5, 0.012, DEPTH - FRONT - 0.5), GLOW.soft, new THREE.Matrix4().makeTranslation(c, CAR_H - 0.006, (-DEPTH - FRONT) / 2).premultiply(L));
      // the call plate's two buttons, right of the doors (a single car's too)
      const px = c - DOOR_W / 2 - 0.34;
      if (i === 0 || N === 1) {
        box(trim, px - 0.06, px + 0.06, 0.98, 1.3, 0, 0.012);
        for (const y of [1.2, 1.08]) glow.add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16).rotateX(Math.PI / 2), GLOW.warm, new THREE.Matrix4().makeTranslation(px, y, 0.018).premultiply(L));
      }
      // the hall lantern, a lit slit over the portal
      glow.add(new THREE.BoxGeometry(0.34, 0.02, 0.01), GLOW.shelf, new THREE.Matrix4().makeTranslation(c, DOOR_H + 0.52, 0.012).premultiply(L));
      this.open.push(0);
      this.want.push(0);
      this.dwell.push(0);
      this.called.push(0);
      const w0 = new THREE.Vector3(c - w / 2, 0, -DEPTH).applyMatrix4(L);
      const w1 = new THREE.Vector3(c + w / 2, 0, -FRONT).applyMatrix4(L);
      this.cars.push({ x0: Math.min(w0.x, w1.x), x1: Math.max(w0.x, w1.x), z0: Math.min(w0.z, w1.z), z1: Math.max(w0.z, w1.z) });
      const cc = carCentre(spec, i);
      this.centres.push({ x: cc.x / 100, z: cc.z / 100 });
    }
    // the indicators over the doors (the floor's letter and the arrows) and each car's button
    // panel inside, beside its door: one mesh, one canvas (panels(): top half the indicator,
    // bottom half the car panel)
    const planes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < N; i++) {
      const c = cx(i);
      const ind = new THREE.PlaneGeometry(0.56, 0.2);
      remapUv(ind, 0, 0.5, 1, 1);
      ind.translate(c, DOOR_H + 0.3, 0.038);
      planes.push(ind);
      const cop = new THREE.PlaneGeometry(0.25, 0.35);
      remapUv(cop, 0, 0, 0.36, 0.5);
      cop.rotateY(Math.PI);
      cop.translate(c + DOOR_W / 2 + 0.2, 1.28, -FRONT - 0.006);
      planes.push(cop);
    }
    const merged = mergePlanes(planes);
    merged.applyMatrix4(L);
    const signs = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ map: panels, color: new THREE.Color(1, 1, 1).multiplyScalar(1.35) }));
    signs.name = 'lift-panels';
    this.group.add(signs);

    // the doors: two brushed panels a car, parted from the middle
    const panelGeo = new THREE.BoxGeometry(DOOR_W / 2 + 0.01, DOOR_H - 0.01, 0.035);
    this.doors = new THREE.InstancedMesh(panelGeo, mats.get(opts.door), N * 2);
    this.doors.name = 'lift-doors';
    this.doors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.doors);
    this.writeDoors();
    this.doors.computeBoundingSphere();

    // what the walker and the camera bump into
    const wbox = (x0: number, x1: number, z0: number, z1: number, top: number, o: { walk?: boolean; cam?: boolean; bottom?: number } = {}) => {
      const p = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2).applyMatrix4(L);
      return col.box(p.x, p.z, x1 - x0, z1 - z0, this.yaw, top, o);
    };
    wbox(span / 2 - END, span / 2, back, 0, H);
    wbox(-span / 2, -span / 2 + END, back, 0, H);
    for (let i = 0; i <= N; i++) {
      const a = i === 0 ? -span / 2 + END : cx(N - i) + DOOR_W / 2;
      const c = i === N ? span / 2 - END : cx(N - 1 - i) - DOOR_W / 2;
      if (c - a > 0.01) wbox(a, c, -FRONT, 0, DOOR_H);
      const x = -(i - N / 2) * PITCH;
      wbox(x - 0.1, x + 0.1, back, -FRONT, CAR_H);
    }
    wbox(-span / 2, span / 2, -FRONT, 0, H, { walk: false, bottom: DOOR_H });
    wbox(-N * PITCH / 2, N * PITCH / 2, back, -DEPTH, CAR_H);
    for (let i = 0; i < N; i++) this.doorBoxes.push(wbox(cx(i) - DOOR_W / 2, cx(i) + DOOR_W / 2, -0.12, -0.05, DOOR_H));
  }

  /** The car a point stands in, or -1. */
  carAt(x: number, z: number, margin = 0): number {
    return this.cars.findIndex((c) => x >= c.x0 - margin && x <= c.x1 + margin && z >= c.z0 - margin && z <= c.z1 + margin);
  }

  /** The middle of car i's floor (world metres). */
  centre(i: number): { x: number; z: number } {
    return this.centres[i]!;
  }

  /** The middle of car i's doorway, on the hall side (world metres). */
  doorway(i: number): { x: number; z: number } {
    const p = new THREE.Vector3(-(i - (this.spec.cars - 1) / 2) * PITCH, 0, 0.1).applyMatrix4(this.local);
    return { x: p.x, z: p.z };
  }

  /** The car whose doorway is nearest (x, z), and how far. */
  nearest(x: number, z: number): { car: number; d: number } {
    let car = 0;
    let d = Infinity;
    for (let i = 0; i < this.spec.cars; i++) {
      const w = this.doorway(i);
      const k = Math.hypot(w.x - x, w.z - z);
      if (k < d) {
        d = k;
        car = i;
      }
    }
    return { car, d };
  }

  /** Open a car's doors for a while (a call from the hall). */
  call(i: number): void {
    this.called[i] = 4;
  }

  isOpen(i: number): boolean {
    return (this.open[i] ?? 0) >= PASSABLE;
  }

  isShut(i: number): boolean {
    return (this.open[i] ?? 0) <= 0.001;
  }

  /** Snap a car's doors shut (arriving: they open once the car has "stopped"). */
  shut(i: number): void {
    this.open[i] = 0;
    this.want[i] = 0;
    this.dwell[i] = 0;
    this.writeDoors();
  }

  /** Every frame: the sensors (people at or in each car), the doors' travel, the collision. */
  update(dt: number, people: Iterable<{ x: number; z: number }>): void {
    const N = this.spec.cars;
    const near = new Array<boolean>(N).fill(false);
    for (const p of people) {
      const inCar = this.carAt(p.x, p.z, 0.05);
      if (inCar >= 0) near[inCar] = true;
      for (let i = 0; i < N; i++) {
        const w = this.doorway(i);
        if (Math.hypot(w.x - p.x, w.z - p.z) < SENSE) near[i] = true;
      }
    }
    let moved = false;
    for (let i = 0; i < N; i++) {
      this.called[i] = Math.max(0, this.called[i]! - dt);
      if (near[i] || this.called[i]! > 0) this.dwell[i] = DWELL_S;
      else this.dwell[i] = Math.max(0, this.dwell[i]! - dt);
      const want = i === this.held ? 0 : this.dwell[i]! > 0 ? 1 : 0;
      if (want !== this.want[i]) {
        this.want[i] = want;
        this.onDoor?.(i, want === 1);
      }
      const o = this.open[i]!;
      const next = want > o ? Math.min(1, o + dt / OPEN_S) : Math.max(0, o - dt / CLOSE_S);
      if (next !== o) {
        this.open[i] = next;
        moved = true;
      }
      const b = this.doorBoxes[i]!;
      b.walk = next < PASSABLE;
      b.cam = next < 0.3;
    }
    if (moved) this.writeDoors();
  }

  private writeDoors(): void {
    const N = this.spec.cars;
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const c = -(i - (N - 1) / 2) * PITCH;
      // eased: quick to start, settling at the end (a real operator's S-curve)
      const t = this.open[i]!;
      const k = t * t * (3 - 2 * t);
      const slide = k * (DOOR_W / 2 - 0.02);
      for (const side of [-1, 1]) {
        p.set(c + side * (DOOR_W / 4 + slide), DOOR_H / 2, -0.085);
        this.m.compose(p, q, s).premultiply(this.local);
        this.doors.setMatrixAt(i * 2 + (side < 0 ? 0 : 1), this.m);
      }
    }
    this.doors.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.doors.geometry.dispose();
    this.group.removeFromParent();
  }
}

/** Map a plane's UVs onto part of a canvas (u0..u1, v0..v1). */
function remapUv(g: THREE.BufferGeometry, u0: number, v0: number, u1: number, v1: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
}

function mergePlanes(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const g of list) {
    const n = g.toNonIndexed();
    pos.push(...(n.getAttribute('position').array as Float32Array));
    uv.push(...(n.getAttribute('uv').array as Float32Array));
    g.dispose();
    n.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

/**
 * The canvas behind the indicators and the car panels: the top half the indicator over the doors
 * (the floor's letter in amber segments, up and down arrows), the bottom-left a brushed plate
 * with the floors' buttons, this floor's ring lit.
 */
export function panelTexture(zone: LiftBank['zone']): THREE.CanvasTexture {
  const W = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = W;
  const g = c.getContext('2d')!;
  const here = floorOf(zone);
  // indicator: dark glass, a bronze bezel, the letter
  g.fillStyle = '#6a4a2a';
  g.fillRect(0, 0, W, W / 2);
  g.fillStyle = '#0a0706';
  g.fillRect(8, 8, W - 16, W / 2 - 16);
  g.fillStyle = '#ffa53a';
  g.font = `700 ${Math.round(W * 0.26)}px DSEG7, ui-monospace, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(here.key, W / 2, W / 4 + 4);
  const arrow = (x: number, up: boolean, on: boolean) => {
    g.fillStyle = on ? '#ffb04a' : '#3a2412';
    g.beginPath();
    const y = W / 4;
    const s = up ? -1 : 1;
    g.moveTo(x - 26, y - s * 16);
    g.lineTo(x + 26, y - s * 16);
    g.lineTo(x, y + s * 22);
    g.closePath();
    g.fill();
  };
  arrow(76, true, zone !== 'roof');
  arrow(W - 76, false, zone !== 'ground');
  // the car panel (bottom-left, 0.36 x 0.5 of the canvas: 184 x 256 px)
  const px = 0;
  const py = W / 2;
  const pw = Math.round(W * 0.36);
  const ph = W / 2;
  g.fillStyle = '#9a9ca2';
  g.fillRect(px, py, pw, ph);
  for (let y = py; y < py + ph; y += 2) {
    g.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    g.fillRect(px, y, pw, 1);
  }
  g.strokeStyle = '#5a5c62';
  g.lineWidth = 4;
  g.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
  const floors = ['R', 'C', 'G'];
  floors.forEach((k, i) => {
    const bx = px + pw / 2;
    const by = py + 60 + i * 64;
    g.beginPath();
    g.arc(bx, by, 22, 0, Math.PI * 2);
    g.fillStyle = '#2a2b2e';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = k === here.key ? '#ffb04a' : '#c8cacf';
    g.stroke();
    g.fillStyle = '#e8e9ec';
    g.font = '600 24px "Barlow Condensed", Arial, sans-serif';
    g.fillText(k, bx, by + 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
