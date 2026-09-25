// What the law carries: a guard's peaked cap and shoulder radio, the pit boss's earpiece and
// tablet. Each piece is a few boxes and cylinders merged into one vertex-coloured mesh and hung on
// a bone of the character once its model has loaded, placed in the character's own frame (x to
// its left, y up, z forward) measured from that bone at the moment it's hung, so it rides the head
// or the chest or the hand from then on. All of it shares one material.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Person } from '../characters.ts';

let shared: THREE.Material | null = null;

function material(): THREE.Material {
  return (shared ??= new THREE.MeshLambertMaterial({ vertexColors: true, name: 'law-gear' }));
}

/** A geometry painted one colour (vertex colours), for merging. */
function paint(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  geo.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
}

function merged(parts: THREE.BufferGeometry[]): THREE.Mesh {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material());
  m.frustumCulled = false;
  return m;
}

/** A security guard's peaked cap: navy crown, black peak, a brass badge; centred on the crown of the head. */
export function guardCap(): THREE.Mesh {
  const crown = paint(new THREE.CylinderGeometry(0.118, 0.102, 0.075, 18, 1).translate(0, 0.02, 0), '#1a2030');
  const band = paint(new THREE.CylinderGeometry(0.104, 0.104, 0.028, 18, 1, true).translate(0, -0.012, 0), '#0c0e14');
  const peak = paint(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 16, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 0.75).rotateX(-0.12).translate(0, -0.03, 0.07), '#0a0a0c');
  const badge = box(0.03, 0.024, 0.008, 0, 0.012, 0.113, '#c29a45');
  return merged([crown, band, peak, badge]);
}

/** A radio clipped to the chest, its stubby aerial up by the shoulder. */
export function radio(): THREE.Mesh {
  return merged([box(0.052, 0.085, 0.028, 0, 0, 0, '#141416'), box(0.012, 0.055, 0.012, 0.012, 0.068, 0, '#0b0b0c'), box(0.03, 0.012, 0.004, 0, 0.02, 0.016, '#4a5260')]);
}

/** An earpiece: a bud in the ear and its clear coil curling down behind to the collar. */
export function earpiece(): THREE.Mesh {
  const parts = [paint(new THREE.SphereGeometry(0.012, 8, 6), '#1c1c1c')];
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const k = i / 24;
    pts.push(new THREE.Vector3(-0.004 * k, -0.02 - 0.15 * k, -0.02 - 0.035 * Math.sin(k * Math.PI)));
  }
  parts.push(paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.0035, 5), '#d8d4c8'));
  return merged(parts);
}

/** A tablet in a black rubber case, carried screen-in at the side. */
export function tablet(): THREE.Mesh {
  return merged([box(0.012, 0.29, 0.21, 0, 0, 0, '#101012'), box(0.002, 0.25, 0.17, -0.007, 0, 0, '#1e3a52')]);
}

const _root = new THREE.Matrix4();
const _bone = new THREE.Matrix4();
const _want = new THREE.Matrix4();
const _v = new THREE.Vector3();

/**
 * Hang `piece` on bone `bone` of `person` once its model is in: at `place` (given the bone's own
 * position, both in the character's frame), turned by `turn` (character frame). Returns a function
 * to call each frame until it answers true (hung).
 */
export function hangOn(person: Person, bone: string, piece: THREE.Object3D, place: (at: THREE.Vector3) => THREE.Vector3, turn = new THREE.Euler()): () => boolean {
  return () => {
    const b = person.root.getObjectByName(bone) ?? person.root.getObjectByName(bone.replace('.', ''));
    if (!b) return false;
    person.root.updateMatrixWorld(true);
    _root.copy(person.root.matrixWorld);
    const inv = _root.clone().invert();
    const at = b.getWorldPosition(_v).applyMatrix4(inv);
    const p = place(at.clone());
    _want.compose(p, new THREE.Quaternion().setFromEuler(turn), new THREE.Vector3(1, 1, 1));
    _want.premultiply(_root);
    _bone.copy(b.matrixWorld).invert();
    piece.matrixAutoUpdate = false;
    piece.matrix.multiplyMatrices(_bone, _want);
    b.add(piece);
    piece.updateMatrixWorld(true);
    return true;
  };
}
