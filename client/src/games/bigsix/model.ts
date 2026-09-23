// The Big Six station as it stands on the floor: the wheel on its column behind a standing-height
// table, the seven spots printed on the felt, a brass foot rail for the players and a lit limits
// sign. The layout is painted from the geometry in layout.ts, the same numbers the clicks and the
// chips use.

import * as THREE from 'three';
import { SPOTS } from '../../../../shared/src/games/bigsix/rules.ts';
import { engine } from '../../../../shared/src/games/bigsix/engine.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import type { Quality } from '../../render/engine3d.ts';
import { Felt } from '../../table/felt.ts';
import { SYMBOL_COLOR, billValue, drawNote, drawStar, drawCrown } from './art.ts';
import {
  FELT_W, FELT_D, SPOT_W, SPOT_Z0, SPOT_Z1, PANEL_Z, PANEL_W, PANEL_D, PAYS_Z, PAYS_SIZE, CHIPS_Z0, CHIPS_Z1, TITLE_Z, spotX,
} from './layout.ts';
import { buildWheel } from './wheel.ts';

export const TOP_Y = 0.9;
export const TABLE_W = 2.32;
export const TABLE_D = 0.96;
/** The table sits toward the players; the wheel stands behind it on the dealer's side. */
export const TABLE_Z = 0.37;
export const WHEEL_Y = 1.84;
export const WHEEL_Z = -0.52;
export const FOOTPRINT = { width: 2.4, depth: 1.7 };
export const FELT_COLOR = '#0c3b29';
export const MODEL_FELT = 'bigsix-felt-model';
export const WHEEL_GROUP = 'bigsix-wheel';

const PRINT = '#ead7a2';
const SERIF = 'Cinzel, Georgia, serif';
const CONDENSED = '"Barlow Condensed", "Arial Narrow", sans-serif';

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Paint the layout, felt-local metres (the canvas origin is the felt's centre). */
export function paintLayout(g: CanvasRenderingContext2D, px: (m: number) => number): void {
  const X = px;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';

  // the name across the dealer's side, between two stars and two rules
  g.fillStyle = PRINT;
  g.font = `600 ${X(0.06)}px ${SERIF}`;
  g.fillText('BIG SIX', 0, X(TITLE_Z + 0.004));
  // the one rule a player might not expect, either side of the name, between fine rules
  g.strokeStyle = PRINT;
  g.lineWidth = X(0.0022);
  g.font = `600 ${X(0.03)}px ${CONDENSED}`;
  for (const side of [-1, 1]) {
    g.save();
    g.translate(X(side * 0.21), X(TITLE_Z));
    drawStar(g, X(0.02));
    g.restore();
    g.fillText(side < 0 ? 'STAR PAYS ONLY ON THE STAR' : 'CROWN PAYS ONLY ON THE CROWN', X(side * 0.555), X(TITLE_Z + 0.002));
    for (const [a, b] of [[0.25, 0.36], [0.75, 0.9]] as const) {
      g.beginPath();
      g.moveTo(X(side * a), X(TITLE_Z));
      g.lineTo(X(side * b), X(TITLE_Z));
      g.stroke();
    }
  }

  SPOTS.forEach((spot, k) => {
    const x = spotX(k);
    // the spot's outline
    g.strokeStyle = PRINT;
    g.lineWidth = X(0.0032);
    rounded(g, X(x - SPOT_W / 2), X(SPOT_Z0), X(SPOT_W), X(SPOT_Z1 - SPOT_Z0), X(0.014));
    g.stroke();
    // the picture panel in the symbol's colour
    g.fillStyle = SYMBOL_COLOR[spot.key];
    rounded(g, X(x - PANEL_W / 2), X(PANEL_Z - PANEL_D / 2), X(PANEL_W), X(PANEL_D), X(0.008));
    g.fill();
    g.lineWidth = X(0.002);
    g.strokeStyle = 'rgba(234, 215, 162, 0.8)';
    g.stroke();
    g.save();
    g.translate(X(x), X(PANEL_Z));
    const v = billValue(spot.key);
    if (v !== null) {
      drawNote(g, v, X(0.222), X(0.108), false);
    } else {
      // the picture over its name
      g.translate(0, X(-0.018));
      if (spot.key === 'star') drawStar(g, X(0.042));
      else drawCrown(g, X(0.094));
      g.fillStyle = '#f6efe0';
      g.font = `700 ${X(0.034)}px ${SERIF}`;
      g.fillText(spot.key === 'star' ? 'STAR' : 'CROWN', 0, X(0.062));
    }
    g.restore();
    // what it pays
    g.fillStyle = PRINT;
    g.textAlign = 'center';
    g.font = `700 ${X(PAYS_SIZE)}px ${SERIF}`;
    g.fillText(`${spot.pays} TO 1`, X(x), X(PAYS_Z + PAYS_SIZE * 0.06));
    // where the chips go
    g.strokeStyle = 'rgba(234, 215, 162, 0.42)';
    g.lineWidth = X(0.0022);
    rounded(g, X(x - PANEL_W / 2), X(CHIPS_Z0), X(PANEL_W), X(CHIPS_Z1 - CHIPS_Z0), X(0.02));
    g.stroke();
  });


  // a fine border around the whole layout
  g.strokeStyle = PRINT;
  g.lineWidth = X(0.0016);
  g.globalAlpha = 0.7;
  rounded(g, X(-FELT_W / 2 + 0.03), X(-FELT_D / 2 + 0.025), X(FELT_W - 0.06), X(FELT_D - 0.05), X(0.03));
  g.stroke();
  g.globalAlpha = 1;
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

function limitSign(): THREE.Mesh {
  const lim = engine.config('', 'multi').limits;
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
  g.font = `600 58px ${SERIF}`;
  g.fillText('BIG SIX', c.width / 2, 92);
  g.font = `600 30px ${SERIF}`;
  g.fillText('MONEY WHEEL', c.width / 2, 134);
  g.fillStyle = '#f4efe4';
  g.font = `600 36px ${CONDENSED}`;
  const rows: [string, string][] = [
    ['Each spot', `${formatMoney(lim.spot!.min)} – ${formatMoney(lim.spot!.max)}`],
    ['Table maximum', `${formatMoney(lim.default.max)} a spin`],
  ];
  rows.forEach(([a, b], i) => {
    const y = 214 + i * 60;
    g.textAlign = 'left';
    g.fillText(a.toUpperCase(), 48, y);
    g.textAlign = 'right';
    g.fillText(b, c.width - 48, y);
  });
  g.textAlign = 'center';
  g.fillStyle = '#c9c0ad';
  g.font = `600 28px ${CONDENSED}`;
  g.fillText('54 STOPS · STAR AND CROWN PAY 40 TO 1', c.width / 2, 384);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.5 });
  const edge = new THREE.MeshStandardMaterial({ color: '#1a1512', roughness: 0.4, metalness: 0.4 });
  return new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1375, 0.008), [edge, edge, edge, edge, face, edge]);
}

/** The station, centred at the origin: players on the +z side, the wheel toward −z. */
export function tableModel(quality: Quality): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#3a1f12', roughness: 0.45 });
  const darkWood = new THREE.MeshStandardMaterial({ color: '#24130b', roughness: 0.55 });
  const leather = new THREE.MeshStandardMaterial({ color: '#1c1210', roughness: 0.62 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a24b', roughness: 0.3, metalness: 1 });

  const table = new THREE.Group();
  table.position.z = TABLE_Z;
  g.add(table);
  const top = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(TABLE_W, TABLE_D, 0.14), { depth: 0.05, bevelEnabled: false, curveSegments: 16 }), wood);
  top.rotation.x = -Math.PI / 2;
  top.position.y = TOP_Y - 0.05;
  table.add(top);
  const ring = roundedShape(TABLE_W - 0.02, TABLE_D - 0.02, 0.13);
  ring.holes.push(roundedShape(FELT_W + 0.01, FELT_D + 0.01, 0.06));
  const rail = new THREE.Mesh(
    new THREE.ExtrudeGeometry(ring, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: quality === 'high' ? 5 : 2, curveSegments: 20 }),
    leather,
  );
  rail.rotation.x = -Math.PI / 2;
  rail.position.y = TOP_Y + 0.012;
  table.add(rail);
  const trim = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedShape(TABLE_W + 0.012, TABLE_D + 0.012, 0.145), { depth: 0.012, bevelEnabled: false, curveSegments: 16 }), brass);
  trim.rotation.x = -Math.PI / 2;
  trim.position.y = TOP_Y - 0.062;
  table.add(trim);
  // a closed cabinet under the top, with a kick and a brass foot rail on the players' side
  const bodyH = TOP_Y - 0.05 - 0.07;
  const body = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W - 0.26, bodyH, TABLE_D - 0.3), darkWood);
  body.position.y = 0.07 + bodyH / 2;
  const kick = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W - 0.34, 0.07, TABLE_D - 0.38), leather);
  kick.position.y = 0.035;
  table.add(body, kick);
  const footRail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, TABLE_W - 0.4, 16).rotateZ(Math.PI / 2), brass);
  footRail.position.set(0, 0.2, TABLE_D / 2 - 0.08);
  table.add(footRail);
  for (const x of [-(TABLE_W - 0.5) / 2, 0, (TABLE_W - 0.5) / 2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.2, 12), brass);
    post.position.set(x, 0.1, TABLE_D / 2 - 0.13);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 10).rotateX(Math.PI / 2), brass);
    arm.position.set(x, 0.2, TABLE_D / 2 - 0.105);
    table.add(post, arm);
  }

  const felt = layoutFelt(quality === 'high' ? 560 : 360);
  felt.mesh.name = MODEL_FELT;
  felt.mesh.position.y = TOP_Y + 0.0004;
  table.add(felt.mesh);

  const sign = limitSign();
  sign.position.set(-TABLE_W / 2 + 0.2, TOP_Y + 0.085, -TABLE_D / 2 + 0.075);
  sign.rotation.x = -0.18;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.02, 12), brass);
  post.position.set(-TABLE_W / 2 + 0.2, TOP_Y + 0.01, -TABLE_D / 2 + 0.075);
  table.add(sign, post);

  const wheel = buildWheel(quality, WHEEL_Y);
  wheel.name = WHEEL_GROUP;
  wheel.position.set(0, WHEEL_Y, WHEEL_Z);
  g.add(wheel);
  return g;
}
