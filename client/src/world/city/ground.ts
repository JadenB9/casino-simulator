// The ground floor (plan.ts GROUND): the valet lobby, a hotel-casino's front hall in honey stone
// and bronze with the elevators in its back wall, a concierge desk, columns, chandeliers and
// sofas; sliding glass doors onto the porte-cochere, the valet stand and the drive; the valet's
// parking round a plaza and in two big lots; the street with its lanes, crosswalk, lamps and
// traffic; and the city at night beyond, lit windows to the horizon.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { Mats } from '../materials.ts';
import type { Collider } from '../collision.ts';
import { GLOW } from '../lighting.ts';
import { hdr } from '../materials.ts';
import { Props } from '../props.ts';
import { LIFTS } from '../../../../shared/src/lifts.ts';
import { Bank, panelTexture } from './bank.ts';
import { Kit, signAtlas, signMesh } from './kit.ts';
import { AISLES, GROUND, STALL, SURFACE, VALET_STAND, stalls } from './plan.ts';
import { parkedCars, Traffic } from './parking.ts';
import { Beacons, skyDome, skylineRing, towers, rng, type Tower } from './sky.ts';
import { SlidingDoors } from './doors.ts';
import type { ZoneBuild } from './zone.ts';

const G = GROUND;

export function buildGround(mats: Mats, col: Collider, quality: Quality): ZoneBuild {
  const kit = new Kit('ground', mats, col);
  const group = new THREE.Group();
  group.name = 'zone:ground';
  const high = quality === 'high';

  // --- the ground everywhere (under the lots too, a little lower, so a lot's own floor sits on it)
  kit.box('asphalt', G.zone.x0, G.zone.x1, -0.3, -0.02, G.zone.z0, G.zone.z1, 6);

  // --- the valet lobby: floor, walls, ceiling -----------------------------------------------------
  const H = G.hall;
  const HH = G.hallHeight;
  kit.box('marble-light', H.x0, H.x1, -0.1, 0, H.z0, H.z1, 2.4);
  // a black marble border and a runner from the elevators to the doors
  kit.box('marble-black', H.x0 + 0.6, H.x1 - 0.6, -0.1, 0.003, H.z0 + 0.6, H.z0 + 1.2, 1.2);
  kit.box('marble-black', H.x0 + 0.6, H.x1 - 0.6, -0.1, 0.003, H.z1 - 1.2, H.z1 - 0.6, 1.2);
  kit.box('marble-black', H.x0 + 3.2, H.x1 - 1.2, -0.1, 0.003, -1.6, -1.3, 1.2);
  kit.box('marble-black', H.x0 + 3.2, H.x1 - 1.2, -0.1, 0.003, 1.3, 1.6, 1.2);
  // walls: honey stone above a dark wood wainscot, with a bronze rail
  const B = G.building;
  const wall = (x0: number, x1: number, z0: number, z1: number, y0 = 0, y1 = HH) => {
    kit.box('limestone', x0, x1, Math.max(y0, 1.1), y1, z0, z1, 2.4);
    if (y0 < 1.1) kit.box('wainscot', x0, x1, y0, 1.1, z0, z1, 1.2);
    kit.solid(x0, x1, z0, z1, y1);
  };
  // north and south walls, a bronze rail along the wainscot's top
  wall(B.x0, B.x1, B.z0, H.z0);
  wall(B.x0, B.x1, H.z1, B.z1);
  kit.box('brass', H.x0, H.x1 - 0.2, 1.1, 1.14, H.z0, H.z0 + 0.02);
  kit.box('brass', H.x0, H.x1 - 0.2, 1.1, 1.14, H.z1 - 0.02, H.z1);
  // the west wall either side of the elevators, and over them (the cars stand behind it)
  const bankSpan = LIFTS.ground.cars * 1.9 + 0.8;
  const west = H.x0 - 0.4;
  kit.solid(west, H.x0, H.z0, -bankSpan / 2, HH);
  kit.solid(west, H.x0, bankSpan / 2, H.z1, HH);
  kit.box('limestone', west, H.x0, 1.1, HH, H.z0, -bankSpan / 2, 2.4);
  kit.box('wainscot', west, H.x0 + 0.03, 0, 1.1, H.z0, -bankSpan / 2, 1.2);
  kit.box('limestone', west, H.x0, 1.1, HH, bankSpan / 2, H.z1, 2.4);
  kit.box('wainscot', west, H.x0 + 0.03, 0, 1.1, bankSpan / 2, H.z1, 1.2);
  kit.box('limestone', west, H.x0, 3.8, HH, -bankSpan / 2, bankSpan / 2, 2.4);
  // the ceiling: a raised field with a lit cove round it, downlights in rows
  kit.box('ceiling-light', H.x0, H.x1, HH, HH + 0.2, H.z0, H.z1, 2.4);
  kit.box('limestone', H.x0, H.x1, HH - 0.5, HH, H.z0, H.z0 + 1.0, 2.4);
  kit.box('limestone', H.x0, H.x1, HH - 0.5, HH, H.z1 - 1.0, H.z1, 2.4);
  kit.box('limestone', H.x0, H.x0 + 1.0, HH - 0.5, HH, H.z0 + 1.0, H.z1 - 1.0, 2.4);
  kit.box('limestone', H.x1 - 1.0, H.x1, HH - 0.5, HH, H.z0 + 1.0, H.z1 - 1.0, 2.4);
  for (let x = H.x0 + 3.0; x < H.x1 - 1.5; x += 3.6) {
    for (const z of [-9.4, -5.6, 5.6, 9.4]) {
      kit.glow.add(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 16), GLOW.bulb, { x, y: HH - 0.51, z });
      kit.pool(x, z, 1.9, 0.006);
    }
  }
  kit.light(GLOW.warm, (H.x0 + H.x1) / 2, HH - 0.52, H.z0 + 1.02, H.x1 - H.x0 - 2, 0.03, 0.03);
  kit.light(GLOW.warm, (H.x0 + H.x1) / 2, HH - 0.52, H.z1 - 1.02, H.x1 - H.x0 - 2, 0.03, 0.03);
  kit.light(GLOW.warm, H.x0 + 1.02, HH - 0.52, 0, 0.03, 0.03, H.z1 - H.z0 - 2);
  kit.light(GLOW.warm, H.x1 - 1.02, HH - 0.52, 0, 0.03, 0.03, H.z1 - H.z0 - 2);
  // the elevators, in the west wall
  const bank = new Bank(LIFTS.ground, kit.batch, kit.glow, mats, col, { height: 3.8, clad: 'marble-black', trim: 'brass', door: 'lift-door' }, panelTexture('ground'));
  group.add(bank.group);

  // columns: black marble drums with bronze rings, two rows down the hall
  for (const x of [113.4, 120.6]) {
    for (const z of [-6.4, 6.4]) {
      kit.cylinder('marble-black', x, z, 0.42, 0, HH - 0.5, 28);
      kit.cylinder('brass', x, z, 0.47, 0, 0.16, 28);
      kit.cylinder('brass', x, z, 0.47, HH - 0.72, HH - 0.5, 28);
      kit.post(x, z, 0.46, HH);
    }
  }
  // the concierge desk on the north side, a backlit panel behind it
  const desk = { x0: 113.8, x1: 120.2, z0: -10.4, z1: -9.5 };
  kit.box('wood', desk.x0, desk.x1, 0, 1.06, desk.z0, desk.z1, 1.2);
  kit.box('marble-black', desk.x0 - 0.04, desk.x1 + 0.04, 1.06, 1.12, desk.z0 - 0.04, desk.z1 + 0.06, 1.2);
  kit.box('brass', desk.x0, desk.x1, 0.02, 0.1, desk.z1, desk.z1 + 0.012);
  kit.solid(desk.x0, desk.x1, desk.z0, desk.z1, 1.12);
  kit.box('wood', 113, 121, 0, 3.4, H.z0 + 0.03, H.z0 + 0.12, 1.4);
  kit.light(GLOW.soft, 117, 3.35, H.z0 + 0.14, 7.6, 0.03, 0.03);
  // sofas round two low tables on the south side, lamps, palms by the doors, plants in corners
  for (const [x, z] of [
    [110.2, 8.6],
    [123.4, 8.6],
  ] as const) {
    kit.prop('couch', x, z - 1.25, 2.2, 0);
    kit.prop('couch', x, z + 1.25, 2.2, Math.PI);
    kit.box('marble-black', x - 0.65, x + 0.65, 0, 0.42, z - 0.35, z + 0.35, 1.2);
    kit.solid(x - 1.1, x + 1.1, z - 1.65, z - 0.85, 0.85);
    kit.solid(x - 1.1, x + 1.1, z + 0.85, z + 1.65, 0.85);
    kit.solid(x - 0.65, x + 0.65, z - 0.35, z + 0.35, 0.42);
    for (const side of [-1, 1] as const) {
      const yaw = side < 0 ? 0 : Math.PI;
      [-0.62, 0, 0.62].forEach((sx, k) => {
        const lx = side < 0 ? sx : -sx;
        kit.seat({ id: `ground.sofa.${x === 110.2 ? 1 : 2}${side < 0 ? 'a' : 'b'}.${k + 1}`, x: x + lx, z: z + side * 1.15, yaw, top: 0.375, kind: 'sofa' });
      });
    }
    kit.prop('lamp-floor', x - 1.55, z, 1.6);
    kit.post(x - 1.55, z, 0.25, 1.6);
  }
  for (const z of [-4.2, 4.2]) {
    kit.cylinder('marble-black', 125.6, z, 0.55, 0, 0.62, 24, 0.6);
    kit.prop('palm', 125.6, z, 3.2, z > 0 ? 1.2 : 0.2, 0.62);
    kit.post(125.6, z, 0.6, 1.2);
  }
  for (const [x, z] of [
    [106.6, -11.4],
    [106.6, 11.4],
  ] as const) {
    kit.cylinder('brass', x, z, 0.36, 0, 0.5, 20, 0.4);
    kit.prop('plant-a', x, z, 1.5, 0, 0.5);
    kit.post(x, z, 0.4, 1.2);
  }
  kit.chandeliers.push({ x: 117, y: HH - 0.5, z: -3.2, size: 1.5, room: 'ground' }, { x: 117, y: HH - 0.5, z: 3.2, size: 1.5, room: 'ground' });

  // --- the glass front and its sliding doors -------------------------------------------------------
  const gx = H.x1;
  const mull = (z: number) => kit.box('brass', gx - 0.06, gx + 0.06, 0, 6.6, z - 0.05, z + 0.05);
  for (let z = H.z0; z <= H.z1 + 0.01; z += 2.1) if (z < G.doors.z0 - 0.3 || z > G.doors.z1 + 0.3) mull(z);
  mull(G.doors.z0 - 0.06);
  mull(G.doors.z1 + 0.06);
  kit.box('glass', gx - 0.02, gx + 0.02, 0, 6.4, H.z0, G.doors.z0 - 0.11);
  kit.box('glass', gx - 0.02, gx + 0.02, 0, 6.4, G.doors.z1 + 0.11, H.z1);
  kit.box('glass', gx - 0.02, gx + 0.02, 3.2, 6.4, G.doors.z0 - 0.11, G.doors.z1 + 0.11);
  kit.box('brass', gx - 0.08, gx + 0.08, 3.1, 3.24, G.doors.z0 - 0.11, G.doors.z1 + 0.11);
  kit.box('marble-black', gx - 0.1, gx + 0.2, 6.4, 6.8, H.z0 - 0.4, H.z1 + 0.4, 1.2);
  kit.solid(gx - 0.1, gx + 0.1, H.z0, G.doors.z0 - 0.1, 6.4);
  kit.solid(gx - 0.1, gx + 0.1, G.doors.z1 + 0.1, H.z1, 6.4);
  kit.solid(gx - 0.1, gx + 0.1, G.doors.z0 - 0.1, G.doors.z1 + 0.1, 6.4, { walk: false, bottom: 3.1 });
  const doors = new SlidingDoors({ x: gx, z0: G.doors.z0 - 0.1, z1: G.doors.z1 + 0.1, height: 3.1 }, mats, col);
  group.add(doors.group);
  // a mat inside the doors
  kit.box('fabric', gx - 3.2, gx - 0.3, 0, 0.006, -1.6, 1.6);

  // a round table under the chandeliers with flowers on it, rugs under the sofas
  kit.cylinder('marble-black', 116.6, 0, 0.8, 0, 0.74, 32, 0.72);
  kit.cylinder('brass', 116.6, 0, 0.9, 0.74, 0.78, 32);
  kit.prop('plant-a', 116.6, 0, 1.3, 0.4, 0.78);
  kit.post(116.6, 0, 0.9, 1.4);
  for (const x of [110.2, 123.4]) kit.box('carpet-lounge', x - 1.9, x + 1.9, 0, 0.008, 6.1, 11.1, 3.2);

  // --- the tower over the lobby: stone piers, glass, lit windows, the name in lights -------------
  const T: Tower[] = [{ x: (B.x0 + B.x1) / 2 - 0.1, z: 0, w: B.x1 - B.x0 - 0.2, d: B.z1 - B.z0 + 0.4, h: 78, y0: 6.8 }];
  // the podium walls round the hall (outside faces), up to the tower
  kit.box('limestone', B.x0, B.x0 + 0.2, 0, 6.8, B.z0, B.z1, 2.4);
  kit.box('limestone', B.x0, B.x1, 0, 6.8, B.z0 - 0.2, B.z0, 2.4);
  kit.box('limestone', B.x0, B.x1, 0, 6.8, B.z1, B.z1 + 0.2, 2.4);

  // --- porte-cochere, the sidewalk and the drive -----------------------------------------------------
  const C = G.canopy;
  const cy = G.canopyY;
  kit.box('curb', G.curb.x0, G.curb.x1, -0.1, 0.004, G.curb.z0, G.curb.z1, 2);
  kit.box('curb', G.curb.x1 - 0.2, G.curb.x1, -0.1, 0.008, G.curb.z0, G.curb.z1);
  kit.box('marble-black', C.x0, C.x1, cy, cy + 0.55, C.z0, C.z1, 1.6);
  kit.box('ceiling-light', C.x0 + 0.3, C.x1 - 0.3, cy - 0.01, cy, C.z0 + 0.3, C.z1 - 0.3);
  kit.box('brass', C.x1, C.x1 + 0.04, cy + 0.05, cy + 0.12, C.z0, C.z1);
  kit.box('brass', C.x0, C.x1 + 0.04, cy + 0.05, cy + 0.12, C.z0 - 0.04, C.z0);
  kit.box('brass', C.x0, C.x1 + 0.04, cy + 0.05, cy + 0.12, C.z1, C.z1 + 0.04);
  for (const z of [C.z0 + 0.5, C.z1 - 0.5]) {
    kit.cylinder('marble-black', C.x1 - 0.5, z, 0.3, 0, cy, 20);
    kit.cylinder('brass', C.x1 - 0.5, z, 0.34, 0, 0.3, 20);
    kit.post(C.x1 - 0.5, z, 0.34, cy);
  }
  // downlights in the canopy's underside, with their pools on the drive
  for (let x = C.x0 + 1.6; x < C.x1 - 0.5; x += 3.2) {
    for (let z = C.z0 + 1.6; z < C.z1 - 0.5; z += 3.2) {
      kit.glow.add(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 16), GLOW.bulb, { x, y: cy - 0.016, z });
      kit.pool(x, z, 2.2);
    }
  }
  // the drive: asphalt, a painted edge and a stop line at the crosswalk to the plaza
  kit.box('asphalt', G.drive.x0, G.drive.x1, -0.1, 0, G.drive.z0, G.drive.z1, 6);
  for (let z = G.walkway.z0; z < G.walkway.z1 - 0.1; z += 0.8) kit.flat('paint-white', G.drive.x0 + 0.3, G.drive.x1 - 0.3, z, z + 0.45, 0.003);
  kit.flat('paint-white', G.drive.x0 + 0.1, G.drive.x0 + 0.22, G.drive.z0, G.drive.z1, 0.003);
  // the valet stand: a lacquered podium with a brass top and a lamp
  const V = VALET_STAND;
  kit.box('lacquer', V.x - 0.28, V.x + 0.28, 0, 1.12, V.z - 0.42, V.z + 0.42);
  kit.box('brass', V.x - 0.32, V.x + 0.32, 1.12, 1.16, V.z - 0.46, V.z + 0.46);
  kit.box('brass', V.x - 0.285, V.x - 0.28, 0.2, 0.9, V.z - 0.3, V.z + 0.3);
  kit.light(GLOW.shelf, V.x - 0.29, 1.02, V.z, 0.01, 0.04, 0.6);
  kit.solid(V.x - 0.3, V.x + 0.3, V.z - 0.45, V.z + 0.45, 1.16);
  // big planters along the lobby's glass, either side of the doors
  for (const z of [-7.4, 7.4]) {
    kit.box('granite', 127.95, 129.2, 0, 0.62, z - 1.2, z + 1.2, 1.2);
    kit.box('soil', 128.05, 129.1, 0.62, 0.63, z - 1.1, z + 1.1);
    kit.box('hedge', 128.1, 129.05, 0.63, 1.05, z - 1.05, z + 1.05, 1.2);
    kit.solid(127.95, 129.2, z - 1.2, z + 1.2, 1.05);
  }

  // --- the plaza: pavers, hedges, palms, the name on a low stone wall ------------------------------
  const P = G.plaza;
  kit.box('pavers', P.x0, P.x1, -0.1, 0.004, P.z0, P.z1, 3.2);
  for (const side of [-1, 1] as const) {
    const zA = side < 0 ? P.z0 + 0.4 : G.walkway.z1 + 1.2;
    const zB = side < 0 ? G.walkway.z0 - 1.2 : P.z1 - 0.4;
    // a raised bed of hedges and palms each side of the walk
    kit.box('granite', P.x0 + 1.2, P.x1 - 1.4, 0, 0.48, zA, zB, 1.2);
    kit.box('soil', P.x0 + 1.35, P.x1 - 1.55, 0.48, 0.5, zA + 0.15, zB - 0.15);
    const hz = side < 0 ? zA + 0.2 : zB - 0.8;
    kit.box('hedge', P.x0 + 1.4, P.x1 - 1.6, 0.5, 1.15, hz, hz + 0.6, 1.2);
    kit.solid(P.x0 + 1.2, P.x1 - 1.4, zA, zB, 1.15);
    for (const x of [P.x0 + 3, P.x0 + 7.4]) kit.prop('palm', x, (zA + zB) / 2 + side * 0.4, 5.2, x * 0.3, 0.5);
  }
  // the monument by the street, facing the traffic
  kit.box('marble-black', P.x1 - 1.2, P.x1 - 0.6, 0, 1.1, 3.2, 8.6, 1.2);
  kit.box('brass', P.x1 - 0.61, P.x1 - 0.595, 0.12, 0.2, 3.3, 8.5);
  kit.solid(P.x1 - 1.2, P.x1 - 0.6, 3.2, 8.6, 1.1);

  // --- the valet's stacks and the surface lots ----------------------------------------------------------
  const V1 = { x0: 137.8, x1: 150 };
  for (const side of [-1, 1] as const) {
    const zA = side * 9.6;
    const zB = side * 40;
    kit.box('asphalt', V1.x0, V1.x1, -0.1, 0, Math.min(zA, zB), Math.max(zA, zB), 6);
    // stall lines, and the nose-to-nose line down the middle
    for (let k = 0; k <= 10; k++) {
      const z = side * (11.4 + k * STALL.w);
      kit.flat('paint-white', 138.4, 143.4, z - 0.05, z + 0.05, 0.003);
      kit.flat('paint-white', 144.2, 149.2, z - 0.05, z + 0.05, 0.003);
    }
    kit.flat('paint-yellow', 143.72, 143.88, Math.min(side * 11.4, side * 38.4), Math.max(side * 11.4, side * 38.4), 0.003);
    // the surface lot
    const s0 = side * SURFACE.z0;
    const s1 = side * SURFACE.z1;
    kit.box('asphalt', SURFACE.x0, SURFACE.x1, -0.1, 0, Math.min(s0, s1), Math.max(s0, s1), 6);
    for (const a of AISLES) {
      // arrows down each aisle
      for (let x = 106; x < 126; x += 8) kit.flat('paint-white', x, x + 1.6, side * (a.z0 + a.z1) / 2 - 0.08, side * (a.z0 + a.z1) / 2 + 0.08, 0.003);
    }
    for (const row of [17, 28.8, 34, 45.8]) {
      for (let k = 0; k <= 9; k++) {
        const x = 102.8 + k * STALL.w;
        const za = side * row;
        const zb = side * (row + STALL.d);
        kit.flat('paint-white', x - 0.05, x + 0.05, Math.min(za, zb), Math.max(za, zb), 0.003);
      }
    }
    // hedges round the lots' outer edges, a strip of palms along the far end
    kit.box('hedge', SURFACE.x0, SURFACE.x1, 0, 0.9, side > 0 ? SURFACE.z1 : -SURFACE.z1 - 0.8, side > 0 ? SURFACE.z1 + 0.8 : -SURFACE.z1, 1.2);
    kit.solid(SURFACE.x0, SURFACE.x1, side > 0 ? SURFACE.z1 : -SURFACE.z1 - 0.8, side > 0 ? SURFACE.z1 + 0.8 : -SURFACE.z1, 0.9);
    // lot lights: tall poles with two heads, pools under them
    for (const [x, z] of [
      [108, side * 25.5],
      [121, side * 25.5],
      [108, side * 42.5],
      [121, side * 42.5],
      [143.8, side * 24],
      [143.8, side * 36],
    ] as const) {
      lamp(kit, x, z, 8.5, 2);
    }
  }

  // --- the street -------------------------------------------------------------------------------------
  const R = G.road;
  const WW = G.walkWest;
  const WE = G.walkEast;
  const z0 = G.zone.z0;
  const z1 = G.zone.z1;
  kit.box('sidewalk', WW.x0, WW.x1, -0.1, 0.006, z0, z1, 2.4);
  kit.box('sidewalk', WE.x0, WE.x1, -0.1, 0.006, z0, z1, 2.4);
  kit.box('curb', WW.x1 - 0.22, WW.x1, -0.1, 0.01, z0, z1);
  kit.box('curb', WE.x0, WE.x0 + 0.22, -0.1, 0.01, z0, z1);
  kit.box('asphalt', R.x0, R.x1, -0.1, 0, z0, z1, 6);
  // the double yellow down the middle, dashed lane lines, the crosswalk's zebra and stop lines
  const mid = (R.x0 + R.x1) / 2;
  const cw = G.crosswalk;
  const along = (x0: number, x1: number, mat: string, dash: number, gap: number) => {
    for (let z = z0; z < z1; z += dash + gap) {
      const a = z;
      const b = Math.min(z1, z + dash);
      // (the markings stop at the crosswalk)
      if (b > cw.z0 - 2.2 && a < cw.z1 + 2.2) continue;
      kit.flat(mat, x0, x1, a, b, 0.003);
    }
  };
  along(mid - 0.2, mid - 0.08, 'paint-yellow', 200, 0);
  along(mid + 0.08, mid + 0.2, 'paint-yellow', 200, 0);
  along(R.x0 + 2.45, R.x0 + 2.57, 'paint-white', 3, 6);
  along(R.x1 - 2.57, R.x1 - 2.45, 'paint-white', 3, 6);
  for (let x = R.x0 + 0.3; x < R.x1 - 0.4; x += 0.9) kit.flat('paint-white', x, x + 0.5, cw.z0, cw.z1, 0.003);
  kit.flat('paint-white', R.x0, mid - 0.3, cw.z0 - 1.6, cw.z0 - 1.2, 0.003);
  kit.flat('paint-white', mid + 0.3, R.x1, cw.z1 + 1.2, cw.z1 + 1.6, 0.003);
  // street lamps along both sides, arms over the road; traffic signals at the crosswalk
  for (let z = -54; z <= 54; z += 18) {
    streetLamp(kit, WW.x1 - 0.6, z, 1);
    streetLamp(kit, WE.x0 + 0.6, z + 9, -1);
  }
  for (const [x, z, face] of [
    [WW.x1 - 0.5, cw.z0 - 0.8, 1],
    [WE.x0 + 0.5, cw.z1 + 0.8, -1],
  ] as const) {
    kit.cylinder('steel', x, z, 0.08, 0, 3.4, 10);
    kit.box('lacquer', x - 0.18, x + 0.18, 2.5, 3.4, z - 0.14, z + 0.14);
    // red for the traffic here, the walking man lit for the crosswalk
    kit.light(hdr('#ff3a22', 2.6), x + face * 0.19, 3.2, z, 0.01, 0.16, 0.16);
    kit.light(hdr('#f4f0e8', 2.2), x - face * 0.19, 2.72, z, 0.01, 0.2, 0.2);
    kit.post(x, z, 0.12, 3.4);
  }
  // the east side's plaza between the lots, a bench and planters at the lots' corners
  const gap = { x0: WE.x1, x1: 186, z0: -5, z1: 5 };
  kit.box('pavers', gap.x0, gap.x1, -0.1, 0.004, gap.z0, gap.z1, 3.2);
  kit.box('limestone', gap.x1, gap.x1 + 0.6, 0, 4.2, gap.z0, gap.z1, 2.4);
  kit.solid(gap.x1, gap.x1 + 0.6, gap.z0, gap.z1, 4.2);
  for (const z of [-3.6, 3.6]) {
    kit.cylinder('granite', 169.2, z, 0.55, 0, 0.6, 20);
    kit.prop('plant-b', 169.2, z, 1.4, 0, 0.6);
    kit.post(169.2, z, 0.6, 1.2);
  }

  // --- the city round it all -------------------------------------------------------------------------
  // near towers beyond the lots, the far ends of the street and behind the lobby's lots
  const rnd = rng(0x51ee7);
  const near: Tower[] = [...T];
  const addRow = (x0: number, x1: number, z0: number, z1: number, depth: number, lo: number, hi: number) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? x1 - x0 : z1 - z0;
    let t = 0;
    while (t < len - 6) {
      const w = Math.min(len - t, 14 + rnd() * 18);
      const h = lo + rnd() * (hi - lo);
      if (alongX) near.push({ x: x0 + t + w / 2, z: z0 + (depth / 2) * Math.sign(z0 || 1), w: w - 1.2, d: depth, h });
      else near.push({ x: x0 + (depth / 2) * Math.sign(x0), z: z0 + t + w / 2, w: depth, d: w - 1.2, h });
      t += w;
    }
  };
  addRow(200, 238, -60, 60, 24, 30, 110);
  addRow(98, 200, 62, 62, 20, 18, 70);
  addRow(98, 200, -62, -62, 20, 18, 70);
  near.push({ x: 110, z: 68, w: 20, d: 12, h: 46 });
  // and west, behind the lobby and its lots (the casino's floor is out that way: they stand between)
  near.push({ x: 90, z: -40, w: 16, d: 38, h: 56 }, { x: 89, z: 0, w: 18, d: 40, h: 92 }, { x: 90, z: 40, w: 16, d: 38, h: 64 });
  const towerMesh = towers(near, 'night', 0x7a11);
  group.add(towerMesh);
  // backdrop walls the walker can't pass (the towers' feet, the lots' far ends)
  kit.solid(G.walk.x0 - 1, G.walk.x1 + 1, G.walk.z1, G.walk.z1 + 1, 6);
  kit.solid(G.walk.x0 - 1, G.walk.x1 + 1, G.walk.z0 - 1, G.walk.z0, 6);
  kit.solid(G.walk.x1, G.walk.x1 + 1, G.walk.z0, G.walk.z1, 6);
  kit.solid(G.walk.x0 - 1, G.walk.x0, G.walk.z0, G.walk.z1, 6);
  const beacons = new Beacons(near.filter((t) => t.h > 80).map((t) => new THREE.Vector3(t.x, (t.y0 ?? 0) + t.h + 1.5, t.z)), 17);
  group.add(beacons.points);
  const moon = new THREE.Vector3(0.35, 0.62, -0.7);
  group.add(skyDome('night', moon));
  const cx = 160;
  for (const r of [
    { radius: 230, y0: -2, y1: 150, seed: 3, low: 0.12, high: 0.75, body: '#0d0f18', haze: '#3a2e38', lit: 0.3, glow: 1.2 },
    { radius: 330, y0: -4, y1: 230, seed: 5, low: 0.14, high: 0.86, body: '#141626', haze: '#3e3240', lit: 0.22, glow: 1.0 },
    { radius: 440, y0: -6, y1: 300, seed: 7, low: 0.1, high: 0.62, body: '#1e1e30', haze: '#40343e', lit: 0.16, glow: 0.9 },
  ].slice(0, high ? 3 : 2)) {
    const ring = skylineRing({ ...r, kind: 'night', size: high ? 4096 : 2048 });
    ring.position.x = cx;
    group.add(ring);
  }

  // --- what moves: the cars, the doors ---------------------------------------------------------------
  const parked = parkedCars(stalls(), mats, col, 0xca75);
  group.add(parked.group);
  const traffic = new Traffic(
    [
      { x: R.x0 + 1.25, dir: 1 },
      { x: R.x0 + 3.75, dir: 1 },
      { x: R.x1 - 3.75, dir: -1 },
      { x: R.x1 - 1.25, dir: -1 },
    ],
    z0 - 12,
    z1 + 12,
    R,
    mats,
    0x7aff,
    high ? 3 : 2,
  );
  group.add(traffic.group);

  // --- signs: the name over the canopy, VALET on its fascia, CONCIERGE, the monument ------------------
  const atlas = signAtlas([
    { text: 'CASINO SIMULATOR', font: '700 92px Cinzel, Georgia, serif', color: '#ffe2a6', glow: '#ffb35a' },
    { text: 'VALET', font: '600 96px Cinzel, Georgia, serif', color: '#ffe6b8', glow: '#ffb35a' },
    { text: 'CONCIERGE', font: '600 88px Cinzel, Georgia, serif', color: '#f4dca6' },
    { text: 'CASINO SIMULATOR', font: '600 80px Cinzel, Georgia, serif', color: '#e8c68a' },
  ]);
  const signs = signMesh(
    atlas,
    [
      { row: 0, x: B.x1 + 0.05, y: 9.4, z: 0, h: 2.2, ry: Math.PI / 2 },
      { row: 1, x: C.x1 + 0.03, y: cy + 0.28, z: 0, h: 0.44, ry: Math.PI / 2 },
      { row: 2, x: 117, y: 2.7, z: H.z0 + 0.13, h: 0.36, ry: 0 },
      { row: 3, x: P.x1 - 0.595, y: 0.68, z: 5.9, h: 0.5, ry: Math.PI / 2 },
    ],
    1.6,
  );
  group.add(signs);

  // --- build -------------------------------------------------------------------------------------------
  const meshes = kit.batch.build(group, 'ground');
  const glowMeshes = kit.glow.build(group);
  const pools = kit.pools('#ffc98a', 0.22);
  if (pools) group.add(pools);
  const props = new Props(quality);
  group.add(props.group);
  const ready = props.build(kit.props, kit.chandeliers).catch((err) => console.warn('ground props failed', err));

  return {
    id: 'ground',
    group,
    bank,
    seats: kit.seats,
    ready,
    /** Inside the hall the lobby's warm light; out under the sky the night's. */
    light(x, z) {
      return x >= B.x0 && x <= H.x1 && z >= H.z0 && z <= H.z1 ? 'inside' : 'outside';
    },
    ceilingAt(x, z) {
      if (x >= B.x0 && x <= H.x1 && z >= H.z0 && z <= H.z1) return HH;
      if (x >= C.x0 && x <= C.x1 && z >= C.z0 && z <= C.z1) return cy;
      return null;
    },
    update(dt, people, calm) {
      doors.update(dt, people);
      traffic.update(dt, people);
      beacons.update(dt, calm);
    },
    setQuality(q) {
      void props.setQuality(q);
    },
    dispose() {
      bank.dispose();
      doors.dispose();
      parked.dispose();
      traffic.dispose();
      for (const m of [...meshes.meshes, ...glowMeshes.meshes]) m.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null; emissiveMap?: THREE.Texture | null };
        if (mat.name === 'skyline' || mat.name === 'towers' || mat.name?.startsWith('sky-') || mat.name === 'city-signs' || mat.name === 'city-pools' || mat.name === 'lift-panels') {
          mat.map?.dispose();
          mat.emissiveMap?.dispose();
          mat.dispose();
          mesh.geometry.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}

/** A lot light: a tall pole with `heads` lamps on a cross-arm, their pools on the ground. */
function lamp(kit: Kit, x: number, z: number, h: number, heads: number): void {
  kit.cylinder('steel', x, z, 0.1, 0, h, 10, 0.07);
  kit.cylinder('concrete', x, z, 0.3, 0, 0.5, 14);
  kit.post(x, z, 0.3, h);
  const span = 1.4;
  kit.box('steel', x - span / 2 - 0.3, x + span / 2 + 0.3, h - 0.08, h, z - 0.06, z + 0.06);
  for (let i = 0; i < heads; i++) {
    const hx = x + (heads === 1 ? 0 : (i / (heads - 1) - 0.5) * span * 1.4);
    kit.box('steel', hx - 0.34, hx + 0.34, h - 0.2, h - 0.08, z - 0.22, z + 0.22);
    kit.light(hdr('#ffd8a0', 2.4), hx, h - 0.205, z, 0.6, 0.01, 0.36);
    kit.pool(hx, z, 7);
  }
}

/** A street lamp on the sidewalk, its arm reaching `dir` (+1 east, -1 west) over the road. */
function streetLamp(kit: Kit, x: number, z: number, dir: 1 | -1): void {
  const h = 7.2;
  kit.cylinder('steel', x, z, 0.11, 0, h, 10, 0.08);
  kit.cylinder('steel', x, z, 0.2, 0, 0.6, 12);
  kit.post(x, z, 0.2, h);
  const reach = 2.4;
  kit.box('steel', Math.min(x, x + dir * reach), Math.max(x, x + dir * reach), h - 0.08, h, z - 0.05, z + 0.05);
  const hx = x + dir * reach;
  kit.box('steel', hx - 0.36, hx + 0.36, h - 0.24, h - 0.06, z - 0.18, z + 0.18);
  kit.light(hdr('#ffcf8a', 2.6), hx, h - 0.245, z, 0.62, 0.01, 0.3);
  kit.pool(hx, z, 7.5);
}
