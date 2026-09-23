// Where things are on the Big Six layout: the seven spots in a row, each with its picture panel,
// its payout line and a chip area, and where each seat's chips sit inside that area. The felt is
// painted from these numbers and clicks are read back through them, so the two can't disagree.
//
// Coordinates are felt-local metres: x across the table, z toward the players, the felt's centre
// at the origin.

import { SPOTS, type SymbolId } from '../../../../shared/src/games/bigsix/rules.ts';

export const FELT_W = 2.12;
export const FELT_D = 0.76;

export const SPOT_W = 0.258;
export const SPOT_GAP = 0.022;
/** The spots run from the dealer's side (z0) toward the players (z1). */
export const SPOT_Z0 = -0.27;
export const SPOT_Z1 = 0.24;
/**
 * The picture panel, the payout line under it, and the chip area nearest the players. The felt is
 * seen at a low angle from the rail, so the printing runs large in depth.
 */
export const PANEL_Z = -0.19;
export const PANEL_W = 0.238;
export const PANEL_D = 0.136;
export const PAYS_Z = -0.083;
export const PAYS_SIZE = 0.05;
export const CHIPS_Z0 = -0.042;
export const CHIPS_Z1 = 0.226;
export const TITLE_Z = -0.325;

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Centre x of the k-th spot from the left. */
export function spotX(k: number): number {
  return (k - (SPOTS.length - 1) / 2) * (SPOT_W + SPOT_GAP);
}

export function spotIndex(key: SymbolId): number {
  return SPOTS.findIndex((s) => s.key === key);
}

export function spotRect(key: SymbolId): Rect {
  return { x: spotX(spotIndex(key)), z: (SPOT_Z0 + SPOT_Z1) / 2, w: SPOT_W, d: SPOT_Z1 - SPOT_Z0 };
}

/** The spot under a felt point, if any. */
export function spotAt(x: number, z: number): SymbolId | null {
  if (z < SPOT_Z0 || z > SPOT_Z1) return null;
  for (let k = 0; k < SPOTS.length; k++) if (Math.abs(x - spotX(k)) <= SPOT_W / 2) return SPOTS[k]!.key;
  return null;
}

/**
 * Where a seat's chips sit on a spot. Alone at the table they sit in the middle of the chip area;
 * at a shared table every seat has its own place in a four-by-two grid, so a glance shows whose
 * chips are whose.
 */
export function chipSpot(key: SymbolId, seat: number | null): [number, number] {
  const x = spotX(spotIndex(key));
  const zc = (CHIPS_Z0 + CHIPS_Z1) / 2;
  if (seat === null) return [x, zc];
  const col = seat % 4;
  const row = Math.floor(seat / 4) % 2;
  return [x + (col - 1.5) * 0.057, zc + (row - 0.5) * 0.078];
}
