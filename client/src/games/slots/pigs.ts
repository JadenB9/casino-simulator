// Straw, Sticks & Bricks' look: a barn-red cabinet with straw-gold trim under a gabled roof, the
// three little pigs, the wolf and a farmyard's things painted on a dusk-blue screen, and the
// houses (straw, sticks, brick and the gold mansion they can be rebuilt into). All drawn here in
// canvas paths; the Blowdown's board and the wolf's breath are pigs-bonus.ts.

import * as THREE from 'three';
import { PIGS, type PigSymbol } from '../../../../shared/src/games/slots/pigs.ts';
import { at, box, merge, panel, slab } from './cabinet.ts';
import { registerSkin } from './build.ts';
import { disclaimers, roundRect, text, type OverlaySpec, type Skin, type SkinLayout, type TopperParts } from './skin.ts';

type G = CanvasRenderingContext2D;

export const DUSK = '#16223a';
const BARN = '#7a2418';
const STRAW = '#e8c35a';
const TIMBER = '#7a5230';
const BRICK = '#a4472e';
const CREAM = '#f6ecd2';
const INK = '#1c1208';

// ---------------------------------------------------------------------------------------------
// small painters

function path(g: G, pts: readonly (readonly [number, number])[], s: number): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
  g.closePath();
}

function vgrad(g: G, y0: number, y1: number, top: string, bottom: string): CanvasGradient {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  return grad;
}

function disc(g: G, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

/** A seeded scatter, so painted texture (straw, brick mortar) is the same every time. */
function seeded(seed: number): () => number {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) / 2147483647);
}

// ---------------------------------------------------------------------------------------------
// the pigs: one face, three hats and three medallions

function pigFace(g: G, s: number): void {
  // ears
  for (const k of [-1, 1]) {
    path(g, [[k * 0.14, -0.2], [k * 0.33, -0.3], [k * 0.3, -0.06]], s);
    g.fillStyle = '#e98a9a';
    g.fill();
    g.strokeStyle = '#8a3a48';
    g.lineWidth = s * 0.018;
    g.stroke();
    path(g, [[k * 0.18, -0.19], [k * 0.3, -0.26], [k * 0.28, -0.1]], s);
    g.fillStyle = '#c96677';
    g.fill();
  }
  // head
  g.beginPath();
  g.ellipse(0, 0.04 * s, 0.31 * s, 0.27 * s, 0, 0, Math.PI * 2);
  const head = g.createRadialGradient(-0.08 * s, -0.04 * s, 0.02 * s, 0, 0.04 * s, 0.34 * s);
  head.addColorStop(0, '#ffd6db');
  head.addColorStop(1, '#e98796');
  g.fillStyle = head;
  g.fill();
  g.strokeStyle = '#8a3a48';
  g.lineWidth = s * 0.02;
  g.stroke();
  // cheeks
  g.fillStyle = 'rgba(230,90,110,0.35)';
  for (const k of [-1, 1]) {
    g.beginPath();
    g.ellipse(k * 0.19 * s, 0.1 * s, 0.06 * s, 0.04 * s, 0, 0, Math.PI * 2);
    g.fill();
  }
  // eyes
  for (const k of [-1, 1]) {
    disc(g, k * 0.11 * s, -0.02 * s, 0.035 * s, '#1a0c0f');
    disc(g, k * 0.11 * s - 0.01 * s, -0.032 * s, 0.012 * s, '#ffffff');
  }
  // snout
  g.beginPath();
  g.ellipse(0, 0.12 * s, 0.13 * s, 0.09 * s, 0, 0, Math.PI * 2);
  g.fillStyle = vgrad(g, 0.03 * s, 0.21 * s, '#f7a6b2', '#e37b8c');
  g.fill();
  g.strokeStyle = '#8a3a48';
  g.lineWidth = s * 0.016;
  g.stroke();
  for (const k of [-1, 1]) {
    g.beginPath();
    g.ellipse(k * 0.045 * s, 0.12 * s, 0.022 * s, 0.035 * s, 0, 0, Math.PI * 2);
    g.fillStyle = '#8a3a48';
    g.fill();
  }
  // a small smile
  g.beginPath();
  g.arc(0, 0.2 * s, 0.07 * s, 0.2 * Math.PI, 0.8 * Math.PI);
  g.strokeStyle = '#8a3a48';
  g.lineWidth = s * 0.014;
  g.stroke();
}

function medallion(g: G, s: number, ring: string, face: string): void {
  disc(g, 0, 0.02 * s, 0.45 * s, ring);
  disc(g, 0, 0.02 * s, 0.4 * s, face);
}

function strawHat(g: G, s: number): void {
  g.beginPath();
  g.ellipse(0, -0.2 * s, 0.34 * s, 0.07 * s, 0, 0, Math.PI * 2);
  g.fillStyle = vgrad(g, -0.27 * s, -0.13 * s, '#fbe08a', '#c89a2e');
  g.fill();
  g.strokeStyle = '#7a5a10';
  g.lineWidth = s * 0.015;
  g.stroke();
  roundRect(g, -0.18 * s, -0.36 * s, 0.36 * s, 0.16 * s, 0.05 * s);
  g.fillStyle = vgrad(g, -0.36 * s, -0.2 * s, '#fbe08a', '#d8ab3a');
  g.fill();
  g.stroke();
  g.fillStyle = '#b3261e';
  g.fillRect(-0.18 * s, -0.25 * s, 0.36 * s, 0.045 * s);
  g.strokeStyle = 'rgba(122,90,16,0.5)';
  g.lineWidth = s * 0.008;
  for (let i = -3; i <= 3; i++) {
    g.beginPath();
    g.moveTo(i * 0.045 * s, -0.35 * s);
    g.lineTo(i * 0.05 * s, -0.26 * s);
    g.stroke();
  }
}

function feltHat(g: G, s: number): void {
  path(g, [[-0.3, -0.18], [0.3, -0.18], [0.22, -0.22], [0.14, -0.4], [-0.16, -0.38], [-0.22, -0.22]], s);
  g.fillStyle = vgrad(g, -0.4 * s, -0.18 * s, '#5d8f4c', '#2f5627');
  g.fill();
  g.strokeStyle = '#1c3316';
  g.lineWidth = s * 0.016;
  g.stroke();
  g.fillStyle = '#6a4424';
  g.fillRect(-0.2 * s, -0.25 * s, 0.4 * s, 0.04 * s);
  // a feather
  g.beginPath();
  g.moveTo(0.12 * s, -0.25 * s);
  g.quadraticCurveTo(0.34 * s, -0.46 * s, 0.4 * s, -0.5 * s);
  g.quadraticCurveTo(0.3 * s, -0.36 * s, 0.14 * s, -0.25 * s);
  g.fillStyle = '#d9502e';
  g.fill();
}

function builderCap(g: G, s: number): void {
  g.beginPath();
  g.moveTo(-0.26 * s, -0.17 * s);
  g.quadraticCurveTo(-0.24 * s, -0.42 * s, 0, -0.42 * s);
  g.quadraticCurveTo(0.24 * s, -0.42 * s, 0.26 * s, -0.17 * s);
  g.closePath();
  g.fillStyle = vgrad(g, -0.42 * s, -0.17 * s, '#e0613e', '#8f2c16');
  g.fill();
  g.strokeStyle = '#4a1508';
  g.lineWidth = s * 0.016;
  g.stroke();
  // the peak
  g.beginPath();
  g.ellipse(0, -0.17 * s, 0.34 * s, 0.05 * s, 0, 0, Math.PI * 2);
  g.fillStyle = '#b33a1e';
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(-0.12 * s, -0.37 * s, 0.1 * s, 0.03 * s);
}

function brickTexture(g: G, x: number, y: number, w: number, h: number, rows: number, face = BRICK): void {
  g.fillStyle = '#d8c7a8';
  g.fillRect(x, y, w, h);
  const bh = h / rows;
  const bw = bh * 2.2;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let bx = x - off; bx < x + w; bx += bw) {
      const x0 = Math.max(x, bx) + 0.8, x1 = Math.min(x + w, bx + bw) - 0.8;
      if (x1 <= x0) continue;
      g.fillStyle = face;
      g.fillRect(x0, y + r * bh + 0.8, x1 - x0, bh - 1.6);
    }
  }
}

function pig(g: G, s: number, kind: 'straw' | 'stick' | 'brick'): void {
  if (kind === 'straw') medallion(g, s, '#c89a2e', '#fff1c4');
  else if (kind === 'stick') medallion(g, s, TIMBER, '#e9dcc2');
  else {
    disc(g, 0, 0.02 * s, 0.45 * s, '#5a1c0e');
    g.save();
    g.beginPath();
    g.arc(0, 0.02 * s, 0.4 * s, 0, Math.PI * 2);
    g.clip();
    brickTexture(g, -0.42 * s, -0.4 * s, 0.84 * s, 0.84 * s, 7, '#b85a3c');
    g.fillStyle = 'rgba(255,240,220,0.35)';
    g.fillRect(-0.42 * s, -0.4 * s, 0.84 * s, 0.84 * s);
    g.restore();
  }
  g.save();
  g.translate(0, 0.05 * s);
  pigFace(g, s * 0.95);
  if (kind === 'straw') strawHat(g, s * 0.95);
  else if (kind === 'stick') feltHat(g, s * 0.95);
  else builderCap(g, s * 0.95);
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// the wolf (the wild)

export function wolfHead(g: G, s: number, blowing = 0): void {
  // ears
  for (const k of [-1, 1]) {
    path(g, [[k * 0.1, -0.2], [k * 0.3, -0.44], [k * 0.34, -0.1]], s);
    g.fillStyle = '#3e4753';
    g.fill();
    path(g, [[k * 0.15, -0.2], [k * 0.28, -0.36], [k * 0.3, -0.14]], s);
    g.fillStyle = '#b67c7c';
    g.fill();
  }
  // head with ruffled cheeks
  path(g, [[0, -0.28], [0.22, -0.22], [0.34, -0.06], [0.4, 0.08], [0.3, 0.1], [0.34, 0.2], [0.18, 0.2], [0, 0.34], [-0.18, 0.2], [-0.34, 0.2], [-0.3, 0.1], [-0.4, 0.08], [-0.34, -0.06], [-0.22, -0.22]], s);
  const fur = g.createRadialGradient(0, -0.08 * s, 0.03 * s, 0, 0, 0.42 * s);
  fur.addColorStop(0, '#8e98a6');
  fur.addColorStop(1, '#4a5360');
  g.fillStyle = fur;
  g.fill();
  g.strokeStyle = '#1f252d';
  g.lineWidth = s * 0.02;
  g.stroke();
  // muzzle
  path(g, [[-0.13, 0.0], [0.13, 0.0], [0.1, 0.24], [0, 0.3], [-0.1, 0.24]], s);
  g.fillStyle = vgrad(g, 0, 0.3 * s, '#d9dde2', '#aeb5be');
  g.fill();
  g.stroke();
  // brows and eyes: yellow, narrowed
  for (const k of [-1, 1]) {
    path(g, [[k * 0.06, -0.06], [k * 0.2, -0.1], [k * 0.19, -0.04], [k * 0.07, -0.02]], s);
    g.fillStyle = '#f2c14a';
    g.fill();
    disc(g, k * 0.13 * s, -0.055 * s, 0.018 * s, '#140c02');
    g.beginPath();
    g.moveTo(k * 0.04 * s, -0.1 * s);
    g.lineTo(k * 0.22 * s, -0.15 * s);
    g.strokeStyle = '#1f252d';
    g.lineWidth = s * 0.03;
    g.stroke();
  }
  // nose
  g.beginPath();
  g.ellipse(0, 0.06 * s, 0.06 * s, 0.04 * s, 0, 0, Math.PI * 2);
  g.fillStyle = '#111';
  g.fill();
  // mouth: a grin, or the round O of a big breath
  if (blowing > 0) {
    g.beginPath();
    g.ellipse(0, 0.2 * s, 0.04 * s * (1 + blowing), 0.04 * s * (1 + blowing), 0, 0, Math.PI * 2);
    g.fillStyle = '#3a0d10';
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(-0.08 * s, 0.18 * s);
    g.quadraticCurveTo(0, 0.24 * s, 0.08 * s, 0.18 * s);
    g.strokeStyle = '#111';
    g.lineWidth = s * 0.018;
    g.stroke();
    g.fillStyle = '#ffffff';
    for (const k of [-1, 1]) {
      path(g, [[k * 0.05, 0.19], [k * 0.07, 0.19], [k * 0.06, 0.23]], s);
      g.fill();
    }
  }
}

function wolfWild(g: G, s: number): void {
  // a pale moon behind him, the night round it
  disc(g, 0, -0.02 * s, 0.44 * s, '#0c1426');
  const moon = g.createRadialGradient(0.08 * s, -0.1 * s, 0.02 * s, 0, -0.02 * s, 0.42 * s);
  moon.addColorStop(0, '#fffbe8');
  moon.addColorStop(1, '#c9c3a4');
  disc(g, 0, -0.02 * s, 0.38 * s, moon);
  g.save();
  g.translate(0, -0.04 * s);
  wolfHead(g, s * 0.82);
  g.restore();
  roundRect(g, -0.3 * s, 0.26 * s, 0.6 * s, 0.17 * s, 0.04 * s);
  g.fillStyle = BARN;
  g.fill();
  g.strokeStyle = STRAW;
  g.lineWidth = s * 0.02;
  g.stroke();
  text(g, 'WILD', 0, 0.35 * s, `${0.15 * s}px Limelight, serif`, STRAW);
}

// ---------------------------------------------------------------------------------------------
// the houses

function ground(g: G, s: number): void {
  g.beginPath();
  g.ellipse(0, 0.33 * s, 0.4 * s, 0.07 * s, 0, 0, Math.PI * 2);
  g.fillStyle = '#3f6b33';
  g.fill();
}

function door(g: G, s: number, x: number, y: number, w: number, h: number, color: string): void {
  g.beginPath();
  g.moveTo((x - w / 2) * s, (y + h) * s);
  g.lineTo((x - w / 2) * s, (y + w / 2) * s);
  g.arc(x * s, (y + w / 2) * s, (w / 2) * s, Math.PI, 0);
  g.lineTo((x + w / 2) * s, (y + h) * s);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function strawHouse(g: G, s: number): void {
  ground(g, s);
  // walls: bundled straw
  g.fillStyle = vgrad(g, -0.02 * s, 0.32 * s, '#f0cf6a', '#c79a2c');
  g.fillRect(-0.28 * s, -0.02 * s, 0.56 * s, 0.34 * s);
  // a domed thatch roof
  g.beginPath();
  g.moveTo(-0.38 * s, 0.02 * s);
  g.quadraticCurveTo(-0.34 * s, -0.4 * s, 0, -0.42 * s);
  g.quadraticCurveTo(0.34 * s, -0.4 * s, 0.38 * s, 0.02 * s);
  g.closePath();
  g.fillStyle = vgrad(g, -0.42 * s, 0.02 * s, '#fbe08a', '#b8862a');
  g.fill();
  g.strokeStyle = '#6e4e0e';
  g.lineWidth = s * 0.018;
  g.stroke();
  const rnd = seeded(11);
  g.strokeStyle = 'rgba(110,78,14,0.55)';
  g.lineWidth = s * 0.008;
  for (let i = 0; i < 26; i++) {
    const x = (rnd() - 0.5) * 0.64;
    const y = -0.3 + rnd() * 0.3;
    g.beginPath();
    g.moveTo(x * s, y * s);
    g.lineTo((x + (rnd() - 0.5) * 0.05) * s, (y + 0.08) * s);
    g.stroke();
  }
  for (let i = 0; i < 18; i++) {
    const x = -0.26 + rnd() * 0.52;
    g.beginPath();
    g.moveTo(x * s, 0.02 * s);
    g.lineTo((x + (rnd() - 0.5) * 0.03) * s, 0.3 * s);
    g.stroke();
  }
  door(g, s, 0, 0.1, 0.13, 0.22, '#5a3a12');
}

function stickHouse(g: G, s: number): void {
  ground(g, s);
  // walls: upright sticks
  const rnd = seeded(23);
  for (let x = -0.28; x < 0.28; x += 0.05) {
    g.fillStyle = rnd() > 0.5 ? '#8a5a32' : '#6f4524';
    g.fillRect(x * s, (-0.02 + rnd() * 0.02) * s, 0.044 * s, 0.34 * s);
  }
  g.strokeStyle = '#3a2210';
  g.lineWidth = s * 0.02;
  g.beginPath();
  g.moveTo(-0.29 * s, 0.08 * s);
  g.lineTo(0.29 * s, 0.1 * s);
  g.moveTo(-0.29 * s, 0.22 * s);
  g.lineTo(0.29 * s, 0.2 * s);
  g.stroke();
  // a pitched roof of crossed sticks
  path(g, [[-0.38, 0.0], [0, -0.38], [0.38, 0.0]], s);
  g.fillStyle = '#5c3a1c';
  g.fill();
  g.strokeStyle = '#2a170a';
  g.stroke();
  g.lineWidth = s * 0.014;
  g.strokeStyle = '#a8764a';
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    g.beginPath();
    g.moveTo((-0.34 + t * 0.34) * s, (-0.03 - t * 0.31) * s);
    g.lineTo((-0.34 + t * 0.34 + 0.2) * s, (-0.03 - t * 0.31 + 0.2) * s);
    g.stroke();
  }
  // the crossed poles over the ridge
  g.strokeStyle = '#3a2210';
  g.lineWidth = s * 0.03;
  g.beginPath();
  g.moveTo(-0.08 * s, -0.46 * s);
  g.lineTo(0.06 * s, -0.32 * s);
  g.moveTo(0.08 * s, -0.46 * s);
  g.lineTo(-0.06 * s, -0.32 * s);
  g.stroke();
  door(g, s, 0.02, 0.12, 0.12, 0.2, '#2a170a');
}

function brickHouse(g: G, s: number): void {
  ground(g, s);
  // chimney
  brickTexture(g, 0.14 * s, -0.4 * s, 0.1 * s, 0.2 * s, 4);
  // walls
  brickTexture(g, -0.28 * s, -0.06 * s, 0.56 * s, 0.38 * s, 7);
  g.strokeStyle = '#4a1a0c';
  g.lineWidth = s * 0.018;
  g.strokeRect(-0.28 * s, -0.06 * s, 0.56 * s, 0.38 * s);
  // slate roof
  path(g, [[-0.36, -0.04], [0, -0.34], [0.36, -0.04]], s);
  g.fillStyle = vgrad(g, -0.34 * s, -0.04 * s, '#5d6a78', '#353d47');
  g.fill();
  g.stroke();
  // lit window and door
  g.fillStyle = '#ffd98a';
  g.fillRect(-0.2 * s, 0.02 * s, 0.12 * s, 0.1 * s);
  g.strokeStyle = '#2a1208';
  g.lineWidth = s * 0.012;
  g.strokeRect(-0.2 * s, 0.02 * s, 0.12 * s, 0.1 * s);
  g.beginPath();
  g.moveTo(-0.14 * s, 0.02 * s);
  g.lineTo(-0.14 * s, 0.12 * s);
  g.stroke();
  g.fillStyle = '#3a2412';
  g.fillRect(0.04 * s, 0.08 * s, 0.13 * s, 0.24 * s);
  disc(g, 0.14 * s, 0.2 * s, 0.01 * s, STRAW);
}

/** The gold mansion: only ever rebuilt from brick in the Blowdown. */
export function mansion(g: G, s: number): void {
  ground(g, s);
  const gold = (y0: number, y1: number) => vgrad(g, y0 * s, y1 * s, '#fff2b0', '#b8860b');
  // two wings and the centre block
  g.fillStyle = gold(-0.1, 0.32);
  g.fillRect(-0.38 * s, -0.06 * s, 0.2 * s, 0.38 * s);
  g.fillRect(0.18 * s, -0.06 * s, 0.2 * s, 0.38 * s);
  g.fillStyle = gold(-0.2, 0.32);
  g.fillRect(-0.2 * s, -0.16 * s, 0.4 * s, 0.48 * s);
  g.strokeStyle = '#6a4a05';
  g.lineWidth = s * 0.016;
  g.strokeRect(-0.38 * s, -0.06 * s, 0.2 * s, 0.38 * s);
  g.strokeRect(0.18 * s, -0.06 * s, 0.2 * s, 0.38 * s);
  g.strokeRect(-0.2 * s, -0.16 * s, 0.4 * s, 0.48 * s);
  // pediment and columns
  path(g, [[-0.24, -0.16], [0, -0.38], [0.24, -0.16]], s);
  g.fillStyle = gold(-0.38, -0.16);
  g.fill();
  g.stroke();
  for (const x of [-0.15, -0.05, 0.05, 0.15]) {
    g.fillStyle = '#fff6d0';
    g.fillRect((x - 0.018) * s, -0.12 * s, 0.036 * s, 0.4 * s);
  }
  // windows lit
  g.fillStyle = '#fff7c4';
  for (const x of [-0.33, -0.25, 0.23, 0.31]) for (const y of [0.0, 0.14]) g.fillRect(x * s, y * s, 0.05 * s, 0.07 * s);
  // a star on the pediment
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = (i % 2 ? 0.02 : 0.05) * s;
    g.lineTo(Math.cos(a) * r, -0.25 * s + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}

/** A house by grade: 0 straw, 1 sticks, 2 brick, 3 the gold mansion. */
export function house(g: G, grade: number, s: number): void {
  if (grade <= 0) strawHouse(g, s);
  else if (grade === 1) stickHouse(g, s);
  else if (grade === 2) brickHouse(g, s);
  else mansion(g, s);
}

// ---------------------------------------------------------------------------------------------
// the farmyard pictures

function pot(g: G, s: number): void {
  // flames under it
  for (const [x, h] of [[-0.14, 0.12], [0, 0.16], [0.14, 0.11]] as const) {
    g.beginPath();
    g.moveTo((x - 0.06) * s, 0.36 * s);
    g.quadraticCurveTo((x - 0.04) * s, (0.36 - h) * s, x * s, (0.3 - h) * s);
    g.quadraticCurveTo((x + 0.04) * s, (0.36 - h) * s, (x + 0.06) * s, 0.36 * s);
    g.closePath();
    g.fillStyle = vgrad(g, (0.3 - h) * s, 0.36 * s, '#ffe27a', '#e0501e');
    g.fill();
  }
  // the pot
  g.beginPath();
  g.moveTo(-0.34 * s, -0.08 * s);
  g.quadraticCurveTo(-0.38 * s, 0.3 * s, 0, 0.3 * s);
  g.quadraticCurveTo(0.38 * s, 0.3 * s, 0.34 * s, -0.08 * s);
  g.closePath();
  const iron = g.createRadialGradient(-0.12 * s, 0.02 * s, 0.02 * s, 0, 0.08 * s, 0.4 * s);
  iron.addColorStop(0, '#6a6f78');
  iron.addColorStop(1, '#16181c');
  g.fillStyle = iron;
  g.fill();
  g.beginPath();
  g.ellipse(0, -0.08 * s, 0.36 * s, 0.07 * s, 0, 0, Math.PI * 2);
  g.fillStyle = '#2a2d33';
  g.fill();
  g.strokeStyle = '#8a9099';
  g.lineWidth = s * 0.02;
  g.stroke();
  // steam
  g.strokeStyle = 'rgba(240,240,240,0.8)';
  g.lineWidth = s * 0.03;
  g.lineCap = 'round';
  for (const x of [-0.12, 0.04, 0.18]) {
    g.beginPath();
    g.moveTo(x * s, -0.14 * s);
    g.bezierCurveTo((x - 0.06) * s, -0.22 * s, (x + 0.06) * s, -0.3 * s, x * s, -0.4 * s);
    g.stroke();
  }
  g.lineCap = 'butt';
}

function churn(g: G, s: number): void {
  // the dasher's handle
  g.fillStyle = '#b07a45';
  g.fillRect(-0.025 * s, -0.46 * s, 0.05 * s, 0.24 * s);
  disc(g, 0, -0.46 * s, 0.04 * s, '#8a5a30');
  // the tub: tapered staves
  path(g, [[-0.2, -0.24], [0.2, -0.24], [0.27, 0.34], [-0.27, 0.34]], s);
  g.fillStyle = vgrad(g, -0.24 * s, 0.34 * s, '#c89060', '#7a4a24');
  g.fill();
  g.strokeStyle = '#3a2010';
  g.lineWidth = s * 0.018;
  g.stroke();
  g.strokeStyle = 'rgba(58,32,16,0.5)';
  g.lineWidth = s * 0.01;
  for (const t of [-0.6, -0.2, 0.2, 0.6]) {
    g.beginPath();
    g.moveTo(t * 0.2 * s, -0.24 * s);
    g.lineTo(t * 0.27 * s, 0.34 * s);
    g.stroke();
  }
  // iron hoops
  g.strokeStyle = '#3b3f46';
  g.lineWidth = s * 0.035;
  for (const [y, w] of [[-0.14, 0.215], [0.22, 0.255]] as const) {
    g.beginPath();
    g.moveTo(-w * s, y * s);
    g.lineTo(w * s, y * s);
    g.stroke();
  }
  // the lid
  g.beginPath();
  g.ellipse(0, -0.24 * s, 0.21 * s, 0.05 * s, 0, 0, Math.PI * 2);
  g.fillStyle = '#9a6a3c';
  g.fill();
  g.strokeStyle = '#3a2010';
  g.lineWidth = s * 0.015;
  g.stroke();
}

function apple(g: G, s: number): void {
  g.beginPath();
  g.moveTo(0, -0.18 * s);
  g.bezierCurveTo(0.2 * s, -0.34 * s, 0.44 * s, -0.12 * s, 0.34 * s, 0.12 * s);
  g.bezierCurveTo(0.26 * s, 0.34 * s, 0.1 * s, 0.38 * s, 0, 0.3 * s);
  g.bezierCurveTo(-0.1 * s, 0.38 * s, -0.26 * s, 0.34 * s, -0.34 * s, 0.12 * s);
  g.bezierCurveTo(-0.44 * s, -0.12 * s, -0.2 * s, -0.34 * s, 0, -0.18 * s);
  g.closePath();
  const skin = g.createRadialGradient(-0.12 * s, -0.08 * s, 0.03 * s, 0, 0.04 * s, 0.42 * s);
  skin.addColorStop(0, '#ff6b5a');
  skin.addColorStop(0.6, '#c81d1d');
  skin.addColorStop(1, '#6e0a0a');
  g.fillStyle = skin;
  g.fill();
  g.strokeStyle = '#3e0505';
  g.lineWidth = s * 0.018;
  g.stroke();
  g.beginPath();
  g.ellipse(-0.16 * s, -0.06 * s, 0.05 * s, 0.1 * s, 0.5, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fill();
  // stem and leaf
  g.strokeStyle = '#4a2a10';
  g.lineWidth = s * 0.03;
  g.beginPath();
  g.moveTo(0, -0.18 * s);
  g.quadraticCurveTo(0.02 * s, -0.3 * s, 0.06 * s, -0.36 * s);
  g.stroke();
  g.beginPath();
  g.moveTo(0.04 * s, -0.3 * s);
  g.quadraticCurveTo(0.22 * s, -0.42 * s, 0.3 * s, -0.3 * s);
  g.quadraticCurveTo(0.16 * s, -0.24 * s, 0.04 * s, -0.3 * s);
  g.fillStyle = '#4f9a3a';
  g.fill();
}

function turnip(g: G, s: number): void {
  // leaves
  for (const [a, c] of [[-0.5, '#3f8a2a'], [0, '#58a83c'], [0.5, '#3f8a2a']] as const) {
    g.save();
    g.translate(0, -0.16 * s);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(-0.1 * s, -0.16 * s, 0, -0.3 * s);
    g.quadraticCurveTo(0.1 * s, -0.16 * s, 0, 0);
    g.fillStyle = c;
    g.fill();
    g.restore();
  }
  // the root: purple shoulders fading to white, a tail
  g.beginPath();
  g.moveTo(0, -0.18 * s);
  g.bezierCurveTo(0.34 * s, -0.18 * s, 0.34 * s, 0.18 * s, 0.03 * s, 0.3 * s);
  g.lineTo(0, 0.42 * s);
  g.lineTo(-0.03 * s, 0.3 * s);
  g.bezierCurveTo(-0.34 * s, 0.18 * s, -0.34 * s, -0.18 * s, 0, -0.18 * s);
  g.closePath();
  const grad = g.createLinearGradient(0, -0.18 * s, 0, 0.34 * s);
  grad.addColorStop(0, '#7c2f8e');
  grad.addColorStop(0.45, '#c79ad2');
  grad.addColorStop(0.6, '#f6f0f6');
  grad.addColorStop(1, '#e2d8e2');
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = '#3e1846';
  g.lineWidth = s * 0.016;
  g.stroke();
}

// ---------------------------------------------------------------------------------------------

export function drawPigs(g: G, sym: string, w: number, h: number): void {
  const s = Math.min(w, h);
  switch (sym as PigSymbol) {
    case 'WOLF':
      wolfWild(g, s);
      break;
    case 'BRICKPIG':
      pig(g, s, 'brick');
      break;
    case 'STICKPIG':
      pig(g, s, 'stick');
      break;
    case 'STRAWPIG':
      pig(g, s, 'straw');
      break;
    case 'POT':
      pot(g, s);
      break;
    case 'CHURN':
      churn(g, s);
      break;
    case 'APPLE':
      apple(g, s);
      break;
    case 'TURNIP':
      turnip(g, s);
      break;
    case 'STRAW':
      strawHouse(g, s);
      break;
    case 'STICKS':
      stickHouse(g, s);
      break;
    case 'BRICK':
      brickHouse(g, s);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// printed glass

const PAY_ORDER: PigSymbol[] = ['BRICKPIG', 'STICKPIG', 'STRAWPIG', 'POT', 'CHURN', 'APPLE', 'TURNIP'];

function boards(g: G, w: number, h: number, base: string): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const rnd = seeded(7);
  for (let x = 0; x < w; x += 64) {
    g.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.1})`;
    g.fillRect(x, 0, 3, h);
    for (let i = 0; i < 5; i++) {
      g.strokeStyle = `rgba(255,220,190,${0.03 + rnd() * 0.04})`;
      g.lineWidth = 1.5;
      g.beginPath();
      const xx = x + 8 + rnd() * 48;
      g.moveTo(xx, 0);
      g.bezierCurveTo(xx + (rnd() - 0.5) * 10, h * 0.3, xx + (rnd() - 0.5) * 10, h * 0.7, xx, h);
      g.stroke();
    }
  }
}

function strawFrame(g: G, w: number, h: number): void {
  g.strokeStyle = STRAW;
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.strokeStyle = 'rgba(122,90,16,0.8)';
  g.lineWidth = 2;
  g.strokeRect(18, 18, w - 36, h - 36);
}

function title(g: G, x: number, y: number, px: number): void {
  text(g, 'STRAW, STICKS & BRICKS', x, y, `${px}px Limelight, serif`, STRAW, { stroke: INK, strokeWidth: Math.round(px / 7) });
}

function payGlass(g: G, w: number, h: number): void {
  boards(g, w, h, '#34110a');
  strawFrame(g, w, h);
  title(g, w / 2, 54, 50);
  const colW = (w - 80) / 3;
  const rowH = 104;
  PAY_ORDER.forEach((sym, i) => {
    const col = i < 6 ? i % 3 : 1;
    const cx = 40 + col * colW, cy = 88 + Math.floor(i / 3) * rowH;
    g.save();
    g.translate(cx + 54, cy + rowH / 2);
    drawPigs(g, sym, 88, 88);
    g.restore();
    const pays = PIGS.linePays[sym]!;
    [5, 4, 3].forEach((n, k) => {
      const y = cy + 24 + k * 28;
      text(g, String(n), cx + 114, y, `600 20px 'Barlow Condensed', sans-serif`, '#f2c98a', { align: 'left' });
      text(g, pays[n - 2]!.toLocaleString('en-US'), cx + 134, y, `600 25px 'Barlow Condensed', sans-serif`, CREAM, { align: 'left' });
    });
  });
  // the wolf's note beside the turnip row
  g.save();
  g.translate(40 + 54, 88 + 2 * rowH + rowH / 2);
  drawPigs(g, 'WOLF', 84, 84);
  g.restore();
  text(g, 'WILD ON 2-5', 40 + 150, 88 + 2 * rowH + rowH / 2, `600 22px 'Barlow Condensed', sans-serif`, STRAW, { align: 'left' });
  const y0 = 88 + 3 * rowH + 6;
  text(g, '6 OR MORE HOUSES ANYWHERE START THE BLOWDOWN', w / 2, y0 + 10, `600 25px 'Barlow Condensed', sans-serif`, STRAW);
  text(g, 'HOUSES HOLD · 3 SPINS · A NEW HOUSE PUTS IT BACK TO 3 · THE WOLF BLOWS EACH ONE DOWN FOR ITS PRIZE', w / 2, y0 + 40, `600 18px 'Barlow Condensed', sans-serif`, CREAM);
  text(g, 'STRAW 1-3x  ·  STICKS 2-8x  ·  BRICK 5-20x  ·  GOLD MANSION 50x  ·  ALL 15: THE WHOLE STREET 1,000x', w / 2, y0 + 66, `600 18px 'Barlow Condensed', sans-serif`, '#f2c98a');
}

function belly(g: G, w: number, h: number): void {
  // dusk over a hill, three houses on it, the wolf's shadow coming over the rise
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0e1830');
  sky.addColorStop(0.55, '#3a3d6a');
  sky.addColorStop(0.8, '#c9765a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const rnd = seeded(5);
  g.fillStyle = 'rgba(255,255,240,0.8)';
  for (let i = 0; i < 40; i++) g.fillRect(rnd() * w, rnd() * h * 0.4, 2, 2);
  const moon = g.createRadialGradient(w * 0.8, h * 0.2, 4, w * 0.8, h * 0.2, 70);
  moon.addColorStop(0, '#fffbe8');
  moon.addColorStop(1, '#d9d2b0');
  disc(g, w * 0.8, h * 0.2, 56, moon);
  g.beginPath();
  g.moveTo(0, h * 0.72);
  g.quadraticCurveTo(w * 0.5, h * 0.5, w, h * 0.7);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fillStyle = '#2c4a26';
  g.fill();
  const spots = [[w * 0.28, h * 0.6, 170, 0], [w * 0.5, h * 0.55, 180, 1], [w * 0.72, h * 0.59, 180, 2]] as const;
  for (const [x, y, s, grade] of spots) {
    g.save();
    g.translate(x, y);
    house(g, grade, s);
    g.restore();
  }
  // the wolf, on the far left, looking in
  g.save();
  g.translate(w * 0.1, h * 0.56);
  wolfHead(g, 170, 0.6);
  g.restore();
  title(g, w / 2, h * 0.86, 62);
  disclaimers(g, w, h - 30, '#f2dcc0', 16);
  strawFrame(g, w, h);
}

/** The sign under the gabled roof, in the topper region. */
export const SIGN_FACE = { x: 0, y: 640, w: 1024, h: 300 };

function topperFace(g: G, w: number, h: number): void {
  boards(g, w, h, '#6b3a1e');
  g.strokeStyle = STRAW;
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, SIGN_FACE.h - 16);
  text(g, 'STRAW, STICKS', w / 2, SIGN_FACE.h * 0.34, `92px Limelight, serif`, STRAW, { stroke: INK, strokeWidth: 12 });
  text(g, '& BRICKS', w / 2, SIGN_FACE.h * 0.72, `92px Limelight, serif`, '#f08a5d', { stroke: INK, strokeWidth: 12 });
  for (const [k, grade] of [[-1, 0], [1, 2]] as const) {
    g.save();
    g.translate(w / 2 + k * 420, SIGN_FACE.h * 0.52);
    house(g, grade, 170);
    g.restore();
  }
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
  body: { color: BARN, metalness: 0.18, roughness: 0.4 },
  trim: { color: '#a07a36', metalness: 0.9, roughness: 0.45 },
  plate: { w: 0.7, h: 0.54, cy: 1.17, zBack: 0.27, depth: 0.062 },
  window: { w: 0.66, h: 0.258, cy: 1.2 },
  // pitch matches the overlay's five columns between its 64 px side strips
  reels: { count: 5, pitch: (0.66 * (1 - 128 / 1024)) / 5, look: LOOK, zFront: 0.322, rows: 3 },
  meters: { w: 0.62, h: 0.075, cy: 0.985 },
  pay: { bottom: [0.285, 1.52], top: [0.22, 1.9], w: 0.66, h: 0.36 },
  belly: { w: 0.62, h: 0.5, cy: 0.37, z: 0.25 },
  deck: { front: [0.43, 0.785], back: [0.28, 0.845], xs: [-0.24, -0.08, 0.08, 0.24], bw: 0.12, bh: 0.055 },
  top: 1.925,
  candle: [-0.3, 1.925, -0.22],
  lever: false,
};

function topper(l: SkinLayout): TopperParts {
  // a sign board, and over it a gabled roof like a barn's
  const signH = 0.2;
  const board = new THREE.Shape();
  board.moveTo(-l.width / 2 + 0.03, 0);
  board.lineTo(l.width / 2 - 0.03, 0);
  board.lineTo(l.width / 2 - 0.03, signH);
  board.lineTo(-l.width / 2 + 0.03, signH);
  board.closePath();
  const sign = slab(board, 0.1, 0.006, -0.02).applyMatrix4(at(0, l.top, 0));
  const gable = new THREE.Shape();
  gable.moveTo(-l.width / 2 - 0.01, 0);
  gable.lineTo(l.width / 2 + 0.01, 0);
  gable.lineTo(0, 0.16);
  gable.closePath();
  const roof = slab(gable, 0.16, 0.006, -0.05).applyMatrix4(at(0, l.top + signH, 0));
  const face = panel(l.width - 0.1, signH - 0.03, SIGN_FACE, at(0, l.top + signH / 2, 0.08 + 0.002));
  const trim = [
    // eaves along the roof's foot and the ridge beam
    box(l.width + 0.04, 0.014, 0.19, at(0, l.top + signH + 0.004, 0.03)),
    box(0.03, 0.03, 0.18, at(0, l.top + signH + 0.158, 0.03)),
  ];
  // bulbs up both slopes of the roof, straw and warm white in turn
  const spots: THREE.Vector3[] = [];
  const colors: THREE.Color[] = [];
  for (const k of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const t = i / 9;
      spots.push(new THREE.Vector3(k * (l.width / 2 + 0.01) * (1 - t), l.top + signH + 0.012 + 0.16 * t, 0.12));
      colors.push(new THREE.Color(i % 2 ? '#ffd36b' : '#fff4d6'));
    }
  }
  spots.push(new THREE.Vector3(0, l.top + signH + 0.175, 0.12));
  colors.push(new THREE.Color('#ffd36b'));
  const strip = (x: number, y0: number, y1: number, z: number) => {
    const geo = box(0.01, y1 - y0, 0.01, at(x, (y0 + y1) / 2, z));
    const c = new THREE.Color('#ffb347');
    geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: geo.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
    return geo;
  };
  const e = l.width / 2 + 0.002;
  const leds = merge([strip(-e, 0.9, 1.46, 0.272), strip(e, 0.9, 1.46, 0.272)]);
  return { body: [sign, roof], trim, printed: [face], bulbs: { spots, colors, radius: 0.009 }, leds };
}

const LINE_COLORS = ['#ffd36b', '#ff8a5d', '#7fd3ff', '#9dff7a', '#ff6b8b', '#c79bff', '#ffe98a', '#4fe3c1', '#ffb0d0', '#b5e8ff'];

export const PIGS_OVERLAY: OverlaySpec = {
  rows: 3,
  lineRows: PIGS.lineRows,
  height: 404,
  side: 64,
  markers: false,
  colors: LINE_COLORS,
  ground: '#0e1628',
  ink: STRAW,
  ringColor: '#ffd36b',
};

export const PIGS_SKIN: Skin = {
  id: 'pigs',
  layout: LAYOUT,
  meter: { ground: '#1a0c08', label: '#f2c98a', digit: '#ffb347', frame: 'rgba(242,201,138,0.45)', labels: ['CREDIT', 'TOTAL BET', 'WIN'] },
  cell: { w: 152, h: 112 },
  symbolScale: 0.9,
  stripGround: DUSK,
  tint: '#fff6ea',
  buttons: { pays: [CREAM, '#5a1a10'], betOne: [STRAW, '#3a2204'], maxBet: [BRICK, '#fff1e0'], spin: ['#3bb56a', '#08210f'] },
  drawSymbol: drawPigs,
  paintPay: payGlass,
  paintBelly: belly,
  paintTopper: topperFace,
  topper,
};

registerSkin({
  skin: PIGS_SKIN,
  sets: [{ strips: PIGS.strips }],
  idle: [3, 9, 14, 21, 7],
  overlay: PIGS_OVERLAY,
});

