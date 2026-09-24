// Hand posing for the floor's life, on top of a character's own animation: a waiter's tray arm, a
// drink handed over, a banker counting notes, a nod. The same turns characters.ts gives dealers
// (about the character's own axes: x its left, y up, z forward; applied z, then x, then y), laid
// over whatever the mixer and the character's own layers (the head's gaze, an emote) did this
// frame. Call restore() before the character's update and apply() after it.
//
// The character faces +z with its right hand on -x: a negative turn about x swings a hanging arm
// forward, a negative turn about z raises the right arm out to the side (the left mirrors: y and
// z change sign).

import * as THREE from 'three';

export type BoneKey = 'hips' | 'torso' | 'chest' | 'shoulderR' | 'upperR' | 'lowerR' | 'handR' | 'shoulderL' | 'upperL' | 'lowerL' | 'handL' | 'neck' | 'head';

const BONE_NAMES: Record<BoneKey, string> = {
  hips: 'Hips',
  torso: 'Torso',
  chest: 'Chest',
  shoulderR: 'Shoulder.R',
  upperR: 'UpperArm.R',
  lowerR: 'LowerArm.R',
  handR: 'Wrist.R',
  shoulderL: 'Shoulder.L',
  upperL: 'UpperArm.L',
  lowerL: 'LowerArm.L',
  handL: 'Wrist.L',
  neck: 'Neck',
  head: 'Head',
};

/** Parents before children, so each turn starts from its parent's new pose. */
const ORDER: BoneKey[] = ['hips', 'torso', 'chest', 'shoulderR', 'upperR', 'lowerR', 'handR', 'shoulderL', 'upperL', 'lowerL', 'handL', 'neck', 'head'];

/** Radians about the character's x (left), y (up) and z (forward) axes. */
export type Turn = [number, number, number];
export type Pose = Partial<Record<BoneKey, Turn>>;

/** The same turn for the left side. */
export const mirror = (t: Turn): Turn => [t[0], -t[1], -t[2]];

/** Weighted sum of poses (a held tray arm under a passing nod, say). */
export function blend(...layers: [Pose, number][]): Pose {
  const out: Pose = {};
  for (const [pose, k] of layers) {
    if (k <= 0) continue;
    for (const key of Object.keys(pose) as BoneKey[]) {
      const t = pose[key]!;
      const o = (out[key] ??= [0, 0, 0]);
      o[0] += t[0] * k;
      o[1] += t[1] * k;
      o[2] += t[2] * k;
    }
  }
  return out;
}

export class Poser {
  private bones: Partial<Record<BoneKey, THREE.Object3D>> = {};
  private found = false;
  private readonly saved = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly spare = new Map<THREE.Object3D, THREE.Quaternion>();

  constructor(private readonly root: THREE.Object3D) {}

  /** Before the character's own update: undo last frame's turns. */
  restore(): void {
    for (const [bone, q] of this.saved) bone.quaternion.copy(q);
    this.saved.clear();
  }

  /** After the character's own update: turn the bones by `pose`. */
  apply(pose: Pose): void {
    if (!this.ready()) return;
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(_rootQ).invert();
    for (const key of ORDER) {
      const t = pose[key];
      if (!t || (t[0] === 0 && t[1] === 0 && t[2] === 0)) continue;
      const bone = this.bones[key];
      if (!bone?.parent) continue;
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.getWorldQuaternion(_parentQ).premultiply(_rootQ);
      _turnQ.setFromEuler(_euler.set(t[0], t[1], t[2], 'YXZ'));
      _turnQ.premultiply(_invQ.copy(_parentQ).invert()).multiply(_parentQ);
      if (!this.saved.has(bone)) {
        let q = this.spare.get(bone);
        if (!q) this.spare.set(bone, (q = new THREE.Quaternion()));
        this.saved.set(bone, q.copy(bone.quaternion));
      }
      bone.quaternion.premultiply(_turnQ);
      bone.updateMatrixWorld(true);
    }
  }

  /** Where a bone is in the world now (after apply), or null before the model has loaded. */
  where(key: BoneKey, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.ready()) return null;
    const b = this.bones[key];
    return b ? b.getWorldPosition(out) : null;
  }

  /** The bones of the model the character shows now (a new outfit is a new model). */
  private ready(): boolean {
    const head = this.bones.head;
    if (this.found && head && attached(head, this.root)) return true;
    this.bones = {};
    this.saved.clear();
    this.spare.clear();
    for (const key of ORDER) {
      const name = BONE_NAMES[key];
      // GLTFLoader drops the dots from node names ("UpperArm.R" becomes "UpperArmR")
      const b = this.root.getObjectByName(name.replace('.', '')) ?? this.root.getObjectByName(name);
      if (b) this.bones[key] = b;
    }
    this.found = !!this.bones.head;
    return this.found;
  }
}

function attached(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

const _rootQ = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _invQ = new THREE.Quaternion();
const _turnQ = new THREE.Quaternion();
const _euler = new THREE.Euler();
