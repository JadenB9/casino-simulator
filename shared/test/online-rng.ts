// Scripted generators for the online games' tests: a queue of raw next32 values played first
// (randInt(rng, n) returns a queued value v < n as it is), and the draws that make drawCrash come
// out on a chosen crash point, for tests that need a particular flight (the unit tests and the
// worker's two-player rounds).

import type { Rng } from '../src/rng.ts';
import { CAP, splitOdds } from '../src/games/crash/rules.ts';
import { seededRng } from './helpers/seeded.ts';

const TWO_32 = 2 ** 32;

/**
 * The next32 values that make drawCrash(rng, cap) return exactly `c` (hundredths): each of the
 * sampler's coins gets the lowest draw (the multiplier goes on past mid) or the highest (it
 * crashes at or below mid), steering the bisection onto `c`.
 */
export function forcedCrash(c: number, cap = CAP): number[] {
  if (c < 100 || c > cap || !Number.isInteger(c)) throw new RangeError(`forcedCrash: ${c}`);
  // randInt(rng, 100): 99 ends the round at 1.00×, 0 lets it fly
  if (c === 100) return [99];
  const seq = [0];
  let lo = 100;
  let hi = cap;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const [, den] = splitOdds(lo, hi, mid, cap);
    const up = c > mid;
    const x = up ? 0 : den - 1;
    if (den <= TWO_32) seq.push(x);
    else seq.push(((Math.floor(x / TWO_32) << 11) >>> 0), x % TWO_32);
    if (up) lo = mid;
    else hi = mid;
  }
  return seq;
}

/** A generator that plays `queue` first (push more onto it at any time), then a seeded stream. */
export function queuedRng(queue: number[] = [], seed = 1): Rng & { queue: number[] } {
  const base = seededRng(seed);
  return {
    queue,
    next32() {
      return this.queue.length ? this.queue.shift()! : base.next32();
    },
  };
}
