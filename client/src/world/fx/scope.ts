// Where an effect plays and who sees it, and where the statues stand. Pure: plans in, answers out.
//
// An effect's point is where the buyer stood when it was bought (integer cm on the wire). 'you'
// effects play round the buyer, and anyone who can see that spot sees them; 'room' effects fill
// the room that point is in (the champagne goes to everyone in it, the disco lights it); 'casino'
// effects play in whatever room you are in.

import type { FxEvent } from '../../../../shared/src/items.ts';
import { STATUES } from '../../../../shared/src/items.ts';
import { inRect, roomAt, type FloorPlan, type PlannedRoom, type Rect } from '../layout.ts';
import { reachOf } from './timing.ts';

/** An event's point in metres. */
export function fxPoint(ev: Pick<FxEvent, 'x' | 'z'>): { x: number; z: number } {
  return { x: ev.x / 100, z: ev.z / 100 };
}

/**
 * The room an event was bought in: the one its point is in, or the nearest (a doorstep just
 * outside), as the floor decides it (server/src/floor/fx.ts). Null only for a plan with no rooms.
 */
export function fxRoom(plan: FloorPlan, ev: Pick<FxEvent, 'x' | 'z'>): PlannedRoom | null {
  const p = fxPoint(ev);
  const inside = roomAt(plan, p.x, p.z);
  if (inside) return inside;
  let best: PlannedRoom | null = null;
  let bestD = Infinity;
  for (const r of plan.rooms) {
    const b = r.bounds;
    const d = Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.z0 - p.z, 0, p.z - b.z1));
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

/**
 * Whether someone in `here` (the room the camera is in) with `visible` rooms drawn should have
 * this effect drawn at all: a room effect only in its room and the rooms that look into it, a
 * casino-wide one everywhere, one round the buyer wherever the buyer's room can be seen.
 */
export function seenFrom(plan: FloorPlan, ev: Pick<FxEvent, 'fx' | 'x' | 'z'>, here: string, visible: ReadonlySet<string>, buyerRoom?: string | null): boolean {
  const reach = reachOf(ev.fx);
  if (reach === 'casino') return true;
  const room = buyerRoom ?? fxRoom(plan, ev)?.id ?? null;
  if (!room) return false;
  return room === here || visible.has(room);
}

/** Whether a room effect (the champagne, the disco) is happening in the room you're in. */
export function inside(plan: FloorPlan, ev: Pick<FxEvent, 'fx' | 'x' | 'z'>, here: string): boolean {
  const reach = reachOf(ev.fx);
  if (reach === 'casino') return true;
  return fxRoom(plan, ev)?.id === here;
}

// --- the statues ---------------------------------------------------------------------------------

export interface StatueSpot {
  x: number;
  z: number;
  /** Which way the figure faces (rotation.y: 0 faces +z, toward the doors). */
  yaw: number;
}

/** The plinth's footprint (m, square) and how far the walker is kept from its middle. */
export const PLINTH = { w: 0.92, base: 1.12, h: 0.96 };
export const STATUE_POST = 0.72;
/** Clear floor wanted round a plinth's base, and the height the figure reaches. */
const CLEAR = 0.55;
const TALL = 3.2;
/** Above this, a solid is overhead (a palm's fronds): only the figure's own reach must miss it. */
const OVERHEAD = 1.2;
const FIGURE_R = 0.5;

/**
 * The lobby's places for a statue (from its middle), best first: flanking the way in from the doors (the first one
 * opposite the directory, so the two balance), then the pair either side of the compass rose, then
 * further toward the pit. Each faces the middle of the lobby, turned toward the doors.
 */
const CANDIDATES: [number, number][] = [
  [4.6, 2.0],
  [4.3, -2.3],
  [-4.3, -2.3],
  [-4.6, 2.0],
  [5.0, 3.4],
  [-5.0, 3.4],
  [3.2, -3.4],
  [-3.2, -3.4],
];

/**
 * Up to `n` spots in the lobby where a statue stands clear of everything: not on a walkway or in a
 * doorway, not in front of the directory, not under a palm's fronds, a plinth's width from
 * anything standing, and apart from each other. The lobby's own plan decides, so moving the
 * directory or a palm moves the statues with it.
 */
export function statueSpots(plan: FloorPlan, n = STATUES): StatueSpot[] {
  const lobby = plan.rooms.find((r) => r.id === 'lobby');
  if (!lobby) return [];
  const L = lobby.inner;
  const cx = (L.x0 + L.x1) / 2;
  const out: StatueSpot[] = [];
  const pool: [number, number][] = CANDIDATES.map(([x, z]) => [lobby.cx + x, lobby.cz + z]);
  // after the chosen few, a grid down the lobby's sides as a fallback (a plan that changed a lot);
  // never its middle, which is the way from the doors to everything
  for (let z = L.z0 + 1; z <= L.z1 - 1; z += 0.5) for (let x = L.x0 + 1; x <= L.x1 - 1; x += 0.5) if (Math.abs(x - cx) >= 3.2) pool.push([x, z]);
  for (const [x, z] of pool) {
    if (out.length >= n) break;
    if (!clearFor(plan, L, x, z)) continue;
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < 2.4)) continue;
    // facing a point on the lobby's middle line, three metres nearer the doors: toward whoever walks in
    out.push({ x, z, yaw: Math.atan2(cx - x, 3) });
  }
  return out;
}

function clearFor(plan: FloorPlan, room: Rect, x: number, z: number): boolean {
  const half = PLINTH.base / 2;
  // inside the room with a walker's width to the walls
  if (!inRect(room, x, z, -(half + 0.6))) return false;
  const foot: Rect = { x0: x - half, z0: z - half, x1: x + half, z1: z + half };
  const grow = (r: Rect, k: number): Rect => ({ x0: r.x0 - k, z0: r.z0 - k, x1: r.x1 + k, z1: r.z1 + k });
  const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
  for (const a of plan.aisles) if (hits(foot, grow(a, 0.35))) return false;
  for (const d of plan.doorways) if (hits(foot, grow(d, 1.2))) return false;
  for (const s of plan.stations) if (Math.hypot(s.x - x, s.z - z) < Math.max(s.fp.width, s.fp.depth) / 2 + half + 1.2) return false;
  for (const s of plan.solids) {
    const tall = s.y0 < TALL;
    if (!tall) continue;
    const r = s.round ? s.w / 2 : Math.hypot(s.w, s.d) / 2;
    // the directory is read from in front: keep its face clear
    if (s.id.includes('directory')) {
      const fx = s.x + Math.sin(s.yaw) * 1.4;
      const fz = s.z + Math.cos(s.yaw) * 1.4;
      if (Math.hypot(fx - x, fz - z) < 1.6 + half) return false;
    }
    const need = s.y0 >= OVERHEAD ? r + FIGURE_R : r + half + CLEAR;
    if (Math.hypot(s.x - x, s.z - z) < need) return false;
  }
  return true;
}
