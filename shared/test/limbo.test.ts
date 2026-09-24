import { describe, it, expect } from 'vitest';
import { MIN_TARGET, MAX_TARGET, MIN_RESULT, drawResult, isTarget, wins, winPayout, winChance, targetForChance } from '../src/games/limbo/rules.ts';
import { engine, RECENT, type LimboState, type LimboAction, type LimboView, type LimboEvent } from '../src/games/limbo/engine.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<LimboState, LimboAction, LimboView>;

const TWO_32 = 2n ** 32n;

/** An Rng that returns these words in turn, then `rest` (for U's later digits) forever. */
function words(list: (number | bigint)[], rest = 0x9e3779b9): Rng & { used: () => number } {
  let i = 0;
  return {
    next32: () => (i < list.length ? Number(list[i++]!) : (i++, rest)),
    used: () => i,
  };
}

/** The base-2^32 digits of a k-word integer, most significant first. */
function digits(x: bigint, k: number): bigint[] {
  return Array.from({ length: k }, (_, i) => (x >> (32n * BigInt(k - 1 - i))) & (TWO_32 - 1n));
}

/** The result for U = x / 2^(32k) followed by `rest` digits. */
function resultAt(x: bigint, k: number, rest?: number): number {
  return drawResult(words(digits(x, k), rest));
}

function solo(stack = 1_000_000, rng: Rng = seededRng(31)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]);
}

describe('limbo targets', () => {
  it('runs from 1.01x to 1,000,000x on the two-decimal grid', () => {
    expect(isTarget(MIN_TARGET)).toBe(true);
    expect(isTarget(MAX_TARGET)).toBe(true);
    expect(isTarget(100)).toBe(false);
    expect(isTarget(MAX_TARGET + 1)).toBe(false);
    expect(isTarget(200.5)).toBe(false);
    expect(MIN_TARGET).toBe(101);
    expect(MAX_TARGET).toBe(100_000_000);
  });

  it('wins on a result that reaches the target and pays the target, in whole cents', () => {
    expect(wins(200, 200)).toBe(true);
    expect(wins(199, 200)).toBe(false);
    expect(winPayout(100, 200)).toBe(200);
    expect(winPayout(1_000, 101)).toBe(1_010);
    expect(winPayout(100_000, MAX_TARGET)).toBe(100_000_000_000);
    expect(Number.isSafeInteger(winPayout(100_000, MAX_TARGET))).toBe(true);
  });

  it('turns a win chance into the nearest target and back', () => {
    expect(winChance(200)).toBeCloseTo(0.495, 15);
    expect(targetForChance(49.5)).toBe(200);
    expect(targetForChance(98)).toBe(MIN_TARGET);
    expect(targetForChance(99)).toBe(MIN_TARGET);
    expect(targetForChance(0.0000001)).toBe(MAX_TARGET);
    expect(targetForChance(0)).toBe(MAX_TARGET);
  });
});

describe('limbo result (exact)', () => {
  it('switches at exactly U = 99 / X for every target up to 200.00x', () => {
    // For each X, take the two 64-bit intervals of U either side of 99 / X. Every U just below
    // gives floor(99 / U) = X (a win on X), every U just above gives X - 1 (a loss on X). With R
    // a non-increasing function of U, that puts {R >= X} exactly at {U <= 99 / X}.
    const bad: number[] = [];
    for (let X = MIN_TARGET; X <= 20_000; X++) {
      const a = (99n << 64n) / BigInt(X);
      const below = resultAt(a - 1n, 2);
      const above = resultAt(a + 1n, 2);
      if (below !== X || above !== Math.max(MIN_RESULT, X - 1)) bad.push(X);
    }
    expect(bad).toEqual([]);
  });

  it('switches exactly at 99 / X for large targets too, to the cap', () => {
    const rng = seededRng(5);
    const targets: number[] = [MAX_TARGET, MAX_TARGET - 1, 10_000_000, 1_000_000, 99_999, 100_000, 652_000, 651_999];
    for (let i = 0; i < 3_000; i++) targets.push(20_000 + (rng.next32() % (MAX_TARGET - 20_000)));
    const bad: number[] = [];
    for (const X of targets) {
      // Three words: 2^-96 is far finer than the gap 99 / X^2 between neighbouring boundaries.
      const a = (99n << 96n) / BigInt(X);
      const below = resultAt(a - 1n, 3);
      const above = resultAt(a + 1n, 3);
      if (below !== X || above !== X - 1) bad.push(X);
    }
    expect(bad).toEqual([]);
  });

  it('is 1.00x above U = 0.99 and the cap for U at or below 99 / 10^8', () => {
    const at99 = (99n << 64n) / 100n; // U = 0.99, a little under
    expect(resultAt(at99 + 1n, 2)).toBe(MIN_RESULT);
    expect(resultAt(TWO_32 * TWO_32 - 1n, 2)).toBe(MIN_RESULT);
    expect(resultAt(0n, 1)).toBe(MAX_TARGET);
    expect(resultAt(1n, 1)).toBe(MAX_TARGET);
    const cap = (99n << 64n) / BigInt(MAX_TARGET);
    expect(resultAt(cap - 1n, 2)).toBe(MAX_TARGET);
    expect(resultAt(cap + 1n, 2)).toBe(MAX_TARGET - 1);
  });

  it('falls as U grows, and reads a second word only when the first straddles a boundary', () => {
    const rng = seededRng(77);
    let prev = { u: -1n, r: Infinity };
    const us: bigint[] = [];
    for (let i = 0; i < 20_000; i++) us.push((BigInt(rng.next32()) << 32n) | BigInt(rng.next32()));
    us.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    let second = 0;
    const bad: string[] = [];
    for (const u of us) {
      const src = words(digits(u, 2));
      const r = drawResult(src);
      if (src.used() > 1) second++;
      // One word decides when both ends of its interval floor to the same result.
      const a = u >> 32n;
      const lo = (99n << 32n) / (a + 1n);
      const hi = a === 0n ? BigInt(MAX_TARGET) : (99n << 32n) / a;
      const clampB = (x: bigint) => (x < 100n ? 100 : x > BigInt(MAX_TARGET) ? MAX_TARGET : Number(x));
      if ((src.used() === 1) !== (clampB(lo) === clampB(hi))) bad.push(`words ${u}`);
      if (r > prev.r) bad.push(`order ${u}`);
      prev = { u, r };
    }
    expect(bad).toEqual([]);
    // About 3 draws in 10,000 need the second word.
    expect(second).toBeLessThan(40);
  });

  it('matches a direct floor(99 · 2^64 / U) wherever two words pin it', () => {
    const rng = seededRng(78);
    const bad: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const u = (BigInt(rng.next32()) << 32n) | BigInt(rng.next32());
      const lo = (99n << 64n) / (u + 1n);
      const hi = u === 0n ? lo + 1n : (99n << 64n) / u;
      if (lo !== hi) continue;
      const want = lo < 100n ? 100 : lo > BigInt(MAX_TARGET) ? MAX_TARGET : Number(lo);
      if (resultAt(u, 2) !== want) bad.push(String(u));
    }
    expect(bad).toEqual([]);
  });
});

describe('limbo engine', () => {
  it('takes the bet and pays the target on a win, in one step', () => {
    // Words 2^31, 0, then more: U a hair above 0.5, so 99 / U is a hair under 198 and the result is 1.97x.
    const sim = solo(10_000, words([2 ** 31, 0]));
    sim.act(0, { type: 'bet', bet: 500, target: 150 });
    const ev = sim.lastEvents[0] as LimboEvent;
    expect(ev).toMatchObject({ type: 'result', seat: 0, round: 1, bet: 500, target: 150, result: 197, win: true, payout: 750 });
    expect(ev.stack).toBe(10_000 - 500 + 750);
    expect(sim.stack(0)).toBe(ev.stack);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 500, returned: 750 }]);
  });

  it('takes the bet on a loss and pays nothing', () => {
    const sim = solo(10_000, words([2 ** 31 + 1]));
    sim.act(0, { type: 'bet', bet: 500, target: 200 });
    const ev = sim.lastEvents[0] as LimboEvent;
    expect(ev.result).toBe(197);
    expect(ev.win).toBe(false);
    expect(ev.payout).toBe(0);
    expect(sim.stack(0)).toBe(9_500);
  });

  it('keeps the last bets newest first', () => {
    const sim = solo();
    for (let i = 0; i < RECENT + 2; i++) sim.act(0, { type: 'bet', bet: 100, target: 200 });
    const v = sim.view(0);
    expect(v.recent).toHaveLength(RECENT);
    expect(v.recent[0]!.round).toBe(RECENT + 2);
    for (const b of v.recent) expect(b.payout).toBe(b.win ? 200 : 0);
  });

  it('refuses bad targets, bets off the limits or the dollar, and bets beyond the stack', () => {
    const sim = solo(5_000);
    const refused = (a: object) => sim.act(0, { type: 'bet', bet: 100, target: 200, ...a }, { allowRefusal: true }).refused;
    expect(refused({ target: 100 })).toBe('BAD_REQUEST');
    expect(refused({ target: MAX_TARGET + 1 })).toBe('BAD_REQUEST');
    expect(refused({ bet: 0 })).toBe('LIMIT');
    expect(refused({ bet: 199 })).toBe('LIMIT');
    expect(refused({ bet: 100_100 })).toBe('LIMIT');
    expect(refused({ bet: 5_100 })).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.rounds).toHaveLength(0);
  });

  it('parses only well-formed bets', () => {
    expect(engine.parseAction({ type: 'bet', bet: 100, target: 200 })).toEqual({ type: 'bet', bet: 100, target: 200 });
    expect(engine.parseAction({ type: 'bet', bet: 100, target: 2.5 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', bet: 100 })).toBeNull();
    expect(engine.parseAction({ type: 'roll', bet: 100, target: 200 })).toBeNull();
  });

  it('never leaves chips on the table and never mutates its input', () => {
    const sim = solo();
    const frozen = sim.state;
    const before = structuredClone(frozen);
    sim.act(0, { type: 'bet', bet: 100, target: 1_000 });
    expect(frozen).toEqual(before);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
  });
});
