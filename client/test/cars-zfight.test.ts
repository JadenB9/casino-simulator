// No two materials of a car share a plane (the far-off flicker the owner hates): every car, in
// every build (full: the garage, the valet's turntable, the curb; lite: the lot and the traffic).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CARS } from '../../shared/src/items.ts';
import { MatBatch } from '../src/world/cars/models.ts';
import { describeFight, findFights, type Surface } from '../src/world/zfight.ts';

function surfaces(id: string, lite: boolean, at: THREE.Matrix4): Surface[] {
  const out: Surface[] = [];
  for (const [mat, geo] of new MatBatch().car({ id, matrix: at, lite }).build()) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    out.push({ name: `${id}-${mat}`, mat, pos: g.getAttribute('position').array });
  }
  return out;
}

describe('car models: no z-fighting', () => {
  for (const lite of [false, true])
    for (const c of CARS)
      it(`${c.id}${lite ? ' (lite)' : ''}`, () => {
        // at the origin and out where the lots are, turned both ways (the checker's buckets fall differently)
        for (const at of [new THREE.Matrix4(), new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(143.8, 0, -31.4), new THREE.Matrix4().setPosition(110.7, 0, 36.6), new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(146.8, 0, 21.1)]) {
          const fights = findFights(surfaces(c.id, lite, at), { minArea: 1e-5 });
          expect(fights.map(describeFight)).toEqual([]);
        }
      });
});

describe('the city lot of parked cars: no z-fighting', () => {
  it('fills every stall without a single fight', async () => {
    const { stalls } = await import('../src/world/city/plan.ts');
    const { lotCars } = await import('../src/world/cars/lot.ts');
    const { CarMaterials } = await import('../src/world/cars/materials.ts');
    const lot = lotCars(stalls(), new CarMaterials('low', null), { seed: 0xca75, fill: 0.78 });
    const out: Surface[] = [];
    for (const o of lot.group.children as THREE.Mesh[]) out.push({ name: o.name, mat: o.name, pos: o.geometry.getAttribute('position').array });
    const fights = findFights(out, { unseen: ([, y], [, ny]) => y < -0.005 || (ny < -0.99 && y < 0.02) });
    expect(fights.map(describeFight).slice(0, 8)).toEqual([]);
  });
});
