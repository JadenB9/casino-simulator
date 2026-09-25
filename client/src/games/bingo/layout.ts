// Where everything in the bingo hall stands, in the station's own metres: the caller's stage at the
// back (-z) with the flashboard on its wall, the blower and the podium on it, then four long tables
// of ten seats facing the stage. The model, the camera and the tests read these numbers.
//
// The station fits a 4.8 m x 6.6 m box centred on the origin, chairs included: the rooms agent
// places it in the bingo hall as one piece.

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

export const FOOTPRINT = { width: 4.8, depth: 6.6 };

// the stage
export const STAGE_Z0 = -3.3;
export const STAGE_Z1 = -1.85;
export const STAGE_H = 0.28;
export const STAGE_W = 4.6;
/** The flashboard on the back wall: its face's centre, size and plane. */
export const BOARD = { y: 2.22, w: 3.6, h: 1.2, z: -3.16 } as const;
/** The blower on the stage, stage right (the players' left); the podium stage left. */
export const BLOWER = { x: -1.72, z: -2.25, r: 0.26, standH: 0.56, baseH: 0.3 } as const;
export const PODIUM = { x: 1.6, z: -2.35, w: 0.8, d: 0.46, h: 1.02 } as const;

// the tables
export const ROWS = 4;
export const PER_ROW = 10;
export const SEAT_GAP = 0.44;
export const TABLE = { w: 4.5, d: 0.56, h: 0.74 } as const;
/** Each row's table centre. */
export const ROW_Z = [-1.05, 0.2, 1.45, 2.7] as const;
/** A seat is this far behind its table's centre, on the players' side. */
export const SEAT_BACK = 0.52;

export const SEATS = ROWS * PER_ROW;

export function seatSpot(seat: number): { x: number; z: number; row: number; col: number } {
  const row = Math.floor(seat / PER_ROW) % ROWS;
  const col = seat % PER_ROW;
  return { x: (col - (PER_ROW - 1) / 2) * SEAT_GAP, z: ROW_Z[row]! + SEAT_BACK, row, col };
}

/** Every seat, facing the stage. */
export function seatPositions(): { position: [number, number, number]; yaw: number }[] {
  return Array.from({ length: SEATS }, (_, i) => {
    const s = seatSpot(i);
    return { position: [s.x, 0, s.z], yaw: Math.PI };
  });
}

/** Sitting at a seat: a seated head's height, looking at the flashboard over the tables in front. */
export function seatPose(seat: number): Pose {
  const s = seatSpot(seat);
  return {
    position: [s.x, 1.22 + s.row * 0.05, s.z + 0.12],
    target: [s.x * 0.35, BOARD.y - 0.25, BOARD.z],
  };
}

/** Watching from the back of the hall. */
export const OVERVIEW_POSE: Pose = { position: [0, 2.1, 3.6], target: [0, 1.45, -2.6] };
