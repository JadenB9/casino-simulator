// The shell of the casino: carpets and floor inlays, panelled walls, the low ceiling with its
// downlights, the stepped-up coffered ceiling over the table pit (warm cove light washing the
// fascia), and marble columns with brass rings. Everything here is static and goes into the batch.

import * as THREE from 'three';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import type { Collider } from './collision.ts';
import { GLOW, type GlowMerge } from './lighting.ts';
import { CEILING, PIT_CEILING, WALL, type FloorPlan, type Rect, inRect } from './layout.ts';

const FLOOR_Y = 0.004;

/**
 * Builds the shell; returns where chandeliers hang (coffer centres over the pit's middle) and where
 * the low ceiling's downlights are (x, z), for the light they throw on the carpet.
 */
export function buildRoom(plan: FloorPlan, b: Batch, m: Mats, col: Collider, glow: GlowMerge): { chandeliers: THREE.Vector3[]; downlights: [number, number][] } {
  const R = plan.room;
  const W = R.x1 - R.x0;
  const D = R.z1 - R.z0;

  // --- floor ---------------------------------------------------------------------------------
  const flat = (r: Rect, mat: THREE.Material, uv: number, y = FLOOR_Y) => {
    const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
    b.add(g, mat, new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2)), uv);
  };
  flat(R, m.get('carpet'), 3.2, 0);
  for (const a of plan.aisles) flat(a, m.get('carpet-aisle'), 1.2);
  flat(plan.pokerRoom, m.get('carpet-poker'), 2.4);
  flat(plan.entrance, m.get('marble-floor'), 2.4);
  // the bartenders' side of the bar is wood
  flat({ x0: plan.bar.front + plan.bar.depth, x1: R.x1, z0: plan.bar.z0 - 0.4, z1: plan.bar.z1 + 0.4 }, m.get('wood'), 1.4, FLOOR_Y + 0.001);
  // brass inlays along the aisle edges and round the vestibule
  const brass = m.get('brass');
  for (const a of [...plan.aisles, plan.entrance]) {
    const edges: Rect[] = [
      { x0: a.x0, x1: a.x1, z0: a.z0 - 0.02, z1: a.z0 + 0.02 },
      { x0: a.x0, x1: a.x1, z0: a.z1 - 0.02, z1: a.z1 + 0.02 },
      { x0: a.x0 - 0.02, x1: a.x0 + 0.02, z0: a.z0, z1: a.z1 },
      { x0: a.x1 - 0.02, x1: a.x1 + 0.02, z0: a.z0, z1: a.z1 },
    ];
    for (const e of edges) b.box(brass, (e.x0 + e.x1) / 2, 0.006, (e.z0 + e.z1) / 2, e.x1 - e.x0, 0.006, e.z1 - e.z0);
  }

  // --- walls ---------------------------------------------------------------------------------
  const wall = m.get('wall');
  const wains = m.get('wainscot');
  const lacquer = m.get('lacquer');
  const wood = m.get('beam');
  const H = CEILING;
  // [x0, z0, x1, z1] of each wall's inner face, and the inward normal
  const runs: { a: [number, number]; b: [number, number]; n: [number, number] }[] = [
    { a: [R.x0, R.z0], b: [R.x1, R.z0], n: [0, 1] },
    { a: [R.x0, R.z0], b: [R.x0, R.z1], n: [1, 0] },
    { a: [R.x1, R.z0], b: [R.x1, R.z1], n: [-1, 0] },
    { a: [R.x0, R.z1], b: [plan.door.x0, R.z1], n: [0, -1] },
    { a: [plan.door.x1, R.z1], b: [R.x1, R.z1], n: [0, -1] },
  ];
  for (const r of runs) {
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    const cx = (r.a[0] + r.b[0]) / 2;
    const cz = (r.a[1] + r.b[1]) / 2;
    const alongX = r.n[0] === 0;
    const sx = alongX ? len : WALL;
    const sz = alongX ? WALL : len;
    const ox = -r.n[0] * (WALL / 2);
    const oz = -r.n[1] * (WALL / 2);
    b.box(wall, cx + ox, H / 2, cz + oz, sx, H, sz, 1.6);
    col.box(cx + ox, cz + oz, sx, sz, 0, H);
    // wainscot, chair rail, baseboard and crown, stepping proud of the wall face
    const layer = (y0: number, y1: number, depth: number, mat: THREE.Material, uv?: number) => {
      const d = depth;
      b.box(mat, cx + r.n[0] * (d / 2), (y0 + y1) / 2, cz + r.n[1] * (d / 2), alongX ? len : d, y1 - y0, alongX ? d : len, uv);
    };
    layer(0, 1.12, 0.04, wains, 2.2);
    layer(1.1, 1.16, 0.07, brass);
    layer(0, 0.14, 0.06, lacquer);
    layer(H - 0.16, H, 0.1, wood, 1.5);
    layer(H - 0.19, H - 0.16, 0.12, brass);
  }
  // door surround: a lintel over the opening
  b.box(wall, 0, (plan.door.height + H) / 2, R.z1 + WALL / 2, plan.door.x1 - plan.door.x0, H - plan.door.height, WALL, 1.6);
  b.box(brass, 0, plan.door.height + 0.05, R.z1 - 0.03, plan.door.x1 - plan.door.x0 + 0.3, 0.1, 0.08);
  for (const x of [plan.door.x0 - 0.1, plan.door.x1 + 0.1]) b.box(brass, x, plan.door.height / 2, R.z1 - 0.03, 0.14, plan.door.height, 0.08);
  col.box(0, R.z1 + 0.35, plan.door.x1 - plan.door.x0, 0.5, 0, H);

  // --- the low ceiling, with a hole over the pit ---------------------------------------------
  const P = plan.pit;
  const ceil = m.get('ceiling');
  const under = (r: Rect) => {
    if (r.x1 - r.x0 < 0.01 || r.z1 - r.z0 < 0.01) return;
    const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
    b.add(g, ceil, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation((r.x0 + r.x1) / 2, H, (r.z0 + r.z1) / 2)), 2.4);
  };
  under({ x0: R.x0, x1: R.x1, z0: R.z0, z1: P.z0 });
  under({ x0: R.x0, x1: R.x1, z0: P.z1, z1: R.z1 });
  under({ x0: R.x0, x1: P.x0, z0: P.z0, z1: P.z1 });
  under({ x0: P.x1, x1: R.x1, z0: P.z0, z1: P.z1 });

  // recessed downlights on a 2.4 m grid, trimmed in brass
  const disc = new THREE.CircleGeometry(0.06, 16);
  const ring = new THREE.RingGeometry(0.06, 0.1, 20);
  const downlights: [number, number][] = [];
  for (let x = R.x0 + 1.4; x < R.x1 - 1; x += 2.4) {
    for (let z = R.z0 + 1.3; z < R.z1 - 1; z += 2.4) {
      if (inRect(P, x, z, 0.5)) continue;
      const at = new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, H - 0.004, z));
      glow.add(disc, GLOW.bulb, at);
      b.add(ring, brass, at);
      downlights.push([x, z]);
    }
  }

  // --- the pit: fascia rising to the coffered ceiling, washed by a hidden cove ---------------
  const fascia = m.get('fascia');
  const PH = PIT_CEILING;
  const sides: { cx: number; cz: number; len: number; ry: number; n: [number, number] }[] = [
    { cx: (P.x0 + P.x1) / 2, cz: P.z0, len: P.x1 - P.x0, ry: 0, n: [0, 1] },
    { cx: (P.x0 + P.x1) / 2, cz: P.z1, len: P.x1 - P.x0, ry: Math.PI, n: [0, -1] },
    { cx: P.x0, cz: (P.z0 + P.z1) / 2, len: P.z1 - P.z0, ry: Math.PI / 2, n: [1, 0] },
    { cx: P.x1, cz: (P.z0 + P.z1) / 2, len: P.z1 - P.z0, ry: -Math.PI / 2, n: [-1, 0] },
  ];
  for (const s of sides) {
    b.add(new THREE.PlaneGeometry(s.len, PH - H), fascia, { x: s.cx, y: (H + PH) / 2, z: s.cz, ry: s.ry });
    // the cove lip: a wood ledge with a brass edge; the LED strip hides on top of it
    const lipD = 0.42;
    const lx = s.cx + s.n[0] * (lipD / 2);
    const lz = s.cz + s.n[1] * (lipD / 2);
    const along = s.n[1] !== 0;
    b.box(wood, lx, H - 0.05, lz, along ? s.len + lipD * 2 : lipD, 0.16, along ? lipD : s.len + lipD * 2, 1.5);
    const ex = s.cx + s.n[0] * (lipD + 0.01);
    const ez = s.cz + s.n[1] * (lipD + 0.01);
    b.box(brass, ex, H - 0.05, ez, along ? s.len + lipD * 2 : 0.025, 0.05, along ? 0.025 : s.len + lipD * 2);
    const gx = s.cx + s.n[0] * 0.12;
    const gz = s.cz + s.n[1] * 0.12;
    glow.box(GLOW.warm, gx, H + 0.045, gz, along ? s.len : 0.05, 0.03, along ? 0.05 : s.len);
  }
  // coffer grid sized so a whole number of coffers spans the pit
  const pw = P.x1 - P.x0;
  const pd = P.z1 - P.z0;
  const nx = Math.max(3, Math.round(pw / 2.3));
  const nz = Math.max(2, Math.round(pd / 2.3));
  const top = new THREE.PlaneGeometry(pw, pd);
  const uv = top.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * nx, uv.getY(i) * nz);
  b.add(top, m.get('ceiling-pit'), new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation((P.x0 + P.x1) / 2, PH, (P.z0 + P.z1) / 2)));
  const beamH = 0.34;
  const beamW = 0.26;
  for (let i = 0; i <= nx; i++) {
    const x = P.x0 + (i * pw) / nx;
    b.box(wood, x, PH - beamH / 2, (P.z0 + P.z1) / 2, beamW, beamH, pd, 1.5);
    b.box(brass, x, PH - beamH - 0.005, (P.z0 + P.z1) / 2, 0.07, 0.01, pd);
  }
  for (let j = 0; j <= nz; j++) {
    const z = P.z0 + (j * pd) / nz;
    b.box(wood, (P.x0 + P.x1) / 2, PH - beamH / 2, z, pw, beamH, beamW, 1.5);
    b.box(brass, (P.x0 + P.x1) / 2, PH - beamH - 0.005, z, pw, 0.01, 0.07);
  }

  // --- columns -------------------------------------------------------------------------------
  const marble = m.get('marble-black');
  for (const c of plan.columns) {
    const h = CEILING;
    b.add(new THREE.CylinderGeometry(c.r + 0.1, c.r + 0.12, 0.16, 24), marble, { x: c.x, y: 0.08, z: c.z });
    b.add(new THREE.CylinderGeometry(c.r + 0.04, c.r + 0.1, 0.1, 24), brass, { x: c.x, y: 0.2, z: c.z });
    b.add(new THREE.CylinderGeometry(c.r, c.r, h - 0.55, 24, 1, true), marble, { x: c.x, y: 0.25 + (h - 0.55) / 2, z: c.z });
    for (const y of [1.15, h - 0.62]) b.add(new THREE.TorusGeometry(c.r + 0.012, 0.028, 8, 32), brass, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(c.x, y, c.z)));
    // flared brass capital meeting the ceiling
    b.add(new THREE.CylinderGeometry(c.r + 0.03, c.r + 0.03, 0.12, 24, 1, true), brass, { x: c.x, y: h - 0.06, z: c.z });
    col.post(c.x, c.z, c.r + 0.1, CEILING);
  }

  // chandeliers in every other coffer of the row over the staff area
  const chandeliers: THREE.Vector3[] = [];
  const cw = pw / nx;
  const cd = pd / nz;
  const midZ = (plan.staff.z0 + plan.staff.z1) / 2;
  const j = Math.max(0, Math.min(nz - 1, Math.floor((midZ - P.z0) / cd)));
  for (let i = nx % 2 ? 0 : 1; i < nx; i += 2) chandeliers.push(new THREE.Vector3(P.x0 + (i + 0.5) * cw, PH - 0.02, P.z0 + (j + 0.5) * cd));
  void W;
  void D;
  return { chandeliers, downlights };
}
