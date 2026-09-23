// Monte Carlo for Diamond Line: millions of spins through spinDiamonds (the function the engine
// settles with), held to |measured - published| <= 3 SE, then the same through engine.act().
//
// Sizing: SD 6.06 per spin; three diamonds (1,000, 1.5% of the return) come 1 in 65,536, so 10M
// spins see them about 150 times; 3 SE = 0.57%.

import { describe, it, expect } from 'vitest';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';
import { TableSim } from './helpers/table-sim.ts';
import { DIAMONDS, spinDiamonds } from '../src/games/slots/diamonds.ts';
import { engine } from '../src/games/slots/engine.ts';

declare const console: { log(...args: unknown[]): void };

// Published return (docs/rules/cards-and-machines.md §3.7), as a house edge.
const EDGE = 1 - 248_992 / 262_144;

describe('Diamond Line Monte Carlo (3 SE)', () => {
  it('94.9829% over 10M spins', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260930);
    const t = new Tally();
    let top = 0;
    for (let i = 0; i < n; i++) {
      const pay = spinDiamonds(rng).pay;
      if (pay === 1000) top++;
      t.add(pay - 1);
    }
    console.log(t.summary('slots diamonds', EDGE), `three diamonds ${top} times (expected ${(n / 65_536).toFixed(0)})`);
    expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
  });

  it('engine path: coins, coin values, cents and chip moves', () => {
    const n = Math.max(10_000, Math.floor(mcRounds(10_000_000) / 30));
    const sim = new TableSim(engine, mcRng(20260931), 'solo', [{ seat: 0, stack: 1e13 }], engine.config('diamonds', 'solo'));
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      sim.act(0, { type: 'spin', coins: 1 + (i % 3), denom: DIAMONDS.denoms[i % 3]! });
      const r = sim.rounds[i]!;
      t.add((r.returned - r.wagered) / r.wagered);
    }
    expect(sim.stack(0) - 1e13).toBe(sim.rounds.reduce((s, r) => s + r.returned - r.wagered, 0));
    console.log(t.summary('slots diamonds (engine)', EDGE));
    expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
  });
});
