// Machine G, "Straw, Sticks & Bricks": five reels by three rows, 20 fixed lines, the WOLF wild on
// reels 2-5, three pigs and four farmhouse pictures on the lines, and houses: STRAW, STICKS and
// BRICK. Six or more houses anywhere start the Blowdown: the houses stay where they are and the
// other cells spin on their own, three spins to start and back to three whenever a house lands.
// Before each of those spins every standing house may be rebuilt one grade stronger (straw to
// sticks to brick to a gold MANSION). When the spins run out the wolf blows every house down and
// each one pays the prize it was hiding, bigger the sturdier it was; all fifteen cells built is
// the Whole Street, a thousand times the bet on top. The strips, lines, pays and bonus rules are
// docs/math/slot-g-straw-sticks-bricks.mjs, the published PAR sheet
// (docs/rules/cards-and-machines.md §3.10).

import type { Cents } from '../../money.ts';
import { randInt, type Rng } from '../../rng.ts';
import { lineCredits, lineTables, lineWins, type LineMachine } from './lines.ts';
import type { BlowdownView, ReelsEvent, SpinSettlement } from './protocol.ts';

export const PIG_SYMBOLS = ['WOLF', 'BRICKPIG', 'STICKPIG', 'STRAWPIG', 'POT', 'CHURN', 'APPLE', 'TURNIP', 'STRAW', 'STICKS', 'BRICK'] as const;
export type PigSymbol = (typeof PIG_SYMBOLS)[number];

/** A house's grade: 0 straw, 1 sticks, 2 brick, 3 the gold mansion (only ever rebuilt, never landed). */
export type Grade = 0 | 1 | 2 | 3;
export const GRADE_NAMES = ['Straw', 'Sticks', 'Brick', 'Mansion'] as const;
/** The house symbol on the reels for each grade that can land there. */
export const HOUSE_SYMBOLS: readonly PigSymbol[] = ['STRAW', 'STICKS', 'BRICK'];

/** The Blowdown's rules. Every chance is a whole number out of a whole number, drawn exactly. */
export interface BlowdownRules {
  cells: number;
  /** Spins to start with, and to go back to whenever a house lands. */
  respins: number;
  /** An empty cell builds a house on a spin with chance land[0] / land[1]. */
  land: readonly [num: number, den: number];
  /** A new house's grade: straw, sticks or brick, out of gradeDen. */
  grade: readonly number[];
  gradeDen: number;
  /** Before each spin, a standing house of each grade is rebuilt one grade up with this chance out of upgradeDen. */
  upgrade: readonly number[];
  upgradeDen: number;
  /** What each grade may be hiding, in total bets, each equally likely. */
  prizes: readonly (readonly number[])[];
  /** All the cells built: the Whole Street, in total bets, on top of the houses' own prizes. */
  street: number;
}

export interface PigsMachine extends LineMachine<PigSymbol, 'pigs'> {
  /** Houses in the window that start the Blowdown. */
  trigger: number;
  bonus: BlowdownRules;
}

export const PIGS: PigsMachine = {
  kind: 'lines',
  id: 'pigs',
  name: 'Straw, Sticks & Bricks',
  // 1¢, 5¢, 25¢, $1 and $5, and the high-limit room's $25, $100 and $500 ($50,000 a spin: 5 a line on 20 lines)
  denoms: [1, 5, 25, 100, 500, 2500, 10_000, 50_000],
  maxCoins: 5,
  lines: 20,
  rows: 3,
  symbols: PIG_SYMBOLS,
  strips: [
    ['BRICKPIG', 'TURNIP', 'APPLE', 'STRAW', 'STRAW', 'STICKS', 'POT', 'CHURN', 'STRAWPIG', 'TURNIP', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'TURNIP', 'APPLE', 'APPLE', 'STRAWPIG', 'POT', 'TURNIP', 'CHURN', 'BRICKPIG', 'TURNIP', 'APPLE', 'STICKPIG', 'CHURN', 'TURNIP', 'POT', 'APPLE', 'TURNIP'],
    ['WOLF', 'TURNIP', 'APPLE', 'STRAW', 'STICKS', 'POT', 'CHURN', 'STRAWPIG', 'TURNIP', 'BRICKPIG', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'TURNIP', 'CHURN', 'WOLF', 'STRAWPIG', 'POT', 'APPLE', 'CHURN', 'TURNIP', 'APPLE', 'STICKPIG', 'BRICKPIG', 'TURNIP', 'POT', 'APPLE', 'TURNIP', 'CHURN'],
    ['STICKPIG', 'TURNIP', 'APPLE', 'STRAW', 'STRAW', 'BRICK', 'CHURN', 'WOLF', 'TURNIP', 'BRICKPIG', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'TURNIP', 'CHURN', 'APPLE', 'STRAWPIG', 'POT', 'TURNIP', 'CHURN', 'WOLF', 'APPLE', 'STICKPIG', 'TURNIP', 'POT', 'BRICKPIG', 'TURNIP', 'APPLE', 'CHURN'],
    ['APPLE', 'TURNIP', 'POT', 'STRAW', 'STICKS', 'POT', 'CHURN', 'WOLF', 'TURNIP', 'BRICKPIG', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'APPLE', 'TURNIP', 'CHURN', 'STRAWPIG', 'WOLF', 'TURNIP', 'CHURN', 'STICKPIG', 'APPLE', 'POT', 'BRICKPIG', 'TURNIP', 'APPLE', 'TURNIP', 'CHURN', 'POT'],
    ['CHURN', 'TURNIP', 'APPLE', 'STRAW', 'STRAW', 'POT', 'WOLF', 'STRAWPIG', 'TURNIP', 'BRICKPIG', 'APPLE', 'STICKPIG', 'POT', 'CHURN', 'TURNIP', 'APPLE', 'STRAWPIG', 'POT', 'TURNIP', 'CHURN', 'WOLF', 'STICKPIG', 'TURNIP', 'POT', 'BRICKPIG', 'APPLE', 'CHURN', 'APPLE', 'TURNIP', 'STICKPIG'],
  ],
  // Neon Nights' twenty lines
  lineRows: [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
    [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0],
  ],
  linePays: {
    BRICKPIG: [0, 40, 200, 800],
    STICKPIG: [0, 30, 100, 400],
    STRAWPIG: [0, 20, 75, 250],
    POT: [0, 10, 40, 125],
    CHURN: [0, 8, 30, 100],
    APPLE: [0, 5, 15, 60],
    TURNIP: [0, 4, 10, 50],
  },
  wild: 'WOLF',
  // the line scorer's one scatter; every house is a non-paying symbol that ends a line
  scatter: 'STRAW',
  trigger: 6,
  bonus: {
    cells: 15,
    respins: 3,
    land: [1, 25],
    grade: [6, 3, 1],
    gradeDen: 10,
    upgrade: [12, 8, 3, 0],
    upgradeDen: 200,
    prizes: [
      [1, 1, 1, 2, 2, 3],
      [2, 3, 3, 4, 5, 8],
      [5, 6, 8, 10, 15, 20],
      [50],
    ],
    street: 1000,
  },
  published: [
    ['Return to player', '94.6852% (Blowdown included)'],
    ['Line wins', '63.7104%'],
    ['Blowdown', '30.9748%, started 1 in 114.56 paid spins'],
    ['Hit frequency', '51.7180% (1 in 1.93 spins)'],
    ['Whole Street', '1 in 235,070 paid spins'],
    ['Standard deviation', 'about 4.8 x the bet per spin (simulated)'],
  ],
};

export const PIG_TABLES = lineTables(PIGS);

/** House grades a window shows, by cell (reel * 3 + row): a grade, or null for no house. */
export function housesIn(stops: readonly number[]): (Grade | null)[] {
  const out: (Grade | null)[] = [];
  for (let r = 0; r < 5; r++) {
    const strip = PIGS.strips[r]!;
    for (let row = 0; row < PIGS.rows; row++) {
      const g = HOUSE_SYMBOLS.indexOf(strip[(stops[r]! + row) % strip.length]!);
      out.push(g < 0 ? null : (g as Grade));
    }
  }
  return out;
}

export interface PigSpin {
  /** Top-row stop per reel (0-29). */
  stops: number[];
  /** Line credits at one credit per line. */
  credits: number;
  houses: number;
  trigger: boolean;
}

export function scorePigs(stops: readonly number[]): PigSpin {
  const [a, b, c, d, e] = stops as [number, number, number, number, number];
  const houses = housesIn(stops).filter((g) => g !== null).length;
  return { stops: [a, b, c, d, e], credits: lineCredits(PIG_TABLES, a, b, c, d, e), houses, trigger: houses >= PIGS.trigger };
}

// ---------------------------------------------------------------------------------------------
// the Blowdown

/** One spin of the Blowdown. */
export interface BlowdownSpin {
  /** Cells whose house was rebuilt one grade up before the spin. */
  rebuilt: number[];
  /** Houses built on the spin: [cell, grade]. */
  landed: [cell: number, grade: Grade][];
  /** Spins left after this one. */
  left: number;
}

export interface BlowdownPlay {
  /** The houses that started it: [cell, grade]. */
  start: [cell: number, grade: Grade][];
  spins: BlowdownSpin[];
  /** Every house at the end, in cell order: its final grade and the prize it hid, in total bets. */
  houses: [cell: number, grade: Grade, prize: number][];
  /** Every cell built. */
  street: boolean;
  /** Everything it paid, in total bets. */
  total: number;
}

/**
 * Play the Blowdown from the houses in `start` (a grade per cell, null for an empty one), drawing
 * with `draw(n)`, a uniform whole number below n. The order is fixed so a script can drive it:
 * each spin first rolls every standing house for a rebuild (in cell order), then each empty cell
 * for a house and, when one lands, its grade; at the end each house draws its prize in cell order.
 */
export function playBlowdown(draw: (n: number) => number, start: readonly (Grade | null)[], b: BlowdownRules = PIGS.bonus): BlowdownPlay {
  const grid = [...start];
  const spins: BlowdownSpin[] = [];
  let left = b.respins;
  const full = () => grid.every((g) => g !== null);
  while (left > 0 && !full()) {
    const rebuilt: number[] = [];
    grid.forEach((g, cell) => {
      if (g === null) return;
      const up = b.upgrade[g] ?? 0;
      if (up > 0 && draw(b.upgradeDen) < up) {
        grid[cell] = (g + 1) as Grade;
        rebuilt.push(cell);
      }
    });
    const landed: [number, Grade][] = [];
    for (let cell = 0; cell < grid.length; cell++) {
      if (grid[cell] !== null) continue;
      if (draw(b.land[1]) >= b.land[0]) continue;
      let k = draw(b.gradeDen);
      let grade = 0;
      while (k >= b.grade[grade]!) k -= b.grade[grade++]!;
      grid[cell] = grade as Grade;
      landed.push([cell, grade as Grade]);
    }
    left = landed.length ? b.respins : left - 1;
    spins.push({ rebuilt, landed, left });
  }
  const houses: [number, Grade, number][] = [];
  let total = 0;
  grid.forEach((g, cell) => {
    if (g === null) return;
    const table = b.prizes[g]!;
    const prize = table[draw(table.length)]!;
    houses.push([cell, g, prize]);
    total += prize;
  });
  const street = full();
  if (street) total += b.street;
  return { start: start.flatMap((g, cell) => (g === null ? [] : [[cell, g] as [number, Grade]])), spins, houses, street, total };
}

/**
 * The Blowdown's exact expectations, by a backward recursion over (houses standing, spins left).
 * Every empty cell builds independently with the same chance on each spin, so how many land on a
 * spin is binomial in the empty cells alone; a standing house's future depends only on its grade
 * and on that count process, and prizes are drawn at the end independently of the rest. So:
 *   h[g](k, r)  the expected prize of a house of grade g with k built and r spins left,
 *   v(k, r)     the expected prizes of houses still to land, plus the Whole Street,
 *   f(k, r)     the chance the street gets built,
 * each a sum over the next spin's landings j of Binomial(N - k, p)(j) times the value at
 * (k + j, j > 0 ? respins : r - 1), with the rebuild step applied to h first. A bonus that starts
 * with houses of grades n[g] is worth sum n[g] h[g](k, respins) + v(k, respins) total bets.
 */
export function blowdownExact(b: BlowdownRules = PIGS.bonus): {
  h: (k: number, r: number) => number[];
  v: (k: number, r: number) => number;
  f: (k: number, r: number) => number;
  value: (grades: readonly number[]) => number;
  street: (houses: number) => number;
} {
  const N = b.cells, R = b.respins, G = b.prizes.length;
  const p = b.land[0] / b.land[1];
  const pi = [...b.grade.map((w) => w / b.gradeDen), ...new Array<number>(G - b.grade.length).fill(0)];
  const mean = b.prizes.map((t) => t.reduce((a, x) => a + x, 0) / t.length);
  const choose = (n: number, k: number) => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    return c;
  };
  const binom = (n: number, j: number) => choose(n, j) * p ** j * (1 - p) ** (n - j);
  const H: number[][][] = [], V: number[][] = [], F: number[][] = [];
  for (let k = N; k >= 0; k--) {
    H[k] = [];
    V[k] = [];
    F[k] = [];
    for (let r = 0; r <= R; r++) {
      if (k === N || r === 0) {
        H[k]![r] = [...mean];
        V[k]![r] = k === N ? b.street : 0;
        F[k]![r] = k === N ? 1 : 0;
        continue;
      }
      const h = new Array<number>(G).fill(0);
      let v = 0, f = 0;
      for (let j = 0; j <= N - k; j++) {
        const pj = binom(N - k, j);
        const nk = k + j, nr = j > 0 ? R : r - 1;
        const hn = H[nk]![nr]!;
        for (let g = 0; g < G; g++) {
          const u = (b.upgrade[g] ?? 0) / b.upgradeDen;
          h[g]! += pj * ((1 - u) * hn[g]! + (u > 0 ? u * hn[g + 1]! : 0));
        }
        let fresh = 0;
        for (let g = 0; g < G; g++) fresh += pi[g]! * hn[g]!;
        v += pj * (j * fresh + V[nk]![nr]!);
        f += pj * F[nk]![nr]!;
      }
      H[k]![r] = h;
      V[k]![r] = v;
      F[k]![r] = f;
    }
  }
  return {
    h: (k, r) => H[k]![r]!,
    v: (k, r) => V[k]![r]!,
    f: (k, r) => F[k]![r]!,
    value: (grades) => {
      const k = grades.reduce((a, n) => a + n, 0);
      const h = H[k]![R]!;
      return grades.reduce((a, n, g) => a + n * h[g]!, 0) + V[k]![R]!;
    },
    street: (houses) => F[houses]![R]!,
  };
}

export interface PigsPlay {
  base: PigSpin;
  bonus: BlowdownPlay | null;
  /** Line credits plus the Blowdown's total bets x the lines, at one credit per line. */
  credits: number;
}

/** One paid spin: a uniform stop on each reel, then the Blowdown when six or more houses show. */
export function playPigs(rng: Rng): PigsPlay {
  const stops: number[] = [];
  for (let r = 0; r < 5; r++) stops.push(randInt(rng, PIGS.strips[r]!.length));
  const base = scorePigs(stops);
  const bonus = base.trigger ? playBlowdown((n) => randInt(rng, n), housesIn(stops)) : null;
  return { base, bonus, credits: base.credits + (bonus ? bonus.total * PIGS.lines : 0) };
}

/** Settle one paid spin: `unit` is one credit per line of the bet's denomination times the credits. */
export function settlePigs(rng: Rng, unit: Cents): SpinSettlement {
  const play = playPigs(rng);
  const lines = lineWins(PIGS, PIG_TABLES, play.base.stops).map((w) => ({ line: w.line, symbol: w.symbol, count: w.count, win: w.pay * unit }));
  const bet = PIGS.lines * unit;
  let blowdown: BlowdownView | undefined;
  if (play.bonus) {
    const bd = play.bonus;
    blowdown = {
      start: bd.start,
      spins: bd.spins.map((s) => ({ rebuilt: s.rebuilt, landed: s.landed, left: s.left })),
      houses: bd.houses.map(([cell, grade, prize]) => [cell, grade, prize * bet]),
      street: bd.street ? PIGS.bonus.street * bet : 0,
      win: bd.total * bet,
    };
  }
  const win = play.credits * unit;
  const ev: ReelsEvent = {
    type: 'reels',
    stops: play.base.stops,
    spin: 0,
    freeLeft: 0,
    lines,
    hits: [],
    combo: null,
    wilds: 0,
    scatters: play.base.houses,
    scatterWin: 0,
    win,
    trigger: play.base.trigger,
    multiplier: 1,
    ...(blowdown ? { blowdown } : {}),
  };
  return { reels: [ev], win, freeSpins: 0, freeWin: 0, stops: play.base.stops };
}
