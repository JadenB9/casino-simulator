// Where everything sits on a Let It Ride table, in table-local metres: +x is the dealer's left
// (first base), +z points at the players, y is up. The felt printing, the click regions, the
// chips, the cards and the camera all come from these numbers, so they can't drift apart.
//
// The table is a "D" like the other carnival tables, a size up for seven players. Each player's
// three bets sit in a row across their place, 1, 2 and $ from their left, with the 3-Card Bonus
// circle toward the dealer and their three cards between it and the dealer. The two community
// cards lie in front of the dealer, the pay tables printed either side of them.

import * as THREE from 'three';
import { Felt, type Region } from '../../table/felt.ts';
import { CARD_H, CARD_W } from '../../table/cards.ts';
import type { Paytable } from '../../../../shared/src/games/letitride/rules.ts';
import { BONUS_NAMES, CATEGORY_NAMES } from '../../../../shared/src/games/letitride/rules.ts';
import { fitWidth } from '../multihand/frame.ts';
import { around } from '../../table/fit.ts';

export const TOP_Y = 0.76;
/** Centre of the players' arc, behind the dealer's edge. */
export const CENTER_Z = -0.72;
export const FELT_R = 1.22;
export const DEALER_Z = -0.5;
export const RAIL_R = 1.275;

/** Felt rectangle that covers the D (the mesh itself is cut to the D). */
export const FELT_W = 2.44;
export const FELT_D = 1.0;

/** Position angles from +z, first base (the dealer's left) first. */
const POSITION_DEG = [48, 32, 16, 0, -16, -32, -48];
/** Seats fill the middle of the table first, so a solo player sits in front of the dealer. */
const SEAT_POSITION = [3, 4, 2, 5, 1, 6, 0];
export const SEAT_COUNT = 7;

/** The three bets: across the player's place at BET_R, 1 on their left, $ on their right. */
export type Circle = 0 | 1 | 2;
export const CIRCLE_NAMES = ['1', '2', '$'] as const;
export const BET_R = 0.97;
export const CIRCLE_GAP = 0.08;
export const CIRCLE_RADIUS = 0.034;
export const BONUS_R = 0.825;
export const BONUS_RADIUS = 0.031;
export const HAND_R = 0.665;
const FAN = 0.036;
const TEXT_R = 0.505;
const TITLE_R = 0.578;

/** The community cards lie a size up from the players', so they read from every seat. */
export const BOARD_CARD_SCALE = 1.25;
export const BOARD_Z = -0.36;
export const BOARD_GAP = 0.094;
export const RACK = { x: 0, z: -0.462, w: 0.46, d: 0.058 };
export const SHUFFLER = new THREE.Vector3(-0.34, TOP_Y + 0.05, -0.45);
export const DISCARD = new THREE.Vector3(0.34, TOP_Y + 0.02, -0.45);
const PAYTABLE_X = 0.75;
const PAYTABLE_Z = -0.355;
const PAYTABLE_W = 0.3;
const PAYTABLE_H = 0.21;

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

/** `r` out along a seat's line and `side` across it toward the player's right. */
export function onSeat(seat: number, r: number, side: number, y = TOP_Y): THREE.Vector3 {
  const a = seatAngle(seat);
  const [x, z] = along(a, r);
  return new THREE.Vector3(x + Math.cos(a) * side, y, z - Math.sin(a) * side);
}

export function circlePoint(seat: number, circle: Circle, y = TOP_Y): THREE.Vector3 {
  return onSeat(seat, BET_R, (circle - 1) * CIRCLE_GAP, y);
}

export function bonusPoint(seat: number, y = TOP_Y): THREE.Vector3 {
  return onSeat(seat, BONUS_R, 0, y);
}

/** Beside a circle toward the dealer, where the dealer sets a payout down. */
export function payoutPoint(seat: number, circle: Circle): THREE.Vector3 {
  return onSeat(seat, BET_R - CIRCLE_RADIUS * 2.1, (circle - 1) * CIRCLE_GAP);
}

export function bonusPayoutPoint(seat: number): THREE.Vector3 {
  return onSeat(seat, BONUS_R, BONUS_RADIUS * 2.3);
}

/** Where a seat's cards lie: three, fanned, facing the player. */
export function handSlot(seat: number, i: number): { pos: THREE.Vector3; yaw: number } {
  const a = seatAngle(seat);
  const p = onSeat(seat, HAND_R, (i - 1) * FAN, TOP_Y + 0.001 + i * 0.0006);
  return { pos: p, yaw: a };
}

export function boardSlot(i: number): THREE.Vector3 {
  return new THREE.Vector3((i - 0.5) * BOARD_GAP, TOP_Y + 0.001, BOARD_Z);
}

/** The community cards' label hangs from their near edge. */
export const BOARD_LABEL = new THREE.Vector3(0, TOP_Y + 0.01, BOARD_Z + (CARD_H * BOARD_CARD_SCALE) / 2 + 0.006);

/** The near edge of a seat's cards: its hand's label hangs from here. */
export function handLabelPoint(seat: number): THREE.Vector3 {
  return onSeat(seat, HAND_R + CARD_H / 2 + 0.006, 0, TOP_Y + 0.01);
}

/** Toward the player from their bets, where chips go home. */
export function railPoint(seat: number): THREE.Vector3 {
  return onSeat(seat, FELT_R + 0.02, 0, TOP_Y + 0.02);
}

/** Where a seated player's avatar stands. */
export function seatPose(seat: number): { position: [number, number, number]; yaw: number } {
  const a = seatAngle(seat);
  const [x, z] = along(a, 1.62);
  return { position: [x, 0, z], yaw: a + Math.PI };
}

/**
 * The camera over a seat, looking down across its bets and cards to the community cards: they sit
 * about a third of the way down the screen and the $ circle clear of the controls. Further back
 * and aimed further in at the ends of the arc, so every seat frames alike.
 */
export function cameraPose(seat: number): { position: [number, number, number]; target: [number, number, number] } {
  const a = seatAngle(seat);
  const t = Math.abs(a) / THREE.MathUtils.degToRad(48);
  const [cx, cz] = along(a, 1.24 + 0.24 * t);
  const [hx, hz] = along(a, HAND_R);
  const k = -0.02 + 0.22 * t;
  return { position: [cx, 1.76, cz], target: [hx + (0 - hx) * k, TOP_Y, hz + (BOARD_Z - hz) * k] };
}

/** A solo player on several hands: over the middle of their places, back and up to take them all in. */
export function spotsPose(spots: readonly number[], aspect?: number): { position: [number, number, number]; target: [number, number, number] } {
  if (spots.length <= 1) return cameraPose(spots[0] ?? 0);
  const angles = spots.map(seatAngle);
  const a = angles.reduce((x, y) => x + y, 0) / angles.length;
  const spread = Math.max(...angles) - Math.min(...angles);
  const [cx, cz] = along(a, 1.34 + 0.42 * spread);
  const [hx, hz] = along(a, HAND_R);
  const k = 0.08 + 0.05 * spread;
  const half = BET_R * Math.sin(spread / 2) + CIRCLE_GAP + 0.1;
  return fitWidth({ position: [cx, 1.86 + 0.22 * spread, cz], target: [hx + (0 - hx) * k, TOP_Y, hz + (BOARD_Z - hz) * k] }, half, aspect);
}

/**
 * What must stay in view at this table (table/fit.ts): the bets and cards of the hands you play
 * (every seat's while you watch) and the community cards and the rack.
 */
export function boardPoints(seats: readonly number[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const card = Math.hypot(CARD_W, CARD_H) / 2;
  for (const seat of seats) {
    for (const c of [0, 1, 2] as Circle[]) out.push(...around(circlePoint(seat, c), CIRCLE_RADIUS * 1.2));
    out.push(...around(bonusPoint(seat), BONUS_RADIUS * 1.2));
    for (let i = 0; i < 3; i++) out.push(...around(handSlot(seat, i).pos, card));
  }
  for (let i = 0; i < 2; i++) out.push(...around(boardSlot(i), card * BOARD_CARD_SCALE));
  out.push(...around(new THREE.Vector3(RACK.x, TOP_Y, RACK.z), RACK.w / 2, RACK.d / 2));
  return out;
}

// ---------------------------------------------------------------------------------------------
// The D outline

export function dShape(r = FELT_R, dealerZ = DEALER_Z): THREE.Shape {
  const half = Math.acos((dealerZ - CENTER_Z) / r);
  const s = new THREE.Shape();
  s.absarc(0, -CENTER_Z, r, -Math.PI / 2 - half, -Math.PI / 2 + half, false);
  s.closePath();
  return s;
}

export function cutFeltToD(felt: Felt): void {
  const geo = new THREE.ShapeGeometry(dShape(), 80);
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
// The printed felt: a deep burgundy cloth, gold ink

const INK = '#ecd49a';
const INK_SOFT = 'rgba(236,212,154,0.55)';
export const FELT_COLOR = '#3c0c13';

function outlinePath(g: CanvasRenderingContext2D, px: (m: number) => number, inset: number): void {
  const r = FELT_R - inset;
  const dz = DEALER_Z + inset;
  const half = Math.acos((dz - CENTER_Z) / r);
  g.beginPath();
  g.arc(0, px(CENTER_Z), px(r), Math.PI / 2 + half, Math.PI / 2 - half, true);
  g.closePath();
}

/** Letters laid along an arc around the table centre, reading left to right from the players. */
function arcText(g: CanvasRenderingContext2D, px: (m: number) => number, text: string, r: number, size: number, tracking: number, weight = 600): void {
  g.font = `${weight} ${px(size)}px Cinzel, Georgia, serif`;
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

function paytableBox(g: CanvasRenderingContext2D, px: (m: number) => number, cx: number, title: string, rows: [string, string][]): void {
  const x = px(cx - PAYTABLE_W / 2);
  const y = px(PAYTABLE_Z - PAYTABLE_H / 2);
  g.fillStyle = 'rgba(20,3,6,0.34)';
  roundRect(g, x, y, px(PAYTABLE_W), px(PAYTABLE_H), px(0.012));
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = px(0.0028);
  g.stroke();
  g.fillStyle = INK;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = `700 ${px(0.023)}px Cinzel, Georgia, serif`;
  g.fillText(title, px(cx), y + px(0.023));
  g.strokeStyle = INK_SOFT;
  g.lineWidth = px(0.0015);
  g.beginPath();
  g.moveTo(x + px(0.03), y + px(0.041));
  g.lineTo(x + px(PAYTABLE_W - 0.03), y + px(0.041));
  g.stroke();
  const top = PAYTABLE_Z - PAYTABLE_H / 2 + 0.058;
  const step = Math.min(0.0215, (PAYTABLE_H - 0.068) / Math.max(rows.length - 1, 1));
  const start = top + (PAYTABLE_H - 0.068 - step * (rows.length - 1)) / 2;
  g.font = `600 ${px(0.0136)}px Cinzel, Georgia, serif`;
  rows.forEach(([name, pays], i) => {
    const ry = px(start + i * step);
    g.textAlign = 'left';
    g.fillText(name.toUpperCase(), x + px(0.022), ry);
    g.textAlign = 'right';
    g.fillText(pays, x + px(PAYTABLE_W - 0.022), ry);
  });
}

/** One of a seat's three bet circles: a ring, the label in the middle, a finer ring round the $. */
function circle(g: CanvasRenderingContext2D, px: (m: number) => number, seat: number, c: Circle): void {
  const p = circlePoint(seat, c);
  const a = seatAngle(seat);
  g.save();
  g.translate(px(p.x), px(p.z));
  g.rotate(-a);
  g.strokeStyle = INK;
  g.lineWidth = px(0.0035);
  g.fillStyle = 'rgba(30,6,10,0.26)';
  g.beginPath();
  g.arc(0, 0, px(CIRCLE_RADIUS), 0, Math.PI * 2);
  g.fill();
  g.stroke();
  if (c === 2) {
    g.lineWidth = px(0.0014);
    g.beginPath();
    g.arc(0, 0, px(CIRCLE_RADIUS - 0.0065), 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${px(c === 2 ? 0.03 : 0.028)}px Cinzel, Georgia, serif`;
  g.fillText(CIRCLE_NAMES[c], 0, px(0.002));
  g.restore();
}

function bonusCircle(g: CanvasRenderingContext2D, px: (m: number) => number, seat: number): void {
  const p = bonusPoint(seat);
  const a = seatAngle(seat);
  g.save();
  g.translate(px(p.x), px(p.z));
  g.rotate(-a);
  g.strokeStyle = INK;
  g.lineWidth = px(0.0026);
  g.fillStyle = 'rgba(30,6,10,0.22)';
  g.beginPath();
  g.arc(0, 0, px(BONUS_RADIUS), 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.lineWidth = px(0.0012);
  g.beginPath();
  g.arc(0, 0, px(BONUS_RADIUS - 0.005), 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${px(0.0112)}px Cinzel, Georgia, serif`;
  g.fillText('3 CARD', 0, -px(0.0082));
  g.fillText('BONUS', 0, px(0.0082));
  g.restore();
}

function paint(pay: Paytable) {
  return (g: CanvasRenderingContext2D, px: (m: number) => number): void => {
    g.strokeStyle = INK;
    g.lineWidth = px(0.004);
    outlinePath(g, px, 0.034);
    g.stroke();
    g.lineWidth = px(0.0016);
    outlinePath(g, px, 0.044);
    g.stroke();

    // the game's name over the dealer's side, and the rule that pays it along the arc
    g.fillStyle = INK;
    arcText(g, px, 'LET IT RIDE', TITLE_R, 0.044, 0.012, 700);
    arcText(g, px, 'PAIR OF TENS OR BETTER PAYS', TEXT_R, 0.019, 0.004);

    const hand = CATEGORY_NAMES.map((name, i) => [name, `${pay.hand[i]} TO 1`] as [string, string]).slice(1).reverse();
    paytableBox(g, px, -PAYTABLE_X, 'PAYS ON EACH BET', hand);
    const bonus = BONUS_NAMES.map((name, i) => [name, `${pay.bonus[i]} TO 1`] as [string, string]);
    paytableBox(g, px, PAYTABLE_X, '3 CARD BONUS', bonus);

    // the community cards' places
    g.strokeStyle = INK_SOFT;
    g.lineWidth = px(0.0015);
    const w = CARD_W * BOARD_CARD_SCALE + 0.008;
    const h = CARD_H * BOARD_CARD_SCALE + 0.008;
    for (let i = 0; i < 2; i++) {
      const p = boardSlot(i);
      roundRect(g, px(p.x - w / 2), px(p.z - h / 2), px(w), px(h), px(0.006));
      g.stroke();
    }

    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      for (const c of [0, 1, 2] as Circle[]) circle(g, px, seat, c);
      bonusCircle(g, px, seat);
    }
  };
}

/** Click regions: every seat's three circles (`bet:<seat>:<circle>`) and bonus (`bonus:<seat>`). */
function regions(): Region[] {
  const out: Region[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    for (const c of [0, 1, 2] as Circle[]) {
      const p = circlePoint(seat, c);
      out.push({ id: `bet:${seat}:${c}`, shape: { kind: 'circle', x: p.x, z: p.z, r: CIRCLE_RADIUS * 1.15 } });
    }
    const b = bonusPoint(seat);
    out.push({ id: `bonus:${seat}`, shape: { kind: 'circle', x: b.x, z: b.z, r: BONUS_RADIUS * 1.2 } });
  }
  return out;
}

/** The printed felt, cut to the table's shape. `resolution` is pixels per metre. */
export function makeFelt(pay: Paytable, resolution: number): Felt {
  const felt = new Felt({ width: FELT_W, depth: FELT_D, color: FELT_COLOR, resolution, paint: paint(pay), regions: regions() });
  cutFeltToD(felt);
  return felt;
}
