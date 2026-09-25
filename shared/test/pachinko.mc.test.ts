import { describe, it, expect } from 'vitest';
import { BATCH, MAX_CHAIN, drawBall, ballsFor, rtp, chainChance } from '../src/games/pachinko/rules.ts';
import { engine, type PachinkoState, type PachinkoAction, type PachinkoView, type LaunchEvent } from '../src/games/pachinko/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// docs/rules/parlour-games.md §2.4. Batches of 25 balls drawn with the engine's own drawBall: a
// batch's return against the exact 96.69189453125%. The jackpot chain makes a batch's SD about 2.9
// batch prices. Chain lengths are checked against 1/2, 1/4, ... 1/128, 1/128 with a chi-square.

describe('pachinko (Monte Carlo)', () => {
  it('lands within 3 SE of the published return', () => {
    const n = mcRounds(2_000_000);
    const rng = mcRng(20260927);
    const t = new Tally();
    const chains = new Array<number>(MAX_CHAIN + 1).fill(0);
    for (let i = 0; i < n; i++) {
      let balls = 0;
      for (let b = 0; b < BATCH; b++) {
        const o = drawBall(rng);
        balls += ballsFor(o);
        if (o.chain.length) chains[o.chain.length]!++;
      }
      t.add(balls / BATCH - 1);
    }
    const published = 1 - rtp();
    console.log(t.summary('pachinko batch', published));
    expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
    const hits = chains.reduce((a, b) => a + b, 0);
    let chi = 0;
    for (let k = 1; k <= MAX_CHAIN; k++) {
      const c = chainChance(k);
      const e = (hits * c.num) / c.den;
      chi += (chains[k]! - e) ** 2 / e;
    }
    // 7 degrees of freedom: 24.32 at p = 0.001
    console.log(`pachinko chains: ${hits} jackpot chains, chi-square ${chi.toFixed(2)} over 7 df (critical 24.32 at p = 0.001)`);
    expect(chi).toBeLessThan(24.32);
  });

  it('matches through the whole engine (bet, launch, pay, stack)', () => {
    const n = mcRounds(200_000);
    const sim = new TableSim<PachinkoState, PachinkoAction, PachinkoView>(engine, mcRng(20260928), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    let wrong = 0;
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'launch', bet: 2_500, power: i % 101 });
      const ev = sim.lastEvents[0] as LaunchEvent;
      if (sim.stack(0) - before !== ev.payout - 2_500 || ev.payout !== 100 * ev.balls) wrong++;
      t.add(ev.payout / 2_500 - 1);
    }
    expect(wrong).toBe(0);
    expect(sim.rounds).toHaveLength(n);
    const published = 1 - rtp();
    console.log(t.summary('pachinko engine', published));
    expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
  });
});
