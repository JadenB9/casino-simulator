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
import { GUNS, type GunItem } from '../../../../shared/src/arms.ts';
import { defineHomeMats, mergedGuns, showPiece, type Live } from '../home/furnish.ts';
import { APT } from '../home/plan.ts';

export interface StoreBuild {
  doors: SlidingDoors[];
  /** v7.2: let go of what's drawn apart from the kit (the guns on the wall, the showroom's own pieces). */
  dispose(): void;
  /** The ceiling inside a store (the follow camera keeps under it), or null. */
  ceilingAt(x: number, z: number): number | null;
  /** Inside a store (its own light)? */
  inside(x: number, z: number): boolean;
}

export function buildStores(kit: Kit, group: THREE.Group, mats: Mats, col: Collider): StoreBuild {
  const doors: SlidingDoors[] = [];
  for (const s of Object.values(STORES)) doors.push(shell(kit, group, mats, col, s));
  const guns = gunStore(kit, group);
  // v7.2: the showroom's sets are the pieces it sells, built as an apartment builds them
  defineHomeMats(mats);
  const live: Live = { group, updates: [], disposers: [] };
  homeStore(kit, col, live);
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
    dispose() {
      for (const m of guns) {
        m.geometry.dispose();
        m.removeFromParent();
      }
      for (const d of live.disposers) d();
    },
  };
}

/** The room: floor, walls, ceiling and its lights, the glass front with the doors, the roof, the sign. */
function shell(kit: Kit, group: THREE.Group, mats: Mats, col: Collider, s: Store): SlidingDoors {
  const R = s.room;
  const H = s.height;
  const T = 0.25;
  const guns = s.id === 'guns';
  // (v7.2: the gun store on polished black stone, like the counter of a jeweller's)
  kit.box(guns ? 'marble-black' : 'floor-wood', R.x0, R.x1, -0.1, 0.03, R.z0, R.z1, guns ? 2.4 : 1.6);
  // back and side walls, outside faces in stone, inside in the store's own finish
  const wall = guns ? 'wall-dark' : 'wall-cream';
  kit.box('limestone', R.x1, R.x1 + T, 0, H + 0.6, R.z0 - T, R.z1 + T, 2.4);
  kit.box('limestone', R.x0, R.x1, 0, H + 0.6, R.z0 - T, R.z0, 2.4);
  kit.box('limestone', R.x0, R.x1, 0, H + 0.6, R.z1, R.z1 + T, 2.4);
  kit.box(wall, R.x1 - 0.02, R.x1, 0.03, H, R.z0, R.z1, 2.4);
  kit.box(wall, R.x0 + 0.03, R.x1 - 0.02, 0.03, H, R.z0, R.z0 + 0.02, 2.4);
  kit.box(wall, R.x0 + 0.03, R.x1 - 0.02, 0.03, H, R.z1 - 0.02, R.z1, 2.4);
  kit.solid(R.x1, R.x1 + T, R.z0 - T, R.z1 + T, H);
  kit.solid(R.x0, R.x1, R.z0 - T, R.z0, H);
  kit.solid(R.x0, R.x1, R.z1, R.z1 + T, H);
  // the ceiling between the walls and behind the fascia, and the roof slab over it
  kit.box('ceiling', R.x0 + 0.09, R.x1, H, H + 0.5, R.z0, R.z1, 2.4);
  kit.box('concrete', R.x0 + 0.09, R.x1, H + 0.5, H + 0.56, R.z0, R.z1, 3);
  for (let x = R.x0 + 2; x < R.x1 - 1; x += 3) kit.light(GLOW.warm, x, H - 0.03, (R.z0 + R.z1) / 2, 0.12, 0.03, R.z1 - R.z0 - 2);
  // the glass front on the street (west), mullions, the door's gap
  const D = s.door;
  const fx = R.x0;
  kit.box('glass', fx - 0.02, fx + 0.02, 0.03, H, R.z0, D.z0 - 0.1);
  kit.box('glass', fx - 0.02, fx + 0.02, 0.03, H, D.z1 + 0.1, R.z1);
  kit.box('glass', fx - 0.02, fx + 0.02, 2.9, H, D.z0 - 0.1, D.z1 + 0.1);
  for (const z of [R.z0 + 0.06, D.z0 - 0.1, D.z1 + 0.1, R.z1 - 0.06]) kit.box('lacquer', fx - 0.06, fx + 0.06, 0.02, H, z - 0.05, z + 0.05);
  kit.box('lacquer', fx - 0.08, fx + 0.08, H, H + 0.58, R.z0 + 0.01, R.z1 - 0.01);
  kit.solid(fx - 0.1, fx + 0.1, R.z0, D.z0 - 0.1, H);
  kit.solid(fx - 0.1, fx + 0.1, D.z1 + 0.1, R.z1, H);
  kit.solid(fx - 0.1, fx + 0.1, D.z0 - 0.1, D.z1 + 0.1, H, { walk: false, bottom: 2.9 });
  const doors = new SlidingDoors({ x: fx, z0: D.z0 - 0.1, z1: D.z1 + 0.1, height: 2.9 }, mats, col);
  group.add(doors.group);
  // a mat inside the door, an awning over it, the name on the fascia (ground.ts: its neon letters)
  // over a line of light along the fascia's foot
  kit.box('fabric', fx + 0.1, fx + 1.6, 0.03, 0.036, D.z0, D.z1);
  kit.box(guns ? 'lacquer-red' : 'velvet-green', fx - 1.1, fx - 0.06, 3.0, 3.08, D.z0 - 0.6, D.z1 + 0.6);
  kit.light(guns ? hdr('#ff4a3a', 2.4) : hdr('#9effc8', 2.0), fx - 0.13, H + 0.05, (R.z0 + R.z1) / 2, 0.02, 0.03, R.z1 - R.z0 - 1);
  return doors;
}

/**
 * The guns on a wall (v7.2): lying flat against the board facing +z at `z`, the barrel to the
 * right, in two rows from `top` down, spread from x0 to x1.
 */
function gunWall(guns: readonly GunItem[], x0: number, x1: number, top: number, z: number): THREE.Mesh[] {
  const perRow = Math.ceil(guns.length / 2);
  return mergedGuns(guns, 'store:guns', (model, i) => {
    const at = x0 + ((i % perRow) + 0.5) * ((x1 - x0) / perRow);
    model.rotation.set(0, Math.PI / 2, 0);
    model.position.set(at - (model.userData.length as number) / 2, top - Math.floor(i / perRow) * 0.8, z + 0.1);
  });
}

/** Ace Arms: glass cases and a counter at the front, guns on a pegboard, the range at the back. */
function gunStore(kit: Kit, group: THREE.Group): THREE.Mesh[] {
  const s = STORES.guns;
  const R = s.room;
  const c = s.counter;
  // the counter the clerk stands behind (the customer's side at c.z), glass-topped cases
  kit.box('wood', c.x - 2.2, c.x + 2.2, 0.03, 0.95, c.z - 1.05, c.z - 0.55);
  kit.box('glass', c.x - 2.2, c.x + 2.2, 0.95, 0.97, c.z - 1.05, c.z - 0.55);
  kit.light(GLOW.shelf, c.x, 0.9, c.z - 0.8, 4.2, 0.02, 0.3);
  kit.solid(c.x - 2.2, c.x + 2.2, c.z - 1.05, c.z - 0.55, 0.97);
  // the wall behind the clerk: a walnut board with every gun the store sells on it, each on its pegs
  // under a strip of light (v7.2: the models themselves, as they're drawn in your hand)
  kit.box('planks', R.x0 + 1, R.x0 + 7.6, 1.0, 2.9, R.z0 + 0.02, R.z0 + 0.06, 1.2);
  kit.light(GLOW.shelf, R.x0 + 4.3, 2.84, R.z0 + 0.1, 6.4, 0.02, 0.03);
  const wall = gunWall(GUNS, R.x0 + 1.2, R.x0 + 7.4, 2.35, R.z0 + 0.06);
  for (const m of wall) group.add(m);
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
  return wall;
  function H(): number {
    return s.height;
  }
}

/**
 * Maison Home: room sets on platforms, the realtor's desk at the front with a model of the tower.
 * v7.2: each set is pieces the store sells, built as an apartment builds them: the Velvet Sectional
 * with its table, the King Canopy Bed with its lamps, the Marble Dining Table under the Crystal
 * Chandelier.
 */
function homeStore(kit: Kit, col: Collider, live: Live): void {
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
  // room sets on low carpeted platforms, facing the street door (west)
  const P = 0.15;
  const set = (x0: number, x1: number, z0: number, z1: number) => {
    kit.box('carpet-lounge', x0, x1, 0.03, P, z0, z1, 2);
    kit.solid(x0, x1, z0, z1, P);
  };
  const west = -Math.PI / 2;
  set(176, 180.5, R.z0 + 0.4, R.z0 + 4);
  showPiece(kit, col, 'sofa', 'velvet', { x: 179.6, z: R.z0 + 2.2, yaw: west }, live, P);
  showPiece(kit, col, 'plant', 'olive', { x: 176.7, z: R.z0 + 1.0, yaw: 0 }, live, P);
  set(181.2, 184.3, R.z0 + 0.4, R.z0 + 4.4);
  showPiece(kit, col, 'bed', 'canopy', { x: 182.75, z: R.z0 + 2.4, yaw: west }, live, P);
  set(177, 184.2, R.z1 - 3.4, R.z1 - 0.3);
  showPiece(kit, col, 'dining', 'marble', { x: 180.6, z: R.z1 - 1.85, yaw: 0 }, live, P);
  showPiece(kit, col, 'chandelier', 'crystal', { x: 180.6, z: R.z1 - 1.85, yaw: 0 }, live, s.height - APT.height);
}
