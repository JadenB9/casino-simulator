// v7: the two stores across the street from the valet, at the ends of the jail's and the garage's
// block (zones.ts LOTS.guns, LOTS.homes): each a single room with a glass front on the east
// sidewalk, a door, a counter with a clerk and E at the counter for the catalog. The gun store's
// back half is a shooting range behind a waist-high wall; the home store is a showroom.
// Metres, world coordinates (x east, z south).

import { LIFTS } from './lifts.ts';

export type StoreId = 'guns' | 'homes';

export interface Store {
  id: StoreId;
  name: string;
  /** The room inside the walls. */
  room: { x0: number; x1: number; z0: number; z1: number };
  /** The door in the front (west) wall: its z range. */
  door: { z0: number; z1: number };
  /** Where you stand at the counter to shop (E), and where the clerk stands behind it. */
  counter: { x: number; z: number };
  clerk: { x: number; z: number; yaw: number };
  height: number;
}

export const STORES: Record<StoreId, Store> = {
  guns: {
    id: 'guns',
    name: 'Ace Arms',
    room: { x0: 167, x1: 184.6, z0: 47.4, z1: 57.8 },
    door: { z0: 51.5, z1: 53.7 },
    counter: { x: 172.4, z: 49.6 },
    clerk: { x: 172.4, z: 48.3, yaw: 0 },
    height: 4.2,
  },
  homes: {
    id: 'homes',
    name: 'Maison Home',
    room: { x0: 167, x1: 184.6, z0: -57.8, z1: -47.4 },
    door: { z0: -53.7, z1: -51.5 },
    counter: { x: 172.4, z: -49.6 },
    clerk: { x: 172.4, z: -48.3, yaw: Math.PI },
    height: 4.2,
  },
};

/** The gun store's range: the lanes behind the half wall (x), where the targets stand. */
export const RANGE = { wall: 177.4, x1: 184.2, z0: 47.8, z1: 57.4, lanes: [49.6, 52.6, 55.6] } as const;

/** Inside a store's room (metres)? */
export function storeAt(x: number, z: number): Store | null {
  for (const s of Object.values(STORES)) {
    const r = s.room;
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return s;
  }
  return null;
}

/**
 * v7.4: the Residences desk, where apartments are sold: the hotel lobby's front desk on the
 * ground floor (the valet lobby under the tower, city/ground.ts), with a clerk behind it facing
 * the lobby. `hall`: the lobby inside its walls (city/plan.ts GROUND.hall is this), where the
 * server lets an apartment be bought (and at Maison Home).
 */
export const RESIDENCES = {
  desk: { x0: 113.8, x1: 120.2, z0: -10.4, z1: -9.5 },
  counter: { x: 117, z: -8.75 },
  clerk: { x: 117, z: -11.25, yaw: 0 },
  hall: { x0: LIFTS.ground.x / 100, x1: 127.6, z0: -12.6, z1: 12.6 },
} as const;
