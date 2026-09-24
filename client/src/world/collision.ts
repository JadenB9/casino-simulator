// Walking collision for the floor: the player is a circle on the ground plane, everything solid is
// an oriented box (walls, counters, station footprints) or an upright cylinder (columns, planters,
// stools). The follow camera asks the same shapes how far it can back away before hitting one.
// A few hundred shapes at most, so a flat list is plenty.

export interface Box {
  cx: number;
  cz: number;
  /** Half extents along the box's own x and z. */
  hx: number;
  hz: number;
  /** Same convention as Object3D.rotation.y. */
  yaw: number;
  /** Top of the box; the camera ray passes over anything lower than it is. */
  top: number;
  /** Bottom of the box for the camera (a lintel over a door starts high); walking ignores it. */
  bottom: number;
  /** Walk-through for the player but still stops the camera (hanging signs), or the reverse. */
  walk: boolean;
  cam: boolean;
}

export interface Post {
  cx: number;
  cz: number;
  r: number;
  top: number;
  walk: boolean;
  cam: boolean;
}

export class Collider {
  readonly boxes: Box[] = [];
  readonly posts: Post[] = [];

  box(cx: number, cz: number, width: number, depth: number, yaw = 0, top = 2, opts: { walk?: boolean; cam?: boolean; bottom?: number } = {}): Box {
    const b: Box = { cx, cz, hx: width / 2, hz: depth / 2, yaw, top, bottom: opts.bottom ?? 0, walk: opts.walk ?? true, cam: opts.cam ?? true };
    this.boxes.push(b);
    return b;
  }

  post(cx: number, cz: number, r: number, top = 3, opts: { walk?: boolean; cam?: boolean } = {}): Post {
    const p: Post = { cx, cz, r, top, walk: opts.walk ?? true, cam: opts.cam ?? true };
    this.posts.push(p);
    return p;
  }

  /** Push a walker of radius `r` at `p` out of everything it overlaps (in place). Three passes settle corners. */
  resolve(p: { x: number; z: number }, r: number): void {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const b of this.boxes) {
        if (!b.walk) continue;
        const dx = p.x - b.cx;
        const dz = p.z - b.cz;
        // quick reject on the bounding circle
        const reach = r + Math.max(b.hx, b.hz) * 1.415;
        if (dx * dx + dz * dz > reach * reach) continue;
        const c = Math.cos(b.yaw);
        const s = Math.sin(b.yaw);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx));
        const qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let ox = lx - qx;
        let oz = lz - qz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;
        let nx: number;
        let nz: number;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = (ox / d) * (r - d);
          nz = (oz / d) * (r - d);
        } else {
          // centre inside the box: leave by the nearest face
          const px = b.hx - Math.abs(lx);
          const pz = b.hz - Math.abs(lz);
          if (px < pz) {
            nx = Math.sign(lx || 1) * (px + r);
            nz = 0;
          } else {
            nx = 0;
            nz = Math.sign(lz || 1) * (pz + r);
          }
        }
        // back to world space
        ox = nx * c + nz * s;
        oz = -nx * s + nz * c;
        p.x += ox;
        p.z += oz;
        moved = true;
      }
      for (const q of this.posts) {
        if (!q.walk) continue;
        const dx = p.x - q.cx;
        const dz = p.z - q.cz;
        const min = r + q.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1e-5;
        p.x = q.cx + (dx / d) * min;
        p.z = q.cz + (dz / d) * min;
        moved = true;
      }
      if (!moved) break;
    }
  }

  /**
   * How far a ray from `o` along unit `dir` travels before it enters a camera-blocking shape,
   * capped at `max`. Shapes stand on the floor, so a ray above a shape's top passes over it.
   */
  raycast(o: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number): number {
    let best = max;
    for (const b of this.boxes) {
      if (!b.cam) continue;
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      const rx = o.x - b.cx;
      const rz = o.z - b.cz;
      const lox = rx * c - rz * s;
      const loz = rx * s + rz * c;
      const ldx = dir.x * c - dir.z * s;
      const ldz = dir.x * s + dir.z * c;
      const t = slab3(lox, o.y, loz, ldx, dir.y, ldz, -b.hx, b.bottom, -b.hz, b.hx, b.top, b.hz);
      if (t !== null && t < best) best = t;
    }
    for (const q of this.posts) {
      if (!q.cam) continue;
      const t = rayCylinder(o, dir, q);
      if (t !== null && t < best) best = t;
    }
    return best;
  }
}

/** Entry distance of a ray into an axis-aligned box, or null when it misses (or starts inside). */
function slab3(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const axes: [number, number, number, number][] = [
    [ox, dx, x0, x1],
    [oy, dy, y0, y1],
    [oz, dz, z0, z1],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  // a ray that starts inside a shape (the player brushing a wall) shouldn't collapse the camera
  return tmin > 0 ? tmin : null;
}

function rayCylinder(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, q: Post): number | null {
  const fx = o.x - q.cx;
  const fz = o.z - q.cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (fx * d.x + fz * d.z);
  const c = fx * fx + fz * fz - q.r * q.r;
  if (c < 0) return null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const y = o.y + d.y * t;
  return y >= 0 && y <= q.top ? t : null;
}
