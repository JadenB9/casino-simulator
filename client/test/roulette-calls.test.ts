import { describe, it, expect } from 'vitest';
import { WHEEL, spotByKey, type Variant } from '../../shared/src/games/roulette/rules.ts';
import { engine } from '../../shared/src/games/roulette/engine.ts';
import { TableSim } from '../../shared/test/helpers/table-sim.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';
import { neighbours, neighbourPieces, callsFor, callOf, coveredBy, unitsOf, placeCall } from '../src/games/roulette/calls.ts';
import { placeFavourite, saveRefusal, saveFavourite, loadFavourites, layoutTotal } from '../src/games/roulette/favourites.ts';
import { mergeLog, SpinLog, logKey, LOG_CAP } from '../src/games/roulette/log.ts';

const cfg = (v: Variant) => engine.config(v, 'solo');
const limitsOf = (v: Variant) => {
  const c = cfg(v);
  return { inside: c.limits.inside!, tableMax: c.limits.default.max };
};

describe('the racetrack: neighbours on the wheel', () => {
  it('a number and two each side, in the wheel order, wrapping past the zero', () => {
    expect(neighbours('european', 0, 2)).toEqual([3, 26, 0, 32, 15]);
    expect(neighbours('european', 17, 2)).toEqual([2, 25, 17, 34, 6]);
    expect(neighbours('american', 0, 1)).toEqual([2, 0, 28]);
    expect(neighbours('american', 37, 2)).toEqual([13, 1, 37, 27, 10]);
  });
  it('never more than the wheel holds, and nothing for a pocket the wheel lacks', () => {
    expect(neighbours('european', 5, 40)).toHaveLength(37);
    expect(new Set(neighbours('european', 5, 40)).size).toBe(37);
    expect(neighbours('european', 37, 2)).toEqual([]);
  });
  it('one chip straight up on each', () => {
    const p = neighbourPieces('american', 17, 2);
    expect(p.map((x) => x.key)).toEqual(['straight:20', 'straight:32', 'straight:17', 'straight:5', 'straight:22']);
    for (const x of p) expect(spotByKey('american', x.key)).not.toBeNull();
  });
});

describe('the French called bets', () => {
  it('only the single-zero wheel offers them', () => {
    expect(callsFor('american')).toEqual([]);
    expect(callsFor('european').map((c) => c.id)).toEqual(['voisins', 'tiers', 'orphelins', 'zero']);
  });
  it('every piece is a real inside spot, and covers exactly the numbers the call names', () => {
    for (const c of callsFor('european')) {
      for (const p of c.pieces) {
        const spot = spotByKey('european', p.key);
        expect(spot, `${c.id} ${p.key}`).not.toBeNull();
        expect(spot!.inside).toBe(true);
      }
      expect(new Set(coveredBy('european', c.pieces))).toEqual(new Set(c.numbers));
    }
  });
  it('the usual chips: nine for the zero\'s neighbours, six for the tier, five for the orphans, four for the zero game', () => {
    expect(callOf('european', 'voisins')!.numbers).toHaveLength(17);
    expect(unitsOf(callOf('european', 'voisins')!.pieces)).toBe(9);
    expect(callOf('european', 'tiers')!.numbers).toHaveLength(12);
    expect(unitsOf(callOf('european', 'tiers')!.pieces)).toBe(6);
    expect(callOf('european', 'orphelins')!.numbers).toHaveLength(8);
    expect(unitsOf(callOf('european', 'orphelins')!.pieces)).toBe(5);
    expect(callOf('european', 'zero')!.numbers).toHaveLength(7);
    expect(unitsOf(callOf('european', 'zero')!.pieces)).toBe(4);
  });
  it('the zero\'s neighbours, the tier and the orphans together are the whole wheel', () => {
    const all = ['voisins', 'tiers', 'orphelins'].flatMap((id) => callOf('european', id as 'voisins')!.numbers);
    expect(all.sort((a, b) => a - b)).toEqual([...WHEEL.european].sort((a, b) => a - b));
  });
});

describe('putting a call down', () => {
  const { inside, tableMax } = limitsOf('european');
  const ctx = { inside, tableMax, bets: {}, stack: 1_000_000 };
  it('sends each piece as the bet the engine settles, at the chip times its units', () => {
    const r = placeCall('european', callOf('european', 'voisins')!.pieces, 500, ctx);
    expect('bets' in r && r.total).toBe(4500);
    const trio = 'bets' in r ? r.bets.find((b) => b.kind === 'street') : null;
    expect(trio).toEqual({ kind: 'street', numbers: [0, 2, 3], amount: 1000 });
  });
  it('the engine takes every call and neighbours bet as one placement', () => {
    for (const v of ['american', 'european'] as Variant[]) {
      const c = cfg(v);
      const pieceSets = [...callsFor(v).map((x) => x.pieces), ...WHEEL[v].map((n) => neighbourPieces(v, n, 2))];
      for (const pieces of pieceSets) {
        const r = placeCall(v, pieces, 100, { inside: c.limits.inside!, tableMax: c.limits.default.max, bets: {}, stack: 100_000 });
        expect('bets' in r).toBe(true);
        if (!('bets' in r)) continue;
        const sim = new TableSim(engine, seededRng(3), 'solo', [{ seat: 0, stack: 100_000 }], c);
        sim.act(0, { type: 'bet', bets: r.bets });
        expect(sim.stack(0)).toBe(100_000 - r.total);
      }
    }
  });
  it('raises a chip under the inside minimum to it, and refuses what the table or stack can not take', () => {
    const r = placeCall('european', neighbourPieces('european', 17, 2), 1, { ...ctx, inside: { min: 500, max: 50_000, step: 100 } });
    expect('bets' in r && r.bets.every((b) => b.amount === 500)).toBe(true);
    expect(placeCall('european', neighbourPieces('european', 17, 2), 100_000, { ...ctx, inside: { min: 100, max: 50_000, step: 100 } })).toMatchObject({ refusal: expect.stringMatching(/inside maximum/) });
    expect(placeCall('european', neighbourPieces('european', 17, 2), 1000, { ...ctx, stack: 4000 })).toMatchObject({ refusal: expect.stringMatching(/more than your stack/) });
    expect(placeCall('european', neighbourPieces('european', 17, 2), 1000, { ...ctx, tableMax: 4000 })).toMatchObject({ refusal: expect.stringMatching(/table maximum/) });
  });
});

describe('favourite layouts', () => {
  const layout = { 'straight:17': 500, red: 2500, 'split:8-11': 500 };
  it('checks a layout against this table before it goes down', () => {
    const r = placeFavourite('american', layout, cfg('american'), {}, 1_000_000);
    expect('bets' in r && r.total).toBe(3500);
    expect(placeFavourite('american', layout, cfg('american'), {}, 1000)).toMatchObject({ refusal: expect.stringMatching(/more than your stack/) });
    expect(placeFavourite('american', { red: 100 }, cfg('american'), {}, 1_000_000)).toMatchObject({ refusal: expect.stringMatching(/Outside bets here start/) });
    expect(placeFavourite('european', { 'topline:0-1-2-3-37': 500 }, cfg('european'), {}, 1_000_000)).toMatchObject({ refusal: expect.stringMatching(/other wheel/) });
  });
  it('keeps up to forty spots, and nothing empty', () => {
    expect(saveRefusal({})).toMatch(/Put chips/);
    expect(saveRefusal(Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`straight:${i % 37}x${i}`, 100])))).toMatch(/up to 40/);
    expect(saveRefusal(layout)).toBeNull();
    expect(layoutTotal(layout)).toBe(3500);
  });
  it('saves into a slot and reads it back (in memory when storage is missing)', () => {
    saveFavourite('european', 1, { 'straight:5': 300 });
    expect(loadFavourites('european')[1]).toEqual({ 'straight:5': 300 });
    saveFavourite('european', 1, null);
    expect(loadFavourites('european')[1]).toBeNull();
  });
});

describe('the longer log of results', () => {
  it('puts the new results in front where the server list continues the log', () => {
    const had = [5, 9, 12, 30, 1, 7];
    expect(mergeLog(had, [22, 17, 5, 9, 12, 30, 1])).toEqual([22, 17, 5, 9, 12, 30, 1, 7]);
    expect(mergeLog(had, [5, 9, 12, 30, 1, 7])).toEqual(had);
    expect(mergeLog([], [3, 4])).toEqual([3, 4]);
    expect(mergeLog(had, [])).toEqual(had);
  });
  it('starts again from the server list when the two do not line up', () => {
    expect(mergeLog([5, 9, 12, 30, 1, 7], [8, 8, 8, 8, 8, 8, 8])).toEqual([8, 8, 8, 8, 8, 8, 8]);
    // too little of the old log is left in the server list to be sure of it
    const had = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(mergeLog(had, [30, 31, 32, 33, 34, 35, 1, 2, 3])).toEqual([30, 31, 32, 33, 34, 35, 1, 2, 3]);
    expect(mergeLog(had, [30, 31, 32, 33, 34, 1, 2, 3, 4])).toEqual([30, 31, 32, 33, 34, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('compares whole results (three dice) and keeps at most the cap', () => {
    const same = (a: number[], b: number[]) => a.join() === b.join();
    expect(mergeLog([[1, 2, 3], [4, 4, 4], [6, 5, 1], [2, 2, 3]], [[3, 3, 3], [1, 2, 3], [4, 4, 4], [6, 5, 1], [2, 2, 3]], same)).toHaveLength(5);
    const long = Array.from({ length: LOG_CAP }, (_, i) => i % 37);
    expect(mergeLog(long, [36, ...long.slice(0, 19)])).toHaveLength(LOG_CAP);
  });
  it('a log keeps only valid results, and only solo tables are kept between visits', () => {
    const log = new SpinLog<number>(null, (x): x is number => typeof x === 'number' && Number.isInteger(x));
    log.merge([3, 'x' as unknown as number, 4]);
    expect(log.results).toEqual([3, 4]);
    expect(logKey('roulette', 'solo:roulette:european:7', 'solo', 'european')).toBe('casino.log.roulette.european.solo:roulette:european:7');
    expect(logKey('roulette', 'rl-k3x9', 'multi')).toBeNull();
  });
});

describe('a solo table keeps its log between visits', () => {
  it('writes the merged log and reads it back, ignoring junk', () => {
    const store = new Map<string, string>();
    const shim = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const g = globalThis as unknown as { localStorage?: unknown };
    const had = g.localStorage;
    g.localStorage = shim;
    try {
      const isN = (x: unknown): x is number => typeof x === 'number';
      const key = logKey('roulette', 'solo:roulette:european:7', 'solo', 'european')!;
      const a = new SpinLog<number>(key, isN);
      a.merge([5, 9, 12, 30]);
      a.merge([17, 5, 9, 12, 30]);
      expect(JSON.parse(store.get(key)!)).toEqual([17, 5, 9, 12, 30]);
      expect(new SpinLog<number>(key, isN).results).toEqual([17, 5, 9, 12, 30]);
      store.set(key, '["x"]');
      expect(new SpinLog<number>(key, isN).results).toEqual([]);
      store.set(key, '{not json');
      expect(new SpinLog<number>(key, isN).results).toEqual([]);
    } finally {
      g.localStorage = had;
    }
  });
});
