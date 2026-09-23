// The printed blackjack felt: three arcs of lettering, the insurance band, seven betting circles.
// One painter serves both the table on the floor (a small shared texture) and the table you sit
// at (a sharp Felt with a click region per circle).

import * as THREE from 'three';
import { Felt, type FeltSpec } from '../../table/felt.ts';
import { DEALER_Z, FELT_RX, FELT_RZ, INSURANCE_ARC, PAYS_ARC, RULE_ARC, SEATS, SPOT_R, spotAt } from './layout.ts';

export const FELT_GREEN = '#134b32';
const INK = 'rgba(236, 210, 150, 0.9)';
const INK_SOFT = 'rgba(236, 210, 150, 0.55)';

type Px = (m: number) => number;

/** A point on an arc ellipse in canvas pixels (canvas y is table +z). */
function arcPoint(px: Px, rx: number, rz: number, phi: number): [number, number] {
  return [px(rx * Math.sin(phi)), px(DEALER_Z + rz * Math.cos(phi))];
}

function strokeArc(g: CanvasRenderingContext2D, px: Px, rx: number, rz: number, fromDeg: number, toDeg: number): void {
  g.beginPath();
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const phi = THREE.MathUtils.degToRad(fromDeg + ((toDeg - fromDeg) * i) / steps);
    const [x, y] = arcPoint(px, rx, rz, phi);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

/**
 * Letter `text` along an arc, centred on the middle of the table, reading left to right from
 * the players' side with the tops of the letters toward the dealer.
 */
function textOnArc(g: CanvasRenderingContext2D, px: Px, text: string, rx: number, rz: number, spacing: number): void {
  // Arc length along the ellipse, so letters keep even spacing where it flattens out.
  const samples = 720;
  const phis: number[] = [];
  const lens: number[] = [];
  let acc = 0;
  let prev = arcPoint(px, rx, rz, -Math.PI / 2);
  for (let i = 0; i <= samples; i++) {
    const phi = -Math.PI / 2 + (Math.PI * i) / samples;
    const p = arcPoint(px, rx, rz, phi);
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    phis.push(phi);
    lens.push(acc);
    prev = p;
  }
  const phiAt = (len: number) => {
    let lo = 0;
    let hi = lens.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lens[mid]! < len) lo = mid;
      else hi = mid;
    }
    const t = (len - lens[lo]!) / Math.max(1e-6, lens[hi]! - lens[lo]!);
    return phis[lo]! + (phis[hi]! - phis[lo]!) * t;
  };
  const widths = [...text].map((ch) => g.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let at = lens[samples / 2]! - total / 2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [...text].forEach((ch, i) => {
    const w = widths[i]! - spacing;
    const phi = phiAt(at + w / 2);
    const [x, y] = arcPoint(px, rx, rz, phi);
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(-rz * Math.sin(phi), rx * Math.cos(phi)));
    g.fillText(ch, 0, 0);
    g.restore();
    at += widths[i]!;
  });
}

export function paintFelt(g: CanvasRenderingContext2D, px: Px): void {
  g.lineCap = 'round';
  // A hairline just inside the rail.
  g.strokeStyle = INK_SOFT;
  g.lineWidth = px(0.003);
  strokeArc(g, px, FELT_RX - 0.035, FELT_RZ - 0.035, -89, 89);

  // Insurance band: two lines with the lettering between them.
  const ins = INSURANCE_ARC;
  g.strokeStyle = INK;
  g.lineWidth = px(0.0032);
  strokeArc(g, px, ins.rx + ins.band / 2, ins.rz + ins.band / 2, -66, 66);
  strokeArc(g, px, ins.rx - ins.band / 2, ins.rz - ins.band / 2, -66, 66);
  g.fillStyle = INK;
  g.font = `600 ${px(0.021)}px Cinzel, Georgia, serif`;
  textOnArc(g, px, 'INSURANCE PAYS 2 TO 1', ins.rx, ins.rz, px(0.006));

  g.font = `500 ${px(0.0205)}px Cinzel, Georgia, serif`;
  textOnArc(g, px, "Dealer must draw to 16 and stand on all 17's", RULE_ARC.rx, RULE_ARC.rz, px(0.0022));

  g.font = `700 ${px(0.036)}px Cinzel, Georgia, serif`;
  textOnArc(g, px, 'BLACKJACK PAYS 3 TO 2', PAYS_ARC.rx, PAYS_ARC.rz, px(0.006));

  // Betting circles: a bold ring with a fine inner ring.
  for (let seat = 0; seat < SEATS; seat++) {
    const s = spotAt(seat);
    g.strokeStyle = INK;
    g.lineWidth = px(0.0042);
    g.beginPath();
    g.arc(px(s.x), px(s.z), px(SPOT_R), 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = INK_SOFT;
    g.lineWidth = px(0.0016);
    g.beginPath();
    g.arc(px(s.x), px(s.z), px(SPOT_R - 0.008), 0, Math.PI * 2);
    g.stroke();
  }
}

/**
 * The felt's outline: the straight dealer edge and the players' arc. Returned as a flat
 * geometry in the felt's plane (x across, y = -z), with UVs spanning the painted rectangle.
 */
export function feltGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-FELT_RX, -DEALER_Z);
  shape.lineTo(FELT_RX, -DEALER_Z);
  shape.absellipse(0, -DEALER_Z, FELT_RX, FELT_RZ, 0, Math.PI, true);
  const geo = new THREE.ShapeGeometry(shape, 64);
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + FELT_RX) / (2 * FELT_RX), (pos.getY(i) + FELT_RZ / 2) / FELT_RZ);
  }
  uv.needsUpdate = true;
  return geo;
}

/** The felt you play on: sharp, with a click region on every betting circle. */
export function playFelt(): Felt {
  const spec: FeltSpec = {
    width: 2 * FELT_RX,
    depth: FELT_RZ,
    color: FELT_GREEN,
    resolution: 1500,
    paint: paintFelt,
    regions: Array.from({ length: SEATS }, (_, seat) => {
      const s = spotAt(seat);
      return { id: `spot:${seat}`, shape: { kind: 'circle' as const, x: s.x, z: s.z, r: SPOT_R + 0.012 } };
    }),
  };
  const felt = new Felt(spec);
  felt.mesh.geometry.dispose();
  felt.mesh.geometry = feltGeometry();
  return felt;
}

let floorFelt: THREE.MeshStandardMaterial | null = null;

/** One modest texture shared by every blackjack table on the floor, repainted once the fonts arrive. */
export function floorFeltMaterial(): THREE.MeshStandardMaterial {
  if (floorFelt) return floorFelt;
  const ppm = 560;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(2 * FELT_RX * ppm);
  canvas.height = Math.round(FELT_RZ * ppm);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paint = () => {
    const g = canvas.getContext('2d')!;
    g.fillStyle = FELT_GREEN;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.save();
    g.translate(canvas.width / 2, canvas.height / 2);
    paintFelt(g, (m) => m * ppm);
    g.restore();
    tex.needsUpdate = true;
  };
  paint();
  void document.fonts?.load('600 20px Cinzel').then(paint, () => {});
  floorFelt = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  return floorFelt;
}
