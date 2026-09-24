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

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DEFAULT_LOOK, OUTFITS, SKIN_TONES, type Look } from '../../../shared/src/look.ts';
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

  create(look: Look, name: string): Character {
    const p = new Person(this, look, name);
    this.live.add(p);
    return p;
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
    const entry = (body === 'f' ? man.f : man.m)[outfit] ?? man.m.suit!;
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
    parts.forEach((mesh, i) => {
      const g = mesh.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
      const n = g.getAttribute('position').count;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const prim = entry.prims[i];
      const slot = prim && prim.material === mat.name ? prim.slot : (entry.parts[`*/${mat.name}`] ?? null);
      const s = slot ? SLOTS.indexOf(slot) : FIXED;
      const c = mat.color ?? new THREE.Color(1, 1, 1);
      for (let k = 0; k < n; k++) {
        slots.push(s);
        base.push(c.r, c.g, c.b);
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
    return {
      root: gltf.scene,
      geometry: merged,
      slot: Uint8Array.from(slots),
      base: Float32Array.from(base),
      clips: gltf.animations,
      height: box.max.y - box.min.y,
    };
  }
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();

class Person implements Character {
  readonly root = new THREE.Group();
  readonly tag: CSS2DObject;
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
  private act: { e: EmoteId; t: number } | null = null;
  private modelY = 0;

  constructor(
    private readonly factory: Characters,
    look: Look,
    name: string,
  ) {
    this.look = look;
    this.root.name = 'character';
    const el = document.createElement('div');
    el.className = 'world-tag';
    this.tag = new CSS2DObject(el);
    this.tag.position.set(0, NAME_Y, 0);
    this.root.add(this.tag);
    const blob = new THREE.Mesh(factory.blobGeometry, factory.blob);
    blob.position.y = 0.012;
    blob.renderOrder = 1;
    this.root.add(blob);
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

  gesture(e: EmoteId): void {
    this.act = { e, t: 0 };
  }

  update(dt: number): void {
    if (!this.mixer) {
      // still loading: a gesture made meanwhile runs out rather than playing late
      if (this.act && (this.act.t += dt) > (GESTURES[this.act.e]?.dur ?? 0)) this.act = null;
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
    if (this.act) this.perform(dt);
  }

  /** Turn the arms (and hop) for the emote being acted out, on top of the mixer's pose. */
  private perform(dt: number): void {
    const act = this.act!;
    const g = GESTURES[act.e];
    act.t += dt;
    if (!g || act.t >= g.dur || !this.model) {
      this.act = null;
      if (this.model) this.model.position.y = this.modelY;
      return;
    }
    // ease into the pose and back out of it
    const k = smooth(Math.min(1, act.t / 0.22)) * smooth(Math.min(1, (g.dur - act.t) / 0.3));
    const pose = g.pose(act.t);
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(_rootQ).invert();
    for (const key of BONE_ORDER) {
      const turn = pose[key];
      const bone = this.bones[key];
      if (!turn || !bone?.parent) continue;
      // the turn is about the character's own axes (x left, y up, z forward): carry it into the
      // bone's parent frame and put it in front of the bone's local rotation
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.getWorldQuaternion(_parentQ).premultiply(_rootQ);
      _turnQ.setFromEuler(_euler.set(turn[0] * k, turn[1] * k, turn[2] * k, 'YXZ'));
      _turnQ.premultiply(_invQ.copy(_parentQ).invert()).multiply(_parentQ);
      this.posed.set(bone, bone.quaternion.clone());
      bone.quaternion.premultiply(_turnQ);
      bone.updateMatrixWorld(true);
    }
    this.model.position.y = this.modelY + (pose.hop ?? 0) * k;
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

type BoneKey = 'shoulderR' | 'upperR' | 'lowerR' | 'shoulderL' | 'upperL' | 'lowerL' | 'head';
const BONE_NAMES: Record<BoneKey, string> = {
  shoulderR: 'Shoulder.R',
  upperR: 'UpperArm.R',
  lowerR: 'LowerArm.R',
  shoulderL: 'Shoulder.L',
  upperL: 'UpperArm.L',
  lowerL: 'LowerArm.L',
  head: 'Head',
};
/** Parents before children, so each turn starts from its parent's new pose. */
const BONE_ORDER: BoneKey[] = ['shoulderR', 'upperR', 'lowerR', 'shoulderL', 'upperL', 'lowerL', 'head'];

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
