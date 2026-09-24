import { describe, it, expect } from 'vitest';
import { DIFFICULTIES, SPECS, drawTower, returnAt, multiplier, type Difficulty } from '../src/games/tower/rules.ts';
import { engine, type TowerAction, type TowerState, type TowerView } from '../src/games/tower/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// One trial = one tower, climbed with a fixed pick per row (tile row mod tiles; the dragons are
// placed uniformly, so which tile is picked makes no difference) and cashed out at each row in
// the plan below, all from the same tower. The towers come from drawTower, the engine's own
// builder, and each cash-out pays multiplier(), the engine's own table. Published: the exact
// return of each cash-out row (docs/rules/online-games.md §5.3).

const PLAN: Record<Difficulty, number[]> = { easy: [3, 9], medium: [2, 5], hard: [1, 4], expert: [1, 3], master: [1, 2] };

const edge = (d: Difficulty, k: number) => {
  const r = returnAt(d, k);
  return 1 - r.num / r.den;
};

describe('tower (Monte Carlo)', () => {
  it('lands within 3 SE of the exact return on every difficulty and cash-out row', () => {
    const n = mcRounds(4_000_000);
    const rng = mcRng(20260925);
    for (const d of DIFFICULTIES) {
      const rows = PLAN[d];
      const top = Math.max(...rows);
      const tallies = rows.map(() => new Tally());
      const { tiles } = SPECS[d];
      for (let i = 0; i < n; i++) {
        const tower = drawTower(rng, d, top);
        let climbed = 0;
        while (climbed < top && !tower[climbed]!.includes(climbed % tiles)) climbed++;
        rows.forEach((k, j) => tallies[j]!.add(climbed >= k ? multiplier(d, k) / 100 - 1 : -1));
      }
      rows.forEach((k, j) => {
        const t = tallies[j]!;
        console.log(t.summary(`tower ${d} cash out at row ${k} (${(multiplier(d, k) / 100).toFixed(2)}×)`, edge(d, k)));
        expect(Math.abs(t.edge - edge(d, k))).toBeLessThanOrEqual(3 * t.se);
      });
    }
  });

  it('matches through the whole engine (bet, random picks, cash out, chip moves)', () => {
    const n = mcRounds(100_000);
    const sim = new TableSim<TowerState, TowerAction, TowerView>(engine, mcRng(20260926), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'bet', amount: 100, difficulty: 'medium' });
      while (sim.state.phase === 'climbing' && sim.state.picks.length < 2) sim.act(0, { type: 'random' });
      if (sim.state.phase === 'climbing') sim.act(0, { type: 'cashout' });
      t.add((sim.stack(0) - before) / 100);
    }
    expect(sim.rounds).toHaveLength(n);
    console.log(t.summary('tower engine medium, random picks, cash out at row 2', edge('medium', 2)));
    expect(Math.abs(t.edge - edge('medium', 2))).toBeLessThanOrEqual(3 * t.se);
  });
});
