// Lucky Cherries' look: a candy-apple red cabinet with cream trim, painted fruit on a cream
// screen, the Cherry Wheel set into the top box (where the player can see it spin) with bulbs
// round its rim, and a marquee with the name on top. The wheel is its own mesh; the view turns it.

import * as THREE from 'three';
import { CHERRIES, type CherrySymbol } from '../../../../shared/src/games/slots/cherries.ts';
import { at, box, cyl, merge, panel, roundedRect, slab } from './cabinet.ts';
import { registerSkin, payMatrix } from './build.ts';
import { disclaimers, rays, roundRect, text, type OverlaySpec, type Skin, type SkinLayout, type TopperParts } from './skin.ts';

type G = CanvasRenderingContext2D;

const RED = '#b3121f';
const DEEP = '#5e0710';
const CREAM = '#fbf1dc';
const GOLD = '#f2c14a';
const LEAF = '#3f8a2a';
export const CHERRY_SCREEN = '#fdf6e6';

// ---------------------------------------------------------------------------------------------
// fruit, drawn centred on (0, 0) in a box w x h

function gloss(g: G, x: number, y: number, rx: number, ry: number, a = -0.6): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fill();
}

function ball(g: G, x: number, y: number, r: number, light: string, dark: string, rim: string): void {
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = r * 0.08;
  g.strokeStyle = rim;
  g.stroke();
}

function leaf(g: G, x: number, y: number, len: number, angle: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.5, -len * 0.45, len, 0);
  g.quadraticCurveTo(len * 0.5, len * 0.45, 0, 0);
  g.fillStyle = LEAF;
  g.fill();
  g.strokeStyle = '#224f15';
  g.lineWidth = len * 0.06;
  g.stroke();
  g.beginPath();
  g.moveTo(len * 0.1, 0);
  g.lineTo(len * 0.85, 0);
  g.strokeStyle = 'rgba(200,240,170,0.6)';
  g.lineWidth = len * 0.04;
  g.stroke();
  g.restore();
}

function cherryPair(g: G, s: number): void {
  g.lineCap = 'round';
  g.strokeStyle = '#4b6b1c';
  g.lineWidth = s * 0.05;
  g.beginPath();
  g.moveTo(-0.2 * s, 0.1 * s);
  g.quadraticCurveTo(-0.1 * s, -0.22 * s, 0.1 * s, -0.4 * s);
  g.moveTo(0.22 * s, 0.16 * s);
  g.quadraticCurveTo(0.22 * s, -0.14 * s, 0.1 * s, -0.4 * s);
  g.stroke();
  leaf(g, 0.1 * s, -0.4 * s, 0.34 * s, -0.35);
  for (const [x, y] of [[-0.21, 0.22], [0.22, 0.28]] as const) {
    ball(g, x * s, y * s, 0.2 * s, '#ff5a5f', '#8e0a17', '#4a0509');
    gloss(g, (x - 0.07) * s, (y - 0.08) * s, 0.06 * s, 0.035 * s);
  }
}

function lemon(g: G, s: number): void {
  const grad = g.createRadialGradient(-0.1 * s, -0.1 * s, 0.05 * s, 0, 0, 0.42 * s);
  grad.addColorStop(0, '#fff7a8');
  grad.addColorStop(1, '#e9b90c');
  g.beginPath();
  g.moveTo(-0.44 * s, 0.02 * s);
  g.quadraticCurveTo(-0.36 * s, -0.3 * s, 0, -0.3 * s);
  g.quadraticCurveTo(0.36 * s, -0.3 * s, 0.44 * s, -0.02 * s);
  g.quadraticCurveTo(0.36 * s, 0.3 * s, 0, 0.3 * s);
  g.quadraticCurveTo(-0.36 * s, 0.3 * s, -0.44 * s, 0.02 * s);
  g.closePath();
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = s * 0.03;
  g.strokeStyle = '#8a6a05';
  g.stroke();
  gloss(g, -0.14 * s, -0.14 * s, 0.1 * s, 0.05 * s, -0.3);
  leaf(g, 0.28 * s, -0.22 * s, 0.24 * s, -0.9);
}

function orange(g: G, s: number): void {
  ball(g, 0, 0.04 * s, 0.36 * s, '#ffc266', '#e0660b', '#8a3a05');
  g.fillStyle = 'rgba(140,60,5,0.35)';
  for (let i = 0; i < 18; i++) {
    const a = i * 2.4, r = (0.08 + (i % 5) * 0.05) * s;
    g.beginPath();
    g.arc(Math.cos(a) * r, 0.04 * s + Math.sin(a) * r, 0.012 * s, 0, Math.PI * 2);
    g.fill();
  }
  gloss(g, -0.13 * s, -0.1 * s, 0.1 * s, 0.05 * s);
  leaf(g, 0.02 * s, -0.3 * s, 0.26 * s, -0.5);
}

function plum(g: G, s: number): void {
  const grad = g.createRadialGradient(-0.12 * s, -0.1 * s, 0.04 * s, 0, 0.04 * s, 0.4 * s);
  grad.addColorStop(0, '#c77be0');
  grad.addColorStop(1, '#4a1266');
  g.beginPath();
  g.ellipse(0, 0.05 * s, 0.32 * s, 0.37 * s, 0.25, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = s * 0.03;
  g.strokeStyle = '#2a0838';
  g.stroke();
  g.beginPath();
  g.moveTo(0.02 * s, -0.3 * s);
  g.quadraticCurveTo(0.16 * s, 0.05 * s, 0.06 * s, 0.4 * s);
  g.strokeStyle = 'rgba(42,8,56,0.5)';
  g.lineWidth = s * 0.025;
  g.stroke();
  gloss(g, -0.14 * s, -0.08 * s, 0.07 * s, 0.12 * s, 0.3);
  g.beginPath();
  g.moveTo(0, -0.31 * s);
  g.lineTo(0.05 * s, -0.44 * s);
  g.strokeStyle = '#5a3a10';
  g.lineWidth = s * 0.04;
  g.stroke();
}

function grapes(g: G, s: number): void {
  const rows = [[-0.2, -0.02, 0.2], [-0.1, 0.1], [0]] as const;
  g.lineCap = 'round';
  g.strokeStyle = '#5a3a10';
  g.lineWidth = s * 0.045;
  g.beginPath();
  g.moveTo(0, -0.2 * s);
  g.lineTo(0.04 * s, -0.42 * s);
  g.stroke();
  leaf(g, 0.04 * s, -0.36 * s, 0.26 * s, -0.3);
  const berries: [number, number][] = [];
  rows.forEach((xs, r) => xs.forEach((x) => berries.push([x * s, (-0.14 + r * 0.19) * s])));
  berries.push([0, 0.42 * s]);
  berries.slice(0, 7).forEach(([x, y]) => {
    ball(g, x, y + 0.03 * s, 0.11 * s, '#9c6ee8', '#3b1675', '#1f0a40');
    gloss(g, x - 0.035 * s, y, 0.03 * s, 0.018 * s);
  });
}

function melon(g: G, s: number): void {
  // a slice: rind, white, red flesh, seeds
  const y0 = -0.14 * s, r = 0.46 * s;
  g.beginPath();
  g.moveTo(-r, y0);
  g.arc(0, y0, r, Math.PI, 0, true);
  g.closePath();
  g.fillStyle = '#2f7a24';
  g.fill();
  g.beginPath();
  g.moveTo(-r * 0.9, y0);
  g.arc(0, y0, r * 0.9, Math.PI, 0, true);
  g.closePath();
  g.fillStyle = '#e9f4d0';
  g.fill();
  g.beginPath();
  g.moveTo(-r * 0.82, y0);
  g.arc(0, y0, r * 0.82, Math.PI, 0, true);
  g.closePath();
  const grad = g.createRadialGradient(0, y0, r * 0.1, 0, y0, r * 0.82);
  grad.addColorStop(0, '#ff6b6b');
  grad.addColorStop(1, '#d11a2a');
  g.fillStyle = grad;
  g.fill();
  g.fillStyle = '#1b0f0a';
  for (const [a, d] of [[0.35, 0.45], [0.8, 0.55], [1.3, 0.5], [1.8, 0.55], [2.35, 0.45], [1.05, 0.25], [1.6, 0.28], [0.6, 0.72], [2.1, 0.72]] as const) {
    g.beginPath();
    g.ellipse(Math.cos(a) * r * d, y0 + Math.sin(a) * r * d, 0.022 * s, 0.038 * s, a, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.moveTo(-r, y0);
  g.lineTo(r, y0);
  g.strokeStyle = '#1f5a18';
  g.lineWidth = s * 0.03;
  g.stroke();
}

function bell(g: G, s: number): void {
  const grad = g.createLinearGradient(-0.3 * s, 0, 0.3 * s, 0);
  grad.addColorStop(0, '#b8860b');
  grad.addColorStop(0.35, '#ffe07a');
  grad.addColorStop(1, '#a8720a');
  g.beginPath();
  g.moveTo(-0.36 * s, 0.24 * s);
  g.quadraticCurveTo(-0.22 * s, 0.14 * s, -0.22 * s, -0.06 * s);
  g.bezierCurveTo(-0.22 * s, -0.36 * s, 0.22 * s, -0.36 * s, 0.22 * s, -0.06 * s);
  g.quadraticCurveTo(0.22 * s, 0.14 * s, 0.36 * s, 0.24 * s);
  g.closePath();
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = s * 0.035;
  g.strokeStyle = '#6b4a05';
  g.stroke();
  g.beginPath();
  g.ellipse(0, 0.24 * s, 0.36 * s, 0.06 * s, 0, 0, Math.PI * 2);
  g.fillStyle = '#d9a520';
  g.fill();
  g.stroke();
  ball(g, 0, 0.33 * s, 0.07 * s, '#fff0b0', '#b8860b', '#6b4a05');
  g.beginPath();
  g.arc(0, -0.34 * s, 0.05 * s, 0, Math.PI * 2);
  g.strokeStyle = '#6b4a05';
  g.lineWidth = s * 0.03;
  g.stroke();
  gloss(g, -0.1 * s, -0.12 * s, 0.04 * s, 0.1 * s, 0.2);
}

function seven(g: G, s: number): void {
  g.save();
  g.scale(s, s);
  g.beginPath();
  g.moveTo(-0.34, -0.42);
  g.lineTo(0.36, -0.42);
  g.lineTo(0.36, -0.27);
  g.bezierCurveTo(0.12, -0.04, 0.02, 0.2, 0.0, 0.44);
  g.lineTo(-0.24, 0.44);
  g.bezierCurveTo(-0.2, 0.16, -0.04, -0.08, 0.12, -0.25);
  g.lineTo(-0.34, -0.25);
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 0.12;
  g.strokeStyle = GOLD;
  g.stroke();
  g.lineWidth = 0.04;
  g.strokeStyle = DEEP;
  g.stroke();
  const grad = g.createLinearGradient(0, -0.42, 0, 0.44);
  grad.addColorStop(0, '#ff4a3d');
  grad.addColorStop(1, '#a50d1b');
  g.fillStyle = grad;
  g.fill();
  g.restore();
}

/** The BONUS scatter: a gold star badge with a cherry pair and a ribbon. */
function bonus(g: G, s: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 2 ? 0.24 : 0.46) * s;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.95);
  }
  g.closePath();
  const grad = g.createRadialGradient(0, -0.05 * s, 0.05 * s, 0, 0, 0.46 * s);
  grad.addColorStop(0, '#fff4b8');
  grad.addColorStop(1, '#d99a0b');
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = s * 0.035;
  g.strokeStyle = '#7a4d05';
  g.stroke();
  g.save();
  g.translate(0, -0.06 * s);
  cherryPair(g, s * 0.5);
  g.restore();
  g.fillStyle = RED;
  g.beginPath();
  g.moveTo(-0.44 * s, 0.2 * s);
  g.lineTo(0.44 * s, 0.2 * s);
  g.lineTo(0.38 * s, 0.31 * s);
  g.lineTo(0.44 * s, 0.42 * s);
  g.lineTo(-0.44 * s, 0.42 * s);
  g.lineTo(-0.38 * s, 0.31 * s);
  g.closePath();
  g.fill();
  text(g, 'BONUS', 0, 0.315 * s, `600 ${0.2 * s}px 'Barlow Condensed', sans-serif`, CREAM);
}

export function drawFruit(g: G, sym: string, w: number, h: number): void {
  const s = Math.min(w, h);
  switch (sym as CherrySymbol) {
    case 'CHERRY':
      cherryPair(g, s);
      break;
    case 'LEMON':
      lemon(g, s);
      break;
    case 'ORANGE':
      orange(g, s);
      break;
    case 'PLUM':
      plum(g, s);
      break;
    case 'GRAPES':
      grapes(g, s);
      break;
    case 'MELON':
      melon(g, s);
      break;
    case 'BELL':
      bell(g, s);
      break;
    case 'SEVEN':
      seven(g, s);
      break;
    case 'BONUS':
      bonus(g, s);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// printed glass: the top box is the wheel's backdrop, the belly is the pay chart

function backdrop(g: G, w: number, h: number): void {
  const grad = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.6);
  grad.addColorStop(0, '#d62a36');
  grad.addColorStop(1, '#6e0712');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  rays(g, w / 2, h / 2, 36, w, 'rgba(255,230,180,0.08)');
  g.strokeStyle = GOLD;
  g.lineWidth = 6;
  g.strokeRect(12, 12, w - 24, h - 24);
  // LUCKY on the left of the wheel, CHERRIES on the right
  for (const [x, word] of [[w * 0.14, 'LUCKY'], [w * 0.86, 'CHERRIES']] as const) {
    g.save();
    g.translate(x, h * 0.5);
    text(g, word, 0, -h * 0.22, `${word.length > 5 ? 52 : 64}px Limelight, serif`, CREAM, { stroke: DEEP, strokeWidth: 9 });
    g.translate(0, h * 0.1);
    cherryPair(g, 150);
    g.restore();
  }
  text(g, '3 · 4 · 5 BONUS SPIN THE WHEEL  ·  PRIZES x1 · x2 · x5 THE TOTAL BET', w / 2, h - 40, `600 22px 'Barlow Condensed', sans-serif`, '#ffe3a6');
}

const PAY_ORDER: CherrySymbol[] = ['SEVEN', 'BELL', 'MELON', 'GRAPES', 'PLUM', 'ORANGE', 'LEMON', 'CHERRY'];

function belly(g: G, w: number, h: number): void {
  g.fillStyle = CREAM;
  g.fillRect(0, 0, w, h);
  rays(g, w / 2, -40, 40, w * 1.2, 'rgba(179,18,31,0.06)');
  g.strokeStyle = RED;
  g.lineWidth = 8;
  g.strokeRect(12, 12, w - 24, h - 24);
  text(g, 'LUCKY CHERRIES', w / 2, 70, `66px Limelight, serif`, RED, { stroke: CREAM, strokeWidth: 2 });
  const colW = (w - 80) / 2;
  const rowH = 90;
  PAY_ORDER.forEach((sym, i) => {
    const cx = 40 + (i % 2) * colW, cy = 130 + Math.floor(i / 2) * rowH;
    g.save();
    g.translate(cx + 56, cy + rowH / 2);
    drawFruit(g, sym, 84, 84);
    g.restore();
    const pays = CHERRIES.linePays[sym]!;
    const cells = [5, 4, 3, 2].filter((n) => pays[n - 2]! > 0);
    cells.forEach((n, k) => {
      const x = cx + 120 + k * 88;
      text(g, `${n}`, x, cy + rowH / 2 - 16, `600 20px 'Barlow Condensed', sans-serif`, '#8a1b20');
      text(g, pays[n - 2]!.toLocaleString('en-US'), x, cy + rowH / 2 + 12, `600 30px 'Barlow Condensed', sans-serif`, '#2a1508');
    });
  });
  text(g, 'PAYS PER CREDIT ON A LINE  ·  10 LINES  ·  CHERRIES PAY FROM TWO', w / 2, h - 58, `600 20px 'Barlow Condensed', sans-serif`, '#5e0710');
  disclaimers(g, w, h - 30, '#5e0710', 16);
}

function marquee(g: G, w: number, h: number): void {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#d9202e');
  grad.addColorStop(1, '#7a0914');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = GOLD;
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  text(g, 'LUCKY CHERRIES', w / 2, h * 0.52, `112px Limelight, serif`, CREAM, { stroke: DEEP, strokeWidth: 12 });
  for (const k of [-1, 1]) {
    g.save();
    g.translate(w / 2 + k * 440, h * 0.52);
    cherryPair(g, 150);
    g.restore();
  }
}

// ---------------------------------------------------------------------------------------------
// the wheel: its own texture, shared by every cabinet

export const WHEEL_RADIUS = 0.15;
const WHEEL_SEGMENTS = CHERRIES.wheel.length;

export function paintWheel(canvas: HTMLCanvasElement, size: number): void {
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2, r = size / 2 - 4;
  g.clearRect(0, 0, size, size);
  const seg = (Math.PI * 2) / WHEEL_SEGMENTS;
  CHERRIES.wheel.forEach((prize, i) => {
    // segment i is centred straight up at rest, the next ones clockwise
    const mid = -Math.PI / 2 + i * seg;
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, r * 0.94, mid - seg / 2, mid + seg / 2);
    g.closePath();
    g.fillStyle = prize >= 100 ? '#f2c14a' : prize >= 20 ? '#1f7a3a' : i % 2 ? CREAM : RED;
    g.fill();
    g.strokeStyle = 'rgba(60,10,10,0.5)';
    g.lineWidth = size * 0.004;
    g.stroke();
    g.save();
    g.translate(c, c);
    g.rotate(mid + Math.PI / 2);
    const ink = prize >= 100 ? DEEP : prize >= 20 ? CREAM : i % 2 ? RED : CREAM;
    text(g, `${prize}x`, 0, -r * 0.72, `600 ${size * (prize >= 100 ? 0.07 : 0.078)}px 'Barlow Condensed', sans-serif`, ink);
    g.restore();
  });
  // gold rim with studs, and the hub
  g.beginPath();
  g.arc(c, c, r * 0.97, 0, Math.PI * 2);
  g.lineWidth = r * 0.07;
  g.strokeStyle = '#d9a520';
  g.stroke();
  for (let i = 0; i < WHEEL_SEGMENTS; i++) {
    const a = -Math.PI / 2 + (i + 0.5) * seg;
    g.beginPath();
    g.arc(c + Math.cos(a) * r * 0.97, c + Math.sin(a) * r * 0.97, r * 0.022, 0, Math.PI * 2);
    g.fillStyle = '#fff4c2';
    g.fill();
  }
  const hub = g.createRadialGradient(c - r * 0.05, c - r * 0.05, 2, c, c, r * 0.22);
  hub.addColorStop(0, '#fff4c2');
  hub.addColorStop(1, '#b8860b');
  g.beginPath();
  g.arc(c, c, r * 0.2, 0, Math.PI * 2);
  g.fillStyle = hub;
  g.fill();
  g.save();
  g.translate(c, c);
  cherryPair(g, r * 0.34);
  g.restore();
}

interface WheelParts {
  geo: THREE.CircleGeometry;
  mat: THREE.MeshStandardMaterial;
}
const wheelCache = new Map<number, WheelParts>();

function wheelParts(scale: number): WheelParts {
  const hit = wheelCache.get(scale);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  paintWheel(canvas, scale < 1 ? 256 : 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const parts = {
    geo: new THREE.CircleGeometry(WHEEL_RADIUS, 64),
    mat: new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.45, roughness: 0.45, metalness: 0.05, transparent: true }),
  };
  wheelCache.set(scale, parts);
  if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
    void document.fonts.ready.then(() => {
      paintWheel(canvas, canvas.width);
      tex.needsUpdate = true;
    });
  }
  return parts;
}

/** Where the wheel sits: on the top box face, a little proud of the glass. */
function wheelMatrix(l: SkinLayout): THREE.Matrix4 {
  return payMatrix(l, l.bevel + 0.02);
}

// ---------------------------------------------------------------------------------------------
// the cabinet

const LOOK = { width: 0.104, radius: 0.8, stopAngle: 0.086 / 0.8, arcHalf: 0.19, curve: 0.55 };

const LAYOUT: SkinLayout = {
  width: 0.74,
  profile: [
    [-0.32, 0], [0.26, 0], [0.26, 0.05], [0.235, 0.075], [0.25, 0.1], [0.25, 0.64], [0.4, 0.73], [0.43, 0.76],
    [0.43, 0.785], [0.28, 0.845], [0.27, 0.87], [0.27, 1.47], [0.285, 1.495], [0.285, 1.52], [0.22, 1.9], [0.19, 1.925], [-0.32, 1.925],
  ],
  bevel: 0.01,
  body: { color: '#a3101c', metalness: 0.25, roughness: 0.22 },
  trim: { color: '#efe1c0', metalness: 0.3, roughness: 0.35 },
  plate: { w: 0.7, h: 0.54, cy: 1.17, zBack: 0.27, depth: 0.062 },
  window: { w: 0.66, h: 0.258, cy: 1.2 },
  // pitch matches the overlay's five columns between its 64 px marker strips
  reels: { count: 5, pitch: (0.66 * (1 - 128 / 1024)) / 5, look: LOOK, zFront: 0.322, rows: 3 },
  meters: { w: 0.62, h: 0.075, cy: 0.985 },
  pay: { bottom: [0.285, 1.52], top: [0.22, 1.9], w: 0.66, h: 0.36 },
  belly: { w: 0.62, h: 0.5, cy: 0.37, z: 0.25 },
  deck: { front: [0.43, 0.785], back: [0.28, 0.845], xs: [-0.24, -0.08, 0.08, 0.24], bw: 0.12, bh: 0.055 },
  top: 1.925,
  candle: [0.3, 1.925, -0.22],
  lever: false,
};

function topper(l: SkinLayout): TopperParts {
  // a marquee box with the name, on top
  const s = new THREE.Shape();
  roundedRect(s, -l.width / 2 + 0.02, 0, l.width - 0.04, 0.22, 0.05);
  const body = [slab(s, 0.12, 0.008, -0.02).applyMatrix4(at(0, l.top, 0))];
  const printed = [panel(l.width - 0.1, 0.17, { x: 0, y: 640, w: 1024, h: 384 }, at(0, l.top + 0.11, 0.1 + 0.002))];
  // the pointer over the wheel and the wheel's hub cap, chrome
  const wm = wheelMatrix(l);
  const pointer = new THREE.Shape();
  pointer.moveTo(-0.022, WHEEL_RADIUS + 0.02);
  pointer.lineTo(0.022, WHEEL_RADIUS + 0.02);
  pointer.lineTo(0, WHEEL_RADIUS - 0.03);
  pointer.closePath();
  const trim = [
    slab(pointer, 0.014, 0.002, 0.004).applyMatrix4(wm),
    cyl(0.02, 0.01, new THREE.Matrix4().multiplyMatrices(wm, at(0, 0, 0.008, Math.PI / 2))),
    box(l.width - 0.02, 0.012, 0.13, at(0, l.top + 0.006, 0.04)),
  ];
  // bulbs round the wheel, warm white and red, and along the marquee's lower edge
  const spots: THREE.Vector3[] = [];
  const colors: THREE.Color[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    spots.push(new THREE.Vector3(Math.cos(a) * (WHEEL_RADIUS + 0.022), Math.sin(a) * (WHEEL_RADIUS + 0.022), 0.006).applyMatrix4(wm));
    colors.push(new THREE.Color(i % 2 ? '#ff5a4f' : '#fff1c9'));
  }
  for (let i = 0; i < 16; i++) {
    const x = -l.width / 2 + 0.06 + (i / 15) * (l.width - 0.12);
    spots.push(new THREE.Vector3(x, l.top + 0.016, 0.105));
    colors.push(new THREE.Color(i % 2 ? '#ff5a4f' : '#fff1c9'));
  }
  return { body, trim, printed, bulbs: { spots, colors, radius: 0.0085 } };
}

const LINE_COLORS = ['#d11a2a', '#1f6fd1', '#1f8a3a', '#d98a0b', '#8a2be2', '#e0457b', '#0f8b8d', '#b35c00', '#5b3fd1', '#c2185b'];

export const CHERRIES_OVERLAY: OverlaySpec = {
  rows: 3,
  lineRows: CHERRIES.lineRows,
  height: 404,
  side: 64,
  markers: true,
  colors: LINE_COLORS,
  ground: '#5e0710',
  ink: CREAM,
  ringColor: '#f2a900',
};

export const CHERRIES_SKIN: Skin = {
  id: 'cherries',
  layout: LAYOUT,
  meter: { ground: '#2a0509', label: '#ffd9a0', digit: '#ffb347', frame: 'rgba(255,217,160,0.45)', labels: ['CREDIT', 'TOTAL BET', 'WIN'] },
  cell: { w: 152, h: 112 },
  symbolScale: 0.9,
  stripGround: CHERRY_SCREEN,
  tint: '#ffffff',
  buttons: { pays: ['#fbf1dc', '#5e0710'], betOne: ['#f2c14a', '#3a1a04'], maxBet: ['#d62a36', '#fff1e6'], spin: ['#3bb56a', '#08210f'] },
  drawSymbol: drawFruit,
  paintPay: backdrop,
  paintBelly: belly,
  paintTopper: marquee,
  topper,
};

registerSkin({
  skin: CHERRIES_SKIN,
  sets: [{ strips: CHERRIES.strips }],
  idle: [2, 9, 21, 5, 13],
  overlay: CHERRIES_OVERLAY,
  extras: {
    add(root, l, scale) {
      const p = wheelParts(scale);
      const mount = new THREE.Group();
      mount.matrixAutoUpdate = false;
      mount.matrix.copy(wheelMatrix(l));
      const wheel = new THREE.Mesh(p.geo, p.mat);
      wheel.name = 'cherry-wheel';
      mount.add(wheel);
      root.add(mount);
      return { wheel };
    },
  },
});
