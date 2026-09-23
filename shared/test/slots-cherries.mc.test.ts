// Monte Carlo for Lucky Cherries: millions of paid spins through playCherries (lines and the Cherry
// Wheel, the functions the engine settles with), held to |measured - published| <= 3 SE, then
// the same through engine.act().
//
// Sizing: SD 3.42 per spin with the wheel; the wheel turns 1 in 117 spins, so 10M spins see it
// about 86,000 times and its 100-segment about 4,300; 3 SE = 0.32%.

import { describe, it, expect } from 'vitest';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';
import { TableSim } from './helpers/table-sim.ts';
import { CHERRIES, playCherries } from '../src/games/slots/cherries.ts';
import { engine } from '../src/games/slots/engine.ts';

declare const console: { log(...args: unknown[]): void };

// Published return (docs/rules/cards-and-machines.md §3.8), as a house edge.
const EDGE = 1 - 0.94027955;

describe('Lucky Cherries Monte Carlo (3 SE)', () => {
  it('94.0280% over 10M paid spins, the wheel included', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20261001);
    const t = new Tally();
    let wheels = 0;
    for (let i = 0; i < n; i++) {
      const p = playCherries(rng);
      if (p.wheel) wheels++;
      t.add(p.credits / CHERRIES.lines - 1);
    }
    console.log(t.summary('slots cherries', EDGE), `wheel 1 in ${(n / wheels).toFixed(1)}`);
    expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
  });

  it('engine path: credits per line, coin values, cents and chip moves', () => {
    const n = Math.max(10_000, Math.floor(mcRounds(10_000_000) / 30));
    const sim = new TableSim(engine, mcRng(20261002), 'solo', [{ seat: 0, stack: 1e13 }], engine.config('cherries', 'solo'));
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      sim.act(0, { type: 'spin', coins: 1 + (i % 5), denom: CHERRIES.denoms[i % 3]! });
      const r = sim.rounds[i]!;
      t.add((r.returned - r.wagered) / r.wagered);
    }
    expect(sim.stack(0) - 1e13).toBe(sim.rounds.reduce((s, r) => s + r.returned - r.wagered, 0));
    console.log(t.summary('slots cherries (engine)', EDGE));
    expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
  });
});
