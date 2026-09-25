// No two materials of a car share a plane (the far-off flicker the owner hates): every car, in
// every build (full: the garage, the valet's turntable, the curb; lite: the lot and the traffic).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CARS } from '../../shared/src/items.ts';
import { MatBatch } from '../src/world/cars/models.ts';
import { describeFight, findFights, type Surface } from '../src/world/zfight.ts';
import { bays } from '../src/world/cars/layout.ts';

/** Where the garage stands its cars, and the turntable's car at every 15 degrees of its turn. */
const hero = bays()[0]!;
const GARAGE_AT = [
  ...bays().map((b) => new THREE.Matrix4().makeRotationY(b.yaw).setPosition(b.x, 0.12, b.z)),
  ...Array.from({ length: 24 }, (_, i) => new THREE.Matrix4().makeRotationY(hero.yaw + (i * Math.PI) / 12).setPosition(hero.x, 0.1, hero.z)),
];

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
        for (const at of [new THREE.Matrix4(), new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(143.8, 0, -31.4), new THREE.Matrix4().setPosition(110.7, 0, 36.6), new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(146.8, 0, 21.1), ...(lite ? [] : GARAGE_AT)]) {
          const fights = findFights(surfaces(c.id, lite, at), { minArea: 1e-5 });
          expect(fights.map(describeFight)).toEqual([]);
        }
      });
});

describe('the checker, far from the origin', () => {
  // two panels 1 mm apart, turned and set out where the garage is: a real fight, found; the same
  // two 5 mm apart: none (the checker once found fights out here that weren't, and missed some that were)
  const panel = (lift: number, mat: string): Surface => {
    const g = new THREE.PlaneGeometry(0.4, 0.3).translate(0, 0, lift).applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2 - 0.55).setPosition(180, 0.6, 15.5)).toNonIndexed();
    return { name: mat, mat, pos: g.getAttribute('position').array };
  };
  it('finds a real fight and nothing else', () => {
    expect(findFights([panel(0, 'paint'), panel(0.001, 'trim')]).length).toBe(1);
    expect(findFights([panel(0, 'paint'), panel(0.005, 'trim')])).toEqual([]);
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
