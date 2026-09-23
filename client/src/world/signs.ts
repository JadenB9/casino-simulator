// Signs: neon script, lit box signs and overhead wayfinding. Every face is drawn once into one
// canvas atlas (Tilt Neon, Limelight and Cinzel from the site's fonts) and all faces share one
// additive material pushed past 1.0, so the whole floor's signage is one draw call that blooms.

import * as THREE from 'three';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { CEILING, type FloorPlan } from './layout.ts';

export type Arrow = 'left' | 'right' | 'up' | 'down';

export interface SignSpec {
  /** neon: glowing tubes on nothing; lit: bright letters on a dark face; way: wayfinding panel. */
  kind: 'neon' | 'lit' | 'way';
  text: string;
  sub?: string;
  /** Wayfinding segments, left to right. */
  segments?: { text: string; arrow: Arrow; before?: boolean }[];
  color: string;
  font: 'Tilt Neon' | 'Limelight' | 'Cinzel';
  at: [number, number, number];
  ry: number;
  w: number;
  h: number;
}

const FONTS = ['Tilt Neon', 'Limelight', 'Cinzel'];

/** Wait for the sign fonts (declared in theme.css) so the atlas isn't drawn in a fallback face. */
export async function loadSignFonts(): Promise<void> {
  try {
    await Promise.race([Promise.all(FONTS.map((f) => document.fonts.load(`64px "${f}"`))), new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    /* fall back to whatever the browser has */
  }
}

/** The floor's own signs: zones, wayfinding and the casino's name. */
export function floorSigns(plan: FloorPlan, b: Batch, m: Mats): SignSpec[] {
  const out: SignSpec[] = [];
  const lacquer = m.get('lacquer');
  const brass = m.get('brass');
  const chrome = m.get('chrome');
  const hang = (x: number, y: number, z: number, ry: number, w: number, h: number) => {
    // a sign box hung from the ceiling on two rods
    b.box(lacquer, x, y, z, w + 0.16, h + 0.14, 0.14, undefined, ry);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    for (const e of [-1, 1]) {
      const dx = e * (w / 2 - 0.2) * c;
      const dz = -e * (w / 2 - 0.2) * s;
      b.add(new THREE.CylinderGeometry(0.008, 0.008, CEILING - (y + h / 2), 6), chrome, { x: x + dx, y: (CEILING + y + h / 2) / 2, z: z + dz });
    }
    b.box(brass, x, y + h / 2 + 0.07, z, w + 0.2, 0.02, 0.17, undefined, ry);
    b.box(brass, x, y - h / 2 - 0.07, z, w + 0.2, 0.02, 0.17, undefined, ry);
  };
  const face = (x: number, y: number, z: number, ry: number, off: number): [number, number, number] => [x + Math.sin(ry) * off, y, z + Math.cos(ry) * off];

  // TABLE GAMES, hung under the pit's south cove, both faces
  {
    const x = 0;
    const z = plan.pit.z1 + 0.2;
    const y = 2.78;
    hang(x, y, z, 0, 4.6, 0.6);
    out.push({ kind: 'lit', text: 'TABLE GAMES', color: '#ffe0a0', font: 'Cinzel', at: face(x, y, z, 0, 0.075), ry: 0, w: 4.4, h: 0.52 });
    out.push({ kind: 'lit', text: 'TABLE GAMES', color: '#ffe0a0', font: 'Cinzel', at: face(x, y, z, Math.PI, 0.075), ry: Math.PI, w: 4.4, h: 0.52 });
  }
  // SLOTS, neon over the south-west islands, facing the main aisle and the entrance
  {
    const x = plan.slotsZone.x1 - 0.35;
    const z = plan.slotsZone.z0 + 3.2;
    const y = 2.82;
    hang(x, y, z, Math.PI / 2, 2.4, 0.66);
    out.push({ kind: 'neon', text: 'SLOTS', color: '#ff3fa4', font: 'Tilt Neon', at: face(x, y, z, Math.PI / 2, 0.075), ry: Math.PI / 2, w: 2.3, h: 0.62 });
    out.push({ kind: 'neon', text: 'SLOTS', color: '#ff3fa4', font: 'Tilt Neon', at: face(x, y, z, -Math.PI / 2, 0.075), ry: -Math.PI / 2, w: 2.3, h: 0.62 });
  }
  // POKER at the poker room's opening
  {
    const x = plan.pokerRoom.x0 - 0.05;
    const z = (plan.pokerRoom.z0 + plan.pokerRoom.z1) / 2;
    const y = 2.82;
    hang(x, y, z, -Math.PI / 2, 2.2, 0.6);
    out.push({ kind: 'neon', text: 'POKER', color: '#ff5a4a', font: 'Tilt Neon', at: face(x, y, z, -Math.PI / 2, 0.075), ry: -Math.PI / 2, w: 2.1, h: 0.56 });
    out.push({ kind: 'neon', text: 'POKER', color: '#ff5a4a', font: 'Tilt Neon', at: face(x, y, z, Math.PI / 2, 0.075), ry: Math.PI / 2, w: 2.1, h: 0.56 });
  }
  // overhead wayfinding just inside the entrance
  {
    const z = plan.entrance.z0 - 0.9;
    const y = 2.74;
    hang(0, y, z, 0, 5.2, 0.5);
    out.push({
      kind: 'way', text: '', color: '#f4e6c8', font: 'Cinzel', at: face(0, y, z, 0, 0.075), ry: 0, w: 5.1, h: 0.44,
      segments: [
        { text: 'SLOTS', arrow: 'left', before: true },
        { text: 'TABLE GAMES', arrow: 'up' },
        { text: 'BAR', arrow: 'right' },
      ],
    });
    out.push({
      kind: 'way', text: '', color: '#f4e6c8', font: 'Cinzel', at: face(0, y, z, Math.PI, 0.075), ry: Math.PI, w: 5.1, h: 0.44,
      segments: [
        { text: 'BAR', arrow: 'left', before: true },
        { text: 'EXIT', arrow: 'up' },
        { text: 'SLOTS', arrow: 'right' },
      ],
    });
  }
  // cashier wayfinding over the cross aisle, for anyone coming from the slots or the pit
  {
    const x = plan.pit.x0 - 1.2;
    const z = (plan.aisles[0]!.z0 + plan.aisles[0]!.z1) / 2;
    const y = 2.74;
    hang(x, y, z, Math.PI / 2, 3.2, 0.44);
    out.push({
      kind: 'way', text: '', color: '#f4e6c8', font: 'Cinzel', at: face(x, y, z, Math.PI / 2, 0.075), ry: Math.PI / 2, w: 3.1, h: 0.38,
      segments: [
        { text: 'SLOTS', arrow: 'left', before: true },
        { text: 'CASHIER', arrow: 'right' },
      ],
    });
    out.push({
      kind: 'way', text: '', color: '#f4e6c8', font: 'Cinzel', at: face(x, y, z, -Math.PI / 2, 0.075), ry: -Math.PI / 2, w: 3.1, h: 0.38,
      segments: [
        { text: 'CASHIER', arrow: 'left', before: true },
        { text: 'BAR', arrow: 'right' },
      ],
    });
  }
  // the casino's name over the doors, seen on the way out
  out.push({ kind: 'neon', text: 'Casino Simulator', color: '#ffc861', font: 'Limelight', at: [0, 3.08, plan.room.z1 - 0.04], ry: Math.PI, w: 4.6, h: 0.5 });
  return out;
}

interface Placed {
  spec: SignSpec;
  x: number;
  y: number;
  pw: number;
  ph: number;
  padX: number;
  padY: number;
}

/** Draw every sign into one atlas and add their faces to the scene as one mesh. */
export function buildSigns(specs: SignSpec[], parent: THREE.Object3D, quality: 'high' | 'low', anisotropy: number): { mesh: THREE.Mesh; texture: THREE.Texture } | null {
  if (specs.length === 0) return null;
  const ppm = quality === 'high' ? 200 : 128;
  const W = 2048;
  // shelf-pack the faces, padded for the glow
  const placed: Placed[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const spec of specs) {
    const glow = spec.kind === 'neon' ? 0.35 : 0.12;
    const padY = Math.round(spec.h * ppm * glow);
    const padX = padY;
    const pw = Math.min(W, Math.round(spec.w * ppm) + padX * 2);
    const ph = Math.round(spec.h * ppm) + padY * 2;
    if (x + pw > W) {
      x = 0;
      y += shelf + 2;
      shelf = 0;
    }
    placed.push({ spec, x, y, pw, ph, padX, padY });
    x += pw + 2;
    shelf = Math.max(shelf, ph);
  }
  const H = THREE.MathUtils.ceilPowerOfTwo(y + shelf);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  for (const p of placed) drawFace(ctx, p);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  const geos: THREE.BufferGeometry[] = [];
  for (const p of placed) {
    const s = p.spec;
    const wm = p.pw / ppm;
    const hm = p.ph / ppm;
    const g = new THREE.PlaneGeometry(wm, hm);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const u = (p.x + uv.getX(i) * p.pw) / W;
      const v = 1 - (p.y + (1 - uv.getY(i)) * p.ph) / H;
      uv.setXY(i, u, v);
    }
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...s.at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry), new THREE.Vector3(1, 1, 1)));
    // neon blooms hard; printed and lit-box faces only just glow
    const k = s.kind === 'neon' ? 1 : s.kind === 'lit' ? 0.62 : 0.5;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(uv.count * 3).fill(k), 3));
    geos.push(g);
  }
  const merged = mergeAll(geos);
  const mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1, 1, 1).multiplyScalar(quality === 'high' ? 2.4 : 1.6) });
  mat.name = 'signs';
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'signs';
  mesh.renderOrder = 2;
  parent.add(mesh);
  return { mesh, texture };
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const t = g.getAttribute('uv');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(t.getX(i), t.getY(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    for (const i of g.index!.array) idx.push(i + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

function drawFace(ctx: CanvasRenderingContext2D, p: Placed): void {
  const s = p.spec;
  const w = p.pw - p.padX * 2;
  const h = p.ph - p.padY * 2;
  ctx.save();
  ctx.translate(p.x + p.padX, p.y + p.padY);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (s.kind === 'neon') {
    const size = fit(ctx, s.text, s.font, w * 0.94, h * (s.sub ? 0.66 : 0.86));
    const cy = s.sub ? h * 0.38 : h / 2;
    ctx.font = `${size}px "${s.font}"`;
    // halo, then the lit tube, then its hot core
    ctx.shadowColor = s.color;
    ctx.fillStyle = s.color;
    ctx.globalAlpha = 0.55;
    ctx.shadowBlur = size * 0.55;
    ctx.fillText(s.text, w / 2, cy);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = size * 0.18;
    ctx.fillText(s.text, w / 2, cy);
    ctx.shadowBlur = 0;
    ctx.fillStyle = mix(s.color, '#ffffff', 0.62);
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.strokeStyle = mix(s.color, '#ffffff', 0.35);
    ctx.strokeText(s.text, w / 2, cy);
    ctx.fillText(s.text, w / 2, cy);
    if (s.sub) {
      const sub = fit(ctx, s.sub, 'Cinzel', w * 0.8, h * 0.2);
      ctx.font = `600 ${sub}px "Cinzel"`;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = sub * 0.5;
      ctx.fillStyle = mix(s.color, '#ffffff', 0.4);
      ctx.fillText(s.sub, w / 2, h * 0.86);
    }
  } else if (s.kind === 'lit') {
    ctx.fillStyle = '#120c09';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#6a4a22';
    ctx.lineWidth = Math.max(2, h * 0.03);
    ctx.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
    const size = fit(ctx, s.text, s.font, w * 0.86, h * 0.62, '600');
    ctx.font = `600 ${size}px "${s.font}"`;
    ctx.letterSpacing = `${Math.round(size * 0.12)}px`;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = size * 0.35;
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, w / 2, h / 2 + size * 0.04);
  } else {
    // wayfinding: navy panel, cream letters, brass arrows
    ctx.fillStyle = '#0f1b36';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c9a24a';
    ctx.fillRect(0, h - h * 0.07, w, h * 0.07);
    const segs = s.segments ?? [];
    const cell = w / Math.max(1, segs.length);
    segs.forEach((seg, i) => {
      const size = fit(ctx, seg.text, s.font, cell * 0.62, h * 0.5, '600');
      ctx.font = `600 ${size}px "${s.font}"`;
      ctx.letterSpacing = `${Math.round(size * 0.1)}px`;
      const tw = ctx.measureText(seg.text).width;
      const aw = h * 0.36;
      const total = tw + aw + h * 0.18;
      const x0 = i * cell + (cell - total) / 2;
      const arrowX = seg.before ? x0 + aw / 2 : x0 + tw + h * 0.18 + aw / 2;
      const textX = seg.before ? x0 + aw + h * 0.18 + tw / 2 : x0 + tw / 2;
      ctx.fillStyle = s.color;
      ctx.shadowColor = '#fff2d0';
      ctx.shadowBlur = size * 0.2;
      ctx.fillText(seg.text, textX, h * 0.47);
      ctx.shadowBlur = 0;
      arrow(ctx, arrowX, h * 0.47, aw, seg.arrow, '#d8b06a');
      if (i > 0) {
        ctx.fillStyle = 'rgba(216,176,106,0.5)';
        ctx.fillRect(i * cell - 1, h * 0.18, 2, h * 0.58);
      }
    });
  }
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dir: Arrow, color: string): void {
  const rot = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  const s = size / 2;
  ctx.moveTo(s, 0);
  ctx.lineTo(0, -s * 0.8);
  ctx.lineTo(0, -s * 0.32);
  ctx.lineTo(-s, -s * 0.32);
  ctx.lineTo(-s, s * 0.32);
  ctx.lineTo(0, s * 0.32);
  ctx.lineTo(0, s * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The largest font size (px) at which `text` fits in w x h. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: string, w: number, h: number, weight = ''): number {
  let size = Math.floor(h);
  ctx.font = `${weight} ${size}px "${font}"`;
  const tw = ctx.measureText(text).width * 1.12;
  if (tw > w) size = Math.floor((size * w) / tw);
  return Math.max(8, size);
}

function mix(a: string, b: string, k: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, k).getHexString()}`;
}
