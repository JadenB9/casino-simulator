// The table's furniture around the layout: the padded leather armrest, swept round the table as a
// real bolster is; the wooden wheel head the wheel is set into; and the dealer's chip rack sunk
// into the dealer's side, rolls of wheel chips lying in its grooves. Geometry is built once per
// call and small; the surfaces come from textures.ts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Quality } from '../../render/engine3d.ts';
import { CHIP_R, CHIP_H } from '../../table/chips.ts';
import { leather, tableWood, chipRolls } from './textures.ts';

// ------------------------------------------------------------------------------------------------
// The armrest

interface PathPoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/**
 * Points along a rounded rectangle (centred, w by d, corner radius rc) with outward normals, from
 * (fromX, −d/2) on the dealer's side, round through the players' side, back to (toX, −d/2). With
 * fromX = toX it closes the loop.
 */
function roundedPath(w: number, d: number, rc: number, fromX: number, toX: number): PathPoint[] {
  const W = w / 2;
  const D = d / 2;
  const out: PathPoint[] = [];
  const straight = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.15));
    for (let i = 0; i < steps; i++) out.push({ x: x0 + ((x1 - x0) * i) / steps, z: z0 + ((z1 - z0) * i) / steps, nx, nz });
  };
  const corner = (cx: number, cz: number, a0: number) => {
    for (let i = 0; i < 14; i++) {
      const a = a0 + (i / 14) * (Math.PI / 2);
      out.push({ x: cx + rc * Math.cos(a), z: cz + rc * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) });
    }
  };
  straight(fromX, -D, W - rc, -D, 0, -1);
  corner(W - rc, -D + rc, -Math.PI / 2);
  straight(W, -D + rc, W, D - rc, 1, 0);
  corner(W - rc, D - rc, 0);
  straight(W - rc, D, -W + rc, D, 0, 1);
  corner(-W + rc, D - rc, Math.PI / 2);
  straight(-W, D - rc, -W, -D + rc, -1, 0);
  corner(-W + rc, -D + rc, Math.PI);
  straight(-W + rc, -D, toX, -D, 0, -1);
  out.push({ x: toX, z: -D, nx: 0, nz: -1 });
  return out;
}

/** The bolster's section, (outward from its inner edge, height), metres: a padded, squarish round. */
function bolsterSection(): [number, number][] {
  const pts: [number, number][] = [[0.002, 0]];
  const cx = 0.046;
  const cy = 0.016;
  const a = 0.046;
  const b = 0.035;
  const e = 2.5;
  for (let k = 0; k <= 20; k++) {
    const t = Math.PI * (1 - k / 20);
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([cx + a * Math.sign(c) * Math.abs(c) ** (2 / e), cy + b * Math.abs(s) ** (2 / e)]);
  }
  pts.push([0.0915, 0.006], [0.089, 0]);
  return pts;
}

/** A section swept along a path: u runs along the path and v round the section, both in metres. */
function sweep(path: PathPoint[], section: [number, number][], closed: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const along: number[] = [0];
  for (let i = 1; i < path.length; i++) along.push(along[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  const round: number[] = [0];
  for (let j = 1; j < section.length; j++) round.push(round[j - 1]! + Math.hypot(section[j]![0] - section[j - 1]![0], section[j]![1] - section[j - 1]![1]));
  const rows = closed ? path.length + 1 : path.length;
  const total = along[path.length - 1]! + (closed ? Math.hypot(path[0]!.x - path.at(-1)!.x, path[0]!.z - path.at(-1)!.z) : 0);
  for (let i = 0; i < rows; i++) {
    const p = path[i % path.length]!;
    const u = i === path.length ? total : along[i]!;
    for (let j = 0; j < section.length; j++) {
      const [d, h] = section[j]!;
      pos.push(p.x + p.nx * d, h, p.z + p.nz * d);
      uv.push(u, round[j]!);
    }
  }
  const n = section.length;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      index.push(a, b + 1, b, a, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A flat cap closing a sweep's end: the section at that point, fanned from its middle. */
function cap(p: PathPoint, section: [number, number][], facing: 1 | -1): THREE.BufferGeometry {
  const pts = section.map(([d, h]) => new THREE.Vector3(p.x + p.nx * d, h, p.z + p.nz * d));
  const mid = pts.reduce((m, q) => m.add(q), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = facing > 0 ? [pts[i]!, pts[i + 1]!] : [pts[i + 1]!, pts[i]!];
    pos.push(mid.x, mid.y, mid.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  // indexed like the sweep it's merged with
  g.setIndex(Array.from({ length: pos.length / 3 }, (_, i) => i));
  g.computeVertexNormals();
  return g;
}

/**
 * The padded armrest round a felt of w by d (its inner edge just outside the felt), open on the
 * dealer's side from gap[0] to gap[1] for the chip rack.
 */
export function paddedRail(w: number, d: number, gap: [number, number], quality: Quality): THREE.Mesh {
  const section = bolsterSection();
  const path = roundedPath(w, d, 0.07, gap[1], gap[0]);
  const geo = mergeGeometries([sweep(path, section, false), cap(path[0]!, section, -1), cap(path.at(-1)!, section, 1)]);
  const maps = leather(quality);
  const normal = maps.normal.clone();
  const rough = maps.roughness.clone();
  // one tile of grain is 5 cm of leather
  for (const t of [normal, rough]) t.repeat.set(20, 20);
  const mat = new THREE.MeshStandardMaterial({
    color: '#15100e',
    roughness: 1,
    roughnessMap: rough,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

// ------------------------------------------------------------------------------------------------
// Wood

/**
 * The table's wood, grain along x, one tile a metre long. `tint` darkens it for the skirt and
 * rack; `across` turns the grain to run along v (legs).
 */
export function woodMaterial(quality: Quality, tint = '#ffffff', across = false): THREE.MeshStandardMaterial {
  const maps = tableWood(quality);
  const map = maps.map.clone();
  const surface = maps.surface.clone();
  for (const t of [map, surface]) {
    t.repeat.set(1, 4);
    if (across) t.rotation = Math.PI / 2;
  }
  return new THREE.MeshStandardMaterial({ color: tint, map, roughness: 1, roughnessMap: surface, bumpMap: surface, bumpScale: 0.4 });
}

/**
 * The wheel head: a wooden deck the wheel is set into, from the table's end to just short of the
 * layout, so the wheel sits in wood rather than on the cloth. Its edge toward the layout carries a
 * brass bead.
 */
export function wheelHead(x0: number, x1: number, d: number, quality: Quality, wood: THREE.Material, brass: THREE.Material): THREE.Group {
  const s = new THREE.Shape();
  const r = 0.07;
  const D = d / 2;
  s.moveTo(x1, -D);
  s.lineTo(x1, D);
  s.lineTo(x0 + r, D);
  s.quadraticCurveTo(x0, D, x0, D - r);
  s.lineTo(x0, -D + r);
  s.quadraticCurveTo(x0, -D, x0 + r, -D);
  s.closePath();
  const deck = new THREE.Mesh(
    new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: quality === 'high' ? 3 : 1, curveSegments: 12 }),
    wood,
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.0022;
  const bead = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, d - 0.01, 12), brass);
  bead.rotation.x = Math.PI / 2;
  bead.position.set(x1 + 0.0015, 0.0045, 0);
  const g = new THREE.Group();
  g.add(deck, bead);
  return g;
}

// ------------------------------------------------------------------------------------------------
// The chip rack

/** Chip colours in the rack, left to right: the wheel chips of every seat, then two cash chips. */
const ROLLS: { body: string; spots: string }[] = [
  { body: '#c7262e', spots: '#f7f2ea' },
  { body: '#2f6fd6', spots: '#f7f2ea' },
  { body: '#e3a21a', spots: '#f7f2ea' },
  { body: '#8e4fd6', spots: '#f7f2ea' },
  { body: '#27b3cf', spots: '#f7f2ea' },
  { body: '#e0709f', spots: '#f7f2ea' },
  { body: '#e06a28', spots: '#f7f2ea' },
  { body: '#efe6d2', spots: '#8a5a33' },
  { body: '#8a5a33', spots: '#f7f2ea' },
  { body: '#1f8a4c', spots: '#f7f2ea' },
];

/**
 * The dealer's rack: a wooden tray, `width` wide and `depth` deep, with a groove per roll of chips
 * lying on their edges. The origin is the middle of its foot on the table top; the rolls run
 * along z.
 */
export function chipRack(width: number, depth: number, quality: Quality, wood: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const n = ROLLS.length;
  const pitch = width / n;
  const R = CHIP_R + 0.0015;
  // the rack stands on the table top in the armrest's gap, its grooves just clear of the table
  const top = R + 0.003;
  const wall = 0.008;
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, top);
  for (let k = n - 1; k >= 0; k--) {
    const cx = -width / 2 + pitch * (k + 0.5);
    s.lineTo(cx + R, top);
    s.absarc(cx, top, R, 0, Math.PI, true);
  }
  s.lineTo(-width / 2, top);
  s.closePath();
  const inner = depth - 2 * wall;
  const tray = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: inner, bevelEnabled: false, curveSegments: quality === 'high' ? 16 : 8 }), wood);
  tray.position.z = -inner / 2;
  g.add(tray);
  const wallH = top + 0.007;
  for (const z of [-(depth - wall) / 2, (depth - wall) / 2]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(width + 0.008, wallH, wall), wood);
    end.position.set(0, wallH / 2, z);
    g.add(end);
  }
  for (const x of [-(width / 2 + 0.002), width / 2 + 0.002]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.004, wallH, depth), wood);
    side.position.set(x, wallH / 2, 0);
    g.add(side);
  }

  // the rolls, one geometry over one texture of every roll's chip edges
  const chips = Math.floor((inner - 0.004) / CHIP_H);
  const atlas = chipRolls(ROLLS, chips, quality);
  const rolls: THREE.BufferGeometry[] = [];
  ROLLS.forEach((_, k) => {
    const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, chips * CHIP_H, quality === 'high' ? 28 : 16);
    const uv = geo.attributes.uv!;
    const nrm = geo.attributes.normal!;
    for (let i = 0; i < uv.count; i++) {
      // the ends show the body colour (a strip of each band is left plain for them)
      if (Math.abs(nrm.getY(i)) > 0.9) uv.setXY(i, 0.01, 1 - (k + 0.5) / n);
      else uv.setY(i, 1 - (k + 1 - uv.getY(i)) / n);
    }
    geo.rotateX(Math.PI / 2);
    geo.translate(-width / 2 + pitch * (k + 0.5), top - R + CHIP_R + 0.0004, 0);
    rolls.push(geo);
  });
  g.add(new THREE.Mesh(mergeGeometries(rolls), new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.42 })));
  return g;
}
