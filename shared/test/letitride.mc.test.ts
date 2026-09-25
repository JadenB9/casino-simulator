import { it, expect } from 'vitest';
import { engine, type LetItRideState } from '../src/games/letitride/engine.ts';
import { DEFAULT_PAYTABLE, dealHands, rideFirst, rideSecond, settle } from '../src/games/letitride/rules.ts';
import type { Card } from '../src/cards.ts';
import type { LetItRideView } from '../src/games/letitride/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// Published and enumerated exactly in letitride-exact.test.ts: the three bets played by the
// pull-back strategy lose 1,822,224 / 51,979,200 of a unit per hand; the 3-Card Bonus
// 50-40-30-6-3-1 loses 1,568 / 22,100.
const EDGE = 1_822_224 / 51_979_200;
const BONUS_EDGE = 1_568 / 22_100;

// Millions of hands through the functions the engine deals and settles with.
it('let it ride (pull-back strategy) and the 3-Card Bonus match the published edges (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(10_000_000);
  const rng = mcRng(20260925);
  const main = new Tally();
  const bonus = new Tally();
  for (let i = 0; i < n; i++) {
    const { hands, board } = dealHands(rng, 1);
    const three = hands[0]!;
    const pulled: [boolean, boolean] = [!rideFirst(three), !rideSecond([...three, board[0]!])];
    const r = settle(1, pulled, 1, [...three, ...board], DEFAULT_PAYTABLE);
    main.add(r.bets[0] + r.bets[1] + r.bets[2] - (r.wagered - 1));
    bonus.add(r.bonus - 1);
  }
  console.log(main.summary('let it ride per unit (pull-back strategy)', EDGE));
  console.log(bonus.summary('let it ride 3-card bonus 50-40-30-6-3-1', BONUS_EDGE));
  expect(Math.abs(main.edge - EDGE)).toBeLessThanOrEqual(3 * main.se);
  expect(Math.abs(bonus.edge - BONUS_EDGE)).toBeLessThanOrEqual(3 * bonus.se);
});

// The whole table end to end: bets, the deal, both decisions and payouts as chip moves.
it('let it ride engine, chips and all, lands on the combined edge (Monte Carlo, 3 SE)', () => {
  const n = Math.ceil(mcRounds(10_000_000) / 50);
  const unit = 1_000;
  const sim = new TableSim(engine, mcRng(19850311), 'solo', [{ seat: 0, stack: 1e12 }]) as TableSim<LetItRideState, unknown, LetItRideView>;
  const tally = new Tally();
  for (let i = 0; i < n; i++) {
    const before = sim.stack(0);
    sim.act(0, { type: 'bet', unit, bonus: unit });
    sim.act(0, { type: 'deal' });
    const three = sim.view(0).seats[0]!.cards as Card[];
    sim.act(0, { type: rideFirst(three) ? 'ride' : 'pull' });
    const first = sim.view(0).board[0] as Card;
    sim.act(0, { type: rideSecond([...three, first]) ? 'ride' : 'pull' });
    tally.add((sim.stack(0) - before) / unit);
  }
  const published = EDGE + BONUS_EDGE;
  console.log(tally.summary('let it ride engine, bets and bonus per unit', published));
  expect(Math.abs(tally.edge - published)).toBeLessThanOrEqual(3 * tally.se);
  expect(sim.rounds).toHaveLength(n);
});

// Three hands a round against one board, as a solo player can play: each hand is still a hand of
// Let It Ride, so the edge per hand is the same. The hands share the board, so the standard error
// comes from each round's average over its hands.
it('let it ride on three hands from one deck keeps the edge per hand (Monte Carlo, 3 SE)', () => {
  const n = Math.ceil(mcRounds(10_000_000) / 3);
  const rng = mcRng(4102);
  const perRound = new Tally();
  for (let i = 0; i < n; i++) {
    const { hands, board } = dealHands(rng, 3);
    let net = 0;
    for (const three of hands) {
      const pulled: [boolean, boolean] = [!rideFirst(three), !rideSecond([...three, board[0]!])];
      const r = settle(1, pulled, 0, [...three, ...board], DEFAULT_PAYTABLE);
      net += r.returned - r.wagered;
    }
    perRound.add(net / 3);
  }
  console.log(perRound.summary('let it ride, three hands a round, per hand', EDGE));
  expect(Math.abs(perRound.edge - EDGE)).toBeLessThanOrEqual(3 * perRound.se);
});
