import { describe, it, expect } from 'vitest';
import { drawCrash, timeTo, multAt } from '../src/games/crash/rules.ts';
import { engine, CRASHED_MS, type CrashAction, type CrashState, type CrashView } from '../src/games/crash/engine.ts';
import { randInt } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// One trial = one flight from drawCrash, the engine's own sampler; an auto cash-out at k pays
// k/100 when the crash point is above k (the engine's rule). Published: 1% edge on every target
// (docs/rules/online-games.md §8.3), and 1 round in 100 over at 1.00×.

const TARGETS = [101, 150, 200, 1_000, 10_000];
const EDGE = 0.01;

describe('crash (Monte Carlo)', () => {
  it('lands within 3 SE of a 1% edge on every auto target, and busts at 1.00× one round in 100', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260934);
    const tallies = TARGETS.map(() => new Tally());
    const instant = new Tally();
    for (let i = 0; i < n; i++) {
      const c = drawCrash(rng);
      instant.add(c === 100 ? 1 : 0);
      for (let j = 0; j < TARGETS.length; j++) tallies[j]!.add(c > TARGETS[j]! ? TARGETS[j]! / 100 - 1 : -1);
    }
    TARGETS.forEach((k, j) => {
      const t = tallies[j]!;
      console.log(t.summary(`crash auto cash-out at ${(k / 100).toFixed(2)}×`, EDGE));
      expect(Math.abs(t.edge - EDGE)).toBeLessThanOrEqual(3 * t.se);
    });
    // `edge` is minus the mean: here the mean is the share of 1.00× rounds
    console.log(`crash at 1.00×: ${(instant.average * 100).toFixed(4)}% of ${n} rounds, published 1%, se ${(instant.se * 100).toFixed(4)}%, z ${((instant.average - 0.01) / instant.se).toFixed(2)}`);
    expect(Math.abs(instant.average - 0.01)).toBeLessThanOrEqual(3 * instant.se);
  });

  it('matches through the whole engine: clicks at random moments of real flights, judged on the server clock', () => {
    const n = mcRounds(60_000);
    const rng = mcRng(20260935);
    const clicks = mcRng(20260936);
    const sim = new TableSim<CrashState, CrashAction, CrashView>(engine, rng, 'multi', [
      { seat: 0, stack: 1e12 },
      { seat: 1, stack: 1e12 },
    ]);
    sim.advance(0);
    const manual = new Tally();
    const auto = new Tally();
    for (let i = 0; i < n; i++) {
      const before = [sim.stack(0), sim.stack(1)];
      sim.act(0, { type: 'bet', amount: 100, auto: null });
      sim.act(1, { type: 'bet', amount: 100, auto: 180 });
      sim.advance(sim.state.deadline! - sim.now);
      // seat 0 clicks at a moment picked before the flight (0 to 20 s after launch)
      const at = sim.state.launchAt! + randInt(clicks, 20_000);
      while (sim.state.phase === 'running' && engine.deadline(sim.state)! <= at) sim.advance(engine.deadline(sim.state)! - sim.now);
      if (sim.state.phase === 'running') {
        sim.now = at;
        sim.act(0, { type: 'cashout' }, { allowRefusal: true });
      }
      while (sim.state.phase === 'running') sim.advance(engine.deadline(sim.state)! - sim.now);
      manual.add((sim.stack(0) - before[0]!) / 100);
      auto.add((sim.stack(1) - before[1]!) / 100);
      sim.advance(CRASHED_MS);
    }
    console.log(manual.summary('crash engine, manual click 0-20 s after launch', EDGE));
    console.log(auto.summary('crash engine, auto cash-out at 1.80×', EDGE));
    expect(Math.abs(manual.edge - EDGE)).toBeLessThanOrEqual(3 * manual.se);
    expect(Math.abs(auto.edge - EDGE)).toBeLessThanOrEqual(3 * auto.se);
    // what the clicks were paid is always the curve at the click, below the crash
    expect(multAt(timeTo(180))).toBe(180);
  });
});
