// What the walker and the follow camera bump into, straight from the floor plan: its walls (a
// lintel over a door and the glass over a shop window's sill stop only the camera) and every
// solid standing on the floor, at the size the plan checked it at. Stations add their own boxes
// (stations.ts) and the staff their posts (npcs.ts).

import type { Collider } from './collision.ts';
import { WALL, type FloorPlan } from './layout.ts';

/** Things lower than this (a sign, a pendant, a lamp over a table) hang over a walker's head. */
const HEAD = 1.2;

export function collide(plan: FloorPlan, col: Collider): void {
  const box = (axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, walk: boolean) => {
    if (axis === 'x') col.box((a0 + a1) / 2, c, a1 - a0, WALL, 0, y1, { walk, cam: true, bottom: y0 });
    else col.box(c, (a0 + a1) / 2, WALL, a1 - a0, 0, y1, { walk, cam: true, bottom: y0 });
  };
  for (const w of plan.wallPieces) box(w.axis, w.c, w.a0, w.a1, w.y0, w.y1, w.y0 < HEAD);
  // the glass: nobody walks through a shop window
  for (const w of plan.windows) box(w.axis, w.c, w.a0, w.a1, w.y0, w.y1, true);
  for (const s of plan.solids) {
    if (s.y0 >= HEAD) continue;
    // the camera sees over anything lower than a person
    const cam = s.y1 > 1.6;
    if (s.round) col.post(s.x, s.z, s.walk ?? s.w / 2, s.y1, { cam });
    else col.box(s.x, s.z, s.w, s.d, s.yaw, s.y1, { cam });
  }
}
