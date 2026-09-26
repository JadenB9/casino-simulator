// v7: the apartments' floor (shared/src/zones.ts ZONES.home), built like the ground floor and the
// roof (city/zone.ts ZoneBuild): the shell that's the same for everyone (the walls, the glass on
// three sides, the private elevator, the bedroom's partitions, the city at night far below and the
// towers round it) and the part that's yours (furnish.ts: the finishes of your step and your
// pieces), which `home.set()` rebuilds when what you own changes.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { Mats } from '../materials.ts';
import type { Collider } from '../collision.ts';
import { LIFTS } from '../../../../shared/src/lifts.ts';
import type { HomeSlot } from '../../../../shared/src/estate.ts';
import { Bank, panelTexture } from '../city/bank.ts';
import { Kit } from '../city/kit.ts';
import { Beacons, cityBelow, rng, skyDome, skylineRing, towers, type Tower } from '../city/sky.ts';
import type { ZoneBuild } from '../city/zone.ts';
import { APT, BEDROOM, DEPTH, SOUTH_SOLID_TO, TERRACE, inFlat, onTerrace } from './plan.ts';
import { defineHomeMats, furnish, type Furnished } from './furnish.ts';

/** What the app does with the apartment once it's built: furnish it for its owner. */
export interface HomeInterior {
  /** Your step (1-3), what you own, and your picks per slot: the flat is rebuilt to match. */
  set(tier: number, owned: ReadonlySet<string>, picks: Partial<Record<HomeSlot, string>>): void;
  /** What stands in each slot now. */
  readonly furnished: Furnished | null;
  /** The terrace door is open (the Penthouse step). */
  readonly terrace: boolean;
}

export type HomeBuild = ZoneBuild & { home: HomeInterior };

export function buildHome(mats: Mats, col: Collider, quality: Quality): HomeBuild {
  defineHomeMats(mats);
  const kit = new Kit('home', mats, col);
  const group = new THREE.Group();
  group.name = 'zone:home';
  const high = quality === 'high';
  const A = APT;
  const H = A.height;
  const T = A.wall;

  // --- the shell: structure behind the finishes, the elevator, the glass -------------------------
  kit.box('concrete', A.x0 - 1, TERRACE.x1 + 1, -0.6, -0.1, A.z0 - 1, A.z1 + 1, 3);
  // the west wall with the elevator in it
  const bank = new Bank(LIFTS.home, kit.batch, kit.glow, mats, col, { height: 3.0, clad: 'marble-black', trim: 'brass', door: 'lift-door' }, panelTexture('home'));
  group.add(bank.group);
  const liftZ0 = 68.6;
  const liftZ1 = 71.4;
  kit.box('wall', A.x0 - T, A.x0, 0, H, A.z0 - T, liftZ0, 2.4);
  kit.box('wall', A.x0 - T, A.x0, 0, H, liftZ1, A.z1 + T, 2.4);
  kit.box('wall', A.x0 - T, A.x0, 3.0, H, liftZ0, liftZ1, 2.4);
  kit.solid(A.x0 - T, A.x0, A.z0 - T, liftZ0, H);
  kit.solid(A.x0 - T, A.x0, liftZ1, A.z1 + T, H);
  // the south wall: solid behind the television, glass on east to the corner
  kit.box('wall', A.x0, SOUTH_SOLID_TO, 0, H, A.z1, A.z1 + T, 2.4);
  kit.solid(A.x0, SOUTH_SOLID_TO, A.z1, A.z1 + T, H);
  // floor-to-ceiling glass: the south's east end, the whole north, the east with the terrace door
  const glass = (x0: number, x1: number, z0: number, z1: number) => {
    kit.box('glass', x0, x1, 0.02, H - 0.02, z0, z1);
    kit.solid(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), H);
  };
  glass(SOUTH_SOLID_TO, A.x1, A.z1 + 0.06, A.z1 + 0.08);
  glass(A.x0, A.x1, A.z0 - 0.08, A.z0 - 0.06);
  glass(A.x1 + 0.06, A.x1 + 0.08, A.z0, TERRACE.door.z0);
  glass(A.x1 + 0.06, A.x1 + 0.08, TERRACE.door.z1, A.z1);
  // mullions every 2.4 m, and the frames top and bottom
  for (let x = A.x0 + 2.4; x < A.x1; x += 2.4) kit.box('lacquer', x - 0.03, x + 0.03, 0.02, H, A.z0 - 0.12, A.z0 - 0.02);
  for (let z = A.z0 + 2.4; z < A.z1; z += 2.4) if (z < TERRACE.door.z0 - 0.1 || z > TERRACE.door.z1 + 0.1) kit.box('lacquer', A.x1 + 0.02, A.x1 + 0.12, 0.02, H, z - 0.03, z + 0.03);
  for (let x = SOUTH_SOLID_TO + 2.4; x < A.x1; x += 2.4) kit.box('lacquer', x - 0.03, x + 0.03, 0.02, H, A.z1 + 0.02, A.z1 + 0.12);
  kit.box('lacquer', A.x0, A.x1, H - 0.1, H, A.z0 - 0.13, A.z0 - 0.01);
  kit.box('lacquer', A.x1 + 0.01, A.x1 + 0.13, H - 0.1, H, A.z0, A.z1);
  // the terrace door's frame; the doorway itself is shut by `terraceDoor` until the Penthouse step
  kit.box('lacquer', A.x1 + 0.02, A.x1 + 0.12, 0.02, H, TERRACE.door.z0 - 0.05, TERRACE.door.z0);
  kit.box('lacquer', A.x1 + 0.02, A.x1 + 0.12, 0.02, H, TERRACE.door.z1, TERRACE.door.z1 + 0.05);
  kit.box('lacquer', A.x1 + 0.02, A.x1 + 0.12, 2.6, H, TERRACE.door.z0, TERRACE.door.z1);
  const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.58, TERRACE.door.z1 - TERRACE.door.z0), mats.get('glass'));
  doorGlass.position.set(A.x1 + 0.07, 1.31, (TERRACE.door.z0 + TERRACE.door.z1) / 2);
  group.add(doorGlass);
  const terraceDoor = col.box(A.x1 + 0.07, (TERRACE.door.z0 + TERRACE.door.z1) / 2, 0.2, TERRACE.door.z1 - TERRACE.door.z0, 0, H);
  // the bedroom's partitions: its south side with a door by the hall, its east side solid
  const B = BEDROOM;
  kit.box('wall', A.x0, B.door.x0, 0, H, B.z1 - 0.12, B.z1, 2.4);
  kit.box('wall', B.door.x1, B.x1, 0, H, B.z1 - 0.12, B.z1, 2.4);
  kit.box('wall', B.door.x0, B.door.x1, 2.2, H, B.z1 - 0.12, B.z1, 2.4);
  kit.box('wall', B.x1, B.x1 + 0.12, 0, H, A.z0, B.z1, 2.4);
  kit.solid(A.x0, B.door.x0, B.z1 - 0.12, B.z1, H);
  kit.solid(B.door.x1, B.x1 + 0.12, B.z1 - 0.12, B.z1, H);
  kit.solid(B.x1, B.x1 + 0.12, A.z0, B.z1, H);
  kit.box('home-walnut', B.door.x0, B.door.x0 + 0.06, 0, 2.2, B.z1 - 0.14, B.z1 + 0.02);
  kit.box('home-walnut', B.door.x1 - 0.06, B.door.x1, 0, 2.2, B.z1 - 0.14, B.z1 + 0.02);
  // the slab's edge outside the glass, and the tower's face going down
  kit.box('concrete', A.x0 - 0.4, A.x1 + 0.4, -0.6, 0.02, A.z0 - 0.5, A.z0 - 0.14, 3);
  kit.box('concrete', SOUTH_SOLID_TO, A.x1 + 0.4, -0.6, 0.02, A.z1 + 0.14, A.z1 + 0.5, 3);
  kit.box('concrete', A.x1 + 0.14, TERRACE.x1 + 0.5, -0.6, 0.02, A.z0 - 0.5, TERRACE.z0, 3);
  kit.box('concrete', A.x1 + 0.14, TERRACE.x1 + 0.5, -0.6, 0.02, TERRACE.z1, A.z1 + 0.5, 3);
  kit.box('concrete', TERRACE.x1, TERRACE.x1 + 0.5, -0.6, 0.02, TERRACE.z0, TERRACE.z1, 3);
  // below the terrace step the terrace is a ledge: its slab only
  kit.box('concrete', A.x1 + 0.14, TERRACE.x1, -0.6, -0.12, TERRACE.z0, TERRACE.z1, 3);

  // --- the city at night, far below and all round -------------------------------------------------
  const rnd = rng(0x40e7);
  const cx = (A.x0 + TERRACE.x1) / 2;
  const cz = (A.z0 + A.z1) / 2;
  const own: Tower = { x: (A.x0 + TERRACE.x1) / 2, z: cz, w: TERRACE.x1 - A.x0 + 2.4, d: A.z1 - A.z0 + 2.4, h: DEPTH - 0.62, y0: -DEPTH };
  const near: Tower[] = [own];
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 60 + rnd() * 140;
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.cos(a) * r;
    const top = -50 + rnd() * 90;
    const w = 14 + rnd() * 22;
    const d = 14 + rnd() * 22;
    if (near.some((t) => Math.abs(t.x - x) < (t.w + w) / 2 + 4 && Math.abs(t.z - z) < (t.d + d) / 2 + 4)) continue;
    near.push({ x, z, w, d, h: top + DEPTH, y0: -DEPTH });
  }
  group.add(towers(near, 'night', 0x40e9));
  const beacons = new Beacons(
    near.filter((t) => t !== own && (t.y0 ?? 0) + t.h > 10).map((t) => new THREE.Vector3(t.x, (t.y0 ?? 0) + t.h + 1.2, t.z)),
    31,
  );
  group.add(beacons.points);
  group.add(cityBelow(470, -DEPTH, 0x40eb));
  const moon = new THREE.Vector3(0.4, 0.5, 0.7);
  group.add(skyDome('night', moon));
  for (const r of [
    { radius: 230, y0: -DEPTH, y1: 90, seed: 23, low: 0.2, high: 0.85, body: '#0d0f18', haze: '#3a2e38', lit: 0.3, glow: 1.2 },
    { radius: 330, y0: -DEPTH, y1: 60, seed: 29, low: 0.25, high: 0.9, body: '#141626', haze: '#3e3240', lit: 0.22, glow: 1.0 },
    { radius: 440, y0: -DEPTH, y1: 30, seed: 31, low: 0.3, high: 0.95, body: '#1e1e30', haze: '#40343e', lit: 0.16, glow: 0.9 },
  ].slice(0, high ? 3 : 2)) {
    const ring = skylineRing({ ...r, kind: 'night', size: high ? 4096 : 2048 });
    ring.position.set(cx, 0, cz);
    group.add(ring);
  }

  const meshes = kit.batch.build(group, 'home');
  const glowMeshes = kit.glow.build(group);

  // --- yours: the finishes and the pieces ---------------------------------------------------------
  let furnished: Furnished | null = null;
  let tier = 0;
  let key = '';
  const home: HomeInterior = {
    set(t, owned, picks) {
      const k = `${t}|${[...owned].sort().join(',')}|${JSON.stringify(picks)}`;
      if (k === key) return;
      key = k;
      tier = t;
      furnished?.dispose();
      furnished = furnish(mats, col, t, owned, picks);
      group.add(furnished.group);
      // the terrace door opens with the Penthouse step
      terraceDoor.walk = t < 3;
      doorGlass.visible = t < 3;
    },
    get furnished() {
      return furnished;
    },
    get terrace() {
      return tier >= 3;
    },
  };

  return {
    id: 'home',
    group,
    bank,
    seats: [],
    ready: Promise.resolve(),
    home,
    light(x, z) {
      return onTerrace(x, z) ? 'outside' : 'inside';
    },
    ceilingAt(x, z) {
      return inFlat(x, z) ? H : null;
    },
    update(dt) {
      beacons.update(dt);
    },
    setQuality() {},
    dispose() {
      furnished?.dispose();
      bank.dispose();
      for (const m of [...meshes.meshes, ...glowMeshes.meshes]) m.dispose();
      doorGlass.geometry.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null };
        if (mat.name === 'skyline' || mat.name === 'towers' || mat.name?.startsWith('sky-') || mat.name === 'city-below' || mat.name === 'lift-panels') {
          mat.map?.dispose();
          mat.dispose();
          mesh.geometry.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}
