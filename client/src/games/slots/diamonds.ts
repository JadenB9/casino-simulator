// Diamond Line's look: a sapphire cabinet with chrome trim and ice-blue edge light, a cut-gem
// topper ringed with bulbs, cool white reel strips with a faceted diamond, blue sevens and
// navy-and-chrome bars. The pay glass is generated from the machine's own pay table.

import * as THREE from 'three';
import { DIAMONDS } from '../../../../shared/src/games/slots/diamonds.ts';
import { at, box, merge, slab, uvFromBounds } from './cabinet.ts';
import { drawStepperSymbol } from './symbols.ts';
import { registerSkin } from './build.ts';
import { disclaimers, rays, roundRect, text, type Skin, type SkinLayout, type TopperParts } from './skin.ts';

type G = CanvasRenderingContext2D;

const NAVY = '#0a1a3e';
const SAPPHIRE = '#1b4fb8';
const ICE = '#dff1ff';
const CHROME = '#cfd9e6';
export const DIAMOND_STRIP = '#f3f7fc';

// ---------------------------------------------------------------------------------------------
// symbols, drawn centred on (0, 0) in a box w x h

/** A brilliant-cut diamond: table, crown and pavilion facets in icy blues, a navy outline, a glint. */
export function drawDiamond(g: G, w: number, h: number): void {
  const s = Math.min(w / 1.05, h / 0.86);
  g.save();
  g.scale(s, s);
  const girdle = -0.1, tableY = -0.32, culet = 0.44;
  const facets: [number, number][][] = [
    [[-0.48, girdle], [-0.3, tableY], [-0.12, tableY], [-0.22, girdle]],
    [[-0.12, tableY], [0.12, tableY], [0.22, girdle], [-0.22, girdle]],
    [[0.12, tableY], [0.3, tableY], [0.48, girdle], [0.22, girdle]],
    [[-0.48, girdle], [-0.22, girdle], [0, culet]],
    [[-0.22, girdle], [0.22, girdle], [0, culet]],
    [[0.22, girdle], [0.48, girdle], [0, culet]],
  ];
  const fills = ['#bfe4ff', '#eef8ff', '#8cc8f5', '#5aa2e6', '#a9dcff', '#2f73c9'];
  facets.forEach((f, i) => {
    g.beginPath();
    f.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = fills[i]!;
    g.fill();
  });
  // outline and facet edges
  g.lineJoin = 'round';
  g.strokeStyle = NAVY;
  g.lineWidth = 0.035;
  g.beginPath();
  g.moveTo(-0.3, tableY);
  g.lineTo(0.3, tableY);
  g.lineTo(0.48, girdle);
  g.lineTo(0, culet);
  g.lineTo(-0.48, girdle);
  g.closePath();
  g.stroke();
  g.lineWidth = 0.014;
  g.strokeStyle = 'rgba(10,26,62,0.7)';
  g.beginPath();
  g.moveTo(-0.48, girdle);
  g.lineTo(0.48, girdle);
  for (const x of [-0.12, 0.12]) {
    g.moveTo(x, tableY);
    g.lineTo(x < 0 ? -0.22 : 0.22, girdle);
    g.lineTo(0, culet);
  }
  g.stroke();
  // glint
  g.fillStyle = '#ffffff';
  g.beginPath();
  const [gx, gy, r] = [-0.2, -0.22, 0.09];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? r * 0.22 : r;
    g.lineTo(gx + Math.cos(a) * rr, gy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  g.restore();
}

/** A sapphire seven with a chrome outline and a white pinstripe. */
function blueSeven(g: G, w: number, h: number): void {
  const s = Math.min(w / 0.8, h);
  g.save();
  g.scale(s, s);
  const path = () => {
    g.beginPath();
    g.moveTo(-0.34, -0.46);
    g.lineTo(0.38, -0.46);
    g.lineTo(0.38, -0.31);
    g.bezierCurveTo(0.14, -0.06, 0.04, 0.2, 0.02, 0.47);
    g.lineTo(-0.24, 0.47);
    g.bezierCurveTo(-0.2, 0.18, -0.04, -0.08, 0.13, -0.28);
    g.lineTo(-0.34, -0.28);
    g.closePath();
  };
  path();
  g.lineJoin = 'round';
  g.lineWidth = 0.1;
  g.strokeStyle = '#a9b8cc';
  g.stroke();
  g.lineWidth = 0.05;
  g.strokeStyle = NAVY;
  g.stroke();
  const grad = g.createLinearGradient(0, -0.46, 0, 0.47);
  grad.addColorStop(0, '#3d7cf0');
  grad.addColorStop(1, '#123f9c');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.translate(-0.01, -0.01);
  g.scale(0.88, 0.88);
  path();
  g.lineWidth = 0.022;
  g.strokeStyle = 'rgba(240,248,255,0.9)';
  g.stroke();
  g.restore();
  g.restore();
}

/** Navy bar plates with chrome rims and silver lettering. */
function bars(g: G, w: number, h: number, n: 1 | 2 | 3): void {
  const pw = Math.min(w * 0.92, h * 1.5);
  const ph = Math.min(h / (n + (n - 1) * 0.22), pw * 0.3);
  const gap = ph * 0.22;
  const total = n * ph + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const y = -total / 2 + i * (ph + gap);
    roundRect(g, -pw / 2, y, pw, ph, ph * 0.3);
    const grad = g.createLinearGradient(0, y, 0, y + ph);
    grad.addColorStop(0, '#e9eef5');
    grad.addColorStop(0.5, '#9fb0c6');
    grad.addColorStop(1, '#e2e8f0');
    g.fillStyle = grad;
    g.fill();
    roundRect(g, -pw / 2 + ph * 0.1, y + ph * 0.1, pw - ph * 0.2, ph * 0.8, ph * 0.22);
    g.fillStyle = NAVY;
    g.fill();
    text(g, 'BAR', 0, y + ph * 0.54, `600 ${ph * 0.74}px 'Barlow Condensed', sans-serif`, ICE);
  }
}

export function drawDiamondsSymbol(g: G, sym: string, w: number, h: number): void {
  switch (sym) {
    case 'DI':
      drawDiamond(g, w, h);
      break;
    case '7':
      blueSeven(g, w, h);
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
      drawStepperSymbol(g, 'CH', w, h);
      break;
    case 'BAR':
      text(g, 'ANY', 0, -h * 0.2, `600 ${h * 0.34}px 'Barlow Condensed', sans-serif`, NAVY);
      text(g, 'BAR', 0, h * 0.2, `600 ${h * 0.34}px 'Barlow Condensed', sans-serif`, NAVY);
      break;
    case 'ANY':
    case 'BLANK':
      text(g, sym, 0, 1, `600 ${h * 0.36}px 'Barlow Condensed', sans-serif`, '#5d6f89');
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// printed glass

/** Where the 1/2/3 COINS columns sit on the pay glass (x centres in region pixels). */
export const DIAMOND_COLUMNS = [668, 792, 916];

const GLASS_CELLS: Record<string, string[]> = {
  threeDI: ['DI', 'DI', 'DI'], three7: ['7', '7', '7'], three3B: ['3B', '3B', '3B'], three2B: ['2B', '2B', '2B'], three1B: ['1B', '1B', '1B'],
  anyBar: ['BAR', 'BAR', 'BAR'], threeCH: ['CH', 'CH', 'CH'], twoCH: ['CH', 'CH', 'ANY'], oneCH: ['CH', 'ANY', 'ANY'],
};

function doubleBorder(g: G, w: number, h: number): void {
  g.strokeStyle = CHROME;
  g.lineWidth = 5;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.lineWidth = 1.5;
  g.strokeStyle = '#6f93c9';
  g.strokeRect(23, 23, w - 46, h - 46);
}

function payGlass(g: G, w: number, h: number): void {
  g.fillStyle = NAVY;
  g.fillRect(0, 0, w, h);
  rays(g, w * 0.28, h * 0.5, 40, w, 'rgba(120,170,255,0.05)');
  doubleBorder(g, w, h);
  ['1 COIN', '2 COINS', '3 COINS'].forEach((s, i) => text(g, s, DIAMOND_COLUMNS[i]!, 50, `600 22px Cinzel, serif`, '#a9c8f5'));
  const top = 72, rowH = 52;
  DIAMONDS.pays.forEach((p, i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(34, y, w - 68, rowH);
    }
    GLASS_CELLS[p.combo]!.forEach((c, k) => {
      const cx = 92 + k * 132, cy = y + rowH / 2;
      roundRect(g, cx - 58, cy - rowH * 0.42, 116, rowH * 0.84, 6);
      g.fillStyle = DIAMOND_STRIP;
      g.fill();
      g.save();
      g.translate(cx, cy);
      drawDiamondsSymbol(g, c, 104, rowH * 0.78);
      g.restore();
    });
    DIAMOND_COLUMNS.forEach((x, k) => text(g, (p.pay * (k + 1)).toLocaleString('en-US'), x, y + rowH / 2 + 2, `600 ${rowH * 0.6}px 'Barlow Condensed', sans-serif`, p.combo === 'threeDI' ? '#ffffff' : ICE));
  });
  const foot = top + DIAMONDS.pays.length * rowH + 16;
  text(g, 'DIAMOND IS WILD FOR EVERY SYMBOL  ·  ONE DIAMOND PAYS DOUBLE  ·  TWO PAY FOUR TIMES', w / 2, foot + 4, `600 19px 'Barlow Condensed', sans-serif`, '#9fd0ff');
  text(g, 'CHERRIES PAY ANYWHERE ON THE LINE  ·  ONLY THE HIGHEST WIN IS PAID', w / 2, foot + 30, `600 17px 'Barlow Condensed', sans-serif`, '#c9d6ea');
}

function sparkles(g: G, w: number, h: number, n: number, seed: number): void {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgba(223,241,255,0.8)';
  for (let i = 0; i < n; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = 3 + rnd() * 7;
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const rr = k % 2 ? r * 0.2 : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  }
}

function belly(g: G, w: number, h: number): void {
  const grad = g.createRadialGradient(w / 2, h * 0.42, 20, w / 2, h * 0.42, w * 0.7);
  grad.addColorStop(0, '#2a62d1');
  grad.addColorStop(1, '#081536');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  rays(g, w / 2, h * 0.42, 48, w, 'rgba(200,230,255,0.06)');
  sparkles(g, w, h * 0.7, 26, 11);
  doubleBorder(g, w, h);
  g.save();
  g.translate(w / 2, h * 0.4);
  drawDiamond(g, 420, 330);
  g.restore();
  text(g, 'DIAMOND LINE', w / 2, h * 0.8, `64px Limelight, serif`, ICE, { stroke: NAVY, strokeWidth: 10 });
  disclaimers(g, w, h - 44, '#c9d6ea', 18);
}

/** The gem topper's face: the outline in region pixels matches the gem shape's bounds. */
export const GEM_FACE = { x: 0, y: 640, w: 700, h: 384 };

function topperFace(g: G, w: number, h: number): void {
  // the gem face is painted into the left 700 px of the topper region
  const fw = GEM_FACE.w;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2f6ee0');
  grad.addColorStop(1, '#0b2361');
  g.fillStyle = grad;
  g.fillRect(0, 0, fw, h);
  // facet lines radiating from the culet
  g.strokeStyle = 'rgba(223,241,255,0.22)';
  g.lineWidth = 3;
  for (let i = 0; i <= 10; i++) {
    g.beginPath();
    g.moveTo(fw / 2, h);
    g.lineTo((i / 10) * fw, 0);
    g.stroke();
  }
  g.strokeStyle = 'rgba(223,241,255,0.35)';
  g.beginPath();
  g.moveTo(0, h * 0.36);
  g.lineTo(fw, h * 0.36);
  g.stroke();
  sparkles(g, fw, h * 0.6, 14, 5);
  text(g, 'DIAMOND', fw / 2, h * 0.2, `600 58px Cinzel, serif`, '#ffffff', { stroke: NAVY, strokeWidth: 8 });
  text(g, 'LINE', fw / 2, h * 0.5, `64px Limelight, serif`, ICE, { stroke: NAVY, strokeWidth: 8 });
}

// ---------------------------------------------------------------------------------------------
// the cabinet

const LOOK = { width: 0.155, radius: 0.19, stopAngle: (Math.PI * 2) / 22, arcHalf: 0.75, curve: 1.5 };

const LAYOUT: SkinLayout = {
  width: 0.66,
  profile: [
    [-0.3, 0], [0.24, 0], [0.24, 0.05], [0.215, 0.075], [0.232, 0.1], [0.232, 0.7], [0.37, 0.765], [0.395, 0.79],
    [0.395, 0.81], [0.255, 0.875], [0.25, 0.9], [0.25, 1.4], [0.268, 1.425], [0.268, 1.445], [0.215, 1.86], [0.19, 1.885], [-0.3, 1.885],
  ],
  bevel: 0.008,
  body: { color: '#173a86', metalness: 0.6, roughness: 0.26 },
  trim: { color: '#e3e9f1', metalness: 1, roughness: 0.14 },
  plate: { w: 0.6, h: 0.45, cy: 1.15, zBack: 0.25, depth: 0.07 },
  window: { w: 0.51, h: 0.215, cy: 1.17 },
  reels: { count: 3, pitch: 0.168, look: LOOK, zFront: 0.312, rows: 1 },
  meters: { w: 0.54, h: 0.072, cy: 0.99 },
  pay: { bottom: [0.268, 1.445], top: [0.215, 1.86], w: 0.6, h: 0.39 },
  belly: { w: 0.56, h: 0.54, cy: 0.4, z: 0.232 },
  deck: { front: [0.395, 0.81], back: [0.255, 0.875], xs: [-0.22, -0.075, 0.075, 0.22], bw: 0.11, bh: 0.052 },
  top: 1.885,
  candle: [-0.25, 1.885, -0.2],
  lever: true,
};

/** The gem's outline, in metres from the top of the cabinet: table, crown, pavilion. */
function gemShape(scale = 1, lift = 0.06): THREE.Shape {
  const pts: [number, number][] = [[-0.21, 0.36], [0.21, 0.36], [0.31, 0.24], [0, 0], [-0.31, 0.24]];
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x * scale, lift + y * scale) : s.moveTo(x * scale, lift + y * scale)));
  s.closePath();
  return s;
}

function topper(l: SkinLayout): TopperParts {
  const z0 = -0.02;
  const body = [
    slab(gemShape(), 0.1, 0.008, z0).applyMatrix4(at(0, l.top, 0)),
    // the gem stands on a short plinth
    box(0.16, 0.07, 0.12, at(0, l.top + 0.035, z0 + 0.05)),
  ];
  const trim = [box(0.2, 0.014, 0.14, at(0, l.top + 0.072, z0 + 0.05))];
  const face = new THREE.ShapeGeometry(gemShape(0.9, 0.06 + 0.018), 1).toNonIndexed();
  uvFromBounds(face, GEM_FACE);
  const printed = [face.applyMatrix4(at(0, l.top, z0 + 0.1 + 0.002))];
  // bulbs along the gem's edge, ice white and blue in turn
  const edge = gemShape(1.04, 0.06 - 0.008);
  const spots = edge.getSpacedPoints(30).slice(0, -1).map((p) => new THREE.Vector3(p.x, l.top + p.y, z0 + 0.1 + 0.012));
  const colors = spots.map((_, i) => new THREE.Color(i % 2 ? '#8fc2ff' : '#f2f8ff'));
  // ice-blue edge light down both front corners of the cabinet
  const strip = (x: number, y0: number, y1: number, z: number) => {
    const g = box(0.01, y1 - y0, 0.01, at(x, (y0 + y1) / 2, z));
    const c = new THREE.Color('#7fc4ff');
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
    return g;
  };
  const e = l.width / 2 + 0.002;
  const leds = merge([strip(-e, 0.14, 0.7, 0.236), strip(e, 0.14, 0.7, 0.236), strip(-e, 0.9, 1.4, 0.254), strip(e, 0.9, 1.4, 0.254)]);
  return { body, trim, printed, bulbs: { spots, colors, radius: 0.011 }, leds };
}

export const DIAMONDS_SKIN: Skin = {
  id: 'diamonds',
  layout: LAYOUT,
  meter: { ground: '#081230', label: '#a9c8f5', digit: '#63c6ff', frame: 'rgba(169,200,245,0.45)', labels: ['CREDIT', 'BET', 'WINNER PAID'] },
  cell: { w: 236, h: 88 },
  symbolScale: 1.55,
  stripGround: DIAMOND_STRIP,
  tint: '#f4f8ff',
  buttons: { pays: ['#dfe6ee', '#132447'], betOne: ['#6fb3ff', '#071a3a'], maxBet: ['#2459c9', '#f2f7ff'], spin: ['#3bb56a', '#08210f'] },
  drawSymbol: drawDiamondsSymbol,
  paintPay: payGlass,
  paintBelly: belly,
  paintTopper: (g, w, h) => topperFace(g, w, h),
  topper,
};

registerSkin({
  skin: DIAMONDS_SKIN,
  sets: [{ strips: DIAMONDS.reels.map((r) => r.map(([s]) => s)), skip: 'BL' }],
  idle: [5, 13, 19],
});

