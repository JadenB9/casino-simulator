import { it, expect } from 'vitest';
import { engine, type HighCardView } from '../src/games/highcard/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// High Card with ties pushing is a fair game: the edge is exactly 0.
it('highcard has no house edge (Monte Carlo, 3 SE)', () => {
  const n = mcRounds(1_000_000);
  const sim = new TableSim(engine, mcRng(20260922), 'solo', [{ seat: 0, stack: 1e12 }]);
  const tally = new Tally();
  for (let i = 0; i < n; i++) {
    sim.act(0, { type: 'bet', amount: 100 });
    sim.act(0, { type: 'deal' });
    const r = (sim.view(0) as HighCardView).results[0]!;
    tally.add((r.payout - 100) / 100);
  }
  console.log(tally.summary('highcard', 0));
  expect(Math.abs(tally.edge - 0)).toBeLessThanOrEqual(3 * tally.se);
});
