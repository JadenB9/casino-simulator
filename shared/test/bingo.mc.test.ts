import { describe, it, expect } from 'vitest';
import { PATTERNS, PATTERN_NAMES, BALLS, dealCard, drawOrder, callNumbers, completions, prizeMult, cardReturn, toNumber, completeOn, lineSubsets, type Pattern } from '../src/games/bingo/rules.ts';
import { engine, BUY_MS, type BingoState } from '../src/games/bingo/engine.ts';
import type { BingoAction, BingoView } from '../src/games/bingo/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

declare const console: { log(...args: unknown[]): void };

// docs/rules/parlour-games.md §1.4. A card and a ball order drawn with the engine's own dealCard
// and drawOrder, scored with the engine's completions and prize table: the card's return and each
// pattern's share, against the exact figures. The blackout jackpot (20,000x one time in 6.8
// million) makes a card's SD about 9.8 prices, so the whole-card check is coarse; the line and
// corners checks are tight. The ball each pattern is completed on is also checked against its
// exact distribution with a chi-square.

describe('bingo (Monte Carlo)', () => {
  it('lands within 3 SE of the published return, per card and per pattern', () => {
    const n = mcRounds(3_000_000);
    const rng = mcRng(20260925);
    const exact = cardReturn();
    const total = new Tally();
    const parts = Object.fromEntries(PATTERNS.map((p) => [p, new Tally()])) as Record<Pattern, Tally>;
    const lineOn = new Array<number>(BALLS + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const card = dealCard(rng);
      const done = completions(card, callNumbers(drawOrder(rng)));
      lineOn[done.line]!++;
      let back = 0;
      for (const p of PATTERNS) {
        const m = prizeMult(p, done[p]) / 100;
        back += m;
        // each pattern's share as its own "bet": its return less the share of the price it carries
        parts[p].add(m - toNumber(exact.parts[p]));
      }
      total.add(back - 1);
    }
    const published = 1 - toNumber(exact.total);
    console.log(total.summary('bingo card', published));
    expect(Math.abs(total.edge - published)).toBeLessThanOrEqual(3 * total.se);
    for (const p of PATTERNS) {
      const t = parts[p];
      console.log(t.summary(`bingo ${PATTERN_NAMES[p]} share (0 = exact)`, 0));
      expect(Math.abs(t.edge)).toBeLessThanOrEqual(3 * t.se);
    }
    // the call the first line comes on, pooled into bins with at least 1000 expected
    const lines = lineSubsets();
    const bins: { obs: number; exp: number }[] = [];
    let obs = 0;
    let exp = 0;
    for (let c = 1; c <= BALLS; c++) {
      obs += lineOn[c]!;
      exp += n * toNumber(completeOn('line', c, lines));
      if (exp >= 1000) {
        bins.push({ obs, exp });
        obs = 0;
        exp = 0;
      }
    }
    if (exp > 0) bins[bins.length - 1] = { obs: bins.at(-1)!.obs + obs, exp: bins.at(-1)!.exp + exp };
    const chi = bins.reduce((a, b) => a + (b.obs - b.exp) ** 2 / b.exp, 0);
    const df = bins.length - 1;
    // Wilson-Hilferty: the chi-square's 0.999 quantile
    const crit = df * (1 - 2 / (9 * df) + 3.09 * Math.sqrt(2 / (9 * df))) ** 3;
    console.log(`bingo first line call: chi-square ${chi.toFixed(2)} over ${df} df (critical ${crit.toFixed(2)} at p = 0.001)`);
    expect(chi).toBeLessThan(crit);
  });

  it('matches through the whole engine (buy, call, pay, stack)', () => {
    const games = mcRounds(15_000);
    const sim = new TableSim<BingoState, BingoAction, BingoView>(engine, mcRng(20260926), 'multi', [{ seat: 0, stack: 1e12 }, { seat: 1, stack: 1e12 }]);
    const t = new Tally();
    let wrong = 0;
    for (let g = 0; g < games; g++) {
      sim.act(0, { type: 'buy', count: 4, stake: 100 });
      sim.act(1, { type: 'buy', count: 1, stake: 100 });
      const before = sim.stack(0) + sim.stack(1);
      sim.advance(BUY_MS);
      while (sim.state.phase === 'calling') sim.advance(engine.deadline(sim.state)! - sim.now);
      const back = sim.stack(0) + sim.stack(1) - before;
      const view = sim.view(0);
      const res = view.results;
      if (res[0]!.returned + res[1]!.returned !== back) wrong++;
      // seat 0's four cards share the game's balls, so the game's average is one sample
      const cards = view.mine!;
      t.add(cards.reduce((n, c) => n + Object.values(c.won).reduce((m, w) => m + w!.paid, 0), 0) / (100 * cards.length) - 1);
      sim.advance(engine.deadline(sim.state)! - sim.now);
    }
    expect(wrong).toBe(0);
    expect(sim.rounds).toHaveLength(2 * games);
    const published = 1 - toNumber(cardReturn().total);
    console.log(t.summary('bingo engine (seat 0 cards)', published));
    expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
  });
});
