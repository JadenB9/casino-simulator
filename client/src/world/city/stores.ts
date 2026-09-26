// v7: the two stores across the street at the block's ends (shared/src/stores.ts): Ace Arms (the
// gun store, a counter and cases at the front, a shooting range behind a half wall at the back) and
// Maison Home (the home store: a showroom of room sets, the realtor's desk for the apartments).
// Each is a single room with a glass front on the east sidewalk, sliding doors, its name over them.

import * as THREE from 'three';
import { hdr } from '../materials.ts';
import { GLOW } from '../lighting.ts';
import { RANGE, STORES, type Store } from '../../../../shared/src/stores.ts';
import type { Mats } from '../materials.ts';
import type { Collider } from '../collision.ts';
import type { Kit } from './kit.ts';
import { SlidingDoors } from './doors.ts';

export interface StoreBuild {
  doors: SlidingDoors[];
  /** The ceiling inside a store (the follow camera keeps under it), or null. */
  ceilingAt(x: number, z: number): number | null;
  /** Inside a store (its own light)? */
  inside(x: number, z: number): boolean;
}

export function buildStores(kit: Kit, group: THREE.Group, mats: Mats, col: Collider): StoreBuild {
  const doors: SlidingDoors[] = [];
  for (const s of Object.values(STORES)) doors.push(shell(kit, group, mats, col, s));
  gunStore(kit);
  homeStore(kit);
  const inRoom = (s: Store, x: number, z: number) => x >= s.room.x0 && x <= s.room.x1 && z >= s.room.z0 && z <= s.room.z1;
  return {
    doors,
    ceilingAt(x, z) {
      for (const s of Object.values(STORES)) if (inRoom(s, x, z)) return s.height;
      return null;
    },
    inside(x, z) {
      return Object.values(STORES).some((s) => inRoom(s, x, z));
    },
  };
}

/** The room: floor, walls, ceiling and its lights, the glass front with the doors, the roof, the sign. */
function shell(kit: Kit, group: THREE.Group, mats: Mats, col: Collider, s: Store): SlidingDoors {
  const R = s.room;
  const H = s.height;
  const T = 0.25;
  const guns = s.id === 'guns';
  kit.box(guns ? 'concrete' : 'floor-wood', R.x0, R.x1, -0.1, 0.03, R.z0, R.z1, guns ? 3 : 1.6);
  // back and side walls, outside faces in stone, inside in the store's own finish
  const wall = guns ? 'wall-dark' : 'wall-cream';
  kit.box('limestone', R.x1, R.x1 + T, 0, H + 0.6, R.z0 - T, R.z1 + T, 2.4);
  kit.box('limestone', R.x0, R.x1, 0, H + 0.6, R.z0 - T, R.z0, 2.4);
  kit.box('limestone', R.x0, R.x1, 0, H + 0.6, R.z1, R.z1 + T, 2.4);
  kit.box(wall, R.x1 - 0.02, R.x1, 0.03, H, R.z0, R.z1, 2.4);
  kit.box(wall, R.x0, R.x1 - 0.02, 0.03, H, R.z0, R.z0 + 0.02, 2.4);
  kit.box(wall, R.x0, R.x1 - 0.02, 0.03, H, R.z1 - 0.02, R.z1, 2.4);
  kit.solid(R.x1, R.x1 + T, R.z0 - T, R.z1 + T, H);
  kit.solid(R.x0, R.x1, R.z0 - T, R.z0, H);
  kit.solid(R.x0, R.x1, R.z1, R.z1 + T, H);
  kit.box('ceiling', R.x0, R.x1 + T, H, H + 0.6, R.z0 - T, R.z1 + T, 2.4);
  for (let x = R.x0 + 2; x < R.x1 - 1; x += 3) kit.light(GLOW.warm, x, H - 0.03, (R.z0 + R.z1) / 2, 0.12, 0.03, R.z1 - R.z0 - 2);
  // the glass front on the street (west), mullions, the door's gap
  const D = s.door;
  const fx = R.x0;
  kit.box('glass', fx - 0.02, fx + 0.02, 0.03, H, R.z0, D.z0 - 0.1);
  kit.box('glass', fx - 0.02, fx + 0.02, 0.03, H, D.z1 + 0.1, R.z1);
  kit.box('glass', fx - 0.02, fx + 0.02, 2.9, H, D.z0 - 0.1, D.z1 + 0.1);
  for (const z of [R.z0, D.z0 - 0.1, D.z1 + 0.1, R.z1]) kit.box('lacquer', fx - 0.06, fx + 0.06, 0.03, H + 0.6, z - 0.05, z + 0.05);
  kit.box('lacquer', fx - 0.08, fx + 0.08, H, H + 0.6, R.z0, R.z1);
  kit.solid(fx - 0.1, fx + 0.1, R.z0, D.z0 - 0.1, H);
  kit.solid(fx - 0.1, fx + 0.1, D.z1 + 0.1, R.z1, H);
  kit.solid(fx - 0.1, fx + 0.1, D.z0 - 0.1, D.z1 + 0.1, H, { walk: false, bottom: 2.9 });
  const doors = new SlidingDoors({ x: fx, z0: D.z0 - 0.1, z1: D.z1 + 0.1, height: 2.9 }, mats, col);
  group.add(doors.group);
  // a mat inside the door, an awning over it, the name on the fascia
  kit.box('fabric', fx + 0.1, fx + 1.6, 0.03, 0.036, D.z0, D.z1);
  kit.box(guns ? 'lacquer-red' : 'velvet-green', fx - 1.1, fx - 0.06, 3.0, 3.08, D.z0 - 0.6, D.z1 + 0.6);
  kit.light(guns ? hdr('#ff4a3a', 2.4) : hdr('#9effc8', 2.0), fx - 0.13, H + 0.3, (R.z0 + R.z1) / 2, 0.02, 0.06, R.z1 - R.z0 - 1);
  return doors;
}

/** Ace Arms: glass cases and a counter at the front, guns on a pegboard, the range at the back. */
function gunStore(kit: Kit): void {
  const s = STORES.guns;
  const R = s.room;
  const c = s.counter;
  // the counter the clerk stands behind (the customer's side at c.z), glass-topped cases
  kit.box('wood', c.x - 2.2, c.x + 2.2, 0.03, 0.95, c.z - 1.05, c.z - 0.55);
  kit.box('glass', c.x - 2.2, c.x + 2.2, 0.95, 0.97, c.z - 1.05, c.z - 0.55);
  kit.light(GLOW.shelf, c.x, 0.9, c.z - 0.8, 4.2, 0.02, 0.3);
  kit.solid(c.x - 2.2, c.x + 2.2, c.z - 1.05, c.z - 0.55, 0.97);
  // the pegboard on the side wall behind the clerk, guns hung as dark shapes
  kit.box('planks', R.x0 + 1, R.x0 + 7.6, 1.0, 2.9, R.z0 + 0.02, R.z0 + 0.06, 1.2);
  for (let i = 0; i < 10; i++) {
    const x = R.x0 + 1.5 + (i % 5) * 1.25;
    const y = 1.5 + Math.floor(i / 5) * 0.8;
    kit.box('steel', x - 0.35, x + 0.35, y, y + 0.1, R.z0 + 0.07, R.z0 + 0.1);
    kit.box('wood', x - 0.4, x - 0.15, y - 0.12, y + 0.08, R.z0 + 0.07, R.z0 + 0.1);
  }
  // cases along the far side, and a flag of red light over the range's window
  kit.box('wood', R.x0 + 1.2, R.x0 + 8, 0.03, 0.9, R.z1 - 0.8, R.z1 - 0.1);
  kit.box('glass', R.x0 + 1.2, R.x0 + 8, 0.9, 0.92, R.z1 - 0.8, R.z1 - 0.1);
  kit.solid(R.x0 + 1.2, R.x0 + 8, R.z1 - 0.8, R.z1 - 0.1, 0.92);
  // the range: a half wall with a shelf to shoot from, lanes divided by baffles, targets at the back
  const W = RANGE.wall;
  kit.box('concrete', W - 0.15, W + 0.15, 0.03, 1.05, R.z0, R.z1, 2);
  kit.box('wood', W - 0.35, W + 0.15, 1.05, 1.1, R.z0, R.z1);
  kit.solid(W - 0.15, W + 0.15, R.z0, R.z1, 1.1);
  for (const z of [RANGE.lanes[0]! + 1.5, RANGE.lanes[1]! + 1.5]) kit.box('steel', W + 0.2, R.x1 - 0.4, 0.03, 2.4, z - 0.03, z + 0.03);
  kit.box('rust', RANGE.x1 - 0.1, R.x1 - 0.02, 0.03, H(), R.z0, R.z1, 2);
  kit.light(hdr('#ff3322', 2.2), W, 2.9, (R.z0 + R.z1) / 2, 0.04, 0.12, 3);
  // signs on the side wall: a red RANGE light and a rules board
  kit.box('lacquer', R.x1 - 0.6, R.x1 - 0.04, 2.6, 3.2, R.z0 + 0.04, R.z0 + 0.08);
  function H(): number {
    return s.height;
  }
}

/** Maison Home: room sets on platforms, the realtor's desk at the front with a model of the tower. */
function homeStore(kit: Kit): void {
  const s = STORES.homes;
  const R = s.room;
  const c = s.counter;
  // the realtor's desk (the customer at c.z, the clerk behind it at larger z)
  kit.box('wood', c.x - 1.8, c.x + 1.8, 0.03, 0.9, c.z + 0.55, c.z + 1.05);
  kit.box('marble-light', c.x - 1.85, c.x + 1.85, 0.9, 0.95, c.z + 0.5, c.z + 1.1);
  kit.solid(c.x - 1.85, c.x + 1.85, c.z + 0.5, c.z + 1.1, 0.95);
  // a model of the tower on a plinth, lit
  kit.box('marble-black', c.x + 3, c.x + 4, 0.03, 0.9, c.z + 0.4, c.z + 1.4);
  kit.box('glass', c.x + 3.25, c.x + 3.75, 0.9, 2.2, c.z + 0.65, c.z + 1.15);
  kit.light(GLOW.warm, c.x + 3.5, 2.1, c.z + 0.9, 0.3, 0.02, 0.3);
  kit.solid(c.x + 3, c.x + 4, c.z + 0.4, c.z + 1.4, 1.2);
  // room sets: a living set, a bedroom set, a dining set on low platforms
  const set = (x0: number, x1: number, z0: number, z1: number) => {
    kit.box('carpet-lounge', x0, x1, 0.03, 0.15, z0, z1, 2);
    kit.solid(x0, x1, z0, z1, 0.15);
  };
  set(176, 180.5, R.z0 + 0.4, R.z0 + 4);
  kit.box('cushion', 176.6, 179.9, 0.15, 0.55, R.z0 + 0.6, R.z0 + 1.5);
  kit.box('cushion', 176.6, 179.9, 0.55, 0.95, R.z0 + 0.6, R.z0 + 0.9);
  kit.box('wood', 177.4, 179.1, 0.15, 0.5, R.z0 + 2.3, R.z0 + 3.1);
  set(181.2, 184.3, R.z0 + 0.4, R.z0 + 4.4);
  kit.box('cushion', 181.6, 183.9, 0.15, 0.7, R.z0 + 0.6, R.z0 + 2.8);
  kit.box('wood', 181.6, 183.9, 0.15, 1.3, R.z0 + 0.5, R.z0 + 0.62);
  set(177, 184.2, R.z1 - 3.4, R.z1 - 0.3);
  kit.box('marble-light', 178.2, 182, 0.85, 0.9, R.z1 - 2.4, R.z1 - 1.3);
  kit.box('brass', 179.9, 180.3, 0.15, 0.85, R.z1 - 2, R.z1 - 1.7);
  for (let x = 178.5; x < 182; x += 1.1) for (const z of [R.z1 - 2.7, R.z1 - 1.0]) kit.box('velvet-green', x - 0.2, x + 0.2, 0.15, 0.6, z - 0.2, z + 0.2);
  // pendants over the sets
  for (const x of [178.2, 182.7, 180.1]) kit.glow.add(new THREE.SphereGeometry(0.14, 12, 8), GLOW.bulb, { x, y: 3.2, z: x === 180.1 ? R.z1 - 1.85 : R.z0 + 2 });
}
