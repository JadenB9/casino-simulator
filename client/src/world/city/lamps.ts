// 1.3: the street lamps, as things a car can knock over. Every lamp is one instance of a pole
// (base, pole, arm and head in one geometry) and one of its glowing face, so the lot are two draw
// calls; a car on the road that runs into one at speed tips it over the way it was going, and it
// falls like a felled mast and lies in the road, dark, until the city stands it back up a while
// later (when nobody's on top of it). Each player's own screen sees the cars it draws hit them.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hdr, type Mats } from '../materials.ts';
import type { Collider, Post } from '../collision.ts';
import type { RoadCar } from './parking.ts';

/** Where a lamp stands, and which way its arm reaches over the road (a unit vector). */
export interface LampSpec {
  x: number;
  z: number;
  ax: number;
  az: number;
}

const H = 7.2;
const REACH = 2.4;
/** Slower than this (m/s) a car only nudges a lamp (it stops against it, as against any post). */
const KNOCK_V = 2.5;
/** How far ahead of touching a car knocks it over (m), so it's gone before the car stops against it. */
const MARGIN = 0.45;
/** A felled lamp is stood back up after this long (s), once nothing is on it. */
const BACK_S = 90;
/** A pole's fall: g, and half its length, for a rod tipping about its foot. */
const G = 9.8;

interface Lamp extends LampSpec {
  yaw: number;
  post: Post | null;
  /** Tipped this far from upright (radians, 0 standing, PI/2 on the ground) and how fast. */
  tilt: number;
  spin: number;
  /** Which way it falls (a unit vector on the ground). */
  fx: number;
  fz: number;
  down: number;
}

export class StreetLamps {
  readonly group = new THREE.Group();
  private readonly lamps: Lamp[];
  private readonly poles: THREE.InstancedMesh;
  private readonly faces: THREE.InstancedMesh;
  private readonly faceMat = new THREE.MeshBasicMaterial({ color: hdr('#ffcf8a', 2.6) });
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qy = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly at = new THREE.Vector3();

  constructor(
    specs: readonly LampSpec[],
    mats: Mats,
    private readonly col: Collider,
  ) {
    this.group.name = 'street-lamps';
    this.lamps = specs.map((s) => ({ ...s, yaw: Math.atan2(s.ax, s.az), post: col.post(s.x, s.z, 0.2, H), tilt: 0, spin: 0, fx: 0, fz: 1, down: 0 }));
    // the lamp as streets.ts drew it, in its own space: standing at the origin, its arm along +z
    const parts = [
      new THREE.CylinderGeometry(0.08, 0.11, H, 10).translate(0, H / 2, 0),
      new THREE.CylinderGeometry(0.2, 0.2, 0.6, 12).translate(0, 0.3, 0),
      new THREE.BoxGeometry(0.1, 0.08, REACH).translate(0, H - 0.04, REACH / 2),
      new THREE.BoxGeometry(0.36, 0.18, 0.72).translate(0, H - 0.15, REACH),
    ].map((g) => g.toNonIndexed());
    const pole = mergeGeometries(parts)!;
    for (const g of parts) g.dispose();
    this.poles = new THREE.InstancedMesh(pole, mats.get('steel'), this.lamps.length);
    const face = new THREE.BoxGeometry(0.3, 0.01, 0.62).translate(0, H - 0.245, REACH);
    this.faceMat.name = 'street-lamp-face';
    this.faces = new THREE.InstancedMesh(face, this.faceMat, this.lamps.length);
    // (spread round the whole block: always drawn, as the static street is)
    this.poles.frustumCulled = false;
    this.faces.frustumCulled = false;
    this.group.add(this.poles, this.faces);
    this.lamps.forEach((_, i) => this.place(i));
  }

  /** Every frame on the ground floor: the cars on the road knock lamps over; felled ones fall, and come back. */
  update(dt: number, cars: readonly RoadCar[]): void {
    this.lamps.forEach((l, i) => {
      if (l.post) {
        for (const c of cars) if (Math.abs(c.v) >= KNOCK_V && this.hits(c, l)) this.knock(l, c);
        if (l.post) return;
      }
      if (l.tilt < Math.PI / 2) {
        // a rod tipping about its foot: faster the further it leans
        l.spin += ((3 * G) / (2 * H)) * Math.sin(Math.max(l.tilt, 0.02)) * dt;
        l.tilt = Math.min(Math.PI / 2 - 0.03, l.tilt + l.spin * dt);
        if (l.tilt >= Math.PI / 2 - 0.03) l.tilt = Math.PI / 2;
        this.place(i);
        return;
      }
      if ((l.down += dt) >= BACK_S && !cars.some((c) => Math.hypot(c.x - l.x, c.z - l.z) < H + 3)) this.standUp(i);
    });
  }

  /** How many are down (for the look scripts). */
  get felled(): number {
    return this.lamps.filter((l) => !l.post).length;
  }

  /** The standing lamp nearest a point (the look scripts). */
  nearest(x: number, z: number): { x: number; z: number } | null {
    let best: Lamp | null = null;
    for (const l of this.lamps) if (l.post && (!best || Math.hypot(l.x - x, l.z - z) < Math.hypot(best.x - x, best.z - z))) best = l;
    return best ? { x: best.x, z: best.z } : null;
  }

  /** A car's box, grown by MARGIN, over the pole's foot. */
  private hits(c: RoadCar, l: Lamp): boolean {
    const dx = l.x - c.x;
    const dz = l.z - c.z;
    if (dx * dx + dz * dz > (c.hl + 2) ** 2) return false;
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    return Math.abs(dx * fx + dz * fz) < c.hl + 0.2 + MARGIN && Math.abs(dx * fz - dz * fx) < c.hw + 0.2 + MARGIN;
  }

  private knock(l: Lamp, c: RoadCar): void {
    if (l.post) this.col.remove(l.post);
    l.post = null;
    // over the way the car was going, a little away from its middle
    const s = Math.sign(c.v) || 1;
    let fx = Math.sin(c.yaw) * s + (l.x - c.x) * 0.15;
    let fz = Math.cos(c.yaw) * s + (l.z - c.z) * 0.15;
    const n = Math.hypot(fx, fz) || 1;
    fx /= n;
    fz /= n;
    l.fx = fx;
    l.fz = fz;
    l.tilt = 0.04;
    // hit harder, it goes over faster
    l.spin = Math.min(1.6, Math.abs(c.v) * 0.05);
    l.down = 0;
  }

  private standUp(i: number): void {
    const l = this.lamps[i]!;
    l.tilt = 0;
    l.spin = 0;
    l.down = 0;
    l.post = this.col.post(l.x, l.z, 0.2, H);
    this.place(i);
  }

  /** Its matrix: stood at its foot, turned to its arm, tipped over the way it falls. */
  private place(i: number): void {
    const l = this.lamps[i]!;
    this.qy.setFromAxisAngle(this.axis.set(0, 1, 0), l.yaw);
    // up turned toward (fx, fz): about the ground's line across the fall
    this.q.setFromAxisAngle(this.axis.set(l.fz, 0, -l.fx), l.tilt).multiply(this.qy);
    this.m.compose(this.at.set(l.x, 0, l.z), this.q, this.one);
    this.poles.setMatrixAt(i, this.m);
    // a felled lamp is dark
    if (l.post || l.tilt === 0) this.faces.setMatrixAt(i, this.m);
    else this.faces.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    this.poles.instanceMatrix.needsUpdate = true;
    this.faces.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const l of this.lamps) if (l.post) this.col.remove(l.post);
    this.poles.geometry.dispose();
    this.faces.geometry.dispose();
    this.faceMat.dispose();
    this.poles.dispose();
    this.faces.dispose();
  }
}
