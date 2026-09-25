// The county jail, across the street in its lot (shared/src/zones.ts LOTS.jail; the plan in
// shared/src/law/rules.ts JAIL). From the street: a concrete block with slit windows, floodlights
// and the name over the door. Inside the door the visitors' hall, its far side floor-to-ceiling
// bars; past them the prison proper, where inmates are kept: booking (its counter is the bank's
// window in here), the day room with the two tables inmates win their bail at, each run by an
// officer, a row of five cells with bunks, and the yard under the open sky behind razor wire.
//
// Cheap to draw: every solid thing is one merged mesh with its light baked into the vertex colours
// (no lights of its own, so nothing in the scene recompiles), the signs are one more mesh on one
// canvas, the bail board one more. Walls, bars and furniture go into the world's collider.
//
// Walls never overlap face to face: a wall along x runs the full length, one along z butts
// between them, and nothing lies in the plane of anything else (no flicker, anywhere).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GAMES } from '../../games/index.ts';
import { variantOf } from '../../../../shared/src/games/catalog.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { JAIL, JAIL_GAMES, type JailState } from '../../../../shared/src/law/rules.ts';
import type { Quality } from '../../render/engine3d.ts';
import type { Collider } from '../collision.ts';
import type { WorldStation } from '../stations.ts';
import type { RoomId } from '../layout.ts';

// --- the plan (metres, world coordinates) ------------------------------------------------------

const B = JAIL.building; // x 167-195, z -41..-9
/** Outer walls' thickness, the storey's height to the roof slab's underside, and the parapet. */
const T = 0.3;
const CEIL = 3.9;
const TOP = 4.4;
/** The line between the hall (and the offices beside it) and the prison, and its bars. */
const BARS_X = 172;
/** The wall between the day room and the yard, and its doorway. */
const YARD_Z = -30;
const YARD_DOOR = { x0: 182.5, x1: 184.5 };
/** The cell fronts, and the cells' dividers. */
const CELLS_Z = -14.5;
const CELL_X = [172.15, 176.66, 181.18, 185.7, 190.22, 194.7];
/** The visitors' door in the front wall. */
const DOOR = { z0: -26, z1: -24, h: 2.7 };
/** The floor's top (a few centimetres over the street, so nothing lies in its plane). */
const FLOOR = 0.03;

/** Where the jail's tables stand (the players on the +z side, the officers on the -z side). */
const TABLE_AT: Record<string, { x: number; z: number }> = {
  'jail-bj': { x: 180.2, z: -23 },
  'jail-sb': { x: 188.4, z: -23 },
};
/** The booking counter, and where you stand at it to use the bank. */
const COUNTER = { x0: 173.1, x1: 177.1, z0: -28.4, z1: -27.8 };
export const BANK_SPOT = { x: 175.1, z: -27.25 };
/** The bail board on the yard wall, facing the day room. */
const BOARD = { x: 189.2, y: 2.25, w: 3.2, h: 1.8 };

// --- baked light ---------------------------------------------------------------------------------

/** How much light a face gets, by the way it faces: from above, and a little more from +x and +z. */
function faceLight(nx: number, ny: number, nz: number): number {
  return 0.66 + 0.34 * Math.max(0, ny) + 0.06 * Math.max(0, -ny) + 0.08 * nx + 0.1 * nz;
}

/**
 * Merged, vertex-lit geometry drawn with one texture, laid on in world space: a face takes the
 * texture across its own plane, one repeat every `repeat` metres, so blocks line up across walls.
 */
class Solid {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly _c = new THREE.Color();

  constructor(
    private readonly name: string,
    private readonly repeat: number,
  ) {}

  /**
   * Add a geometry (already placed) in one colour. `lit`: bake light by facing and height;
   * otherwise it's a lamp and keeps its colour.
   */
  add(g: THREE.BufferGeometry, hex: string, lit = true): void {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.deleteAttribute('uv');
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const col = new Float32Array(pos.count * 3);
    const uv = new Float32Array(pos.count * 2);
    const base = this._c.set(hex);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nor.getX(i));
      const ay = Math.abs(nor.getY(i));
      const az = Math.abs(nor.getZ(i));
      const [u, v] = ay >= ax && ay >= az ? [pos.getX(i), pos.getZ(i)] : ax >= az ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getY(i)];
      uv[i * 2] = u / this.repeat;
      uv[i * 2 + 1] = v / this.repeat;
      let k = 1;
      if (lit) {
        // darker toward the floor, as if the room's light fell off (and corners gathered dirt)
        const y = pos.getY(i);
        k = faceLight(nor.getX(i), nor.getY(i), nor.getZ(i)) * (0.8 + 0.2 * Math.min(1, y / 2.6));
      }
      col[i * 3] = base.r * k;
      col[i * 3 + 1] = base.g * k;
      col[i * 3 + 2] = base.b * k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.parts.push(geo);
  }

  /** An axis-aligned box between two corners. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: string, lit = true): void {
    this.add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), hex, lit);
  }

  build(map: THREE.Texture): THREE.Mesh {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, map, name: this.name }));
    m.name = this.name;
    return m;
  }
}

// --- the surfaces: painted concrete block, and cast concrete's grain -------------------------------

function canvasTexture(draw: (g: CanvasRenderingContext2D, n: number) => void): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  draw(c.getContext('2d')!, n);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A small deterministic generator, so the jail looks the same for everyone and every visit. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Painted block, 0.4 x 0.2 m in running bond: 0.8 m square per repeat (BLOCK_REPEAT). */
function blockTexture(): THREE.CanvasTexture {
  return canvasTexture((g, n) => {
    const r = rng(11);
    const rowH = n / 4;
    const w = n / 2;
    g.fillStyle = '#b7b4ad';
    g.fillRect(0, 0, n, n);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? w / 2 : 0;
      for (let k = -1; k < 3; k++) {
        const x = k * w + off;
        const tone = 236 + Math.floor(r() * 14);
        g.fillStyle = `rgb(${tone},${tone - 1},${tone - 4})`;
        g.fillRect(x + 3, row * rowH + 3, w - 6, rowH - 6);
      }
    }
    // the paint's orange peel
    for (let i = 0; i < 2600; i++) {
      const a = r() * 0.07;
      g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      g.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2);
    }
  });
}
const BLOCK_REPEAT = 0.8;

/** Cast concrete: a fine grain and a few soft blotches, 2 m per repeat. */
function grainTexture(): THREE.CanvasTexture {
  return canvasTexture((g, n) => {
    const r = rng(5);
    g.fillStyle = '#efefef';
    g.fillRect(0, 0, n, n);
    // everything drawn again a tile over wherever it crosses an edge, so the repeats meet unseen
    const wrapped = (x: number, y: number, rad: number, paint: (x: number, y: number) => void) => {
      for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) if (x + dx + rad > 0 && x + dx - rad < n && y + dy + rad > 0 && y + dy - rad < n) paint(x + dx, y + dy);
    };
    for (let i = 0; i < 26; i++) {
      const x = r() * n;
      const y = r() * n;
      const rad = 14 + r() * 36;
      const a = 0.012 + r() * 0.03;
      const tone = r() < 0.5 ? '0,0,0' : '255,255,255';
      wrapped(x, y, rad, (px, py) => {
        const grad = g.createRadialGradient(px, py, 0, px, py, rad);
        grad.addColorStop(0, `rgba(${tone},${a})`);
        grad.addColorStop(1, `rgba(${tone},0)`);
        g.fillStyle = grad;
        g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    for (let i = 0; i < 5000; i++) {
      const a = r() * 0.06;
      g.fillStyle = r() < 0.55 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      g.fillRect(r() * n, r() * n, 1, 1);
    }
  });
}
const GRAIN_REPEAT = 2;

// --- colours -------------------------------------------------------------------------------------

const C = {
  street: '#6d6c68',
  facade: '#8f8c84',
  reveal: '#6f6c66',
  inner: '#b9b5a8',
  lower: '#6e7a73', // the painted band along the bottom of the prison's walls
  ceiling: '#c9c6bd',
  floor: '#83847e',
  hall: '#9a948a',
  yard: '#8e8c85',
  steel: '#5d6166',
  bars: '#3d4146',
  header: '#6a6f6b',
  mattress: '#5d6b78',
  blanket: '#b8622e',
  wood: '#8a7456',
  line: '#c9a227',
  white: '#dcd9d0',
  glass: '#1c2227',
  lamp: '#fff3d6',
  flood: '#ffe9b8',
  wire: '#8b8f93',
  orange: '#c46a2a',
  rim: '#c24e1c',
};

// --- the signs, on one canvas --------------------------------------------------------------------

interface SignSpec {
  text: string;
  sub?: string;
  /** Plate and letter colours. */
  bg: string;
  fg: string;
  /** Centre (world), the size (m), and the way it faces (+x, -x, +z or -z). */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  face: '+x' | '-x' | '+z' | '-z';
}

const SIGNS: SignSpec[] = [
  { text: 'COUNTY DETENTION CENTER', sub: 'VISITORS ENTRANCE', bg: '#20242a', fg: '#e8e2cf', x: B.x0 - 0.02, y: 3.35, z: -25, w: 6.4, h: 0.95, face: '-x' },
  { text: 'NO CONTACT', sub: 'BEYOND THE BARS', bg: '#c9a227', fg: '#16181b', x: 168.9, y: 3.25, z: -20.17, w: 2.6, h: 0.7, face: '-z' },
  { text: 'BOOKING', sub: 'COMMISSARY  ·  BANK', bg: '#2a3a33', fg: '#e7e3d6', x: 175.1, y: 3.15, z: YARD_Z + 0.17, w: 3.0, h: 0.7, face: '+z' },
  { text: 'YARD', bg: '#2a3a33', fg: '#e7e3d6', x: (YARD_DOOR.x0 + YARD_DOOR.x1) / 2, y: 3.2, z: YARD_Z + 0.17, w: 1.6, h: 0.55, face: '+z' },
  { text: 'C BLOCK', sub: 'CELLS 1 - 5', bg: '#2a3a33', fg: '#e7e3d6', x: 183.4, y: 3.25, z: CELLS_Z - 0.12, w: 3.0, h: 0.7, face: '-z' },
];

function signAtlas(signs: SignSpec[]): { texture: THREE.CanvasTexture; cells: { u0: number; v0: number; u1: number; v1: number }[]; draw: () => void } {
  const W = 1024;
  const rowH = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = rowH * signs.length;
  const g = canvas.getContext('2d')!;
  const draw = () => signs.map((s, i) => {
    const y = i * rowH;
    // each sign keeps its own proportions: as wide as the cell allows at the row's height
    const w = Math.min(W, Math.round((rowH * s.w) / s.h));
    g.fillStyle = s.bg;
    g.fillRect(0, y, w, rowH);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 4;
    g.strokeRect(2, y + 2, w - 4, rowH - 4);
    g.fillStyle = s.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const big = s.sub ? rowH * 0.46 : rowH * 0.62;
    g.font = `600 ${big}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    fitText(g, s.text, w * 0.9, big);
    g.fillText(s.text, w / 2, y + (s.sub ? rowH * 0.38 : rowH * 0.53));
    if (s.sub) {
      const small = rowH * 0.24;
      g.font = `600 ${small}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      fitText(g, s.sub, w * 0.9, small);
      g.fillText(s.sub, w / 2, y + rowH * 0.77);
    }
    return { u0: 0, v0: 1 - (y + rowH) / canvas.height, u1: w / W, v1: 1 - y / canvas.height };
  });
  const cells = draw();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, cells, draw };
}

/** Shrink the font until the text fits `max` pixels. */
function fitText(g: CanvasRenderingContext2D, text: string, max: number, size: number): void {
  while (size > 8 && g.measureText(text).width > max) {
    size *= 0.92;
    g.font = g.font.replace(/\d+(\.\d+)?px/, `${size}px`);
  }
}

function signMesh(signs: SignSpec[]): { mesh: THREE.Mesh; texture: THREE.CanvasTexture } {
  const { texture, cells, draw } = signAtlas(signs);
  // the lettering's face may still be on its way: letter it again once it's here
  void document.fonts?.load(`600 40px "Barlow Condensed"`).then(() => {
    draw();
    texture.needsUpdate = true;
  }, () => {});
  const parts = signs.map((s, i) => {
    const q = new THREE.PlaneGeometry(s.w, s.h);
    const uv = q.getAttribute('uv');
    const c = cells[i]!;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, c.u0 + uv.getX(k) * (c.u1 - c.u0), c.v0 + uv.getY(k) * (c.v1 - c.v0));
    const turn = s.face === '+z' ? 0 : s.face === '-z' ? Math.PI : s.face === '+x' ? Math.PI / 2 : -Math.PI / 2;
    q.rotateY(turn).translate(s.x, s.y, s.z);
    return q;
  });
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: texture, name: 'jail-signs' }));
  mesh.name = 'jail-signs';
  return { mesh, texture };
}

// --- the bail board ------------------------------------------------------------------------------

/** The board on the yard wall: what bail is, and (for an inmate) how far along theirs is. */
export class BailBoard {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private key = '';

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 576;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const g = new THREE.PlaneGeometry(BOARD.w, BOARD.h).translate(BOARD.x, BOARD.y, YARD_Z + 0.18);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.texture, name: 'jail-board' }));
    this.mesh.name = 'jail-board';
    this.show(null);
    void document.fonts?.load(`600 40px "Barlow Condensed"`).then(() => {
      const last = this.last;
      this.key = '';
      this.show(last);
    }, () => {});
  }

  private last: JailState | null = null;

  show(jail: JailState | null): void {
    const key = jail ? `${jail.bail}:${jail.won}` : 'none';
    this.last = jail;
    if (key === this.key) return;
    this.key = key;
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#1d211e';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#6a6f6b';
    g.lineWidth = 14;
    g.strokeRect(7, 7, W - 14, H - 14);
    g.fillStyle = '#c9a227';
    g.fillRect(40, 44, W - 80, 86);
    g.fillStyle = '#16181b';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 64px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText('BAIL', W / 2, 89);
    g.fillStyle = '#e7e3d6';
    if (!jail) {
      g.font = '600 50px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillText('Inmates walk out when their winnings', W / 2, 220);
      g.fillText('at these tables reach their bail.', W / 2, 282);
      g.fillStyle = '#9fa39d';
      g.font = '600 36px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillText('Losses never count below zero.  Broke? The bank is at booking.', W / 2, 400);
    } else {
      const k = Math.min(1, jail.won / jail.bail);
      g.font = '600 76px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillText(`WIN ${formatMoney(jail.bail)} TO MAKE BAIL`, W / 2, 210);
      // the progress bar
      const x0 = 80;
      const bw = W - 160;
      g.fillStyle = '#343a36';
      g.fillRect(x0, 290, bw, 58);
      g.fillStyle = '#c9a227';
      g.fillRect(x0, 290, Math.round(bw * k), 58);
      g.strokeStyle = '#6a6f6b';
      g.lineWidth = 4;
      g.strokeRect(x0, 290, bw, 58);
      g.fillStyle = '#e7e3d6';
      g.font = '600 52px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillText(`${formatMoney(jail.won)} won  ·  ${formatMoney(Math.max(0, jail.bail - jail.won))} to go`, W / 2, 420);
      g.fillStyle = '#9fa39d';
      g.font = '600 34px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillText('Losses never count below zero.  Broke? The bank is at booking.', W / 2, 500);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// --- the building ----------------------------------------------------------------------------

export interface Jail {
  group: THREE.Group;
  stations: WorldStation[];
  board: BailBoard;
  /** Where the jail's officers stand: booking, each table, the yard door. */
  posts: { id: string; x: number; z: number; yaw: number }[];
  dispose(): void;
}

export function buildJail(opts: { quality: Quality; collider: Collider }): Jail {
  const col = opts.collider;
  const s = new Solid('jail-solid', GRAIN_REPEAT);
  const blocks = new Solid('jail-blocks', BLOCK_REPEAT);
  const group = new THREE.Group();
  group.name = 'jail';

  /** A wall: a box that the walker and the camera bump into; inside walls are painted block. */
  const wall = (x0: number, x1: number, z0: number, z1: number, y1: number, hex: string, y0 = 0) => {
    (hex === C.inner ? blocks : s).box(x0, x1, y0, y1, z0, z1, hex);
    if (y0 < 1.8) col.box((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0, y1, { cam: true });
  };

  // the lot around the building: pavement, and the sidewalk along the street
  s.box(166, B.x0, 0, FLOOR, -45, -5, C.street);
  s.box(B.x0, 196, 0, FLOOR, -45, B.z0, C.street);
  s.box(B.x0, 196, 0, FLOOR, B.z1, -5, C.street);
  s.box(B.x1, 196, 0, FLOOR, B.z0, B.z1, C.street);
  // the floors: the hall, the prison, the yard (and under the offices, for the walls to stand on)
  s.box(B.x0 + T, BARS_X - 0.15, 0, FLOOR, B.z0 + T, B.z1 - T, C.hall);
  s.box(BARS_X - 0.15, B.x1 - T, 0, FLOOR, YARD_Z - 0.15, B.z1 - T, C.floor);
  s.box(BARS_X - 0.15, B.x1 - T, 0, FLOOR, B.z0 + T, YARD_Z - 0.15, C.yard);

  // --- the shell
  // the front, with the visitors' door
  wall(B.x0, B.x0 + T, B.z0, DOOR.z0, TOP, C.facade);
  wall(B.x0, B.x0 + T, DOOR.z1, B.z1, TOP, C.facade);
  s.box(B.x0, B.x0 + T, DOOR.h, TOP, DOOR.z0, DOOR.z1, C.facade);
  // the back and the two long sides (these run the full length; the rest butt between them)
  wall(B.x1 - T, B.x1, B.z0, B.z1, TOP, C.facade);
  wall(B.x0 + T, B.x1 - T, B.z1 - T, B.z1, TOP, C.facade);
  wall(B.x0 + T, B.x1 - T, B.z0, B.z0 + T, TOP + 0.6, C.facade);
  // the roof over everything but the yard
  s.box(B.x0 + T, B.x1 - T, CEIL, CEIL + 0.3, YARD_Z + 0.15, B.z1 - T, C.ceiling);
  // the yard wall: with the day room behind it, a doorway through it
  wall(B.x0 + T, YARD_DOOR.x0, YARD_Z - 0.15, YARD_Z + 0.15, TOP, C.inner);
  wall(YARD_DOOR.x1, B.x1 - T, YARD_Z - 0.15, YARD_Z + 0.15, TOP, C.inner);
  blocks.box(YARD_DOOR.x0, YARD_DOOR.x1, 2.6, TOP, YARD_Z - 0.15, YARD_Z + 0.15, C.inner);
  // the hall's far wall (toward the cells) and the offices' walls on the bars' line
  wall(B.x0 + T, BARS_X - 0.15, -20.15, -19.85, CEIL, C.inner);
  wall(BARS_X - 0.15, BARS_X + 0.15, B.z0 + T, YARD_Z - 0.15, TOP, C.inner);
  wall(BARS_X - 0.15, BARS_X + 0.15, -19.85, B.z1 - T, CEIL, C.inner);
  // the painted band along the bottom of the prison's walls (proud of them by a centimetre)
  s.box(BARS_X + 0.15, B.x1 - T - 0.01, FLOOR, 1.2, YARD_Z + 0.15, YARD_Z + 0.16, C.lower);
  s.box(B.x1 - T - 0.01, B.x1 - T, FLOOR, 1.2, YARD_Z + 0.16, CELLS_Z, C.lower);

  // --- the facade from the street
  for (const y of [1.2, 2.4, 3.6]) s.box(B.x0 - 0.02, B.x0, y, y + 0.05, B.z0, B.z1, C.reveal);
  for (const z of [-38, -34, -16, -12]) slitWindow(s, z);
  // floodlights over the door and at the corners
  for (const z of [-27.2, -22.8, B.z0 + 0.6, B.z1 - 0.6]) {
    s.box(B.x0 - 0.35, B.x0, 3.95, 4.15, z - 0.2, z + 0.2, C.steel);
    s.box(B.x0 - 0.34, B.x0 - 0.02, 3.93, 3.95, z - 0.18, z + 0.18, C.flood, false);
  }
  // the door's steel frame, and a door standing open inward
  s.box(B.x0 - 0.04, B.x0 + T + 0.02, 0, DOOR.h, DOOR.z0 - 0.06, DOOR.z0, C.steel);
  s.box(B.x0 - 0.04, B.x0 + T + 0.02, 0, DOOR.h, DOOR.z1, DOOR.z1 + 0.06, C.steel);
  s.box(B.x0 - 0.04, B.x0 + T + 0.02, DOOR.h - 0.06, DOOR.h, DOOR.z0, DOOR.z1, C.steel);
  s.box(B.x0 + T + 0.02, B.x0 + T + 0.07, FLOOR, DOOR.h - 0.08, DOOR.z1 - 0.02 - 1.0, DOOR.z1 - 0.02, C.steel);
  // razor wire along the top of the yard's walls
  razorWire(s, [
    [BARS_X, TOP + 0.6, B.z0 + 0.15, B.x1 - 0.15, B.z0 + 0.15],
    [B.x1 - 0.15, TOP, B.z0 + 0.15, B.x1 - 0.15, YARD_Z],
    [BARS_X, TOP, B.z0 + 0.15, BARS_X, YARD_Z],
  ]);

  // --- the visitors' hall
  // the bars between the hall and the prison, a steel header over them
  bars(s, col, 'z', BARS_X, -29.85, -20.15, 2.8);
  s.box(BARS_X - 0.08, BARS_X + 0.08, 2.8, CEIL, -29.85, -20.15, C.header);
  // benches along the side walls, a yellow line not to cross
  bench(s, col, B.x0 + 0.9, -29.4, 2.4, 'x');
  bench(s, col, B.x0 + 0.9, -20.6, 2.4, 'x');
  s.box(BARS_X - 0.75, BARS_X - 0.65, FLOOR, FLOOR + 0.012, -29.85, -20.15, C.line);
  ceilingLights(s, [[169.6, -25]]);

  // --- booking: the counter (the bank's window), a clock over it
  s.box(COUNTER.x0, COUNTER.x1, FLOOR, 1.02, COUNTER.z0, COUNTER.z1, '#5e6166');
  s.box(COUNTER.x0 - 0.04, COUNTER.x1 + 0.04, 1.02, 1.07, COUNTER.z0 - 0.04, COUNTER.z1 + 0.1, C.wood);
  col.box((COUNTER.x0 + COUNTER.x1) / 2, (COUNTER.z0 + COUNTER.z1) / 2, COUNTER.x1 - COUNTER.x0, COUNTER.z1 - COUNTER.z0, 0, 1.07, { cam: false });
  // a monitor and a tray of forms on it
  s.box(173.6, 174.1, 1.07, 1.1, -28.2, -27.95, C.steel);
  s.box(173.7, 174.0, 1.1, 1.4, -28.1, -28.06, '#15181b');
  s.box(176.1, 176.5, 1.07, 1.11, -28.25, -27.95, C.white);
  clock(s, 176.8, 2.7, YARD_Z + 0.16);

  // --- the day room: the tables' stools, a steel table bolted down, lights
  s.box(176.4, 177.8, FLOOR, 0.74, -18.6, -17.8, C.steel);
  col.box(177.1, -18.2, 1.4, 0.8, 0, 0.78, { cam: false });
  for (const [x, z] of [
    [176.7, -19.1],
    [177.5, -19.1],
    [176.7, -17.3],
    [177.5, -17.3],
  ] as const)
    stool(s, x, z);
  // the painted walkway in front of the cells
  s.box(BARS_X + 0.15, B.x1 - T, FLOOR, FLOOR + 0.012, CELLS_Z - 2.05, CELLS_Z - 1.95, C.line);
  ceilingLights(s, [
    [176, -24],
    [183.4, -24],
    [190.8, -24],
    [176, -18.5],
    [183.4, -18.5],
    [190.8, -18.5],
  ]);

  // --- the cells
  bars(s, col, 'x', CELLS_Z, BARS_X + 0.15, B.x1 - T, 2.6, (x) => CELL_X.slice(0, 5).some((c0) => x > c0 + 0.35 && x < c0 + 1.35));
  s.box(BARS_X + 0.15, B.x1 - T, 2.6, CEIL, CELLS_Z - 0.08, CELLS_Z + 0.08, C.header);
  for (let i = 1; i < CELL_X.length - 1; i++) wall(CELL_X[i]! - 0.1, CELL_X[i]! + 0.1, CELLS_Z + 0.08, B.z1 - T, CEIL, C.inner);
  for (let i = 0; i < 5; i++) {
    const c0 = CELL_X[i]! + (i === 0 ? 0 : 0.1);
    const c1 = CELL_X[i + 1]! - (i === 4 ? 0 : 0.1);
    cell(s, col, c0, c1, i);
    // the door, slid open behind the bars beside the doorway
    bars(s, null, 'x', CELLS_Z - 0.12, c0 + 1.4, c0 + 2.4, 2.3);
  }

  // --- the yard
  hoop(s, col, 183.4);
  // the key painted on the concrete
  const kz = B.z0 + T;
  s.box(181.6, 185.2, FLOOR, FLOOR + 0.012, kz + 4.2, kz + 4.3, C.white);
  s.box(181.6, 181.7, FLOOR, FLOOR + 0.012, kz, kz + 4.2, C.white);
  s.box(185.1, 185.2, FLOOR, FLOOR + 0.012, kz, kz + 4.2, C.white);
  bench(s, col, B.x1 - 1.0, -36.5, 3.0, 'z');
  bench(s, col, 174.4, -35.5, 3.0, 'z');
  pullUp(s, col, 177.5, -38.6);

  // the jail's tables: the games' own models, a stool at each seat
  const stations: WorldStation[] = [];
  const posts: Jail['posts'] = [];
  for (const g of JAIL_GAMES) {
    const at = TABLE_AT[g.station]!;
    const variant = variantOf(g.game, g.variant);
    const mod = GAMES[g.game];
    const anchor = new THREE.Group();
    anchor.name = `station:${g.station}`;
    anchor.position.set(at.x, 0, at.z);
    const model = mod.createModel({ variant, quality: opts.quality });
    anchor.add(model);
    group.add(anchor);
    const fp = mod.footprint;
    col.box(at.x, at.z, fp.width, fp.depth, 0, 1.0, { cam: false });
    // blackjack's players sit; Sic Bo's stand at the rail
    if (g.game === 'blackjack') for (const seat of mod.seats(variant)) stool(s, at.x + seat.position[0], at.z + seat.position[2]);
    stations.push({
      id: g.station,
      game: g.game,
      variant,
      anchor,
      footprint: fp,
      zone: 'pit',
      name: g.game === 'blackjack' ? 'Jail Blackjack' : 'Jail Sic Bo',
      limits: 'Win your bail',
      model,
      yaw: 0,
      room: 'pit' as RoomId,
    });
    posts.push({ id: `officer-${g.station}`, x: at.x, z: at.z - fp.depth / 2 - 0.42, yaw: 0 });
  }
  posts.push({ id: 'officer-booking', x: 175.1, z: -29.15, yaw: 0 });
  posts.push({ id: 'officer-yard', x: YARD_DOOR.x1 + 0.55, z: YARD_Z + 0.65, yaw: 0.35 });

  const grain = grainTexture();
  const block = blockTexture();
  const solid = s.build(grain);
  const blockMesh = blocks.build(block);
  group.add(solid, blockMesh);
  // each cell's number over its door
  const numbers: SignSpec[] = CELL_X.slice(0, 5).map((c0, i) => ({ text: String(i + 1), bg: '#dcd9d0', fg: '#1d211e', x: c0 + 0.85 + (i === 0 ? 0 : 0.1), y: 2.84, z: CELLS_Z - 0.09, w: 0.34, h: 0.26, face: '-z' }));
  const signs = signMesh([...SIGNS, ...numbers]);
  group.add(signs.mesh);
  const board = new BailBoard();
  group.add(board.mesh);

  return {
    group,
    stations,
    board,
    posts,
    dispose() {
      for (const m of [solid, blockMesh]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      grain.dispose();
      block.dispose();
      signs.mesh.geometry.dispose();
      (signs.mesh.material as THREE.Material).dispose();
      signs.texture.dispose();
      board.dispose();
      group.removeFromParent();
    },
  };
}

// --- pieces ------------------------------------------------------------------------------------

/**
 * A run of bars along x (at z = `c`) or along z (at x = `c`) from a0 to a1, `h` high, with flat
 * bars across; `gap` leaves some out (a doorway). Into the collider as one box per unbroken run.
 */
function bars(s: Solid, col: Collider | null, along: 'x' | 'z', c: number, a0: number, a1: number, h: number, gap: (a: number) => boolean = () => false): void {
  const pitch = 0.13;
  const r = 0.018;
  let run: number | null = null;
  const close = (end: number) => {
    if (run === null) return;
    if (col) {
      if (along === 'x') col.box((run + end) / 2, c, end - run, 0.1, 0, h, { cam: false });
      else col.box(c, (run + end) / 2, 0.1, end - run, 0, h, { cam: false });
    }
    // the flat bars across, at a hand's height and near the top
    for (const y of [1.0, h - 0.25]) {
      if (along === 'x') s.box(run, end, y, y + 0.05, c - 0.03, c + 0.03, C.bars);
      else s.box(c - 0.03, c + 0.03, y, y + 0.05, run, end, C.bars);
    }
    run = null;
  };
  for (let a = a0 + pitch / 2; a < a1; a += pitch) {
    if (gap(a)) {
      close(a - pitch / 2);
      continue;
    }
    run ??= a - pitch / 2;
    if (along === 'x') s.box(a - r, a + r, FLOOR, h, c - r, c + r, C.bars);
    else s.box(c - r, c + r, FLOOR, h, a - r, a + r, C.bars);
  }
  close(a1);
}

function bench(s: Solid, col: Collider, x: number, z: number, len: number, along: 'x' | 'z'): void {
  const [w, d] = along === 'x' ? [len, 0.42] : [0.42, len];
  s.box(x - w / 2, x + w / 2, 0.42, 0.47, z - d / 2, z + d / 2, C.steel);
  for (const k of [-0.4, 0.4]) {
    const px = along === 'x' ? x + k * len : x;
    const pz = along === 'z' ? z + k * len : z;
    s.box(px - 0.05, px + 0.05, FLOOR, 0.42, pz - 0.15, pz + 0.15, C.bars);
  }
  col.box(x, z, w, d, 0, 0.47, { cam: false });
}

function stool(s: Solid, x: number, z: number): void {
  s.add(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 12).translate(x, 0.66, z), C.steel);
  s.add(new THREE.CylinderGeometry(0.035, 0.05, 0.63, 8).translate(x, FLOOR + 0.315, z), C.bars);
}

function ceilingLights(s: Solid, at: [number, number][]): void {
  for (const [x, z] of at) {
    s.box(x - 0.65, x + 0.65, CEIL - 0.06, CEIL, z - 0.18, z + 0.18, C.steel);
    s.box(x - 0.6, x + 0.6, CEIL - 0.07, CEIL - 0.06, z - 0.13, z + 0.13, C.lamp, false);
  }
}

function slitWindow(s: Solid, z: number): void {
  s.box(B.x0 - 0.03, B.x0, 1.6, 3.1, z - 0.22, z + 0.22, C.glass, false);
  for (const dz of [-0.11, 0, 0.11]) s.box(B.x0 - 0.06, B.x0 - 0.03, 1.6, 3.1, z + dz - 0.012, z + dz + 0.012, C.bars);
  s.box(B.x0 - 0.1, B.x0, 1.54, 1.6, z - 0.3, z + 0.3, C.reveal);
}

function clock(s: Solid, x: number, y: number, z: number): void {
  s.add(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 20).rotateX(Math.PI / 2).translate(x, y, z + 0.025), C.white);
  s.box(x - 0.012, x + 0.012, y, y + 0.15, z + 0.05, z + 0.06, '#15181b');
  s.box(x, x + 0.11, y - 0.012, y + 0.012, z + 0.05, z + 0.06, '#15181b');
}

/** One cell: a two-high bunk on the back wall, a steel toilet and basin by the bars, a shelf. */
function cell(s: Solid, col: Collider, x0: number, x1: number, i: number): void {
  const back = JAIL.building.z1 - T;
  const bx0 = x1 - 2.2;
  const bx1 = x1 - 0.2;
  const bz0 = back - 0.95;
  for (const [x, z] of [
    [bx0, bz0],
    [bx1, bz0],
    [bx0, back - 0.05],
    [bx1, back - 0.05],
  ] as const)
    s.box(x - 0.04, x + 0.04, FLOOR, 1.85, z - 0.04, z + 0.04, C.steel);
  for (const y of [0.4, 1.5]) {
    s.box(bx0, bx1, y, y + 0.06, bz0, back - 0.05, C.steel);
    s.box(bx0 + 0.04, bx1 - 0.04, y + 0.06, y + 0.2, bz0 + 0.04, back - 0.09, C.mattress);
  }
  // a folded blanket on the lower bunk (a different place in each cell)
  const fx = bx0 + 0.3 + (i % 3) * 0.5;
  s.box(fx, fx + 0.45, 0.66, 0.74, bz0 + 0.12, back - 0.2, C.blanket);
  col.box((bx0 + bx1) / 2, (bz0 + back) / 2, bx1 - bx0, back - bz0, 0, 1.9, { cam: false });
  // the toilet and the basin against the side wall, by the bars
  const tx = x0 + 0.35;
  const tz = CELLS_Z + 1.3;
  s.box(tx - 0.2, tx + 0.2, FLOOR, 0.42, tz - 0.25, tz + 0.25, '#a8adb1');
  s.box(tx - 0.2, tx + 0.2, 0.42, 0.9, tz + 0.25, tz + 0.4, '#a8adb1');
  s.box(tx - 0.2, tx + 0.2, 0.9, 1.05, tz + 0.2, tz + 0.45, '#b7bcc0');
  col.box(tx, tz + 0.08, 0.4, 0.66, 0, 1.05, { cam: false });
  // a shelf on the back wall with a cup and a book
  s.box(x0 + 0.3, x0 + 1.2, 1.35, 1.38, back - 0.28, back, C.steel);
  s.box(x0 + 0.4, x0 + 0.48, 1.38, 1.48, back - 0.2, back - 0.12, C.orange);
  s.box(x0 + 0.7, x0 + 0.94, 1.38, 1.42, back - 0.22, back - 0.06, '#35506e');
}

/** The yard's basketball hoop on the far wall: pole, backboard, orange rim. */
function hoop(s: Solid, col: Collider, x: number): void {
  const wz = JAIL.building.z0 + T;
  s.box(x - 0.07, x + 0.07, FLOOR, 3.35, wz + 0.1, wz + 0.24, C.steel);
  s.box(x - 0.05, x + 0.05, 2.95, 3.05, wz + 0.24, wz + 0.95, C.steel);
  s.box(x - 0.9, x + 0.9, 2.6, 3.65, wz + 0.95, wz + 1.0, C.white);
  s.box(x - 0.3, x + 0.3, 2.7, 3.08, wz + 1.0, wz + 1.005, '#b33f1a');
  s.add(new THREE.TorusGeometry(0.23, 0.012, 6, 20).rotateX(Math.PI / 2).translate(x, 3.05, wz + 1.25), C.rim);
  col.box(x, wz + 0.17, 0.2, 0.2, 0, 3.4, { cam: false });
}

function pullUp(s: Solid, col: Collider, x: number, z: number): void {
  for (const dx of [-0.7, 0.7]) {
    s.box(x + dx - 0.04, x + dx + 0.04, FLOOR, 2.3, z - 0.04, z + 0.04, C.steel);
    col.box(x + dx, z, 0.1, 0.1, 0, 2.3, { cam: false });
  }
  s.add(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 8).rotateZ(Math.PI / 2).translate(x, 2.25, z), C.bars);
}

/** Coils of razor wire along the tops of walls: [x0, y (the wall's top), z0, x1, z1] runs. */
function razorWire(s: Solid, runs: [number, number, number, number, number][]): void {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x0, y0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const turns = Math.round(len / 0.2);
    const pts: THREE.Vector3[] = [];
    const R = 0.2;
    const steps = turns * 6;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const a = (i / 6) * Math.PI * 2;
      const along = new THREE.Vector3(x0 + (x1 - x0) * k, y0 + R + 0.02, z0 + (z1 - z0) * k);
      // the coil's circle is square to the run
      const side = new THREE.Vector3(-(z1 - z0) / len, 0, (x1 - x0) / len);
      pts.push(along.addScaledVector(side, Math.cos(a) * R).add(new THREE.Vector3(0, Math.sin(a) * R, 0)));
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, 0.007, 3));
  }
  for (const p of parts) s.add(p, C.wire);
}
