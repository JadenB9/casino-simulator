import { describe, it, expect } from 'vitest';
import { drawCard, winCount, wins, payMult, rankOfCard, type Guess } from '../src/games/hilo/rules.ts';
import { engine, type HiloAction, type HiloState, type HiloView } from '../src/games/hilo/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// One trial = one round: guess the likelier side (higher on a tie) until n right guesses, then
// cash out. Cards come from drawCard, the engine's own draw; the payout is payMult, the engine's
// own floored product. Published: the exact returns enumerated in hilo.test.ts
// (docs/rules/online-games-b.md §3.3).

const PUBLISHED: Record<number, number> = { 1: 1 - 16_685 / 16_900, 2: 1 - 214_903 / 219_700, 3: 1 - 2_765_594 / 2_856_100 };

const likelier = (r: number): Guess => (winCount(r, 'hi') >= winCount(r, 'lo') ? 'hi' : 'lo');

describe('hi-lo (Monte Carlo)', () => {
  it('lands within 3 SE of the exact return for one, two and three guesses', () => {
    const n = mcRounds(10_000_000);
    for (const guesses of [1, 2, 3]) {
      const rng = mcRng(20260929 + guesses);
      const t = new Tally();
      for (let i = 0; i < n; i++) {
        let r = rankOfCard(drawCard(rng));
        const counts: number[] = [];
        while (counts.length < guesses) {
          const g = likelier(r);
          const next = rankOfCard(drawCard(rng));
          if (!wins(r, g, next)) break;
          counts.push(winCount(r, g));
          r = next;
        }
        t.add(counts.length === guesses ? payMult(counts) / 100 - 1 : -1);
      }
      console.log(t.summary(`hi-lo likelier side, cash out after ${guesses} right guess${guesses > 1 ? 'es' : ''}`, PUBLISHED[guesses]!));
      expect(Math.abs(t.edge - PUBLISHED[guesses]!)).toBeLessThanOrEqual(3 * t.se);
    }
  });

  it('matches through the whole engine (bet, guesses, skips, cash out, chip moves)', () => {
    const n = mcRounds(100_000);
    const sim = new TableSim<HiloState, HiloAction, HiloView>(engine, mcRng(20260933), 'solo', [{ seat: 0, stack: 1e12 }]);
    const t = new Tally();
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'bet', amount: 100 });
      // a skip now and then changes nothing: the next card is as random as the last
      if (i % 3 === 0) sim.act(0, { type: 'skip' });
      while (sim.state.phase === 'playing' && sim.state.counts.length < 2) sim.act(0, { type: 'guess', dir: likelier(rankOfCard(sim.state.card)) });
      if (sim.state.phase === 'playing') sim.act(0, { type: 'cashout' });
      t.add((sim.stack(0) - before) / 100);
    }
    expect(sim.rounds).toHaveLength(n);
    console.log(t.summary('hi-lo engine, likelier side, cash out after 2', PUBLISHED[2]!));
    expect(Math.abs(t.edge - PUBLISHED[2]!)).toBeLessThanOrEqual(3 * t.se);
  });
});
