import { describe, it, expect } from 'vitest';
import { SPOTS, STOPS, drawStop, returnFor, edgeOf } from '../src/games/bigsix/rules.ts';
import { engine, type BigSixState } from '../src/games/bigsix/engine.ts';
import type { BigSixAction, BigSixView } from '../src/games/bigsix/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds, chiSquareUniform } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// One trial = one spin, per spot (docs/rules/table-games.md §7.5). The spins go through drawStop
// and returnFor, the same two functions the engine settles with, so ten million of them take a
// couple of seconds. Every assertion is |measured − published| ≤ 3 SE on a fixed seed.

const published = (i: number) => edgeOf(SPOTS[i]!).num / edgeOf(SPOTS[i]!).den;

// chi-square critical value at p = 0.001 for 53 degrees of freedom
const CHI_CRIT = 90.57;

describe('big six (Monte Carlo)', () => {
  it('lands within 3 SE of the published edge on every spot', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260923);
    const tallies = SPOTS.map(() => new Tally());
    const counts = new Array<number>(STOPS).fill(0);
    for (let i = 0; i < n; i++) {
      const stop = drawStop(rng);
      counts[stop]!++;
      for (let k = 0; k < SPOTS.length; k++) tallies[k]!.add(returnFor(SPOTS[k]!.key, stop, 1) - 1);
    }
    SPOTS.forEach((spot, k) => {
      const t = tallies[k]!;
      console.log(t.summary(`big six ${spot.name} (${spot.pays} to 1)`, published(k)));
      expect(Math.abs(t.edge - published(k))).toBeLessThanOrEqual(3 * t.se);
    });
    const chi = chiSquareUniform(counts);
    console.log(`big six stops: chi-square ${chi.toFixed(2)} over ${STOPS - 1} df (critical ${CHI_CRIT} at p = 0.001)`);
    expect(chi).toBeLessThan(CHI_CRIT);
  });

  it('matches through the whole engine (bet, spin, settle, chip moves)', () => {
    const n = mcRounds(200_000);
    const sim = new TableSim<BigSixState, BigSixAction, BigSixView>(engine, mcRng(20260924), 'solo', [{ seat: 0, stack: 1e12 }]);
    const tallies = SPOTS.map(() => new Tally());
    const bets = SPOTS.map((s) => ({ spot: s.key, amount: 100 }));
    for (let i = 0; i < n; i++) {
      sim.act(0, { type: 'bet', bets });
      const before = sim.stack(0);
      sim.act(0, { type: 'spin' });
      const settled = sim.view(0).settled[0]!;
      settled.bets.forEach(([, amount, back], k) => tallies[k]!.add((back - amount) / amount));
      expect(sim.stack(0) - before).toBe(settled.returned);
    }
    expect(sim.rounds).toHaveLength(n);
    SPOTS.forEach((spot, k) => {
      const t = tallies[k]!;
      console.log(t.summary(`big six engine ${spot.name}`, published(k)));
      expect(Math.abs(t.edge - published(k))).toBeLessThanOrEqual(3 * t.se);
    });
  });
});
