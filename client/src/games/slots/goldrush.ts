// Gold Rush's look: a walnut cabinet with brass trim and amber edge light, a timber mine-portal
// topper hung with lanterns, a dark earth screen five reels by four rows, mining symbols in brass
// and gold, and the free games' held wilds drawn as gold ingots over the reels.

import * as THREE from 'three';
import { GOLDRUSH, type GoldSymbol } from '../../../../shared/src/games/slots/goldrush.ts';
import { at, box, merge, slab, uvFromBounds } from './cabinet.ts';
import { registerSkin } from './build.ts';
import { disclaimers, rays, roundRect, text, type OverlaySpec, type Skin, type SkinLayout, type TopperParts } from './skin.ts';

type G = CanvasRenderingContext2D;

const EARTH = '#1a120b';
const GOLD = '#f2c14a';
const BRASS = '#b98a3e';
const TIMBER = '#5a3a1e';
const INK = '#2a1a0c';
export const GOLD_SCREEN = EARTH;

// ---------------------------------------------------------------------------------------------
// symbols, drawn centred on (0, 0) in a box w x h

function goldFill(g: G, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, '#fff2b0');
  grad.addColorStop(0.45, '#f2c14a');
  grad.addColorStop(1, '#9a6a12');
  return grad;
}

/** WILD: a gold ingot stamped WILD. */
function ingot(g: G, s: number): void {
  const top = [[-0.3, -0.22], [0.3, -0.22], [0.42, 0.02], [-0.42, 0.02]] as const;
  const front = [[-0.42, 0.02], [0.42, 0.02], [0.42, 0.24], [-0.42, 0.24]] as const;
  g.lineJoin = 'round';
  for (const [poly, fill] of [[top, goldFill(g, 0, -0.22 * s, 0, 0.02 * s)], [front, goldFill(g, 0, 0.02 * s, 0, 0.3 * s)]] as const) {
    g.beginPath();
    poly.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = s * 0.025;
    g.strokeStyle = '#5a3a05';
    g.stroke();
  }
  text(g, 'WILD', 0, 0.135 * s, `600 ${0.2 * s}px 'Barlow Condensed', sans-serif`, '#5a3a05');
  text(g, 'WILD', 0, -0.1 * s, `${0.17 * s}px Limelight, serif`, '#7a5208');
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillRect(-0.24 * s, -0.19 * s, 0.14 * s, 0.025 * s);
}

/** NUGGET: a lumpy gold nugget with glints. */
function nugget(g: G, s: number): void {
  const pts = [[-0.36, 0.06], [-0.28, -0.16], [-0.1, -0.3], [0.12, -0.26], [0.3, -0.14], [0.38, 0.06], [0.28, 0.24], [0.04, 0.32], [-0.2, 0.28]] as const;
  g.beginPath();
  pts.forEach(([x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length]!;
    const mx = ((x + nx) / 2) * 1.06, my = ((y + ny) / 2) * 1.06;
    if (i === 0) g.moveTo(x * s, y * s);
    g.quadraticCurveTo(mx * s, my * s, nx * s, ny * s);
  });
  g.closePath();
  const grad = g.createRadialGradient(-0.1 * s, -0.12 * s, 0.02 * s, 0, 0, 0.42 * s);
  grad.addColorStop(0, '#fff6c8');
  grad.addColorStop(0.5, '#f0b93a');
  grad.addColorStop(1, '#8a5a0e');
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = s * 0.03;
  g.strokeStyle = '#4a2e05';
  g.stroke();
  g.fillStyle = 'rgba(120,70,5,0.45)';
  for (const [x, y, r] of [[0.1, 0.08, 0.06], [-0.14, 0.12, 0.05], [0.18, -0.08, 0.04]] as const) {
    g.beginPath();
    g.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  for (const [x, y, r] of [[-0.16, -0.14, 0.07], [0.24, 0.16, 0.045]] as const) {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i % 2 ? r * 0.25 : r;
      g.lineTo((x + Math.cos(a) * rr) * s, (y + Math.sin(a) * rr) * s);
    }
    g.closePath();
    g.fill();
  }
}

function cart(g: G, s: number): void {
  // gold heaped over the rim, then the tub, then the wheels
  g.fillStyle = goldFill(g, 0, -0.34 * s, 0, 0);
  g.beginPath();
  g.moveTo(-0.34 * s, -0.08 * s);
  for (const [x, y] of [[-0.26, -0.26], [-0.12, -0.32], [0, -0.24], [0.12, -0.34], [0.26, -0.24], [0.34, -0.08]] as const) g.quadraticCurveTo((x - 0.05) * s, (y - 0.05) * s, x * s, y * s);
  g.closePath();
  g.fill();
  g.lineWidth = s * 0.02;
  g.strokeStyle = '#6a4a08';
  g.stroke();
  g.beginPath();
  g.moveTo(-0.42 * s, -0.1 * s);
  g.lineTo(0.42 * s, -0.1 * s);
  g.lineTo(0.32 * s, 0.2 * s);
  g.lineTo(-0.32 * s, 0.2 * s);
  g.closePath();
  const tub = g.createLinearGradient(0, -0.1 * s, 0, 0.2 * s);
  tub.addColorStop(0, '#8a5a34');
  tub.addColorStop(1, '#4a2c14');
  g.fillStyle = tub;
  g.fill();
  g.strokeStyle = '#1e1208';
  g.lineWidth = s * 0.03;
  g.stroke();
  g.strokeStyle = BRASS;
  g.lineWidth = s * 0.035;
  for (const y of [-0.04, 0.12]) {
    g.beginPath();
    g.moveTo(-0.4 * s + Math.abs(y) * 0.1 * s, y * s);
    g.lineTo(0.4 * s - Math.abs(y) * 0.1 * s, y * s);
    g.stroke();
  }
  for (const x of [-0.2, 0.2]) {
    g.beginPath();
    g.arc(x * s, 0.26 * s, 0.09 * s, 0, Math.PI * 2);
    g.fillStyle = '#2b2b2b';
    g.fill();
    g.lineWidth = s * 0.03;
    g.strokeStyle = '#8a8a8a';
    g.stroke();
  }
}

function pick(g: G, s: number): void {
  g.save();
  g.rotate(-0.6);
  const handle = g.createLinearGradient(-0.04 * s, 0, 0.04 * s, 0);
  handle.addColorStop(0, '#6a4222');
  handle.addColorStop(0.5, '#b07a45');
  handle.addColorStop(1, '#5a361a');
  g.fillStyle = handle;
  roundRect(g, -0.04 * s, -0.36 * s, 0.08 * s, 0.8 * s, 0.03 * s);
  g.fill();
  g.strokeStyle = '#2a1608';
  g.lineWidth = s * 0.02;
  g.stroke();
  g.beginPath();
  g.moveTo(-0.44 * s, -0.22 * s);
  g.quadraticCurveTo(0, -0.46 * s, 0.44 * s, -0.22 * s);
  g.quadraticCurveTo(0, -0.34 * s, -0.44 * s, -0.22 * s);
  g.closePath();
  const iron = g.createLinearGradient(0, -0.46 * s, 0, -0.22 * s);
  iron.addColorStop(0, '#e6e8ec');
  iron.addColorStop(1, '#6b7078');
  g.fillStyle = iron;
  g.fill();
  g.strokeStyle = '#2b2e33';
  g.lineWidth = s * 0.025;
  g.stroke();
  g.restore();
}

function lantern(g: G, s: number): void {
  // glow
  const glow = g.createRadialGradient(0, 0.04 * s, 0.02 * s, 0, 0.04 * s, 0.42 * s);
  glow.addColorStop(0, 'rgba(255,200,90,0.55)');
  glow.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = glow;
  g.fillRect(-0.45 * s, -0.4 * s, 0.9 * s, 0.9 * s);
  // handle
  g.beginPath();
  g.arc(0, -0.3 * s, 0.14 * s, Math.PI, 0);
  g.strokeStyle = '#3a3a3a';
  g.lineWidth = s * 0.03;
  g.stroke();
  // cap and base
  g.fillStyle = '#4a4a4a';
  roundRect(g, -0.2 * s, -0.3 * s, 0.4 * s, 0.1 * s, 0.03 * s);
  g.fill();
  roundRect(g, -0.22 * s, 0.26 * s, 0.44 * s, 0.1 * s, 0.03 * s);
  g.fill();
  // glass with flame
  const glass = g.createLinearGradient(0, -0.2 * s, 0, 0.26 * s);
  glass.addColorStop(0, '#ffe9a8');
  glass.addColorStop(1, '#f29a2e');
  g.fillStyle = glass;
  roundRect(g, -0.16 * s, -0.2 * s, 0.32 * s, 0.46 * s, 0.08 * s);
  g.fill();
  g.beginPath();
  g.moveTo(0, -0.06 * s);
  g.quadraticCurveTo(0.08 * s, 0.08 * s, 0, 0.16 * s);
  g.quadraticCurveTo(-0.08 * s, 0.08 * s, 0, -0.06 * s);
  g.fillStyle = '#fffbe8';
  g.fill();
  g.strokeStyle = '#3a3a3a';
  g.lineWidth = s * 0.025;
  for (const x of [-0.16, 0, 0.16]) {
    g.beginPath();
    g.moveTo(x * s, -0.2 * s);
    g.lineTo(x * s, 0.26 * s);
    g.stroke();
  }
}

function pan(g: G, s: number): void {
  g.beginPath();
  g.ellipse(0, 0.04 * s, 0.44 * s, 0.26 * s, 0, 0, Math.PI * 2);
  const rim = g.createLinearGradient(-0.44 * s, 0, 0.44 * s, 0);
  rim.addColorStop(0, '#5a5f66');
  rim.addColorStop(0.5, '#c9ced6');
  rim.addColorStop(1, '#4a4f56');
  g.fillStyle = rim;
  g.fill();
  g.strokeStyle = '#22252a';
  g.lineWidth = s * 0.025;
  g.stroke();
  g.beginPath();
  g.ellipse(0, 0.06 * s, 0.34 * s, 0.18 * s, 0, 0, Math.PI * 2);
  g.fillStyle = '#3b2a1c';
  g.fill();
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = GOLD;
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.28;
    g.beginPath();
    g.arc(Math.cos(a) * r * s, (0.06 + Math.sin(a) * r * 0.55) * s, (0.012 + rnd() * 0.02) * s, 0, Math.PI * 2);
    g.fill();
  }
  ball(g, 0.06 * s, 0.05 * s, 0.07 * s);
}

function ball(g: G, x: number, y: number, r: number): void {
  const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, '#fff2b0');
  grad.addColorStop(1, '#b07a12');
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
}

const LETTER: Record<string, [string, string, string]> = {
  A: ['#ffe9a0', '#d9a520', '#5a3a05'],
  K: ['#ffc9a0', '#b8622c', '#4a1e05'],
  Q: ['#f0f3f7', '#9aa3ad', '#2b3036'],
  J: ['#f2d3a0', '#a8743a', '#3e2408'],
  '10': ['#cfe3ee', '#5f8aa3', '#1b2e3a'],
};

function letter(g: G, sym: string, s: number): void {
  const [hi, lo, edge] = LETTER[sym]!;
  const grad = g.createLinearGradient(0, -0.3 * s, 0, 0.3 * s);
  grad.addColorStop(0, hi);
  grad.addColorStop(1, lo);
  text(g, sym, 0, 0.04 * s, `600 ${(sym === '10' ? 0.56 : 0.7) * s}px Cinzel, serif`, grad, { stroke: edge, strokeWidth: s * 0.06 });
}

export function drawGold(g: G, sym: string, w: number, h: number): void {
  const s = Math.min(w, h);
  switch (sym as GoldSymbol) {
    case 'WILD':
      ingot(g, s);
      break;
    case 'NUGGET':
      nugget(g, s);
      break;
    case 'CART':
      cart(g, s);
      break;
    case 'PICK':
      pick(g, s);
      break;
    case 'LANTERN':
      lantern(g, s);
      break;
    case 'PAN':
      pan(g, s);
      break;
    default:
      letter(g, sym, s);
  }
}

/** A held wild: the ingot on a lit plate that covers the cell, so the reel spins behind it. */
function drawHeld(g: G, w: number, h: number): void {
  roundRect(g, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 10);
  const grad = g.createRadialGradient(0, 0, 4, 0, 0, w * 0.6);
  grad.addColorStop(0, '#5a3a10');
  grad.addColorStop(1, '#241408');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.shadowColor = '#ffcf5a';
  g.shadowBlur = 16;
  g.strokeStyle = '#ffd36b';
  g.lineWidth = 5;
  g.stroke();
  g.restore();
  ingot(g, Math.min(w, h) * 0.86);
}

// ---------------------------------------------------------------------------------------------
// printed glass

const PAY_ORDER: GoldSymbol[] = ['CART', 'PICK', 'LANTERN', 'PAN', 'A', 'K', 'Q', 'J', '10'];

function planks(g: G, w: number, h: number, base: string): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < h; y += 46) {
    g.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.1})`;
    g.fillRect(0, y, w, 2);
    for (let i = 0; i < 8; i++) {
      g.strokeStyle = `rgba(255,220,170,${0.03 + rnd() * 0.04})`;
      g.lineWidth = 1.5;
      g.beginPath();
      const yy = y + 6 + rnd() * 34;
      g.moveTo(0, yy);
      g.bezierCurveTo(w * 0.3, yy + (rnd() - 0.5) * 8, w * 0.7, yy + (rnd() - 0.5) * 8, w, yy);
      g.stroke();
    }
  }
}

function brassFrame(g: G, w: number, h: number): void {
  g.strokeStyle = BRASS;
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = '#e8c878';
  for (const [x, y] of [[22, 22], [w - 22, 22], [22, h - 22], [w - 22, h - 22]] as const) {
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
  }
}

function payGlass(g: G, w: number, h: number): void {
  planks(g, w, h, '#2a1a0e');
  brassFrame(g, w, h);
  text(g, 'GOLD RUSH', w / 2, 56, `58px Limelight, serif`, GOLD, { stroke: INK, strokeWidth: 8 });
  const colW = (w - 80) / 3;
  const rowH = 118;
  PAY_ORDER.forEach((sym, i) => {
    const cx = 40 + (i % 3) * colW, cy = 96 + Math.floor(i / 3) * rowH;
    g.save();
    g.translate(cx + 58, cy + rowH / 2);
    drawGold(g, sym, 96, 96);
    g.restore();
    const pays = GOLDRUSH.linePays[sym]!;
    [5, 4, 3].forEach((n, k) => {
      const y = cy + 28 + k * 31;
      text(g, String(n), cx + 124, y, `600 21px 'Barlow Condensed', sans-serif`, '#e8b86a', { align: 'left' });
      text(g, pays[n - 2]!.toLocaleString('en-US'), cx + 146, y, `600 27px 'Barlow Condensed', sans-serif`, '#fbe9c2', { align: 'left' });
    });
  });
  const y0 = 96 + 3 * rowH + 10;
  text(g, '3 · 4 · 5 NUGGETS ANYWHERE: 8 · 10 · 15 FREE GAMES', w / 2, y0 + 12, `600 26px 'Barlow Condensed', sans-serif`, GOLD);
  text(g, 'EVERY WILD THAT LANDS IN THE FREE GAMES STAYS PUT TILL THEY END', w / 2, y0 + 44, `600 21px 'Barlow Condensed', sans-serif`, '#fbe9c2');
}

function belly(g: G, w: number, h: number): void {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#3a2210');
  sky.addColorStop(1, '#120a05');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  rays(g, w / 2, h * 0.42, 36, w, 'rgba(242,193,74,0.06)');
  // the mine's mouth: a timber portal onto the dark
  g.fillStyle = '#060403';
  roundRect(g, w * 0.28, h * 0.18, w * 0.44, h * 0.5, 20);
  g.fill();
  g.fillStyle = TIMBER;
  g.fillRect(w * 0.25, h * 0.14, w * 0.5, 30);
  g.fillRect(w * 0.25, h * 0.14, 34, h * 0.56);
  g.fillRect(w * 0.75 - 34, h * 0.14, 34, h * 0.56);
  // rails and a cart coming out
  g.strokeStyle = '#8a8a8a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(w * 0.4, h * 0.68);
  g.lineTo(w * 0.18, h * 0.86);
  g.moveTo(w * 0.6, h * 0.68);
  g.lineTo(w * 0.82, h * 0.86);
  g.stroke();
  g.save();
  g.translate(w / 2, h * 0.6);
  cart(g, 250);
  g.restore();
  for (const k of [-1, 1]) {
    g.save();
    g.translate(w / 2 + k * 330, h * 0.3);
    lantern(g, 150);
    g.restore();
  }
  text(g, 'GOLD RUSH', w / 2, h * 0.84, `70px Limelight, serif`, GOLD, { stroke: INK, strokeWidth: 10 });
  disclaimers(g, w, h - 34, '#e8d3a8', 17);
  brassFrame(g, w, h);
}

/** The portal sign's face, in the topper region. */
export const PORTAL_FACE = { x: 0, y: 640, w: 1024, h: 300 };

function topperFace(g: G, w: number, h: number): void {
  planks(g, w, h, '#4a2e16');
  g.strokeStyle = BRASS;
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, PORTAL_FACE.h - 16);
  text(g, 'GOLD RUSH', w / 2, PORTAL_FACE.h * 0.5, `124px Limelight, serif`, GOLD, { stroke: INK, strokeWidth: 12 });
  for (const k of [-1, 1]) {
    g.save();
    g.translate(w / 2 + k * 420, PORTAL_FACE.h * 0.5);
    nugget(g, 130);
    g.restore();
  }
}

// ---------------------------------------------------------------------------------------------
// the cabinet

const CELL_M = 0.07;
const SIDE_PX = 48;
const LOOK = { width: 0.108, radius: 0.8, stopAngle: CELL_M / 0.8, arcHalf: 0.19, curve: 0.55 };

const LAYOUT: SkinLayout = {
  width: 0.74,
  profile: [
    [-0.32, 0], [0.26, 0], [0.26, 0.05], [0.235, 0.075], [0.25, 0.1], [0.25, 0.64], [0.4, 0.73], [0.43, 0.76],
    [0.43, 0.785], [0.28, 0.845], [0.27, 0.87], [0.27, 1.47], [0.285, 1.495], [0.285, 1.52], [0.22, 1.9], [0.19, 1.925], [-0.32, 1.925],
  ],
  bevel: 0.01,
  body: { color: '#3b2414', metalness: 0.15, roughness: 0.48 },
  trim: { color: '#c0913f', metalness: 1, roughness: 0.3 },
  plate: { w: 0.7, h: 0.54, cy: 1.17, zBack: 0.27, depth: 0.062 },
  window: { w: 0.66, h: 4 * CELL_M, cy: 1.205 },
  reels: { count: 5, pitch: (0.66 * (1 - (2 * SIDE_PX) / 1024)) / 5, look: LOOK, zFront: 0.322, rows: 4 },
  meters: { w: 0.62, h: 0.075, cy: 0.985 },
  pay: { bottom: [0.285, 1.52], top: [0.22, 1.9], w: 0.66, h: 0.36 },
  belly: { w: 0.62, h: 0.5, cy: 0.37, z: 0.25 },
  deck: { front: [0.43, 0.785], back: [0.28, 0.845], xs: [-0.24, -0.08, 0.08, 0.24], bw: 0.12, bh: 0.055 },
  top: 1.925,
  candle: [-0.3, 1.925, -0.22],
  lever: false,
};

function topper(l: SkinLayout): TopperParts {
  // two timber posts and a beam, the sign board hung between them
  const posts = [-1, 1].map((k) => box(0.06, 0.36, 0.08, at(k * (l.width / 2 - 0.03), l.top + 0.18, 0.02)));
  const beam = box(l.width + 0.04, 0.06, 0.1, at(0, l.top + 0.33, 0.02));
  const s = new THREE.Shape();
  s.moveTo(-l.width / 2 + 0.07, 0.04);
  s.lineTo(l.width / 2 - 0.07, 0.04);
  s.lineTo(l.width / 2 - 0.07, 0.29);
  s.lineTo(-l.width / 2 + 0.07, 0.29);
  s.closePath();
  const board = slab(s, 0.05, 0.006, 0.0).applyMatrix4(at(0, l.top, 0));
  const face = new THREE.PlaneGeometry(l.width - 0.16, 0.23).toNonIndexed();
  uvFromBounds(face, PORTAL_FACE);
  face.applyMatrix4(at(0, l.top + 0.165, 0.05 + 0.002));
  const trim = [
    // brass brackets where the board hangs, and the brass cap along the beam
    box(0.04, 0.05, 0.06, at(-l.width / 2 + 0.12, l.top + 0.305, 0.03)),
    box(0.04, 0.05, 0.06, at(l.width / 2 - 0.12, l.top + 0.305, 0.03)),
    box(l.width + 0.05, 0.012, 0.105, at(0, l.top + 0.366, 0.02)),
  ];
  // lanterns along the beam and down the posts, amber in turn
  const spots: THREE.Vector3[] = [];
  const colors: THREE.Color[] = [];
  for (let i = 0; i < 14; i++) {
    spots.push(new THREE.Vector3(-l.width / 2 + 0.03 + (i / 13) * (l.width - 0.06), l.top + 0.33, 0.075));
    colors.push(new THREE.Color(i % 2 ? '#ffb347' : '#ffe2a0'));
  }
  for (const k of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      spots.push(new THREE.Vector3(k * (l.width / 2 - 0.03), l.top + 0.04 + i * 0.055, 0.065));
      colors.push(new THREE.Color(i % 2 ? '#ffb347' : '#ffe2a0'));
    }
  }
  const strip = (x: number, y0: number, y1: number, z: number) => {
    const g = box(0.01, y1 - y0, 0.01, at(x, (y0 + y1) / 2, z));
    const c = new THREE.Color('#ff9f2e');
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
    return g;
  };
  const e = l.width / 2 + 0.002;
  const leds = merge([strip(-e, 0.12, 0.62, 0.252), strip(e, 0.12, 0.62, 0.252), strip(-e, 0.9, 1.46, 0.272), strip(e, 0.9, 1.46, 0.272)]);
  return { body: [...posts, beam, board], trim, printed: [face], bulbs: { spots, colors, radius: 0.0095 }, leds };
}

const LINE_COLORS = ['#ffd36b', '#ff8a3d', '#6dd3ff', '#9dff7a', '#ff6b8b', '#c79bff', '#ffe98a', '#4fe3c1', '#ffb0d0', '#b5e8ff'];

export const GOLD_OVERLAY: OverlaySpec = {
  rows: 4,
  lineRows: GOLDRUSH.lineRows,
  height: Math.round(1024 * ((4 * CELL_M) / 0.66)),
  side: SIDE_PX,
  markers: false,
  colors: LINE_COLORS,
  ground: '#140d08',
  ink: GOLD,
  ringColor: '#ffd36b',
  drawHeld,
};

export const GOLD_SKIN: Skin = {
  id: 'goldrush',
  layout: LAYOUT,
  meter: { ground: '#140d08', label: '#e8b86a', digit: '#ffb347', frame: 'rgba(232,184,106,0.45)', labels: ['CREDIT', 'TOTAL BET', 'WIN'] },
  cell: { w: 160, h: 94 },
  symbolScale: 0.9,
  stripGround: EARTH,
  tint: '#fff4e0',
  buttons: { pays: ['#e8d3a8', '#2a1a0c'], betOne: ['#f2c14a', '#3a2204'], maxBet: ['#b8622c', '#fff1e0'], spin: ['#3bb56a', '#08210f'] },
  drawSymbol: drawGold,
  paintPay: payGlass,
  paintBelly: belly,
  paintTopper: topperFace,
  topper,
};

registerSkin({
  skin: GOLD_SKIN,
  sets: [{ strips: GOLDRUSH.strips }, { strips: GOLDRUSH.freeStrips }],
  idle: [3, 9, 24, 12, 29],
  overlay: GOLD_OVERLAY,
});
