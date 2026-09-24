// The staff the floor's life brings (waiters, bankers, the shopkeeper, the bartender): characters
// like the dealers (npcs.ts), dressed in the same made-in-code uniforms, drawn with the characters'
// one shared material as one mesh each. Waiters wear a deep teal waistcoat (the bar's colour), the
// bartender wine red, bankers a navy blazer and the shopkeeper a black one.
//
// Each member is placed by whoever runs it (a waiter's round, a banker's window) and the crew gives
// it life: the idle clip at its own pace, weight shifts while standing, a head that turns to whoever
// comes near, and motions laid over the clips (motions.ts: a nod, a drink handed over, notes
// counted), with a held pose under them (a tray on the left hand).
//
// Cost, as npcs.ts: a member out of the camera's view is hidden and not animated; past LIVE_M it
// gives way to a still copy of itself, drawn with everyone in the same uniform as one instanced
// mesh. Every shadow is one instanced mesh. Each stands on a collision post that goes where they go.

import * as THREE from 'three';
import { SKIN_TONES, type Body, type Look } from '../../../../shared/src/look.ts';
import { uniformOutfit, type Characters, type Person, type UniformId } from '../characters.ts';
import type { Collider, Post } from '../collision.ts';
import { turnToward } from '../npcs.ts';
import { Poser, blend, type Pose } from './pose.ts';
import { MOTIONS, type Motion, type MotionId } from './motions.ts';

export type CrewRole = 'waiter' | 'bartender' | 'banker' | 'shopkeeper';

/** Drawn live out to here (metres from the camera), a still copy beyond (back in 1 m nearer). */
export const LIVE_M = 22;
/** How near someone must be for a head to turn their way. */
const NOTICE_M = 3.6;
const POST_R = 0.28;
const POST_TOP = 1.9;

const DRESS: Record<CrewRole, { uniform: UniformId; top: string; bottom: string }> = {
  waiter: { uniform: 'vest', top: '#0f3a36', bottom: '#15161a' },
  bartender: { uniform: 'vest', top: '#5a1a26', bottom: '#1a1b20' },
  banker: { uniform: 'blazer', top: '#1d2a44', bottom: '#1a1b20' },
  shopkeeper: { uniform: 'blazer', top: '#18181c', bottom: '#141417' },
};

const HAIR_LIGHT = ['#2b1d14', '#4a3020', '#1b1512', '#6b4226', '#8f6a3e', '#7a3b22', '#b89660', '#8c8a86', '#0e0c0b'];
const HAIR_DARK = ['#0e0c0b', '#1b1512', '#2b1d14', '#3a2618', '#6f6c68'];
const HEIGHTS = [1.0, 0.975, 1.03, 0.99, 1.045, 0.965, 1.015];

/** A small deterministic generator: the same crew on every visit and every client. */
export function rng(seed: number): () => number {
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
 * The crew's looks and heights, one each, none alike: skin tones and heights walk their lists at
 * different strides from a start of their own (not the dealers'), hair and body vary on top.
 */
export function crewLooks(roles: CrewRole[], seed = 4242): { look: Look; scale: number }[] {
  const r = rng(seed);
  const skinStart = Math.floor(r() * SKIN_TONES.length);
  const heightStart = Math.floor(r() * HEIGHTS.length);
  return roles.map((role, i) => {
    const body: Body = r() < 0.5 ? 'f' : 'm';
    const skin = (skinStart + i * 3) % SKIN_TONES.length;
    const hairs = skin >= 5 ? HAIR_DARK : HAIR_LIGHT;
    const hair = hairs[(i * 5 + Math.floor(r() * hairs.length)) % hairs.length]!;
    const d = DRESS[role];
    const look: Look = { v: 1, body, outfit: uniformOutfit(d.uniform), skin, hair, top: d.top, bottom: d.bottom, shoes: '#0c0c0e' };
    const scale = HEIGHTS[(heightStart + i) % HEIGHTS.length]! * (body === 'f' ? 0.975 : 1);
    return { look, scale };
  });
}

export interface Member {
  readonly role: CrewRole;
  readonly ch: Person;
  readonly poser: Poser;
  readonly scale: number;
  /** Where to draw them this frame, and which way they face (rotation.y). */
  x: number;
  z: number;
  yaw: number;
  /** 0 standing, 1 a full walk (Character.setMotion). */
  motion: number;
  /** A pose held under the motions (a tray on the left hand). */
  hold: Pose | null;
  /** Where the eyes go; null lets them look at whoever comes near. */
  look: THREE.Vector3 | null;
  /** Shown live this frame (in view and near enough). */
  shown: boolean;
  /** internal */
  act: { m: Motion; t: number } | null;
  col: Post | null;
  far: FarGroup | null;
  farShown: boolean;
  gazeWho: THREE.Object3D | null;
  gazeUntil: number;
  gaze: THREE.Vector3;
  /** Weight shifts while standing (their own seed), and whether they're on now. */
  sway: number;
  swaying: boolean;
}

interface FarGroup {
  mesh: THREE.InstancedMesh;
  members: Member[];
  dirty: boolean;
}

export class Crew {
  readonly group = new THREE.Group();
  readonly members: Member[] = [];
  private blobs: THREE.InstancedMesh | null = null;
  private readonly far: FarGroup[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  private readonly cam = new THREE.Vector3();
  private readonly people: THREE.Vector3[] = [];
  private readonly peopleWho: THREE.Object3D[] = [];
  private readonly pool: THREE.Vector3[] = [];
  private readonly rand = rng(733);
  private clock = 0;
  private readonly looks: { look: Look; scale: number }[];

  /** `roles` in the order members will be added (their looks are dealt out up front). */
  constructor(
    private readonly characters: Characters,
    private readonly col: Collider | null,
    roles: CrewRole[],
  ) {
    this.group.name = 'floor-life';
    this.looks = crewLooks(roles);
  }

  /** A new member, standing at (x, z) facing `yaw`. */
  add(role: CrewRole, x: number, z: number, yaw: number): Member {
    const i = this.members.length;
    const { look, scale } = this.looks[i] ?? crewLooks([role], 9000 + i)[0]!;
    const d = DRESS[role];
    const ch = this.characters.create({ ...look, top: d.top, bottom: d.bottom, outfit: uniformOutfit(d.uniform) }, '', { blob: false, staff: true });
    ch.root.scale.setScalar(scale);
    ch.root.visible = false;
    ch.root.position.set(x, 0, z);
    ch.root.rotation.y = yaw;
    const r = rng(i * 7919 + 101);
    ch.setPace(0.88 + r() * 0.24, r());
    const sway = r() * 10;
    this.group.add(ch.root);
    const m: Member = {
      role,
      ch,
      poser: new Poser(ch.root),
      scale,
      x,
      z,
      yaw,
      motion: 0,
      hold: null,
      look: null,
      shown: false,
      act: null,
      col: this.col ? this.col.post(x, z, POST_R, POST_TOP, { cam: false }) : null,
      far: null,
      farShown: false,
      gazeWho: null,
      gazeUntil: 0,
      gaze: new THREE.Vector3(),
      sway,
      swaying: false,
    };
    this.members.push(m);
    return m;
  }

  /** Resolves when every uniform's model is ready; then the far copies are baked. */
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
    await Promise.all(waits.map((w) => w.catch((err) => console.warn('crew uniform failed to load', err))));
    // (room for a few more: a shopkeeper can arrive with a boutique later)
    this.blobs = new THREE.InstancedMesh(this.characters.blobGeometry, this.characters.blob, this.members.length + 4);
    this.blobs.name = 'crew-shadows';
    this.blobs.renderOrder = 1;
    this.blobs.frustumCulled = false;
    this.blobs.count = 0;
    this.group.add(this.blobs);
    this.buildFar();
  }

  /** Play a motion over whatever they're doing (a new one replaces one still playing). */
  play(m: Member, motion: MotionId | Motion): void {
    m.act = { m: typeof motion === 'string' ? MOTIONS[motion] : motion, t: 0 };
  }

  /** Seconds left of the motion playing, 0 when none. */
  playing(m: Member): number {
    return m.act ? Math.max(0, m.act.m.dur - m.act.t) : 0;
  }

  /** Stop a motion that is playing. */
  still(m: Member): void {
    m.act = null;
  }

  /**
   * Every frame, after the owners have placed their members. `rooms` are the rooms the camera can
   * see into (visibility.ts) and `roomOf` says which one a point is in: anyone elsewhere isn't
   * drawn, not even as a still copy.
   */
  update(dt: number, camera: THREE.Camera, rooms: ReadonlySet<string> | null = null, sees: ((room: string, box: THREE.Box3) => boolean) | null = null, roomOf: ((x: number, z: number) => string | null) | null = null): void {
    this.clock += dt;
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.cam);
    const cam = camera as THREE.PerspectiveCamera;
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    this.gatherPeople();
    let blobs = 0;
    for (const m of this.members) {
      const root = m.ch.root;
      const moved = root.position.x !== m.x || root.position.z !== m.z || root.rotation.y !== m.yaw;
      root.position.x = m.x;
      root.position.z = m.z;
      root.rotation.y = m.yaw;
      if (m.col) {
        m.col.cx = m.x;
        m.col.cz = m.z;
      }
      const d = Math.hypot(m.x - this.cam.x, m.z - this.cam.z);
      const near = m.shown ? d < LIVE_M : d < LIVE_M - 1;
      this.sphere.center.set(m.x, 0.95, m.z);
      const room = rooms && roomOf ? roomOf(m.x, m.z) : null;
      _box.min.set(m.x - 0.4, 0, m.z - 0.4);
      _box.max.set(m.x + 0.4, 1.9, m.z + 0.4);
      const seen = !rooms || !room || (rooms.has(room) && (!sees || sees(room, _box)));
      const show = seen && near && this.frustum.intersectsSphere(this.sphere);
      const farShow = seen && !show && !near;
      if (m.far && (farShow !== m.farShown || (farShow && moved))) {
        m.farShown = farShow;
        m.far.dirty = true;
      }
      if (show !== m.shown) {
        m.shown = show;
        root.visible = show;
      }
      if (m.act) {
        m.act.t += dt;
        if (m.act.t >= m.act.m.dur) m.act = null;
      }
      if (!show) continue;
      if (this.blobs && blobs < this.blobs.instanceMatrix.count) {
        _mat.makeScale(m.scale, 1, m.scale).setPosition(m.x, 0.012, m.z);
        this.blobs.setMatrixAt(blobs++, _mat);
      }
      m.ch.setMotion(m.motion);
      // weight from foot to foot while standing still, not on the move
      const standing = m.motion < 0.05;
      if (standing !== m.swaying) {
        m.swaying = standing;
        m.ch.sway(standing ? m.sway : null);
      }
      m.poser.restore();
      m.ch.lookAt(this.gazeFor(m));
      m.ch.update(dt);
      const act = m.act ? m.act.m.pose(m.act.t) : null;
      if (m.hold || act) m.poser.apply(blend([m.hold ?? {}, 1], [act ?? {}, 1]));
    }
    if (this.blobs) {
      this.blobs.count = blobs;
      this.blobs.instanceMatrix.needsUpdate = true;
    }
    const mat = this.characters.material();
    for (const g of this.far) {
      if (g.mesh.material !== mat) g.mesh.material = mat;
      if (g.dirty) this.placeFar(g);
    }
  }

  dispose(): void {
    for (const m of this.members) {
      m.ch.dispose();
      if (m.col && this.col) {
        const i = this.col.posts.indexOf(m.col);
        if (i >= 0) this.col.posts.splice(i, 1);
      }
    }
    this.blobs?.dispose();
    for (const g of this.far) {
      g.mesh.geometry.dispose();
      g.mesh.dispose();
    }
    this.group.removeFromParent();
  }

  /** Where the eyes go: what the owner asked for, else whoever is near and in front, else ahead. */
  private gazeFor(m: Member): THREE.Vector3 | null {
    if (m.look) return m.look;
    let best = -1;
    let bestD = NOTICE_M;
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i]!;
      const dd = Math.hypot(p.x - m.x, p.z - m.z);
      if (dd > NOTICE_M || dd < 0.3) continue;
      if (Math.abs(turnToward(m.yaw, m.x, m.z, p.x, p.z)) > 1.6) continue;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    const who = best >= 0 ? this.peopleWho[best]! : null;
    const keep = m.gazeWho !== null && this.clock < m.gazeUntil && this.peopleWho.includes(m.gazeWho);
    if (who && !keep && who !== m.gazeWho) {
      m.gazeWho = who;
      m.gazeUntil = this.clock + 1.5 + this.rand() * 2;
    } else if (!who && !keep) {
      m.gazeWho = null;
    }
    if (!m.gazeWho) return null;
    const i = this.peopleWho.indexOf(m.gazeWho);
    return i >= 0 ? m.gaze.copy(this.people[i]!) : null;
  }

  /** Where everyone who isn't staff is, heads up. */
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

  /** One baked copy per uniform and colour, posed at rest, shared by everyone wearing it. */
  private buildFar(): void {
    const groups = new Map<string, Member[]>();
    for (const m of this.members) {
      // the cage's tellers and the boutique's keeper stand in corners behind bars and counters:
      // from across the floor they simply aren't drawn (a still copy each would cost a draw call)
      if (m.role === 'banker' || m.role === 'shopkeeper') continue;
      const l = m.ch.currentLook;
      const key = `${l.body}|${l.outfit}|${l.top}`;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    for (const members of groups.values()) {
      const first = members[0]!;
      const root = first.ch.root;
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
      mesh.name = 'crew-far';
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
}

const _mat = new THREE.Matrix4();
const _box = new THREE.Box3();
