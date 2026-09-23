// The printed baccarat felt: burgundy cloth with gold printing, drawn from the layout data. The
// same description gives the click regions, so what you see is what you hit. The felt mesh is
// cut to the table's kidney outline instead of a rectangle.

import * as THREE from 'three';
import type { FeltSpec, Region } from '../../table/felt.ts';
import { SPOTS } from '../../../../shared/src/games/baccarat/rules.ts';
import {
  ARC_OVER, BANDS, COMMISSION, CZ, FELT_D, FELT_W, HAND_BOX, NUMBER_R, PAIR_OFFSET, PAIR_R, PAIR_RADIUS, R_FELT, SEAT_COUNT,
  commissionBox, feltOutline, polar, regionId, seatAngle, sectorPoints, spotCentre,
} from './layout.ts';

export const FELT_COLOR = '#4a1019';
const INK = 'rgba(234, 203, 139, 0.92)';
const INK_SOFT = 'rgba(234, 203, 139, 0.6)';
const SERIF = 'Cinzel, Georgia, serif';

type Px = (m: number) => number;

function pathOf(g: CanvasRenderingContext2D, px: Px, pts: [number, number][]): void {
  g.beginPath();
  pts.forEach(([x, z], i) => (i === 0 ? g.moveTo(px(x), px(z)) : g.lineTo(px(x), px(z))));
  g.closePath();
}

function circle(g: CanvasRenderingContext2D, px: Px, x: number, z: number, r: number): void {
  g.beginPath();
  g.arc(px(x), px(z), px(r), 0, Math.PI * 2);
}

/** Text at (x, z), turned so it reads from a seat at angle `a` (a = PI/2 reads straight on). */
function textAt(g: CanvasRenderingContext2D, px: Px, text: string, x: number, z: number, a: number, size: number, weight = 600, spacing = 0.12): void {
  g.save();
  g.translate(px(x), px(z));
  g.rotate(a - Math.PI / 2);
  g.font = `${weight} ${px(size)}px ${SERIF}`;
  g.letterSpacing = `${px(size) * spacing}px`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // letterSpacing adds space after the last letter too; shift back half of it to stay centred
  g.fillText(text, (px(size) * spacing) / 2, 0);
  g.restore();
}

/** Text laid along the arc of radius r around the table's centre, centred on angle `centre`. */
function arcText(g: CanvasRenderingContext2D, px: Px, text: string, r: number, centre: number, size: number, track = 0.2): void {
  g.save();
  g.font = `600 ${px(size)}px ${SERIF}`;
  g.letterSpacing = '0px';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const gap = px(size) * track;
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  const rp = px(r);
  let a = centre + total / 2 / rp;
  [...text].forEach((ch, i) => {
    const w = widths[i]!;
    const mid = a - w / 2 / rp;
    const [x, z] = polar(r, mid);
    g.save();
    g.translate(px(x), px(z));
    g.rotate(mid - Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    a -= (w + gap) / rp;
  });
  g.restore();
}

function paint(g: CanvasRenderingContext2D, px: Px): void {
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineJoin = 'round';

  // a pinstripe inside the rail
  g.lineWidth = px(0.0025);
  g.strokeStyle = INK_SOFT;
  g.beginPath();
  g.arc(0, px(CZ), px(R_FELT - 0.018), -ARC_OVER, Math.PI + ARC_OVER);
  g.stroke();
  g.strokeStyle = INK;

  for (let n = 1; n <= SEAT_COUNT; n++) {
    const a = seatAngle(n);
    g.lineWidth = px(0.0035);
    for (const key of ['player', 'banker', 'tie'] as const) {
      const b = BANDS[key];
      pathOf(g, px, sectorPoints(b.r0, b.r1, a - b.half, a + b.half, 16));
      g.stroke();
      const [x, z] = polar((b.r0 + b.r1) / 2, a);
      textAt(g, px, b.label, x, z, a, b.font);
    }
    // the seat's number at the rail
    const [nx, nz] = polar(NUMBER_R, a);
    g.lineWidth = px(0.0025);
    circle(g, px, nx, nz, 0.022);
    g.stroke();
    textAt(g, px, String(n), nx, nz + 0.0005, a, 0.024, 700, 0);
    for (const [side, label] of [[1, 'P PAIR'], [-1, 'B PAIR']] as const) {
      const pa = a + side * PAIR_OFFSET;
      const [px0, pz0] = polar(PAIR_R, pa);
      g.lineWidth = px(0.003);
      circle(g, px, px0, pz0, PAIR_RADIUS);
      g.stroke();
      const up = 0.007;
      textAt(g, px, label, px0 - Math.cos(pa) * up, pz0 - Math.sin(pa) * up, pa, 0.0098, 700, 0.05);
      textAt(g, px, '11 TO 1', px0 + Math.cos(pa) * 0.0085, pz0 + Math.sin(pa) * 0.0085, pa, 0.0074, 600, 0.08);
    }
  }

  // the two hands
  g.lineWidth = px(0.003);
  for (const [hand, label] of [['player', 'PLAYER'], ['banker', 'BANKER']] as const) {
    const c = HAND_BOX[hand];
    g.beginPath();
    g.roundRect(px(c.x - HAND_BOX.w / 2), px(c.z - HAND_BOX.d / 2), px(HAND_BOX.w), px(HAND_BOX.d), px(0.012));
    g.stroke();
    textAt(g, px, label, c.x, c.z + HAND_BOX.d / 2 + 0.024, Math.PI / 2, 0.03, 600, 0.18);
  }
  arcText(g, px, 'TIE PAYS 8 TO 1', 0.5, Math.PI / 2, 0.026);

  // commission boxes, numbered by seat
  g.lineWidth = px(0.0025);
  for (let n = 1; n <= SEAT_COUNT; n++) {
    const [x, z] = commissionBox(n);
    g.strokeRect(px(x - COMMISSION.w / 2), px(z - COMMISSION.d / 2), px(COMMISSION.w), px(COMMISSION.d));
    textAt(g, px, String(n), x, z + 0.001, Math.PI / 2, 0.017, 600, 0);
  }
  g.fillStyle = INK_SOFT;
  textAt(g, px, 'COMMISSION', 0, COMMISSION.z + COMMISSION.d / 2 + 0.018, Math.PI / 2, 0.0105, 600, 0.3);
}

function regions(): Region[] {
  const out: Region[] = [];
  for (let n = 1; n <= SEAT_COUNT; n++) {
    const a = seatAngle(n);
    for (const spot of SPOTS) {
      const anchor = spotCentre(n, spot);
      if (spot === 'playerPair' || spot === 'bankerPair') {
        out.push({ id: regionId(n, spot), shape: { kind: 'circle', x: anchor[0], z: anchor[1], r: PAIR_RADIUS + 0.004 }, anchor });
      } else {
        const b = BANDS[spot];
        out.push({ id: regionId(n, spot), shape: { kind: 'poly', points: sectorPoints(b.r0, b.r1, a - b.half, a + b.half, 6) }, anchor });
      }
    }
  }
  return out;
}

export function feltSpec(resolution?: number): FeltSpec {
  const spec: FeltSpec = { width: FELT_W, depth: FELT_D, color: FELT_COLOR, paint, regions: regions() };
  if (resolution) spec.resolution = resolution;
  return spec;
}

let kidney: THREE.BufferGeometry | null = null;

/**
 * The felt cut to the table's outline, with UVs that map the painted rectangle onto it, so the
 * Felt painter's texture lines up exactly. Built in the plane's own axes (x, y = -z): the felt
 * mesh is turned flat with rotation.x = -PI/2.
 */
export function kidneyGeometry(): THREE.BufferGeometry {
  if (kidney) return kidney;
  const shape = new THREE.Shape(feltOutline().map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(shape, 24);
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / FELT_W + 0.5, pos.getY(i) / FELT_D + 0.5);
  }
  uv.needsUpdate = true;
  kidney = geo;
  return geo;
}
