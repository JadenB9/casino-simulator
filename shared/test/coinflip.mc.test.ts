import { describe, it, expect } from 'vitest';
import { flip, streakMult } from '../src/games/coinflip/rules.ts';
import { engine, type CoinflipAction, type CoinflipState, type CoinflipView } from '../src/games/coinflip/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// Rounds from the engine's own flip(), each settled against four plans: cash out after 1, 3, 6
// and 10 right calls. Every stop returns exactly 99% (docs/rules/online-games.md §9), so each
// tally must land within 3 SE of a 1% edge.

const STOPS = [1, 3, 6, 10];

describe('coinflip (Monte Carlo)', () => {
  it('returns 99% at every stop', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260925);
    const tallies = STOPS.map(() => new Tally());
    for (let i = 0; i < n; i++) {
      // right calls in a row before the first miss, up to the longest stop
      let run = 0;
      while (run < STOPS.at(-1)! && flip(rng) === 'heads') run++;
      STOPS.forEach((k, j) => tallies[j]!.add(run >= k ? streakMult(k) / 100 - 1 : -1));
    }
    STOPS.forEach((k, j) => {
      const t = tallies[j]!;
      console.log(t.summary(`coinflip cash out after ${k} (${(streakMult(k) / 100).toFixed(2)}×)`, 0.01));
      expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
    });
  });

  it('matches through the whole engine (bet, calls, cash out, chip moves)', () => {
    const n = mcRounds(300_000);
    const sim = new TableSim<CoinflipState, CoinflipAction, CoinflipView>(engine, mcRng(20260926), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'bet', amount: 100, side: i % 2 ? 'heads' : 'tails' });
      while (sim.state.phase === 'playing' && sim.view(0).streak < 2) sim.act(0, { type: 'flip', side: 'tails' });
      if (sim.state.phase === 'playing') sim.act(0, { type: 'cashout' });
      t.add((sim.stack(0) - before) / 100);
    }
    expect(sim.rounds).toHaveLength(n);
    console.log(t.summary('coinflip engine, cash out after 2', 0.01));
    expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
  });
});
