import { it, expect } from 'vitest';
import { openShoe, startRound, decideInsurance, play, legalMoves, current, isBlackjack, type Dealing } from '../src/games/blackjack/rules.ts';
import { basicStrategy } from '../src/games/blackjack/strategy.ts';
import type { Rng } from '../src/rng.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without Node or DOM types.
declare const console: { log(...args: unknown[]): void };

const BET = 100;

interface Counts {
  naturals: number;
  pushes: number;
  surrenders: number;
  splits: number;
  doubles: number;
  /** Net result of each round in units of the bet, keyed by twice the net (so -0.5 and 1.5 are integers). */
  nets: Map<number, number>;
}

/**
 * A uniform integer in [0, n), exactly (Lemire's multiply-shift with rejection): the high 32 bits
 * of x·n, redrawing the few x whose low bits would favour small results. Same guarantee as
 * randInt, without its floating-point modulo on every draw, which dominates a run that
 * reshuffles for every round.
 */
function below(rng: Rng, n: number): number {
  for (;;) {
    const m = rng.next32() * n;
    const hi = Math.floor(m / 4294967296);
    const lo = m - hi * 4294967296;
    if (lo >= n || lo >= 4294967296 % n) return hi;
  }
}

/**
 * One seat, flat $1 bets, the chart deciding every hand, never insurance: the round played
 * through the same rule functions the engine calls. `fresh` deals every round from a newly
 * shuffled shoe; otherwise the shoe runs to the cut card and is reshuffled after that round.
 */
function simulate(n: number, seed: number, fresh: boolean): { tally: Tally; counts: Counts } {
  const rng = mcRng(seed);
  const d: Dealing = { shoe: openShoe(rng), rng, out: null };
  const tally = new Tally();
  const counts: Counts = { naturals: 0, pushes: 0, surrenders: 0, splits: 0, doubles: 0, nets: new Map() };
  const bets = [{ seat: 0, bet: BET }];
  // A fresh shoe for every round only needs its first few cards shuffled: a partial
  // Fisher-Yates over the first PREFIX positions draws them uniformly from all 312, whatever
  // order the rest is in. No single-seat round comes anywhere near 60 cards, and it's checked.
  const PREFIX = 60;
  const deck = d.shoe.cards;
  for (let i = 0; i < n; i++) {
    if (fresh) {
      for (let k = 0; k < PREFIX; k++) {
        const j = k + below(rng, deck.length - k);
        const t = deck[k]!;
        deck[k] = deck[j]!;
        deck[j] = t;
      }
      d.shoe = { cards: deck, pos: 0, cutAt: deck.length, decks: 6 };
    }
    const r = startRound(bets, d);
    if (isBlackjack(r.spots[0]!.hands[0]!)) counts.naturals++;
    if (r.stage === 'insurance') decideInsurance(r, 0, false, d);
    for (let c = current(r); c; c = current(r)) {
      const move = basicStrategy(c.hand.cards, r.dealer[0]!, legalMoves(r, c.spot, c.hand));
      if (move === 'split') counts.splits++;
      else if (move === 'double') counts.doubles++;
      else if (move === 'surrender') counts.surrenders++;
      const fault = play(r, 0, move, d);
      if (fault) throw new Error(`strategy picked an illegal ${move}: ${fault.msg}`);
    }
    if (fresh && d.shoe.pos > PREFIX) throw new Error(`a round used ${d.shoe.pos} cards`);
    const s = r.spots[0]!;
    const net = (s.returned - s.wagered) / BET;
    if (net === 0) counts.pushes++;
    const key = Math.round(net * 2);
    counts.nets.set(key, (counts.nets.get(key) ?? 0) + 1);
    tally.add(net);
  }
  return { tally, counts };
}

function report(label: string, published: number, n: number, { tally, counts }: { tally: Tally; counts: Counts }): void {
  const per = (k: number) => ((100 * k) / n).toFixed(3);
  console.log(tally.summary(label, published));
  console.log(`  per 100 rounds: naturals ${per(counts.naturals)}, pushes ${per(counts.pushes)}, surrenders ${per(counts.surrenders)}, splits ${per(counts.splits)}, doubles ${per(counts.doubles)}`);
}

// The game as the table deals it: a 6-deck shoe to the cut card at 75%. Wizard of Odds
// calculator for exactly these rules (6D, S17, DAS, split to 4, no resplit aces, late
// surrender, peek, 3:2), total-dependent basic strategy dealt to a cut card: 0.3536%, which
// docs/rules/table-games.md §1.2 rounds to 0.354% for this test. SD is about 1.14, so 12 million
// rounds give an SE of about 0.033%.
it('blackjack: basic strategy to a 75% cut card has the published 0.354% edge (Monte Carlo, 3 SE)', () => {
  const PUBLISHED = 0.00354;
  const n = mcRounds(12_000_000);
  const run = simulate(n, 20260922, false);
  report('blackjack 6D S17 DAS LS, basic strategy, cut card at 75%', PUBLISHED, n, run);
  expect(Math.abs(run.tally.edge - PUBLISHED)).toBeLessThanOrEqual(3 * run.tally.se);
});

// The same game with a fresh shoe every round, which is what the reference figures in §1.2 and
// §1.6 were measured on: the continuous-shuffler edge (0.3336%), how often each thing happens,
// and the whole distribution of a round's net result. A settlement bug can move the
// distribution a lot while barely moving the edge, so this is checked bin by bin as well.
it('blackjack: from a fresh shoe every round, the edge, the rates and the net distribution match the reference (Monte Carlo)', () => {
  const PUBLISHED = 0.003336;
  const n = mcRounds(12_000_000);
  const run = simulate(n, 20260923, true);
  report('blackjack 6D S17 DAS LS, basic strategy, fresh shoe every round', PUBLISHED, n, run);
  expect(Math.abs(run.tally.edge - PUBLISHED)).toBeLessThanOrEqual(3 * run.tally.se);

  // §1.6: per round, natural 4.749%, push 8.499145%, surrender 4.47514%; 2.78 splits and 10.38
  // doubles per 100 rounds. `half` is half a unit in the last digit the reference was published
  // to: at a few hundred million rounds, rounding "2.78" is worth several standard errors.
  const z = (count: number, p: number, half: number) => Math.max(0, Math.abs(count / n - p) - half) / Math.sqrt((p * (1 - p)) / n);
  const c = run.counts;
  expect(z(c.naturals, 0.04749, 0.000005)).toBeLessThan(4);
  expect(z(c.pushes, 0.08499145, 0)).toBeLessThan(4);
  expect(z(c.surrenders, 0.0447514, 0)).toBeLessThan(4);
  expect(z(c.splits, 0.0278, 0.00005)).toBeLessThan(4);
  expect(z(c.doubles, 0.1038, 0.00005)).toBeLessThan(4);

  // §1.6 distribution of the net result (keys are twice the net). Tails beyond ±4 units are
  // merged so every bin expects plenty of rounds.
  const REF: [number, number][] = [
    [-16, 0.00000018], [-14, 0.00000236], [-12, 0.00001769], [-10, 0.000089], [-8, 0.00047415], [-6, 0.00201036],
    [-4, 0.04195844], [-2, 0.40160518], [-1, 0.0447514], [0, 0.08499145], [2, 0.31690512], [3, 0.04532153],
    [4, 0.05859757], [6, 0.00236419], [8, 0.00072248], [10, 0.0001445], [12, 0.00003763], [14, 0.00000613], [16, 0.00000066],
  ];
  const bin = (k: number) => (k <= -8 ? -8 : k >= 8 ? 8 : k);
  const expected = new Map<number, number>();
  for (const [k, p] of REF) expected.set(bin(k), (expected.get(bin(k)) ?? 0) + p * n);
  const observed = new Map<number, number>();
  for (const [k, count] of c.nets) {
    expect(expected.has(bin(k)), `a round netted ${k / 2} units, which the reference never saw`).toBe(true);
    observed.set(bin(k), (observed.get(bin(k)) ?? 0) + count);
  }
  let chi2 = 0;
  for (const [k, e] of expected) chi2 += ((observed.get(k) ?? 0) - e) ** 2 / e;
  // 11 bins, 10 degrees of freedom: the 0.1% critical value is 29.6.
  console.log(`  net distribution vs §1.6: chi-square ${chi2.toFixed(1)} on ${expected.size - 1} degrees of freedom`);
  expect(expected.size).toBe(11);
  expect(chi2).toBeLessThan(29.6);
});
