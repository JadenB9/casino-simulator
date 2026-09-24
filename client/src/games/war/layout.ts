// Where everything sits on a Casino War table, in table-local metres: +x is the dealer's left
// (first base, where the shoe is), +z points at the players, y is up. The felt printing, the click
// regions, the chips, the cards and the camera all come from these numbers, so they can't drift
// apart.
//
// The table is a "D": a straight edge on the dealer's side and an arc on the players' side. Six
// player positions sit along the arc, each with three spots in a column: TIE nearest the dealer,
// then the BET, then the WAR box nearest the player, where the raise goes. A seat's card lands
// between the TIE spot and the dealer, and its war card beside it.

import * as THREE from 'three';
import { Felt, type Region } from '../../table/felt.ts';
import { CARD_H, CARD_W } from '../../table/cards.ts';
import type { WarRules } from '../../../../shared/src/games/war/rules.ts';
import { fitWidth } from '../multihand/frame.ts';

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

export const SPOT_R = { tie: 0.75, bet: 0.866, war: 0.985 } as const;
export type SpotKind = keyof typeof SPOT_R;
export const SPOT_SIZE = { tie: 0.036, bet: 0.047, war: 0.046 } as const;
const CARD_R = 0.6;
/** Half the distance between a seat's card and its war card, and the dealer's two cards. */
const PAIR = CARD_W / 2 + 0.006;
const LOGO_Z = -0.227;
const ARC_R = 0.482;
const HOUSE_R = 0.518;

export const DEALER_CARD_Z = -0.33;
export const RACK = { x: 0, z: -0.412, w: 0.46, d: 0.058 };
/** The shoe on the dealer's left, its mouth toward the players, and the discard holder on the right. */
export const SHOE = { pos: new THREE.Vector3(0.37, TOP_Y, -0.372), yaw: -0.42 };
export const SHOE_MOUTH = new THREE.Vector3(0.325, TOP_Y + 0.05, -0.33);
export const DISCARD = new THREE.Vector3(-0.37, TOP_Y + 0.003, -0.382);
export const BOX_X = 0.74;
const BOX_Z = -0.305;
const BOX_W = 0.33;
const BOX_H = 0.16;

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

/** `r` out along a seat's line and `side` along the arc toward the player's right (+x at the centre). */
function onSeat(seat: number, r: number, side: number, y: number): THREE.Vector3 {
  const a = seatAngle(seat);
  const [x, z] = along(a, r);
  return new THREE.Vector3(x + Math.cos(a) * side, y, z - Math.sin(a) * side);
}

export function spotPoint(seat: number, kind: SpotKind, y = TOP_Y): THREE.Vector3 {
  return onSeat(seat, SPOT_R[kind], 0, y);
}

/** Beside a spot, toward the player's right: where the dealer sets a payout down. */
export function payoutPoint(seat: number, kind: SpotKind): THREE.Vector3 {
  return onSeat(seat, SPOT_R[kind], SPOT_SIZE[kind] * 1.3 + 0.02, TOP_Y);
}

/** Beside a spot, `offset` toward the player's right (negative: left), a little above the felt: pills and tips. */
export function besideSpot(seat: number, kind: SpotKind, offset: number): THREE.Vector3 {
  return onSeat(seat, SPOT_R[kind], offset, TOP_Y + 0.02);
}

/** Where a seat's card lies (war = the war card beside it), facing the player. */
export function cardSlot(seat: number, war: boolean): { pos: THREE.Vector3; yaw: number } {
  return { pos: onSeat(seat, CARD_R, war ? PAIR : -PAIR, TOP_Y + 0.001), yaw: seatAngle(seat) };
}

/** The dealer's card, and the dealer's war card beside it. */
export function dealerSlot(war: boolean): THREE.Vector3 {
  return new THREE.Vector3(war ? PAIR : -PAIR, TOP_Y + 0.001, DEALER_CARD_Z);
}

/** Between a seat's cards and its TIE spot, clear of the printing: where the call for that hand is pinned. */
export function handLabelPoint(seat: number): THREE.Vector3 {
  return onSeat(seat, (CARD_R + CARD_H / 2 + SPOT_R.tie - SPOT_SIZE.tie) / 2, 0, TOP_Y + 0.01);
}

/** Toward the player from their WAR box, where collected chips go. */
export function railPoint(seat: number): THREE.Vector3 {
  return onSeat(seat, FELT_R + 0.02, 0, TOP_Y + 0.02);
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

/**
 * The camera for a solo player on several spots (numbered like seats): over the middle of their
 * positions, further back and a little higher the wider they spread, so every spot's cards and
 * boxes and the dealer's cards are in view. One spot is its seat's pose.
 */
export function spotsPose(spots: readonly number[], aspect?: number): { position: [number, number, number]; target: [number, number, number] } {
  if (spots.length <= 1) return cameraPose(spots[0] ?? 0);
  const angles = spots.map(seatAngle);
  const a = angles.reduce((x, y) => x + y, 0) / angles.length;
  const spread = Math.max(...angles) - Math.min(...angles);
  const [cx, cz] = along(a, 1.45 + 0.1 * spread);
  const [tx, tz] = along(a, 0.53);
  // wide enough for the outer spots' War boxes, on any screen
  const half = SPOT_R.war * Math.sin(spread / 2) + 0.14;
  return fitWidth({ position: [cx, 1.36 + 0.14 * spread, cz], target: [tx, TOP_Y, tz] }, half, aspect);
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
function cutFeltToD(felt: Felt): void {
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
const WELL = 'rgba(4,22,24,0.26)';
export const FELT_TEAL = '#0f4f55';
const SERIF = 'Cinzel, Georgia, serif';

type Px = (m: number) => number;

function outlinePath(g: CanvasRenderingContext2D, px: Px, inset: number): void {
  const r = FELT_R - inset;
  const dz = DEALER_Z + inset;
  const half = Math.acos((dz - CENTER_Z) / r);
  // canvas angles run from +x toward +z (canvas y is table z)
  g.beginPath();
  g.arc(0, px(CENTER_Z), px(r), Math.PI / 2 + half, Math.PI / 2 - half, true);
  g.closePath();
}

/** Letters laid along an arc around the table centre, reading left to right from the players. */
function arcText(g: CanvasRenderingContext2D, px: Px, text: string, r: number, size: number, tracking: number, weight = 600): void {
  g.font = `${weight} ${px(size)}px ${SERIF}`;
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

/** A boxed table of rows ("TIE THE WAR · 2 TO 1") beside the dealer, with an optional note under it. */
function ruleBox(g: CanvasRenderingContext2D, px: Px, cx: number, title: string, rows: [string, string][], note: string): void {
  const x = px(cx - BOX_W / 2);
  const y = px(BOX_Z - BOX_H / 2);
  g.fillStyle = WELL;
  roundRect(g, x, y, px(BOX_W), px(BOX_H), px(0.012));
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = px(0.0028);
  g.stroke();
  g.fillStyle = INK;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = `700 ${px(0.024)}px ${SERIF}`;
  g.fillText(title, px(cx), y + px(0.025));
  g.strokeStyle = INK_SOFT;
  g.lineWidth = px(0.0015);
  g.beginPath();
  g.moveTo(x + px(0.03), y + px(0.045));
  g.lineTo(x + px(BOX_W - 0.03), y + px(0.045));
  g.stroke();
  g.font = `600 ${px(0.0168)}px ${SERIF}`;
  rows.forEach(([name, pays], i) => {
    const ry = y + px(0.071 + i * 0.03);
    g.textAlign = 'left';
    g.fillText(name, x + px(0.022), ry);
    g.textAlign = 'right';
    g.fillText(pays, x + px(BOX_W - 0.022), ry);
  });
  g.fillStyle = INK_SOFT;
  g.textAlign = 'center';
  g.font = `600 ${px(0.0132)}px ${SERIF}`;
  g.fillText(note, px(cx), y + px(BOX_H - 0.02));
}

/** The big WAR in the middle of the felt, between two rules that end in diamonds. */
function logo(g: CanvasRenderingContext2D, px: Px): void {
  g.save();
  g.translate(0, px(LOGO_Z));
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${px(0.074)}px ${SERIF}`;
  const tracking = px(0.018);
  const letters = [...'WAR'];
  const widths = letters.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (letters.length - 1);
  let x = -total / 2;
  letters.forEach((ch, i) => {
    g.fillText(ch, x + widths[i]! / 2, 0);
    x += widths[i]! + tracking;
  });
  // rules either side, each ending in a small diamond
  g.strokeStyle = INK;
  g.lineWidth = px(0.0022);
  for (const s of [-1, 1]) {
    const from = s * (total / 2 + px(0.024));
    const to = s * (total / 2 + px(0.13));
    g.beginPath();
    g.moveTo(from, 0);
    g.lineTo(to, 0);
    g.stroke();
    g.beginPath();
    g.moveTo(to + s * px(0.012), 0);
    g.lineTo(to, -px(0.006));
    g.lineTo(to - s * px(0.012), 0);
    g.lineTo(to, px(0.006));
    g.closePath();
    g.fill();
  }
  g.restore();
}

function spot(g: CanvasRenderingContext2D, px: Px, seat: number, kind: SpotKind, rules: WarRules): void {
  const a = seatAngle(seat);
  const [x, z] = along(a, SPOT_R[kind]);
  const r = SPOT_SIZE[kind];
  g.save();
  g.translate(px(x), px(z));
  g.rotate(-a);
  g.strokeStyle = INK;
  g.lineWidth = px(0.0035);
  g.fillStyle = WELL;
  if (kind === 'war') {
    roundRect(g, -px(r), -px(r * 0.8), px(r * 2), px(r * 1.6), px(0.01));
  } else {
    g.beginPath();
    g.arc(0, 0, px(r), 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();
  if (kind === 'tie') {
    // a second ring marks the side bet
    g.lineWidth = px(0.0014);
    g.beginPath();
    g.arc(0, 0, px(r - 0.006), 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (kind === 'tie') {
    g.font = `700 ${px(0.0135)}px ${SERIF}`;
    g.fillText('TIE', 0, -px(0.0072));
    g.font = `600 ${px(0.0086)}px ${SERIF}`;
    g.fillText(`${rules.tiePays} TO 1`, 0, px(0.0082));
  } else {
    g.font = `700 ${px(0.0158)}px ${SERIF}`;
    g.fillText(kind === 'bet' ? 'BET' : 'WAR', 0, px(0.001));
  }
  g.restore();
}

function paint(rules: WarRules) {
  return (g: CanvasRenderingContext2D, px: Px): void => {
    g.strokeStyle = INK;
    g.lineWidth = px(0.004);
    outlinePath(g, px, 0.032);
    g.stroke();
    g.lineWidth = px(0.0016);
    outlinePath(g, px, 0.042);
    g.stroke();

    logo(g, px);
    g.fillStyle = INK;
    arcText(g, px, `TIE PAYS ${rules.tiePays} TO 1`, ARC_R, 0.027, 0.005, 700);
    g.fillStyle = INK_SOFT;
    arcText(g, px, 'HIGH CARD WINS · ACES ARE HIGH', HOUSE_R, 0.0148, 0.003);

    const pays = (n: number) => `${n} TO 1`;
    ruleBox(g, px, -BOX_X, 'ON A TIE', [['SURRENDER', 'HALF BACK'], ['OR GO TO WAR', 'RAISE THE BET']], 'THE DEALER BURNS THREE');
    ruleBox(g, px, BOX_X, 'WAR PAYS', [['WIN THE WAR', pays(1)], ['TIE THE WAR', pays(rules.warTiePays)]], 'ON THE RAISE · THE BET PUSHES');

    // the dealer's card and war card
    g.strokeStyle = INK_SOFT;
    g.lineWidth = px(0.0015);
    for (const war of [false, true]) {
      const p = dealerSlot(war);
      roundRect(g, px(p.x - CARD_W / 2 - 0.003), px(p.z - CARD_H / 2 - 0.003), px(CARD_W + 0.006), px(CARD_H + 0.006), px(0.006));
      g.stroke();
    }

    for (let seat = 0; seat < SEAT_COUNT; seat++) for (const kind of ['tie', 'bet', 'war'] as const) spot(g, px, seat, kind, rules);
  };
}

/** Click regions: every seat's three spots, named `<kind>:<seat>`. */
function regions(): Region[] {
  const out: Region[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    for (const kind of ['tie', 'bet', 'war'] as const) {
      const p = spotPoint(seat, kind);
      out.push({ id: `${kind}:${seat}`, shape: { kind: 'circle', x: p.x, z: p.z, r: SPOT_SIZE[kind] * 1.15 } });
    }
  }
  return out;
}

/** The printed felt, cut to the table's shape. `resolution` is pixels per metre. */
export function makeFelt(rules: WarRules, resolution: number): Felt {
  const felt = new Felt({ width: FELT_W, depth: FELT_D, color: FELT_TEAL, resolution, paint: paint(rules), regions: regions() });
  cutFeltToD(felt);
  return felt;
}
