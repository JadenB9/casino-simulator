import { it, expect } from 'vitest';
import { engine, type ThreeCardState } from '../src/games/threecard/engine.ts';
import { dealHands, score, settle, shouldPlay, DEFAULT_PAYTABLE } from '../src/games/threecard/rules.ts';
import type { ThreeCardView } from '../src/games/threecard/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// Published (and enumerated in threecard.test.ts): Ante and Play with the Q-6-4 rule loses
// 13,733,780 / 407,170,400 of an Ante per round; Pair Plus 40-30-6-3-1 loses 1,608 / 22,100.
const ANTE_EDGE = 13_733_780 / 407_170_400;
const PAIR_PLUS_EDGE = 1_608 / 22_100;

// Millions of rounds through the functions the engine deals and settles with.
it('three card poker Ante/Play (Q-6-4) and Pair Plus match the published edges (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(10_000_000);
  const rng = mcRng(20260922);
  const ante = new Tally();
  const pairPlus = new Tally();
  for (let i = 0; i < n; i++) {
    const { hands, dealer } = dealHands(rng, 1);
    const p = score(hands[0]!);
    const play = shouldPlay(p) ? 1 : 0;
    const r = settle({ ante: 1, play, pairPlus: 1 }, p, score(dealer), DEFAULT_PAYTABLE);
    ante.add(r.ante + r.play + r.bonus - 1 - play);
    pairPlus.add(r.pairPlus - 1);
  }
  console.log(ante.summary('threecard ante+play per ante (Q-6-4)', ANTE_EDGE));
  console.log(pairPlus.summary('threecard pair plus 40-30-6-3-1', PAIR_PLUS_EDGE));
  expect(Math.abs(ante.edge - ANTE_EDGE)).toBeLessThanOrEqual(3 * ante.se);
  expect(Math.abs(pairPlus.edge - PAIR_PLUS_EDGE)).toBeLessThanOrEqual(3 * pairPlus.se);
});

// The whole table end to end: bets, the deal, Play/Fold and payouts as chip moves on the stack.
it('three card poker engine, chips and all, lands on the combined edge (Monte Carlo, 3 SE)', () => {
  const n = Math.ceil(mcRounds(10_000_000) / 50);
  const unit = 1_000;
  const sim = new TableSim(engine, mcRng(19780112), 'solo', [{ seat: 0, stack: 1e12 }]) as TableSim<ThreeCardState, unknown, ThreeCardView>;
  const tally = new Tally();
  for (let i = 0; i < n; i++) {
    const before = sim.stack(0);
    sim.act(0, { type: 'bet', ante: unit, pairPlus: unit });
    sim.act(0, { type: 'deal' });
    const cards = sim.view(0).seats[0]!.cards;
    sim.act(0, { type: shouldPlay(score(cards as never)) ? 'play' : 'fold' });
    tally.add((sim.stack(0) - before) / unit);
  }
  const published = ANTE_EDGE + PAIR_PLUS_EDGE;
  console.log(tally.summary('threecard engine ante+play+pair plus per ante', published));
  expect(Math.abs(tally.edge - published)).toBeLessThanOrEqual(3 * tally.se);
  expect(sim.rounds).toHaveLength(n);
});
