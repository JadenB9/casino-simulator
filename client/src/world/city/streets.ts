// v7: the ground floor's roads: the street in front of the valet and the loop it now makes round
// the jail's and the garage's block (loop.ts), with sidewalks either side, curbs, the double yellow
// and the lane lines, crosswalks (the plaza's, the jail's, one to each store) and street lamps. The
// zone's own ground under it all is asphalt already, so the corners need only their sidewalks and
// paint; the straight runs lay a road surface of their own. Walls the walker can't pass follow the
// outer sidewalks' backs (posts round the corners).

import { hdr } from '../materials.ts';
import type { Kit } from './kit.ts';
import { CORNERS, LOOP } from './loop.ts';
import { GROUND } from './plan.ts';
import { STORES } from '../../../../shared/src/stores.ts';

const G = GROUND;
/** The inner sidewalks are as wide as the street's east one; the outer as wide as its west one. */
const INNER = G.walkEast.x1 - G.walkEast.x0;
const OUTER = G.walkWest.x1 - G.walkWest.x0;
const R = LOOP.r;
const H = LOOP.half;
/** The crosswalks over the street: the plaza's, the jail's door, and one to each store's door. */
export const CROSSWALKS = [0, -25, (STORES.guns.door.z0 + STORES.guns.door.z1) / 2, (STORES.homes.door.z0 + STORES.homes.door.z1) / 2];

export function buildStreets(kit: Kit): void {
  const z0 = LOOP.z0 + R;
  const z1 = LOOP.z1 - R;
  const x0 = LOOP.x0 + R;
  const x1 = LOOP.x1 - R;
  const road = G.road;
  const WW = G.walkWest;
  const WE = G.walkEast;

  // --- the street (the loop's west run) ---------------------------------------------------------
  // (the west sidewalk is cut where the drive's two driveways cross it to the street)
  const cuts = [-45.5, -40.5, 40.5, 45.5];
  for (const [a, b] of [
    [z0, cuts[0]!],
    [cuts[1]!, cuts[2]!],
    [cuts[3]!, z1],
  ] as const) {
    // (the sidewalk's edge tucked inside the curb, so their faces on the street never share a plane)
    kit.box('sidewalk', WW.x0, WW.x1 - 0.1, -0.1, 0.006, a, b, 2.4);
    kit.box('curb', WW.x1 - 0.22, WW.x1, -0.1, 0.01, a + 0.01, b - 0.01);
  }
  for (const side of [-1, 1] as const) {
    const za = side * 40.5;
    const zb = side * 45.5;
    kit.box('asphalt', G.drive.x0, WW.x1, -0.1, 0, Math.min(za, zb), Math.max(za, zb), 6);
  }
  kit.box('sidewalk', WE.x0 + 0.1, WE.x1, -0.1, 0.006, z0, z1, 2.4);
  kit.box('curb', WE.x0, WE.x0 + 0.22, -0.1, 0.01, z0 + 0.01, z1 - 0.01);
  kit.box('asphalt', road.x0, road.x1, -0.1, 0, z0, z1, 6);

  // --- the other three runs: the roads along the block's ends and its east side ------------------
  // north (+z) and south (-z) ends
  for (const side of [-1, 1] as const) {
    const zc = side * LOOP.z1;
    const zr0 = zc - H;
    const zr1 = zc + H;
    kit.box('asphalt', x0, x1, -0.1, 0, zr0, zr1, 6);
    // the inner sidewalk (toward the block) and the outer one (toward the towers)
    const inA = side > 0 ? zr0 - INNER : zr1;
    const inB = side > 0 ? zr0 : zr1 + INNER;
    kit.box('sidewalk', x0, x1, -0.1, 0.006, side > 0 ? inA : inA + 0.1, side > 0 ? inB - 0.1 : inB, 2.4);
    kit.box('curb', x0 + 0.01, x1 - 0.01, -0.1, 0.01, side > 0 ? inB - 0.22 : inA, side > 0 ? inB : inA + 0.22);
    const outA = side > 0 ? zr1 : zr0 - OUTER;
    const outB = side > 0 ? zr1 + OUTER : zr0;
    kit.box('sidewalk', x0, x1, -0.1, 0.006, side > 0 ? outA + 0.1 : outA, side > 0 ? outB : outB - 0.1, 2.4);
    kit.box('curb', x0 + 0.01, x1 - 0.01, -0.1, 0.01, side > 0 ? outA : outB - 0.22, side > 0 ? outA + 0.22 : outB);
  }
  // east
  {
    const xr0 = LOOP.x1 - H;
    const xr1 = LOOP.x1 + H;
    kit.box('asphalt', xr0, xr1, -0.1, 0, z0, z1, 6);
    kit.box('sidewalk', xr0 - INNER, xr0 - 0.1, -0.1, 0.006, z0, z1, 2.4);
    kit.box('curb', xr0 - 0.22, xr0, -0.1, 0.01, z0 + 0.01, z1 - 0.01);
    kit.box('sidewalk', xr1 + 0.1, xr1 + OUTER, -0.1, 0.006, z0, z1, 2.4);
    kit.box('curb', xr1, xr1 + 0.22, -0.1, 0.01, z0 + 0.01, z1 - 0.01);
  }

  // --- the corners: sidewalks and curbs round the quarter circles ---------------------------------
  for (const c of CORNERS) {
    const ri = R - H;
    const ro = R + H;
    kit.sector('sidewalk', c.x, c.z, ri - INNER, ri - 0.1, c.a0, c.a1, -0.1, 0.006);
    kit.sector('curb', c.x, c.z, ri - 0.22, ri, c.a0, c.a1, -0.1, 0.01);
    kit.sector('sidewalk', c.x, c.z, ro + 0.1, ro + OUTER, c.a0, c.a1, -0.1, 0.006);
    kit.sector('curb', c.x, c.z, ro, ro + 0.22, c.a0, c.a1, -0.1, 0.01);
    // the double yellow and the lane lines round the bend
    kit.sector('paint-yellow', c.x, c.z, R - 0.2, R - 0.08, c.a0, c.a1, 0, 0.003, 1);
    kit.sector('paint-yellow', c.x, c.z, R + 0.08, R + 0.2, c.a0, c.a1, 0, 0.003, 1);
    for (const r of [R - 2.5, R + 2.5]) {
      const dash = 3 / r;
      const gap = 6 / r;
      for (let a = c.a0 + gap / 2; a + dash < c.a1; a += dash + gap) kit.sector('paint-white', c.x, c.z, r - 0.06, r + 0.06, a, a + dash, 0, 0.003, 1);
    }
    // the backs of the outer sidewalks: the walker goes no further (the towers are past it)
    kit.arcWall(c.x, c.z, ro + OUTER + 0.4, c.a0, c.a1);
  }

  // --- markings on the straight runs ---------------------------------------------------------------
  // the street's lines stop short of its crosswalks; the east road's run unbroken
  const gaps = [...CROSSWALKS].sort((a, b) => a - b).map((c) => [c - 4.2, c + 4.2] as const);
  const pieces = (a: number, b: number): [number, number][] => {
    const out: [number, number][] = [];
    let s = a;
    for (const [g0, g1] of gaps) {
      if (g1 <= s || g0 >= b) continue;
      if (g0 > s) out.push([s, g0]);
      s = Math.max(s, g1);
    }
    if (s < b) out.push([s, b]);
    return out;
  };
  for (const [xc, broken] of [
    [(road.x0 + road.x1) / 2, true],
    [LOOP.x1, false],
  ] as const) {
    const runs = broken ? pieces(z0 + 0.02, z1 - 0.02) : [[z0 + 0.02, z1 - 0.02] as [number, number]];
    for (const [a, b] of runs) {
      kit.flat('paint-yellow', xc - 0.2, xc - 0.08, a, b, 0.003);
      kit.flat('paint-yellow', xc + 0.08, xc + 0.2, a, b, 0.003);
    }
    for (const off of [-2.5, 2.5]) {
      for (let z = z0; z < z1 - 1; z += 9) {
        const a = z + 1.5;
        const b = Math.min(z1 - 0.02, z + 4.5);
        const p = broken ? pieces(a, b) : [[a, b]];
        if (p.length === 1 && p[0]![0] === a && p[0]![1] === b) kit.flat('paint-white', xc + off - 0.06, xc + off + 0.06, a, b, 0.003);
      }
    }
  }
  // along the two end roads (x)
  for (const zc of [LOOP.z0, LOOP.z1]) {
    kit.flat('paint-yellow', x0 + 0.02, x1 - 0.02, zc - 0.2, zc - 0.08, 0.003);
    kit.flat('paint-yellow', x0 + 0.02, x1 - 0.02, zc + 0.08, zc + 0.2, 0.003);
    for (const off of [-2.5, 2.5]) for (let x = x0; x < x1 - 1; x += 9) kit.flat('paint-white', x + 1.5, Math.min(x1 - 0.02, x + 4.5), zc + off - 0.06, zc + off + 0.06, 0.003);
  }
  // the crosswalks' zebra over the street, and a stop line each way before the plaza's and the stores'
  for (const zc of CROSSWALKS) for (let x = road.x0 + 0.3; x < road.x1 - 0.4; x += 0.9) kit.flat('paint-white', x, x + 0.5, zc - 2, zc + 2, 0.003);
  const mid = (road.x0 + road.x1) / 2;
  for (const zc of CROSSWALKS) {
    kit.flat('paint-white', road.x0, mid - 0.3, zc - 3.6, zc - 3.2, 0.003);
    kit.flat('paint-white', mid + 0.3, road.x1, zc + 3.2, zc + 3.6, 0.003);
  }

  // --- the block's own ground round the stores, and a pocket garden outside each street corner -----
  for (const side of [-1, 1] as const) {
    const a = side > 0 ? 45 : LOOP.z0 + H + INNER;
    const b = side > 0 ? LOOP.z1 - H - INNER : -45;
    kit.box('pavers', WE.x1, LOOP.x1 - H - INNER, -0.1, 0.004, a, b, 3.2);
  }

  // --- street lamps along every run (their arms out over the road), two round each bend -------------
  for (let z = -54; z <= 54; z += 18) {
    streetLamp(kit, WW.x1 - 0.6, z, 1, 0);
    streetLamp(kit, WE.x0 + 0.6, z + 9, -1, 0);
    streetLamp(kit, LOOP.x1 - H - 0.6, z + 9, 1, 0);
    streetLamp(kit, LOOP.x1 + H + 0.6, z, -1, 0);
  }
  for (const side of [-1, 1] as const) {
    for (let x = x0 + 4; x < x1; x += 18) {
      streetLamp(kit, x, side * (LOOP.z1 + H + 0.6), 0, -side);
      streetLamp(kit, x + 9, side * (LOOP.z1 - H - 0.6), 0, side);
    }
  }
  for (const c of CORNERS) {
    const a = (c.a0 + c.a1) / 2;
    const r = R + H + 0.6;
    streetLamp(kit, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, -Math.cos(a), -Math.sin(a));
  }

  // --- the walls the walker can't pass: the backs of the outer sidewalks, and the valet's lots ------
  const back = OUTER + 0.4;
  kit.solid(LOOP.x1 + H + back, LOOP.x1 + H + back + 1, z0, z1, 6);
  for (const side of [-1, 1] as const) {
    const zb = side * (LOOP.z1 + H + back);
    kit.solid(x0, x1, Math.min(zb, zb + side), Math.max(zb, zb + side), 6);
    // the valet's side: north and south of its lots, up to the street's west sidewalk
    const zv = side * G.walk.z1;
    kit.solid(G.walk.x0 - 1, WW.x0, Math.min(zv, zv + side), Math.max(zv, zv + side), 6);
  }
  kit.solid(G.walk.x0 - 1, G.walk.x0, -G.walk.z1, G.walk.z1, 6);
}

/**
 * A street lamp on a sidewalk at (x, z), its arm reaching over the road along (ax, az) (a unit
 * vector along x or z, or a corner's diagonal).
 */
export function streetLamp(kit: Kit, x: number, z: number, ax: number, az: number): void {
  const h = 7.2;
  kit.cylinder('steel', x, z, 0.11, 0, h, 10, 0.08);
  kit.cylinder('steel', x, z, 0.2, 0, 0.6, 12);
  kit.post(x, z, 0.2, h);
  const reach = 2.4;
  const len = Math.hypot(ax, az) || 1;
  const ux = ax / len;
  const uz = az / len;
  const yaw = Math.atan2(ux, uz);
  // the arm, and the head at its end
  kit.turned('steel', x + (ux * reach) / 2, h - 0.04, z + (uz * reach) / 2, 0.1, 0.08, reach, yaw);
  const hx = x + ux * reach;
  const hz = z + uz * reach;
  kit.turned('steel', hx, h - 0.15, hz, 0.36, 0.18, 0.72, yaw);
  kit.light(hdr('#ffcf8a', 2.6), hx, h - 0.245, hz, 0.3, 0.01, 0.62, yaw);
  kit.pool(hx, hz, 7.5);
}
