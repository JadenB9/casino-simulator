// Signs: neon script, lit box signs and overhead wayfinding. Every face is drawn once into one
// canvas atlas (Tilt Neon, Limelight and Cinzel from the site's fonts) and all faces share one
// additive material pushed past 1.0, so the whole floor's signage is one draw call that blooms.

import * as THREE from 'three';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { WALL, ceilingAt, type FloorPlan, type Hanging } from './layout.ts';

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

/** How each room's name reads over its doors: a lit box in gold, or a neon of its own. */
const DOOR_SIGNS: Record<string, { kind: 'lit' | 'neon'; color: string; font: SignSpec['font'] }> = {
  lobby: { kind: 'lit', color: '#ffe0a0', font: 'Cinzel' },
  pit: { kind: 'lit', color: '#ffe0a0', font: 'Cinzel' },
  slots: { kind: 'neon', color: '#ff3fa4', font: 'Tilt Neon' },
  bar: { kind: 'neon', color: '#3fe0d0', font: 'Limelight' },
  lounge: { kind: 'lit', color: '#ffd09a', font: 'Cinzel' },
  poker: { kind: 'neon', color: '#ff5a4a', font: 'Tilt Neon' },
  salon: { kind: 'lit', color: '#f2cf7c', font: 'Cinzel' },
  online: { kind: 'neon', color: '#1fe07e', font: 'Tilt Neon' },
  yard: { kind: 'neon', color: '#ff8a2a', font: 'Tilt Neon' },
  bank: { kind: 'lit', color: '#ffe2a8', font: 'Cinzel' },
  boutique: { kind: 'lit', color: '#f6dca0', font: 'Limelight' },
};

/**
 * The floor's own signs: over every doorway, on both sides, the name of the room it leads to;
 * the hanging signs the rooms ask for (lit boxes and wayfinding with arrows); the rooms' wall
 * neons; and the casino's name over the doors, seen on the way out.
 */
export function floorSigns(plan: FloorPlan, b: Batch, m: Mats): SignSpec[] {
  const out: SignSpec[] = [];
  const lacquer = m.get('lacquer');
  const brass = m.get('brass');
  const chrome = m.get('chrome');
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));
  const hang = ({ x, y, z, ry, w, h, room }: Hanging) => {
    // a sign box hung from the ceiling on two rods
    b.room = room;
    const top = ceilingAt(plan, x, z);
    b.box(lacquer, x, y, z, w + 0.16, h + 0.14, 0.14, undefined, ry);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    for (const e of [-1, 1]) {
      const dx = e * (w / 2 - 0.2) * c;
      const dz = -e * (w / 2 - 0.2) * s;
      b.add(new THREE.CylinderGeometry(0.008, 0.008, top - (y + h / 2), 6), chrome, { x: x + dx, y: (top + y + h / 2) / 2, z: z + dz });
    }
    b.box(brass, x, y + h / 2 + 0.07, z, w + 0.2, 0.02, 0.17, undefined, ry);
    b.box(brass, x, y - h / 2 - 0.07, z, w + 0.2, 0.02, 0.17, undefined, ry);
  };
  // both faces of a hanging sign, inset (dw, dh) from the box; `back` is what the second face says when it differs
  const faces = (hs: Hanging, dw: number, dh: number, face: Omit<SignSpec, 'at' | 'ry' | 'w' | 'h'>, back: Partial<SignSpec> = {}) => {
    hang(hs);
    for (const [k, ry] of [hs.ry, hs.ry + Math.PI].entries()) {
      const at: [number, number, number] = [hs.x + Math.sin(ry) * 0.075, hs.y, hs.z + Math.cos(ry) * 0.075];
      out.push({ ...face, ...(k === 1 ? back : {}), at, ry, w: hs.w - dw, h: hs.h - dh });
    }
  };
  for (const hs of plan.hanging) {
    if (hs.kind === 'way') faces(hs, 0.1, 0.06, { kind: 'way', text: '', color: '#f4e6c8', font: 'Cinzel', segments: hs.front ?? [] }, { segments: hs.back ?? hs.front ?? [] });
    else if (hs.kind === 'neon') faces(hs, 0.1, 0.04, { kind: 'neon', text: hs.text ?? '', color: hs.color ?? '#ff3fa4', font: 'Tilt Neon' });
    else faces(hs, 0.2, 0.08, { kind: 'lit', text: hs.text ?? '', color: hs.color ?? '#ffe0a0', font: 'Cinzel' });
  }

  // over every doorway, on each side, the room beyond
  for (const d of plan.doors) {
    if (d.b === 'outside') continue;
    for (const [here, there] of [
      [d.a, d.b],
      [d.b, d.a],
    ] as const) {
      const r = byId.get(here);
      const beyond = byId.get(there);
      if (!r || !beyond) continue;
      const style = DOOR_SIGNS[there] ?? DOOR_SIGNS.pit!;
      const text = there === 'lobby' && r.id === 'pit' ? 'LOBBY · EXIT' : beyond.sign;
      // which way is into this room from the wall
      const n = d.axis === 'x' ? (r.bounds.z1 === d.c ? -1 : 1) : r.bounds.x1 === d.c ? -1 : 1;
      const h = style.kind === 'neon' ? 0.5 : 0.42;
      const span = d.a1 - d.a0;
      // as wide as its words want, a little over the doorway at least, never wider than the wall allows
      const w = Math.min(Math.max(text.length * (style.kind === 'neon' ? 0.3 : 0.26) + 0.7, Math.min(span + 0.6, 2.4)), d.kind === 'shopfront' ? 5.2 : span + 2.6, 6.2);
      const y = Math.min(d.height + 0.36 + h / 2, r.style.ceiling - h / 2 - 0.12);
      const off = WALL / 2 + (d.kind === 'grand' || d.kind === 'arch' ? 0.14 : 0.1);
      const mid = (d.a0 + d.a1) / 2;
      const at: [number, number, number] = d.axis === 'x' ? [mid, y, d.c + n * off] : [d.c + n * off, y, mid];
      // facing into the room: +z is ry 0, -z is PI, +x is PI/2, -x is -PI/2
      const ry = d.axis === 'x' ? (n > 0 ? 0 : Math.PI) : n > 0 ? Math.PI / 2 : -Math.PI / 2;
      out.push({ kind: style.kind, text, color: style.color, font: style.font, at, ry, w, h });
    }
  }

  // the rooms' wall neons (HOUSE ORIGINALS, HIGH LIMIT)
  for (const n of plan.neons) out.push({ kind: 'neon', text: n.text, color: n.color, font: n.font, at: [n.x, n.y, n.z], ry: n.ry, w: n.w, h: n.h });

  // the casino's name over the doors, seen on the way out
  const lobby = byId.get('lobby');
  const top = lobby ? lobby.style.ceiling : 3.4;
  out.push({ kind: 'neon', text: 'Casino Simulator', color: '#ffc861', font: 'Limelight', at: [(plan.door.x0 + plan.door.x1) / 2, Math.min(plan.door.height + 0.7, top - 0.5), plan.door.z - WALL / 2 - 0.04], ry: Math.PI, w: 4.6, h: 0.56 });
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
