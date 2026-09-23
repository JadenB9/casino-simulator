// Where the eight players stand. Seat numbers run clockwise seen from above, starting just right
// of the stickman (the dice pass to the next seat number after a seven-out). Players right of
// the stickman bet on the right end's layout, the rest on the left end's.

import * as THREE from 'three';
import { FELT_W, FELT_D } from './layout.ts';
import { RAIL_Y } from './model.ts';

/** x, z, yaw (yaw 0 faces +z). */
export const SEATS: [number, number, number][] = [
  [0.42, 1.08, Math.PI],
  [-0.42, 1.08, Math.PI],
  [-1.2, 1.08, Math.PI],
  [-2.12, 0.34, Math.PI / 2],
  [-2.12, -0.3, Math.PI / 2],
  [2.12, -0.3, -Math.PI / 2],
  [2.12, 0.34, -Math.PI / 2],
  [1.2, 1.08, Math.PI],
];

export function seatEnd(seat: number): 1 | -1 {
  return (SEATS[seat]?.[0] ?? 1) >= 0 ? 1 : -1;
}

/** A seat's place among the four players at its end, for spreading chips inside a spot. */
const SLOT: Record<number, number> = { 0: 0, 7: 1, 6: 2, 5: 3, 1: 0, 2: 1, 3: 2, 4: 3 };

/** Offset inside a spot so several players' chips don't sit on top of each other. */
export function slotOffset(seat: number, id: string): [number, number] {
  const k = SLOT[seat] ?? 0;
  if (/^(pass|dontpass|come|dontcome|field)$/.test(id)) return [(k - 1.5) * 0.1 * seatEnd(seat), 0];
  if (/^(come|dontcome|place|buy|lay|big)\d+$/.test(id)) return [((k % 2) - 0.5) * 0.03, (Math.floor(k / 2) - 0.5) * 0.024];
  // the proposition box is shared: the right end's players to the right, the left end's to the left
  const col = (seatEnd(seat) > 0 ? 2 : 0) + (k % 2);
  return [(col - 1.5) * 0.03, (Math.floor(k / 2) - 0.5) * 0.026];
}

/** The chip rail in front of a seat, where winnings are pushed. */
export function railSpot(seat: number): THREE.Vector3 {
  const [x, z] = SEATS[seat] ?? SEATS[0]!;
  const y = RAIL_Y - 0.043;
  if (Math.abs(z) > 0.9) return new THREE.Vector3(x, y, FELT_D / 2 + 0.165);
  return new THREE.Vector3(Math.sign(x) * (FELT_W / 2 + 0.165), y, z);
}

/** The shooter's hand, just over the rail in front of their seat. */
export function handSpot(seat: number | null): THREE.Vector3 {
  if (seat === null) return new THREE.Vector3(0, RAIL_Y + 0.08, FELT_D / 2 + 0.05);
  const r = railSpot(seat);
  const inward = r.clone().setY(0).multiplyScalar(-0.12 / Math.max(0.01, r.clone().setY(0).length()));
  return r.add(inward).setY(RAIL_Y + 0.08);
}
