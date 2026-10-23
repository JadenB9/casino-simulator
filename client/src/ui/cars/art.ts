// The valet's pictures: every car side on, drawn from the same shape data the 3D models are built
// from (world/cars/specs.ts): the body's top line from tail to nose, closed along the sills and
// round the wheel arches; the glasshouse with its painted pillars, or an open car's windscreen and
// seats; the wheels in their own rim style; and the extras (a wing, fins, roof lamps, a teak deck,
// neon underneath, a light bar). Facing right, on a 200 x 100 design box, in the car's own paint:
// a car keeps its colours in both themes.

import { CAR_SPECS, type CarSpec } from '../../world/cars/specs.ts';
import { rrect, shade } from '../shop/art.ts';

const TAU = Math.PI * 2;
type G = CanvasRenderingContext2D;

/** How far the arch is cut round the tyre. */
const ARCH = 1.14;
const CHROME = '#d4d9df';

function extent(s: CarSpec): { z0: number; z1: number; top: number } {
  const zs = s.body.map((p) => p[0]);
  const ys = [...s.body.map((p) => p[1]), ...(s.cabin ?? []).map((p) => p[1]), s.open ? s.open.screenY + s.open.screenH : 0, s.wing?.y ?? 0];
  return { z0: Math.min(...zs), z1: Math.max(...zs), top: Math.max(...ys) };
}

/** The body: the top line, down the nose to the sill, along it under the arches, up the tail. */
function bodyPath(g: G, s: CarSpec): void {
  const first = s.body[0]!;
  const last = s.body.at(-1)!;
  g.beginPath();
  g.moveTo(first[0], first[1]);
  for (const [z, y] of s.body) g.lineTo(z, y);
  const sill = Math.min(s.sill, last[1], first[1]);
  g.lineTo(last[0], sill);
  for (const axle of [s.front, s.rear]) {
    const ra = s.wheelR * ARCH;
    const dy = sill - s.wheelR;
    if (Math.abs(dy) >= ra) continue;
    const dx = Math.sqrt(ra * ra - dy * dy);
    const a = Math.atan2(dy, dx);
    g.lineTo(axle + dx, sill);
    // over the top of the wheel (y is up here, so the angle grows anticlockwise on screen)
    g.arc(axle, s.wheelR, ra, a, Math.PI - a, false);
    g.lineTo(axle - dx, sill);
  }
  g.lineTo(first[0], sill);
  g.closePath();
}

function paintFill(g: G, s: CarSpec, top: number): CanvasGradient {
  const gr = g.createLinearGradient(0, top, 0, s.sill);
  if (s.gold) {
    gr.addColorStop(0, '#fff2c4');
    gr.addColorStop(0.35, '#e6b54c');
    gr.addColorStop(0.7, '#b07d22');
    gr.addColorStop(1, '#6e4a10');
    return gr;
  }
  gr.addColorStop(0, shade(s.paint, 0.34));
  gr.addColorStop(0.4, s.paint);
  gr.addColorStop(1, shade(s.paint, -0.45));
  return gr;
}

function wheel(g: G, s: CarSpec, axle: number): void {
  const r = s.wheelR;
  const y = r;
  g.fillStyle = '#111113';
  g.beginPath();
  g.arc(axle, y, r, 0, TAU);
  g.fill();
  if (s.whitewall) {
    g.strokeStyle = '#efece4';
    g.lineWidth = r * 0.16;
    g.beginPath();
    g.arc(axle, y, r * 0.74, 0, TAU);
    g.stroke();
  }
  const rim = s.gold ? '#e0b84a' : (s.rimColor ?? '#d4d9df');
  const ri = r * 0.62;
  const gr = g.createRadialGradient(axle - ri * 0.3, y + ri * 0.3, ri * 0.1, axle, y, ri);
  gr.addColorStop(0, shade(rim, 0.4));
  gr.addColorStop(1, shade(rim, -0.3));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(axle, y, ri, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = r * 0.05;
  const spokes = (n: number, inner: number, curve = 0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.beginPath();
      g.moveTo(axle + Math.cos(a) * ri * inner, y + Math.sin(a) * ri * inner);
      if (curve) g.quadraticCurveTo(axle + Math.cos(a + curve) * ri * 0.7, y + Math.sin(a + curve) * ri * 0.7, axle + Math.cos(a + curve * 1.6) * ri * 0.95, y + Math.sin(a + curve * 1.6) * ri * 0.95);
      else g.lineTo(axle + Math.cos(a) * ri * 0.95, y + Math.sin(a) * ri * 0.95);
      g.stroke();
    }
  };
  switch (s.rim) {
    case 'wire':
      g.lineWidth = r * 0.02;
      spokes(24, 0.18);
      break;
    case 'five':
      g.lineWidth = r * 0.12;
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.6;
        g.beginPath();
        g.moveTo(axle + Math.cos(a) * ri * 0.3, y + Math.sin(a) * ri * 0.3);
        g.lineTo(axle + Math.cos(a) * ri * 0.92, y + Math.sin(a) * ri * 0.92);
        g.stroke();
      }
      break;
    case 'dish':
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = r * 0.05;
      g.beginPath();
      g.arc(axle, y, ri * 0.7, 0, TAU);
      g.stroke();
      break;
    case 'mesh':
      g.lineWidth = r * 0.025;
      spokes(16, 0.25, 0.35);
      spokes(16, 0.25, -0.35);
      break;
    case 'turbine':
      g.lineWidth = r * 0.06;
      spokes(10, 0.2, 0.5);
      break;
  }
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.arc(axle, y, ri * 0.16, 0, TAU);
  g.fill();
}

function glass(g: G, top: number, bottom: number): CanvasGradient {
  const gr = g.createLinearGradient(0, top, 0, bottom);
  gr.addColorStop(0, '#9fb3c4');
  gr.addColorStop(0.35, '#2a3542');
  gr.addColorStop(1, '#0d1218');
  return gr;
}

/** The glasshouse: glass, its roof and pillars painted, the pillar behind the last window too. */
function cabin(g: G, s: CarSpec, fill: CanvasGradient): void {
  const c = s.cabin!;
  const ys = c.map((p) => p[1]);
  const top = Math.max(...ys);
  const base = Math.min(...ys);
  g.beginPath();
  c.forEach(([z, y], i) => (i ? g.lineTo(z, y) : g.moveTo(z, y)));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.save();
  g.clip();
  // the windows: the glasshouse less its roof, inset from the pillars
  g.fillStyle = glass(g, top, base);
  g.beginPath();
  const z0 = Math.min(...c.map((p) => p[0]));
  const z1 = Math.max(...c.map((p) => p[0]));
  g.rect(z0 + 0.06, base, z1 - z0 - 0.12, top - base - 0.07);
  g.fill();
  // what's painted: behind the sail, and each extra pillar
  g.fillStyle = fill;
  if (s.sail !== undefined) g.fillRect(z0 - 0.1, base - 0.1, s.sail - z0 + 0.1, top - base + 0.2);
  for (const z of s.pillars ?? []) g.fillRect(z - 0.05, base - 0.1, 0.1, top - base + 0.2);
  // a streak of sky across the glass
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.beginPath();
  g.moveTo(z0 + (z1 - z0) * 0.45, top);
  g.lineTo(z0 + (z1 - z0) * 0.6, top);
  g.lineTo(z0 + (z1 - z0) * 0.4, base);
  g.lineTo(z0 + (z1 - z0) * 0.25, base);
  g.fill();
  g.restore();
}

/** An open car: the windscreen raked back, the seats' backs, the interior's colour in the cockpit. */
function open(g: G, s: CarSpec): void {
  const o = s.open!;
  const [c0, c1] = o.cockpit;
  const rim = Math.max(...s.body.filter((p) => p[0] >= c0 && p[0] <= c1).map((p) => p[1]), s.sill + 0.4);
  g.fillStyle = shade(s.interior, -0.2);
  for (let i = 0; i < Math.min(2, o.seats / 2 || 1); i++) {
    const z = c0 + (c1 - c0) * (0.25 + i * 0.4);
    rrect(g, z - 0.12, rim - 0.02, 0.24, 0.22, 0.08);
    g.fill();
  }
  g.strokeStyle = 'rgba(200,220,235,0.85)';
  g.lineWidth = 0.035;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(o.screenZ, o.screenY);
  g.lineTo(o.screenZ - o.screenH * o.rake, o.screenY + o.screenH);
  g.stroke();
}

function extras(g: G, s: CarSpec, fill: CanvasGradient): void {
  const nose = s.body.at(-1)![0];
  const tail = s.body[0]![0];
  if (s.stripes) {
    g.save();
    bodyPath(g, s);
    g.clip();
    g.fillStyle = s.stripes;
    const mid = (s.sill + Math.max(...s.body.map((p) => p[1]))) / 2;
    g.fillRect(tail - 1, mid - 0.045, nose - tail + 2, 0.09);
    g.restore();
  }
  if (s.deck) {
    g.save();
    bodyPath(g, s);
    g.clip();
    g.fillStyle = '#8a5a2b';
    g.fillRect(s.deck[0], Math.max(...s.body.map((p) => p[1])) - 0.08, s.deck[1] - s.deck[0], 0.12);
    g.restore();
  }
  if (s.intakes) {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    rrect(g, s.rear + s.wheelR * 1.3, s.sill + 0.12, 0.5, 0.14, 0.05);
    g.fill();
  }
  if (s.fins) {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(tail + 0.05, s.body[1]![1] - 0.02);
    g.lineTo(tail + 0.15, s.body[1]![1] + 0.16);
    g.lineTo(tail + 0.75, s.body[1]![1]);
    g.fill();
  }
  if (s.fin && s.cabin) {
    g.fillStyle = shade(s.paint, -0.35);
    const back = Math.min(...s.cabin.map((p) => p[0]));
    g.beginPath();
    g.moveTo(back, Math.max(...s.cabin.map((p) => p[1])) - 0.05);
    g.lineTo(tail + 0.3, Math.max(...s.body.map((p) => p[1])) + 0.04);
    g.lineTo(back + 0.3, Math.max(...s.body.map((p) => p[1])));
    g.fill();
  }
  if (s.wing) {
    g.fillStyle = '#151518';
    g.fillRect(s.wing.z - 0.28, s.wing.y - 0.03, 0.56, 0.06);
    g.fillRect(s.wing.z - 0.04, s.wing.y - 0.3, 0.08, 0.3);
  }
  if (s.roofLamps && s.cabin) {
    const roof = Math.max(...s.cabin.map((p) => p[1]));
    const zs = s.cabin.filter((p) => p[1] > roof - 0.05).map((p) => p[0]);
    const mid = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (let i = -1.5; i <= 1.5; i++) {
      g.fillStyle = '#ffe9a6';
      g.beginPath();
      g.arc(mid + i * 0.18, roof + 0.07, 0.06, 0, TAU);
      g.fill();
    }
  }
  if (s.roofRails && s.cabin) {
    const roof = Math.max(...s.cabin.map((p) => p[1]));
    const zs = s.cabin.filter((p) => p[1] > roof - 0.05).map((p) => p[0]);
    g.fillStyle = '#2b2d31';
    g.fillRect(Math.min(...zs) + 0.1, roof, Math.max(...zs) - Math.min(...zs) - 0.2, 0.05);
  }
  // the lamps: white at the nose, red at the tail, a light bar where there is one
  g.fillStyle = s.lightbar ?? '#fff6dc';
  rrect(g, nose - 0.1, s.lampY - 0.04, 0.12, s.lightbar ? 0.05 : 0.09, 0.03);
  g.fill();
  g.fillStyle = '#d61f2a';
  rrect(g, tail - 0.02, s.tailY - 0.05, 0.1, 0.09, 0.03);
  g.fill();
  if (s.chrome) {
    g.fillStyle = CHROME;
    rrect(g, nose - 0.16, s.sill + 0.02, 0.2, 0.06, 0.03);
    g.fill();
    rrect(g, tail - 0.04, s.sill + 0.02, 0.2, 0.06, 0.03);
    g.fill();
  }
  // a line of light along the shoulder
  g.strokeStyle = s.gold ? 'rgba(255,248,220,0.6)' : 'rgba(255,255,255,0.22)';
  g.lineWidth = 0.025;
  g.beginPath();
  s.body.slice(1, -1).forEach(([z, y], i) => (i ? g.lineTo(z, y - 0.05) : g.moveTo(z, y - 0.05)));
  g.stroke();
}

function draw(g: G, id: string, w: number, h: number): void {
  const s = CAR_SPECS[id];
  if (!s) return;
  const e = extent(s);
  const len = e.z1 - e.z0;
  // a little air round it, the ground two thirds of the way down a short car's box
  const k = Math.min((w * 0.9) / len, (h * 0.78) / Math.max(1.4, e.top + 0.1));
  const ground = h * 0.86;
  g.save();
  // the shadow on the ground, and a car's neon under it
  if (s.underglow) {
    const gr = g.createRadialGradient(w / 2, ground, 0, w / 2, ground, len * k * 0.55);
    gr.addColorStop(0, s.underglow);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.translate(0, ground);
    g.scale(1, 0.18);
    g.translate(0, -ground);
    g.fillStyle = gr;
    g.globalAlpha = 0.75;
    g.beginPath();
    g.arc(w / 2, ground, len * k * 0.55, 0, TAU);
    g.fill();
    g.restore();
  }
  g.save();
  g.translate(w / 2, ground);
  g.scale(1, 0.09);
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, len * k * 0.56);
  sh.addColorStop(0, 'rgba(0,0,0,0.42)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.beginPath();
  g.arc(0, 0, len * k * 0.56, 0, TAU);
  g.fill();
  g.restore();
  // car space: metres, y up, the middle of its length at the box's middle
  g.translate(w / 2 - ((e.z0 + e.z1) / 2) * k, ground);
  g.scale(k, -k);
  const fill = paintFill(g, s, e.top);
  if (s.cabin) cabin(g, s, fill);
  bodyPath(g, s);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.02;
  g.stroke();
  if (s.open) open(g, s);
  extras(g, s, fill);
  wheel(g, s, s.front);
  wheel(g, s, s.rear);
  g.restore();
}

function ratio(): number {
  return Math.min(2, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
}

/** A car side on, `w` x `h` CSS pixels (the CSS size comes from `cls`). */
export function carPicture(id: string, w = 200, h = 90, cls = 'vl-art'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = cls;
  c.setAttribute('aria-hidden', 'true');
  const k = ratio();
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = c.getContext('2d');
  if (g) {
    g.scale(k, k);
    draw(g, id, w, h);
  }
  return c;
}
