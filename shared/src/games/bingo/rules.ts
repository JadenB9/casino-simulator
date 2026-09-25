// Bingo as data: the 75-ball card, the three patterns, and the fixed prize table
// (docs/rules/parlour-games.md §1).
//
// A card is five columns under B-I-N-G-O: B holds five numbers from 1-15, I from 16-30, N four
// from 31-45 round the free centre, G from 46-60 and O from 61-75. The caller draws balls from a
// shuffled set of 75 without replacement.
//
// Prizes don't depend on who else is playing. Each card is its own bet: it pays a fixed multiple
// of its price for each pattern it completes, and how much depends only on the ball the pattern
// was completed on (the 17th ball called, say). So the return is the same with one card in the
// hall or a hundred and sixty, and it can be computed exactly: for a card and a random ball order,
// only which of the card's cells are marked after n balls matters, and those are a uniformly
// random subset of the card's 24 numbers whose size is hypergeometric. Four corners and blackout
// are then single binomial ratios; a line is counted by inclusion-exclusion over the 12 lines
// (checked against all 2^24 subsets in the tests).

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

export const BALLS = 75;
/** A card's cells, row by row; cell 12 is the free centre. */
export const CELLS = 25;
export const FREE = 12;
export const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

export type Pattern = 'line' | 'corners' | 'blackout';
export const PATTERNS: readonly Pattern[] = ['line', 'corners', 'blackout'];
export const PATTERN_NAMES: Record<Pattern, string> = { line: 'Line', corners: 'Four corners', blackout: 'Blackout' };

/** The five rows, the five columns and the two diagonals, as cell indexes. */
export const LINES: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < 5; r++) out.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) out.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  out.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return out;
})();
export const CORNERS: readonly number[] = [0, 4, 20, 24];

/** A card as the player sees it: 25 numbers row by row, 0 in the free centre. */
export type Card = number[];

/** The column (0 = B) a ball belongs to. */
export function columnOf(ball: number): number {
  return Math.floor((ball - 1) / 15);
}

/** "B 7", "O 72". */
export function ballName(ball: number): string {
  return `${LETTERS[columnOf(ball)]} ${ball}`;
}

export function isBall(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= BALLS;
}

/** A fresh card: each column's numbers drawn without replacement from its fifteen, in drawn order. */
export function dealCard(rng: Rng): Card {
  const card: Card = new Array<number>(CELLS).fill(0);
  for (let col = 0; col < 5; col++) {
    const pool = Array.from({ length: 15 }, (_, i) => col * 15 + i + 1);
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) continue;
      const j = randInt(rng, pool.length);
      card[row * 5 + col] = pool[j]!;
      pool.splice(j, 1);
    }
  }
  return card;
}

/** A whole ball order: Fisher-Yates over 1..75. */
export function drawOrder(rng: Rng): number[] {
  const balls = Array.from({ length: BALLS }, (_, i) => i + 1);
  for (let i = balls.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [balls[i], balls[j]] = [balls[j]!, balls[i]!];
  }
  return balls;
}

/** For a ball order, the call number of every ball (1 = the first ball called), indexed by ball. */
export function callNumbers(order: readonly number[]): number[] {
  const at = new Array<number>(BALLS + 1).fill(0);
  order.forEach((b, i) => (at[b] = i + 1));
  return at;
}

/** The call a cell is marked on (0 for the free centre, marked from the start). */
function cellAt(card: Card, at: readonly number[], cell: number): number {
  return cell === FREE ? 0 : at[card[cell]!]!;
}

/** The call on which each pattern is completed on this card, given the call number of every ball. */
export function completions(card: Card, at: readonly number[]): Record<Pattern, number> {
  let line = Infinity;
  for (const l of LINES) {
    let done = 0;
    for (const c of l) done = Math.max(done, cellAt(card, at, c));
    line = Math.min(line, done);
  }
  let corners = 0;
  for (const c of CORNERS) corners = Math.max(corners, cellAt(card, at, c));
  let blackout = 0;
  for (let c = 0; c < CELLS; c++) blackout = Math.max(blackout, cellAt(card, at, c));
  return { line, corners, blackout };
}

/** Whether a pattern is complete on a card once `called` holds every ball called so far. */
export function hasPattern(card: Card, called: ReadonlySet<number>, p: Pattern): boolean {
  const marked = (c: number) => c === FREE || called.has(card[c]!);
  if (p === 'corners') return CORNERS.every(marked);
  if (p === 'blackout') return card.every((_, c) => marked(c));
  return LINES.some((l) => l.every(marked));
}

/** Numbers still needed for the pattern: the fewest over its lines for Line. */
export function toGo(card: Card, called: ReadonlySet<number>, p: Pattern): number {
  const missing = (cells: readonly number[]) => cells.filter((c) => c !== FREE && !called.has(card[c]!)).length;
  if (p === 'corners') return missing(CORNERS);
  if (p === 'blackout') return missing(Array.from({ length: CELLS }, (_, c) => c));
  return Math.min(...LINES.map(missing));
}

// ---------------------------------------------------------------------------------------------
// The prize table

/** One band: completed on call `upTo` or earlier (and after the band before) pays `mult` hundredths of the card's price. */
export interface Band {
  upTo: number;
  mult: number;
}

/**
 * Multiples of the card's price in hundredths (a line on call 12 or earlier pays 50x, 5000). A
 * pattern completed after its last band pays nothing. The blackout bands are the hall's jackpot:
 * every number on the card inside 45, 50 or 55 calls.
 */
export const PRIZES: Record<Pattern, readonly Band[]> = {
  line: [
    { upTo: 12, mult: 5_000 },
    { upTo: 16, mult: 2_000 },
    { upTo: 20, mult: 800 },
    { upTo: 25, mult: 300 },
    { upTo: 30, mult: 150 },
    { upTo: 35, mult: 80 },
    { upTo: 40, mult: 40 },
  ],
  corners: [
    { upTo: 12, mult: 10_000 },
    { upTo: 16, mult: 4_000 },
    { upTo: 20, mult: 1_200 },
    { upTo: 25, mult: 500 },
    { upTo: 30, mult: 200 },
    { upTo: 35, mult: 50 },
  ],
  blackout: [
    { upTo: 45, mult: 2_000_000 },
    { upTo: 50, mult: 250_000 },
    { upTo: 55, mult: 20_000 },
  ],
};

/** The last call on which a pattern can still win something. */
export const LAST_PRIZE: Record<Pattern, number> = {
  line: PRIZES.line.at(-1)!.upTo,
  corners: PRIZES.corners.at(-1)!.upTo,
  blackout: PRIZES.blackout.at(-1)!.upTo,
};

/** The most balls a game can call: after this nothing on any card can win. */
export const MAX_CALLS = Math.max(LAST_PRIZE.line, LAST_PRIZE.corners, LAST_PRIZE.blackout);

/** The multiple (hundredths) a pattern completed on `call` pays; 0 when it is too late. */
export function prizeMult(p: Pattern, call: number): number {
  for (const b of PRIZES[p]) if (call <= b.upTo) return b.mult;
  return 0;
}

/** What a card priced `stake` (whole dollars) collects for completing `p` on `call`. Always whole cents. */
export function prizeFor(p: Pattern, call: number, stake: Cents): Cents {
  return (stake / 100) * prizeMult(p, call);
}

/**
 * Whether this card can still win anything once `calls` balls are out: an open pattern whose last
 * band hasn't passed, and for blackout, few enough numbers missing to fill in the calls left.
 */
export function canStillWin(card: Card, called: ReadonlySet<number>, calls: number, done: Partial<Record<Pattern, unknown>>): boolean {
  if (!done.line && calls < LAST_PRIZE.line) return true;
  if (!done.corners && calls < LAST_PRIZE.corners) return true;
  if (!done.blackout && toGo(card, called, 'blackout') <= LAST_PRIZE.blackout - calls) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Exact odds

/** C(n, k) as a BigInt (0 outside 0..n). */
export function chooseBig(n: number, k: number): bigint {
  if (k < 0 || k > n || n < 0) return 0n;
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

/** The card's 24 numbered cells as bit positions 0..23 (the centre skipped). */
function bitOf(cell: number): number {
  return cell < FREE ? cell : cell - 1;
}

/** Each line as a bit mask over the 24 numbered cells (the four through the centre have four bits). */
export const LINE_MASKS: readonly number[] = LINES.map((l) => l.filter((c) => c !== FREE).reduce((m, c) => m | (1 << bitOf(c)), 0));

function popcount(x: number): number {
  let n = 0;
  for (let b = x; b; b &= b - 1) n++;
  return n;
}

/**
 * How many k-subsets of the 24 numbered cells complete at least one line, for k = 0..24, by
 * inclusion-exclusion over the 4,095 non-empty sets of lines: a set of lines whose cells number u
 * is inside C(24 - u, k - u) subsets, counted with sign (-1)^(lines + 1).
 */
export function lineSubsets(): bigint[] {
  const out = new Array<bigint>(25).fill(0n);
  for (let s = 1; s < 1 << LINE_MASKS.length; s++) {
    let union = 0;
    let lines = 0;
    for (let j = 0; j < LINE_MASKS.length; j++) {
      if ((s >> j) & 1) {
        union |= LINE_MASKS[j]!;
        lines++;
      }
    }
    const u = popcount(union);
    const sign = lines % 2 === 1 ? 1n : -1n;
    for (let k = u; k <= 24; k++) out[k]! += sign * chooseBig(24 - u, k - u);
  }
  return out;
}

/** An exact fraction. */
export interface Frac {
  num: bigint;
  den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function frac(num: bigint, den: bigint): Frac {
  const g = gcd(num, den) || 1n;
  return { num: num / g, den: den / g };
}

export function add(a: Frac, b: Frac): Frac {
  return frac(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function sub(a: Frac, b: Frac): Frac {
  return frac(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function toNumber(f: Frac): number {
  // enough digits for a double without overflowing one
  const scale = 10n ** 18n;
  return Number((f.num * scale) / f.den) / 1e18;
}

/**
 * The chance a card has completed `p` once `n` balls are out, exactly. After n calls the card has
 * k of its 24 numbers marked with chance C(24, k) C(51, n - k) / C(75, n), and every k-subset of
 * cells is equally likely.
 */
export function completeBy(p: Pattern, n: number, lines: bigint[] = lineSubsets()): Frac {
  if (n <= 0) return { num: 0n, den: 1n };
  const total = chooseBig(BALLS, n);
  if (p === 'corners') return frac(chooseBig(n, 4), chooseBig(BALLS, 4));
  if (p === 'blackout') return frac(chooseBig(n, 24), chooseBig(BALLS, 24));
  let num = 0n;
  for (let k = 0; k <= 24; k++) num += lines[k]! * chooseBig(BALLS - 24, n - k);
  return frac(num, total);
}

/** The chance `p` is completed on exactly call n. */
export function completeOn(p: Pattern, n: number, lines: bigint[] = lineSubsets()): Frac {
  return sub(completeBy(p, n, lines), completeBy(p, n - 1, lines));
}

/** One pattern's share of the return, as a fraction of the card's price. */
export function patternReturn(p: Pattern, lines: bigint[] = lineSubsets()): Frac {
  let r: Frac = { num: 0n, den: 1n };
  let from = 0;
  for (const b of PRIZES[p]) {
    const chance = sub(completeBy(p, b.upTo, lines), completeBy(p, from, lines));
    r = add(r, frac(chance.num * BigInt(b.mult), chance.den * 100n));
    from = b.upTo;
  }
  return r;
}

/** The card's whole return: the three patterns' shares added. */
export function cardReturn(): { total: Frac; parts: Record<Pattern, Frac> } {
  const lines = lineSubsets();
  const parts = { line: patternReturn('line', lines), corners: patternReturn('corners', lines), blackout: patternReturn('blackout', lines) };
  return { total: add(add(parts.line, parts.corners), parts.blackout), parts };
}

/** The published return, as printed: 96.710234% (the exact fraction rounds to this). */
export const PUBLISHED_RTP = '96.710234';

/** The chance of each prize band, for the rules card and the tips. */
export function bandChances(p: Pattern): { band: Band; from: number; chance: number }[] {
  const lines = lineSubsets();
  let from = 0;
  return PRIZES[p].map((band) => {
    const c = sub(completeBy(p, band.upTo, lines), completeBy(p, from, lines));
    const row = { band, from: from + 1, chance: toNumber(c) };
    from = band.upTo;
    return row;
  });
}

/** Bingo callers' names for some numbers, said after the number. */
export const CALLS: Readonly<Record<number, string>> = {
  1: 'Kelly\'s eye',
  7: 'Lucky seven',
  11: 'Legs eleven',
  13: 'Unlucky for some',
  21: 'Key of the door',
  22: 'Two little ducks',
  26: 'Pick and mix',
  30: 'Dirty Gertie',
  33: 'All the threes',
  44: 'Droopy drawers',
  45: 'Halfway there',
  52: 'Danny La Rue',
  55: 'Snakes alive',
  57: 'Heinz varieties',
  59: 'The Brighton line',
  64: 'Almost retired',
  66: 'Clickety click',
  69: 'Either way up',
  71: 'Bang on the drum',
  72: 'Six dozen',
};

/** What the caller says for a ball: "B 7. Lucky seven." */
export function callLine(ball: number): string {
  const nick = CALLS[ball];
  return nick ? `${ballName(ball)}. ${nick}` : ballName(ball);
}
