// Monte Carlo for Gold Rush: millions of paid spins through playGoldRush (the base game and its
// sticky-wild free games, the functions the engine settles with), held to |measured - published|
// <= 3 SE; the free games alone against their closed-form values; then engine.act().
//
// Sizing: SD about 3.7 per paid spin with the free games, which start 1 in 62 spins, so 10M
// spins play about 160,000 features; 3 SE = 0.35%.

import { describe, it, expect } from 'vitest';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';
import { TableSim } from './helpers/table-sim.ts';
import { GOLDRUSH, GOLD_FREE_TABLES, playGoldRush, wildsLanding } from '../src/games/slots/goldrush.ts';
import { lineCredits } from '../src/games/slots/lines.ts';
import { randInt, type Rng } from '../src/rng.ts';
import { engine } from '../src/games/slots/engine.ts';

declare const console: { log(...args: unknown[]): void };

// Published return (docs/rules/cards-and-machines.md §3.9), as a house edge, and the closed-form
// value of 8, 10 and 15 free games in total bets.
const EDGE = 1 - 0.92993553;
const FEATURE: Record<number, number> = { 8: 15.397699, 10: 26.508102, 15: 76.891374 };

/** A feature of `games` free games on its own, in total bets (the same steps as playGoldRush). */
function feature(rng: Rng, games: number): number {
  let held = 0;
  let credits = 0;
  for (let g = 0; g < games; g++) {
    const s = [0, 1, 2, 3, 4].map((r) => randInt(rng, GOLDRUSH.freeStrips[r]!.length));
    held |= wildsLanding(s);
    credits += lineCredits(GOLD_FREE_TABLES, s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, held);
  }
  return credits / GOLDRUSH.lines;
}

describe('Gold Rush Monte Carlo (3 SE)', () => {
  it('92.9936% over 10M paid spins, free games included', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20261003);
    const t = new Tally();
    let features = 0, free = 0;
    for (let i = 0; i < n; i++) {
      const p = playGoldRush(rng);
      if (p.free.length) {
        features++;
        free += p.free.length;
      }
      t.add(p.credits / GOLDRUSH.lines - 1);
    }
    console.log(t.summary('slots goldrush', EDGE), `features 1 in ${(n / features).toFixed(1)}, ${(free / features).toFixed(3)} free games each`);
    expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
  });

  for (const games of [8, 10, 15]) {
    it(`${games} free games alone: ${FEATURE[games]} x the total bet`, () => {
      const n = Math.max(20_000, Math.floor(mcRounds(10_000_000) / 20));
      const rng = mcRng(20261004 + games);
      const t = new Tally();
      for (let i = 0; i < n; i++) t.add(feature(rng, games));
      const z = (t.average - FEATURE[games]!) / t.se;
      console.log(`slots goldrush ${games} free games: n=${t.n} mean=${t.average.toFixed(4)} x bet published=${FEATURE[games]} se=${t.se.toFixed(4)} z=${z.toFixed(2)} sd=${t.sd.toFixed(4)}`);
      expect(Math.abs(t.average - FEATURE[games]!)).toBeLessThanOrEqual(3 * t.se);
    });
  }

  it('engine path: credits per line, coin values, cents and chip moves', () => {
    const n = Math.max(10_000, Math.floor(mcRounds(10_000_000) / 30));
    const sim = new TableSim(engine, mcRng(20261005), 'solo', [{ seat: 0, stack: 1e13 }], engine.config('goldrush', 'solo'));
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      sim.act(0, { type: 'spin', coins: 1 + (i % 5), denom: GOLDRUSH.denoms[i % 3]! });
      const r = sim.rounds[i]!;
      t.add((r.returned - r.wagered) / r.wagered);
    }
    expect(sim.stack(0) - 1e13).toBe(sim.rounds.reduce((s, r) => s + r.returned - r.wagered, 0));
    console.log(t.summary('slots goldrush (engine)', EDGE));
    expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
  });
});
