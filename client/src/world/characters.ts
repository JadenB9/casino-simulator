// Characters: the Quaternius modular men and women, dressed from a Look.
//
// Each outfit file is one skinned mesh with a primitive per original material (see
// scripts/assets-world.mjs). On load those primitives are joined into one geometry and every
// vertex remembers which Look slot it belongs to (outfits.json). A character is then a clone of
// the skeleton plus its own colour attribute, drawn with one shared vertex-coloured material:
// one draw call per character, and recolouring one player can never touch another (nothing
// shared is ever mutated, the per-instance colours live in that character's own buffer).
//
// Motion blends Idle, Walk and Run by weight (setMotion 0 = idle, 1 = walk, 2 = run) and the name
// floats over the head as a CSS2D label. Emotes are acted out on top of that (gesture): after the
// mixer has posed the body, each arm is solved to where the emote wants its hand (reach: the
// wrist at a point or the arm along given directions, the elbow bending about its own hinge, the
// palm turned by the forearm and the wrist, fingers closed into a fist), in the character's own
// frame and in arm lengths, so a clap's palms meet on either body, standing or seated.
//
// The same hand posing gives the floor's staff their life (world/npcs.ts: a head that turns to
// look at someone, slow weight shifts, a dealer's arm motions) and seats a player on a chair
// (sit). Staff wear uniforms: outfits made from the players' models, see the end of this file.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { skipWhileHidden } from '../render/matrices.ts';
import { modelBytes } from '../render/model-bytes.ts';
import { DEFAULT_LOOK, OUTFITS, SKIN_TONES, type Body, type Look } from '../../../shared/src/look.ts';
import type { Quality } from '../render/engine3d.ts';
import type { Character, CharacterFactory } from './contract.ts';
import type { EmoteId } from '../../../shared/src/protocol.ts';
import { Wearables, dressed } from './wearables.ts';
import { Ride, kneeFor, rideSpec, stanceYaw } from './rides.ts';

export const MODEL_BASE = `${import.meta.env.BASE_URL}assets/models/`;

type Slot = 'skin' | 'skinShade' | 'hair' | 'hairShade' | 'brows' | 'top' | 'bottom' | 'shoes';
const SLOTS: Slot[] = ['skin', 'skinShade', 'hair', 'hairShade', 'brows', 'top', 'bottom', 'shoes'];
const FIXED = 255;

interface OutfitEntry {
  file: string;
  parts: Record<string, Slot>;
  prims: { part: string; material: string; slot: Slot | null }[];
}

interface Manifest {
  version: 1;
  clips: string[];
  m: Record<string, OutfitEntry>;
  f: Record<string, OutfitEntry>;
}

/** One loaded outfit: the skeleton and joined mesh to clone, per-vertex slots and authored colours. */
interface Template {
  root: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  slot: Uint8Array;
  base: Float32Array;
  clips: THREE.AnimationClip[];
  height: number;
}

const NAME_Y = 2.08;
const LABEL_RANGE = 20;
const LABEL_MAX = 24;

export class Characters implements CharacterFactory {
  private manifest: Promise<Manifest>;
  private templates = new Map<string, Promise<Template>>();
  private loaded = new Map<string, Template>();
  private loader = new GLTFLoader();
  /**
   * Each model file's bytes, fetched once: the staff's uniforms are cut from the suit and smart
   * outfits, so those files are built into two templates each (a build rearranges its own parse).
   */
  private files = new Map<string, Promise<ArrayBuffer>>();
  private mats: Partial<Record<Quality, THREE.Material>> = {};
  private readonly live = new Set<Person>();
  readonly blobGeometry = new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2);

  constructor(
    private quality: Quality,
    readonly blob: THREE.Material,
  ) {
    this.manifest = fetch(`${MODEL_BASE}outfits.json`).then((r) => {
      if (!r.ok) throw new Error(`outfits.json: ${r.status}`);
      return r.json() as Promise<Manifest>;
    });
  }

  /** The shared material for every character at the current quality. */
  material(): THREE.Material {
    let m = this.mats[this.quality];
    if (!m) {
      m = this.quality === 'high' ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
      m.name = 'character';
      this.mats[this.quality] = m;
    }
    return m;
  }

  /** Resolves when the model for `look` is ready to show (create() never waits). */
  async load(look: Look): Promise<void> {
    await this.template(look.body, dressed(look).outfit);
  }

  create(look: Look, name: string, opts: PersonOptions = {}): Person {
    const p = new Person(this, look, name, opts);
    this.live.add(p);
    return p;
  }

  /** Everyone drawn on the floor who isn't staff (you, other players), shown or not. */
  *people(): Iterable<Person> {
    for (const p of this.live) if (!p.staff) yield p;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    for (const p of this.live) p.useMaterial(this.material());
  }

  /** Show only the nearest name tags within range (the rest cost DOM work for nothing). */
  updateLabels(camera: THREE.Camera): void {
    const cam = camera.getWorldPosition(_v);
    const near: [number, Person][] = [];
    for (const p of this.live) {
      if (!p.tag.element.textContent) continue;
      const d = p.root.getWorldPosition(_w).distanceToSquared(cam);
      near.push([d, p]);
    }
    near.sort((a, b) => a[0] - b[0]);
    near.forEach(([d, p], i) => p.showTag(i < LABEL_MAX && d < LABEL_RANGE * LABEL_RANGE));
  }

  forget(p: Person): void {
    this.live.delete(p);
  }

  /** The template for an outfit, loaded once; null while it loads. */
  ready(body: string, outfit: string): Template | null {
    return this.loaded.get(`${body}/${outfit}`) ?? null;
  }

  template(body: string, outfit: string): Promise<Template> {
    const key = `${body}/${outfit}`;
    let t = this.templates.get(key);
    if (!t) {
      t = this.build(body, outfit).then((tpl) => {
        this.loaded.set(key, tpl);
        return tpl;
      });
      this.templates.set(key, t);
    }
    return t;
  }

  private async build(body: string, outfit: string): Promise<Template> {
    const man = await this.manifest;
    const uniform = uniformFor(outfit);
    const entry = (body === 'f' ? man.f : man.m)[uniform ? uniform.base[body === 'f' ? 'f' : 'm'] : outfit] ?? man.m.suit!;
    let bytes = this.files.get(entry.file);
    if (!bytes) {
      bytes = modelBytes(MODEL_BASE + entry.file);
      this.files.set(entry.file, bytes);
      bytes.catch(() => this.files.delete(entry.file));
    }
    const gltf = await this.loader.parseAsync(await bytes, MODEL_BASE);
    const parts: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
    });
    if (parts.length === 0) throw new Error(`${entry.file}: no skinned mesh`);
    // join the primitives (same skeleton, same node) and note each vertex's slot and colour
    const geos: THREE.BufferGeometry[] = [];
    const slots: number[] = [];
    const base: number[] = [];
    /** Per vertex, which part and original material it came from (for uniforms). */
    const from: { part: string; material: string }[] = [];
    parts.forEach((mesh, i) => {
      const g = mesh.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
      const n = g.getAttribute('position').count;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const prim = entry.prims[i];
      const slot = prim && prim.material === mat.name ? prim.slot : (entry.parts[`*/${mat.name}`] ?? null);
      const s = slot ? SLOTS.indexOf(slot) : FIXED;
      const c = mat.color ?? new THREE.Color(1, 1, 1);
      const src = { part: prim?.part ?? '', material: mat.name };
      for (let k = 0; k < n; k++) {
        slots.push(s);
        base.push(c.r, c.g, c.b);
        if (uniform) from.push(src);
      }
      geos.push(g);
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) throw new Error(`${entry.file}: parts don't merge`);
    const first = parts[0]!;
    const joined = new THREE.SkinnedMesh(merged, this.material());
    joined.name = 'body';
    joined.position.copy(first.position);
    joined.quaternion.copy(first.quaternion);
    joined.scale.copy(first.scale);
    first.parent!.add(joined);
    joined.bind(first.skeleton, first.bindMatrix);
    for (const p of parts) p.removeFromParent();
    merged.computeBoundingSphere();
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const tpl: Template = {
      root: gltf.scene,
      geometry: merged,
      slot: Uint8Array.from(slots),
      base: Float32Array.from(base),
      clips: gltf.animations,
      height: box.max.y - box.min.y,
    };
    return uniform ? tailor(tpl, joined, uniform, from, body === 'f' ? 'f' : 'm') : tpl;
  }
}

export interface PersonOptions {
  /** Draw the soft shadow under the feet (staff share one instanced set instead). */
  blob?: boolean;
  /** Floor staff: left out of people(). */
  staff?: boolean;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();

export class Person implements Character {
  readonly root = new THREE.Group();
  readonly tag: CSS2DObject;
  readonly staff: boolean;
  private model: THREE.Object3D | null = null;
  private mesh: THREE.SkinnedMesh | null = null;
  private colors: THREE.BufferAttribute | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: THREE.AnimationAction[] = [];
  private weights = [1, 0, 0];
  private speed = 0;
  private look: Look;
  private template: Template | null = null;
  private shownKey = '';
  private disposed = false;
  private tagOn = true;
  /** The boutique's pieces and a held bar order (wearables.ts). */
  private readonly wear = new Wearables();
  private bones: Partial<Record<BoneKey, THREE.Object3D>> = {};
  /** Both arms as the emotes pose them (reach()), measured when the model is shown. */
  private arms: Partial<Record<'R' | 'L', Arm>> = {};
  /** Bones this frame's gesture turned, and the mixer's pose for them (put back next frame). */
  private readonly posed = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly spare = new Map<THREE.Object3D, THREE.Quaternion>();
  private act: { e: EmoteId | StaffGesture; t: number } | null = null;
  private modelY = 0;
  // --- posing layers (see the functions after the class) ---
  /** Where the head looks (world space), and the eased yaw/pitch it has got to. */
  private gaze: THREE.Vector3 | null = null;
  private readonly aim = { yaw: 0, pitch: 0 };
  /** Weight shifts: on with a seed so neighbours don't move in step; the clock that drives them. */
  private swaySeed: number | null = null;
  private swayT = 0;
  /** Seat top above the feet while sitting, and how far the model is lowered for it. */
  private seatTop: number | null = null;
  private seated = 0;
  private legs: { hip: number; thigh: number; knee: number; thighTip: number; shinTip: number } | null = null;
  /** Idle clip speed and phase (staff breathe out of step with each other). */
  private pace: { rate: number; phase: number } | null = null;
  /** The shadow under the feet (none for staff), and the root height the caller last gave us. */
  private blobMesh: THREE.Mesh | null = null;
  private rootFloor = 0;
  private rootSet = Number.NaN;
  // --- v6 looks6: riding (rides.ts) ---
  /** The ride the look wears, hung on the root; stood on unless sitting. */
  private ride: Ride | null = null;
  /** Bones the riding stance moved (feet, hips), and where the animation had them (put back next frame). */
  private readonly moved = new Map<THREE.Object3D, THREE.Vector3>();
  /** Where the root was last frame, and how fast it goes and turns (for the ride's wheels and lean). */
  private rideLast: { x: number; z: number; yaw: number } | null = null;
  private rideSpeed = 0;
  private rideYaw = 0;

  constructor(
    private readonly factory: Characters,
    look: Look,
    name: string,
    opts: PersonOptions = {},
  ) {
    this.look = look;
    this.staff = opts.staff ?? false;
    this.root.name = 'character';
    // a hidden character's seventy-odd bones aren't worth a matrix update every frame
    skipWhileHidden(this.root);
    const el = document.createElement('div');
    el.className = 'world-tag';
    this.tag = new CSS2DObject(el);
    this.tag.position.set(0, NAME_Y, 0);
    this.root.add(this.tag);
    if (opts.blob ?? true) {
      const blob = (this.blobMesh = new THREE.Mesh(factory.blobGeometry, factory.blob));
      blob.position.y = 0.012;
      blob.renderOrder = 1;
      this.root.add(blob);
    }
    this.setName(name);
    this.setLook(look);
  }

  setLook(look: Look): void {
    this.look = look = dressed(look);
    this.mountRide(look.ride);
    const key = `${look.body}/${look.outfit}`;
    if (key === this.shownKey) {
      this.paint();
      return;
    }
    const tpl = this.factory.ready(look.body, look.outfit);
    if (tpl) {
      this.show(tpl, key);
      return;
    }
    void this.factory
      .template(look.body, look.outfit)
      .then((t) => {
        // only if the look hasn't moved on while it loaded
        if (!this.disposed && `${this.look.body}/${this.look.outfit}` === key) this.show(t, key);
      })
      .catch(() => {
        if (!this.disposed && key !== `${DEFAULT_LOOK.body}/${DEFAULT_LOOK.outfit}`) this.setLook({ ...look, body: DEFAULT_LOOK.body, outfit: DEFAULT_LOOK.outfit });
      });
  }

  setMotion(speed: number): void {
    this.speed = Math.max(0, Math.min(2, speed));
  }

  setName(name: string): void {
    this.tag.element.textContent = name;
    this.tag.visible = this.tagOn && name !== '';
  }

  /**
   * The soft shadow under the feet (none for staff, who share one instanced set). RemotePlayers
   * hides it and draws everyone's from its world matrix in one instanced mesh.
   */
  get shadow(): THREE.Mesh | null {
    return this.blobMesh;
  }

  /** Called by the factory's label culling. */
  showTag(on: boolean): void {
    this.tagOn = on;
    this.tag.visible = on && this.tag.element.textContent !== '';
  }

  useMaterial(m: THREE.Material): void {
    if (this.mesh) this.mesh.material = this.wear.body(m);
  }

  /** The Look this character is drawn from. */
  get currentLook(): Look {
    return this.look;
  }

  /** Act out an emote, or one of a dealer's motions (StaffGesture). */
  gesture(e: EmoteId | StaffGesture): void {
    this.act = { e, t: 0 };
  }

  /** Turn the head (and a little of the neck) toward a point in world space; null looks ahead. */
  lookAt(p: THREE.Vector3 | null): void {
    if (p) (this.gaze ??= new THREE.Vector3()).copy(p);
    else this.gaze = null;
  }

  /** Slow weight shifts from foot to foot, out of step with anyone given another seed; null stops. */
  sway(seed: number | null): void {
    this.swaySeed = seed;
  }

  /**
   * Sit on a seat whose top is `seatTop` above the feet (the root's own units: metres unless the
   * root is scaled): hips and knees bend until the shins hang onto the floor, the character drops
   * onto the seat (its name tag and bubbles with it) and the forearms come forward onto the
   * table's rail. Null stands up again.
   */
  sit(seatTop: number | null): void {
    this.seatTop = seatTop;
  }

  /**
   * A still copy of the character as posed now, in its root's frame: skinned on the CPU, in its
   * own colours, for a far-away stand-in (world/npcs.ts). Null until its model has loaded.
   */
  bake(): THREE.BufferGeometry | null {
    const mesh = this.mesh;
    const index = mesh?.geometry.getIndex();
    if (!mesh || !this.colors || !index) return null;
    // updateMatrixWorld, not updateWorldMatrix: only the former refreshes the skinned mesh's
    // bindMatrixInverse, which getVertexPosition works through
    this.root.updateWorldMatrix(true, false);
    this.root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(this.root.matrixWorld).invert().multiply(mesh.matrixWorld);
    const n = mesh.geometry.getAttribute('position').count;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) mesh.getVertexPosition(i, _v).applyMatrix4(toRoot).toArray(pos, i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute((this.colors.array as Uint16Array).slice(), 3, true));
    g.setIndex(new THREE.BufferAttribute((index.array as Uint16Array | Uint32Array).slice(), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** The idle clip's speed (1 = as made) and where in it to start (0-1), so a crowd breathes out of step. */
  setPace(rate: number, phase: number): void {
    this.pace = { rate, phase };
    this.applyPace();
  }

  update(dt: number): void {
    if (!this.mixer) {
      // still loading: a gesture made meanwhile runs out rather than playing late
      if (this.act && (this.act.t += dt) > (gestureOf(this.act.e)?.dur ?? 0)) this.act = null;
      return;
    }
    // the mixer only rewrites bones its clips move: undo last frame's gesture first
    for (const [bone, q] of this.posed) bone.quaternion.copy(q);
    this.posed.clear();
    for (const [bone, p] of this.moved) bone.position.copy(p);
    this.moved.clear();
    const riding = this.rideOn(dt);
    // idle -> walk -> run by weight, eased so starts and stops cross-fade (a rider stands still on it)
    const s = riding ? 0 : this.speed;
    const target = s <= 1 ? [1 - s, s, 0] : [0, 2 - s, s - 1];
    const k = 1 - Math.exp(-dt * 9);
    for (let i = 0; i < 3; i++) {
      this.weights[i] = this.weights[i]! + (target[i]! - this.weights[i]!) * k;
      this.actions[i]?.setEffectiveWeight(this.weights[i]!);
    }
    const walk = this.actions[1];
    if (walk) walk.timeScale = 0.85 + 0.3 * Math.min(1, s);
    this.mixer.update(dt);
    // then the hand posing, each layer on top of the last: legs, body, head, arms
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(_rootQ).invert();
    _rootInv.copy(this.root.matrixWorld).invert();
    let y = 0;
    let drop = 0;
    if (this.seatTop !== null) drop = this.sitPose();
    else if (riding) y += this.ridePose();
    else if (this.swaySeed !== null) this.swayPose(dt);
    this.lookPose(dt);
    if (this.act) y += this.perform(dt);
    if (this.model) this.model.position.y = this.modelY + y;
    this.settle(drop);
  }

  /** Pose the body for the emote being acted out; returns how high it hops. */
  private perform(dt: number): number {
    const act = this.act!;
    const g = gestureOf(act.e);
    act.t += dt;
    if (!g || act.t >= g.dur || !this.model) {
      this.act = null;
      return 0;
    }
    // ease into the pose and back out of it
    const k = smooth(Math.min(1, act.t / 0.22)) * smooth(Math.min(1, (g.dur - act.t) / 0.3));
    const pose = g.pose(act.t, this.seatTop !== null);
    for (const key of BONE_ORDER) {
      const turn = pose[key];
      if (turn) this.turn(key, turn, k);
    }
    if (pose.handR || pose.handL) this.hands(pose, k);
    return (pose.hop ?? 0) * k;
  }

  /**
   * Turn one bone about the character's own axes (x left, y up, z forward) on top of its pose
   * now, by Euler angles (see Turn) scaled by `k`.
   */
  private turn(key: BoneKey, t: Turn, k = 1): void {
    const bone = this.bones[key];
    if (bone) this.rotate(bone, _turnQ.setFromEuler(_euler.set(t[0] * k, t[1] * k, t[2] * k, 'YXZ')));
  }

  /**
   * Turn a bone about its joint by `q`, a rotation in the character's own frame, on top of its
   * pose now: the turn is carried into the bone's parent frame and put in front of its local
   * rotation. The pose before the frame's first turn is kept; update() puts it back.
   */
  private rotate(bone: THREE.Object3D, q: THREE.Quaternion): void {
    if (!bone.parent) return;
    bone.parent.getWorldQuaternion(_parentQ).premultiply(_rootQ);
    _localQ.copy(q).premultiply(_invQ.copy(_parentQ).invert()).multiply(_parentQ);
    if (!this.posed.has(bone)) {
      let p = this.spare.get(bone);
      if (!p) this.spare.set(bone, (p = new THREE.Quaternion()));
      this.posed.set(bone, p.copy(bone.quaternion));
    }
    bone.quaternion.premultiply(_localQ);
    bone.updateMatrixWorld(true);
  }

  /** Turn a bone about its joint until it points along `dir` (the character's frame, unit length). */
  private point(bone: THREE.Object3D, dir: THREE.Vector3): void {
    // every bone of these rigs runs along its own +y
    const y = _y.set(0, 1, 0).applyQuaternion(spin(bone, _qd));
    this.rotate(bone, _qd.setFromUnitVectors(y, dir));
  }

  /** Both hands of an emote's pose, measured from the middle of the shoulders in arm lengths. */
  private hands(pose: Pose, k: number): void {
    const r = this.arms.R;
    const l = this.arms.L;
    if (!r || !l) return;
    const right = local(r.upper, _sh);
    const mid = local(l.upper, _mid).add(right).multiplyScalar(0.5);
    const len = right.distanceTo(local(r.lower, _el)) + _el.distanceTo(local(r.wrist, _wr));
    if (pose.handR) this.reach(r, 1, pose.handR, mid, len, k);
    if (pose.handL) this.reach(l, -1, pose.handL, mid, len, k);
  }

  /**
   * Put one arm where an emote wants it (see Hand): the elbow and the wrist first, then the palm,
   * then the fingers. The upper arm turns about its length until the elbow's own hinge lies square
   * to the plane the arm now bends in, so the forearm swings into place as an elbow bends; the turn
   * of the hand is shared between the forearm (as a forearm turns) and the wrist. All of it is
   * solved in full and then blended with the pose it replaces by `k`, as the emote eases in and
   * out. `m` is 1 for the right arm and -1 for the left, which mirrors the hand's numbers.
   */
  private reach(arm: Arm, m: number, h: Hand, mid: THREE.Vector3, len: number, k: number): void {
    arm.bones.forEach((b, i) => arm.from[i]!.copy(b.quaternion));
    const S = local(arm.upper, _sh);
    const E = local(arm.lower, _el);
    const W = local(arm.wrist, _wr);
    const a = S.distanceTo(E);
    const b = E.distanceTo(W);
    // where the elbow and the wrist go
    const elbow = _e1;
    const wrist = _t;
    if (h.at) {
      wrist.set(h.at[0] * m, h.at[1], h.at[2]).multiplyScalar(len).add(mid);
      wrist.x -= (h.out ?? 0) * m;
      const u = _u.subVectors(wrist, S);
      const d = THREE.MathUtils.clamp(u.length(), Math.abs(a - b) + 1e-4, (a + b) * 0.999);
      u.normalize();
      wrist.copy(S).addScaledVector(u, d);
      // the elbow sits where both bones' lengths meet, out toward the side it was given
      const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
      const out = mirrored(h.elbow ?? DOWN, m, _hint);
      out.addScaledVector(u, -out.dot(u));
      if (out.lengthSq() < 1e-8) out.set(-m, 0, 0).addScaledVector(u, u.x * m);
      out.normalize();
      elbow.copy(S).addScaledVector(u, a * cos).addScaledVector(out, a * Math.sqrt(1 - cos * cos));
    } else {
      elbow.copy(S).addScaledVector(mirrored(h.upper ?? DOWN, m, _hint).normalize(), a);
      wrist.copy(elbow).addScaledVector(mirrored(h.fore ?? DOWN, m, _hint).normalize(), b);
    }
    // 1. the upper arm onto the elbow (when the arm is straight, any turn about its length will do)
    const dir0 = _d0.subVectors(E, S).normalize();
    const dir1 = _d1.subVectors(elbow, S).normalize();
    const fore = _fore.subVectors(wrist, elbow).normalize();
    const hinge = _h1.crossVectors(dir1, fore);
    if (hinge.lengthSq() > 1e-4) {
      frame(dir0, _h0.copy(arm.hinge).applyQuaternion(spin(arm.upper, _qa)), _qb);
      this.rotate(arm.upper, frame(dir1, hinge, _qa).multiply(_qb.invert()));
    } else {
      this.rotate(arm.upper, _qa.setFromUnitVectors(dir0, dir1));
    }
    // 2. the forearm onto the wrist
    local(arm.lower, E);
    local(arm.wrist, W);
    this.rotate(arm.lower, _qa.setFromUnitVectors(_d0.subVectors(W, E).normalize(), fore));
    // 3. the hand: half its turn about the forearm's length is the forearm's, the rest the wrist's
    const palm = mirrored(h.palm, m, _pt).normalize();
    const along = h.fingers ? mirrored(h.fingers, m, _ft) : _ft.copy(fore);
    along.addScaledVector(palm, -along.dot(palm)).normalize();
    frame(palm, along, _qt);
    _qa.copy(_qt).multiply(this.handFrame(arm, _qb).invert());
    this.rotate(arm.lower, _qc.identity().slerp(twist(_qa, fore, _qb), 0.5));
    this.rotate(arm.wrist, _qa.copy(_qt).multiply(this.handFrame(arm, _qb).invert()));
    // 4. the fingers closed into a fist, and the thumb up along its top
    if (h.fist) {
      // turning the fingers' way about this axis curls them toward the palm
      const curl = _ax.crossVectors(along, palm);
      for (const chain of arm.fingers) {
        let angle = 0;
        chain.forEach((bone, i) => {
          angle += FIST[i]! * h.fist!;
          this.point(bone, _dir.copy(along).applyAxisAngle(curl, angle));
        });
      }
    }
    if (h.thumb) {
      // the index finger's side of the hand
      const up = _dir.crossVectors(along, palm).multiplyScalar(m).addScaledVector(along, 0.12).normalize();
      for (const bone of arm.thumb) this.point(bone, up);
    }
    if (k < 1) {
      arm.bones.forEach((bone, i) => bone.quaternion.slerpQuaternions(arm.from[i]!, _qa.copy(bone.quaternion), k));
      arm.upper.updateMatrixWorld(true);
    }
  }

  /** The hand's palm and fingers, as a rotation from the x and y axes (the character's frame). */
  private handFrame(arm: Arm, out: THREE.Quaternion): THREE.Quaternion {
    const q = spin(arm.wrist, _qd);
    return frame(_pn.copy(arm.palm).applyQuaternion(q), _fn.copy(arm.along).applyQuaternion(q), out);
  }

  /**
   * Both arms' bones and what reach() needs to know about them, measured in the idle pose: the
   * elbow's hinge (in the upper arm's own frame) and the palm and fingers (in the wrist's), from
   * where the knuckles are. An arm without every bone is left alone by the emotes.
   */
  private measureArms(model: THREE.Object3D): void {
    this.arms = {};
    const find = (n: string) => model.getObjectByName(n) ?? model.getObjectByName(n.replace('.', '')) ?? null;
    for (const [side, m] of [['R', 1], ['L', -1]] as const) {
      const upper = find(`UpperArm.${side}`);
      const lower = find(`LowerArm.${side}`);
      const wrist = find(`Wrist.${side}`);
      const fingers = FINGERS.map((f) => [2, 3, 4].map((i) => find(`${f}${i}.${side}`)));
      const thumb = [2, 3].map((i) => find(`Thumb${i}.${side}`));
      if (!upper || !lower || !wrist || fingers.some((c) => c.includes(null)) || thumb.includes(null)) continue;
      const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
      const S = at(upper);
      const E = at(lower);
      const hinge = E.clone().sub(S).cross(at(wrist).sub(E));
      const knuckle = (o: THREE.Object3D) => wrist.worldToLocal(at(o));
      const across = knuckle(fingers[0]![0]!).sub(knuckle(fingers[3]![0]!));
      const along = knuckle(fingers[1]![0]!);
      const palm = across.cross(along).multiplyScalar(m);
      if (hinge.lengthSq() < 1e-12 || palm.lengthSq() < 1e-12) continue;
      palm.normalize();
      along.addScaledVector(palm, -along.dot(palm)).normalize();
      hinge.normalize().applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert());
      const all = [upper, lower, wrist, ...fingers.flat(), ...thumb] as THREE.Object3D[];
      this.arms[side] = {
        upper,
        lower,
        wrist,
        fingers: fingers as THREE.Object3D[][],
        thumb: thumb as THREE.Object3D[],
        hinge,
        palm,
        along,
        bones: all,
        from: all.map(() => new THREE.Quaternion()),
      };
    }
  }

  /** Head and neck toward the gaze point, within a comfortable reach, eased. */
  private lookPose(dt: number): void {
    let yaw = 0;
    let pitch = 0;
    if (this.gaze) {
      const p = this.root.worldToLocal(_v.copy(this.gaze));
      const flat = Math.hypot(p.x, p.z);
      yaw = Math.atan2(p.x, p.z);
      pitch = Math.atan2(EYE_Y - p.y, flat);
      // nobody turns their head right round: past this, look ahead again
      if (Math.abs(yaw) > LOOK_GIVE_UP || flat < 0.2) yaw = pitch = 0;
      yaw = THREE.MathUtils.clamp(yaw, -LOOK_YAW, LOOK_YAW);
      pitch = THREE.MathUtils.clamp(pitch, -0.3, 0.6);
    }
    const k = 1 - Math.exp(-dt * 3.2);
    this.aim.yaw += (yaw - this.aim.yaw) * k;
    this.aim.pitch += (pitch - this.aim.pitch) * k;
    if (Math.abs(this.aim.yaw) + Math.abs(this.aim.pitch) < 1e-4) return;
    this.turn('neck', [this.aim.pitch * 0.35, this.aim.yaw * 0.4, 0]);
    this.turn('head', [this.aim.pitch * 0.65, this.aim.yaw * 0.6, 0]);
  }

  /**
   * Weight from one foot to the other every few seconds, resting on each: the hips tip (the
   * standing leg's side up) while the thighs keep the legs upright, the free knee eases forward
   * and the spine leans back over the feet.
   */
  private swayPose(dt: number): void {
    this.swayT += dt;
    const t = this.swayT + this.swaySeed! * 7.3;
    const w = Math.sin((t * Math.PI * 2) / (8.5 + (this.swaySeed! % 1) * 3));
    const s = Math.sign(w) * Math.sqrt(Math.abs(w));
    const tip = 0.05 * s;
    this.turn('hips', [0, 0.035 * s, tip]);
    this.turn('thighR', [0, 0, -tip]);
    this.turn('thighL', [0, 0, -tip]);
    const free = Math.abs(s);
    const [thigh, shin] = s > 0 ? (['thighR', 'shinR'] as const) : (['thighL', 'shinL'] as const);
    this.turn(thigh, [-0.07 * free, 0, 0]);
    this.turn(shin, [0.14 * free, 0, 0]);
    this.turn('torso', [0, -0.02 * s, -0.8 * tip]);
    this.turn('chest', [0.012 * Math.sin(t * 0.61), 0.03 * Math.sin(t * 0.37), 0]);
  }

  /**
   * Lower the whole character onto its seat, so its name tag and anything else hung on the root
   * (speech and emote bubbles) drop with it, while its shadow stays on the floor. The caller owns
   * the root's height: whatever it last set is the floor this works from.
   */
  private settle(drop: number): void {
    const p = this.root.position;
    if (p.y !== this.rootSet) this.rootFloor = p.y;
    p.y = this.rootFloor - drop * this.root.scale.y;
    this.rootSet = p.y;
    if (this.blobMesh) this.blobMesh.position.y = 0.012 + drop;
  }

  /** The sitting pose (see sit()); returns how far the character drops (root units). */
  private sitPose(): number {
    const legs = (this.legs ??= this.measureLegs());
    if (!legs) return 0;
    // The hip joint rides a hand's width above the seat. The thighs tip forward (from wherever
    // the idle pose holds them) until the shins, hanging from the knees, reach the floor; a high
    // stool leaves them bent at the limit with the feet on its rail.
    const hipY = this.seatTop! + HIP_OVER_SEAT;
    const tip = Math.acos(THREE.MathUtils.clamp((hipY - legs.knee) / legs.thigh, Math.cos(SIT_BEND_MAX), Math.cos(SIT_BEND_MIN)));
    const thigh: Turn = [-(tip - legs.thighTip), 0, 0];
    const shin: Turn = [tip - legs.thighTip + legs.shinTip + 0.08, 0, 0];
    this.turn('thighR', thigh);
    this.turn('shinR', shin);
    this.turn('thighL', thigh);
    this.turn('shinL', shin);
    this.turn('torso', [0.1, 0, 0]);
    // elbows down by the sides at rail height, forearms forward and a little in, resting on it
    this.turn('upperR', SIT_UPPER);
    this.turn('upperL', mirror(SIT_UPPER));
    this.turn('lowerR', SIT_LOWER);
    this.turn('lowerL', mirror(SIT_LOWER));
    return legs.hip - hipY;
  }

  /**
   * The standing legs in the root's frame, for sitting: hip height, thigh length, knee height, and
   * how far forward the idle pose already tips the thigh and the shin (radians from straight down).
   */
  private measureLegs(): { hip: number; thigh: number; knee: number; thighTip: number; shinTip: number } | null {
    const hipBone = this.bones.thighR;
    const kneeBone = this.bones.shinR;
    const foot = this.model?.getObjectByName('FootR') ?? this.model?.getObjectByName('Foot.R');
    if (!this.model || !hipBone || !kneeBone || !foot) return null;
    this.model.updateWorldMatrix(true, true);
    // (in the model's own frame, so neither a hop nor the root lowered onto a seat counts)
    const lift = this.model.position.y - this.modelY;
    const hip = this.root.worldToLocal(hipBone.getWorldPosition(new THREE.Vector3()));
    const knee = this.root.worldToLocal(kneeBone.getWorldPosition(new THREE.Vector3()));
    const ankle = this.root.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
    return {
      hip: hip.y - lift,
      thigh: hip.distanceTo(knee),
      knee: knee.y - lift,
      thighTip: Math.atan2(knee.z - hip.z, hip.y - knee.y),
      shinTip: Math.atan2(ankle.z - knee.z, knee.y - ankle.y),
    };
  }

  private applyPace(): void {
    const idle = this.actions[0];
    if (!this.pace || !idle) return;
    idle.timeScale = this.pace.rate;
    idle.time = this.pace.phase * idle.getClip().duration;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.mesh?.geometry.dispose();
    this.wear.dispose();
    this.ride?.dispose();
    this.tag.element.remove();
    this.root.removeFromParent();
    this.factory.forget(this);
  }

  private show(tpl: Template, key: string): void {
    if (this.model) {
      this.mixer?.stopAllAction();
      this.mixer?.uncacheRoot(this.model);
      this.mesh?.geometry.dispose();
      this.model.removeFromParent();
    }
    const model = SkeletonUtils.clone(tpl.root);
    let mesh: THREE.SkinnedMesh | null = null;
    model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    if (!mesh) return;
    const m = mesh as THREE.SkinnedMesh;
    // share every attribute with the template except this character's own colours
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(name, tpl.geometry.getAttribute(name));
    g.setIndex(tpl.geometry.index);
    const n = tpl.slot.length;
    this.colors = new THREE.BufferAttribute(new Uint16Array(n * 3), 3, true);
    g.setAttribute('color', this.colors);
    g.boundingSphere = tpl.geometry.boundingSphere;
    m.geometry = g;
    m.material = this.factory.material();
    // skinned bounds don't follow the animation; the character is small, so never cull it alone
    m.frustumCulled = false;
    this.model = model;
    this.modelY = model.position.y;
    this.bones = {};
    this.posed.clear();
    for (const [key, name] of Object.entries(BONE_NAMES) as [BoneKey, string][]) {
      // GLTFLoader drops the dots from node names ("UpperArm.R" becomes "UpperArmR")
      const b = model.getObjectByName(name) ?? model.getObjectByName(name.replace('.', ''));
      if (b) this.bones[key] = b;
    }
    this.mesh = m;
    this.shownKey = key;
    this.template = tpl;
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = ['Idle', 'Walk', 'Run'].map((name) => {
      const clip = tpl.clips.find((c) => c.name === name) ?? tpl.clips[0]!;
      const a = this.mixer!.clipAction(clip);
      a.play();
      return a;
    });
    this.weights = [1, 0, 0];
    this.spare.clear();
    this.legs = null;
    this.applyPace();
    // the arms are measured in the idle pose, before anything else has turned them
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    this.measureArms(model);
    this.update(0);
    this.paint();
  }

  /** Write this character's colours from its Look into its own colour buffer. */
  private paint(): void {
    const tpl = this.template;
    const attr = this.colors;
    if (!tpl || !attr) return;
    const look = this.look;
    const skin = new THREE.Color(SKIN_TONES[look.skin] ?? SKIN_TONES[2]);
    const hair = new THREE.Color(look.hair);
    const slot: THREE.Color[] = [
      skin,
      skin.clone().multiplyScalar(0.84),
      hair,
      hair.clone().multiplyScalar(0.7),
      hair.clone().multiplyScalar(0.55),
      new THREE.Color(look.top),
      new THREE.Color(look.bottom),
      new THREE.Color(look.shoes),
    ];
    const arr = attr.array as Uint16Array;
    for (let i = 0; i < tpl.slot.length; i++) {
      const s = tpl.slot[i]!;
      const c = s === FIXED ? _c.setRGB(tpl.base[i * 3]!, tpl.base[i * 3 + 1]!, tpl.base[i * 3 + 2]!) : slot[s]!;
      arr[i * 3] = Math.round(Math.min(1, c.r) * 65535);
      arr[i * 3 + 1] = Math.round(Math.min(1, c.g) * 65535);
      arr[i * 3 + 2] = Math.round(Math.min(1, c.b) * 65535);
    }
    attr.needsUpdate = true;
    this.wear.dress(this.look, tpl, this.model!, this.mesh!, this.mixer);
  }

  // --- riding (v6 looks6) ---------------------------------------------------------------------

  /** The ride this character stands on right now (not while sitting), for the walker's speeds. */
  get riding(): string | null {
    return this.ride && this.seatTop === null ? this.ride.id : null;
  }

  private mountRide(id: string | undefined): void {
    const spec = rideSpec(id);
    if ((this.ride?.id ?? null) === (spec ? id : null)) return;
    this.ride?.dispose();
    this.ride = spec ? new Ride(id!, spec) : null;
    if (this.ride) this.root.add(this.ride.outer);
    this.rideLast = null;
  }

  /**
   * The ride rolls on under the character (it's parked out of sight while they sit): its wheels
   * and lean from how fast the root moves and turns. True while it's stood on.
   */
  private rideOn(dt: number): boolean {
    const ride = this.ride;
    const on = !!ride && this.seatTop === null && !!this.model;
    if (ride) ride.outer.visible = on;
    if (ride && on) {
      const p = this.root.position;
      const yaw = this.root.rotation.y;
      const last = this.rideLast;
      let v = 0;
      let w = 0;
      if (last && dt > 0) {
        const step = Math.hypot(p.x - last.x, p.z - last.z);
        // a jump (a teleport, someone drawn again after a while) isn't speed
        if (step < 1.5) {
          v = step / dt;
          w = Math.atan2(Math.sin(yaw - last.yaw), Math.cos(yaw - last.yaw)) / dt;
        }
      }
      this.rideLast = { x: p.x, z: p.z, yaw };
      const k = 1 - Math.exp(-dt * 8);
      this.rideSpeed += (v - this.rideSpeed) * k;
      this.rideYaw += (w - this.rideYaw) * k;
      ride.update(dt, this.rideSpeed, this.rideYaw);
    } else if (this.model && this.model.rotation.y + this.model.rotation.x + this.model.rotation.z !== 0) {
      this.model.rotation.set(0, 0, 0);
      this.tag.position.y = NAME_Y;
    }
    return on;
  }

  /**
   * Stand on the ride: the model up on its deck, turned sideways across a board, leaning with the
   * ride. From here on the posing works in the rider's own frame (so the stance and any emote on
   * top of it read the same on a board as on the floor). The hips come down, each foot goes to its
   * place on the deck with the leg solved to reach it, the knees forward; on a board the arms
   * hang out for balance and the head looks where it's going, on a bar the hands grip it. Returns
   * how high the model stands.
   */
  private ridePose(): number {
    const ride = this.ride!;
    const spec = ride.spec;
    const model = this.model!;
    const side = spec.stance === 'side';
    const lift = spec.deck + ride.bob;
    model.position.y = this.modelY + lift;
    model.rotation.set(side ? ride.lean : ride.pitch, stanceYaw(spec), side ? 0 : ride.lean, 'YXZ');
    model.updateMatrixWorld(true);
    model.getWorldQuaternion(_rootQ).invert();
    _rootInv.copy(model.matrixWorld).invert();
    this.tag.position.y = NAME_Y + lift;
    const find = (n: string) => model.getObjectByName(n.replace('.', '')) ?? model.getObjectByName(n);
    const body = find('Body');
    // the hips down: the knees take it
    if (body?.parent) {
      this.moved.set(body, body.position.clone());
      const at = local(body, _rv).add(_rw.set(0, -spec.crouch, 0)).applyMatrix4(model.matrixWorld);
      body.position.copy(body.parent.worldToLocal(at));
      body.updateMatrixWorld(true);
    }
    for (const [i, s] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      const thigh = this.bones[s === 1 ? 'thighL' : 'thighR'];
      const shin = this.bones[s === 1 ? 'shinL' : 'shinR'];
      const foot = find(`Foot.${i}`);
      if (!thigh || !shin || !foot?.parent) continue;
      const H = local(thigh, _rh);
      const K0 = local(shin, _rk);
      const A0 = local(foot, _ra);
      const a = H.distanceTo(K0);
      const b = K0.distanceTo(A0);
      // where the shin ends, in its own frame: it stays that way as the leg turns
      const end = shin.worldToLocal(foot.getWorldPosition(_re));
      const [fx, fz] = spec.feet[s === 1 ? 0 : 1];
      const want = _rv.set(fx, A0.y, fz);
      const reached = kneeFor(H, want, a, b, _rw.set(0.25 * s, 0, 1), _rn);
      const knee = _rn;
      this.rotate(thigh, _rq.setFromUnitVectors(_rd.subVectors(K0, H).normalize(), _rd2.subVectors(knee, H).normalize()));
      const K = local(shin, _rk);
      const E = shin.localToWorld(end.clone()).applyMatrix4(_rootInv);
      this.rotate(shin, _rq.setFromUnitVectors(_rd.subVectors(E, K).normalize(), _rd2.subVectors(reached, K).normalize()));
      // the foot (a target of its own, not the shin's child) onto the deck, toes turned
      this.moved.set(foot, foot.position.clone());
      foot.position.copy(foot.parent.worldToLocal(reached.clone().applyMatrix4(model.matrixWorld)));
      foot.updateMatrixWorld(true);
      this.rotate(foot, _rq.setFromAxisAngle(_rw.set(0, 1, 0), spec.toes[s === 1 ? 0 : 1] * s));
    }
    this.turn('torso', [side ? 0.12 : 0.06, side ? 0.12 : 0, 0]);
    if (side) {
      // looking along the board, arms out a little for balance
      this.turn('chest', [0, 0.14, 0]);
      this.turn('neck', [0, 0.42, 0]);
      this.turn('head', [0.08, 0.62, 0]);
      this.turn('upperR', [-0.2, 0, -0.32]);
      this.turn('upperL', [-0.12, 0, 0.36]);
      this.turn('lowerR', [-0.35, 0, 0]);
      this.turn('lowerL', [-0.3, 0, 0]);
      return lift;
    }
    // both hands on the bar
    const r = this.arms.R;
    const l = this.arms.L;
    if (!r || !l) return lift;
    const right = local(r.upper, _sh);
    const mid = local(l.upper, _mid).add(right).multiplyScalar(0.5);
    const len = right.distanceTo(local(r.lower, _el)) + _el.distanceTo(local(r.wrist, _wr));
    for (const [arm, m] of [
      [r, 1],
      [l, -1],
    ] as const) {
      const g = ride.grip(m === 1 ? 1 : -1, _rg);
      if (!g) continue;
      g.applyMatrix4(_rootInv).sub(mid).divideScalar(len);
      this.reach(arm, m, { at: [g.x * m, g.y, g.z], elbow: [-1, -0.6, -0.5], palm: [0, -1, 0.25], fingers: [0.15, -0.2, 1], fist: 0.75 }, mid, len, 1);
    }
    return lift;
  }
}

const _rv = new THREE.Vector3();
const _rw = new THREE.Vector3();
const _rh = new THREE.Vector3();
const _rk = new THREE.Vector3();
const _ra = new THREE.Vector3();
const _re = new THREE.Vector3();
const _rn = new THREE.Vector3();
const _rd = new THREE.Vector3();
const _rd2 = new THREE.Vector3();
const _rg = new THREE.Vector3();
const _rq = new THREE.Quaternion();

// --- gestures ---------------------------------------------------------------------------------

type BoneKey =
  | 'shoulderR'
  | 'upperR'
  | 'lowerR'
  | 'shoulderL'
  | 'upperL'
  | 'lowerL'
  | 'head'
  | 'neck'
  | 'hips'
  | 'torso'
  | 'chest'
  | 'thighR'
  | 'shinR'
  | 'thighL'
  | 'shinL';
const BONE_NAMES: Record<BoneKey, string> = {
  shoulderR: 'Shoulder.R',
  upperR: 'UpperArm.R',
  lowerR: 'LowerArm.R',
  shoulderL: 'Shoulder.L',
  upperL: 'UpperArm.L',
  lowerL: 'LowerArm.L',
  head: 'Head',
  neck: 'Neck',
  hips: 'Hips',
  torso: 'Torso',
  chest: 'Chest',
  thighR: 'UpperLeg.R',
  shinR: 'LowerLeg.R',
  thighL: 'UpperLeg.L',
  shinL: 'LowerLeg.L',
};
/** Parents before children, so each turn starts from its parent's new pose. */
const BONE_ORDER: BoneKey[] = ['hips', 'thighR', 'shinR', 'thighL', 'shinL', 'torso', 'chest', 'shoulderR', 'upperR', 'lowerR', 'shoulderL', 'upperL', 'lowerL', 'neck', 'head'];

/** Where the eyes are above the feet, for aiming the head. */
const EYE_Y = 1.64;
/** How far the head turns toward what it looks at, and past which it gives up and looks ahead. */
const LOOK_YAW = 1.15;
const LOOK_GIVE_UP = 1.9;
/** Sitting: the hip joint's height over the seat top, and how far the thighs tip from straight down. */
const HIP_OVER_SEAT = 0.1;
const SIT_BEND_MIN = 1.2;
const SIT_BEND_MAX = 1.62;
// The idle pose holds the upper arm 14 degrees back and 27 out, the forearm 24 forward: seated, the
// upper arm comes to 10 forward and closer in, the forearm level (right arm; the left mirrors).
const SIT_UPPER: Turn = [-0.43, 0, 0.2];
const SIT_LOWER: Turn = [-0.72, 0.3, 0];

/** Radians about the character's x (left), y (up) and z (forward) axes, applied z, then x, then y. */
type Turn = [number, number, number];
/** A point or a direction in the character's frame: x to its left, y up, z forward. */
type Vec = [number, number, number];

/**
 * An arm as an emote holds it, given for the right arm (the left mirrors x: -x is out to the
 * right, +x across the body). Either the wrist goes to `at` (from the middle of the shoulders, in
 * arm lengths: shoulder to wrist, straight) with the elbow bending out toward `elbow`, or the upper
 * arm and the forearm lie along `upper` and `fore`. Directions needn't be unit length.
 */
interface Hand {
  at?: Vec;
  /** Metres further out than `at` (-x for the right hand): a hand's own thickness, which doesn't grow with the arm. */
  out?: number;
  elbow?: Vec;
  upper?: Vec;
  fore?: Vec;
  /** Which way the palm faces, and the way the fingers point (on along the forearm if not given). */
  palm: Vec;
  fingers?: Vec;
  /** The fingers curled into a fist, 0 to 1. */
  fist?: number;
  /** The thumb straight up along the index finger's side of the hand. */
  thumb?: boolean;
}

type Pose = Partial<Record<BoneKey, Turn>> & { hop?: number; handR?: Hand; handL?: Hand };
type Gesture = { dur: number; pose: (t: number, seated: boolean) => Pose };

/** An arm's bones and how they're built (Person.measureArms). */
interface Arm {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  wrist: THREE.Object3D;
  /** Index, middle, ring and little finger, knuckle to tip. */
  fingers: THREE.Object3D[][];
  /** The thumb's two outer bones. */
  thumb: THREE.Object3D[];
  /** The elbow's hinge, in the upper arm's own frame. */
  hinge: THREE.Vector3;
  /** The palm's normal and the way the fingers point, in the wrist's own frame. */
  palm: THREE.Vector3;
  along: THREE.Vector3;
  /** Every bone above, and room for their poses before an emote turned them (for the blend). */
  bones: THREE.Object3D[];
  from: THREE.Quaternion[];
}

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
/** A fist: each finger joint's bend, knuckle first (radians). */
const FIST = [1.5, 1.65, 0.95];
const DOWN: Vec = [0, -1, 0];

/** The same turn for the left side: x stays, y and z change sign. */
const mirror = (t: Turn): Turn => [t[0], -t[1], -t[2]];

/** Claps a second, and how long a clap lasts; the hands meet at every 1 / CLAP_RATE s. */
export const CLAP_RATE = 3;
export const CLAP_S = 2;
/** When a clap's hands meet, in seconds from its start (while the arms are fully up): its sound's cues. */
export const CLAP_TIMES: readonly number[] = [1, 2, 3, 4, 5].map((n) => n / CLAP_RATE);
/** How far a wrist is from the middle when the palms touch, in metres (on either body). */
const PALM = 0.054;

/**
 * The emotes, each hand given for the right arm (see Hand). Everything is in the character's own
 * frame, so a seated player makes the same shapes; a cheer only hops from the floor.
 */
const GESTURES: Partial<Record<EmoteId, Gesture>> = {
  // the right hand up by the head, palm out, the forearm rocking side to side from the elbow
  wave: {
    dur: 2.4,
    pose: (t) => ({
      handR: { upper: [-1, -0.3, 0.15], fore: [-0.45 * Math.sin(t * 11), 1, 0.15], palm: [0, 0, 1] },
      head: [0, 0, 0.08],
    }),
  },
  // both fists thrown up in a V and shaken, with a couple of hops
  cheer: {
    dur: 1.7,
    pose: (t, seated) => {
      const hand: Hand = { upper: [-0.5, 1, 0.12], fore: [-0.38 + 0.14 * Math.sin(t * 16), 1, 0.15], palm: [0.25, 0, 1], fist: 1 };
      return { handR: hand, handL: hand, hop: !seated && t < 0.9 ? 0.15 * Math.abs(Math.sin((Math.PI * t) / 0.45)) : 0 };
    },
  },
  // palm to palm in front of the chest, elbows out, three claps a second: the hands snap shut
  // and ease apart
  clap: {
    dur: CLAP_S,
    pose: (t) => {
      const open = Math.abs(Math.sin(Math.PI * CLAP_RATE * t)) ** 0.75;
      const hand: Hand = { at: [-0.25 * open, -0.42, 0.62], out: PALM, elbow: [-1, -0.3, -0.15], palm: [1, 0, 0], fingers: [-0.1 * open, 0.6, 1] };
      return { handR: hand, handL: hand, head: [0.04, 0, 0] };
    },
  },
  // a fist held out in front of the chest, thumb up, pushed forward once, and a nod
  thumbs: {
    dur: 1.9,
    pose: (t) => {
      const push = beat(t, 0.1, 0.55);
      return {
        handR: { upper: [-0.22, -0.8, 0.5 + 0.2 * push], fore: [0.1, 0.3, 1], palm: [1, 0, 0], fingers: [0, 0, 1], fist: 1, thumb: true },
        head: [0.07 + 0.05 * push, 0, 0],
      };
    },
  },
  // shoulders up, elbows in at the sides, forearms out with the palms up, head to one side
  shrug: {
    dur: 1.7,
    pose: () => {
      const shoulder: Turn = [0, 0, -0.24];
      const hand: Hand = { upper: [-0.14, -1, -0.04], fore: [-0.8, 0.12, 0.6], palm: [0, 1, 0], fingers: [-0.8, 0, 0.6] };
      return { shoulderR: shoulder, shoulderL: mirror(shoulder), handR: hand, handL: hand, head: [0, 0, 0.2] };
    },
  },
  // "six, seven": both hands out in front, palms up, weighed one against the other while the
  // head bobs to it
  sixseven: {
    dur: 2.1,
    pose: (t, seated) => {
      const w = Math.sin(t * Math.PI * 2 * 1.6);
      const lift = seated ? 0.3 : 0.08;
      const hand = (up: number): Hand => ({ upper: [-0.1, -1, seated ? 0.45 : 0.28], fore: [-0.07, lift + 0.42 * up, 1], palm: [0, 1, 0], fingers: [-0.1, 0, 1] });
      return { handR: hand(w), handL: hand(-w), head: [0.03 + 0.06 * Math.abs(w), 0, 0.06 * w] };
    },
  },
};

/** A dealer's motions at the table, for the table views to call through the world. */
export type StaffGesture = 'deal' | 'sweep' | 'pay';

/** Up, then down again, between two moments of a gesture (0 outside them). */
const beat = (t: number, t0: number, t1: number) => (t <= t0 || t >= t1 ? 0 : Math.sin((Math.PI * (t - t0)) / (t1 - t0)));

// Reaching down over the felt: from the idle arm (upper 14 degrees back and 27 out, forearm 24
// forward) the upper arm swings forward and in and the elbow opens, so the hand comes down to a
// hand's height over a table 0.78 m high, 30-40 cm out.
const STAFF_GESTURES: Record<StaffGesture, { dur: number; pose: (t: number) => Pose }> = {
  // the deck held at the waist in the left hand; the right takes a card and flicks it out
  deal: {
    dur: 1.0,
    pose: (t) => {
      const flick = beat(t, 0.35, 0.7);
      return {
        torso: [0.06, 0, 0],
        upperL: [-0.34, 0, -0.26],
        lowerL: [-0.81, -0.5, 0],
        upperR: [-0.88 - 0.2 * flick, 0.1, 0.26],
        lowerR: [0.67 + 0.15 * flick, 0.15, 0],
      };
    },
  },
  // the right arm reaches across the layout and draws the chips in toward the rack
  sweep: {
    dur: 1.35,
    pose: (t) => {
      const u = smooth(Math.min(1, Math.max(0, (t - 0.2) / 0.85)));
      return {
        torso: [0.14, 0.15 - 0.3 * u, 0],
        upperR: [-1.0 + 0.45 * u, 0.55 - 0.75 * u, 0.26],
        lowerR: [0.55 - 0.45 * u, 0.2, 0],
      };
    },
  },
  // both hands forward, setting a payout down beside a bet
  pay: {
    dur: 1.1,
    pose: (t) => {
      const push = beat(t, 0.3, 0.8);
      const upper: Turn = [-0.8 - 0.15 * push, 0.1, 0.26];
      const lower: Turn = [0.5 + 0.15 * push, 0.2, 0];
      return { torso: [0.1 + 0.04 * push, 0, 0], upperR: upper, lowerR: lower, upperL: mirror(upper), lowerL: mirror(lower) };
    },
  },
};

function gestureOf(e: EmoteId | StaffGesture): Gesture | undefined {
  return (GESTURES as Partial<Record<string, Gesture>>)[e] ?? (STAFF_GESTURES as Partial<Record<string, Gesture>>)[e];
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

// The posing works in the character's own frame: update() sets these from its root each frame.
const _rootQ = new THREE.Quaternion();
const _rootInv = new THREE.Matrix4();

/** Where a bone's joint is, in the character's frame. */
function local(o: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return o.getWorldPosition(out).applyMatrix4(_rootInv);
}

/** A bone's rotation, in the character's frame. */
function spin(o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  return o.getWorldQuaternion(out).premultiply(_rootQ);
}

/** A hand's point or direction for the arm on side `m` (1 right, -1 left: x mirrors). */
function mirrored(v: Vec, m: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(v[0] * m, v[1], v[2]);
}

/** The rotation taking the x axis onto `a` and the y axis onto `b` (made square to `a`). */
function frame(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _fx.copy(a).normalize();
  _fy.copy(b).addScaledVector(_fx, -b.dot(_fx));
  if (_fy.lengthSq() < 1e-10) {
    // b along a: any square direction will do
    _fy.set(-_fx.y, _fx.x, 0);
    if (_fy.lengthSq() < 1e-10) _fy.set(0, -_fx.z, _fx.y);
  }
  _fy.normalize();
  _fz.crossVectors(_fx, _fy);
  return out.setFromRotationMatrix(_basis.makeBasis(_fx, _fy, _fz));
}

/** The part of rotation `q` that turns about `axis` (unit length): swing-twist's twist. */
function twist(q: THREE.Quaternion, axis: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  out.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  return out.lengthSq() < 1e-12 ? out.identity() : out.normalize();
}

const _parentQ = new THREE.Quaternion();
const _invQ = new THREE.Quaternion();
const _localQ = new THREE.Quaternion();
const _turnQ = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _sh = new THREE.Vector3();
const _el = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _d0 = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _fore = new THREE.Vector3();
const _h0 = new THREE.Vector3();
const _h1 = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _ft = new THREE.Vector3();
const _pn = new THREE.Vector3();
const _fn = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _y = new THREE.Vector3();
const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _fz = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/** Every outfit id per body, for pickers and checks. */
export const ALL_OUTFITS = OUTFITS;

// --- staff uniforms ------------------------------------------------------------------------------
//
// The floor's staff wear outfits made from the players' own models (nothing more to download): a
// uniform names a base outfit per body and restyles it vertex by vertex, going by the bone each
// vertex follows. Arm vertices become a white shirt's sleeves under a vest, or stay the jacket's
// colour; a vest stops at the waist; skin at the neckline goes under a shirt collar; the suit's
// long tie goes. A bow tie and a brass name badge are added as a few more vertices, skinned like
// the cloth under them, so a uniformed character is still one mesh and one draw call. The Look
// colours it as usual: top is the vest or jacket, bottom the trousers, plus skin and hair.

export type UniformId = 'vest' | 'blazer';

/** The Look.outfit that dresses a character in a uniform. */
export function uniformOutfit(u: UniformId): string {
  return `staff:${u}`;
}

interface Uniform {
  base: Record<Body, string>;
  /** What the arms are: a white shirt's sleeves (under a vest) or the jacket's own. */
  sleeves: 'shirt' | 'top';
  /** A vest ends at the waist: the jacket's skirt over the hips turns trouser-coloured. */
  waist: boolean;
  bow: boolean;
  badge: boolean;
}

const UNIFORMS: Record<UniformId, Uniform> = {
  vest: { base: { m: 'suit', f: 'smart' }, sleeves: 'shirt', waist: true, bow: true, badge: true },
  blazer: { base: { m: 'suit', f: 'smart' }, sleeves: 'top', waist: false, bow: false, badge: true },
};

function uniformFor(outfit: string): Uniform | null {
  return outfit.startsWith('staff:') ? (UNIFORMS[outfit.slice(6) as UniformId] ?? null) : null;
}

// A shirt a shade off white (pure white glows under the pit's spots), a black silk bow tie and a
// brushed brass badge.
const SHIRT = new THREE.Color('#dedad0');
const BOW = new THREE.Color('#141418');
const BADGE = new THREE.Color('#b8923f');

const HAND = /^(Wrist|Index|Middle|Ring|Pinky|Thumb)/;
const ARM = /^(UpperArm|LowerArm)/;
const HIPS = /^(Body|Hips|UpperLeg)$/;
const TRUNK = /^(Chest|Torso|Abdomen|Shoulder)/;

/**
 * Restyle a loaded outfit into a uniform (see above); the template's arrays are rebuilt. It is
 * measured in the idle pose (the file's own node pose is a twisted one); stopping the clip
 * afterwards puts the bones back.
 */
function tailor(tpl: Template, mesh: THREE.SkinnedMesh, u: Uniform, from: { part: string; material: string }[], body: Body): Template {
  const mixer = new THREE.AnimationMixer(tpl.root);
  const idle = tpl.clips.find((c) => c.name === 'Idle');
  if (idle) mixer.clipAction(idle).play();
  mixer.update(0);
  tpl.root.updateMatrixWorld(true);
  try {
    return restyle(tpl, mesh, u, from, body);
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(tpl.root);
    tpl.root.updateMatrixWorld(true);
  }
}

function restyle(tpl: Template, mesh: THREE.SkinnedMesh, u: Uniform, from: { part: string; material: string }[], body: Body): Template {
  const geo = mesh.geometry;
  const n = tpl.slot.length;
  // each vertex in the character's frame: y up, z forward, x to its left
  const at = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).toArray(at, i * 3);
  // the bone each vertex mostly follows, and how much of it hangs on the arm (and the forearm)
  const names = mesh.skeleton.bones.map((b) => b.name.replace(/\./g, ''));
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const main: string[] = [];
  const arm = new Float32Array(n);
  const fore = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bw = -1;
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      const name = names[si.getComponent(i, c)] ?? '';
      if (ARM.test(name)) arm[i]! += w;
      if (name.startsWith('LowerArm')) fore[i]! += w;
      if (w > bw) {
        bw = w;
        best = c;
      }
    }
    main.push(names[si.getComponent(i, best)] ?? '');
  }
  const slot = tpl.slot;
  const base = tpl.base;
  const TOP = SLOTS.indexOf('top');
  const HAIR = SLOTS.indexOf('hair');
  const SKIN = SLOTS.indexOf('skin');
  const BOTTOM = SLOTS.indexOf('bottom');
  const fix = (i: number, c: THREE.Color) => {
    slot[i] = FIXED;
    base[i * 3] = c.r;
    base[i * 3 + 1] = c.g;
    base[i * 3 + 2] = c.b;
  };
  const shirt = (i: number) => (u.sleeves === 'shirt' ? fix(i, SHIRT) : (slot[i] = TOP));
  const isShirt = new Uint8Array(n);
  const ownFront = from.some((f, i) => f.material === 'White' && f.part.endsWith('_Body') && slot[i] === FIXED);
  for (let i = 0; i < n; i++) {
    const body = from[i]!.part.endsWith('_Body');
    const bone = main[i]!;
    if (body && from[i]!.material === 'White' && slot[i] === FIXED) {
      // the suit's shirt front and cuffs
      fix(i, SHIRT);
      isShirt[i] = 1;
    } else if (body && from[i]!.material === 'Tie') {
      if (u.bow) {
        fix(i, SHIRT);
        isShirt[i] = 1;
      }
    } else if (body && slot[i] === TOP) {
      if (arm[i]! >= 0.5) {
        shirt(i);
        isShirt[i] = u.sleeves === 'shirt' ? 1 : 0;
      } else if (u.waist && HIPS.test(bone)) slot[i] = BOTTOM;
    } else if (body && slot[i] === SKIN) {
      // bare arms get long sleeves, down to a cuff at the wrist (the ring of the hand that still
      // follows the forearm), and an open neckline a shirt collar
      if (HAND.test(bone) ? fore[i]! >= 0.25 : arm[i]! >= 0.5) {
        shirt(i);
        isShirt[i] = u.sleeves === 'shirt' ? 1 : 0;
      } else if (TRUNK.test(bone)) {
        fix(i, SHIRT);
        isShirt[i] = 1;
      }
    }
  }

  // Where the collar meets the neck, front and centre: the highest shirt at the middle of the chest.
  let collarY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!isShirt[i] || Math.abs(at[i * 3]!) > 0.03 || at[i * 3 + 2]! <= 0) continue;
    collarY = Math.max(collarY, at[i * 3 + 1]!);
  }
  if (!Number.isFinite(collarY)) return tpl;
  /**
   * The body's front surface at (x, y): a ray from in front straight back (-z) against the
   * triangles, and the hit triangle's nearest corner, to skin an addition like the cloth it sits
   * on. Hair and arms are left out (the neck's front belongs to the head part, so heads count).
   */
  const index = geo.getIndex();
  const front = (x: number, y: number): { z: number; i: number } => {
    let z = -Infinity;
    let best = -1;
    const tris = index ? index.count : n;
    for (let t = 0; t + 2 < tris; t += 3) {
      const a = index ? index.getX(t) : t;
      const b = index ? index.getX(t + 1) : t + 1;
      const c = index ? index.getX(t + 2) : t + 2;
      if (slot[a] === HAIR || arm[a]! >= 0.5 || arm[b]! >= 0.5 || arm[c]! >= 0.5) continue;
      const ax = at[a * 3]!;
      const ay = at[a * 3 + 1]!;
      const bx = at[b * 3]!;
      const by = at[b * 3 + 1]!;
      const cx = at[c * 3]!;
      const cy = at[c * 3 + 1]!;
      // barycentric weights of (x, y) in the triangle seen from the front
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-12) continue;
      const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) continue;
      const hz = wa * at[a * 3 + 2]! + wb * at[b * 3 + 2]! + wc * at[c * 3 + 2]!;
      if (hz > z) {
        z = hz;
        best = wa >= wb && wa >= wc ? a : wb >= wc ? b : c;
      }
    }
    return { z, i: best };
  };

  /** Additions in the character's frame, each vertex skinned like the body vertex `skin` names. */
  const extras: { geo: THREE.BufferGeometry; color: THREE.Color; skin: number[] }[] = [];
  const each = (g: THREE.BufferGeometry, i: number) => new Array<number>(g.getAttribute('position').count).fill(i);
  if (!ownFront) {
    // A top with a plain round neck (unlike the suit) gets a shirt front: a V laid over its chest,
    // a few millimetres proud of it, so the bow tie sits on white as it does on the men.
    const patch = shirtFront(collarY, front);
    if (patch) extras.push({ geo: patch.geo, color: SHIRT, skin: patch.skin });
  }
  if (u.bow) {
    const y = collarY - 0.022;
    const f = front(0, y);
    if (f.i >= 0) {
      const g = bowTie(new THREE.Vector3(0, y, f.z + (ownFront ? 0.008 : 0.011)));
      extras.push({ geo: g, color: BOW, skin: each(g, f.i) });
    }
  }
  if (u.badge) {
    // the wearer's left breast: on the upper chest, a little under halfway out to the side
    const y = collarY - (body === 'f' ? 0.105 : 0.155);
    let half = 0;
    for (let i = 0; i < n; i++) {
      if (TRUNK.test(main[i]!) && arm[i]! < 0.3 && Math.abs(at[i * 3 + 1]! - y) < 0.012 && at[i * 3 + 2]! > 0) half = Math.max(half, Math.abs(at[i * 3]!));
    }
    const x = 0.42 * (half || 0.17);
    const f = front(x, y);
    if (f.i >= 0) {
      const g = new THREE.BoxGeometry(0.066, 0.019, 0.005);
      g.translate(x, y, f.z + 0.004);
      extras.push({ geo: g, color: BADGE, skin: each(g, f.i) });
    }
  }

  // Carry each addition from the character's frame into the mesh's own (quantized) space, skinned
  // exactly like the vertex it sits on, so it rides the same bones.
  if (extras.length === 0) return tpl;
  const slots = Array.from(slot);
  const bases = Array.from(base);
  const pieces: THREE.BufferGeometry[] = [geo];
  const toMesh = new Map<number, { m: THREE.Matrix4; turn: THREE.Matrix3 }>();
  const inverse = (j: number) => {
    let t = toMesh.get(j);
    if (!t) {
      const m = restMatrix(mesh, j).invert();
      toMesh.set(j, (t = { m, turn: new THREE.Matrix3().setFromMatrix4(m) }));
    }
    return t;
  };
  for (const x of extras) {
    const src = x.geo;
    const count = src.getAttribute('position').count;
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight'] as const) {
      const a = geo.getAttribute(name) as THREE.BufferAttribute;
      const Arr = a.array.constructor as new (len: number) => THREE.TypedArray;
      out.setAttribute(name, new THREE.BufferAttribute(new Arr(count * a.itemSize), a.itemSize, a.normalized));
    }
    const pos = out.getAttribute('position');
    const nor = out.getAttribute('normal');
    const sk = out.getAttribute('skinIndex');
    const wt = out.getAttribute('skinWeight');
    const p = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const j = x.skin[k]!;
      const t = inverse(j);
      p.fromBufferAttribute(src.getAttribute('position'), k).applyMatrix4(t.m);
      pos.setXYZ(k, p.x, p.y, p.z);
      p.fromBufferAttribute(src.getAttribute('normal'), k).applyMatrix3(t.turn).normalize();
      nor.setXYZ(k, p.x, p.y, p.z);
      sk.setXYZW(k, si.getX(j), si.getY(j), si.getZ(j), si.getW(j));
      wt.setXYZW(k, sw.getX(j), sw.getY(j), sw.getZ(j), sw.getW(j));
      slots.push(FIXED);
      bases.push(x.color.r, x.color.g, x.color.b);
    }
    out.setIndex(src.getIndex());
    pieces.push(out);
    src.dispose();
  }
  const joined = mergeGeometries(pieces, false);
  if (!joined) return tpl;
  joined.computeBoundingSphere();
  mesh.geometry = joined;
  geo.dispose();
  return { ...tpl, geometry: joined, slot: Uint8Array.from(slots), base: Float32Array.from(bases) };
}

/** Mesh space to the character's frame, at rest, for a vertex skinned like vertex `j`. */
function restMatrix(mesh: THREE.SkinnedMesh, j: number): THREE.Matrix4 {
  const geo = mesh.geometry;
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const sum = new THREE.Matrix4().makeScale(0, 0, 0);
  sum.elements[15] = 0;
  const m = new THREE.Matrix4();
  for (let c = 0; c < 4; c++) {
    const w = sw.getComponent(j, c);
    if (!w) continue;
    const b = si.getComponent(j, c);
    m.multiplyMatrices(mesh.skeleton.bones[b]!.matrixWorld, mesh.skeleton.boneInverses[b]!);
    for (let e = 0; e < 16; e++) sum.elements[e]! += m.elements[e]! * w;
  }
  return new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).multiply(sum).multiply(mesh.bindMatrix);
}

/**
 * A V of shirt front from the collar down the chest: a small grid whose points are cast onto the
 * body (`front`) and lifted a few millimetres off it, each skinned like the body vertex it lands
 * nearest. Null if any point misses the body.
 */
function shirtFront(collarY: number, front: (x: number, y: number) => { z: number; i: number }): { geo: THREE.BufferGeometry; skin: number[] } | null {
  const ROWS = 7;
  const COLS = 6;
  const HALF = 0.062;
  const DEPTH = 0.17;
  const pos: number[] = [];
  const skin: number[] = [];
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    const y = collarY + 0.004 - v * DEPTH;
    for (let c = 0; c <= COLS; c++) {
      const x = ((2 * c) / COLS - 1) * HALF * (1 - v);
      const f = front(x, y);
      if (f.i < 0) return null;
      pos.push(x, y, f.z + 0.004);
      skin.push(f.i);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = r * (COLS + 1) + c;
      const b = a + COLS + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, skin };
}

/** A bow tie centred on `c`, facing +z: a knot and two wings pinched where they meet it. */
function bowTie(c: THREE.Vector3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(0.042, 0.036, 0.01);
    const pos = wing.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      // the end at the knot is half as tall as the outer end
      if (pos.getX(k) * side < 0) pos.setY(k, pos.getY(k) * 0.45);
    }
    wing.computeVertexNormals();
    wing.translate(side * 0.028, 0, 0);
    parts.push(wing);
  }
  const knot = new THREE.BoxGeometry(0.018, 0.02, 0.014);
  parts.push(knot);
  for (const p of parts) p.deleteAttribute('uv');
  const bow = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  bow.translate(c.x, c.y, c.z);
  return bow;
}
