import { describe, it, expect } from 'vitest';
import { GRID, drawRoll, wins, winCount, winPayout, rtpOf } from '../src/games/dice/rules.ts';
import { engine, type DiceState, type DiceAction, type DiceView, type RollEvent } from '../src/games/dice/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds, chiSquareUniform } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// Ten million rolls with the engine's drawRoll, each settled against a spread of bets with the
// engine's own wins/winPayout: the even-money bet both ways, chances whose cent rounding costs
// the most at $1 (70% and 97.09%), the 0.01% long shot (9,900x) and bigger bets where the
// rounding nearly vanishes. Every one must land within 3 SE of its exact published return
// (docs/rules/online-games.md §2.4), cent rounding included. The 10,000 faces get a chi-square.

const CASES: { name: string; target: number; over: boolean; bet: number }[] = [
  { name: 'under 49.50, $1', target: 4950, over: false, bet: 100 },
  { name: 'over 50.49, $1', target: 5049, over: true, bet: 100 },
  { name: 'under 70.00, $1', target: 7000, over: false, bet: 100 },
  { name: 'over 2.90, $1', target: 290, over: true, bet: 100 },
  { name: 'under 0.01, $1', target: 1, over: false, bet: 100 },
  { name: 'under 33.33, $7', target: 3333, over: false, bet: 700 },
  { name: 'over 60.00, $25', target: 6000, over: true, bet: 2_500 },
  { name: 'under 98.00, $1', target: 9800, over: false, bet: 100 },
];

// chi-square critical value at p = 0.001 for 9,999 degrees of freedom (normal approximation)
const CHI_CRIT = 9999 + 3.09 * Math.sqrt(2 * 9999);

describe('dice (Monte Carlo)', () => {
  it('lands within 3 SE of the exact return, cent rounding included', () => {
    const n = mcRounds(10_000_000);
    const rng = mcRng(20260925);
    const tallies = CASES.map(() => new Tally());
    const wins_ = CASES.map((c) => winPayout(c.bet, winCount(c.target, c.over)) / c.bet - 1);
    const faces = new Array<number>(GRID).fill(0);
    for (let i = 0; i < n; i++) {
      const roll = drawRoll(rng);
      faces[roll]!++;
      for (let k = 0; k < CASES.length; k++) {
        const c = CASES[k]!;
        tallies[k]!.add(wins(roll, c.target, c.over) ? wins_[k]! : -1);
      }
    }
    CASES.forEach((c, k) => {
      const t = tallies[k]!;
      const published = 1 - rtpOf(c.bet, winCount(c.target, c.over));
      console.log(t.summary(`dice ${c.name}`, published));
      expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
    });
    const chi = chiSquareUniform(faces);
    console.log(`dice faces: chi-square ${chi.toFixed(1)} over 9999 df (critical ${CHI_CRIT.toFixed(1)} at p = 0.001)`);
    expect(chi).toBeLessThan(CHI_CRIT);
  });

  it('matches through the whole engine (bet, roll, pay, stack)', () => {
    const n = mcRounds(300_000);
    const sim = new TableSim<DiceState, DiceAction, DiceView>(engine, mcRng(20260926), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    let wrong = 0;
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'roll', bet: 100, target: 7000, over: false });
      const ev = sim.lastEvents[0] as RollEvent;
      if (sim.stack(0) - before !== ev.payout - 100 || ev.payout !== (ev.win ? 141 : 0)) wrong++;
      t.add(ev.payout / 100 - 1);
    }
    expect(wrong).toBe(0);
    const published = 1 - rtpOf(100, 7000);
    console.log(t.summary('dice engine under 70.00, $1', published));
    expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
  });
});
