import { it, expect } from 'vitest';
import { openShoe, startRound, decideInsurance, play, legalMoves, current, type Dealing } from '../src/games/blackjack/rules.ts';
import { basicStrategy } from '../src/games/blackjack/strategy.ts';
import type { Rng } from '../src/rng.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without Node or DOM types.
declare const console: { log(...args: unknown[]): void };

// One player on several spots: every spot is a hand of its own, played by the chart, dealt round
// the table from the same shoe as a full table would be. Each hand plays by exactly the same rules,
// so the edge per hand is the published one; the only thing sharing a shoe can change is the real
// card-removal effect of the other hands' cards, which these runs measure along with it.
//
// The hands of one round share the dealer's cards, so they are not independent: a dealer bust wins
// them all. The standard error therefore comes from each round's average over its hands (one
// number per round, and rounds are independent), not from the hands as if they were separate.

const BET = 100;

function below(rng: Rng, n: number): number {
  for (;;) {
    const m = rng.next32() * n;
    const hi = Math.floor(m / 4294967296);
    const lo = m - hi * 4294967296;
    if (lo >= n || lo >= 4294967296 % n) return hi;
  }
}

/**
 * `rounds` rounds of `spots` hands, flat $1 on each, the chart deciding every hand, never
 * insurance. `fresh` deals every round from a newly shuffled shoe, exactly as the table deals (its
 * continuous shuffler); otherwise the shoe runs to a cut card at 75%, the shoe game for reference.
 */
function simulate(rounds: number, spots: number, seed: number, fresh: boolean): { perRound: Tally; perHand: Tally } {
  const rng = mcRng(seed);
  const d: Dealing = { shoe: openShoe(rng), rng, out: null };
  const perRound = new Tally();
  const perHand = new Tally();
  const bets = Array.from({ length: spots }, (_, seat) => ({ seat, bet: BET }));
  // A fresh shoe only needs its first cards shuffled (see blackjack.mc.test.ts); a round of five
  // spots stays far inside this many, and it's checked.
  const PREFIX = 60 + 25 * spots;
  const deck = d.shoe.cards;
  for (let i = 0; i < rounds; i++) {
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
    if (r.stage === 'insurance') for (const s of r.spots) if (r.stage === 'insurance') decideInsurance(r, s.seat, false, d);
    for (let c = current(r); c; c = current(r)) {
      const fault = play(r, c.spot.seat, basicStrategy(c.hand.cards, r.dealer[0]!, legalMoves(r, c.spot, c.hand)), d);
      if (fault) throw new Error(`strategy picked an illegal move: ${fault.msg}`);
    }
    if (fresh && d.shoe.pos > PREFIX) throw new Error(`a round used ${d.shoe.pos} cards`);
    let sum = 0;
    for (const s of r.spots) {
      const net = (s.returned - s.wagered) / BET;
      perHand.add(net);
      sum += net;
    }
    perRound.add(sum / spots);
  }
  return { perRound, perHand };
}

function report(label: string, published: number, spots: number, run: { perRound: Tally; perHand: Tally }): void {
  console.log(run.perRound.summary(`${label} (per hand, SE from per-round means)`, published));
  console.log(`  ${run.perHand.n} hands in ${run.perRound.n} rounds of ${spots}; per-hand SD ${run.perHand.sd.toFixed(4)}, per-round-mean SD ${run.perRound.sd.toFixed(4)}`);
}

// The published figures are the single-spot ones from docs/rules/table-games.md §1.2: 0.3336% from a
// fresh shoe, as the table deals (a continuous shuffler), and 0.354% to a cut card, for reference.
it('blackjack, three spots: from a fresh shoe every round the edge per hand is the published 0.3336% (Monte Carlo, 3 SE)', () => {
  const PUBLISHED = 0.003336;
  const n = mcRounds(12_000_000);
  const run = simulate(n, 3, 20260925, true);
  report('blackjack 3 spots, 6D S17 DAS LS, basic strategy, fresh shoe every round', PUBLISHED, 3, run);
  expect(Math.abs(run.perRound.edge - PUBLISHED)).toBeLessThanOrEqual(3 * run.perRound.se);
});

it('blackjack, five spots (a whole solo row): from a fresh shoe every round the edge per hand is the published 0.3336% (Monte Carlo, 3 SE)', () => {
  const PUBLISHED = 0.003336;
  const n = mcRounds(12_000_000) / 2;
  const run = simulate(n, 5, 20260926, true);
  report('blackjack 5 spots, 6D S17 DAS LS, basic strategy, fresh shoe every round', PUBLISHED, 5, run);
  expect(Math.abs(run.perRound.edge - PUBLISHED)).toBeLessThanOrEqual(3 * run.perRound.se);
});

it('blackjack, three spots, for reference: a shoe dealt to a 75% cut card keeps 0.354% per hand (Monte Carlo, 3 SE)', () => {
  const PUBLISHED = 0.00354;
  const n = mcRounds(12_000_000);
  const run = simulate(n, 3, 20260924, false);
  report('blackjack 3 spots, 6D S17 DAS LS, basic strategy, cut card at 75% (reference)', PUBLISHED, 3, run);
  expect(Math.abs(run.perRound.edge - PUBLISHED)).toBeLessThanOrEqual(3 * run.perRound.se);
});
