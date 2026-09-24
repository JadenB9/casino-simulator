import { describe, it, expect } from 'vitest';
import { TILES, MIN_MINES, MAX_MINES, choose, gemsOf, multiplier, returnAt, drawField, bestStop } from '../src/games/mines/rules.ts';
import { engine, type MinesAction, type MinesState, type MinesView } from '../src/games/mines/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';
import { queuedRng } from './online-rng.ts';

type Sim = TableSim<MinesState, MinesAction, MinesView>;

function solo(stack = 100_000, seed = 21): Sim {
  return new TableSim(engine, seededRng(seed), 'solo', [{ seat: 0, stack }]);
}

const safeTile = (sim: Sim) => Array.from({ length: TILES }, (_, i) => i).find((i) => !sim.state.field.includes(i) && !sim.state.revealed.includes(i))!;

describe('mines rules', () => {
  it('counts combinations exactly', () => {
    expect(choose(25, 0)).toBe(1);
    expect(choose(25, 1)).toBe(25);
    expect(choose(25, 12)).toBe(5_200_300);
    expect(choose(25, 13)).toBe(5_200_300);
    expect(choose(24, 12)).toBe(2_704_156);
    expect(choose(5, 6)).toBe(0);
    for (let n = 1; n <= 25; n++) for (let k = 1; k <= n; k++) expect(choose(n, k)).toBe(choose(n - 1, k - 1) + choose(n - 1, k));
  });

  it("matches Stake's first and last cells: 1 mine pays 1.03× for a gem, 24 mines pay 24.75×", () => {
    expect(multiplier(1, 1)).toBe(103);
    expect(multiplier(1, 24)).toBe(2_475);
    expect(multiplier(24, 1)).toBe(2_475);
    expect(multiplier(3, 1)).toBe(112);
    expect(multiplier(3, 5)).toBe(199);
    expect(multiplier(12, 13)).toBe(514_829_700);
    expect(multiplier(5, 0)).toBe(0);
  });

  it('every multiplier is 0.99 × C(25,k) / C(25−m,k) floored to the cent (all 300 cells, exact integers)', () => {
    let cells = 0;
    for (let m = MIN_MINES; m <= MAX_MINES; m++) {
      for (let k = 1; k <= gemsOf(m); k++) {
        const mult = BigInt(multiplier(m, k));
        const top = 99n * BigInt(choose(TILES, k));
        const bottom = BigInt(choose(TILES - m, k));
        expect(mult * bottom <= top && (mult + 1n) * bottom > top).toBe(true);
        cells++;
      }
    }
    expect(cells).toBe(300);
  });

  it('cashing out after any number of gems with any number of mines returns at most 99%, exactly', () => {
    let worst = 1;
    let best = 0;
    for (let m = MIN_MINES; m <= MAX_MINES; m++) {
      for (let k = 1; k <= gemsOf(m); k++) {
        const r = returnAt(m, k);
        // exact: num / den ≤ 99 / 100
        expect(BigInt(r.num) * 100n <= BigInt(r.den) * 99n).toBe(true);
        // and the floor takes less than one cent of the multiplier: return > 0.99 − 0.01 × P(k gems)
        expect(BigInt(r.den) * 99n - BigInt(r.num) * 100n < BigInt(choose(TILES - m, k)) * 100n).toBe(true);
        worst = Math.min(worst, r.num / r.den);
        best = Math.max(best, r.num / r.den);
      }
    }
    expect(best).toBe(0.99);
    // the lowest cells on the board: 1 mine, 4 gems pays 1.17× with probability 21/25 (98.28%)
    expect(worst).toBeCloseTo(0.9828, 4);
    expect(returnAt(1, 4)).toEqual({ num: 117 * choose(24, 4), den: 100 * choose(25, 4) });
  });

  it('places exactly m distinct mines, every tile equally likely', () => {
    const rng = seededRng(8);
    for (let m = MIN_MINES; m <= MAX_MINES; m++) {
      const f = drawField(rng, m);
      expect(f).toHaveLength(m);
      expect(new Set(f).size).toBe(m);
      expect([...f].sort((a, b) => a - b)).toEqual(f);
    }
    const counts = new Array<number>(TILES).fill(0);
    for (let n = 0; n < 20_000; n++) for (const t of drawField(rng, 5)) counts[t]!++;
    // chi-square at p = 0.001 for 24 df
    expect(chiSquareUniform(counts)).toBeLessThan(51.18);
  });

  it('points Tips at the gem count with the best exact return', () => {
    // 3 mines: 1 gem gives 1.12 × 22/25 = 98.56%; the best return on the ladder is 99.0% at 13 gems
    expect(bestStop(3, 0)).toBe(13);
    // 24 mines: there is only one gem to find
    expect(bestStop(24, 0)).toBe(1);
    expect(bestStop(24, 1)).toBe(1);
    expect(bestStop(1, 24)).toBe(24);
  });
});

describe('mines engine', () => {
  it('takes the bet, places the mines and keeps them out of the view and the events', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 2_000, mines: 5 });
    expect(sim.stack(0)).toBe(98_000);
    expect(sim.state.field).toHaveLength(5);
    const v = sim.view(0);
    expect(v).toMatchObject({ phase: 'playing', bet: 2_000, mines: 5, revealed: [], mult: 0, field: null, hit: null });
    expect(JSON.stringify(sim.lastEvents)).not.toMatch(/field/);
    sim.act(0, { type: 'reveal', tile: safeTile(sim) });
    expect(sim.lastEvents).toEqual([{ type: 'reveal', tile: sim.state.revealed[0], safe: true, gems: 1, mult: multiplier(5, 1) }]);
    expect(sim.view(null).field).toBeNull();
    expect(engine.liveBets(sim.state, 0)).toBe(2_000);
  });

  it('turns gems, cashes out at the multiplier and shows the board', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 1_000, mines: 3 });
    expect(sim.act(0, { type: 'cashout' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    for (let k = 0; k < 5; k++) sim.act(0, { type: 'reveal', tile: safeTile(sim) });
    expect(sim.view(0).mult).toBe(199);
    const field = sim.state.field;
    sim.act(0, { type: 'cashout' });
    expect(sim.stack(0)).toBe(99_000 + 1_990);
    expect(sim.view(0).result).toEqual({ outcome: 'cashout', gems: 5, mult: 199, payout: 1_990 });
    expect(sim.view(0).field).toEqual(field);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 1_990 }]);
  });

  it('a mine ends the round, loses the bet and shows where they all were', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 1_000, mines: 10 });
    sim.act(0, { type: 'reveal', tile: safeTile(sim) });
    const mine = sim.state.field[0]!;
    sim.act(0, { type: 'reveal', tile: mine });
    expect(sim.stack(0)).toBe(99_000);
    expect(sim.view(0)).toMatchObject({ phase: 'over', hit: mine, result: { outcome: 'bust', gems: 1, mult: 0, payout: 0 } });
    expect(sim.view(0).field).toEqual(sim.state.field);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 0 }]);
  });

  it('clearing every gem pays out on its own', () => {
    const sim = solo(10_000_000);
    sim.act(0, { type: 'bet', amount: 100, mines: 22 });
    for (let k = 0; k < 3; k++) sim.act(0, { type: 'reveal', tile: safeTile(sim) });
    expect(sim.view(0).result).toEqual({ outcome: 'cleared', gems: 3, mult: 227_700, payout: 227_700 });
  });

  it('random picks never repeat a gem', () => {
    const sim = solo(1_000_000, 5);
    for (let r = 0; r < 100; r++) {
      sim.act(0, { type: 'bet', amount: 100, mines: 1 });
      while (sim.state.phase === 'playing' && sim.state.revealed.length < 20) sim.act(0, { type: 'random' });
      expect(new Set(sim.state.revealed).size).toBe(sim.state.revealed.length);
      if (sim.state.phase === 'playing') sim.act(0, { type: 'cashout' });
    }
  });

  it('refuses what the rules do not allow', () => {
    const sim = solo(5_000);
    const refused = (a: unknown) => sim.act(0, a, { allowRefusal: true }).refused;
    expect(refused({ type: 'reveal', tile: 0 })).toBe('WRONG_PHASE');
    expect(refused({ type: 'bet', amount: 100, mines: 0 })).toBe('LIMIT');
    expect(refused({ type: 'bet', amount: 100, mines: 25 })).toBe('LIMIT');
    expect(refused({ type: 'bet', amount: 250, mines: 3 })).toBe('LIMIT');
    expect(refused({ type: 'bet', amount: 9_000, mines: 3 })).toBe('NOT_ENOUGH_CHIPS');
    sim.act(0, { type: 'bet', amount: 100, mines: 3 });
    expect(refused({ type: 'bet', amount: 100, mines: 3 })).toBe('WRONG_PHASE');
    expect(refused({ type: 'reveal', tile: 25 })).toBe('BAD_REQUEST');
    const gem = safeTile(sim);
    sim.act(0, { type: 'reveal', tile: gem });
    expect(refused({ type: 'reveal', tile: gem })).toBe('BAD_REQUEST');
    expect(engine.parseAction({ type: 'bet', amount: 100, mines: '3' })).toBeNull();
  });

  it('standing up cashes out the gems found, or hands back an untouched bet', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 1_000, mines: 3 });
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(sim.stack(0)).toBe(100_000);
    expect(sim.rounds).toEqual([]);
    expect(sim.state.field).toEqual([]);
    sim.act(0, { type: 'bet', amount: 1_000, mines: 3 });
    sim.act(0, { type: 'reveal', tile: safeTile(sim) });
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(sim.stack(0)).toBe(99_000 + 1_120);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The exact return (docs/rules/online-games.md §6.3), proved by enumeration.

/** Every sequence of the draws placing m mines makes: randInt(25), randInt(24), ... */
function fieldDraws(m: number): number[][] {
  let seqs: number[][] = [[]];
  for (let i = 0; i < m; i++) seqs = seqs.flatMap((s) => Array.from({ length: TILES - i }, (_, v) => [...s, v]));
  return seqs;
}

describe('mines exact return', () => {
  it('places every set of m mines equally often (all 25, 600 and 13,800 draw sequences for 1 to 3 mines)', () => {
    for (const m of [1, 2, 3]) {
      const seqs = fieldDraws(m);
      const seen = new Map<string, number>();
      for (const seq of seqs) {
        const key = drawField(queuedRng([...seq]), m).join(',');
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      expect(seen.size).toBe(choose(TILES, m));
      const each = seqs.length / choose(TILES, m);
      expect([...seen.values()].every((n) => n === each)).toBe(true);
    }
  });

  it('turning k tiles finds no mine with probability C(25−m, k) / C(25, k), whichever tiles (every cell)', () => {
    // Uniform placements: of the C(25, m) sets, C(25 − k, m) avoid k given tiles; the same ratio.
    for (let m = MIN_MINES; m <= MAX_MINES; m++) {
      for (let k = 1; k <= gemsOf(m); k++) {
        expect(BigInt(choose(TILES - k, m)) * BigInt(choose(TILES, k))).toBe(BigInt(choose(TILES - m, k)) * BigInt(choose(TILES, m)));
      }
    }
  });

  it('the engine pays exactly multiplier × P(k gems) for every k, over every board (1 and 2 mines, enumerated)', () => {
    for (const m of [1, 2]) {
      const seqs = fieldDraws(m);
      const top = gemsOf(m);
      const found = new Array<number>(top + 1).fill(0);
      let paid = 0;
      for (const seq of seqs) {
        const sim = new TableSim(engine, queuedRng([...seq]), 'solo', [{ seat: 0, stack: 1_000_000_000 }]);
        sim.act(0, { type: 'bet', amount: 100, mines: m });
        // the plan: turn tiles in a scattered fixed order until a mine or the board is cleared
        for (let i = 0; sim.state.phase === 'playing'; i++) sim.act(0, { type: 'reveal', tile: (i * 7) % TILES });
        const gems = sim.view(0).result!.gems;
        for (let k = 0; k <= gems; k++) found[k]!++;
        paid += sim.view(0).result!.payout;
      }
      for (let k = 1; k <= top; k++) expect(found[k]! * choose(TILES, k)).toBe(seqs.length * choose(TILES - m, k));
      // only clearing the board pays under this plan: the whole board's multiplier × P(clear)
      expect(paid * choose(TILES, top)).toBe(seqs.length * multiplier(m, top) * choose(TILES - m, top));
    }
  });
});
