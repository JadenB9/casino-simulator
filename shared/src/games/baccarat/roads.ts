// The scoreboards a baccarat table shows, worked out from the shoe's history (FEATURES.md §4.5):
//
//   Bead Plate  every coup in order, top to bottom in columns of six; Banker, Player or Tie.
//   Big Road    streaks: a new column each time the winner changes, ties marked on the last
//               mark instead of taking a cell. A streak that reaches the bottom row, or runs
//               into an older streak, turns right and carries on along that row (the "dragon
//               tail"); the next streak still starts one column right of where this one began.
//
// Pure functions of the history, so every client draws the same board and the tests can check
// them against sequences worked out by hand.

import type { RoadEntry } from './protocol.ts';

export const ROAD_ROWS = 6;

export interface BeadCell {
  col: number;
  row: number;
  entry: RoadEntry;
}

export function beadPlate(history: readonly RoadEntry[], rows = ROAD_ROWS): BeadCell[] {
  return history.map((entry, i) => ({ col: Math.floor(i / rows), row: i % rows, entry }));
}

export interface BigRoadCell {
  col: number;
  row: number;
  winner: 'P' | 'B';
  /** Ties dealt after this mark (drawn as a green slash, with the count when there's more than one). */
  ties: number;
  playerPair: boolean;
  bankerPair: boolean;
  /** Which streak this mark belongs to, counting from 0. */
  streak: number;
}

export interface BigRoad {
  cells: BigRoadCell[];
  /** Ties before the shoe's first Player or Banker win; they sit on the first cell. */
  leadingTies: number;
  /** Columns in use (the widest point, dragon tails included). */
  columns: number;
}

export function bigRoad(history: readonly RoadEntry[], rows = ROAD_ROWS): BigRoad {
  const cells: BigRoadCell[] = [];
  const taken = new Set<number>();
  const key = (col: number, row: number) => col * rows + row;
  let leadingTies = 0;
  let last: BigRoadCell | null = null;
  let streak = -1;
  let streakCol = -1;
  let turned = false;
  let columns = 0;

  for (const e of history) {
    if (e.w === 'T') {
      if (last) last.ties++;
      else leadingTies++;
      continue;
    }
    let col: number;
    let row: number;
    if (last && last.winner === e.w) {
      if (!turned && last.row + 1 < rows && !taken.has(key(last.col, last.row + 1))) {
        col = last.col;
        row = last.row + 1;
      } else {
        turned = true;
        col = last.col + 1;
        row = last.row;
        while (taken.has(key(col, row))) col++;
      }
    } else {
      streak++;
      turned = false;
      col = streakCol + 1;
      row = 0;
      while (taken.has(key(col, row))) col++;
      streakCol = col;
    }
    const cell: BigRoadCell = { col, row, winner: e.w, ties: 0, playerPair: e.pp, bankerPair: e.bp, streak };
    cells.push(cell);
    taken.add(key(col, row));
    columns = Math.max(columns, col + 1);
    last = cell;
  }
  return { cells, leadingTies, columns };
}

export interface RoadCounts {
  banker: number;
  player: number;
  tie: number;
  playerPair: number;
  bankerPair: number;
  naturals: number;
}

export function roadCounts(history: readonly RoadEntry[]): RoadCounts {
  const c: RoadCounts = { banker: 0, player: 0, tie: 0, playerPair: 0, bankerPair: 0, naturals: 0 };
  for (const e of history) {
    if (e.w === 'B') c.banker++;
    else if (e.w === 'P') c.player++;
    else c.tie++;
    if (e.pp) c.playerPair++;
    if (e.bp) c.bankerPair++;
    if (e.n) c.naturals++;
  }
  return c;
}
