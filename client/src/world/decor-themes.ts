// The north wing's built-in dressing, drawn in code into the floor's batch and glow merge: the
// pachinko parlour's islands (end caps, the crown over the machines, their LED strips), its prize
// counter and the noren over its doors, the paper lanterns on their cords, the Jade Room's big
// lanterns over each table, its moon gate and lattice screens, and the bingo hall's snack bar and
// pattern boards. Sizes and places come from the floor plan (layout.ts), which checks them
// against everything else; every face here stands clear of the faces round it (see README.md, No
// z-fighting).

import * as THREE from 'three';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { hdr } from './materials.ts';
import { GLOW, type GlowMerge } from './lighting.ts';
import { DRAPES, FOUNTAIN, ISLAND_CAP, ISLAND_TOP, LANTERN, MOONGATE, PATTERN_BOARD, TABLE_LANTERN, WALL, WALL_COUNTER, ceilingAt, type FloorPlan, type WallMount } from './layout.ts';
import { BOARD_PATTERNS, drawFalls, drawPatternBoards, drawRipples } from './textures-themes.ts';
import { canvasTexture } from './carpet.ts';
import type { Decor } from './decor.ts';

/** The pachinko machines' own colours, for their islands' trim. */
const SAKURA = '#ff5fa8';

export function buildThemes(plan: FloorPlan, b: Batch, m: Mats, glow: GlowMerge, out: Decor): void {
  const brass = m.get('brass');
  const chrome = m.get('chrome');
  const lacquer = m.get('lacquer');
  const red = m.get('lacquer-red');
  const into = (room: string) => {
    b.room = room;
    glow.room = room;
  };

  const prizeMats = ['#e8467a', '#3a86e0', '#f2c230', '#34b27a', '#f06a2a', '#9a5ad8'].map((c, i) => {
    m.define1(`prize-${i}`, () => new THREE.MeshLambertMaterial({ color: c }));
    return m.get(`prize-${i}`);
  });

  // --- the pachinko islands: end caps, the crown over the machines --------------------------------
  for (const isl of plan.machineIslands) {
    into(isl.room);
    const c = Math.cos(isl.yaw);
    const s = Math.sin(isl.yaw);
    // island-local (x along it, z across) to world
    const at = (lx: number, lz: number) => ({ x: isl.x + lx * c + lz * s, z: isl.z - lx * s + lz * c });
    const box = (mat: THREE.Material | THREE.Color, lx: number, y: number, lz: number, sx: number, sy: number, sz: number) => {
      const p = at(lx, lz);
      if (mat instanceof THREE.Color) glow.box(mat, p.x, y, p.z, sx, sy, sz, isl.yaw);
      else b.box(mat, p.x, y, p.z, sx, sy, sz, undefined, isl.yaw);
    };
    const L = isl.length;
    const D = isl.depth;
    const pink = hdr(SAKURA, 2.6);
    // the crown over both rows: black lacquer, chrome edges, a pink strip along each face's foot
    const y0 = 2.07;
    box(lacquer, 0, (y0 + ISLAND_TOP) / 2, 0, L + 2 * ISLAND_CAP, ISLAND_TOP - y0, D + 0.04);
    for (const e of [-1, 1]) {
      box(chrome, 0, ISLAND_TOP - 0.015, e * (D / 2 + 0.03), L + 2 * ISLAND_CAP + 0.02, 0.03, 0.02);
      box(pink, 0, y0 + 0.02, e * (D / 2 + 0.028), L + 2 * ISLAND_CAP - 0.04, 0.02, 0.012);
    }
    // the end caps, from the floor to the crown: black lacquer, chrome corners, a pink panel with
    // its light bar, the machine's name lit over it
    for (const e of [-1, 1]) {
      const x = e * (L / 2 + ISLAND_CAP / 2);
      box(lacquer, x, y0 / 2, 0, ISLAND_CAP - 0.02, y0, D);
      box(lacquer, x, 0.04, 0, ISLAND_CAP, 0.08, D + 0.02);
      for (const f of [-1, 1]) box(chrome, x, y0 / 2, f * (D / 2 - 0.015), ISLAND_CAP + 0.004, y0 - 0.1, 0.04);
      // a panel in the island's pink on the cap's face, and its light bar
      const face = e * (L / 2 + ISLAND_CAP);
      // (each layer's faces a few millimetres clear of the one under it)
      box(chrome, face + e * 0.0045, 1.02, 0, 0.007, 1.36, D - 0.3);
      box(m.get('prize-0'), face + e * 0.011, 1.02, 0, 0.01, 1.3, D - 0.36);
      for (const f of [-1, 1]) box(pink, face + e * 0.021, 1.02, f * (D / 2 - 0.1), 0.006, 1.26, 0.025);
      for (let k = 0; k < 3; k++) box(new THREE.Color('#fff0f6').multiplyScalar(2.2), face + e * 0.021, 0.52 + k * 0.06, 0, 0.006, 0.03, D - 0.5);
      const sign = at(face + e * 0.03, 0);
      const ry = isl.yaw + (e > 0 ? Math.PI / 2 : -Math.PI / 2);
      out.signs.push({ kind: 'lit', text: 'SAKURA STORM', color: '#ffc4e0', font: 'Limelight', at: [sign.x, 1.9, sign.z], ry, w: D - 0.16, h: 0.24 });
      // the island's number, big on its panel, the way a parlour's islands are found
      out.signs.push({ kind: 'neon', text: String(isl.n), color: '#fff2f8', font: 'Tilt Neon', at: [sign.x, 1.2, sign.z], ry, w: 0.5, h: 0.62 });
    }
    out.pools.push({ x: isl.x, z: isl.z, r: Math.max(L, D) * 0.6 + 1.4, room: isl.room });
  }

  // --- counters along a wall: the parlour's prizes, the bingo hall's snack bar --------------------
  for (const k of plan.counters) {
    into(k.room);
    const r = k.counter;
    const alongZ = k.axis === 'z';
    const len = alongZ ? r.z1 - r.z0 : r.x1 - r.x0;
    const mid = alongZ ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
    const across = alongZ ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2;
    const depth = alongZ ? r.x1 - r.x0 : r.z1 - r.z0;
    // a point `a` across (from the counter's middle toward the wall, +) and `t` along
    const pt = (a: number, t: number) => (alongZ ? { x: across + k.side * a, z: mid + t } : { x: mid + t, z: across + k.side * a });
    const bx = (mat: THREE.Material | THREE.Color, a: number, y: number, t: number, sa: number, sy: number, st: number) => {
      const p = pt(a, t);
      const [sx, sz] = alongZ ? [sa, st] : [st, sa];
      if (mat instanceof THREE.Color) glow.box(mat, p.x, y, p.z, sx, sy, sz);
      else b.box(mat, p.x, y, p.z, sx, sy, sz);
    };
    const H = WALL_COUNTER.h;
    // the shelves' unit against the wall
    const wallA = Math.abs(k.wall - across);
    const shelfA = wallA - WALL_COUNTER.shelf / 2;
    const facing = alongZ ? (k.side > 0 ? -Math.PI / 2 : Math.PI / 2) : k.side > 0 ? Math.PI : 0;
    if (k.kind === 'prizes') {
      // a glass case of a counter: lacquer base, a lit glass top with prizes on a velvet floor
      bx(lacquer, 0, 0.44, 0, depth, 0.88, len);
      bx(brass, 0, 0.885, 0, depth + 0.02, 0.01, len + 0.02);
      bx(m.get('velvet'), 0, 0.9, 0, depth - 0.08, 0.02, len - 0.08);
      bx(m.get('glass'), 0, 0.96, 0, depth - 0.02, 0.1, len - 0.02);
      bx(chrome, 0, H - 0.006, 0, depth + 0.02, 0.012, len + 0.02);
      bx(GLOW.shelf, -depth / 2 - 0.006, 0.84, 0, 0.012, 0.012, len - 0.1);
      // under the glass, the special prizes: little gold plates in rows, what the balls are traded for
      for (let t = -len / 2 + 0.2; t < len / 2 - 0.15; t += 0.12) for (const a of [-0.12, 0.05]) bx(m.get('lacquer-gold'), a, 0.918, t, 0.08, 0.016, 0.05);
      // the wall of prizes: an open lacquer case against the wall, four lit shelves of boxes
      const S = WALL_COUNTER.shelf;
      const run = len + 0.6;
      bx(lacquer, wallA - 0.02, WALL_COUNTER.back / 2, 0, 0.04, WALL_COUNTER.back, run);
      for (const e of [-1, 1]) bx(lacquer, shelfA, WALL_COUNTER.back / 2, e * (run / 2 - 0.02), S, WALL_COUNTER.back, 0.04);
      bx(lacquer, shelfA, WALL_COUNTER.back - 0.02, 0, S, 0.04, run - 0.08);
      bx(lacquer, shelfA, 0.06, 0, S, 0.12, run - 0.08);
      let n = 0;
      for (const y of [0.52, 0.98, 1.44, 1.9]) {
        bx(chrome, shelfA - 0.02, y, 0, S - 0.04, 0.02, run - 0.08);
        bx(GLOW.shelf, shelfA - S / 2 + 0.01, y - 0.018, 0, 0.012, 0.012, run - 0.1);
        for (let t = -run / 2 + 0.2; t < run / 2 - 0.15; t += 0.26) {
          const mat = prizeMats[n % prizeMats.length]!;
          const kind = (n * 7) % 5;
          const hgt = 0.14 + ((n * 37) % 5) * 0.045;
          n++;
          if (kind === 1) {
            // a tin of sweets
            const p = pt(shelfA - 0.02, t);
            b.add(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 16), mat, { x: p.x, y: y + 0.09, z: p.z });
            b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 16), m.get('lacquer-gold'), { x: p.x, y: y + 0.17, z: p.z });
          } else if (kind === 3) {
            // a stuffed toy, round and sitting up
            const p = pt(shelfA - 0.03, t);
            b.add(new THREE.SphereGeometry(0.09, 12, 8), mat, { x: p.x, y: y + 0.1, z: p.z });
            b.add(new THREE.SphereGeometry(0.065, 12, 8), mat, { x: p.x, y: y + 0.24, z: p.z });
          } else {
            // a boxed prize with a ribbon round it
            bx(mat, shelfA - 0.02, y + 0.01 + hgt / 2, t, 0.24, hgt, 0.2);
            bx(m.get('enamel'), shelfA - 0.02, y + 0.01 + hgt / 2, t, 0.25, hgt + 0.01, 0.03);
          }
        }
      }
      const sign = pt(wallA - 0.03, 0);
      out.signs.push({ kind: 'lit', text: 'PRIZE COUNTER', color: '#ffd8ec', font: 'Limelight', at: [sign.x, 2.72, sign.z], ry: facing, w: Math.min(len, 3.2), h: 0.4 });
      out.pools.push({ ...pt(-0.6, 0), r: 2.2, room: k.room });
    } else {
      // a diner counter: red vinyl front ribbed in chrome, a pale top
      bx(m.get('vinyl'), 0, 0.46, 0, depth, 0.92, len);
      for (let t = -len / 2 + 0.3; t < len / 2 - 0.2; t += 0.4) bx(chrome, -depth / 2 - 0.006, 0.46, t, 0.012, 0.8, 0.03);
      bx(m.get('marble-light'), 0, H - 0.05, 0, depth + 0.08, 0.1, len + 0.06, );
      bx(chrome, 0, H - 0.1, 0, depth + 0.1, 0.012, len + 0.08);
      // behind it: the drinks cooler (a lit window of cans) at one end, a back counter with the
      // popcorn case and the coffee urns on it along the rest
      const S = WALL_COUNTER.shelf;
      const run = len + 0.6;
      const split = -run / 2 + 1.5;
      const coolerT = (-run / 2 + split) / 2;
      const backT = (split + run / 2) / 2;
      bx(m.get('enamel'), shelfA, 1.05, coolerT, S, 2.1, split + run / 2);
      bx(m.get('vending-face'), shelfA - S / 2 - 0.006, 1.2, coolerT, 0.01, 1.4, split + run / 2 - 0.3);
      bx(chrome, shelfA - S / 2 - 0.014, 1.2, coolerT - (split + run / 2) / 2 + 0.12, 0.012, 1.46, 0.03);
      bx(chrome, shelfA - S / 2 - 0.014, 1.2, coolerT + (split + run / 2) / 2 - 0.12, 0.012, 1.46, 0.03);
      bx(m.get('enamel'), shelfA, 0.45, backT, S, 0.9, run / 2 - split);
      bx(m.get('marble-light'), shelfA, 0.92, backT, S + 0.02, 0.04, run / 2 - split + 0.02);
      const popcorn = new THREE.Color('#ffd25a').multiplyScalar(1.7);
      const pc = split + 0.5;
      bx(m.get('glass'), shelfA, 1.2, pc, 0.34, 0.52, 0.52);
      bx(popcorn, shelfA, 1.03, pc, 0.3, 0.2, 0.48);
      bx(red, shelfA, 1.49, pc, 0.36, 0.06, 0.54);
      for (const t of [pc + 0.6, pc + 0.95]) {
        const p = pt(shelfA, t);
        b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 16), chrome, { x: p.x, y: 1.15, z: p.z });
      }
      const sign = pt(wallA - 0.03, 0);
      out.signs.push({ kind: 'neon', text: 'SNACK BAR', sub: 'HOT DOGS · POPCORN · COFFEE · SODA', color: '#ff6a3a', font: 'Limelight', at: [sign.x, 2.78, sign.z], ry: facing, w: Math.min(len, 3.4), h: 0.62 });
      out.pools.push({ ...pt(-0.6, 0), r: 2.2, room: k.room });
    }
  }

  // --- paper lanterns on their cords ----------------------------------------------------------
  const lantern = new THREE.SphereGeometry(LANTERN.r, 16, 10);
  lantern.scale(1, LANTERN.h / (2 * LANTERN.r), 1);
  const cap = new THREE.CylinderGeometry(LANTERN.r * 0.42, LANTERN.r * 0.46, 0.05, 14);
  for (const l of plan.lanterns) {
    into(l.room);
    glow.add(lantern, hdr(l.color, 1.8), { x: l.x, y: l.y, z: l.z });
    b.add(cap, lacquer, { x: l.x, y: l.y + LANTERN.h / 2 - 0.012, z: l.z });
    b.add(cap, lacquer, { x: l.x, y: l.y - LANTERN.h / 2 + 0.012, z: l.z });
    // its hanger up to the cord
    b.add(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 5), lacquer, { x: l.x, y: l.y + LANTERN.h / 2 + 0.06, z: l.z });
    out.pools.push({ x: l.x, z: l.z, r: 1.1, room: l.room });
  }
  for (const c of plan.cords) {
    into(c.room);
    const len = Math.hypot(c.x1 - c.x0, c.z1 - c.z0);
    const ry = Math.atan2(c.x1 - c.x0, c.z1 - c.z0);
    b.add(new THREE.CylinderGeometry(0.005, 0.005, len, 5), lacquer, new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationY(ry)).premultiply(new THREE.Matrix4().makeTranslation((c.x0 + c.x1) / 2, c.y, (c.z0 + c.z1) / 2)));
    // the cord hangs from the ceiling at both ends
    for (const [x, z] of [
      [c.x0, c.z0],
      [c.x1, c.z1],
    ] as const) {
      const top = ceilingAt(plan, x, z);
      b.add(new THREE.CylinderGeometry(0.005, 0.005, top - c.y, 5), lacquer, { x, y: (top + c.y) / 2, z });
    }
  }

  // --- the Jade Room's big lanterns, low over each table -----------------------------------------
  const silk = new THREE.LatheGeometry(
    [
      [0.001, -TABLE_LANTERN.h / 2],
      [TABLE_LANTERN.r * 0.5, -TABLE_LANTERN.h / 2],
      [TABLE_LANTERN.r * 0.9, -TABLE_LANTERN.h * 0.3],
      [TABLE_LANTERN.r, 0],
      [TABLE_LANTERN.r * 0.9, TABLE_LANTERN.h * 0.3],
      [TABLE_LANTERN.r * 0.5, TABLE_LANTERN.h / 2],
      [0.001, TABLE_LANTERN.h / 2],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    24,
  );
  const rib = new THREE.TorusGeometry(TABLE_LANTERN.r * 0.5 + 0.004, 0.012, 6, 28);
  for (const l of plan.tableLanterns) {
    into(l.room);
    const y = TABLE_LANTERN.y;
    const top = ceilingAt(plan, l.x, l.z);
    glow.add(silk, new THREE.Color('#ff4a2a').multiplyScalar(1.5), { x: l.x, y, z: l.z });
    // gold rings at its shoulders, a black crown and foot, the rod to the ceiling, a tassel
    for (const e of [-1, 1]) b.add(rib, m.get('lacquer-gold'), new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(l.x, y + e * (TABLE_LANTERN.h / 2 - 0.004), l.z)));
    b.add(new THREE.CylinderGeometry(0.1, 0.16, 0.08, 16), lacquer, { x: l.x, y: y + TABLE_LANTERN.h / 2 + 0.03, z: l.z });
    b.add(new THREE.CylinderGeometry(0.16, 0.1, 0.06, 16), lacquer, { x: l.x, y: y - TABLE_LANTERN.h / 2 - 0.02, z: l.z });
    b.add(new THREE.CylinderGeometry(0.012, 0.012, top - (y + TABLE_LANTERN.h / 2 + 0.07), 6), m.get('lacquer-gold'), { x: l.x, y: (top + y + TABLE_LANTERN.h / 2 + 0.07) / 2, z: l.z });
    b.add(new THREE.ConeGeometry(0.035, 0.24, 10), m.get('silk-red'), { x: l.x, y: y - TABLE_LANTERN.h / 2 - 0.17, z: l.z, rx: Math.PI });
    out.pools.push({ x: l.x, z: l.z, r: 2.2, room: l.room });
  }

  // --- the moon gate: a round frame on the wall, the painting inside, JADE ROOM over it -----------
  for (const g of plan.moongates) {
    into(g.room);
    const R = MOONGATE.r;
    const ring = new THREE.Shape();
    ring.absarc(0, 0, R + 0.26, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, R, 0, Math.PI * 2, true);
    ring.holes.push(hole);
    const frame = new THREE.ExtrudeGeometry(ring, { depth: 0.14, bevelEnabled: false, curveSegments: 48 });
    // (clear of the wainscot at 0.04 and the rail at 0.07: the painting stands in front of both)
    const place = (d: number, y: number) => wallPlace(g, d, y);
    b.add(frame, lacquer, place(0.004, MOONGATE.y));
    b.add(new THREE.TorusGeometry(R + 0.005, 0.022, 8, 64), m.get('lacquer-gold'), place(0.146, MOONGATE.y));
    b.add(new THREE.TorusGeometry(R + 0.25, 0.014, 8, 64), m.get('lacquer-gold'), place(0.146, MOONGATE.y));
    b.add(new THREE.CircleGeometry(R, 48), m.get('painting'), place(0.092, MOONGATE.y));
    const sign = wallPoint(g, 0.03);
    out.signs.push({ kind: 'lit', text: 'JADE ROOM', color: '#f2cf7c', font: 'Cinzel', at: [sign.x, MOONGATE.y + R + 0.52, sign.z], ry: g.ry, w: 2.1, h: 0.34 });
    const pool = wallPoint(g, 1.2);
    out.pools.push({ x: pool.x, z: pool.z, r: 1.8, room: g.room });
  }

  // --- lattice screens: red frames, black fretwork, warm paper glowing behind -------------------
  for (const l of plan.lattices) {
    into(l.room);
    const w = l.w;
    const y0 = 0.3;
    const y1 = 2.62;
    const h = y1 - y0;
    const ym = (y0 + y1) / 2;
    // the lit paper, then the fretwork in front of it, then the frame round both
    const paper = wallPoint(l, 0.085);
    glow.box(new THREE.Color('#e8a860').multiplyScalar(0.62), paper.x, ym, paper.z, w - 0.16, h - 0.16, 0.01, l.ry);
    // the fretwork: two sets of bars on the diagonals, a diamond lattice, each cut to the frame
    const iw = w - 0.16;
    const ih = h - 0.16;
    const pitch = 0.2;
    for (const dir of [1, -1]) {
      // lines a·dir - (y - ym) = c across the panel, clipped to its rect
      for (let c = -(iw + ih) / 2; c <= (iw + ih) / 2; c += pitch) {
        const pts: [number, number][] = [];
        for (const a of [-iw / 2, iw / 2]) {
          const v = a * dir - c;
          if (Math.abs(v) <= ih / 2) pts.push([a, v]);
        }
        for (const v of [-ih / 2, ih / 2]) {
          const a = (v + c) * dir;
          if (Math.abs(a) <= iw / 2) pts.push([a, v]);
        }
        if (pts.length < 2) continue;
        const [[a0, v0], [a1, v1]] = pts as [[number, number], [number, number]];
        const len = Math.hypot(a1 - a0, v1 - v0);
        if (len < 0.05) continue;
        const p = wallPoint(l, 0.105, (a0 + a1) / 2);
        b.add(new THREE.BoxGeometry(len, 0.026, 0.03), lacquer, { x: p.x, y: ym + (v0 + v1) / 2, z: p.z, ry: l.ry, rz: Math.atan2(v1 - v0, a1 - a0) });
      }
    }
    // a round medallion in the middle: a lacquer ring over the diamonds, a gold ring inside it
    const mid = wallPlace(l, 0.125, ym + 0.2);
    b.add(new THREE.TorusGeometry(Math.min(iw, ih) * 0.28, 0.03, 8, 40), red, mid);
    b.add(new THREE.TorusGeometry(Math.min(iw, ih) * 0.28 - 0.05, 0.012, 6, 40), m.get('lacquer-gold'), wallPlace(l, 0.13, ym + 0.2));
    for (const [a, y, bw, bh] of [
      [-w / 2 + 0.04, ym, 0.08, h],
      [w / 2 - 0.04, ym, 0.08, h],
      [0, y1 - 0.04, w - 0.16, 0.08],
      [0, y0 + 0.04, w - 0.16, 0.08],
    ] as const) {
      const p = wallPoint(l, 0.11, a);
      b.box(red, p.x, y, p.z, bw, bh, 0.05, undefined, l.ry);
    }
  }

  // --- the bingo hall's pattern boards: a lit face for each pattern, bulbs chasing round it --------
  if (plan.patternBoards.length) {
    m.define1('pattern-boards', () => {
      const t = canvasTexture(drawPatternBoards(256, 320), 4);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1, 1, 1).multiplyScalar(1.15) });
    });
    const faceMat = m.get('pattern-boards');
    const bulb = new THREE.SphereGeometry(0.022, 8, 6);
    const warm = new THREE.Color('#ffd070').multiplyScalar(2.3);
    plan.patternBoards.forEach((p, i) => {
      into(p.room);
      const { w, h, y } = PATTERN_BOARD;
      const k = i % BOARD_PATTERNS.length;
      const back = wallPoint(p, 0.105);
      b.box(lacquer, back.x, y, back.z, w + 0.1, h + 0.1, 0.05, undefined, p.ry);
      // the face, its third of the canvas
      const face = new THREE.PlaneGeometry(w - 0.02, h - 0.02);
      const uv = face.getAttribute('uv');
      for (let q = 0; q < uv.count; q++) uv.setX(q, (k + uv.getX(q)) / BOARD_PATTERNS.length);
      const f = wallPoint(p, 0.134);
      b.add(face, faceMat, { x: f.x, y, z: f.z, ry: p.ry });
      // bulbs round the frame's edge
      const n = 7;
      for (let q = 0; q < n; q++) {
        for (const e of [-1, 1]) {
          const a = -w / 2 - 0.02 + (q * (w + 0.04)) / (n - 1);
          const top = wallPoint(p, 0.14, a);
          glow.add(bulb, warm, { x: top.x, y: y + e * (h / 2 + 0.025), z: top.z });
          const side = wallPoint(p, 0.14, e * (w / 2 + 0.025));
          glow.add(bulb, warm, { x: side.x, y: y - h / 2 + (q * h) / (n - 1), z: side.z });
        }
      }
      out.pools.push({ ...wallPoint(p, 1.0), r: 1.3, room: p.room });
    });
  }

  // --- stage drapes: gathered velvet either side of the stage, a pelmet with a gold fringe --------
  for (const d of plan.drapes) {
    into(d.room);
    const top = ceilingAt(plan, d.x, d.z) - 0.02;
    const h = top - DRAPES.pelmet;
    for (const e of [-1, 1]) {
      // folds: the cloth swings in and out across its width, deepest at the gathered outer edge
      const g = new THREE.PlaneGeometry(DRAPES.w, h - 0.02, 40, 1);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / DRAPES.w + 0.5;
        const k = e > 0 ? u : 1 - u;
        pos.setZ(i, 0.05 * Math.sin(u * Math.PI * 14) * (0.55 + 0.45 * k));
      }
      g.computeVertexNormals();
      const p = wallPoint(d, 0.1, e * (d.w / 2 + DRAPES.w / 2));
      b.add(g, m.get('velvet'), { x: p.x, y: (h - 0.02) / 2 + 0.01, z: p.z, ry: d.ry });
    }
    const pw = d.w + 2 * DRAPES.w + 0.2;
    const pel = wallPoint(d, (DRAPES.d + 0.08) / 2 + 0.004);
    b.box(m.get('velvet'), pel.x, top - DRAPES.pelmet / 2, pel.z, pw, DRAPES.pelmet, DRAPES.d + 0.08 - 0.008, 1.2, d.ry);
    const fringe = wallPoint(d, DRAPES.d + 0.084);
    b.box(m.get('lacquer-gold'), fringe.x, top - DRAPES.pelmet - 0.02, fringe.z, pw + 0.01, 0.06, 0.012, undefined, d.ry);
    b.box(m.get('lacquer-gold'), fringe.x, top - 0.03, fringe.z, pw + 0.01, 0.025, 0.012, undefined, d.ry);
  }

  // --- fountains: a travertine basin, two bowls on a baluster, water sheeting off each lip ----------
  if (plan.fountains.length) fountains(plan, b, m, glow, out);

  // --- noren over the parlour's doorways: navy cloth panels with a white blossom crest ------------
  m.define1('noren', () => {
    const t = canvasTexture(drawNoren(256, 128), 4);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide });
  });
  const noren = m.get('noren');
  for (const d of plan.doors) {
    if (d.b === 'outside' || (d.a !== 'parlour' && d.b !== 'parlour')) continue;
    b.room = 'parlour';
    const room = plan.rooms.find((r) => r.id === 'parlour')!;
    // on the parlour's side of the wall's middle, hung from a rod under the lining's head
    const n = d.axis === 'x' ? (room.bounds.z1 === d.c ? -1 : 1) : room.bounds.x1 === d.c ? -1 : 1;
    const c = d.c + n * (WALL / 2 - 0.06);
    const span = d.a1 - d.a0 - 0.08;
    const drop = 0.46;
    const top = d.height - 0.035;
    const panels = 3;
    const pw = (span - (panels - 1) * 0.02) / panels;
    for (let i = 0; i < panels; i++) {
      const a = d.a0 + 0.04 + pw / 2 + i * (pw + 0.02);
      const g = new THREE.PlaneGeometry(pw, drop);
      const uv = g.getAttribute('uv');
      for (let q = 0; q < uv.count; q++) uv.setX(q, (i + uv.getX(q)) / panels);
      if (d.axis === 'x') b.add(g, noren, { x: a, y: top - drop / 2, z: c });
      else b.add(g, noren, { x: c, y: top - drop / 2, z: a, ry: Math.PI / 2 });
    }
    const mid = (d.a0 + d.a1) / 2;
    const rod = new THREE.CylinderGeometry(0.012, 0.012, span + 0.04, 8);
    if (d.axis === 'x') b.add(rod, lacquer, { x: mid, y: top + 0.01, z: c, rz: Math.PI / 2 });
    else b.add(rod, lacquer, { x: c, y: top + 0.01, z: mid, rx: Math.PI / 2 });
  }
}

/** A point on a wall mount's face, `d` out from the wall and `a` along it (its local +x). */
function wallPoint(m: WallMount, d: number, a = 0): { x: number; z: number } {
  const c = Math.cos(m.ry);
  const s = Math.sin(m.ry);
  return { x: m.x + a * c + d * s, z: m.z - a * s + d * c };
}

/** A matrix standing a flat piece `d` out from a wall mount's face, at height y, facing into the room. */
function wallPlace(m: WallMount, d: number, y: number): THREE.Matrix4 {
  const p = wallPoint(m, d);
  return new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.ry), new THREE.Vector3(1, 1, 1));
}

/** The noren's cloth across its three panels: indigo, a white blossom crest in the middle, a dark hem. */
function drawNoren(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a2150';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#10143a';
  ctx.fillRect(0, 0, w, h * 0.1);
  ctx.fillRect(0, h * 0.94, w, h * 0.06);
  // the crest: a five-petalled blossom in a ring
  const cx = w / 2;
  const cy = h * 0.52;
  const R = h * 0.3;
  ctx.strokeStyle = '#f4efe4';
  ctx.lineWidth = h * 0.035;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4efe4';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * R * 0.42, cy + Math.sin(a) * R * 0.42, R * 0.32, R * 0.22, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1a2150';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.14, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

// --- the fountain ------------------------------------------------------------------------------------

/**
 * The water's two textures, shared by every fountain and both qualities: the pools' ripples drift
 * and the sheets falling off the bowls' lips run down. Moving a texture's offset each frame is all
 * the animation costs (tickWater, from the world's update).
 */
let ripples: THREE.CanvasTexture | null = null;
let falls: THREE.CanvasTexture | null = null;

/** Scroll the fountains' water (no-op until a fountain is built). */
export function tickWater(dt: number): void {
  if (ripples) {
    ripples.offset.x = (ripples.offset.x + dt * 0.021) % 1;
    ripples.offset.y = (ripples.offset.y + dt * 0.013) % 1;
  }
  if (falls) falls.offset.y = (falls.offset.y + dt * 0.55) % 1;
}

/** A shape turned round the fountain's axis: [radius, height] from the inside out or bottom up. */
function lathe(pts: [number, number][], seg = 48): THREE.LatheGeometry {
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
}

function fountains(plan: FloorPlan, b: Batch, m: Mats, glow: GlowMerge, out: Decor): void {
  m.define1('water-pool', () => {
    ripples ??= canvasTexture(drawRipples(256), 4);
    return new THREE.MeshBasicMaterial({ map: ripples, color: new THREE.Color(1, 1, 1).multiplyScalar(1.05), transparent: true, opacity: 0.86, depthWrite: false });
  });
  m.define1('water-fall', () => {
    falls ??= canvasTexture(drawFalls(128, 256, 107), 4);
    return new THREE.MeshBasicMaterial({ map: falls, color: new THREE.Color(1, 1, 1).multiplyScalar(1.3), transparent: true, depthWrite: false, side: THREE.DoubleSide });
  });
  m.define1('pool-tile', () => new THREE.MeshLambertMaterial({ color: '#0f3a40' }));
  const stone = m.get('marble-light');
  const brass = m.get('brass');
  const pool = m.get('water-pool');
  const fall = m.get('water-fall');
  const { r: R, rim, mid, top, crown } = FOUNTAIN;
  const floor = 0.12;
  // each surface of water sits a little under its bowl's lip, each sheet just outside the lip it pours over
  const midWater = mid.y - 0.05;
  const topWater = top.y - 0.04;
  for (const f of plan.fountains) {
    b.room = f.room;
    glow.room = f.room;
    const at = (y = 0) => ({ x: f.x, y, z: f.z });
    // the basin: a stepped travertine wall with a rolled lip, its inside down to a tiled floor
    b.add(lathe([[R + 0.04, 0], [R + 0.04, 0.06], [R, 0.08], [R, rim - 0.06], [R + 0.03, rim - 0.03], [R, rim], [R - 0.12, rim], [R - 0.14, rim - 0.04], [R - 0.14, floor]]), stone, at(), 1.2);
    b.add(new THREE.CircleGeometry(R - 0.14, 48).rotateX(-Math.PI / 2), m.get('pool-tile'), at(floor));
    b.add(new THREE.TorusGeometry(R + 0.012, 0.012, 6, 64).rotateX(Math.PI / 2), brass, at(rim - 0.16));
    // coins on the bottom, for luck
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996;
      const rr = 0.45 + ((i * 37) % 11) * 0.07;
      b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 10), brass, { x: f.x + Math.cos(a) * rr, y: floor + 0.006, z: f.z + Math.sin(a) * rr });
    }
    // light under the water, round the basin's inside wall
    glow.add(new THREE.TorusGeometry(R - 0.17, 0.018, 6, 64).rotateX(Math.PI / 2), new THREE.Color('#9fe8ff').multiplyScalar(1.8), at(floor + 0.12));
    // the pool's surface
    b.add(new THREE.CircleGeometry(R - 0.145, 48).rotateX(-Math.PI / 2), pool, at(rim - 0.08));
    // the baluster up to the middle bowl, the middle bowl, the stem to the top bowl, the top bowl
    b.add(lathe([[0.24, floor], [0.3, floor + 0.08], [0.2, 0.3], [0.13, 0.55], [0.2, 0.72], [0.14, 0.86], [0.18, mid.y - 0.26]], 24), stone, at(), 1.2);
    b.add(lathe([[0.18, mid.y - 0.3], [0.4, mid.y - 0.24], [0.66, mid.y - 0.13], [mid.r, mid.y - 0.03], [mid.r + 0.02, mid.y], [mid.r - 0.06, mid.y], [mid.r - 0.08, mid.y - 0.06], [0.3, mid.y - 0.14], [0.001, mid.y - 0.15]]), stone, at(), 1.2);
    b.add(lathe([[0.11, mid.y - 0.15], [0.14, mid.y + 0.02], [0.09, mid.y + 0.2], [0.13, mid.y + 0.34], [0.1, top.y - 0.14]], 20), stone, at(), 1.2);
    b.add(lathe([[0.1, top.y - 0.16], [0.24, top.y - 0.11], [top.r, top.y - 0.02], [top.r + 0.015, top.y], [top.r - 0.05, top.y], [top.r - 0.06, top.y - 0.05], [0.001, top.y - 0.08]], 32), stone, at(), 1.2);
    b.add(new THREE.TorusGeometry(mid.r + 0.01, 0.012, 6, 48).rotateX(Math.PI / 2), brass, at(mid.y - 0.035));
    // the finial: a brass pine cone on a short stem in the top bowl
    b.add(lathe([[0.04, topWater - 0.02], [0.05, top.y + 0.08], [0.035, top.y + 0.14], [0.09, top.y + 0.24], [0.11, top.y + 0.33], [0.07, crown - 0.06], [0.001, crown]], 16), brass, at());
    // the water in each bowl, and the sheets pouring over their lips into the one below
    b.add(new THREE.CircleGeometry(mid.r - 0.075, 40).rotateX(-Math.PI / 2), pool, at(midWater));
    b.add(new THREE.CircleGeometry(top.r - 0.055, 28).rotateX(-Math.PI / 2), pool, at(topWater));
    b.add(new THREE.CylinderGeometry(mid.r + 0.035, mid.r + 0.2, mid.y - 0.01 - (rim - 0.08), 48, 1, true), fall, at((mid.y - 0.01 + rim - 0.08) / 2));
    b.add(new THREE.CylinderGeometry(top.r + 0.03, top.r + 0.12, top.y - 0.01 - midWater, 32, 1, true), fall, at((top.y - 0.01 + midWater) / 2));
    out.pools.push({ x: f.x, z: f.z, r: R + 1.4, room: f.room });
  }
}
