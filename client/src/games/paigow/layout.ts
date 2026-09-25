// Where everything sits on a Pai Gow Poker table, in table-local metres: +x is the dealer's left
// (first base), +z points at the players, y is up. The felt printing, the click regions, the
// chips, the cards and the camera all come from these numbers, so they can't drift apart.
//
// A "D" with six places. Each has its bet circle nearest the player, the Fortune circle inside
// it, and two printed boxes toward the dealer: the high hand's five cards and, nearer the dealer,
// the low hand's two. The seven cards land fanned in the high box and are split into both once
// the hand is set. The dealer's seven lie in a row in front of the rack and are set by the house
// way into the dealer's own two boxes. The Fortune pay table and the house rules are printed
// either side.

import * as THREE from 'three';
import { Felt, type Region } from '../../table/felt.ts';
import { CARD_H, CARD_W } from '../../table/cards.ts';
import type { FortunePays } from '../../../../shared/src/games/paigow/rules.ts';
import { fitWidth } from '../multihand/frame.ts';
import { around } from '../../table/fit.ts';

export const TOP_Y = 0.76;
export const CENTER_Z = -0.72;
export const FELT_R = 1.22;
export const DEALER_Z = -0.5;
export const RAIL_R = 1.275;
export const FELT_W = 2.44;
export const FELT_D = 1.0;

const POSITION_DEG = [45, 27, 9, -9, -27, -45];
const SEAT_POSITION = [2, 3, 1, 4, 0, 5];
export const SEAT_COUNT = 6;

export const BET_R = 0.975;
export const BET_RADIUS = 0.04;
export const FORTUNE_R = 0.862;
export const FORTUNE_RADIUS = 0.03;
/** The high hand's box and the low hand's, along the seat's line. */
export const HIGH_R = 0.715;
export const LOW_R = 0.585;
const HIGH_BOX = { w: 0.19, d: 0.104 };
const LOW_BOX = { w: 0.116, d: 0.104 };
const FAN7 = 0.0205;
const FAN5 = 0.028;
const FAN2 = 0.03;
const TEXT_R = 0.505;
const TITLE_R = 0.578;

export const DEALER_CARD_SCALE = 1.1;
export const DEALER_ROW_Z = -0.36;
export const DEALER_GAP = 0.076;
/** Where the dealer's set hands lie: the high hand left of centre, the low hand right. */
export const DEALER_HIGH_X = -0.14;
export const DEALER_LOW_X = 0.2;
export const RACK = { x: 0, z: -0.462, w: 0.46, d: 0.058 };
export const SHUFFLER = new THREE.Vector3(-0.34, TOP_Y + 0.05, -0.45);
export const DISCARD = new THREE.Vector3(0.34, TOP_Y + 0.02, -0.45);
const BOX_X = 0.75;
const BOX_Z = -0.36;
const BOX_W = 0.3;
const BOX_H = 0.22;

export function positionOf(seat: number): number {
  return SEAT_POSITION[seat] ?? seat;
}

export function seatAngle(seat: number): number {
  return (POSITION_DEG[positionOf(seat)]! * Math.PI) / 180;
}

export function along(a: number, r: number): [number, number] {
  return [Math.sin(a) * r, CENTER_Z + Math.cos(a) * r];
}

/** `r` out along a seat's line and `side` across it toward the player's right. */
export function onSeat(seat: number, r: number, side: number, y = TOP_Y): THREE.Vector3 {
  const a = seatAngle(seat);
  const [x, z] = along(a, r);
  return new THREE.Vector3(x + Math.cos(a) * side, y, z - Math.sin(a) * side);
}

export const betPoint = (seat: number, y = TOP_Y) => onSeat(seat, BET_R, 0, y);
export const fortunePoint = (seat: number, y = TOP_Y) => onSeat(seat, FORTUNE_R, 0, y);
export const payoutPoint = (seat: number) => onSeat(seat, BET_R, BET_RADIUS * 2.3);
export const fortunePayoutPoint = (seat: number) => onSeat(seat, FORTUNE_R, FORTUNE_RADIUS * 2.4);

/**
 * A card's place at a seat: `where` is the seven as dealt (fanned in the high box), the high
 * hand's five, or the low hand's two; `i` counts from the player's left.
 */
export function seatCard(seat: number, where: 'seven' | 'high' | 'low', i: number): { pos: THREE.Vector3; yaw: number } {
  const n = where === 'seven' ? 7 : where === 'high' ? 5 : 2;
  const fan = where === 'seven' ? FAN7 : where === 'high' ? FAN5 : FAN2;
  const r = where === 'low' ? LOW_R : HIGH_R;
  return { pos: onSeat(seat, r, (i - (n - 1) / 2) * fan, TOP_Y + 0.001 + i * 0.0006), yaw: seatAngle(seat) };
}

/** The dealer's seven in a row, then set: the five and the two in their boxes. */
export function dealerCard(where: 'seven' | 'high' | 'low', i: number): THREE.Vector3 {
  if (where === 'seven') return new THREE.Vector3((i - 3) * DEALER_GAP, TOP_Y + 0.001 + i * 0.0006, DEALER_ROW_Z);
  if (where === 'high') return new THREE.Vector3(DEALER_HIGH_X + (i - 2) * FAN5 * 1.25, TOP_Y + 0.001 + i * 0.0006, DEALER_ROW_Z);
  return new THREE.Vector3(DEALER_LOW_X + (i - 0.5) * FAN2 * 1.4, TOP_Y + 0.001 + i * 0.0006, DEALER_ROW_Z);
}

/** Labels hang from the near edge of a seat's cards, and under the dealer's row. */
export function handLabelPoint(seat: number): THREE.Vector3 {
  return onSeat(seat, HIGH_R + CARD_H / 2 + 0.006, 0, TOP_Y + 0.01);
}
export const DEALER_LABEL = new THREE.Vector3(0.03, TOP_Y + 0.01, DEALER_ROW_Z + (CARD_H * DEALER_CARD_SCALE) / 2 + 0.008);

export function railPoint(seat: number): THREE.Vector3 {
  return onSeat(seat, FELT_R + 0.02, 0, TOP_Y + 0.02);
}

export function seatPose(seat: number): { position: [number, number, number]; yaw: number } {
  const a = seatAngle(seat);
  const [x, z] = along(a, 1.62);
  return { position: [x, 0, z], yaw: a + Math.PI };
}

/** The camera over a seat, looking down across its cards to the dealer's row. */
export function cameraPose(seat: number): { position: [number, number, number]; target: [number, number, number] } {
  const a = seatAngle(seat);
  const t = Math.abs(a) / THREE.MathUtils.degToRad(45);
  const [cx, cz] = along(a, 1.22 + 0.24 * t);
  const [hx, hz] = along(a, HIGH_R);
  const k = 0.02 + 0.22 * t;
  return { position: [cx, 1.72, cz], target: [hx + (0 - hx) * k, TOP_Y, hz + (DEALER_ROW_Z - hz) * k] };
}

export function spotsPose(spots: readonly number[], aspect?: number): { position: [number, number, number]; target: [number, number, number] } {
  if (spots.length <= 1) return cameraPose(spots[0] ?? 0);
  const angles = spots.map(seatAngle);
  const a = angles.reduce((x, y) => x + y, 0) / angles.length;
  const spread = Math.max(...angles) - Math.min(...angles);
  const [cx, cz] = along(a, 1.3 + 0.42 * spread);
  const [hx, hz] = along(a, HIGH_R);
  const k = 0.1 + 0.05 * spread;
  const half = BET_R * Math.sin(spread / 2) + 0.16;
  return fitWidth({ position: [cx, 1.82 + 0.22 * spread, cz], target: [hx + (0 - hx) * k, TOP_Y, hz + (DEALER_ROW_Z - hz) * k] }, half, aspect);
}

/** What must stay in view (table/fit.ts): your places' bets and cards, and the dealer's row and rack. */
export function boardPoints(seats: readonly number[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const card = Math.hypot(CARD_W, CARD_H) / 2;
  for (const seat of seats) {
    out.push(...around(betPoint(seat), BET_RADIUS * 1.2), ...around(fortunePoint(seat), FORTUNE_RADIUS * 1.2));
    out.push(...around(seatCard(seat, 'seven', 0).pos, card), ...around(seatCard(seat, 'seven', 6).pos, card), ...around(seatCard(seat, 'low', 0).pos, card));
  }
  out.push(...around(dealerCard('seven', 0), card * DEALER_CARD_SCALE), ...around(dealerCard('seven', 6), card * DEALER_CARD_SCALE));
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
// The printed felt: jade cloth, gold ink

const INK = '#e9d397';
const INK_SOFT = 'rgba(233,211,151,0.5)';
export const FELT_COLOR = '#0c3a30';
const SHADE = 'rgba(2,20,15,0.3)';

function outlinePath(g: CanvasRenderingContext2D, px: (m: number) => number, inset: number): void {
  const r = FELT_R - inset;
  const dz = DEALER_Z + inset;
  const half = Math.acos((dz - CENTER_Z) / r);
  g.beginPath();
  g.arc(0, px(CENTER_Z), px(r), Math.PI / 2 + half, Math.PI / 2 - half, true);
  g.closePath();
}

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

/** A printed box at (cx, cz): a title over a rule, and rows of name and figure. */
function box(g: CanvasRenderingContext2D, px: (m: number) => number, cx: number, title: string, rows: [string, string][], font = 0.0128): void {
  const x = px(cx - BOX_W / 2);
  const y = px(BOX_Z - BOX_H / 2);
  g.fillStyle = SHADE;
  roundRect(g, x, y, px(BOX_W), px(BOX_H), px(0.012));
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = px(0.0028);
  g.stroke();
  g.fillStyle = INK;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = `700 ${px(0.021)}px Cinzel, Georgia, serif`;
  g.fillText(title, px(cx), y + px(0.022));
  g.strokeStyle = INK_SOFT;
  g.lineWidth = px(0.0015);
  g.beginPath();
  g.moveTo(x + px(0.03), y + px(0.039));
  g.lineTo(x + px(BOX_W - 0.03), y + px(0.039));
  g.stroke();
  const step = Math.min(0.0215, (BOX_H - 0.064) / Math.max(rows.length - 1, 1));
  const start = BOX_Z - BOX_H / 2 + 0.054 + (BOX_H - 0.064 - step * (rows.length - 1)) / 2;
  g.font = `600 ${px(font)}px Cinzel, Georgia, serif`;
  rows.forEach(([name, figure], i) => {
    const ry = px(start + i * step);
    if (!figure) {
      g.textAlign = 'center';
      g.fillText(name.toUpperCase(), px(cx), ry);
      return;
    }
    g.textAlign = 'left';
    g.fillText(name.toUpperCase(), x + px(0.02), ry);
    g.textAlign = 'right';
    g.fillText(figure, x + px(BOX_W - 0.02), ry);
  });
}

/** A card-shaped outline around `n` fanned cards at a point, turned to face the seat. */
function cardBox(g: CanvasRenderingContext2D, px: (m: number) => number, at: THREE.Vector3, a: number, w: number, d: number, label: string): void {
  g.save();
  g.translate(px(at.x), px(at.z));
  g.rotate(-a);
  g.strokeStyle = INK_SOFT;
  g.lineWidth = px(0.0016);
  roundRect(g, -px(w / 2), -px(d / 2), px(w), px(d), px(0.008));
  g.stroke();
  g.fillStyle = INK_SOFT;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${px(0.0118)}px Cinzel, Georgia, serif`;
  g.fillText(label, 0, -px(d / 2) - px(0.009));
  g.restore();
}

function ring(g: CanvasRenderingContext2D, px: (m: number) => number, at: THREE.Vector3, a: number, r: number, lines: string[], size: number, double = false): void {
  g.save();
  g.translate(px(at.x), px(at.z));
  g.rotate(-a);
  g.strokeStyle = INK;
  g.lineWidth = px(0.0034);
  g.fillStyle = SHADE;
  g.beginPath();
  g.arc(0, 0, px(r), 0, Math.PI * 2);
  g.fill();
  g.stroke();
  if (double) {
    g.lineWidth = px(0.0013);
    g.beginPath();
    g.arc(0, 0, px(r - 0.0058), 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${px(size)}px Cinzel, Georgia, serif`;
  const lh = size * 1.25;
  lines.forEach((t, i) => g.fillText(t, 0, px((i - (lines.length - 1) / 2) * lh)));
  g.restore();
}

/** The short names of the Fortune lines, as printed. */
const FORTUNE_PRINT = ['7-card str. flush', 'Royal + royal match', '7-card SF w/ joker', 'Five aces', 'Royal flush', 'Straight flush', 'Four of a kind', 'Full house', 'Flush', 'Three of a kind', 'Straight'];

function paint(fortune: FortunePays) {
  return (g: CanvasRenderingContext2D, px: (m: number) => number): void => {
    g.strokeStyle = INK;
    g.lineWidth = px(0.004);
    outlinePath(g, px, 0.034);
    g.stroke();
    g.lineWidth = px(0.0016);
    outlinePath(g, px, 0.044);
    g.stroke();

    g.fillStyle = INK;
    arcText(g, px, 'PAI GOW POKER', TITLE_R, 0.04, 0.01, 700);
    arcText(g, px, 'DEALER SETS BY THE HOUSE WAY', TEXT_R, 0.0175, 0.004);

    box(g, px, -BOX_X, 'FORTUNE BONUS', FORTUNE_PRINT.map((name, i) => [name, `${fortune[i]} TO 1`] as [string, string]), 0.0112);
    box(g, px, BOX_X, 'HOUSE RULES', [
      ['Win both hands', '1 TO 1'],
      ['Less 5% commission', ''],
      ['Win one hand', 'PUSH'],
      ['Copies win for', 'DEALER'],
      ['Joker plays as an ace', ''],
      ['or fills a straight or flush', ''],
      ['A-2-3-4-5 is the second', ''],
      ['highest straight', ''],
    ], 0.0122);

    // the dealer's boxes
    const dw = CARD_W * DEALER_CARD_SCALE;
    const dd = CARD_H * DEALER_CARD_SCALE + 0.01;
    cardBox(g, px, new THREE.Vector3(DEALER_HIGH_X, TOP_Y, DEALER_ROW_Z), 0, dw + 4 * FAN5 * 1.25 + 0.014, dd, 'HIGH');
    cardBox(g, px, new THREE.Vector3(DEALER_LOW_X, TOP_Y, DEALER_ROW_Z), 0, dw + FAN2 * 1.4 + 0.014, dd, 'LOW');

    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const a = seatAngle(seat);
      cardBox(g, px, onSeat(seat, HIGH_R, 0), a, HIGH_BOX.w, HIGH_BOX.d, 'HIGH HAND');
      cardBox(g, px, onSeat(seat, LOW_R, 0), a, LOW_BOX.w, LOW_BOX.d, 'LOW');
      ring(g, px, fortunePoint(seat), a, FORTUNE_RADIUS, ['FORTUNE'], 0.0098, true);
      ring(g, px, betPoint(seat), a, BET_RADIUS, ['BET'], 0.018);
    }
  };
}

function regions(): Region[] {
  const out: Region[] = [];
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const b = betPoint(seat);
    const f = fortunePoint(seat);
    out.push({ id: `bet:${seat}`, shape: { kind: 'circle', x: b.x, z: b.z, r: BET_RADIUS * 1.15 } });
    out.push({ id: `fortune:${seat}`, shape: { kind: 'circle', x: f.x, z: f.z, r: FORTUNE_RADIUS * 1.2 } });
  }
  return out;
}

export function makeFelt(fortune: FortunePays, resolution: number): Felt {
  const felt = new Felt({ width: FELT_W, depth: FELT_D, color: FELT_COLOR, resolution, paint: paint(fortune), regions: regions() });
  cutFeltToD(felt);
  return felt;
}
