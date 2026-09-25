// The cars parked in the valet's stalls: real models in the paint a guest's car would be,
// merged into the cars' materials, so however many there are the whole lot is five or six draw
// calls. The city lays out the stalls and draws the asphalt (world/city/); this fills them.
// Parked cars have their lamps off.

import * as THREE from 'three';
import type { Collider } from '../collision.ts';
import { MatBatch, carKit } from './models.ts';
import type { CarMaterials } from './materials.ts';
import { parked, type Stall } from './layout.ts';

export interface Lot {
  group: THREE.Group;
  dispose(): void;
}

/**
 * Cars in these stalls (most of them: a few are left empty, the same ones every time for a
 * seed). With a collider, each car also stops the walker (not the camera).
 */
export function lotCars(stalls: readonly Stall[], mats: CarMaterials, opts: { seed?: number; collider?: Collider } = {}): Lot {
  const group = new THREE.Group();
  group.name = 'valet-lot';
  const batch = new MatBatch();
  for (const p of parked(stalls, opts.seed)) {
    batch.car({ id: p.id, paint: p.paint, matrix: new THREE.Matrix4().makeRotationY(p.stall.yaw).setPosition(p.stall.x, 0, p.stall.z) });
    if (opts.collider) {
      const k = carKit(p.id);
      opts.collider.box(p.stall.x, p.stall.z, k.width, k.length, p.stall.yaw, k.height, { cam: false });
    }
  }
  const geos: THREE.BufferGeometry[] = [];
  for (const [m, geo] of batch.build()) {
    const mesh = new THREE.Mesh(geo, mats.get(m));
    mesh.name = `lot-${m}`;
    group.add(mesh);
    geos.push(geo);
  }
  return {
    group,
    dispose() {
      group.removeFromParent();
      for (const g of geos) g.dispose();
    },
  };
}

/**
 * One car model many times over, moved every frame (the street's traffic): a set of instanced
 * meshes, one per material, lamps lit. `place(i, matrix, paint)` puts the i-th one; `hide(i)`
 * takes it off the road. Each model the traffic uses is one such set (five or six draw calls).
 */
export class CarFleet {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly paintMeshes: THREE.InstancedMesh[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly tint = new THREE.Color();

  constructor(readonly id: string, readonly count: number, mats: CarMaterials) {
    this.group.name = `fleet-${id}`;
    const one = new MatBatch().car({ id, paint: '#ffffff', matrix: new THREE.Matrix4() }).build();
    for (const [m, geo] of one) {
      const mesh = new THREE.InstancedMesh(geo, mats.get(m === 'lamp' ? 'glow' : m), count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, this.zero);
      if (m === 'paint') {
        for (let i = 0; i < count; i++) mesh.setColorAt(i, this.tint.set('#ffffff'));
        this.paintMeshes.push(mesh);
      }
      this.meshes.push(mesh);
      this.geos.push(geo);
      this.group.add(mesh);
    }
  }

  place(i: number, matrix: THREE.Matrix4, paint?: string): void {
    for (const m of this.meshes) {
      m.setMatrixAt(i, matrix);
      m.instanceMatrix.needsUpdate = true;
    }
    if (paint)
      for (const m of this.paintMeshes) {
        m.setColorAt(i, this.tint.set(paint));
        m.instanceColor!.needsUpdate = true;
      }
  }

  hide(i: number): void {
    for (const m of this.meshes) {
      m.setMatrixAt(i, this.zero);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of this.meshes) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}
