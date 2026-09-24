import { describe, it, expect } from 'vitest';
import { drawResult, winPayout, wins } from '../src/games/limbo/rules.ts';
import { engine, type LimboState, type LimboAction, type LimboView, type LimboEvent } from '../src/games/limbo/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// Ten million results from the engine's drawResult, each settled against targets from 1.01x to
// 100,000x: every target returns exactly 99% (docs/rules/online-games.md §3), so each tally must
// land within 3 SE of a 1% edge. The same draws check P(R ≥ x) = 0.99 / x at points up to the
// cap with a binomial z-score each.

const TARGETS = [101, 150, 200, 333, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];
const POINTS = [101, 110, 200, 250, 1_000, 5_000, 20_000, 100_000, 1_000_000, 10_000_000, 100_000_000];

describe('limbo (Monte Carlo)', () => {
  it('returns 99% on every target and P(R ≥ x) = 0.99 / x', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260927);
    const tallies = TARGETS.map(() => new Tally());
    const reached = new Array<number>(POINTS.length).fill(0);
    for (let i = 0; i < n; i++) {
      const r = drawResult(rng);
      for (let k = 0; k < TARGETS.length; k++) {
        const t = TARGETS[k]!;
        tallies[k]!.add(wins(r, t) ? t / 100 - 1 : -1);
      }
      for (let k = 0; k < POINTS.length; k++) if (r >= POINTS[k]!) reached[k]!++;
    }
    TARGETS.forEach((t, k) => {
      const tally = tallies[k]!;
      console.log(tally.summary(`limbo target ${(t / 100).toFixed(2)}x`, 0.01));
      expect(Math.abs(tally.edge - 0.01)).toBeLessThanOrEqual(3 * tally.se);
    });
    const lines = ['P(R >= x)          measured      published       z'];
    POINTS.forEach((x, k) => {
      const p = 99 / x;
      const got = reached[k]! / n;
      const z = (got - p) / Math.sqrt((p * (1 - p)) / n);
      lines.push(`${(x / 100).toFixed(2).padStart(12)}x  ${got.toExponential(6)}  ${p.toExponential(6)}  ${z.toFixed(2).padStart(6)}`);
      expect(Math.abs(z)).toBeLessThan(4);
    });
    console.log(lines.join('\n'));
  });

  it('matches through the whole engine (bet, draw, pay, stack)', () => {
    const n = mcRounds(300_000);
    const sim = new TableSim<LimboState, LimboAction, LimboView>(engine, mcRng(20260928), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    let wrong = 0;
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'bet', bet: 200, target: 250 });
      const ev = sim.lastEvents[0] as LimboEvent;
      if (ev.payout !== (ev.win ? winPayout(200, 250) : 0) || sim.stack(0) - before !== ev.payout - 200) wrong++;
      t.add(ev.payout / 200 - 1);
    }
    expect(wrong).toBe(0);
    console.log(t.summary('limbo engine target 2.50x', 0.01));
    expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
  });
});
