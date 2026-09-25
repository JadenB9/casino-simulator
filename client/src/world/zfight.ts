// Finding z-fighting: two differently dressed surfaces lying in the same plane (within a couple of
// millimetres) and overlapping, so the depth test can't tell which is in front and they flicker
// in stripes as the camera moves (a door's casing and the wall trim running into it, a sign on a
// wall, a rug on the floor). The floor's own check: the unit test runs it over every piece the
// building's batch collects, and the dev floor's `window.casino.zfight()` runs it over the whole
// scene as drawn (props, furniture, stations too).
//
// Faces facing opposite ways are back to back (a box against a wall) and never both drawn, so
// only faces facing the same way count. Same material, same place: nothing to see, so skipped.

export interface Surface {
  /** What it is, for the report (a mesh's name, or a piece's tag). */
  name: string;
  /** Its material: surfaces of one material never count against each other. */
  mat: string;
  /** Triangles in world space, 9 numbers each (non-indexed). */
  pos: ArrayLike<number>;
}

export interface Fight {
  a: string;
  b: string;
  /** How much they overlap (m²) and a point in the middle of the biggest overlap. */
  area: number;
  at: [number, number, number];
  /** The way the faces point. */
  normal: [number, number, number];
  /** How far apart the planes are (m). */
  gap: number;
}

export interface FightOptions {
  /** Planes closer than this count as the same (m). */
  gap?: number;
  /** Overlaps smaller than this are left out (m², summed over each pair of surfaces). */
  minArea?: number;
  /** Where nobody can look from (under the floor, over a ceiling, outside the building): left out. */
  unseen?: (at: [number, number, number], normal: [number, number, number]) => boolean;
}

interface Tri {
  /** Its surface, and its own number (to count a pair met in two buckets once). */
  s: number;
  id: number;
  /** The plane's normal (one way for both sides), its distance along it, and which way this face looks. */
  n: [number, number, number];
  d: number;
  face: 1 | -1;
  /** The triangle in the plane's 2D frame, and its bounds there. */
  p: [number, number][];
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const QN = 40;

/** Every pair of surfaces that fight, biggest overlap first. */
export function findFights(surfaces: readonly Surface[], opts: FightOptions = {}): Fight[] {
  const gap = opts.gap ?? 0.002;
  const minArea = opts.minArea ?? 2e-5;
  // buckets by the plane (either way it faces): its normal, then its distance in steps of `gap`
  const buckets = new Map<string, Tri[]>();
  const put = (key: string, t: Tri) => {
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(t);
  };
  let ids = 0;
  surfaces.forEach((surf, s) => {
    const P = surf.pos;
    for (let i = 0; i + 8 < P.length; i += 9) {
      const ax = P[i]!, ay = P[i + 1]!, az = P[i + 2]!;
      const bx = P[i + 3]! - ax, by = P[i + 4]! - ay, bz = P[i + 5]! - az;
      const cx = P[i + 6]! - ax, cy = P[i + 7]! - ay, cz = P[i + 8]! - az;
      let nx = by * cz - bz * cy;
      let ny = bz * cx - bx * cz;
      let nz = bx * cy - by * cx;
      const len = Math.hypot(nx, ny, nz);
      // degenerate (a BatchedMesh's unused tail, a collapsed cap)
      if (len < 1e-7) continue;
      nx /= len;
      ny /= len;
      nz /= len;
      // the plane's own normal points along +x, else +y, else +z; `face` says which way this one faces
      const face = (Math.abs(nx) > 1e-6 ? nx : Math.abs(ny) > 1e-6 ? ny : nz) > 0 ? 1 : -1;
      const n: [number, number, number] = [nx * face, ny * face, nz * face];
      const d = n[0] * ax + n[1] * ay + n[2] * az;
      const p = project([ax, ay, az, P[i + 3]!, P[i + 4]!, P[i + 5]!, P[i + 6]!, P[i + 7]!, P[i + 8]!], n);
      const us = p.map((q) => q[0]);
      const vs = p.map((q) => q[1]);
      const t: Tri = { s, id: ids++, d, face, n, p, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
      const nk = `${Math.round(n[0] * QN)},${Math.round(n[1] * QN)},${Math.round(n[2] * QN)}`;
      const dk = Math.floor(d / gap);
      // in its own step and the next, so two planes either side of a step boundary still meet
      put(`${nk}|${dk}`, t);
      put(`${nk}|${dk + 1}`, t);
    }
  });

  const pairs = new Map<string, Fight>();
  const best = new Map<Fight, number>();
  const seen = new Set<string>();
  const near = (A: Tri, B: Tri) => B.u0 < A.u1 && A.u0 < B.u1 && B.v0 < A.v1 && A.v0 < B.v1 && Math.abs(A.d - B.d) <= gap && A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] > 0.9995;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    // only surfaces of different materials matter: skip a bucket of one material
    const mats = new Set(list.map((t) => surfaces[t.s]!.mat));
    if (mats.size < 2) continue;
    list.sort((a, b) => a.u0 - b.u0);
    for (let i = 0; i < list.length; i++) {
      const A = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j]!;
        if (B.u0 >= A.u1) break;
        if (A.s === B.s || A.face !== B.face) continue;
        const sa = surfaces[A.s]!;
        const sb = surfaces[B.s]!;
        if (sa.mat === sb.mat || !near(A, B)) continue;
        // the very same triangle drawn twice (a glass drawn in two passes) lands on the same depths: no fight
        if (same(A, B)) continue;
        // a triangle pair lands in two buckets: count it once
        const tk = A.id < B.id ? `${A.id}:${B.id}` : `${B.id}:${A.id}`;
        if (seen.has(tk)) continue;
        seen.add(tk);
        const poly = clip(A.p, B.p);
        let area = polyArea(poly);
        if (area < 1e-7) continue;
        // pressed against something facing the other way (a trim's back on the wall, the ends of
        // two runs of wall meeting, a box's foot on the floor): that part is never seen
        const u0 = Math.min(...poly.map((q) => q[0]));
        const u1 = Math.max(...poly.map((q) => q[0]));
        const v0 = Math.min(...poly.map((q) => q[1]));
        const v1 = Math.max(...poly.map((q) => q[1]));
        const P: Tri = { ...A, p: poly, u0, u1, v0, v1 };
        for (const C of list) {
          if (C.face === A.face || C.u0 >= u1 || !near(P, C)) continue;
          area -= polyArea(clip(poly, C.p));
          if (area < 1e-7) break;
        }
        if (area < 1e-7) continue;
        const nf: [number, number, number] = [A.n[0] * A.face, A.n[1] * A.face, A.n[2] * A.face];
        const at = unproject(centroid(poly), A.n, A.d);
        if (opts.unseen?.(at, nf)) continue;
        const [first, second] = A.s < B.s ? [sa, sb] : [sb, sa];
        const key = `${first.name}|${first.mat}|${second.name}|${second.mat}|${nf.map((v) => Math.round(v * QN)).join(',')}|${Math.round(A.d * 100)}`;
        let f = pairs.get(key);
        if (!f) {
          f = { a: `${first.name} (${first.mat})`, b: `${second.name} (${second.mat})`, area: 0, at: [0, 0, 0], normal: nf, gap: 0 };
          pairs.set(key, f);
        }
        if (area > (best.get(f) ?? 0)) {
          best.set(f, area);
          f.at = at;
        }
        f.area += area;
        f.gap = Math.max(f.gap, Math.abs(A.d - B.d));
      }
    }
  }
  return [...pairs.values()].filter((f) => f.area >= minArea).sort((a, b) => b.area - a.area);
}

/** Two triangles with the same corners (in any order). */
function same(A: Tri, B: Tri): boolean {
  if (Math.abs(A.d - B.d) > 1e-6) return false;
  return A.p.every((q) => B.p.some((r) => Math.abs(q[0] - r[0]) < 1e-6 && Math.abs(q[1] - r[1]) < 1e-6));
}

/** A line for each fight: where, what against what, how much. */
export function describeFight(f: Fight): string {
  const at = f.at.map((v) => v.toFixed(2)).join(', ');
  const n = f.normal.map((v) => (Math.abs(v) < 0.01 ? '0' : v.toFixed(2))).join(',');
  return `(${at}) facing ${n}: ${f.a} vs ${f.b}, ${(f.area * 1e4).toFixed(1)} cm², ${(f.gap * 1000).toFixed(1)} mm apart`;
}

// --- the plane's own 2D frame ------------------------------------------------------------------

/** Two axes in the plane of normal n. */
function frame(nx: number, ny: number, nz: number): [[number, number, number], [number, number, number]] {
  // any vector not along n, crossed with n
  const [hx, hy, hz] = Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = hy * nz - hz * ny;
  let uy = hz * nx - hx * nz;
  let uz = hx * ny - hy * nx;
  const l = Math.hypot(ux, uy, uz);
  ux /= l;
  uy /= l;
  uz /= l;
  return [
    [ux, uy, uz],
    [ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux],
  ];
}

function project(v: number[], n: [number, number, number]): [number, number][] {
  const [u, w] = frame(n[0], n[1], n[2]);
  const out: [number, number][] = [];
  for (let k = 0; k < 9; k += 3) out.push([v[k]! * u[0] + v[k + 1]! * u[1] + v[k + 2]! * u[2], v[k]! * w[0] + v[k + 1]! * w[1] + v[k + 2]! * w[2]]);
  // counter-clockwise, for the clipper
  if (signed(out) < 0) out.reverse();
  return out;
}

function unproject(c: [number, number], n: [number, number, number], d: number): [number, number, number] {
  const [u, w] = frame(n[0], n[1], n[2]);
  return [0, 1, 2].map((k) => c[0] * u[k]! + c[1] * w[k]! + d * n[k]!) as [number, number, number];
}

function signed(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function polyArea(p: [number, number][]): number {
  return p.length < 3 ? 0 : Math.abs(signed(p));
}

function centroid(p: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const q of p) {
    x += q[0];
    y += q[1];
  }
  return [x / p.length, y / p.length];
}

/** The overlap of two convex counter-clockwise polygons (Sutherland-Hodgman). */
function clip(subject: [number, number][], by: [number, number][]): [number, number][] {
  let out = subject;
  for (let i = 0; i < by.length && out.length; i++) {
    const [ax, ay] = by[i]!;
    const [bx, by2] = by[(i + 1) % by.length]!;
    const inside = (p: [number, number]) => (bx - ax) * (p[1] - ay) - (by2 - ay) * (p[0] - ax) >= -1e-12;
    const cut = (p: [number, number], q: [number, number]): [number, number] => {
      const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1];
      const den = (x1 - x2) * (ay - by2) - (y1 - y2) * (ax - bx);
      if (Math.abs(den) < 1e-15) return q;
      const t = ((x1 - ax) * (ay - by2) - (y1 - ay) * (ax - bx)) / den;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const cur = input[k]!;
      const prev = input[(k + input.length - 1) % input.length]!;
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
  }
  return out;
}
