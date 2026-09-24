// Machine D, "Diamond Line": a classic 3-reel stepper, one line, 1-3 coins. The DIAMOND is wild
// for every symbol, cherries included, and doubles the win it's part of: one DIAMOND pays x2, two
// pay x4, three pay the top award. The strips and pays are docs/math/slot-d-diamond-line.mjs, the
// published PAR sheet (docs/rules/cards-and-machines.md §3.7); the tests hold this file to it.

import type { Cents } from '../../money.ts';
import { randInt, type Rng } from '../../rng.ts';
import type { StepperMachine } from './machines.ts';
import { virtualReel } from './rules.ts';
import type { ReelsEvent, SpinSettlement } from './protocol.ts';

/** DI = diamond wild, 7 = blue seven, 3B/2B/1B = triple/double/single bar, CH = cherry, BL = blank. */
export type DiamondSymbol = 'DI' | '7' | '3B' | '2B' | '1B' | 'CH' | 'BL';
export type DiamondCombo = 'threeDI' | 'three7' | 'three3B' | 'three2B' | 'three1B' | 'anyBar' | 'threeCH' | 'twoCH' | 'oneCH';

/** Pays per coin before the diamond multiplier. */
export const DIAMOND_THREE: Readonly<Record<'7' | '3B' | '2B' | '1B' | 'CH', number>> = { '7': 80, '3B': 40, '2B': 25, '1B': 10, CH: 10 };
export const DIAMOND_ANY_BAR = 5;
/** One and two cherries on the line, diamonds counted as cherries (three is DIAMOND_THREE.CH). */
export const DIAMOND_CHERRIES: readonly [one: number, two: number] = [2, 5];
export const DIAMOND_TOP = 1000;
/** Each DIAMOND in a win multiplies it by this. */
export const DIAMOND_MULTIPLIER = 2;

export const DIAMONDS: StepperMachine<DiamondSymbol, DiamondCombo, 'diamonds'> = {
  kind: 'stepper',
  id: 'diamonds',
  name: 'Diamond Line',
  // $1, $2, $5, and the high-limit $25 and $100
  denoms: [100, 200, 500, 2500, 10_000],
  maxCoins: 3,
  lines: 1,
  virtualStops: 64,
  reels: [
    [['DI', 2], ['BL', 3], ['1B', 3], ['BL', 4], ['CH', 2], ['BL', 4], ['2B', 3], ['BL', 4], ['1B', 3], ['BL', 3], ['7', 2], ['BL', 3], ['3B', 2], ['BL', 4], ['1B', 3], ['BL', 4], ['2B', 2], ['BL', 3], ['CH', 1], ['BL', 4], ['3B', 2], ['BL', 3]],
    [['DI', 2], ['BL', 3], ['2B', 3], ['BL', 4], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 3], ['CH', 2], ['BL', 4], ['1B', 3], ['BL', 3], ['7', 2], ['BL', 3], ['2B', 2], ['BL', 4], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 4], ['CH', 1], ['BL', 3]],
    [['DI', 1], ['BL', 3], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 4], ['2B', 3], ['BL', 4], ['CH', 1], ['BL', 3], ['7', 2], ['BL', 3], ['1B', 3], ['BL', 4], ['2B', 3], ['BL', 4], ['3B', 2], ['BL', 4], ['1B', 3], ['BL', 4], ['CH', 1], ['BL', 3]],
  ],
  pays: [
    { combo: 'threeDI', label: 'Diamond Diamond Diamond', pay: DIAMOND_TOP },
    { combo: 'three7', label: 'Seven Seven Seven', pay: DIAMOND_THREE['7'] },
    { combo: 'three3B', label: 'Triple bar x3', pay: DIAMOND_THREE['3B'] },
    { combo: 'three2B', label: 'Double bar x3', pay: DIAMOND_THREE['2B'] },
    { combo: 'three1B', label: 'Single bar x3', pay: DIAMOND_THREE['1B'] },
    { combo: 'anyBar', label: 'Any three bars', pay: DIAMOND_ANY_BAR },
    { combo: 'threeCH', label: 'Three cherries', pay: DIAMOND_THREE.CH },
    { combo: 'twoCH', label: 'Any two cherries', pay: DIAMOND_CHERRIES[1] },
    { combo: 'oneCH', label: 'Any one cherry', pay: DIAMOND_CHERRIES[0] },
  ],
  published: [
    ['Return to player', '94.9829%'],
    ['Hit frequency', '21.3497% (1 in 4.68 spins)'],
    ['Diamond Diamond Diamond', '1 in 65,536 spins'],
    ['Standard deviation', '6.06 x the bet per spin'],
  ],
};

const isBar = (s: DiamondSymbol): boolean => s === '3B' || s === '2B' || s === '1B';
const isThreeSymbol = (s: DiamondSymbol): s is keyof typeof DIAMOND_THREE => Object.hasOwn(DIAMOND_THREE, s);

export interface DiamondScore {
  combo: DiamondCombo | null;
  /** DIAMONDs in the win: 0-2 multiply it (x1, x2, x4); 3 is the top award. */
  wilds: number;
  /** Pays per coin, multiplier included. */
  pay: number;
}

/**
 * Diamond Line: the DIAMOND substitutes for any symbol and each one in a win doubles it. Cherries
 * pay anywhere on the line, one, two or three of them, and a DIAMOND counts as a cherry, so a
 * lone DIAMOND pays one cherry doubled. Only the highest win is paid.
 */
export function scoreDiamonds(a: DiamondSymbol, b: DiamondSymbol, c: DiamondSymbol): DiamondScore {
  const line = [a, b, c];
  const wilds = line.filter((s) => s === 'DI').length;
  if (wilds === 3) return { combo: 'threeDI', wilds: 3, pay: DIAMOND_TOP };
  const rest = line.filter((s) => s !== 'DI');
  // every diamond on the line takes part in every candidate win, so they share one multiplier
  const candidates: [DiamondCombo, number][] = [];
  const first = rest[0]!;
  if (isThreeSymbol(first) && rest.every((s) => s === first)) candidates.push([`three${first}`, DIAMOND_THREE[first]]);
  if (rest.every(isBar)) candidates.push(['anyBar', DIAMOND_ANY_BAR]);
  const cherries = rest.filter((s) => s === 'CH').length + wilds;
  if (cherries === 2) candidates.push(['twoCH', DIAMOND_CHERRIES[1]]);
  else if (cherries === 1) candidates.push(['oneCH', DIAMOND_CHERRIES[0]]);
  if (candidates.length === 0) return { combo: null, wilds: 0, pay: 0 };
  const [combo, perCoin] = candidates.reduce((best, c) => (c[1] > best[1] ? c : best));
  return { combo, wilds, pay: perCoin * DIAMOND_MULTIPLIER ** wilds };
}

const MAPS = DIAMONDS.reels.map((r) => virtualReel(r));

export interface DiamondSpin extends DiamondScore {
  /** The drawn virtual stops (0..63). */
  virtual: number[];
  /** The physical stop on the payline for each reel (0..21). */
  stops: number[];
  symbols: DiamondSymbol[];
}

/** One spin: a uniform virtual stop per reel, mapped to its physical stop and scored. */
export function spinDiamonds(rng: Rng): DiamondSpin {
  const virtual = MAPS.map((m) => randInt(rng, m.length));
  const stops = virtual.map((v, r) => MAPS[r]![v]!);
  const symbols = stops.map((s, r) => DIAMONDS.reels[r]![s]![0]);
  return { virtual, stops, symbols, ...scoreDiamonds(symbols[0]!, symbols[1]!, symbols[2]!) };
}

/** The score of a set of physical stops (enumeration and replay use this). */
export function diamondsPayAt(stops: readonly number[]): DiamondScore {
  const s = stops.map((x, r) => DIAMONDS.reels[r]![x]![0]);
  return scoreDiamonds(s[0]!, s[1]!, s[2]!);
}

/** Which reels' payline symbols made the win, for the lit reels behind the glass. */
export function diamondHits(symbols: readonly DiamondSymbol[], combo: DiamondCombo | null): boolean[] {
  if (combo === null) return [false, false, false];
  if (combo === 'oneCH' || combo === 'twoCH') return symbols.map((s) => s === 'CH' || s === 'DI');
  return [true, true, true];
}

/** The symbol a pay glass row is about ('BAR' for any three bars). */
const COMBO_SYMBOL: Record<DiamondCombo, string> = {
  threeDI: 'DI', three7: '7', three3B: '3B', three2B: '2B', three1B: '1B', anyBar: 'BAR', threeCH: 'CH', twoCH: 'CH', oneCH: 'CH',
};

/** Settle one paid spin: `unit` is one coin of the bet's denomination times the coins bet. */
export function settleDiamonds(rng: Rng, unit: Cents): SpinSettlement {
  const r = spinDiamonds(rng);
  const win = r.pay * unit;
  const hits = diamondHits(r.symbols, r.combo);
  const reels: ReelsEvent = {
    type: 'reels',
    stops: r.stops,
    spin: 0,
    freeLeft: 0,
    lines: r.combo === null ? [] : [{ line: 0, symbol: COMBO_SYMBOL[r.combo], count: hits.filter(Boolean).length, win }],
    hits,
    combo: r.combo,
    wilds: r.wilds,
    scatters: 0,
    scatterWin: 0,
    win,
    trigger: false,
    multiplier: r.wilds > 0 && r.wilds < 3 ? DIAMOND_MULTIPLIER ** r.wilds : 1,
  };
  return { reels: [reels], win, freeSpins: 0, freeWin: 0, stops: r.stops };
}
