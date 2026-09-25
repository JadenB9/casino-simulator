// The first three cabinets, built in code: a side profile extruded to the cabinet's width, a bezel plate
// with the reel window cut out of it, printed glass (pay glass, belly, topper face, deck buttons)
// from one atlas, the reels, the meters, a bulb ring and a candle. Geometry is merged by material
// and cached per machine, so a bank of twenty machines on the floor costs about a dozen draw
// calls each and shares every buffer and texture. The geometry helpers are exported for the
// later machines' cabinets (build.ts).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Quality } from '../../render/engine3d.ts';
import { MACHINES, type MachineId } from '../../../../shared/src/games/slots/machines.ts';
import { ATLAS_H, ATLAS_W, BUTTONS, COIN_COLUMNS, REGIONS, paintAtlas, paintMeters, paintOverlay, type DeckButton, type Rect } from './glass.ts';
import { stripArt, type StripArt } from './symbols.ts';
import { reelGeometry, reelMaterial, stripTexture, type ReelLook, type ReelMaterial } from './reels.ts';

type ZY = [z: number, y: number];

interface Layout {
  width: number;
  profile: ZY[];
  bevel: number;
  body: { color: string; metalness: number; roughness: number };
  trim: { color: string; metalness: number; roughness: number };
  /** The bezel plate that frames the reels and meters; the window is cut through it. */
  plate: { w: number; h: number; cy: number; zBack: number; depth: number };
  window: { w: number; h: number; cy: number };
  reels: { count: number; pitch: number; look: ReelLook; zFront: number };
  meters: { w: number; h: number; cy: number };
  /** The top box's front face, bottom and top edge as (z, y). */
  pay: { bottom: ZY; top: ZY; w: number; h: number };
  belly: { w: number; h: number; cy: number; z: number };
  deck: { front: ZY; back: ZY; xs: number[]; bw: number; bh: number };
  topper: 'arch' | 'sign' | 'disc';
  top: number;
  candle: [number, number, number];
  lever: boolean;
}

const SEVENS_LOOK: ReelLook = { width: 0.155, radius: 0.19, stopAngle: (Math.PI * 2) / 22, arcHalf: 0.75, curve: 1.6 };
const NEON_LOOK: ReelLook = { width: 0.104, radius: 0.8, stopAngle: 0.086 / 0.8, arcHalf: 0.19, curve: 0.6 };

const STEPPER_PROFILE: ZY[] = [
  [-0.3, 0], [0.24, 0], [0.24, 0.05], [0.215, 0.075], [0.232, 0.1], [0.232, 0.7], [0.37, 0.765], [0.395, 0.79],
  [0.395, 0.81], [0.255, 0.875], [0.25, 0.9], [0.25, 1.4], [0.268, 1.425], [0.268, 1.445], [0.215, 1.86], [0.19, 1.885], [-0.3, 1.885],
];

const LAYOUTS: Record<MachineId, Layout> = {
  sevens: {
    width: 0.66,
    profile: STEPPER_PROFILE,
    bevel: 0.008,
    body: { color: '#6e0d14', metalness: 0.35, roughness: 0.32 },
    trim: { color: '#d7dbe0', metalness: 1, roughness: 0.2 },
    plate: { w: 0.6, h: 0.45, cy: 1.15, zBack: 0.25, depth: 0.07 },
    window: { w: 0.51, h: 0.215, cy: 1.17 },
    reels: { count: 3, pitch: 0.168, look: SEVENS_LOOK, zFront: 0.312 },
    meters: { w: 0.54, h: 0.072, cy: 0.99 },
    pay: { bottom: [0.268, 1.445], top: [0.215, 1.86], w: 0.6, h: 0.39 },
    belly: { w: 0.56, h: 0.54, cy: 0.4, z: 0.232 },
    deck: { front: [0.395, 0.81], back: [0.255, 0.875], xs: [-0.22, -0.075, 0.075, 0.22], bw: 0.11, bh: 0.052 },
    topper: 'arch',
    top: 1.885,
    candle: [0, 1.885 + 0.285, 0.085],
    lever: true,
  },
  wild: {
    width: 0.66,
    profile: STEPPER_PROFILE,
    bevel: 0.008,
    body: { color: '#141216', metalness: 0.3, roughness: 0.28 },
    trim: { color: '#c9a24b', metalness: 1, roughness: 0.28 },
    plate: { w: 0.6, h: 0.45, cy: 1.15, zBack: 0.25, depth: 0.07 },
    window: { w: 0.51, h: 0.215, cy: 1.17 },
    reels: { count: 3, pitch: 0.168, look: SEVENS_LOOK, zFront: 0.312 },
    meters: { w: 0.54, h: 0.072, cy: 0.99 },
    pay: { bottom: [0.268, 1.445], top: [0.215, 1.86], w: 0.6, h: 0.39 },
    belly: { w: 0.56, h: 0.54, cy: 0.4, z: 0.232 },
    deck: { front: [0.395, 0.81], back: [0.255, 0.875], xs: [-0.22, -0.075, 0.075, 0.22], bw: 0.11, bh: 0.052 },
    topper: 'disc',
    top: 1.885,
    candle: [0.24, 1.885, -0.18],
    lever: true,
  },
  neon: {
    width: 0.74,
    profile: [
      [-0.32, 0], [0.26, 0], [0.26, 0.05], [0.235, 0.075], [0.25, 0.1], [0.25, 0.64], [0.4, 0.73], [0.43, 0.76],
      [0.43, 0.785], [0.28, 0.845], [0.27, 0.87], [0.27, 1.47], [0.285, 1.495], [0.285, 1.52], [0.22, 1.9], [0.19, 1.925], [-0.32, 1.925],
    ],
    bevel: 0.01,
    body: { color: '#1a1b22', metalness: 0.55, roughness: 0.38 },
    trim: { color: '#0b0b0f', metalness: 0.2, roughness: 0.14 },
    plate: { w: 0.7, h: 0.54, cy: 1.17, zBack: 0.27, depth: 0.062 },
    window: { w: 0.66, h: 0.258, cy: 1.2 },
    // pitch matches the overlay's five columns between its 64 px marker strips
    reels: { count: 5, pitch: (0.66 * (1 - 128 / 1024)) / 5, look: NEON_LOOK, zFront: 0.322 },
    meters: { w: 0.62, h: 0.075, cy: 0.985 },
    pay: { bottom: [0.285, 1.52], top: [0.22, 1.9], w: 0.66, h: 0.36 },
    belly: { w: 0.62, h: 0.5, cy: 0.37, z: 0.25 },
    deck: { front: [0.43, 0.785], back: [0.28, 0.845], xs: [-0.24, -0.08, 0.08, 0.24], bw: 0.12, bh: 0.055 },
    topper: 'sign',
    top: 1.925,
    candle: [-0.29, 1.925, -0.22],
    lever: false,
  },
};

/** Candle colours by coin value (this casino's scheme; white above is the service light). */
const CANDLE: Record<number, string> = { 5: '#e8412c', 25: '#f2c14a', 100: '#3d7be0', 500: '#b05ad6', 2500: '#f08a2c', 10_000: '#c9a24b' };
export function candleColor(denom: number): string {
  return CANDLE[denom] ?? '#3d7be0';
}

// ---------------------------------------------------------------------------------------------
// geometry helpers

export function extrudeProfile(points: ZY[], width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
  // shape x is world z; the extrusion runs along world x, centred
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  return g;
}

export function roundedRect(path: THREE.Path, x: number, y: number, w: number, h: number, r: number): void {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

/** A slab extruded toward +z from zBack, with optional holes. */
export function slab(outline: THREE.Shape, depth: number, bevel: number, zBack: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(outline, { depth: depth - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, zBack + bevel);
  return g;
}

/** Point every uv of a flat (x, y) shape into an atlas rectangle, by position within its bounds. */
export function uvFromBounds(g: THREE.BufferGeometry, rect: Rect): void {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) - b.min.x) / (b.max.x - b.min.x);
    const v = (pos.getY(i) - b.min.y) / (b.max.y - b.min.y);
    uv.setXY(i, (rect.x + u * rect.w) / ATLAS_W, 1 - (rect.y + (1 - v) * rect.h) / ATLAS_H);
  }
}

/** A flat printed panel of size w x h, its uvs covering `rect` of the atlas. */
export function panel(w: number, h: number, rect: Rect, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
  uvFromBounds(g, rect);
  g.applyMatrix4(m);
  return g;
}

export function solid(g: THREE.BufferGeometry, rect: Rect): THREE.BufferGeometry {
  const uv = g.getAttribute('uv');
  const u = (rect.x + rect.w / 2) / ATLAS_W;
  const v = 1 - (rect.y + rect.h / 2) / ATLAS_H;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return g;
}

export const M = () => new THREE.Matrix4();
export const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  M().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

export function box(w: number, h: number, d: number, m: THREE.Matrix4): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).toNonIndexed().applyMatrix4(m);
}

export function cyl(r: number, h: number, m: THREE.Matrix4, seg = 20): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, h, seg).toNonIndexed().applyMatrix4(m);
}

/** A thin frame of four bars around a w x h panel. */
export function frame(w: number, h: number, t: number, d: number, m: THREE.Matrix4): THREE.BufferGeometry[] {
  return [
    box(w + 2 * t, t, d, M().multiplyMatrices(m, at(0, h / 2 + t / 2, 0))),
    box(w + 2 * t, t, d, M().multiplyMatrices(m, at(0, -h / 2 - t / 2, 0))),
    box(t, h, d, M().multiplyMatrices(m, at(w / 2 + t / 2, 0, 0))),
    box(t, h, d, M().multiplyMatrices(m, at(-w / 2 - t / 2, 0, 0))),
  ];
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // every part must carry the same attributes, unindexed
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    g.clearGroups();
    return g;
  });
  const merged = mergeGeometries(clean, false);
  if (!merged) throw new Error('slot cabinet: geometry merge failed');
  return merged;
}

/** The pay glass plane: centred on the top box face, leaning back with it. */
function payMatrix(l: Layout, lift: number): THREE.Matrix4 {
  const [z0, y0] = l.pay.bottom;
  const [z1, y1] = l.pay.top;
  const tilt = Math.atan2(z0 - z1, y1 - y0);
  const nz = Math.cos(tilt);
  const ny = Math.sin(tilt);
  return at(0, (y0 + y1) / 2 + ny * lift, (z0 + z1) / 2 + nz * lift, -tilt);
}

function deckMatrix(l: Layout, x: number, lift: number): THREE.Matrix4 {
  const [z0, y0] = l.deck.front;
  const [z1, y1] = l.deck.back;
  const slope = Math.atan2(y1 - y0, z0 - z1);
  const ny = Math.cos(slope);
  const nz = Math.sin(slope);
  return at(x, (y0 + y1) / 2 + ny * lift, (z0 + z1) / 2 + nz * lift, -(Math.PI / 2 - slope));
}

// ---------------------------------------------------------------------------------------------
// bulbs: an instanced ring whose chase runs in the shader, from one shared clock

/** 0 idle chase, 1 alternate flash (free games starting), 2 slow pulse, 3 fast win chase. */
export type BulbMode = 0 | 1 | 2 | 3;

export function bulbMaterial(time: { value: number }, mode: { value: number }): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uMode = mode;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uMode;\nvarying float vLit;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        float bulbId = float(gl_InstanceID);
        float chase = step(0.62, fract(bulbId / 3.0 - uTime * 2.4));
        float flash = step(0.5, fract(uTime * 3.0 + mod(bulbId, 2.0) * 0.5));
        float pulse = 0.5 + 0.5 * cos(uTime * 3.14159);
        float run = fract(bulbId / 7.0 - uTime * 4.2);
        float comet = 0.12 + 1.25 * run * run * run;
        vLit = uMode < 0.5 ? 0.3 + 0.7 * chase : (uMode < 1.5 ? 0.22 + 0.78 * flash : (uMode < 2.5 ? 0.15 + 0.85 * pulse : comet));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLit;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= vLit * 1.5;');
  };
  m.customProgramCacheKey = () => 'slots-bulb-chase';
  return m;
}

const clock = { value: 0 };
const idleMode = { value: 0 };

// ---------------------------------------------------------------------------------------------
// parts shared by every cabinet of one machine

interface Parts {
  layout: Layout;
  body: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  printed: THREE.BufferGeometry;
  leds: THREE.BufferGeometry | null;
  bodyMat: THREE.MeshStandardMaterial;
  trimMat: THREE.MeshStandardMaterial;
  printedMat: THREE.MeshStandardMaterial;
  ledMat: THREE.MeshBasicMaterial;
  reelGeo: THREE.BufferGeometry;
  reelMats: ReelMaterial[];
  art: StripArt;
  sharp: THREE.CanvasTexture[];
  blurred: THREE.CanvasTexture[];
  meterGeo: THREE.PlaneGeometry;
  meterMat: THREE.MeshBasicMaterial;
  overlayGeo: THREE.PlaneGeometry | null;
  overlayMat: THREE.MeshBasicMaterial | null;
  paylineGeo: THREE.PlaneGeometry | null;
  paylineMat: THREE.MeshBasicMaterial;
  bulbGeo: THREE.SphereGeometry;
  bulbMat: THREE.MeshBasicMaterial;
  bulbSpots: THREE.Vector3[];
  bulbColors: THREE.Color[];
  candleGeo: THREE.CylinderGeometry;
  candleWhite: THREE.MeshBasicMaterial;
  candleTint: THREE.MeshBasicMaterial;
  atlas: THREE.CanvasTexture;
  scale: number;
}

const cache = new Map<string, Parts>();

function bodyParts(l: Layout): THREE.BufferGeometry[] {
  const parts = [extrudeProfile(l.profile, l.width, l.bevel)];
  if (l.lever) parts.push(new THREE.SphereGeometry(0.034, 18, 12).toNonIndexed().applyMatrix4(at(l.width / 2 + 0.05, 1.42, 0.06)));
  if (l.topper === 'arch') {
    const s = new THREE.Shape();
    s.moveTo(-0.31, 0);
    s.lineTo(0.31, 0);
    s.lineTo(0.31, 0.14);
    s.absellipse(0, 0.14, 0.31, 0.14, 0, Math.PI, false);
    s.lineTo(-0.31, 0);
    parts.push(slab(s, 0.13, 0.008, 0.02).applyMatrix4(at(0, l.top, 0)));
  } else if (l.topper === 'sign') {
    const s = new THREE.Shape();
    roundedRect(s, -l.width / 2, 0, l.width, 0.24, 0.03);
    parts.push(slab(s, 0.12, 0.008, 0.0).applyMatrix4(at(0, l.top, 0)));
  } else {
    const s = new THREE.Shape();
    s.absarc(0, 0, 0.25, 0, Math.PI * 2, false);
    parts.push(slab(s, 0.1, 0.008, 0.03).applyMatrix4(at(0, l.top + 0.26, 0)));
    parts.push(box(0.12, 0.03, 0.1, at(0, l.top + 0.015, 0.08)));
  }
  return parts;
}

function trimParts(l: Layout): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  // bezel plate with the reel window through it
  const p = l.plate;
  const outline = new THREE.Shape();
  roundedRect(outline, -p.w / 2, -p.h / 2, p.w, p.h, 0.03);
  const hole = new THREE.Path();
  const w = l.window;
  roundedRect(hole, -w.w / 2, w.cy - p.cy - w.h / 2, w.w, w.h, 0.014);
  outline.holes.push(hole);
  parts.push(slab(outline, p.depth, 0.006, p.zBack).applyMatrix4(at(0, p.cy, 0)));
  // frames around the glass, the deck's front edge, and the candle's collar and cap
  const pay = payMatrix(l, 0.012);
  parts.push(...frame(l.pay.w, l.pay.h, 0.012, 0.016, pay));
  parts.push(...frame(l.belly.w, l.belly.h, 0.01, 0.014, at(0, l.belly.cy, l.belly.z + 0.012)));
  parts.push(box(l.width - 0.02, 0.018, 0.022, at(0, l.deck.front[1] - 0.012, l.deck.front[0] + 0.006)));
  const [cx, cy, cz] = l.candle;
  parts.push(cyl(0.036, 0.022, at(cx, cy + 0.011, cz)));
  parts.push(cyl(0.034, 0.012, at(cx, cy + 0.022 + 0.15 + 0.006, cz)));
  if (l.lever) {
    const x = l.width / 2 + 0.05;
    parts.push(box(0.05, 0.1, 0.12, at(l.width / 2 + 0.02, 1.02, 0.06)));
    parts.push(cyl(0.012, 0.38, at(x, 1.22, 0.06, 0, 0, 0), 12));
  }
  if (l.topper === 'disc') {
    parts.push(new THREE.TorusGeometry(0.25, 0.012, 8, 64).toNonIndexed().applyMatrix4(at(0, l.top + 0.26, 0.13)));
  }
  return parts;
}

function printedParts(l: Layout): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const P = REGIONS;
  parts.push(panel(l.pay.w, l.pay.h, P.pay, payMatrix(l, l.bevel + 0.002)));
  parts.push(panel(l.belly.w, l.belly.h, P.belly, at(0, l.belly.cy, l.belly.z + l.bevel + 0.002)));
  l.deck.xs.forEach((x, i) => parts.push(panel(l.deck.bw, l.deck.bh, P.buttons[i]!, deckMatrix(l, x, l.bevel + 0.003))));
  // the dark inside of the reel box, behind the reels
  parts.push(solid(new THREE.PlaneGeometry(l.window.w + 0.02, l.window.h + 0.06).toNonIndexed().applyMatrix4(at(0, l.window.cy, l.plate.zBack + 0.016)), P.black));
  // topper face
  if (l.topper === 'arch') {
    const s = new THREE.Shape();
    s.moveTo(-0.285, 0.02);
    s.lineTo(0.285, 0.02);
    s.lineTo(0.285, 0.14);
    s.absellipse(0, 0.14, 0.285, 0.115, 0, Math.PI, false);
    s.lineTo(-0.285, 0.02);
    const g = new THREE.ShapeGeometry(s, 24).toNonIndexed();
    uvFromBounds(g, P.topper);
    parts.push(g.applyMatrix4(at(0, l.top, 0.02 + 0.13 + 0.002)));
  } else if (l.topper === 'sign') {
    parts.push(panel(l.width - 0.05, 0.2, P.topper, at(0, l.top + 0.12, 0.12 + 0.002)));
  } else {
    const g = new THREE.CircleGeometry(0.205, 48).toNonIndexed();
    uvFromBounds(g, { x: P.topper.x, y: P.topper.y, w: P.topper.h, h: P.topper.h });
    parts.push(g.applyMatrix4(at(0, l.top + 0.26, 0.03 + 0.1 + 0.002)));
  }
  return parts;
}

function bulbLayout(l: Layout): { spots: THREE.Vector3[]; colors: THREE.Color[] } {
  const spots: THREE.Vector3[] = [];
  const colors: THREE.Color[] = [];
  if (l.topper === 'arch') {
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0.012);
    s.lineTo(0.3, 0.012);
    s.lineTo(0.3, 0.14);
    s.absellipse(0, 0.14, 0.3, 0.13, 0, Math.PI, false);
    s.lineTo(-0.3, 0.012);
    for (const p of s.getSpacedPoints(34).slice(0, -1)) spots.push(new THREE.Vector3(p.x, l.top + p.y, 0.155));
    for (let i = 0; i < spots.length; i++) colors.push(new THREE.Color('#ffe2a8'));
  } else if (l.topper === 'sign') {
    const s = new THREE.Path();
    roundedRect(s, -l.width / 2 + 0.012, 0.012, l.width - 0.024, 0.216, 0.02);
    for (const p of s.getSpacedPoints(44).slice(0, -1)) spots.push(new THREE.Vector3(p.x, l.top + p.y, 0.124));
    spots.forEach((_, i) => colors.push(new THREE.Color(i % 2 ? '#40d6ff' : '#ff4fd8')));
  } else {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      spots.push(new THREE.Vector3(Math.cos(a) * 0.222, l.top + 0.26 + Math.sin(a) * 0.222, 0.134));
      colors.push(new THREE.Color('#ffe2a8'));
    }
  }
  return { spots, colors };
}

function ledParts(l: Layout): THREE.BufferGeometry | null {
  if (l.topper !== 'sign') return null;
  const strip = (x: number, color: string, y0: number, y1: number, z: number) => {
    const g = box(0.012, y1 - y0, 0.012, at(x, (y0 + y1) / 2, z));
    const c = new THREE.Color(color);
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
    return g;
  };
  const edge = l.width / 2 + 0.002;
  return merge([
    strip(-edge, '#ff4fd8', 0.12, 1.46, 0.262),
    strip(edge, '#40d6ff', 0.12, 1.46, 0.262),
    strip(-edge, '#ff4fd8', 1.52, 1.88, 0.232),
    strip(edge, '#40d6ff', 1.52, 1.88, 0.232),
  ]);
}

function parts(machine: MachineId, quality: Quality): Parts {
  const key = `${machine}:${quality}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const l = LAYOUTS[machine];
  const scale = quality === 'low' ? 0.5 : 1;
  const atlasCanvas = document.createElement('canvas');
  paintAtlas(atlasCanvas, machine, scale);
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  const art = stripArt(machine, quality === 'low' ? 0.6 : 1);
  const sharp = art.sharp.map(stripTexture);
  const blurred = art.blurred.map(stripTexture);
  const video = machine === 'neon';
  const reelMats = sharp.map((t, i) => reelMaterial(t, blurred[i]!, art.stops, l.reels.look.curve, video ? '#ffffff' : '#fff4e2'));
  const meterCanvas = document.createElement('canvas');
  paintMeters(meterCanvas, machine, null, scale);
  const meterTex = new THREE.CanvasTexture(meterCanvas);
  meterTex.colorSpace = THREE.SRGBColorSpace;
  let overlayMat: THREE.MeshBasicMaterial | null = null;
  if (video) {
    const oc = document.createElement('canvas');
    paintOverlay(oc, null, scale);
    const ot = new THREE.CanvasTexture(oc);
    ot.colorSpace = THREE.SRGBColorSpace;
    overlayMat = new THREE.MeshBasicMaterial({ map: ot, transparent: true, depthWrite: false, toneMapped: false });
  }
  const bulbs = bulbLayout(l);
  const p: Parts = {
    layout: l,
    body: merge(bodyParts(l)),
    trim: merge(trimParts(l)),
    printed: merge(printedParts(l)),
    leds: ledParts(l),
    bodyMat: new THREE.MeshStandardMaterial(l.body),
    trimMat: new THREE.MeshStandardMaterial(l.trim),
    printedMat: new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: '#ffffff', emissiveIntensity: 0.4, roughness: 0.6, metalness: 0, envMapIntensity: 0.3 }),
    ledMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    reelGeo: reelGeometry(l.reels.look),
    reelMats,
    art,
    sharp,
    blurred,
    meterGeo: new THREE.PlaneGeometry(l.meters.w, l.meters.h),
    meterMat: new THREE.MeshBasicMaterial({ map: meterTex, toneMapped: false }),
    overlayGeo: video ? new THREE.PlaneGeometry(l.window.w, l.window.h) : null,
    overlayMat,
    paylineGeo: video ? null : new THREE.PlaneGeometry(l.window.w - 0.01, 0.0035),
    paylineMat: new THREE.MeshBasicMaterial({ color: '#ff3326', toneMapped: false }),
    bulbGeo: new THREE.SphereGeometry(video ? 0.008 : 0.011, 10, 8),
    bulbMat: bulbMaterial(clock, idleMode),
    bulbSpots: bulbs.spots,
    bulbColors: bulbs.colors,
    candleGeo: new THREE.CylinderGeometry(0.03, 0.03, 0.075, 20),
    candleWhite: new THREE.MeshBasicMaterial({ color: '#fff8ec', toneMapped: false }),
    candleTint: new THREE.MeshBasicMaterial({ color: candleColor(MACHINES[machine].denoms[0]!), toneMapped: false }),
    atlas,
    scale,
  };
  cache.set(key, p);
  // canvases painted before a web font arrived get painted again once it has
  if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
    void document.fonts.ready.then(() => repaint(p, machine));
  }
  return p;
}

function repaint(p: Parts, machine: MachineId): void {
  paintAtlas(p.atlas.image as HTMLCanvasElement, machine, p.scale);
  p.atlas.needsUpdate = true;
  paintMeters(p.meterMat.map!.image as HTMLCanvasElement, machine, null, p.scale);
  p.meterMat.map!.needsUpdate = true;
  const fresh = stripArt(machine, p.scale === 0.5 ? 0.6 : 1);
  fresh.sharp.forEach((c, i) => {
    const g = p.art.sharp[i]!.getContext('2d')!;
    g.drawImage(c, 0, 0);
    p.sharp[i]!.needsUpdate = true;
  });
  fresh.blurred.forEach((c, i) => {
    const g = p.art.blurred[i]!.getContext('2d')!;
    g.drawImage(c, 0, 0);
    p.blurred[i]!.needsUpdate = true;
  });
  if (p.overlayMat) {
    paintOverlay(p.overlayMat.map!.image as HTMLCanvasElement, null, p.scale);
    p.overlayMat.map!.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// one cabinet

/** What a table view needs to drive a cabinet. Lives on the model's userData.slots. */
export interface CabinetHandle {
  machine: MachineId;
  layout: Layout;
  root: THREE.Group;
  reels: THREE.Mesh[];
  sharp: THREE.Texture[];
  blurred: THREE.Texture[];
  stops: number;
  meters: THREE.Mesh;
  overlay: THREE.Mesh | null;
  payline: THREE.Mesh | null;
  bulbs: THREE.InstancedMesh;
  candleTint: THREE.Mesh;
  candleWhite: THREE.Mesh;
  printed: THREE.Mesh;
  scale: number;
  clock: { value: number };
}

export function buildCabinet(machine: MachineId, quality: Quality, idleStops?: readonly number[]): THREE.Group {
  const p = parts(machine, quality);
  const l = p.layout;
  const root = new THREE.Group();
  root.name = `slots-${machine}`;
  const body = new THREE.Mesh(p.body, p.bodyMat);
  const trim = new THREE.Mesh(p.trim, p.trimMat);
  const printed = new THREE.Mesh(p.printed, p.printedMat);
  root.add(body, trim, printed);
  if (p.leds) root.add(new THREE.Mesh(p.leds, p.ledMat));

  const reels = p.reelMats.map((mat, i) => {
    const mesh = new THREE.Mesh(p.reelGeo, mat);
    mesh.position.set((i - (l.reels.count - 1) / 2) * l.reels.pitch, l.window.cy, l.reels.zFront);
    root.add(mesh);
    return mesh;
  });
  // the decor reels share one material per reel; show a quiet window
  const shown = idleStops ?? (machine === 'neon' ? [4, 9, 20, 1, 26] : [3, 11, 17]);
  p.reelMats.forEach((m, i) => (m.uniforms.uOffset.value = shown[i]! + (machine === 'neon' ? 1 : 0)));

  const meters = new THREE.Mesh(p.meterGeo, p.meterMat);
  meters.position.set(0, l.meters.cy, l.plate.zBack + l.plate.depth + 0.0015);
  root.add(meters);
  let overlay: THREE.Mesh | null = null;
  let payline: THREE.Mesh | null = null;
  if (p.overlayGeo && p.overlayMat) {
    overlay = new THREE.Mesh(p.overlayGeo, p.overlayMat);
    overlay.position.set(0, l.window.cy, l.reels.zFront + 0.003);
    overlay.renderOrder = 2;
    root.add(overlay);
  }
  if (p.paylineGeo) {
    payline = new THREE.Mesh(p.paylineGeo, p.paylineMat);
    payline.position.set(0, l.window.cy, l.reels.zFront + 0.003);
    root.add(payline);
  }

  const bulbs = new THREE.InstancedMesh(p.bulbGeo, p.bulbMat, p.bulbSpots.length);
  const m = new THREE.Matrix4();
  p.bulbSpots.forEach((s, i) => {
    bulbs.setMatrixAt(i, m.makeTranslation(s.x, s.y, s.z));
    bulbs.setColorAt(i, p.bulbColors[i]!);
  });
  bulbs.instanceMatrix.needsUpdate = true;
  if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  bulbs.computeBoundingSphere();
  // one clock for every cabinet: whichever bulb ring renders first advances it
  bulbs.onBeforeRender = () => {
    clock.value = performance.now() / 1000;
  };
  root.add(bulbs);

  const [cx, cy, cz] = l.candle;
  const candleTint = new THREE.Mesh(p.candleGeo, p.candleTint);
  candleTint.position.set(cx, cy + 0.022 + 0.0375, cz);
  const candleWhite = new THREE.Mesh(p.candleGeo, p.candleWhite);
  candleWhite.position.set(cx, cy + 0.022 + 0.075 + 0.0375, cz);
  root.add(candleTint, candleWhite);

  const handle: CabinetHandle = {
    machine,
    layout: l,
    root,
    reels,
    sharp: p.sharp,
    blurred: p.blurred,
    stops: p.art.stops,
    meters,
    overlay,
    payline,
    bulbs,
    candleTint,
    candleWhite,
    printed,
    scale: p.scale,
    clock,
  };
  root.userData.slots = handle;
  return root;
}

/** Which deck button (if any) a hit on the printed glass landed on. */
export function buttonAtUv(uv: THREE.Vector2 | undefined): DeckButton | null {
  if (!uv) return null;
  const x = uv.x * ATLAS_W;
  const y = (1 - uv.y) * ATLAS_H;
  const i = REGIONS.buttons.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  return i >= 0 ? BUTTONS[i]!.id : null;
}

/** The transform of the pay glass, and where its coin columns are across it (metres from centre). */
export function payGlassPlacement(l: Layout): { matrix: THREE.Matrix4; columns: number[]; w: number; h: number } {
  return {
    matrix: payMatrix(l, l.bevel + 0.004),
    columns: COIN_COLUMNS.map((px) => (px / REGIONS.pay.w - 0.5) * l.pay.w),
    w: l.pay.w,
    h: l.pay.h,
  };
}

export const FOOTPRINT = { width: 0.8, depth: 0.8 };

/** A cabinet's face as a layout gives it (the classic cabinets' and the skinned ones' alike). */
interface Face {
  pay: { bottom: ZY; top: ZY; w: number };
  plate: { zBack: number; depth: number };
  window: { w: number; h: number; cy: number };
  meters: { w: number; h: number; cy: number };
}

/**
 * What stays in view at a machine (table/fit.ts): the pay glass, the reels' window and the meters
 * under it. The deck's buttons are the control bar's too, so the bar may cover them.
 */
export function playFace(l: Face): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const front = l.plate.zBack + l.plate.depth;
  for (const s of [-1, 1]) {
    for (const [z, y] of [l.pay.bottom, l.pay.top]) out.push(new THREE.Vector3((s * l.pay.w) / 2, y, z));
    for (const r of [l.window, l.meters]) for (const t of [-1, 1]) out.push(new THREE.Vector3((s * r.w) / 2, r.cy + (t * r.h) / 2, front));
  }
  return out;
}
export { LAYOUTS };
