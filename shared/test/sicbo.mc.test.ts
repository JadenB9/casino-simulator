import { describe, it, expect } from 'vitest';
import { spots, spotByKey, rollDice, returnFor, houseEdge, spotName } from '../src/games/sicbo/rules.ts';
import { engine, type SicBoState } from '../src/games/sicbo/engine.ts';
import type { SicBoAction, SicBoView } from '../src/games/sicbo/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds, chiSquareUniform } from './helpers/stats.ts';

// One trial = one roll, per bet (docs/rules/table-games.md, Sic Bo). The rolls go through rollDice
// and returnFor, the same two functions the engine settles with, so millions of them take seconds.
// Every bet on the layout is tallied on the same rolls and each must land within 3 SE of its
// published edge (the exact figure from all 216 rolls, which the unit tests pin to the Wizard of
// Odds table). The seeds are fixed, so the run is deterministic.

// Chi-square critical values at p = 0.001: 215 degrees of freedom (the 216 ordered rolls)...
const CHI_CRIT_215 = 284.82;
// ...and for 5 degrees of freedom (one die's six faces).
const CHI_CRIT_5 = 20.52;

describe('sic bo (Monte Carlo)', () => {
  it('lands within 3 SE of the published edge on every bet on the layout', () => {
    const n = mcRounds(4_000_000);
    const rng = mcRng(20260923);
    const cases = [...spots().values()].map((spot) => ({ spot, tally: new Tally(), published: houseEdge(spot) }));
    const outcomes = new Array<number>(216).fill(0);
    const faces = [0, 0, 0].map(() => new Array<number>(6).fill(0));
    for (let i = 0; i < n; i++) {
      const d = rollDice(rng);
      outcomes[(d[0] - 1) * 36 + (d[1] - 1) * 6 + (d[2] - 1)]!++;
      faces[0]![d[0] - 1]!++;
      faces[1]![d[1] - 1]!++;
      faces[2]![d[2] - 1]!++;
      for (const c of cases) c.tally.add(returnFor(c.spot, d, 1) - 1);
    }
    const worst = { z: 0, key: '' };
    for (const c of cases) {
      const z = (c.tally.edge - c.published) / c.tally.se;
      if (Math.abs(z) > Math.abs(worst.z)) Object.assign(worst, { z, key: c.spot.key });
      console.log(c.tally.summary(`sic bo ${spotName(c.spot)}`, c.published));
      expect(Math.abs(c.tally.edge - c.published), c.spot.key).toBeLessThanOrEqual(3 * c.tally.se);
    }
    console.log(`sic bo: ${cases.length} bets over ${n} rolls, largest |z| ${Math.abs(worst.z).toFixed(2)} (${worst.key})`);
    const chi = chiSquareUniform(outcomes);
    console.log(`sic bo rolls: chi-square ${chi.toFixed(2)} over 215 df (critical ${CHI_CRIT_215} at p = 0.001)`);
    expect(chi).toBeLessThan(CHI_CRIT_215);
    for (const [i, counts] of faces.entries()) {
      const c = chiSquareUniform(counts);
      console.log(`sic bo die ${i + 1}: chi-square ${c.toFixed(2)} over 5 df (critical ${CHI_CRIT_5} at p = 0.001)`);
      expect(c).toBeLessThan(CHI_CRIT_5);
    }
  });

  it('matches through the whole engine (bet, shake, settle, chip moves)', () => {
    const n = mcRounds(300_000);
    const sim = new TableSim<SicBoState, SicBoAction, SicBoView>(engine, mcRng(777), 'solo', [{ seat: 0, stack: 1e12 }], engine.config('', 'solo'));
    const keys = ['small', 'even', 'total:10', 'single:4', 'combo:2-5', 'anytriple'];
    const tallies = new Map(keys.map((k) => [k, new Tally()]));
    for (let i = 0; i < n; i++) {
      sim.act(0, { type: 'bet', bets: keys.map((spot) => ({ spot, amount: 500 })) });
      const before = sim.stack(0);
      sim.act(0, { type: 'roll' });
      const settled = sim.view(0).settled[0]!;
      for (const [k, a, r] of settled.bets) tallies.get(k)!.add((r - a) / a);
      expect(sim.stack(0) - before).toBe(settled.returned);
    }
    for (const [k, t] of tallies) {
      const published = houseEdge(spotByKey(k)!);
      console.log(t.summary(`sic bo engine ${k}`, published));
      expect(Math.abs(t.edge - published), k).toBeLessThanOrEqual(3 * t.se);
    }
  });
});
