// v7: what's in the apartment: the finishes the step you've reached gives it (oak floors and cream
// walls; marble, walnut panelling, a fireplace and a wet bar; gold fittings and the terrace with its
// pool, hot tub and fire pit) and the pieces you own, each in its place (plan.ts SLOTS), drawn by
// kind and style from boxes and cylinders like the rest of the city. Rebuilt whenever what you own
// changes; merged per material, so the whole flat is a couple of dozen draw calls.

import * as THREE from 'three';
import type { Mats } from '../materials.ts';
import { hdr } from '../materials.ts';
import { GLOW } from '../lighting.ts';
import { Collider } from '../collision.ts';
import { Kit } from '../city/kit.ts';
import { signAtlas, signMesh } from '../city/kit.ts';
import { HOME_ITEMS, pieceIn, type HomeItem, type HomeSlot } from '../../../../shared/src/estate.ts';
import { GUNS, type GunItem } from '../../../../shared/src/arms.ts';
import { gunModel, disposeGun } from '../arms/models.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { APT, BEDROOM, FIREPLACE, HALL, SLOTS, SOUTH_SOLID_TO, TABLET, TERRACE, type SlotPlace } from './plan.ts';

/** The home's own materials (the rest come from the casino's and the city's). */
export function defineHomeMats(mats: Mats): void {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const lam = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(o);
  const both = (name: string, color: string, rough = 0.6, metal = 0, emissive?: string) =>
    mats.define1(name, (q) => (q === 'high' ? std({ color, roughness: rough, metalness: metal, ...(emissive ? { emissive } : {}) }) : lam({ color, ...(emissive ? { emissive } : {}) })));
  both('home-linen', '#cdbfa6', 0.9);
  both('home-velvet', '#1d5a44', 0.8);
  both('home-cognac', '#8a4a24', 0.5);
  both('home-crimson', '#7a1020', 0.75);
  both('home-sheet', '#eeeae2', 0.9);
  both('home-oak', '#b58a5c', 0.55);
  both('home-walnut', '#4a2e1c', 0.45);
  both('home-white', '#f2f0ec', 0.2);
  both('home-screen', '#07080b', 0.08, 0.3);
  both('home-copper', '#b8683a', 0.3, 0.9);
  both('home-bronze', '#6a4a2a', 0.4, 0.8);
  both('home-gold', '#d4a53c', 0.25, 1, '#2a1a04');
  both('home-steel', '#8c9096', 0.35, 0.8);
  both('home-felt', '#1f6a3f', 0.95);
  both('home-felt-blue', '#1c3a6a', 0.95);
  both('home-rug', '#3a3632', 1);
  both('home-persian', '#7a1c1a', 1);
  both('home-cream', '#e8dcc4', 0.9);
  both('home-stone', '#d8d2c8', 0.5);
  both('home-tile', '#2a6a88', 0.2, 0.1);
  both('home-soil', '#3a2a1c', 1);
  both('home-leaf', '#3e6a38', 0.8);
}

/** A slot's own frame: pieces are laid out facing +z from its middle, then turned and moved into place. */
class At {
  private readonly c: number;
  private readonly s: number;

  constructor(
    private readonly kit: Kit,
    private readonly col: Collider,
    readonly p: { x: number; z: number; yaw: number },
  ) {
    this.c = Math.cos(p.yaw);
    this.s = Math.sin(p.yaw);
  }

  /** Local (x, z) to world. */
  w(x: number, z: number): { x: number; z: number } {
    return { x: this.p.x + x * this.c + z * this.s, z: this.p.z - x * this.s + z * this.c };
  }

  /** A box by its local corners. */
  box(mat: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, uv?: number): void {
    const m = this.w((x0 + x1) / 2, (z0 + z1) / 2);
    this.kit.turned(mat, m.x, (y0 + y1) / 2, m.z, x1 - x0, y1 - y0, z1 - z0, this.p.yaw, uv);
  }

  /** An upright cylinder at local (x, z). */
  cyl(mat: string, x: number, z: number, r: number, y0: number, y1: number, seg = 18, rTop = r): void {
    const m = this.w(x, z);
    this.kit.cylinder(mat, m.x, m.z, r, y0, y1, seg, rTop);
  }

  /** A lit box (a screen, a strip of light). */
  glow(color: THREE.Color, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    const m = this.w((x0 + x1) / 2, (z0 + z1) / 2);
    this.kit.light(color, m.x, (y0 + y1) / 2, m.z, x1 - x0, y1 - y0, z1 - z0, this.p.yaw);
  }

  /** Solid to the walker, by its local corners. */
  solid(x0: number, x1: number, z0: number, z1: number, top = 1.2): void {
    const m = this.w((x0 + x1) / 2, (z0 + z1) / 2);
    this.col.box(m.x, m.z, x1 - x0, z1 - z0, this.p.yaw, top);
  }

  /** A sphere (a pendant, a bulb, a ball). */
  ball(mat: string, x: number, y: number, z: number, r: number): void {
    const m = this.w(x, z);
    this.kit.batch.add(new THREE.SphereGeometry(r, 14, 10), this.kit.mat(mat), { x: m.x, y, z: m.z });
  }
}

export interface Furnished {
  group: THREE.Group;
  /** What stands in each slot now (null: empty). */
  pieces: Map<HomeSlot, HomeItem | null>;
  dispose(): void;
}

/**
 * Build the finishes for step `tier` and the pieces `owned` (picked per slot where the owner chose
 * one) into a group, adding their collision to `col` (taken out again on dispose).
 */
export function furnish(mats: Mats, col: Collider, tier: number, owned: ReadonlySet<string>, picks: Partial<Record<HomeSlot, string>>): Furnished {
  const own = new Collider();
  const kit = new Kit('home', mats, own);
  const group = new THREE.Group();
  group.name = 'home:furnished';
  const t = Math.max(1, tier);
  const A = APT;
  const H = A.height;

  // --- finishes --------------------------------------------------------------------------------
  const floor = t >= 2 ? 'marble-floor' : 'floor-wood';
  kit.box(floor, A.x0, A.x1, -0.1, 0.01, A.z0, A.z1, t >= 2 ? 2.4 : 1.6);
  // the walls' inner faces: cream paint, or walnut panelling to the dado and cream above
  const inner = 0.02;
  // west wall either side of the elevator, south wall's solid part: cream plaster, and from the
  // Grand step walnut panelling to the dado under it
  const lift = { z0: 68.6, z1: 71.4 };
  const dado = t >= 2 ? 1.25 : 0.01;
  const face = (x0: number, x1: number, z0: number, z1: number) => {
    if (t >= 2) kit.box('home-walnut', x0, x1, 0.01, dado, z0, z1, 1.2);
    kit.box('home-cream', x0, x1, dado, H, z0, z1, 2.4);
  };
  face(A.x0, A.x0 + inner, A.z0, lift.z0);
  face(A.x0, A.x0 + inner, lift.z1, A.z1);
  face(A.x0, SOUTH_SOLID_TO, A.z1 - inner, A.z1);
  // skirting and a picture rail in brass (gold on the Penthouse)
  const trim = t >= 3 ? 'home-gold' : 'brass';
  kit.box(trim, A.x0 + inner, A.x0 + inner + 0.015, 2.62, 2.66, A.z0, lift.z0);
  kit.box(trim, A.x0 + inner, A.x0 + inner + 0.015, 2.62, 2.66, lift.z1, A.z1);
  kit.box(trim, A.x0, SOUTH_SOLID_TO, 2.62, 2.66, A.z1 - inner - 0.015, A.z1 - inner);
  kit.box(t >= 2 ? 'home-walnut' : 'home-white', A.x0 + inner, A.x0 + inner + 0.02, 0.01, 0.12, A.z0, lift.z0);
  kit.box(t >= 2 ? 'home-walnut' : 'home-white', A.x0 + inner, A.x0 + inner + 0.02, 0.01, 0.12, lift.z1, A.z1);
  // the ceiling, and a lit cove round its edge from the Grand step
  kit.box('home-white', A.x0, A.x1, H, H + 0.1, A.z0, A.z1, 2.4);
  if (t >= 2) {
    kit.light(GLOW.warm, (A.x0 + A.x1) / 2, H - 0.06, A.z0 + 0.3, A.x1 - A.x0 - 1, 0.02, 0.02);
    kit.light(GLOW.warm, (A.x0 + A.x1) / 2, H - 0.06, A.z1 - 0.3, A.x1 - A.x0 - 1, 0.02, 0.02);
    kit.light(GLOW.warm, A.x1 - 0.3, H - 0.06, (A.z0 + A.z1) / 2, 0.02, 0.02, A.z1 - A.z0 - 1);
  }
  // downlights, their pools on the floor
  for (let x = A.x0 + 3; x < A.x1 - 1; x += 4) {
    for (let z = A.z0 + 3; z < A.z1 - 1; z += 4.5) {
      kit.glow.add(new THREE.CylinderGeometry(0.08, 0.08, 0.012, 14), GLOW.bulb, { x, y: H - 0.008, z });
      kit.pool(x, z, 2.2);
    }
  }
  // the kitchen along the north glass: a run of base units and a worktop (always)
  const K = { x0: -141.4, x1: -131.6, z0: 58.08, z1: 58.8 };
  kit.box(t >= 2 ? 'home-walnut' : 'home-white', K.x0, K.x1, 0.01, 0.86, K.z0, K.z1);
  kit.box(t >= 2 ? 'marble-light' : 'home-stone', K.x0 - 0.02, K.x1 + 0.02, 0.86, 0.9, K.z0, K.z1 + 0.03);
  kit.box('home-steel', -136.9, -136, 0.9, 0.905, K.z0 + 0.12, K.z1 - 0.12);
  own.box((K.x0 + K.x1) / 2, (K.z0 + K.z1) / 2, K.x1 - K.x0, K.z1 - K.z0 + 0.06, 0, 0.9);
  // the tablet by the elevator: the home's catalogue
  kit.box('home-screen', TABLET.x - 0.2, TABLET.x + 0.2, 1.2, 1.5, TABLET.z - 0.02, TABLET.z);
  kit.light(hdr('#7fb4ff', 1.4), TABLET.x, 1.35, TABLET.z - 0.025, 0.34, 0.24, 0.005);
  // the Grand step: a fireplace in the living room's wall, and a wet bar by the kitchen
  if (t >= 2) {
    const F = FIREPLACE;
    kit.box('marble-black', F.x - 1.1, F.x + 1.1, 0.01, 1.2, F.z - 0.35, A.z1 - inner);
    kit.box('marble-black', F.x - 1.3, F.x + 1.3, 1.2, 1.28, F.z - 0.42, A.z1 - inner);
    kit.box('lacquer', F.x - 0.75, F.x + 0.75, 0.2, 0.9, F.z - 0.36, F.z - 0.34);
    kit.light(hdr('#ff8a2a', 2.6), F.x, 0.32, F.z - 0.37, 1.2, 0.12, 0.02);
    kit.box('fire', F.x - 0.6, F.x + 0.6, 0.24, 0.5, F.z - 0.33, F.z - 0.3);
    kit.pool(F.x, F.z - 1.4, 2.4);
    own.box(F.x, F.z - 0.1, 2.6, 0.9, 0, 1.28);
    // the wet bar: a lacquered counter with a brass rail
    kit.box('lacquer', -131.8, -130.2, 0.01, 1.02, 63.2, 68.4);
    kit.box('marble-black', -131.9, -130.1, 1.02, 1.07, 63.1, 68.5);
    kit.box('brass', -131.93, -131.9, 0.12, 0.16, 63.2, 68.4);
    own.box(-131, 65.8, 1.8, 5.4, 0, 1.07);
  }
  // the terrace: the Penthouse step opens it (pool, hot tub, fire pit, loungers)
  if (t >= 3) terrace(kit, own);

  // --- the pieces ------------------------------------------------------------------------------
  const pieces = new Map<HomeSlot, HomeItem | null>();
  for (const slot of Object.keys(SLOTS) as HomeSlot[]) {
    const item = pieceIn(slot, owned, t, picks[slot] ?? null);
    pieces.set(slot, item);
    if (!item) continue;
    const at = new At(kit, own, SLOTS[slot]);
    BUILD[slot](at, item.style, t);
  }
  // the neon sign's words (a sign mesh of its own)
  let neon: THREE.Mesh | null = null;
  if (pieces.get('neon')) {
    const atlas = signAtlas([{ text: 'JACKPOT', font: '600 96px "Tilt Neon", "Arial Rounded MT Bold", sans-serif', color: '#ffd0f0', glow: '#ff3fb4' }]);
    const s = SLOTS.neon;
    neon = signMesh(atlas, [{ row: 0, x: s.x, y: 2.62, z: s.z + 0.05, h: 0.5, ry: s.yaw }], 1.8);
    group.add(neon);
  }

  // v7.1: the gun wall on the games corner's wall: the owner's guns on a lit walnut board
  const guns = GUNS.filter((g) => owned.has(g.id));
  let rack: THREE.Mesh[] = [];
  if (guns.length) {
    const W = { x0: -153.7, x1: -148.4, z: A.z1 - inner };
    kit.box('home-walnut', W.x0, W.x1, 0.95, 2.75, W.z - 0.06, W.z);
    kit.light(GLOW.shelf, (W.x0 + W.x1) / 2, 2.72, W.z - 0.08, W.x1 - W.x0 - 0.3, 0.02, 0.03);
    rack = gunRack(guns, W);
    for (const m of rack) group.add(m);
  }
  const built = kit.batch.build(group, 'home');
  const glows = kit.glow.build(group);
  const pools = kit.pools('#ffd8a8', 0.2);
  if (pools) group.add(pools);
  for (const b of own.boxes) col.boxes.push(b);
  for (const p of own.posts) col.posts.push(p);
  return {
    group,
    pieces,
    dispose() {
      for (const b of own.boxes) {
        const i = col.boxes.indexOf(b);
        if (i >= 0) col.boxes.splice(i, 1);
      }
      for (const p of own.posts) {
        const i = col.posts.indexOf(p);
        if (i >= 0) col.posts.splice(i, 1);
      }
      for (const m of [...built.meshes, ...glows.meshes]) m.dispose();
      if (pools) {
        pools.geometry.dispose();
        const mat = pools.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
      for (const m of rack) m.geometry.dispose();
      if (neon) {
        neon.geometry.dispose();
        const mat = neon.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
      group.removeFromParent();
    },
  };
}

/** The terrace past the east glass: teak, an infinity pool along the rail, a hot tub, a fire pit, loungers. */
function terrace(kit: Kit, col: Collider): void {
  const T = TERRACE;
  kit.box('deck', T.x0 + 0.02, T.x1, -0.1, 0.01, T.z0, T.z1, 2.8);
  // the pool: tiled, lit from inside, its far edge a sheet of glass over the drop
  const P = { x0: -128.2, x1: -122.6, z0: 63.6, z1: 78.4 };
  kit.box('home-tile', P.x0, P.x1, -0.1, 0.02, P.z0, P.z1, 1);
  kit.box('water-pool', P.x0 + 0.1, P.x1 - 0.05, 0.02, 0.28, P.z0 + 0.1, P.z1 - 0.1);
  kit.box('stone-warm', P.x0 - 0.3, P.x0, 0.01, 0.34, P.z0, P.z1, 1.6);
  kit.box('stone-warm', P.x0 - 0.3, P.x1, 0.01, 0.34, P.z0 - 0.3, P.z0, 1.6);
  kit.box('stone-warm', P.x0 - 0.3, P.x1, 0.01, 0.34, P.z1, P.z1 + 0.3, 1.6);
  kit.light(hdr('#5fd8ff', 1.3), (P.x0 + P.x1) / 2, 0.29, (P.z0 + P.z1) / 2, P.x1 - P.x0 - 0.4, 0.004, P.z1 - P.z0 - 0.4);
  col.box((P.x0 + P.x1) / 2 - 0.15, (P.z0 + P.z1) / 2, P.x1 - P.x0 + 0.3, P.z1 - P.z0 + 0.6, 0, 0.34);
  // the hot tub, round, steaming blue
  kit.cylinder('stone-warm', -125.4, 80.6, 1.25, 0.01, 0.62, 28);
  kit.cylinder('water-pool', -125.4, 80.6, 1.08, 0.5, 0.58, 28);
  kit.light(hdr('#7fe4ff', 1.2), -125.4, 0.59, 80.6, 1.6, 0.004, 1.6);
  col.post(-125.4, 80.6, 1.3, 0.62);
  // the fire pit with its ring of low seats
  kit.cylinder('granite', -125.4, 61.6, 0.75, 0.01, 0.42, 24);
  kit.cylinder('fire', -125.4, 61.6, 0.45, 0.42, 0.5, 16, 0.3);
  kit.pool(-125.4, 61.6, 3);
  col.post(-125.4, 61.6, 0.8, 0.5);
  // loungers along the glass by the pool's head
  for (const z of [65.2, 68.2, 71.2, 74.2]) {
    kit.box('teak', -129.6, -128.7, 0.01, 0.34, z - 0.35, z + 0.35);
    kit.box('cushion', -129.55, -128.75, 0.34, 0.42, z - 0.33, z + 0.33);
    col.box(-129.15, z, 0.9, 0.7, 0, 0.42);
  }
  // the glass rail round the edge, and the walker stays behind it
  kit.box('glass', T.x1 - 0.02, T.x1, 0.01, 1.1, T.z0, T.z1);
  kit.box('glass', T.x0, T.x1, 0.01, 1.1, T.z0, T.z0 + 0.02);
  kit.box('glass', T.x0, T.x1, 0.01, 1.1, T.z1 - 0.02, T.z1);
  kit.box('chrome', T.x1 - 0.05, T.x1 + 0.02, 1.08, 1.12, T.z0 + 0.03, T.z1 - 0.03);
  col.box(T.x1, (T.z0 + T.z1) / 2, 0.2, T.z1 - T.z0, 0, 1.1);
  col.box((T.x0 + T.x1) / 2, T.z0, T.x1 - T.x0, 0.2, 0, 1.1);
  col.box((T.x0 + T.x1) / 2, T.z1, T.x1 - T.x0, 0.2, 0, 1.1);
  // string lights over it
  for (let z = T.z0 + 1; z < T.z1; z += 1.6) kit.glow.add(new THREE.SphereGeometry(0.05, 8, 6), GLOW.bulb, { x: -125.6, y: 2.9 + 0.2 * Math.sin(z), z });
}

type Builder = (a: At, style: string, tier: number) => void;

const BUILD: Record<HomeSlot, Builder> = {
  sofa(a, style) {
    const m = style === 'leather' ? 'home-cognac' : style === 'velvet' ? 'home-velvet' : 'home-linen';
    const W = style === 'velvet' ? 3.4 : 2.8;
    a.box(style === 'linen' ? 'home-oak' : 'lacquer', -W / 2 + 0.1, W / 2 - 0.1, 0, 0.12, -0.42, 0.42);
    a.box(m, -W / 2, W / 2, 0.12, 0.42, -0.45, 0.45);
    a.box(m, -W / 2, W / 2, 0.42, 0.85, -0.45, -0.22);
    for (const s of [-1, 1]) a.box(m, s > 0 ? W / 2 - 0.2 : -W / 2, s > 0 ? W / 2 : -W / 2 + 0.2, 0.42, 0.62, -0.45, 0.45);
    // the cushions on the seat
    const n = style === 'velvet' ? 3 : 2;
    const cw = (W - 0.44) / n;
    for (let i = 0; i < n; i++) a.box(m, -W / 2 + 0.22 + i * cw + 0.02, -W / 2 + 0.22 + (i + 1) * cw - 0.02, 0.42, 0.52, -0.2, 0.42);
    if (style === 'velvet') {
      // the L's chaise
      a.box(m, W / 2 - 0.9, W / 2, 0.12, 0.52, 0.45, 1.6);
      a.solid(W / 2 - 0.9, W / 2, 0.45, 1.6, 0.52);
    }
    a.solid(-W / 2, W / 2, -0.45, 0.45, 0.85);
    // a low table in front
    a.box(style === 'leather' ? 'marble-black' : 'home-oak', -0.6, 0.6, 0.36, 0.4, 0.95, 1.55);
    a.box('home-steel', -0.55, 0.55, 0, 0.36, 1.2, 1.3);
    a.solid(-0.6, 0.6, 0.95, 1.55, 0.4);
  },
  tv(a, style) {
    const w = style === 'cinema' ? 4.4 : style === '85' ? 1.9 : 1.24;
    const h = style === 'cinema' ? 2.2 : style === '85' ? 1.08 : 0.72;
    const y = style === 'cinema' ? 0.7 : 1.05;
    a.box('home-walnut', -1.2, 1.2, 0, 0.45, -0.5, 0.0);
    a.solid(-1.2, 1.2, -0.5, 0.0, 0.45);
    a.box('home-screen', -w / 2, w / 2, y, y + h, -0.08, -0.03);
    a.glow(hdr('#3a6ab8', 0.55), -w / 2 + 0.03, w / 2 - 0.03, y + 0.03, y + h - 0.03, -0.028, -0.026);
    if (style !== '55') a.box('lacquer', -w / 2 + 0.1, w / 2 - 0.1, y - 0.1, y - 0.02, -0.12, -0.03);
    if (style === 'cinema') for (const s of [-1, 1]) a.box('lacquer', s * (w / 2 + 0.2) - 0.16, s * (w / 2 + 0.2) + 0.16, 0, 1.4, -0.4, -0.05);
  },
  bed(a, style) {
    if (style === 'round') {
      a.cyl('home-gold', 0, 0.3, 1.45, 0, 0.3, 32);
      a.cyl('home-crimson', 0, 0.3, 1.38, 0.3, 0.6, 32);
      a.cyl('home-sheet', 0, 0.3, 1.3, 0.6, 0.66, 32);
      a.box('home-crimson', -1.1, 1.1, 0.3, 1.3, -1.1, -0.95);
      for (const x of [-0.5, 0.5]) a.box('home-sheet', x - 0.35, x + 0.35, 0.66, 0.82, -0.8, -0.45);
      a.solid(-1.45, 1.45, -1.15, 1.75, 0.66);
      return;
    }
    const W = style === 'canopy' ? 2.0 : 1.6;
    const L = 2.2;
    const frame = style === 'canopy' ? 'home-walnut' : 'home-linen';
    a.box(frame, -W / 2 - 0.05, W / 2 + 0.05, 0, 0.36, -L / 2, L / 2);
    a.box(frame, -W / 2 - 0.05, W / 2 + 0.05, 0.36, 1.25, -L / 2 - 0.08, -L / 2);
    a.box('home-sheet', -W / 2, W / 2, 0.36, 0.6, -L / 2 + 0.02, L / 2 - 0.02);
    a.box(style === 'canopy' ? 'home-crimson' : 'home-rug', -W / 2 - 0.01, W / 2 + 0.01, 0.58, 0.63, 0.1, L / 2 + 0.01);
    for (const x of [-W / 4, W / 4]) a.box('home-sheet', x - 0.32, x + 0.32, 0.6, 0.76, -L / 2 + 0.1, -L / 2 + 0.45);
    if (style === 'canopy') {
      for (const x of [-W / 2 - 0.02, W / 2 + 0.02]) for (const z of [-L / 2 - 0.04, L / 2 + 0.02]) a.cyl('home-walnut', x, z, 0.05, 0, 2.3, 10);
      a.box('home-linen', -W / 2 - 0.05, W / 2 + 0.05, 2.28, 2.32, -L / 2 - 0.08, L / 2 + 0.06);
    }
    a.solid(-W / 2 - 0.05, W / 2 + 0.05, -L / 2 - 0.08, L / 2, 0.76);
    // bedside tables and lamps
    for (const s of [-1, 1]) {
      const x = s * (W / 2 + 0.4);
      a.box('home-oak', x - 0.25, x + 0.25, 0, 0.55, -L / 2 + 0.05, -L / 2 + 0.5);
      a.cyl('home-white', x, -L / 2 + 0.28, 0.1, 0.55, 0.85, 12, 0.06);
      a.glow(GLOW.warm, x - 0.09, x + 0.09, 0.85, 0.98, -L / 2 + 0.2, -L / 2 + 0.36);
    }
  },
  rug(a, style) {
    const w = style === 'persian' ? 4.2 : 3.4;
    const d = style === 'persian' ? 3 : 2.5;
    a.box(style === 'persian' ? 'home-persian' : 'home-rug', -w / 2, w / 2, 0.01, 0.018, -d / 2, d / 2);
    if (style === 'persian') {
      a.box('home-cream', -w / 2 + 0.2, w / 2 - 0.2, 0.018, 0.024, -d / 2 + 0.2, -d / 2 + 0.28);
      a.box('home-cream', -w / 2 + 0.2, w / 2 - 0.2, 0.018, 0.024, d / 2 - 0.28, d / 2 - 0.2);
      a.box('home-felt-blue', -0.9, 0.9, 0.018, 0.028, -0.6, 0.6);
    }
  },
  art(a, style) {
    const w = style === 'master' ? 2.2 : style === 'abstract' ? 2.4 : 1.0;
    const h = style === 'master' ? 1.6 : style === 'abstract' ? 1.6 : 0.7;
    const y = 1.55;
    a.box(style === 'master' ? 'home-gold' : style === 'abstract' ? 'home-oak' : 'lacquer', -w / 2 - 0.08, w / 2 + 0.08, y - h / 2 - 0.08, y + h / 2 + 0.08, -0.01, 0.04);
    a.box('painting', -w / 2, w / 2, y - h / 2, y + h / 2, 0.04, 0.05);
    if (style === 'master') a.glow(GLOW.warm, -w / 2, w / 2, y + h / 2 + 0.12, y + h / 2 + 0.16, 0.05, 0.25);
    if (style === 'abstract') a.glow(hdr('#e0b050', 0.9), -w / 2 + 0.3, -w / 2 + 0.9, y - 0.3, y + 0.3, 0.05, 0.052);
  },
  plant(a, style) {
    if (style === 'olive') {
      a.cyl('home-copper', 0, 0, 0.42, 0, 0.7, 20, 0.5);
      a.cyl('home-soil', 0, 0, 0.44, 0.66, 0.68, 20);
      a.cyl('home-walnut', 0, 0, 0.07, 0.68, 1.8, 8, 0.05);
      for (const [x, y, z, r] of [[0, 2.1, 0, 0.62], [0.3, 1.9, 0.2, 0.45], [-0.3, 2.0, -0.1, 0.5]] as const) a.ball('home-leaf', x, y, z, r);
      a.solid(-0.5, 0.5, -0.5, 0.5, 1.2);
      return;
    }
    a.cyl('home-white', 0, 0, 0.26, 0, 0.5, 18, 0.3);
    a.cyl('home-soil', 0, 0, 0.28, 0.48, 0.5, 18);
    a.cyl('home-walnut', 0, 0, 0.04, 0.5, 1.4, 8);
    for (const [x, y, z, r] of [[0, 1.55, 0, 0.36], [0.18, 1.3, 0.1, 0.28], [-0.16, 1.2, -0.08, 0.26], [0.05, 1.8, -0.05, 0.25]] as const) a.ball('home-leaf', x, y, z, r);
    a.solid(-0.32, 0.32, -0.32, 0.32, 1);
  },
  chandelier(a, style) {
    const y = APT.height;
    if (style === 'crystal') {
      a.cyl('home-gold', 0, 0, 0.02, y - 0.7, y, 6);
      for (const [r, h, n] of [[0.9, y - 1.3, 14], [0.62, y - 1.05, 10], [0.34, y - 0.82, 6]] as const) {
        a.cyl('home-gold', 0, 0, r, h - 0.02, h + 0.02, 24);
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          a.ball('glass', Math.cos(ang) * r, h - 0.12, Math.sin(ang) * r, 0.06);
          a.glow(GLOW.bulb, Math.cos(ang) * r - 0.025, Math.cos(ang) * r + 0.025, h + 0.02, h + 0.1, Math.sin(ang) * r - 0.025, Math.sin(ang) * r + 0.025);
        }
      }
      return;
    }
    for (let i = 0; i < 12; i++) {
      const x = ((i % 4) - 1.5) * 0.45;
      const z = (Math.floor(i / 4) - 1) * 0.45;
      const h = y - 0.9 - ((i * 37) % 5) * 0.12;
      a.cyl('home-steel', x, z, 0.006, h + 0.12, y, 4);
      a.ball('glass', x, h, z, 0.13);
      a.glow(GLOW.bulb, x - 0.03, x + 0.03, h - 0.03, h + 0.03, z - 0.03, z + 0.03);
    }
  },
  dining(a, style) {
    const W = style === 'marble' ? 3.4 : 2.2;
    const D = 1.1;
    if (style === 'marble') {
      a.box('marble-light', -W / 2, W / 2, 0.72, 0.77, -D / 2, D / 2);
      a.box('brass', -0.2, 0.2, 0, 0.72, -0.3, 0.3);
      a.box('brass', -W / 2 + 0.3, W / 2 - 0.3, 0.01, 0.06, -0.12, 0.12);
    } else {
      a.box('home-oak', -W / 2, W / 2, 0.7, 0.76, -D / 2, D / 2);
      for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) a.box('home-oak', x - 0.04, x + 0.04, 0, 0.7, z - 0.04, z + 0.04);
    }
    a.solid(-W / 2, W / 2, -D / 2, D / 2, 0.77);
    const seats = style === 'marble' ? 5 : 3;
    for (let i = 0; i < seats; i++) {
      const x = -W / 2 + (W / seats) * (i + 0.5);
      for (const s of [-1, 1]) {
        const z = s * (D / 2 + 0.35);
        a.box(style === 'marble' ? 'home-velvet' : 'home-linen', x - 0.22, x + 0.22, 0.44, 0.5, z - 0.22, z + 0.22);
        a.box(style === 'marble' ? 'home-velvet' : 'home-linen', x - 0.22, x + 0.22, 0.5, 0.98, s > 0 ? z + 0.16 : z - 0.22, s > 0 ? z + 0.22 : z - 0.16);
        for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) a.box('home-walnut', x + lx - 0.02, x + lx + 0.02, 0, 0.44, z + lz - 0.02, z + lz + 0.02);
      }
    }
  },
  kitchen(a, style) {
    if (style === 'chef') {
      // a range in the run, a copper hood over it, and an island with stools
      a.box('home-steel', -0.8, 0.8, 0, 0.94, -1.72, -1.02);
      a.box('lacquer', -0.7, 0.7, 0.94, 0.955, -1.62, -1.12);
      for (const x of [-0.45, 0, 0.45]) for (const z of [-1.52, -1.22]) a.cyl('home-steel', x, z, 0.09, 0.955, 0.965, 12);
      a.box('home-copper', -0.9, 0.9, 1.7, 2.2, -1.9, -1.2);
      a.box('home-copper', -0.25, 0.25, 2.2, APT.height, -1.75, -1.35);
      a.box('home-walnut', -1.6, 1.6, 0, 0.88, 1.2, 2.2);
      a.box('marble-light', -1.7, 1.7, 0.88, 0.94, 1.1, 2.3);
      a.solid(-1.7, 1.7, 1.1, 2.3, 0.94);
      for (const x of [-1.1, 0, 1.1]) {
        a.cyl('home-steel', x, 2.75, 0.03, 0, 0.72, 8);
        a.cyl('home-cognac', x, 2.75, 0.2, 0.72, 0.78, 16);
      }
      a.glow(GLOW.warm, -1.4, 1.4, 1.62, 1.64, 1.6, 1.62);
      return;
    }
    // an espresso machine on the worktop
    a.box('home-steel', -0.2, 0.2, 0.9, 1.3, -1.72, -1.4);
    a.box('lacquer', -0.16, 0.16, 1.02, 1.05, -1.42, -1.3);
    a.cyl('chrome', 0, -1.36, 0.035, 1.12, 1.2, 10);
  },
  bar(a, style) {
    if (style === 'wine') {
      a.box('home-walnut', -2.2, 2.2, 0, 2.6, -0.02, 0.42);
      a.box('glass', -2.0, 2.0, 0.1, 2.5, 0.42, 0.44);
      for (let r = 0; r < 7; r++) {
        const y = 0.25 + r * 0.33;
        a.box('home-oak', -2.0, 2.0, y, y + 0.02, 0.02, 0.4);
        for (let i = 0; i < 16; i++) a.cyl(r % 2 ? 'lacquer-red' : 'home-bronze', -1.85 + i * 0.245, 0.2, 0.035, y + 0.03, y + 0.28, 8, 0.02);
      }
      a.glow(GLOW.shelf, -2.0, 2.0, 2.52, 2.55, 0.1, 0.34);
      a.solid(-2.2, 2.2, -0.02, 0.44, 2.6);
      return;
    }
    a.box('brass', -0.45, 0.45, 0.4, 0.42, 0.05, 0.55);
    a.box('brass', -0.45, 0.45, 0.8, 0.82, 0.05, 0.55);
    for (const x of [-0.43, 0.43]) for (const z of [0.07, 0.53]) a.cyl('brass', x, z, 0.012, 0, 0.84, 6);
    for (let i = 0; i < 5; i++) a.cyl(i % 2 ? 'glass' : 'home-bronze', -0.3 + i * 0.15, 0.3, 0.04, 0.82, 1.12, 8, 0.02);
    a.solid(-0.45, 0.45, 0.05, 0.55, 0.84);
  },
  aquarium(a, style) {
    const w = style === 'shark' ? 6.4 : 3.2;
    const h = style === 'shark' ? APT.height - 0.2 : 1.5;
    const y = style === 'shark' ? 0.05 : 0.7;
    a.box('lacquer', -w / 2 - 0.08, w / 2 + 0.08, 0, y, -0.2, 0.55);
    a.box('water', -w / 2, w / 2, y, y + h, -0.15, 0.5);
    a.box('glass', -w / 2, w / 2, y, y + h, 0.5, 0.52);
    a.glow(hdr('#3aa8ff', style === 'shark' ? 1.2 : 0.9), -w / 2 + 0.05, w / 2 - 0.05, y + h - 0.06, y + h - 0.02, -0.1, 0.45);
    // the fish (and two sharks) as bright specks
    for (let i = 0; i < (style === 'shark' ? 14 : 9); i++) {
      const x = -w / 2 + 0.3 + ((i * 0.71) % (w - 0.6));
      const fy = y + 0.3 + ((i * 0.37) % (h - 0.6));
      a.glow(hdr(i % 3 === 0 ? '#ffb040' : '#9fe8ff', 1.1), x - 0.06, x + 0.06, fy - 0.02, fy + 0.02, 0.2, 0.26);
    }
    if (style === 'shark') for (const [x, fy] of [[-1.2, 1.6], [1.4, 2.4]] as const) a.box('home-steel', x - 0.5, x + 0.5, fy - 0.1, fy + 0.1, 0.1, 0.3);
    a.solid(-w / 2 - 0.08, w / 2 + 0.08, -0.2, 0.55, y + h);
  },
  piano(a, style) {
    const m = style === 'white' ? 'home-white' : 'lacquer';
    a.box(m, -0.8, 0.8, 0.62, 0.95, -1.2, 0.5);
    a.cyl(m, 0, -1.2, 0.8, 0.62, 0.95, 24);
    // the lid, raised
    a.box(m, -0.78, 0.78, 1.2, 1.24, -1.4, 0.2);
    a.cyl('home-steel', 0.7, -0.4, 0.015, 0.95, 1.22, 6);
    a.box('home-white', -0.72, 0.72, 0.9, 0.97, 0.5, 0.66);
    a.box('lacquer', -0.72, 0.72, 0.97, 0.99, 0.5, 0.58);
    for (const [x, z] of [[-0.65, 0.35], [0.65, 0.35], [0, -1.7]] as const) a.cyl(m, x, z, 0.06, 0, 0.62, 10);
    a.box(m, -0.4, 0.4, 0.45, 0.52, 1.0, 1.4);
    a.solid(-0.85, 0.85, -2.0, 0.66, 1.2);
    a.solid(-0.4, 0.4, 1.0, 1.4, 0.52);
  },
  games(a, style) {
    const felt = style === 'poker' ? 'home-felt-blue' : 'home-felt';
    if (style === 'poker') {
      a.cyl('home-walnut', 0, 0, 1.25, 0.7, 0.78, 32);
      a.cyl(felt, 0, 0, 1.08, 0.78, 0.8, 32);
      a.cyl('home-walnut', 0, 0, 0.3, 0, 0.7, 12);
      a.solid(-1.25, 1.25, -1.25, 1.25, 0.8);
      return;
    }
    a.box('home-walnut', -1.35, 1.35, 0.6, 0.82, -0.75, 0.75);
    a.box(felt, -1.2, 1.2, 0.82, 0.84, -0.6, 0.6);
    for (const x of [-1.2, 1.2]) for (const z of [-0.6, 0.6]) a.box('home-walnut', x - 0.1, x + 0.1, 0, 0.6, z - 0.1, z + 0.1);
    for (const [x, z, c] of [[0.5, 0, 'home-white'], [-0.4, 0.2, 'lacquer-red'], [-0.5, -0.15, 'home-gold'], [-0.3, -0.05, 'home-felt-blue']] as const) a.ball(c, x, 0.87, z, 0.03);
    a.box('home-oak', -0.8, 0.8, 0.86, 0.87, 0.3, 0.32);
    a.solid(-1.35, 1.35, -0.75, 0.75, 0.84);
    // a lamp over it
    a.box('home-velvet', -0.9, 0.9, 2.3, 2.45, -0.2, 0.2);
    a.glow(GLOW.warm, -0.8, 0.8, 2.28, 2.3, -0.15, 0.15);
  },
  arcade(a) {
    a.box('lacquer', -0.36, 0.36, 0, 1.85, -0.35, 0.35);
    a.box('home-screen', -0.28, 0.28, 1.05, 1.5, 0.28, 0.3);
    a.glow(hdr('#57ffb0', 0.9), -0.26, 0.26, 1.07, 1.48, 0.3, 0.302);
    a.glow(hdr('#ff4fb4', 1.3), -0.34, 0.34, 1.62, 1.8, 0.35, 0.36);
    a.box('home-steel', -0.34, 0.34, 0.9, 1.0, 0.25, 0.5);
    a.solid(-0.36, 0.36, -0.35, 0.5, 1.85);
  },
  jukebox(a) {
    a.box('home-walnut', -0.5, 0.5, 0, 1.2, -0.3, 0.3);
    a.cyl('home-walnut', 0, 0, 0.5, 1.2, 1.25, 20);
    a.box('chrome', -0.46, 0.46, 0.75, 1.15, 0.3, 0.32);
    for (const x of [-0.45, 0.45]) a.glow(hdr(x < 0 ? '#ff7a2a' : '#ffd23a', 1.5), x - 0.04, x + 0.04, 0.1, 1.18, 0.28, 0.33);
    a.glow(hdr('#7affff', 1.1), -0.3, 0.3, 0.4, 0.6, 0.31, 0.32);
    a.solid(-0.5, 0.5, -0.3, 0.33, 1.25);
  },
  safe(a, style) {
    if (style === 'vault') {
      a.box('home-steel', -1.0, 1.0, 0.01, 2.2, -0.1, 0.05);
      a.cyl('home-steel', 0, 0.1, 0.85, 0.2, 2.0, 28);
      a.box('chrome', -0.06, 0.06, 0.4, 1.8, 0.16, 0.2);
      a.box('chrome', -0.7, 0.7, 1.04, 1.16, 0.16, 0.2);
      a.solid(-1.0, 1.0, -0.1, 0.2, 2.2);
      return;
    }
    a.box('home-steel', -0.35, 0.35, 0, 0.8, -0.3, 0.3);
    a.cyl('brass', 0, 0.32, 0.08, 0.45, 0.47, 16);
    a.solid(-0.35, 0.35, -0.3, 0.3, 0.8);
  },
  trophy(a) {
    a.box('home-walnut', -0.7, 0.7, 0, 0.3, -0.25, 0.25);
    a.box('glass', -0.68, 0.68, 0.3, 2.0, 0.23, 0.25);
    for (const y of [0.8, 1.3]) a.box('glass', -0.66, 0.66, y, y + 0.01, -0.23, 0.23);
    for (const [x, y, h] of [[-0.4, 0.3, 0.4], [0.05, 0.3, 0.3], [0.45, 0.3, 0.35], [-0.3, 0.81, 0.3], [0.3, 0.81, 0.38], [0, 1.31, 0.45]] as const) {
      a.cyl('home-gold', x, 0, 0.05, y, y + h * 0.6, 10);
      a.cyl('home-gold', x, 0, 0.1, y + h * 0.6, y + h, 12, 0.14);
    }
    a.glow(GLOW.shelf, -0.6, 0.6, 1.96, 1.98, -0.2, 0.2);
    a.solid(-0.7, 0.7, -0.25, 0.25, 2);
  },
  sculpture(a, style) {
    a.box('marble-light', -0.5, 0.5, 0, 0.9, -0.5, 0.5);
    if (style === 'gold') {
      // a charging bull: body, head down, horns, legs
      a.box('home-gold', -0.28, 0.28, 1.25, 1.85, -0.7, 0.55);
      a.box('home-gold', -0.2, 0.2, 1.1, 1.5, 0.5, 0.95);
      for (const s of [-1, 1]) a.box('home-gold', s * 0.2, s * 0.2 + s * 0.3, 1.45, 1.52, 0.72, 0.8);
      for (const [x, z] of [[-0.18, -0.55], [0.18, -0.55], [-0.18, 0.4], [0.18, 0.4]] as const) a.box('home-gold', x - 0.06, x + 0.06, 0.9, 1.3, z - 0.06, z + 0.06);
      a.box('home-gold', -0.03, 0.03, 1.5, 1.9, -0.82, -0.7);
    } else {
      // a figure: legs, torso, head, an arm raised
      for (const x of [-0.1, 0.1]) a.cyl('home-bronze', x, 0, 0.07, 0.9, 1.75, 10, 0.08);
      a.cyl('home-bronze', 0, 0, 0.17, 1.75, 2.35, 14, 0.2);
      a.ball('home-bronze', 0, 2.52, 0, 0.12);
      a.cyl('home-bronze', 0.24, 0, 0.05, 2.2, 2.75, 8, 0.04);
      a.cyl('home-bronze', -0.22, 0.05, 0.05, 1.8, 2.25, 8, 0.05);
    }
    a.glow(GLOW.warm, -0.45, 0.45, 0.91, 0.92, 0.46, 0.47);
    a.solid(-0.5, 0.5, -0.5, 0.5, 2);
  },
  neon(a) {
    // (the words themselves are a sign mesh: furnish())
    a.box('lacquer', -1.1, 1.1, 2.3, 2.94, -0.02, 0.02);
  },
  telescope(a) {
    for (const ang of [0, 2.1, 4.2]) a.box('brass', Math.cos(ang) * 0.3 - 0.015, Math.cos(ang) * 0.3 + 0.015, 0, 1.1, Math.sin(ang) * 0.3 - 0.015, Math.sin(ang) * 0.3 + 0.015);
    a.cyl('brass', 0, 0, 0.05, 1.1, 1.2, 10);
    a.box('brass', -0.07, 0.07, 1.22, 1.36, -0.55, 0.65);
    a.cyl('glass', 0, 0.66, 0.075, 1.225, 1.355, 12);
    a.solid(-0.35, 0.35, -0.35, 0.35, 1.3);
  },
};

/**
 * The guns hung on the wall in rows, barrels pointing left, merged per material (a draw call a
 * finish, however many guns).
 */
function gunRack(guns: readonly GunItem[], w: { x0: number; x1: number; z: number }): THREE.Mesh[] {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const perRow = Math.max(1, Math.ceil(guns.length / 3));
  guns.forEach((g, i) => {
    const model = gunModel(g);
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = w.x1 - 0.35 - (col + 0.5) * ((w.x1 - w.x0 - 0.5) / perRow) + 0.2;
    // lying flat against the board, the barrel to the left (-x), the grip down
    model.rotation.set(0, -Math.PI / 2, 0);
    model.position.set(x + (model.userData.length as number) / 2, 2.35 - row * 0.55, w.z - 0.12);
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const list = byMat.get(m.material as THREE.Material) ?? [];
      list.push(geo.index ? geo.toNonIndexed() : geo);
      byMat.set(m.material as THREE.Material, list);
    });
    disposeGun(model);
  });
  const out: THREE.Mesh[] = [];
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'home:guns';
    out.push(mesh);
  }
  return out;
}

/** Every slot, in the order the catalogue shows them. */
export const SLOT_ORDER: readonly HomeSlot[] = ['sofa', 'tv', 'rug', 'art', 'plant', 'chandelier', 'dining', 'kitchen', 'bar', 'bed', 'safe', 'games', 'arcade', 'jukebox', 'piano', 'aquarium', 'trophy', 'sculpture', 'neon', 'telescope'];

/** The pieces for a slot, cheapest first. */
export function slotItems(slot: HomeSlot): HomeItem[] {
  return HOME_ITEMS.filter((h) => h.slot === slot).sort((a, b) => a.price - b.price);
}

export { HALL, BEDROOM };
export type { SlotPlace };
