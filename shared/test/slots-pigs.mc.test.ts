// Monte Carlo for Straw, Sticks & Bricks: millions of paid spins through playPigs (the base game
// and its Blowdown, the functions the engine settles with), held to |measured - published| <= 3 SE;
// the Blowdown alone from fixed starts against the exact recursion; then engine.act().
//
// Sizing: SD about 4.8 per paid spin with the Blowdown, which starts 1 in 115 spins, so 10M spins
// play about 87,000 of them; 3 SE = about 0.45%.

import { describe, it, expect } from 'vitest';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';
import { TableSim } from './helpers/table-sim.ts';
import { PIGS, blowdownExact, playBlowdown, playPigs, type Grade } from '../src/games/slots/pigs.ts';
import { randInt } from '../src/rng.ts';
import { engine } from '../src/games/slots/engine.ts';

declare const console: { log(...args: unknown[]): void };

// Published return (docs/rules/cards-and-machines.md §3.10), as a house edge.
const EDGE = 1 - 0.9468517;

describe('Straw, Sticks & Bricks Monte Carlo (3 SE)', () => {
  it('94.6852% over 10M paid spins, the Blowdown included', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20261101);
    const t = new Tally();
    let bonuses = 0, mansions = 0, streets = 0;
    for (let i = 0; i < n; i++) {
      const p = playPigs(rng);
      if (p.bonus) {
        bonuses++;
        if (p.bonus.houses.some(([, g]) => g === 3)) mansions++;
        if (p.bonus.street) streets++;
      }
      t.add(p.credits / PIGS.lines - 1);
    }
    console.log(t.summary('slots pigs', EDGE), `Blowdown 1 in ${(n / bonuses).toFixed(1)}, a mansion in ${((mansions / bonuses) * 100).toFixed(2)}% of them, ${streets} Whole Streets`);
    expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
  });

  const STARTS: [string, (Grade | null)[]][] = [
    ['six straw', [0, 0, 0, 0, 0, 0, null, null, null, null, null, null, null, null, null]],
    ['nine mixed', [0, 1, 2, 0, 1, 0, 0, 2, 0, null, null, null, null, null, null]],
    ['thirteen', [2, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, null, null]],
  ];
  const X = blowdownExact();
  for (const [name, start] of STARTS) {
    const n = [0, 1, 2].map((g) => start.filter((s) => s === g).length);
    const want = X.value(n);
    it(`the Blowdown from ${name}: ${want.toFixed(4)} x the bet`, () => {
      const runs = Math.max(20_000, Math.floor(mcRounds(10_000_000) / 25));
      const rng = mcRng(20261102 + n[0]! * 7 + n[1]! * 3 + n[2]!);
      const t = new Tally();
      for (let i = 0; i < runs; i++) t.add(playBlowdown((m) => randInt(rng, m), start).total);
      const z = (t.average - want) / t.se;
      console.log(`slots pigs Blowdown ${name}: n=${t.n} mean=${t.average.toFixed(4)} exact=${want.toFixed(4)} se=${t.se.toFixed(4)} z=${z.toFixed(2)} sd=${t.sd.toFixed(3)}`);
      expect(Math.abs(t.average - want)).toBeLessThanOrEqual(3 * t.se);
    });
  }

  it('engine path: credits per line, coin values, cents and chip moves', () => {
    const n = Math.max(10_000, Math.floor(mcRounds(10_000_000) / 10));
    const sim = new TableSim(engine, mcRng(20261103), 'solo', [{ seat: 0, stack: 1e13 }], engine.config('pigs', 'solo'));
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      sim.act(0, { type: 'spin', coins: 1 + (i % 5), denom: PIGS.denoms[i % 3]! });
      const r = sim.rounds[i]!;
      t.add((r.returned - r.wagered) / r.wagered);
    }
    expect(sim.stack(0) - 1e13).toBe(sim.rounds.reduce((s, r) => s + r.returned - r.wagered, 0));
    console.log(t.summary('slots pigs (engine)', EDGE));
    expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
  });
});
