import { describe, it, expect } from 'vitest';
import { RISKS, MAX_PICKS, RISK_NAMES, drawNumbers, multFor, tableRtp, hitChance, countHits } from '../src/games/keno/rules.ts';
import { engine, type KenoState, type KenoAction, type KenoView, type KenoEvent } from '../src/games/keno/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { Tally, mcRng, mcRounds } from './helpers/stats.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

// Five million draws with the engine's own drawNumbers, each scored for picks {1..p} for every p
// from 1 to 10 on all four risk tables: forty tallies, each within 3 SE of its exact return
// (docs/rules/online-games.md §4.3). Any fixed set of picks sees the same odds, since the draw is
// uniform. The hit counts for ten picks also get a chi-square against the hypergeometric.

// chi-square critical value at p = 0.001 for 8 degrees of freedom (hits 0-7 and 8+)
const CHI_CRIT = 26.12;

describe('keno (Monte Carlo)', () => {
  it('lands within 3 SE of the published return on all 40 tables', () => {
    const n = mcRounds(5_000_000);
    const rng = mcRng(20260929);
    const tallies = RISKS.map(() => Array.from({ length: MAX_PICKS }, () => new Tally()));
    const pays = RISKS.map((risk) => Array.from({ length: MAX_PICKS }, (_, p) => Array.from({ length: p + 2 }, (_, h) => multFor(risk, p + 1, h) / 100 - 1)));
    const tenHits = new Array<number>(11).fill(0);
    const hits = new Array<number>(MAX_PICKS + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const drawn = drawNumbers(rng);
      // hits[p] = how many of the drawn numbers are at most p: the hits for picks {1..p}.
      hits.fill(0);
      for (const d of drawn) if (d <= MAX_PICKS) hits[d]!++;
      for (let p = 1; p <= MAX_PICKS; p++) hits[p]! += hits[p - 1]!;
      tenHits[hits[MAX_PICKS]!]!++;
      for (let r = 0; r < RISKS.length; r++) {
        for (let p = 1; p <= MAX_PICKS; p++) tallies[r]![p - 1]!.add(pays[r]![p - 1]![hits[p]!]!);
      }
    }
    RISKS.forEach((risk, r) => {
      for (let p = 1; p <= MAX_PICKS; p++) {
        const t = tallies[r]![p - 1]!;
        const published = 1 - tableRtp(risk, p);
        console.log(t.summary(`keno ${RISK_NAMES[risk]} ${p} pick${p > 1 ? 's' : ''}`, published));
        expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
      }
    });
    // Ten hits is 1 in 848 million: pool 8, 9 and 10 so every cell expects at least a few.
    const expected = Array.from({ length: 11 }, (_, h) => n * hitChance(MAX_PICKS, h));
    const pooled = (a: number[]) => [...a.slice(0, 8), a[8]! + a[9]! + a[10]!];
    const obs = pooled(tenHits);
    const exp = pooled(expected);
    const chi = obs.reduce((acc, o, k) => acc + (o - exp[k]!) ** 2 / exp[k]!, 0);
    console.log(`keno ten picks, hits 0-7 and 8+: chi-square ${chi.toFixed(2)} over 8 df (critical ${CHI_CRIT} at p = 0.001)`);
    expect(chi).toBeLessThan(CHI_CRIT);
  });

  it('matches through the whole engine (bet, draw, pay, stack)', () => {
    const n = mcRounds(200_000);
    const sim = new TableSim<KenoState, KenoAction, KenoView>(engine, mcRng(20261002), 'solo', [{ seat: 0, stack: 1e12 }]);
    const picks = [3, 11, 17, 22, 29, 34, 38];
    const t = new Tally();
    let wrong = 0;
    for (let i = 0; i < n; i++) {
      const before = sim.stack(0);
      sim.act(0, { type: 'bet', bet: 100, picks, risk: 'classic' });
      const ev = sim.lastEvents[0] as KenoEvent;
      if (ev.hits !== countHits(picks, ev.drawn) || sim.stack(0) - before !== ev.payout - 100) wrong++;
      t.add(ev.payout / 100 - 1);
    }
    expect(wrong).toBe(0);
    const published = 1 - tableRtp('classic', picks.length);
    console.log(t.summary('keno engine Classic 7 picks', published));
    expect(Math.abs(t.edge - published)).toBeLessThanOrEqual(3 * t.se);
  });
});
