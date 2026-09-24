// The built-in furniture of the floor, drawn in code: slot bank islands (plinth, LED underglow,
// end caps, topper), the bar (counter, foot rail, back bar with lit shelves and a mirror, pendant
// lamps), the cashier cage, the pit podium, planters and the lounge's coffee tables. Loose props
// (stools, couches, bottles, plants) are placed here but drawn by props.ts; sign faces are
// collected here and drawn by signs.ts. Where things stand and how big they are comes from the
// floor plan (layout.ts), which checks that none of them pass through each other.

import * as THREE from 'three';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { hdr } from './materials.ts';
import type { Collider } from './collision.ts';
import { BAR_TOP, CEILING, COFFEE_TABLE, COUCH, FLOOR_LAMP, LEAVES, LOUNGE_LAMP_X, PALM_PLANTER, PLANTER, PODIUM, STOOL, type FloorPlan } from './layout.ts';
import type { WorldStation } from './stations.ts';
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

export function buildDecor(plan: FloorPlan, stations: WorldStation[], b: Batch, m: Mats, col: Collider): Decor {
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
  const bx = bar.front + bar.depth / 2;
  const leather = m.get('leather');
  for (const [z0, z1] of bar.segments) {
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
  if (plan.vpMode === 'bartop') {
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
  // stools along the counter (and in front of bar-top video poker), cocktail glasses on the plain run
  const vpAt = new Set(plan.vpMode === 'bartop' ? vps.map((s) => s.anchor.position.z) : []);
  for (const z of bar.stools) {
    out.props.push({ kind: 'stool', x: bar.stoolX, y: 0, z, ry: Math.PI / 2, size: STOOL.h });
    col.post(bar.stoolX, z, STOOL.r, STOOL.h, { cam: false });
    if (!vpAt.has(z) && Math.round(z * 10) % 3 !== 0) out.props.push({ kind: 'glass-cocktail', x: bar.front + 0.12, y: BAR_TOP, z: z + 0.12, ry: z, size: 0.17 });
  }
  // drum pendants over the counter
  {
    const shade = new THREE.CylinderGeometry(0.19, 0.21, 0.26, 24, 1, true);
    const diffuser = new THREE.CircleGeometry(0.19, 24);
    for (const z of bar.pendants) {
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

  // --- the pit: the podium in the staff area, and the light over every table ------------------
  {
    const { x: cx, z: cz } = plan.podium;
    b.box(wood, cx, 0.52, cz, PODIUM.w - 0.1, 1.04, PODIUM.d - 0.08, 1.2);
    b.box(marble, cx, 1.06, cz, PODIUM.w, 0.04, PODIUM.d, 1.4);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8), brass, { x: cx + 0.45, y: 1.26, z: cz });
    b.add(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 16, 1, true), m.get('shade'), { x: cx + 0.45, y: 1.44, z: cz });
    col.box(cx, cz, PODIUM.w, PODIUM.d, 0, 1.1, { cam: false });
    for (const s of stations) if (s.zone === 'pit' || s.zone === 'poker' || s.zone === 'feature') out.pools.push({ x: s.anchor.position.x, z: s.anchor.position.z, r: Math.max(s.footprint.width, s.footprint.depth) * 0.6 + 0.4 });
  }

  // --- planters, palms and plants --------------------------------------------------------------
  // Walkers keep off the leaves as well as the pot: they brush the tips, never walk through.
  const planter = (x: number, z: number, r: number, h: number, reach: number) => {
    b.add(new THREE.CylinderGeometry(r, r * 0.82, h, 24), lacquer, { x, y: h / 2, z });
    b.add(new THREE.TorusGeometry(r, 0.02, 6, 28), brass, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, h, z)));
    col.post(x, z, Math.max(r, reach), h + 0.6, { cam: false });
  };
  for (const p of plan.palms) {
    planter(p.x, p.z, PALM_PLANTER.r, PALM_PLANTER.h, 1.0);
    out.props.push({ kind: 'palm', x: p.x, y: PALM_PLANTER.seat, z: p.z, ry: p.x, size: p.size });
  }
  for (const p of plan.plants) {
    planter(p.x, p.z, PLANTER.r, PLANTER.h, LEAVES[p.kind].r * p.size - 0.25);
    out.props.push({ kind: p.kind, x: p.x, y: PLANTER.seat, z: p.z, ry: p.x + p.z, size: p.size });
  }

  // --- the lounge: two couch groups round marble coffee tables --------------------------------
  for (const { x: cx, z: cz } of plan.loungeGroups) {
    out.props.push({ kind: 'couch', x: cx, y: 0, z: cz - 1.25, ry: 0, size: COUCH.w });
    out.props.push({ kind: 'couch', x: cx, y: 0, z: cz + 1.25, ry: Math.PI, size: COUCH.w });
    col.box(cx, cz - 1.25, COUCH.w, COUCH.d + 0.1, 0, 0.9, { cam: false });
    col.box(cx, cz + 1.25, COUCH.w, COUCH.d + 0.1, 0, 0.9, { cam: false });
    b.box(marble, cx, COFFEE_TABLE.h - 0.02, cz, COFFEE_TABLE.w, 0.04, COFFEE_TABLE.d, 1.4);
    for (const [dx, dz] of [[-0.55, -0.27], [0.55, -0.27], [-0.55, 0.27], [0.55, 0.27]] as const) b.box(brass, cx + dx, 0.2, cz + dz, 0.03, 0.4, 0.03);
    col.box(cx, cz, COFFEE_TABLE.w, COFFEE_TABLE.d, 0, COFFEE_TABLE.h, { cam: false });
    for (const s of [-1, 1]) {
      const x = cx - s * LOUNGE_LAMP_X;
      const z = cz + s * 1.25;
      out.props.push({ kind: 'lamp-floor', x, y: 0, z, ry: 0, size: FLOOR_LAMP.h });
      col.post(x, z, FLOOR_LAMP.r - 0.1, 1.6, { cam: false });
    }
    out.pools.push({ x: cx, z: cz, r: 2.4 });
  }

  // --- the entrance doors ----------------------------------------------------------------------
  out.props.push({ kind: 'door', x: 0, y: 0, z: plan.room.z1 + 0.05, ry: Math.PI, size: plan.door.height });
  return out;
}
