// Where everything at the Bandit Wheel stands, in the station's own metres: the wheel on its frame
// at the back (−z), ten betting terminals in an arc in front of it, and the players standing at
// them. The model, the chips, the camera and the tests all read these numbers.
//
// The whole station fits a 4.0 m × 2.8 m box centred on the origin; the players stand just outside
// it on the arc.

import type { Pose } from '../../table/stage.ts';

// ---------------------------------------------------------------------------------------------
// The wheel

/** Height of the hub. The band tops out at 2.64 m and the frame at about 3 m. */
export const HUB_Y = 1.6;
/** The painted face's plane; the disc is DISC_T thick behind it. */
export const WHEEL_Z = -0.9;
export const DISC_T = 0.09;
/** The painted face, and the numbered ring on it. */
export const FACE_R = 0.985;
export const RING_IN = 0.4;
/** The steel band round the rim. */
export const BAND_R = 1.04;
/** The pegs: pins on the slot boundaries, standing out of the face. */
export const PEG_R = 0.935;
export const PEG_RADIUS = 0.0095;
export const PEG_OUT = 0.075;
/** The flapper: hinged above the band, hanging in front of the face between the pegs. */
export const PIVOT_R = 1.165;
export const FLAP_L = 0.258;
export const FLAP_Z = 0.046;

/** The frame: two timber posts either side of the wheel and a beam across the top. */
export const POST_X = 1.22;
export const POST_W = 0.16;
export const BEAM_Y = 2.88;
export const BEAM_H = 0.18;
/** The heavy base the frame stands on. */
export const BASE_H = 0.3;
export const BASE_W = 2.9;
export const BASE_Z0 = -1.4;
export const BASE_Z1 = -0.4;

// ---------------------------------------------------------------------------------------------
// The terminals

export const TERMINALS = 10;
/** The arc's centre (behind the wheel, so the arc is gentle) and radius to each terminal's middle. */
export const ARC_CZ = -1.35;
export const ARC_R = 2.6;
/** Terminal to terminal along the arc. */
export const TERM_GAP = 0.43;
export const TERM_W = 0.38;
export const TERM_D = 0.3;
/** The counter top, level: five cups for chips at the front, a small screen at the back. */
export const TOP_Y = 0.96;
export const SCREEN_H = 0.15;
export const SCREEN_TILT = 0.32;
/** How far in front of a terminal its player stands. */
export const STAND_R = 0.45;

export const FOOTPRINT = { width: 4.0, depth: 2.8 };

/**
 * Terminals left to right (0..9) and the seat each belongs to. The first players get the middle of
 * the arc, square to the wheel: seat 0 is left of centre, seat 1 right of it, and so on outward.
 */
export const SEAT_OF_TERMINAL = [8, 6, 4, 2, 0, 1, 3, 5, 7, 9] as const;

export function terminalOfSeat(seat: number): number {
  const i = (SEAT_OF_TERMINAL as readonly number[]).indexOf(((seat % TERMINALS) + TERMINALS) % TERMINALS);
  return i < 0 ? 4 : i;
}

/** The angle of terminal i round the arc (0 = straight in front of the wheel, + to the right). */
export function terminalAngle(i: number): number {
  return (i - (TERMINALS - 1) / 2) * (TERM_GAP / ARC_R);
}

/** A point on the arc at `r` from its centre, at terminal i's angle. */
function onArc(i: number, r: number): [number, number] {
  const a = terminalAngle(i);
  return [r * Math.sin(a), ARC_CZ + r * Math.cos(a)];
}

export interface TerminalPlace {
  /** Centre of the pedestal on the floor. */
  x: number;
  z: number;
  /** rotation.y: the terminal's front (its player's side) faces +z when this is 0. */
  yaw: number;
}

export function terminalPlace(i: number): TerminalPlace {
  const [x, z] = onArc(i, ARC_R);
  return { x, z, yaw: terminalAngle(i) };
}

/**
 * The five cups on a terminal's counter, terminal-local: x across (left to right as its player
 * sees it), y up, z toward its player. Chips stack from these points.
 */
export const SLOT_PITCH = 0.068;
export const CUP_R = 0.026;
export const CUP_Z = 0.045;
export function slotLocal(k: number): [number, number, number] {
  return [(k - 2) * SLOT_PITCH, TOP_Y + 0.001, CUP_Z];
}

/** Where a seat's player stands, facing the wheel. */
export function seatPositions(): { position: [number, number, number]; yaw: number }[] {
  const out: { position: [number, number, number]; yaw: number }[] = [];
  for (let seat = 0; seat < TERMINALS; seat++) {
    const i = terminalOfSeat(seat);
    const [x, z] = onArc(i, ARC_R + STAND_R);
    // yaw faces the table: Math.PI looks toward −z
    out.push({ position: [x, 0, z], yaw: Math.PI + terminalAngle(i) });
  }
  return out;
}

/**
 * The camera at a terminal: over the player's shoulder at standing eye height, looking at the
 * wheel, with the terminal's top along the bottom of the picture.
 */
export function seatPose(seat: number): Pose {
  const i = terminalOfSeat(seat);
  const [x, z] = onArc(i, ARC_R + STAND_R + 0.12);
  return { position: [x, 1.86, z], target: [x * 0.18, HUB_Y - 0.28, WHEEL_Z] };
}

/** Walking up, before a seat is known: the middle of the arc, a step back. */
export const OVERVIEW_POSE: Pose = { position: [0, 2.05, ARC_CZ + ARC_R + 1.1], target: [0, HUB_Y - 0.25, WHEEL_Z] };

/** The spin: square to the wheel, closer. Then close on the flapper as it slows. */
export function wheelPose(seat: number | null): Pose {
  const i = seat === null ? 4.5 : terminalOfSeat(seat);
  const a = terminalAngle(i) * 0.35;
  return { position: [Math.sin(a) * 2.6, HUB_Y + 0.12, WHEEL_Z + Math.cos(a) * 2.6], target: [0, HUB_Y + 0.05, WHEEL_Z] };
}

export const FLAPPER_POSE: Pose = { position: [0, HUB_Y + 0.72, WHEEL_Z + 1.25], target: [0, HUB_Y + 0.8, WHEEL_Z] };
