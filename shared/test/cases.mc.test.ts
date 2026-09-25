import { describe, it, expect } from 'vitest';
import { CASES, CASE_INFO, WEIGHT, drawItem } from '../src/games/cases/rules.ts';
import { engine, type CasesAction, type CasesEvent, type CasesState, type CasesView } from '../src/games/cases/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// Five million cases of each kind from the engine's drawItem: every case returns exactly 99%
// (docs/rules/online-games.md §11), and each item comes up about as often as its weight says.

describe('cases (Monte Carlo)', () => {
  it('returns 99% on every case, each item at its weight', () => {
    const n = mcRounds(5_000_000);
    const rng = mcRng(20261001);
    for (const id of CASES) {
      const items = CASE_INFO[id].items;
      const t = new Tally();
      const seen = new Array<number>(items.length).fill(0);
      for (let i = 0; i < n; i++) {
        const k = drawItem(rng, id);
        seen[k]!++;
        t.add(items[k]!.mult / 100 - 1);
      }
      console.log(t.summary(`cases ${id}`, 0.01));
      expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
      items.forEach((it, k) => {
        const p = it.weight / WEIGHT;
        const z = (seen[k]! / n - p) / Math.sqrt((p * (1 - p)) / n);
        expect(Math.abs(z)).toBeLessThan(4.5);
      });
    }
  });

  it('matches through the whole engine', () => {
    const n = mcRounds(300_000);
    const sim = new TableSim<CasesState, CasesAction, CasesView>(engine, mcRng(20261002), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'open', bet: 100, case: 'starter', quick: true });
      const e = sim.lastEvents[0] as CasesEvent;
      expect(sim.stack(0) - before).toBe(e.payout - 100);
      t.add(e.payout / 100 - 1);
    }
    console.log(t.summary('cases engine starter', 0.01));
    expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
  });
});
