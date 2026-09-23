// Sic Bo dice, drawn in code: ivory with black pips, and the one and the four in red as on
// Chinese dice. One painter draws the dice printed on the felt and the faces of the three dice in
// the shaker, so the layout and the dice always look like the same set.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FACE_ORDER, restRotation } from './faces.ts';

/** 19 mm dice, as at the craps table. */
export const DIE_SIZE = 0.019;

export const IVORY = '#f4efe3';
const PIP_BLACK = '#17130f';
const PIP_RED = '#b3141b';

/** Pip centres on a unit face. */
export const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.23], [0.72, 0.23], [0.28, 0.5], [0.72, 0.5], [0.28, 0.77], [0.72, 0.77]],
};

export function pipColor(face: number): string {
  return face === 1 || face === 4 ? PIP_RED : PIP_BLACK;
}

/**
 * A die face centred on (cx, cy), `size` pixels across: a rounded ivory square with its pips.
 * `flat` leaves out the body (the 3D dice's texture fills the whole face).
 */
export function paintDie(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, face: number, flat = false): void {
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  if (!flat) {
    g.save();
    g.shadowColor = 'rgba(0, 0, 0, 0.35)';
    g.shadowBlur = size * 0.08;
    g.shadowOffsetY = size * 0.03;
    g.fillStyle = IVORY;
    g.beginPath();
    g.roundRect(x0, y0, size, size, size * 0.16);
    g.fill();
    g.restore();
  }
  const r = size * (face === 1 ? 0.13 : 0.085);
  for (const [px, py] of PIPS[face]!) {
    const x = x0 + px * size;
    const y = y0 + py * size;
    // a drilled pip: dark rim, colour inside
    g.fillStyle = 'rgba(0, 0, 0, 0.28)';
    g.beginPath();
    g.arc(x, y + r * 0.12, r * 1.08, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = pipColor(face);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

let mats: THREE.Material[] | null = null;
let geo: THREE.BufferGeometry | null = null;

function faceTexture(face: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = IVORY;
  g.fillRect(0, 0, 128, 128);
  paintDie(g, 64, 64, 128, face, true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** One of the three dice in the shaker, its faces in faces.ts's order. Materials and geometry are shared. */
export class SicBoDie extends THREE.Mesh {
  constructor() {
    mats ??= FACE_ORDER.map((n) => new THREE.MeshPhysicalMaterial({ map: faceTexture(n), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 }));
    geo ??= new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 2, DIE_SIZE * 0.12);
    super(geo, mats);
  }
}

/** A die resting with `face` on top, turned `yaw` radians about the vertical (faces.ts). */
export function restQuaternion(face: number, yaw: number): THREE.Quaternion {
  return new THREE.Quaternion(...restRotation(face, yaw));
}
