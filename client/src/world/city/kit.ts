// What the ground floor and the roof are built with: a zone's static pieces merged per material
// (batch.ts), its glowing strips and discs as one mesh (lighting.ts GlowMerge), its props from
// the floor's GLB set (props.ts, instanced), warm pools of light on the ground as one additive
// mesh, collision, and the seats it offers to sit-anywhere (life/sitting.ts). All in world
// metres; y is up from the zone's floor.

import * as THREE from 'three';
import { Batch } from '../batch.ts';
import { GlowMerge } from '../lighting.ts';
import type { Mats } from '../materials.ts';
import type { Collider } from '../collision.ts';
import type { PropPlace } from '../decor.ts';
import type { Chandelier } from '../room.ts';
import type { Seatable } from '../life-points.ts';
import { canvasTexture } from '../carpet.ts';
import { rng } from './sky.ts';
import { wrapped } from '../home/surfaces.ts';

export class Kit {
  readonly batch = new Batch();
  readonly glow = new GlowMerge();
  readonly props: PropPlace[] = [];
  readonly chandeliers: Chandelier[] = [];
  readonly seats: Seatable[] = [];
  private readonly poolGeos: THREE.BufferGeometry[] = [];

  constructor(
    readonly zone: string,
    readonly mats: Mats,
    readonly col: Collider,
  ) {
    this.batch.room = zone;
    this.glow.room = zone;
  }

  mat(name: string): THREE.Material {
    return this.mats.get(name);
  }

  /** An axis-aligned box by its corners; `uv` projects the texture at that many metres a repeat. */
  box(mat: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, uv?: number): void {
    this.batch.box(this.mat(mat), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, uv);
  }

  /** A box turned about y (its own x and z extents), by its middle. */
  turned(mat: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry: number, uv?: number): void {
    this.batch.box(this.mat(mat), cx, cy, cz, sx, sy, sz, uv, ry);
  }

  /** An upright cylinder standing on y0. */
  cylinder(mat: string, x: number, z: number, r: number, y0: number, y1: number, seg = 20, rTop = r): void {
    this.batch.add(new THREE.CylinderGeometry(rTop, r, y1 - y0, seg), this.mat(mat), { x, y: (y0 + y1) / 2, z });
  }

  /** A rounded lump (a tree's crown): an icosahedron of radius r, squashed by `sy`. */
  blob(mat: string, x: number, y: number, z: number, r: number, sy = 1): void {
    const geo = new THREE.IcosahedronGeometry(r, 1);
    geo.scale(1, sy, 1);
    this.batch.add(geo, this.mat(mat), { x, y, z });
  }

  /** A flat piece lying on the ground at height y (a marking, a rug): a thin box. */
  flat(mat: string, x0: number, x1: number, z0: number, z1: number, y: number, uv?: number): void {
    this.box(mat, x0, x1, y - 0.004, y, z0, z1, uv);
  }

  /** A solid the walker and the camera bump into, axis-aligned by its corners. */
  solid(x0: number, x1: number, z0: number, z1: number, top = 2.4, opts: { walk?: boolean; cam?: boolean; bottom?: number } = {}): void {
    this.col.box((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0, top, opts);
  }

  post(x: number, z: number, r: number, top = 2.5): void {
    this.col.post(x, z, r, top);
  }

  /**
   * v7: a curved slab lying on the ground: the part of a ring between radii r0 and r1 round
   * (cx, cz), from angle a0 to a1 (a point is at cx + cos a * r, cz + sin a * r), from y0 up to y1,
   * its top and both curved sides (a sidewalk, a curb round a corner). World-projected UVs.
   */
  sector(mat: string, cx: number, cz: number, r0: number, r1: number, a0: number, a1: number, y0: number, y1: number, uv = 2.4): void {
    const seg = Math.max(6, Math.ceil((Math.abs(a1 - a0) * r1) / 1.2));
    const pos: number[] = [];
    const nor: number[] = [];
    const at = (r: number, a: number, y: number) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    const quad = (p: number[][], n: number[][]) => {
      // two triangles, wound so the face points along n (checked against the first normal)
      const [a, b, c, d] = p;
      const ux = b![0]! - a![0]!, uy = b![1]! - a![1]!, uz = b![2]! - a![2]!;
      const vx = c![0]! - a![0]!, vy = c![1]! - a![1]!, vz = c![2]! - a![2]!;
      const face = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const flip = face[0]! * n[0]![0]! + face[1]! * n[0]![1]! + face[2]! * n[0]![2]! < 0;
      const tri = flip ? [a, c, b, b, c, d] : [a, b, c, b, d, c];
      const ntri = flip ? [n[0], n[2], n[1], n[1], n[2], n[3]] : [n[0], n[1], n[2], n[1], n[3], n[2]];
      for (const v of tri) pos.push(...v!);
      for (const v of ntri) nor.push(...v!);
    };
    for (let i = 0; i < seg; i++) {
      const aa = a0 + ((a1 - a0) * i) / seg;
      const ab = a0 + ((a1 - a0) * (i + 1)) / seg;
      const up = [0, 1, 0];
      quad([at(r0, aa, y1), at(r1, aa, y1), at(r0, ab, y1), at(r1, ab, y1)], [up, up, up, up]);
      const out = (a: number) => [Math.cos(a), 0, Math.sin(a)];
      const inn = (a: number) => [-Math.cos(a), 0, -Math.sin(a)];
      quad([at(r1, aa, y0), at(r1, ab, y0), at(r1, aa, y1), at(r1, ab, y1)], [out(aa), out(ab), out(aa), out(ab)]);
      if (r0 > 0.01) quad([at(r0, aa, y0), at(r0, ab, y0), at(r0, aa, y1), at(r0, ab, y1)], [inn(aa), inn(ab), inn(aa), inn(ab)]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    this.batch.add(g, this.mat(mat), {}, uv);
    g.dispose();
  }

  /** v7: posts round an arc (a wall the walker can't pass that curves round a corner). */
  arcWall(cx: number, cz: number, r: number, a0: number, a1: number, top = 6, step = 0.8): void {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      this.col.post(cx + Math.cos(a) * r, cz + Math.sin(a) * r, step * 0.75, top);
    }
  }

  /** A glowing box (a light strip, a lamp's face), coloured past 1 so it blooms on High. */
  light(color: THREE.Color, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0): void {
    this.glow.box(color, cx, cy, cz, sx, sy, sz, ry);
  }

  /** A warm pool of light on the ground (a downlight's, a street lamp's), radius r. */
  pool(x: number, z: number, r: number, y = 0.012): void {
    const g = new THREE.PlaneGeometry(r * 2, r * 2);
    g.rotateX(-Math.PI / 2);
    g.translate(x, y, z);
    this.poolGeos.push(g);
  }

  prop(kind: PropPlace['kind'], x: number, z: number, size: number, ry = 0, y = 0): void {
    this.props.push({ kind, x, y, z, ry, size, room: this.zone });
  }

  seat(s: Omit<Seatable, 'room'>): void {
    this.seats.push({ ...s, room: this.zone });
  }

  /** The pools as one additive mesh (tinted `color`, `k` strong). */
  pools(color: string, k: number): THREE.Mesh | null {
    if (this.poolGeos.length === 0) return null;
    const merged = new THREE.BufferGeometry();
    const pos: number[] = [];
    const uv: number[] = [];
    for (const g of this.poolGeos) {
      const n = g.toNonIndexed();
      pos.push(...(n.getAttribute('position').array as Float32Array));
      uv.push(...(n.getAttribute('uv').array as Float32Array));
      g.dispose();
      n.dispose();
    }
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const tex = canvasTexture(poolCanvas(128), 1);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.name = 'city-pools';
    const mesh = new THREE.Mesh(merged, m);
    mesh.name = `${this.zone}:pools`;
    mesh.renderOrder = 1;
    return mesh;
  }
}

/** A pool's falloff: bright in the middle, a long soft edge. */
function poolCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    grad.addColorStop(t, `rgba(255,255,255,${Math.pow(Math.cos((t * Math.PI) / 2), 2.2).toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** The zones' own surfaces, drawn once per quality: asphalt, pavers, concrete paint, hedges. */
export function defineCityMats(mats: Mats): void {
  const lazy = (draw: () => HTMLCanvasElement) => {
    let t: THREE.Texture | null = null;
    return () => (t ??= canvasTexture(draw(), 8));
  };
  const asphalt = lazy(() => drawAsphalt(1024, 71));
  const pavers = lazy(() => drawPavers(512, 73));
  const hedge = lazy(() => drawHedge(256, 79));
  const hi = (q: string) => q === 'high';
  mats.define1('asphalt', (q) => (hi(q) ? new THREE.MeshStandardMaterial({ map: asphalt(), color: '#8a8a90', roughness: 0.82 }) : new THREE.MeshLambertMaterial({ map: asphalt(), color: '#8a8a90' })));
  mats.define1('pavers', (q) => (hi(q) ? new THREE.MeshStandardMaterial({ map: pavers(), roughness: 0.7 }) : new THREE.MeshLambertMaterial({ map: pavers() })));
  mats.define1('curb', () => new THREE.MeshLambertMaterial({ color: '#8c8780' }));
  mats.define1('paint-white', () => new THREE.MeshLambertMaterial({ color: '#d8d6cf' }));
  mats.define1('paint-yellow', () => new THREE.MeshLambertMaterial({ color: '#d9a52a' }));
  mats.define1('hedge', () => new THREE.MeshLambertMaterial({ map: hedge(), color: '#6a8a5a' }));
  mats.define1('bark', () => new THREE.MeshLambertMaterial({ color: '#3a2e26' }));
  mats.define1('car-glass', (q) => (hi(q) ? new THREE.MeshStandardMaterial({ color: '#0e1218', roughness: 0.1, metalness: 0.5 }) : new THREE.MeshLambertMaterial({ color: '#10141a' })));
  mats.define1('sidewalk', () => new THREE.MeshLambertMaterial({ map: sidewalk() }));
  mats.define1('cushion', () => new THREE.MeshLambertMaterial({ color: '#e6ddcc' }));
  mats.define1('cushion-dark', () => new THREE.MeshLambertMaterial({ color: '#3a3f4a' }));
  mats.define1('stone-warm', (q) => (hi(q) ? new THREE.MeshStandardMaterial({ map: mats.textures.marbleTiles ?? null, color: '#d8c6a8', roughness: 0.45 }) : new THREE.MeshLambertMaterial({ map: mats.textures.marbleTiles ?? null, color: '#d8c6a8' })));
  const limestone = lazy(() => drawLimestone(512, 83));
  const granite = lazy(() => drawGranite(256, 89));
  const deck = lazy(() => drawDeck(512, 97));
  const sidewalk = lazy(() => drawSlabs(256, 101));
  mats.define1('limestone', () => new THREE.MeshLambertMaterial({ map: limestone() }));
  mats.define1('granite', (q) => (hi(q) ? new THREE.MeshStandardMaterial({ map: granite(), roughness: 0.5 }) : new THREE.MeshLambertMaterial({ map: granite() })));
  mats.define1('deck', () => new THREE.MeshLambertMaterial({ map: deck() }));
  // the loungers' and rails' teak: the deck's boards, oiled a shade darker
  mats.define1('teak', () => new THREE.MeshLambertMaterial({ map: deck(), color: '#c89a78' }));
  mats.define1('lift-floor', () => new THREE.MeshLambertMaterial({ map: granite(), color: '#8a8480' }));
  const door = lazy(() => drawLiftDoor(256, 512, 107));
  mats.define1('lift-door', (q) => (hi(q) ? new THREE.MeshStandardMaterial({ map: door(), metalness: 0.8, roughness: 0.34 }) : new THREE.MeshLambertMaterial({ map: door(), emissive: '#141312' })));
}

/** Honey limestone in big ashlar blocks (1.2 m by 0.6 m a block at 2.4 m a repeat), faint veins. */
function drawLimestone(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  const bw = size / 2;
  const bh = size / 4;
  for (let r = 0; r < 4; r++) {
    for (let k = -1; k < 3; k++) {
      const x = k * bw + (r % 2) * (bw / 2);
      const v = 0.975 + rnd() * 0.045;
      g.fillStyle = `rgb(${Math.round(214 * v)},${Math.round(194 * v)},${Math.round(164 * v)})`;
      g.fillRect(x, r * bh, bw, bh);
      // fossil flecks and a vein or two
      for (let i = 0; i < 160; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(120,96,70,0.08)' : 'rgba(255,245,225,0.1)';
        g.fillRect(x + rnd() * bw, r * bh + rnd() * bh, 1 + rnd() * 3, 1);
      }
      g.strokeStyle = 'rgba(150,120,90,0.12)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + rnd() * bw, r * bh);
      g.bezierCurveTo(x + rnd() * bw, r * bh + bh * 0.4, x + rnd() * bw, r * bh + bh * 0.6, x + rnd() * bw, r * bh + bh);
      g.stroke();
      g.fillStyle = 'rgba(90,70,50,0.22)';
      g.fillRect(x, r * bh, bw, 1);
      g.fillRect(x, r * bh, 1, bh);
    }
  }
  return c;
}

/** Teak decking: long narrow boards (16 to a repeat) with dark gaps and a screw at each end. */
function drawDeck(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  const rows = 16;
  const bh = size / rows;
  g.fillStyle = '#1a120c';
  g.fillRect(0, 0, size, size);
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * size * 0.6;
    while (x < size) {
      const len = size * (0.45 + rnd() * 0.55);
      const k = 0.85 + rnd() * 0.25;
      g.fillStyle = `rgb(${Math.round(176 * k)},${Math.round(118 * k)},${Math.round(74 * k)})`;
      g.fillRect(x + 1, r * bh + 1.5, len - 2, bh - 3);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(90,52,26,${0.12 + rnd() * 0.14})`;
        g.fillRect(x + rnd() * len * 0.3, r * bh + 2 + rnd() * (bh - 4), len * (0.3 + rnd() * 0.6), 1);
      }
      g.fillStyle = 'rgba(40,30,24,0.8)';
      for (const sx of [x + 5, x + len - 7]) {
        g.fillRect(sx, r * bh + bh * 0.3, 2, 2);
        g.fillRect(sx, r * bh + bh * 0.62, 2, 2);
      }
      x += len;
    }
  }
  return c;
}

/** Sidewalk slabs, 1.2 m square at 2.4 m a repeat, each a slightly different grey, with joints. */
function drawSlabs(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  const n = 2;
  const s = size / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = 0.92 + rnd() * 0.1;
      g.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(146 * v)},${Math.round(140 * v)})`;
      g.fillRect(i * s, j * s, s, s);
      for (let k = 0; k < 900; k++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
        g.fillRect(i * s + rnd() * s, j * s + rnd() * s, 1, 1);
      }
      g.fillStyle = 'rgba(40,38,36,0.55)';
      g.fillRect(i * s, j * s, s, 2);
      g.fillRect(i * s, j * s, 2, s);
    }
  }
  return c;
}

/**
 * One elevator door leaf (each car's pair shows two): brushed stainless in fine vertical grain, a
 * bronze-etched deco panel (stepped chevrons under a fan) inside an inset line, a darker kick
 * plate, and a shadowed edge down both sides, so where the two leaves meet reads as the seam.
 */
function drawLiftDoor(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  g.fillStyle = '#b4b0a8';
  g.fillRect(0, 0, w, h);
  // the brushing: fine vertical streaks, lighter and darker
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(40,36,30,0.09)';
    g.fillRect(x, y, 1, 20 + rnd() * 120);
  }
  // a soft sheen down the leaf
  const sheen = g.createLinearGradient(0, 0, w, 0);
  sheen.addColorStop(0, 'rgba(0,0,0,0.10)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.08)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);
  // the inset line
  const m = 18;
  g.strokeStyle = 'rgba(40,34,26,0.55)';
  g.lineWidth = 2;
  g.strokeRect(m, m, w - 2 * m, h - 2 * m - 60);
  g.strokeStyle = 'rgba(255,250,240,0.35)';
  g.lineWidth = 1;
  g.strokeRect(m + 2, m + 2, w - 2 * m, h - 2 * m - 60);
  // the etched deco panel: a fan over stepped chevrons, in bronze
  const cx = w / 2;
  const top = h * 0.3;
  g.strokeStyle = 'rgba(122,86,40,0.75)';
  g.lineWidth = 2;
  for (let r = 18; r <= 54; r += 12) {
    g.beginPath();
    g.arc(cx, top, r, Math.PI, Math.PI * 2);
    g.stroke();
  }
  for (let k = -3; k <= 3; k++) {
    g.beginPath();
    g.moveTo(cx, top);
    g.lineTo(cx + Math.sin((k / 3.5) * (Math.PI / 2)) * 56, top - Math.cos((k / 3.5) * (Math.PI / 2)) * 56);
    g.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const y = top + 22 + i * 22;
    g.beginPath();
    g.moveTo(cx - 50 + i * 4, y);
    g.lineTo(cx, y + 14);
    g.lineTo(cx + 50 - i * 4, y);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(cx, top + 150);
  g.lineTo(cx, h * 0.78);
  g.stroke();
  // the kick plate
  g.fillStyle = 'rgba(60,50,38,0.45)';
  g.fillRect(0, h - 44, w, 44);
  g.fillStyle = 'rgba(255,245,225,0.25)';
  g.fillRect(0, h - 44, w, 1);
  // the edges: where the leaves meet, and where each slides into its pier
  const edge = g.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(0,0,0,0.55)');
  edge.addColorStop(0.03, 'rgba(0,0,0,0)');
  edge.addColorStop(0.97, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
  return c;
}

function drawGranite(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  g.fillStyle = '#3c3a3a';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.25; i++) {
    const v = rnd();
    g.fillStyle = v < 0.6 ? '#2a2828' : v < 0.9 ? '#5a5654' : '#8a8480';
    g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1 + Math.floor(rnd() * 2), 1);
  }
  return c;
}

/**
 * Asphalt, 6 m a repeat: the binder's broad unevenness (soft blotches lighter and darker), the
 * aggregate's specks, a patch or two cut in with a darker fresh surface, tar-sealed cracks
 * wandering across it, and the odd oil stain.
 */
function drawAsphalt(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  g.fillStyle = '#34353a';
  g.fillRect(0, 0, size, size);
  // broad unevenness, drawn wrapped so the repeat has no seam
  const blot = (x: number, y: number, r: number, color: string) =>
    wrapped(
      size,
      (dx, dy) => {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      },
      { x, y, r },
    );
  for (let i = 0; i < 26; i++) blot(rnd() * size, rnd() * size, size * (0.08 + rnd() * 0.2), rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)');
  // aggregate: specks, lighter and darker (written into the pixels: a fillRect each is slow)
  const img = g.getImageData(0, 0, size, size);
  const px = img.data;
  const n = size * size * 0.14;
  for (let i = 0; i < n; i++) {
    const v = 38 + Math.floor(rnd() * 46);
    const s = rnd() < 0.1 ? 2 : 1;
    const x0 = Math.floor(rnd() * size);
    const y0 = Math.floor(rnd() * size);
    for (let y = y0; y < Math.min(size, y0 + s); y++) {
      for (let x = x0; x < Math.min(size, x0 + s); x++) {
        const o = (y * size + x) * 4;
        px[o] = v;
        px[o + 1] = v;
        px[o + 2] = v + 3;
      }
    }
  }
  g.putImageData(img, 0, 0);
  // a patch cut in, darker and smoother, its edge a thin seam
  for (let i = 0; i < 2; i++) {
    const w = size * (0.15 + rnd() * 0.2);
    const h = size * (0.1 + rnd() * 0.15);
    const x = rnd() * (size - w);
    const y = rnd() * (size - h);
    g.fillStyle = 'rgba(18,18,22,0.35)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(10,10,12,0.55)';
    g.lineWidth = Math.max(1, size / 512);
    g.strokeRect(x, y, w, h);
  }
  // tar-sealed cracks: dark wandering lines
  g.strokeStyle = 'rgba(12,12,14,0.75)';
  for (let i = 0; i < 5; i++) {
    g.lineWidth = (size / 512) * (1.5 + rnd() * 2.5);
    let x = rnd() * size;
    let y = rnd() * size;
    let a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 8 + Math.floor(rnd() * 14);
    for (let k = 0; k < steps; k++) {
      a += (rnd() - 0.5) * 0.9;
      x = Math.min(size, Math.max(0, x + Math.cos(a) * size * 0.03));
      y = Math.min(size, Math.max(0, y + Math.sin(a) * size * 0.03));
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // oil stains
  for (let i = 0; i < 4; i++) blot(rnd() * size, rnd() * size, size * (0.02 + rnd() * 0.04), 'rgba(8,8,10,0.35)');
  return c;
}

function drawPavers(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  g.fillStyle = '#3e3630';
  g.fillRect(0, 0, size, size);
  // running bond, 8 x 16 bricks a repeat
  const bh = size / 16;
  const bw = size / 8;
  for (let r = 0; r < 16; r++) {
    for (let k = -1; k < 9; k++) {
      const x = k * bw + (r % 2) * (bw / 2);
      const v = 0.85 + rnd() * 0.3;
      g.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(128 * v)},${Math.round(108 * v)})`;
      g.fillRect(x + 1.5, r * bh + 1.5, bw - 3, bh - 3);
    }
  }
  return c;
}

function drawHedge(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = rng(seed);
  g.fillStyle = '#1e3a1c';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? '#2c5228' : v < 0.85 ? '#3a6a32' : '#5a8a44';
    g.beginPath();
    g.ellipse(rnd() * size, rnd() * size, 2 + rnd() * 3, 1 + rnd() * 2, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Text for signs, painted on one canvas: each line a row; returns the rows' UV rects. */
export interface SignRow {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** The row's painted width over its height. */
  aspect: number;
}

export function signAtlas(lines: { text: string; font: string; color: string; glow?: string }[], w = 1024, rowH = 128): { tex: THREE.CanvasTexture; rows: SignRow[] } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = rowH * lines.length;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const rows = lines.map((l, i): SignRow => {
    g.save();
    g.font = l.font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const width = Math.min(w - 20, g.measureText(l.text).width + 30);
    if (l.glow) {
      g.shadowColor = l.glow;
      g.shadowBlur = rowH * 0.12;
    }
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, i * rowH + rowH / 2 + rowH * 0.04, w - 30);
    g.restore();
    const h = c.height;
    return { v0: 1 - ((i + 1) * rowH) / h, v1: 1 - (i * rowH) / h, aspect: width / rowH, u0: (w - width) / 2 / w, u1: (w + width) / 2 / w };
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, rows };
}

/**
 * Sign planes on one atlas, as one mesh: each a plane of `h` metres tall (its width from its
 * text), facing `ry`, lit (additive over whatever it's on, so the atlas's black is nothing).
 */
export function signMesh(atlas: ReturnType<typeof signAtlas>, list: { row: number; x: number; y: number; z: number; h: number; ry: number }[], k: number): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const s of list) {
    const r = atlas.rows[s.row]!;
    const g = new THREE.PlaneGeometry(s.h * r.aspect, s.h).toNonIndexed();
    const u = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < u.count; i++) u.setXY(i, r.u0 + u.getX(i) * (r.u1 - r.u0), r.v0 + u.getY(i) * (r.v1 - r.v0));
    g.rotateY(s.ry);
    g.translate(s.x, s.y, s.z);
    pos.push(...(g.getAttribute('position').array as Float32Array));
    uv.push(...(u.array as Float32Array));
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.MeshBasicMaterial({ map: atlas.tex, color: new THREE.Color(1, 1, 1).multiplyScalar(k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.name = 'city-signs';
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'signs';
  mesh.renderOrder = 2;
  return mesh;
}
