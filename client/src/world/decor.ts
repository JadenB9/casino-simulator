// The built-in furniture of the floor, drawn in code: slot bank islands (plinth, LED underglow,
// end caps, topper), the bar (counter, foot rail, back bar with lit shelves and a mirror, pendant
// lamps), the cashier's cage and the vault behind it, the boutique's counter and its lit shelves,
// the pit podium, the lounge's fireplace and coffee tables, the lamps over the poker tables, the
// yard's string of bulbs, and the planters. Loose props (stools, couches, bottles, plants) are
// placed here but drawn by props.ts, and the procedural furniture by furniture.ts; sign faces are
// collected here and drawn by signs.ts. Where things stand and how big they are comes from the
// floor plan (layout.ts), which checks that none of them pass through each other; what blocks
// walking is the plan's too (collide.ts).

import * as THREE from 'three';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { hdr } from './materials.ts';
import { GLOW, type GlowMerge } from './lighting.ts';
import { BAR_TOP, COFFEE_TABLE, COUCH, FLOOR_LAMP, LOUNGE_LAMP_X, PALM_PLANTER, PLANTER, PODIUM, STOOL, ceilingAt, planterRadius, roomAt, type FloorPlan } from './layout.ts';
import { FURNITURE } from './furniture-spec.ts';
import type { WorldStation } from './stations.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';
import type { SignSpec } from './signs.ts';
import { buildThemes } from './decor-themes.ts';

export type PropKind = 'stool' | 'couch' | 'palm' | 'plant-a' | 'plant-b' | 'lamp-floor' | 'bottle-tall' | 'bottle-red' | 'bottle-white' | 'glass-cocktail' | 'door' | 'chandelier';

export interface PropPlace {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  ry: number;
  /** Target size in metres (height, or length for couches and doors). */
  size: number;
  /** The room it stands in (hidden with it). */
  room: string;
}

export interface Decor {
  props: PropPlace[];
  signs: SignSpec[];
  /** Pendants, lamps and tables, for light pools. */
  pools: { x: number; z: number; r: number; room: string }[];
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

export function buildDecor(plan: FloorPlan, stations: WorldStation[], b: Batch, m: Mats, glow: GlowMerge): Decor {
  const out: Decor = { props: [], signs: [], pools: [] };
  const brass = m.get('brass');
  const lacquer = m.get('lacquer');
  const wood = m.get('wood');
  const marble = m.get('marble-black');
  const chrome = m.get('chrome');
  const roomOf = (x: number, z: number) => roomAt(plan, x, z)?.id ?? 'pit';
  const into = (room: string) => {
    b.room = room;
    glow.room = room;
  };

  // --- slot bank islands ---------------------------------------------------------------------
  for (const [bi, bank] of plan.banks.entries()) {
    const room = roomOf(bank.x, bank.z);
    into(room);
    const [c1, c2] = bankColors(bank.variant, bi);
    const led = hdr(c1, 3.2);
    const led2 = hdr(c2, 2.6);
    const at = (lx: number, y: number, lz: number) => {
      // bank-local (x along the bank, z across) to world
      const c = Math.cos(bank.yaw);
      const s = Math.sin(bank.yaw);
      return { x: bank.x + lx * c + lz * s, y, z: bank.z - lx * s + lz * c, ry: bank.yaw };
    };
    const L = bank.length;
    const Dp = bank.depth;
    const box = (lx: number, y: number, lz: number, sx: number, sy: number, sz: number, mat: THREE.Material | THREE.Color, uv?: number) => {
      const p = at(lx, y, lz);
      if (mat instanceof THREE.Color) glow.add(new THREE.BoxGeometry(sx, sy, sz), mat, p);
      else b.add(new THREE.BoxGeometry(sx, sy, sz), mat, p, uv);
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
    out.pools.push({ x: bank.x, z: bank.z, r: Math.max(L, Dp) * 0.9 + 1.2, room });
  }

  // --- the bar -------------------------------------------------------------------------------
  const bar = plan.bar;
  const vps = stations.filter((s) => s.game === 'videopoker');
  if (bar.z1 > bar.z0) {
    const room = roomOf(bar.front, (bar.z0 + bar.z1) / 2);
    into(room);
    const bx = bar.front + bar.depth / 2;
    const leather = m.get('leather');
    for (const [z0, z1] of bar.segments) {
      const len = z1 - z0;
      const zc = (z0 + z1) / 2;
      b.box(wood, bx, 0.53, zc, bar.depth, 1.02, len, 1.2);
      // the kick plate stops short of the counter's ends, so its ends never share their plane
      b.box(lacquer, bar.front + 0.05, 0.06, zc, 0.12, 0.12, len - 0.01);
      b.box(marble, bx - 0.05, BAR_TOP - 0.025, zc, bar.depth + 0.18, 0.05, len + 0.06, 1.4);
      b.add(new THREE.CylinderGeometry(0.045, 0.045, len, 10), leather, { x: bar.front - 0.1, y: BAR_TOP + 0.02, z: zc, rx: Math.PI / 2 });
      b.add(new THREE.CylinderGeometry(0.022, 0.022, len, 10), brass, { x: bar.front - 0.24, y: 0.2, z: zc, rx: Math.PI / 2 });
      for (let z = z0 + 0.3; z < z1 - 0.1; z += 1.2) b.box(brass, bar.front - 0.12, 0.2, z, 0.24, 0.03, 0.03);
      // warm light under the top's overhang
      glow.box(GLOW.shelf, bar.front - 0.1, BAR_TOP - 0.06, zc, 0.03, 0.012, len);
    }
    // returns closing the bartenders' side at both ends
    for (const z of [bar.z0, bar.z1]) {
      const x0 = bar.front + bar.depth;
      const x1 = bar.back;
      // up to the marble's underside (a centimetre into it, their ends would share a plane)
      b.box(wood, (x0 + x1) / 2, 0.515, z, x1 - x0, 1.03, 0.12, 1.2);
      b.box(marble, (x0 + x1) / 2, BAR_TOP - 0.025, z, x1 - x0, 0.05, 0.2, 1.4);
    }
    // back bar: cabinet, mirror, three lit glass shelves of bottles, and a crown for the sign
    {
      const x0 = bar.back;
      const x1 = bar.wall;
      const zc = (bar.z0 + bar.z1) / 2;
      const len = bar.z1 - bar.z0 - 0.3;
      const top = ceilingAt(plan, x0, zc);
      b.box(wood, (x0 + x1) / 2, 0.48, zc, x1 - x0, 0.96, len, 1.2);
      b.box(marble, (x0 + x1) / 2 - 0.02, 0.98, zc, x1 - x0 + 0.04, 0.04, len + 0.04, 1.4);
      b.add(new THREE.PlaneGeometry(len, 1.8), m.get('mirror'), { x: x1 - 0.012, y: 1.95, z: zc, ry: -Math.PI / 2 });
      const kinds: PropKind[] = ['bottle-red', 'bottle-white', 'bottle-tall', 'bottle-red', 'bottle-tall', 'bottle-white'];
      let k = 0;
      for (const y of [1.34, 1.78, 2.22]) {
        b.box(chrome, x1 - 0.2, y, zc, 0.34, 0.018, len);
        glow.box(GLOW.shelf, x1 - 0.36, y - 0.016, zc, 0.012, 0.01, len);
        for (let z = bar.z0 + 0.35; z < bar.z1 - 0.35; z += 0.16) {
          const kind = kinds[k++ % kinds.length]!;
          out.props.push({ kind, x: x1 - 0.2 + ((k * 7) % 3) * 0.04 - 0.04, y: y + 0.01, z, ry: (k * 1.3) % 6.28, size: kind === 'bottle-tall' ? 0.34 : 0.3, room });
        }
      }
      b.box(wood, (x0 + x1) / 2, (2.95 + top) / 2, zc, x1 - x0 + 0.1, top - 2.95, len + 0.1, 1.2);
      b.box(brass, x0 - 0.02, 2.93, zc, 0.04, 0.04, len + 0.1);
      out.signs.push({ kind: 'neon', text: 'BAR', sub: 'COCKTAILS · WINE · SPIRITS', color: '#3fe0d0', font: 'Limelight', at: [x0 - 0.06, Math.min(3.17, top - 0.28), zc], ry: -Math.PI / 2, w: 3.0, h: 0.46 });
    }
    // stools along the counter (and in front of bar-top video poker), cocktail glasses on the plain run
    const vpAt = new Set(plan.vpMode === 'bartop' ? vps.map((s) => s.anchor.position.z) : []);
    for (const z of bar.stools) {
      out.props.push({ kind: 'stool', x: bar.stoolX, y: 0, z, ry: Math.PI / 2, size: STOOL.h, room });
      if (!vpAt.has(z) && Math.round(z * 10) % 3 !== 0) out.props.push({ kind: 'glass-cocktail', x: bar.front + 0.12, y: BAR_TOP, z: z + 0.12, ry: z, size: 0.17, room });
    }
    // drum pendants over the counter
    const shade = new THREE.CylinderGeometry(0.19, 0.21, 0.26, 24, 1, true);
    const diffuser = new THREE.CircleGeometry(0.19, 24);
    for (const z of bar.pendants) {
      const x = bar.front + bar.depth / 2 - 0.1;
      const top = ceilingAt(plan, x, z);
      b.add(shade, m.get('shade'), { x, y: 2.28, z });
      glow.add(diffuser, GLOW.soft, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, 2.16, z)));
      b.add(new THREE.CylinderGeometry(0.006, 0.006, top - 2.41, 6), chrome, { x, y: (top + 2.41) / 2, z });
      b.add(new THREE.TorusGeometry(0.2, 0.012, 6, 24), brass, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, 2.41, z)));
      out.pools.push({ x: x - 0.5, z, r: 1.3, room });
    }
  }

  // --- the cashier's cage --------------------------------------------------------------------
  const cage = plan.cashier;
  if (cage.counter.x1 > cage.counter.x0) {
    const c = cage.counter;
    const room = roomOf(cage.x, cage.z);
    into(room);
    const cx = (c.x0 + c.x1) / 2;
    const zf = c.z1 - 0.32;
    const width = c.x1 - c.x0;
    const top = ceilingAt(plan, cage.x, cage.z);
    b.box(wood, cx, 0.55, c.z1 - 0.32, width, 1.1, 0.64, 1.2);
    b.box(marble, cx, 1.12, c.z1 - 0.3, width + 0.04, 0.05, 0.72, 1.4);
    b.box(brass, cx, 1.02, c.z1 + 0.012, width, 0.03, 0.02);
    // the cage front: brass bars with a teller window at each banker
    const bar1 = new THREE.CylinderGeometry(0.009, 0.009, 1, 6);
    const cageM = m.get('cage');
    for (let x = c.x0 + 0.08; x < c.x1 - 0.04; x += 0.11) {
      const inWin = cage.windows.some((w) => Math.abs(x - w) < 0.42);
      const y0 = inWin ? 1.86 : 1.16;
      const y1 = 2.62;
      const g = bar1.clone();
      g.scale(1, y1 - y0, 1);
      b.add(g, cageM, { x, y: (y0 + y1) / 2, z: zf });
    }
    for (const y of [1.16, 1.86, 2.62]) b.box(cageM, cx, y, zf, width, 0.035, 0.035);
    for (const w of cage.windows) {
      b.box(cageM, w - 0.43, 1.5, zf, 0.04, 0.72, 0.05);
      b.box(cageM, w + 0.43, 1.5, zf, 0.04, 0.72, 0.05);
      glow.box(GLOW.soft, w, 1.84, zf - 0.03, 0.8, 0.02, 0.02);
      // a brass number plate over each window
      b.box(brass, w, 1.97, zf + 0.03, 0.26, 0.1, 0.012);
      out.pools.push({ x: w, z: c.z1 + 0.6, r: 1.4, room });
    }
    // fascia above the cage carries the sign; warm light inside it, seen through the bars
    b.box(m.get('lacquer-red'), cx, (2.66 + top) / 2, zf, width, top - 2.66, 0.2);
    b.box(brass, cx, 2.66, zf + 0.11, width, 0.04, 0.03);
    // warm light inside the cage over each window, seen through the bars
    for (const w of cage.windows) glow.box(GLOW.soft, w, 2.5, c.z0 + 0.12, 1.6, 0.025, 0.03);
    out.signs.push({ kind: 'lit', text: 'CASHIER', color: '#ffe2a8', font: 'Cinzel', at: [cx, (2.66 + top) / 2, zf + 0.105], ry: 0, w: Math.min(width - 0.6, 3.6), h: 0.5 });
  }
  for (const v of plan.vaults) {
    // the vault's round steel door in the back wall behind the tellers, its wheel and bolts
    into(v.room);
    const steel = m.get('steel');
    const z = v.z + 0.02;
    b.box(marble, v.x, 1.35, z + 0.05, 2.1, 2.2, 0.1, 1.4);
    b.add(new THREE.CylinderGeometry(0.92, 0.92, 0.14, 40), steel, { x: v.x, y: 1.35, z: z + 0.12, rx: Math.PI / 2 });
    b.add(new THREE.TorusGeometry(0.93, 0.05, 10, 48), brass, { x: v.x, y: 1.35, z: z + 0.2 });
    b.add(new THREE.TorusGeometry(0.3, 0.03, 8, 32), chrome, { x: v.x, y: 1.35, z: z + 0.26 });
    for (let k = 0; k < 6; k++) b.add(new THREE.CylinderGeometry(0.018, 0.018, 0.64, 8), chrome, { x: v.x, y: 1.35, z: z + 0.26, rz: (k * Math.PI) / 6 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 10), chrome, { x: v.x + Math.cos(a) * 0.78, y: 1.35 + Math.sin(a) * 0.78, z: z + 0.2, rx: Math.PI / 2 });
    }
  }

  // --- the boutique: its counter, and the lit shelves of hats and boxes behind it ----------------
  if (plan.boutique) {
    const k = plan.boutique.counter;
    const room = roomOf((k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2);
    into(room);
    const cx = (k.x0 + k.x1) / 2;
    const cz = (k.z0 + k.z1) / 2;
    const len = k.z1 - k.z0;
    b.box(m.get('marble-light'), cx, 0.47, cz, k.x1 - k.x0, 0.94, len, 1.2);
    b.box(brass, cx, 0.97, cz, k.x1 - k.x0 + 0.06, 0.05, len + 0.06);
    b.box(brass, k.x0 - 0.005, 0.1, cz, 0.01, 0.06, len);
    glow.box(GLOW.shelf, k.x0 - 0.02, 0.9, cz, 0.012, 0.012, len - 0.1);
    // a brass service bell on the counter's front edge, where you'd ask
    const bell = { x: k.x0 + 0.16, z: cz };
    b.add(new THREE.CylinderGeometry(0.05, 0.055, 0.012, 20), m.get('marble-black'), { x: bell.x, y: 1.001, z: bell.z });
    b.add(new THREE.SphereGeometry(0.042, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), brass, { x: bell.x, y: 1.007, z: bell.z });
    b.add(new THREE.CylinderGeometry(0.007, 0.007, 0.022, 8), brass, { x: bell.x, y: 1.056, z: bell.z });
    const x1 = plan.boutique.wall;
    const x0 = x1 - 0.36;
    b.box(wood, (x0 + x1) / 2, 1.25, cz, 0.36, 2.5, len + 0.8, 1.2);
    b.add(new THREE.PlaneGeometry(len + 0.6, 1.9), m.get('mirror'), { x: x0 - 0.004, y: 1.45, z: cz, ry: -Math.PI / 2 });
    for (const y of [1.0, 1.5, 2.0]) {
      b.box(m.get('glass'), x0 - 0.12, y, cz, 0.26, 0.012, len + 0.5);
      glow.box(GLOW.shelf, x0 - 0.02, y + 0.03, cz, 0.01, 0.01, len + 0.5);
      // boxes on the shelves: dark leather, a brass clasp
      for (let z = k.z0 + 0.1; z < k.z1 + 0.1; z += 0.55) {
        b.box(m.get('leather'), x0 - 0.13, y + 0.06, z, 0.16, 0.1, 0.2);
        b.box(brass, x0 - 0.215, y + 0.07, z, 0.005, 0.02, 0.05);
      }
    }
    out.pools.push({ x: cx - 0.6, z: cz, r: 2.0, room });
  }

  // --- the pit: the podium in the staff area, and the light over every table ------------------
  {
    into('pit');
    const { x: cx, z: cz } = plan.podium;
    b.box(wood, cx, 0.52, cz, PODIUM.w - 0.1, 1.04, PODIUM.d - 0.08, 1.2);
    b.box(marble, cx, 1.06, cz, PODIUM.w, 0.04, PODIUM.d, 1.4);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8), brass, { x: cx + 0.45, y: 1.26, z: cz });
    b.add(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 16, 1, true), m.get('shade'), { x: cx + 0.45, y: 1.44, z: cz });
    for (const s of stations) {
      if (s.zone === 'pit' || s.zone === 'poker' || s.zone === 'feature' || s.zone === 'wheel' || s.zone === 'hall') out.pools.push({ x: s.anchor.position.x, z: s.anchor.position.z, r: Math.max(s.footprint.width, s.footprint.depth) * 0.6 + 0.4, room: s.room });
    }
  }

  // --- planters, palms and plants --------------------------------------------------------------
  const soil = m.get('soil');
  const planter = (x: number, z: number, r: number, h: number) => {
    b.add(new THREE.CylinderGeometry(r, r * 0.82, h, 24), lacquer, { x, y: h / 2, z });
    b.add(new THREE.TorusGeometry(r, 0.02, 6, 28), brass, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, h, z)));
    // earth to the brim, the trunk (or the plant's own pot) standing in it
    b.add(new THREE.CircleGeometry(r - 0.012, 24), soil, new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, h + 0.004, z)), 0.6);
  };
  for (const p of plan.palms) {
    into(p.room);
    planter(p.x, p.z, planterRadius('palm', p.size), PALM_PLANTER.h);
    out.props.push({ kind: 'palm', x: p.x, y: PALM_PLANTER.seat, z: p.z, ry: p.x, size: p.size, room: p.room });
  }
  for (const p of plan.plants) {
    into(p.room);
    planter(p.x, p.z, planterRadius(p.kind, p.size), PLANTER.h);
    out.props.push({ kind: p.kind, x: p.x, y: PLANTER.seat, z: p.z, ry: p.x + p.z, size: p.size, room: p.room });
  }

  // --- the lounges: couch groups round marble coffee tables, and the fireplace ---------------------
  for (const { x: cx, z: cz, room } of plan.loungeGroups) {
    into(room);
    out.props.push({ kind: 'couch', x: cx, y: 0, z: cz - 1.25, ry: 0, size: COUCH.w, room });
    out.props.push({ kind: 'couch', x: cx, y: 0, z: cz + 1.25, ry: Math.PI, size: COUCH.w, room });
    b.box(marble, cx, COFFEE_TABLE.h - 0.02, cz, COFFEE_TABLE.w, 0.04, COFFEE_TABLE.d, 1.4);
    for (const [dx, dz] of [[-0.55, -0.27], [0.55, -0.27], [-0.55, 0.27], [0.55, 0.27]] as const) b.box(brass, cx + dx, 0.2, cz + dz, 0.03, 0.4, 0.03);
    for (const s of [-1, 1]) out.props.push({ kind: 'lamp-floor', x: cx - s * LOUNGE_LAMP_X, y: 0, z: cz + s * 1.25, ry: 0, size: FLOOR_LAMP.h, room });
    out.pools.push({ x: cx, z: cz, r: 2.4, room });
  }
  for (const f of plan.fireplaces) {
    into(f.room);
    const top = ceilingAt(plan, f.x - 0.3, f.z);
    // the chimney breast in dark marble, a wood mantel, a firebox with its fire glowing
    b.box(marble, f.x - 0.17, (1.3 + top) / 2, f.z, 0.34, top - 1.3, 1.9, 1.4);
    b.box(marble, f.x - 0.27, 0.65, f.z, 0.54, 1.3, 2.2, 1.4);
    b.box(wood, f.x - 0.33, 1.34, f.z, 0.66, 0.08, 2.4, 1.2);
    b.box(m.get('lacquer'), f.x - 0.55, 0.45, f.z, 0.02, 0.7, 1.2);
    b.box(brass, f.x - 0.56, 0.45, f.z, 0.012, 0.74, 1.24);
    glow.box(new THREE.Color('#ff7a1e').multiplyScalar(2.6), f.x - 0.4, 0.26, f.z, 0.2, 0.18, 0.9);
    glow.box(new THREE.Color('#ffb24a').multiplyScalar(2.0), f.x - 0.42, 0.42, f.z, 0.08, 0.2, 0.6);
    // a mirror over the mantel
    b.add(new THREE.PlaneGeometry(1.2, 0.9), m.get('mirror'), { x: f.x - 0.35, y: 2.05, z: f.z, ry: -Math.PI / 2 });
    b.box(brass, f.x - 0.345, 2.05, f.z, 0.02, 0.96, 1.26);
    out.pools.push({ x: f.x - 1.2, z: f.z, r: 1.9, room: f.room });
  }

  // --- the poker room's lamps, low over each table --------------------------------------------
  for (const l of plan.tableLamps) {
    into(l.room);
    const top = ceilingAt(plan, l.x, l.z);
    const c = Math.cos(l.yaw);
    const s = Math.sin(l.yaw);
    for (const e of [-0.7, 0.7]) b.add(new THREE.CylinderGeometry(0.005, 0.005, top - 2.28, 5), chrome, { x: l.x + e * c, y: (top + 2.28) / 2, z: l.z - e * s });
    b.box(m.get('lacquer'), l.x, 2.2, l.z, 1.8, 0.16, 0.5, undefined, l.yaw);
    b.box(brass, l.x, 2.12, l.z, 1.82, 0.02, 0.52, undefined, l.yaw);
    glow.box(GLOW.soft, l.x, 2.106, l.z, 1.7, 0.012, 0.42, l.yaw);
    out.pools.push({ x: l.x, z: l.z, r: 2.1, room: l.room });
  }

  // --- the online lounge: gaming-cafe light round the desks ------------------------------------
  // a low divider between the back-to-back monitors with a strip of light along its top, a glow on
  // the floor under each pair of desks in its game's colour, and two lines of light overhead
  const accents = ['#ff3d7f', '#35a8ff', '#1fe07e', '#b46bff', '#ffb02e', '#3dd6ff', '#ff5a4a', '#e4ff3d'];
  for (const isl of plan.deskIslands) {
    into(isl.room);
    const top = ceilingAt(plan, isl.x, isl.z);
    b.box(lacquer, isl.x, 1.0, isl.z, isl.w - 0.1, 0.52, 0.05);
    glow.box(hdr('#35d8ff', 2.4), isl.x, 1.265, isl.z, isl.w - 0.11, 0.012, 0.03);
    // the north row holds the first half of its games (two desks each), the south row the rest
    const perRow = Math.max(1, Math.ceil(isl.games.length / 2));
    isl.games.forEach((g, i) => {
      const color = hdr(accents[Object.keys(CATALOG).indexOf(g) % accents.length]!, 2.6);
      const side = i < perRow ? -1 : 1;
      const x = isl.x - isl.w / 2 + ((i % perRow) + 0.5) * (isl.w / perRow);
      glow.box(color, x, 0.015, isl.z + side * 0.7, isl.w / perRow - 0.25, 0.012, 0.04);
    });
    for (const [side, c] of [
      [-1, '#35d8ff'],
      [1, '#ff3fd0'],
    ] as const) glow.box(hdr(c, 2.2), isl.x, top - 0.03, isl.z + side * 1.25, isl.w + 1.2, 0.02, 0.05);
    out.pools.push({ x: isl.x, z: isl.z, r: 3.0, room: isl.room });
  }

  // --- the yard's string of bulbs --------------------------------------------------------------
  for (const f of plan.festoons) {
    into(f.room);
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
    const n = Math.max(6, Math.round(len / 0.55));
    const bulb = new THREE.SphereGeometry(0.045, 8, 6);
    const warm = new THREE.Color('#ffc070').multiplyScalar(2.4);
    let px = f.x0;
    let py = f.y;
    let pz = f.z0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = f.x0 + (f.x1 - f.x0) * t;
      const z = f.z0 + (f.z1 - f.z0) * t;
      // it sags between its ends
      const y = f.y - Math.sin(t * Math.PI) * 0.55;
      const seg = new THREE.Vector3(x - px, y - py, z - pz);
      const g = new THREE.CylinderGeometry(0.004, 0.004, seg.length(), 4);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.clone().normalize());
      b.add(g, m.get('steel'), new THREE.Matrix4().compose(new THREE.Vector3((x + px) / 2, (y + py) / 2, (z + pz) / 2), q, new THREE.Vector3(1, 1, 1)));
      if (i < n) glow.add(bulb, warm, { x, y: y - 0.06, z });
      px = x;
      py = y;
      pz = z;
    }
    out.pools.push({ x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2, r: 3.2, room: f.room });
  }

  // --- the loose furniture drawn from GLBs, and the pools of light by it -----------------------
  for (const f of plan.furniture) {
    if (f.kind === 'sofa') out.props.push({ kind: 'couch', x: f.x, y: 0, z: f.z, ry: f.yaw, size: COUCH.w, room: f.room });
    if (f.kind === 'lamp') out.props.push({ kind: 'lamp-floor', x: f.x, y: 0, z: f.z, ry: f.yaw, size: FLOOR_LAMP.h, room: f.room });
    if (f.kind === 'hightop') {
      for (const s of FURNITURE.hightop.seats!) {
        const c = Math.cos(f.yaw);
        const sn = Math.sin(f.yaw);
        out.props.push({ kind: 'stool', x: f.x + s.x * c + s.z * sn, y: 0, z: f.z - s.x * sn + s.z * c, ry: f.yaw + s.yaw, size: STOOL.h, room: f.room });
      }
      out.pools.push({ x: f.x, z: f.z, r: 1.3, room: f.room });
    }
    if (f.kind === 'banquette' || f.kind === 'mannequin' || f.kind === 'case' || f.kind === 'drum-fire') out.pools.push({ x: f.x, z: f.z, r: f.kind === 'banquette' ? 2.4 : 1.2, room: f.room });
  }

  // --- the north wing: the parlour's islands and prizes, lanterns, the moon gate, the snack bar ------
  buildThemes(plan, b, m, glow, out);

  // --- the entrance doors ----------------------------------------------------------------------
  out.props.push({ kind: 'door', x: (plan.door.x0 + plan.door.x1) / 2, y: 0, z: plan.door.z + 0.05, ry: Math.PI, size: plan.door.height, room: 'lobby' });
  return out;
}
