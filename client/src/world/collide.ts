// What the walker and the follow camera bump into, straight from the floor plan: its walls (a
// lintel over a door and the glass over a shop window's sill stop only the camera) and every
// solid standing on the floor, at the size the plan checked it at. Stations add their own boxes
// (stations.ts) and the staff their posts (npcs.ts).

import type { Collider } from './collision.ts';
import { WALL, type FloorPlan } from './layout.ts';

/** Things lower than this (a sign, a pendant, a lamp over a table) hang over a walker's head. */
const HEAD = 1.2;

/**
 * What hangs over the walkers (a palm's fronds, a plant's leaves, a lamp over a table): nothing the
 * follow camera bumps into while you walk, but a seated camera settling somewhere for a while
 * should not end up inside a palm (life/sitting.ts). Camera-only boxes from the solids collide()
 * leaves out, a little inside their outline.
 */
export function overhead(plan: FloorPlan, col: Collider): void {
  for (const s of plan.solids) {
    if (s.y0 < HEAD) continue;
    const k = s.round ? 0.8 : 1;
    col.box(s.x, s.z, s.w * k, s.d * k, s.yaw, s.y1, { walk: false, cam: true, bottom: s.y0 });
  }
}

export function collide(plan: FloorPlan, col: Collider): void {
  const box = (axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, walk: boolean) => {
    if (axis === 'x') col.box((a0 + a1) / 2, c, a1 - a0, WALL, 0, y1, { walk, cam: true, bottom: y0 });
    else col.box(c, (a0 + a1) / 2, WALL, a1 - a0, 0, y1, { walk, cam: true, bottom: y0 });
  };
  for (const w of plan.wallPieces) box(w.axis, w.c, w.a0, w.a1, w.y0, w.y1, w.y0 < HEAD);
  // the street doors stay shut (door.glb stands in them): nobody walks out of the building
  for (const d of plan.doors) if (d.b === 'outside') box(d.axis, d.c, d.a0, d.a1, 0, d.height, true);
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
