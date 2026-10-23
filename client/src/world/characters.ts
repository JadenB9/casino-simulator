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
import { MOTION_MAX, speedOf, type BodyPart, type Character, type CharacterFactory } from './contract.ts';
import type { EmoteId } from '../../../shared/src/protocol.ts';
import { Wearables, dressed, shadeBody } from './wearables.ts';
import { DOWN, PIVOT, gestureOf, mirror, movesLegs, smooth, dances, type BoneKey, type Foot, type Hand, type HandMix, type Pose, type PropId, type StaffGesture, type LawGesture, type Turn, type Vec } from './gestures.ts';
import { disposeProp, propMesh } from './emote-props.ts';
import { Ride, kneeFor, rideSpec, stanceYaw, type RideSpec } from './rides.ts';

export { CLAP_RATE, CLAP_S, CLAP_TIMES, gestureSeconds, type StaffGesture, type LawGesture } from './gestures.ts';

export const MODEL_BASE = `${import.meta.env.BASE_URL}assets/models/`;

type Slot = 'skin' | 'skinShade' | 'hair' | 'hairShade' | 'brows' | 'top' | 'bottom' | 'shoes';
const SLOTS: Slot[] = ['skin', 'skinShade', 'hair', 'hairShade', 'brows', 'top', 'bottom', 'shoes'];
/** The template's buffers every character of an outfit draws with; only the colours are its own. */
const SHARED_ATTRIBUTES = ['position', 'normal', 'skinIndex', 'skinWeight', 'surface'] as const;
const FIXED = 255;

/**
 * v8: what each vertex is made of, for how it takes the light: a `surface` attribute (roughness,
 * metalness, sheen, skin) the body's material reads per vertex (wearables.ts bodyShading), so skin,
 * hair, cloth, leather, metal and the wet of an eye all differ while a character stays one mesh.
 */
const KIND = { skin: 0, hair: 1, brows: 2, eye: 3, cloth: 4, shoes: 5, metal: 6, silk: 7 } as const;
/** Per kind: roughness, metalness, how much a soft sheen lights its edges, and how much light wraps round it as it does round skin. */
const SURFACES: readonly (readonly [number, number, number, number])[] = [
  [0.55, 0, 0.28, 1],
  [0.56, 0, 0.5, 0],
  [0.85, 0, 0.1, 0],
  [0.12, 0, 0, 0],
  [0.86, 0, 0.62, 0],
  [0.4, 0, 0.18, 0],
  [0.3, 1, 0, 0],
  [0.32, 0, 0.5, 0],
];

/** A vertex's kind from the Look slot it takes its colour from and the model's own material and part. */
function kindOf(slot: Slot | null, material: string, part: string): number {
  if (slot === 'skin' || slot === 'skinShade') return KIND.skin;
  if (slot === 'hair' || slot === 'hairShade') return KIND.hair;
  if (slot === 'brows') return KIND.brows;
  if (slot === 'shoes') return KIND.shoes;
  if (slot) return KIND.cloth;
  if (material === 'Eye') return KIND.eye;
  if (material === 'Earrings' || material === 'Gold') return KIND.metal;
  if (material === 'Tie') return KIND.silk;
  // two of the women's faces draw their eyes in plain brown or black
  if ((material === 'Brown' || material === 'Black') && part.endsWith('_Head')) return KIND.eye;
  return KIND.cloth;
}

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
  /** v8: what each vertex is made of (SKIN, HAIR, ... above). */
  kind: Uint8Array;
  clips: THREE.AnimationClip[];
  height: number;
  /** v8: how far the walk and the run carry the body (measureGait), for feet that don't slide. */
  gait: Gait | null;
}

/**
 * v8: one locomotion clip as measured on its model: the ground a whole cycle (two steps) covers
 * with the feet planted, the clip's length, and where in it (0-1) the right foot is furthest ahead
 * of the left (the walk and the run are played in step from there).
 */
interface Stride {
  length: number;
  dur: number;
  at: number;
}

interface Gait {
  walk: Stride;
  run: Stride;
}

const NAME_Y = 2.08;
const LABEL_RANGE = 20;
const LABEL_MAX = 24;

/**
 * v8 gait: cadences in cycles a second (a cycle is two steps). Up to EASY_HZ's pace the walk comes
 * in over the idle at that cadence; alone it quickens to BRISK_HZ, crosses into the run by JOG_HZ,
 * and the run quickens up to SPRINT_HZ (any faster and the legs would blur: the feet slide instead).
 */
const EASY_HZ = 0.75;
const BRISK_HZ = 1.1;
const JOG_HZ = 1.25;
const SPRINT_HZ = 2.1;
/** v8: radians of lean per (rad/s of turn × m/s of speed), and the most a body leans. */
const LEAN = 0.012;
const LEAN_MAX = 0.12;

function fract(x: number): number {
  return x - Math.floor(x);
}

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
      const high = this.quality === 'high';
      m = high ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
      m.name = 'character';
      // v8: skin, hair, cloth and the rest each take the light their own way (wearables.ts)
      shadeBody(m, high, `body-${this.quality}`);
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
    const kinds: number[] = [];
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
      const kind = kindOf(slot, mat.name, src.part);
      for (let k = 0; k < n; k++) {
        slots.push(s);
        base.push(c.r, c.g, c.b);
        kinds.push(kind);
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
      kind: Uint8Array.from(kinds),
      clips: gltf.animations,
      height: box.max.y - box.min.y,
      gait: null,
    };
    const cut = uniform ? tailor(tpl, joined, uniform, from, body === 'f' ? 'f' : 'm') : tpl;
    // v8: smooth shading, and the walk's and the run's strides
    const soft = soften(cut);
    joined.geometry = soft.geometry;
    if (soft.geometry !== cut.geometry) cut.geometry.dispose();
    soft.gait = measureGait(soft.root, soft.clips);
    return soft;
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
  /**
   * The emote being acted out, how far in, and (walked off) how much of it is left as it fades;
   * on a ride, how it's done there (RideAct), chosen as it starts.
   */
  private act: { e: EmoteId | StaffGesture | LawGesture; t: number; fade: number; ride: RideAct } | null = null;
  /** v8: the ground speed being walked (m/s, eased) and where in the gait's cycle the feet are (0-1). */
  private ground = 0;
  private gaitPhase = 0;
  /** v8: the heading last frame, how fast it turns (rad/s, eased) and the lean into the turn. */
  private leanYaw = Number.NaN;
  private leanRate = 0;
  private leanK = 0;
  /** Room for where the mixer had the bones an emote moves (kept in `moved`, below). */
  private readonly spareAt = new Map<THREE.Object3D, THREE.Vector3>();
  /** The legs as the emotes pose them, and the chest's turn in the idle pose (for Hand.frame). */
  private legsIK: Partial<Record<'R' | 'L', Leg>> = {};
  private readonly chestRest = new THREE.Quaternion();
  /** Something an emote holds (a fan of bills, a trophy), while it plays. */
  private prop: { id: PropId; mesh: THREE.Mesh } | null = null;
  /**
   * v7: a gun in hand (world/arms/): held out in the right hand (1, a pistol) or at the shoulder
   * with both hands (2, a long gun), eased in and out (k); where it points up or down; a shot's kick.
   */
  private readonly gun = { kind: 0 as 0 | 1 | 2, k: 0, pitch: 0, recoil: 0, mesh: null as THREE.Object3D | null };
  /** The model's own place in the root, which a hop, glide, flip or spin moves it from. */
  private readonly modelAt = new THREE.Vector3();
  private readonly modelQ = new THREE.Quaternion();
  // --- posing layers (see the functions after the class) ---
  /** Where the head looks (world space), and the eased yaw/pitch it has got to. */
  private gaze: THREE.Vector3 | null = null;
  private readonly aim = { yaw: 0, pitch: 0 };
  /** Weight shifts: on with a seed so neighbours don't move in step; the clock that drives them. */
  private swaySeed: number | null = null;
  private swayT = 0;
  /** Seat top above the feet while sitting, and how far the model is lowered for it. */
  private seatTop: number | null = null;
  /** v7.4: crouched (wanted), and how far down it is now (0-1, eased). */
  private crouchOn = false;
  private crouchK = 0;
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
  /** Bones the riding stance or an emote moved (feet, hips), and where the animation had them (put back next frame). */
  private readonly moved = new Map<THREE.Object3D, THREE.Vector3>();
  /** Where the root was last frame, and how fast it goes and turns (for the ride's wheels and lean). */
  private rideLast: { x: number; z: number; yaw: number } | null = null;
  private rideSpeed = 0;
  private rideYaw = 0;
  /**
   * v7.2, emotes on a ride: how far the rider has stepped off beside it for a dance (0 on the deck,
   * 1 on the floor), and how far rider and board have turned together to face ahead (a board's
   * side-on stance, for an emote done on it). Each eases over STEP_S.
   */
  private rideStep = 0;
  private rideFace = 0;

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
    this.shape();
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

  /** 0 idle, 1 a walk, 2 a run (motionOf turns a ground speed into this); past 2 the run quickens. */
  setMotion(speed: number): void {
    this.speed = Number.isFinite(speed) ? Math.max(0, Math.min(MOTION_MAX, speed)) : 0;
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

  /**
   * v7.2: where a part of the body is now, in the root's frame (see Character.part): the left wrist
   * (the watch is worn there), a little ahead of the face, the front of the chest below the neck,
   * the crown of the head, the right hand. Each from its bone, so a tall body or a short one, a
   * broad one, a pose, all frame the same.
   */
  part(p: BodyPart, out: THREE.Vector3): THREE.Vector3 | null {
    const model = this.model;
    if (!model) return null;
    const [name, dx, dy, dz] = PARTS[p];
    const b = boneOf(model, name);
    if (!b) return null;
    // (the bone brings its own chain up to date; the root only needs its own matrix for the way back)
    this.root.updateWorldMatrix(true, false);
    b.getWorldPosition(out);
    this.root.worldToLocal(out);
    // the offsets grow with the body (the look's height scales the model)
    const s = model.scale.y;
    return out.add(_pt.set(dx * s, dy * s, dz * s));
  }

  /** Act out an emote, or one of a dealer's motions (StaffGesture). */
  gesture(e: EmoteId | StaffGesture | LawGesture): void {
    this.act = { e, t: 0, fade: 1, ride: this.rideAct(e) };
    if (this.prop && gestureOf(e)?.prop !== this.prop.id) this.dropProp();
  }

  /** Take up an emote's prop (in hand from the next frame). */
  private takeProp(id: PropId): void {
    this.dropProp();
    const mesh = propMesh(id);
    mesh.scale.setScalar(0.001);
    this.root.add(mesh);
    this.prop = { id, mesh };
  }

  private dropProp(): void {
    if (!this.prop) return;
    disposeProp(this.prop.mesh);
    this.prop = null;
  }

  /**
   * Put the prop in hand, where the hands are now (after the flip and the hop): the bills fanned
   * up from the right palm, the cup upright between both hands. It grows in as the emote starts
   * and shrinks away as it ends.
   */
  private holdProp(): void {
    const prop = this.prop!;
    const r = this.arms.R;
    const l = this.arms.L;
    const act = this.act;
    const g = act ? gestureOf(act.e) : null;
    if (!r || !l || !act || !g || !this.model) {
      prop.mesh.visible = false;
      return;
    }
    const mesh = prop.mesh;
    mesh.visible = true;
    mesh.scale.setScalar(Math.max(0.001, smooth(Math.min(1, act.t / 0.3, (g.dur - act.t) / 0.25, act.fade))));
    // (in the root's own frame, which the prop hangs in: on a ride the posing frame is the model's)
    const at = (o: THREE.Object3D, out: THREE.Vector3) => this.root.worldToLocal(o.getWorldPosition(out));
    if (prop.id === 'bills') {
      const q = r.wrist.getWorldQuaternion(_qa).premultiply(this.root.getWorldQuaternion(_qb).invert());
      const palm = _pn.copy(r.palm).applyQuaternion(q);
      const along = _fn.copy(r.along).applyQuaternion(q);
      at(r.wrist, mesh.position).addScaledVector(along, 0.06).addScaledVector(palm, 0.028);
      _fx.crossVectors(along, palm);
      mesh.quaternion.setFromRotationMatrix(_basis.makeBasis(_fx, along, palm));
    } else {
      at(r.wrist, mesh.position).add(at(l.wrist, _v)).multiplyScalar(0.5);
      mesh.position.y += 0.02;
      mesh.quaternion.copy(this.model.quaternion).multiply(_qa.copy(this.modelQ).invert());
    }
  }

  /**
   * v7: hold a gun (world/arms/models.ts builds it; its muzzle is on its +z, its grip at its
   * origin): 1 in the right hand held out, 2 at the shoulder in both hands, 0 put away (the arms
   * ease back and the model goes when they're down). The model is the caller's to dispose.
   */
  holdGun(kind: 0 | 1 | 2, mesh: THREE.Object3D | null): void {
    const g = this.gun;
    if (mesh !== g.mesh) {
      g.mesh?.removeFromParent();
      g.mesh = mesh;
      if (mesh) {
        mesh.visible = false;
        this.root.add(mesh);
      }
    }
    g.kind = mesh ? kind : 0;
  }

  /** v7: where the gun points, radians up (+) or down. */
  aimGun(pitch: number): void {
    this.gun.pitch = Math.max(-0.7, Math.min(0.7, pitch));
  }

  /** v7: a shot's kick (the hands jump up and back, and settle). */
  kick(): void {
    this.gun.recoil = 1;
  }

  /** v7: the gun's muzzle in world space (its model's +z tip), or null with none in hand. */
  muzzle(out: THREE.Vector3): THREE.Vector3 | null {
    const m = this.gun.mesh;
    if (!m || !m.visible) return null;
    m.updateWorldMatrix(true, false);
    return out.set(0, 0, (m.userData.length as number | undefined) ?? 0.25).applyMatrix4(m.matrixWorld);
  }

  /** v7.1: the look's height and build on the body (the model scaled from its own size). */
  private readonly baseScale = new THREE.Vector3(1, 1, 1);
  private shape(): void {
    const m = this.model;
    if (!m) return;
    const h = this.look.height ?? 1;
    const b = this.look.build ?? 1;
    m.scale.set(this.baseScale.x * b, this.baseScale.y * h, this.baseScale.z * b);
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

  /** v7.4: down into a crouch (knees bent, hips low, leaning in), or up again. */
  crouch(on: boolean): void {
    this.crouchOn = on;
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
    const surface = mesh.geometry.getAttribute('surface') as THREE.BufferAttribute | undefined;
    if (surface) g.setAttribute('surface', new THREE.BufferAttribute((surface.array as Uint8Array).slice(), 4, true));
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
    // the posing works on the body standing where it stands; a flip is put on at the end (and a
    // ride's stance, which ridePose() puts on again, below)
    if (this.model) {
      this.model.position.copy(this.modelAt);
      this.model.quaternion.copy(this.modelQ);
    }
    const riding = this.rideOn(dt);
    // idle -> walk -> run, eased so starts and stops cross-fade (a rider stands still on it): with
    // the feet planted where the model's strides are known, else by weight alone
    const s = riding ? 0 : this.speed;
    const gait = this.template?.gait;
    if (gait && this.actions[1] && this.actions[2]) this.stride(dt, s, gait);
    else this.blend(dt, Math.min(2, s));
    this.mixer.update(dt);
    // then the hand posing, each layer on top of the last: legs, body, head, arms
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(_rootQ).invert();
    _rootInv.copy(this.root.matrixWorld).invert();
    let drop = 0;
    if (this.seatTop !== null) drop = this.sitPose();
    else if (riding) this.model!.position.y = this.modelAt.y + this.ridePose();
    else if (this.swaySeed !== null) this.swayPose(dt);
    this.lean(dt, this.seatTop === null && !riding && this.crouchK === 0);
    if (this.crouchOn || this.crouchK > 0) {
      this.crouchK += ((this.crouchOn ? 1 : 0) - this.crouchK) * (1 - Math.exp(-dt * 9));
      if (this.crouchK < 0.005) this.crouchK = 0;
    }
    if (this.crouchK > 0 && !this.act && this.seatTop === null && !riding) this.crouchPose();
    this.lookPose(dt);
    if (this.gun.kind || this.gun.k > 0) this.gunPose(dt);
    const whole = this.act ? this.perform(dt, riding) : null;
    if (whole) this.carry(whole);
    if (this.prop) this.holdProp();
    if (this.gun.mesh) this.placeGun();
    this.settle(drop);
  }

  /** Idle, walk and run by weight alone, eased (a model whose strides weren't measured). */
  private blend(dt: number, s: number): void {
    const target = s <= 1 ? [1 - s, s, 0] : [0, 2 - s, s - 1];
    const k = 1 - Math.exp(-dt * 9);
    for (let i = 0; i < 3; i++) {
      this.weights[i] = this.weights[i]! + (target[i]! - this.weights[i]!) * k;
      this.actions[i]?.setEffectiveWeight(this.weights[i]!);
    }
    const walk = this.actions[1];
    if (walk) walk.timeScale = 0.85 + 0.3 * Math.min(1, s);
  }

  /**
   * v8: walking and running with the feet planted. The ground speed asked for (eased, so starts and
   * stops cross-fade) picks the blend and the cadence: up to an easy pace the walk comes in over the
   * idle at its own cadence (its stride grows with its weight), then it quickens alone, then crosses
   * into the run, the two played in step (the same foot forward at the same moment), and last the
   * run quickens. At every speed the cadence is the one at which the blend's stride covers the
   * ground the body does, so a foot on the floor stays where it was put down.
   */
  private stride(dt: number, s: number, gait: Gait): void {
    this.ground += (speedOf(s) - this.ground) * (1 - Math.exp(-dt * 9));
    const v = this.ground;
    // (the steps grow with the model: its build widens it, the root's scale sizes it all)
    const k = this.root.scale.z * (this.look.build ?? 1);
    const sw = gait.walk.length * k;
    const sr = gait.run.length * k;
    let walk = 0;
    let run = 0;
    let hz = EASY_HZ;
    if (v < sw * EASY_HZ) {
      // (a blend with the idle shortens the steps more than its weight would say: the walk comes
      // in sooner, so the feet still keep up)
      walk = Math.sqrt(v / (sw * EASY_HZ));
    } else if (v < sw * BRISK_HZ) {
      walk = 1;
      hz = v / sw;
    } else if (v < sr * JOG_HZ) {
      run = smooth((v - sw * BRISK_HZ) / (sr * JOG_HZ - sw * BRISK_HZ));
      walk = 1 - run;
      hz = v / (sw + (sr - sw) * run);
    } else {
      run = 1;
      hz = Math.min(SPRINT_HZ, v / sr);
    }
    this.weights[0] = 1 - walk - run;
    this.weights[1] = walk;
    this.weights[2] = run;
    for (let i = 0; i < 3; i++) this.actions[i]!.setEffectiveWeight(this.weights[i]!);
    this.gaitPhase = (this.gaitPhase + hz * dt) % 1;
    // both clips are posed at the phase by hand (the mixer only blends them)
    const w = this.actions[1]!;
    const r = this.actions[2]!;
    w.timeScale = r.timeScale = 0;
    w.time = fract(this.gaitPhase + gait.walk.at) * gait.walk.dur;
    r.time = fract(this.gaitPhase + gait.run.at) * gait.run.dur;
  }

  /**
   * v8: into a turn the body leans (more the faster it goes), as anyone running round a corner
   * does; the turn rate is read off the root's own heading, so it's the same for you, everyone else
   * and the staff. `on` false eases it out (sitting, riding, crouched: those lean their own way).
   */
  private lean(dt: number, on: boolean): void {
    const yaw = this.root.rotation.y;
    if (!(dt > 0) || Number.isNaN(this.leanYaw)) {
      this.leanYaw = yaw;
      return;
    }
    const d = Math.atan2(Math.sin(yaw - this.leanYaw), Math.cos(yaw - this.leanYaw));
    this.leanYaw = yaw;
    // (a snap round, someone placed somewhere new, isn't a turn)
    const rate = Math.abs(d) < 0.8 ? d / dt : 0;
    this.leanRate += (rate - this.leanRate) * (1 - Math.exp(-dt * 6));
    const want = on ? THREE.MathUtils.clamp(-this.leanRate * this.ground * LEAN, -LEAN_MAX, LEAN_MAX) : 0;
    this.leanK += (want - this.leanK) * (1 - Math.exp(-dt * 8));
    if (Math.abs(this.leanK) > 1e-3) this.turn('body', [0, 0, this.leanK]);
  }

  /**
   * v7.4: the crouch: the hips down, the body leaning in over the knees, the head up. Standing
   * still the feet take a crouching stance; walking, they stay where the walk puts them and the
   * knees bend to reach (a crouched walk).
   */
  private crouchPose(): void {
    const k = smooth(this.crouchK);
    const lens = this.legLengths();
    const body = this.bones.body;
    if (!lens || !body) return;
    const moving = Math.min(1, this.speed * 2);
    const drop = 0.34 - 0.08 * moving;
    this.shift(body, _v.set(0, -drop * k, -0.05 * k).add(local(body, _w)));
    this.turn('body', [0.34 + 0.08 * moving, 0, 0], k);
    this.turn('chest', [0.1, 0, 0], k);
    this.turn('head', [-0.36, 0, 0], k);
    this.plant(CROUCH, k * (1 - moving), lens);
  }

  /**
   * Pose the body for the emote being acted out; returns what it does to the whole body. On a ride
   * it's done as rideAct() chose: stepped off beside it (the legs and the whole body the emote's as
   * the step is made), standing on the deck (the arms and head; a hop takes the ride up too), or
   * the seated version, the upper body only on top of the stance.
   */
  private perform(dt: number, riding = false): Whole | null {
    const act = this.act!;
    const g = gestureOf(act.e);
    act.t += dt;
    if (!g || act.t >= g.dur || !this.model) {
      this.act = null;
      this.dropProp();
      return null;
    }
    const mode = riding ? (act.ride ?? 'upper') : null;
    const seated = this.seatTop !== null || mode === 'upper';
    // (on the deck, the upper-body version: the feet are on the ride)
    const deck = mode === 'on' || mode === 'ollie';
    const pose = g.pose(act.t, seated || deck);
    // how much the legs are the emote's: stepping off a ride, they come to it as the step is made
    const ground = deck ? 0 : mode === 'off' ? smooth(this.rideStep) : 1;
    const legs = !seated && ground > 0 && movesLegs(pose);
    // walking off ends a dance: it fades from wherever it had got to (not in mid-air)
    if (act.fade < 1 || (legs && this.speed > DANCE_WALK && !pose.flip)) {
      act.fade -= dt / 0.3;
      if (act.fade <= 0) {
        this.act = null;
        this.dropProp();
        return null;
      }
    }
    // ease into the pose and back out of it
    const k = smooth(Math.min(1, act.t / 0.22)) * smooth(Math.min(1, (g.dur - act.t) / 0.3)) * smooth(act.fade);
    // the legs' lengths, from the pose the mixer gave them, before the hips move
    const lens = legs ? this.legLengths() : null;
    const kl = k * ground;
    if (legs && pose.pelvis) {
      const body = this.bones.body;
      if (body) this.shift(body, _v.set(pose.pelvis[0] * kl, pose.pelvis[1] * kl, pose.pelvis[2] * kl).add(local(body, _w)));
    }
    for (const key of BONE_ORDER) {
      const turn = pose[key];
      if (!turn || ((seated || deck) && (key === 'body' || key === 'hips')) || (lens && LEG_BONES.has(key))) continue;
      this.turn(key, turn, key === 'body' || key === 'hips' ? kl : k);
    }
    if (lens) this.plant(pose, kl, lens);
    if (pose.handR || pose.handL) this.hands(pose, k);
    if (g.prop && this.prop?.id !== g.prop) this.takeProp(g.prop);
    if (seated) return { y: 0, z: 0, flip: 0, spin: 0 };
    if (deck) {
      // an ollie: the ride goes up with you (never down through the floor)
      const y = (pose.hop ?? 0) * k;
      this.ride?.raise(Math.max(0, y));
      return { y, z: 0, flip: 0, spin: 0 };
    }
    return { y: (pose.hop ?? 0) * kl, z: (pose.glide ?? 0) * kl, flip: (pose.flip ?? 0) * kl, spin: (pose.spin ?? 0) * kl };
  }

  /**
   * v7: the arms holding a gun, eased in by gun.k: a pistol out at arm's length in the right hand
   * with the left cupping it, or a long gun's stock at the right shoulder and the left hand out
   * along the barrel; raised or lowered with the aim, jumping with a shot's kick. An emote or a
   * knock that moves the arms takes over while it plays.
   */
  private gunPose(dt: number): void {
    const g = this.gun;
    g.k += ((g.kind ? 1 : 0) - g.k) * (1 - Math.exp(-dt * 10));
    if (!g.kind && g.k < 0.02) g.k = 0;
    g.recoil = Math.max(0, g.recoil - dt * 7);
    if (g.k <= 0 || this.act || this.seatTop !== null) return;
    const up = Math.sin(g.pitch) * 0.85;
    const r = g.recoil;
    const pose: Pose =
      g.kind === 2
        ? {
            handR: { at: [-0.13, 0.16 + up * 0.55 + 0.05 * r, 0.44 - 0.08 * r], elbow: [-1, -0.9, 0], palm: [1, 0, 0], fingers: [0, 0.1, 1], fist: 0.85, thumb: 'tuck' },
            handL: { at: [0.03, 0.14 + up + 0.04 * r, 0.88 - 0.06 * r], elbow: [-1, -1, 0], palm: [0, 1, 0.2], fingers: [0.2, 0, 1], fist: 0.45 },
          }
        : {
            handR: { at: [-0.06, 0.24 + up + 0.1 * r, 0.93 - 0.12 * r], elbow: [-1, -0.6, 0], palm: [1, 0, 0], fingers: [0, 0.15, 1], fist: 0.9, thumb: 'tuck' },
            handL: { at: [0.02, 0.2 + up + 0.08 * r, 0.86 - 0.1 * r], elbow: [-1, -0.8, 0], palm: [-0.2, 0.3, 1], fingers: [0.3, 0.2, 1], fist: 0.55 },
          };
    this.turn('torso', [0, g.kind === 2 ? -0.28 : -0.1, 0], g.k);
    this.hands(pose, g.k);
  }

  /** v7: the gun in the right hand: along the forearm (a pistol), or from the right hand toward the left (a long gun). */
  private placeGun(): void {
    const g = this.gun;
    const mesh = g.mesh!;
    const r = this.arms.R;
    const l = this.arms.L;
    if (!r || !l || !this.model || g.k < 0.35) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const at = (o: THREE.Object3D, out: THREE.Vector3) => this.root.worldToLocal(o.getWorldPosition(out));
    const wrist = at(r.wrist, _gw);
    const fwd = g.kind === 2 ? at(l.wrist, _gf).sub(wrist) : _gf.subVectors(wrist, at(r.lower, _gf));
    fwd.normalize();
    // the grip in the palm: a little on from the wrist, the barrel along `fwd`, level across
    mesh.position.copy(wrist).addScaledVector(fwd, g.kind === 2 ? 0.02 : 0.07);
    mesh.position.y -= 0.02;
    _gx.set(0, 1, 0).cross(fwd).normalize();
    _gy.crossVectors(fwd, _gx);
    mesh.quaternion.setFromRotationMatrix(_gm.makeBasis(_gx, _gy, fwd));
  }

  /** Lift, glide, flip and spin the whole model (about PIVOT, the middle of the body). */
  private carry(w: Whole): void {
    const m = this.model;
    if (!m) return;
    if (w.flip || w.spin) {
      _turnQ.setFromEuler(_euler.set(w.flip, w.spin, 0, 'YXZ'));
      _pv.fromArray(PIVOT);
      m.position.sub(_pv).applyQuaternion(_turnQ).add(_pv);
      m.quaternion.premultiply(_turnQ);
    }
    m.position.y += w.y;
    m.position.z += w.z;
  }

  /** Move a bone's joint to `to` (the character's frame); the mixer's place for it comes back next frame. */
  private shift(bone: THREE.Object3D, to: THREE.Vector3): void {
    if (!bone.parent) return;
    if (!this.moved.has(bone)) {
      let p = this.spareAt.get(bone);
      if (!p) this.spareAt.set(bone, (p = new THREE.Vector3()));
      this.moved.set(bone, p.copy(bone.position));
    }
    bone.parent.updateWorldMatrix(true, false);
    bone.position.copy(bone.parent.worldToLocal(this.root.localToWorld(_pt.copy(to))));
    bone.updateMatrixWorld(true);
  }

  /** Each leg's thigh and shin (knee to the foot's joint) as the mixer has them now. */
  private legLengths(): Record<'R' | 'L', [number, number]> | null {
    const r = this.legsIK.R;
    const l = this.legsIK.L;
    if (!r || !l) return null;
    const len = (g: Leg): [number, number] => {
      const h = local(g.thigh, _sh);
      const k = local(g.shin, _el);
      return [h.distanceTo(k), k.distanceTo(local(g.foot, _wr))];
    };
    return { R: len(r), L: len(l) };
  }

  /**
   * Put the feet where the pose wants them and bend the legs to reach: each thigh points at a
   * knee found where both bones' lengths meet (out toward Foot.knee), turned about its length so
   * the knee's own hinge lies square to the bend; the shin then points at the foot. A foot out of
   * reach comes up to the leg instead. Each foot keeps its roll, turns to its toe angle and rocks
   * onto its ball for a raised heel.
   */
  private plant(pose: Pose, k: number, lens: Record<'R' | 'L', [number, number]>): void {
    for (const [side, m] of [['R', 1], ['L', -1]] as const) {
      const leg = this.legsIK[side]!;
      const f: Foot = (side === 'R' ? pose.footR : pose.footL) ?? { at: [-0.1, 0, 0.05], toe: 0.14 };
      const [a, b] = lens[side];
      // where the heel goes: from where the mixer stands it, `k` of the way to the pose's place
      const now = local(leg.foot, _wr);
      const heel = (f.heel ?? 0) * k;
      const toe = (f.toe ?? 0) * m;
      const fwd = _fn.set(-Math.sin(toe), 0, Math.cos(toe));
      const T = _t.set(f.at[0] * m, leg.footY + f.at[1], f.at[2]);
      if (heel > 0) T.addScaledVector(fwd, BALL * (1 - Math.cos(heel))).setY(T.y + BALL * Math.sin(heel));
      T.lerpVectors(now, T, k);
      // the knee
      const H = local(leg.thigh, _sh);
      const u = _u.subVectors(T, H);
      const d = THREE.MathUtils.clamp(u.length(), Math.abs(a - b) + 1e-4, (a + b) * 0.999);
      u.normalize();
      T.copy(H).addScaledVector(u, d);
      const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
      const out = mirrored(f.knee ?? KNEE, m, _hint);
      out.addScaledVector(u, -out.dot(u));
      if (out.lengthSq() < 1e-8) out.set(0, 0, 1);
      out.normalize();
      const K = _e1.copy(H).addScaledVector(u, a * cos).addScaledVector(out, a * Math.sqrt(1 - cos * cos));
      // the thigh onto the knee, its hinge square to the bend
      const dir0 = _y.set(0, 1, 0).applyQuaternion(spin(leg.thigh, _qa));
      const dir1 = _d1.subVectors(K, H).normalize();
      frame(dir0, _h0.copy(leg.hinge).applyQuaternion(_qa), _qb);
      this.rotate(leg.thigh, frame(dir1, _h1.crossVectors(out, u), _qa).multiply(_qb.invert()));
      // the shin onto the foot
      this.point(leg.shin, _d0.subVectors(T, local(leg.shin, _el)).normalize());
      // the foot: to the ankle, turned to face its way and rocked onto its ball
      this.shift(leg.foot, T);
      const f0 = _dir.set(0, 1, 0).applyQuaternion(spin(leg.foot, _qa)).setY(0);
      if (f0.lengthSq() < 1e-6) continue;
      _qb.setFromUnitVectors(f0.normalize(), fwd);
      _qc.identity().slerp(_qb, k);
      if (heel !== 0) _qc.premultiply(_qd.setFromAxisAngle(_ax.crossVectors(_y.set(0, 1, 0), fwd).normalize(), heel));
      this.rotate(leg.foot, _qc);
    }
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
    // the chest's turn from the idle pose, for hands that go with it
    const chest = this.bones.chest;
    if (chest) spin(chest, _qChest).multiply(_qa.copy(this.chestRest).invert());
    else _qChest.identity();
    if (pose.handR) this.arm(r, 1, pose.handR, mid, len, k);
    if (pose.handL) this.arm(l, -1, pose.handL, mid, len, k);
  }

  /** One arm to a hand, or to a mix of two (each solved in full, then blended), eased in by `k`. */
  private arm(arm: Arm, m: number, h: Hand | HandMix, mid: THREE.Vector3, len: number, k: number): void {
    arm.bones.forEach((b, i) => arm.from[i]!.copy(b.quaternion));
    if ('w' in h) {
      this.reach(arm, m, h.a, mid, len);
      arm.bones.forEach((b, i) => {
        arm.mixed[i]!.copy(b.quaternion);
        b.quaternion.copy(arm.from[i]!);
      });
      arm.upper.updateMatrixWorld(true);
      this.reach(arm, m, h.b, mid, len);
      arm.bones.forEach((b, i) => b.quaternion.slerpQuaternions(arm.mixed[i]!, _qa.copy(b.quaternion), h.w));
      arm.upper.updateMatrixWorld(true);
    } else {
      this.reach(arm, m, h, mid, len);
    }
    if (k < 1) {
      arm.bones.forEach((bone, i) => bone.quaternion.slerpQuaternions(arm.from[i]!, _qa.copy(bone.quaternion), k));
      arm.upper.updateMatrixWorld(true);
    }
  }

  /**
   * Put one arm where an emote wants it (see Hand): the elbow and the wrist first, then the palm,
   * then the fingers. The upper arm turns about its length until the elbow's own hinge lies square
   * to the plane the arm now bends in, so the forearm swings into place as an elbow bends; the turn
   * of the hand is shared between the forearm (as a forearm turns) and the wrist. `m` is 1 for
   * the right arm and -1 for the left, which mirrors the hand's numbers.
   */
  private reach(arm: Arm, m: number, h: Hand, mid: THREE.Vector3, len: number): void {
    // a hand in the chest's frame: every direction turned as the chest has turned
    const q = h.frame === 'chest' ? _qChest : null;
    const dir = (v: Vec, out: THREE.Vector3) => (q ? mirrored(v, m, out).applyQuaternion(q) : mirrored(v, m, out));
    const S = local(arm.upper, _sh);
    const E = local(arm.lower, _el);
    const W = local(arm.wrist, _wr);
    const a = S.distanceTo(E);
    const b = E.distanceTo(W);
    // where the elbow and the wrist go
    const elbow = _e1;
    const wrist = _t;
    if (h.at || h.knee) {
      if (h.knee) {
        const shin = this.bones[m > 0 ? 'shinR' : 'shinL'];
        if (shin) local(shin, wrist).add(mirrored(h.knee, m, _hint));
        else wrist.copy(W);
      } else {
        dir(h.at!, wrist).multiplyScalar(len).add(mid);
        wrist.x -= (h.out ?? 0) * m;
      }
      const u = _u.subVectors(wrist, S);
      const d = THREE.MathUtils.clamp(u.length(), Math.abs(a - b) + 1e-4, (a + b) * 0.999);
      u.normalize();
      wrist.copy(S).addScaledVector(u, d);
      // the elbow sits where both bones' lengths meet, out toward the side it was given
      const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
      const out = dir(h.elbow ?? DOWN, _hint);
      out.addScaledVector(u, -out.dot(u));
      if (out.lengthSq() < 1e-8) out.set(-m, 0, 0).addScaledVector(u, u.x * m);
      out.normalize();
      elbow.copy(S).addScaledVector(u, a * cos).addScaledVector(out, a * Math.sqrt(1 - cos * cos));
    } else {
      elbow.copy(S).addScaledVector(dir(h.upper ?? DOWN, _hint).normalize(), a);
      wrist.copy(elbow).addScaledVector(dir(h.fore ?? DOWN, _hint).normalize(), b);
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
    const palm = dir(h.palm, _pt).normalize();
    const along = h.fingers ? dir(h.fingers, _ft) : _ft.copy(fore);
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
    if (h.thumb === 'tuck') {
      // v6 law6: folded across the front of the curled fingers, from the index side toward the little finger's
      const across = _dir.crossVectors(along, palm).multiplyScalar(-m).addScaledVector(palm, 0.6).addScaledVector(along, 0.15).normalize();
      for (const bone of arm.thumb) this.point(bone, across);
    } else if (h.thumb) {
      // the index finger's side of the hand
      const up = _dir.crossVectors(along, palm).multiplyScalar(m).addScaledVector(along, 0.12).normalize();
      for (const bone of arm.thumb) this.point(bone, up);
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
    const find = (n: string) => boneOf(model, n);
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
        mixed: all.map(() => new THREE.Quaternion()),
      };
    }
  }

  /**
   * The legs and the chest in the idle pose, for the emotes that move the feet and the hands that
   * go with the chest: each knee's hinge (the character's x axis, in the thigh's own frame) and the
   * foot's height off the floor. A leg without every bone leaves the feet to the mixer.
   */
  private measureStance(model: THREE.Object3D): void {
    this.legsIK = {};
    const find = (n: string) => boneOf(model, n);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const toRoot = rootQ.clone().invert();
    const chest = this.bones.chest;
    if (chest) this.chestRest.copy(chest.getWorldQuaternion(new THREE.Quaternion()).premultiply(toRoot));
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
    for (const side of ['R', 'L'] as const) {
      const thigh = find(`UpperLeg.${side}`);
      const shin = find(`LowerLeg.${side}`);
      const foot = find(`Foot.${side}`);
      if (!thigh || !shin || !foot) continue;
      const hinge = x.clone().applyQuaternion(thigh.getWorldQuaternion(new THREE.Quaternion()).invert());
      hinge.y = 0;
      if (hinge.lengthSq() < 1e-8) continue;
      const at = this.root.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
      this.legsIK[side] = { thigh, shin, foot, hinge: hinge.normalize(), footY: at.y };
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
    const lift = this.model.position.y - this.modelAt.y;
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
    this.freeGeometry();
    this.wear.dispose();
    this.dropProp();
    this.ride?.dispose();
    this.tag.element.remove();
    this.root.removeFromParent();
    this.factory.forget(this);
  }

  /**
   * Give back this character's own buffer (the colours) and nothing else: the positions, normals,
   * skin weights, surfaces and index are the template's, drawn by everyone in the outfit, and the
   * rest positions a hat or special clothes put on (wearables.ts) are the model's; disposing a
   * geometry frees every attribute still on it. Taking the shared ones off first keeps the rest
   * of the crowd from uploading their mesh again the next frame each time someone leaves.
   */
  private freeGeometry(): void {
    const g = this.mesh?.geometry;
    if (!g) return;
    for (const name of Object.keys(g.attributes)) if (name !== 'color') g.deleteAttribute(name);
    g.setIndex(null);
    g.dispose();
  }

  private show(tpl: Template, key: string): void {
    if (this.model) {
      this.mixer?.stopAllAction();
      this.mixer?.uncacheRoot(this.model);
      this.freeGeometry();
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
    for (const name of SHARED_ATTRIBUTES) {
      const a = tpl.geometry.getAttribute(name);
      if (a) g.setAttribute(name, a);
    }
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
    this.modelAt.copy(model.position);
    this.modelQ.copy(model.quaternion);
    this.baseScale.copy(model.scale);
    this.shape();
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
    // (idle alone: every action starts at full weight until update() eases them)
    this.actions.forEach((a, i) => a.setEffectiveWeight(this.weights[i]!));
    this.spare.clear();
    this.legs = null;
    this.applyPace();
    // the arms are measured in the idle pose, before anything else has turned them
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    this.measureArms(model);
    this.measureStance(model);
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
    const had = !!this.ride;
    this.ride?.dispose();
    this.ride = spec ? new Ride(id!, spec) : null;
    if (this.ride) this.root.add(this.ride.outer);
    this.rideLast = null;
    // getting on (B) in view: the ride comes down beside you and you hop onto it
    this.rideStep = this.ride && !had && this.model && this.root.visible ? 1 : 0;
    this.rideFace = 0;
  }

  /**
   * How an emote starting now is done on the ride you're on (null: not on one). A jump is an
   * ollie, the ride going up with you; an emote of the arms and head is done standing on the deck
   * (on a board, turned with it to face ahead while it's slow); a dance, a backflip or a knock
   * steps off beside the ride for it and back on after, unless you're going too fast to (then the
   * upper body does it on the deck, as it does on a throne).
   */
  private rideAct(e: EmoteId | StaffGesture | LawGesture): RideAct {
    const ride = this.riding ? this.ride : null;
    if (!ride) return null;
    if (e === 'jump') return 'ollie';
    if (ride.spec.stance === 'seat') return 'upper';
    if (!dances(e)) return 'on';
    return this.rideSpeed < STEP_OFF_SPEED ? 'off' : 'upper';
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
      ride.raise(0);
      // off the deck for a dance and back on after it; a board turned to face ahead for an emote
      const a = this.act;
      const step = a?.ride === 'off' ? 1 : 0;
      const face = a?.ride === 'on' && ride.spec.stance === 'side' && this.rideSpeed < STEP_OFF_SPEED ? 1 : 0;
      const e = dt / STEP_S;
      this.rideStep += THREE.MathUtils.clamp(step - this.rideStep, -e, e);
      this.rideFace += THREE.MathUtils.clamp(face - this.rideFace, -e, e);
    } else if (this.tag.position.y !== NAME_Y) {
      // (the model's own turn is put back every frame in update())
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
    // stepped off for a dance (the ride beside you), or turned with a board to face ahead
    const step = smooth(this.rideStep);
    const face = smooth(this.rideFace);
    const on = 1 - step;
    ride.outer.position.x = -STEP_ASIDE * step;
    ride.outer.rotation.y = side ? (face * Math.PI) / 2 : 0;
    // stepping off or back on is a little hop between the deck and the floor
    const lift = (spec.deck + ride.bob) * on + STEP_HOP * Math.sin(Math.PI * step);
    const yaw = stanceYaw(spec) * (1 - Math.max(face, step));
    model.position.y = this.modelAt.y + lift;
    model.quaternion.copy(this.modelQ).multiply(_rq.setFromEuler(_reu.set((side ? ride.lean : ride.pitch) * on, yaw, (side ? 0 : ride.lean) * on, 'YXZ')));
    model.updateMatrixWorld(true);
    model.getWorldQuaternion(_rootQ).invert();
    _rootInv.copy(model.matrixWorld).invert();
    this.tag.position.y = NAME_Y + lift;
    if (spec.stance === 'seat') {
      // A throne: sat on as on any chair (thighs, torso), the seat's height over the footrest.
      // The model comes down onto the seat, and so would the feet (targets of their own, under
      // the floor); they go onto the footrest instead, the legs solved to them, and the forearms
      // rest along the arms with the hands over their scrolls.
      // the shin's length to the foot, measured standing (sitting moves the knee off the line)
      const shin = this.bones.shinR;
      const foot = model.getObjectByName('FootR') ?? model.getObjectByName('Foot.R');
      const shinTo = shin && foot ? local(shin, _rk).distanceTo(local(foot, _ra)) : undefined;
      const was = this.seatTop;
      this.seatTop = spec.seat ?? 0.45;
      const drop = this.sitPose();
      this.seatTop = was;
      this.rideLegs(spec, drop, 1, shinTo);
      this.rideHands(ride, { palm: [0, -1, 0.1], fingers: [0.05, -0.15, 1], fist: 0.35, elbow: [-1, -0.8, -0.6] });
      return lift - drop;
    }
    const find = (n: string) => boneOf(model, n);
    const body = find('Body');
    // the hips down: the knees take it
    if (body?.parent && on > 0) {
      this.moved.set(body, body.position.clone());
      const at = local(body, _rv).add(_rw.set(0, -spec.crouch * on, 0)).applyMatrix4(model.matrixWorld);
      body.position.copy(body.parent.worldToLocal(at));
      body.updateMatrixWorld(true);
    }
    this.rideLegs(spec, 0, 0, undefined, on);
    this.turn('torso', [side ? 0.12 : 0.06, side ? 0.12 : 0, 0], on);
    if (side) {
      // looking along the board, arms out a little for balance (facing ahead for an emote: square on)
      const k = on * (1 - face);
      this.turn('chest', [0, 0.14, 0], k);
      this.turn('neck', [0, 0.42, 0], k);
      this.turn('head', [0.08, 0.62, 0], k);
      this.turn('upperR', [-0.2, 0, -0.32], on);
      this.turn('upperL', [-0.12, 0, 0.36], on);
      this.turn('lowerR', [-0.35, 0, 0], on);
      this.turn('lowerL', [-0.3, 0, 0], on);
      return lift;
    }
    // both hands on the bar (let go of as you step off)
    this.rideHands(ride, { palm: [0, -1, 0.25], fingers: [0.15, -0.2, 1], fist: 0.75, elbow: [-1, -0.6, -0.5] }, on);
    return lift;
  }

  /**
   * Each foot to its place on the deck (the ride's `feet`), `up` over where the animation has it
   * (a seated rider's model has come down that far), the leg solved to reach it: the thigh turned
   * to where the knee must be, the shin to the foot, the foot moved there (it is a target of its
   * own, not the shin's child) and its toes turned. The knees bend forward, and `rise` tips them
   * up (a seated rider's knees point ahead and up); `shinTo` is the shin's length to the foot when
   * the pose before this one has already moved the knee.
   */
  private rideLegs(spec: RideSpec, up: number, rise: number, shinTo?: number, w = 1): void {
    if (w <= 0) return;
    const model = this.model!;
    const find = (n: string) => boneOf(model, n);
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
      const b = shinTo ?? K0.distanceTo(A0);
      // where the shin ends, in its own frame: it stays that way as the leg turns
      const end = shin.worldToLocal(foot.getWorldPosition(_re));
      const [fx, fz] = spec.feet[s === 1 ? 0 : 1];
      // (`w` of the way from where the animation has the foot: stepping off, it comes back to it)
      const want = _rv.set(fx, A0.y + up, fz).lerp(A0, 1 - w);
      const reached = kneeFor(H, want, a, b, _rw.set(0.25 * s, rise, 1), _rn);
      const knee = _rn;
      this.rotate(thigh, _rq.setFromUnitVectors(_rd.subVectors(K0, H).normalize(), _rd2.subVectors(knee, H).normalize()));
      const K = local(shin, _rk);
      const E = shin.localToWorld(end.clone()).applyMatrix4(_rootInv);
      this.rotate(shin, _rq.setFromUnitVectors(_rd.subVectors(E, K).normalize(), _rd2.subVectors(reached, K).normalize()));
      this.moved.set(foot, foot.position.clone());
      foot.position.copy(foot.parent.worldToLocal(reached.clone().applyMatrix4(model.matrixWorld)));
      foot.updateMatrixWorld(true);
      this.rotate(foot, _rq.setFromAxisAngle(_rw.set(0, 1, 0), spec.toes[s === 1 ? 0 : 1] * s * w));
    }
  }

  /** Both hands to the ride's grips (a bar, a throne's arms), shaped by `hand` (given for the right; the left mirrors). */
  private rideHands(ride: Ride, hand: Omit<Hand, 'at'>, k = 1): void {
    const r = this.arms.R;
    if (k <= 0) return;
    const l = this.arms.L;
    if (!r || !l) return;
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
      this.arm(arm, m, { ...hand, at: [g.x * m, g.y, g.z] }, mid, len, k);
    }
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
const _reu = new THREE.Euler();

// --- gestures ---------------------------------------------------------------------------------

const BONE_NAMES: Record<BoneKey, string> = {
  body: 'Body',
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
const BONE_ORDER: BoneKey[] = ['body', 'hips', 'thighR', 'shinR', 'thighL', 'shinL', 'torso', 'chest', 'shoulderR', 'upperR', 'lowerR', 'shoulderL', 'upperL', 'lowerL', 'neck', 'head'];
const LEG_BONES = new Set<BoneKey>(['thighR', 'shinR', 'thighL', 'shinL']);

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
/** Heel to the tips of the toes, metres: a raised heel turns the (unbending) foot about them. */
const BALL = 0.18;
/** A walk faster than this ends a dance (it eases out from wherever it had got to). */
const DANCE_WALK = 0.3;
/** v7.4: the crouching stance: feet a little apart, one ahead, knees out over the toes. */
const CROUCH: Pose = { footR: { at: [-0.14, 0, 0.14], toe: 0.3, knee: [-0.3, 0, 1] }, footL: { at: [-0.13, 0, -0.08], toe: 0.3, heel: 0.5, knee: [-0.3, 0, 1] } };

/** v7.2: each body part's bone, and where the part is from its joint (metres, the character's frame). */
const PARTS: Record<BodyPart, [bone: string, dx: number, dy: number, dz: number]> = {
  wrist: ['Wrist.L', 0, 0, 0],
  face: ['Head', 0, 0.07, 0.11],
  chest: ['Neck', 0, -0.05, 0.05],
  crown: ['Head', 0, 0.15, 0.03],
  hand: ['Wrist.R', 0, 0.04, 0.04],
};

/**
 * v7.2: how an emote is done on a ride (Person.rideAct): stepped off beside it ('off'), standing
 * on the deck ('on'), a jump with the ride going up too ('ollie'), or the seated upper-body version
 * ('upper'); null when it began off a ride.
 */
type RideAct = 'off' | 'on' | 'ollie' | 'upper' | null;

/** A bone of the model by its name, as the model spells it (without the dot) or as written. */
function boneOf(model: THREE.Object3D, name: string): THREE.Object3D | null {
  return model.getObjectByName(name.replace('.', '')) ?? model.getObjectByName(name) ?? null;
}
/** Slower than this (m/s) a ride stops for an emote: you step off it for a dance, a board turns to face ahead. */
const STEP_OFF_SPEED = 0.8;
/** Seconds to step off a ride or back on (or turn a board to face ahead). */
const STEP_S = 0.28;
/** Where the ride waits while you dance (metres to your right), and how high the step off it goes. */
const STEP_ASIDE = 0.62;
const STEP_HOP = 0.1;

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
  /** Every bone above, and room for their poses before an emote turned them (for the blend), and for a second pose (a mix). */
  bones: THREE.Object3D[];
  from: THREE.Quaternion[];
  mixed: THREE.Quaternion[];
}

/** A leg's bones for the emotes that move the feet (Person.plant). */
interface Leg {
  thigh: THREE.Object3D;
  shin: THREE.Object3D;
  foot: THREE.Object3D;
  /** The knee's hinge (the character's x axis in the idle pose), in the thigh's own frame. */
  hinge: THREE.Vector3;
  /** The foot's height off the floor standing. */
  footY: number;
}

/** What an emote does to the whole body this frame: its hop and glide, flip and spin. */
interface Whole {
  y: number;
  z: number;
  flip: number;
  spin: number;
}

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
/** A fist: each finger joint's bend, knuckle first (radians). */
const FIST = [1.5, 1.65, 0.95];
/** A knee bends ahead. */
const KNEE: Vec = [0, 0, 1];

// The posing works in the character's own frame: update() sets these from its root each frame.
const _rootQ = new THREE.Quaternion();
const _gw = new THREE.Vector3();
const _gf = new THREE.Vector3();
const _gx = new THREE.Vector3();
const _gy = new THREE.Vector3();
const _gm = new THREE.Matrix4();
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
const _qChest = new THREE.Quaternion();
const _pv = new THREE.Vector3();

/** Every outfit id per body, for pickers and checks. */
export const ALL_OUTFITS = OUTFITS;

// --- smooth shading and strides (v8) ---------------------------------------------------------------

/**
 * Faces meeting at less than this angle shade as one smooth surface; a sharper turn (a shoe's sole,
 * the line of a nose, a lapel's edge, a box's corner) stays an edge.
 */
const CREASE = Math.cos((62 * Math.PI) / 180);

/**
 * The models come flat-shaded: every face has corners of its own carrying the face's own normal,
 * which read as facets on a cheek or a sleeve. Each corner is given the normal of the surface round
 * it instead: the faces at the same place that turn less than CREASE from the corner's own face,
 * each weighted by its angle there, so curves shade smoothly and real edges stay crisp. Corners
 * left alike (the same place, normal, skinning, slot, colour and kind) become one vertex, a third
 * as many to skin. Done once per model; every character in the outfit draws the result, and the
 * `surface` attribute (what each vertex is made of) goes on with it.
 */
export function soften<T extends { geometry: THREE.BufferGeometry; slot: Uint8Array; base: Float32Array; kind: Uint8Array }>(tpl: T): T {
  const geo = tpl.geometry;
  const index = geo.getIndex();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const si = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  const sw = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  if (!index || !pos || !nor || !si || !sw) return tpl;
  const n = pos.count;
  // one id per place: the stored (quantized) numbers, so corners at one place match exactly
  const raw = pos.array;
  const placeOf = new Int32Array(n);
  const places = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = `${raw[i * 3]},${raw[i * 3 + 1]},${raw[i * 3 + 2]}`;
    let id = places.get(key);
    if (id === undefined) places.set(key, (id = places.size));
    placeOf[i] = id;
  }
  // each face's normal, and its angle at each corner
  const corners = index.count;
  const faceN = new Float32Array(corners);
  const angle = new Float32Array(corners);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const bc = new THREE.Vector3();
  const f = new THREE.Vector3();
  for (let t = 0; t + 2 < corners; t += 3) {
    a.fromBufferAttribute(pos, index.getX(t));
    b.fromBufferAttribute(pos, index.getX(t + 1));
    c.fromBufferAttribute(pos, index.getX(t + 2));
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    bc.subVectors(c, b);
    f.crossVectors(ab, ac);
    if (f.lengthSq() < 1e-20) continue;
    f.normalize().toArray(faceN, t);
    angle[t] = ab.angleTo(ac);
    angle[t + 1] = ab.negate().angleTo(bc);
    angle[t + 2] = Math.max(0, Math.PI - angle[t]! - angle[t + 1]!);
  }
  // the corners of faces at each place
  const first = new Int32Array(places.size + 1);
  for (let k = 0; k < corners; k++) first[placeOf[index.getX(k)]! + 1]!++;
  for (let p = 0; p < places.size; p++) first[p + 1]! += first[p]!;
  const fill = first.slice(0, places.size);
  const round = new Int32Array(corners);
  for (let k = 0; k < corners; k++) round[fill[placeOf[index.getX(k)]!]!++] = k;
  // each vertex's own normal (the face it was drawn with), and the surface round it
  const normal = new Float32Array(n * 3);
  const own = new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    own.fromBufferAttribute(nor, i);
    if (own.lengthSq() < 1e-12) own.set(0, 1, 0);
    own.normalize();
    sum.set(0, 0, 0);
    const p = placeOf[i]!;
    for (let r = first[p]!; r < first[p + 1]!; r++) {
      const k = round[r]!;
      const t = k - (k % 3);
      const fx = faceN[t]!;
      const fy = faceN[t + 1]!;
      const fz = faceN[t + 2]!;
      if (fx * own.x + fy * own.y + fz * own.z <= CREASE) continue;
      const w = angle[k]!;
      sum.x += fx * w;
      sum.y += fy * w;
      sum.z += fz * w;
    }
    if (sum.lengthSq() < 1e-12) sum.copy(own);
    sum.normalize().toArray(normal, i * 3);
  }
  // corners left alike become one vertex
  const remap = new Int32Array(n);
  const keep: number[] = [];
  const alike = new Map<string, number>();
  const q = (x: number) => Math.round(x * 4096);
  for (let i = 0; i < n; i++) {
    const s = tpl.slot[i]!;
    const tint = s === FIXED ? `${q(tpl.base[i * 3]!)},${q(tpl.base[i * 3 + 1]!)},${q(tpl.base[i * 3 + 2]!)}` : '';
    const key = `${placeOf[i]}|${q(normal[i * 3]!)},${q(normal[i * 3 + 1]!)},${q(normal[i * 3 + 2]!)}|${si.getX(i)},${si.getY(i)},${si.getZ(i)},${si.getW(i)}|${sw.array[i * 4]},${sw.array[i * 4 + 1]},${sw.array[i * 4 + 2]},${sw.array[i * 4 + 3]}|${s}|${tpl.kind[i]}|${tint}`;
    let j = alike.get(key);
    if (j === undefined) {
      alike.set(key, (j = keep.length));
      keep.push(i);
    }
    remap[i] = j;
  }
  const m = keep.length;
  const out = new THREE.BufferGeometry();
  const copy = (src: THREE.BufferAttribute): THREE.BufferAttribute => {
    const Arr = src.array.constructor as new (len: number) => THREE.TypedArray;
    const w = src.itemSize;
    const arr = new Arr(m * w);
    for (let j = 0; j < m; j++) for (let e = 0; e < w; e++) arr[j * w + e] = src.array[keep[j]! * w + e]!;
    return new THREE.BufferAttribute(arr, w, src.normalized);
  };
  out.setAttribute('position', copy(pos));
  const normals = new Float32Array(m * 3);
  for (let j = 0; j < m; j++) for (let e = 0; e < 3; e++) normals[j * 3 + e] = normal[keep[j]! * 3 + e]!;
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('skinIndex', copy(si));
  out.setAttribute('skinWeight', copy(sw));
  const surface = new Uint8Array(m * 4);
  const slot = new Uint8Array(m);
  const base = new Float32Array(m * 3);
  const kind = new Uint8Array(m);
  for (let j = 0; j < m; j++) {
    const i = keep[j]!;
    slot[j] = tpl.slot[i]!;
    kind[j] = tpl.kind[i]!;
    base[j * 3] = tpl.base[i * 3]!;
    base[j * 3 + 1] = tpl.base[i * 3 + 1]!;
    base[j * 3 + 2] = tpl.base[i * 3 + 2]!;
    const sf = SURFACES[kind[j]!] ?? SURFACES[KIND.cloth]!;
    for (let e = 0; e < 4; e++) surface[j * 4 + e] = Math.round(sf[e]! * 255);
  }
  out.setAttribute('surface', new THREE.BufferAttribute(surface, 4, true));
  const tris = m < 65536 ? new Uint16Array(corners) : new Uint32Array(corners);
  for (let k = 0; k < corners; k++) tris[k] = remap[index.getX(k)]!;
  out.setIndex(new THREE.BufferAttribute(tris, 1));
  out.computeBoundingSphere();
  return { ...tpl, geometry: out, slot, base, kind };
}

/** A foot this near the lowest either foot gets in a clip is down on the floor (metres). */
const FOOT_DOWN = 0.03;

/**
 * The walk's and the run's strides, measured on the model itself (the clips' pace differs from one
 * body to the other): each clip is stepped through, and while a foot is down (near the floor) it
 * slides back under the body as fast as the body goes, so how far it slides in the steps it's down
 * gives the clip's speed, and over the whole cycle its stride. Where the right foot is furthest
 * ahead of the left is noted too, so the two clips can be played in step. Null if the model has no
 * feet or no clips to measure.
 */
export function measureGait(root: THREE.Object3D, clips: THREE.AnimationClip[]): Gait | null {
  const footR = root.getObjectByName('FootR') ?? root.getObjectByName('Foot.R');
  const footL = root.getObjectByName('FootL') ?? root.getObjectByName('Foot.L');
  const walk = clips.find((c) => c.name === 'Walk');
  const run = clips.find((c) => c.name === 'Run');
  if (!footR || !footL || !walk || !run) return null;
  const mixer = new THREE.AnimationMixer(root);
  const v = new THREE.Vector3();
  const N = 48;
  const one = (clip: THREE.AnimationClip): Stride | null => {
    const action = mixer.clipAction(clip);
    action.play();
    const z = [new Float32Array(N), new Float32Array(N)];
    const y = [new Float32Array(N), new Float32Array(N)];
    for (let k = 0; k < N; k++) {
      action.time = (k / N) * clip.duration;
      mixer.update(0);
      root.updateMatrixWorld(true);
      [footR, footL].forEach((foot, s) => {
        root.worldToLocal(foot.getWorldPosition(v));
        z[s]![k] = v.z;
        y[s]![k] = v.y;
      });
    }
    action.stop();
    mixer.uncacheAction(clip);
    const low = Math.min(...y[0]!, ...y[1]!) + FOOT_DOWN;
    let slid = 0;
    let down = 0;
    let ahead = -Infinity;
    let at = 0;
    for (let k = 0; k < N; k++) {
      const next = (k + 1) % N;
      let step = 0;
      let feet = 0;
      for (let s = 0; s < 2; s++) {
        if (y[s]![k]! > low || y[s]![next]! > low) continue;
        step += z[s]![k]! - z[s]![next]!;
        feet++;
      }
      if (feet) {
        slid += step / feet;
        down++;
      }
      const d = z[0]![k]! - z[1]![k]!;
      if (d > ahead) {
        ahead = d;
        at = k / N;
      }
    }
    // (in the air between strides the body keeps the pace it had)
    const length = down ? (slid / down) * N : 0;
    return length > 0.2 ? { length, dur: clip.duration, at } : null;
  };
  try {
    const w = one(walk);
    const r = one(run);
    return w && r ? { walk: w, run: r } : null;
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    root.updateMatrixWorld(true);
  }
}

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
  const kind = tpl.kind;
  const TOP = SLOTS.indexOf('top');
  const HAIR = SLOTS.indexOf('hair');
  const SKIN = SLOTS.indexOf('skin');
  const BOTTOM = SLOTS.indexOf('bottom');
  // (whatever the uniform recolours is cloth: a shirt, the vest, the trousers)
  const fix = (i: number, c: THREE.Color) => {
    slot[i] = FIXED;
    kind[i] = KIND.cloth;
    base[i * 3] = c.r;
    base[i * 3 + 1] = c.g;
    base[i * 3 + 2] = c.b;
  };
  const shirt = (i: number) => (u.sleeves === 'shirt' ? fix(i, SHIRT) : ((slot[i] = TOP), (kind[i] = KIND.cloth)));
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
  const extras: { geo: THREE.BufferGeometry; color: THREE.Color; kind: number; skin: number[] }[] = [];
  const each = (g: THREE.BufferGeometry, i: number) => new Array<number>(g.getAttribute('position').count).fill(i);
  if (!ownFront) {
    // A top with a plain round neck (unlike the suit) gets a shirt front: a V laid over its chest,
    // a few millimetres proud of it, so the bow tie sits on white as it does on the men.
    const patch = shirtFront(collarY, front);
    if (patch) extras.push({ geo: patch.geo, color: SHIRT, kind: KIND.cloth, skin: patch.skin });
  }
  if (u.bow) {
    const y = collarY - 0.022;
    const f = front(0, y);
    if (f.i >= 0) {
      const g = bowTie(new THREE.Vector3(0, y, f.z + (ownFront ? 0.008 : 0.011)));
      extras.push({ geo: g, color: BOW, kind: KIND.silk, skin: each(g, f.i) });
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
      extras.push({ geo: g, color: BADGE, kind: KIND.metal, skin: each(g, f.i) });
    }
  }

  // Carry each addition from the character's frame into the mesh's own (quantized) space, skinned
  // exactly like the vertex it sits on, so it rides the same bones.
  if (extras.length === 0) return tpl;
  const slots = Array.from(slot);
  const bases = Array.from(base);
  const kinds = Array.from(kind);
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
      kinds.push(x.kind);
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
  return { ...tpl, geometry: joined, slot: Uint8Array.from(slots), base: Float32Array.from(bases), kind: Uint8Array.from(kinds) };
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
