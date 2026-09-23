// Where everything sits on a Three Card Poker table, in table-local metres: +x is the dealer's
// left (first base), +z points at the players, y is up. The felt printing, the click regions, the
// chips, the cards and the camera all come from these numbers, so they can't drift apart.
//
// The table is a "D": a straight edge on the dealer's side and an arc on the players' side. Six
// player positions sit along the arc, each with the three spots in a column: PAIR PLUS nearest
// the dealer, then ANTE, then PLAY nearest the player.

import * as THREE from 'three';
import { Felt, type Region } from '../../table/felt.ts';
import type { Paytable } from '../../../../shared/src/games/threecard/rules.ts';
import { CATEGORY_NAMES } from '../../../../shared/src/games/threecard/rules.ts';

export const TOP_Y = 0.76;
/** Centre of the players' arc, behind the dealer's edge. */
export const CENTER_Z = -0.64;
export const FELT_R = 1.1;
export const DEALER_Z = -0.44;
export const RAIL_R = 1.155;

/** Felt rectangle that covers the D (the mesh itself is cut to the D). */
export const FELT_W = 2.2;
export const FELT_D = 0.92;

/** Position angles from +z, first base (the dealer's left) first. */
const POSITION_DEG = [50, 30, 10, -10, -30, -50];
/** Seats fill the middle of the table first, so a solo player sits nearly in front of the dealer. */
const SEAT_POSITION = [2, 3, 1, 4, 0, 5];
export const SEAT_COUNT = 6;

export const SPOT_R = { pairPlus: 0.745, ante: 0.862, play: 0.98 } as const;
export type SpotKind = keyof typeof SPOT_R;
export const SPOT_RADIUS = 0.044;
const HAND_R = 0.575;
const FAN = 0.036;
const TEXT_R = 0.48;

export const DEALER_CARDS_Z = -0.328;
export const DEALER_CARD_GAP = 0.074;
export const RACK = { x: 0, z: -0.412, w: 0.44, d: 0.056 };
export const SHUFFLER = new THREE.Vector3(-0.3, TOP_Y + 0.05, -0.405);
export const DISCARD = new THREE.Vector3(0.3, TOP_Y + 0.02, -0.405);
export const PAYTABLE_X = 0.72;
const PAYTABLE_Z = -0.345;
const PAYTABLE_W = 0.34;
const PAYTABLE_H = 0.17;

/** Position index (0 = first base) of a seat. */
export function positionOf(seat: number): number {
  return SEAT_POSITION[seat] ?? seat;
}

/** A seat's angle from +z in radians (positive toward +x). */
export function seatAngle(seat: number): number {
  return (POSITION_DEG[positionOf(seat)]! * Math.PI) / 180;
}

/** The point `r` from the arc centre along angle `a`. */
export function along(a: number, r: number): [number, number] {
  return [Math.sin(a) * r, CENTER_Z + Math.cos(a) * r];
}

export function spotPoint(seat: number, kind: SpotKind, y = TOP_Y): THREE.Vector3 {
  const [x, z] = along(seatAngle(seat), SPOT_R[kind]);
  return new THREE.Vector3(x, y, z);
}

/** Next to a spot, toward the player's right: where the dealer sets a payout down. */
export function payoutPoint(seat: number, kind: SpotKind): THREE.Vector3 {
  const a = seatAngle(seat);
  const p = spotPoint(seat, kind);
  const side = SPOT_RADIUS * 1.25;
  return p.add(new THREE.Vector3(Math.cos(a) * side, 0, -Math.sin(a) * side));
}

/** Where a seat's cards lie: three, fanned, facing the player. */
export function handSlot(seat: number, i: number): { pos: THREE.Vector3; yaw: number } {
  const a = seatAngle(seat);
  const [x, z] = along(a, HAND_R);
  const off = (i - 1) * FAN;
  return { pos: new THREE.Vector3(x + Math.cos(a) * off, TOP_Y + 0.001 + i * 0.0006, z - Math.sin(a) * off), yaw: a };
}

export function dealerSlot(i: number): THREE.Vector3 {
  return new THREE.Vector3((i - 1) * DEALER_CARD_GAP, TOP_Y + 0.001, DEALER_CARDS_Z);
}

/** Toward the player from their play spot, where collected chips go. */
export function railPoint(seat: number): THREE.Vector3 {
  const [x, z] = along(seatAngle(seat), FELT_R + 0.02);
  return new THREE.Vector3(x, TOP_Y + 0.02, z);
}

/** Where a seated player's avatar stands, and the camera pose to play from. */
export function seatPose(seat: number): { position: [number, number, number]; yaw: number } {
  const a = seatAngle(seat);
  const [x, z] = along(a, 1.5);
  return { position: [x, 0, z], yaw: a + Math.PI };
}

export function cameraPose(seat: number): { position: [number, number, number]; target: [number, number, number] } {
  const a = seatAngle(seat);
  const [cx, cz] = along(a, 1.45);
  const [tx, tz] = along(a, 0.55);
  return { position: [cx, 1.34, cz], target: [tx, TOP_Y, tz] };
}

// ---------------------------------------------------------------------------------------------
// The D outline

/** The table's outline as a shape in the felt's plane (x, -z), for the felt mesh and the table top. */
export function dShape(r = FELT_R, dealerZ = DEALER_Z): THREE.Shape {
  const half = Math.acos((dealerZ - CENTER_Z) / r);
  const s = new THREE.Shape();
  // shape y is -z; the players' arc points toward shape angle -90 degrees
  s.absarc(0, -CENTER_Z, r, -Math.PI / 2 - half, -Math.PI / 2 + half, false);
  s.closePath();
  return s;
}

/** Cut a Felt's rectangle down to the D, keeping the texture where it was. */
export function cutFeltToD(felt: Felt): void {
  const geo = new THREE.ShapeGeometry(dShape(), 72);
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / FELT_W + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / FELT_D + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  felt.mesh.geometry.dispose();
  felt.mesh.geometry = geo;
}

// ---------------------------------------------------------------------------------------------
// The printed felt

const INK = '#efd9a2';
const INK_SOFT = 'rgba(239,217,162,0.55)';
export const FELT_BLUE = '#17477d';

function outlinePath(g: CanvasRenderingContext2D, px: (m: number) => number, inset: number): void {
  const r = FELT_R - inset;
  const dz = DEALER_Z + inset;
  const half = Math.acos((dz - CENTER_Z) / r);
  // canvas angles run from +x toward +z (canvas y is table z)
  g.beginPath();
  g.arc(0, px(CENTER_Z), px(r), Math.PI / 2 + half, Math.PI / 2 - half, true);
  g.closePath();
}

/** Letters laid along an arc around the table centre, reading left to right from the players. */
function arcText(g: CanvasRenderingContext2D, px: (m: number) => number, text: string, r: number, size: number, tracking: number): void {
  g.font = `600 ${px(size)}px Cinzel, Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const widths = [...text].map((ch) => g.measureText(ch).width + px(tracking));
  const total = widths.reduce((a, b) => a + b, 0);
  let a = -total / px(r) / 2;
  [...text].forEach((ch, i) => {
    const w = widths[i]!;
    a += w / px(r) / 2;
    const [x, z] = along(a, r);
    g.save();
    g.translate(px(x), px(z));
    g.rotate(-a);
    g.fillText(ch, 0, 0);
    g.restore();
    a += w / px(r) / 2;
  });
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

function paytableBox(g: CanvasRenderingContext2D, px: (m: number) => number, cx: number, title: string, rows: [string, number][]): void {
  const x = px(cx - PAYTABLE_W / 2);
  const y = px(PAYTABLE_Z - PAYTABLE_H / 2);
  g.fillStyle = 'rgba(8,22,44,0.28)';
  roundRect(g, x, y, px(PAYTABLE_W), px(PAYTABLE_H), px(0.012));
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = px(0.0028);
  g.stroke();
  g.fillStyle = INK;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = `700 ${px(0.024)}px Cinzel, Georgia, serif`;
  g.fillText(title, px(cx), y + px(0.024));
  g.strokeStyle = INK_SOFT;
  g.lineWidth = px(0.0015);
  g.beginPath();
  g.moveTo(x + px(0.03), y + px(0.043));
  g.lineTo(x + px(PAYTABLE_W - 0.03), y + px(0.043));
  g.stroke();
  const top = PAYTABLE_Z - PAYTABLE_H / 2 + 0.062;
  const step = (PAYTABLE_H - 0.075) / Math.max(rows.length - 1, 1);
  const lineStep = rows.length > 3 ? step : 0.027;
  const start = rows.length > 3 ? top : top + (step * (rows.length - 1) - lineStep * (rows.length - 1)) / 2 + 0.012;
  g.font = `600 ${px(0.0165)}px Cinzel, Georgia, serif`;
  rows.forEach(([name, pays], i) => {
    const ry = px(start + i * lineStep);
    g.textAlign = 'left';
    g.fillText(name.toUpperCase(), x + px(0.022), ry);
    g.textAlign = 'right';
    g.fillText(`${pays} TO 1`, x + px(PAYTABLE_W - 0.022), ry);
  });
}

function spot(g: CanvasRenderingContext2D, px: (m: number) => number, seat: number, kind: SpotKind): void {
  const a = seatAngle(seat);
  const [x, z] = along(a, SPOT_R[kind]);
  g.save();
  g.translate(px(x), px(z));
  g.rotate(-a);
  g.strokeStyle = INK;
  g.lineWidth = px(0.0035);
  g.fillStyle = 'rgba(8,22,44,0.22)';
  if (kind === 'play') {
    roundRect(g, -px(SPOT_RADIUS), -px(SPOT_RADIUS * 0.82), px(SPOT_RADIUS * 2), px(SPOT_RADIUS * 1.64), px(0.01));
  } else {
    g.beginPath();
    g.arc(0, 0, px(SPOT_RADIUS), 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();
  if (kind === 'pairPlus') {
    // a second ring marks the side bet
    g.lineWidth = px(0.0014);
    g.beginPath();
    g.arc(0, 0, px(SPOT_RADIUS - 0.0065), 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (kind === 'pairPlus') {
    g.font = `700 ${px(0.0122)}px Cinzel, Georgia, serif`;
    g.fillText('PAIR', 0, -px(0.0085));
    g.fillText('PLUS', 0, px(0.0085));
  } else {
    g.font = `700 ${px(0.0145)}px Cinzel, Georgia, serif`;
    g.fillText(kind === 'ante' ? 'ANTE' : 'PLAY', 0, px(0.001));
  }
  g.restore();
}

function paint(pay: Paytable) {
  return (g: CanvasRenderingContext2D, px: (m: number) => number): void => {
    g.strokeStyle = INK;
    g.lineWidth = px(0.004);
    outlinePath(g, px, 0.032);
    g.stroke();
    g.lineWidth = px(0.0016);
    outlinePath(g, px, 0.042);
    g.stroke();

    g.fillStyle = INK;
    arcText(g, px, 'DEALER PLAYS WITH QUEEN HIGH OR BETTER', TEXT_R, 0.025, 0.004);

    const cat = (i: number) => CATEGORY_NAMES[5 - i]!;
    paytableBox(g, px, -PAYTABLE_X, 'PAIR PLUS', pay.pairPlus.map((p, i) => [cat(i), p]));
    paytableBox(g, px, PAYTABLE_X, 'ANTE BONUS', pay.anteBonus.map((p, i) => [cat(i), p]));

    // the dealer's card line
    g.strokeStyle = INK_SOFT;
    g.lineWidth = px(0.0015);
    for (let i = 0; i < 3; i++) {
      const p = dealerSlot(i);
      roundRect(g, px(p.x - 0.035), px(p.z - 0.048), px(0.07), px(0.096), px(0.006));
      g.stroke();
    }

    for (let seat = 0; seat < SEAT_COUNT; seat++) for (const kind of ['pairPlus', 'ante', 'play'] as const) spot(g, px, seat, kind);
  };
}

/** Click regions: every seat's three spots, named `<kind>:<seat>`. */
function regions(): Region[] {
  const out: Region[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    for (const kind of ['pairPlus', 'ante', 'play'] as const) {
      const p = spotPoint(seat, kind);
      out.push({ id: `${kind}:${seat}`, shape: { kind: 'circle', x: p.x, z: p.z, r: SPOT_RADIUS * 1.15 } });
    }
  }
  return out;
}

/** The printed felt, cut to the table's shape. `resolution` is pixels per metre. */
export function makeFelt(pay: Paytable, resolution: number): Felt {
  const felt = new Felt({ width: FELT_W, depth: FELT_D, color: FELT_BLUE, resolution, paint: paint(pay), regions: regions() });
  cutFeltToD(felt);
  return felt;
}

