import { it, expect } from 'vitest';
import type { Shoe } from '../src/cards.ts';
import { engine, type WarState } from '../src/games/war/engine.ts';
import { DEFAULT_RULES, bestChoice, dealRound, dealWar, openShoe, settle, settleDeal, shuffleDue, type Hand } from '../src/games/war/rules.ts';
import type { WarView } from '../src/games/war/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// Three spots from the table's own shoe, dealt as a full table is: a card to each spot and one to
// the dealer, and when spots tie, one war deal (burn three, a card to each spot at war, one to the
// dealer, shared by them all). Each spot's deal against the dealer's card is two cards of the shoe
// whatever the other spots hold, so the chance of a tie (and the Tie bet) are exactly the one-spot
// figures; the only difference sharing a shoe makes is the real card removal when two spots tie at
// once (the war then comes from a shoe short of one more card of the tied rank). The spots share
// the dealer's cards, so the standard error comes from each round's average over its spots.
const WAR_EDGE = 216_571_680 / 9_294_695_280;
const NO_BONUS_EDGE = 267_420_816 / 9_294_695_280;
const SURRENDER_EDGE = 23 / 622;
const TIE_EDGE = 58 / 311;

it('casino war, three spots a round: going to war, surrendering, no bonus and the Tie bet keep their published edges per spot (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(10_000_000);
  const rng = mcRng(20260924);
  const war = new Tally();
  const noBonus = new Tally();
  const surrender = new Tally();
  const tie = new Tally();
  const bets = { bet: 2, tie: 0 };
  const noBonusRules = { ...DEFAULT_RULES, warTiePays: 1 };
  let shoe: Shoe | null = null;
  let multiTies = 0;
  for (let i = 0; i < n; i++) {
    if (shuffleDue(shoe)) shoe = openShoe(rng);
    const { cards, dealer } = dealRound(shoe!, 3);
    const tied: number[] = [];
    let w = 0;
    let nb = 0;
    let su = 0;
    let t = 0;
    cards.forEach((player, spot) => {
      const deal = settleDeal({ bet: 2, tie: 1 }, player, dealer, DEFAULT_RULES);
      t += deal.tie - 1;
      if (deal.bet === null) {
        tied.push(spot);
        return;
      }
      const x = (deal.bet - 2) / 2;
      w += x;
      nb += x;
      su += x;
    });
    if (tied.length > 0) {
      if (tied.length > 1) multiTies++;
      const wd = dealWar(shoe!, tied.length);
      tied.forEach((spot, k) => {
        const player = cards[spot]!;
        const hand: Hand = { player, dealer, choice: 'war', war: { player: wd.cards[k]!, dealer: wd.dealer } };
        const a = settle(bets, hand, DEFAULT_RULES);
        const b = settle(bets, hand, noBonusRules);
        const c = settle(bets, { player, dealer, choice: 'surrender' }, DEFAULT_RULES);
        w += (a.returned - a.wagered) / 2;
        nb += (b.returned - b.wagered) / 2;
        su += (c.returned - c.wagered) / 2;
      });
    }
    war.add(w / 3);
    noBonus.add(nb / 3);
    surrender.add(su / 3);
    tie.add(t / 3);
  }
  console.log(war.summary('casino war 3 spots, always war (tie in the war pays 2 to 1), per spot', WAR_EDGE));
  console.log(noBonus.summary('casino war 3 spots, always war (no bonus), per spot', NO_BONUS_EDGE));
  console.log(surrender.summary('casino war 3 spots, always surrender, per spot', SURRENDER_EDGE));
  console.log(tie.summary('casino war 3 spots, tie bet 10 to 1, per spot', TIE_EDGE));
  console.log(`  ${3 * n} spots in ${n} rounds; ${multiTies} rounds had two or three spots at war at once`);
  for (const [t, published] of [
    [war, WAR_EDGE],
    [noBonus, NO_BONUS_EDGE],
    [surrender, SURRENDER_EDGE],
    [tie, TIE_EDGE],
  ] as const) {
    expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
  }
});

// The whole table end to end: three spots' bets and Tie bets on one stack, the shoe, the wars and
// the payouts as chip moves.
it('casino war engine, three spots on one stack, lands on the combined edge per spot (Monte Carlo, 3 SE)', () => {
  const n = Math.ceil(mcRounds(10_000_000) / 60);
  const unit = 1_000;
  const sim = new TableSim(engine, mcRng(19940512), 'solo', [{ seat: 0, stack: 1e12 }]) as TableSim<WarState, unknown, WarView>;
  sim.act(0, { type: 'spots', n: 3 });
  const tally = new Tally();
  for (let i = 0; i < n; i++) {
    const before = sim.stack(0);
    for (const spot of [0, 1, 2]) sim.act(0, { type: 'bet', bet: unit, tie: unit, spot });
    sim.act(0, { type: 'deal' });
    while ((sim.view(0) as WarView).phase === 'deciding') sim.act(0, { type: bestChoice() });
    tally.add((sim.stack(0) - before) / unit / 3);
  }
  const published = WAR_EDGE + TIE_EDGE;
  console.log(tally.summary('casino war engine, 3 spots, bet + tie bet per bet per spot', published));
  expect(Math.abs(tally.edge - published)).toBeLessThanOrEqual(3 * tally.se);
  expect(sim.rounds).toHaveLength(3 * n);
});
