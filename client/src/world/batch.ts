// Static geometry, merged per material. Walls, ceilings, counters, trims and signs are built from
// many small pieces; drawing each as its own mesh would cost hundreds of draw calls, so every
// piece is baked into world space and merged into one mesh per material at the end.
//
// Pieces can ask for world-projected UVs (`uv: metres per texture repeat`) so a wood or marble
// texture keeps the same scale on a long counter and a short trim.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Piece {
  geo: THREE.BufferGeometry;
}

const tmpN = new THREE.Vector3();

export class Batch {
  private byMat = new Map<THREE.Material, Piece[]>();

  /**
   * Add a piece. The geometry is cloned and baked with `matrix` (or position/rotation), so the
   * same template can be added many times.
   */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, place: THREE.Matrix4 | { x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number }, uv?: number): void {
    const m = place instanceof THREE.Matrix4 ? place : compose(place);
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    g.applyMatrix4(m);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (uv) projectUVs(g, uv);
    else if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.clearGroups();
    const list = this.byMat.get(mat) ?? [];
    list.push({ geo: g });
    this.byMat.set(mat, list);
  }

  /** A box by its centre and size. */
  box(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, uv?: number, ry = 0): void {
    this.add(new THREE.BoxGeometry(sx, sy, sz), mat, { x: cx, y: cy, z: cz, ry }, uv);
  }

  /** Merge everything into one mesh per material and add them to `parent`. */
  build(parent: THREE.Object3D, name: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, pieces] of this.byMat) {
      const merged = mergeGeometries(pieces.map((p) => p.geo), false);
      for (const p of pieces) p.geo.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}:${mat.name || mat.type}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.byMat.clear();
    return out;
  }
}

function compose(p: { x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number }): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
}

/** Box-project UVs from world position, picking the plane each face points along. */
function projectUVs(g: THREE.BufferGeometry, metres: number): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const k = 1 / metres;
  // per triangle, so a face never straddles two projections
  for (let i = 0; i < pos.count; i += 3) {
    tmpN.set(0, 0, 0);
    for (let j = 0; j < 3; j++) {
      tmpN.x += nor.getX(i + j);
      tmpN.y += nor.getY(i + j);
      tmpN.z += nor.getZ(i + j);
    }
    const ax = Math.abs(tmpN.x);
    const ay = Math.abs(tmpN.y);
    const az = Math.abs(tmpN.z);
    for (let j = 0; j < 3; j++) {
      const x = pos.getX(i + j);
      const y = pos.getY(i + j);
      const z = pos.getZ(i + j);
      let u: number;
      let v: number;
      if (ay >= ax && ay >= az) {
        u = x;
        v = z;
      } else if (ax >= az) {
        u = z;
        v = y;
      } else {
        u = x;
        v = y;
      }
      uv[(i + j) * 2] = u * k;
      uv[(i + j) * 2 + 1] = v * k;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
