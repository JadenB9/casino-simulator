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
import { LANES, laneAt, laneLength, onLoopRoad } from './loop.ts';

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

/** v7: a car on the road, as the traffic hands it to whoever asks (the driving and the knocks). */
export interface RoadCar {
  x: number;
  z: number;
  yaw: number;
  /** m/s along its heading. */
  v: number;
  /** Half its length and width (m). */
  hl: number;
  hw: number;
}

/** What a knock from a car tells the city: who it hit, which way it pushes them, and how fast it was going. */
export interface Knock {
  x: number;
  z: number;
  /** Unit vector the push goes (away from the car). */
  dx: number;
  dz: number;
  speed: number;
}

interface Lane {
  /** Offset from the loop's centre line (outward +), and which way round it drives. */
  o: number;
  dir: 1 | -1;
  speed: number;
  len: number;
}

interface Mover {
  lane: Lane;
  s: number;
  v: number;
  kind: number;
  paint: string;
  /** Pulled up after a knock or a crash: seconds before it moves off again. */
  held: number;
  /** A horn already sounded for this hold. */
  honked: boolean;
  car: RoadCar;
}

/** v6 cars6: the models on the street (world/cars/specs.ts). */
const TRAFFIC = ['aurelian-saloon', 'ardent-overland', 'stallard-440'];
/** v7: how hard a car can brake (m/s²): someone who steps out right in front of one gets hit. */
const BRAKE = 6.5;
/** How far ahead a driver watches the lane (m), and how wide it is (m either side of the car's middle). */
const LOOK = 22;
const LANE_HALF = 1.5;
/** How long a car stays put after hitting someone or something (s). */
const HOLD_S = 2.4;

/**
 * v7: cars driving the loop road (loop.ts), one or two per lane: the outer lanes down the street
 * the way its southbound lanes always went, the inner ones the other way round. Each keeps its
 * distance from the car ahead and brakes for anyone in its lane ahead, as hard as a car can; step
 * out too close in front of one and it hits you (`onKnock`: the city knocks the walker down), then
 * it stops, sounds its horn and drives on. Anything else on the road (a driven car: `obstacles`)
 * is braked for the same way, and a car that runs into one is a crash (`onCrash`).
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
  /** A car hit someone on foot (the walker: world/drive/ knocks them down). */
  onKnock: ((k: Knock) => void) | null = null;
  /** A car ran into something on the road (a driven car), at this closing speed. */
  onCrash: ((car: RoadCar, speed: number, at: { x: number; z: number }) => void) | null = null;
  /** A horn, from a car that pulled up (for the sound). */
  onHorn: ((at: { x: number; z: number }) => void) | null = null;

  constructor(mats: Mats, seed: number, perLane = 1) {
    const rnd = rng(seed);
    for (const o of LANES) {
      const dir: 1 | -1 = o > 0 ? 1 : -1;
      const lane: Lane = { o, dir, speed: 9 + rnd() * 3.5, len: laneLength(o) };
      for (let k = 0; k < perLane; k++) {
        const s = ((k + rnd() * 0.5) / perLane) * lane.len;
        this.movers.push({ lane, s, v: lane.speed, kind: 0, paint: '#000', held: 0, honked: false, car: { x: 0, z: 0, yaw: 0, v: 0, hl: CAR.l / 2, hw: 1.0 } });
      }
    }
    // v6 cars6: the cars slice's models, a fleet (instanced, lamps lit) per kind on the road
    const cm = carMaterials(mats.quality);
    this.movers.forEach((a, i) => (a.kind = i % TRAFFIC.length));
    this.fleets = TRAFFIC.map((id, k) => new CarFleet(id, Math.max(1, this.movers.filter((a) => a.kind === k).length), cm));
    this.slots = this.movers.map((a) => this.movers.filter((b) => b.kind === a.kind).indexOf(a));
    this.movers.forEach((a) => (a.paint = PAINTS[Math.floor(rnd() * PAINTS.length)]!));
    this.group.name = 'traffic';
    for (const f of this.fleets) this.group.add(f.group);
    this.place();
    this.write(true);
  }

  /** The cars on the road now (for the driving: what a driven car can hit). */
  cars(): readonly RoadCar[] {
    return this.movers.map((a) => a.car);
  }

  /**
   * Move everyone along. `people` are those who might be on the road (m); `me` is the walker
   * (knocked when a car reaches them, unless null: driving, riding the elevator); `obstacles` are
   * other things on the road to brake for and crash into (a driven car's middle and its size).
   */
  update(dt: number, people: Iterable<{ x: number; z: number }>, me: { x: number; z: number } | null = null, obstacles: readonly RoadCar[] = []): void {
    const walkers: { x: number; z: number }[] = [];
    for (const p of people) if (onLoopRoad(p.x, p.z, 1.2)) walkers.push({ x: p.x, z: p.z });
    for (const a of this.movers) {
      const c = a.car;
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      if (a.held > 0) {
        a.held -= dt;
        a.v = 0;
        if (!a.honked && a.held < HOLD_S - 0.5) {
          a.honked = true;
          this.onHorn?.({ x: c.x, z: c.z });
        }
        continue;
      }
      // the gap to whatever is ahead: the next car in the lane, anyone in its path
      let gap = Infinity;
      for (const b of this.movers) {
        if (b === a || b.lane !== a.lane) continue;
        const ahead = ((((b.s - a.s) * a.lane.dir) % a.lane.len) + a.lane.len) % a.lane.len;
        if (ahead > 0) gap = Math.min(gap, ahead - CAR.l - 2.5);
      }
      const ahead = (x: number, z: number, half: number) => {
        const dx = x - c.x;
        const dz = z - c.z;
        const along = dx * fx + dz * fz;
        if (along <= 0 || along > LOOK) return;
        if (Math.abs(dx * fz - dz * fx) > LANE_HALF + half) return;
        gap = Math.min(gap, along - c.hl - half - 0.8);
      };
      for (const p of walkers) ahead(p.x, p.z, 0.3);
      for (const o of obstacles) ahead(o.x, o.z, o.hw);
      // ease toward the lane's speed, or brake (no harder than a car can) for the gap
      const want = gap <= 0 ? 0 : Math.min(a.lane.speed, Math.sqrt(2 * BRAKE * gap));
      const k = want < a.v ? Math.min(a.v - want, BRAKE * dt) : Math.min(want - a.v, 2.2 * dt);
      a.v += want < a.v ? -k : k;
      a.s += a.v * dt * a.lane.dir;
      a.s = ((a.s % a.lane.len) + a.lane.len) % a.lane.len;
    }
    this.place();
    // what the cars ran into
    for (const a of this.movers) {
      const c = a.car;
      if (me && a.v > 1.2 && touches(c, me.x, me.z, 0.32)) {
        const fx = Math.sin(c.yaw);
        const fz = Math.cos(c.yaw);
        // pushed ahead of the car and off to whichever side you stood
        const side = (me.x - c.x) * fz - (me.z - c.z) * fx >= 0 ? 1 : -1;
        const dx = fx * 0.8 + fz * side * 0.6;
        const dz = fz * 0.8 - fx * side * 0.6;
        const n = Math.hypot(dx, dz) || 1;
        this.onKnock?.({ x: me.x, z: me.z, dx: dx / n, dz: dz / n, speed: a.v });
        this.stop(a);
      }
      for (const o of obstacles) {
        if (Math.hypot(o.x - c.x, o.z - c.z) > c.hl + o.hl + 0.5) continue;
        if (!boxesTouch(c, o)) continue;
        const rel = Math.abs(a.v - o.v * Math.cos(o.yaw - c.yaw));
        if (a.v > 0.5 || rel > 0.5) this.onCrash?.(c, rel, { x: (c.x + o.x) / 2, z: (c.z + o.z) / 2 });
        this.stop(a);
      }
    }
    this.write();
  }

  private stop(a: Mover): void {
    if (a.held > 0) return;
    a.held = HOLD_S;
    a.honked = false;
    a.v = 0;
    a.car.v = 0;
  }

  private place(): void {
    for (const a of this.movers) {
      const p = laneAt(a.lane.o, a.s, a.lane.dir);
      a.car.x = p.x;
      a.car.z = p.z;
      a.car.yaw = p.yaw;
      a.car.v = a.v;
    }
  }

  private write(paint = false): void {
    this.movers.forEach((a, i) => {
      this.m.compose(this.p.set(a.car.x, 0, a.car.z), this.q.setFromAxisAngle(this.up, a.car.yaw), this.one);
      this.fleets[a.kind]!.place(this.slots[i]!, this.m, paint ? a.paint : undefined);
    });
  }

  dispose(): void {
    for (const f of this.fleets) f.dispose();
  }
}

/** A circle (a person, radius r) against a car's footprint. */
export function touches(c: RoadCar, x: number, z: number, r: number): boolean {
  const fx = Math.sin(c.yaw);
  const fz = Math.cos(c.yaw);
  const dx = x - c.x;
  const dz = z - c.z;
  const along = dx * fx + dz * fz;
  const side = dx * fz - dz * fx;
  const ex = Math.max(0, Math.abs(along) - c.hl);
  const ez = Math.max(0, Math.abs(side) - c.hw);
  return ex * ex + ez * ez < r * r;
}

/** Two cars' footprints overlapping (separating axes on the four sides). */
export function boxesTouch(a: RoadCar, b: RoadCar): boolean {
  for (const c of [a, b]) {
    for (const [ax, az] of [
      [Math.sin(c.yaw), Math.cos(c.yaw)],
      [Math.cos(c.yaw), -Math.sin(c.yaw)],
    ] as const) {
      const project = (o: RoadCar) => {
        const ox = Math.sin(o.yaw);
        const oz = Math.cos(o.yaw);
        const centre = o.x * ax + o.z * az;
        const r = o.hl * Math.abs(ox * ax + oz * az) + o.hw * Math.abs(oz * ax - ox * az);
        return [centre - r, centre + r] as const;
      };
      const [a0, a1] = project(a);
      const [b0, b1] = project(b);
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}
