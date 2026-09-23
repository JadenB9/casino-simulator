// The craps table: a rounded tub with high walls lined in rubber pyramids (the far wall the dice
// must hit), a padded armrest, a wooden chip rail, a skirt down to a kick base, and the
// boxman's bank of chips on the dealers' side. Built from primitives and canvas textures.

import * as THREE from 'three';
import { CHIPS } from '../../../../shared/src/money.ts';
import { Felt } from '../../table/felt.ts';
import { FELT_W, FELT_D, feltSpec } from './layout.ts';

/** Height of the felt bed; the walls rise to RAIL_Y. Players stand at a craps table. */
export const BED_Y = 0.8;
export const WALL_Y = 0.99;
export const RAIL_Y = 1.03;
const CORNER = 0.16;
/** The chip rail ledge runs from here to the outer edge (offsets from the felt's edge). */
const LEDGE = [0.1, 0.23] as const;
export const OUTER = { w: FELT_W + 2 * LEDGE[1], d: FELT_D + 2 * LEDGE[1] };

/** Points around the felt's rounded rectangle pushed out by `off`, counter-clockwise seen from above. */
function outline(off: number, perCorner: number): THREE.Vector2[] {
  const hw = FELT_W / 2 - CORNER;
  const hd = FELT_D / 2 - CORNER;
  const r = CORNER + off;
  const pts: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [[hw, hd, Math.PI / 2], [hw, -hd, 0], [-hw, -hd, -Math.PI / 2], [-hw, hd, Math.PI]];
  // walk x+,z+ -> x+,z- -> x-,z- -> x-,z+ (x, z as Vector2 x, y), each corner's arc sweeping 90°
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 - (i / perCorner) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
  }
  return pts;
}

/** Rubber pyramids: a normal map (four sloped faces per pyramid) and a dark rubber colour. */
function pyramidTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const size = 256;
  const cells = 8;
  const cell = size / cells;
  const n = document.createElement('canvas');
  n.width = n.height = size;
  const g = n.getContext('2d')!;
  const tilt = 0.75;
  const enc = (x: number, y: number) => {
    const len = Math.hypot(x, y, 1);
    return `rgb(${Math.round(((x / len) * 0.5 + 0.5) * 255)},${Math.round(((y / len) * 0.5 + 0.5) * 255)},${Math.round(((1 / len) * 0.5 + 0.5) * 255)})`;
  };
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x0 = i * cell;
      const y0 = j * cell;
      const cx = x0 + cell / 2;
      const cy = y0 + cell / 2;
      const faces: [[number, number], [number, number], string][] = [
        [[x0, y0], [x0 + cell, y0], enc(0, tilt)],
        [[x0 + cell, y0], [x0 + cell, y0 + cell], enc(tilt, 0)],
        [[x0 + cell, y0 + cell], [x0, y0 + cell], enc(0, -tilt)],
        [[x0, y0 + cell], [x0, y0], enc(-tilt, 0)],
      ];
      for (const [a, b, color] of faces) {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.lineTo(cx, cy);
        g.closePath();
        g.fill();
      }
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const h = c.getContext('2d')!;
  h.fillStyle = '#2b2522';
  h.fillRect(0, 0, size, size);
  // a faint sheen on the pyramid tips
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      h.fillStyle = 'rgba(255,240,220,0.06)';
      h.beginPath();
      h.arc(i * cell + cell / 2, j * cell + cell / 2, cell * 0.12, 0, Math.PI * 2);
      h.fill();
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.CanvasTexture(n);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return { map, normal };
}

/** A vertical band along a closed outline, facing inward, with UVs in metres / tile. */
function wallStrip(pts: THREE.Vector2[], y0: number, y1: number, tile: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let run = 0;
  const n = pts.length;
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n]!;
    const prev = pts[(i - 1 + n) % n]!;
    const next = pts[(i + 1) % n]!;
    if (i > 0) run += p.distanceTo(prev);
    // inward normal: the outline runs clockwise in x/z, so the right-hand perpendicular points in
    const tx = next.x - prev.x;
    const tz = next.y - prev.y;
    const len = Math.hypot(tx, tz) || 1;
    const nx = tz / len;
    const nz = -tx / len;
    for (const y of [y0, y1]) {
      pos.push(p.x, y, p.y);
      nor.push(nx, 0, nz);
      uv.push(run / tile, (y - y0) / tile);
    }
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // front faces look into the tub
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** A flat ring between two outlines, extruded upward by `h`. */
function ring(inner: number, outer: number, h: number, perCorner: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(outline(outer, perCorner));
  shape.holes.push(new THREE.Path(outline(inner, perCorner)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 });
  geo.rotateX(Math.PI / 2); // shape x/y -> world x/z; extrusion points down, so lift by h after
  geo.translate(0, h, 0);
  return geo;
}

/** A stack of chips in the boxman's bank: one cylinder with a striped edge. */
function bankStack(value: number, count: number): THREE.Mesh {
  const spec = CHIPS.find((c) => c.value === value)!;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const rows = count;
  for (let i = 0; i < rows; i++) {
    g.fillStyle = spec.body;
    g.fillRect(0, (i * 128) / rows, 64, 128 / rows);
    g.fillStyle = spec.spots;
    for (let k = 0; k < 4; k++) g.fillRect(k * 16 + ((i * 7) % 12), (i * 128) / rows + 1, 5, 128 / rows - 2);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, ((i + 1) * 128) / rows - 1, 64, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  const h = count * 0.0033;
  const top = new THREE.MeshStandardMaterial({ color: spec.body, roughness: 0.5 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0197, 0.0197, h, 24), [new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), top, top]);
  mesh.position.y = h / 2;
  return mesh;
}

export function tableModel(quality: 'high' | 'low'): THREE.Group {
  const g = new THREE.Group();
  g.name = 'craps-table';
  const per = quality === 'high' ? 10 : 5;
  const wood = new THREE.MeshStandardMaterial({ color: '#4a2a17', roughness: 0.5, metalness: 0.05 });
  const woodLight = new THREE.MeshStandardMaterial({ color: '#6e4424', roughness: 0.42 });
  const leather = new THREE.MeshStandardMaterial({ color: '#241512', roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15100d', roughness: 0.8 });
  const { map, normal } = pyramidTextures();
  const rubber = new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.85 });

  // the bed under the felt
  const bed = new THREE.Mesh(new THREE.BoxGeometry(FELT_W, 0.04, FELT_D), dark);
  bed.position.y = BED_Y - 0.02;
  g.add(bed);

  // inner walls: rubber pyramids, then the wall body up to the armrest
  const wall = new THREE.Mesh(wallStrip(outline(-0.002, per * 2), BED_Y, WALL_Y, 0.12), rubber);
  wall.name = 'craps-pyramids';
  g.add(wall);
  const body = new THREE.Mesh(ring(0, LEDGE[0], WALL_Y - BED_Y + 0.02, per), wood);
  body.position.y = BED_Y - 0.02;
  g.add(body);

  // the padded armrest along the top of the wall
  const railPath = new THREE.CatmullRomCurve3(outline(LEDGE[0] * 0.5, per * 2).map((p) => new THREE.Vector3(p.x, RAIL_Y - 0.012, p.y)), true);
  const armrest = new THREE.Mesh(new THREE.TubeGeometry(railPath, quality === 'high' ? 240 : 120, 0.042, 12, true), leather);
  g.add(armrest);

  // the chip rail ledge outside it, with a groove
  const ledge = new THREE.Mesh(ring(LEDGE[0], LEDGE[1], 0.03, per), woodLight);
  ledge.position.y = RAIL_Y - 0.075;
  g.add(ledge);
  const groove = new THREE.Mesh(ring(LEDGE[0] + 0.035, LEDGE[1] - 0.035, 0.004, per), dark);
  groove.position.y = RAIL_Y - 0.046;
  g.add(groove);

  // skirt and kick base
  const skirt = new THREE.Mesh(ring(LEDGE[1] - 0.03, LEDGE[1], RAIL_Y - 0.075 - 0.1, per), wood);
  skirt.position.y = 0.1;
  g.add(skirt);
  const base = new THREE.Mesh(ring(LEDGE[1] - 0.14, LEDGE[1] - 0.1, 0.1, per), dark);
  g.add(base);
  const fill = new THREE.Mesh(new THREE.BoxGeometry(FELT_W + 0.1, BED_Y - 0.1, FELT_D + 0.1), dark);
  fill.position.y = 0.1 + (BED_Y - 0.1) / 2 - 0.02;
  g.add(fill);

  // the boxman's bank, set into the rail on the dealers' side
  const bank = new THREE.Group();
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.1), dark);
  bank.add(tray);
  const values = [100, 500, 500, 2500, 2500, 10_000, 10_000, 50_000, 100_000];
  values.forEach((v, i) => {
    for (let row = 0; row < 2; row++) {
      const s = bankStack(v, 20);
      s.position.x = -0.28 + i * 0.07;
      s.position.z = -0.022 + row * 0.044;
      s.position.y += 0.006;
      bank.add(s);
    }
  });
  bank.position.set(0, RAIL_Y - 0.039, -(FELT_D / 2 + (LEDGE[0] + LEDGE[1]) / 2));
  g.add(bank);

  // a low-resolution copy of the printed felt, so the table reads as craps from across the floor
  const floorFelt = new Felt({ ...feltSpec(), resolution: quality === 'high' ? 520 : 320 });
  floorFelt.mesh.name = 'craps-floor-felt';
  floorFelt.mesh.position.y = BED_Y + 0.0002;
  g.add(floorFelt.mesh);
  return g;
}
