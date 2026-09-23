import { describe, it, expect } from 'vitest';
import type { RoadEntry } from '../src/games/baccarat/protocol.ts';
import { beadPlate, bigRoad, roadCounts } from '../src/games/baccarat/roads.ts';

/** "BBPT" -> history entries; a lowercase letter marks a Player pair on that coup. */
function shoe(seq: string): RoadEntry[] {
  return [...seq].map((ch) => {
    const w = ch.toUpperCase() as RoadEntry['w'];
    return { w, p: w === 'P' ? 7 : 5, b: w === 'B' ? 7 : 5, pp: ch !== ch.toUpperCase(), bp: false, n: false };
  });
}

const cellsOf = (seq: string) => bigRoad(shoe(seq)).cells.map((c) => `${c.winner}${c.col},${c.row}`);

describe('baccarat Bead Plate', () => {
  it('fills columns of six, top to bottom, in coup order', () => {
    const cells = beadPlate(shoe('BPTBBPPB'));
    expect(cells.map((c) => [c.col, c.row])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 0], [1, 1]]);
    expect(cells.map((c) => c.entry.w).join('')).toBe('BPTBBPPB');
  });
});

describe('baccarat Big Road', () => {
  it('starts a new column whenever the winner changes', () => {
    expect(cellsOf('BBPB')).toEqual(['B0,0', 'B0,1', 'P1,0', 'B2,0']);
  });

  it('marks ties on the last mark, and ties before the first win on the first cell', () => {
    const r = bigRoad(shoe('TBTTP'));
    expect(r.leadingTies).toBe(1);
    expect(r.cells.map((c) => [c.winner, c.ties])).toEqual([['B', 2], ['P', 0]]);
  });

  it('turns a long streak right along the bottom row (the dragon tail)', () => {
    expect(cellsOf('BBBBBBBB')).toEqual(['B0,0', 'B0,1', 'B0,2', 'B0,3', 'B0,4', 'B0,5', 'B1,5', 'B2,5']);
    expect(bigRoad(shoe('BBBBBBBB')).columns).toBe(3);
  });

  it('starts the next streak one column right of where the last one began, above its tail', () => {
    expect(cellsOf('BBBBBBBBP').at(-1)).toBe('P1,0');
  });

  it('turns a streak early when an older tail is in the way', () => {
    // Seven Bankers: six down and one right. Seven Players then run down column 1 until the
    // Banker tail at row 5 stops them, and turn right along row 4.
    expect(cellsOf('BBBBBBBPPPPPPP')).toEqual([
      'B0,0', 'B0,1', 'B0,2', 'B0,3', 'B0,4', 'B0,5', 'B1,5',
      'P1,0', 'P1,1', 'P1,2', 'P1,3', 'P1,4', 'P2,4', 'P3,4',
    ]);
  });

  it('keeps stacking tails: the third streak stops above the first tail', () => {
    const cells = cellsOf('BBBBBBBB' + 'P' + 'BBBBBB');
    expect(cells.slice(-6)).toEqual(['B2,0', 'B2,1', 'B2,2', 'B2,3', 'B2,4', 'B3,4']);
  });

  it('numbers the streaks and carries pairs', () => {
    const r = bigRoad(shoe('BpPB'));
    expect(r.cells.map((c) => c.streak)).toEqual([0, 1, 1, 2]);
    expect(r.cells.map((c) => c.playerPair)).toEqual([false, true, false, false]);
  });
});

describe('baccarat road counts', () => {
  it('counts winners, pairs and naturals', () => {
    const h = shoe('BBpTP');
    h[0]!.n = true;
    expect(roadCounts(h)).toEqual({ banker: 2, player: 2, tie: 1, playerPair: 1, bankerPair: 0, naturals: 1 });
  });
});
