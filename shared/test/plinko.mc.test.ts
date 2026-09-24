import { describe, it, expect } from 'vitest';
import { ROWS, RISKS, MULTS, drawBits, binOf, boardRtp, binChance, RISK_NAMES } from '../src/games/plinko/rules.ts';
import { engine, type PlinkoState, type PlinkoAction, type PlinkoView, type DropEvent } from '../src/games/plinko/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// Every board (docs/rules/online-games.md §1.4): four million drops per row count, each path drawn
// with the engine's own drawBits and scored on all three risk tables at once. The widest board,
// 16 rows High, has an SD of 6.57 bets a drop, so 3 SE there is about 1%. The bins are also checked
// against the binomial C(rows, k) / 2^rows with a chi-square.

// chi-square critical values at p = 0.001 for 8 to 16 degrees of freedom
const CHI_CRIT: Record<number, number> = { 8: 26.12, 9: 27.88, 10: 29.59, 11: 31.26, 12: 32.91, 13: 34.53, 14: 36.12, 15: 37.7, 16: 39.25 };

describe('plinko (Monte Carlo)', () => {
  it('lands within 3 SE of the published return on all 27 boards', () => {
    const n = mcRounds(4_000_000);
    for (const rows of ROWS) {
      const rng = mcRng(20260930 + rows);
      const tallies = RISKS.map(() => new Tally());
      const counts = new Array<number>(rows + 1).fill(0);
      const tables = RISKS.map((risk) => MULTS[rows][risk].map((m) => m / 100 - 1));
      for (let i = 0; i < n; i++) {
        const bin = binOf(drawBits(rng, rows));
        counts[bin]!++;
        for (let k = 0; k < 3; k++) tallies[k]!.add(tables[k]![bin]!);
      }
      RISKS.forEach((risk, k) => {
        const t = tallies[k]!;
        const published = 1 - boardRtp(rows, risk);
        console.log(t.summary(`plinko ${rows} rows ${RISK_NAMES[risk]}`, published));
        expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
      });
      const chi = counts.reduce((acc, c, bin) => {
        const e = n * binChance(rows, bin);
        return acc + (c - e) ** 2 / e;
      }, 0);
      console.log(`plinko ${rows} rows bins: chi-square ${chi.toFixed(2)} over ${rows} df (critical ${CHI_CRIT[rows]} at p = 0.001)`);
      expect(chi).toBeLessThan(CHI_CRIT[rows]!);
    }
  });

  it('matches through the whole engine (bet, drop, pay, stack)', () => {
    const n = mcRounds(150_000);
    for (const [rows, risk] of [[16, 'high'], [8, 'low'], [12, 'medium']] as const) {
      const sim = new TableSim<PlinkoState, PlinkoAction, PlinkoView>(engine, mcRng(20261001 + rows), 'solo', [{ seat: 0, stack: 1e12 }]);
      const t = new Tally();
      let wrong = 0;
      for (let i = 0; i < n; i++) {
        const before = sim.stack(0);
        sim.act(0, { type: 'drop', bet: 300, rows, risk });
        const ev = sim.lastEvents[0] as DropEvent;
        if (sim.stack(0) - before !== ev.payout - 300 || ev.payout !== 3 * MULTS[rows][risk][ev.bin]!) wrong++;
        t.add(ev.payout / 300 - 1);
      }
      expect(wrong).toBe(0);
      expect(sim.rounds).toHaveLength(n);
      const published = 1 - boardRtp(rows, risk);
      console.log(t.summary(`plinko engine ${rows} rows ${RISK_NAMES[risk]}`, published));
      expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
    }
  });
});
