// v7: the loop road. The street in front of the valet no longer runs off into the backdrop at both
// ends: it turns east at each end, runs along the far side of the stores, down the east side of the
// jail's and the garage's block and back, a rounded rectangle of road about 430 m round with a
// sidewalk either side. Cars drive it (traffic, and anyone driving their own car: world/drive/).
//
// Everything here is metres and pure: the centre line as a rounded rectangle, a lane at any offset
// from it (outward positive), a point and heading at a distance round a lane, and how far any
// point is from the centre line.

/** The centre line: the street's middle (x0) to the east road's (x1), the north and south roads' middles (z). */
export const LOOP = { x0: 158.5, x1: 208, z0: -70, z1: 70, r: 14, half: 5, walk: 3 } as const;

/** Lanes, outward positive: the outer two drive with the street's southbound lanes (+z on the street). */
export const LANES = [3.75, 1.25, -1.25, -3.75] as const;

const CX = (LOOP.x0 + LOOP.x1) / 2;
const CZ = (LOOP.z0 + LOOP.z1) / 2;
const HX = (LOOP.x1 - LOOP.x0) / 2;
const HZ = (LOOP.z1 - LOOP.z0) / 2;

/**
 * Signed distance from the centre line (m): 0 on it, positive outside the loop, negative inside.
 * (A rounded box's distance: the straight runs and the four quarter circles.)
 */
export function loopDist(x: number, z: number): number {
  const qx = Math.abs(x - CX) - (HX - LOOP.r);
  const qz = Math.abs(z - CZ) - (HZ - LOOP.r);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return out + Math.min(Math.max(qx, qz), 0) - LOOP.r;
}

/** On the roadway (between the curbs)? */
export function onLoopRoad(x: number, z: number, margin = 0): boolean {
  return Math.abs(loopDist(x, z)) <= LOOP.half + margin;
}

/** The corners' middles (each quarter circle's centre). */
export const CORNERS = [
  { x: LOOP.x0 + LOOP.r, z: LOOP.z1 - LOOP.r, a0: Math.PI / 2, a1: Math.PI }, // street's +z end
  { x: LOOP.x1 - LOOP.r, z: LOOP.z1 - LOOP.r, a0: 0, a1: Math.PI / 2 },
  { x: LOOP.x1 - LOOP.r, z: LOOP.z0 + LOOP.r, a0: -Math.PI / 2, a1: 0 },
  { x: LOOP.x0 + LOOP.r, z: LOOP.z0 + LOOP.r, a0: Math.PI, a1: (3 * Math.PI) / 2 }, // street's -z end
] as const;

/** A lane's length round the loop (offset `o` outward from the centre line). */
export function laneLength(o: number): number {
  const r = LOOP.r + o;
  return 2 * (2 * HX - 2 * LOOP.r) + 2 * (2 * HZ - 2 * LOOP.r) + 2 * Math.PI * r;
}

/**
 * The point `s` metres round a lane at offset `o`, and the heading there (yaw: 0 faces +z). The
 * distance runs the way the outer lanes drive: down the street (+z), east along the +z road, back
 * up the east road (-z), west along the -z road. `dir` -1 drives it the other way (the inner lanes).
 */
export function laneAt(o: number, s: number, dir: 1 | -1 = 1): { x: number; z: number; yaw: number } {
  const r = LOOP.r + o;
  const L = laneLength(o);
  let t = ((s % L) + L) % L;
  const sx = 2 * HX - 2 * LOOP.r;
  const sz = 2 * HZ - 2 * LOOP.r;
  const quarter = (Math.PI / 2) * r;
  const x0 = LOOP.x0 - o;
  const x1 = LOOP.x1 + o;
  const z0 = LOOP.z0 - o;
  const z1 = LOOP.z1 + o;
  let p: { x: number; z: number; yaw: number };
  // the street, +z
  if (t < sz) p = { x: x0, z: LOOP.z0 + LOOP.r + t, yaw: 0 };
  else if ((t -= sz) < quarter) {
    const a = Math.PI - t / r;
    const c = CORNERS[0];
    p = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, yaw: t / r };
  } else if ((t -= quarter) < sx) p = { x: LOOP.x0 + LOOP.r + t, z: z1, yaw: Math.PI / 2 };
  else if ((t -= sx) < quarter) {
    const a = Math.PI / 2 - t / r;
    const c = CORNERS[1];
    p = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, yaw: Math.PI / 2 + t / r };
  } else if ((t -= quarter) < sz) p = { x: x1, z: LOOP.z1 - LOOP.r - t, yaw: Math.PI };
  else if ((t -= sz) < quarter) {
    const a = -t / r;
    const c = CORNERS[2];
    p = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, yaw: Math.PI + t / r };
  } else if ((t -= quarter) < sx) p = { x: LOOP.x1 - LOOP.r - t, z: z0, yaw: -Math.PI / 2 };
  else {
    t -= sx;
    const a = -Math.PI / 2 - t / r;
    const c = CORNERS[3];
    p = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, yaw: -Math.PI / 2 + t / r };
  }
  if (dir < 0) p.yaw += Math.PI;
  return p;
}
