// The arm poses for drinking and eating, worked out on each outfit model once, the way the carrying
// pose is (wearables.ts): from the first frame of its idle, where it spends most of its time.
//
// Each pose says where the thing in the hand should be (a glass's rim at the lips, tipped back so
// it drinks; a bottle up in front, then pointed up and away; a plate under the chin) or where the
// left hand's fingertips should be (on the plate, at the mouth, on the belly). The arm gets there
// by two-bone IK: the wrist's place and turn follow from the glass's, the elbow goes down and out
// on the circle the two bones allow, and a little search picks the glass's turn about its own
// upright and the elbow's swing that bend the wrist least. Half the forearm's twist is the
// forearm's, the rest the wrist's, so the skin round the wrist doesn't wring.
//
// The right arm's poses include the carrying pose (they stand in for it: its weight comes down as
// theirs goes up), the left arm's start from the idle. Each is an additive clip, turns relative
// to the idle, like the carrying clip.

import * as THREE from 'three';
import type { TemplateLike } from '../wearables.ts';
import type { HeldModel } from './models.ts';

type V3 = THREE.Vector3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();

/** What pose.ts reads off a fitted model (wearables.ts heldFit()). */
export interface HandView {
  id: number;
  /** The carrying pose: turns per bone name, on top of the idle. */
  carry: Map<string, THREE.Quaternion>;
  /** Where the held thing's frame is in the right wrist bone's own frame. */
  grip: THREE.Matrix4;
  /** The mouth (lips' middle) in the head bone's own frame. */
  mouth: V3;
}

export type ArmPose = 'lift' | 'tip' | 'raise' | 'aim' | 'chin' | 'reach' | 'eat' | 'belly' | 'leanL' | 'leanR';

export interface Poses {
  clips: Partial<Record<ArmPose, THREE.AnimationClip>>;
  /** The carrying pose as a clip (turns relative to the idle). */
  carry: THREE.AnimationClip;
  /** Where the left hand's fingertips pinch, in the left wrist bone's own frame. */
  pinch: THREE.Matrix4;
}

const strip = (n: string) => n.replace(/\./g, '');

/** A model's bones posed as its idle's first frame, measured. */
class Rig {
  readonly bones: THREE.Bone[];
  readonly idle = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly saved: THREE.Quaternion[];

  constructor(private readonly tpl: TemplateLike) {
    let mesh: THREE.SkinnedMesh | null = null;
    tpl.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
    });
    this.bones = mesh ? (mesh as THREE.SkinnedMesh).skeleton.bones : [];
    this.saved = this.bones.map((b) => b.quaternion.clone());
    const idle = tpl.clips?.find((c) => c.name === 'Idle');
    for (const t of idle?.tracks ?? []) {
      if (!t.name.endsWith('.quaternion')) continue;
      const b = this.bones.find((x) => `${x.name}.quaternion` === t.name);
      if (b) b.quaternion.fromArray(t.values as unknown as number[], 0);
    }
    for (const b of this.bones) this.idle.set(b, b.quaternion.clone());
    tpl.root.updateMatrixWorld(true);
  }

  bone(name: string): THREE.Bone | undefined {
    const n = strip(name);
    return this.bones.find((b) => strip(b.name) === n);
  }

  /** Set bones to the idle with `turns` on top (bone -> turn in its own frame), and update. */
  pose(turns: Map<THREE.Object3D, THREE.Quaternion>): void {
    for (const [b, q] of this.idle) b.quaternion.copy(q);
    for (const [b, d] of turns) b.quaternion.copy(this.idle.get(b) ?? Q()).multiply(d);
    this.tpl.root.updateMatrixWorld(true);
  }

  restore(): void {
    this.bones.forEach((b, i) => b.quaternion.copy(this.saved[i]!));
    this.tpl.root.updateMatrixWorld(true);
  }
}

const at = (o: THREE.Object3D) => o.getWorldPosition(V());
const wq = (o: THREE.Object3D) => o.getWorldQuaternion(Q());

interface Arm {
  upper: THREE.Bone;
  lower: THREE.Bone;
  wrist: THREE.Bone;
  /** +1 for the character's left side (+x), -1 for the right. */
  side: number;
}

interface Solved {
  upper: THREE.Quaternion;
  lower: THREE.Quaternion;
  wrist: THREE.Quaternion;
  cost: number;
}

/**
 * The arm's bones' local turns that put the wrist at `w` turned to `wQ` (world), with the elbow
 * swung `swing` radians about the shoulder-wrist line from straight down-and-out. The rig must
 * stand in the pose the arm starts from (its parents are read from it).
 */
function reachArm(arm: Arm, w: V3, wQ: THREE.Quaternion, swing: number, start: Map<THREE.Object3D, THREE.Quaternion>): Solved {
  const s = at(arm.upper);
  const e0 = at(arm.lower);
  const w0 = at(arm.wrist);
  const l1 = e0.distanceTo(s);
  const l2 = w0.distanceTo(e0);
  const toW = w.clone().sub(s);
  let d = toW.length();
  const n = toW.normalize();
  d = Math.min(d, (l1 + l2) * 0.999);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // the elbow points down, a little out to its side and back
  const pole = V(arm.side * 0.45, -1, -0.25);
  pole.addScaledVector(n, -pole.dot(n)).normalize().applyAxisAngle(n, swing);
  const e = s.clone().addScaledVector(n, a).addScaledVector(pole, h);
  const wAt = s.clone().addScaledVector(n, d);
  // the upper arm turns (in the world) from where its elbow is to where it should be
  const parentQ = wq(arm.upper.parent!);
  const upperW = wq(arm.upper);
  const r1 = Q().setFromUnitVectors(e0.clone().sub(s).normalize(), e.clone().sub(s).normalize());
  const upperW2 = r1.clone().multiply(upperW);
  // the forearm, carried along, then turned onto the wrist
  const lowerW = r1.clone().multiply(wq(arm.lower));
  const fore0 = w0.clone().sub(e0).applyQuaternion(r1).normalize();
  const fore = wAt.clone().sub(e).normalize();
  const r2 = Q().setFromUnitVectors(fore0, fore);
  let lowerW2 = r2.clone().multiply(lowerW);
  // the wrist's turn left over, half of its twist about the forearm given to the forearm
  let wristL = lowerW2.clone().invert().multiply(wQ);
  const axis = arm.wrist.position.clone().normalize();
  const twist = twistAbout(wristL, axis);
  const half = Q().slerpQuaternions(Q(), twist, 0.5);
  lowerW2 = lowerW2.clone().multiply(half);
  wristL = lowerW2.clone().invert().multiply(wQ);
  const upperL = parentQ.clone().invert().multiply(upperW2);
  const lowerL = upperW2.clone().invert().multiply(lowerW2);
  // how far the wrist bends from how it started, and the elbow never up over the shoulder
  const startWrist = start.get(arm.wrist) ?? Q();
  const bend = angle(wristL, startWrist);
  const miss = wAt.distanceTo(w);
  const cost = bend + Math.max(0, e.y - s.y + 0.02) * 20 + miss * 40 + Math.abs(swing) * 0.1;
  return { upper: upperL, lower: lowerL, wrist: wristL, cost };
}

/** The part of `q` that turns about `axis` (swing-twist). */
function twistAbout(q: THREE.Quaternion, axis: V3): THREE.Quaternion {
  const p = axis.clone().multiplyScalar(q.x * axis.x + q.y * axis.y + q.z * axis.z);
  const t = new THREE.Quaternion(p.x, p.y, p.z, q.w);
  if (t.lengthSq() < 1e-12) return Q();
  return t.normalize();
}

function angle(a: THREE.Quaternion, b: THREE.Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
}

/** Tries over a grid, then closer round the best, for two parameters. */
function search2(lo: [number, number], hi: [number, number], f: (a: number, b: number) => number): [number, number] {
  let best: [number, number] = [0, 0];
  let bestC = Infinity;
  let span: [number, number] = [hi[0] - lo[0], hi[1] - lo[1]];
  let c0: [number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
  for (let round = 0; round < 4; round++) {
    const steps = round === 0 ? 13 : 7;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const a = c0[0] + (i / (steps - 1) - 0.5) * span[0];
        const b = c0[1] + (j / (steps - 1) - 0.5) * span[1];
        const c = f(a, b);
        if (c < bestC) {
          bestC = c;
          best = [a, b];
        }
      }
    }
    c0 = best;
    span = [span[0] * 0.3, span[1] * 0.3];
  }
  return best;
}

const cache = new Map<string, Poses>();

/** How far a drink is tipped back at the lips while it goes down, by what it's in (radians). */
const TIP: Record<string, number> = { flute: 0.95, martini: 0.62, wine: 0.85, margarita: 0.6, rocks: 0.8, cup: 0.8, bottle: 1.35, can: 1.3, magnum: 1.35 };

/** The poses for one model holding one kind of thing, worked out on first use. */
export function posesFor(tpl: TemplateLike, view: HandView, held: HeldModel): Poses | null {
  const key = `${view.id}|${held.model}`;
  const known = cache.get(key);
  if (known) return known;
  const rig = new Rig(tpl);
  try {
    const out = solveAll(rig, view, held);
    if (out) cache.set(key, out);
    return out;
  } finally {
    rig.restore();
  }
}

function solveAll(rig: Rig, view: HandView, held: HeldModel): Poses | null {
  const R: Arm | null = arm(rig, 'R', -1);
  const L: Arm | null = arm(rig, 'L', 1);
  const head = rig.bone('Head');
  const neck = rig.bone('Neck');
  if (!R || !L || !head) return null;
  // which way is the character's left: the left arm's side of the right
  const leftX = Math.sign(at(L.upper).x - at(R.upper).x) || 1;
  R.side = -leftX;
  L.side = leftX;
  const carry = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const [name, q] of view.carry) {
    const b = rig.bone(name);
    if (b) carry.set(b, q);
  }
  rig.pose(new Map());
  const mouth = view.mouth.clone().applyMatrix4(head.matrixWorld);
  const idleLocal = new Map<THREE.Object3D, THREE.Quaternion>([...rig.idle].map(([b, q]) => [b, q.clone()]));

  // the carrying pose: where the glass is, turned how
  rig.pose(carry);
  const carried = new Map<THREE.Object3D, THREE.Quaternion>([R.upper, R.lower, R.wrist].map((b) => [b, b.quaternion.clone()]));
  const glass0 = R.wrist.matrixWorld.clone().multiply(view.grip);
  const g0Q = Q();
  glass0.decompose(V(), g0Q, V());
  const shoulderR = at(R.upper);
  const plateAt = held.plate ? held.plate.clone().applyMatrix4(glass0) : null;
  const forward = V(0, 0, 1);
  const inward = V(leftX, 0, 0);
  const gripInv = view.grip.clone().invert();

  const clips: Poses['clips'] = {};
  // the carrying pose's grip (the fingers round the glass) goes into every right-arm pose
  const fingers = [...carry].filter(([b]) => b !== R.upper && b !== R.lower && b !== R.wrist);
  const trackR = (name: ArmPose, s: Solved, extra: [THREE.Object3D, THREE.Quaternion][] = []) => {
    clips[name] = clip(name, [
      ...fingers,
      [R.upper, delta(idleLocal, R.upper, s.upper)],
      [R.lower, delta(idleLocal, R.lower, s.lower)],
      [R.wrist, delta(idleLocal, R.wrist, s.wrist)],
      ...extra,
    ]);
  };

  /**
   * The right hand puts the held thing's `point` (its own frame) at `target`, the thing turned by
   * `tilt` (world) from upright; the search turns it about its upright and swings the elbow.
   */
  const place = (point: V3, target: V3, tilt: THREE.Quaternion, yawRange = 1.4): Solved => {
    rig.pose(carry);
    const run = (yaw: number, swing: number): Solved => {
      const gQ = tilt.clone().multiply(Q().setFromAxisAngle(V(0, 1, 0), yaw)).multiply(g0Q);
      const gM = new THREE.Matrix4().makeRotationFromQuaternion(gQ);
      const origin = target.clone().sub(point.clone().applyMatrix4(gM));
      gM.setPosition(origin);
      // (the bones may be scaled: take the turn apart from the scale)
      const wP = V();
      const wQ = Q();
      gM.multiply(gripInv).decompose(wP, wQ, V());
      return reachArm(R, wP, wQ, swing, carried);
    };
    const [yaw, swing] = search2([-yawRange, -1.1], [yawRange, 1.1], (y, s) => run(y, s).cost);
    return run(yaw, swing);
  };

  const headTurn = (b: THREE.Bone, pitch: number): [THREE.Object3D, THREE.Quaternion] => {
    // about the body's left-right axis, in the bone's own frame; + looks down
    const q = wq(b);
    return [b, Q().setFromAxisAngle(V(1, 0, 0).applyQuaternion(q.clone().invert()).normalize(), pitch)];
  };

  if (held.plate && plateAt) {
    // the plate up under the chin (candles, and a little for every bite), and held out in front
    const chinAt = mouth.clone().add(V(0, -0.15, 0.2));
    trackR('chin', place(held.plate, chinAt, Q(), 0.6));
    const front = shoulderR.clone().addScaledVector(inward, 0.1).add(V(0, -0.05, 0)).addScaledVector(forward, 0.45);
    trackR('raise', place(held.plate, front, Q(), 0.8));
  } else {
    // a drink: the near side of the rim at the lips, the glass a little tipped, then well tipped
    const rimR = held.rimR;
    const lips = mouth.clone().add(V(0, -0.004, 0.014));
    const tipTo = (theta: number) => {
      const tilt = Q().setFromAxisAngle(V(1, 0, 0), -theta);
      const centre = lips.clone().add(V(0, Math.sin(theta), Math.cos(theta)).multiplyScalar(rimR));
      return place(held.lip, centre, tilt);
    };
    const full = TIP[held.model] ?? 0.8;
    const swig = full > 1.1;
    trackR('lift', tipTo(0.3), [headTurn(head, -0.04)]);
    trackR('tip', tipTo(full), [headTurn(head, swig ? -0.34 : -0.16), ...(neck ? [headTurn(neck, swig ? -0.12 : -0.05)] : [])]);
    // up in front at shoulder height (a toast, handing it back, shaking a bottle), then pointed up and away
    const front = shoulderR.clone().addScaledVector(inward, 0.12).add(V(0, 0.08, 0)).addScaledVector(forward, 0.42);
    trackR('raise', place(V(0, 0, 0), front, Q(), 1.0));
    const aimAt = shoulderR.clone().addScaledVector(inward, 0.06).add(V(0, 0.2, 0)).addScaledVector(forward, 0.38);
    trackR('aim', place(V(0, 0, 0), aimAt, Q().setFromAxisAngle(V(1, 0, 0), 0.85), 1.0));
  }

  // a tipsy sway: the body leaning a little to one side, the head keeping level
  rig.pose(new Map());
  const trunk = rig.bone('Torso') ?? rig.bone('Abdomen');
  if (trunk) {
    const lean = (sign: number): [THREE.Object3D, THREE.Quaternion][] => {
      const turn = (b: THREE.Bone, a: number): [THREE.Object3D, THREE.Quaternion] => [b, Q().setFromAxisAngle(V(0, 0, 1).applyQuaternion(wq(b).invert()).normalize(), a)];
      return [turn(trunk, 0.075 * sign), turn(head, -0.05 * sign), ...(neck ? [turn(neck, -0.02 * sign)] : [])];
    };
    clips.leanL = clip('leanL', lean(1));
    clips.leanR = clip('leanR', lean(-1));
  }

  // the left hand: its fingertips' pinch, measured at the idle
  rig.pose(new Map());
  const tipA = rig.bone('Index3.L') ?? rig.bone('Index2.L');
  const tipB = rig.bone('Thumb3.L') ?? rig.bone('Thumb2.L');
  const pinchW = tipA && tipB ? at(tipA).add(at(tipB)).multiplyScalar(0.5) : at(L.wrist);
  const pinch = L.wrist.matrixWorld.clone().invert().multiply(new THREE.Matrix4().makeTranslation(pinchW.x, pinchW.y, pinchW.z));
  const pinchLocal = V().setFromMatrixPosition(pinch);
  /** The left hand's pinch at `target`, the hand as the forearm carries it, bent `bend` at the wrist. */
  const reachL = (target: V3, bend: THREE.Quaternion): Solved => {
    rig.pose(new Map());
    const start = new Map<THREE.Object3D, THREE.Quaternion>([[L.wrist, L.wrist.quaternion.clone()]]);
    // the wrist's place depends on the hand's turn, which follows the forearm: a few rounds settle it
    let wP = target.clone();
    let best: Solved | null = null;
    for (let k = 0; k < 6; k++) {
      const s = reachArm(L, wP, Q(), 0, start);
      const lowerW = wq(L.upper.parent!).multiply(s.upper).multiply(s.lower);
      const wQ = lowerW.clone().multiply(rig.idle.get(L.wrist)!).multiply(bend);
      const [sw] = search2([-1, -0.01], [0.6, 0.01], (sw2) => reachArm(L, wP, wQ, sw2, start).cost);
      best = reachArm(L, wP, wQ, sw, start);
      // the pinch where it lands with this turn, and the wrist moved to bring it onto the target
      const off = pinchLocal.clone().applyQuaternion(wQ);
      wP = target.clone().sub(off);
    }
    return best!;
  };
  const trackL = (name: ArmPose, s: Solved, extra: [THREE.Object3D, THREE.Quaternion][] = []) => {
    clips[name] = clip(name, [
      [L.upper, delta(idleLocal, L.upper, s.upper)],
      [L.lower, delta(idleLocal, L.lower, s.lower)],
      [L.wrist, delta(idleLocal, L.wrist, s.wrist)],
      ...extra,
    ]);
  };
  const palmDown = Q().setFromAxisAngle(V(0, 0, 1), 0.2 * leftX);
  if (plateAt) {
    trackL('reach', reachL(plateAt.clone().add(V(0, 0.03, 0)), palmDown));
    rig.pose(new Map());
    trackL('eat', reachL(mouth.clone().add(V(0, -0.01, 0.04)), Q().setFromAxisAngle(V(1, 0, 0), -0.5)), [headTurn(head, 0.08)]);
  }
  rig.pose(new Map());
  const torso = rig.bone('Abdomen') ?? rig.bone('Torso') ?? rig.bone('Hips');
  if (torso) {
    const belly = at(torso).add(V(leftX * 0.05, 0.02, 0.14));
    trackL('belly', reachL(belly, Q().setFromAxisAngle(V(0, 1, 0), -0.6 * leftX)));
  }

  const carryClip = clip(
    'carry',
    [...carry].map(([b, q]) => [b, q] as [THREE.Object3D, THREE.Quaternion]),
  );
  return { clips, carry: carryClip, pinch };
}

function arm(rig: Rig, s: 'R' | 'L', side: number): Arm | null {
  const upper = rig.bone(`UpperArm.${s}`);
  const lower = rig.bone(`LowerArm.${s}`);
  const wrist = rig.bone(`Wrist.${s}`);
  return upper && lower && wrist ? { upper, lower, wrist, side } : null;
}

/** A bone's turn from its idle to `local`, in its own frame. */
function delta(idle: Map<THREE.Object3D, THREE.Quaternion>, b: THREE.Object3D, local: THREE.Quaternion): THREE.Quaternion {
  return (idle.get(b) ?? Q()).clone().invert().multiply(local).normalize();
}

function clip(name: string, turns: [THREE.Object3D, THREE.Quaternion][]): THREE.AnimationClip {
  return new THREE.AnimationClip(
    `dine-${name}`,
    1,
    turns.map(([b, q]) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1], [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w])),
    THREE.AdditiveAnimationBlendMode,
  );
}
