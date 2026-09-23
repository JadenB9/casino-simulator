// The roulette table as it stands on the floor: a wooden top with a padded leather armrest, the
// printed layout on woven cloth, the wheel set into a wooden head at the end of the layout, the
// dealer's chip rack, and a lit limits sign. The layout is painted from the geometry in
// layout.ts, the same data the click zones and the chips use.

import * as THREE from 'three';
import { type Variant, DOUBLE_ZERO, colorOf } from '../../../../shared/src/games/roulette/rules.ts';
import { engine } from '../../../../shared/src/games/roulette/engine.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import type { Quality } from '../../render/engine3d.ts';
import { Felt } from '../../table/felt.ts';
import { layoutOf, zeroRects, XZ, X0, XR, XC, ZT, ZN, ZD, ZE, rowEdge, colEdge, type Rect } from './layout.ts';
import { buildWheel, WHEEL_R } from './wheel.ts';
import { feltWeave } from './textures.ts';
import { paddedRail, woodMaterial, wheelHead, chipRack } from './table.ts';

export const TOP_Y = 0.78;
export const TABLE_W = 2.86;
export const TABLE_D = 1.06;
export const FELT_W = 2.66;
export const FELT_D = 0.86;
export const FELT_COLOR = '#0c3d26';
/** Wheel centre on the table top: at the head of the layout, beside the zeros. */
export const WHEEL_X = XZ - 0.08 - WHEEL_R;
export const WHEEL_Z = 0;
export const MODEL_FELT = 'roulette-felt-model';
/** The dealer's chip rack, in the armrest on the dealer's side, beside the wheel. */
const RACK_X = -0.1;
const RACK_W = 0.46;
const RACK_D = 0.094;

const PRINT = '#ead7a2';
const RED = '#7a0a1a';
const BLACK = '#0b0b0b';
const ZERO = '#0b6134';
const NUMERAL = '#f3e8cc';

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Paint the layout. Coordinates are table-local metres; the felt is centred on the table. */
export function paintLayout(g: CanvasRenderingContext2D, px: (m: number) => number, v: Variant): void {
  const geo = layoutOf(v);
  const X = (m: number) => px(m);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // number panels, red and black, with the numerals standing toward the players
  for (let n = 1; n <= 36; n++) {
    const r = geo.cells.get(n)!;
    const inset = 0.0075;
    g.fillStyle = colorOf(n) === 'red' ? RED : BLACK;
    rounded(g, X(r.x - r.w / 2 + inset), X(r.z - r.d / 2 + inset), X(r.w - 2 * inset), X(r.d - 2 * inset), X(0.008));
    g.fill();
    g.fillStyle = NUMERAL;
    g.font = `600 ${X(0.052)}px Cinzel, Georgia, serif`;
    g.fillText(String(n), X(r.x), X(r.z + 0.004));
  }

  // the zeros: pentagons pointing at the wheel
  const tip = 0.034;
  for (const [p, r] of zeroRects(v)) {
    const x0 = r.x - r.w / 2;
    const x1 = r.x + r.w / 2;
    const z0 = r.z - r.d / 2;
    const z1 = r.z + r.d / 2;
    const inset = 0.0075;
    const shape = (k: number) => {
      g.beginPath();
      g.moveTo(X(x1 - k), X(z0 + k));
      g.lineTo(X(x1 - k), X(z1 - k));
      g.lineTo(X(x0 + tip + k * 0.5), X(z1 - k));
      g.lineTo(X(x0 + k), X(r.z));
      g.lineTo(X(x0 + tip + k * 0.5), X(z0 + k));
      g.closePath();
    };
    shape(inset);
    g.fillStyle = ZERO;
    g.fill();
    g.fillStyle = NUMERAL;
    g.font = `600 ${X(0.052)}px Cinzel, Georgia, serif`;
    g.fillText(p === DOUBLE_ZERO ? '00' : '0', X(r.x + 0.006), X(r.z + 0.004));
    shape(0);
    g.strokeStyle = PRINT;
    g.lineWidth = X(0.0034);
    g.stroke();
  }

  // grid lines
  g.strokeStyle = PRINT;
  g.lineWidth = X(0.0034);
  const lineAt = (x1: number, z1: number, x2: number, z2: number) => {
    g.beginPath();
    g.moveTo(X(x1), X(z1));
    g.lineTo(X(x2), X(z2));
    g.stroke();
  };
  const box = (x1: number, z1: number, x2: number, z2: number) => g.strokeRect(X(x1), X(z1), X(x2 - x1), X(z2 - z1));
  box(X0, ZT, XR, ZN);
  for (let k = 1; k < 12; k++) lineAt(rowEdge(k), ZT, rowEdge(k), ZN);
  lineAt(X0, colEdge(1), XR, colEdge(1));
  lineAt(X0, colEdge(2), XR, colEdge(2));
  box(XR, ZT, XC, ZN);
  lineAt(XR, colEdge(1), XC, colEdge(1));
  lineAt(XR, colEdge(2), XC, colEdge(2));
  box(X0, ZN, XR, ZD);
  lineAt(rowEdge(4), ZN, rowEdge(4), ZD);
  lineAt(rowEdge(8), ZN, rowEdge(8), ZD);
  box(X0, ZD, XR, ZE);
  for (let k = 2; k < 12; k += 2) lineAt(rowEdge(k), ZD, rowEdge(k), ZE);

  // outside wording (FEATURES §4.2)
  g.fillStyle = PRINT;
  const text = (s: string, r: Rect, size: number) => {
    g.font = `600 ${X(size)}px Cinzel, Georgia, serif`;
    g.fillText(s, X(r.x), X(r.z + size * 0.08));
  };
  text('1st 12', geo.boxes.get('dozen1')!, 0.046);
  text('2nd 12', geo.boxes.get('dozen2')!, 0.046);
  text('3rd 12', geo.boxes.get('dozen3')!, 0.046);
  text('1 to 18', geo.boxes.get('low')!, 0.036);
  text('EVEN', geo.boxes.get('even')!, 0.036);
  text('ODD', geo.boxes.get('odd')!, 0.036);
  text('19 to 36', geo.boxes.get('high')!, 0.036);
  for (let c = 1; c <= 3; c++) text('2 to 1', geo.boxes.get(`column${c}`)!, 0.034);
  for (const [kind, fill] of [['red', RED], ['black', BLACK]] as const) {
    const r = geo.boxes.get(kind)!;
    g.beginPath();
    g.moveTo(X(r.x - 0.058), X(r.z));
    g.lineTo(X(r.x), X(r.z - 0.03));
    g.lineTo(X(r.x + 0.058), X(r.z));
    g.lineTo(X(r.x), X(r.z + 0.03));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = X(0.0022);
    g.strokeStyle = PRINT;
    g.stroke();
  }

  // a fine border around the whole layout
  g.lineWidth = X(0.0016);
  g.globalAlpha = 0.7;
  rounded(g, X(XZ - 0.016), X(ZT - 0.016), X(XC - XZ + 0.032), X(ZE - ZT + 0.032), X(0.02));
  g.stroke();
  g.globalAlpha = 1;
}

/**
 * The printed felt on woven cloth: the painted layout over a fine weave's normal map, tiled at
 * 12 mm. No sheen: a fabric lobe greys the black boxes and turns the reds orange.
 */
export function layoutFelt(v: Variant, resolution: number, quality: Quality = 'high'): Felt {
  const felt = new Felt({
    width: FELT_W,
    depth: FELT_D,
    color: FELT_COLOR,
    resolution,
    paint: (g, px) => paintLayout(g, px, v),
    regions: [],
  });
  const cloth = felt.mesh.material as THREE.MeshStandardMaterial;
  const weave = feltWeave(quality).clone();
  weave.repeat.set(FELT_W / 0.012, FELT_D / 0.012);
  cloth.normalMap = weave;
  cloth.normalScale.set(0.8, 0.8);
  cloth.roughness = 0.92;
  return felt;
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

function limitSign(v: Variant): THREE.Mesh {
  const lim = engine.config(v, 'multi').limits;
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 440;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0b09';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#d8b06a';
  g.lineWidth = 6;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.textAlign = 'center';
  g.fillStyle = '#f1d59a';
  g.font = '600 50px Cinzel, Georgia, serif';
  g.fillText(v === 'american' ? 'AMERICAN' : 'EUROPEAN', c.width / 2, 86);
  g.font = '600 34px Cinzel, Georgia, serif';
  g.fillText('ROULETTE', c.width / 2, 130);
  g.fillStyle = '#f4efe4';
  g.font = '600 36px "Barlow Condensed", sans-serif';
  const rows: [string, string][] = [
    ['Inside, each spot', `${formatMoney(lim.inside!.min)} – ${formatMoney(lim.inside!.max)}`],
    ['Outside, each bet', `${formatMoney(lim.outside!.min)} – ${formatMoney(lim.outside!.max)}`],
    ['Table maximum', `${formatMoney(lim.default.max)}`],
  ];
  rows.forEach(([a, b], i) => {
    const y = 206 + i * 56;
    g.textAlign = 'left';
    g.fillText(a.toUpperCase(), 48, y);
    g.textAlign = 'right';
    g.fillText(b, c.width - 48, y);
  });
  g.textAlign = 'center';
  g.fillStyle = '#c9c0ad';
  g.font = '600 28px "Barlow Condensed", sans-serif';
  g.fillText(v === 'american' ? 'TOP LINE 0-00-1-2-3 PAYS 6 TO 1' : 'SINGLE ZERO · FIRST FOUR PAYS 8 TO 1', c.width / 2, 392);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.5 });
  const edge = new THREE.MeshStandardMaterial({ color: '#1a1512', roughness: 0.4, metalness: 0.4 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1375, 0.008), [edge, edge, edge, edge, face, edge]);
  return sign;
}

/** The table, centred at the origin, players on the +z side, the wheel at −x. */
export function tableModel(v: Variant, quality: Quality): THREE.Group {
  const g = new THREE.Group();
  const wood = woodMaterial(quality);
  const darkWood = woodMaterial(quality, '#7d5f50');
  const legWood = woodMaterial(quality, '#7d5f50', true);
  const brass = new THREE.MeshStandardMaterial({ color: '#b8923f', roughness: 0.32, metalness: 1 });

  const top = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(TABLE_W, TABLE_D, 0.16), { depth: 0.05, bevelEnabled: false, curveSegments: 16 }), wood);
  top.rotation.x = -Math.PI / 2;
  top.position.y = TOP_Y - 0.05;
  g.add(top);

  const rail = paddedRail(FELT_W + 0.012, FELT_D + 0.012, [RACK_X - RACK_W / 2 - 0.004, RACK_X + RACK_W / 2 + 0.004], quality);
  rail.position.y = TOP_Y;
  g.add(rail);
  const trim = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(TABLE_W + 0.012, TABLE_D + 0.012, 0.165), { depth: 0.012, bevelEnabled: false, curveSegments: 16 }), brass);
  trim.rotation.x = -Math.PI / 2;
  trim.position.y = TOP_Y - 0.062;
  g.add(trim);

  const skirt = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(TABLE_W - 0.2, TABLE_D - 0.2, 0.1), { depth: 0.11, bevelEnabled: false }), darkWood);
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = TOP_Y - 0.17;
  g.add(skirt);
  const legGeo = new THREE.CylinderGeometry(0.03, 0.022, TOP_Y - 0.17, 16);
  for (const x of [-1.2, 0, 1.2]) {
    for (const z of [-0.36, 0.36]) {
      const leg = new THREE.Mesh(legGeo, legWood);
      leg.position.set(x, (TOP_Y - 0.17) / 2, z);
      g.add(leg);
    }
  }

  const felt = layoutFelt(v, quality === 'high' ? 560 : 360, quality);
  felt.mesh.name = MODEL_FELT;
  felt.mesh.position.y = TOP_Y + 0.0004;
  g.add(felt.mesh);

  const head = wheelHead(-FELT_W / 2 - 0.006, WHEEL_X + WHEEL_R + 0.03, FELT_D + 0.012, quality, wood, brass);
  head.position.y = TOP_Y;
  g.add(head);
  const wheel = buildWheel(v, quality);
  wheel.position.set(WHEEL_X, TOP_Y, WHEEL_Z);
  g.add(wheel);

  const rack = chipRack(RACK_W, RACK_D, quality, darkWood);
  rack.position.set(RACK_X, TOP_Y, -(FELT_D / 2 + 0.006 + RACK_D / 2));
  g.add(rack);

  const sign = limitSign(v);
  sign.position.set(XC - 0.16, TOP_Y + 0.085, ZT - 0.075);
  sign.rotation.x = -0.18;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.02, 12), brass);
  post.position.set(XC - 0.16, TOP_Y + 0.01, ZT - 0.075);
  g.add(sign, post);
  return g;
}
