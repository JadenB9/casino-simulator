// Moments worth marking: a made hand in poker, a blackjack, a big slot line. One call puts up the
// banner (the hand's name, what it paid), rings the cards, chips or printed spots that made it
// with a soft band of light, and on the biggest wins drops a short shower of chips around them.
// Callers decide whether a moment counts: never for a return at or below the stake (a push, or a
// win that only gives the bet back).
//
// The light is a ring, not a patch drawn over things: it peaks a hair outside an object's
// outline and falls away over a couple of centimetres, lying under the object (the side away from
// the camera), so nothing is ever drawn over a card's face or a chip's value. Under a hand it also
// fills the footprint, which only shows in the gaps between the cards (so they don't read as dark
// seams); round a printed spot it's an outline only, so the spot's own words stay as printed. It
// adds only a little light to the felt, well short of what the bloom picks up, so the felt and its
// printing show through it.

import * as THREE from 'three';
import type { TableStage } from './stage.ts';
import type { Sfx } from '../audio/sfx.ts';
import { el } from '../ui/kit.ts';

export type Tier = 'nice' | 'big' | 'huge';

/** A printed spot on the felt to ring (it has no object of its own), in table-local metres. */
export interface Spot {
  x: number;
  /** The felt's height there. */
  y: number;
  z: number;
  /** Size along x and along z. */
  w: number;
  d: number;
  /** A round spot, `w` across. */
  round?: boolean;
}

export interface Moment {
  /** What happened, in the table's words: "Full house, kings full", "Blackjack", "Big win". */
  title: string;
  /** A second line: what it paid ("Pays 9 to 1 · $450"). */
  sub?: string;
  tier: Tier;
  /** Table-local point the chips fall around (huge only). */
  at?: THREE.Vector3;
  /**
   * Objects to ring with light, each on its own (the board's cards, a chip pile); a nested list
   * shares one ring (a hand of overlapping cards).
   */
  glow?: (THREE.Object3D | THREE.Object3D[])[];
  /** Printed spots to ring: the box a bet won on, the numbers it covered. */
  spots?: Spot[];
}

const HOLD_MS: Record<Tier, number> = { nice: 1800, big: 2600, huge: 3600 };
/** The ring's brightest point, by tier: a little light added to the felt, never a floodlight. */
const PEAK: Record<Tier, number> = { nice: 0.28, big: 0.34, huge: 0.4 };
/** How much further the light reaches for a bigger moment. */
const SPREAD: Record<Tier, number> = { nice: 1, big: 1.15, huge: 1.3 };
const WARM = new THREE.Color(1, 0.8, 0.47);

/**
 * Mark a moment. Returns a stop that takes the light down early (the next hand starting); the
 * banner and any chips finish on their own.
 */
export function celebrate(ctx: { stage: TableStage; ui: HTMLElement; sfx: Sfx }, m: Moment): () => void {
  banner(ctx.ui, m);
  const prints = [...(m.glow ?? []).map((g) => footprintOf(ctx.stage.root, ctx.stage.engine.camera, Array.isArray(g) ? g : [g])), ...(m.spots ?? []).map(spotPrint)].filter((f): f is Footprint => f !== null);
  const stop = rings(ctx.stage, prints, m.tier, HOLD_MS[m.tier] + 400);
  if (m.tier === 'huge' && m.at) shower(ctx.stage, m.at, prints);
  chime(ctx.sfx, m.tier);
  return stop;
}

function banner(ui: HTMLElement, m: Moment): void {
  const b = el('div', `celebrate panel tier-${m.tier}`);
  b.append(el('div', 'celebrate-title', m.title));
  if (m.sub) b.append(el('div', 'celebrate-sub', m.sub));
  ui.append(b);
  setTimeout(() => b.classList.add('out'), HOLD_MS[m.tier]);
  setTimeout(() => b.remove(), HOLD_MS[m.tier] + 400);
}

// ---- where the light goes ------------------------------------------------------------------

/** An outline to ring, table-local: a (rounded) rectangle in the plane through `centre`. */
export interface Footprint {
  /** Things lying on the felt (lit under as well as round them), or a printed spot (outline only). */
  solid: boolean;
  centre: THREE.Vector3;
  /** Across (u) and along (v) the rectangle, and out of its plane toward the camera side (n). */
  u: THREE.Vector3;
  v: THREE.Vector3;
  n: THREE.Vector3;
  /** Half sizes along u and v. */
  a: number;
  b: number;
  round: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _cam = new THREE.Vector3();

export function spotPrint(s: Spot): Footprint {
  const a = s.w / 2;
  return {
    solid: false,
    centre: new THREE.Vector3(s.x, s.y + 0.0003, s.z),
    u: new THREE.Vector3(1, 0, 0),
    v: new THREE.Vector3(0, 0, 1),
    n: UP.clone(),
    a,
    b: s.round ? a : s.d / 2,
    round: !!s.round,
  };
}

/**
 * The outline of `objects` together, measured from their meshes in the table's own space (`root`,
 * so a station turned on the floor doesn't widen it) and squared to the first one's turn, so a
 * hand dealt at an angle gets a ring at that angle. Things lying flat (cards, chips, a printed
 * box) are ringed in the felt's plane; a flat thing standing up (a lit sector on an upright wheel)
 * in its own plane. The ring goes on the side away from `camera`.
 */
export function footprintOf(root: THREE.Object3D, camera: THREE.Camera, objects: THREE.Object3D[]): Footprint | null {
  root.updateWorldMatrix(true, false);
  _inv.copy(root.matrixWorld).invert();
  const pts: THREE.Vector3[] = [];
  let round = true;
  const visit = (o: THREE.Object3D, top: boolean) => {
    // the objects asked for count even when hidden (a stand-in); hidden parts inside them don't
    if (!top && !o.visible) return;
    if (o instanceof THREE.Mesh) {
      const box = boxOf(o);
      if (box) {
        _m.multiplyMatrices(_inv, o.matrixWorld);
        for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(_m));
        const type = (o.geometry as THREE.BufferGeometry).type;
        if (type !== 'CylinderGeometry' && type !== 'CircleGeometry') round = false;
      }
    }
    for (const c of o.children) visit(c, false);
  };
  for (const o of objects) {
    if (!o) continue;
    o.updateWorldMatrix(true, true);
    visit(o, true);
  }
  const first = objects.find((o) => o);
  if (!pts.length || !first) return null;

  // the first object's own axes, table-local
  _m.multiplyMatrices(_inv, first.matrixWorld);
  const axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  _m.extractBasis(axes[0]!, axes[1]!, axes[2]!);
  axes.forEach((a) => a.normalize());
  const extent = axes.map((a) => spread(pts, a));
  const order = [0, 1, 2].sort((i, j) => extent[i]! - extent[j]!);
  const thin = order[0]!;
  let n: THREE.Vector3;
  let u: THREE.Vector3;
  if (extent[thin]! < 0.25 * extent[order[1]!]! && Math.abs(axes[thin]!.y) < 0.5) {
    // standing up: ring it in its own plane, the rectangle along its more level axis
    n = axes[thin]!.clone();
    const [p, q] = order.slice(1).map((i) => axes[i]!);
    u = (Math.abs(p!.y) < Math.abs(q!.y) ? p! : q!).clone();
  } else {
    n = UP.clone();
    // squared to the first object's turn about the vertical
    u = new THREE.Vector3(axes[0]!.x, 0, axes[0]!.z);
    if (u.lengthSq() < 0.09) u.set(axes[2]!.x, 0, axes[2]!.z);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
  }
  const v = new THREE.Vector3().crossVectors(u, n).normalize();
  u.crossVectors(n, v).normalize();
  let [u0, u1, v0, v1, n0, n1] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const p of pts) {
    const pu = p.dot(u);
    const pv = p.dot(v);
    const pn = p.dot(n);
    u0 = Math.min(u0, pu);
    u1 = Math.max(u1, pu);
    v0 = Math.min(v0, pv);
    v1 = Math.max(v1, pv);
    n0 = Math.min(n0, pn);
    n1 = Math.max(n1, pn);
  }
  // Just inside the object's far side from the camera: under a card lying flat (between its two
  // faces), a hair above the felt under a chip. Something with no thickness (a lit sector on a
  // wheel) gets it a hair behind instead.
  camera.getWorldPosition(_cam);
  root.worldToLocal(_cam);
  const thick = n1 - n0;
  const off = thick < 0.0002 ? -0.0002 : Math.min(0.0003, thick / 2);
  const depth = _cam.dot(n) >= (n0 + n1) / 2 ? n0 + off : n1 - off;
  const centre = new THREE.Vector3()
    .addScaledVector(u, (u0 + u1) / 2)
    .addScaledVector(v, (v0 + v1) / 2)
    .addScaledVector(n, depth);
  return { solid: true, centre, u, v, n, a: Math.max((u1 - u0) / 2, 0.004), b: Math.max((v1 - v0) / 2, 0.004), round };
}

/** A mesh's box in its own space (an instanced mesh's across all its instances). */
function boxOf(o: THREE.Mesh): THREE.Box3 | null {
  if (o instanceof THREE.InstancedMesh) {
    if (o.count === 0) return null;
    if (!o.boundingBox) o.computeBoundingBox();
    return o.boundingBox;
  }
  const g = o.geometry as THREE.BufferGeometry;
  if (!g.attributes.position) return null;
  if (!g.boundingBox) g.computeBoundingBox();
  return g.boundingBox;
}

function spread(pts: THREE.Vector3[], axis: THREE.Vector3): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const d = p.dot(axis);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return hi - lo;
}

// ---- the rings -----------------------------------------------------------------------------

/** How far inside the outline the light starts, and how far outside it peaks. */
const INSET = 0.004;
const CREST = 0.0015;

const falloffTex: Partial<Record<'solid' | 'outline', THREE.Texture>> = {};

/**
 * The ring's profile across its width (u 0 -> 1): full at the crest (u 0.5, just outside the
 * outline), easing away to nothing at the outer edge. Inside the crest a solid footprint stays
 * full; an outline rises from nothing at the inner edge.
 */
function falloff(kind: 'solid' | 'outline'): THREE.Texture {
  const have = falloffTex[kind];
  if (have) return have;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 1;
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 1);
  for (let i = 0; i < 128; i++) {
    const s = i / 127;
    let a: number;
    if (s <= 0.5) {
      const x = s / 0.5;
      a = kind === 'solid' ? 1 : x * x * (3 - 2 * x);
    } else {
      const x = (s - 0.5) / 0.5;
      a = Math.exp(-3.2 * x * x) * (1 - x * x);
    }
    const v = Math.round(a * 255);
    img.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  falloffTex[kind] = t;
  return t;
}

/**
 * A band round a rounded rectangle (half sizes a, b, corner radius r) in the xz plane, in three
 * rows: the inner edge, the crest just outside the outline, and `reach` out. The texture runs
 * across the band (u 0 -> 0.5 -> 1), so the profile stays the same whatever the size. A solid
 * band's inner edge is the middle of the footprint (the rectangle shrunk by r, plus a quad over
 * it); an outline's is INSET inside the outline.
 */
function bandGeometry(a: number, b: number, r: number, reach: number, solid: boolean): THREE.BufferGeometry {
  // Every point of a rounded rectangle is a point q of the rectangle shrunk by r, pushed out r
  // along its normal; the rows are the same points pushed out further or less far.
  const qa = Math.max(0, a - r);
  const qb = Math.max(0, b - r);
  const rows = [solid ? 0 : r - INSET, r + CREST, r + reach];
  const corners: [number, number, number][] = [
    [qa, qb, 0],
    [-qa, qb, Math.PI / 2],
    [-qa, -qb, Math.PI],
    [qa, -qb, 1.5 * Math.PI],
  ];
  const K = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  for (const [qx, qz, t0] of corners) {
    for (let k = 0; k <= K; k++) {
      const t = t0 + (k / K) * (Math.PI / 2);
      const nx = Math.cos(t);
      const nz = Math.sin(t);
      rows.forEach((d, i) => {
        pos.push(qx + nx * d, 0, qz + nz * d);
        uv.push(i / 2, 0.5);
      });
    }
  }
  const count = pos.length / 9;
  const index: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    for (let row = 0; row < 2; row++) {
      const a0 = i * 3 + row;
      const b0 = j * 3 + row;
      index.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  if (solid && qa > 0 && qb > 0) {
    const k = count * 3;
    pos.push(-qa, 0, -qb, qa, 0, -qb, qa, 0, qb, -qa, 0, qb);
    uv.push(0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5);
    index.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** Ring every footprint for `ms`; returns the early stop. */
function rings(stage: TableStage, prints: Footprint[], tier: Tier, ms: number): () => void {
  if (!prints.length) return () => {};
  const material = (kind: 'solid' | 'outline') =>
    new THREE.MeshBasicMaterial({
      color: WARM,
      alphaMap: falloff(kind),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      // No depth offset: the ring lies a clear 0.2-0.6 mm above the felt, and pulling it forward
      // would let it through a card face 0.2 mm above it when the camera looks along the table.
      blending: THREE.AdditiveBlending,
    });
  const mats = { solid: material('solid'), outline: material('outline') };
  const meshes = prints.map((f) => {
    const small = Math.min(f.a, f.b) * 2;
    const reach = Math.min(0.024, Math.max(0.01, 0.012 + 0.1 * small)) * SPREAD[tier];
    // an outline's corners at least as round as its inset, so its inner row never folds over itself
    const r = f.round ? Math.min(f.a, f.b) : Math.max(INSET, Math.min(0.1 * small, 0.008));
    const mesh = new THREE.Mesh(bandGeometry(f.a, f.b, r, reach, f.solid), f.solid ? mats.solid : mats.outline);
    mesh.matrix.makeBasis(f.u, f.n, f.v).setPosition(f.centre);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    mesh.raycast = () => {};
    stage.root.add(mesh);
    return mesh;
  });
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    mats.solid.dispose();
    mats.outline.dispose();
  };
  const start = performance.now();
  const tick = () => {
    if (done) return;
    const t = performance.now() - start;
    if (t >= ms || !meshes.some((m) => m.parent)) return stop();
    // In over a fifth of a second, a slow breath, out over the last half second.
    const fadeIn = Math.min(1, t / 220);
    const fadeOut = Math.min(1, (ms - t) / 550);
    mats.solid.opacity = mats.outline.opacity = PEAK[tier] * fadeIn * fadeOut * (0.86 + 0.14 * Math.sin(t / 210));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return stop;
}

// ---- the chips -----------------------------------------------------------------------------

const CHIP_COLORS = ['#c8102e', '#1b7f3b', '#101010', '#5b2a86', '#d4a017'];
const CHIP_R = 0.019;

/** Inside a flat footprint's rectangle (grown by `pad`), on the felt's plane. */
function covers(f: Footprint, x: number, z: number, pad: number): boolean {
  if (f.n.y < 0.9 && f.n.y > -0.9) return false;
  const dx = x - f.centre.x;
  const dz = z - f.centre.z;
  return Math.abs(dx * f.u.x + dz * f.u.z) < f.a + pad && Math.abs(dx * f.v.x + dz * f.v.z) < f.b + pad;
}

/**
 * Where a showered chip comes down: somewhere round `at`, and never on the lit things (a chip's
 * width clear of them), so the cards that made the moment stay readable. Table-local x, z.
 */
export function landing(at: THREE.Vector3, keepClear: Footprint[], random: () => number = Math.random): [number, number] {
  const clear = (x: number, z: number) => !keepClear.some((f) => covers(f, x, z, CHIP_R + 0.004));
  let a = 0;
  let x = at.x;
  let z = at.z;
  for (let tries = 0; tries < 16; tries++) {
    a = random() * Math.PI * 2;
    const r = 0.06 + random() * (0.12 + tries * 0.012);
    x = at.x + Math.cos(a) * r;
    z = at.z + Math.sin(a) * r;
    if (clear(x, z)) return [x, z];
  }
  // hemmed in (`at` in the middle of a big hand): keep going outward until it's clear
  for (let step = 0; step < 100 && !clear(x, z); step++) {
    x += Math.cos(a) * 0.01;
    z += Math.sin(a) * 0.01;
  }
  return [x, z];
}

/**
 * A handful of chips tossed up over `at` that land and settle on the felt, then fade. They come
 * down round the lit things, never on them, so the cards that made the moment stay readable.
 */
function shower(stage: TableStage, at: THREE.Vector3, keepClear: Footprint[]): void {
  const n = 28;
  const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, 0.0035, 20);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05, transparent: true });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const color = new THREE.Color();
  const floor = at.y + 0.002;
  const parts = Array.from({ length: n }, (_, i) => {
    mesh.setColorAt(i, color.set(CHIP_COLORS[i % CHIP_COLORS.length]!));
    const [tx, tz] = landing(at, keepClear);
    const p = new THREE.Vector3(at.x, at.y + 0.35 + Math.random() * 0.25, at.z);
    const vy = 0.6 + Math.random() * 0.6;
    // time to fall back to the felt, so the throw lands where it was aimed
    const t = (vy + Math.sqrt(vy * vy + 19.6 * (p.y - floor))) / 9.8;
    return {
      p,
      v: new THREE.Vector3((tx - p.x) / t, vy, (tz - p.z) / t),
      spin: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      w: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
      rest: false,
    };
  });
  stage.root.add(mesh);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  let last = performance.now();
  const start = last;
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = (now - start) / 1000;
    if (age > 3.2 || !mesh.parent) {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
      return;
    }
    parts.forEach((c, i) => {
      if (!c.rest) {
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        c.spin.x += c.w.x * dt;
        c.spin.y += c.w.y * dt;
        c.spin.z += c.w.z * dt;
        if (c.p.y <= floor && c.v.y < 0) {
          c.p.y = floor;
          if (Math.abs(c.v.y) < 0.6) {
            c.rest = true;
            c.spin.set(0, c.spin.y, 0);
          } else {
            // a short hop that barely moves it, so it stays where it was aimed
            c.v.y *= -0.3;
            c.v.x *= 0.15;
            c.v.z *= 0.15;
          }
        }
      }
      mesh.setMatrixAt(i, m4.compose(c.p, q.setFromEuler(c.spin), one));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mat.opacity = age > 2.4 ? Math.max(0, 1 - (age - 2.4) / 0.8) : 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** A short rising chime through the shared master gain: longer and brighter for bigger wins. */
function chime(sfx: Sfx, tier: Tier): void {
  const ctx = sfx.audio;
  if (ctx.state !== 'running') return;
  const notes = tier === 'nice' ? [659.25, 987.77] : tier === 'big' ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
  const t0 = ctx.currentTime + 0.02;
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    const t = t0 + i * 0.09;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(sfx.out);
    o.start(t);
    o.stop(t + 0.75);
  });
  if (tier !== 'nice') sfx.play('chips-stack', { volume: 0.7, delay: 0.25 });
}
