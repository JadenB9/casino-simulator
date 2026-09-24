// The shell of every room: its floor (carpet, marble, planks or concrete) with runners along its
// walkways, its walls (each side of a wall in its own room's dress: damask or panels above a
// wainscot, a brass chair rail, a crown at its own ceiling), the casings round its doorways, shop
// windows, and its ceiling: low panels with downlights, a tray washed by a hidden cove, the pit's
// stepped-up coffers, or the yard's steel trusses. Everything here is static and goes into the
// batch, each room into its own part of it.

import * as THREE from 'three';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { GLOW, type GlowMerge } from './lighting.ts';
import { PIT_CEILING, WALL, inRect, type FloorPlan, type PlannedDoor, type PlannedRoom, type Rect, type WallPiece } from './layout.ts';

const FLOOR_Y = 0.004;

export interface Chandelier {
  x: number;
  /** Its top, at the ceiling. */
  y: number;
  z: number;
  /** How tall it hangs. */
  size: number;
  room: string;
}

export interface Downlight {
  x: number;
  z: number;
  room: string;
}

/** The cove's glow for each kind of room. */
const COVES = {
  warm: GLOW.warm,
  amber: new THREE.Color('#ffab5a').multiplyScalar(2.3),
  cool: new THREE.Color('#58d2ff').multiplyScalar(2.0),
  neon: new THREE.Color('#ff47b8').multiplyScalar(2.1),
};

export function buildRoom(plan: FloorPlan, b: Batch, m: Mats, glow: GlowMerge): { chandeliers: Chandelier[]; downlights: Downlight[] } {
  const chandeliers: Chandelier[] = [];
  const downlights: Downlight[] = [];
  const brass = m.get('brass');
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));

  for (const r of plan.rooms) {
    b.room = r.id;
    glow.room = r.id;
    floor(r);
    ceiling(r);
  }
  for (const w of plan.wallPieces) {
    for (const side of ['neg', 'pos'] as const) {
      const id = w[side];
      if (!id) continue;
      const r = byId.get(id)!;
      b.room = r.id;
      glow.room = r.id;
      wall(w, side, r, !w[side === 'neg' ? 'pos' : 'neg']);
    }
  }
  for (const d of plan.doors) {
    for (const side of ['a', 'b'] as const) {
      const id = d[side];
      if (id === 'outside') continue;
      const r = byId.get(id)!;
      b.room = r.id;
      glow.room = r.id;
      casing(d, r);
    }
    // the threshold through the wall, in the first room's part
    if (d.b !== 'outside') {
      b.room = d.a;
      const t = d.rect;
      const th = d.axis === 'x' ? { x0: d.a0, x1: d.a1, z0: d.c - WALL / 2 - 0.02, z1: d.c + WALL / 2 + 0.02 } : { x0: d.c - WALL / 2 - 0.02, x1: d.c + WALL / 2 + 0.02, z0: d.a0, z1: d.a1 };
      flat(th, m.get(d.kind === 'industrial' ? 'steel' : 'marble-black'), 1.2, FLOOR_Y + 0.002);
      void t;
    }
  }
  for (const w of plan.windows) {
    b.room = w.pos;
    shopWindow(w);
  }
  columns();
  return { chandeliers, downlights };

  // --- floors ------------------------------------------------------------------------------------

  function flat(r: Rect, mat: THREE.Material, uv: number, y = FLOOR_Y): void {
    const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
    b.add(g, mat, new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2)), uv);
  }

  function floor(r: PlannedRoom): void {
    const s = r.style;
    flat(r.inner, m.get(s.floor), s.floorUv, 0);
    const carpeted = s.floor.startsWith('carpet');
    for (const a of r.runners) {
      // a carpet runner on marble or boards, a patterned aisle on carpet; brass edging either way
      flat(a, m.get(carpeted ? 'carpet-aisle' : r.id === 'lobby' ? 'carpet' : 'carpet-aisle'), carpeted ? 1.2 : 2.4, FLOOR_Y + 0.001);
      const edges: Rect[] = [
        { x0: a.x0, x1: a.x1, z0: a.z0 - 0.02, z1: a.z0 + 0.02 },
        { x0: a.x0, x1: a.x1, z0: a.z1 - 0.02, z1: a.z1 + 0.02 },
        { x0: a.x0 - 0.02, x1: a.x0 + 0.02, z0: a.z0, z1: a.z1 },
        { x0: a.x1 - 0.02, x1: a.x1 + 0.02, z0: a.z0, z1: a.z1 },
      ];
      for (const e of edges) {
        // trimmed to the room, so an edge never shows through a wall
        const x0 = Math.max(e.x0, r.inner.x0);
        const x1 = Math.min(e.x1, r.inner.x1);
        const z0 = Math.max(e.z0, r.inner.z0);
        const z1 = Math.min(e.z1, r.inner.z1);
        if (x1 > x0 && z1 > z0) b.box(brass, (x0 + x1) / 2, 0.006, (z0 + z1) / 2, x1 - x0, 0.006, z1 - z0);
      }
    }
    if (r.id === 'lobby') compass((r.inner.x0 + r.inner.x1) / 2, (r.inner.z0 + r.inner.z1) / 2 - 1.2);
    if (r.id === 'bar') {
      // the bartenders' side of the bar is dark boards, the customers' a rug of the floor's carpet
      const bar = plan.bar;
      flat({ x0: bar.front + bar.depth, x1: bar.wall, z0: bar.z0 - 0.4, z1: bar.z1 + 0.4 }, m.get('wood'), 1.4, FLOOR_Y + 0.001);
    }
  }

  /** A brass compass rose set into the lobby's marble. */
  function compass(x: number, z: number): void {
    const black = m.get('marble-black');
    const ring = (r0: number, r1: number, mat: THREE.Material, y: number) => b.add(new THREE.RingGeometry(r0, r1, 64), mat, new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, y, z)));
    ring(1.3, 1.36, brass, 0.007);
    ring(1.05, 1.3, black, 0.006);
    ring(0.99, 1.05, brass, 0.007);
    const star = new THREE.Shape();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = i % 4 === 0 ? 0.98 : i % 2 === 0 ? 0.5 : 0.2;
      if (i === 0) star.moveTo(Math.sin(a) * rr, Math.cos(a) * rr);
      else star.lineTo(Math.sin(a) * rr, Math.cos(a) * rr);
    }
    b.add(new THREE.ShapeGeometry(star), brass, new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, 0.008, z)));
  }

  // --- walls -------------------------------------------------------------------------------------

  /**
   * One room's half of a wall: from the centre line to its face (the whole thickness when the
   * other side is the street), up to its own ceiling, with its trims on a full-height stretch.
   */
  function wall(w: WallPiece, side: 'neg' | 'pos', r: PlannedRoom, outer: boolean): void {
    const s = r.style;
    const n = side === 'neg' ? -1 : 1;
    const top = Math.min(w.y1, s.ceiling);
    const y0 = w.y0;
    if (top <= y0 + 0.001) return;
    const len = w.a1 - w.a0;
    const mid = (w.a0 + w.a1) / 2;
    const thick = outer ? WALL : WALL / 2;
    // centre across the wall of this half, and a point proud of the face by d
    const across = w.c + n * (WALL / 2 - thick / 2);
    const face = (d: number) => w.c + n * (WALL / 2 + d / 2);
    const piece = (mat: THREE.Material, y0: number, y1: number, depth: number, off: number | null, uv?: number) => {
      const cz = off === null ? across : face(depth);
      if (w.axis === 'x') b.box(mat, mid, (y0 + y1) / 2, cz, len, y1 - y0, off === null ? thick : depth, uv);
      else b.box(mat, cz, (y0 + y1) / 2, mid, off === null ? thick : depth, y1 - y0, len, uv);
    };
    piece(m.get(s.wall), y0, top, thick, null, s.wall === 'corrugated' ? 2.4 : 1.6);
    const full = y0 === 0 && top >= s.ceiling - 0.001;
    const sill = y0 === 0 && !full;
    const rail = m.get(s.rail);
    if (full) {
      if (s.wainscot) piece(m.get(s.wainscot), 0, 1.12, 0.04, 0, 2.2);
      if (s.wall === 'corrugated') {
        // the yard: a steel kick plate and a timber rail instead of a wainscot
        piece(m.get('steel'), 0, 0.3, 0.03, 0);
        piece(m.get('planks'), 1.0, 1.16, 0.06, 0, 1.2);
      } else {
        piece(rail, 1.1, 1.16, 0.07, 0);
        piece(m.get('lacquer'), 0, 0.14, 0.06, 0);
      }
    }
    if (sill) {
      piece(m.get('lacquer'), 0, 0.14, 0.06, 0);
      piece(m.get('marble-black'), top - 0.04, top, 0.1, 0, 1.4);
    }
    if (top >= s.ceiling - 0.001 && s.kind !== 'truss') {
      piece(m.get('beam'), s.ceiling - 0.16, s.ceiling, 0.1, 0, 1.5);
      piece(rail, s.ceiling - 0.19, s.ceiling - 0.16, 0.12, 0);
    }
  }

  /** The casing round a doorway on one room's face, dressed for the kind of door. */
  function casing(d: PlannedDoor, r: PlannedRoom): void {
    // which way is into this room from the wall: -1 for the north/west room
    const n = d.axis === 'x' ? (r.bounds.z1 === d.c ? -1 : 1) : r.bounds.x1 === d.c ? -1 : 1;
    const faceAt = (proud: number) => d.c + n * (WALL / 2 + proud / 2);
    const part = (mat: THREE.Material, a: number, y: number, along: number, h: number, proud: number, uv?: number) => {
      if (d.axis === 'x') b.box(mat, a, y, faceAt(proud), along, h, proud, uv);
      else b.box(mat, faceAt(proud), y, a, proud, h, along, uv);
    };
    const w = d.a1 - d.a0;
    const mid = (d.a0 + d.a1) / 2;
    const h = d.height;
    const ceiling = r.style.ceiling;
    if (d.kind === 'grand') {
      // marble pilasters and a deep entablature with a brass band
      const black = m.get('marble-black');
      for (const a of [d.a0 - 0.28, d.a1 + 0.28]) {
        part(black, a, h / 2, 0.56, h, 0.1, 1.4);
        part(brass, a, 0.1, 0.62, 0.2, 0.14);
        part(brass, a, h - 0.1, 0.62, 0.12, 0.14);
      }
      const eh = Math.min(0.5, ceiling - h - 0.02);
      if (eh > 0.1) {
        part(black, mid, h + eh / 2, w + 1.16, eh, 0.12, 1.4);
        part(brass, mid, h + eh / 2, w + 1.2, 0.06, 0.16);
      }
      return;
    }
    if (d.kind === 'industrial' && r.style.wall === 'corrugated') {
      // the yard's side: a steel frame with hazard stripes on the jambs
      const steel = m.get('steel');
      for (const a of [d.a0 - 0.12, d.a1 + 0.12]) part(steel, a, h / 2, 0.24, h, 0.12);
      part(steel, mid, h + 0.12, w + 0.48, 0.24, 0.14);
      const stripe = m.get('brass');
      for (const a of [d.a0 - 0.12, d.a1 + 0.12]) for (let y = 0.3; y < h - 0.2; y += 0.5) part(stripe, a, y, 0.25, 0.18, 0.13);
      return;
    }
    if (d.kind === 'entrance') {
      // brass round the street door (door.glb stands in it)
      part(brass, mid, h + 0.05, w + 0.3, 0.1, 0.08);
      for (const a of [d.a0 - 0.1, d.a1 + 0.1]) part(brass, a, h / 2, 0.14, h, 0.08);
      return;
    }
    // portals, arches and shop doors: a dark wood architrave with a brass bead; an arch gets
    // marble pilasters and a keystone
    const wood = m.get('beam');
    const jamb = d.kind === 'arch' ? 0.3 : 0.16;
    const mat = d.kind === 'arch' ? m.get('marble-black') : d.kind === 'shopfront' ? brass : wood;
    for (const a of [d.a0 - jamb / 2, d.a1 + jamb / 2]) part(mat, a, h / 2, jamb, h, 0.07, 1.2);
    const head = Math.min(d.kind === 'arch' ? 0.36 : 0.2, ceiling - h - 0.02);
    if (head > 0.04) part(mat, mid, h + head / 2, w + 2 * jamb, head, 0.08, 1.2);
    if (d.kind !== 'shopfront') {
      for (const a of [d.a0 - 0.012, d.a1 + 0.012]) part(brass, a, h / 2, 0.024, h, 0.09);
      part(brass, mid, h + 0.012, w + 0.05, 0.024, 0.09);
    }
    if (d.kind === 'arch' && head > 0.2) part(brass, mid, h + head / 2, 0.3, head * 0.9, 0.11);
  }

  /** A shop window: clear glass between brass mullions, over the sill the wall pieces left. */
  function shopWindow(w: FloorPlan['windows'][number]): void {
    const glass = m.get('glass');
    const len = w.a1 - w.a0;
    const mid = (w.a0 + w.a1) / 2;
    const h = w.y1 - w.y0;
    const at = (a: number, y: number) => (w.axis === 'x' ? { x: a, y, z: w.c } : { x: w.c, y, z: a });
    const g = new THREE.PlaneGeometry(len, h);
    const p = at(mid, (w.y0 + w.y1) / 2);
    b.add(g, glass, { ...p, ry: w.axis === 'x' ? 0 : Math.PI / 2 });
    const panes = Math.max(1, Math.round(len / 1.3));
    for (let i = 0; i <= panes; i++) {
      const a = w.a0 + (i * len) / panes;
      const q = at(a, (w.y0 + w.y1) / 2);
      if (w.axis === 'x') b.box(brass, q.x, q.y, q.z, 0.06, h, 0.1);
      else b.box(brass, q.x, q.y, q.z, 0.1, h, 0.06);
    }
    for (const y of [w.y0 + 0.02, w.y1 - 0.02]) {
      const q = at(mid, y);
      if (w.axis === 'x') b.box(brass, q.x, q.y, q.z, len, 0.05, 0.12);
      else b.box(brass, q.x, q.y, q.z, 0.12, 0.05, len);
    }
  }

  // --- ceilings --------------------------------------------------------------------------------

  function under(rect: Rect, mat: THREE.Material, y: number, uv = 2.4): void {
    if (rect.x1 - rect.x0 < 0.01 || rect.z1 - rect.z0 < 0.01) return;
    const g = new THREE.PlaneGeometry(rect.x1 - rect.x0, rect.z1 - rect.z0);
    b.add(g, mat, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation((rect.x0 + rect.x1) / 2, y, (rect.z0 + rect.z1) / 2)), uv);
  }

  /** Recessed downlights on a grid over a rect, skipping `hole`, trimmed in brass. */
  function lights(r: PlannedRoom, rect: Rect, y: number, pitch: number, hole: Rect | null): void {
    const disc = new THREE.CircleGeometry(0.06, 16);
    const ring = new THREE.RingGeometry(0.06, 0.1, 20);
    const nx = Math.max(1, Math.round((rect.x1 - rect.x0) / pitch));
    const nz = Math.max(1, Math.round((rect.z1 - rect.z0) / pitch));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = rect.x0 + ((i + 0.5) * (rect.x1 - rect.x0)) / nx;
        const z = rect.z0 + ((j + 0.5) * (rect.z1 - rect.z0)) / nz;
        if (hole && inRect(hole, x, z, 0.5)) continue;
        const at = new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, y - 0.004, z));
        glow.add(disc, GLOW.bulb, at);
        b.add(ring, brass, at);
        downlights.push({ x, z, room: r.id });
      }
    }
  }

  function ceiling(r: PlannedRoom): void {
    const s = r.style;
    const I = r.inner;
    const mat = m.get(s.ceilingMat);
    const cove = s.cove ? COVES[s.cove] : null;
    if (s.kind === 'coffer') return coffers(r);
    if (s.kind === 'truss') return trusses(r);
    if (s.kind === 'panels') {
      under(I, mat, s.ceiling);
      if (s.downlights > 0) lights(r, { x0: I.x0 + 0.4, x1: I.x1 - 0.4, z0: I.z0 + 0.4, z1: I.z1 - 0.4 }, s.ceiling, s.downlights, null);
      // a glowing strip along the top of the walls, above the crown
      if (cove) for (const e of edges(I, 0.12)) glow.box(cove, e.x, s.ceiling - 0.21, e.z, e.w, 0.02, e.d);
      return;
    }
    // a tray: a lower band round the walls, the middle raised, a hidden cove washing it
    const band = Math.min(1.3, (I.x1 - I.x0) / 5, (I.z1 - I.z0) / 5);
    const drop = 0.42;
    const low = s.ceiling - drop;
    const inner: Rect = { x0: I.x0 + band, x1: I.x1 - band, z0: I.z0 + band, z1: I.z1 - band };
    under({ x0: I.x0, x1: I.x1, z0: I.z0, z1: inner.z0 }, mat, low);
    under({ x0: I.x0, x1: I.x1, z0: inner.z1, z1: I.z1 }, mat, low);
    under({ x0: I.x0, x1: inner.x0, z0: inner.z0, z1: inner.z1 }, mat, low);
    under({ x0: inner.x1, x1: I.x1, z0: inner.z0, z1: inner.z1 }, mat, low);
    under(inner, mat, s.ceiling);
    const fascia = m.get('fascia');
    const wood = m.get('beam');
    const sides = [
      { cx: (inner.x0 + inner.x1) / 2, cz: inner.z0, len: inner.x1 - inner.x0, ry: 0, n: [0, 1] },
      { cx: (inner.x0 + inner.x1) / 2, cz: inner.z1, len: inner.x1 - inner.x0, ry: Math.PI, n: [0, -1] },
      { cx: inner.x0, cz: (inner.z0 + inner.z1) / 2, len: inner.z1 - inner.z0, ry: Math.PI / 2, n: [1, 0] },
      { cx: inner.x1, cz: (inner.z0 + inner.z1) / 2, len: inner.z1 - inner.z0, ry: -Math.PI / 2, n: [-1, 0] },
    ] as const;
    for (const sd of sides) {
      b.add(new THREE.PlaneGeometry(sd.len, drop), fascia, { x: sd.cx, y: low + drop / 2, z: sd.cz, ry: sd.ry });
      const along = sd.n[1] !== 0;
      // the lip that hides the strip: wood, a brass edge
      const lx = sd.cx - sd.n[0] * 0.09;
      const lz = sd.cz - sd.n[1] * 0.09;
      b.box(wood, lx, low - 0.04, lz, along ? sd.len + 0.36 : 0.18, 0.1, along ? 0.18 : sd.len + 0.36, 1.5);
      b.box(brass, sd.cx - sd.n[0] * 0.185, low - 0.04, sd.cz - sd.n[1] * 0.185, along ? sd.len + 0.36 : 0.02, 0.04, along ? 0.02 : sd.len + 0.36);
      if (cove) glow.box(cove, sd.cx - sd.n[0] * 0.08, low + 0.035, sd.cz - sd.n[1] * 0.08, along ? sd.len : 0.04, 0.03, along ? 0.04 : sd.len);
    }
    if (s.downlights > 0) {
      // downlights in the band all round
      for (const e of edges({ x0: I.x0 + band / 2, x1: I.x1 - band / 2, z0: I.z0 + band / 2, z1: I.z1 - band / 2 }, 0)) {
        const count = Math.max(1, Math.round(Math.max(e.w, e.d) / s.downlights));
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count - 0.5;
          const x = e.x + (e.w > e.d ? t * e.w : 0);
          const z = e.z + (e.d > e.w ? t * e.d : 0);
          const at = new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(x, low - 0.004, z));
          glow.add(new THREE.CircleGeometry(0.06, 16), GLOW.bulb, at);
          b.add(new THREE.RingGeometry(0.06, 0.1, 20), brass, at);
          downlights.push({ x, z, room: r.id });
        }
      }
    }
    // chandeliers in the raised middle: the lobby's one grand one, one over each salon table
    if (r.id === 'lobby') chandeliers.push({ x: (inner.x0 + inner.x1) / 2, y: s.ceiling - 0.02, z: (inner.z0 + inner.z1) / 2, size: 2.1, room: r.id });
    if (r.id === 'salon') for (const st of plan.stations.filter((q) => q.room === 'salon')) chandeliers.push({ x: st.x, y: s.ceiling - 0.02, z: st.z + 0.3, size: 1.25, room: r.id });
  }

  /** The four edges of a rect as thin strips inset by `inset`: centre and size. */
  function edges(R: Rect, inset: number): { x: number; z: number; w: number; d: number }[] {
    const w = R.x1 - R.x0;
    const d = R.z1 - R.z0;
    return [
      { x: (R.x0 + R.x1) / 2, z: R.z0 + inset, w, d: 0.03 },
      { x: (R.x0 + R.x1) / 2, z: R.z1 - inset, w, d: 0.03 },
      { x: R.x0 + inset, z: (R.z0 + R.z1) / 2, w: 0.03, d },
      { x: R.x1 - inset, z: (R.z0 + R.z1) / 2, w: 0.03, d },
    ];
  }

  /** The pit: low panels round the stepped-up coffered ceiling, the fascia washed by a hidden cove. */
  function coffers(r: PlannedRoom): void {
    const s = r.style;
    const I = r.inner;
    const P = plan.pit;
    const H = s.ceiling;
    const ceil = m.get('ceiling');
    under({ x0: I.x0, x1: I.x1, z0: I.z0, z1: P.z0 }, ceil, H);
    under({ x0: I.x0, x1: I.x1, z0: P.z1, z1: I.z1 }, ceil, H);
    under({ x0: I.x0, x1: P.x0, z0: P.z0, z1: P.z1 }, ceil, H);
    under({ x0: P.x1, x1: I.x1, z0: P.z0, z1: P.z1 }, ceil, H);
    lights(r, { x0: I.x0 + 0.3, x1: I.x1 - 0.3, z0: I.z0 + 0.3, z1: I.z1 - 0.3 }, H, s.downlights || 2.4, P);

    const brassM = brass;
    const wood = m.get('beam');
    const fascia = m.get('fascia');
    const PH = PIT_CEILING;
    const sides = [
      { cx: (P.x0 + P.x1) / 2, cz: P.z0, len: P.x1 - P.x0, ry: 0, n: [0, 1] },
      { cx: (P.x0 + P.x1) / 2, cz: P.z1, len: P.x1 - P.x0, ry: Math.PI, n: [0, -1] },
      { cx: P.x0, cz: (P.z0 + P.z1) / 2, len: P.z1 - P.z0, ry: Math.PI / 2, n: [1, 0] },
      { cx: P.x1, cz: (P.z0 + P.z1) / 2, len: P.z1 - P.z0, ry: -Math.PI / 2, n: [-1, 0] },
    ] as const;
    for (const sd of sides) {
      b.add(new THREE.PlaneGeometry(sd.len, PH - H), fascia, { x: sd.cx, y: (H + PH) / 2, z: sd.cz, ry: sd.ry });
      // the cove lip: a wood ledge with a brass edge; the LED strip hides on top of it
      const lipD = 0.42;
      const lx = sd.cx + sd.n[0] * (lipD / 2);
      const lz = sd.cz + sd.n[1] * (lipD / 2);
      const along = sd.n[1] !== 0;
      b.box(wood, lx, H - 0.05, lz, along ? sd.len + lipD * 2 : lipD, 0.16, along ? lipD : sd.len + lipD * 2, 1.5);
      const ex = sd.cx + sd.n[0] * (lipD + 0.01);
      const ez = sd.cz + sd.n[1] * (lipD + 0.01);
      b.box(brassM, ex, H - 0.05, ez, along ? sd.len + lipD * 2 : 0.025, 0.05, along ? 0.025 : sd.len + lipD * 2);
      const gx = sd.cx + sd.n[0] * 0.12;
      const gz = sd.cz + sd.n[1] * 0.12;
      glow.box(GLOW.warm, gx, H + 0.045, gz, along ? sd.len : 0.05, 0.03, along ? 0.05 : sd.len);
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
      b.box(brassM, x, PH - beamH - 0.005, (P.z0 + P.z1) / 2, 0.07, 0.01, pd);
    }
    for (let j = 0; j <= nz; j++) {
      const z = P.z0 + (j * pd) / nz;
      b.box(wood, (P.x0 + P.x1) / 2, PH - beamH / 2, z, pw, beamH, beamW, 1.5);
      b.box(brassM, (P.x0 + P.x1) / 2, PH - beamH - 0.005, z, pw, 0.01, 0.07);
    }
    // chandeliers in every other coffer of the row over the staff area
    const cw = pw / nx;
    const cd = pd / nz;
    const midZ = (plan.staff.z0 + plan.staff.z1) / 2;
    const j = Math.max(0, Math.min(nz - 1, Math.floor((midZ - P.z0) / cd)));
    for (let i = nx % 2 ? 0 : 1; i < nx; i += 2) chandeliers.push({ x: P.x0 + (i + 0.5) * cw, y: PH - 0.02, z: P.z0 + (j + 0.5) * cd, size: 1.5, room: r.id });
  }

  /** The yard: a dark roof on steel trusses, a work lamp hanging from every other one. */
  function trusses(r: PlannedRoom): void {
    const s = r.style;
    const I = r.inner;
    under(I, m.get(s.ceilingMat), s.ceiling);
    const steel = m.get('steel');
    const y = s.ceiling - 0.55;
    const span = I.z1 - I.z0;
    let k = 0;
    for (let x = I.x0 + 1.4; x < I.x1 - 0.6; x += 2.6, k++) {
      // an I-beam across the yard (north to south): flanges and a web
      b.box(steel, x, y + 0.2, (I.z0 + I.z1) / 2, 0.16, 0.02, span);
      b.box(steel, x, y - 0.2, (I.z0 + I.z1) / 2, 0.16, 0.02, span);
      b.box(steel, x, y, (I.z0 + I.z1) / 2, 0.02, 0.4, span);
      // diagonal bracing up to the roof
      for (let z = I.z0 + 0.8; z < I.z1 - 0.4; z += 1.6) b.add(new THREE.BoxGeometry(0.04, 0.8, 0.04), steel, { x, y: y + 0.45, z, rx: 0.7 });
      if (k % 2 === 0) {
        for (const z of [I.z0 + span * 0.3, I.z0 + span * 0.7]) {
          // a caged work lamp on a chain
          b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 5), steel, { x, y: y - 0.65, z });
          b.add(new THREE.CylinderGeometry(0.16, 0.2, 0.14, 12, 1, true), steel, { x, y: y - 1.15, z });
          glow.add(new THREE.SphereGeometry(0.07, 10, 8), new THREE.Color('#ffb060').multiplyScalar(2.6), { x, y: y - 1.2, z });
        }
      }
    }
    // purlins along the room, over the trusses
    for (let z = I.z0 + 1.2; z < I.z1 - 0.6; z += 2.4) b.box(steel, (I.x0 + I.x1) / 2, s.ceiling - 0.1, z, I.x1 - I.x0, 0.12, 0.08);
  }

  // --- columns -----------------------------------------------------------------------------------

  function columns(): void {
    const marble = m.get('marble-black');
    for (const c of plan.columns) {
      b.room = c.room;
      const h = byId.get(c.room)?.style.ceiling ?? 3.4;
      b.add(new THREE.CylinderGeometry(c.r + 0.1, c.r + 0.12, 0.16, 24), marble, { x: c.x, y: 0.08, z: c.z });
      b.add(new THREE.CylinderGeometry(c.r + 0.04, c.r + 0.1, 0.1, 24), brass, { x: c.x, y: 0.2, z: c.z });
      b.add(new THREE.CylinderGeometry(c.r, c.r, h - 0.55, 24, 1, true), marble, { x: c.x, y: 0.25 + (h - 0.55) / 2, z: c.z });
      for (const y of [1.15, h - 0.62]) b.add(new THREE.TorusGeometry(c.r + 0.012, 0.028, 8, 32), brass, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(c.x, y, c.z)));
      // flared brass capital meeting the ceiling
      b.add(new THREE.CylinderGeometry(c.r + 0.03, c.r + 0.03, 0.12, 24, 1, true), brass, { x: c.x, y: h - 0.06, z: c.z });
    }
  }
}
