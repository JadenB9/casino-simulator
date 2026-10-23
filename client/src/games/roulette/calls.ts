// The racetrack's bets: a number and its neighbours on the wheel, and on the single-zero wheel the
// four French called bets. None of them is a bet of its own on the server: each is the ordinary
// straight, split, street and corner chips a dealer puts down for it, sent as one placement, so
// they pay exactly what those chips pay and Undo takes the whole call back at once.
// Pure data and arithmetic (no DOM, no three.js); client/test/roulette-calls.test.ts checks every
// piece is a real spot on its layout and covers exactly the numbers the call is named for.

import { WHEEL, type Variant, spotByKey, numbersLabel } from '../../../../shared/src/games/roulette/rules.ts';
import { formatMoney, type BetLimits, type Cents } from '../../../../shared/src/money.ts';
import type { BetInput } from '../../../../shared/src/games/roulette/protocol.ts';

/** One chip (or `units` chips) on one spot of the layout. */
export interface Piece {
  key: string;
  units: number;
}

export type CallId = 'voisins' | 'tiers' | 'orphelins' | 'zero';

export interface Call {
  id: CallId;
  /** As the dealer calls it, and as the track prints it. */
  name: string;
  short: string;
  /** The numbers it covers, in wheel order. */
  numbers: number[];
  pieces: Piece[];
}

/** The pockets from `k` before `n` to `k` after it, in the wheel's clockwise order. */
export function neighbours(v: Variant, n: number, k: number): number[] {
  const order = WHEEL[v];
  const i = order.indexOf(n);
  if (i < 0) return [];
  const span = Math.max(0, Math.min(Math.floor((order.length - 1) / 2), k));
  const out: number[] = [];
  for (let d = -span; d <= span; d++) out.push(order[(i + d + order.length) % order.length]!);
  return out;
}

/** A neighbours bet: one chip straight up on each number. */
export function neighbourPieces(v: Variant, n: number, k: number): Piece[] {
  return neighbours(v, n, k).map((p) => ({ key: `straight:${p}`, units: 1 }));
}

/** The arc of the single-zero wheel from `from` to `to`, clockwise, both included. */
function arc(from: number, to: number): number[] {
  const order = WHEEL.european;
  const out: number[] = [];
  for (let i = order.indexOf(from); ; i = (i + 1) % order.length) {
    out.push(order[i]!);
    if (order[i] === to) return out;
  }
}

/**
 * The called bets as the French layout deals them (the zero's neighbours, the third of the wheel
 * opposite it, the orphans between, and the zero game), each with its usual chips.
 */
const CALLS: readonly Call[] = [
  {
    id: 'voisins',
    name: 'Voisins du zéro',
    short: 'Voisins',
    numbers: arc(22, 25),
    pieces: [
      { key: 'street:0-2-3', units: 2 },
      { key: 'split:4-7', units: 1 },
      { key: 'split:12-15', units: 1 },
      { key: 'split:18-21', units: 1 },
      { key: 'split:19-22', units: 1 },
      { key: 'corner:25-26-28-29', units: 2 },
      { key: 'split:32-35', units: 1 },
    ],
  },
  {
    id: 'tiers',
    name: 'Tiers du cylindre',
    short: 'Tiers',
    numbers: arc(27, 33),
    pieces: ['5-8', '10-11', '13-16', '23-24', '27-30', '33-36'].map((s) => ({ key: `split:${s}`, units: 1 })),
  },
  {
    id: 'orphelins',
    name: 'Orphelins',
    short: 'Orphelins',
    numbers: [...arc(17, 6), ...arc(1, 9)],
    pieces: [
      { key: 'straight:1', units: 1 },
      { key: 'split:6-9', units: 1 },
      { key: 'split:14-17', units: 1 },
      { key: 'split:17-20', units: 1 },
      { key: 'split:31-34', units: 1 },
    ],
  },
  {
    id: 'zero',
    name: 'Jeu zéro',
    short: 'Zéro',
    numbers: arc(12, 15),
    pieces: [
      { key: 'split:0-3', units: 1 },
      { key: 'split:12-15', units: 1 },
      { key: 'straight:26', units: 1 },
      { key: 'split:32-35', units: 1 },
    ],
  },
];

/** The called bets this wheel's racetrack offers: the four French ones on a single zero, none on a double. */
export function callsFor(v: Variant): readonly Call[] {
  return v === 'european' ? CALLS : [];
}

export function callOf(v: Variant, id: CallId): Call | null {
  return callsFor(v).find((c) => c.id === id) ?? null;
}

/** Every number a set of pieces covers, each once, in the wheel's order. */
export function coveredBy(v: Variant, pieces: readonly Piece[]): number[] {
  const set = new Set<number>();
  for (const p of pieces) for (const n of spotByKey(v, p.key)?.numbers ?? []) set.add(n);
  return WHEEL[v].filter((n) => set.has(n));
}

export function unitsOf(pieces: readonly Piece[]): number {
  return pieces.reduce((a, p) => a + p.units, 0);
}

/**
 * What a call costs at `unit` a chip and the chips it sends, or why it can't go down: a chip
 * under the inside minimum is raised to it (as a single chip on the layout is), and the call
 * must fit each spot's maximum with what is already there, the table's maximum a spin, and the
 * chips in front of the player. The server checks all of it again.
 */
export function placeCall(
  v: Variant,
  pieces: readonly Piece[],
  unit: Cents,
  ctx: { inside: BetLimits; tableMax: Cents; bets: Record<string, Cents>; stack: Cents },
): { bets: BetInput[]; total: Cents } | { refusal: string } {
  const { inside } = ctx;
  // whole chips of the spot's step, never under its minimum
  const chip = Math.max(inside.min, Math.ceil(unit / inside.step) * inside.step);
  const adds = new Map<string, Cents>();
  for (const p of pieces) adds.set(p.key, (adds.get(p.key) ?? 0) + chip * p.units);
  let total = 0;
  const bets: BetInput[] = [];
  for (const [key, amount] of adds) {
    const spot = spotByKey(v, key);
    if (!spot) return { refusal: "That isn't a bet on this layout." };
    if ((ctx.bets[key] ?? 0) + amount > inside.max) return { refusal: `${numbersLabel(spot.numbers)} would go over the ${formatMoney(inside.max)} inside maximum.` };
    total += amount;
    bets.push({ kind: spot.kind, numbers: [...spot.numbers], amount });
  }
  const down = Object.values(ctx.bets).reduce((a, b) => a + b, 0);
  if (down + total > ctx.tableMax) return { refusal: `The table maximum is ${formatMoney(ctx.tableMax)} a spin.` };
  if (total > ctx.stack) return { refusal: `That call is ${formatMoney(total)}, more than your stack.` };
  return { bets, total };
}
