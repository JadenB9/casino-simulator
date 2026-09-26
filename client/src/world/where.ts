// v7: where someone is, in a few words, for the list of who's online: the table they sit at, the
// casino's room they stand in, or the place in another zone (the street, the jail, the garage,
// the stores, the roof, their apartment).

import { zoneOf } from '../../../shared/src/zones.ts';
import { JAIL } from '../../../shared/src/law/rules.ts';
import { roomAt, type FloorPlan } from './layout.ts';
import { GROUND } from './city/plan.ts';
import { STORES } from '../../../shared/src/stores.ts';

const inside = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/**
 * A place's name for someone at (x, z) metres, sitting at `at` (a station id) if anywhere.
 * `stationName` turns a station id into its name ("Blackjack").
 */
export function whereIs(plan: FloorPlan, x: number, z: number, at: string | null, stationName: (id: string) => string | null): string {
  if (at) {
    const n = stationName(at);
    return n ? `At ${n}` : 'At a table';
  }
  const zone = zoneOf(Math.round(x * 100), Math.round(z * 100)) ?? 'casino';
  if (zone === 'roof') return 'Sky Terrace';
  if (zone === 'home') return 'At home';
  if (zone === 'ground') {
    if (inside(JAIL.inner, x, z)) return 'In the county jail';
    if (inside(JAIL.building, x, z)) return 'Visiting the jail';
    for (const s of Object.values(STORES)) if (inside(s.room, x, z)) return `In ${s.name}`;
    if (inside(GROUND.garage, x, z)) return 'At the garage';
    if (inside(GROUND.hall, x, z)) return 'Valet lobby';
    if (x >= GROUND.walkWest.x0 && x <= GROUND.walkEast.x1) return 'On the street';
    return 'At the valet';
  }
  return roomAt(plan, x, z)?.name ?? 'In the casino';
}
