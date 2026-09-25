// Rides: the boutique's skateboard, electric scooter, hoverboard and Segway, and the golden board
// a feat gives. Worn like any piece (Look.ride), a ride is stood on: the character (characters.ts)
// takes a riding stance on it instead of walking, goes faster (player.ts asks ridePace() for the
// speeds), leans into turns, and everyone else sees the same.
//
// Each ride is built here from primitives in its own frame (metres, +z forward, y up, x to the
// rider's left), merged into one skinned mesh with one material that reads colour, metalness,
// roughness and glow per vertex, so a ride is one draw call (a hoverboard adds its glow on the
// carpet). The wheels are skinned to a bone per axle and turn with the ground speed; the rest rides
// the root bone. The geometry is built once per ride and shared by everyone riding one.
//
// The rest is the pure part: the stance a ride asks for (where the feet go, how low the rider
// crouches, where the hands grip), the leg solve that puts a foot on the deck, the lean into a
// turn, the hover's bob. And B, which steps off a ride and back on.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { itemOfKind, withItem, type ShopItem } from '../../../shared/src/items.ts';
import type { Look } from '../../../shared/src/look.ts';
import { GOLD, beforeDraw, fin, reflect, type Finish } from './wearables.ts';

type V3 = THREE.Vector3;
const V = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);
const T = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z);
const Rx = (a: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationX(a);
const Rz = (a: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationZ(a);

// --- what each ride is -------------------------------------------------------------------------------

/** One ride: how it goes, how you stand on it, and where its wheels are. */
export interface RideSpec {
  /** Ground speed at a push and flat out (Shift), m/s. Walking is 2.6 and 4.8. */
  walk: number;
  run: number;
  /** How quickly it gets up to speed, and how slowly it rolls to a stop (1/s: higher is quicker). */
  accel: number;
  coast: number;
  /** How quickly it swings round to where you steer (1/s; walking is 12). */
  turn: number;
  /** The walker's circle while riding (m): the deck reaches further than feet do. */
  radius: number;
  /** Sideways across a board, facing ahead with the hands on a bar, or sitting (a throne). */
  stance: 'side' | 'front' | 'seat';
  /** Sitting: the seat's top over the footrest the feet are on (the footrest is `deck`). */
  seat?: number;
  /** The deck's top over the floor, where the soles stand (m). */
  deck: number;
  /**
   * The feet on the deck in the rider's own frame (x to their left, z ahead of them): left foot,
   * right foot; and each foot's turn about the vertical, toes out.
   */
  feet: [[number, number], [number, number]];
  toes: [number, number];
  /** How far the hips come down, knees bent (m). */
  crouch: number;
  /** The right hand's grip in the ride's frame (the left mirrors it), for a handlebar. */
  grip?: [number, number, number];
  /** How much of the rider's lean the ride itself takes (a skateboard tips less than its rider). */
  tip: number;
  /** Floats (bobs, no wheels), with this colour of glow under it. */
  hover?: THREE.ColorRepresentation;
  /** Wheel axles: height and distance ahead, and the wheel radius. */
  axles: { y: number; z: number; r: number }[];
}

export const RIDES: Record<string, RideSpec> = {
  skateboard: {
    walk: 4.4,
    run: 6.2,
    accel: 2.6,
    coast: 0.9,
    turn: 5,
    radius: 0.4,
    stance: 'side',
    deck: 0.1,
    feet: [
      [0.2, 0.02],
      [-0.2, -0.01],
    ],
    toes: [0.3, -0.12],
    crouch: 0.11,
    tip: 0.45,
    axles: [
      { y: 0.027, z: 0.215, r: 0.027 },
      { y: 0.027, z: -0.215, r: 0.027 },
    ],
  },
  'e-scooter': {
    walk: 5.2,
    run: 7.0,
    accel: 2.2,
    coast: 1.1,
    turn: 4.5,
    radius: 0.42,
    stance: 'front',
    deck: 0.098,
    feet: [
      [0.045, 0.12],
      [-0.055, -0.15],
    ],
    toes: [0.1, 0.45],
    crouch: 0.03,
    grip: [-0.19, 1.0, 0.315],
    tip: 1,
    axles: [
      { y: 0.1, z: 0.4, r: 0.1 },
      { y: 0.1, z: -0.36, r: 0.1 },
    ],
  },
  hoverboard: {
    walk: 5.0,
    run: 7.2,
    accel: 1.8,
    coast: 0.6,
    turn: 4.2,
    radius: 0.42,
    stance: 'side',
    deck: 0.19,
    feet: [
      [0.21, 0.02],
      [-0.21, -0.01],
    ],
    toes: [0.25, -0.1],
    crouch: 0.1,
    tip: 1,
    hover: '#3fb6ff',
    axles: [],
  },
  segway: {
    walk: 4.0,
    run: 5.6,
    accel: 2.4,
    coast: 1.6,
    turn: 6,
    radius: 0.4,
    stance: 'front',
    deck: 0.255,
    feet: [
      [0.12, 0.0],
      [-0.12, 0.0],
    ],
    toes: [0.12, -0.12],
    crouch: 0.02,
    grip: [-0.2, 1.08, 0.2],
    tip: 1,
    axles: [{ y: 0.24, z: 0, r: 0.24 }],
  },
  'hover-throne': {
    walk: 3.4,
    run: 5.2,
    accel: 2,
    coast: 0.7,
    turn: 3.2,
    radius: 0.45,
    stance: 'seat',
    deck: 0.22,
    seat: 0.43,
    feet: [
      [0.1, 0.3],
      [-0.1, 0.3],
    ],
    toes: [0.1, -0.1],
    crouch: 0,
    tip: 0.5,
    hover: '#ff6a3a',
    axles: [],
  },
  'golden-board': {
    walk: 5.6,
    run: 7.8,
    accel: 1.9,
    coast: 0.55,
    turn: 4.4,
    radius: 0.42,
    stance: 'side',
    deck: 0.19,
    feet: [
      [0.21, 0.02],
      [-0.21, -0.01],
    ],
    toes: [0.25, -0.1],
    crouch: 0.1,
    tip: 1,
    hover: '#ffc760',
    axles: [],
  },
};

/** The ride a Look field names, or null. */
export function rideSpec(id: unknown): RideSpec | null {
  return itemOfKind(id, 'ride') ? (RIDES[id as string] ?? null) : null;
}

/** What the walker needs from a ride (player.ts). */
export type RidePace = Pick<RideSpec, 'walk' | 'run' | 'accel' | 'coast' | 'turn' | 'radius'>;

/** The ride a character is on right now (not sitting), for the walker; null on foot. */
export function ridePace(character: unknown): RidePace | null {
  return rideSpec((character as { riding?: string | null } | null)?.riding);
}

// --- the pure parts of riding --------------------------------------------------------------------------

/** The most a rider leans into a turn (radians). */
export const MAX_LEAN = 0.32;

/**
 * How far to lean into a turn at `speed` (m/s) turning at `yawRate` (rad/s, positive to the left):
 * the angle that balances the turn's pull (tan = v w / g), capped. Positive leans right (a roll
 * about the direction of travel), so a left turn gives a negative lean.
 */
export function leanFor(speed: number, yawRate: number): number {
  const a = Math.atan((Math.max(0, speed) * yawRate) / 9.81);
  return -THREE.MathUtils.clamp(a, -MAX_LEAN, MAX_LEAN);
}

/** How far a wheel of radius `r` turns rolling `speed` m/s for `dt` s (radians). */
export function wheelTurn(speed: number, dt: number, r: number): number {
  return r > 0 ? (speed * dt) / r : 0;
}

/** A hoverboard's float: slow and uneven, a centimetre either way (m, at `t` seconds). */
export function hoverBob(t: number): number {
  return 0.009 * Math.sin(t * 5.6) + 0.004 * Math.sin(t * 2.3 + 1.1);
}

/** A Segway tips forward as it goes (radians about the axle, positive nose down). */
export function segwayPitch(speed: number): number {
  return Math.min(0.14, Math.max(0, speed) * 0.024);
}

/**
 * The knee for a leg from hip `hip` to ankle `ankle` with a thigh `a` and shin `b` long, bending
 * toward `pole`: where both lengths meet, on the pole's side. An ankle out of reach is pulled in
 * along the line (the leg straight). Writes the knee into `out`, returns the ankle actually reached.
 */
export function kneeFor(hip: V3, ankle: V3, a: number, b: number, pole: V3, out: V3): V3 {
  const u = ankle.clone().sub(hip);
  const d = THREE.MathUtils.clamp(u.length(), Math.abs(a - b) + 1e-5, (a + b) * 0.9995);
  u.normalize();
  const reached = hip.clone().addScaledVector(u, d);
  const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const side = pole.clone().addScaledVector(u, -pole.dot(u));
  if (side.lengthSq() < 1e-10) side.set(0, 0, 1).addScaledVector(u, -u.z);
  side.normalize();
  out.copy(hip).addScaledVector(u, a * cos).addScaledVector(side, a * Math.sqrt(1 - cos * cos));
  return reached;
}

/** A rider's yaw on the ride: sideways (left shoulder ahead, a regular stance) or facing ahead. */
export function stanceYaw(spec: RideSpec): number {
  return spec.stance === 'side' ? -Math.PI / 2 : 0;
}

// --- building a ride --------------------------------------------------------------------------------------

type Paint = Finish | ((p: V3, n: V3) => Finish);

/** Triangles for a ride, each part riding one bone, with colour, finish and glow per vertex. */
class Parts {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private pbr: number[] = [];
  private skin: number[] = [];
  private idx: number[] = [];
  private n = 0;

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint, bone = 0, glow = 0): void {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const P = geo.getAttribute('position');
    const N = geo.getAttribute('normal');
    for (let k = 0; k < P.count; k++) {
      const p = _p.fromBufferAttribute(P, k).applyMatrix4(m);
      const n = _n.fromBufferAttribute(N, k).applyMatrix3(nm).normalize();
      const f = typeof paint === 'function' ? paint(p, n) : paint;
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(f.c[0], f.c[1], f.c[2]);
      this.pbr.push(f.m, f.r, glow);
      this.skin.push(bone, 0, 0, 0);
    }
    const index = geo.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(this.n + index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(this.n + i);
    this.n += P.count;
    geo.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('pbr', new THREE.Float32BufferAttribute(this.pbr, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin, 4));
    const w = new Float32Array(this.n * 4);
    for (let i = 0; i < this.n; i++) w[i * 4] = 1;
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const _p = V();
const _n = V();

// finishes (linear colour, metalness, roughness)
const MAPLE = fin(0.6, 0.38, 0.19, 0, 0.55);
const MAPLE_DARK = fin(0.34, 0.18, 0.08, 0, 0.6);
const GRIP = fin(0.018, 0.018, 0.02, 0, 0.97);
const ALU = fin(0.78, 0.78, 0.8, 1, 0.3);
const ALU_SATIN = fin(0.62, 0.63, 0.66, 1, 0.42);
const ANODISED = fin(0.035, 0.037, 0.042, 0.85, 0.34);
const STEEL = fin(0.6, 0.6, 0.62, 1, 0.2);
const RUBBER = fin(0.014, 0.014, 0.016, 0, 0.82);
const PLASTIC = fin(0.03, 0.031, 0.035, 0, 0.45);
const PLASTIC_GREY = fin(0.07, 0.072, 0.078, 0, 0.42);
const URETHANE = fin(0.55, 0.035, 0.03, 0, 0.42);
const BUSHING = fin(0.85, 0.3, 0.02, 0, 0.6);
const PRINT = fin(0.75, 0.74, 0.7, 0, 0.5);
const GRAPHITE = fin(0.018, 0.02, 0.026, 0.6, 0.22);
const WHITE_GLOW = fin(1.0, 0.92, 0.78, 0, 0.3);
const RED_GLOW = fin(1.0, 0.04, 0.02, 0, 0.3);
const SCREEN = fin(0.35, 0.75, 1.0, 0, 0.2);
const GREEN_GLOW = fin(0.2, 1.0, 0.35, 0, 0.3);

/**
 * A board: a rectangle with round ends, `len` long and `wide` across, `thick` thick, bent by
 * `bend(x, z)` (kicktails, concave). Its top, bottom and edge come separately so each can take its
 * own finish; `rim` is the edge's loop at half thickness (for a light strip).
 */
function board(len: number, wide: number, thick: number, bend: (x: number, z: number) => number, segU = 48, segV = 10) {
  const straight = len / 2 - wide / 2;
  const hw = (z: number) => (Math.abs(z) <= straight ? wide / 2 : Math.sqrt(Math.max(0, (wide / 2) ** 2 - (Math.abs(z) - straight) ** 2)));
  // the ends are round: spend more of the rows there
  const zOf = (u: number) => {
    const s = (u / segU) * 2 - 1;
    return (Math.sign(s) * (1 - Math.cos((Math.abs(s) * Math.PI) / 2) * 0.35 - 0.65 * (1 - Math.abs(s))) * len) / 2;
  };
  const surface = (up: boolean) => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let u = 0; u <= segU; u++) {
      const z = zOf(u);
      for (let v = 0; v <= segV; v++) {
        const x = hw(z) * ((2 * v) / segV - 1);
        pos.push(x, bend(x, z) + (up ? thick : 0), z);
      }
    }
    for (let u = 0; u < segU; u++) {
      for (let v = 0; v < segV; v++) {
        const a = u * (segV + 1) + v;
        const b = a + segV + 1;
        if (up) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // the edge loop: down the right side (-z), back up the left (+z), so the faces look outward
  const loop: [number, number][] = [];
  for (let u = segU; u >= 0; u--) loop.push([-hw(zOf(u)), zOf(u)]);
  for (let u = 1; u < segU; u++) loop.push([hw(zOf(u)), zOf(u)]);
  const pos: number[] = [];
  const idx: number[] = [];
  loop.forEach(([x, z]) => pos.push(x, bend(x, z), z, x, bend(x, z) + thick, z));
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1);
  }
  const edge = new THREE.BufferGeometry();
  edge.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  edge.setIndex(idx);
  edge.computeVertexNormals();
  const rim = loop.map(([x, z]) => V(x, bend(x, z) + thick / 2, z));
  return { top: surface(true), bottom: surface(false), edge, rim };
}

/** A solid of revolution about the x axis (a wheel, a tyre, a fender): `pts` as [radius, x]. */
function turned(pts: [number, number][], segs: number, from = 0, sweep = Math.PI * 2): THREE.BufferGeometry {
  // a lathe turns about y; lay its axis along x
  return new THREE.LatheGeometry(
    pts.map(([r, x]) => new THREE.Vector2(r, x)),
    segs,
    from,
    sweep,
  ).rotateZ(-Math.PI / 2);
}

/** A tyre of radius `r` (to the tread), `w` wide, on the x axis. */
function tyre(r: number, w: number, segs = 36): THREE.BufferGeometry {
  const t = w / 2;
  return turned(
    [
      [r - w * 0.55, -t * 0.9],
      [r - t * 0.35, -t],
      [r - t * 0.05, -t * 0.7],
      [r, -t * 0.3],
      [r, t * 0.3],
      [r - t * 0.05, t * 0.7],
      [r - t * 0.35, t],
      [r - w * 0.55, t * 0.9],
    ],
    segs,
  );
}

/** Spokes: `n` flat bars from the hub to the rim, in the wheel's plane (the x axis through it). */
function spokes(n: number, hub: number, rim: number, width: number, thick: number, parts: Parts, at: THREE.Matrix4, paint: Paint, bone: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const len = rim - hub;
    const g = new THREE.BoxGeometry(thick, len, width).translate(0, hub + len / 2, 0);
    parts.add(g, at.clone().multiply(Rx(a)), paint, bone);
  }
}

/** A mark on a wheel's side (a print, a valve), so you can see it turn: `f` near angle 0 on the outer face. */
function marked(center: V3, outward: number, f: Finish, base: Finish): Paint {
  return (p, n) => {
    if (n.x * outward < 0.6) return base;
    const a = Math.atan2(p.y - center.y, p.z - center.z);
    const r = Math.hypot(p.y - center.y, p.z - center.z);
    return a > 0.25 && a < 1.3 && r > 0.012 ? f : base;
  };
}

function buildSkateboard(parts: Parts): void {
  const deckY = 0.086;
  const deck = board(0.8, 0.205, 0.012, (x, z) => {
    const kick = Math.max(0, Math.abs(z) - 0.25);
    return deckY + kick * kick * 2.4 + (x / 0.1) ** 2 * 0.005 * (Math.abs(z) < 0.28 ? 1 : Math.max(0, 1 - (Math.abs(z) - 0.28) / 0.08));
  });
  parts.add(deck.top, T(0, 0.0004, 0), GRIP);
  parts.add(deck.edge, new THREE.Matrix4(), (p) => (Math.round((p.y - deckY) * 580) % 2 ? MAPLE : MAPLE_DARK));
  // a deep red underside with a pale band across the middle: the shop's print
  parts.add(deck.bottom, new THREE.Matrix4(), (p) => (Math.abs(p.z) < 0.07 && Math.abs(p.z) > 0.04 ? PRINT : fin(0.28, 0.02, 0.02, 0, 0.5)));
  for (const [i, ax] of RIDES.skateboard!.axles.entries()) {
    const z = ax.z;
    const bone = i + 1;
    // baseplate, the hanger on its kingpin and bushings, the axle
    parts.add(new RoundedBoxGeometry(0.056, 0.008, 0.086, 1, 0.002), T(0, deckY - 0.004, z), ALU);
    parts.add(new THREE.CylinderGeometry(0.012, 0.013, 0.012, 14), T(0, deckY - 0.014, z - Math.sign(z) * 0.012), BUSHING);
    parts.add(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 8), T(0, deckY - 0.028, z - Math.sign(z) * 0.012), STEEL);
    parts.add(new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 6), T(0, deckY - 0.052, z - Math.sign(z) * 0.012), STEEL);
    const hanger = new RoundedBoxGeometry(0.15, 0.024, 0.03, 2, 0.008);
    // narrower at the base of the V
    const hp = hanger.getAttribute('position');
    for (let k = 0; k < hp.count; k++) if (hp.getY(k) > 0) hp.setX(k, hp.getX(k) * 0.55);
    hanger.computeVertexNormals();
    parts.add(hanger, T(0, ax.y + 0.012, z), ALU);
    parts.add(new RoundedBoxGeometry(0.028, 0.034, 0.028, 1, 0.006), T(0, ax.y + 0.03, z - Math.sign(z) * 0.008).multiply(Rx(Math.sign(z) * 0.5)), ALU);
    parts.add(new THREE.CylinderGeometry(0.004, 0.004, 0.214, 8).rotateZ(Math.PI / 2), T(0, ax.y, z), STEEL);
    for (const side of [-1, 1]) {
      const c = V(side * 0.096, ax.y, z);
      const wheel = turned(
        [
          [0.008, -0.016],
          [0.022, -0.016],
          [0.0265, -0.012],
          [ax.r, -0.006],
          [ax.r, 0.006],
          [0.0265, 0.012],
          [0.022, 0.016],
          [0.008, 0.016],
        ],
        28,
      );
      parts.add(wheel, T(c.x, c.y, c.z), marked(c, side, PRINT, URETHANE), bone);
      parts.add(turned([[0.0105, -0.0162], [0.0105, 0.0162]], 16), T(c.x, c.y, c.z), STEEL, bone);
      parts.add(new THREE.CylinderGeometry(0.006, 0.006, 0.0328, 10).rotateZ(Math.PI / 2), T(c.x, c.y, c.z), fin(0.02, 0.02, 0.02, 0.5, 0.4), bone);
    }
  }
}

function buildScooter(parts: Parts): void {
  const [front, rear] = RIDES['e-scooter']!.axles as [RideSpec['axles'][0], RideSpec['axles'][0]];
  // the deck, its rubber mat and a thin light down each side
  parts.add(new RoundedBoxGeometry(0.15, 0.042, 0.52, 3, 0.014), T(0, 0.075, -0.03), ANODISED);
  parts.add(new RoundedBoxGeometry(0.128, 0.004, 0.46, 1, 0.0018), T(0, 0.0965, -0.03), RUBBER);
  for (const side of [-1, 1]) parts.add(new THREE.BoxGeometry(0.002, 0.005, 0.4), T(side * 0.0755, 0.07, -0.03), fin(0.9, 0.35, 0.05, 0, 0.3), 0, 1.4);
  // the wheels: a black tyre, a five-spoke rim; a hub motor in front, a disc brake behind
  for (const [i, ax] of [front, rear].entries()) {
    const bone = i + 1;
    const at = T(0, ax.y, ax.z);
    const c = V(0, ax.y, ax.z);
    parts.add(tyre(ax.r, 0.05), at, marked(c, 1, fin(0.06, 0.06, 0.065, 0, 0.7), RUBBER), bone);
    parts.add(turned([[0.064, -0.019], [0.07, -0.02], [0.07, 0.02], [0.064, 0.019]], 32), at, ALU_SATIN, bone);
    spokes(5, i === 0 ? 0.045 : 0.018, 0.066, 0.012, 0.03, parts, at, ALU_SATIN, bone);
    parts.add(turned([[0.0001, -0.022], [i === 0 ? 0.045 : 0.018, -0.022], [i === 0 ? 0.045 : 0.018, 0.022], [0.0001, 0.022]], 24), at, i === 0 ? ALU : STEEL, bone);
    if (i === 1) parts.add(turned([[0.02, -0.028], [0.052, -0.028], [0.052, -0.026], [0.02, -0.026]], 28), at, STEEL, bone);
    // the axle nut stays put
    parts.add(new THREE.CylinderGeometry(0.009, 0.009, 0.08, 6).rotateZ(Math.PI / 2), at, STEEL);
  }
  // rear fender over the back wheel, the tail light at its end
  parts.add(turned([[0.118, -0.03], [0.124, -0.032], [0.124, 0.032], [0.118, 0.03]], 20, Math.PI + 0.25, 1.7), T(0, rear.y, rear.z), ANODISED);
  parts.add(new RoundedBoxGeometry(0.05, 0.012, 0.012, 1, 0.004), T(0, rear.y + 0.05, rear.z - 0.118), RED_GLOW, 0, 3);
  // rear link from the deck to the wheel
  for (const side of [-1, 1]) parts.add(new RoundedBoxGeometry(0.008, 0.03, 0.14, 1, 0.003), T(side * 0.034, 0.085, -0.3), ANODISED);
  // the steering: the fork round the front wheel, the stem raked back to the bar
  const axle = V(0, front.y, front.z);
  const top = V(0, 1.0, 0.31);
  const dir = top.clone().sub(axle).normalize();
  const along = (d: number) => axle.clone().addScaledVector(dir, d);
  const rake = Math.atan2(dir.z, dir.y);
  for (const side of [-1, 1]) {
    const mid = along(0.08);
    parts.add(new RoundedBoxGeometry(0.01, 0.17, 0.028, 1, 0.004), T(side * 0.036, mid.y, mid.z).multiply(Rx(rake)), ANODISED);
  }
  const crown = along(0.17);
  parts.add(new RoundedBoxGeometry(0.084, 0.024, 0.04, 2, 0.008), T(crown.x, crown.y, crown.z).multiply(Rx(rake)), ANODISED);
  const stemFrom = along(0.18);
  const stemLen = stemFrom.distanceTo(top);
  const stemMid = stemFrom.clone().add(top).multiplyScalar(0.5);
  parts.add(new THREE.CylinderGeometry(0.017, 0.019, stemLen, 16), T(stemMid.x, stemMid.y, stemMid.z).multiply(Rx(rake)), ALU_SATIN);
  // the folding latch where the neck meets the stem, and the neck down to the deck
  const latch = along(0.2);
  parts.add(new RoundedBoxGeometry(0.05, 0.05, 0.05, 2, 0.012), T(latch.x, latch.y, latch.z), ANODISED);
  parts.add(new RoundedBoxGeometry(0.06, 0.04, 0.12, 2, 0.012), T(0, 0.1, 0.26).multiply(Rx(-0.5)), ANODISED);
  // the bar, grips, brake lever, the display and the headlight
  parts.add(new THREE.CylinderGeometry(0.011, 0.011, 0.44, 12).rotateZ(Math.PI / 2), T(top.x, top.y, top.z), ALU_SATIN);
  for (const side of [-1, 1]) {
    parts.add(new THREE.CylinderGeometry(0.016, 0.016, 0.1, 14).rotateZ(Math.PI / 2), T(side * 0.19, top.y, top.z), RUBBER);
    parts.add(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 14).rotateZ(Math.PI / 2), T(side * 0.243, top.y, top.z), ANODISED);
  }
  parts.add(new RoundedBoxGeometry(0.012, 0.008, 0.075, 1, 0.003), T(0.15, top.y + 0.004, top.z + 0.05).multiply(new THREE.Matrix4().makeRotationY(0.15)), ANODISED);
  parts.add(new RoundedBoxGeometry(0.07, 0.024, 0.05, 2, 0.008), T(0, top.y + 0.022, top.z - 0.004), ANODISED);
  parts.add(new THREE.PlaneGeometry(0.046, 0.026).rotateX(-Math.PI / 2 + 0.35), T(0, top.y + 0.0345, top.z - 0.006), SCREEN, 0, 1.2);
  const lamp = along(0.72);
  parts.add(new THREE.CylinderGeometry(0.018, 0.02, 0.022, 16).rotateX(Math.PI / 2), T(lamp.x, lamp.y, lamp.z + 0.024), ANODISED);
  parts.add(new THREE.CircleGeometry(0.015, 16), T(lamp.x, lamp.y, lamp.z + 0.0355), WHITE_GLOW, 0, 3.5);
}

function buildSegway(parts: Parts): void {
  const ax = RIDES.segway!.axles[0]!;
  // the platform between the wheels, its two rubber foot mats
  parts.add(new RoundedBoxGeometry(0.46, 0.07, 0.34, 3, 0.02), T(0, 0.22, 0), PLASTIC_GREY);
  for (const side of [-1, 1]) parts.add(new RoundedBoxGeometry(0.17, 0.006, 0.28, 1, 0.0025), T(side * 0.11, 0.2575, 0), RUBBER);
  // the wheels: fat tyres on silver rims, fenders over them
  for (const side of [-1, 1]) {
    const x = side * 0.305;
    const at = T(x, ax.y, 0);
    const c = V(x, ax.y, 0);
    parts.add(tyre(ax.r, 0.1, 44), at, marked(c, side, fin(0.05, 0.05, 0.055, 0, 0.7), RUBBER), 1);
    parts.add(turned([[0.1, -0.042], [0.145, -0.044], [0.145, 0.044], [0.1, 0.042]], 36), at, ALU, 1);
    spokes(6, 0.05, 0.1, 0.02, 0.07, parts, at, ALU_SATIN, 1);
    parts.add(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 24).rotateZ(Math.PI / 2), at, PLASTIC, 1);
    parts.add(turned([[0.262, -0.052], [0.27, -0.056], [0.27, 0.056], [0.262, 0.052]], 24, Math.PI + 0.35, Math.PI - 0.7), at, PLASTIC_GREY);
  }
  // the steering column, a LeanSteer bar, the status lights
  parts.add(new RoundedBoxGeometry(0.1, 0.06, 0.08, 2, 0.02), T(0, 0.28, 0.1), PLASTIC);
  const base = V(0, 0.29, 0.1);
  const top = V(0, 1.05, 0.2);
  const len = base.distanceTo(top);
  const mid = base.clone().add(top).multiplyScalar(0.5);
  const lean = Math.atan2(top.z - base.z, top.y - base.y);
  parts.add(new RoundedBoxGeometry(0.058, len, 0.042, 2, 0.012), T(mid.x, mid.y, mid.z).multiply(Rx(lean)), PLASTIC);
  parts.add(new RoundedBoxGeometry(0.46, 0.036, 0.05, 2, 0.014), T(top.x, top.y + 0.01, top.z), PLASTIC);
  for (const side of [-1, 1]) parts.add(new THREE.CylinderGeometry(0.017, 0.017, 0.11, 14).rotateZ(Math.PI / 2), T(side * 0.2, top.y + 0.03, top.z), RUBBER);
  parts.add(new RoundedBoxGeometry(0.1, 0.02, 0.07, 2, 0.008), T(0, top.y + 0.036, top.z - 0.012), PLASTIC_GREY);
  for (let i = 0; i < 5; i++) parts.add(new THREE.BoxGeometry(0.008, 0.002, 0.012), T(-0.03 + i * 0.015, top.y + 0.047, top.z - 0.012), GREEN_GLOW, 0, 2.2);
}

/** Back to the Future's board, made real: a deck floating on two thruster pods, a light round its rim. */
function buildHoverboard(parts: Parts, gold: boolean): void {
  const deckY = 0.155;
  const deck = board(0.92, 0.27, 0.034, (x, z) => {
    const kick = Math.max(0, Math.abs(z) - 0.32);
    return deckY + kick * kick * 1.3 + (x / 0.13) ** 2 * 0.004;
  });
  const shell = gold ? GOLD : GRAPHITE;
  const light = gold ? fin(1.0, 0.8, 0.45, 0, 0.3) : fin(0.25, 0.72, 1.0, 0, 0.3);
  parts.add(deck.top, T(0, 0.0004, 0), (p) => {
    // footpads: two lighter rounded patches in the grip
    const pad = Math.abs(Math.abs(p.z) - 0.2) < 0.085 && Math.abs(p.x) < 0.095;
    return gold ? (pad ? fin(0.06, 0.045, 0.02, 0, 0.9) : fin(0.02, 0.016, 0.01, 0, 0.95)) : pad ? fin(0.05, 0.052, 0.058, 0, 0.9) : GRIP;
  });
  parts.add(deck.edge, new THREE.Matrix4(), shell);
  parts.add(deck.bottom, new THREE.Matrix4(), shell);
  // the light strip round the rim
  parts.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(deck.rim, true), 160, 0.0045, 6, true), T(0, 0, 0), light, 0, gold ? 2.2 : 2.6);
  // the pods: a rounded housing each end, a glowing thruster ring and a lens under it
  for (const z of [-0.25, 0.25]) {
    const y = deckY - 0.02;
    parts.add(turned([[0.0001, -0.028], [0.05, -0.028], [0.08, -0.018], [0.085, 0.012], [0.07, 0.03], [0.0001, 0.03]], 32).rotateZ(Math.PI / 2), T(0, y, z), shell);
    parts.add(new THREE.TorusGeometry(0.058, 0.006, 6, 36).rotateX(Math.PI / 2), T(0, y - 0.027, z), light, 0, 3.4);
    parts.add(new THREE.CircleGeometry(0.045, 28).rotateX(Math.PI / 2), T(0, y - 0.029, z), light, 0, 1.6);
  }
}

const VELVET = fin(0.2, 0.008, 0.016, 0, 0.92);
const GOLD_SATIN = fin(1.0, 0.74, 0.34, 1, 0.3);

/**
 * The Hover Throne: a gilded dais floating on four thruster pods, a throne on it with a red velvet
 * seat and a buttoned back, scrolled gold arms and a crest; the footrest is the dais's front. The
 * back stops at the sitter's head, under the follow camera's line to it.
 */
function buildThrone(parts: Parts): void {
  const spec = RIDES['hover-throne']!;
  const dais = spec.deck;
  const seat = dais + spec.seat!;
  const glow = fin(1.0, 0.45, 0.2, 0, 0.3);
  // the dais: a rounded slab, a gold moulding round it, glowing pods under the corners
  parts.add(new RoundedBoxGeometry(0.78, 0.07, 0.92, 3, 0.025), T(0, dais - 0.035, 0.08), GOLD_SATIN);
  parts.add(new RoundedBoxGeometry(0.72, 0.006, 0.86, 1, 0.003), T(0, dais + 0.001, 0.08), VELVET);
  const outline = board(0.95, 0.8, 0.012, () => dais - 0.05, 32, 4);
  const rim = outline.rim;
  for (const g of [outline.top, outline.bottom, outline.edge]) g.dispose();
  parts.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 120, 0.006, 6, true), T(0, 0, 0.08), GOLD);
  for (const [x, z] of [
    [-0.28, -0.24],
    [0.28, -0.24],
    [-0.28, 0.4],
    [0.28, 0.4],
  ] as const) {
    parts.add(turned([[0.0001, -0.03], [0.05, -0.03], [0.066, -0.01], [0.062, 0.02], [0.0001, 0.02]], 24).rotateZ(Math.PI / 2), T(x, dais - 0.09, z), GOLD_SATIN);
    parts.add(new THREE.TorusGeometry(0.045, 0.006, 6, 28).rotateX(Math.PI / 2), T(x, dais - 0.121, z), glow, 0, 3.2);
    parts.add(new THREE.CircleGeometry(0.036, 20).rotateX(Math.PI / 2), T(x, dais - 0.123, z), glow, 0, 1.6);
  }
  // the seat: a gold frame with a deep red velvet cushion
  parts.add(new RoundedBoxGeometry(0.62, seat - dais - 0.07, 0.5, 2, 0.02), T(0, (seat + dais - 0.07) / 2, 0.0), GOLD_SATIN);
  parts.add(new RoundedBoxGeometry(0.54, 0.08, 0.44, 3, 0.035), T(0, seat - 0.04, 0.01), VELVET);
  // legs: short scrolled feet at the corners
  for (const x of [-0.29, 0.29]) for (const z of [-0.22, 0.23]) parts.add(new THREE.SphereGeometry(0.035, 14, 10), T(x, dais + 0.03, z), GOLD);
  // the back: a tall gold frame, a buttoned velvet panel, a crest over it
  const backZ = -0.23;
  parts.add(new RoundedBoxGeometry(0.66, 0.68, 0.07, 3, 0.03), T(0, seat + 0.32, backZ), GOLD_SATIN);
  parts.add(new RoundedBoxGeometry(0.52, 0.56, 0.03, 3, 0.012), T(0, seat + 0.32, backZ + 0.045), VELVET);
  for (let r = 0; r < 3; r++) for (const x of r % 2 ? [-0.075, 0.075] : [-0.15, 0, 0.15]) parts.add(new THREE.SphereGeometry(0.009, 8, 6), T(x, seat + 0.14 + r * 0.18, backZ + 0.062), GOLD);
  const crest = new THREE.Shape();
  crest.moveTo(-0.3, 0);
  crest.bezierCurveTo(-0.25, 0.07, -0.1, 0.04, 0, 0.13);
  crest.bezierCurveTo(0.1, 0.04, 0.25, 0.07, 0.3, 0);
  crest.lineTo(-0.3, 0);
  parts.add(new THREE.ExtrudeGeometry(crest, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 12 }), T(0, seat + 0.645, backZ - 0.025), GOLD);
  parts.add(new THREE.SphereGeometry(0.024, 16, 10), T(0, seat + 0.8, backZ), fin(0.36, 0.004, 0.02, 0.25, 0.04));
  // the arms: gold rails ending in scrolls, velvet pads on top
  for (const side of [-1, 1]) {
    parts.add(new RoundedBoxGeometry(0.06, 0.2, 0.44, 2, 0.02), T(side * 0.3, seat + 0.1, 0.0), GOLD_SATIN);
    parts.add(new RoundedBoxGeometry(0.07, 0.03, 0.38, 2, 0.012), T(side * 0.3, seat + 0.21, -0.02), VELVET);
    parts.add(new THREE.TorusGeometry(0.035, 0.014, 8, 20).rotateY(Math.PI / 2), T(side * 0.3, seat + 0.17, 0.22), GOLD);
  }
}

// --- the material, the glow, the shared builds -------------------------------------------------------------

let rideMat: THREE.MeshStandardMaterial | null = null;

/** Every ride: colour per vertex, metalness, roughness and glow per vertex (the pbr attribute). */
function material(): THREE.MeshStandardMaterial {
  if (rideMat) return rideMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 1, envMapIntensity: 1.25 });
  m.name = 'ride';
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 pbr;\nvarying vec3 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbr;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vPbr.y;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vPbr.x;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vPbr.z;');
  };
  m.customProgramCacheKey = () => 'ride-1';
  reflect(m);
  rideMat = m;
  return m;
}

const glows = new Map<string, THREE.MeshBasicMaterial>();
let glowGeo: THREE.PlaneGeometry | null = null;

/** The hoverboard's light on the carpet: a soft oval, added to what's there. */
function glowMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  const key = new THREE.Color(color).getHexString();
  let m = glows.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.85)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  r.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  m.name = 'ride-glow';
  glows.set(key, m);
  return m;
}

const BUILDERS: Record<string, (p: Parts) => void> = {
  skateboard: buildSkateboard,
  'e-scooter': buildScooter,
  segway: buildSegway,
  hoverboard: (p) => buildHoverboard(p, false),
  'golden-board': (p) => buildHoverboard(p, true),
  'hover-throne': buildThrone,
};

/** Whether a ride id has a model (every ride in the catalog should). */
export function hasRideModel(id: string): boolean {
  return !!BUILDERS[id] && !!RIDES[id];
}

const built = new Map<string, { geo: THREE.BufferGeometry; users: number }>();

function acquire(id: string): THREE.BufferGeometry {
  let b = built.get(id);
  if (!b) {
    const parts = new Parts();
    BUILDERS[id]!(parts);
    b = { geo: parts.build(), users: 0 };
    built.set(id, b);
  }
  b.users++;
  return b.geo;
}

function release(id: string): void {
  const b = built.get(id);
  if (!b || --b.users > 0) return;
  built.delete(id);
  b.geo.dispose();
}

// --- one ride under one character ----------------------------------------------------------------------------

/**
 * A ride under a character: hung on the character's root (it goes where they go, facing where they
 * face). `outer` stays level on the floor (a hoverboard's glow is on it); `inner` leans, pitches and
 * bobs, and holds the skinned model with a bone per axle.
 */
export class Ride {
  readonly outer = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly axles: THREE.Bone[] = [];
  private readonly mesh: THREE.SkinnedMesh;
  private readonly glow: THREE.Mesh | null = null;
  private t = Math.random() * 10;
  private wheel = 0;
  /** The lean (roll to the right, radians), pitch (nose down) and float the rider shares. */
  lean = 0;
  pitch = 0;
  bob = 0;

  constructor(
    readonly id: string,
    readonly spec: RideSpec,
  ) {
    this.outer.name = `ride:${id}`;
    this.outer.add(this.inner);
    const root = new THREE.Bone();
    for (const ax of spec.axles) {
      const b = new THREE.Bone();
      b.position.set(0, ax.y, ax.z);
      root.add(b);
      this.axles.push(b);
    }
    this.inner.add(root);
    // made at the origin, before it is hung anywhere: the bones' inverses are taken from here
    this.mesh = new THREE.SkinnedMesh(acquire(id), material());
    this.mesh.name = 'ride';
    this.inner.add(this.mesh);
    this.outer.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton([root, ...this.axles]));
    this.mesh.onBeforeRender = beforeDraw;
    if (spec.hover !== undefined) {
      glowGeo ??= new THREE.PlaneGeometry(1.15, 0.62).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
      const glow = new THREE.Mesh(glowGeo, glowMaterial(spec.hover));
      glow.position.y = 0.006;
      glow.renderOrder = 2;
      glow.name = 'ride-glow';
      this.outer.add(glow);
      this.glow = glow;
    }
  }

  /**
   * Roll on at `speed` (m/s) turning at `yawRate` (rad/s, left positive): the wheels turn, the ride
   * and the rider lean into the turn, a Segway tips forward, a hoverboard floats.
   */
  update(dt: number, speed: number, yawRate: number): void {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 6);
    this.lean += (leanFor(speed, yawRate) - this.lean) * k;
    const pitch = this.id === 'segway' ? segwayPitch(speed) : 0;
    this.pitch += (pitch - this.pitch) * k;
    this.bob = this.spec.hover !== undefined ? hoverBob(this.t) : 0;
    // one angle for every wheel, turned by the first axle's radius: the axles differ in size only on paper
    const r = this.spec.axles[0]?.r ?? 0;
    this.wheel = (this.wheel + wheelTurn(speed, dt, r)) % (Math.PI * 2);
    for (const [i, b] of this.axles.entries()) b.rotation.x = (this.wheel * r) / this.spec.axles[i]!.r;
    // a Segway pitches about its axle, everything else rolls about where it meets the floor
    const pivot = this.id === 'segway' ? this.spec.axles[0]!.y : 0;
    this.inner.position.set(0, this.bob + pivot, 0);
    this.inner.rotation.set(this.pitch, 0, this.lean * this.spec.tip, 'YXZ');
    this.inner.updateMatrix();
    this.inner.matrix.multiply(T(0, -pivot, 0));
    this.inner.matrixAutoUpdate = false;
    if (this.glow) {
      // the light spreads and dims as the board floats up, and follows its lean a little
      const s = 1 + this.bob * 6;
      this.glow.scale.set(s, 1, s);
      this.glow.position.x = -Math.sin(this.lean) * 0.12;
    }
  }

  /** Where the right hand (side 1) or the left (-1) grips, in world space; null without a bar. */
  grip(side: 1 | -1, out: V3): V3 | null {
    const g = this.spec.grip;
    if (!g) return null;
    this.inner.updateWorldMatrix(true, false);
    return out.set(g[0] * side, g[1], g[2]).applyMatrix4(this.inner.matrixWorld);
  }

  dispose(): void {
    this.outer.removeFromParent();
    this.mesh.skeleton.dispose();
    release(this.id);
  }
}

// --- stepping off and back on ----------------------------------------------------------------------------------

/** Where the last ride you stepped off is remembered on this device (a convenience only). */
const LAST_KEY = 'casino.lastRide';

function rememberRide(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* storage can be off; B then steps onto the first ride you own */
  }
}

function lastRide(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/**
 * The look after pressing B: off the ride you're on, or back onto the last one you stepped off
 * (or, failing that, the first ride you own). Null when there's nothing to step onto.
 */
export function toggledRide(look: Look, owned: readonly string[] | undefined, last: string | null): Look | null {
  if (look.ride) return withItem(look, 'ride', null);
  const mine = (owned ?? []).filter((id) => itemOfKind(id, 'ride'));
  const pick = last && (owned === undefined || mine.includes(last)) && itemOfKind(last, 'ride') ? last : (mine[0] ?? null);
  return pick ? withItem(look, 'ride', pick) : null;
}

export interface RideKeyDeps {
  /** The signed-in look and what you own (Profile.owned; undefined when the server doesn't say). */
  profile(): { look: Look; owned?: string[] } | null;
  /** Save a look through the app (the server keeps a ride only if it's yours) and take it up. */
  save(look: Look): Promise<Look>;
  /** Whether B means anything now: walking the floor, nothing over it, not typing. */
  allowed(e: KeyboardEvent): boolean;
  /** Say something short (no ride yet, or the save failed). */
  say(text: string): void;
}

/** B steps off your ride and back on again. Returns a function that stops listening. */
export function rideKey(deps: RideKeyDeps): () => void {
  let busy = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyB' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || busy || !deps.allowed(e)) return;
    const p = deps.profile();
    if (!p) return;
    const riding = itemOfKind(p.look.ride, 'ride') as ShopItem | null;
    const next = toggledRide(p.look, p.owned, lastRide());
    if (!next) {
      deps.say('No ride yet: the boutique sells them.');
      return;
    }
    e.preventDefault();
    if (riding) rememberRide(riding.id);
    busy = true;
    deps
      .save(next)
      .then((stored) => {
        if (next.ride && !stored.ride) deps.say("That ride isn't yours any more.");
      })
      .catch(() => deps.say("Couldn't change that just now."))
      .finally(() => (busy = false));
  };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}
