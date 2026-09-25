// The casino's rooms, as simply as the law needs them: which room a point is in. The staff see
// only within the room they stand in (sight.ts), so the rooms' walls are the only walls the
// server has to know about, and a rectangle per room is all a wall needs to be.
//
// It is the conservative rule. A guard never sees through a wall, but he doesn't see through a
// doorway into the next room either: you can get away with something in plain view on the other
// side of a door. Seeing through doorways would mean the whole wall plan on the server, rebuilt
// whenever a room changes, for the rare case of being caught from next door.
//
// These are the room bounds of client/src/world/rooms.ts (the wall centre lines), in metres;
// client/test/law-plan.test.ts fails if the two drift apart. (A room here the floor doesn't have
// yet is fine as long as it overlaps none it does: the north wing, before it's built.)

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const ROOMS: Readonly<Record<string, Box>> = {
  lobby: { x0: -7, z0: 3, x1: 7, z1: 15 },
  pit: { x0: -13, z0: -19, x1: 13, z1: 3 },
  slots: { x0: -31, z0: -19, x1: -13, z1: 3 },
  bar: { x0: 13, z0: -19, x1: 31, z1: 3 },
  lounge: { x0: 17, z0: 3, x1: 31, z1: 15 },
  poker: { x0: 9, z0: -31, x1: 31, z1: -19 },
  salon: { x0: -9, z0: -31, x1: 9, z1: -19 },
  online: { x0: -31, z0: -31, x1: -9, z1: -19 },
  yard: { x0: -31, z0: 3, x1: -17, z1: 15 },
  bank: { x0: -17, z0: 3, x1: -7, z1: 15 },
  boutique: { x0: 7, z0: 3, x1: 17, z1: 15 },
  // the north wing (v6 rooms6): the pachinko parlour, the card room, the bingo hall
  parlour: { x0: -31, z0: -43, x1: -9, z1: -31 },
  cardroom: { x0: -9, z0: -43, x1: 9, z1: -31 },
  bingo: { x0: 9, z0: -43, x1: 31, z1: -31 },
};

/** The room (x, z) is in (metres), or null outside the building. On a wall line, the first listed wins. */
export function roomAt(x: number, z: number): string | null {
  for (const [id, b] of Object.entries(ROOMS)) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return id;
  return null;
}
