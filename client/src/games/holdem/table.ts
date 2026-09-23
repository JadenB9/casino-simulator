// The Hold'em table as geometry: a racetrack oval (two straight sides and two half-circle ends)
// with dark green felt, a padded leather rail and a wooden apron on a pedestal. Every position a
// view needs (where a seat's cards, bets and nameplate go, where the board and pot sit) comes
// from one function that walks the oval, so the drawing and the layout can't drift apart.

import * as THREE from 'three';
import { Felt } from '../../table/felt.ts';
import { CARD_W, CARD_H } from '../../table/cards.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';

export const TOP_Y = 0.76;
/** Half the length of the straight sides, and the radius of the ends (the felt's edge). */
export const SL = 0.62;
export const RR = 0.6;
export const FELT_W = 2 * (SL + RR);
export const FELT_D = 2 * RR;
const RAIL_R = 0.055;
const FELT_COLOR = '#154a33';

export interface EdgePoint {
  x: number;
  z: number;
  /** Outward normal. */
  nx: number;
  nz: number;
}

/**
 * A point on the oval of radius `r` (same centres as the felt), `t` of the way round (0..1),
 * starting at the middle of the near side and going clockwise as seen from above the player:
 * left along the near side, round the left end, across the far side, round the right end.
 */
export function oval(t: number, r = RR): EdgePoint {
  const perim = 4 * SL + 2 * Math.PI * r;
  let s = (((t % 1) + 1) % 1) * perim;
  if (s < SL) return { x: -s, z: r, nx: 0, nz: 1 };
  s -= SL;
  if (s < Math.PI * r) {
    const th = Math.PI / 2 + s / r;
    return { x: -SL + r * Math.cos(th), z: r * Math.sin(th), nx: Math.cos(th), nz: Math.sin(th) };
  }
  s -= Math.PI * r;
  if (s < 2 * SL) return { x: -SL + s, z: -r, nx: 0, nz: -1 };
  s -= 2 * SL;
  if (s < Math.PI * r) {
    const th = 1.5 * Math.PI + s / r;
    return { x: SL + r * Math.cos(th), z: r * Math.sin(th), nx: Math.cos(th), nz: Math.sin(th) };
  }
  s -= Math.PI * r;
  return { x: SL - s, z: r, nx: 0, nz: 1 };
}

/** Where visual slot `k` of `n` sits on the felt's edge. The dealer has the middle of the far side. */
export function slotEdge(k: number, n: number): EdgePoint {
  return oval(k / (n + 1));
}

/** A point `inset` metres in from the felt's edge at a slot (negative goes outward, past the rail). */
export function slotPoint(k: number, n: number, inset: number, y = TOP_Y): THREE.Vector3 {
  const e = slotEdge(k, n);
  return new THREE.Vector3(e.x - e.nx * inset, y, e.z - e.nz * inset);
}

/** Rotation about y that turns a card's top edge away from the seat at this slot (so its owner reads it). */
export function slotYaw(k: number, n: number): number {
  const e = slotEdge(k, n);
  return Math.atan2(e.nx, e.nz);
}

export const DEALER_POINT = new THREE.Vector3(0, TOP_Y + 0.03, -RR + 0.14);
export const POT_POINT = new THREE.Vector3(0, TOP_Y, 0.2);
/**
 * The board is dealt larger than life: everyone reads it from across the table, and it's the
 * part of the felt every decision turns on. The printed card spots use the same size.
 */
export const BOARD_SCALE = 1.6;
const BOARD_Z = -0.035;
const BOARD_GAP = 0.014;
export function boardPoint(i: number): THREE.Vector3 {
  return new THREE.Vector3((i - 2) * (CARD_W * BOARD_SCALE + BOARD_GAP), TOP_Y + 0.0012, BOARD_Z);
}

function ovalPoints(r: number, n = 160): EdgePoint[] {
  return Array.from({ length: n }, (_, i) => oval(i / n, r));
}

/** A flat oval in the xz plane at radius r, as geometry lying in the plane's own xy (y = -z). */
function ovalShape(r: number): THREE.Shape {
  const pts = ovalPoints(r).map((p) => new THREE.Vector2(p.x, -p.z));
  return new THREE.Shape(pts);
}

/** The table on the floor: body, apron, rail and felt-coloured top (the view adds the printed felt). */
export function tableModel(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#2a1810', roughness: 0.55, metalness: 0.05 });
  const leather = new THREE.MeshStandardMaterial({ color: '#16110e', roughness: 0.48, metalness: 0.02 });
  const brass = new THREE.MeshStandardMaterial({ color: '#b08a4a', roughness: 0.35, metalness: 0.8 });

  // apron: the oval extruded downward
  const apron = new THREE.Mesh(new THREE.ExtrudeGeometry(ovalShape(RR + 0.1), { depth: 0.09, bevelEnabled: false, curveSegments: 48 }), wood);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = TOP_Y - 0.09;
  g.add(apron);

  // felt-coloured top under the printed felt, so the model reads right from across the floor
  const top = new THREE.Mesh(new THREE.ShapeGeometry(ovalShape(RR + 0.02), 48), new THREE.MeshStandardMaterial({ color: FELT_COLOR, roughness: 0.95 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = TOP_Y - 0.0005;
  g.add(top);

  // the padded rail
  const railPath = new THREE.CatmullRomCurve3(
    ovalPoints(RR + 0.052, 96).map((p) => new THREE.Vector3(p.x, TOP_Y + 0.022, p.z)),
    true,
  );
  const rail = new THREE.Mesh(new THREE.TubeGeometry(railPath, 240, RAIL_R, 18, true), leather);
  g.add(rail);
  // a thin brass bead where the rail meets the apron
  const beadPath = new THREE.CatmullRomCurve3(
    ovalPoints(RR + 0.1, 96).map((p) => new THREE.Vector3(p.x, TOP_Y - 0.004, p.z)),
    true,
  );
  g.add(new THREE.Mesh(new THREE.TubeGeometry(beadPath, 240, 0.006, 8, true), brass));

  // pedestal: two tapered columns on a plinth
  for (const x of [-SL * 0.75, SL * 0.75]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, TOP_Y - 0.1, 24), wood);
    col.position.set(x, (TOP_Y - 0.1) / 2, 0);
    g.add(col);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.04, 32), wood);
    foot.position.set(x, 0.02, 0);
    g.add(foot);
  }
  return g;
}

/** The printed felt: the betting line, the board spots and the house's lettering. */
export function holdemFelt(blinds: { sb: Cents; bb: Cents }, seats: number): Felt {
  const felt = new Felt({
    width: FELT_W,
    depth: FELT_D,
    color: FELT_COLOR,
    resolution: 1500,
    paint(g, px) {
      // a darker vignette toward the rail, the way stretched felt catches the light
      const grad = g.createRadialGradient(0, 0, px(0.3), 0, 0, px(SL + RR));
      grad.addColorStop(0, 'rgba(255,255,255,0.05)');
      grad.addColorStop(1, 'rgba(0,0,0,0.28)');
      g.fillStyle = grad;
      g.fillRect(px(-FELT_W / 2), px(-FELT_D / 2), px(FELT_W), px(FELT_D));

      const line = 'rgba(226, 196, 132, 0.62)';
      // the betting line
      g.strokeStyle = line;
      g.lineWidth = px(0.004);
      g.beginPath();
      ovalPoints(RR - 0.27, 200).forEach((p, i) => (i ? g.lineTo(px(p.x), px(p.z)) : g.moveTo(px(p.x), px(p.z))));
      g.closePath();
      g.stroke();
      // an inlay just inside the rail
      g.lineWidth = px(0.0025);
      g.strokeStyle = 'rgba(226, 196, 132, 0.35)';
      g.beginPath();
      ovalPoints(RR - 0.035, 200).forEach((p, i) => (i ? g.lineTo(px(p.x), px(p.z)) : g.moveTo(px(p.x), px(p.z))));
      g.closePath();
      g.stroke();

      // five card spots for the board
      g.strokeStyle = 'rgba(226, 196, 132, 0.4)';
      g.lineWidth = px(0.002);
      const w = CARD_W * BOARD_SCALE;
      const h = CARD_H * BOARD_SCALE;
      for (let i = 0; i < 5; i++) {
        const b = boardPoint(i);
        roundRect(g, px(b.x - w / 2 - 0.004), px(b.z - h / 2 - 0.004), px(w + 0.008), px(h + 0.008), px(0.007));
        g.stroke();
      }

      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(234, 206, 146, 0.8)';
      g.font = `600 ${px(0.052)}px Cinzel, Georgia, serif`;
      g.fillText("TEXAS HOLD'EM", 0, px(-0.222));
      g.font = `500 ${px(0.024)}px Cinzel, Georgia, serif`;
      g.fillStyle = 'rgba(234, 206, 146, 0.62)';
      g.fillText(`NO LIMIT  ·  BLINDS ${formatMoney(blinds.sb)} / ${formatMoney(blinds.bb)}  ·  ${seats} SEATS`, 0, px(-0.162));
    },
    regions: [],
  });
  // The painter makes a rectangle; give the same texture an oval outline instead, with UVs laid
  // out over the full rectangle so the painted coordinates still line up.
  const geo = new THREE.ShapeGeometry(ovalShape(RR), 64);
  const pos = geo.attributes.position!;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[2 * i] = (pos.getX(i) + FELT_W / 2) / FELT_W;
    uv[2 * i + 1] = (pos.getY(i) + FELT_D / 2) / FELT_D;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  felt.mesh.geometry.dispose();
  felt.mesh.geometry = geo;
  return felt;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The dealer button: a white puck with DEALER on it. */
export function dealerButton(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1ea';
  g.beginPath();
  g.arc(64, 64, 64, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1d1d20';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#1d1d20';
  g.font = '700 26px "Barlow Condensed", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DEALER', 64, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
  const side = new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.5 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.007, 36), [side, face, face]);
  return m;
}
