// Felt layouts: a game describes its printed felt as drawing code plus named regions, and the
// painter turns that into a textured mesh whose clicks come back as region names. The same
// description draws the felt and decides what you clicked, so they can't disagree.
//
// The cloth itself is the painter's: under the print, the dye's slow unevenness and a soft pool of
// light toward the middle (the rail's edge falls away a little darker), and over all of it a fine
// fibre that catches the light (a small normal map tiled across, the same for every felt), so a
// large felt reads as baize under the lamps instead of flat green paint.

import * as THREE from 'three';

export interface Region {
  id: string;
  /** Local felt coordinates in metres, x across, z toward the player (+z). */
  shape: { kind: 'rect'; x: number; z: number; w: number; d: number } | { kind: 'circle'; x: number; z: number; r: number } | { kind: 'poly'; points: [number, number][] };
  /** Where chips for this region sit, if not the shape's centre. */
  anchor?: [number, number];
}

export interface FeltSpec {
  /** Size of the felt in metres. */
  width: number;
  depth: number;
  color: string;
  /** Pixels per metre for the painted texture (capped at 4096 px per side). */
  resolution?: number;
  paint(g: CanvasRenderingContext2D, px: (metres: number) => number): void;
  regions: Region[];
}

export class Felt {
  readonly mesh: THREE.Mesh;
  readonly spec: FeltSpec;

  constructor(spec: FeltSpec) {
    this.spec = spec;
    const ppm = Math.min(spec.resolution ?? 1400, 4096 / Math.max(spec.width, spec.depth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(spec.width * ppm);
    canvas.height = Math.round(spec.depth * ppm);
    const g = canvas.getContext('2d')!;
    g.fillStyle = spec.color;
    g.fillRect(0, 0, canvas.width, canvas.height);
    dye(g, canvas.width, canvas.height);
    g.save();
    g.translate(canvas.width / 2, canvas.height / 2);
    spec.paint(g, (m) => m * ppm);
    g.restore();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    // the fibre, a tile every FIBRE_TILE metres (a copy of the one shared picture, uploaded once),
    // on the felt you sit at: the floor's tables, painted coarser and seen from across the room,
    // would only pay for it
    if (ppm >= FIBRE_FROM) {
      const fibre = fibreTexture().clone();
      fibre.repeat.set(spec.width / FIBRE_TILE, spec.depth / FIBRE_TILE);
      mat.normalMap = fibre;
      mat.normalScale.set(0.45, 0.45);
    }
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.depth), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.name = 'felt';
  }

  /** Which region a local felt point (x, z) is in, if any. Later regions win (props drawn on top). */
  regionAt(x: number, z: number): Region | null {
    for (let i = this.spec.regions.length - 1; i >= 0; i--) {
      const r = this.spec.regions[i]!;
      if (inside(r, x, z)) return r;
    }
    return null;
  }

  anchorOf(id: string): [number, number] | null {
    const r = this.spec.regions.find((x) => x.id === id);
    if (!r) return null;
    if (r.anchor) return r.anchor;
    const s = r.shape;
    if (s.kind === 'poly') {
      const n = s.points.length;
      return [s.points.reduce((a, p) => a + p[0], 0) / n, s.points.reduce((a, p) => a + p[1], 0) / n];
    }
    return [s.x, s.z];
  }
}

function inside(r: Region, x: number, z: number): boolean {
  const s = r.shape;
  if (s.kind === 'rect') return Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2;
  if (s.kind === 'circle') return (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r ** 2;
  let hit = false;
  const p = s.points;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]!;
    const [xj, zj] = p[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * The dye under the print: slow, faint blotches lighter and darker (a felt is never one flat colour)
 * and a soft pool of light toward the middle, the edges toward the rail a little darker. Painted
 * the same way every time, so a felt redrawn for the next sitting looks the same.
 */
function dye(g: CanvasRenderingContext2D, w: number, h: number): void {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const size = Math.max(w, h);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = size * (0.08 + rnd() * 0.16);
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = rnd() < 0.5 ? '255, 255, 255' : '0, 0, 0';
    blot.addColorStop(0, `rgba(${tone}, ${0.025 + rnd() * 0.02})`);
    blot.addColorStop(1, `rgba(${tone}, 0)`);
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const pool = g.createRadialGradient(w / 2, h / 2, size * 0.08, w / 2, h / 2, size * 0.62);
  pool.addColorStop(0, 'rgba(255, 250, 235, 0.06)');
  pool.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  pool.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
  g.fillStyle = pool;
  g.fillRect(0, 0, w, h);
}

/** How much felt one tile of the fibre covers, m (half a millimetre a texel). */
const FIBRE_TILE = 0.12;
/**
 * A felt painted at least this sharp (pixels a metre) is one you sit at, and gets the fibre: the
 * tables you play at paint theirs at 1,260 to 1,500, the floor's at 320 to 1,100.
 */
const FIBRE_FROM = 1150;
let fibre: THREE.Texture | null = null;

/**
 * Baize up close: a tileable field of fine, short fibres lying every which way over a soft nap,
 * as a normal map. Made once; each felt wears a copy with its own repeat (the picture is shared,
 * and uploaded once). Mipmapped, so from across the room it evens out to smooth cloth.
 */
function fibreTexture(): THREE.Texture {
  if (fibre) return fibre;
  const N = 256;
  const height = new Float32Array(N * N);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  // the nap: smooth bumps a few millimetres across, wrapping at the tile's edges
  const lattice = (cells: number, amp: number) => {
    const v = Array.from({ length: cells * cells }, () => rnd());
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const fy = (y / N) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const at = (i: number, j: number) => v[((j % cells) * cells + (i % cells)) % v.length]!;
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        height[y * N + x]! += (top + (bottom - top) * sy) * amp;
      }
    }
  };
  lattice(8, 0.5);
  lattice(32, 0.35);
  // the fibres: short raised strokes at every angle, wrapping round the tile
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const a = rnd() * Math.PI;
    const len = 2 + rnd() * 5;
    const lift = 0.25 + rnd() * 0.35;
    for (let t = 0; t <= len; t += 0.5) {
      const px = Math.floor(x + Math.cos(a) * t + N) % N;
      const py = Math.floor(y + Math.sin(a) * t + N) % N;
      height[py * N + px]! += lift;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const h = (x: number, y: number) => height[((y + N) % N) * N + ((x + N) % N)]!;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 0.5;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 0.5;
      const len = Math.hypot(dx, dy, 1);
      img.data.set([Math.round(((-dx / len) * 0.5 + 0.5) * 255), Math.round(((dy / len) * 0.5 + 0.5) * 255), Math.round(((1 / len) * 0.5 + 0.5) * 255), 255], (y * N + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  fibre = new THREE.CanvasTexture(c);
  fibre.wrapS = fibre.wrapT = THREE.RepeatWrapping;
  fibre.anisotropy = 8;
  fibre.userData.shared = true;
  return fibre;
}
