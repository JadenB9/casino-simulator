import { describe, it, expect } from 'vitest';
import { HANDS, PATTERNS, PAYS, WAYS, drawGems, patternOf } from '../src/games/diamonds/rules.ts';
import { engine, type DiamondsAction, type DiamondsEvent, type DiamondsState, type DiamondsView } from '../src/games/diamonds/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// Ten million hands from the engine's drawGems: the return is exactly 99%
// (docs/rules/online-games.md §12), and each pattern comes up at its enumerated rate.

describe('diamonds (Monte Carlo)', () => {
  it('returns 99%, each pattern at its rate', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20261003);
    const t = new Tally();
    const seen = Object.fromEntries(PATTERNS.map((p) => [p, 0])) as Record<string, number>;
    for (let i = 0; i < n; i++) {
      const p = patternOf(drawGems(rng));
      seen[p]!++;
      t.add(PAYS[p] / 100 - 1);
    }
    console.log(t.summary('diamonds', 0.01));
    expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
    const lines = ['pattern      measured     published    z'];
    for (const p of PATTERNS) {
      const q = WAYS[p] / HANDS;
      const z = (seen[p]! / n - q) / Math.sqrt((q * (1 - q)) / n);
      lines.push(`${p.padEnd(10)} ${(seen[p]! / n).toFixed(6)}   ${q.toFixed(6)}   ${z.toFixed(2)}`);
      expect(Math.abs(z)).toBeLessThan(4);
    }
    console.log(lines.join('\n'));
  });

  it('matches through the whole engine', () => {
    const n = mcRounds(300_000);
    const sim = new TableSim<DiamondsState, DiamondsAction, DiamondsView>(engine, mcRng(20261004), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'bet', bet: 100 });
      const e = sim.lastEvents[0] as DiamondsEvent;
      expect(sim.stack(0) - before).toBe(e.payout - 100);
      t.add(e.payout / 100 - 1);
    }
    console.log(t.summary('diamonds engine', 0.01));
    expect(Math.abs(t.edge - 0.01)).toBeLessThanOrEqual(3 * t.se);
  });
});
