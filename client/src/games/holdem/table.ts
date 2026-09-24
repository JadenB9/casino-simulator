// The Hold'em table's layout: a racetrack oval (two straight sides and two half-circle ends) of
// felt, a walnut racetrack and a padded rail round it, and chairs round that. Every position a
// view needs (where a seat's cards, bets and nameplate go, where the board and pot sit) and every
// part of the model (model.ts) comes from one function that walks the oval, so the drawing and
// the layout can't drift apart.

import * as THREE from 'three';
import { Felt } from '../../table/felt.ts';
import { CARD_W, CARD_H } from '../../table/cards.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { FELT_COLOR, weaveFor } from './art.ts';

export const TOP_Y = 0.76;
/** Half the length of the straight sides, and the radius of the ends (the felt's edge). */
export const SL = 0.62;
export const RR = 0.6;
export const FELT_W = 2 * (SL + RR);
export const FELT_D = 2 * RR;
/** The walnut racetrack's width round the felt, then the padded rail's. */
export const TRIM = 0.05;
export const RAIL_IN = RR + TRIM;
export const RAIL_W = 0.115;
export const RAIL_OUT = RAIL_IN + RAIL_W;
/** The rail breaks for the dealer between these x on the far side (the tray sits there). */
export const DEALER_GAP = 0.34;
/**
 * Where the chairs stand (the middle of each seat, 0.48 m up): near enough in that every chair's
 * back, the turned ones at the ends included, stays inside the station's footprint (the oval
 * RR + 0.62 out), with the seat's front edge tucked under the rail's overhang.
 */
export const CHAIR_R = RR + 0.3;
/** The footprint's reach round the oval, as it has always been (the poker room is laid out on it). */
export const FOOTPRINT_R = RR + 0.62;

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

/** The point on the oval of radius `r` nearest (x, z), with its outward normal. */
export function nearestOnOval(x: number, z: number, r: number): EdgePoint {
  if (Math.abs(x) <= SL) return { x, z: Math.sign(z || 1) * r, nx: 0, nz: Math.sign(z || 1) };
  const cx = Math.sign(x) * SL;
  const d = Math.hypot(x - cx, z) || 1;
  const nx = (x - cx) / d;
  const nz = z / d;
  return { x: cx + nx * r, z: nz * r, nx, nz };
}

/**
 * The nine chairs: ten places evenly round the oval at CHAIR_R, the middle of the far side left
 * to the dealer. Near side first, then round the left end, the far side and back. `yaw` turns a
 * chair (or a sitter) built facing +z to face the table.
 */
export function chairSpots(): (EdgePoint & { yaw: number })[] {
  const out: (EdgePoint & { yaw: number })[] = [];
  for (let k = 0; k < 10; k++) {
    if (k === 5) continue;
    const e = oval(k / 10, CHAIR_R);
    out.push({ ...e, yaw: Math.atan2(-e.nx, -e.nz) });
  }
  return out;
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

/**
 * The house's printing: a darker vignette toward the rail, the betting line, an inlay inside the
 * rail, the five board spots and the lettering (`rules`, the line under the name, when known).
 */
function paintFelt(g: CanvasRenderingContext2D, px: (m: number) => number, rules: string | null): void {
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
  g.fillText(rules ?? 'NO LIMIT', 0, px(-0.162));
}

/** Oval felt geometry with UVs laid over the full painted rectangle, so painted coordinates line up. */
function feltGeometry(r = RR): THREE.ShapeGeometry {
  const geo = new THREE.ShapeGeometry(ovalShape(r), 64);
  const pos = geo.attributes.position!;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[2 * i] = (pos.getX(i) + FELT_W / 2) / FELT_W;
    uv[2 * i + 1] = (pos.getY(i) + FELT_D / 2) / FELT_D;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** The printed felt: the betting line, the board spots and the house's lettering. */
export function holdemFelt(blinds: { sb: Cents; bb: Cents }, seats: number): Felt {
  const felt = new Felt({
    width: FELT_W,
    depth: FELT_D,
    color: FELT_COLOR,
    resolution: 1500,
    paint: (g, px) => paintFelt(g, px, `NO LIMIT  ·  BLINDS ${formatMoney(blinds.sb)} / ${formatMoney(blinds.bb)}  ·  ${seats} SEATS`),
    regions: [],
  });
  // The painter makes a rectangle; give the same texture an oval outline instead.
  felt.mesh.geometry.dispose();
  felt.mesh.geometry = feltGeometry();
  // and the cloth's weave in the light, up close
  const mat = felt.mesh.material as THREE.MeshStandardMaterial;
  mat.bumpMap = weaveFor(FELT_W, FELT_D);
  mat.bumpScale = 0.35;
  return felt;
}

const floorFelts = new Map<boolean, THREE.MeshStandardMaterial>();

/**
 * The felt the table shows on the floor (the view lays its own over it once you sit): the same
 * green and printing without the blinds, one modest texture shared by every Hold'em table,
 * repainted once the lettering's face has loaded. An ordinary textured material, so the far
 * stand-ins keep it green.
 */
export function floorFelt(high: boolean): THREE.MeshStandardMaterial {
  const have = floorFelts.get(high);
  if (have) return have;
  const ppm = high ? 480 : 300;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(FELT_W * ppm);
  canvas.height = Math.round(FELT_D * ppm);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paint = () => {
    const g = canvas.getContext('2d')!;
    g.fillStyle = FELT_COLOR;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.save();
    g.translate(canvas.width / 2, canvas.height / 2);
    paintFelt(g, (m) => m * ppm, null);
    g.restore();
    tex.needsUpdate = true;
  };
  paint();
  void document.fonts?.load('600 20px Cinzel').then(paint, () => {});
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  if (high) {
    mat.bumpMap = weaveFor(FELT_W, FELT_D);
    mat.bumpScale = 0.35;
  }
  floorFelts.set(high, mat);
  return mat;
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

/**
 * The dealer button: a white acrylic puck, 5 cm across and 1 cm thick with rounded edges, DEALER
 * in black across it. Its origin is 3.5 mm above its underside (where the view has always put
 * it), so it sits on the felt.
 */
export function dealerButton(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f3ec';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#1d1d20';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#1d1d20';
  g.font = '700 54px "Barlow Condensed", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('DEALER', 128, 131);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // the puck's side, turned: a flat top 2 cm across, rounded down to the full 2.5 cm radius
  const R = 0.025;
  const H = 0.01;
  const edge = 0.003;
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(R - edge, 0)];
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - edge + Math.cos(a) * edge, edge + Math.sin(a) * edge));
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - edge + Math.cos(a) * edge, H - edge + Math.sin(a) * edge));
  }
  pts.push(new THREE.Vector2(0, H));
  const side = new THREE.LatheGeometry(pts, 40);
  side.translate(0, -0.0035, 0);
  const top = new THREE.CircleGeometry(R - edge + 0.0005, 40);
  top.rotateX(-Math.PI / 2);
  top.translate(0, H - 0.0035 + 0.0001, 0);
  const body = new THREE.MeshStandardMaterial({ color: '#efebe2', roughness: 0.3 });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 });
  const m = new THREE.Mesh(side, body);
  m.add(new THREE.Mesh(top, face));
  m.name = 'dealer-button';
  return m;
}
