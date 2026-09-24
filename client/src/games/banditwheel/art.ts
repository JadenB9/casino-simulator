// The Bandit Wheel's paint, drawn in code: weathered timber, rusted steel, the terminals' chipped
// paint, a leather strap, the wheel's face (twenty-five hand-painted wedges gone dull with dirt,
// scratched and chipped at the edges, the cream centre stained with rust), the five painted
// squares on each terminal, the terminals' little amber screens and the stencilled sign.
//
// Everything is painted on canvases (the page's CSP blocks data: URLs) from a seeded generator,
// so every copy of the wheel wears the same scratches. The colours are Rust's: yellow 1, green 3,
// blue 5, purple 10, red 20.

import * as THREE from 'three';
import { SLOTS, WHEEL, type WheelNumber } from '../../../../shared/src/games/banditwheel/rules.ts';
import { FACE_R, RING_IN, PEG_R } from './layout.ts';

/** mulberry32: a small seeded generator for texture noise. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each number's paint: the body colour, the lighter streak down a wedge's middle, the darker edges. */
export const PAINT: Record<WheelNumber, { body: string; hi: string; lo: string }> = {
  1: { body: '#dcb534', hi: '#f0d766', lo: '#b08a1f' },
  3: { body: '#3f9a3a', hi: '#6fbf54', lo: '#2a7128' },
  5: { body: '#3a6fb4', hi: '#6a9bd4', lo: '#28528a' },
  10: { body: '#a64aa9', hi: '#c97acb', lo: '#7c3080' },
  20: { body: '#cf4a26', hi: '#e8743f', lo: '#9f3118' },
};

/** The ink the numbers are painted in. */
export const INK = '#1b1714';
/** Numbers are typewriter figures, as on the Rust wheel and its betting squares. */
export const NUMBER_FONT = '"Courier New", Courier, "Nimbus Mono PS", monospace';
const STENCIL_FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

function canvas(w: number, h = w): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

export function texture(c: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; anisotropy?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.anisotropy ?? 4;
  return t;
}

/** Per-pixel grain over the whole canvas, ±amp in each channel. */
function grain(g: CanvasRenderingContext2D, w: number, h: number, amp: number, rand: () => number): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 2 * amp;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
}

/**
 * A soft blotch. On a tiling texture (w, h > 0) it is drawn wrapped round the edges so the tiles
 * show no seam; with w = h = 0 it is drawn once, where it is.
 */
function blotch(g: CanvasRenderingContext2D, w: number, h: number, x: number, y: number, r: number, color: string, alpha: number): void {
  const wrap = w > 0 && h > 0;
  for (const dx of wrap ? [-w, 0, w] : [0]) {
    for (const dy of wrap ? [-h, 0, h] : [0]) {
      const cx = x + dx;
      const cy = y + dy;
      if (wrap && (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h)) continue;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = alpha;
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  g.globalAlpha = 1;
}

/** A ragged flake of paint knocked off (or of rust showing through): a jagged little polygon. */
function flake(g: CanvasRenderingContext2D, x: number, y: number, r: number, rand: () => number): void {
  const n = 6 + Math.floor(rand() * 5);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.5;
    const rr = r * (0.35 + rand() * 0.75);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * (0.6 + rand() * 0.6);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

// ---------------------------------------------------------------------------------------------
// Tiling materials

/** Old timber, the grain running along u: grey-brown boards gone silver at the edges, dark knots, cracks. */
export function paintWood(size = 512, seed = 11): HTMLCanvasElement {
  const { c, g } = canvas(size);
  const rand = seeded(seed);
  g.fillStyle = '#5c4a39';
  g.fillRect(0, 0, size, size);
  // broad streaks of tone along the grain
  for (let i = 0; i < 26; i++) {
    const y = rand() * size;
    const h = 8 + rand() * 40;
    const tone = rand() < 0.5 ? 'rgba(40,28,18,' : 'rgba(150,132,110,';
    g.fillStyle = `${tone}${0.08 + rand() * 0.14})`;
    g.fillRect(0, y, size, h);
    if (y + h > size) g.fillRect(0, y - size, size, h);
  }
  // the grain itself: long wavy hairlines
  for (let i = 0; i < 420; i++) {
    const y0 = rand() * size;
    const len = size * (0.3 + rand() * 0.9);
    const x0 = rand() * size;
    const amp = 1 + rand() * 4;
    const freq = (2 + Math.floor(rand() * 4)) * ((Math.PI * 2) / size);
    const dark = rand() < 0.65;
    g.strokeStyle = dark ? `rgba(30,20,12,${0.12 + rand() * 0.3})` : `rgba(190,170,140,${0.06 + rand() * 0.14})`;
    g.lineWidth = 0.6 + rand() * 1.6;
    for (const off of [0, -size]) {
      g.beginPath();
      for (let x = 0; x <= len; x += 6) {
        const px = x0 + x + off;
        const py = y0 + Math.sin(px * freq + i) * amp;
        if (x === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  // knots, with rings
  for (let i = 0; i < 5; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 5 + rand() * 11;
    for (let k = 4; k >= 0; k--) {
      g.strokeStyle = `rgba(28,18,10,${0.18 + k * 0.08})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(x, y, r * (1 + k * 0.55), r * 0.5 * (1 + k * 0.35), 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(24,15,8,0.8)';
    g.beginPath();
    g.ellipse(x, y, r * 0.7, r * 0.35, 0, 0, Math.PI * 2);
    g.fill();
  }
  // weather: silvered patches and dark damp
  for (let i = 0; i < 14; i++) blotch(g, size, size, rand() * size, rand() * size, 30 + rand() * 90, rand() < 0.5 ? '#9a9286' : '#1e150d', 0.12 + rand() * 0.16);
  // cracks along the grain
  g.strokeStyle = 'rgba(12,8,5,0.8)';
  for (let i = 0; i < 9; i++) {
    const y = rand() * size;
    const x = rand() * size;
    g.lineWidth = 0.8 + rand() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 30 + rand() * 140, y + (rand() - 0.5) * 4);
    g.stroke();
  }
  grain(g, size, size, 10, rand);
  return c;
}

/** Rusted steel: dark iron under orange-brown rust, pitted, with bright scratches and runs. */
export function paintRust(size = 512, seed = 23): HTMLCanvasElement {
  const { c, g } = canvas(size);
  const rand = seeded(seed);
  g.fillStyle = '#4b433b';
  g.fillRect(0, 0, size, size);
  const rusts = ['#7a3d1c', '#8f4b22', '#a45e2b', '#5e2d15', '#6b4a33'];
  for (let i = 0; i < 70; i++) blotch(g, size, size, rand() * size, rand() * size, 14 + rand() * 80, rusts[Math.floor(rand() * rusts.length)]!, 0.25 + rand() * 0.45);
  // runs of rust down from the blotches
  for (let i = 0; i < 40; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 20 + rand() * 90;
    const grad = g.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, `rgba(150,78,36,${0.25 + rand() * 0.3})`);
    grad.addColorStop(1, 'rgba(150,78,36,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1.5 + rand() * 4, len);
  }
  // pits
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(20,12,8,${0.3 + rand() * 0.5})`;
    const r = 0.4 + rand() * 1.8;
    g.beginPath();
    g.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    g.fill();
  }
  // scratches through to bare metal
  for (let i = 0; i < 60; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const len = 8 + rand() * 50;
    g.strokeStyle = `rgba(170,160,150,${0.12 + rand() * 0.25})`;
    g.lineWidth = 0.6 + rand();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  grain(g, size, size, 14, rand);
  return c;
}

/**
 * Sheet steel painted once, long ago: the terminals' pale blue, rubbed through at the edges and
 * chipped to rust, streaked with grime.
 */
export function paintPainted(size = 512, seed = 37, color = '#61716f'): HTMLCanvasElement {
  const { c, g } = canvas(size);
  const rand = seeded(seed);
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) blotch(g, size, size, rand() * size, rand() * size, 40 + rand() * 110, rand() < 0.6 ? '#3b4446' : '#c9d4d0', 0.08 + rand() * 0.12);
  // chips through to rust in a few worn patches, each with a pale primer rim
  for (let c = 0; c < 12; c++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const n = 3 + Math.floor(rand() * 7);
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * 60;
      const y = cy + (rand() - 0.5) * 40;
      const r = 2 + rand() * (rand() < 0.15 ? 16 : 6);
      g.fillStyle = 'rgba(190,188,176,0.45)';
      flake(g, x, y, r * 1.3, rand);
      g.fillStyle = rand() < 0.6 ? '#5a3420' : '#3f3530';
      flake(g, x, y, r, rand);
    }
  }
  // grime running down
  for (let i = 0; i < 50; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 30 + rand() * 160;
    const grad = g.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, `rgba(40,34,28,${0.1 + rand() * 0.2})`);
    grad.addColorStop(1, 'rgba(40,34,28,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 2 + rand() * 7, len);
  }
  // scuffs
  for (let i = 0; i < 70; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const len = 6 + rand() * 40;
    g.strokeStyle = `rgba(30,26,22,${0.1 + rand() * 0.25})`;
    g.lineWidth = 0.7 + rand();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  grain(g, size, size, 9, rand);
  return c;
}

/** The flapper's leather: dark tan, grained, with a line of stitching down each side. */
export function paintLeather(): HTMLCanvasElement {
  const w = 128;
  const h = 256;
  const { c, g } = canvas(w, h);
  const rand = seeded(53);
  g.fillStyle = '#95592c';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 12; i++) blotch(g, w, h, rand() * w, rand() * h, 10 + rand() * 40, rand() < 0.5 ? '#5a3217' : '#b67a45', 0.3);
  // wear toward the tip (the bottom of the canvas) where the pegs rub
  const wear = g.createLinearGradient(0, h * 0.6, 0, h);
  wear.addColorStop(0, 'rgba(170,120,80,0)');
  wear.addColorStop(1, 'rgba(170,120,80,0.35)');
  g.fillStyle = wear;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(225,200,160,0.75)';
  g.lineWidth = 2;
  g.setLineDash([7, 5]);
  for (const x of [12, w - 12]) {
    g.beginPath();
    g.moveTo(x, 8);
    g.lineTo(x, h - 16);
    g.stroke();
  }
  g.setLineDash([]);
  grain(g, w, h, 12, rand);
  return c;
}

// ---------------------------------------------------------------------------------------------
// The wheel's face

/** Wedge boundaries' angle for slot i, clockwise from straight up (the canvas's up). */
const edge = (i: number) => (i * Math.PI * 2) / SLOTS;

/**
 * Paint the face on a `size`-pixel square: canvas centre = hub, canvas up = the wheel's up at rest,
 * slot 0 (the 20) just right of the top, clockwise from there.
 */
export function paintFace(size: number): HTMLCanvasElement {
  const { c, g } = canvas(size);
  const rand = seeded(20180802);
  const ppm = size / (2 * FACE_R);
  const R = (m: number) => m * ppm;
  const S = size / 2048; // strokes and details scale with the canvas
  g.translate(size / 2, size / 2);
  const wedgePath = (i: number, r0: number, r1: number) => {
    const a0 = edge(i) - Math.PI / 2;
    const a1 = edge(i + 1) - Math.PI / 2;
    g.beginPath();
    g.arc(0, 0, R(r1), a0, a1);
    g.arc(0, 0, R(r0), a1, a0, true);
    g.closePath();
  };

  // bare plywood under everything (it shows where the paint has gone)
  g.fillStyle = '#7d6a55';
  g.beginPath();
  g.arc(0, 0, size / 2, 0, Math.PI * 2);
  g.fill();

  // the cream centre
  const cream = g.createRadialGradient(0, 0, R(0.05), 0, 0, R(RING_IN));
  cream.addColorStop(0, '#e9e0c8');
  cream.addColorStop(0.75, '#dfd3b4');
  cream.addColorStop(1, '#c9bb97');
  g.fillStyle = cream;
  g.beginPath();
  g.arc(0, 0, R(RING_IN), 0, Math.PI * 2);
  g.fill();

  // the wedges: each brushed on with a lighter streak down its middle
  const bandOut = FACE_R - 0.004;
  for (let i = 0; i < SLOTS; i++) {
    const p = PAINT[WHEEL[i]!];
    const mid = (edge(i) + edge(i + 1)) / 2 - Math.PI / 2;
    const rm = R((RING_IN + bandOut) / 2);
    // across the wedge: dark edge, light middle, dark edge
    const ex = Math.cos(mid + Math.PI / 2);
    const ey = Math.sin(mid + Math.PI / 2);
    const half = R(Math.sin(Math.PI / SLOTS) * bandOut);
    const cx = Math.cos(mid) * rm;
    const cy = Math.sin(mid) * rm;
    const across = g.createLinearGradient(cx - ex * half, cy - ey * half, cx + ex * half, cy + ey * half);
    across.addColorStop(0, p.lo);
    across.addColorStop(0.28, p.body);
    across.addColorStop(0.5, p.hi);
    across.addColorStop(0.72, p.body);
    across.addColorStop(1, p.lo);
    g.fillStyle = across;
    wedgePath(i, RING_IN, bandOut);
    g.fill();
    // brush strokes along the wedge
    g.save();
    wedgePath(i, RING_IN, bandOut);
    g.clip();
    for (let k = 0; k < 16; k++) {
      const a = edge(i) + (edge(i + 1) - edge(i)) * rand() - Math.PI / 2;
      const r0 = RING_IN + rand() * 0.4;
      const r1 = r0 + 0.08 + rand() * 0.3;
      g.strokeStyle = rand() < 0.5 ? `rgba(255,250,230,${0.02 + rand() * 0.04})` : `rgba(40,25,10,${0.02 + rand() * 0.05})`;
      g.lineWidth = (4 + rand() * 10) * S;
      g.beginPath();
      g.moveTo(Math.cos(a) * R(r0), Math.sin(a) * R(r0));
      g.lineTo(Math.cos(a) * R(r1), Math.sin(a) * R(r1));
      g.stroke();
    }
    g.restore();
  }

  // the numbers, their heads toward the rim
  for (let i = 0; i < SLOTS; i++) {
    const n = WHEEL[i]!;
    g.save();
    g.rotate((edge(i) + edge(i + 1)) / 2);
    g.translate(0, -R(0.79));
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${R(n >= 10 ? 0.125 : 0.15)}px ${NUMBER_FONT}`;
    if (n >= 10) g.scale(0.82, 1);
    g.fillText(String(n), 0, 0);
    g.restore();
  }

  // dark lines between the wedges, round the cream and round the rim
  g.strokeStyle = 'rgba(22,16,12,0.85)';
  g.lineWidth = 5 * S;
  for (let i = 0; i < SLOTS; i++) {
    const a = edge(i) - Math.PI / 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * R(RING_IN), Math.sin(a) * R(RING_IN));
    g.lineTo(Math.cos(a) * R(bandOut), Math.sin(a) * R(bandOut));
    g.stroke();
  }
  g.lineWidth = 9 * S;
  g.beginPath();
  g.arc(0, 0, R(RING_IN), 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 7 * S;
  g.beginPath();
  g.arc(0, 0, R(bandOut - 0.004), 0, Math.PI * 2);
  g.stroke();

  // the boards under the paint: faint seams across the face, cracked in places
  for (let y = -FACE_R + 0.2; y < FACE_R; y += 0.235) {
    g.strokeStyle = 'rgba(30,20,12,0.22)';
    g.lineWidth = 3 * S;
    g.beginPath();
    g.moveTo(-size / 2, R(y));
    g.lineTo(size / 2, R(y));
    g.stroke();
    for (let k = 0; k < 6; k++) {
      const x = (rand() - 0.5) * size;
      g.strokeStyle = 'rgba(20,12,8,0.55)';
      g.lineWidth = 2.5 * S;
      g.beginPath();
      g.moveTo(x, R(y));
      g.lineTo(x + (40 + rand() * 120) * S, R(y) + (rand() - 0.5) * 6 * S);
      g.stroke();
    }
  }

  // wear: paint knocked off in clusters, mostly round the rim where hands and the flapper catch
  // it, some along the wedges' edges; pale primer with the wood showing in the middle
  for (let c = 0; c < 70; c++) {
    const rim = rand() < 0.6;
    const a = rand() * Math.PI * 2 - Math.PI / 2;
    const r = rim ? bandOut - rand() * 0.07 : RING_IN + rand() * (bandOut - RING_IN);
    const aa = rim ? a : edge(Math.floor(rand() * SLOTS)) - Math.PI / 2 + (rand() - 0.5) * 0.02;
    const n = 2 + Math.floor(rand() * 6);
    for (let k = 0; k < n; k++) {
      const rr = r + (rand() - 0.5) * 0.03;
      const ak = aa + (rand() - 0.5) * (rim ? 0.05 : 0.01);
      const x = Math.cos(ak) * R(rr);
      const y = Math.sin(ak) * R(rr);
      const size0 = (4 + rand() * (rand() < 0.2 ? 22 : 9)) * S;
      g.fillStyle = 'rgba(198,190,172,0.85)';
      flake(g, x, y, size0 * 1.15, rand);
      if (rand() < 0.7) {
        g.fillStyle = 'rgba(106,88,66,0.95)';
        flake(g, x, y, size0 * 0.7, rand);
      }
    }
  }
  // scratches: fine dark lines in every direction, and a few long gouges
  for (let i = 0; i < 260; i++) {
    const r = RING_IN * 0.2 + rand() * (bandOut - RING_IN * 0.2);
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * R(r);
    const y = Math.sin(a) * R(r);
    const dir = rand() * Math.PI;
    const len = (10 + rand() * (rand() < 0.1 ? 260 : 60)) * S;
    g.strokeStyle = rand() < 0.7 ? `rgba(25,18,12,${0.25 + rand() * 0.4})` : `rgba(240,235,220,${0.2 + rand() * 0.3})`;
    g.lineWidth = (1 + rand() * 2.2) * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
    g.stroke();
  }
  // rust bleeding from the straps and bolts across the cream, and dirt round the rim
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * RING_IN;
    blotch(g, 0, 0, Math.cos(a) * R(r), Math.sin(a) * R(r), (18 + rand() * 60) * S, rand() < 0.6 ? '#8a4a22' : '#5b3a22', 0.18 + rand() * 0.25);
  }
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * R(0.02 + rand() * 0.06);
    const y = Math.sin(a) * R(0.02 + rand() * 0.06);
    const len = R(0.1 + rand() * 0.25);
    const grad = g.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, 'rgba(120,58,24,0.55)');
    grad.addColorStop(1, 'rgba(120,58,24,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, (3 + rand() * 7) * S, len);
  }
  const dirt = g.createRadialGradient(0, 0, R(FACE_R * 0.6), 0, 0, R(FACE_R));
  dirt.addColorStop(0, 'rgba(30,20,10,0)');
  dirt.addColorStop(1, 'rgba(30,20,10,0.4)');
  g.fillStyle = dirt;
  g.beginPath();
  g.arc(0, 0, R(FACE_R), 0, Math.PI * 2);
  g.fill();
  // grime rings where the pegs are driven in
  for (let i = 0; i < SLOTS; i++) {
    const a = edge(i) - Math.PI / 2;
    blotch(g, 0, 0, Math.cos(a) * R(PEG_R), Math.sin(a) * R(PEG_R), 22 * S, '#1c120a', 0.55);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  grain(g, size, size, 7, rand);
  return c;
}

// ---------------------------------------------------------------------------------------------
// The betting squares: on the terminals, in the panel and in the history strip

/**
 * One number's square, as on Rust's betting terminal: flat paint, scuffed and dirty, the number in
 * dark typewriter figures. `size` pixels; `seed` changes the wear.
 */
export function drawSquare(g: CanvasRenderingContext2D, x: number, y: number, size: number, n: WheelNumber, seed: number): void {
  const rand = seeded(seed * 97 + n);
  const p = PAINT[n];
  g.save();
  g.beginPath();
  g.rect(x, y, size, size);
  g.clip();
  g.fillStyle = p.body;
  g.fillRect(x, y, size, size);
  const lit = g.createLinearGradient(x, y, x + size, y + size);
  lit.addColorStop(0, 'rgba(255,255,240,0.12)');
  lit.addColorStop(1, 'rgba(20,10,0,0.18)');
  g.fillStyle = lit;
  g.fillRect(x, y, size, size);
  // scuffs and dirt
  for (let i = 0; i < 10; i++) {
    const r = size * (0.08 + rand() * 0.3);
    blotch(g, 0, 0, x + rand() * size, y + rand() * size, r, rand() < 0.6 ? '#2a1a0c' : p.lo, 0.12 + rand() * 0.2);
  }
  for (let i = 0; i < 16; i++) {
    const sx = x + rand() * size;
    const sy = y + rand() * size;
    const a = rand() * Math.PI;
    const len = size * (0.05 + rand() * 0.3);
    g.strokeStyle = `rgba(20,14,8,${0.2 + rand() * 0.35})`;
    g.lineWidth = Math.max(1, size * 0.008);
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
    g.stroke();
  }
  // chips of paint off the corners
  for (let i = 0; i < 5; i++) {
    const cx = x + (rand() < 0.5 ? 0 : size) + (rand() - 0.5) * size * 0.1;
    const cy = y + rand() * size;
    g.fillStyle = 'rgba(40,32,26,0.85)';
    flake(g, cx, cy, size * (0.03 + rand() * 0.06), rand);
  }
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${size * (n >= 10 ? 0.5 : 0.62)}px ${NUMBER_FONT}`;
  g.save();
  g.translate(x + size / 2, y + size * 0.53);
  if (n >= 10) g.scale(0.86, 1);
  g.fillText(String(n), 0, 0);
  g.restore();
  // a worn bit of the number
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 4; i++) {
    g.fillStyle = p.body;
    g.globalAlpha = 0.5 + rand() * 0.4;
    flake(g, x + size * (0.3 + rand() * 0.4), y + size * (0.3 + rand() * 0.4), size * (0.02 + rand() * 0.04), rand);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.restore();
  g.strokeStyle = 'rgba(14,10,8,0.85)';
  g.lineWidth = Math.max(1, size * 0.03);
  g.strokeRect(x + g.lineWidth / 2, y + g.lineWidth / 2, size - g.lineWidth, size - g.lineWidth);
}

/** A square on its own canvas, for the panel and the history. */
export function squareCanvas(n: WheelNumber, size: number, seed = 1): HTMLCanvasElement {
  const { c, g } = canvas(size);
  drawSquare(g, 0, 0, size, n, seed);
  return c;
}

/** The plate on each terminal's top: the five squares on scuffed steel. 4:1, left to right 1, 3, 5, 10, 20. */
export function paintPlate(width = 1024): HTMLCanvasElement {
  const h = width / 4;
  const { c, g } = canvas(width, h);
  const rand = seeded(77);
  g.drawImage(paintRust(256, 71), 0, 0, width, h);
  g.fillStyle = 'rgba(20,16,14,0.45)';
  g.fillRect(0, 0, width, h);
  const pitch = width / 5;
  const sq = pitch * 0.875;
  ([1, 3, 5, 10, 20] as WheelNumber[]).forEach((n, k) => {
    const x = k * pitch + (pitch - sq) / 2;
    const y = (h - sq) / 2;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x + 3, y + 5, sq, sq);
    drawSquare(g, x, y, sq, n, 5 + k);
  });
  // rivets in the plate's corners
  for (const [x, y] of [[8, 8], [width - 8, 8], [8, h - 8], [width - 8, h - 8]]) {
    g.fillStyle = '#2a2420';
    g.beginPath();
    g.arc(x!, y!, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(200,190,170,0.35)';
    g.beginPath();
    g.arc(x! - 1.5, y! - 1.5, 2, 0, Math.PI * 2);
    g.fill();
  }
  grain(g, width, h, 6, rand);
  return c;
}

// ---------------------------------------------------------------------------------------------
// The terminals' screens

export type ScreenState = { kind: 'bets'; seconds: number } | { kind: 'spin' } | { kind: 'result'; n: WheelNumber } | { kind: 'idle' };

/** An old amber display: the seconds to the next spin, "NO MORE BETS", or the number that came up. */
export function drawScreen(c: HTMLCanvasElement, s: ScreenState): void {
  const g = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;
  g.fillStyle = '#120d06';
  g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.7);
  glow.addColorStop(0, 'rgba(255,140,30,0.12)');
  glow.addColorStop(1, 'rgba(255,140,30,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const amber = '#ffb13b';
  g.shadowColor = 'rgba(255,150,40,0.8)';
  g.shadowBlur = h * 0.08;
  if (s.kind === 'bets') {
    g.fillStyle = amber;
    g.font = `bold ${h * 0.5}px DSEG7, ${NUMBER_FONT}`;
    g.fillText(String(Math.max(0, s.seconds)).padStart(2, '0'), w / 2, h * 0.42);
    g.shadowBlur = h * 0.04;
    g.font = `600 ${h * 0.17}px ${STENCIL_FONT}`;
    g.fillText('PLACE BETS', w / 2, h * 0.83);
  } else if (s.kind === 'spin') {
    g.fillStyle = amber;
    g.font = `600 ${h * 0.25}px ${STENCIL_FONT}`;
    g.fillText('NO MORE', w / 2, h * 0.35);
    g.fillText('BETS', w / 2, h * 0.66);
  } else if (s.kind === 'result') {
    g.fillStyle = amber;
    g.font = `bold ${h * 0.6}px ${NUMBER_FONT}`;
    g.fillText(String(s.n), w / 2, h * 0.52);
  } else {
    g.fillStyle = 'rgba(255,177,59,0.55)';
    g.font = `600 ${h * 0.22}px ${STENCIL_FONT}`;
    g.fillText('BANDIT WHEEL', w / 2, h * 0.5);
  }
  g.shadowBlur = 0;
  // scanlines and a dirty glass
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  const rim = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = rim;
  g.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------------------------
// The sign

/** "BANDIT WHEEL" sprayed through a stencil onto a sheet of corrugated iron. 4:1. */
export function paintSign(width = 1024): HTMLCanvasElement {
  const h = width / 4;
  const { c, g } = canvas(width, h);
  const rand = seeded(1999);
  g.drawImage(paintRust(512, 91), 0, 0, width, h);
  // old green paint on the sheet, mostly gone
  g.globalAlpha = 0.55;
  g.drawImage(paintPainted(512, 93, '#5d7254'), 0, 0, width, h);
  g.globalAlpha = 1;
  // the corrugations: light and dark bands across
  const waves = 22;
  for (let i = 0; i < waves; i++) {
    const x = (i / waves) * width;
    const grad = g.createLinearGradient(x, 0, x + width / waves, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.28)');
    grad.addColorStop(0.45, 'rgba(255,240,220,0.14)');
    grad.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = grad;
    g.fillRect(x, 0, width / waves, h);
  }
  // the lettering: sprayed cream through a stencil, with the stencil's bridges left bare
  const text = 'BANDIT WHEEL';
  g.font = `600 ${h * 0.62}px ${STENCIL_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const letters = document.createElement('canvas');
  letters.width = width;
  letters.height = h;
  const lg = letters.getContext('2d')!;
  lg.font = g.font;
  lg.textAlign = 'center';
  lg.textBaseline = 'middle';
  // overspray first, then the letters
  lg.shadowColor = 'rgba(236,224,196,0.55)';
  lg.shadowBlur = h * 0.05;
  lg.fillStyle = '#ece0c4';
  lg.fillText(text, width / 2, h * 0.54);
  lg.shadowBlur = 0;
  // stencil bridges: thin gaps across each letter's counters and joins
  lg.globalCompositeOperation = 'destination-out';
  const tw = lg.measureText(text).width;
  const left = width / 2 - tw / 2;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') continue;
    const x = left + lg.measureText(text.slice(0, i)).width + lg.measureText(text[i]!).width * 0.5;
    lg.fillRect(x - 3, h * 0.2, 6, h * 0.14);
    lg.fillRect(x - 3, h * 0.7, 6, h * 0.12);
  }
  // patchy spray
  for (let i = 0; i < 400; i++) {
    lg.globalAlpha = 0.3 + rand() * 0.5;
    lg.beginPath();
    lg.arc(rand() * width, rand() * h, 1 + rand() * 5, 0, Math.PI * 2);
    lg.fill();
  }
  lg.globalAlpha = 1;
  lg.globalCompositeOperation = 'source-over';
  g.drawImage(letters, 0, 0);
  // rust runs over the paint and bolts at the corners
  for (let i = 0; i < 26; i++) {
    const x = rand() * width;
    const y = rand() * h * 0.4;
    const len = h * (0.2 + rand() * 0.6);
    const grad = g.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, 'rgba(130,62,26,0.5)');
    grad.addColorStop(1, 'rgba(130,62,26,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 2 + rand() * 5, len);
  }
  for (const [x, y] of [[26, 24], [width - 26, 24], [26, h - 24], [width - 26, h - 24], [width / 2, 18]]) {
    g.fillStyle = '#1f1a16';
    g.beginPath();
    g.arc(x!, y!, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(190,170,150,0.35)';
    g.beginPath();
    g.arc(x! - 2, y! - 2, 3.5, 0, Math.PI * 2);
    g.fill();
  }
  grain(g, width, h, 8, rand);
  return c;
}
