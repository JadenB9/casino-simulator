// The Sic Bo table as it stands on the floor: wooden top and padded rail, a jade felt printed with
// the classic layout, the dome shaker in front of the dealer, and a lit limits sign. The printing
// is drawn box by box from layout.ts, the same data the click zones, the chips and the lights use.

import * as THREE from 'three';
import { engine } from '../../../../shared/src/games/sicbo/engine.ts';
import { spotByKey, paysLabel } from '../../../../shared/src/games/sicbo/rules.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import type { TableConfig } from '../../../../shared/src/engine.ts';
import { repaintable } from '../../table/limit-sign.ts';
import type { Quality } from '../../render/engine3d.ts';
import { Felt } from '../../table/felt.ts';
import { areas, LW, X0, ZA, ZE, type Area } from './layout.ts';
import { paintDie } from './art.ts';
import { buildShaker } from './shaker.ts';

export const TOP_Y = 0.78;
export const TABLE_W = 2.5;
export const TABLE_D = 1.42;
export const FELT_W = 2.32;
export const FELT_D = 1.24;
export const FELT_COLOR = '#0e4a41';
/** The shaker stands in front of the dealer, centred behind the top row. */
export const SHAKER_Z = -0.43;
export const MODEL_FELT = 'sicbo-felt-model';

const GOLD = '#e4c47c';
const GOLD_SOFT = 'rgba(228, 196, 124, 0.66)';
const CREAM = '#f4e9cd';
const RED = '#5e0e15';
const PANEL = 'rgba(0, 0, 0, 0.17)';
const SERIF = 'Cinzel, Georgia, serif';
const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';
const WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];

type Px = (m: number) => number;

interface TextOpts {
  font?: 'serif' | 'cond' | 'deco';
  weight?: number;
  color?: string;
  spacing?: number;
}

/** Centred text at (x, z), `size` metres tall. */
function text(g: CanvasRenderingContext2D, px: Px, s: string, x: number, z: number, size: number, o: TextOpts = {}): void {
  const family = o.font === 'cond' ? COND : o.font === 'deco' ? 'Limelight, Georgia, serif' : SERIF;
  g.font = `${o.weight ?? 600} ${px(size)}px ${family}`;
  const spacing = px(size) * (o.spacing ?? 0.08);
  g.letterSpacing = `${spacing}px`;
  g.fillStyle = o.color ?? GOLD;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // letterSpacing adds space after the last letter too; shift back half of it to stay centred
  g.fillText(s, px(x) + spacing / 2, px(z));
}

function dieAt(g: CanvasRenderingContext2D, px: Px, x: number, z: number, size: number, face: number): void {
  paintDie(g, px(x), px(z), px(size), face);
}

function fillRect(g: CanvasRenderingContext2D, px: Px, a: Area, color: string, inset = 0.004): void {
  const r = a.rect;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(px(r.x - r.w / 2 + inset), px(r.z - r.d / 2 + inset), px(r.w - 2 * inset), px(r.d - 2 * inset), px(0.006));
  g.fill();
}

/** What's printed in one box, by the kind of bet. */
function printArea(g: CanvasRenderingContext2D, px: Px, a: Area): void {
  const spot = spotByKey(a.key)!;
  const { x, z, w, d } = a.rect;
  const top = z - d / 2;
  const bottom = z + d / 2;
  const pays = paysLabel(spot).toUpperCase();
  const [n, m] = spot.numbers as [number, number];
  switch (spot.kind) {
    case 'small':
    case 'big':
      fillRect(g, px, a, RED);
      text(g, px, spot.kind === 'small' ? 'SMALL' : 'BIG', x, top + 0.066, 0.056, { weight: 700, color: CREAM, spacing: 0.1 });
      text(g, px, spot.kind === 'small' ? '4 TO 10' : '11 TO 17', x, top + 0.114, 0.027);
      text(g, px, '1 TO 1', x, top + 0.148, 0.022, { font: 'cond', color: CREAM });
      text(g, px, 'LOSE IF ANY TRIPLE', x, bottom - 0.022, 0.0165, { font: 'cond', color: GOLD_SOFT, spacing: 0.12 });
      break;
    case 'odd':
    case 'even':
      fillRect(g, px, a, PANEL);
      text(g, px, spot.kind.toUpperCase(), x, top + 0.07, 0.042, { weight: 700, color: CREAM, spacing: 0.1 });
      text(g, px, '1 TO 1', x, top + 0.118, 0.022, { font: 'cond' });
      text(g, px, 'LOSE IF', x, bottom - 0.04, 0.015, { font: 'cond', color: GOLD_SOFT, spacing: 0.12 });
      text(g, px, 'ANY TRIPLE', x, bottom - 0.021, 0.015, { font: 'cond', color: GOLD_SOFT, spacing: 0.12 });
      break;
    case 'double':
      dieAt(g, px, x, top + 0.056, 0.044, n);
      dieAt(g, px, x, top + 0.108, 0.044, n);
      text(g, px, pays, x, top + 0.16, 0.021, { font: 'cond' });
      break;
    case 'triple': {
      fillRect(g, px, a, PANEL, 0.003);
      for (const k of [-1, 0, 1]) dieAt(g, px, x + k * 0.029, z - 0.012, 0.025, n);
      text(g, px, pays, x, z + 0.028, 0.0165, { font: 'cond' });
      break;
    }
    case 'anytriple':
      fillRect(g, px, a, RED);
      text(g, px, 'ANY', x, top + 0.03, 0.024, { weight: 700, color: CREAM, spacing: 0.14 });
      text(g, px, 'TRIPLE', x, top + 0.058, 0.024, { weight: 700, color: CREAM, spacing: 0.14 });
      text(g, px, pays, x, top + 0.088, 0.021, { font: 'cond' });
      for (let f = 1; f <= 6; f++) {
        const col = f <= 3 ? -1 : 1;
        const row = (f - 1) % 3;
        for (const k of [-1, 0, 1]) dieAt(g, px, x + col * 0.038 + k * 0.0185, top + 0.122 + row * 0.03, 0.0165, f);
      }
      break;
    case 'total':
      text(g, px, String(n), x, top + 0.056, 0.058, { weight: 700, color: CREAM, spacing: 0 });
      text(g, px, pays, x, top + 0.106, 0.021, { font: 'cond' });
      break;
    case 'combo':
      dieAt(g, px, x - 0.025, top + 0.054, 0.042, n);
      dieAt(g, px, x + 0.025, top + 0.054, 0.042, m);
      text(g, px, pays, x, top + 0.106, 0.021, { font: 'cond' });
      break;
    case 'single':
      dieAt(g, px, x - w * 0.3, z, 0.07, n);
      text(g, px, WORDS[n]!, x + 0.004, z - 0.019, 0.032, { weight: 700, color: CREAM, spacing: 0.1 });
      text(g, px, '1 · 2 · 3 TO 1', x + 0.004, z + 0.022, 0.019, { font: 'cond' });
      break;
  }
}

/** Paint the layout. Coordinates are table-local metres; the felt is centred on the table. */
export function paintLayout(g: CanvasRenderingContext2D, px: Px): void {
  g.lineJoin = 'round';
  for (const a of areas().values()) printArea(g, px, a);

  // box lines
  g.strokeStyle = GOLD;
  g.lineWidth = px(0.0032);
  for (const a of areas().values()) {
    const r = a.rect;
    g.strokeRect(px(r.x - r.w / 2), px(r.z - r.d / 2), px(r.w), px(r.d));
  }
  // a double border round the whole layout
  g.lineWidth = px(0.005);
  g.strokeRect(px(X0), px(ZA), px(LW), px(ZE - ZA));
  g.lineWidth = px(0.0018);
  g.strokeStyle = GOLD_SOFT;
  g.beginPath();
  g.roundRect(px(X0 - 0.014), px(ZA - 0.014), px(LW + 0.028), px(ZE - ZA + 0.028), px(0.012));
  g.stroke();

  // the dealer's side: the game's name to the left of the shaker
  text(g, px, 'SIC BO', -0.62, SHAKER_Z - 0.012, 0.085, { font: 'deco', weight: 400, spacing: 0.12 });
  text(g, px, 'WINNING BETS LIGHT UP', -0.62, SHAKER_Z + 0.06, 0.02, { font: 'cond', color: GOLD_SOFT, spacing: 0.22 });
  g.strokeStyle = GOLD_SOFT;
  g.lineWidth = px(0.0018);
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(px(-0.62 + side * 0.17), px(SHAKER_Z + 0.032));
    g.lineTo(px(-0.62 + side * 0.03), px(SHAKER_Z + 0.032));
    g.stroke();
  }
}

export function layoutFelt(resolution: number): Felt {
  return new Felt({ width: FELT_W, depth: FELT_D, color: FELT_COLOR, resolution, paint: paintLayout, regions: [] });
}

function roundedShape(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** The limits sign's face: every class of bet with its minimum and maximum at a table of these limits. */
function paintSign(g: CanvasRenderingContext2D, cfg: TableConfig): void {
  const c = g.canvas;
  const lim = cfg.limits;
  g.fillStyle = '#0d0b09';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#d8b06a';
  g.lineWidth = 6;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.textAlign = 'center';
  g.fillStyle = '#f1d59a';
  g.font = '400 58px Limelight, Georgia, serif';
  g.fillText('SIC BO', c.width / 2, 92);
  g.fillStyle = '#f4efe4';
  g.font = '600 31px "Barlow Condensed", sans-serif';
  const range = (k: string) => `${formatMoney(lim[k]!.min)} – ${formatMoney(lim[k]!.max)}`;
  const rows: [string, string][] = [
    ['Small · Big · Odd · Even', range('even')],
    ['Single numbers', range('single')],
    ['Totals · Two dice · Doubles', range('prop')],
    ['Any triple', range('prop')],
    ['Specific triples', range('triple')],
  ];
  rows.forEach(([a, b], i) => {
    const y = 158 + i * 46;
    g.textAlign = 'left';
    g.fillText(a.toUpperCase(), 44, y);
    g.textAlign = 'right';
    g.fillText(b, c.width - 44, y);
  });
  g.textAlign = 'center';
  g.fillStyle = '#c9c0ad';
  g.font = '600 27px "Barlow Condensed", sans-serif';
  g.fillText(`TABLE MAXIMUM ${formatMoney(lim.default.max)} A ROLL`, c.width / 2, 400);
}

/** The limits sign, painted for the Standard table (and for yours while you sit at it). */
function limitSign(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 440;
  paintSign(c.getContext('2d')!, engine.config('', 'multi'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.5 });
  const edge = new THREE.MeshStandardMaterial({ color: '#1a1512', roughness: 0.4, metalness: 0.4 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1375, 0.008), [edge, edge, edge, edge, face, edge]);
  repaintable(sign, face, { width: 640, height: 440, paint: paintSign });
  return sign;
}

/** The table, centred at the origin, players on the +z side, the shaker toward -z. */
export function tableModel(quality: Quality): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#3a1f12', roughness: 0.45 });
  const darkWood = new THREE.MeshStandardMaterial({ color: '#24130b', roughness: 0.55 });
  const leather = new THREE.MeshStandardMaterial({ color: '#1c1210', roughness: 0.62 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a24b', roughness: 0.3, metalness: 1 });

  const top = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(TABLE_W, TABLE_D, 0.2), { depth: 0.05, bevelEnabled: false, curveSegments: 16 }), wood);
  top.rotation.x = -Math.PI / 2;
  top.position.y = TOP_Y - 0.05;
  g.add(top);

  const ring = roundedShape(TABLE_W - 0.02, TABLE_D - 0.02, 0.19);
  ring.holes.push(roundedShape(FELT_W + 0.01, FELT_D + 0.01, 0.1));
  const rail = new THREE.Mesh(
    new THREE.ExtrudeGeometry(ring, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: quality === 'high' ? 5 : 2, curveSegments: 20 }),
    leather,
  );
  rail.rotation.x = -Math.PI / 2;
  rail.position.y = TOP_Y + 0.012;
  g.add(rail);
  const trim = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(TABLE_W + 0.012, TABLE_D + 0.012, 0.205), { depth: 0.012, bevelEnabled: false, curveSegments: 16 }), brass);
  trim.rotation.x = -Math.PI / 2;
  trim.position.y = TOP_Y - 0.062;
  g.add(trim);

  const skirt = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(TABLE_W - 0.24, TABLE_D - 0.24, 0.12), { depth: 0.11, bevelEnabled: false }), darkWood);
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = TOP_Y - 0.17;
  g.add(skirt);
  const legGeo = new THREE.CylinderGeometry(0.03, 0.022, TOP_Y - 0.17, 16);
  for (const x of [-1.02, 0, 1.02]) {
    for (const z of [-0.46, 0.46]) {
      const leg = new THREE.Mesh(legGeo, darkWood);
      leg.position.set(x, (TOP_Y - 0.17) / 2, z);
      g.add(leg);
    }
  }

  const felt = layoutFelt(quality === 'high' ? 560 : 360);
  felt.mesh.name = MODEL_FELT;
  felt.mesh.position.y = TOP_Y + 0.0004;
  g.add(felt.mesh);

  const shaker = buildShaker(quality);
  shaker.position.set(0, TOP_Y, SHAKER_Z);
  g.add(shaker);

  const sign = limitSign();
  sign.position.set(0.66, TOP_Y + 0.085, SHAKER_Z - 0.02);
  sign.rotation.x = -0.18;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.02, 12), brass);
  post.position.set(0.66, TOP_Y + 0.01, SHAKER_Z - 0.02);
  g.add(sign, post);
  return g;
}
