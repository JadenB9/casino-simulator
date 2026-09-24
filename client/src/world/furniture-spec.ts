// The loose furniture's sizes and seats, as data: the floor plan makes each piece's solids and
// seats from these, and furniture.ts draws each piece to the same measurements (world4.mjs checks
// the drawn seats against these tops with a ray straight down). A piece's front is its local +z:
// yaw 0 turns it to face south, and a sitter on it faces the way the piece does.

import type { GameId } from '../../../shared/src/engine.ts';
import type { FurnitureKind } from './rooms.ts';

export type SeatKind = 'chair' | 'stool' | 'sofa' | 'bench';

export interface FurnitureSpec {
  /** Across (local x) and deep (local z), or the diameter when round; how tall. */
  w: number;
  d: number;
  h: number;
  round?: boolean;
  /** How near a walker's centre may come to a round piece's centre, when not its drawn size. */
  walk?: number;
  /** The places to sit: hip points (local) and the way each sitter faces (local yaw); the seat's top. */
  seats?: { x: number; z: number; yaw: number }[];
  top?: number;
  seatKind?: SeatKind;
}

/** Bar stools (stool.glb, scaled to 0.8 m: its cushion is its top). */
export const BAR_STOOL = { r: 0.21, h: 0.8 };

/** Three bar stools round a high-top, a third of a turn apart, this far from its middle. */
const HIGHTOP_STOOLS = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
const HIGHTOP_R = 0.62;

export const FURNITURE: Record<FurnitureKind, FurnitureSpec> = {
  // couch.glb at 2.2 m: back at -z, cushion 0.375 m up, three places
  sofa: { w: 2.2, d: 0.8, h: 0.85, seats: [-0.62, 0, 0.62].map((x) => ({ x, z: 0.1, yaw: 0 })), top: 0.375, seatKind: 'sofa' },
  // a leather club chair
  armchair: { w: 0.86, d: 0.84, h: 0.8, seats: [{ x: 0, z: 0.08, yaw: 0 }], top: 0.44, seatKind: 'chair' },
  // the salon's velvet tub chair
  tub: { w: 0.74, d: 0.74, h: 0.92, seats: [{ x: 0, z: 0.06, yaw: 0 }], top: 0.48, seatKind: 'chair' },
  // an upholstered bench, no back: three places
  bench: { w: 1.8, d: 0.52, h: 0.46, seats: [-0.58, 0, 0.58].map((x) => ({ x, z: 0, yaw: 0 })), top: 0.46, seatKind: 'bench' },
  // a round banquette about a planter: eight places facing out
  banquette: {
    w: 3.1,
    d: 3.1,
    h: 0.9,
    round: true,
    seats: Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return { x: Math.sin(a) * 1.22, z: Math.cos(a) * 1.22, yaw: a };
    }),
    top: 0.45,
    seatKind: 'bench',
  },
  // a round bar-height table with three stools round it
  hightop: {
    w: 2 * (HIGHTOP_R + BAR_STOOL.r),
    d: 2 * (HIGHTOP_R + BAR_STOOL.r),
    h: 1.06,
    round: true,
    seats: HIGHTOP_STOOLS.map((a) => ({ x: Math.sin(a) * HIGHTOP_R, z: Math.cos(a) * HIGHTOP_R, yaw: a + Math.PI })),
    top: BAR_STOOL.h,
    seatKind: 'stool',
  },
  coffee: { w: 1.3, d: 0.7, h: 0.44 },
  side: { w: 0.56, d: 0.56, h: 0.56, round: true },
  // a jeweller's case: glass top on a lit wood base
  case: { w: 1.6, d: 0.62, h: 0.96 },
  // a mannequin on a round plinth
  mannequin: { w: 0.84, d: 0.84, h: 1.95, round: true },
  // the yard: a crate to sit on, oil barrels, stacked pallets, a scrap heap, a workbench, a fire
  crate: { w: 0.62, d: 0.62, h: 0.5, seats: [{ x: 0, z: 0, yaw: 0 }], top: 0.5, seatKind: 'stool' },
  barrel: { w: 0.6, d: 0.6, h: 0.9, round: true },
  pallets: { w: 1.22, d: 1.02, h: 0.62 },
  scrap: { w: 2.0, d: 1.56, h: 1.15 },
  // (its lamp stands half a metre over the top)
  workbench: { w: 1.8, d: 0.72, h: 1.5 },
  'drum-fire': { w: 0.62, d: 0.62, h: 0.92, round: true, walk: 0.62 },
  'plank-bench': { w: 1.9, d: 0.46, h: 0.48, seats: [-0.46, 0.46].map((x) => ({ x, z: 0, yaw: 0 })), top: 0.48, seatKind: 'bench' },
  // the lobby's directory: a board on two posts
  directory: { w: 1.5, d: 0.36, h: 2.36 },
  // a host stand
  podium: { w: 0.92, d: 0.56, h: 1.52 },
  lamp: { w: 0.84, d: 0.84, h: 1.45, round: true },
  palm: { w: 1.0, d: 1.0, h: 0.62, round: true },
};

/** The chairs and stools at the tables, drawn at every seat the game's module lists. */
export type ChairKind = 'chair' | 'plush' | 'stool' | 'velvet-stool';

export const CHAIRS: Record<ChairKind, { w: number; d: number; h: number; round?: boolean }> = {
  // a casino table chair: upholstered seat and back on a wood frame, brass foot ring
  // (deeper than its seat: the back's posts rake back)
  chair: { w: 0.46, d: 0.56, h: 1.06 },
  // the salon's: velvet, a rounder back
  plush: { w: 0.5, d: 0.5, h: 1.06 },
  // a backless stool on a chrome post
  stool: { w: 0.31, d: 0.31, h: 0.7, round: true },
  'velvet-stool': { w: 0.33, d: 0.33, h: 0.74, round: true },
};

/**
 * What each game's players sit on and how high, from its table's height at the players' rail
 * (measured from the models: blackjack 0.80 m, baccarat and the carnival games 0.76, roulette 0.80,
 * Sic Bo 0.78, the Big Six's layout 0.90, a slot's button deck 0.82). A seat sits about a fifth of
 * a metre under the rail, so knees go under it. Games not listed keep their own (Hold'em's chairs,
 * the Bandit Wheel's stools, the desks' gaming chairs, video poker's) or are played standing
 * (craps, at its rail).
 */
export const SEATING: Partial<Record<GameId, { kind: ChairKind; top: number; high?: { kind: ChairKind; top: number } }>> = {
  blackjack: { kind: 'chair', top: 0.58, high: { kind: 'plush', top: 0.56 } },
  baccarat: { kind: 'chair', top: 0.56, high: { kind: 'plush', top: 0.54 } },
  threecard: { kind: 'chair', top: 0.56, high: { kind: 'plush', top: 0.54 } },
  war: { kind: 'chair', top: 0.56, high: { kind: 'plush', top: 0.54 } },
  roulette: { kind: 'stool', top: 0.62, high: { kind: 'velvet-stool', top: 0.62 } },
  sicbo: { kind: 'stool', top: 0.6 },
  bigsix: { kind: 'stool', top: 0.68 },
  slots: { kind: 'stool', top: 0.6 },
};
