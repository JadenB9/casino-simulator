// The body builder: a car from its spec (specs.ts). The body is its side silhouette, closed along
// the sills and up round the wheel arches, extruded across the car's width with a rounded edge,
// then pulled in at the nose and the tail (plan view) and above the shoulder (tumblehome), and
// smoothed so the paint reads as one curved panel. The glasshouse is a second, narrower
// silhouette on top, its flat top painted as the roof. Then the details a car is recognised by:
// lamps set into the nose and tail at the angle of the panel they sit on, a grille, bumpers,
// mirrors, wheels with tyres and rims, and each kind's extras (fins, a wing, roof lamps, a teak
// deck, stripes).
//
// Every piece is baked into a handful of geometries, one per material (paint, trim, metal, glass,
// lamps, and gold leaf), with the colour in the vertices: a whole car is five or six draw calls,
// and a car park of them merged together is the same five or six.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_SPECS, type CarSpec } from './specs.ts';

/** The materials a car is drawn with (materials.ts makes them); `glow` is a lamp switched on. */
export type CarMat = 'paint' | 'trim' | 'metal' | 'glass' | 'lamp' | 'glow' | 'gold';
export const CAR_MATS: readonly CarMat[] = ['paint', 'trim', 'metal', 'glass', 'lamp', 'glow', 'gold'];

/** Where a piece goes: `paint` takes the car's colour; `accent` is paint that keeps its own (stripes). */
type Part = Exclude<CarMat, 'gold' | 'glow'> | 'accent';

/** The rounded edge, all round the body. */
const B = 0.045;
const HEAD = '#fff4dc';
const TAIL = '#a8101a';
const TYRE = '#131314';
const CHROME = '#d9dde2';
const DARK = '#1b1c1f';

type Geos = Map<Part, THREE.BufferGeometry[]>;

const tmpColor = new THREE.Color();

/** A piece ready to merge: unindexed, no UVs, normals, and its colour in every vertex. */
function prep(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  tmpColor.set(color);
  for (let i = 0; i < n; i++) {
    c[i * 3] = tmpColor.r;
    c[i * 3 + 1] = tmpColor.g;
    c[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function add(geos: Geos, part: Part, geo: THREE.BufferGeometry, color: string): void {
  const list = geos.get(part) ?? [];
  list.push(prep(geo, color));
  geos.set(part, list);
}

/** A box of size (w, h, d) at (x, y, z), turned by the quaternion if given. */
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, q?: THREE.Quaternion): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (q) g.applyQuaternion(q);
  g.translate(x, y, z);
  return g;
}

/** A disc facing +z (a lamp lens), radius r, depth d. */
function lens(r: number, d: number, seg = 14): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, d, seg).rotateX(Math.PI / 2);
}

/** Shape measurements along the silhouette. */
class Outline {
  readonly zF: number;
  readonly zR: number;
  readonly top: number;
  constructor(readonly pts: [number, number][]) {
    this.zR = pts[0]![0];
    this.zF = pts.at(-1)![0];
    this.top = Math.max(...pts.map((p) => p[1]));
  }

  /** The top line's height at z (the highest crossing). */
  yAt(z: number): number {
    let best = -Infinity;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const [z0, y0] = this.pts[i]!;
      const [z1, y1] = this.pts[i + 1]!;
      if (z < Math.min(z0, z1) || z > Math.max(z0, z1) || z0 === z1) continue;
      best = Math.max(best, y0 + ((z - z0) / (z1 - z0)) * (y1 - y0));
    }
    return best === -Infinity ? this.pts[0]![1] : best;
  }

  /**
   * Where the front (or the back) of the silhouette crosses height y, and which way the panel
   * there faces in the side view (a unit [nz, ny] pointing out of the car).
   */
  face(end: 'front' | 'rear', y: number): { z: number; nz: number; ny: number } {
    let best: { z: number; nz: number; ny: number } | null = null;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const [z0, y0] = this.pts[i]!;
      const [z1, y1] = this.pts[i + 1]!;
      if (y < Math.min(y0, y1) || y > Math.max(y0, y1) || y0 === y1) continue;
      const z = z0 + ((y - y0) / (y1 - y0)) * (z1 - z0);
      // the outward normal of a segment walked tail to nose over the top: (dy, -dz) rotated
      const dz = z1 - z0;
      const dy = y1 - y0;
      const len = Math.hypot(dz, dy);
      const n = { z, nz: dy / len, ny: -dz / len };
      if (n.ny < 0) {
        n.nz = -n.nz;
        n.ny = -n.ny;
      }
      if (end === 'front' && (!best || z > best.z)) best = { z, nz: Math.abs(n.nz), ny: n.ny };
      if (end === 'rear' && (!best || z < best.z)) best = { z, nz: -Math.abs(n.nz), ny: n.ny };
    }
    return best ?? { z: end === 'front' ? this.zF : this.zR, nz: end === 'front' ? 1 : -1, ny: 0 };
  }
}

/** The plan-view pinch at the nose and the tail: 1 in the middle, less towards the ends. */
function taper(s: CarSpec, o: Outline, z: number): number {
  let k = 1;
  const [nk, nl] = s.nose;
  const [tk, tl] = s.tail;
  if (z > o.zF - nl) k -= nk * ((z - (o.zF - nl)) / nl) ** 2;
  if (z < o.zR + tl) k -= tk * ((o.zR + tl - z) / tl) ** 2;
  return Math.max(0.2, k);
}

/** The body's half-width at (y, z), where its side is. */
function sideAt(s: CarSpec, o: Outline, y: number, z: number): number {
  const t = THREE.MathUtils.clamp((y - s.shoulder) / Math.max(0.05, o.top - s.shoulder), 0, 1);
  return s.half * taper(s, o, z) * (1 - s.tumble * t ** 1.5) + B;
}

/** Extrude a side silhouette across a width (the car's x) and turn it into the car's frame. */
function extrude(shape: THREE.Shape, half: number, segments = 10): THREE.BufferGeometry {
  const depth = Math.max(0.05, 2 * (half - B));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelSegments: 2, curveSegments: segments, steps: 1 });
  // shape x is the car's z, shape y its height, the extrusion its width
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  return g;
}

/** Soften a deformed extrusion: shared corners, normals averaged. */
function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

function buildBody(s: CarSpec, o: Outline, geos: Geos): void {
  const shape = new THREE.Shape();
  const pts = s.body;
  shape.moveTo(pts[0]![0], pts[0]![1]);
  for (const [z, y] of pts.slice(1)) shape.lineTo(z, y);
  // down the nose and back along the sills, up and over each wheel
  const ar = s.wheelR + 0.07;
  const a0 = Math.asin(THREE.MathUtils.clamp((s.sill - s.wheelR) / ar, -1, 1));
  shape.lineTo(o.zF - 0.12, s.sill);
  shape.lineTo(s.front + ar * Math.cos(a0), s.sill);
  shape.absarc(s.front, s.wheelR, ar, a0, Math.PI - a0, false);
  shape.lineTo(s.rear + ar * Math.cos(a0), s.sill);
  shape.absarc(s.rear, s.wheelR, ar, a0, Math.PI - a0, false);
  shape.lineTo(o.zR + 0.12, s.sill);
  shape.closePath();
  const g = extrude(shape, s.half);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const t = THREE.MathUtils.clamp((y - s.shoulder) / Math.max(0.05, o.top - s.shoulder), 0, 1);
    p.setX(i, x * taper(s, o, z) * (1 - s.tumble * t ** 1.5));
  }
  add(geos, 'paint', smooth(g), '#ffffff');
  // the wheel wells: dark, so the arches read as openings
  for (const az of [s.front, s.rear]) {
    const well = new THREE.CylinderGeometry(ar - 0.02, ar - 0.02, 2 * s.half * taper(s, o, az) - 0.06, 20, 1, true, Math.PI / 2 - 1.2, 2.4).rotateZ(Math.PI / 2);
    well.translate(0, s.wheelR, az);
    // seen from under the arch: its inside faces out
    add(geos, 'trim', flipWinding(well.toNonIndexed()), '#0c0c0d');
  }
}

function buildCabin(s: CarSpec, o: Outline, geos: Geos): { roofY: number; roofZ: [number, number] } | null {
  if (!s.cabin) return null;
  const pts = s.cabin;
  const base = Math.min(pts[0]![1], pts.at(-1)![1]);
  const top = Math.max(...pts.map((p) => p[1]));
  const shape = new THREE.Shape();
  shape.moveTo(pts[0]![0], pts[0]![1]);
  for (const [z, y] of pts.slice(1)) shape.lineTo(z, y);
  shape.closePath();
  const half = s.cabinHalf ?? s.half * 0.85;
  const g = extrude(shape, half, 4);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - base) / Math.max(0.05, top - base), 0, 1);
    p.setX(i, p.getX(i) * taper(s, o, p.getZ(i)) * (1 - (s.cabinTumble ?? 0.15) * t));
  }
  // the flat top is the roof, painted; the rest is glass
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  const pos = flat.getAttribute('position');
  const nor = flat.getAttribute('normal');
  const roof: number[] = [];
  const glass: number[] = [];
  const sail = s.sail ?? -Infinity;
  for (let i = 0; i < pos.count; i += 3) {
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    // the flat top; and the side behind the last window (a fastback's sail, a saloon's C-pillar)
    const painted = (nor.getY(i) > 0.965 && pos.getY(i) > top - 0.1) || (Math.abs(nor.getX(i)) > 0.5 && cz < sail);
    const out = painted ? roof : glass;
    for (let k = 0; k < 3; k++) out.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
  }
  const piece = (arr: number[]) => {
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    q.computeVertexNormals();
    return q;
  };
  if (roof.length) add(geos, 'paint', piece(roof), '#ffffff');
  add(geos, 'glass', piece(glass), '#ffffff');
  // the roof's extent, for the roof's extras
  const flatPts = pts.filter((q) => q[1] > top - 0.1);
  const zs = flatPts.map((q) => q[0]);
  // pillars: dark posts down the side glass (a limousine's run of windows)
  for (const pz of s.pillars ?? []) {
    const x0 = half * taper(s, o, pz) + B + 0.004;
    const x1 = half * taper(s, o, pz) * (1 - (s.cabinTumble ?? 0.15)) + B + 0.004;
    const w = 0.05;
    const yb = base + 0.02;
    const yt = top - 0.02;
    for (const side of [1, -1]) {
      const q = new THREE.BufferGeometry();
      const v = [side * x0, yb, pz + w, side * x0, yb, pz - w, side * x1, yt, pz - w, side * x0, yb, pz + w, side * x1, yt, pz - w, side * x1, yt, pz + w];
      q.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      q.computeVertexNormals();
      // facing out, whichever side it's on
      if (Math.sign(q.getAttribute('normal').getX(0)) !== side) flipWinding(q);
      add(geos, 'trim', q, DARK);
    }
  }
  return { roofY: top + B, roofZ: [Math.min(...zs), Math.max(...zs)] };
}

function flipWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const a = p.array as Float32Array;
  for (let i = 0; i < p.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const t = a[(i + 1) * 3 + k]!;
      a[(i + 1) * 3 + k] = a[(i + 2) * 3 + k]!;
      a[(i + 2) * 3 + k] = t;
    }
  }
  g.computeVertexNormals();
  return g;
}

/** A strip laid on the body's (or the roof's) top between z0 and z1, x from xa to xb, following its line. */
function topStrip(heightAt: (z: number) => number, z0: number, z1: number, xa: (z: number) => number, xb: (z: number) => number, lift = 0.008): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((z1 - z0) / 0.12));
  const v: number[] = [];
  for (let i = 0; i < n; i++) {
    const za = z0 + ((z1 - z0) * i) / n;
    const zb = z0 + ((z1 - z0) * (i + 1)) / n;
    const ya = heightAt(za) + B + lift;
    const yb = heightAt(zb) + B + lift;
    v.push(xb(za), ya, za, xa(za), ya, za, xa(zb), yb, zb, xb(za), ya, za, xa(zb), yb, zb, xb(zb), yb, zb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  // make it face up
  if (g.getAttribute('normal').getY(0) < 0) flipWinding(g);
  return g;
}

function buildOpen(s: CarSpec, o: Outline, geos: Geos): void {
  const op = s.open;
  if (!op) return;
  // the cockpit: a dark opening in the top, the seats' backs standing out of it
  const [c0, c1] = op.cockpit;
  const inset = (z: number) => s.half * taper(s, o, z) * (1 - s.tumble) - 0.12;
  add(geos, 'trim', topStrip((z) => o.yAt(z), c0, c1, (z) => -inset(z), (z) => inset(z), 0.004), shade(s.interior, 0.35));
  const rows = op.seats > 2 ? [c0 + 0.32, c0 + (c1 - c0) * 0.62] : [c0 + (c1 - c0) * 0.42];
  const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.22);
  const y = o.yAt((c0 + c1) / 2) + B;
  for (const rz of rows)
    for (const sx of [0.34, -0.34]) {
      add(geos, 'trim', box(0.44, 0.46, 0.1, sx * (s.half / 0.9), y + 0.12, rz, lean), s.interior);
      add(geos, 'trim', box(0.24, 0.12, 0.09, sx * (s.half / 0.9), y + 0.42, rz - 0.07, lean), s.interior);
    }
  // the driver's wheel (left-hand drive: +x)
  const wheel = new THREE.TorusGeometry(0.17, 0.018, 6, 20).rotateX(-0.5);
  wheel.translate(0.34 * (s.half / 0.9), y + 0.18, rows.at(-1)! + 0.48);
  add(geos, 'trim', wheel, '#161616');
  // the windscreen, raked back, in a chrome frame
  const w = 2 * s.half * taper(s, o, op.screenZ) * 0.86;
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -op.rake);
  const cy = op.screenY + B + (op.screenH / 2) * Math.cos(op.rake);
  const cz = op.screenZ - (op.screenH / 2) * Math.sin(op.rake);
  add(geos, 'glass', box(w, op.screenH, 0.02, 0, cy, cz, tilt), '#ffffff');
  const up = new THREE.Vector3(0, op.screenH / 2, 0).applyQuaternion(tilt);
  add(geos, 'metal', box(w + 0.04, 0.03, 0.035, 0, cy + up.y, cz + up.z, tilt), CHROME);
  for (const sx of [1, -1]) add(geos, 'metal', box(0.03, op.screenH, 0.035, (sx * (w + 0.02)) / 2, cy, cz, tilt), CHROME);
}

/** A colour darkened (k < 1) or lightened. */
function shade(hex: string, k: number): string {
  return `#${tmpColor.set(hex).multiplyScalar(k).getHexString()}`;
}

/** A piece set on the nose or the tail at height y, facing the way the panel faces there. */
function onFace(o: Outline, end: 'front' | 'rear', y: number, geo: THREE.BufferGeometry, x: number, out = 0): THREE.BufferGeometry {
  const f = o.face(end, y);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, f.ny, f.nz).normalize());
  geo.applyQuaternion(q);
  const dz = f.nz * (B + out);
  const dy = f.ny * (B + out);
  geo.translate(x, y + dy, f.z + dz);
  return geo;
}

function buildLamps(s: CarSpec, o: Outline, geos: Geos): void {
  const fz = o.face('front', s.lampY).z;
  const rz = o.face('rear', s.tailY).z;
  const hx = s.lampX * taper(s, o, fz);
  const tx = s.lampX * taper(s, o, rz) * 1.05;
  for (const side of [1, -1]) {
    if (s.lamps === 'round' || s.lamps === 'quad') {
      const spots = s.lamps === 'quad' ? [hx + 0.1, hx - 0.1] : [hx];
      const r = s.lamps === 'quad' ? 0.07 : 0.095;
      for (const lx of spots) {
        add(geos, 'lamp', onFace(o, 'front', s.lampY, lens(r, 0.04), side * lx, 0.004), HEAD);
        add(geos, 'metal', onFace(o, 'front', s.lampY, new THREE.TorusGeometry(r + 0.008, 0.013, 6, 18), side * lx, 0.02), s.chrome ? CHROME : DARK);
      }
    } else {
      const [w, h] = s.lamps === 'rect' ? [0.32, 0.12] : [0.4, 0.055];
      add(geos, 'lamp', onFace(o, 'front', s.lampY, box(w, h, 0.03), side * hx, 0.002), HEAD);
    }
    // tail lamps: a bar on the modern ones, a round pair on the old
    if (s.chrome && s.lamps === 'round') add(geos, 'lamp', onFace(o, 'rear', s.tailY, lens(0.07, 0.04), side * tx, 0.004), TAIL);
    else add(geos, 'lamp', onFace(o, 'rear', s.tailY, box(s.lamps === 'slit' ? 0.5 : 0.36, s.lamps === 'slit' ? 0.05 : 0.11, 0.03), side * tx, 0.002), TAIL);
  }
  // a light bar right across the tail of the modern mid-engined cars
  if (s.lamps === 'slit') add(geos, 'lamp', onFace(o, 'rear', s.tailY, box(2 * tx - 0.4, 0.02, 0.02), 0, 0.002), TAIL);
}

function buildNose(s: CarSpec, o: Outline, geos: Geos): void {
  const gy = s.grille === 'intake' ? s.sill + 0.12 : s.lampY - 0.04;
  const gz = o.face('front', gy).z;
  const inner = s.lampX * taper(s, o, gz);
  const [w, h] =
    s.grille === 'upright' ? [0.46, 0.36]
    : s.grille === 'oval' ? [0.42, 0.18]
    : s.grille === 'wide' ? [Math.max(0.5, 2 * inner - 0.34), 0.17]
    : [2 * s.half * taper(s, o, gz) - 0.5, 0.13];
  const gyAt = s.grille === 'upright' ? gy + 0.02 : gy;
  add(geos, 'trim', onFace(o, 'front', gyAt, box(w, h, 0.03), 0, 0.004), '#0e0f11');
  if (s.chrome || s.grille === 'upright') {
    add(geos, 'metal', onFace(o, 'front', gyAt + h / 2, box(w + 0.04, 0.025, 0.03), 0, 0.012), CHROME);
    add(geos, 'metal', onFace(o, 'front', gyAt - h / 2, box(w + 0.04, 0.025, 0.03), 0, 0.012), CHROME);
    if (s.grille === 'upright') for (let i = -3; i <= 3; i++) add(geos, 'metal', onFace(o, 'front', gyAt, box(0.012, h, 0.02), (i * w) / 8, 0.012), CHROME);
  }
  // bumpers: chrome bars on the old cars; a dark lip and a diffuser on the new
  const by = s.sill + 0.1;
  const fw = 2 * s.half * taper(s, o, o.face('front', by).z) + 0.04;
  const rw = 2 * s.half * taper(s, o, o.face('rear', by).z) + 0.04;
  if (s.chrome) {
    add(geos, 'metal', onFace(o, 'front', by, box(fw, 0.085, 0.1), 0, 0.03), CHROME);
    add(geos, 'metal', onFace(o, 'rear', by, box(rw, 0.085, 0.1), 0, 0.03), CHROME);
  } else {
    add(geos, 'trim', onFace(o, 'rear', s.sill + 0.06, box(rw - 0.1, 0.1, 0.06), 0, 0.0), DARK);
  }
  // the number plate, rear
  add(geos, 'trim', onFace(o, 'rear', s.sill + 0.24, box(0.52, 0.12, 0.012), 0, 0.006), '#e7e3d6');
}

function buildExtras(s: CarSpec, o: Outline, geos: Geos, roof: { roofY: number; roofZ: [number, number] } | null): void {
  // mirrors, at the base of the windscreen
  const mz = s.cabin ? s.cabin.at(-1)![0] - 0.18 : s.open ? s.open.screenZ - 0.05 : 0;
  const my = o.yAt(mz) + B + 0.1;
  for (const side of [1, -1]) {
    const x = side * (sideAt(s, o, my, mz) + 0.08);
    add(geos, s.chrome ? 'metal' : 'paint', box(0.14, 0.08, 0.06, x, my, mz), s.chrome ? CHROME : '#ffffff');
    add(geos, 'trim', box(0.1, 0.02, 0.03, x - side * 0.08, my - 0.02, mz + 0.01), DARK);
  }
  if (s.stripes) {
    const lane = (off: number) => [(z: number) => off - 0.07, (z: number) => off + 0.07] as const;
    for (const off of [-0.13, 0.13]) {
      const [xa, xb] = lane(off);
      add(geos, 'accent', topStrip((z) => o.yAt(z), o.zR + 0.05, o.zF - 0.04, xa, xb), s.stripes);
      if (s.cabin && roof) add(geos, 'accent', topStrip(() => roof.roofY - B, roof.roofZ[0] + 0.03, roof.roofZ[1] - 0.03, xa, xb, 0.006), s.stripes);
    }
  }
  if (s.wing) {
    const { z, y, half } = s.wing;
    add(geos, 'trim', box(2 * half, 0.035, 0.32, 0, y, z), '#1e1f22');
    for (const side of [1, -1]) {
      add(geos, 'trim', box(0.035, 0.2, 0.34, side * half, y - 0.02, z), '#1e1f22');
      const baseY = o.yAt(z) + B;
      add(geos, 'trim', box(0.04, y - baseY, 0.08, side * (half - 0.25), (y + baseY) / 2, z), '#1e1f22');
    }
  }
  if (s.roofLamps && roof) {
    const z = roof.roofZ[1] - 0.12;
    add(geos, 'trim', box(1.1, 0.05, 0.08, 0, roof.roofY + 0.04, z), DARK);
    for (let i = 0; i < 4; i++) {
      const g = lens(0.075, 0.07).translate(-0.45 + i * 0.3, roof.roofY + 0.12, z + 0.03);
      add(geos, 'lamp', g, HEAD);
      add(geos, 'trim', new THREE.CylinderGeometry(0.085, 0.085, 0.08, 14).rotateX(Math.PI / 2).translate(-0.45 + i * 0.3, roof.roofY + 0.12, z - 0.02), DARK);
    }
  }
  if (s.roofRails && roof && s.cabinHalf) {
    const x = s.cabinHalf * (1 - (s.cabinTumble ?? 0.1)) * 0.86;
    const len = roof.roofZ[1] - roof.roofZ[0] - 0.2;
    for (const side of [1, -1]) add(geos, 'metal', box(0.04, 0.045, len, side * x, roof.roofY + 0.05, (roof.roofZ[0] + roof.roofZ[1]) / 2), '#8b9096');
  }
  if (s.fins) {
    // tail fins rising along the rear wings
    const z0 = o.zR + 0.02;
    const z1 = o.zR + 1.5;
    const fin = new THREE.Shape();
    const y0 = o.yAt(z1);
    fin.moveTo(z0, y0 - 0.1);
    fin.lineTo(z0, y0 + 0.16);
    fin.lineTo(z1, y0);
    fin.lineTo(z1, y0 - 0.1);
    fin.closePath();
    for (const side of [1, -1]) {
      const g = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
      g.rotateY(-Math.PI / 2);
      g.translate(side * (s.half * taper(s, o, (z0 + z1) / 2) - 0.02) + 0.04, B, 0);
      add(geos, 'paint', g, '#ffffff');
      add(geos, 'lamp', box(0.06, 0.1, 0.03, side * (s.half * taper(s, o, z0) - 0.02), y0 + 0.04 + B, z0 - 0.02), TAIL);
    }
  }
  if (s.intakes) {
    const z = s.rear + s.wheelR + 0.45;
    for (const side of [1, -1]) add(geos, 'trim', box(0.02, 0.2, 0.55, side * (sideAt(s, o, 0.5, z) + 0.002), 0.52, z), '#0b0b0c');
  }
  if (s.deck) {
    const [z0, z1] = s.deck;
    const inset = (z: number) => s.half * taper(s, o, z) * (1 - s.tumble) - 0.1;
    add(geos, 'trim', topStrip((z) => o.yAt(z), z0, z1, (z) => -inset(z), (z) => inset(z), 0.004), '#7a4a26');
    // the teak's seams
    for (let i = -3; i <= 3; i++) add(geos, 'trim', topStrip((z) => o.yAt(z), z0 + 0.04, z1 - 0.04, () => i * 0.12 - 0.006, () => i * 0.12 + 0.006, 0.007), '#3a2412');
  }
  // door handles and a shut line hint: chrome dashes on the older cars
  if (s.chrome) {
    const hz = (s.front + s.rear) / 2 + 0.25;
    const hy = Math.min(o.yAt(hz), s.shoulder + 0.1) - 0.08;
    for (const side of [1, -1]) add(geos, 'metal', box(0.02, 0.025, 0.14, side * (sideAt(s, o, hy, hz) + 0.004), hy, hz), CHROME);
  }
}

/** One wheel at the origin, its outer face towards +x. */
function buildWheel(s: CarSpec, geos: Geos): void {
  const R = s.wheelR;
  const w = s.wheelW;
  const ri = R * 0.66;
  const prof = [
    [ri, -w / 2], [R - 0.035, -w / 2], [R - 0.008, -w / 2 + 0.02], [R, -w / 2 + 0.05],
    [R, w / 2 - 0.05], [R - 0.008, w / 2 - 0.02], [R - 0.035, w / 2], [ri, w / 2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  add(geos, 'trim', new THREE.LatheGeometry(prof, 18).rotateZ(-Math.PI / 2), TYRE);
  const face = w / 2 - 0.02;
  const disc = (r: number, d: number, at: number) => new THREE.CylinderGeometry(r, r, d, 20).rotateZ(Math.PI / 2).translate(at, 0, 0);
  const rim = s.gold ? '#e0b84a' : (s.rimColor ?? CHROME);
  if (s.whitewall) add(geos, 'trim', new THREE.RingGeometry(ri + 0.015, ri + 0.085, 24).rotateY(Math.PI / 2).translate(w / 2 + 0.002, 0, 0), '#f1eee6');
  add(geos, 'metal', new THREE.TorusGeometry(ri, 0.022, 6, 24).rotateY(Math.PI / 2).translate(face, 0, 0), rim);
  const spokes = (n: number, width: number, color: string, part: Part, twist = 0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
      const g = box(0.03, ri * 0.95, width, 0, 0, 0);
      g.rotateY(twist);
      g.translate(0, ri * 0.48, 0);
      g.applyQuaternion(q);
      g.translate(face - 0.01, 0, 0);
      add(geos, part, g, color);
    }
  };
  switch (s.rim) {
    case 'dish':
      add(geos, 'metal', disc(ri - 0.01, 0.04, face - 0.02), rim);
      add(geos, 'metal', new THREE.ConeGeometry(0.11, 0.07, 16).rotateZ(-Math.PI / 2).translate(face + 0.03, 0, 0), rim);
      break;
    case 'wire':
      add(geos, 'trim', disc(ri - 0.01, 0.02, face - 0.06), '#2a2b2d');
      spokes(16, 0.012, rim, 'metal', 0.3);
      add(geos, 'metal', disc(0.07, 0.08, face + 0.01), rim);
      add(geos, 'metal', box(0.03, 0.2, 0.03, face + 0.05, 0, 0), rim);
      add(geos, 'metal', box(0.03, 0.03, 0.2, face + 0.05, 0, 0), rim);
      break;
    case 'five':
      add(geos, 'trim', disc(ri - 0.01, 0.02, face - 0.07), '#161719');
      spokes(5, 0.07, rim, 'metal');
      add(geos, 'metal', disc(0.08, 0.05, face), rim);
      break;
    case 'mesh':
      add(geos, 'trim', disc(ri - 0.01, 0.02, face - 0.05), '#2c2d30');
      spokes(10, 0.025, rim, 'metal', 0.5);
      spokes(10, 0.025, rim, 'metal', -0.5);
      add(geos, 'metal', disc(0.09, 0.05, face), rim);
      break;
    case 'turbine':
      add(geos, 'metal', disc(ri - 0.01, 0.03, face - 0.02), rim);
      spokes(9, 0.05, '#0d0e10', 'trim', 0.9);
      add(geos, 'metal', disc(0.07, 0.05, face + 0.01), '#9aa0a8');
      break;
  }
  // the brake disc behind
  add(geos, 'metal', disc(ri * 0.8, 0.02, -0.02), '#55585d');
}

/** A car, in pieces: the body's geometries per part, one wheel's, and where the four wheels go. */
export interface CarKit {
  body: Map<Part, THREE.BufferGeometry>;
  wheel: Map<Part, THREE.BufferGeometry>;
  wheels: THREE.Vector3[];
  length: number;
  width: number;
  height: number;
  gold: boolean;
}

const kits = new Map<string, CarKit>();

function mergeAll(geos: Geos): Map<Part, THREE.BufferGeometry> {
  const out = new Map<Part, THREE.BufferGeometry>();
  for (const [part, list] of geos) {
    const m = mergeGeometries(list, false);
    if (m) out.set(part, m);
    for (const g of list) g.dispose();
  }
  return out;
}

/** The car's pieces (built once per car, then shared). */
export function carKit(id: string): CarKit {
  const cached = kits.get(id);
  if (cached) return cached;
  const s = CAR_SPECS[id];
  if (!s) throw new Error(`no car ${id}`);
  const o = new Outline(s.body);
  const body: Geos = new Map();
  buildBody(s, o, body);
  const roof = buildCabin(s, o, body);
  buildOpen(s, o, body);
  buildLamps(s, o, body);
  buildNose(s, o, body);
  buildExtras(s, o, body, roof);
  const wheel: Geos = new Map();
  buildWheel(s, wheel);
  const wx = s.half * Math.min(taper(s, o, s.front), taper(s, o, s.rear)) + B - s.wheelW / 2 + 0.03;
  const kit: CarKit = {
    body: mergeAll(body),
    wheel: mergeAll(wheel),
    wheels: [new THREE.Vector3(wx, s.wheelR, s.front), new THREE.Vector3(-wx, s.wheelR, s.front), new THREE.Vector3(wx, s.wheelR, s.rear), new THREE.Vector3(-wx, s.wheelR, s.rear)],
    length: o.zF - o.zR + 2 * B,
    width: 2 * (s.half + B),
    height: Math.max(o.top, ...(s.cabin ?? []).map((p) => p[1])) + B,
    gold: !!s.gold,
  };
  kits.set(id, kit);
  return kit;
}

/** A body part's material: gold leaf takes the paint on the gold car. */
function matOf(part: Part, gold: boolean): CarMat {
  if (part === 'paint' || part === 'accent') return gold ? 'gold' : 'paint';
  return part;
}

/** A copy of a paint geometry with its (white) vertex colour set to `paint`. */
function tinted(g: THREE.BufferGeometry, paint: string): THREE.BufferGeometry {
  const t = g.clone();
  const c = t.getAttribute('color');
  tmpColor.set(paint);
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * tmpColor.r, c.getY(i) * tmpColor.g, c.getZ(i) * tmpColor.b);
  return t;
}

/** The body's pieces per material, painted (the paint's own colour by default). */
export function bodyGeometries(id: string, paint?: string): Map<CarMat, THREE.BufferGeometry[]> {
  const kit = carKit(id);
  const colour = paint ?? CAR_SPECS[id]!.paint;
  const out = new Map<CarMat, THREE.BufferGeometry[]>();
  const put = (m: CarMat, g: THREE.BufferGeometry) => out.set(m, [...(out.get(m) ?? []), g]);
  for (const [part, g] of kit.body) put(matOf(part, kit.gold), part === 'paint' ? tinted(g, kit.gold ? '#ffffff' : colour) : g.clone());
  return out;
}

/** A single wheel's pieces per material (its outer face towards +x). */
export function wheelGeometries(id: string): Map<CarMat, THREE.BufferGeometry[]> {
  const kit = carKit(id);
  const out = new Map<CarMat, THREE.BufferGeometry[]>();
  for (const [part, g] of kit.wheel) out.set(matOf(part, kit.gold), [...(out.get(matOf(part, kit.gold)) ?? []), g.clone()]);
  return out;
}

const tmpM = new THREE.Matrix4();
const flipY = new THREE.Matrix4().makeRotationY(Math.PI);

/** Where each wheel sits and faces: the left ones turned round so their faces look out. */
export function wheelMatrix(kit: CarKit, i: number, spin = 0): THREE.Matrix4 {
  const p = kit.wheels[i]!;
  const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
  if (p.x < 0) m.multiply(flipY);
  if (spin) m.multiply(tmpM.makeRotationX(p.x < 0 ? -spin : spin));
  return m;
}

/** One placed car in a merged set: which car, its paint, and where it stands. */
export interface Placed {
  id: string;
  paint?: string;
  matrix: THREE.Matrix4;
}

/**
 * Pieces merged into one geometry per car material: cars (a car park, a showroom) and anything
 * else built in the cars' materials (lamp posts, the valet's podium, the garage's fittings), so
 * however many there are, it's one draw call per material.
 */
export class MatBatch {
  private readonly lists = new Map<CarMat, THREE.BufferGeometry[]>();

  /** A piece in a material, its colour in the vertices (white for glass). */
  add(mat: CarMat, geo: THREE.BufferGeometry, color = '#ffffff', matrix?: THREE.Matrix4): this {
    const g = prep(geo, color);
    if (matrix) g.applyMatrix4(matrix);
    this.put(mat, g);
    return this;
  }

  car(c: Placed): this {
    const kit = carKit(c.id);
    for (const [m, gs] of bodyGeometries(c.id, c.paint)) for (const g of gs) this.put(m, g.applyMatrix4(c.matrix));
    const wheel = wheelGeometries(c.id);
    for (let i = 0; i < 4; i++) {
      const wm = new THREE.Matrix4().multiplyMatrices(c.matrix, wheelMatrix(kit, i));
      for (const [m, gs] of wheel) for (const g of gs) this.put(m, g.clone().applyMatrix4(wm));
    }
    for (const gs of wheel.values()) for (const g of gs) g.dispose();
    return this;
  }

  build(): Map<CarMat, THREE.BufferGeometry> {
    const out = new Map<CarMat, THREE.BufferGeometry>();
    for (const [m, list] of this.lists) {
      const g = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      if (g) {
        g.computeBoundingSphere();
        out.set(m, g);
      }
    }
    this.lists.clear();
    return out;
  }

  private put(m: CarMat, g: THREE.BufferGeometry): void {
    const l = this.lists.get(m) ?? [];
    l.push(g);
    this.lists.set(m, l);
  }
}

/** Many cars merged: one geometry per material. */
export function mergeCars(cars: readonly Placed[]): Map<CarMat, THREE.BufferGeometry> {
  const b = new MatBatch();
  for (const c of cars) b.car(c);
  return b.build();
}
