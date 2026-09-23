import { it, expect } from 'vitest';
import { openShoe, startRound, decideInsurance, play, legalMoves, current, isBlackjack, type Dealing } from '../src/games/blackjack/rules.ts';
import { basicStrategy } from '../src/games/blackjack/strategy.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without Node or DOM types.
declare const console: { log(...args: unknown[]): void };

// Wizard of Odds calculator for exactly these rules (6D, S17, DAS, split to 4, no resplit aces,
// late surrender, peek, 3:2), total-dependent basic strategy dealt to a cut card: 0.3536%.
// docs/rules/table-games.md §1.2 says to use 0.354% for one seat dealt to the 75% cut card.
const PUBLISHED = 0.00354;
const BET = 100;

// One seat, flat $1 bets, the chart deciding every hand, never insurance, dealt from a 6-deck
// shoe to the cut card at 75% and reshuffled after that round: the game exactly as the table
// deals it, through the same rule functions the engine calls. SD is about 1.14, so 12 million
// rounds give an SE of about 0.033%.
it('blackjack: basic strategy to a 75% cut card has the published 0.354% edge (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(12_000_000);
  const rng = mcRng(20260922);
  const d: Dealing = { shoe: openShoe(rng), rng, out: null };
  const tally = new Tally();
  const bets = [{ seat: 0, bet: BET }];
  let naturals = 0;
  let surrenders = 0;
  let pushes = 0;
  let splits = 0;
  let doubles = 0;
  for (let i = 0; i < n; i++) {
    const r = startRound(bets, d);
    if (isBlackjack(r.spots[0]!.hands[0]!)) naturals++;
    if (r.stage === 'insurance') decideInsurance(r, 0, false, d);
    for (let c = current(r); c; c = current(r)) {
      const move = basicStrategy(c.hand.cards, r.dealer[0]!, legalMoves(r, c.spot, c.hand));
      if (move === 'split') splits++;
      else if (move === 'double') doubles++;
      else if (move === 'surrender') surrenders++;
      const fault = play(r, 0, move, d);
      if (fault) throw new Error(`strategy picked an illegal ${move}: ${fault.msg}`);
    }
    const s = r.spots[0]!;
    const net = s.returned - s.wagered;
    if (net === 0) pushes++;
    tally.add(net / BET);
  }
  const per = (k: number) => ((100 * k) / n).toFixed(3);
  console.log(tally.summary('blackjack 6D S17 DAS LS, basic strategy, cut card 75%', PUBLISHED));
  console.log(`  per 100 rounds: naturals ${per(naturals)}, pushes ${per(pushes)}, surrenders ${per(surrenders)}, splits ${per(splits)}, doubles ${per(doubles)}`);
  expect(Math.abs(tally.edge - PUBLISHED)).toBeLessThanOrEqual(3 * tally.se);

  // How often each thing happens, against the reference simulation in §1.6 (fresh shoe, 8e9
  // rounds). A bug in the flow can move these a lot while barely moving the edge, so they get
  // their own looser check (5 SE; the cut card shifts them by far less than that).
  const rate = (count: number, published: number) => Math.abs(count / n - published) / Math.sqrt((published * (1 - published)) / n);
  expect(rate(naturals, 0.04749)).toBeLessThan(5);
  expect(rate(pushes, 0.08499)).toBeLessThan(5);
  expect(rate(surrenders, 0.04475)).toBeLessThan(5);
  expect(rate(splits, 0.0278)).toBeLessThan(5);
  expect(rate(doubles, 0.1038)).toBeLessThan(5);
});
