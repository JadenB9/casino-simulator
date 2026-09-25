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
