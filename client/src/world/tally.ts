// The day's big wins on a meter, the way progressive meters hang over real slot floors: "PAID TO
// WINNERS TODAY" over the total in red seven-segment digits (the unlit segments showing through),
// and how many wins made it below. Hung over the slots hall's main aisle just inside the arch from
// the pit, one face toward the arch, one down the hall. It counts up when a new win lands.
//
// One mesh and one material (signbox.ts): one draw call. The face is a canvas texture, painted
// once and then again only while the number moves. The shader brightens only the red of the
// digits past the bloom threshold, so they glow and the lettering stays crisp.

import * as THREE from 'three';
import type { Quality } from '../render/engine3d.ts';
import { CEILING, type FloorPlan } from './layout.ts';
import { Merge, SIGN_COLORS, SIGN_VERTEX, signFragment } from './signbox.ts';

const FACE_W = 2.24;
const FACE_H = 0.7;
const BEZEL = 0.06;
const DEPTH = 0.14;
/** Clears anyone walking the aisle under it. */
const BOTTOM = 2.5;
const PX = 1024;
const PY = Math.round((PX * FACE_H) / FACE_W);
/** Digit positions on the meter; unused leading ones show as unlit eights. */
const DIGITS = 7;
/** Seconds a count-up takes. */
const COUNT_S = 2.4;

const FONTS = ['700 100px "DSEG7"', '600 40px "Cinzel"', '600 30px "Barlow Condensed"'];

/** Where the meter hangs (the plan's spot over the slots hall's aisle) and its turn: faces east and west. */
export function tallyPlacement(plan: FloorPlan): { x: number; z: number; ry: number } {
  return { ...plan.tallyAt, ry: Math.PI / 2 };
}

export class Tally {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly uniforms: { uFace: { value: THREE.Texture }; uGain: { value: number } };
  private shown = 0;
  private from = 0;
  private target = 0;
  private count = 0;
  private t = COUNT_S;
  private lastPaint = -1;

  constructor(plan: FloorPlan, quality: Quality) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PX;
    this.canvas.height = PY;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.uniforms = { uFace: { value: this.texture }, uGain: { value: gainFor(quality) } };
    const material = new THREE.ShaderMaterial({
      name: 'tally',
      uniforms: this.uniforms,
      vertexShader: SIGN_VERTEX,
      fragmentShader: FRAGMENT,
      vertexColors: true,
      toneMapped: false,
    });
    const at = tallyPlacement(plan);
    this.mesh = new THREE.Mesh(buildGeometry(), material);
    this.mesh.name = 'tally';
    this.mesh.position.set(at.x, 0, at.z);
    this.mesh.rotation.y = at.ry;
    this.paint();
    // the canvas may have been painted in a fallback face; paint again once the fonts are in
    void Promise.all(FONTS.map((f) => document.fonts?.load(f).catch(() => null))).then(() => this.paint());
  }

  /** The day's total and count. `countUp` rolls the digits up to it; otherwise it just shows it. */
  set(total: number, count: number, countUp: boolean): void {
    const dollars = Math.floor(Math.max(0, total) / 100);
    this.count = count;
    if (countUp && dollars > this.shown) {
      this.from = this.shown;
      this.target = dollars;
      this.t = 0;
    } else {
      this.shown = this.from = this.target = dollars;
      this.t = COUNT_S;
      this.paint();
    }
  }

  update(dt: number): void {
    if (this.t >= COUNT_S) return;
    this.t = Math.min(COUNT_S, this.t + dt);
    const k = 1 - (1 - this.t / COUNT_S) ** 3;
    const value = Math.round(this.from + (this.target - this.from) * k);
    // twenty repaints a second is plenty for digits rolling
    if (value !== this.shown && (this.t >= COUNT_S || this.t - this.lastPaint >= 0.05)) {
      this.shown = value;
      this.lastPaint = this.t;
      this.paint();
    }
    if (this.t >= COUNT_S) {
      this.lastPaint = -1;
      if (this.shown !== this.target) {
        this.shown = this.target;
        this.paint();
      }
    }
  }

  setQuality(q: Quality): void {
    this.uniforms.uGain.value = gainFor(q);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  private paint(): void {
    const c = this.ctx;
    const W = PX;
    const H = PY;
    c.save();
    c.fillStyle = '#0a0706';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#5c4020';
    c.lineWidth = 3;
    c.strokeRect(10, 10, W - 20, H - 20);
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    // the label
    c.font = '600 34px "Cinzel", Georgia, serif';
    c.letterSpacing = '7px';
    c.fillStyle = '#e9cf96';
    c.shadowColor = 'rgba(241, 213, 154, 0.35)';
    c.shadowBlur = 8;
    c.fillText('PAID TO WINNERS TODAY', W / 2, 52);
    c.shadowBlur = 0;
    c.letterSpacing = '0px';

    // the meter: "$" then DIGITS seven-segment positions with commas between thousands
    const digits = String(this.shown);
    const n = Math.max(DIGITS, digits.length);
    const padded = digits.padStart(n, ' ');
    const size = 124;
    c.font = `700 ${size}px "DSEG7", ui-monospace, monospace`;
    const dw = c.measureText('8').width;
    const comma = size * 0.2;
    const commas = Math.floor((n - 1) / 3);
    const dollarW = size * 0.5;
    const total = dollarW + n * dw + commas * comma;
    let x = (W - total) / 2;
    const y = H * 0.55;
    const lit = '#ff2d16';
    const ghost = '#1c0604';
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const base = y + size * 0.5;
    // the dollar sign isn't in a seven-segment font; it is printed on the glass in the same red
    c.font = `600 ${Math.round(size * 0.78)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    c.fillStyle = lit;
    c.shadowColor = lit;
    c.shadowBlur = 16;
    c.fillText('$', x, base - size * 0.02);
    x += dollarW;
    c.font = `700 ${size}px "DSEG7", ui-monospace, monospace`;
    for (let i = 0; i < n; i++) {
      c.shadowBlur = 0;
      c.fillStyle = ghost;
      c.fillText('8', x, base);
      const ch = padded[i]!;
      if (ch !== ' ') {
        c.fillStyle = lit;
        c.shadowBlur = 16;
        c.fillText(ch, x, base);
      }
      x += dw;
      const left = n - 1 - i;
      if (left > 0 && left % 3 === 0) {
        // a comma segment between thousands, lit once the digits reach it
        c.shadowBlur = padded[i] !== ' ' ? 12 : 0;
        c.fillStyle = padded[i] !== ' ' ? lit : ghost;
        c.beginPath();
        c.moveTo(x + comma * 0.25, base - size * 0.02);
        c.lineTo(x + comma * 0.62, base - size * 0.02);
        c.lineTo(x + comma * 0.3, base + size * 0.14);
        c.lineTo(x + comma * 0.08, base + size * 0.14);
        c.closePath();
        c.fill();
        x += comma;
      }
    }

    // how many made it
    c.shadowBlur = 0;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '600 28px "Barlow Condensed", "Arial Narrow", sans-serif';
    c.letterSpacing = '4px';
    c.fillStyle = '#b9ad95';
    c.fillText(`${this.count} BIG WIN${this.count === 1 ? '' : 'S'} SINCE MIDNIGHT`, W / 2, H - 44);
    c.restore();
    this.texture.needsUpdate = true;
  }
}

function gainFor(q: Quality): number {
  return q === 'high' ? 2.3 : 1.4;
}

/** The meter round its own middle (the mesh stands it in place). */
function buildGeometry(): THREE.BufferGeometry {
  const x = 0;
  const z = 0;
  const out = new Merge();
  const H = FACE_H + 2 * BEZEL;
  const cy = BOTTOM + H / 2;
  out.box(x, cy, z, FACE_W + 2 * BEZEL, H, DEPTH, SIGN_COLORS.body);
  for (const side of [1, -1]) {
    const fz = z + side * (DEPTH / 2 + 0.004);
    const t = 0.016;
    out.box(x, cy + FACE_H / 2 + t / 2, fz, FACE_W + 2 * t, t, 0.008, SIGN_COLORS.brass);
    out.box(x, cy - FACE_H / 2 - t / 2, fz, FACE_W + 2 * t, t, 0.008, SIGN_COLORS.brass);
    out.box(x - FACE_W / 2 - t / 2, cy, fz, t, FACE_H, 0.008, SIGN_COLORS.brass);
    out.box(x + FACE_W / 2 + t / 2, cy, fz, t, FACE_H, 0.008, SIGN_COLORS.brass);
  }
  for (const rx of [x - FACE_W / 2 + 0.25, x + FACE_W / 2 - 0.25]) out.rod(rx, z, cy + H / 2, CEILING, SIGN_COLORS.chrome, SIGN_COLORS.brass);
  out.face(x, cy, z + DEPTH / 2 + 0.003, FACE_W, FACE_H, 0);
  out.face(x, cy, z - DEPTH / 2 - 0.003, FACE_W, FACE_H, Math.PI);
  return out.build();
}

// The digits are the only strongly red parts of the face: brighten those past the bloom threshold.
const FRAGMENT = signFragment(
  /* glsl */ `
  uniform sampler2D uFace;
  uniform float uGain;`,
  /* glsl */ `
      vec3 t = texture2D(uFace, vUv).rgb;
      float red = clamp((t.r - max(t.g, t.b) * 1.6) * 2.5, 0.0, 1.0);
      c = t * mix(0.92, uGain, red);`,
);
