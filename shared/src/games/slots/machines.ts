// The first three machines' PAR sheets as data: reel strips, weights, pays, lines and bets. The strips
// and pays are copied from docs/math/slot-*.mjs, which stay the published source (see
// docs/rules/cards-and-machines.md §3). The tests enumerate every stop combination through the
// engine's own scoring and compare against the published returns, so a changed weight or pay
// here can't slip through. Diamond Line, Lucky Cherries and Gold Rush came later and live in their
// own files; lineup.ts puts all six together.

import type { Cents } from '../../money.ts';

/** The first three machines, which share the v1 cabinets and view. SlotId (lineup.ts) is all six. */
export type MachineId = 'sevens' | 'neon' | 'wild';
export const MACHINE_IDS: readonly MachineId[] = ['sevens', 'neon', 'wild'];

export function isMachineId(x: unknown): x is MachineId {
  return x === 'sevens' || x === 'neon' || x === 'wild';
}

/** What every machine shares: its bets, and the published figures its help screen shows. */
export interface MachineBase<Id extends string = MachineId> {
  id: Id;
  name: string;
  /** Coin values the player can pick, in cents, lowest first. */
  denoms: readonly Cents[];
  /** Coins per spin (3-reel) or credits per line (5-reel), 1..maxCoins. */
  maxCoins: number;
  /** Paylines. The 5-reel plays all 20 at once, so its bet is lines x credits per line. */
  lines: number;
  /** The PAR sheet's headline figures, as the help screen prints them. */
  published: readonly (readonly [label: string, value: string])[];
}

// ---------------------------------------------------------------------------------------------
// Machine A, "Classic Sevens": 3 reels, 22 physical stops, 64 virtual stops per reel, one line.

/** 7 = red seven, 3B/2B/1B = triple/double/single bar, CH = cherry, BL = blank. */
export type SevensSymbol = '7' | '3B' | '2B' | '1B' | 'CH' | 'BL';

/** One physical stop: its symbol and how many of the virtual stops point at it. */
export type WeightedStop<S extends string> = readonly [symbol: S, weight: number];

export type SevensCombo = 'three7' | 'three3B' | 'three2B' | 'three1B' | 'anyBar' | 'threeCH' | 'twoCH' | 'oneCH';

export interface StepperMachine<S extends string, C extends string, Id extends string = MachineId> extends MachineBase<Id> {
  kind: 'stepper';
  virtualStops: number;
  /** [symbol, weight] for physical stops 0..21 on each reel. */
  reels: readonly (readonly WeightedStop<S>[])[];
  /** The pay glass, top to bottom: pays per coin. */
  pays: readonly { combo: C; label: string; pay: number }[];
}

export const SEVENS: StepperMachine<SevensSymbol, SevensCombo> = {
  kind: 'stepper',
  id: 'sevens',
  name: 'Classic Sevens',
  // 25¢, $1, $5, and the high-limit $25 and $100
  denoms: [25, 100, 500, 2500, 10_000],
  maxCoins: 3,
  lines: 1,
  virtualStops: 64,
  reels: [
    [['7', 2], ['BL', 3], ['1B', 4], ['BL', 3], ['CH', 4], ['BL', 2], ['2B', 4], ['BL', 3], ['1B', 3], ['BL', 2], ['3B', 3], ['BL', 3], ['CH', 4], ['BL', 2], ['1B', 3], ['BL', 3], ['2B', 3], ['BL', 2], ['CH', 4], ['BL', 3], ['3B', 2], ['BL', 2]],
    [['7', 2], ['BL', 3], ['2B', 3], ['BL', 3], ['CH', 4], ['BL', 3], ['1B', 4], ['BL', 3], ['3B', 3], ['BL', 3], ['2B', 3], ['BL', 3], ['1B', 3], ['BL', 3], ['CH', 4], ['BL', 3], ['2B', 2], ['BL', 3], ['1B', 3], ['BL', 2], ['3B', 2], ['BL', 2]],
    [['7', 2], ['BL', 3], ['1B', 4], ['BL', 3], ['3B', 3], ['BL', 3], ['2B', 3], ['BL', 3], ['CH', 3], ['BL', 3], ['1B', 4], ['BL', 3], ['2B', 3], ['BL', 3], ['3B', 3], ['BL', 3], ['1B', 3], ['BL', 3], ['CH', 3], ['BL', 2], ['2B', 2], ['BL', 2]],
  ],
  pays: [
    { combo: 'three7', label: 'Seven Seven Seven', pay: 1000 },
    { combo: 'three3B', label: 'Triple bar x3', pay: 100 },
    { combo: 'three2B', label: 'Double bar x3', pay: 50 },
    { combo: 'three1B', label: 'Single bar x3', pay: 20 },
    { combo: 'anyBar', label: 'Any three bars', pay: 5 },
    { combo: 'threeCH', label: 'Cherry Cherry Cherry', pay: 20 },
    { combo: 'twoCH', label: 'Cherry on reels 1 and 2', pay: 5 },
    { combo: 'oneCH', label: 'Cherry on reel 1', pay: 2 },
  ],
  published: [
    ['Return to player', '94.4275%'],
    ['Hit frequency', '23.5786% (1 in 4.24 spins)'],
    ['Seven Seven Seven', '1 in 32,768 spins'],
    ['Standard deviation', '6.66 x the bet per spin'],
  ],
};

// ---------------------------------------------------------------------------------------------
// Machine C, "5x Wild": 3 reels, 22 physical stops, 72 virtual stops per reel, one line. The 5X
// symbol is wild for sevens and bars and multiplies the win by 5 for each one on the line.

/** WX = the 5X wild. */
export type WildSymbol = 'WX' | '7' | '3B' | '2B' | '1B' | 'BL';
export type WildCombo = 'threeWX' | 'three7' | 'three3B' | 'three2B' | 'three1B' | 'anyBar' | 'twoWX' | 'oneWX';

export const WILD_BASE: Readonly<Record<'7' | '3B' | '2B' | '1B', number>> = { '7': 100, '3B': 40, '2B': 25, '1B': 10 };
export const WILD_ANY_BAR = 5;
export const WILD_THREE_WILDS = 5000;
/** Two 5X with a symbol they can't complete (a blank). */
export const WILD_TWO_ONLY = 10;
/** One 5X and no line win. */
export const WILD_ONE_ONLY = 2;
export const WILD_MULTIPLIER = 5;

export const WILD: StepperMachine<WildSymbol, WildCombo> = {
  kind: 'stepper',
  id: 'wild',
  name: '5x Wild',
  // $1, $5, $25, and the high-limit $100
  denoms: [100, 500, 2500, 10_000],
  maxCoins: 3,
  lines: 1,
  virtualStops: 72,
  reels: [
    [['WX', 2], ['BL', 4], ['1B', 3], ['BL', 5], ['2B', 2], ['BL', 4], ['7', 2], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['2B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['3B', 1], ['BL', 5], ['2B', 2], ['BL', 4]],
    [['WX', 2], ['BL', 4], ['2B', 2], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['7', 2], ['BL', 5], ['2B', 2], ['BL', 4], ['1B', 2], ['BL', 5], ['3B', 2], ['BL', 4], ['1B', 2], ['BL', 5], ['2B', 2], ['BL', 4]],
    [['WX', 1], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 5], ['2B', 2], ['BL', 4], ['1B', 3], ['BL', 5], ['7', 2], ['BL', 4], ['1B', 2], ['BL', 5], ['2B', 2], ['BL', 4], ['3B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['2B', 2], ['BL', 4]],
  ],
  pays: [
    { combo: 'threeWX', label: '5X 5X 5X', pay: WILD_THREE_WILDS },
    { combo: 'three7', label: 'Seven x3', pay: WILD_BASE['7'] },
    { combo: 'three3B', label: 'Triple bar x3', pay: WILD_BASE['3B'] },
    { combo: 'three2B', label: 'Double bar x3', pay: WILD_BASE['2B'] },
    { combo: 'three1B', label: 'Single bar x3', pay: WILD_BASE['1B'] },
    { combo: 'anyBar', label: 'Any three bars', pay: WILD_ANY_BAR },
    { combo: 'twoWX', label: 'Two 5X, no line win', pay: WILD_TWO_ONLY },
    { combo: 'oneWX', label: 'One 5X, no line win', pay: WILD_ONE_ONLY },
  ],
  published: [
    ['Return to player', '89.8204%'],
    ['Hit frequency', '8.7277% (1 in 11.46 spins)'],
    ['5X 5X 5X', '1 in 93,312 spins'],
    ['Standard deviation', '26.72 x the bet per spin'],
  ],
};

// ---------------------------------------------------------------------------------------------
// Machine B, "Neon Nights": 5 reels x 3 rows, 32-stop strips drawn uniformly, 20 fixed lines,
// WILD on reels 2-5, SCATTER anywhere pays and starts 10 free spins with every win x3.

export const NEON_SYMBOLS = ['WILD', 'SCATTER', 'DIAMOND', 'SEVEN', 'BELL', 'HORSESHOE', 'A', 'K', 'Q', 'J', '10'] as const;
export type NeonSymbol = (typeof NEON_SYMBOLS)[number];

export interface VideoMachine extends MachineBase {
  kind: 'video';
  rows: number;
  /** Stop s shows strip[s], strip[s+1], strip[s+2] (wrapping) in the top, middle and bottom rows. */
  strips: readonly (readonly NeonSymbol[])[];
  /** Row (0 top, 1 middle, 2 bottom) on reels 1-5 for each line. */
  lineRows: readonly (readonly number[])[];
  /** Credits per credit on the line for 3, 4 and 5 of a kind from reel 1. */
  linePays: Readonly<Partial<Record<NeonSymbol, readonly [number, number, number]>>>;
  /** By number of scatters anywhere, times the total bet. */
  scatterPays: readonly number[];
  freeSpins: number;
  freeMultiplier: number;
  trigger: number;
}

export const NEON: VideoMachine = {
  kind: 'video',
  id: 'neon',
  name: 'Neon Nights',
  // 5¢, 25¢, $1, and the high-limit $5
  denoms: [5, 25, 100, 500],
  maxCoins: 5,
  lines: 20,
  rows: 3,
  strips: [
    ['DIAMOND', '10', 'A', 'BELL', 'K', 'Q', 'SEVEN', 'J', '10', 'HORSESHOE', 'A', 'SCATTER', 'K', 'Q', 'BELL', 'J', '10', 'DIAMOND', 'A', 'K', 'HORSESHOE', 'Q', 'J', '10', 'SEVEN', 'A', 'K', 'BELL', 'Q', 'J', 'HORSESHOE', '10'],
    ['SEVEN', 'J', 'K', 'WILD', 'Q', '10', 'HORSESHOE', 'A', 'J', 'DIAMOND', 'K', 'Q', 'BELL', 'SCATTER', 'J', '10', 'WILD', 'A', 'K', 'HORSESHOE', 'Q', 'BELL', 'J', 'SEVEN', 'K', '10', 'WILD', 'Q', 'DIAMOND', 'A', 'HORSESHOE', 'BELL'],
    ['A', 'BELL', 'Q', 'WILD', 'K', 'DIAMOND', '10', 'J', 'HORSESHOE', 'A', 'Q', 'SCATTER', 'K', 'SEVEN', 'WILD', '10', 'A', 'BELL', 'J', 'K', 'HORSESHOE', 'Q', 'WILD', 'A', 'DIAMOND', '10', 'K', 'BELL', 'J', 'Q', 'SEVEN', 'HORSESHOE'],
    ['K', '10', 'SEVEN', 'Q', 'WILD', 'A', 'HORSESHOE', 'J', 'K', 'BELL', 'Q', '10', 'DIAMOND', 'A', 'SCATTER', 'J', 'WILD', 'K', 'HORSESHOE', 'Q', 'A', 'BELL', '10', 'WILD', 'J', 'SEVEN', 'K', 'Q', 'DIAMOND', 'A', 'BELL', 'HORSESHOE'],
    ['Q', 'HORSESHOE', '10', 'A', 'DIAMOND', 'K', 'J', 'WILD', 'Q', '10', 'BELL', 'A', 'SCATTER', 'K', 'SEVEN', 'J', 'Q', 'HORSESHOE', '10', 'A', 'BELL', 'K', 'WILD', 'Q', 'J', 'DIAMOND', '10', 'A', 'SEVEN', 'K', 'BELL', 'HORSESHOE'],
  ],
  lineRows: [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
    [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0],
  ],
  linePays: {
    DIAMOND: [50, 200, 1000],
    SEVEN: [30, 100, 500],
    BELL: [20, 75, 250],
    HORSESHOE: [15, 50, 200],
    A: [10, 30, 125],
    K: [10, 25, 100],
    Q: [5, 20, 100],
    J: [5, 15, 75],
    '10': [5, 10, 50],
  },
  scatterPays: [0, 0, 0, 2, 10, 50],
  freeSpins: 10,
  freeMultiplier: 3,
  trigger: 3,
  published: [
    ['Return to player', '95.3741% (free games included)'],
    ['Base game', '77.5318%'],
    ['Free games', '17.8424%, started 1 in 140.36 paid spins'],
    ['Hit frequency', '44.3851% (1 in 2.25 spins)'],
    ['Standard deviation', '3.78 x the bet per spin'],
  ],
};

export type Machine = typeof SEVENS | typeof WILD | typeof NEON;

export const MACHINES: Readonly<Record<MachineId, Machine>> = { sevens: SEVENS, neon: NEON, wild: WILD };

/** The amount one spin costs: coins x denomination, times the lines on the 5-reel. */
export function betOf(m: Pick<MachineBase<string>, 'lines'>, coins: number, denom: Cents): Cents {
  return m.lines * coins * denom;
}
