// Monte Carlo for the three slot machines: millions of spins through the same functions the
// engine settles with, each held to |measured - published| <= 3 SE. A Neon Nights paid spin
// counts its whole free-game feature, as the published 95.374145% does.
//
// Sizing. The test is only as good as the normal approximation behind "3 SE", and slot returns
// are skewed: a few rare pays carry much of the return. The run has to see the rarest big pay
// many times over.
//   Classic Sevens: SD 6.66, three sevens (3.1% of the return) 1 in 32,768. 10M spins see it
//     about 305 times; 3 SE = 0.63%.
//   Neon Nights: SD 3.78 with the feature, features 1 in 140. 10M spins; 3 SE = 0.36%.
//   5x Wild: SD 26.72, heavy-tailed: 5X 5X 5X pays 5,000 (5.4% of the return) 1 in 93,312, and
//     the 2,500 and 1,000 pays add another 18.8%. 50M spins (5x the others) see the top award
//     about 536 times; 3 SE = 1.13%. A short run (MC_ROUNDS=1e5 gives it 5e5) is a smoke test only.

import { describe, it, expect } from 'vitest';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';
import { TableSim } from './helpers/table-sim.ts';
import { playNeon, spinSevens, spinWild } from '../src/games/slots/rules.ts';
import { engine } from '../src/games/slots/engine.ts';
import { MACHINES, type MachineId } from '../src/games/slots/machines.ts';

declare const console: { log(...args: unknown[]): void };

// Published returns (docs/rules/cards-and-machines.md §3), as house edges.
const EDGE: Record<MachineId, number> = {
  sevens: 1 - 247_536 / 262_144,
  neon: 1 - 0.95374145,
  wild: 1 - 335_253 / 373_248,
};

describe('slots Monte Carlo (3 SE)', () => {
  it('Classic Sevens: 94.4275%', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260922);
    const t = new Tally();
    for (let i = 0; i < n; i++) t.add(spinSevens(rng).pay - 1);
    console.log(t.summary('slots sevens', EDGE.sevens));
    expect(Math.abs(t.edge - EDGE.sevens)).toBeLessThanOrEqual(3 * t.se);
  });

  it('Neon Nights: 95.3741% with free games', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260923);
    const t = new Tally();
    let features = 0, free = 0;
    for (let i = 0; i < n; i++) {
      const p = playNeon(rng);
      if (p.free.length) {
        features++;
        free += p.free.length;
      }
      t.add(p.credits / 20 - 1);
    }
    console.log(t.summary('slots neon', EDGE.neon), `features 1 in ${(n / features).toFixed(1)}, ${(free / features).toFixed(3)} free games each`);
    expect(Math.abs(t.edge - EDGE.neon)).toBeLessThanOrEqual(3 * t.se);
  });

  it('5x Wild: 89.8204% (heavy tail: 5x the spins)', () => {
    const n = mcRounds(10_000_000) * 5;
    const rng = mcRng(20260924);
    const t = new Tally();
    let top = 0;
    for (let i = 0; i < n; i++) {
      const pay = spinWild(rng).pay;
      if (pay === 5000) top++;
      t.add(pay - 1);
    }
    console.log(t.summary('slots wild', EDGE.wild), `5X 5X 5X ${top} times (expected ${(n / 93_312).toFixed(0)})`);
    expect(Math.abs(t.edge - EDGE.wild)).toBeLessThanOrEqual(3 * t.se);
  });

  // The same check through engine.act(): coins, coin values, cents and chip moves, on a
  // TableSim. Fewer spins (it clones the state every spin), so wider bands.
  for (const id of ['sevens', 'neon', 'wild'] as const) {
    it(`engine path, ${MACHINES[id].name}`, () => {
      const m = MACHINES[id];
      const n = Math.max(10_000, Math.floor(mcRounds(10_000_000) / (id === 'wild' ? 10 : 30)));
      const sim = new TableSim(engine, mcRng(id.length * 1000 + 7), 'solo', [{ seat: 0, stack: 1e13 }], engine.config(id, 'solo'));
      const t = new Tally();
      for (let i = 0; i < n; i++) {
        const coins = 1 + (i % m.maxCoins);
        const denom = m.denoms[i % m.denoms.length]!;
        sim.act(0, { type: 'spin', coins, denom });
        const r = sim.rounds[i]!;
        t.add((r.returned - r.wagered) / r.wagered);
      }
      const stackNet = sim.stack(0) - 1e13;
      expect(stackNet).toBe(sim.rounds.reduce((s, r) => s + r.returned - r.wagered, 0));
      console.log(t.summary(`slots ${id} (engine)`, EDGE[id]));
      expect(Math.abs(t.edge - EDGE[id])).toBeLessThanOrEqual(3 * t.se);
    });
  }
});
