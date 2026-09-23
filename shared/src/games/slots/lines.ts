// Line machines: five reels of uniformly drawn strips, a window of three or four rows, fixed lines
// paid left to right from reel 1. Lucky Cherries and Gold Rush score every window with these, from
// flat tables built once per strip set, so the enumeration, the Monte Carlo and the engine all run
// the same code.

import type { MachineBase } from './machines.ts';

export interface LineMachine<S extends string, Id extends string> extends MachineBase<Id> {
  kind: 'lines';
  /** Rows in the window: stop s shows strip[s], strip[s+1], ... (wrapping) from the top row down. */
  rows: number;
  symbols: readonly S[];
  strips: readonly (readonly S[])[];
  /** Row (0 top) on reels 1-5 for each line. */
  lineRows: readonly (readonly number[])[];
  /** Credits per credit on the line for 2, 3, 4 and 5 of a kind from reel 1 (0 where it doesn't pay). */
  linePays: Readonly<Partial<Record<S, readonly [number, number, number, number]>>>;
  /** Stands in for every symbol but the scatter and pays nothing itself; never on reel 1. */
  wild: S | null;
  /** Counts anywhere in the window and never completes a line. */
  scatter: S;
}

export interface LineTables {
  rows: number;
  /** Stops per strip. */
  len: number;
  /** Lines. */
  nl: number;
  /** lineSym[r][stop * nl + line]: the symbol index that line reads on reel r at that stop. */
  lineSym: Int8Array[];
  /** scatters[r][stop]: scatters reel r shows in the window. */
  scatters: Int8Array[];
  /** pay[symbol * 6 + n]: credits for n of a kind (0 below the lowest pay). */
  pay: Int32Array;
  /** cellBit[line * 5 + r]: the bit of the cell that line reads on reel r, in a held-cell mask. */
  cellBit: Int32Array;
  wild: number;
  scatter: number;
}

export const REELS = 5;

/** Bit of cell (reel, row) in a held-cell mask. */
export const cellBit = (rows: number, reel: number, row: number): number => 1 << (reel * rows + row);

export function lineTables<S extends string>(m: LineMachine<S, string>, strips: readonly (readonly S[])[] = m.strips): LineTables {
  const len = strips[0]!.length;
  const nl = m.lineRows.length;
  const sym = (s: S): number => m.symbols.indexOf(s);
  if (strips.length !== REELS || strips.some((s) => s.length !== len)) throw new Error(`${m.id}: five strips of one length`);
  if (m.wild && strips[0]!.includes(m.wild)) throw new Error(`${m.id}: no wild on reel 1`);
  if (m.rows * REELS > 31) throw new Error(`${m.id}: too many cells for a held mask`);
  const lineSym = strips.map((strip, r) => {
    const t = new Int8Array(len * nl);
    for (let s = 0; s < len; s++) for (let l = 0; l < nl; l++) t[s * nl + l] = sym(strip[(s + m.lineRows[l]![r]!) % len]!);
    return t;
  });
  const scatters = strips.map((strip) => {
    const t = new Int8Array(len);
    for (let s = 0; s < len; s++) for (let k = 0; k < m.rows; k++) if (strip[(s + k) % len] === m.scatter) t[s]!++;
    return t;
  });
  const pay = new Int32Array(m.symbols.length * 6);
  for (const [s, p] of Object.entries(m.linePays) as [S, readonly number[]][]) for (let n = 2; n <= 5; n++) pay[sym(s) * 6 + n] = p[n - 2]!;
  const bits = new Int32Array(nl * REELS);
  for (let l = 0; l < nl; l++) for (let r = 0; r < REELS; r++) bits[l * REELS + r] = cellBit(m.rows, r, m.lineRows[l]![r]!);
  return { rows: m.rows, len, nl, lineSym, scatters, pay, cellBit: bits, wild: m.wild ? sym(m.wild) : -1, scatter: sym(m.scatter) };
}

/**
 * Line credits for one window at one credit per line. Each line pays its reel-1 symbol for the run
 * of that symbol (or the wild) from the left; reel 1 has no wild, so there is one candidate per
 * line. `held` marks cells that read WILD whatever the reel shows (Gold Rush's sticky wilds).
 * This is the hot loop of the enumerations and the money path of the engine, so it reads flat
 * tables only.
 */
export function lineCredits(t: LineTables, s0: number, s1: number, s2: number, s3: number, s4: number, held = 0): number {
  const nl = t.nl, W = t.wild, S = t.scatter, pay = t.pay, bits = t.cellBit;
  const L0 = t.lineSym[0]!, L1 = t.lineSym[1]!, L2 = t.lineSym[2]!, L3 = t.lineSym[3]!, L4 = t.lineSym[4]!;
  const b0 = s0 * nl, b1 = s1 * nl, b2 = s2 * nl, b3 = s3 * nl, b4 = s4 * nl;
  let win = 0;
  for (let l = 0; l < nl; l++) {
    const f = L0[b0 + l]!;
    if (f === S) continue;
    const c = l * 5;
    let x = held & bits[c + 1]! ? W : L1[b1 + l]!;
    if (x !== f && x !== W) continue; // one of a kind never pays
    x = held & bits[c + 2]! ? W : L2[b2 + l]!;
    if (x !== f && x !== W) {
      win += pay[f * 6 + 2]!;
      continue;
    }
    x = held & bits[c + 3]! ? W : L3[b3 + l]!;
    if (x !== f && x !== W) {
      win += pay[f * 6 + 3]!;
      continue;
    }
    x = held & bits[c + 4]! ? W : L4[b4 + l]!;
    win += pay[f * 6 + (x === f || x === W ? 5 : 4)]!;
  }
  return win;
}

export function scatterCount(t: LineTables, stops: readonly number[]): number {
  let k = 0;
  for (let r = 0; r < REELS; r++) k += t.scatters[r]![stops[r]!]!;
  return k;
}

export interface LineWin<S extends string = string> {
  /** 0-based line index. */
  line: number;
  symbol: S;
  count: number;
  /** Credits at one credit per line. */
  pay: number;
}

/** Which lines won and with what: the same rule as lineCredits, spelled out for the display. */
export function lineWins<S extends string>(m: LineMachine<S, string>, t: LineTables, stops: readonly number[], held = 0): LineWin<S>[] {
  const wins: LineWin<S>[] = [];
  for (let l = 0; l < t.nl; l++) {
    const f = t.lineSym[0]![stops[0]! * t.nl + l]!;
    if (f === t.scatter) continue;
    let n = 1;
    while (n < REELS) {
      const x = held & t.cellBit[l * REELS + n]! ? t.wild : t.lineSym[n]![stops[n]! * t.nl + l]!;
      if (x === f || x === t.wild) n++;
      else break;
    }
    const pay = t.pay[f * 6 + n]!;
    if (pay > 0) wins.push({ line: l, symbol: m.symbols[f]!, count: n, pay });
  }
  return wins;
}

/** The symbol in `row` (0 top) of `reel` when it stops at `stop`. */
export function symbolAt<S extends string>(strips: readonly (readonly S[])[], reel: number, stop: number, row: number): S {
  const strip = strips[reel]!;
  return strip[(stop + row) % strip.length]!;
}

/** The cells of a window showing `sym`, as reel * rows + row. */
export function cellsShowing<S extends string>(strips: readonly (readonly S[])[], rows: number, stops: readonly number[], sym: S): number[] {
  const cells: number[] = [];
  stops.forEach((s, reel) => {
    for (let row = 0; row < rows; row++) if (symbolAt(strips, reel, s, row) === sym) cells.push(reel * rows + row);
  });
  return cells;
}
