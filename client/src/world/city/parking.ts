// The cars on the ground floor: parked in the valet's stalls, and driving along the street.
// `parkedCars()` is the one place parked cars are made: until the car models come (the cars
// slice), each is a plain stand-in (a painted body and a dark glasshouse and skirt), all of them
// two instanced meshes. The street's traffic is the same stand-in, driven along its lanes,
// stopping for anyone on the crosswalk, with head and tail lights as one more instanced mesh.

import * as THREE from 'three';
import type { Mats } from '../materials.ts';
import type { Collider } from '../collision.ts';
import { rng } from './sky.ts';
import type { Stall } from './plan.ts';

/** A stand-in car: how wide, long and tall its body is (m). */
const CAR = { w: 1.86, l: 4.7, body: 0.72, top: 1.46 };

const PAINTS = ['#0e0f12', '#f0efe8', '#9a9ea6', '#5a0f16', '#1a2442', '#c8b89a', '#2a2c30', '#e4e2da', '#3a4a3a', '#101826'];

/** A sedan's side, nose at +z: the painted body up to the waist, bumper to bumper. */
const SIDE: [number, number][] = [
  [-2.35, 0.3],
  [2.3, 0.3],
  [2.36, 0.52],
  [2.26, 0.7],
  [1.1, 0.84],
  [-1.25, 0.86],
  [-2.12, 0.8],
  [-2.36, 0.62],
];
/** The glasshouse over the waist: windscreen, roof, rear window. */
const CABIN: [number, number][] = [
  [-1.3, 0.84],
  [1.12, 0.84],
  [0.42, 1.34],
  [-0.78, 1.34],
];

/** A side profile (z, y) pushed out `w` wide across x, centred. */
function profile(points: [number, number][], w: number, bevel = 0.04): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // shape x is along the car (z), the extrusion across it (x)
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2 - bevel, 0, 0);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    const n = p.index ? p.toNonIndexed() : p;
    pos.push(...(n.getAttribute('position').array as Float32Array));
    nor.push(...(n.getAttribute('normal').array as Float32Array));
    if (n !== p) n.dispose();
    p.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

function bodyGeometry(): THREE.BufferGeometry {
  // the body, and the roof's painted skin over the glass
  const roof = new THREE.BoxGeometry(CAR.w - 0.3, 0.05, 1.1);
  roof.translate(0, 1.38, -0.18);
  return merge([profile(SIDE, CAR.w), roof]);
}

function darkGeometry(): THREE.BufferGeometry {
  // the glasshouse, a little narrower than the body, and four wheels
  const parts = [profile(CABIN, CAR.w - 0.22, 0.03)];
  for (const z of [-1.42, 1.38]) {
    for (const x of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(x * (CAR.w / 2 - 0.1), 0.33, z);
      parts.push(wheel);
    }
  }
  return merge(parts);
}

function paintMaterial(mats: Mats): THREE.Material {
  mats.define1('car-paint', (q) => (q === 'high' ? new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.32 }) : new THREE.MeshLambertMaterial({ color: '#ffffff' })));
  return mats.get('car-paint');
}

/**
 * Parked cars in some of the stalls (a seeded share of them, the same for everyone), each with a
 * collision box. Returns the group to add and a dispose.
 */
export function parkedCars(stalls: Stall[], mats: Mats, col: Collider, seed: number, fill = 0.78): { group: THREE.Group; dispose(): void } {
  const rnd = rng(seed);
  const used = stalls.filter(() => rnd() < fill);
  const group = new THREE.Group();
  group.name = 'parked-cars';
  const body = new THREE.InstancedMesh(bodyGeometry(), paintMaterial(mats), used.length);
  const dark = new THREE.InstancedMesh(darkGeometry(), mats.get('car-glass'), used.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  used.forEach((s, i) => {
    // a little off the stall's middle, as people park
    const jx = (rnd() - 0.5) * 0.2;
    const jy = (rnd() - 0.5) * 0.05;
    m.compose(new THREE.Vector3(s.x + jx, 0, s.z + jx * 0.5), q.setFromAxisAngle(up, s.yaw + jy), one);
    body.setMatrixAt(i, m);
    dark.setMatrixAt(i, m);
    body.setColorAt(i, c.set(PAINTS[Math.floor(rnd() * PAINTS.length)]!));
    col.box(s.x + jx, s.z + jx * 0.5, CAR.w + 0.1, CAR.l + 0.1, s.yaw + jy, CAR.top);
  });
  body.name = 'parked:body';
  dark.name = 'parked:glass';
  body.computeBoundingSphere();
  dark.computeBoundingSphere();
  group.add(body, dark);
  return {
    group,
    dispose() {
      body.geometry.dispose();
      dark.geometry.dispose();
      body.dispose();
      dark.dispose();
    },
  };
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
}

/**
 * Cars driving the street: a few per lane, spaced out, looping from one end of the zone to the
 * other (they drive out of sight behind the backdrop's ends). Each keeps its distance from the car
 * ahead and stops short of anyone on the roadway in front of it.
 */
export class Traffic {
  readonly group = new THREE.Group();
  private readonly movers: Mover[] = [];
  private readonly body: THREE.InstancedMesh;
  private readonly dark: THREE.InstancedMesh;
  private readonly lights: THREE.InstancedMesh;
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
    const n = this.movers.length;
    this.body = new THREE.InstancedMesh(bodyGeometry(), paintMaterial(mats), n);
    this.dark = new THREE.InstancedMesh(darkGeometry(), mats.get('car-glass'), n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) this.body.setColorAt(i, c.set(PAINTS[Math.floor(rnd() * PAINTS.length)]!));
    this.lights = new THREE.InstancedMesh(lightsGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), n);
    for (const mesh of [this.body, this.dark, this.lights]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
    }
    this.body.name = 'traffic:body';
    this.lights.name = 'traffic:lights';
    this.group.name = 'traffic';
    this.group.add(this.body, this.dark, this.lights);
    this.write();
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

  private write(): void {
    this.movers.forEach((a, i) => {
      this.m.compose(this.p.set(a.lane.x, 0, a.z), this.q.setFromAxisAngle(this.up, a.lane.dir > 0 ? 0 : Math.PI), this.one);
      this.body.setMatrixAt(i, this.m);
      this.dark.setMatrixAt(i, this.m);
      this.lights.setMatrixAt(i, this.m);
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.dark.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.body, this.dark, this.lights]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    (this.lights.material as THREE.Material).dispose();
  }
}

/** Two headlights at the nose (+z), two tail lights at the back: coloured past 1 so they bloom. */
function lightsGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const head = new THREE.Color('#fff4dc').multiplyScalar(3.2);
  const tail = new THREE.Color('#ff2a1a').multiplyScalar(2.4);
  for (const [z, c, w] of [
    [CAR.l / 2 + 0.01, head, 0.34],
    [-CAR.l / 2 - 0.01, tail, 0.3],
  ] as const) {
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(w, 0.1, 0.02).toNonIndexed();
      g.translate((s * (CAR.w - 0.42)) / 2, 0.6, z);
      const a = g.getAttribute('position');
      for (let i = 0; i < a.count; i++) {
        pos.push(a.getX(i), a.getY(i), a.getZ(i));
        col.push(c.r, c.g, c.b);
      }
      g.dispose();
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
