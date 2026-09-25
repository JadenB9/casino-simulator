// Static geometry, merged per material and kept per room. Walls, ceilings, counters, trims and
// signs are built from many small pieces; drawing each as its own mesh would cost hundreds of draw
// calls, so every piece is baked into world space and merged. Each room's pieces of a material
// become one geometry, and all the rooms' geometries of that material one BatchedMesh: with
// multi-draw that's one draw call per material however many rooms show, and a room that can't be
// seen (visibility.ts) is switched off without touching the others. Each room's part is also
// culled against the camera on its own.
//
// Pieces can ask for world-projected UVs (`uv: metres per texture repeat`) so a wood or marble
// texture keeps the same scale on a long counter and a short trim.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpN = new THREE.Vector3();

export type Place = THREE.Matrix4 | { x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number };

/** The built batches: their meshes, and a switch for each room's part of them. */
export interface RoomMeshes {
  meshes: THREE.BatchedMesh[];
  setRoom(room: string, visible: boolean): void;
}

/**
 * Collects pieces into one BatchedMesh per material with one instance per room. `room` is where
 * the next pieces go; set it before building each room's things.
 */
export class Batch {
  room = '';
  private byMat = new Map<THREE.Material, Map<string, THREE.BufferGeometry[]>>();

  /**
   * Add a piece. The geometry is cloned and baked with `place`, so the same template can be added
   * many times. Only positions, normals and UVs are kept.
   */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, place: Place, uv?: number): void {
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
    this.push(mat, g);
  }

  /** A box by its centre and size. */
  box(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, uv?: number, ry = 0): void {
    this.add(new THREE.BoxGeometry(sx, sy, sz), mat, { x: cx, y: cy, z: cz, ry }, uv);
  }

  /** A piece already in world space with its own attributes (the glows' colours), taken as it is. */
  raw(geo: THREE.BufferGeometry, mat: THREE.Material): void {
    this.push(mat, geo);
  }

  private push(mat: THREE.Material, g: THREE.BufferGeometry): void {
    let rooms = this.byMat.get(mat);
    if (!rooms) this.byMat.set(mat, (rooms = new Map()));
    const list = rooms.get(this.room) ?? [];
    list.push(g);
    rooms.set(this.room, list);
  }

  /** Every piece so far in world space, by room and material (for the z-fighting check, zfight.ts). */
  surfaces(): { name: string; mat: string; pos: ArrayLike<number> }[] {
    const out: { name: string; mat: string; pos: ArrayLike<number> }[] = [];
    for (const [mat, rooms] of this.byMat) {
      for (const [room, pieces] of rooms) for (const g of pieces) out.push({ name: room, mat: mat.name || mat.type, pos: g.getAttribute('position').array });
    }
    return out;
  }

  /** Merge everything into one BatchedMesh per material, one instance per room, under `parent`. */
  build(parent: THREE.Object3D, name: string): RoomMeshes {
    const meshes: THREE.BatchedMesh[] = [];
    const parts = new Map<string, { mesh: THREE.BatchedMesh; id: number }[]>();
    const identity = new THREE.Matrix4();
    for (const [mat, rooms] of this.byMat) {
      const geos: [string, THREE.BufferGeometry][] = [];
      for (const [room, pieces] of rooms) {
        const merged = pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces, false);
        if (pieces.length > 1) for (const p of pieces) p.dispose();
        if (merged) geos.push([room, merged]);
      }
      if (geos.length === 0) continue;
      const vertices = geos.reduce((n, [, g]) => n + g.getAttribute('position').count, 0);
      const mesh = new THREE.BatchedMesh(geos.length, vertices, vertices, mat);
      mesh.name = `${name}:${mat.name || mat.type}`;
      for (const [room, g] of geos) {
        const id = mesh.addInstance(mesh.addGeometry(g));
        mesh.setMatrixAt(id, identity);
        g.dispose();
        const list = parts.get(room) ?? [];
        list.push({ mesh, id });
        parts.set(room, list);
      }
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.byMat.clear();
    return {
      meshes,
      setRoom(room, visible) {
        for (const p of parts.get(room) ?? []) p.mesh.setVisibleAt(p.id, visible);
      },
    };
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
