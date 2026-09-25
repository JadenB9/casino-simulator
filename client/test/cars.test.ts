// The cars' layout and models: stalls that fit the valet lot and keep the drive clear, a called
// car's way to its curb space and away, bays for every car in the garage that stay inside its walls
// and clear of each other and the door, the collection order, and every car building into a
// sensible shape.

import { describe, expect, it } from 'vitest';
import { CARS } from '../../shared/src/items.ts';
import { CURB } from '../../shared/src/valet.ts';
import { LOTS, inRect } from '../../shared/src/zones.ts';
import { CURB_LANE, GARAGE, THROUGH_LANE, VALET, along, arrivalPath, bays, collection, departurePath, parked, pathLength, stalls } from '../src/world/cars/layout.ts';
import { CAR_SPECS } from '../src/world/cars/specs.ts';
import { carKit, mergeCars } from '../src/world/cars/models.ts';
import * as THREE from 'three';

describe('valet lot', () => {
  it('lays the stalls inside the lot, apart from each other and clear of the drive', () => {
    const all = stalls();
    expect(all.length).toBeGreaterThanOrEqual(24);
    for (const s of all) {
      expect(inRect(LOTS.valet, s.x * 100, s.z * 100), `${s.x},${s.z}`).toBe(true);
      // the drive's lanes run up the west side; the porte-cochère's strip stays open
      expect(s.x - 1.25).toBeGreaterThan(THROUGH_LANE + 1.2);
      expect(Math.abs(s.z)).toBeGreaterThan(13);
    }
    for (const a of all)
      for (const b of all) if (a !== b) expect(Math.abs(a.x - b.x) >= 2.49 || Math.abs(a.z - b.z) >= 5.59, `${a.x},${a.z} / ${b.x},${b.z}`).toBe(true);
  });

  it('parks the same cars every time, and only cars that fit a stall', () => {
    const one = parked();
    expect(parked()).toEqual(one);
    expect(one.length).toBeGreaterThan(stalls().length / 2);
    for (const p of one) expect(carKit(p.id).length, p.id).toBeLessThan(5.6);
  });

  it('brings a called car to its curb space nose south, and takes it off down the street', () => {
    CURB.forEach((c, slot) => {
      const path = arrivalPath(slot);
      const end = along(path, pathLength(path));
      expect(end.done).toBe(true);
      expect(end.x).toBeCloseTo(c.x);
      expect(end.z).toBeCloseTo(c.z);
      // its last leg heads south-ish (nose -z)
      expect(Math.cos(end.yaw)).toBeLessThan(-0.7);
      // the drive in comes down the through lane, not through the other spaces
      const lane = path.filter((w) => w.z > c.z + 3 && w.z < 12);
      for (const w of lane) expect(w.x).toBeCloseTo(THROUGH_LANE);
      const away = departurePath(slot);
      expect(away[0]).toEqual({ x: CURB_LANE, z: c.z });
      expect(away.at(-1)!.z).toBeLessThan(LOTS.valet.minZ / 100);
    });
    expect(CURB_LANE).toBeGreaterThan(VALET.x0);
  });

  it('walks a path at the right distances', () => {
    const p = [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 5, z: 10 }];
    expect(pathLength(p)).toBe(15);
    expect(along(p, 5)).toMatchObject({ x: 0, z: 5, done: false });
    expect(along(p, 12)).toMatchObject({ x: 2, z: 10, done: false });
    expect(along(p, 99)).toMatchObject({ x: 5, z: 10, done: true });
    expect(along(p, 5).yaw).toBeCloseTo(0);
    expect(along(p, 12).yaw).toBeCloseTo(Math.PI / 2);
  });
});

describe('garage', () => {
  const inside = (x: number, z: number, m = 0) => x > GARAGE.x0 + m && x < GARAGE.x1 - m && z > GARAGE.z0 + m && z < GARAGE.z1 - m;

  it('has a bay for every car, inside the walls, apart, with the door aisle clear', () => {
    const b = bays();
    expect(b.length).toBe(CARS.length);
    expect(b.filter((x) => x.hero)).toHaveLength(1);
    expect(inRect(LOTS.garage, GARAGE.x0 * 100, GARAGE.z0 * 100) && inRect(LOTS.garage, GARAGE.x1 * 100, GARAGE.z1 * 100)).toBe(true);
    for (const bay of b) {
      // the longest car fits the bay whichever way it's turned
      expect(inside(bay.x, bay.z, 2.9), `${bay.x},${bay.z}`).toBe(true);
      // nothing stands in the way in from the door
      if (!bay.hero) expect(Math.abs(bay.z - GARAGE.doorZ) > 3.5 || bay.x > GARAGE.x0 + 9, `${bay.x},${bay.z}`).toBe(true);
    }
    for (const p of b)
      for (const q of b) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z), `${p.x},${p.z} / ${q.x},${q.z}`).toBeGreaterThan(5.3);
  });

  it('shows your cars dearest first, the dearest on the turntable, then empty bays for the rest', () => {
    const none = collection([]);
    expect(none.every((c) => !c.owned)).toBe(true);
    expect(none.map((c) => c.car)).toEqual(CARS.map((c) => c.id));
    const some = collection(['halden-roadster', 'ombra-oro', 'not-a-car', 'raffica-v10']);
    expect(some.slice(0, 3).map((c) => c.car)).toEqual(['ombra-oro', 'raffica-v10', 'halden-roadster']);
    expect(some[0]!.bay.hero).toBe(true);
    expect(some.slice(3).every((c) => !c.owned)).toBe(true);
    expect(new Set(some.map((c) => c.car)).size).toBe(CARS.length);
    const all = collection(CARS.map((c) => c.id));
    expect(all.every((c) => c.owned)).toBe(true);
    expect(all[0]!.car).toBe('ombra-oro');
  });
});

describe('car models', () => {
  it('has a shape for every car, and each builds into a car-sized body on four wheels on the ground', () => {
    for (const c of CARS) {
      expect(CAR_SPECS[c.id], c.id).toBeTruthy();
      const k = carKit(c.id);
      expect(k.length, c.id).toBeGreaterThan(3.5);
      expect(k.length, c.id).toBeLessThan(8);
      expect(k.width, c.id).toBeGreaterThan(1.4);
      expect(k.width, c.id).toBeLessThan(2.2);
      expect(k.height, c.id).toBeGreaterThan(0.8);
      expect(k.height, c.id).toBeLessThan(2.1);
      expect(k.wheels).toHaveLength(4);
      for (const w of k.wheels) {
        expect(Math.abs(w.z), c.id).toBeLessThan(k.length / 2);
        expect(w.y, c.id).toBeCloseTo(CAR_SPECS[c.id]!.wheelR);
      }
      // the body's geometry stays inside its measured box (the bevel's included)
      const box = new THREE.Box3();
      for (const g of k.body.values()) {
        g.computeBoundingBox();
        box.union(g.boundingBox!);
      }
      expect(box.min.y, c.id).toBeGreaterThan(-0.01);
      expect(box.max.z - box.min.z, c.id).toBeLessThan(k.length + 0.4);
    }
  });

  it('merges a car park into one geometry per material', () => {
    const lot = parked().slice(0, 6).map((p) => ({ id: p.id, paint: p.paint, matrix: new THREE.Matrix4().makeTranslation(p.stall.x, 0, p.stall.z) }));
    const merged = mergeCars(lot);
    expect(merged.size).toBeLessThanOrEqual(6);
    for (const g of merged.values()) {
      expect(g.getAttribute('color')).toBeTruthy();
      expect(g.getAttribute('normal')).toBeTruthy();
    }
  });
});
