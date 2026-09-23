import { describe, it, expect } from 'vitest';
import { type Variant, drawPocket, spotByKey, returnFor, pocketCount } from '../src/games/roulette/rules.ts';
import { engine, type RouletteState } from '../src/games/roulette/engine.ts';
import type { RouletteAction, RouletteView } from '../src/games/roulette/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds, chiSquareUniform } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// One trial = one spin, per bet (docs/rules/table-games.md §5). The spins go through drawPocket
// and returnFor, the same two functions the engine settles with, so millions of them take a
// fraction of a second. Every assertion is |measured − published| ≤ 3 SE on a fixed seed.

interface Case {
  key: string;
  published: number;
}

const CASES: Record<Variant, Case[]> = {
  american: [
    { key: 'straight:17', published: 2 / 38 },
    { key: 'straight:37', published: 2 / 38 },
    { key: 'red', published: 2 / 38 },
    { key: 'odd', published: 2 / 38 },
    { key: 'topline:0-1-2-3-37', published: 3 / 38 },
  ],
  european: [
    { key: 'straight:17', published: 1 / 37 },
    { key: 'red', published: 1 / 37 },
    { key: 'odd', published: 1 / 37 },
  ],
};

// chi-square critical values at p = 0.001 for 37 and 36 degrees of freedom
const CHI_CRIT: Record<Variant, number> = { american: 69.35, european: 67.99 };

describe.each(['american', 'european'] as const)('roulette %s (Monte Carlo)', (variant) => {
  it('lands within 3 SE of the published edge for straight-up and even-money bets', () => {
    const n = mcRounds(3_000_000);
    const rng = mcRng(variant === 'american' ? 20260922 : 20260923);
    const cases = CASES[variant].map((c) => ({ ...c, spot: spotByKey(variant, c.key)!, tally: new Tally() }));
    const counts = new Array<number>(pocketCount(variant)).fill(0);
    for (let i = 0; i < n; i++) {
      const p = drawPocket(rng, variant);
      counts[p]!++;
      for (const c of cases) c.tally.add(returnFor(c.spot, p, 1) - 1);
    }
    for (const c of cases) {
      console.log(c.tally.summary(`roulette ${variant} ${c.key}`, c.published));
      expect(Math.abs(c.tally.edge - c.published)).toBeLessThanOrEqual(3 * c.tally.se);
    }
    const chi = chiSquareUniform(counts);
    console.log(`roulette ${variant} pockets: chi-square ${chi.toFixed(2)} over ${counts.length - 1} df (critical ${CHI_CRIT[variant]} at p = 0.001)`);
    expect(chi).toBeLessThan(CHI_CRIT[variant]);
  });

  it('matches through the whole engine (bet, spin, settle, chip moves)', () => {
    const n = mcRounds(200_000);
    const sim = new TableSim<RouletteState, RouletteAction, RouletteView>(engine, mcRng(variant === 'american' ? 777 : 778), 'solo', [{ seat: 0, stack: 1e12 }], engine.config(variant, 'solo'));
    const straight = new Tally();
    const even = new Tally();
    for (let i = 0; i < n; i++) {
      sim.act(0, { type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount: 100 }, { kind: 'black', amount: 500 }] });
      const before = sim.stack(0);
      sim.act(0, { type: 'spin' });
      const settled = sim.view(0).settled[0]!;
      const byKey = new Map(settled.bets.map(([k, a, r]) => [k, (r - a) / a]));
      straight.add(byKey.get('straight:17')!);
      even.add(byKey.get('black')!);
      expect(sim.stack(0) - before).toBe(settled.returned);
    }
    const published = variant === 'american' ? 2 / 38 : 1 / 37;
    console.log(straight.summary(`roulette ${variant} engine straight`, published));
    console.log(even.summary(`roulette ${variant} engine black`, published));
    expect(Math.abs(straight.edge - published)).toBeLessThanOrEqual(3 * straight.se);
    expect(Math.abs(even.edge - published)).toBeLessThanOrEqual(3 * even.se);
  });
});
