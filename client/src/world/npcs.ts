// The floor's staff: a dealer behind every table (a stickman at craps), a bartender behind the bar
// and a cashier in the cage. They are characters like the players (the same rigs, one draw call
// each, the shared vertex-coloured material) dressed in uniforms (characters.ts): dealers in a
// white shirt, black vest, bow tie and brass name badge, the bartender in a wine-red vest, the
// cashier in a navy blazer. Skin, hair, body and height differ from one to the next, never twice
// the same, and each table keeps its dealer from one visit to the next.
//
// Where a dealer stands comes from the table's own model: behind its edge on the dealer's side
// (local -z), as close as the model allows at every height (a high craps rail keeps the stickman
// further back than a blackjack table does), by the wheel at roulette and beside it at the Big
// Six. So when a table is rebuilt, its dealer moves with it.
//
// Life: the idle clip plays at a slightly different pace for each, weight shifts from foot to
// foot, and heads turn to whoever comes near (within reach and in front); with nobody there they
// glance over their layout. When you sit at a table its dealer turns to face you. Table views can
// ask for a deal, sweep or pay motion (FloorWorld.dealerGesture).
//
// Cost: staff out of the camera's view are hidden and not animated. Past CULL_M each one gives way
// to a still copy of itself, drawn with everyone else in the same uniform as one instanced mesh
// (a few draw calls for the whole far floor), and their shadows are one instanced mesh too. Each
// stands on a collision post so nobody walks through them.

import * as THREE from 'three';
import type { GameId } from '../../../shared/src/engine.ts';
import { SKIN_TONES, type Body, type Look } from '../../../shared/src/look.ts';
import { uniformOutfit, type Characters, type Person, type StaffGesture, type UniformId } from './characters.ts';
import type { Collider, Post as CollisionPost } from './collision.ts';
import { roomAt, type FloorPlan } from './layout.ts';
import type { WorldStation } from './stations.ts';

export type { StaffGesture } from './characters.ts';
export type StaffRole = 'dealer' | 'stickman' | 'bartender' | 'cashier';

/** Where one of the staff works: a floor position and the way they face (Object3D.rotation.y). */
export interface StaffPost {
  role: StaffRole;
  /** The station they deal at; null behind the bar and in the cage. */
  station: string | null;
  x: number;
  z: number;
  yaw: number;
  /** The room they work in (hidden with it). */
  room: string;
}

/** Hidden past this (metres from the camera), shown again inside CULL_M - 1. */
export const CULL_M = 15;
/** How near someone must be for a head to turn their way. */
const NOTICE_M = 3.6;
/** Collision: the coordinator's post for anyone standing on the floor. */
const POST_R = 0.28;
const POST_TOP = 1.9;

// --- where dealers stand ------------------------------------------------------------------------

/**
 * How far the front of a standing body reaches (z, metres) at a height: toes near the floor,
 * thighs at table height, belly and chest above it.
 */
export function bodyFront(y: number): number {
  if (y < 0.12) return 0.2;
  if (y < 0.95) return 0.12;
  return 0.19;
}
const CLEAR = 0.04;
/** Half the body's width with the arms at its sides. */
const HALF_WIDTH = 0.3;

/**
 * Heights and offsets across the body where standBehind looks for the table in front: every few
 * centimetres through table height, so a thin top or rail can't slip between two rays.
 */
const PROBE_Y = [0.04, 0.2, 0.35, 0.5, 0.6, 0.65, 0.69, 0.72, 0.75, 0.78, 0.81, 0.84, 0.87, 0.91, 0.95, 1.0, 1.05, 1.1, 1.2, 1.35, 1.5, 1.7];
const PROBE_X = [-0.26, -0.13, 0, 0.13, 0.26];

/**
 * The dealer's z (in the station's frame, dealer side -z) for a body centred on x: as close to the
 * model as bodyFront allows at every height, a few centimetres clear. `hit(x, y)` is the z where a
 * ray from far behind the dealer (-z) heading +z first meets the model, or null.
 */
export function standBehind(hit: (x: number, y: number) => number | null, x: number): number {
  let z = Infinity;
  for (const y of PROBE_Y) {
    for (const dx of PROBE_X) {
      const h = hit(x + dx, y);
      if (h !== null) z = Math.min(z, h - bodyFront(y) - CLEAR);
    }
  }
  return Number.isFinite(z) ? z : -0.9;
}

/** Rays against a station's model, in its own frame: the first surface met heading +z from far behind. */
function modelHits(s: WorldStation): (x: number, y: number) => number | null {
  const ray = new THREE.Raycaster();
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const local = new THREE.Vector3();
  s.anchor.updateWorldMatrix(true, true);
  const q = new THREE.Quaternion();
  s.anchor.getWorldQuaternion(q);
  return (x, y) => {
    s.anchor.localToWorld(from.set(x, y, -4));
    dir.set(0, 0, 1).applyQuaternion(q);
    ray.set(from, dir);
    ray.far = 8;
    const hit = ray.intersectObject(s.model, true).find((h) => (h.object as THREE.Mesh).isMesh && !(h.object as THREE.SkinnedMesh).isSkinnedMesh);
    return hit ? s.anchor.worldToLocal(local.copy(hit.point)).z : null;
  };
}

/** True when no part of the model is inside a body standing at (x, z) facing +z. */
export function standsClear(points: ArrayLike<number>, x: number, z: number): boolean {
  for (let i = 0; i + 2 < points.length; i += 3) {
    const py = points[i + 1]!;
    if (Math.abs(points[i]! - x) > HALF_WIDTH - 0.03 || py < 0.02 || py > 1.9) continue;
    const pz = points[i + 2]!;
    if (pz > z - 0.17 && pz < z + bodyFront(py)) return false;
  }
  return true;
}

/** The model's geometry in its station's frame, sampled (a few thousand points per table). */
function modelPoints(s: WorldStation, only?: THREE.Object3D): Float32Array {
  const out: number[] = [];
  s.anchor.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(s.anchor.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const im = new THREE.Matrix4();
  const v = new THREE.Vector3();
  (only ?? s.model).traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    const copies = inst ? inst.count : 1;
    const step = Math.max(1, Math.floor((pos.count * copies) / 6000));
    m.multiplyMatrices(inv, mesh.matrixWorld);
    for (let c = 0; c < copies; c++) {
      if (inst) inst.getMatrixAt(c, im).premultiply(m);
      const to = inst ? im : m;
      for (let i = c % step; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(to);
        out.push(v.x, v.y, v.z);
      }
    }
  });
  return Float32Array.from(out);
}

/** An object's box in the station's frame. */
function localBox(s: WorldStation, name: string): THREE.Box3 | null {
  const o = s.model.getObjectByName(name);
  if (!o) return null;
  const p = modelPoints(s, o);
  if (p.length === 0) return null;
  const box = new THREE.Box3();
  for (let i = 0; i < p.length; i += 3) box.expandByPoint(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
  return box;
}

const TABLES: GameId[] = ['blackjack', 'roulette', 'craps', 'baccarat', 'threecard', 'war', 'sicbo', 'bigsix', 'holdem'];

/** A dealer's spot in the station's frame: x, z and a turn from facing the players (+z). */
function dealerSpot(s: WorldStation, points: Float32Array): { x: number; z: number; turn: number } {
  if (s.game === 'bigsix') {
    // beside the wheel on its left (as the players see it), turned a little toward the layout
    const wheel = localBox(s, 'bigsix-wheel');
    if (wheel) {
      const z = (wheel.min.z + wheel.max.z) / 2 + 0.12;
      let x = wheel.max.x + HALF_WIDTH + 0.06;
      for (let k = 0; k < 8 && !standsClear(points, x, z); k++) x += 0.05;
      return { x, z, turn: -0.35 };
    }
  }
  let x = 0;
  if (s.game === 'roulette') {
    // between the wheel and the layout's zero end, the wheel at the dealer's right hand
    const wheel = localBox(s, 'roulette-wheel');
    if (wheel) {
      const cx = (wheel.min.x + wheel.max.x) / 2;
      x = cx + Math.sign(-cx || 1) * 0.36;
    }
  }
  return { x, z: standBehind(modelHits(s), x), turn: 0 };
}

/** Every post on the floor: the tables' dealers, then the bartender and the cashier. */
export function staffPosts(stations: WorldStation[], plan: FloorPlan): StaffPost[] {
  const posts: StaffPost[] = [];
  const at = new THREE.Vector3();
  for (const s of stations) {
    if (!TABLES.includes(s.game)) continue;
    const spot = dealerSpot(s, modelPoints(s));
    s.anchor.updateWorldMatrix(true, false);
    s.anchor.localToWorld(at.set(spot.x, 0, spot.z));
    posts.push({ role: s.game === 'craps' ? 'stickman' : 'dealer', station: s.id, x: at.x, z: at.z, yaw: s.yaw + spot.turn, room: s.room });
  }
  // behind the bar, a little way back from the counter, facing the stools (-x)
  const bar = plan.bar;
  const stools = bar.stools.length ? bar.stools : [(bar.z0 + bar.z1) / 2];
  const mid = stools[Math.floor(stools.length / 2)]!;
  const room = (x: number, z: number) => roomAt(plan, x, z)?.id ?? 'pit';
  const bx = bar.front + bar.depth + 0.42;
  posts.push({ role: 'bartender', station: null, x: bx, z: mid, yaw: -Math.PI / 2, room: room(bx, mid) });
  // in the cage behind the counter, at its middle teller window
  const c = plan.cashier;
  const cz = c.counter.z1 - 0.64 - 0.3;
  posts.push({ role: 'cashier', station: null, x: c.x, z: cz, yaw: 0, room: room(c.x, cz) });
  return posts;
}

// --- where players sit -------------------------------------------------------------------------

/** A chair or stool top counts between these heights (a table top or the floor doesn't). */
const SEAT_MIN = 0.3;
const SEAT_MAX = 0.95;

/**
 * For every seat of every station, the top of the chair or stool that stands there: a ray straight
 * down at the seat against the station's model and `extra` (the floor's props, for bar stools).
 * No seat there (most tables are played standing) leaves null, and the player stands.
 */
export function measureSeats(stations: WorldStation[], seatsOf: (s: WorldStation) => { position: [number, number, number] }[], extra: THREE.Object3D[] = []): void {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const from = new THREE.Vector3();
  for (const s of stations) {
    s.anchor.updateWorldMatrix(true, true);
    s.seatTops = seatsOf(s).map((seat) => {
      const p = s.anchor.localToWorld(new THREE.Vector3(...seat.position));
      ray.set(from.set(p.x, p.y + 1.3, p.z), down);
      ray.far = 1.3;
      const hit = ray.intersectObjects([s.model, ...extra], true).find((h) => !(h.object as THREE.SkinnedMesh).isSkinnedMesh);
      const top = hit ? hit.point.y - p.y : null;
      return top !== null && top >= SEAT_MIN && top <= SEAT_MAX ? top : null;
    });
  }
}

// --- who they are -------------------------------------------------------------------------------

const HAIR_LIGHT = ['#2b1d14', '#4a3020', '#1b1512', '#6b4226', '#8f6a3e', '#7a3b22', '#b89660', '#8c8a86', '#0e0c0b'];
const HAIR_DARK = ['#0e0c0b', '#1b1512', '#2b1d14', '#3a2618', '#6f6c68'];
const HEIGHTS = [1.0, 0.97, 1.03, 0.985, 1.045, 0.96, 1.015];

const UNIFORM: Record<StaffRole, { uniform: UniformId; top: string }> = {
  dealer: { uniform: 'vest', top: '#16171b' },
  stickman: { uniform: 'vest', top: '#16171b' },
  bartender: { uniform: 'vest', top: '#5a1a26' },
  cashier: { uniform: 'blazer', top: '#1d2a44' },
};

/** A small deterministic generator, so a table keeps its dealer from one visit to the next. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The staff's looks and heights, one per post, never two alike: skin tones and heights walk
 * through their lists at different strides, so the pair differs for every one of up to 56 staff
 * (hair and body vary on top of that).
 */
export function staffLooks(posts: StaffPost[], seed = 7): { look: Look; scale: number }[] {
  const r = rng(seed);
  const skinStart = Math.floor(r() * SKIN_TONES.length);
  const heightStart = Math.floor(r() * HEIGHTS.length);
  return posts.map((p, i) => {
    const body: Body = r() < 0.45 ? 'f' : 'm';
    const skin = (skinStart + i * 3) % SKIN_TONES.length;
    const hairs = skin >= 5 ? HAIR_DARK : HAIR_LIGHT;
    const hair = hairs[(i * 5 + Math.floor(r() * hairs.length)) % hairs.length]!;
    const u = UNIFORM[p.role];
    const look: Look = { v: 1, body, outfit: uniformOutfit(u.uniform), skin, hair, top: u.top, bottom: '#1a1b20', shoes: '#0c0c0e' };
    const scale = HEIGHTS[(heightStart + i) % HEIGHTS.length]! * (body === 'f' ? 0.975 : 1);
    return { look, scale };
  });
}

// --- the staff on the floor ---------------------------------------------------------------------

/** The angle from facing `yaw` to looking from (x, z) toward (tx, tz), in -PI..PI. */
export function turnToward(yaw: number, x: number, z: number, tx: number, tz: number): number {
  const want = Math.atan2(tx - x, tz - z);
  return Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
}

interface Member {
  post: StaffPost;
  ch: Person;
  scale: number;
  station: WorldStation | null;
  col: CollisionPost | null;
  shown: boolean;
  /** Current turn of the body away from the post's facing. */
  turn: number;
  /** Who or what they look at, and until when (seconds on the staff clock). */
  gaze: THREE.Vector3 | null;
  gazeWho: THREE.Object3D | 'you' | 'table' | null;
  gazeUntil: number;
  /** The bartender's stroll: where to, and the pause before the next one. */
  walkTo: number | null;
  rest: number;
  /** The still copy that stands in past CULL_M, and whether it is standing in now. */
  far: FarGroup | null;
  farShown: boolean;
}

/** Still copies of everyone in one uniform and colour, as one instanced mesh. */
interface FarGroup {
  mesh: THREE.InstancedMesh;
  members: Member[];
  dirty: boolean;
}

export class Staff {
  readonly group = new THREE.Group();
  readonly posts: StaffPost[];
  private readonly members: Member[] = [];
  private readonly blobs: THREE.InstancedMesh;
  private readonly far: FarGroup[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  private readonly box = new THREE.Box3();
  private readonly cam = new THREE.Vector3();
  private readonly people: THREE.Vector3[] = [];
  private readonly pool: THREE.Vector3[] = [];
  private readonly peopleWho: THREE.Object3D[] = [];
  private clock = 0;
  private blobsDirty = true;
  private readonly rand = rng(911);
  private readonly bar: { z0: number; z1: number };

  constructor(
    private readonly characters: Characters,
    stations: WorldStation[],
    plan: FloorPlan,
    col: Collider | null,
    /** Roles someone else puts on the floor (the floor's life brings its own bartender and bankers). */
    opts: { skip?: StaffRole[] } = {},
  ) {
    this.group.name = 'staff';
    this.posts = staffPosts(stations, plan).filter((p) => !opts.skip?.includes(p.role));
    const looks = staffLooks(this.posts);
    const stools = plan.bar.stools;
    this.bar = stools.length ? { z0: stools[0]!, z1: stools[stools.length - 1]! } : { z0: plan.bar.z0 + 1, z1: plan.bar.z1 - 1 };
    this.posts.forEach((post, i) => {
      const { look, scale } = looks[i]!;
      const ch = characters.create(look, '', { blob: false, staff: true });
      ch.root.position.set(post.x, 0, post.z);
      ch.root.rotation.y = post.yaw;
      ch.root.scale.setScalar(scale);
      ch.root.visible = false;
      const r = rng(i * 7919 + 17);
      ch.setPace(0.88 + r() * 0.24, r());
      ch.sway(r() * 10);
      this.group.add(ch.root);
      this.members.push({
        post,
        ch,
        scale,
        station: stations.find((s) => s.id === post.station) ?? null,
        col: col ? col.post(post.x, post.z, POST_R, POST_TOP, { cam: false }) : null,
        shown: false,
        turn: 0,
        gaze: null,
        gazeWho: null,
        gazeUntil: 0,
        walkTo: null,
        rest: 6 + r() * 10,
        far: null,
        farShown: false,
      });
    });
    this.blobs = new THREE.InstancedMesh(characters.blobGeometry, characters.blob, this.members.length);
    this.blobs.name = 'staff-shadows';
    this.blobs.renderOrder = 1;
    this.blobs.frustumCulled = false;
    this.group.add(this.blobs);
  }

  /** Resolves when every uniform's model is ready (behind the loading screen). */
  async load(): Promise<void> {
    const seen = new Set<string>();
    const waits: Promise<void>[] = [];
    for (const m of this.members) {
      const look = m.ch.currentLook;
      const key = `${look.body}/${look.outfit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      waits.push(this.characters.load(look));
    }
    await Promise.all(waits.map((w) => w.catch((err) => console.warn('uniform failed to load', err))));
    this.buildFar();
  }

  /** The staff member posted at a station (its dealer or stickman). */
  at(stationId: string): Person | null {
    return this.members.find((m) => m.post.station === stationId)?.ch ?? null;
  }

  /** A dealer's motion at a table; false when the station has no dealer. */
  gesture(stationId: string, g: StaffGesture): boolean {
    const m = this.members.find((x) => x.post.station === stationId);
    if (!m) return false;
    m.ch.gesture(g);
    return true;
  }

  /**
   * Every frame: show who's near and in view, and give them their life; `seated` is the table you
   * sit at, `rooms` the rooms that can be seen (visibility.ts): anyone elsewhere isn't drawn.
   */
  update(dt: number, camera: THREE.Camera, seated: WorldStation | null, rooms: Set<string> | null = null, sees: ((room: string, box: THREE.Box3) => boolean) | null = null): void {
    this.clock += dt;
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.cam);
    const cam = camera as THREE.PerspectiveCamera;
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    this.gatherPeople();
    for (const m of this.members) {
      const root = m.ch.root;
      const mine = seated !== null && m.station === seated;
      const d = Math.hypot(root.position.x - this.cam.x, root.position.z - this.cam.z);
      const near = m.shown ? d < CULL_M : d < CULL_M - 1;
      this.sphere.center.set(root.position.x, 0.95, root.position.z);
      this.box.min.set(root.position.x - 0.4, 0, root.position.z - 0.4);
      this.box.max.set(root.position.x + 0.4, 1.9, root.position.z + 0.4);
      const seen = mine || !rooms || (rooms.has(m.post.room) && (!sees || sees(m.post.room, this.box)));
      const show = mine || (seen && near && this.frustum.intersectsSphere(this.sphere));
      // past CULL_M (not merely out of view) the still copy stands in, if its room can be seen
      const farShow = !show && !near && seen;
      if (m.far && farShow !== m.farShown) {
        m.farShown = farShow;
        m.far.dirty = true;
      }
      if (show !== m.shown) {
        m.shown = show;
        root.visible = show;
        this.blobsDirty = true;
      }
      if (!show) continue;
      if (m.post.role === 'bartender') this.stroll(m, dt);
      this.live(m, dt, mine);
      m.ch.update(dt);
    }
    if (this.blobsDirty) this.placeBlobs();
    const mat = this.characters.material();
    for (const g of this.far) {
      if (g.mesh.material !== mat) g.mesh.material = mat;
      if (g.dirty) this.placeFar(g);
    }
  }

  dispose(): void {
    for (const m of this.members) m.ch.dispose();
    this.blobs.dispose();
    for (const g of this.far) {
      g.mesh.geometry.dispose();
      g.mesh.dispose();
    }
    this.group.removeFromParent();
  }

  /** Where everyone who isn't staff is, heads up (your own character too, while it's shown). */
  private gatherPeople(): void {
    this.people.length = 0;
    this.peopleWho.length = 0;
    let n = 0;
    for (const p of this.characters.people()) {
      const r = p.root;
      let shown = r.parent !== null;
      for (let o: THREE.Object3D | null = r; o && shown; o = o.parent) shown = o.visible;
      if (!shown) continue;
      const head = this.pool[n] ?? (this.pool[n] = new THREE.Vector3());
      n++;
      this.people.push(head.set(r.position.x, r.position.y + 1.55 * r.scale.y, r.position.z));
      this.peopleWho.push(r);
    }
  }

  /** Where to look and how far to turn: you when you sit here, else whoever is near, else the table. */
  private live(m: Member, dt: number, mine: boolean): void {
    const root = m.ch.root;
    const x = root.position.x;
    const z = root.position.z;
    const home = m.post.yaw;
    let want = 0;
    if (mine) {
      // face the player: the body turns part of the way, the head the rest
      // (not so far that a hand swings over the chip rack)
      want = THREE.MathUtils.clamp(turnToward(home, x, z, this.cam.x, this.cam.z), -0.5, 0.5);
      if (m.gazeWho !== 'you' || this.clock > m.gazeUntil) {
        // mostly you, now and then a glance down at the layout
        const glance = m.gazeWho === 'you' && this.rand() < 0.3;
        m.gazeWho = glance ? 'table' : 'you';
        m.gazeUntil = this.clock + (glance ? 1.2 + this.rand() : 3 + this.rand() * 3);
        m.gaze = glance ? this.tablePoint(m) : null;
      }
      if (m.gazeWho === 'you') m.gaze = (m.gaze ?? new THREE.Vector3()).set(this.cam.x, this.cam.y - 0.08, this.cam.z);
    } else {
      // the nearest person within reach and in front keeps their gaze a while
      let best = -1;
      let bestD = NOTICE_M;
      for (let i = 0; i < this.people.length; i++) {
        const p = this.people[i]!;
        const dd = Math.hypot(p.x - x, p.z - z);
        if (dd > NOTICE_M || dd < 0.3) continue;
        if (Math.abs(turnToward(home, x, z, p.x, p.z)) > 1.9) continue;
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
      const who = best >= 0 ? this.peopleWho[best]! : null;
      const keep = m.gazeWho instanceof THREE.Object3D && this.clock < m.gazeUntil && this.peopleWho.includes(m.gazeWho);
      if (who && !keep && who !== m.gazeWho) {
        m.gazeWho = who;
        m.gazeUntil = this.clock + 1.5 + this.rand() * 2;
      } else if (!who && m.gazeWho instanceof THREE.Object3D && !keep) {
        m.gazeWho = null;
      }
      if (m.gazeWho instanceof THREE.Object3D) {
        const i = this.peopleWho.indexOf(m.gazeWho);
        const p = this.people[i]!;
        m.gaze = (m.gaze ?? new THREE.Vector3()).copy(p);
        want = THREE.MathUtils.clamp(turnToward(home, x, z, p.x, p.z), -0.45, 0.45) * 0.6;
      } else if (this.clock > m.gazeUntil) {
        // nobody near: look over the layout now and then, or straight ahead
        const table = m.station !== null && this.rand() < 0.6;
        m.gazeWho = table ? 'table' : null;
        m.gaze = table ? this.tablePoint(m) : null;
        m.gazeUntil = this.clock + 2.5 + this.rand() * 4;
      }
    }
    m.turn += (want - m.turn) * (1 - Math.exp(-dt * 2.2));
    if (m.walkTo === null) root.rotation.y = home + m.turn;
    m.ch.lookAt(m.gaze);
  }

  /** A spot on the layout in front of a dealer, where their eyes rest between players. */
  private tablePoint(m: Member): THREE.Vector3 | null {
    const s = m.station;
    if (!s) return null;
    const p = new THREE.Vector3((this.rand() - 0.5) * 1.2, 0.8, -0.2 + this.rand() * 0.5);
    return s.anchor.localToWorld(p);
  }

  /** The bartender now and then walks a few steps along the bar, then turns back to the stools. */
  private stroll(m: Member, dt: number): void {
    const root = m.ch.root;
    if (m.walkTo === null) {
      m.rest -= dt;
      if (m.rest > 0) return;
      const span = this.bar.z1 - this.bar.z0;
      let to = this.bar.z0 + this.rand() * span;
      if (Math.abs(to - root.position.z) < 1.2) to = root.position.z + (to < root.position.z ? -1.6 : 1.6);
      m.walkTo = THREE.MathUtils.clamp(to, this.bar.z0, this.bar.z1);
      m.gazeWho = null;
      m.gaze = null;
      return;
    }
    const dz = m.walkTo - root.position.z;
    const step = Math.min(Math.abs(dz), 1.05 * dt);
    root.position.z += Math.sign(dz) * step;
    const face = dz > 0 ? 0 : Math.PI;
    root.rotation.y += Math.atan2(Math.sin(face - root.rotation.y), Math.cos(face - root.rotation.y)) * (1 - Math.exp(-dt * 6));
    m.ch.setMotion(Math.abs(dz) > 0.05 ? 0.62 : 0);
    if (m.col) m.col.cz = root.position.z;
    this.blobsDirty = true;
    if (Math.abs(dz) <= 0.02) {
      m.walkTo = null;
      m.ch.setMotion(0);
      m.rest = 8 + this.rand() * 14;
      m.turn = Math.atan2(Math.sin(root.rotation.y - m.post.yaw), Math.cos(root.rotation.y - m.post.yaw));
    }
  }

  /** One baked copy per uniform and colour, posed at rest, shared by everyone wearing it. */
  private buildFar(): void {
    const groups = new Map<string, Member[]>();
    for (const m of this.members) {
      const l = m.ch.currentLook;
      const key = `${l.body}|${l.outfit}|${l.top}`;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    for (const members of groups.values()) {
      const first = members[0]!;
      const root = first.ch.root;
      // bake at the origin, facing +z, unscaled: each copy's own matrix places it
      const saved = { p: root.position.clone(), r: root.rotation.y, s: root.scale.x, v: root.visible };
      root.position.set(0, 0, 0);
      root.rotation.y = 0;
      root.scale.setScalar(1);
      first.ch.update(0);
      const geo = first.ch.bake();
      root.position.copy(saved.p);
      root.rotation.y = saved.r;
      root.scale.setScalar(saved.s);
      root.visible = saved.v;
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, this.characters.material(), members.length);
      mesh.name = 'staff-far';
      mesh.count = 0;
      mesh.visible = false;
      this.group.add(mesh);
      const g: FarGroup = { mesh, members, dirty: true };
      for (const m of members) m.far = g;
      this.far.push(g);
    }
  }

  private placeFar(g: FarGroup): void {
    g.dirty = false;
    let n = 0;
    for (const m of g.members) {
      if (!m.farShown) continue;
      m.ch.root.updateMatrix();
      g.mesh.setMatrixAt(n++, m.ch.root.matrix);
    }
    g.mesh.count = n;
    g.mesh.visible = n > 0;
    g.mesh.instanceMatrix.needsUpdate = true;
    if (n > 0) g.mesh.computeBoundingSphere();
  }

  private placeBlobs(): void {
    this.blobsDirty = false;
    const mat = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.members.forEach((m, i) => {
      if (!m.shown) {
        this.blobs.setMatrixAt(i, zero);
        return;
      }
      const p = m.ch.root.position;
      mat.makeScale(m.scale, 1, m.scale).setPosition(p.x, 0.012, p.z);
      this.blobs.setMatrixAt(i, mat);
    });
    this.blobs.instanceMatrix.needsUpdate = true;
  }
}
