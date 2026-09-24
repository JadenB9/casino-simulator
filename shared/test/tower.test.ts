import { describe, it, expect } from 'vitest';
import { DIFFICULTIES, SPECS, LEVELS, eggs, multiplier, ladder, returnAt, drawTower, bestStop, type Difficulty } from '../src/games/tower/rules.ts';
import { engine, type TowerAction, type TowerState, type TowerView } from '../src/games/tower/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';
import { queuedRng } from './online-rng.ts';

/** C(n, k) for the small counts here. */
const choose = (n: number, k: number): number => (k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k);

type Sim = TableSim<TowerState, TowerAction, TowerView>;

function solo(stack = 100_000, seed = 11): Sim {
  return new TableSim(engine, seededRng(seed), 'solo', [{ seat: 0, stack }]);
}

/** A safe tile and a bad tile on the next row of the live tower (read from the server's state). */
function tilesOf(sim: Sim): { safe: number; bad: number } {
  const row = sim.state.bad[sim.state.picks.length]!;
  const tiles = SPECS[sim.state.difficulty].tiles;
  const safe = Array.from({ length: tiles }, (_, i) => i).find((i) => !row.includes(i))!;
  return { safe, bad: row[0]! };
}

// The published ladders (docs/rules/online-games-b.md §1.2): floor(99 × tiles^k / eggs^k) / 100.
const PUBLISHED: Record<Difficulty, number[]> = {
  easy: [1.32, 1.76, 2.34, 3.12, 4.17, 5.56, 7.41, 9.88, 13.18],
  medium: [1.48, 2.22, 3.34, 5.01, 7.51, 11.27, 16.91, 25.37, 38.05],
  hard: [1.98, 3.96, 7.92, 15.84, 31.68, 63.36, 126.72, 253.44, 506.88],
  expert: [2.97, 8.91, 26.73, 80.19, 240.57, 721.71, 2165.13, 6495.39, 19486.17],
  master: [3.96, 15.84, 63.36, 253.44, 1013.76, 4055.04, 16220.16, 64880.64, 259522.56],
};

describe('tower rules', () => {
  it("has Stake's five Dragon Tower rows: 4 tiles/1 dragon, 3/1, 2/1, 3/2, 4/3", () => {
    expect(DIFFICULTIES.map((d) => [SPECS[d].tiles, SPECS[d].bad])).toEqual([
      [4, 1],
      [3, 1],
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
    expect(LEVELS).toBe(9);
  });

  it('pays the published ladder on every row of every difficulty', () => {
    for (const d of DIFFICULTIES) expect(ladder(d).map((m) => m / 100)).toEqual(PUBLISHED[d]);
    expect(multiplier('easy', 0)).toBe(0);
  });

  it('each multiplier is 0.99 / P(survive k) floored to the cent, checked in exact integers', () => {
    for (const d of DIFFICULTIES) {
      const { tiles } = SPECS[d];
      const g = eggs(d);
      for (let k = 1; k <= LEVELS; k++) {
        const m = BigInt(multiplier(d, k));
        // m ≤ 99 × tiles^k / g^k < m + 1
        const top = 99n * BigInt(tiles) ** BigInt(k);
        const bottom = BigInt(g) ** BigInt(k);
        expect(m * bottom <= top).toBe(true);
        expect((m + 1n) * bottom > top).toBe(true);
      }
    }
  });

  it('cashing out on any row returns at most 99% (exactly), and exactly 99% where the floor takes nothing', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 1; k <= LEVELS; k++) {
        const r = returnAt(d, k);
        expect(r.num * 100).toBeLessThanOrEqual(r.den * 99);
        // within a cent of the multiplier: the floor takes less than 0.01 × P(survive)
        expect(r.den * 99 - r.num * 100).toBeLessThan(eggs(d) ** k * 100);
      }
    }
    for (const d of ['hard', 'expert', 'master'] as const) {
      for (let k = 1; k <= LEVELS; k++) expect(returnAt(d, k).num * 100).toBe(returnAt(d, k).den * 99);
    }
    // the lowest return on the board: Medium rows 1 and 2, 1.48 × 2/3 and 2.22 × 4/9
    expect(returnAt('medium', 1)).toEqual({ num: 148 * 2, den: 300 });
  });

  it('builds rows with exactly the right number of distinct dragons, uniformly placed', () => {
    const rng = seededRng(3);
    const counts: Record<Difficulty, number[]> = { easy: [0, 0, 0, 0], medium: [0, 0, 0], hard: [0, 0], expert: [0, 0, 0], master: [0, 0, 0, 0] };
    let bad = 0;
    for (const d of DIFFICULTIES) {
      for (let n = 0; n < 4000; n++) {
        const t = drawTower(rng, d);
        if (t.length !== LEVELS) bad++;
        for (const row of t) {
          if (new Set(row).size !== SPECS[d].bad) bad++;
          for (const x of row) {
            if (!(x >= 0 && x < SPECS[d].tiles)) bad++;
            counts[d][x]!++;
          }
        }
      }
      expect(bad).toBe(0);
      // chi-square at p = 0.001: 16.27 for 3 df (the largest here)
      expect(chiSquareUniform(counts[d])).toBeLessThan(16.27);
    }
  });

  it('points Tips at the row with the best exact return', () => {
    // Hard, Expert and Master return exactly 99% everywhere: the first row is as good as any.
    expect(bestStop('hard', 0)).toBe(1);
    expect(bestStop('master', 5)).toBe(5);
    // Easy rows 1 and 2 are 99% exactly; from row 2 on, row 2 is the best.
    expect(bestStop('easy', 0)).toBe(1);
    expect(bestStop('easy', 2)).toBe(2);
    // Medium: rows 1-2 give 98.67%, row 8 gives 98.99%, the best of the ladder.
    expect(bestStop('medium', 0)).toBe(8);
    expect(bestStop('medium', 9)).toBe(9);
  });
});

describe('tower engine', () => {
  it('takes the bet, builds the tower and keeps it out of the view and the events', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 1_000, difficulty: 'medium' });
    expect(sim.stack(0)).toBe(99_000);
    expect(sim.state.phase).toBe('climbing');
    expect(sim.state.bad).toHaveLength(LEVELS);
    const v = sim.view(0);
    expect(v).toMatchObject({ phase: 'climbing', bet: 1_000, difficulty: 'medium', level: 0, picks: [], mult: 0, tower: null });
    expect(JSON.stringify(v)).not.toMatch(/bad/);
    expect(JSON.stringify(sim.lastEvents)).not.toMatch(/tower|bad/);
    // a safe pick shows only that it was safe
    sim.act(0, { type: 'pick', tile: tilesOf(sim).safe });
    expect(sim.lastEvents).toEqual([{ type: 'pick', row: 0, tile: sim.state.picks[0], safe: true, mult: 148 }]);
    expect(sim.view(null).tower).toBeNull();
    expect(sim.engine.liveBets(sim.state, 0)).toBe(1_000);
  });

  it('climbs, cashes out at the row multiplier and shows the whole tower', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 1_000, difficulty: 'easy' });
    expect(sim.act(0, { type: 'cashout' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    for (let k = 0; k < 3; k++) sim.act(0, { type: 'pick', tile: tilesOf(sim).safe });
    expect(sim.view(0)).toMatchObject({ level: 3, mult: 234 });
    const tower = sim.state.bad;
    sim.act(0, { type: 'cashout' });
    expect(sim.stack(0)).toBe(99_000 + 2_340);
    const v = sim.view(0);
    expect(v.result).toEqual({ outcome: 'cashout', level: 3, mult: 234, payout: 2_340 });
    expect(v.tower).toEqual(tower);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 2_340 }]);
    expect(sim.engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('loses the bet on the dragon, reveals the tower, and refuses further picks', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 500, difficulty: 'hard' });
    sim.act(0, { type: 'pick', tile: tilesOf(sim).safe });
    const { bad } = tilesOf(sim);
    sim.act(0, { type: 'pick', tile: bad });
    expect(sim.stack(0)).toBe(99_500);
    expect(sim.view(0).result).toEqual({ outcome: 'bust', level: 1, mult: 0, payout: 0 });
    expect(sim.view(0).level).toBe(1);
    expect(sim.view(0).tower).toEqual(sim.state.bad);
    expect(sim.lastEvents.map((e) => (e as { type: string }).type)).toEqual(['pick', 'over']);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 500, returned: 0 }]);
    expect(sim.act(0, { type: 'pick', tile: 0 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('pays the top row on its own when the ninth egg is found', () => {
    const sim = solo(1_000_000);
    sim.act(0, { type: 'bet', amount: 1_000, difficulty: 'master' });
    for (let k = 0; k < LEVELS; k++) sim.act(0, { type: 'pick', tile: tilesOf(sim).safe });
    expect(sim.view(0).result).toEqual({ outcome: 'top', level: 9, mult: 25_952_256, payout: 25_952_256 * 10 });
    expect(sim.stack(0)).toBe(999_000 + 259_522_560);
  });

  it('random picks land on the current row and play like any other pick', () => {
    const sim = solo(100_000, 99);
    let busts = 0;
    for (let r = 0; r < 200; r++) {
      sim.act(0, { type: 'bet', amount: 100, difficulty: 'easy' });
      while (sim.state.phase === 'climbing' && sim.state.picks.length < 3) sim.act(0, { type: 'random' });
      if (sim.state.phase === 'climbing') sim.act(0, { type: 'cashout' });
      for (const p of sim.state.picks) expect(p).toBeLessThan(4);
      if (sim.state.result!.outcome === 'bust') busts++;
    }
    // P(bust within 3 easy rows) = 1 − (3/4)^3 ≈ 58%
    expect(busts).toBeGreaterThan(80);
    expect(busts).toBeLessThan(150);
  });

  it('refuses what the rules do not allow', () => {
    const sim = solo(5_000);
    const refused = (a: unknown) => sim.act(0, a, { allowRefusal: true }).refused;
    expect(refused({ type: 'pick', tile: 0 })).toBe('WRONG_PHASE');
    expect(refused({ type: 'bet', amount: 50, difficulty: 'easy' })).toBe('LIMIT');
    expect(refused({ type: 'bet', amount: 150, difficulty: 'easy' })).toBe('LIMIT');
    expect(refused({ type: 'bet', amount: 200_000, difficulty: 'easy' })).toBe('LIMIT');
    expect(refused({ type: 'bet', amount: 6_000, difficulty: 'easy' })).toBe('NOT_ENOUGH_CHIPS');
    expect(engine.parseAction({ type: 'bet', amount: 100, difficulty: 'insane' })).toBeNull();
    expect(engine.parseAction({ type: 'pick', tile: 1.5 })).toBeNull();
    sim.act(0, { type: 'bet', amount: 100, difficulty: 'hard' });
    expect(refused({ type: 'bet', amount: 100, difficulty: 'hard' })).toBe('WRONG_PHASE');
    expect(refused({ type: 'pick', tile: 2 })).toBe('BAD_REQUEST');
    expect(refused({ type: 'pick', tile: -1 })).toBe('BAD_REQUEST');
  });

  it('standing up cashes out what was found, or hands back an untouched bet', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 1_000, difficulty: 'expert' });
    let step = engine.seatLeaving(sim.state, 0, sim.ctx());
    sim.apply(step);
    expect(step.chips).toEqual([{ seat: 0, payout: 1_000 }]);
    expect(step.rounds ?? []).toEqual([]);
    expect(sim.stack(0)).toBe(100_000);
    expect(sim.state.phase).toBe('idle');
    expect(sim.state.bad).toEqual([]);

    sim.act(0, { type: 'bet', amount: 1_000, difficulty: 'expert' });
    sim.act(0, { type: 'pick', tile: tilesOf(sim).safe });
    step = engine.seatLeaving(sim.state, 0, sim.ctx());
    sim.apply(step);
    expect(sim.stack(0)).toBe(99_000 + 2_970);
    expect(sim.view(0).result?.outcome).toBe('cashout');
    // nothing live, nothing more to pay
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.seatLeaving(sim.state, 0, sim.ctx()).events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The exact return (docs/rules/online-games-b.md §1.3), proved by enumeration.

/** Every sequence of the draws one row makes: randInt(tiles), randInt(tiles − 1), ... `bad` of them. */
function rowDraws(d: Difficulty): number[][] {
  const { tiles, bad } = SPECS[d];
  let seqs: number[][] = [[]];
  for (let i = 0; i < bad; i++) seqs = seqs.flatMap((s) => Array.from({ length: tiles - i }, (_, v) => [...s, v]));
  return seqs;
}

describe('tower exact return', () => {
  it('every row puts the dragons on each set of tiles equally often (all draw sequences)', () => {
    for (const d of DIFFICULTIES) {
      const seqs = rowDraws(d);
      const seen = new Map<string, number>();
      for (const seq of seqs) {
        // row 0 from this sequence; the other eight rows from any draws
        const row = drawTower(queuedRng([...seq]), d)[0]!;
        seen.set(row.join(','), (seen.get(row.join(',')) ?? 0) + 1);
      }
      const { tiles, bad } = SPECS[d];
      const sets = choose(tiles, bad);
      expect(seen.size).toBe(sets);
      for (const n of seen.values()) expect(n).toBe(seqs.length / sets);
    }
  });

  it('the engine pays exactly multiplier × P(survive) on every row it can reach, over every tower (enumerated)', () => {
    // As many rows as can be enumerated whole: 16,384 Easy towers, 19,683 Medium, 512 Hard,
    // 7,776 Expert and 13,824 Master (each draw sequence equally likely).
    const depth: Record<Difficulty, number> = { easy: 7, medium: 9, hard: 9, expert: 5, master: 3 };
    for (const d of DIFFICULTIES) {
      const K = depth[d];
      const row = rowDraws(d);
      const total = row.length ** K;
      // survived[k]: towers on which the plan (pick tile row % tiles) finds k eggs or more
      const survived = new Array<number>(K + 1).fill(0);
      let paidAtTop = 0;
      for (let n = 0; n < total; n++) {
        const draws: number[] = [];
        for (let r = 0, x = n; r < K; r++, x = Math.floor(x / row.length)) draws.push(...row[x % row.length]!);
        const sim = new TableSim(engine, queuedRng(draws, n), 'solo', [{ seat: 0, stack: 1_000_000_000 }]);
        sim.act(0, { type: 'bet', amount: 100, difficulty: d });
        while (sim.state.phase === 'climbing' && sim.state.picks.length < K) sim.act(0, { type: 'pick', tile: sim.state.picks.length % SPECS[d].tiles });
        const v = sim.view(0);
        for (let k = 0; k <= v.level; k++) survived[k]!++;
        if (sim.state.phase === 'climbing') sim.act(0, { type: 'cashout' });
        paidAtTop += sim.view(0).result!.payout;
      }
      const g = eggs(d);
      const { tiles } = SPECS[d];
      for (let k = 1; k <= K; k++) {
        // P(k safe rows) = (eggs / tiles)^k exactly
        expect(survived[k]! * tiles ** k).toBe(total * g ** k);
      }
      // cash out at row K: sum of payouts (cents on $1) = total × m × P(K) exactly
      expect(paidAtTop * tiles ** K).toBe(total * multiplier(d, K) * g ** K);
    }
  });
});
