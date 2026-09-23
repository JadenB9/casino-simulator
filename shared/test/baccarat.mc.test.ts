import { it, expect } from 'vitest';
import { engine, type BaccaratState } from '../src/games/baccarat/engine.ts';
import type { BaccaratView } from '../src/games/baccarat/protocol.ts';
import { SPOTS, newTrack, playCoup, settleSpot, type Spot } from '../src/games/baccarat/rules.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// This folder compiles without DOM or Node types.
declare const console: { log(...args: unknown[]): void };

// Published edges, exact (docs/rules/table-games.md §4.4). Unlike blackjack, baccarat shows no
// measurable cut-card effect, so the full-shoe figures are the targets for coups dealt from the
// shoe (burn, cut card 16 from the bottom, one more coup, shuffle).
const PUBLISHED: Record<Spot, number> = {
  banker: 114753351728 / 10847218479825,
  player: 241149546272 / 19524993263685,
  tie: 103841353768 / 723147898655,
  playerPair: 43 / 415,
  bankerPair: 43 / 415,
};

it('baccarat: every bet\'s edge over coups dealt from the shoe (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(10_000_000);
  const rng = mcRng(20260922);
  const track = newTrack();
  const tallies = Object.fromEntries(SPOTS.map((s) => [s, new Tally()])) as Record<Spot, Tally>;
  const stake = 100;
  for (let i = 0; i < n; i++) {
    const { coup } = playCoup(track, rng);
    for (const spot of SPOTS) tallies[spot].add((settleSpot(spot, stake, coup).returned - stake) / stake);
  }
  for (const spot of SPOTS) {
    const t = tallies[spot];
    console.log(t.summary(`baccarat ${spot}`, PUBLISHED[spot]));
    expect(Math.abs(t.edge - PUBLISHED[spot])).toBeLessThanOrEqual(3 * t.se);
  }
});

// The same check through the engine itself (bets, deal, chip moves, the shoe in the table's
// state), fewer coups because every action clones the state the way the host does.
it('baccarat: the engine pays the Banker edge at the table (Monte Carlo, 3 SE)', () => {
  const n = Math.max(1_000, Math.floor(mcRounds(10_000_000) / 100));
  const sim = new TableSim(engine, mcRng(20260923), 'solo', [{ seat: 0, stack: 1e12 }]) as TableSim<BaccaratState, unknown, BaccaratView>;
  const tally = new Tally();
  const bet = 10_000;
  for (let i = 0; i < n; i++) {
    const before = sim.stack(0);
    sim.act(0, { type: 'bet', banker: bet });
    sim.act(0, { type: 'deal' });
    tally.add((sim.stack(0) - before) / bet);
  }
  console.log(tally.summary('baccarat banker (engine)', PUBLISHED.banker));
  expect(Math.abs(tally.edge - PUBLISHED.banker)).toBeLessThanOrEqual(3 * tally.se);
});
