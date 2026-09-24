// Can you walk there? The floor plan rasterised onto a grid: a cell is free when a walker (a
// circle of the player's radius) can stand in it without touching a wall, a station or anything
// solid standing on the floor. Only the plan's own data is used (no models), so the unit tests can
// ask it: is every seat, counter and table reachable from the doors, and is a waiter's loop clear.

import type { FloorPlan, Solid } from './layout.ts';

/** The walker's radius (player.ts), and the grid's cell. */
export const WALKER_R = 0.3;
const CELL = 0.1;
/** Anything whose bottom is lower than this is in a walker's way (a sign or a pendant overhead isn't). */
const BODY_H = 1.2;

export interface Grid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** 1 where a walker can stand. */
  free: Uint8Array;
}

type Shape = { kind: 'box'; x: number; z: number; hx: number; hz: number; yaw: number } | { kind: 'round'; x: number; z: number; r: number };

/** What blocks walking in a plan: its walls, its stations and the solids standing on the floor. */
export function blockers(plan: FloorPlan): Shape[] {
  const out: Shape[] = [];
  for (const w of plan.walls) out.push({ kind: 'box', x: (w.x0 + w.x1) / 2, z: (w.z0 + w.z1) / 2, hx: (w.x1 - w.x0) / 2, hz: (w.z1 - w.z0) / 2, yaw: 0 });
  for (const s of plan.stations) out.push({ kind: 'box', x: s.x, z: s.z, hx: s.fp.width / 2, hz: s.fp.depth / 2, yaw: s.yaw });
  for (const s of plan.solids) if (s.y0 < BODY_H) out.push(shapeOf(s));
  return out;
}

function shapeOf(s: Solid): Shape {
  return s.round ? { kind: 'round', x: s.x, z: s.z, r: s.walk ?? s.w / 2 } : { kind: 'box', x: s.x, z: s.z, hx: s.w / 2, hz: s.d / 2, yaw: s.yaw };
}

/** Distance from a point to a shape (0 inside it). */
function distance(sh: Shape, x: number, z: number): number {
  if (sh.kind === 'round') return Math.max(0, Math.hypot(x - sh.x, z - sh.z) - sh.r);
  const c = Math.cos(sh.yaw);
  const s = Math.sin(sh.yaw);
  const dx = x - sh.x;
  const dz = z - sh.z;
  // into the box's own frame (the inverse of Object3D's turn)
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ox = Math.max(0, Math.abs(lx) - sh.hx);
  const oz = Math.max(0, Math.abs(lz) - sh.hz);
  return Math.hypot(ox, oz);
}

/**
 * The walkable grid of a plan. Outside the building is blocked; each blocker marks the cells within
 * `radius` of it. `extra` adds more blockers (the staff's posts, a test's own).
 */
export function walkGrid(plan: FloorPlan, opts: { radius?: number; extra?: Shape[]; cell?: number } = {}): Grid {
  const radius = opts.radius ?? WALKER_R;
  const cell = opts.cell ?? CELL;
  const R = plan.room;
  const x0 = R.x0 - 1;
  const z0 = R.z0 - 1;
  const nx = Math.ceil((R.x1 - R.x0 + 2) / cell);
  const nz = Math.ceil((R.z1 - R.z0 + 2) / cell);
  const free = new Uint8Array(nx * nz);
  // inside a room or a doorway; the walls themselves then keep walkers a radius from their faces
  const inside = [...plan.rooms.map((r) => r.inner), ...plan.doorways];
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell;
      if (inside.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) free[j * nx + i] = 1;
    }
  }
  for (const sh of [...blockers(plan), ...(opts.extra ?? [])]) {
    const reach = sh.kind === 'round' ? sh.r : Math.hypot(sh.hx, sh.hz);
    const i0 = Math.max(0, Math.floor((sh.x - reach - radius - x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((sh.x + reach + radius - x0) / cell));
    const j0 = Math.max(0, Math.floor((sh.z - reach - radius - z0) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((sh.z + reach + radius - z0) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        if (!free[j * nx + i]) continue;
        if (distance(sh, x0 + (i + 0.5) * cell, z) < radius) free[j * nx + i] = 0;
      }
    }
  }
  return { x0, z0, cell, nx, nz, free };
}

function index(g: Grid, x: number, z: number): number {
  const i = Math.floor((x - g.x0) / g.cell);
  const j = Math.floor((z - g.z0) / g.cell);
  return i < 0 || j < 0 || i >= g.nx || j >= g.nz ? -1 : j * g.nx + i;
}

export function isFree(g: Grid, x: number, z: number): boolean {
  const k = index(g, x, z);
  return k >= 0 && g.free[k] === 1;
}

/** Every cell reachable from (x, z), flood-filled (4-connected). */
export function reachFrom(g: Grid, x: number, z: number): Uint8Array {
  const seen = new Uint8Array(g.free.length);
  const start = index(g, x, z);
  if (start < 0 || !g.free[start]) return seen;
  const queue = new Int32Array(g.free.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const k = queue[head++]!;
    const i = k % g.nx;
    const j = (k - i) / g.nx;
    const next = [i > 0 ? k - 1 : -1, i < g.nx - 1 ? k + 1 : -1, j > 0 ? k - g.nx : -1, j < g.nz - 1 ? k + g.nx : -1];
    for (const n of next) {
      if (n < 0 || seen[n] || !g.free[n]) continue;
      seen[n] = 1;
      queue[tail++] = n;
    }
  }
  return seen;
}

/** Whether (x, z), or a free cell within `near` metres of it, is in the reached set. */
export function reached(g: Grid, seen: Uint8Array, x: number, z: number, near = 0): boolean {
  const k = index(g, x, z);
  if (k >= 0 && seen[k]) return true;
  if (near <= 0) return false;
  const n = Math.ceil(near / g.cell);
  for (let dj = -n; dj <= n; dj++) {
    for (let di = -n; di <= n; di++) {
      if (Math.hypot(di, dj) * g.cell > near) continue;
      const kk = index(g, x + di * g.cell, z + dj * g.cell);
      if (kk >= 0 && seen[kk]) return true;
    }
  }
  return false;
}

/** Whether a walker can go straight from a to b (every cell along the line free). */
export function segmentClear(g: Grid, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / (g.cell / 2)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    if (!isFree(g, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}
