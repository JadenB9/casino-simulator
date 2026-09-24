// Where everything at the Bandit Wheel stands, in the station's own metres: the wheel on its frame
// at the back (−z), ten betting terminals in an arc round it, and a stool at each terminal. The
// model, the chips, the camera and the tests all read these numbers.
//
// The station fits a 4.0 m × 3.0 m box centred on the origin, stools included.

/**
 * A camera pose (the same shape as table/stage.ts's Pose, declared here so this file and the spin
 * maths stay free of three.js and the DOM: the shared tests import them).
 */
export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

// ---------------------------------------------------------------------------------------------
// The wheel

/** Height of the hub. The band tops out at 2.64 m and the sign at 3.31 m. */
export const HUB_Y = 1.6;
/** The painted face's plane; the disc is DISC_T thick behind it. */
export const WHEEL_Z = -0.9;
export const DISC_T = 0.09;
/** The painted face, and the edge of the cream centre where the numbered wedges begin. */
export const FACE_R = 0.985;
export const RING_IN = 0.43;
/** The steel band round the rim; its lip stands this far proud of the face. */
export const BAND_R = 1.04;
export const BAND_LIP = 0.012;
/** The pegs: pins on the slot boundaries, standing out of the face. */
export const PEG_R = 0.935;
export const PEG_RADIUS = 0.0095;
export const PEG_OUT = 0.075;
/** The flapper: hinged above the band, hanging in front of the face between the pegs. */
export const PIVOT_R = 1.165;
export const FLAP_L = 0.258;
export const FLAP_Z = 0.046;

/** The frame stands behind the wheel: two posts, a beam across the top, a post carrying the axle. */
export const FRAME_Z = -1.1;
export const POST_X = 1.24;
export const POST_W = 0.17;
export const BEAM_Y = 2.88;
export const BEAM_H = 0.18;
/** The heavy base the frame stands on. */
export const BASE_H = 0.3;
export const BASE_W = 3.0;
export const BASE_Z0 = -1.46;
export const BASE_Z1 = -0.74;

// ---------------------------------------------------------------------------------------------
// The terminals and the stools

export const TERMINALS = 10;
/** The arc's centre, just behind the wheel, so every terminal faces it. */
export const ARC_CZ = -1.06;
/** Arc radius to each terminal's console and to its stool. */
export const TERM_R = 2.0;
export const STOOL_R = 2.4;
/** Stool to stool along the arc. */
export const STOOL_GAP = 0.46;
/** The console: a small steel box on a post, its top level with a bar. */
export const TERM_W = 0.34;
export const TERM_D = 0.26;
export const TOP_Y = 0.96;
/** The stool's seat: top, radius. */
export const STOOL_TOP = 0.66;
export const STOOL_SEAT_R = 0.17;

export const FOOTPRINT = { width: 4.0, depth: 3.0 };

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
  return (i - (TERMINALS - 1) / 2) * (STOOL_GAP / STOOL_R);
}

/** A point on the arc at radius `r`, at terminal i's angle: [x, z]. */
export function onArc(i: number, r: number): [number, number] {
  const a = terminalAngle(i);
  return [r * Math.sin(a), ARC_CZ + r * Math.cos(a)];
}

/** rotation.y for something at terminal i that faces its player (+z when i is in the middle). */
export function terminalYaw(i: number): number {
  return terminalAngle(i);
}

/**
 * The five cups on a console's top, console-local: x across (left to right as its player sees
 * it), y up, z toward its player. Chips stack from these points.
 */
export const CUP_PITCH = 0.064;
export const CUP_W = 0.056;
export const CUP_Z = 0.052;
export function cupLocal(k: number): [number, number, number] {
  return [(k - 2) * CUP_PITCH, TOP_Y + 0.0015, CUP_Z];
}

/** A cup's place in station coordinates. */
export function cupPlace(terminal: number, k: number): [number, number, number] {
  const [cx, cz] = onArc(terminal, TERM_R);
  const [lx, ly, lz] = cupLocal(k);
  const a = terminalYaw(terminal);
  return [cx + lx * Math.cos(a) + lz * Math.sin(a), ly, cz - lx * Math.sin(a) + lz * Math.cos(a)];
}

/** Where a seat's player sits: the stool, facing the wheel. */
export function seatPositions(): { position: [number, number, number]; yaw: number }[] {
  const out: { position: [number, number, number]; yaw: number }[] = [];
  for (let seat = 0; seat < TERMINALS; seat++) {
    const i = terminalOfSeat(seat);
    const [x, z] = onArc(i, STOOL_R);
    // Math.PI looks toward −z; each stool turns with the arc to face the wheel
    out.push({ position: [x, 0, z], yaw: Math.PI + terminalAngle(i) });
  }
  return out;
}

/**
 * The camera at a terminal: behind and above the stool, looking at the wheel, with your console
 * along the bottom of the picture. The top of the screen belongs to the HUD and the call line, so
 * every pose keeps Rust's pointer below them (about a fifth of the way down).
 */
export function seatPose(seat: number): Pose {
  const i = terminalOfSeat(seat);
  const [x, z] = onArc(i, STOOL_R + 1.8);
  return { position: [x, 2.2, z], target: [x * 0.12, 1.61, WHEEL_Z] };
}

/** Walking up, before a seat is known: the middle of the arc, a step back. */
export const OVERVIEW_POSE: Pose = { position: [0, 2.3, ARC_CZ + STOOL_R + 1.9], target: [0, 1.55, WHEEL_Z] };

/** The spin: square to the wheel from in front of your terminal, the whole face in view. */
export function wheelPose(seat: number | null): Pose {
  const a = seat === null ? 0 : terminalAngle(terminalOfSeat(seat)) * 0.3;
  return { position: [Math.sin(a) * 2.9, HUB_Y + 0.1, WHEEL_Z + Math.cos(a) * 2.9], target: [0, HUB_Y + 0.18, WHEEL_Z] };
}

/** Then close on the flapper as the wheel slows. */
export const FLAPPER_POSE: Pose = { position: [0, HUB_Y + 0.62, WHEEL_Z + 1.2], target: [0, HUB_Y + 0.83, WHEEL_Z] };
