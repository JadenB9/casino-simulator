// Dice: a tumble that always lands on the faces the server rolled. The path is random-looking,
// but the last stretch slerps into the orientation that shows the chosen face on top.

import * as THREE from 'three';
import { tween, ease } from './tween.ts';

const SIZE = 0.019; // 19 mm casino dice
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]],
};

function faceTex(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b3121c';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f5f1e8';
  for (const [x, y] of PIPS[n]!) {
    g.beginPath();
    g.arc(x * 128, y * 128, 11, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// BoxGeometry face order: +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_ORDER = [3, 4, 1, 6, 2, 5];
let mats: THREE.Material[] | null = null;

/** Rotation that puts face `n` on top (+y). */
function topFor(n: number): THREE.Quaternion {
  const up = new THREE.Vector3(0, 1, 0);
  const normals = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ];
  const idx = FACE_ORDER.indexOf(n);
  return new THREE.Quaternion().setFromUnitVectors(normals[idx]!, up);
}

export class Die extends THREE.Mesh {
  constructor() {
    mats ??= FACE_ORDER.map((n) => new THREE.MeshPhysicalMaterial({ map: faceTex(n), roughness: 0.25, clearcoat: 0.6 }));
    super(new THREE.BoxGeometry(SIZE, SIZE, SIZE), mats);
  }
}

/** Throw a die from `from` to rest at `to`, ending with `face` up. */
export async function throwDie(die: Die, from: THREE.Vector3, to: THREE.Vector3, face: number, ms = 1600, spin = 1): Promise<void> {
  const target = topFor(face).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin * 1.3));
  const wild = new THREE.Quaternion().setFromEuler(new THREE.Euler(9 * spin, 7, 5 * spin));
  const start = die.quaternion.clone();
  await tween(ms, (k) => {
    die.position.lerpVectors(from, to, k);
    // two bounces on the way down
    const h = Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 0.12;
    die.position.y = to.y + SIZE / 2 + h;
    const q = start.clone().slerp(wild, Math.min(1, k * 1.4));
    die.quaternion.copy(k < 0.7 ? q : q.slerp(target, (k - 0.7) / 0.3));
  }, ease.outQuint);
  die.quaternion.copy(target);
}
