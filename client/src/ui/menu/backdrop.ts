// The menu's own background, for when no 3D floor is behind it yet: the casino seen out of focus.
// Pools of lamp light, blurred machine lights in a receding row, a lit table's felt low on the
// right, then a vignette and a darker left side for the menu text. Drawn once per resize at half
// resolution (it is meant to be soft), from a fixed seed so it looks the same on every visit.

import { el } from '../kit.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = [number, number, number];

const WARM: RGB[] = [
  [255, 206, 138],
  [241, 213, 154],
  [255, 236, 206],
  [255, 180, 96],
];
// Slot-bank LEDs: a few cool and red points among the warm ones.
const LED: RGB[] = [
  [255, 98, 84],
  [90, 209, 200],
  [214, 96, 209],
  [255, 206, 138],
];

function glow(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, a: number, soft = 0.72): void {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  grad.addColorStop(soft, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.8})`);
  grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function paint(canvas: HTMLCanvasElement): void {
  const w = Math.max(320, Math.round(innerWidth / 2));
  const h = Math.max(200, Math.round(innerHeight / 2));
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return;
  const rnd = mulberry32(0x5eed);
  const s = Math.min(w, h);

  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#0b0807';
  g.fillRect(0, 0, w, h);

  // carpet catching the light, and a lit table's felt low on the right
  const floor = g.createRadialGradient(w * 0.66, h * 1.05, 0, w * 0.66, h * 1.05, w * 0.7);
  floor.addColorStop(0, 'rgba(92,26,32,0.55)');
  floor.addColorStop(1, 'rgba(92,26,32,0)');
  g.fillStyle = floor;
  g.fillRect(0, 0, w, h);

  g.globalCompositeOperation = 'lighter';
  glow(g, w * 0.78, h * 0.86, s * 0.42, [40, 128, 84], 0.16, 0.4);
  // pendant lamps over the pit
  glow(g, w * 0.7, h * 0.18, s * 0.55, [255, 190, 110], 0.1, 0.3);
  glow(g, w * 0.93, h * 0.3, s * 0.4, [255, 190, 110], 0.08, 0.3);

  // a row of machines receding toward the right: smaller and closer together with distance
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x = w * (0.42 + 0.55 * Math.pow(t, 0.8));
    const y = h * (0.56 - 0.1 * t) + (rnd() - 0.5) * h * 0.03;
    const r = s * (0.05 - 0.035 * t) * (0.7 + rnd() * 0.6);
    glow(g, x, y, r, LED[Math.floor(rnd() * LED.length)]!, 0.09 + rnd() * 0.1);
  }
  // out-of-focus lights everywhere else, most of them warm, fewer on the left where the text is
  for (let i = 0; i < 80; i++) {
    const x = w * Math.pow(rnd(), 0.6);
    const y = h * (0.05 + rnd() * 0.7);
    const r = s * (0.012 + rnd() * rnd() * 0.07);
    const warm = rnd() < 0.82;
    const c = warm ? WARM[Math.floor(rnd() * WARM.length)]! : LED[Math.floor(rnd() * LED.length)]!;
    glow(g, x, y, r, c, (0.05 + rnd() * 0.16) * (0.35 + 0.65 * (x / w)));
  }

  g.globalCompositeOperation = 'source-over';
  // darker on the left, where the title and menu sit
  const side = g.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(8,6,5,0.94)');
  side.addColorStop(0.38, 'rgba(8,6,5,0.62)');
  side.addColorStop(0.72, 'rgba(8,6,5,0)');
  g.fillStyle = side;
  g.fillRect(0, 0, w, h);
  const vig = g.createRadialGradient(w * 0.6, h * 0.5, s * 0.3, w * 0.6, h * 0.5, Math.hypot(w, h) * 0.62);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  // fine grain, so the dark gradients don't band
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 7;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
}

/** A full-screen painted background. The caller puts it first in its container. */
export function paintedBackdrop(): { root: HTMLCanvasElement; dispose(): void } {
  const canvas = el('canvas', 'backdrop-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  let timer = 0;
  const onResize = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => paint(canvas), 120);
  };
  paint(canvas);
  addEventListener('resize', onResize);
  return {
    root: canvas,
    dispose() {
      clearTimeout(timer);
      removeEventListener('resize', onResize);
    },
  };
}
