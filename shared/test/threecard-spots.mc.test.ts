import { it, expect } from 'vitest';
import { engine, type ThreeCardState } from '../src/games/threecard/engine.ts';
import { dealHands, score, settle, shouldPlay, DEFAULT_PAYTABLE } from '../src/games/threecard/rules.ts';
import type { ThreeCardView } from '../src/games/threecard/protocol.ts';
import type { Card } from '../src/cards.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// Three hands from one deck against one dealer hand. Every hand's three cards and the dealer's are
// a uniformly random pick from the deck whatever the other hands hold, and each hand's Play or Fold
// looks at its own cards only, so the other hands are cards nobody looks at: the edge per hand is
// exactly the one-hand edge. The hands share the dealer, so the standard error comes from each
// round's average over its hands, not from the hands as if they were independent.
const ANTE_EDGE = 13_733_780 / 407_170_400;
const PAIR_PLUS_EDGE = 1_608 / 22_100;

it('three card poker, three hands a round: Ante/Play (Q-6-4) and Pair Plus keep their published edges per hand (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(10_000_000);
  const rng = mcRng(20260924);
  const ante = new Tally();
  const pairPlus = new Tally();
  for (let i = 0; i < n; i++) {
    const { hands, dealer } = dealHands(rng, 3);
    const d = score(dealer);
    let a = 0;
    let pp = 0;
    for (const h of hands) {
      const p = score(h);
      const play = shouldPlay(p) ? 1 : 0;
      const r = settle({ ante: 1, play, pairPlus: 1 }, p, d, DEFAULT_PAYTABLE);
      a += r.ante + r.play + r.bonus - 1 - play;
      pp += r.pairPlus - 1;
    }
    ante.add(a / 3);
    pairPlus.add(pp / 3);
  }
  console.log(ante.summary('threecard 3 hands, ante+play per ante per hand (Q-6-4)', ANTE_EDGE));
  console.log(pairPlus.summary('threecard 3 hands, pair plus 40-30-6-3-1 per hand', PAIR_PLUS_EDGE));
  expect(Math.abs(ante.edge - ANTE_EDGE)).toBeLessThanOrEqual(3 * ante.se);
  expect(Math.abs(pairPlus.edge - PAIR_PLUS_EDGE)).toBeLessThanOrEqual(3 * pairPlus.se);
});

// The whole table end to end: three hands' bets, the deal, a Play or Fold on each and the payouts
// as chip moves on the one stack.
it('three card poker engine, three hands on one stack, lands on the combined edge per hand (Monte Carlo, 3 SE)', () => {
  const n = Math.ceil(mcRounds(10_000_000) / 60);
  const unit = 1_000;
  const sim = new TableSim(engine, mcRng(19780113), 'solo', [{ seat: 0, stack: 1e12 }]) as TableSim<ThreeCardState, unknown, ThreeCardView>;
  sim.act(0, { type: 'spots', n: 3 });
  const tally = new Tally();
  for (let i = 0; i < n; i++) {
    const before = sim.stack(0);
    for (const spot of [0, 1, 2]) sim.act(0, { type: 'bet', ante: unit, pairPlus: unit, spot });
    sim.act(0, { type: 'deal' });
    for (const spot of [0, 1, 2]) sim.act(0, { type: shouldPlay(score(sim.view(0).seats[spot]!.cards as Card[])) ? 'play' : 'fold', spot });
    tally.add((sim.stack(0) - before) / unit / 3);
  }
  const published = ANTE_EDGE + PAIR_PLUS_EDGE;
  console.log(tally.summary('threecard engine, 3 hands, ante+play+pair plus per ante per hand', published));
  expect(Math.abs(tally.edge - published)).toBeLessThanOrEqual(3 * tally.se);
  expect(sim.rounds).toHaveLength(3 * n);
});
