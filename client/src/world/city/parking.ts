// The cars on the ground floor: parked in the valet's stalls, and driving along the street.
// `parkedCars()` is the one place parked cars are made: the cars slice's models (world/cars/),
// merged into one mesh per material for the whole lot. The street's traffic is a few of the same
// models, instanced, driven along its lanes, stopping for anyone on the crosswalk.

import * as THREE from 'three';
import type { Mats } from '../materials.ts';
import type { Collider } from '../collision.ts';
import { rng } from './sky.ts';
import type { Stall } from './plan.ts';
import { CarFleet, lotCars } from '../cars/lot.ts'; // v6 cars6: the car models
import { carMaterials } from '../cars/materials.ts'; // v6 cars6

/** How long a car on the street is (m), for the gaps between them (v6 cars6: the longest of TRAFFIC). */
const CAR = { l: 5.5 };

const PAINTS = ['#0e0f12', '#f0efe8', '#9a9ea6', '#5a0f16', '#1a2442', '#c8b89a', '#2a2c30', '#e4e2da', '#3a4a3a', '#101826'];

/**
 * Parked cars in some of the stalls (a seeded share of them, the same for everyone), each with a
 * collision box. Returns the group to add and a dispose.
 */
export function parkedCars(stalls: Stall[], mats: Mats, col: Collider, seed: number, fill = 0.78): { group: THREE.Group; dispose(): void } {
  // v6 cars6: the cars slice's models (world/cars/lot.ts): one merged mesh per material for the whole lot
  return lotCars(stalls, carMaterials(mats.quality), { seed, fill, collider: col });
}

interface Lane {
  x: number;
  /** +1 drives south (+z), -1 north. */
  dir: 1 | -1;
  speed: number;
}

interface Mover {
  lane: Lane;
  z: number;
  v: number;
  // v6 cars6: which model, and its paint
  kind?: number;
  paint?: string;
}

/** v6 cars6: the models on the street (world/cars/specs.ts). */
const TRAFFIC = ['aurelian-saloon', 'ardent-overland', 'stallard-440'];

/**
 * Cars driving the street: a few per lane, spaced out, looping from one end of the zone to the
 * other (they drive out of sight behind the backdrop's ends). Each keeps its distance from the car
 * ahead and stops short of anyone on the roadway in front of it.
 */
export class Traffic {
  readonly group = new THREE.Group();
  private readonly movers: Mover[] = [];
  private readonly fleets: CarFleet[];
  private readonly slots: number[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly p = new THREE.Vector3();

  constructor(
    lanes: { x: number; dir: 1 | -1 }[],
    private readonly z0: number,
    private readonly z1: number,
    private readonly road: { x0: number; x1: number },
    mats: Mats,
    seed: number,
    perLane = 3,
  ) {
    const rnd = rng(seed);
    for (const l of lanes) {
      const lane: Lane = { ...l, speed: 9 + rnd() * 4 };
      for (let k = 0; k < perLane; k++) this.movers.push({ lane, z: z0 + ((k + rnd() * 0.4) / perLane) * (z1 - z0), v: lane.speed });
    }
    // v6 cars6: the cars slice's models, a fleet (instanced, lamps lit) per kind on the road
    const cm = carMaterials(mats.quality);
    this.movers.forEach((a, i) => (a.kind = i % TRAFFIC.length));
    this.fleets = TRAFFIC.map((id, k) => new CarFleet(id, this.movers.filter((a) => a.kind === k).length, cm));
    this.slots = this.movers.map((a) => this.movers.filter((b) => b.kind === a.kind).indexOf(a));
    this.movers.forEach((a, i) => (a.paint = PAINTS[Math.floor(rnd() * PAINTS.length)]!));
    this.group.name = 'traffic';
    for (const f of this.fleets) this.group.add(f.group);
    this.write(true);
  }

  /** Move everyone along; `people` are those who might be on the roadway (m). */
  update(dt: number, people: Iterable<{ x: number; z: number }>): void {
    const onRoad: { x: number; z: number }[] = [];
    for (const p of people) if (p.x > this.road.x0 - 0.6 && p.x < this.road.x1 + 0.6) onRoad.push({ x: p.x, z: p.z });
    const len = this.z1 - this.z0;
    for (const a of this.movers) {
      const d = a.lane.dir;
      // the gap to whatever is ahead: the next car in the lane, or a person in its path
      let gap = Infinity;
      for (const b of this.movers) {
        if (b === a || b.lane !== a.lane) continue;
        const ahead = (((b.z - a.z) * d) % len + len) % len;
        if (ahead > 0) gap = Math.min(gap, ahead - CAR.l - 2.5);
      }
      for (const p of onRoad) {
        if (Math.abs(p.x - a.lane.x) > 2.2) continue;
        const ahead = (p.z - a.z) * d;
        if (ahead > 0 && ahead < 26) gap = Math.min(gap, ahead - CAR.l / 2 - 2.2);
      }
      // ease toward the lane's speed, or down to a stop short of the gap
      const want = gap <= 0 ? 0 : Math.min(a.lane.speed, Math.sqrt(2 * 4.5 * gap));
      a.v += (want - a.v) * Math.min(1, dt * (want < a.v ? 5 : 1.2));
      a.z += a.v * dt * d;
      if (a.z > this.z1) a.z -= len;
      if (a.z < this.z0) a.z += len;
    }
    this.write();
  }

  private write(paint = false): void {
    this.movers.forEach((a, i) => {
      this.m.compose(this.p.set(a.lane.x, 0, a.z), this.q.setFromAxisAngle(this.up, a.lane.dir > 0 ? 0 : Math.PI), this.one);
      this.fleets[a.kind!]!.place(this.slots[i]!, this.m, paint ? a.paint : undefined);
    });
  }

  dispose(): void {
    for (const f of this.fleets) f.dispose();
  }
}
