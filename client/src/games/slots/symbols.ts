// Reel symbols, drawn as vectors on canvas: the steppers' sevens, bars, cherries and 5X on a
// cream reel strip, and Neon Nights' neon signs on a night-blue screen. The same painters draw the
// strips, the pay glass rows and the help screen, so every picture of a symbol is the same one.

import { NEON, SEVENS, WILD, type MachineId, type NeonSymbol } from '../../../../shared/src/games/slots/machines.ts';

type G = CanvasRenderingContext2D;

export const STRIP_CREAM = '#f3ecdb';
export const SCREEN_NIGHT = '#0c0b1d';

// ---------------------------------------------------------------------------------------------
// Stepper symbols. Each painter draws centred on (0, 0) in a box `w` wide and `h` tall.

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A red seven: flared top bar and a swept stem, outlined, with a white pinstripe. */
function seven(g: G, w: number, h: number, fill = '#cf1f2b'): void {
  const s = Math.min(w / 0.8, h);
  g.save();
  g.scale(s, s);
  const path = () => {
    g.beginPath();
    g.moveTo(-0.36, -0.46);
    g.lineTo(0.38, -0.46);
    g.lineTo(0.38, -0.3);
    g.bezierCurveTo(0.16, -0.08, 0.02, 0.18, -0.02, 0.47);
    g.lineTo(-0.25, 0.47);
    g.bezierCurveTo(-0.2, 0.2, -0.05, -0.06, 0.12, -0.27);
    g.lineTo(-0.2, -0.27);
    g.lineTo(-0.26, -0.18);
    g.lineTo(-0.36, -0.18);
    g.closePath();
  };
  path();
  g.lineJoin = 'round';
  g.lineWidth = 0.09;
  g.strokeStyle = '#2b0708';
  g.stroke();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 0.022;
  g.strokeStyle = 'rgba(255,244,230,0.9)';
  g.save();
  g.clip();
  g.translate(-0.012, -0.012);
  g.scale(0.9, 0.9);
  path();
  g.stroke();
  g.restore();
  g.restore();
}

/** Bar plates: 1, 2 or 3 black plates with cream "BAR". */
function bars(g: G, w: number, h: number, n: 1 | 2 | 3): void {
  const pw = Math.min(w * 0.92, h * 1.5);
  const ph = Math.min(h / (n + (n - 1) * 0.22), pw * 0.3);
  const gap = ph * 0.22;
  const total = n * ph + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const y = -total / 2 + i * (ph + gap);
    roundRect(g, -pw / 2, y, pw, ph, ph * 0.22);
    g.fillStyle = '#16120f';
    g.fill();
    g.lineWidth = Math.max(1, ph * 0.08);
    g.strokeStyle = '#e9dcb9';
    roundRect(g, -pw / 2 + ph * 0.1, y + ph * 0.1, pw - ph * 0.2, ph * 0.8, ph * 0.16);
    g.stroke();
    g.fillStyle = '#f3e7c6';
    g.font = `600 ${ph * 0.78}px 'Barlow Condensed', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BAR', 0, y + ph * 0.54);
  }
}

/** Two cherries on stems joined under a leaf. */
function cherry(g: G, w: number, h: number): void {
  const s = Math.min(w, h);
  g.save();
  g.scale(s, s);
  g.lineCap = 'round';
  g.strokeStyle = '#3f6b1e';
  g.lineWidth = 0.045;
  g.beginPath();
  g.moveTo(-0.2, 0.14);
  g.quadraticCurveTo(-0.12, -0.2, 0.08, -0.36);
  g.moveTo(0.2, 0.2);
  g.quadraticCurveTo(0.2, -0.12, 0.08, -0.36);
  g.stroke();
  g.fillStyle = '#4f8a24';
  g.beginPath();
  g.moveTo(0.08, -0.36);
  g.quadraticCurveTo(0.3, -0.5, 0.42, -0.34);
  g.quadraticCurveTo(0.26, -0.26, 0.08, -0.36);
  g.fill();
  for (const [x, y] of [[-0.2, 0.24], [0.2, 0.3]] as const) {
    g.beginPath();
    g.arc(x, y, 0.17, 0, Math.PI * 2);
    g.fillStyle = '#b3121f';
    g.fill();
    g.lineWidth = 0.02;
    g.strokeStyle = '#4a0509';
    g.stroke();
    g.beginPath();
    g.ellipse(x - 0.06, y - 0.07, 0.05, 0.035, -0.6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,235,225,0.75)';
    g.fill();
  }
  g.restore();
}

/** The 5X wild: a black oval badge with a gold rim, a gold "5X" and a red WILD ribbon. */
function fiveX(g: G, w: number, h: number): void {
  const rw = Math.min(w * 0.46, h * 0.62);
  const rh = rw * 0.74;
  g.save();
  g.beginPath();
  g.ellipse(0, -rh * 0.06, rw, rh, 0, 0, Math.PI * 2);
  g.fillStyle = '#121016';
  g.fill();
  g.lineWidth = rw * 0.1;
  g.strokeStyle = '#d8b25a';
  g.stroke();
  g.lineWidth = rw * 0.025;
  g.strokeStyle = '#6b4f18';
  g.beginPath();
  g.ellipse(0, -rh * 0.06, rw * 0.88, rh * 0.84, 0, 0, Math.PI * 2);
  g.stroke();
  g.font = `${rh * 1.05}px Limelight, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = rh * 0.08;
  g.strokeStyle = '#3d2a08';
  g.strokeText('5X', 0, -rh * 0.12);
  g.fillStyle = '#f2cf6b';
  g.fillText('5X', 0, -rh * 0.12);
  // ribbon
  const ry = rh * 0.62;
  g.fillStyle = '#c41d2a';
  g.beginPath();
  g.moveTo(-rw * 0.78, ry - rh * 0.2);
  g.lineTo(rw * 0.78, ry - rh * 0.2);
  g.lineTo(rw * 0.7, ry + rh * 0.02);
  g.lineTo(rw * 0.78, ry + rh * 0.24);
  g.lineTo(-rw * 0.78, ry + rh * 0.24);
  g.lineTo(-rw * 0.7, ry + rh * 0.02);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff3d8';
  g.font = `600 ${rh * 0.36}px 'Barlow Condensed', sans-serif`;
  g.fillText('WILD', 0, ry + rh * 0.03);
  g.restore();
}

/** Draw a 3-reel symbol ('BAR' is the "any bar" picture used on the pay glass). */
export function drawStepperSymbol(g: G, sym: string, w: number, h: number): void {
  switch (sym) {
    case '7':
      seven(g, w, h);
      break;
    case '3B':
      bars(g, w, h, 3);
      break;
    case '2B':
      bars(g, w, h, 2);
      break;
    case '1B':
      bars(g, w, h, 1);
      break;
    case 'CH':
      cherry(g, w, h);
      break;
    case 'WX':
      fiveX(g, w, h);
      break;
    case 'BAR':
      g.font = `600 ${h * 0.34}px 'Barlow Condensed', sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#16120f';
      g.fillText('ANY', 0, -h * 0.2);
      g.fillText('BAR', 0, h * 0.2);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Neon Nights symbols: bent-tube neon on a night screen.

const NEON_COLORS: Record<NeonSymbol, string> = {
  WILD: '#ff4fd8',
  SCATTER: '#ffd36b',
  DIAMOND: '#5ff3ff',
  SEVEN: '#ff3d6e',
  BELL: '#ffc53a',
  HORSESHOE: '#6dff9c',
  A: '#ff9a3c',
  K: '#b58cff',
  Q: '#40d6ff',
  J: '#c4ff4a',
  '10': '#ff6fa3',
};

export function neonColor(sym: NeonSymbol): string {
  return NEON_COLORS[sym];
}

/** Stroke the current path as a neon tube: a wide soft glow, the coloured tube and a hot core. */
function tube(g: G, color: string, width: number): void {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = color;
  g.shadowBlur = width * 3.2;
  g.strokeStyle = color;
  g.globalAlpha = 0.55;
  g.lineWidth = width * 2.1;
  g.stroke();
  g.globalAlpha = 1;
  g.shadowBlur = width * 1.4;
  g.lineWidth = width;
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = width * 0.34;
  g.stroke();
  g.restore();
}

function neonText(g: G, text: string, size: number, color: string, y = 0): void {
  g.save();
  g.font = `${size}px 'Tilt Neon', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = size * 0.35;
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.lineWidth = size * 0.1;
  g.strokeText(text, 0, y);
  g.shadowBlur = size * 0.12;
  g.fillStyle = color;
  g.fillText(text, 0, y);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.globalAlpha = 0.55;
  g.fillText(text, 0, y);
  g.restore();
}

export function drawNeonSymbol(g: G, sym: NeonSymbol, w: number, h: number): void {
  const s = Math.min(w, h);
  const c = NEON_COLORS[sym];
  const lw = s * 0.045;
  switch (sym) {
    case 'DIAMOND': {
      g.beginPath();
      g.moveTo(-0.34 * s, -0.12 * s);
      g.lineTo(-0.2 * s, -0.3 * s);
      g.lineTo(0.2 * s, -0.3 * s);
      g.lineTo(0.34 * s, -0.12 * s);
      g.lineTo(0, 0.34 * s);
      g.closePath();
      g.moveTo(-0.34 * s, -0.12 * s);
      g.lineTo(0.34 * s, -0.12 * s);
      g.moveTo(-0.1 * s, -0.3 * s);
      g.lineTo(-0.14 * s, -0.12 * s);
      g.lineTo(0, 0.34 * s);
      g.lineTo(0.14 * s, -0.12 * s);
      g.lineTo(0.1 * s, -0.3 * s);
      tube(g, c, lw);
      break;
    }
    case 'SEVEN': {
      g.beginPath();
      g.moveTo(-0.24 * s, -0.28 * s);
      g.lineTo(0.26 * s, -0.28 * s);
      g.quadraticCurveTo(0.02 * s, 0.0, -0.06 * s, 0.32 * s);
      g.moveTo(-0.24 * s, -0.28 * s);
      g.lineTo(-0.24 * s, -0.18 * s);
      tube(g, c, lw * 1.2);
      break;
    }
    case 'BELL': {
      g.beginPath();
      g.moveTo(-0.3 * s, 0.2 * s);
      g.quadraticCurveTo(-0.18 * s, 0.1 * s, -0.18 * s, -0.06 * s);
      g.bezierCurveTo(-0.18 * s, -0.3 * s, 0.18 * s, -0.3 * s, 0.18 * s, -0.06 * s);
      g.quadraticCurveTo(0.18 * s, 0.1 * s, 0.3 * s, 0.2 * s);
      g.closePath();
      g.moveTo(0, -0.26 * s);
      g.lineTo(0, -0.32 * s);
      tube(g, c, lw);
      g.beginPath();
      g.arc(0, 0.27 * s, 0.05 * s, 0, Math.PI * 2);
      tube(g, c, lw * 0.8);
      break;
    }
    case 'HORSESHOE': {
      g.beginPath();
      g.arc(0, -0.02 * s, 0.24 * s, Math.PI * 0.82, Math.PI * 2.18);
      tube(g, c, lw * 1.5);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * (0.95 + (i / 5) * 1.1);
        g.beginPath();
        g.arc(Math.cos(a) * 0.24 * s, -0.02 * s + Math.sin(a) * 0.24 * s, 0.018 * s, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'WILD': {
      g.beginPath();
      const r = 0.36 * s;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? r * 0.8 : r;
        g.lineTo(Math.cos(a) * rr * 1.25, Math.sin(a) * rr);
      }
      g.closePath();
      tube(g, c, lw * 0.8);
      neonText(g, 'WILD', s * 0.3, '#ffffff', s * 0.02);
      break;
    }
    case 'SCATTER': {
      g.beginPath();
      g.arc(-0.02 * s, -0.06 * s, 0.22 * s, Math.PI * 0.3, Math.PI * 1.7);
      g.arc(0.08 * s, -0.1 * s, 0.18 * s, Math.PI * 1.6, Math.PI * 0.4, true);
      g.closePath();
      tube(g, c, lw);
      for (const [x, y, r] of [[0.26, -0.26, 0.05], [0.3, 0.02, 0.035]] as const) {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 ? r * 0.45 : r;
          g.lineTo((x + Math.cos(a) * rr) * s, (y + Math.sin(a) * rr) * s);
        }
        g.closePath();
        tube(g, '#fff4c2', lw * 0.5);
      }
      neonText(g, 'SCATTER', s * 0.13, '#fff4c2', s * 0.33);
      break;
    }
    default:
      neonText(g, sym, s * (sym === '10' ? 0.5 : 0.6), c, s * 0.02);
  }
}

// ---------------------------------------------------------------------------------------------
// Reel strips

export interface StripArt {
  /** One canvas per reel, stop 0 at the top, one cell per stop. */
  sharp: HTMLCanvasElement[];
  /** The same strips smeared vertically, for a reel at speed. */
  blurred: HTMLCanvasElement[];
  stops: number;
  /** Cell size in pixels. */
  cellW: number;
  cellH: number;
}

/** Pixel size of one stop's cell, per machine (the steppers' cells are wide: a symbol spans ~1.6 stops). */
export function cellSize(machine: MachineId, scale: number): { w: number; h: number } {
  const base = machine === 'neon' ? { w: 152, h: 112 } : { w: 236, h: 88 };
  return { w: Math.round(base.w * scale), h: Math.round(base.h * scale) };
}

function paperGrain(g: G, w: number, h: number, seed: number): void {
  // a faint printed-paper grain so a still reel doesn't read as flat plastic
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  g.globalAlpha = 0.05;
  for (let i = 0; i < (w * h) / 180; i++) {
    g.fillStyle = i % 2 ? '#7a6a4a' : '#ffffff';
    g.fillRect(rnd() * w, rnd() * h, 1.4, 1.4);
  }
  g.globalAlpha = 1;
}

function stripCanvas(machine: MachineId, reel: number, scale: number): HTMLCanvasElement {
  const { w, h } = cellSize(machine, scale);
  const canvas = document.createElement('canvas');
  if (machine === 'neon') {
    const strip = NEON.strips[reel]!;
    canvas.width = w;
    canvas.height = strip.length * h;
    const g = canvas.getContext('2d')!;
    g.fillStyle = SCREEN_NIGHT;
    g.fillRect(0, 0, canvas.width, canvas.height);
    // a faint screen raster
    g.fillStyle = 'rgba(120,110,255,0.035)';
    for (let y = 0; y < canvas.height; y += 3) g.fillRect(0, y, canvas.width, 1);
    strip.forEach((sym, k) => {
      g.save();
      g.translate(w / 2, (k + 0.5) * h);
      drawNeonSymbol(g, sym, w * 0.86, h * 0.92);
      g.restore();
    });
    return canvas;
  }
  const m = machine === 'sevens' ? SEVENS : WILD;
  const stops = m.reels[reel]!;
  canvas.width = w;
  canvas.height = stops.length * h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = STRIP_CREAM;
  g.fillRect(0, 0, canvas.width, canvas.height);
  paperGrain(g, canvas.width, canvas.height, reel + 1);
  // symbols sit on their stop and spill into the blank stops either side, as on a real strip;
  // draw each one a strip-length above and below too so the wrap at stop 0 is seamless
  stops.forEach(([sym], k) => {
    if (sym === 'BL') return;
    for (const wrap of [-1, 0, 1]) {
      g.save();
      g.translate(w / 2, (k + 0.5) * h + wrap * canvas.height);
      drawStepperSymbol(g, sym, w * 0.78, h * 1.55);
      g.restore();
    }
  });
  return canvas;
}

/** A vertically smeared copy at half size: the running average of shifted draws, wrapping. */
function blurCanvas(src: HTMLCanvasElement, spanPx: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, src.width >> 1);
  c.height = Math.max(1, src.height >> 1);
  const g = c.getContext('2d')!;
  const n = 14;
  for (let i = 0; i < n; i++) {
    const off = ((i / (n - 1) - 0.5) * spanPx) / 2;
    g.globalAlpha = 1 / (i + 1);
    for (const wrap of [-c.height, 0, c.height]) g.drawImage(src, 0, off + wrap, c.width, c.height);
  }
  g.globalAlpha = 1;
  return c;
}

export function stripArt(machine: MachineId, scale: number): StripArt {
  const reels = machine === 'neon' ? NEON.strips.length : 3;
  const sharp = Array.from({ length: reels }, (_, r) => stripCanvas(machine, r, scale));
  const { w, h } = cellSize(machine, scale);
  const blurred = sharp.map((c) => blurCanvas(c, h * 1.8));
  return { sharp, blurred, stops: machine === 'neon' ? 32 : 22, cellW: w, cellH: h };
}
