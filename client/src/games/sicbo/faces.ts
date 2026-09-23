// Which way up a die comes to rest. Pure arithmetic on [x, y, z, w] quaternions (no three.js), so
// the shared tests can check that every rolled face ends flat on top.
//
// A three.js box has its faces in the order +x, -x, +y, -y, +z, -z; the dice carry 3, 4, 1, 6,
// 2, 5 there (opposite faces add up to 7). To show face n: first turn n's normal up, then spin
// the die about the vertical. The order matters: spinning about the die's own axis first would
// tip any face but 1 and 6 off the top.

export type Quat = [x: number, y: number, z: number, w: number];

export const FACE_ORDER = [3, 4, 1, 6, 2, 5] as const;

const NORMALS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** The die-local normal of face n. */
export function faceNormal(face: number): [number, number, number] {
  const i = FACE_ORDER.indexOf(face as (typeof FACE_ORDER)[number]);
  if (i < 0) throw new RangeError(`no face ${face}`);
  return NORMALS[i]!;
}

export function mul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** v turned by q. */
export function rotate(q: Quat, v: [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** The rotation that turns face n up. */
export function faceUp(face: number): Quat {
  const [nx, ny, nz] = faceNormal(face);
  // shortest arc from n to +y: [n × up, 1 + n · up], normalised. For 6 (straight down) any half
  // turn about a level axis will do.
  if (ny < -0.5) return [1, 0, 0, 0];
  const q: Quat = [-nz, 0, nx, 1 + ny];
  const len = Math.hypot(...q);
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Face n on top, spun `yaw` radians about the vertical. */
export function restRotation(face: number, yaw: number): Quat {
  const spin: Quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  return mul(spin, faceUp(face));
}

/** The face that points up under rotation q, and how straight up it points (1 = flat). */
export function topFace(q: Quat): { face: number; up: number } {
  let best = { face: 0, up: -2 };
  FACE_ORDER.forEach((face, i) => {
    const up = rotate(q, NORMALS[i]!)[1];
    if (up > best.up) best = { face, up };
  });
  return best;
}
