// The mini-baccarat table's geometry, in table-local metres (+y up, dealer at -z, players at +z,
// the felt centred on the origin). The felt painter, the click regions, the chip anchors and the
// 3D model are all generated from these numbers, so they can't drift apart.
//
// The players' side is a half circle (a little more) around CENTRE; seven seats sit around it,
// numbered 1-7 from the dealer's left (+x) to the dealer's right. Each seat has, from the rail
// in: its number, then the PLAYER box between the two pair circles, then BANKER and TIE. The hands
// are dealt in the middle, Player on the left as the players see it and Banker on the right, with
// the shoe at the dealer's left, the discard holder at the dealer's right and the chip rack and
// numbered commission boxes in front of the dealer.

import * as THREE from 'three';
import type { Spot } from '../../../../shared/src/games/baccarat/rules.ts';
import { CARD_H, CARD_W } from '../../table/cards.ts';
import { around } from '../../table/fit.ts';

export const TOP_Y = 0.76;
/** Centre of the players' arc (x = 0). */
export const CZ = -0.46;
/** Felt radius along the arc, and the padded rail's centre line. */
export const R_FELT = 0.98;
export const R_RAIL = 1.03;
export const RAIL_TUBE = 0.05;
/** The arc runs this far past a half circle at each end, down to the dealer's edge. */
export const ARC_OVER = 0.06;
/** How far the dealer's edge bows in at the middle (the dealer stands in the curve). */
export const DEALER_BOW = 0.04;

export const FELT_W = 2.04;
export const FELT_D = 1.1;

export const SEAT_COUNT = 7;
const SEAT_SPREAD = 0.36;

/** Angle of seat 1-7 around CENTRE; seat 1 at the dealer's left (+x), seat 4 straight ahead. */
export function seatAngle(n: number): number {
  const step = (Math.PI - 2 * SEAT_SPREAD) / (SEAT_COUNT - 1);
  return SEAT_SPREAD + (n - 1) * step;
}

export function polar(r: number, a: number): [number, number] {
  return [r * Math.cos(a), CZ + r * Math.sin(a)];
}

// ---------------------------------------------------------------------------------------------
// Betting spots

export interface Band {
  r0: number;
  r1: number;
  /** Half the box's angular width. */
  half: number;
  label: string;
  font: number;
}

// About 16 cm across each, the same width in every ring.
export const BANDS: Record<'player' | 'banker' | 'tie', Band> = {
  player: { r0: 0.765, r1: 0.875, half: 0.098, label: 'PLAYER', font: 0.028 },
  banker: { r0: 0.645, r1: 0.755, half: 0.12, label: 'BANKER', font: 0.027 },
  tie: { r0: 0.55, r1: 0.635, half: 0.135, label: 'TIE', font: 0.025 },
};

/** Pair circles flank the PLAYER box: Player Pair on the seated player's left, Banker Pair on the right. */
export const PAIR_R = 0.82;
export const PAIR_RADIUS = 0.029;
export const PAIR_OFFSET = 0.148;
export const NUMBER_R = 0.93;

export function spotCentre(seatNo: number, spot: Spot): [number, number] {
  const a = seatAngle(seatNo);
  if (spot === 'playerPair') return polar(PAIR_R, a + PAIR_OFFSET);
  if (spot === 'bankerPair') return polar(PAIR_R, a - PAIR_OFFSET);
  const b = BANDS[spot];
  return polar((b.r0 + b.r1) / 2, a);
}

/** Region id for a seat's spot on the felt ("s4:banker"). */
export function regionId(seatNo: number, spot: Spot): string {
  return `s${seatNo}:${spot}`;
}

export function parseRegion(id: string | null): { seatNo: number; spot: Spot } | null {
  const m = id ? /^s([1-7]):(player|banker|tie|playerPair|bankerPair)$/.exec(id) : null;
  return m ? { seatNo: Number(m[1]), spot: m[2] as Spot } : null;
}

/** Points around an annular sector, for drawing and hit tests. */
export function sectorPoints(r0: number, r1: number, a0: number, a1: number, steps = 10): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) pts.push(polar(r1, a0 + ((a1 - a0) * i) / steps));
  for (let i = steps; i >= 0; i--) pts.push(polar(r0, a0 + ((a1 - a0) * i) / steps));
  return pts;
}

// ---------------------------------------------------------------------------------------------
// The dealer's side

export const CARD_Y = TOP_Y + 0.001;
/** The hands' cards lie a size up from the usual, so they read from every seat. */
export const HAND_CARD_SCALE = 1.25;

/** The printed box each hand is dealt into; it reaches back toward the commission boxes. */
export const HAND_BOX = { player: { x: -0.19, z: -0.16 }, banker: { x: 0.19, z: -0.16 }, w: 0.22, d: 0.24 };

// Two cards upright side by side along the top of the box, the third sideways below them.
const UP_Z = HAND_BOX.player.z - HAND_BOX.d / 2 + 0.012 + (CARD_H * HAND_CARD_SCALE) / 2;
const SIDE_Z = UP_Z + (CARD_H * HAND_CARD_SCALE) / 2 + 0.008 + (CARD_W * HAND_CARD_SCALE) / 2;
const HALF_GAP = (CARD_W * HAND_CARD_SCALE + 0.011) / 2;

/** Where each hand's cards land, as [x, z, sideways]. */
export const HAND_SLOTS: Record<'player' | 'banker', [number, number, boolean][]> = {
  player: [[HAND_BOX.player.x - HALF_GAP, UP_Z, false], [HAND_BOX.player.x + HALF_GAP, UP_Z, false], [HAND_BOX.player.x, SIDE_Z, true]],
  banker: [[HAND_BOX.banker.x - HALF_GAP, UP_Z, false], [HAND_BOX.banker.x + HALF_GAP, UP_Z, false], [HAND_BOX.banker.x, SIDE_Z, true]],
};

export function handSlot(hand: 'player' | 'banker', i: number): { pos: THREE.Vector3; sideways: boolean } {
  const [x, z, sideways] = HAND_SLOTS[hand][Math.min(i, 2)]!;
  return { pos: new THREE.Vector3(x, CARD_Y + i * 0.0003, z), sideways };
}

/** Commission boxes, numbered by seat, in a row in front of the chip rack; box 1 on the dealer's left. */
export const COMMISSION = { z: -0.33, w: 0.05, d: 0.042, step: 0.09 };

export function commissionBox(seatNo: number): [number, number] {
  return [0.27 - (seatNo - 1) * COMMISSION.step, COMMISSION.z];
}

export const RACK = { x: 0, z: -0.425, w: 0.5, d: 0.09 };
/** The shoe's mouth (its local -x end) is turned toward the middle of the table by `yaw`. */
export const SHOE = { x: 0.6, z: -0.41, yaw: 0.25 };
export const DISCARD = { x: -0.6, z: -0.41, yaw: -0.25 };

/** Where cards leave the shoe: just past its mouth. */
export const SHOE_MOUTH = new THREE.Vector3(SHOE.x - 0.12 * Math.cos(SHOE.yaw), TOP_Y + 0.03, SHOE.z + 0.12 * Math.sin(SHOE.yaw));
export const DISCARD_TOP = new THREE.Vector3(DISCARD.x, TOP_Y + 0.02, DISCARD.z);
/** Where the burn card is shown face up, and where the cut card rests once it's out. */
export const BURN_SPOT = new THREE.Vector3(0.4, CARD_Y, -0.3);
export const CUT_SPOT = new THREE.Vector3(0.46, CARD_Y + 0.0006, -0.47);
/** Where the dealer's chips come from and losing bets go. */
export const RACK_POINT = new THREE.Vector3(RACK.x, TOP_Y + 0.03, RACK.z);

// ---------------------------------------------------------------------------------------------
// The table's outline

/** The felt's outline, dealer's edge first, as (x, z) points. */
export function feltOutline(radius = R_FELT, steps = 96): [number, number][] {
  const pts: [number, number][] = [];
  const a0 = -ARC_OVER;
  const a1 = Math.PI + ARC_OVER;
  for (let i = 0; i <= steps; i++) pts.push(polar(radius, a0 + ((a1 - a0) * i) / steps));
  // back along the dealer's edge, bowing in toward the players at the middle
  const [xl, zl] = pts[pts.length - 1]!;
  const [xr] = pts[0]!;
  for (let i = 1; i < 24; i++) {
    const t = i / 24;
    const x = xl + (xr - xl) * t;
    pts.push([x, zl + DEALER_BOW * Math.sin(Math.PI * t)]);
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Seats and camera

/** Where seat 1-7's player sits (on the floor), facing the table. */
export function seatPlace(n: number): { position: [number, number, number]; yaw: number } {
  const a = seatAngle(n);
  const [x, z] = polar(1.4, a);
  return { position: [x, 0, z], yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) };
}

/**
 * The camera over seat n's rail, looking down across its spots to the hands, steep enough that
 * the whole layout sits between the scoreboard and the chip tray.
 */
export function seatCamera(n: number): { position: [number, number, number]; target: [number, number, number] } {
  const a = seatAngle(n);
  const [x, z] = polar(1.18, a);
  const [tx, tz] = polar(0.51, a);
  return { position: [x, 1.62, z], target: [tx * 0.6, TOP_Y, tz] };
}

/**
 * What must stay in view at this table (table/fit.ts): your seat's boxes (every seat's while you
 * watch), the Player and Banker hands, the commission boxes and the chip rack.
 */
export function boardPoints(seatNo: number | null): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const at = ([x, z]: [number, number]) => new THREE.Vector3(x, TOP_Y, z);
  for (let n = 1; n <= SEAT_COUNT; n++) {
    if (seatNo !== null && n !== seatNo) continue;
    const a = seatAngle(n);
    for (const b of Object.values(BANDS)) out.push(...sectorPoints(b.r0, b.r1, a - b.half, a + b.half, 2).map(at));
    for (const spot of ['playerPair', 'bankerPair'] as const) out.push(...around(at(spotCentre(n, spot)), PAIR_RADIUS));
  }
  for (const h of [HAND_BOX.player, HAND_BOX.banker]) out.push(...around(new THREE.Vector3(h.x, TOP_Y, h.z), HAND_BOX.w / 2, HAND_BOX.d / 2));
  out.push(...around(new THREE.Vector3(0, TOP_Y, COMMISSION.z), 0.27 + COMMISSION.w / 2, COMMISSION.d / 2));
  out.push(...around(new THREE.Vector3(RACK.x, TOP_Y, RACK.z), RACK.w / 2, RACK.d / 2));
  return out;
}
