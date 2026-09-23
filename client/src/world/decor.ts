// The built-in furniture of the floor, drawn in code: slot bank islands (plinth, LED underglow,
// end caps, topper), the bar (counter, foot rail, back bar with lit shelves and a mirror, pendant
// lamps), the cashier cage, the pit podium, velvet ropes on brass stanchions, planters, and the
// lounge's coffee tables. Loose props (stools, couches, bottles, plants) are placed here but
// drawn by props.ts; sign faces are collected here and drawn by signs.ts.

import * as THREE from 'three';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { hdr } from './materials.ts';
import type { Collider } from './collision.ts';
import { CEILING, type FloorPlan } from './layout.ts';
import type { WorldStation, VpMode } from './stations.ts';
import { BAR_TOP } from './stations.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';
import type { SignSpec } from './signs.ts';

export type PropKind = 'stool' | 'couch' | 'palm' | 'plant-a' | 'plant-b' | 'lamp-floor' | 'bottle-tall' | 'bottle-red' | 'bottle-white' | 'glass-cocktail' | 'door' | 'chandelier';

export interface PropPlace {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  ry: number;
  /** Target size in metres (height, or length for couches and doors). */
  size: number;
}

export interface Decor {
  props: PropPlace[];
  signs: SignSpec[];
  /** Pendants and podium lamps, for light pools and the lighting rig. */
  pools: { x: number; z: number; r: number }[];
}

export const BANK_COLORS: Record<string, [string, string]> = {
  sevens: ['#ff3b30', '#ffcf5a'],
  neon: ['#ff2bd6', '#35a8ff'],
  wild: ['#2dff7a', '#b46bff'],
  // the new cabinets' own themes: ice blue, cherry red on gold, gold on orange
  diamonds: ['#63c6ff', '#eef7ff'],
  cherries: ['#ff3d6e', '#f2c14a'],
  goldrush: ['#f2c14a', '#ff9f2e'],
};
/** For a variant added later without its own colours: one of these, by its place in the catalogue. */
const SPARE_COLORS: [string, string][] = [
  ['#ff8a3d', '#3dd6ff'],
  ['#c77dff', '#ffe066'],
  ['#3dffc5', '#ff5c8a'],
];

function bankColors(variant: string, i: number): [string, string] {
  return BANK_COLORS[variant] ?? SPARE_COLORS[i % SPARE_COLORS.length]!;
}

const BANK_TITLES: Record<string, string> = {
  sevens: 'CLASSIC SEVENS',
  neon: 'NEON NIGHTS',
  wild: '5X WILD',
  diamonds: 'DIAMOND LINE',
  cherries: 'LUCKY CHERRIES',
  goldrush: 'GOLD RUSH',
};

/** The island's topper; a variant added later reads its catalogue name. */
function bankTitle(variant: string): string {
  return BANK_TITLES[variant] ?? (CATALOG.slots.variants.find((v) => v.id === variant)?.name ?? variant).toUpperCase();
}

export function buildDecor(plan: FloorPlan, stations: WorldStation[], vpMode: VpMode, b: Batch, m: Mats, col: Collider): Decor {
  const out: Decor = { props: [], signs: [], pools: [] };
  const brass = m.get('brass');
  const lacquer = m.get('lacquer');
  const wood = m.get('wood');
  const marble = m.get('marble-black');
  const chrome = m.get('chrome');

  // --- slot bank islands ---------------------------------------------------------------------
  for (const [bi, bank] of plan.banks.entries()) {
    const [c1, c2] = bankColors(bank.variant, bi);
    m.define1(`led-${bank.variant}`, () => new THREE.MeshBasicMaterial({ color: hdr(c1, 3.2) }));
    m.define1(`led2-${bank.variant}`, () => new THREE.MeshBasicMaterial({ color: hdr(c2, 2.6) }));
    const led = m.get(`led-${bank.variant}`);
    const led2 = m.get(`led2-${bank.variant}`);
    const at = (lx: number, y: number, lz: number) => {
      // bank-local (x along the bank, z across) to world
      const c = Math.cos(bank.yaw);
      const s = Math.sin(bank.yaw);
      return { x: bank.x + lx * c + lz * s, y, z: bank.z - lx * s + lz * c, ry: bank.yaw };
    };
    const L = bank.length;
    const Dp = bank.depth;
    const box = (lx: number, y: number, lz: number, sx: number, sy: number, sz: number, mat: THREE.Material, uv?: number) => {
      const p = at(lx, y, lz);
      b.add(new THREE.BoxGeometry(sx, sy, sz), mat, p, uv);
    };
    // plinth with a lit reveal round its foot
    box(0, 0.035, 0, L + 0.5, 0.07, Dp + 0.16, lacquer);
    box(0, 0.074, 0, L + 0.52, 0.008, Dp + 0.18, brass);
    box(0, 0.012, (Dp + 0.16) / 2 + 0.008, L + 0.5, 0.016, 0.012, led);
    box(0, 0.012, -(Dp + 0.16) / 2 - 0.008, L + 0.5, 0.016, 0.012, led);
    box((L + 0.5) / 2 + 0.008, 0.012, 0, 0.012, 0.016, Dp + 0.16, led);
    box(-(L + 0.5) / 2 - 0.008, 0.012, 0, 0.012, 0.016, Dp + 0.16, led);
    // spine between the back-to-back machines
    box(0, 0.75, 0, L, 1.36, 0.16, lacquer);
    box(0, 1.44, 0, L + 0.02, 0.03, 0.2, brass);
    // end caps with vertical light bars
    for (const e of [-1, 1]) {
      // black lacquer frame, a red inset panel edged in brass, light bars down both corners
      box(e * (L / 2 + 0.12), 0.98, 0, 0.2, 1.84, Dp + 0.02, lacquer);
      box(e * (L / 2 + 0.225), 0.98, 0, 0.01, 1.4, Dp - 0.5, m.get('lacquer-red'));
      box(e * (L / 2 + 0.228), 0.98, (Dp - 0.5) / 2, 0.012, 1.42, 0.02, brass);
      box(e * (L / 2 + 0.228), 0.98, -(Dp - 0.5) / 2, 0.012, 1.42, 0.02, brass);
      box(e * (L / 2 + 0.228), 0.98 + 0.71, 0, 0.012, 0.02, Dp - 0.48, brass);
      box(e * (L / 2 + 0.228), 0.98 - 0.71, 0, 0.012, 0.02, Dp - 0.48, brass);
      for (const side of [-1, 1]) box(e * (L / 2 + 0.12), 0.98, side * (Dp / 2 + 0.018), 0.05, 1.6, 0.014, led2);
      box(e * (L / 2 + 0.12), 1.91, 0, 0.24, 0.03, Dp + 0.06, brass);
    }
    // topper: a sign box on a chrome mast above the spine
    const mast = at(0, 1.9, 0);
    b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 12), chrome, mast);
    const topY = 2.62;
    const tw = Math.min(Math.max(L * 0.9, 1.6), 3.2);
    box(0, topY, 0, tw + 0.12, 0.6, 0.18, lacquer);
    box(0, topY + 0.31, 0, tw + 0.16, 0.025, 0.22, brass);
    box(0, topY - 0.31, 0, tw + 0.16, 0.025, 0.22, brass);
    for (const side of [1, -1]) {
      const p = at(0, topY, side * 0.095);
      out.signs.push({ kind: 'neon', text: bankTitle(bank.variant), color: c1, font: 'Tilt Neon', at: [p.x, p.y, p.z], ry: bank.yaw + (side > 0 ? 0 : Math.PI), w: tw, h: 0.5 });
    }
    col.box(bank.x, bank.z, L + 0.62, Dp + 0.2, bank.yaw, 1.95);
    out.pools.push({ x: bank.x, z: bank.z, r: Math.max(L, Dp) * 0.9 + 1.2 });
  }

  // --- the bar -------------------------------------------------------------------------------
  const bar = plan.bar;
  const vps = stations.filter((s) => s.game === 'videopoker');
  const gaps: [number, number][] = vpMode === 'floor' ? vps.map((s) => [s.anchor.position.z - s.footprint.width / 2 - 0.04, s.anchor.position.z + s.footprint.width / 2 + 0.04]) : [];
  const segs: [number, number][] = [];
  {
    let z = bar.z0;
    for (const [a, c] of gaps.sort((p, q) => p[0] - q[0])) {
      if (a > z + 0.05) segs.push([z, a]);
      z = Math.max(z, c);
    }
    if (bar.z1 > z + 0.05) segs.push([z, bar.z1]);
  }
  const bx = bar.front + bar.depth / 2;
  const leather = m.get('leather');
  for (const [z0, z1] of segs) {
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    b.box(wood, bx, 0.53, zc, bar.depth, 1.02, len, 1.2);
    b.box(lacquer, bar.front + 0.05, 0.06, zc, 0.12, 0.12, len);
    b.box(marble, bx - 0.05, BAR_TOP - 0.025, zc, bar.depth + 0.18, 0.05, len + 0.06, 1.4);
    b.add(new THREE.CylinderGeometry(0.045, 0.045, len, 10), leather, { x: bar.front - 0.1, y: BAR_TOP + 0.02, z: zc, rx: Math.PI / 2 });
    b.add(new THREE.CylinderGeometry(0.022, 0.022, len, 10), brass, { x: bar.front - 0.24, y: 0.2, z: zc, rx: Math.PI / 2 });
    for (let z = z0 + 0.3; z < z1 - 0.1; z += 1.2) b.box(brass, bar.front - 0.12, 0.2, z, 0.24, 0.03, 0.03);
    // warm light under the top's overhang
    b.box(m.get('glow-shelf'), bar.front - 0.1, BAR_TOP - 0.06, zc, 0.03, 0.012, len);
    col.box(bx, zc, bar.depth + 0.3, len, 0, BAR_TOP + 0.05, { cam: false });
  }
  // returns closing the bartenders' side at both ends
  for (const z of [bar.z0, bar.z1]) {
    const x0 = bar.front + bar.depth;
    const x1 = bar.back;
    b.box(wood, (x0 + x1) / 2, 0.53, z, x1 - x0, 1.02, 0.12, 1.2);
    b.box(marble, (x0 + x1) / 2, BAR_TOP - 0.025, z, x1 - x0, 0.05, 0.2, 1.4);
    col.box((x0 + x1) / 2, z, x1 - x0, 0.3, 0, BAR_TOP, { cam: false });
  }
  if (vpMode === 'bartop') {
    for (const s of vps) col.box(s.anchor.position.x, s.anchor.position.z, 0.3, s.footprint.width, 0, BAR_TOP, { cam: false });
  }
  // back bar: cabinet, mirror, three lit glass shelves of bottles, and a crown for the sign
  {
    const x0 = bar.back;
    const x1 = plan.room.x1;
    const zc = (bar.z0 + bar.z1) / 2;
    const len = bar.z1 - bar.z0 - 0.3;
    b.box(wood, (x0 + x1) / 2, 0.48, zc, x1 - x0, 0.96, len, 1.2);
    b.box(marble, (x0 + x1) / 2 - 0.02, 0.98, zc, x1 - x0 + 0.04, 0.04, len + 0.04, 1.4);
    b.add(new THREE.PlaneGeometry(len, 1.8), m.get('mirror'), { x: x1 - 0.012, y: 1.95, z: zc, ry: -Math.PI / 2 });
    const kinds: PropKind[] = ['bottle-red', 'bottle-white', 'bottle-tall', 'bottle-red', 'bottle-tall', 'bottle-white'];
    let k = 0;
    for (const y of [1.34, 1.78, 2.22]) {
      b.box(chrome, x1 - 0.2, y, zc, 0.34, 0.018, len);
      b.box(m.get('glow-shelf'), x1 - 0.36, y - 0.016, zc, 0.012, 0.01, len);
      for (let z = bar.z0 + 0.35; z < bar.z1 - 0.35; z += 0.16) {
        const kind = kinds[k++ % kinds.length]!;
        out.props.push({ kind, x: x1 - 0.2 + ((k * 7) % 3) * 0.04 - 0.04, y: y + 0.01, z, ry: (k * 1.3) % 6.28, size: kind === 'bottle-tall' ? 0.34 : 0.3 });
      }
    }
    b.box(wood, (x0 + x1) / 2, (2.95 + CEILING) / 2, zc, x1 - x0 + 0.1, CEILING - 2.95, len + 0.1, 1.2);
    b.box(brass, x0 - 0.02, 2.93, zc, 0.04, 0.04, len + 0.1);
    col.box((x0 + x1) / 2, zc, x1 - x0, len, 0, CEILING);
    out.signs.push({ kind: 'neon', text: 'BAR', sub: 'COCKTAILS · WINE · SPIRITS', color: '#3fe0d0', font: 'Limelight', at: [x0 - 0.06, 3.17, zc], ry: -Math.PI / 2, w: 3.0, h: 0.46 });
  }
  // cocktail glasses along the counter, stools in front of the plain run
  for (const z of bar.stools) {
    out.props.push({ kind: 'stool', x: bar.front - 0.5, y: 0, z, ry: Math.PI / 2, size: 0.8 });
    col.post(bar.front - 0.5, z, 0.2, 0.8, { cam: false });
    if (Math.round(z * 10) % 3 !== 0) out.props.push({ kind: 'glass-cocktail', x: bar.front + 0.12, y: BAR_TOP, z: z + 0.12, ry: z, size: 0.17 });
  }
  if (vpMode === 'bartop') {
    for (const s of vps) {
      out.props.push({ kind: 'stool', x: bar.front - 0.5, y: 0, z: s.anchor.position.z, ry: Math.PI / 2, size: 0.8 });
      col.post(bar.front - 0.5, s.anchor.position.z, 0.2, 0.8, { cam: false });
    }
  }
  // drum pendants over the counter
  {
    const shade = new THREE.CylinderGeometry(0.19, 0.21, 0.26, 24, 1, true);
    const diffuser = new THREE.CircleGeometry(0.19, 24);
    for (let z = bar.z0 + 0.9; z < bar.z1 - 0.5; z += 1.9) {
      const x = bar.front + bar.depth / 2 - 0.1;
      b.add(shade, m.get('shade'), { x, y: 2.28, z });
      b.add(diffuser, m.get('glow-soft'), new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, 2.16, z)));
      b.add(new THREE.CylinderGeometry(0.006, 0.006, CEILING - 2.41, 6), chrome, { x, y: (CEILING + 2.41) / 2, z });
      b.add(new THREE.TorusGeometry(0.2, 0.012, 6, 24), brass, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, 2.41, z)));
      out.pools.push({ x: x - 0.5, z, r: 1.3 });
    }
  }

  // --- cashier cage --------------------------------------------------------------------------
  {
    const c = plan.cashier.counter;
    const cx = (c.x0 + c.x1) / 2;
    const zf = c.z1 - 0.32;
    const width = c.x1 - c.x0;
    b.box(wood, cx, 0.55, c.z1 - 0.32, width, 1.1, 0.64, 1.2);
    b.box(marble, cx, 1.12, c.z1 - 0.3, width + 0.04, 0.05, 0.72, 1.4);
    b.box(brass, cx, 1.02, c.z1 + 0.012, width, 0.03, 0.02);
    // the cage front: brass bars with two teller windows
    const windows = [plan.cashier.x - 1.0, plan.cashier.x + 1.0];
    const bar1 = new THREE.CylinderGeometry(0.009, 0.009, 1, 6);
    const cage = m.get('cage');
    for (let x = c.x0 + 0.08; x < c.x1 - 0.04; x += 0.11) {
      const inWin = windows.some((w) => Math.abs(x - w) < 0.42);
      const y0 = inWin ? 1.86 : 1.16;
      const y1 = 2.62;
      const g = bar1.clone();
      g.scale(1, y1 - y0, 1);
      b.add(g, cage, { x, y: (y0 + y1) / 2, z: zf });
    }
    for (const y of [1.16, 1.86, 2.62]) b.box(cage, cx, y, zf, width, 0.035, 0.035);
    for (const w of windows) {
      b.box(cage, w - 0.43, 1.5, zf, 0.04, 0.72, 0.05);
      b.box(cage, w + 0.43, 1.5, zf, 0.04, 0.72, 0.05);
      b.box(m.get('glow-soft'), w, 1.84, zf - 0.03, 0.8, 0.02, 0.02);
    }
    // fascia above the cage carries the sign; a side wall closes the cage off
    b.box(m.get('lacquer-red'), cx, (2.66 + CEILING) / 2, zf, width, CEILING - 2.66, 0.2);
    b.box(brass, cx, 2.66, zf + 0.11, width, 0.04, 0.03);
    b.box(m.get('wall'), c.x1 + 0.1, CEILING / 2, (plan.room.z0 + c.z1) / 2, 0.2, CEILING, c.z1 - plan.room.z0, 1.6);
    b.box(m.get('wainscot'), c.x1 + 0.21, 0.56, (plan.room.z0 + c.z1) / 2, 0.02, 1.12, c.z1 - plan.room.z0, 2.2);
    // warm light inside the cage, seen through the bars
    b.box(m.get('glow-shelf'), cx, 2.5, plan.room.z0 + 0.1, width, 0.03, 0.03);
    col.box(cx + 0.1, (plan.room.z0 + c.z1) / 2, width + 0.2, c.z1 - plan.room.z0, 0, CEILING);
    out.signs.push({ kind: 'lit', text: 'CASHIER', color: '#ffe2a8', font: 'Cinzel', at: [cx, (2.66 + CEILING) / 2, zf + 0.105], ry: 0, w: Math.min(width - 0.6, 3.6), h: 0.5 });
    out.pools.push({ x: plan.cashier.x, z: c.z1 + 0.6, r: 2.2 });
  }

  // --- the pit: podium in the staff area, ropes closing the gaps between tables ---------------
  {
    const st = plan.staff;
    const cx = (st.x0 + st.x1) / 2;
    const cz = (st.z0 + st.z1) / 2;
    b.box(wood, cx, 0.52, cz, 1.3, 1.04, 0.56, 1.2);
    b.box(marble, cx, 1.06, cz, 1.4, 0.04, 0.64, 1.4);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8), brass, { x: cx + 0.45, y: 1.26, z: cz });
    b.add(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 16, 1, true), m.get('shade'), { x: cx + 0.45, y: 1.44, z: cz });
    for (const row of ['north', 'south'] as const) {
      const tables = stations
        .filter((s) => s.zone === 'pit' && (row === 'north' ? s.yaw !== 0 : s.yaw === 0))
        .sort((p, q) => p.anchor.position.x - q.anchor.position.x);
      const z = row === 'north' ? st.z0 + 0.05 : st.z1 - 0.05;
      for (let i = 0; i + 1 < tables.length; i++) {
        const a = tables[i]!;
        const c = tables[i + 1]!;
        const xa = a.anchor.position.x + a.footprint.width / 2 - 0.15;
        const xc = c.anchor.position.x - c.footprint.width / 2 + 0.15;
        if (xc - xa > 0.3) plan.ropes.push({ points: [[xa, z], [xc, z]] });
      }
    }
    for (const s of stations) if (s.zone === 'pit' || s.zone === 'poker' || s.zone === 'feature') out.pools.push({ x: s.anchor.position.x, z: s.anchor.position.z, r: Math.max(s.footprint.width, s.footprint.depth) * 0.6 + 0.4 });
  }

  // --- velvet ropes --------------------------------------------------------------------------
  const velvet = m.get('velvet');
  const baseG = new THREE.CylinderGeometry(0.13, 0.16, 0.035, 20);
  const poleG = new THREE.CylinderGeometry(0.022, 0.022, 0.9, 10);
  const ballG = new THREE.SphereGeometry(0.042, 12, 8);
  for (const r of plan.ropes) {
    const posts: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = new THREE.Vector2(...r.points[i]!);
      const c = new THREE.Vector2(...r.points[i + 1]!);
      const n = Math.max(1, Math.ceil(a.distanceTo(c) / 2.0));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) posts.push(a.clone().lerp(c, k / n));
      const mid = a.clone().add(c).multiplyScalar(0.5);
      col.box(mid.x, mid.y, Math.max(0.1, Math.abs(c.x - a.x)), Math.max(0.1, Math.abs(c.y - a.y)), 0, 0.95, { cam: false });
    }
    for (const p of posts) {
      b.add(baseG, brass, { x: p.x, y: 0.018, z: p.y });
      b.add(poleG, brass, { x: p.x, y: 0.48, z: p.y });
      b.add(ballG, brass, { x: p.x, y: 0.96, z: p.y });
    }
    for (let i = 0; i + 1 < posts.length; i++) {
      const a = posts[i]!;
      const c = posts[i + 1]!;
      const pts: THREE.Vector3[] = [];
      for (let t = 0; t <= 1.0001; t += 0.125) {
        const sag = 0.13 * 4 * t * (1 - t);
        pts.push(new THREE.Vector3(a.x + (c.x - a.x) * t, 0.86 - sag, a.y + (c.y - a.y) * t));
      }
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.02, 6, false), velvet, new THREE.Matrix4());
    }
  }

  // --- planters, palms and plants --------------------------------------------------------------
  const planter = (x: number, z: number, r: number, h: number) => {
    b.add(new THREE.CylinderGeometry(r, r * 0.82, h, 24), lacquer, { x, y: h / 2, z });
    b.add(new THREE.TorusGeometry(r, 0.02, 6, 28), brass, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, h, z)));
    col.post(x, z, r, h + 0.6, { cam: false });
  };
  for (const [x, z] of plan.palms) {
    planter(x, z, 0.5, 0.62);
    out.props.push({ kind: 'palm', x, y: 0.55, z, ry: x, size: 3.1 });
  }
  for (const [x, z, k] of plan.plants) {
    planter(x, z, 0.32, 0.46);
    out.props.push({ kind: k ? 'plant-b' : 'plant-a', x, y: 0.42, z, ry: x + z, size: 1.1 });
  }

  // --- the lounge: two couch groups round marble coffee tables --------------------------------
  {
    const L = plan.lounge;
    const groups = L.z1 - L.z0 > 6.5 ? [L.z0 + 2.2, L.z1 - 2.3] : [(L.z0 + L.z1) / 2];
    const cx = (L.x0 + L.x1) / 2;
    for (const cz of groups) {
      out.props.push({ kind: 'couch', x: cx, y: 0, z: cz - 1.25, ry: 0, size: 2.2 });
      out.props.push({ kind: 'couch', x: cx, y: 0, z: cz + 1.25, ry: Math.PI, size: 2.2 });
      col.box(cx, cz - 1.3, 2.2, 0.9, 0, 0.9, { cam: false });
      col.box(cx, cz + 1.3, 2.2, 0.9, 0, 0.9, { cam: false });
      b.box(marble, cx, 0.42, cz, 1.3, 0.04, 0.7, 1.4);
      for (const [dx, dz] of [[-0.55, -0.27], [0.55, -0.27], [-0.55, 0.27], [0.55, 0.27]] as const) b.box(brass, cx + dx, 0.2, cz + dz, 0.03, 0.4, 0.03);
      col.box(cx, cz, 1.3, 0.7, 0, 0.45, { cam: false });
      out.props.push({ kind: 'lamp-floor', x: cx + 1.5, y: 0, z: cz - 1.25, ry: 0, size: 1.45 });
      out.props.push({ kind: 'lamp-floor', x: cx - 1.5, y: 0, z: cz + 1.25, ry: 0, size: 1.45 });
      col.post(cx + 1.45, cz - 1.25, 0.2, 1.6, { cam: false });
      col.post(cx - 1.45, cz + 1.25, 0.2, 1.6, { cam: false });
      out.pools.push({ x: cx, z: cz, r: 2.4 });
    }
  }

  // --- the entrance doors ----------------------------------------------------------------------
  out.props.push({ kind: 'door', x: 0, y: 0, z: plan.room.z1 + 0.05, ry: Math.PI, size: plan.door.height });
  return out;
}
