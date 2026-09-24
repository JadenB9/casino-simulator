// The surfaces of the wheel and its table, painted in code the first time they're asked for and
// shared by every roulette model after that: the veneered apron and cone (eight book-matched
// wedges, as real wheels are laid), the brushed steel ball track, the number ring and the flocked
// pockets; the mahogany of the table (stained nearly black, the bowl's rim too), its felt weave,
// the armrest's leather grain, and the rolls of chips in the dealer's rack.
//
// A wood surface's bump and roughness share one texture (bump in red, roughness in green, which
// is where three.js reads each of them), so a lacquered part costs two textures, not three.

import * as THREE from 'three';
import { WHEEL, colorOf, pocketLabel, type Variant } from '../../../../shared/src/games/roulette/rules.ts';
import type { Quality } from '../../render/engine3d.ts';
import { DIMS, TAU } from './spin.ts';

/** The wheel's colours (sRGB): a deep casino red, not an orange one, and the zeros' green. */
export const WHEEL_COLORS = { red: '#8a0b14', black: '#101011', green: '#08663a' } as const;
const NUMERAL = '#f3ecdc';

/** The veneer texture covers this band of radii (the cone and the apron both sit inside it). */
export const VENEER_R0 = 0.03;
export const VENEER_R1 = 0.376;
/** Wedges of veneer around the wheel. */
export const VENEER_WEDGES = 8;

const made = new Map<string, THREE.Texture>();

function once<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = made.get(key) as T | undefined;
  if (!t) {
    t = make();
    made.set(key, t);
  }
  return t;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, color: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function repeating(t: THREE.Texture): THREE.Texture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Value noise on a lattice that repeats every px by py cells, so a texture built on it can wrap. */
class Noise {
  private readonly v: Float32Array;

  constructor(
    seed: number,
    private readonly px = 256,
    private readonly py = 256,
  ) {
    this.v = new Float32Array(px * py);
    let s = seed >>> 0 || 1;
    for (let i = 0; i < this.v.length; i++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      this.v[i] = s / 4294967296;
    }
  }

  at(x: number, y: number): number {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const tx = x - fx;
    const ty = y - fy;
    const { px, py, v } = this;
    const x0 = ((fx % px) + px) % px;
    const y0 = ((fy % py) + py) % py;
    const x1 = x0 + 1 === px ? 0 : x0 + 1;
    const y1 = y0 + 1 === py ? 0 : y0 + 1;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = v[y0 * px + x0]!;
    const b = v[y0 * px + x1]!;
    const c = v[y1 * px + x0]!;
    const d = v[y1 * px + x1]!;
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Octaves at whole-number multiples of the base frequency, so the sum wraps like the lattice. */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.at(x * f + o * 31.7, y * f + o * 17.3);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A three-stop palette from dark (0) through mid (0.5) to light (1). */
function palette(dark: string, mid: string, light: string): (t: number, out: Uint8ClampedArray, i: number) => void {
  const a = rgb(dark);
  const b = rgb(mid);
  const c = rgb(light);
  return (t, out, i) => {
    const k = Math.min(1, Math.max(0, t));
    const [p, q, u] = k < 0.5 ? [a, b, k * 2] : [b, c, k * 2 - 1];
    out[i] = p[0] + (q[0] - p[0]) * u;
    out[i + 1] = p[1] + (q[1] - p[1]) * u;
    out[i + 2] = p[2] + (q[2] - p[2]) * u;
    out[i + 3] = 255;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------------------------------------
// Wood

/**
 * Figured mahogany at a point, in metres across (a) and along (b) the grain: fine growth lines
 * that wander, the long light and dark ribbons of quarter-sawn wood, a soft flame figure across
 * the grain, fibres and pores. Returns the tone (0 dark to 1 light) and how deep a pore is there.
 */
function mahogany(n: Noise, a: number, b: number): [number, number] {
  const wander = (n.fbm(a * 26, b * 3.5, 2) - 0.5) * 0.022;
  const t = (a + wander) * 380;
  const f = t - Math.floor(t);
  const line = (0.5 + 0.5 * Math.cos(TAU * f)) ** 10 * (0.3 + 0.7 * n.at(t * 0.23 + 3.1, b * 6));
  const ribbon = n.fbm(a * 95 + wander * 30, b * 2.4, 2) - 0.5;
  const flame = Math.sin(TAU * (b * 44 + 3 * n.fbm(a * 14, b * 10, 2))) * Math.max(0, n.at(a * 16 + 7, b * 5) - 0.45) * 2;
  const fibre = n.at(a * 1300, b * 40) - 0.5;
  const p = n.at(a * 2400 + 11, b * 150 + 5);
  const pore = Math.max(0, (p - 0.78) * 4.5);
  const tone = 0.5 + 0.55 * ribbon + 0.1 * flame + 0.08 * fibre - 0.2 * line - 0.3 * pore;
  return [tone, Math.min(1, pore + line * 0.25)];
}

export interface WoodMaps {
  map: THREE.Texture;
  /** Bump (red) and roughness (green). */
  surface: THREE.Texture;
}

/**
 * The veneer of the apron and cone as one wedge in polar form: x runs across the wedge's angle,
 * y down from the outer radius VENEER_R1 to VENEER_R0. Drawn on a lathe whose v is its radius
 * and whose u is repeated VENEER_WEDGES times with mirroring, each wedge is the next one's mirror
 * image (book-matched) and the grain in every wedge runs straight out from the centre. A thin
 * dark joint runs along the wedge's edges, the same width at every radius.
 */
export function veneer(quality: Quality): WoodMaps {
  const key = `veneer:${quality}`;
  const map = made.get(key);
  if (map) return { map, surface: made.get(`${key}:s`)! };
  // 0.6 mm a texel at the apron's edge, finer toward the middle: sharper than the wheel's own
  // close-up camera needs, and a quarter of the painting a 1024 square would take
  const W = quality === 'high' ? 512 : 256;
  const H = quality === 'high' ? 512 : 256;
  const [cc, cg] = canvasOf(W, H);
  const [sc, sg] = canvasOf(W, H);
  const col = cg.createImageData(W, H);
  const surf = sg.createImageData(W, H);
  const n = new Noise(7, 512, 512);
  const paint = palette('#1d0703', '#44170a', '#6e2b13');
  const half = Math.PI / VENEER_WEDGES;
  for (let y = 0; y < H; y++) {
    const r = VENEER_R1 - ((y + 0.5) / H) * (VENEER_R1 - VENEER_R0);
    for (let x = 0; x < W; x++) {
      const th = ((x + 0.5) / W) * 2 * half - half;
      const [tone, pore] = mahogany(n, r * Math.sin(th), r * Math.cos(th));
      const i = (y * W + x) * 4;
      // distance to the joint (the wedge's edge), in metres of arc
      const joint = r * (half - Math.abs(th));
      if (joint < 0.00055) {
        col.data[i] = 22;
        col.data[i + 1] = 8;
        col.data[i + 2] = 4;
        col.data[i + 3] = 255;
        surf.data[i] = 60;
        surf.data[i + 1] = 150;
      } else {
        paint(tone, col.data, i);
        surf.data[i] = 150 - pore * 90;
        surf.data[i + 1] = 110 + pore * 80;
      }
      surf.data[i + 2] = 0;
      surf.data[i + 3] = 255;
    }
  }
  cg.putImageData(col, 0, 0);
  sg.putImageData(surf, 0, 0);
  const setup = (t: THREE.Texture) => {
    t.wrapS = THREE.MirroredRepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(VENEER_WEDGES, 1);
    // joints under the deflectors, which sit half a wedge round from angle 0
    t.offset.set(0.5, 0);
    return t;
  };
  const m = setup(texture(cc, true));
  const s = setup(texture(sc, false));
  made.set(key, m);
  made.set(`${key}:s`, s);
  return { map: m, surface: s };
}

/**
 * Straight-grained mahogany that wraps both ways, grain along x: the table's edge, skirt and legs,
 * and (tinted nearly black) the bowl's lacquered rim, drawn round its circumference. Every
 * frequency is a whole number of cycles per texture, so the tile repeats without a seam.
 */
export function plainWood(quality: Quality): WoodMaps {
  const key = `wood:${quality}`;
  const map = made.get(key);
  if (map) return { map, surface: made.get(`${key}:s`)! };
  const W = quality === 'high' ? 1024 : 512;
  const H = quality === 'high' ? 256 : 128;
  const [cc, cg] = canvasOf(W, H);
  const [sc, sg] = canvasOf(W, H);
  const col = cg.createImageData(W, H);
  const surf = sg.createImageData(W, H);
  const drift = new Noise(33, 6, 4);
  const detail = new Noise(34, 48, 128);
  const pores = new Noise(35, 256, 512);
  const paint = palette('#1d0b05', '#3b180b', '#5e2a13');
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const wander = drift.fbm(u * 6, v * 4, 2) - 0.5;
      const t = (v + wander * 0.08) * 28;
      const f = t - Math.floor(t);
      const line = (0.5 + 0.5 * Math.cos(TAU * f)) ** 8;
      const ribbon = detail.fbm(u * 48, v * 32 + wander * 6, 2) - 0.5;
      const fibre = detail.at(u * 48 + 5, v * 128) - 0.5;
      const pore = Math.max(0, (pores.at(u * 256, v * 512) - 0.8) * 5);
      const tone = 0.5 + 0.85 * (0.8 * ribbon + 0.14 * fibre - 0.35 * line - 0.4 * pore);
      const i = (y * W + x) * 4;
      paint(tone, col.data, i);
      surf.data[i] = 150 - pore * 80 - line * 25;
      surf.data[i + 1] = 80 + pore * 70;
      surf.data[i + 2] = 0;
      surf.data[i + 3] = 255;
    }
  }
  cg.putImageData(col, 0, 0);
  sg.putImageData(surf, 0, 0);
  const m = repeating(texture(cc, true));
  const s = repeating(texture(sc, false));
  made.set(key, m);
  made.set(`${key}:s`, s);
  return { map: m, surface: s };
}

// ------------------------------------------------------------------------------------------------
// Metal

export interface MetalMaps {
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

/** Normal map pixels from a height field (wrapping at the edges); +v is up the canvas. */
function normals(h: Float32Array, W: number, H: number, strength: number, out: Uint8ClampedArray): void {
  for (let y = 0; y < H; y++) {
    const yu = (y + H - 1) % H;
    const yd = (y + 1) % H;
    for (let x = 0; x < W; x++) {
      const xl = (x + W - 1) % W;
      const xr = (x + 1) % W;
      const dx = (h[y * W + xr]! - h[y * W + xl]!) * strength;
      const dy = (h[yu * W + x]! - h[yd * W + x]!) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
}

/**
 * The ball track: steel turned on a lathe and brushed round, so fine grooves run round the wheel
 * (along u) with a few deeper turning marks, and the roughness streaks the same way.
 */
export function brushedSteel(quality: Quality): MetalMaps {
  const key = `steel:${quality}`;
  const normal = made.get(key);
  if (normal) return { normal, roughness: made.get(`${key}:r`)! };
  const W = quality === 'high' ? 512 : 256;
  const H = quality === 'high' ? 512 : 256;
  const h = new Float32Array(W * H);
  const [rc, rg] = canvasOf(W, H);
  const rough = rg.createImageData(W, H);
  const streak = new Noise(41, 8, 256);
  const fine = new Noise(42, 64, 512);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const turned = (0.5 + 0.5 * Math.cos(TAU * v * 14)) ** 18;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const brush = fine.at(u * 64, v * 512) - 0.5;
      h[y * W + x] = 0.35 * brush - 1.2 * turned;
      const s = streak.fbm(u * 8, v * 256, 2) - 0.5;
      const i = (y * W + x) * 4;
      const value = 0.3 + 0.22 * s + 0.12 * turned;
      rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = value * 255;
      rough.data[i + 3] = 255;
    }
  }
  const [nc, ng] = canvasOf(W, H);
  const nimg = ng.createImageData(W, H);
  normals(h, W, H, 1.6, nimg.data);
  ng.putImageData(nimg, 0, 0);
  rg.putImageData(rough, 0, 0);
  const n = repeating(texture(nc, false));
  const r = repeating(texture(rc, false));
  made.set(key, n);
  made.set(`${key}:r`, r);
  return { normal: n, roughness: r };
}

// ------------------------------------------------------------------------------------------------
// The rotor's faces

/**
 * The number ring as a strip: position i of the wheel occupies the i-th segment from the right,
 * because the lathe's u runs counterclockwise while the wheel order runs clockwise. The strip's
 * bottom is the ring's outer edge, so the numbers stand up toward the centre, as on a real head.
 * The strip is taller than the ring is in proportion, for sharper numerals, and the numerals are
 * drawn squeezed to match, so they come out in their true shape.
 */
export function numberRing(v: Variant, quality: Quality): THREE.Texture {
  return once(`ring:${v}:${quality}`, () => {
    const order = WHEEL[v];
    const n = order.length;
    const midR = (DIMS.ringOutR + DIMS.ringInR) / 2;
    const slant = Math.hypot(DIMS.ringOutR - DIMS.ringInR, DIMS.ringOutY - DIMS.ringInY);
    const W = quality === 'high' ? 4096 : 2048;
    const H = quality === 'high' ? 256 : 128;
    const [c, g] = canvasOf(W, H);
    const seg = W / n;
    // pixels per metre around the ring and across it: the numerals are drawn in the round one's scale
    const ppmX = W / (TAU * midR);
    const ppmY = H / slant;
    order.forEach((p, i) => {
      const x = (n - 1 - i) * seg;
      g.fillStyle = WHEEL_COLORS[colorOf(p)];
      g.fillRect(Math.floor(x), 0, Math.ceil(seg) + 1, H);
    });
    // a faint darker line where the enamel panels meet, and a shadow line along each edge
    g.fillStyle = 'rgba(0, 0, 0, 0.45)';
    for (let i = 0; i <= n; i++) g.fillRect(Math.round(i * seg) - 1, 0, 2, H);
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.fillRect(0, 0, W, Math.max(2, H * 0.03));
    g.fillRect(0, H - Math.max(2, H * 0.03), W, Math.max(2, H * 0.03));
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = NUMERAL;
    const cap = 0.0158 * ppmX; // numeral height, 16 mm, in the round scale
    order.forEach((p, i) => {
      const x = (n - 1 - i) * seg + seg / 2;
      const label = pocketLabel(p);
      g.save();
      g.translate(x, H * 0.5);
      g.scale(1, ppmY / ppmX);
      g.font = `700 ${Math.round(cap * 1.36)}px Cinzel, Georgia, serif`;
      // two-figure numbers are set a touch narrower so every number sits inside its panel
      const w = g.measureText(label).width;
      const room = seg * 0.8;
      if (w > room) g.scale(room / w, 1);
      g.fillText(label, 0, cap / 2);
      g.restore();
    });
    return texture(c, true);
  });
}

/**
 * The pocket floors: flocked cloth in the pocket's colour, darker toward the frets and the walls
 * where less light reaches down into it. The strip's bottom is the pockets' outer edge.
 */
export function pocketFloor(v: Variant, quality: Quality): THREE.Texture {
  return once(`pockets:${v}:${quality}`, () => {
    const order = WHEEL[v];
    const n = order.length;
    const W = quality === 'high' ? 2048 : 1024;
    const H = quality === 'high' ? 96 : 48;
    const [c, g] = canvasOf(W, H);
    const img = g.createImageData(W, H);
    const seg = W / n;
    const flock = new Noise(5, 1024, 64);
    const base = { red: rgb('#6e0810'), black: rgb('#0d0d0e'), green: rgb('#064d2b') };
    for (let x = 0; x < W; x++) {
      const i = Math.min(n - 1, Math.floor(x / seg));
      const pocket = order[n - 1 - i]!;
      const cl = base[colorOf(pocket)];
      const fx = (x - i * seg) / seg;
      const side = Math.min(fx, 1 - fx);
      for (let y = 0; y < H; y++) {
        const fy = y / H;
        const ao = 1 - 0.55 * Math.exp(-side / 0.1) - 0.4 * Math.exp(-(1 - fy) / 0.14) - 0.3 * Math.exp(-fy / 0.12);
        const fl = 0.82 + 0.36 * flock.at(x * 0.9, y * 1.6);
        const k = Math.max(0.2, ao) * fl;
        const o = (y * W + x) * 4;
        img.data[o] = cl[0] * k;
        img.data[o + 1] = cl[1] * k;
        img.data[o + 2] = cl[2] * k;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return texture(c, true);
  });
}

// ------------------------------------------------------------------------------------------------
// The table

/**
 * Speed cloth: a fine plain weave softened by fuzz, as a tiling normal map. One tile is sixteen
 * threads each way.
 */
export function feltWeave(quality: Quality): THREE.Texture {
  return once(`weave:${quality}`, () => {
    const S = quality === 'high' ? 256 : 128;
    const threads = 16;
    const h = new Float32Array(S * S);
    const fuzz = new Noise(9, 64, 64);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const gx = (x / S) * threads;
        const gy = (y / S) * threads;
        const i = Math.floor(gx);
        const j = Math.floor(gy);
        const fx = gx - i;
        const fy = gy - j;
        const warp = Math.sin(Math.PI * fx) ** 0.6;
        const weft = Math.sin(Math.PI * fy) ** 0.6;
        const over = (i + j) % 2 === 0;
        const top = over ? warp * (0.7 + 0.3 * Math.sin(Math.PI * fy)) : weft * (0.7 + 0.3 * Math.sin(Math.PI * fx));
        h[y * S + x] = top + 0.5 * (fuzz.fbm((x / S) * 64, (y / S) * 64, 2) - 0.5);
      }
    }
    const [c, g] = canvasOf(S, S);
    const img = g.createImageData(S, S);
    normals(h, S, S, quality === 'high' ? 1.1 : 0.7, img.data);
    g.putImageData(img, 0, 0);
    return repeating(texture(c, false));
  });
}

/**
 * Pebbled leather for the padded rail: rounded grains between fine creases, from a cellular
 * pattern that wraps (one jittered point per cell). Normal and roughness; one tile is 18 grains.
 */
export function leather(quality: Quality): MetalMaps {
  const key = `leather:${quality}`;
  const normal = made.get(key);
  if (normal) return { normal, roughness: made.get(`${key}:r`)! };
  const S = quality === 'high' ? 256 : 128;
  const cells = 18;
  let seed = 77;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    px[i] = 0.15 + 0.7 * rand();
    py[i] = 0.15 + 0.7 * rand();
  }
  const h = new Float32Array(S * S);
  const [rc, rg] = canvasOf(S, S);
  const rough = rg.createImageData(S, S);
  const fine = new Noise(79, 64, 64);
  for (let y = 0; y < S; y++) {
    const gy = (y / S) * cells;
    const cy = Math.floor(gy);
    for (let x = 0; x < S; x++) {
      const gx = (x / S) * cells;
      const cx = Math.floor(gx);
      let f1 = 9;
      let f2 = 9;
      for (let oy = -1; oy <= 1; oy++) {
        const ky = cy + oy;
        const wy = ((ky % cells) + cells) % cells;
        for (let ox = -1; ox <= 1; ox++) {
          const kx = cx + ox;
          const k = wy * cells + (((kx % cells) + cells) % cells);
          const d = Math.hypot(gx - kx - px[k]!, gy - ky - py[k]!);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
      }
      const crease = smooth(0, 0.22, f2 - f1);
      const grain = fine.at((x / S) * 64, (y / S) * 64) - 0.5;
      const i = y * S + x;
      h[i] = 0.9 * crease - 0.25 * f1 + 0.15 * grain;
      const o = i * 4;
      rough.data[o] = rough.data[o + 1] = rough.data[o + 2] = (0.5 + 0.22 * (1 - crease) + 0.06 * grain) * 255;
      rough.data[o + 3] = 255;
    }
  }
  const [nc, ng] = canvasOf(S, S);
  const nimg = ng.createImageData(S, S);
  normals(h, S, S, quality === 'high' ? 2.2 : 1.4, nimg.data);
  ng.putImageData(nimg, 0, 0);
  rg.putImageData(rough, 0, 0);
  const n = repeating(texture(nc, false));
  const r = repeating(texture(rc, false));
  made.set(key, n);
  made.set(`${key}:r`, r);
  return { normal: n, roughness: r };
}

/**
 * Rolls of chips lying in a rack, one band per roll from the top of the texture down: each chip's
 * edge with its six inserts turned at random, a fine dark line between chips, and a plain strip
 * at the left for the rolls' ends.
 */
export function chipRolls(rolls: { body: string; spots: string }[], chips: number, quality: Quality): THREE.Texture {
  return once(`rolls:${rolls.length}:${chips}:${quality}`, () => {
    const W = quality === 'high' ? 128 : 64;
    const row = quality === 'high' ? 6 : 4;
    const band = chips * row;
    const [c, g] = canvasOf(W, band * rolls.length);
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const spotW = W / 6 / 3;
    rolls.forEach((r, k) => {
      for (let i = 0; i < chips; i++) {
        const y = k * band + i * row;
        g.fillStyle = r.body;
        g.fillRect(0, y, W, row);
        g.fillStyle = r.spots;
        const phase = rand() * W;
        for (let s = 0; s < 6; s++) {
          const x = (phase + (s * W) / 6) % W;
          if (x < W * 0.08) continue;
          g.fillRect(x, y, Math.min(spotW, W - x), row);
        }
        g.fillStyle = `rgba(0, 0, 0, ${0.25 + 0.15 * rand()})`;
        g.fillRect(0, y + row - 1, W, 1);
        g.fillStyle = `rgba(255, 255, 255, ${0.05 * rand()})`;
        g.fillRect(0, y, W, row - 1);
      }
      g.fillStyle = r.body;
      g.fillRect(0, k * band, Math.ceil(W * 0.04), band);
    });
    return texture(c, true);
  });
}
