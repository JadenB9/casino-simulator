// Running mean and standard error for Monte Carlo tests.
//
// Every game's test does the same thing: play N independent rounds, record the net result of
// each in units of the initial wager, and check |measured - published| <= 3 * SD / sqrt(N).
// Seeds are fixed, so a correct engine passes deterministically; `MC_RNG=crypto` reruns on
// the production generator.

import type { Rng } from '../../src/rng.ts';
import { cryptoRng } from '../../src/rng.ts';
import { seededRng } from './seeded.ts';

export class Tally {
  n = 0;
  private mean = 0;
  private m2 = 0;

  /** Add one round's net result (e.g. -1 for a lost unit bet, +1.5 for a blackjack). */
  add(x: number): void {
    this.n++;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    this.m2 += delta * (x - this.mean);
  }

  get average(): number {
    return this.mean;
  }

  get sd(): number {
    return this.n > 1 ? Math.sqrt(this.m2 / (this.n - 1)) : 0;
  }

  /** Standard error of the mean, from the measured SD. */
  get se(): number {
    return this.n > 0 ? this.sd / Math.sqrt(this.n) : Infinity;
  }

  /** House edge as a positive number when the house wins (e.g. 0.00354 for blackjack). */
  get edge(): number {
    return -this.mean;
  }

  summary(label: string, published: number): string {
    const z = (this.edge - published) / this.se;
    return `${label}: n=${this.n} edge=${(this.edge * 100).toFixed(4)}% published=${(published * 100).toFixed(4)}% se=${(this.se * 100).toFixed(4)}% z=${z.toFixed(2)} sd=${this.sd.toFixed(4)}`;
  }
}

/** The generator a Monte Carlo test should use: seeded by default, crypto with MC_RNG=crypto. */
export function mcRng(seed: number): Rng {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.MC_RNG === 'crypto' ? cryptoRng() : seededRng(seed);
}

/** How many rounds to run: MC_ROUNDS overrides (e.g. a quick local check or a long nightly run). */
export function mcRounds(defaultN: number): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const n = Number(env?.MC_ROUNDS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultN;
}

/** Pearson chi-square statistic for observed counts against equal expected counts. */
export function chiSquareUniform(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = total / counts.length;
  return counts.reduce((acc, o) => acc + ((o - expected) ** 2) / expected, 0);
}
