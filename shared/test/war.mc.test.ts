import { it, expect } from 'vitest';
import type { Shoe } from '../src/cards.ts';
import { engine, type WarState } from '../src/games/war/engine.ts';
import { DEFAULT_RULES, bestChoice, dealRound, dealWar, openShoe, settle, settleDeal, shuffleDue, type Hand } from '../src/games/war/rules.ts';
import type { WarView } from '../src/games/war/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// Published by Wizard of Odds for six decks and enumerated exactly in war.test.ts, per unit bet:
// always going to war with the raise paying 2 to 1 on a tie in the war loses
// 216,571,680 / 9,294,695,280 (2.33%); with no bonus 267,420,816 / 9,294,695,280 (2.88%);
// always surrendering 23/622 (3.70%); the Tie bet at 10 to 1 58/311 (18.65%).
const WAR_EDGE = 216_571_680 / 9_294_695_280;
const NO_BONUS_EDGE = 267_420_816 / 9_294_695_280;
const SURRENDER_EDGE = 23 / 622;
const TIE_EDGE = 58 / 311;

// Millions of rounds dealt from the table's own shoe: six decks, the cover card a quarter from the
// bottom, a burn after each shuffle and three before each war, exactly as the engine deals them.
// The table goes to war on every tie; the surrender and no-bonus figures settle the same deals the
// other way, which needs no extra cards.
it('casino war: going to war, surrendering, no bonus and the Tie bet match the published edges (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(10_000_000);
  const rng = mcRng(20260923);
  const war = new Tally();
  const noBonus = new Tally();
  const surrender = new Tally();
  const tie = new Tally();
  const bets = { bet: 2, tie: 0 };
  const noBonusRules = { ...DEFAULT_RULES, warTiePays: 1 };
  let shoe: Shoe | null = null;
  for (let i = 0; i < n; i++) {
    if (shuffleDue(shoe)) shoe = openShoe(rng);
    const { cards, dealer } = dealRound(shoe!, 1);
    const player = cards[0]!;
    const deal = settleDeal({ bet: 2, tie: 1 }, player, dealer, DEFAULT_RULES);
    tie.add(deal.tie - 1);
    if (deal.bet !== null) {
      const x = (deal.bet - 2) / 2;
      war.add(x);
      noBonus.add(x);
      surrender.add(x);
      continue;
    }
    const w = dealWar(shoe!, 1);
    const hand: Hand = { player, dealer, choice: 'war', war: { player: w.cards[0]!, dealer: w.dealer } };
    const a = settle(bets, hand, DEFAULT_RULES);
    const b = settle(bets, hand, noBonusRules);
    const c = settle(bets, { player, dealer, choice: 'surrender' }, DEFAULT_RULES);
    war.add((a.returned - a.wagered) / 2);
    noBonus.add((b.returned - b.wagered) / 2);
    surrender.add((c.returned - c.wagered) / 2);
  }
  console.log(war.summary('casino war, always war (tie in the war pays 2 to 1)', WAR_EDGE));
  console.log(noBonus.summary('casino war, always war (no bonus)', NO_BONUS_EDGE));
  console.log(surrender.summary('casino war, always surrender', SURRENDER_EDGE));
  console.log(tie.summary('casino war, tie bet 10 to 1', TIE_EDGE));
  for (const [t, published] of [
    [war, WAR_EDGE],
    [noBonus, NO_BONUS_EDGE],
    [surrender, SURRENDER_EDGE],
    [tie, TIE_EDGE],
  ] as const) {
    expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
  }
});

// The whole table end to end: bets, the shoe, the war and payouts as chip moves on the stack.
it('casino war engine, chips and all, lands on the combined edge (Monte Carlo, 3 SE)', () => {
  const n = Math.ceil(mcRounds(10_000_000) / 50);
  const unit = 1_000;
  const sim = new TableSim(engine, mcRng(19940511), 'solo', [{ seat: 0, stack: 1e12 }]) as TableSim<WarState, unknown, WarView>;
  const tally = new Tally();
  for (let i = 0; i < n; i++) {
    const before = sim.stack(0);
    sim.act(0, { type: 'bet', bet: unit, tie: unit });
    sim.act(0, { type: 'deal' });
    if ((sim.view(0) as WarView).phase === 'deciding') sim.act(0, { type: bestChoice() });
    tally.add((sim.stack(0) - before) / unit);
  }
  const published = WAR_EDGE + TIE_EDGE;
  console.log(tally.summary('casino war engine, bet + tie bet per bet', published));
  expect(Math.abs(tally.edge - published)).toBeLessThanOrEqual(3 * tally.se);
  expect(sim.rounds).toHaveLength(n);
});
