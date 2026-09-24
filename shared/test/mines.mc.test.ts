import { describe, it, expect } from 'vitest';
import { drawField, returnAt, multiplier } from '../src/games/mines/rules.ts';
import { engine, type MinesAction, type MinesState, type MinesView } from '../src/games/mines/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// One trial = one board from drawField (the engine's own), turned over in tile order 0, 1, 2...
// Its mines come back sorted, so the gems found before the first mine are exactly field[0], and a
// cash-out after k gems pays multiplier(m, k) (the engine's own table) when field[0] ≥ k.
// Published: the exact return of each (mines, gems) cell (docs/rules/online-games-b.md §2.3).

const PLAN: [mines: number, gems: number[]][] = [
  [1, [5, 24]],
  [3, [1, 5, 10]],
  [5, [3, 8]],
  [10, [2, 5]],
  [24, [1]],
];

const edge = (m: number, k: number) => {
  const r = returnAt(m, k);
  return 1 - r.num / r.den;
};

describe('mines (Monte Carlo)', () => {
  it('lands within 3 SE of the exact return on every cell in the plan', () => {
    const n = mcRounds(4_000_000);
    const rng = mcRng(20260927);
    for (const [m, ks] of PLAN) {
      const tallies = ks.map(() => new Tally());
      for (let i = 0; i < n; i++) {
        const first = drawField(rng, m)[0]!;
        ks.forEach((k, j) => tallies[j]!.add(first >= k ? multiplier(m, k) / 100 - 1 : -1));
      }
      ks.forEach((k, j) => {
        const t = tallies[j]!;
        console.log(t.summary(`mines ${m} mine${m > 1 ? 's' : ''}, cash out after ${k} gem${k > 1 ? 's' : ''} (${(multiplier(m, k) / 100).toFixed(2)}×)`, edge(m, k)));
        expect(Math.abs(t.edge - edge(m, k))).toBeLessThanOrEqual(3 * t.se);
      });
    }
  });

  it('matches through the whole engine (bet, random tiles, cash out, chip moves)', () => {
    const n = mcRounds(100_000);
    const sim = new TableSim<MinesState, MinesAction, MinesView>(engine, mcRng(20260928), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'bet', amount: 100, mines: 3 });
      while (sim.state.phase === 'playing' && sim.state.revealed.length < 5) sim.act(0, { type: 'random' });
      if (sim.state.phase === 'playing') sim.act(0, { type: 'cashout' });
      t.add((sim.stack(0) - before) / 100);
    }
    expect(sim.rounds).toHaveLength(n);
    console.log(t.summary('mines engine 3 mines, random tiles, cash out after 5 gems', edge(3, 5)));
    expect(Math.abs(t.edge - edge(3, 5))).toBeLessThanOrEqual(3 * t.se);
  });
});
