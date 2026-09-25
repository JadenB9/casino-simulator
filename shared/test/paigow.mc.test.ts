import { it, expect } from 'vitest';
import { engine, type PaiGowState } from '../src/games/paigow/engine.ts';
import { DEFAULT_FORTUNE, dealHands, houseWay, lowIndexes, settle, type PgCard } from '../src/games/paigow/rules.ts';
import type { PaiGowView } from '../src/games/paigow/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// Published by the Wizard of Odds for player and dealer both setting by the house way: the player
// wins both hands 28.61% of the time, pushes 41.48%, loses 29.91%, so with the 5% commission the
// house keeps 0.2991 - 0.95 x 0.2861 = 2.7305% of the bet. Each figure is rounded to 0.005%, which
// moves the edge by at most 0.0098%: that is added to the allowance below. (His newer exact table,
// for a slightly different house way, is 2.7212%; see docs/rules/table-games.md.)
const WIN = 0.2861;
const PUSH = 0.4148;
const LOSS = 0.2991;
const EDGE = LOSS - 0.95 * WIN;
const ROUNDING = 0.00005 * 1.95;
// The Fortune, enumerated in paigow-fortune.exact.mc.test.ts.
const FORTUNE_EDGE = 11_970_096 / 154_143_080;

it('pai gow poker, house way against house way, matches the published edge and outcomes (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(10_000_000);
  const rng = mcRng(20260926);
  const main = new Tally();
  const fortune = new Tally();
  let win = 0;
  let push = 0;
  for (let i = 0; i < n; i++) {
    const { hands, dealer } = dealHands(rng, 1);
    const seven = hands[0]!;
    const r = settle({ bet: 100, fortune: 100 }, houseWay(seven), houseWay(dealer), seven, DEFAULT_FORTUNE);
    main.add((r.bet - 100) / 100);
    fortune.add((r.fortune - 100) / 100);
    if (r.outcome === 'win') win++;
    else if (r.outcome === 'push') push++;
  }
  console.log(main.summary('pai gow poker, house way, 5% commission', EDGE));
  console.log(fortune.summary('pai gow fortune, pay table 2', FORTUNE_EDGE));
  const loss = n - win - push;
  const se = (p: number) => Math.sqrt((p * (1 - p)) / n);
  console.log(`pai gow outcomes: win ${((win / n) * 100).toFixed(3)}% (${(WIN * 100).toFixed(2)}%), push ${((push / n) * 100).toFixed(3)}% (${(PUSH * 100).toFixed(2)}%), loss ${((loss / n) * 100).toFixed(3)}% (${(LOSS * 100).toFixed(2)}%)`);
  expect(Math.abs(main.edge - EDGE)).toBeLessThanOrEqual(3 * main.se + ROUNDING);
  expect(Math.abs(fortune.edge - FORTUNE_EDGE)).toBeLessThanOrEqual(3 * fortune.se);
  expect(Math.abs(win / n - WIN)).toBeLessThanOrEqual(3 * se(WIN) + 0.00005);
  expect(Math.abs(push / n - PUSH)).toBeLessThanOrEqual(3 * se(PUSH) + 0.00005);
  expect(Math.abs(loss / n - LOSS)).toBeLessThanOrEqual(3 * se(LOSS) + 0.00005);
});

// The whole table end to end: bets, the deal, the player setting by the house way (through the
// action a client sends), the dealer's house way and payouts as chip moves.
it('pai gow poker engine, chips and all, lands on the combined edge (Monte Carlo, 3 SE)', () => {
  const n = Math.ceil(mcRounds(10_000_000) / 50);
  const unit = 1_000;
  const sim = new TableSim(engine, mcRng(19870402), 'solo', [{ seat: 0, stack: 1e12 }]) as TableSim<PaiGowState, unknown, PaiGowView>;
  const tally = new Tally();
  for (let i = 0; i < n; i++) {
    const before = sim.stack(0);
    sim.act(0, { type: 'bet', bet: unit, fortune: unit });
    sim.act(0, { type: 'deal' });
    const seven = sim.view(0).seats[0]!.cards as PgCard[];
    sim.act(0, { type: 'set', low: lowIndexes(seven, houseWay(seven)) });
    tally.add((sim.stack(0) - before) / unit);
  }
  const published = EDGE + FORTUNE_EDGE;
  console.log(tally.summary('pai gow engine, bet and fortune per unit', published));
  expect(Math.abs(tally.edge - published)).toBeLessThanOrEqual(3 * tally.se + ROUNDING);
  expect(sim.rounds).toHaveLength(n);
});
