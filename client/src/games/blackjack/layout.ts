// Where everything sits on the blackjack table, in table-local metres (+x to the players' right,
// +z toward the players, y up). The table is a half-moon: a straight dealer edge at the back and
// an elliptical arc on the players' side. The printed arcs, the seven betting circles, the cards,
// the chips and the camera all hang off the same ellipse centre, so the felt, the model and the
// animations can't drift apart.
//
// Circles are counted from first base, the dealer's left (the players' right, +x), to third base.
// A seat number is the host's; `spotOf` says which circle it sits at (seat 0 is the middle one).

import * as THREE from 'three';
import { spotOf } from '../../../../shared/src/games/blackjack/rules.ts';

export const TOP_Y = 0.78;
/** The straight dealer edge of the felt; every arc is centred on the middle of it. */
export const DEALER_Z = -0.45;
export const FELT_RX = 1.0;
export const FELT_RZ = 0.9;
/** Centre line of the padded rail. */
export const RAIL_RX = 1.035;
export const RAIL_RZ = 0.935;
/** Outer edge of the wooden top. */
export const BODY_RX = 1.1;
export const BODY_RZ = 1.0;

export const SEATS = 7;
/** Angle of each circle, first base first. */
const SPOT_DEG = [62, 41.3, 20.6, 0, -20.6, -41.3, -62];
const degOf = (seat: number) => SPOT_DEG[spotOf(seat)] ?? 0;
export const SPOT_RX = 0.79;
export const SPOT_RZ = 0.69;
export const SPOT_R = 0.052;

/** The printed arcs, as ellipses around the dealer-edge centre. */
export const INSURANCE_ARC = { rx: 0.575, rz: 0.475, band: 0.036 };
export const RULE_ARC = { rx: 0.47, rz: 0.37 };
export const PAYS_ARC = { rx: 0.385, rz: 0.285 };

/** A point on one of the table's ellipses at angle `deg` from straight ahead (+z), toward +x. */
export function onArc(rx: number, rz: number, deg: number, y = TOP_Y): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(rx * Math.sin(a), y, DEALER_Z + rz * Math.cos(a));
}

/** The betting circle of a seat. */
export function spotAt(seat: number, y = TOP_Y): THREE.Vector3 {
  return onArc(SPOT_RX, SPOT_RZ, degOf(seat), y);
}

/** Unit vector from the dealer toward a seat's circle (flat), and the players' right across it. */
export function spotFrame(seat: number): { out: THREE.Vector3; right: THREE.Vector3; yaw: number } {
  const s = spotAt(seat);
  const out = new THREE.Vector3(s.x, 0, s.z - DEALER_Z).normalize();
  const right = new THREE.Vector3(out.z, 0, -out.x);
  return { out, right, yaw: Math.atan2(out.x, out.z) };
}

// Split hands lie side by side across the circle, the first hand on the players' right.
const HAND_GAP = 0.078;
function handOffset(hand: number, hands: number): number {
  return ((hands - 1) / 2 - hand) * HAND_GAP;
}

/** Centre of a hand's first card. */
export function handAnchor(seat: number, hand: number, hands: number): THREE.Vector3 {
  const { out, right } = spotFrame(seat);
  return spotAt(seat, TOP_Y + 0.0012)
    .addScaledVector(out, -0.145)
    .addScaledVector(right, handOffset(hand, hands));
}

/**
 * Where card `index` of a hand lies and how it's turned: each card a little further toward the
 * dealer and to the right, and a double-down card crosswise.
 */
export function handCard(seat: number, hand: number, hands: number, index: number, sideways: boolean): { pos: THREE.Vector3; yaw: number } {
  const { out, right, yaw } = spotFrame(seat);
  const pos = handAnchor(seat, hand, hands)
    .addScaledVector(out, -0.024 * index)
    .addScaledVector(right, 0.011 * index);
  pos.y += 0.0006 * index;
  if (sideways) pos.addScaledVector(out, -0.012).addScaledVector(right, 0.012);
  return { pos, yaw: sideways ? yaw + Math.PI / 2 : yaw };
}

/** Where a hand's bet sits: in the circle, or in a row across it once the hand is split. */
export function handChips(seat: number, hand: number, hands: number): THREE.Vector3 {
  const { right } = spotFrame(seat);
  return spotAt(seat).addScaledVector(right, hands > 1 ? handOffset(hand, hands) : 0);
}

/** The double-down chips go beside the bet, toward the player; winnings touch it on the dealer side. */
export function doubleChips(seat: number, hand: number, hands: number): THREE.Vector3 {
  return handChips(seat, hand, hands).addScaledVector(spotFrame(seat).out, 0.043);
}
export function winChips(seat: number, hand: number, hands: number): THREE.Vector3 {
  return handChips(seat, hand, hands).addScaledVector(spotFrame(seat).out, -0.043);
}

/** Insurance bets sit on the insurance line in front of the circle. */
export function insuranceChips(seat: number): THREE.Vector3 {
  return onArc(INSURANCE_ARC.rx, INSURANCE_ARC.rz, degOf(seat) * 0.93);
}

/** In front of the player, on the rail side: where their chips come from and go back to. */
export function playerRail(seat: number): THREE.Vector3 {
  return spotAt(seat, TOP_Y + 0.03).addScaledVector(spotFrame(seat).out, 0.2);
}

// The dealer's side.
export const DEALER_CARDS_Z = -0.262;
export function dealerCard(index: number): { pos: THREE.Vector3; yaw: number } {
  // The hole card tucks half under the up card; draws spread to the right.
  const x = index === 0 ? -0.035 : 0.012 + (index - 1) * 0.05;
  return { pos: new THREE.Vector3(x, TOP_Y + 0.0012 + index * 0.0006, DEALER_CARDS_Z), yaw: 0 };
}

export const RACK = new THREE.Vector3(0, TOP_Y + 0.02, -0.395);
export const SHOE = { pos: new THREE.Vector3(0.66, TOP_Y, -0.33), yaw: THREE.MathUtils.degToRad(-18) };
/** Where a card leaves the shoe. */
export const SHOE_MOUTH = new THREE.Vector3(0.555, TOP_Y + 0.03, -0.305);
export const DISCARD = new THREE.Vector3(-0.67, TOP_Y, -0.34);

/** Where a seated player's character goes, facing the table. */
export function seatPosition(seat: number): { position: [number, number, number]; yaw: number } {
  const p = onArc(1.42, 1.3, degOf(seat), 0);
  return { position: [p.x, 0, p.z], yaw: Math.atan2(-p.x, DEALER_Z - p.z) };
}

/** The camera for a seat: behind the circle at eye height, looking across to the dealer. */
export function seatPose(seat: number): { position: [number, number, number]; target: [number, number, number] } {
  const s = spotAt(seat);
  const { out } = spotFrame(seat);
  const eye = s.clone().addScaledVector(out, 0.5);
  eye.y = TOP_Y + 0.58;
  const target = s.clone().lerp(new THREE.Vector3(0, TOP_Y, -0.2), 0.62);
  target.y = TOP_Y - 0.02;
  return { position: [eye.x, eye.y, eye.z], target: [target.x, target.y, target.z] };
}
