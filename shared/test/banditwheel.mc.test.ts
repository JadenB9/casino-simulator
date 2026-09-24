import { describe, it, expect } from 'vitest';
import { SPOTS, SLOTS, drawSlot, returnFor, edgeOf } from '../src/games/banditwheel/rules.ts';
import { engine, type BanditState } from '../src/games/banditwheel/engine.ts';
import type { BanditAction, BanditView } from '../src/games/banditwheel/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds, chiSquareUniform } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// One trial = one spin, per number (docs/rules/table-games.md §9.5). The spins go through drawSlot
// and returnFor, the same two functions the engine settles with, so ten million of them take a
// couple of seconds. Every assertion is |measured − published| ≤ 3 SE on a fixed seed.

const published = (i: number) => edgeOf(SPOTS[i]!).num / edgeOf(SPOTS[i]!).den;

// chi-square critical value at p = 0.001 for 24 degrees of freedom
const CHI_CRIT = 51.18;

describe('bandit wheel (Monte Carlo)', () => {
  it('lands within 3 SE of the published edge on every number', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260923);
    const tallies = SPOTS.map(() => new Tally());
    const counts = new Array<number>(SLOTS).fill(0);
    for (let i = 0; i < n; i++) {
      const slot = drawSlot(rng);
      counts[slot]!++;
      for (let k = 0; k < SPOTS.length; k++) tallies[k]!.add(returnFor(SPOTS[k]!.key, slot, 1) - 1);
    }
    SPOTS.forEach((spot, k) => {
      const t = tallies[k]!;
      console.log(t.summary(`bandit wheel ${spot.key} (${spot.pays} to 1)`, published(k)));
      expect(Math.abs(t.edge - published(k))).toBeLessThanOrEqual(3 * t.se);
    });
    const chi = chiSquareUniform(counts);
    console.log(`bandit wheel slots: chi-square ${chi.toFixed(2)} over ${SLOTS - 1} df (critical ${CHI_CRIT} at p = 0.001)`);
    expect(chi).toBeLessThan(CHI_CRIT);
  });

  it('matches through the whole engine (bet, spin, settle, chip moves)', () => {
    const n = mcRounds(200_000);
    const sim = new TableSim<BanditState, BanditAction, BanditView>(engine, mcRng(20260924), 'solo', [{ seat: 0, stack: 1e12 }]);
    const tallies = SPOTS.map(() => new Tally());
    const bets = SPOTS.map((s) => ({ spot: s.key, amount: 100 }));
    for (let i = 0; i < n; i++) {
      sim.act(0, { type: 'bet', bets });
      const before = sim.stack(0);
      sim.act(0, { type: 'spin' });
      const settled = sim.view(0).settled[0]!;
      settled.bets.forEach(([, amount, back], k) => tallies[k]!.add((back - amount) / amount));
      expect(sim.stack(0) - before).toBe(settled.returned);
      // the result stands, then the next window opens
      sim.advance(engine.deadline(sim.state)! - sim.now);
    }
    expect(sim.rounds).toHaveLength(n);
    SPOTS.forEach((spot, k) => {
      const t = tallies[k]!;
      console.log(t.summary(`bandit wheel engine ${spot.key}`, published(k)));
      expect(Math.abs(t.edge - published(k))).toBeLessThanOrEqual(3 * t.se);
    });
  });
});
