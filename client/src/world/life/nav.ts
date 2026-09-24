// Where the floor's walking staff can go: a grid over the room, each cell open only if a body of
// `radius` fits there. On the floor it comes from the plan's own walk grid (reach.ts: the rooms,
// their doorways, the stations and every solid standing on the floor, the same things the player
// bumps into); tests can build one from a collision map. Paths are A* over the grid (eight ways,
// never cutting a corner past a blocked cell), then pulled tight: every waypoint that a straight,
// clear line can skip is dropped, so a waiter walks straight across open floor and turns only at
// corners.
//
// Built once when the floor loads, from things that don't move, so every client builds the same
// grid and finds the same paths (the waiters' rounds depend on that).

import type { Box, Post } from '../collision.ts';
import type { Grid } from '../reach.ts';

export interface Pt {
  x: number;
  z: number;
}

export interface NavBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A body's radius (m): a waiter with a tray keeps this far from everything solid. */
export const NAV_RADIUS = 0.34;
/** Grid cell (m). */
export const NAV_CELL = 0.2;

const SQRT2 = Math.SQRT2;

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** 1 where a body can't stand. */
  readonly blocked: Uint8Array;

  constructor(
    readonly bounds: NavBounds,
    readonly cell = NAV_CELL,
    size?: { cols: number; rows: number },
  ) {
    this.cols = size?.cols ?? Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cell - 1e-9));
    this.rows = size?.rows ?? Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / cell - 1e-9));
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  /** The grid of a plan's walk grid (reach.ts walkGrid): open where it is free. */
  static fromWalk(g: Grid): NavGrid {
    const n = new NavGrid({ x0: g.x0, z0: g.z0, x1: g.x0 + g.nx * g.cell, z1: g.z0 + g.nz * g.cell }, g.cell, { cols: g.nx, rows: g.nz });
    for (let i = 0; i < n.blocked.length; i++) n.blocked[i] = g.free[i] ? 0 : 1;
    return n;
  }

  /**
   * The grid for a collision map: every shape that stops walking blocks the cells whose centre is
   * closer to it than `radius`. `skip` leaves shapes out (things that move).
   */
  static build(shapes: { boxes: readonly Box[]; posts: readonly Post[] }, bounds: NavBounds, opts: { radius?: number; cell?: number; skip?: (s: Box | Post) => boolean } = {}): NavGrid {
    const g = new NavGrid(bounds, opts.cell ?? NAV_CELL);
    const r = opts.radius ?? NAV_RADIUS;
    for (const b of shapes.boxes) if (b.walk && !opts.skip?.(b)) g.blockBox(b, r);
    for (const p of shapes.posts) if (p.walk && !opts.skip?.(p)) g.blockCircle(p.cx, p.cz, p.r + r);
    return g;
  }

  /** Cell index of a point, or -1 off the grid. */
  index(x: number, z: number): number {
    const c = Math.floor((x - this.bounds.x0) / this.cell);
    const r = Math.floor((z - this.bounds.z0) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  /** The centre of cell `i`. */
  centre(i: number): Pt {
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    return { x: this.bounds.x0 + (c + 0.5) * this.cell, z: this.bounds.z0 + (r + 0.5) * this.cell };
  }

  isClear(x: number, z: number): boolean {
    const i = this.index(x, z);
    return i >= 0 && this.blocked[i] === 0;
  }

  /** The open cell centre nearest (x, z) within `reach` metres, or null. */
  nearestClear(x: number, z: number, reach = 2.5): Pt | null {
    if (this.isClear(x, z)) return { x, z };
    const c0 = Math.floor((x - this.bounds.x0) / this.cell);
    const r0 = Math.floor((z - this.bounds.z0) / this.cell);
    const rings = Math.ceil(reach / this.cell);
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let k = 1; k <= rings; k++) {
      for (let dr = -k; dr <= k; dr++) {
        for (let dc = -k; dc <= k; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== k) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || this.blocked[r * this.cols + c]) continue;
          const p = this.centre(r * this.cols + c);
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
      // a ring further out can't hold anything nearer than half a cell less than its own radius
      if (best && bestD <= (k - 0.5) * this.cell) break;
    }
    return best && bestD <= reach ? best : null;
  }

  /** True when a body can walk the straight line from a to b: every cell the line crosses is open. */
  lineClear(a: Pt, b: Pt): boolean {
    // walk the cells along the line, one crossing at a time (Amanatides and Woo)
    const x = (a.x - this.bounds.x0) / this.cell;
    const z = (a.z - this.bounds.z0) / this.cell;
    const dx = (b.x - this.bounds.x0) / this.cell - x;
    const dz = (b.z - this.bounds.z0) / this.cell - z;
    let c = Math.floor(x);
    let r = Math.floor(z);
    const ec = Math.floor(x + dx);
    const er = Math.floor(z + dz);
    const open = (cc: number, rr: number) => cc >= 0 && rr >= 0 && cc < this.cols && rr < this.rows && this.blocked[rr * this.cols + cc] === 0;
    if (!open(c, r)) return false;
    const sc = Math.sign(dx);
    const sr = Math.sign(dz);
    const stepC = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const stepR = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let nextC = dx > 0 ? (c + 1 - x) * stepC : dx < 0 ? (x - c) * stepC : Infinity;
    let nextR = dz > 0 ? (r + 1 - z) * stepR : dz < 0 ? (z - r) * stepR : Infinity;
    for (let guard = this.cols + this.rows + 4; (c !== ec || r !== er) && guard > 0; guard--) {
      if (Math.abs(nextC - nextR) < 1e-12) {
        // through a corner exactly: both cells beside it must be open too
        if (!open(c + sc, r) || !open(c, r + sr)) return false;
        c += sc;
        r += sr;
        nextC += stepC;
        nextR += stepR;
      } else if (nextC < nextR) {
        c += sc;
        nextC += stepC;
      } else {
        r += sr;
        nextR += stepR;
      }
      if (!open(c, r)) return false;
      // no crossing left within the line (rounding kept us off the end cell): stop here
      if (nextC > 1 + 1e-9 && nextR > 1 + 1e-9) break;
    }
    return open(ec, er);
  }

  /**
   * A walkable path from `from` to `to`, both ends included (each moved onto open floor first if
   * it stands in a blocked cell), pulled tight. Null when there's no way through.
   */
  path(from: Pt, to: Pt): Pt[] | null {
    const a = this.nearestClear(from.x, from.z);
    const b = this.nearestClear(to.x, to.z);
    if (!a || !b) return null;
    if (this.lineClear(a, b)) return dedupe([a, b]);
    const cells = this.astar(this.index(a.x, a.z), this.index(b.x, b.z));
    if (!cells) return null;
    const raw = [a, ...cells.slice(1, -1).map((i) => this.centre(i)), b];
    return dedupe(this.pull(raw));
  }

  /** Cells from start to goal (inclusive), or null. */
  private astar(start: number, goal: number): number[] | null {
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new Heap();
    const gc = goal % this.cols;
    const gr = (goal - gc) / this.cols;
    const h = (i: number) => {
      const c = i % this.cols;
      const dx = Math.abs(c - gc);
      const dz = Math.abs((i - c) / this.cols - gr);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    g[start] = 0;
    heap.push(start, h(start));
    while (heap.size > 0) {
      const i = heap.pop();
      if (closed[i]) continue;
      if (i === goal) {
        const out: number[] = [];
        for (let k = i; k !== -1; k = parent[k]!) out.push(k);
        return out.reverse();
      }
      closed[i] = 1;
      const c = i % this.cols;
      const r = (i - c) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const j = nr * this.cols + nc;
          if (this.blocked[j] || closed[j]) continue;
          // a diagonal step only where both cells beside it are open (no cutting a corner)
          if (dr !== 0 && dc !== 0 && (this.blocked[r * this.cols + nc] || this.blocked[nr * this.cols + c])) continue;
          const cost = g[i]! + (dr !== 0 && dc !== 0 ? SQRT2 : 1);
          if (cost < g[j]!) {
            g[j] = cost;
            parent[j] = i;
            heap.push(j, cost + h(j));
          }
        }
      }
    }
    return null;
  }

  /** Drop every point a clear straight line can skip. */
  private pull(pts: Pt[]): Pt[] {
    const out: Pt[] = [pts[0]!];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineClear(pts[i]!, pts[j]!)) j--;
      out.push(pts[j]!);
      i = j;
    }
    return out;
  }

  private blockCircle(cx: number, cz: number, r: number): void {
    this.cells(cx - r, cz - r, cx + r, cz + r, (x, z) => Math.hypot(x - cx, z - cz) < r);
  }

  private blockBox(b: Box, r: number): void {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    // the box's reach on the floor, round its turned corners, plus the body
    const ex = Math.abs(b.hx * c) + Math.abs(b.hz * s) + r;
    const ez = Math.abs(b.hx * s) + Math.abs(b.hz * c) + r;
    this.cells(b.cx - ex, b.cz - ez, b.cx + ex, b.cz + ez, (x, z) => {
      const dx = x - b.cx;
      const dz = z - b.cz;
      // into the box's own frame (the same turn the collider uses)
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const ox = Math.max(0, Math.abs(lx) - b.hx);
      const oz = Math.max(0, Math.abs(lz) - b.hz);
      return Math.hypot(ox, oz) < r;
    });
  }

  private cells(x0: number, z0: number, x1: number, z1: number, inside: (x: number, z: number) => boolean): void {
    const c0 = Math.max(0, Math.floor((x0 - this.bounds.x0) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.bounds.x0) / this.cell));
    const r0 = Math.max(0, Math.floor((z0 - this.bounds.z0) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((z1 - this.bounds.z0) / this.cell));
    for (let r = r0; r <= r1; r++) {
      const z = this.bounds.z0 + (r + 0.5) * this.cell;
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        if (this.blocked[i]) continue;
        if (inside(this.bounds.x0 + (c + 0.5) * this.cell, z)) this.blocked[i] = 1;
      }
    }
  }
}

/** How long a path is, in metres. */
export function pathLength(pts: readonly Pt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  return d;
}

function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z) > 1e-6);
}

/** A binary min-heap of cell indices by priority. */
class Heap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      ids[i] = ids[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }

  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[m]! >= lastKey) break;
        ids[i] = ids[m]!;
        keys[i] = keys[m]!;
        i = m;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
