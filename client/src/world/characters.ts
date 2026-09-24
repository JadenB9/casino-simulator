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
// floats over the head as a CSS2D label. Emotes are acted out on top of that (gesture): the arms
// are turned by hand after the mixer has posed them, in the character's own frame, so a wave or
// a cheer works whatever the bones' local axes are, and a cheer hops.
//
// The same hand posing gives the floor's staff their life (world/npcs.ts: a head that turns to
// look at someone, slow weight shifts, a dealer's arm motions) and seats a player on a chair
// (sit). Staff wear uniforms: outfits made from the players' models, see the end of this file.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DEFAULT_LOOK, OUTFITS, SKIN_TONES, type Body, type Look } from '../../../shared/src/look.ts';
import type { Quality } from '../render/engine3d.ts';
import type { Character, CharacterFactory } from './contract.ts';
import type { EmoteId } from '../../../shared/src/protocol.ts';
import { Wearables, dressed } from './wearables.ts';

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
    const gltf = await this.loader.loadAsync(MODEL_BASE + entry.file);
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

  constructor(
    private readonly factory: Characters,
    look: Look,
    name: string,
    opts: PersonOptions = {},
  ) {
    this.look = look;
    this.staff = opts.staff ?? false;
    this.root.name = 'character';
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
    // idle -> walk -> run by weight, eased so starts and stops cross-fade
    const s = this.speed;
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
    let y = 0;
    let drop = 0;
    if (this.seatTop !== null) drop = this.sitPose();
    else if (this.swaySeed !== null) this.swayPose(dt);
    this.lookPose(dt);
    if (this.act) y += this.perform(dt);
    if (this.model) this.model.position.y = this.modelY + y;
    this.settle(drop);
  }

  /** Turn the arms for the emote being acted out; returns how high it hops. */
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
    const pose = g.pose(act.t);
    for (const key of BONE_ORDER) {
      const turn = pose[key];
      if (turn) this.turn(key, turn, k);
    }
    return (pose.hop ?? 0) * k;
  }

  /**
   * Turn one bone about the character's own axes (x left, y up, z forward) on top of its pose
   * now: the turn is carried into the bone's parent frame and put in front of its local rotation.
   * The pose before the frame's first turn is kept; update() puts it back.
   */
  private turn(key: BoneKey, t: Turn, k = 1): void {
    const bone = this.bones[key];
    if (!bone?.parent) return;
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(_parentQ).premultiply(_rootQ);
    _turnQ.setFromEuler(_euler.set(t[0] * k, t[1] * k, t[2] * k, 'YXZ'));
    _turnQ.premultiply(_invQ.copy(_parentQ).invert()).multiply(_parentQ);
    if (!this.posed.has(bone)) {
      let q = this.spare.get(bone);
      if (!q) this.spare.set(bone, (q = new THREE.Quaternion()));
      this.posed.set(bone, q.copy(bone.quaternion));
    }
    bone.quaternion.premultiply(_turnQ);
    bone.updateMatrixWorld(true);
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
}

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
type Pose = Partial<Record<BoneKey, Turn>> & { hop?: number };

/** The same turn for the left side: x stays, y and z change sign. */
const mirror = (t: Turn): Turn => [t[0], -t[1], -t[2]];

/**
 * The character faces +z with its right hand on -x, so turning a hanging right arm by a negative
 * angle about z raises it out to the side, and a negative angle about x swings it forward.
 */
const GESTURES: Record<EmoteId, { dur: number; pose: (t: number) => Pose }> = {
  wave: {
    dur: 2.4,
    pose: (t) => ({ upperR: [-0.2, 0, -2.45], lowerR: [0, 0, 0.45 + 0.38 * Math.sin(t * 13)], head: [0, 0, 0.08] }),
  },
  cheer: {
    dur: 1.7,
    pose: (t) => {
      const up: Turn = [-0.1, 0, -2.7];
      const shake: Turn = [0, 0, 0.2 * Math.sin(t * 16)];
      return { upperR: up, upperL: mirror(up), lowerR: shake, lowerL: mirror(shake), hop: t < 0.9 ? 0.15 * Math.abs(Math.sin((Math.PI * t) / 0.45)) : 0 };
    },
  },
  clap: {
    dur: 1.9,
    pose: (t) => {
      const upper: Turn = [-1.05, 0, -0.12];
      const lower: Turn = [-0.55, 0.8 + 0.26 * Math.sin(t * 19), 0];
      return { upperR: upper, upperL: mirror(upper), lowerR: lower, lowerL: mirror(lower) };
    },
  },
  thumbs: {
    dur: 1.9,
    pose: () => ({ upperR: [-0.75, 0, -0.3], lowerR: [-1.25, 0.2, 0], head: [0.06, 0, 0] }),
  },
  shrug: {
    dur: 1.7,
    pose: () => {
      const shoulder: Turn = [0, 0, -0.24];
      const upper: Turn = [-0.15, 0, -0.32];
      const lower: Turn = [-1.05, -0.55, 0];
      return { shoulderR: shoulder, shoulderL: mirror(shoulder), upperR: upper, upperL: mirror(upper), lowerR: lower, lowerL: mirror(lower), head: [0, 0, 0.2] };
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

function gestureOf(e: EmoteId | StaffGesture): { dur: number; pose: (t: number) => Pose } | undefined {
  return (GESTURES as Partial<Record<string, { dur: number; pose: (t: number) => Pose }>>)[e] ?? (STAFF_GESTURES as Partial<Record<string, { dur: number; pose: (t: number) => Pose }>>)[e];
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

const _rootQ = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _invQ = new THREE.Quaternion();
const _turnQ = new THREE.Quaternion();
const _euler = new THREE.Euler();

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
