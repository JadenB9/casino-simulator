// Wheel as data (docs/rules/online-games.md §10): a wheel of 10, 20, 30, 40 or 50 equal segments
// at Low, Medium or High risk, each segment printed with what it pays. The server picks one
// segment uniformly, so a segment comes up with probability 1 / segments and the return is the
// average of the printed multipliers. Every one of the fifteen wheels averages exactly 0.99:
//
//   Low     two segments in ten pay nothing, seven pay 1.20×, one pays 1.50×
//   Medium  half the segments pay nothing; the rest pay 1.50× to 5.00×
//   High    one segment pays 0.99 × segments (9.90× on ten, 49.50× on fifty); the rest nothing
//
// These are the shapes of Stake's Wheel; Medium's 10- to 40-segment layouts are Stake's, and the
// 50-segment one keeps the same colours with the counts that make it 99%.

import { randInt, type Rng } from '../../rng.ts';
import type { Cents } from '../../money.ts';

export const SEGMENTS = [10, 20, 30, 40, 50] as const;
export type Segments = (typeof SEGMENTS)[number];

export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

export const RISK_NAMES: Record<Risk, string> = { low: 'Low', medium: 'Medium', high: 'High' };

const LOW_TEN = [1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0];

/** Medium's paying segments in wheel order; a blank sits between each two. */
const MEDIUM_PAYS: Record<Segments, readonly number[]> = {
  10: [1.9, 1.5, 2, 1.5, 3],
  20: [1.5, 2, 2, 2, 1.5, 3, 1.8, 2, 2, 2],
  30: [1.5, 1.5, 2, 1.5, 2, 2, 1.5, 3, 1.5, 2, 2, 1.7, 4, 1.5, 2],
  40: [2, 3, 2, 1.5, 3, 1.5, 1.5, 2, 1.5, 3, 1.5, 2, 2, 1.6, 2, 1.5, 3, 1.5, 2, 1.5],
  50: [2, 1.5, 3, 1.5, 2, 1.5, 2, 1.5, 1.5, 3, 1.5, 2, 1.5, 2, 1.5, 1.5, 5, 1.5, 2, 1.5, 2, 1.5, 3, 1.5, 2],
};

function printed(risk: Risk, n: Segments): number[] {
  if (risk === 'low') return Array.from({ length: n }, (_, i) => LOW_TEN[i % 10]!);
  if (risk === 'high') return Array.from({ length: n }, (_, i) => (i === 0 ? (99 * n) / 100 : 0));
  // Medium 10 starts on a blank, the others on a paying segment
  const pays = MEDIUM_PAYS[n];
  return Array.from({ length: n }, (_, i) => (n === 10 ? (i % 2 ? pays[(i - 1) / 2]! : 0) : i % 2 ? 0 : pays[i / 2]!));
}

/** Every wheel's segments, clockwise from the top, in hundredths (1.5× is 150). */
export const WHEELS = {} as Record<Risk, Record<Segments, readonly number[]>>;
for (const risk of RISKS) {
  WHEELS[risk] = {} as Record<Segments, readonly number[]>;
  for (const n of SEGMENTS) WHEELS[risk][n] = printed(risk, n).map((m) => Math.round(m * 100));
}

export function isSegments(x: unknown): x is Segments {
  return typeof x === 'number' && (SEGMENTS as readonly number[]).includes(x);
}

export function isRisk(x: unknown): x is Risk {
  return typeof x === 'string' && (RISKS as readonly string[]).includes(x);
}

/** The segment under the pointer: uniform over the wheel. */
export function drawSegment(rng: Rng, n: Segments): number {
  return randInt(rng, n);
}

/** A whole-dollar bet times hundredths is whole cents. */
export function payoutFor(bet: Cents, risk: Risk, n: Segments, segment: number): Cents {
  return (bet / 100) * WHEELS[risk][n][segment]!;
}

/** A wheel's exact return: the sum of its multipliers (hundredths) over 100 × segments. */
export function wheelReturn(risk: Risk, n: Segments): { num: number; den: number } {
  return { num: WHEELS[risk][n].reduce((a, b) => a + b, 0), den: 100 * n };
}

/** Each multiplier on a wheel with how many segments print it, highest first. */
export function wheelTable(risk: Risk, n: Segments): { mult: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const m of WHEELS[risk][n]) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].map(([mult, count]) => ({ mult, count })).sort((a, b) => b.mult - a.mult);
}
