// Slot rules as plain functions: draw the stops, score them. The engine settles every spin with
// these, and the tests enumerate and simulate with the same functions, so what is proven is what
// is played.
//
// Pays here are in coins (3-reel, per coin bet) or credits (5-reel, at one credit per line). The
// engine multiplies by coins and denomination to get cents.

import { randInt, type Rng } from '../../rng.ts';
import {
  NEON,
  NEON_SYMBOLS,
  SEVENS,
  WILD,
  WILD_ANY_BAR,
  WILD_BASE,
  WILD_MULTIPLIER,
  WILD_ONE_ONLY,
  WILD_THREE_WILDS,
  WILD_TWO_ONLY,
  type NeonSymbol,
  type SevensCombo,
  type SevensSymbol,
  type WeightedStop,
  type WildCombo,
  type WildSymbol,
} from './machines.ts';

// ---------------------------------------------------------------------------------------------
// 3-reel steppers

/**
 * The virtual reel: virtual stop -> physical stop, each physical stop entered `weight` times. The
 * server draws a uniform virtual stop per reel and the reel shows the physical stop it maps to.
 */
export function virtualReel<S extends string>(reel: readonly WeightedStop<S>[]): number[] {
  const map: number[] = [];
  reel.forEach(([, w], stop) => {
    for (let i = 0; i < w; i++) map.push(stop);
  });
  return map;
}

const isBar = (s: string): boolean => s === '3B' || s === '2B' || s === '1B';

export interface SevensScore {
  combo: SevensCombo | null;
  /** Pays per coin. */
  pay: number;
}

const SEVENS_PAY = Object.fromEntries(SEVENS.pays.map((p) => [p.combo, p.pay])) as Record<SevensCombo, number>;

/** Classic Sevens: only the highest win on the line is paid; bars and cherries never combine. */
export function scoreSevens(a: SevensSymbol, b: SevensSymbol, c: SevensSymbol): SevensScore {
  let combo: SevensCombo | null = null;
  if (a === '7' && b === '7' && c === '7') combo = 'three7';
  else if (a === '3B' && b === '3B' && c === '3B') combo = 'three3B';
  else if (a === '2B' && b === '2B' && c === '2B') combo = 'three2B';
  else if (a === '1B' && b === '1B' && c === '1B') combo = 'three1B';
  else if (isBar(a) && isBar(b) && isBar(c)) combo = 'anyBar';
  else if (a === 'CH' && b === 'CH' && c === 'CH') combo = 'threeCH';
  else if (a === 'CH' && b === 'CH') combo = 'twoCH';
  else if (a === 'CH') combo = 'oneCH';
  return { combo, pay: combo ? SEVENS_PAY[combo] : 0 };
}

export interface WildScore {
  combo: WildCombo | null;
  /** How many 5X symbols multiplied the win (0-2; three 5X is its own award). */
  wilds: number;
  /** Pays per coin, multiplier included. */
  pay: number;
}

/**
 * 5x Wild: the 5X substitutes for sevens and bars, and each one in a line win multiplies it by 5.
 * With no line win, two 5X pay 10 and one pays 2. Only the highest win is paid.
 */
export function scoreWild(a: WildSymbol, b: WildSymbol, c: WildSymbol): WildScore {
  const line = [a, b, c];
  const wilds = line.filter((s) => s === 'WX').length;
  if (wilds === 3) return { combo: 'threeWX', wilds: 3, pay: WILD_THREE_WILDS };
  const rest = line.filter((s) => s !== 'WX') as Exclude<WildSymbol, 'WX'>[];
  const mult = WILD_MULTIPLIER ** wilds;
  let combo: WildCombo | null = null;
  let pay = 0;
  const first = rest[0]!;
  if (first !== 'BL' && rest.every((s) => s === first)) {
    combo = `three${first}`;
    pay = WILD_BASE[first] * mult;
  }
  if (rest.every(isBar) && WILD_ANY_BAR * mult > pay) {
    combo = 'anyBar';
    pay = WILD_ANY_BAR * mult;
  }
  if (combo) return { combo, wilds, pay };
  if (wilds === 2) return { combo: 'twoWX', wilds: 2, pay: WILD_TWO_ONLY };
  if (wilds === 1) return { combo: 'oneWX', wilds: 1, pay: WILD_ONE_ONLY };
  return { combo: null, wilds: 0, pay: 0 };
}

const SEVENS_MAPS = SEVENS.reels.map((r) => virtualReel(r));
const WILD_MAPS = WILD.reels.map((r) => virtualReel(r));

export interface StepperSpin<S extends string, C extends string> {
  /** The drawn virtual stops (0..63 or 0..71). */
  virtual: number[];
  /** The physical stop on the payline for each reel (0..21). */
  stops: number[];
  symbols: S[];
  combo: C | null;
  wilds: number;
  pay: number;
}

/** One Classic Sevens spin: a uniform virtual stop per reel, mapped and scored. */
export function spinSevens(rng: Rng): StepperSpin<SevensSymbol, SevensCombo> {
  const virtual = SEVENS_MAPS.map((m) => randInt(rng, m.length));
  const stops = virtual.map((v, r) => SEVENS_MAPS[r]![v]!);
  const symbols = stops.map((s, r) => SEVENS.reels[r]![s]![0]);
  const { combo, pay } = scoreSevens(symbols[0]!, symbols[1]!, symbols[2]!);
  return { virtual, stops, symbols, combo, wilds: 0, pay };
}

/** One 5x Wild spin. */
export function spinWild(rng: Rng): StepperSpin<WildSymbol, WildCombo> {
  const virtual = WILD_MAPS.map((m) => randInt(rng, m.length));
  const stops = virtual.map((v, r) => WILD_MAPS[r]![v]!);
  const symbols = stops.map((s, r) => WILD.reels[r]![s]![0]);
  const { combo, wilds, pay } = scoreWild(symbols[0]!, symbols[1]!, symbols[2]!);
  return { virtual, stops, symbols, combo, wilds, pay };
}

/** Pay per coin for a set of physical stops (enumeration and replay use this). */
export function sevensPayAt(stops: readonly number[]): SevensScore {
  const s = stops.map((x, r) => SEVENS.reels[r]![x]![0]);
  return scoreSevens(s[0]!, s[1]!, s[2]!);
}

export function wildPayAt(stops: readonly number[]): WildScore {
  const s = stops.map((x, r) => WILD.reels[r]![x]![0]);
  return scoreWild(s[0]!, s[1]!, s[2]!);
}

// ---------------------------------------------------------------------------------------------
// 5-reel video: Neon Nights

const NL = NEON.lines;
const LEN = NEON.strips[0]!.length;
const REELS = NEON.strips.length;
const SYM = (s: NeonSymbol): number => NEON_SYMBOLS.indexOf(s);
const W = SYM('WILD');
const S = SYM('SCATTER');

// lineSym[r][stop * NL + line]: the symbol that line reads on reel r when the reel stops at `stop`.
const LINE_SYM = NEON.strips.map((strip, r) => {
  const t = new Int8Array(LEN * NL);
  for (let s = 0; s < LEN; s++) for (let l = 0; l < NL; l++) t[s * NL + l] = SYM(strip[(s + NEON.lineRows[l]![r]!) % LEN]!);
  return t;
});
// scatters[r][stop]: how many scatters that reel shows in the window.
const SCATTERS = NEON.strips.map((strip) => {
  const t = new Int8Array(LEN);
  for (let s = 0; s < LEN; s++) for (let k = 0; k < NEON.rows; k++) if (strip[(s + k) % LEN] === 'SCATTER') t[s]!++;
  return t;
});
// PAY[symbol * 6 + n]: credits for n of a kind (0 below 3).
const PAY = new Int32Array(NEON_SYMBOLS.length * 6);
for (const [sym, p] of Object.entries(NEON.linePays)) {
  const i = SYM(sym as NeonSymbol);
  PAY[i * 6 + 3] = p![0];
  PAY[i * 6 + 4] = p![1];
  PAY[i * 6 + 5] = p![2];
}
const L0 = LINE_SYM[0]!, L1 = LINE_SYM[1]!, L2 = LINE_SYM[2]!, L3 = LINE_SYM[3]!, L4 = LINE_SYM[4]!;
const SC0 = SCATTERS[0]!, SC1 = SCATTERS[1]!, SC2 = SCATTERS[2]!, SC3 = SCATTERS[3]!, SC4 = SCATTERS[4]!;

/**
 * Line credits for one window, at one credit per line. A line pays 3, 4 or 5 of a kind on
 * adjacent reels from reel 1; WILD substitutes for everything but SCATTER. Reel 1 has no WILD,
 * so each line has one candidate symbol. This is the hot loop of the enumeration and the money
 * path of the engine, so it reads flat tables only.
 */
export function neonLineCredits(s0: number, s1: number, s2: number, s3: number, s4: number): number {
  let win = 0;
  const b0 = s0 * NL, b1 = s1 * NL, b2 = s2 * NL, b3 = s3 * NL, b4 = s4 * NL;
  for (let l = 0; l < NL; l++) {
    const f = L0[b0 + l]!;
    if (f === S) continue;
    let x = L1[b1 + l]!;
    if (x !== f && x !== W) continue;
    x = L2[b2 + l]!;
    if (x !== f && x !== W) continue;
    x = L3[b3 + l]!;
    if (x !== f && x !== W) {
      win += PAY[f * 6 + 3]!;
      continue;
    }
    x = L4[b4 + l]!;
    win += PAY[f * 6 + (x === f || x === W ? 5 : 4)]!;
  }
  return win;
}

export function neonScatters(s0: number, s1: number, s2: number, s3: number, s4: number): number {
  return SC0[s0]! + SC1[s1]! + SC2[s2]! + SC3[s3]! + SC4[s4]!;
}

/** Scatter credits at one credit per line: the scatter pay times the total bet (20 credits). */
export function neonScatterCredits(scatters: number): number {
  return (NEON.scatterPays[scatters] ?? 0) * NL;
}

export interface NeonLineWin {
  /** 0-based line index (line 1 is index 0). */
  line: number;
  symbol: NeonSymbol;
  count: number;
  /** Credits at one credit per line. */
  pay: number;
}

/** Which lines won and with what: the same rule as neonLineCredits, spelled out for the display. */
export function neonLineWins(stops: readonly number[]): NeonLineWin[] {
  const wins: NeonLineWin[] = [];
  for (let l = 0; l < NL; l++) {
    const f = LINE_SYM[0]![stops[0]! * NL + l]!;
    if (f === S) continue;
    let n = 1;
    while (n < REELS) {
      const x = LINE_SYM[n]![stops[n]! * NL + l]!;
      if (x === f || x === W) n++;
      else break;
    }
    const pay = PAY[f * 6 + n]!;
    if (pay > 0) wins.push({ line: l, symbol: NEON_SYMBOLS[f]!, count: n, pay });
  }
  return wins;
}

/** The symbol in row `row` (0 top) of reel `reel` when it stops at `stop`. */
export function neonSymbolAt(reel: number, stop: number, row: number): NeonSymbol {
  return NEON.strips[reel]![(stop + row) % LEN]!;
}

export interface NeonSpin {
  stops: number[];
  /** Line credits plus scatter credits, at one credit per line, before any free-spin multiplier. */
  credits: number;
  lineCredits: number;
  scatters: number;
  scatterCredits: number;
  /** Three or more scatters: 10 free spins (more during free spins). */
  trigger: boolean;
}

/** Score a window. */
export function scoreNeon(stops: readonly number[]): NeonSpin {
  const [a, b, c, d, e] = stops as [number, number, number, number, number];
  const lineCredits = neonLineCredits(a, b, c, d, e);
  const scatters = neonScatters(a, b, c, d, e);
  const scatterCredits = neonScatterCredits(scatters);
  return { stops: [a, b, c, d, e], credits: lineCredits + scatterCredits, lineCredits, scatters, scatterCredits, trigger: scatters >= NEON.trigger };
}

/** One spin: a uniform stop (0..31) on each reel. */
export function spinNeon(rng: Rng): NeonSpin {
  const stops: number[] = [];
  for (let r = 0; r < REELS; r++) stops.push(randInt(rng, LEN));
  return scoreNeon(stops);
}

export interface NeonPlay {
  base: NeonSpin;
  /** Every free spin in order, retriggers included. Their credits are before the x3. */
  free: NeonSpin[];
  /** Base credits plus 3 x every free spin's credits, at one credit per line. */
  credits: number;
}

/**
 * A paid spin and the whole feature it starts. Free spins use the same reels and lines at the
 * triggering bet, every win x3, and three or more scatters during them add 10 more (no cap).
 * They are drawn here, one after another, so the paid spin settles in one step.
 */
export function playNeon(rng: Rng): NeonPlay {
  const base = spinNeon(rng);
  const free: NeonSpin[] = [];
  let credits = base.credits;
  if (base.trigger) {
    let left = NEON.freeSpins;
    while (left > 0) {
      left--;
      const fs = spinNeon(rng);
      free.push(fs);
      credits += NEON.freeMultiplier * fs.credits;
      if (fs.trigger) left += NEON.freeSpins;
    }
  }
  return { base, free, credits };
}
