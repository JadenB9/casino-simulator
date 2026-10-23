// What the board over a wheel shows from its log: how the colours have split, the numbers that
// have come up most (hot) and the ones that have come up least, longest ago (cold). Every spin is
// a fresh draw, so these say what happened, never what will: the board says so too. Pure, so the
// tests can check it.

import { WHEEL, type Variant, colorOf } from '../../../../shared/src/games/roulette/rules.ts';

export interface WheelStats {
  spins: number;
  red: number;
  black: number;
  green: number;
  /** Up to `take` numbers seen at least twice, most often first (the latest first on a tie). */
  hot: { n: number; count: number }[];
  /** Up to `take` numbers seen least often, the longest gone first. */
  cold: { n: number; count: number }[];
}

/** Stats over `log` (newest first). */
export function wheelStats(v: Variant, log: readonly number[], take = 4): WheelStats {
  const count = new Map<number, number>();
  const last = new Map<number, number>();
  let red = 0;
  let black = 0;
  let green = 0;
  log.forEach((n, i) => {
    count.set(n, (count.get(n) ?? 0) + 1);
    if (!last.has(n)) last.set(n, i);
    const c = colorOf(n);
    if (c === 'red') red++;
    else if (c === 'black') black++;
    else green++;
  });
  const pockets = [...WHEEL[v]];
  const seen = (n: number) => count.get(n) ?? 0;
  // never seen counts as gone the longest
  const since = (n: number) => last.get(n) ?? Infinity;
  const hot = pockets
    .filter((n) => seen(n) >= 2)
    .sort((a, b) => seen(b) - seen(a) || since(a) - since(b) || a - b)
    .slice(0, take)
    .map((n) => ({ n, count: seen(n) }));
  const cold = log.length === 0 ? [] : pockets
    .sort((a, b) => seen(a) - seen(b) || since(b) - since(a) || a - b)
    .slice(0, take)
    .map((n) => ({ n, count: seen(n) }));
  return { spins: log.length, red, black, green, hot, cold };
}

/** Each colour's share in whole percent, adding up to 100 (the points left by rounding down go to the largest remainders). */
export function shares(s: Pick<WheelStats, 'red' | 'black' | 'green'>): { red: number; black: number; green: number } {
  const counts = [s.red, s.black, s.green];
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return { red: 0, black: 0, green: 0 };
  const raw = counts.map((c) => (c / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  for (const i of [0, 1, 2].sort((a, b) => raw[b]! - out[b]! - (raw[a]! - out[a]!))) {
    if (left <= 0) break;
    out[i] = out[i]! + 1;
    left--;
  }
  return { red: out[0]!, black: out[1]!, green: out[2]! };
}
