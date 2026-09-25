// A bar order in someone's hand, drunk or eaten there: the glass on the right wrist, the drink in
// it going down sip by sip, a plate's pieces taken one at a time by the left hand, the arm poses
// played on the character's own mixer, bubbles in a flute, steam off an espresso, a Dom sprayed,
// a cake's candles blown out. Everyone holding something gets one (wearables.ts attaches it), you
// and everyone else alike, all following the same timetable (schedule.ts), so what you see
// others do is what they see themselves do.
//
// It runs as it's drawn (its glass's onBeforeRender), once a frame, so someone out of sight costs
// nothing. The first one drawn each frame also looks for two people with drinks standing face to
// face: they toast, on every screen at the same moment.

import * as THREE from 'three';
import type { Held } from '../../../../shared/src/look.ts';
import { barItem } from '../../../../shared/src/items.ts';
import { ITEM_EFFECTS } from './effects.ts';
import { heldModel, type HeldModel } from './models.ts';
import { posesFor, type ArmPose, type HandView, type Poses } from './pose.ts';
import { acts, extraWeights, planFor, smooth, stateAt, weights, type Plan, type State, type Weights } from './schedule.ts';
import { play } from './sounds.ts';
import { Fizz, fizzScale, sparksFor } from './particles.ts';
import { addExtra, extraAt, firstSeen, myOrder, now, ownActs, type ExtraAct } from './state.ts';
import type { TemplateLike } from '../wearables.ts';

/** The materials a held order is drawn in, from wearables.ts (the reflections of a small casino). */
export interface HeldKit {
  solid(): THREE.Material;
  glass(): THREE.Material;
  reflect(m: THREE.MeshStandardMaterial): void;
  beforeDraw(r: THREE.WebGLRenderer): void;
}

const strip = (n: string) => n.replace(/\./g, '');
const R_POSES: ArmPose[] = ['lift', 'tip', 'raise', 'aim', 'chin'];
const L_POSES: ArmPose[] = ['reach', 'eat', 'belly'];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Everyone holding something on this screen. */
const live = new Set<HeldOrder>();
let lastFrame = -1;
/** How tipsy your own character looks (0-1), from your effects (diner.ts). */
let mySway = 0;
export function setMySway(k: number): void {
  mySway = k;
}

export class HeldOrder {
  readonly order: string;
  readonly item: string;
  readonly model: HeldModel;
  private readonly plan: Plan;
  private readonly poses: Poses | null;
  private readonly group = new THREE.Group();
  private readonly pinchGroup = new THREE.Group();
  private readonly meshes: THREE.Object3D[] = [];
  private readonly pour: THREE.Group | null = null;
  private readonly floater: THREE.Mesh | null = null;
  private readonly food: THREE.Mesh | null = null;
  private readonly hand: THREE.Mesh | null = null;
  private readonly flames: THREE.Mesh | null = null;
  private readonly fizz: Fizz | null = null;
  private readonly tinted: THREE.MeshStandardMaterial | null = null;
  private readonly actions = new Map<ArmPose | 'carry', THREE.AnimationAction>();
  private readonly born = performance.now();
  private lastTick = performance.now();
  private clock = 0;
  private readonly fired = new Set<string>();
  private emitAt = 0;
  /** Where it stood, and since when it has stood still (for toasts). */
  private readonly stood = new THREE.Vector3(NaN, 0, 0);
  private stillSince = 0;
  state: State | null = null;
  private disposed = false;

  constructor(
    readonly key: string,
    tpl: TemplateLike,
    view: HandView,
    private readonly root: THREE.Object3D,
    body: THREE.SkinnedMesh,
    private readonly mixer: THREE.AnimationMixer | null,
    held: Held,
    kit: HeldKit,
  ) {
    this.order = held.order;
    this.item = held.item;
    this.model = heldModel(held.item)!;
    this.plan = planFor(held.item, held.order, held.until, firstSeen(held.order));
    this.poses = posesFor(tpl, view, this.model);
    const bones = body.skeleton.bones;
    const wristR = bones.find((b) => strip(b.name) === 'WristR');
    const wristL = bones.find((b) => strip(b.name) === 'WristL');
    const m = this.model;
    const add = (o: THREE.Object3D, into: THREE.Object3D = this.group) => {
      into.add(o);
      this.meshes.push(o);
      return o;
    };
    const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, order = 0) => {
      const x = new THREE.Mesh(g, mat);
      x.renderOrder = order;
      x.onBeforeRender = kit.beforeDraw;
      return x;
    };
    // the vessel's frame in the hand, riding the wrist
    this.group.name = 'held';
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(view.grip);
    wristR?.add(this.group);
    const tick = mesh(m.solid ?? new THREE.BufferGeometry(), kit.solid());
    // always drawn with the character: its onBeforeRender runs the whole order
    tick.frustumCulled = false;
    tick.onBeforeRender = (r, _s, cam) => {
      kit.beforeDraw(r);
      this.tick(r, cam);
    };
    add(tick);
    if (m.glass) add(mesh(m.glass, kit.glass(), 2));
    if (m.tinted) {
      const tm = new THREE.MeshStandardMaterial({ color: m.tinted.color, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.55, envMapIntensity: 2.5, depthWrite: false });
      kit.reflect(tm);
      this.tinted = tm;
      add(mesh(m.tinted.geo, tm, 2));
    }
    if (m.pour) {
      const g = new THREE.Group();
      g.position.copy(m.pour.base);
      const pm = mesh(m.pour.geo, kit.solid(), 1);
      pm.position.copy(m.pour.base).negate();
      g.add(pm);
      add(g);
      this.pour = g;
    }
    if (m.floater) this.floater = add(mesh(m.floater.geo, kit.solid(), 1)) as THREE.Mesh;
    if (m.food) {
      // the dish's own copy of the food, sharing its buffers, drawn from the next piece on
      const g = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(m.food.geo.attributes)) g.setAttribute(name, a);
      g.boundingSphere = m.food.geo.boundingSphere;
      this.food = add(mesh(g, kit.solid())) as THREE.Mesh;
      if (wristL && this.poses) {
        this.pinchGroup.matrixAutoUpdate = false;
        this.pinchGroup.matrix.copy(this.poses.pinch);
        wristL.add(this.pinchGroup);
        const h = mesh(m.food.hand[0]!, kit.solid());
        h.visible = false;
        this.hand = add(h, this.pinchGroup) as THREE.Mesh;
      }
    }
    if (m.flames.length) {
      const parts = m.flames.map((p) => new THREE.ConeGeometry(0.0045, 0.017, 8).translate(p.x, p.y + 0.006, p.z));
      this.flames = add(new THREE.Mesh(mergeFlames(parts), flameMaterial())) as THREE.Mesh;
      for (const p of parts) p.dispose();
    }
    if (m.fizz) {
      const color = barItem(held.item)?.id === 'beer' ? new THREE.Color(1, 0.85, 0.5) : new THREE.Color(1, 0.93, 0.7);
      this.fizz = new Fizz(m.fizz.bottom, m.fizz.r, color);
      add(this.fizz.points);
    }
    // the arm: carrying first (faded in), the rest at nothing until an act needs them
    if (mixer && this.poses) {
      const carry = mixer.clipAction(this.poses.carry, root);
      carry.reset().play();
      carry.setEffectiveWeight(0);
      this.actions.set('carry', carry);
      for (const [name, clip] of Object.entries(this.poses.clips) as [ArmPose, THREE.AnimationClip][]) {
        const a = mixer.clipAction(clip, root);
        a.reset();
        a.setEffectiveWeight(0);
        this.actions.set(name, a);
      }
    }
    live.add(this);
  }

  /** When its acts start (ms), and how long each takes: for checks and still shots. */
  timeline(): { acts: number[]; ms: number; openerMs: number; opener: boolean } {
    const had = acts(this.plan, this.order === myOrder() ? ownActs(this.order) : []);
    return { acts: had.acts, ms: this.plan.ms, openerMs: this.plan.openerMs, opener: had.opener };
  }

  /** Who's holding it: its model's place and facing. */
  where(out: THREE.Vector3): THREE.Vector3 {
    return this.root.getWorldPosition(out);
  }

  facing(): number {
    this.root.getWorldQuaternion(_q);
    _v.set(0, 0, 1).applyQuaternion(_q);
    return Math.atan2(_v.x, _v.z);
  }

  /** The glass's place in the world now. */
  glassAt(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0.05, 0).applyMatrix4(this.group.matrixWorld);
  }

  get isDrink(): boolean {
    return barItem(this.item)?.kind === 'drink';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    live.delete(this);
    this.group.removeFromParent();
    this.pinchGroup.removeFromParent();
    this.food?.geometry.dispose();
    this.flames?.geometry.dispose();
    this.fizz?.dispose();
    this.tinted?.dispose();
    for (const [name, a] of this.actions) {
      if (name === 'carry') a.fadeOut(0.35);
      else a.stop();
    }
  }

  // --- every frame, as it's drawn ----------------------------------------------------------------

  private tick(r: THREE.WebGLRenderer, cam: THREE.Camera): void {
    const pnow = performance.now();
    if (pnow - this.lastTick < 3 || this.disposed) return;
    const dt = Math.min(0.1, (pnow - this.lastTick) / 1000);
    this.lastTick = pnow;
    this.clock += dt;
    if (pnow - lastFrame > 3) {
      lastFrame = pnow;
      findToasts();
    }
    fizzScale(r.getDrawingBufferSize(_size).y * 0.5 * ((cam as THREE.PerspectiveCamera).projectionMatrix?.elements[5] ?? 1.6));
    const t = now();
    const had = acts(this.plan, this.order === myOrder() ? ownActs(this.order) : []);
    const s = stateAt(this.plan, had, t);
    this.state = s;
    this.trackStill(dt);

    // the arm
    let w: Weights | null = null;
    if (s.act) w = weights(s.act.kind, s.act.phase);
    const ex = s.act ? null : this.extra(s, t);
    if (ex) w = extraWeights(ex.e.kind, ex.phase);
    this.pose(w, s);

    // what's in it
    const m = this.model;
    if (this.pour && m.pour) {
      const l = s.level;
      this.pour.visible = l > 0.01;
      this.pour.scale.set(Math.pow(l, m.pour.ax), Math.pow(l, m.pour.ay), Math.pow(l, m.pour.ax));
    }
    if (this.floater && m.floater) {
      const l = s.level;
      this.floater.position.lerpVectors(m.floater.low, m.floater.high, l);
      const k = Math.pow(Math.max(0.01, l), m.floater.ax);
      this.floater.scale.set(k, 1, k);
      // the olive goes with the last sip; ice stays in the empty glass; the crema goes with the coffee
      this.floater.visible = m.model === 'martini' ? l > 0.18 : m.model === 'cup' ? l > 0.03 : true;
    }
    if (this.fizz && m.fizz && m.pour) this.fizz.update(this.clock, m.pour.base.y + (this.pourTop() - m.pour.base.y) * Math.pow(s.level, m.pour.ay));
    if (this.food && m.food) {
      const n = m.food.starts.length - 1;
      const picked = s.act?.kind === 'bite' && s.act.phase >= 0.2 && s.act.portion >= s.taken ? 1 : 0;
      const gone = Math.min(n, s.taken + picked);
      const a = m.food.starts[gone]!;
      this.food.geometry.setDrawRange(a, m.food.starts[n]! - a);
      if (this.hand) {
        const p = s.act?.kind === 'bite' ? s.act.phase : -1;
        this.hand.visible = p >= 0.2 && p < 0.56;
        if (this.hand.visible) {
          this.hand.geometry = m.food.hand[s.act!.portion % m.food.hand.length]!;
          const k = p < 0.47 ? 1 : 0.55;
          this.hand.scale.setScalar(k);
        }
      }
    }
    if (this.flames) {
      this.flames.visible = !s.opened;
      if (!s.opened) this.flames.scale.set(1, 0.85 + 0.15 * Math.sin(this.clock * 23) * Math.sin(this.clock * 7.3), 1);
    }
    this.events(s, t, dt);
  }

  private pourTop(): number {
    const g = this.model.pour!.geo;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox!.max.y;
  }

  /** A toast, handing it back, or a pat on the belly after the last bite. */
  private extra(s: State, t: number): { e: ExtraAct; phase: number } | null {
    const ex = extraAt(this.order, t);
    if (ex) return ex;
    if (s.done && barItem(this.item)?.kind === 'food') {
      const t0 = s.doneAt + 500;
      const phase = (t - t0) / 2200;
      if (phase >= 0 && phase < 1) return { e: { kind: 'pat', t0 }, phase };
    }
    return null;
  }

  private pose(w: Weights | null, s: State): void {
    if (!this.actions.size) return;
    const inK = smooth((performance.now() - this.born) / 350);
    let sumR = 0;
    let sumL = 0;
    if (w) {
      for (const p of R_POSES) sumR += w[p as keyof Weights] ?? 0;
      for (const p of L_POSES) sumL += w[p as keyof Weights] ?? 0;
    }
    const nR = sumR > 1 ? 1 / sumR : 1;
    const nL = sumL > 1 ? 1 / sumL : 1;
    const set = (name: ArmPose | 'carry', k: number) => {
      const a = this.actions.get(name);
      if (!a) return;
      if (k > 0.001) {
        if (!a.isRunning()) {
          a.enabled = true;
          a.play();
        }
        a.setEffectiveWeight(k);
      } else if (a.isRunning()) {
        a.stop();
      }
    };
    set('carry', inK * Math.max(0, 1 - sumR * nR));
    for (const p of R_POSES) set(p, inK * (w ? (w[p as keyof Weights] ?? 0) : 0) * nR);
    for (const p of L_POSES) set(p, inK * (w ? (w[p as keyof Weights] ?? 0) : 0) * nL);
    // a tipsy sway, side to side and never quite regular
    const sway = this.sway(s);
    const ph = this.clock * ((Math.PI * 2) / 3.6) + Math.sin(this.clock * 0.7) * 0.8;
    set('leanL', sway * Math.max(0, Math.sin(ph)));
    set('leanR', sway * Math.max(0, -Math.sin(ph)));
  }

  /** How tipsy they look: yours from your effects, anyone else's from how much of this drink is gone. */
  private sway(s: State): number {
    if (this.order === myOrder()) return mySway * 0.9;
    const per = ITEM_EFFECTS[this.item]?.tipsy ?? 0;
    return Math.min(0.6, Math.max(0, s.taken * per - 0.3) * 0.5);
  }

  private trackStill(dt: number): void {
    const p = this.where(_w);
    if (Number.isNaN(this.stood.x) || p.distanceTo(this.stood) > 0.08) {
      this.stood.copy(p);
      this.stillSince = this.clock;
    }
    void dt;
  }

  /** Stood still (for toasts) this long (s). */
  get still(): number {
    return this.clock - this.stillSince;
  }

  /** Busy drinking, or about to be, around time `t` (for toasts). */
  busy(t: number): boolean {
    const had = acts(this.plan, this.order === myOrder() ? ownActs(this.order) : []);
    const s = stateAt(this.plan, had, t);
    if (s.act || s.done || extraAt(this.order, t)) return true;
    return had.acts.some((a) => a > t && a < t + 3500);
  }

  // --- one-off moments ---------------------------------------------------------------------------

  private once(key: string): boolean {
    if (this.fired.has(key)) return false;
    this.fired.add(key);
    return true;
  }

  private events(s: State, t: number, dt: number): void {
    const sparks = sparksFor(this.root);
    if (!sparks) return;
    const m = this.model;
    const spout = () => m.spout.clone().applyMatrix4(this.group.matrixWorld);
    const upAxis = () => _v.set(0, 1, 0).transformDirection(this.group.matrixWorld);
    const act = s.act;
    // a first sight of an act long under way doesn't set it off again
    const fresh = (t0: number) => t - t0 < 1500;
    if (act?.kind === 'spray') {
      if (act.phase >= 0.46 && this.once(`pop${act.i}`) && fresh(act.t0 + 0.46 * 4200)) {
        const at = spout();
        play('pop', at);
        play('hiss', at, 0.8);
        sparks.burst({ at, vel: upAxis().clone().multiplyScalar(5), spread: 0.4, n: 1, color: new THREE.Color(0.6, 0.45, 0.25), size: [0.02, 0.02], life: [0.8, 0.8], gravity: 9.8 });
      }
      if (act.phase >= 0.46 && act.phase < 0.86) {
        // a jet of foam and drops, out of the neck along the bottle
        const at = spout();
        const dir = upAxis().clone();
        const n = Math.max(1, Math.round(dt * 240));
        sparks.burst({ at, vel: dir.clone().multiplyScalar(3.2), spread: 0.55, n, color: [new THREE.Color(1, 0.95, 0.8), new THREE.Color(0.95, 0.85, 0.55)], size: [0.012, 0.03], life: [0.5, 0.9], gravity: 5, drag: 0.8, alpha: 0.75 });
        sparks.burst({ at, vel: dir.clone().multiplyScalar(2.6), spread: 0.7, n: Math.max(1, n >> 2), color: new THREE.Color(1, 0.9, 0.6), size: [0.012, 0.004], life: [0.3, 0.6], gravity: 3, glow: true, twinkle: true });
      }
    }
    if (act?.kind === 'blow' && act.phase >= 0.42 && this.once(`blow${act.i}`) && fresh(act.t0 + 0.42 * 2600)) {
      play('blow', this.where(_w));
      for (const f of m.flames) {
        const at = f.clone().add(new THREE.Vector3(0, 0.008, 0)).applyMatrix4(this.group.matrixWorld);
        sparks.burst({ at, vel: new THREE.Vector3(0, 0.14, 0), spread: 0.03, n: 7, color: new THREE.Color(0.55, 0.55, 0.55), size: [0.01, 0.05], life: [1.2, 2.0], alpha: 0.35, drag: 0.4 });
      }
      // a birthday: confetti over them
      const top = this.where(_w).clone().add(new THREE.Vector3(0, 2.1, 0));
      sparks.burst({ at: top, vel: new THREE.Vector3(0, 0.6, 0), spread: 1.4, scatter: 0.3, n: 90, color: CONFETTI, size: [0.022, 0.018], life: [2.2, 3.4], gravity: 1.1, drag: 1.6 });
    }
    // steam off a hot espresso for the first couple of minutes
    if (m.model === 'cup' && s.level > 0.02 && t - this.plan.at[0]! < 150_000) {
      this.emitAt -= dt;
      if (this.emitAt <= 0) {
        this.emitAt = 0.1;
        const at = spout();
        sparks.burst({ at, vel: new THREE.Vector3(0, 0.09, 0), spread: 0.018, scatter: 0.008, n: 1, color: new THREE.Color(0.92, 0.92, 0.9), size: [0.012, 0.075], life: [1.6, 2.4], alpha: 0.075, drag: 0.35 });
      }
    }
    // someone who's had champagne sparkles a little (your own comes from your effects: diner.ts)
    if ((this.item === 'champagne' || this.item === 'dom') && s.taken >= 1 && this.order !== myOrder()) {
      this.emitAt -= dt;
      if (this.emitAt <= 0) {
        this.emitAt = 0.22;
        glint(sparks, this.where(_w));
      }
    }
    // the clink of a toast, made once by whichever of the two comes first
    const ex = act ? null : extraAt(this.order, t);
    if (ex?.e.kind === 'toast' && ex.phase >= 0.42 && this.once(`toast${ex.e.t0}`) && fresh(ex.e.t0 + 0.42 * 2400)) {
      const partner = [...live].find((h) => h !== this && extraAt(h.order, t)?.e.t0 === ex.e.t0);
      if (!partner || this.order < partner.order) {
        const a = this.glassAt(new THREE.Vector3());
        const at = partner ? a.add(partner.glassAt(new THREE.Vector3())).multiplyScalar(0.5) : a;
        play('clink', at);
        sparks.burst({ at, vel: new THREE.Vector3(0, 0.25, 0), spread: 0.6, n: 34, color: [new THREE.Color(1, 0.9, 0.6), new THREE.Color(1, 1, 1)], size: [0.02, 0.005], life: [0.5, 1.0], glow: true, twinkle: true, drag: 2.2 });
      }
    }
  }
}

const _size = new THREE.Vector2();

const CONFETTI = [new THREE.Color(0.95, 0.75, 0.2), new THREE.Color(0.8, 0.08, 0.1), new THREE.Color(0.1, 0.35, 0.8), new THREE.Color(0.95, 0.95, 0.9), new THREE.Color(0.1, 0.6, 0.3)];

/** One twinkle somewhere round a person standing at `p`. */
export function glint(sparks: { burst(b: import('./particles.ts').Burst): void }, p: THREE.Vector3): void {
  const a = Math.random() * Math.PI * 2;
  const r = 0.28 + Math.random() * 0.2;
  sparks.burst({
    at: new THREE.Vector3(p.x + Math.cos(a) * r, p.y + 0.5 + Math.random() * 1.3, p.z + Math.sin(a) * r),
    vel: new THREE.Vector3(0, 0.12, 0),
    n: 1,
    color: new THREE.Color(1, 0.86, 0.5),
    size: [0.03, 0.006],
    life: [0.7, 1.1],
    glow: true,
    twinkle: true,
  });
}

// --- toasts --------------------------------------------------------------------------------------

/** Two drinks standing this close (m) and facing each other within this (radians) toast. */
const TOAST_NEAR = 1.7;
const TOAST_FACE = 1.25;
/** Standing still this long first (s). */
const TOAST_STILL = 1.2;
/** Toasts start on the shared clock's slots, so every screen that sees the pair picks the same one (ms). */
const TOAST_SLOT = 2000;
const toasted = new Set<string>();

function findToasts(): void {
  if (live.size < 2) return;
  const t = now();
  const drinks = [...live].filter((h) => h.isDrink && h.still >= TOAST_STILL && !h.busy(t) && !h.busy(t + TOAST_SLOT));
  if (drinks.length < 2) return;
  drinks.sort((a, b) => (a.order < b.order ? -1 : 1));
  const taken = new Set<HeldOrder>();
  for (let i = 0; i < drinks.length; i++) {
    const a = drinks[i]!;
    if (taken.has(a)) continue;
    const pa = a.where(new THREE.Vector3());
    for (let j = i + 1; j < drinks.length; j++) {
      const b = drinks[j]!;
      if (taken.has(b)) continue;
      const key = `${a.order}|${b.order}`;
      if (toasted.has(key)) continue;
      const pb = b.where(new THREE.Vector3());
      const d = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      if (d > TOAST_NEAR || d < 0.5) continue;
      if (Math.abs(wrap(Math.atan2(pb.x - pa.x, pb.z - pa.z) - a.facing())) > TOAST_FACE) continue;
      if (Math.abs(wrap(Math.atan2(pa.x - pb.x, pa.z - pb.z) - b.facing())) > TOAST_FACE) continue;
      toasted.add(key);
      taken.add(a);
      taken.add(b);
      const t0 = Math.ceil((t + 400) / TOAST_SLOT) * TOAST_SLOT;
      addExtra(a.order, { kind: 'toast', t0, toward: { x: pb.x, z: pb.z } });
      addExtra(b.order, { kind: 'toast', t0, toward: { x: pa.x, z: pa.z } });
      break;
    }
  }
}

function wrap(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The held orders on this screen (the diner finds yours here). */
export function heldOrders(): ReadonlySet<HeldOrder> {
  return live;
}

let flameMat: THREE.MeshBasicMaterial | null = null;
function flameMaterial(): THREE.MeshBasicMaterial {
  // hot enough to bloom
  return (flameMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.9, 0.6), toneMapped: false }));
}

function mergeFlames(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    if (g !== p) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return out;
}
