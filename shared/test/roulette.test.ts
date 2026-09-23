import { describe, it, expect } from 'vitest';
import {
  WHEEL, RED, DOUBLE_ZERO, type Variant, type Spot, type BetKind,
  spotsOf, spotByKey, normalizeBet, returnFor, colorOf, pocketCount, pocketLabel, describePocket, spotName, drawPocket,
} from '../src/games/roulette/rules.ts';
import { engine, BETTING_MS, LAUNCH_LEAD_MS, SPIN_MS, LATE_SPIN_MS, SETTLE_MS, type RouletteState } from '../src/games/roulette/engine.ts';
import { parseAction, type RouletteView, type SeatSettle } from '../src/games/roulette/protocol.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

const VARIANTS: Variant[] = ['american', 'european'];
const pockets = (v: Variant) => Array.from({ length: pocketCount(v) }, (_, i) => i);

/** An Rng whose next draw lands on `pocket` (randInt keeps x % n for any x below its rejection limit). */
function forced(pocket: number): Rng {
  return { next32: () => pocket };
}

/** A generator whose next results can be queued, falling back to a seeded stream. */
function steerable(seed = 7) {
  const base = seededRng(seed);
  const queue: number[] = [];
  const rng: Rng = { next32: () => (queue.length ? queue.shift()! : base.next32()) };
  return { rng, next: (p: number) => queue.push(p) };
}

// ---------------------------------------------------------------------------------------------
// The wheel

describe('roulette wheels', () => {
  it('match the published clockwise order exactly', () => {
    const us = '0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 00, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2';
    const eu = '0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26';
    expect(WHEEL.american.map(pocketLabel).join(', ')).toBe(us);
    expect(WHEEL.european.map(pocketLabel).join(', ')).toBe(eu);
  });

  it('holds every pocket exactly once', () => {
    for (const v of VARIANTS) expect([...WHEEL[v]].sort((a, b) => a - b)).toEqual(pockets(v));
  });

  it('alternates red and black all the way round', () => {
    for (const v of VARIANTS) {
      const numbers = WHEEL[v].filter((p) => p !== 0 && p !== DOUBLE_ZERO);
      // on the double-zero wheel the zeros split the sequence in two; within each run colours alternate
      const runs = v === 'american' ? [WHEEL[v].slice(1, 19), WHEEL[v].slice(20)] : [numbers];
      for (const run of runs) for (let i = 1; i < run.length; i++) expect(colorOf(run[i]!)).not.toBe(colorOf(run[i - 1]!));
      expect(numbers.filter((n) => colorOf(n) === 'red')).toHaveLength(18);
    }
  });

  it('puts 0 opposite 00 and n+1 opposite every odd n on the double-zero wheel', () => {
    const w = WHEEL.american;
    const opposite = (p: number) => w[(w.indexOf(p) + 19) % 38];
    expect(opposite(0)).toBe(DOUBLE_ZERO);
    for (let n = 1; n <= 35; n += 2) expect(opposite(n)).toBe(n + 1);
  });

  it('colours the numbers from the fixed red set, zeros green', () => {
    expect([...RED].sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    expect(colorOf(0)).toBe('green');
    expect(colorOf(DOUBLE_ZERO)).toBe('green');
    expect(colorOf(17)).toBe('black');
    expect(colorOf(32)).toBe('red');
  });

  it('calls the number and the outside results', () => {
    expect(describePocket(17)).toMatchObject({ call: '17 BLACK', detail: 'ODD · 1-18 · 2nd 12 · Column 2' });
    expect(describePocket(36)).toMatchObject({ call: '36 RED', detail: 'EVEN · 19-36 · 3rd 12 · Column 3' });
    expect(describePocket(DOUBLE_ZERO)).toMatchObject({ call: '00 GREEN', detail: 'Outside bets lose' });
    expect(describePocket(0).call).toBe('0 GREEN');
  });
});

// ---------------------------------------------------------------------------------------------
// The spot table

const byKind = (v: Variant) => {
  const m = new Map<BetKind, Spot[]>();
  for (const s of spotsOf(v).values()) m.set(s.kind, [...(m.get(s.kind) ?? []), s]);
  return m;
};

/** Row and column of a number on the grid (row 1 = 1-2-3 next to the zeros, column 1 = 1, 4, ... 34). */
const rc = (n: number) => ({ r: Math.ceil(n / 3), c: n - 3 * (Math.ceil(n / 3) - 1) });

describe('roulette spot table', () => {
  it('has every legal inside bet and nothing else (counts from §2.3)', () => {
    const us = byKind('american');
    const eu = byKind('european');
    expect(us.get('straight')).toHaveLength(38);
    expect(eu.get('straight')).toHaveLength(37);
    expect(us.get('split')).toHaveLength(62);
    expect(eu.get('split')).toHaveLength(60);
    expect(us.get('street')).toHaveLength(12 + 3);
    expect(eu.get('street')).toHaveLength(12 + 2);
    expect(us.get('corner')).toHaveLength(22);
    expect(eu.get('corner')).toHaveLength(22);
    expect(us.get('sixline')).toHaveLength(11);
    expect(eu.get('sixline')).toHaveLength(11);
    expect(us.get('topline')).toHaveLength(1);
    expect(us.get('firstfour')).toBeUndefined();
    expect(eu.get('firstfour')).toHaveLength(1);
    expect(eu.get('topline')).toBeUndefined();
    expect(spotsOf('american').size).toBe(38 + 62 + 15 + 22 + 11 + 1 + 12);
    expect(spotsOf('european').size).toBe(37 + 60 + 14 + 22 + 11 + 1 + 12);
  });

  it('builds every split, street, corner and six line from neighbours on the grid', () => {
    for (const v of VARIANTS) {
      for (const s of spotsOf(v).values()) {
        const nums = s.numbers;
        if (nums.some((n) => n === 0 || n === DOUBLE_ZERO)) continue; // zero bets are checked by name below
        const cells = nums.map(rc);
        const rows = new Set(cells.map((x) => x.r));
        const cols = new Set(cells.map((x) => x.c));
        if (s.kind === 'split') {
          const [a, b] = cells as [{ r: number; c: number }, { r: number; c: number }];
          expect(Math.abs(a.r - b.r) + Math.abs(a.c - b.c)).toBe(1);
        } else if (s.kind === 'street') {
          expect(rows.size).toBe(1);
          expect(cols.size).toBe(3);
        } else if (s.kind === 'corner') {
          expect(rows.size).toBe(2);
          expect(cols.size).toBe(2);
          expect(Math.abs([...rows][0]! - [...rows][1]!)).toBe(1);
          expect(Math.abs([...cols][0]! - [...cols][1]!)).toBe(1);
        } else if (s.kind === 'sixline') {
          expect(rows.size).toBe(2);
          expect(cols.size).toBe(3);
          expect(Math.abs([...rows][0]! - [...rows][1]!)).toBe(1);
        }
      }
    }
  });

  it('has exactly the zero bets each layout allows, named by their numbers', () => {
    const zeroNames = (v: Variant) =>
      [...spotsOf(v).values()].filter((s) => s.inside && s.numbers.some((n) => n === 0 || n === DOUBLE_ZERO)).map(spotName).sort();
    expect(zeroNames('american')).toEqual(
      ['Split 0-00', 'Split 0-1', 'Split 0-2', 'Split 00-2', 'Split 00-3', 'Straight 0', 'Straight 00', 'Top line 0-00-1-2-3', 'Trio 0-00-2', 'Trio 0-1-2', 'Trio 00-2-3'].sort(),
    );
    expect(zeroNames('european')).toEqual(['First four 0-1-2-3', 'Split 0-1', 'Split 0-2', 'Split 0-3', 'Straight 0', 'Trio 0-1-2', 'Trio 0-2-3'].sort());
  });

  it('pays the standard odds for each bet', () => {
    const pays: Record<BetKind, number> = {
      straight: 35, split: 17, street: 11, corner: 8, sixline: 5, topline: 6, firstfour: 8,
      red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, dozen1: 2, dozen2: 2, dozen3: 2, column1: 2, column2: 2, column3: 2,
    };
    for (const v of VARIANTS) for (const s of spotsOf(v).values()) expect(s.pays, s.key).toBe(pays[s.kind]);
  });
});

// ---------------------------------------------------------------------------------------------
// Settlement, exhaustively

/** What each outside bet covers, written out independently of rules.ts. 0 and 00 cover nothing. */
function outsideCovers(kind: BetKind, p: number): boolean {
  if (p === 0 || p === DOUBLE_ZERO) return false;
  const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(p);
  switch (kind) {
    case 'red': return red;
    case 'black': return !red;
    case 'odd': return p % 2 === 1;
    case 'even': return p % 2 === 0;
    case 'low': return p >= 1 && p <= 18;
    case 'high': return p >= 19 && p <= 36;
    case 'dozen1': return p <= 12;
    case 'dozen2': return p >= 13 && p <= 24;
    case 'dozen3': return p >= 25;
    case 'column1': return p % 3 === 1;
    case 'column2': return p % 3 === 2;
    case 'column3': return p % 3 === 0;
    default: throw new Error(kind);
  }
}

describe('roulette settlement', () => {
  it('pays every bet correctly on every pocket (exhaustive)', () => {
    for (const v of VARIANTS) {
      for (const s of spotsOf(v).values()) {
        for (const p of pockets(v)) {
          const covers = s.inside ? s.numbers.includes(p) : outsideCovers(s.kind, p);
          expect(returnFor(s, p, 700), `${v} ${s.key} on ${pocketLabel(p)}`).toBe(covers ? 700 * (s.pays + 1) : 0);
        }
      }
    }
  });

  it('loses every outside bet on 0 and 00, whatever 37 looks like arithmetically', () => {
    for (const v of VARIANTS) {
      const zeros = v === 'american' ? [0, DOUBLE_ZERO] : [0];
      for (const s of spotsOf(v).values()) if (!s.inside) for (const z of zeros) expect(returnFor(s, z, 100)).toBe(0);
    }
  });

  it('pays straight 0 and 00 35 to 1, and the zero combinations on their zeros', () => {
    const us = (k: string) => spotByKey('american', k)!;
    expect(returnFor(us('straight:37'), DOUBLE_ZERO, 100)).toBe(3600);
    expect(returnFor(us('straight:0'), 0, 100)).toBe(3600);
    expect(returnFor(us('straight:0'), DOUBLE_ZERO, 100)).toBe(0);
    expect(returnFor(us('split:0-37'), DOUBLE_ZERO, 100)).toBe(1800);
    expect(returnFor(us('topline:0-1-2-3-37'), DOUBLE_ZERO, 100)).toBe(700);
    expect(returnFor(us('street:0-2-37'), 2, 100)).toBe(1200);
    const eu = (k: string) => spotByKey('european', k)!;
    expect(returnFor(eu('firstfour:0-1-2-3'), 3, 100)).toBe(900);
    expect(returnFor(eu('street:0-2-3'), 0, 100)).toBe(1200);
  });

  it('has the published edge for every bet, by exact enumeration', () => {
    // Sum of what comes back for 1 unit over every pocket; edge = (pockets - sum) / pockets.
    const lines: string[] = [];
    for (const v of VARIANTS) {
      const n = pocketCount(v);
      for (const s of spotsOf(v).values()) {
        const back = pockets(v).reduce((acc, p) => acc + returnFor(s, p, 1), 0);
        const lost = n - back; // in units of 1/n
        if (v === 'american') expect(lost, s.key).toBe(s.kind === 'topline' ? 3 : 2);
        else expect(lost, s.key).toBe(1);
        if (s.kind === 'straight' && s.numbers[0] === 17) lines.push(`${v} straight edge ${lost}/${n} = ${((lost / n) * 100).toFixed(3)}%`);
        if (s.kind === 'topline') lines.push(`american top line edge ${lost}/${n} = ${((lost / n) * 100).toFixed(3)}%`);
      }
    }
    console.log(lines.join('\n'));
    expect(((2 / 38) * 100).toFixed(3)).toBe('5.263');
    expect(((3 / 38) * 100).toFixed(3)).toBe('7.895');
    expect(((1 / 37) * 100).toFixed(3)).toBe('2.703');
  });

  it('draws pockets from randInt over the whole wheel', () => {
    for (const v of VARIANTS) {
      for (const p of pockets(v)) expect(drawPocket(forced(p), v)).toBe(p);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Refusing what isn't on the layout

describe('roulette bet validation', () => {
  it('refuses illegal number combinations', () => {
    const bad: [Variant, string, unknown][] = [
      ['american', 'split', [1, 5]],
      ['american', 'split', [3, 4]], // across the column-3 edge
      ['american', 'split', [0, 3]], // 0-3 is European; American has 00-3
      ['american', 'split', [DOUBLE_ZERO, 1]],
      ['american', 'split', [0, DOUBLE_ZERO, 1]],
      ['european', 'split', [0, DOUBLE_ZERO]],
      ['european', 'split', [DOUBLE_ZERO, 2]],
      ['american', 'split', [5, 5]],
      ['american', 'split', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
      ['american', 'street', [2, 3, 4]],
      ['american', 'street', [0, 2, 3]], // a European trio
      ['european', 'street', [0, DOUBLE_ZERO, 2]],
      ['american', 'corner', [3, 4, 6, 7]],
      ['american', 'corner', [0, 1, 2, 3]], // first four is European and not a corner
      ['european', 'corner', [0, 1, 2, 3]],
      ['american', 'corner', [33, 34, 36, 37]],
      ['american', 'sixline', [1, 2, 3, 4, 5]],
      ['american', 'sixline', [2, 3, 4, 5, 6, 7]],
      ['european', 'topline', [0, 1, 2, 3, DOUBLE_ZERO]],
      ['american', 'firstfour', [0, 1, 2, 3]],
      ['american', 'topline', [0, 1, 2, 3]],
      ['american', 'straight', [38]],
      ['european', 'straight', [DOUBLE_ZERO]],
      ['american', 'straight', [-1]],
      ['american', 'straight', [1.5]],
      ['american', 'straight', ['17']],
      ['american', 'straight', []],
      ['american', 'straight', undefined],
      ['american', 'red', [1, 3]],
      ['american', 'dozen4', undefined],
      ['american', 'basket', [0, 1, 2]],
    ];
    for (const [v, kind, numbers] of bad) expect(normalizeBet(v, kind, numbers), `${v} ${kind} ${JSON.stringify(numbers)}`).toBeNull();
  });

  it('accepts legal bets in any order', () => {
    expect(normalizeBet('american', 'split', [20, 17])?.key).toBe('split:17-20');
    expect(normalizeBet('american', 'street', [2, DOUBLE_ZERO, 0])?.key).toBe('street:0-2-37');
    expect(normalizeBet('american', 'topline', [3, 2, 1, DOUBLE_ZERO, 0])?.key).toBe('topline:0-1-2-3-37');
    expect(normalizeBet('european', 'firstfour', [3, 0, 2, 1])?.key).toBe('firstfour:0-1-2-3');
    expect(normalizeBet('american', 'red', undefined)?.key).toBe('red');
    expect(normalizeBet('american', 'column2', [])?.key).toBe('column2');
  });

  it('parses only well-formed actions', () => {
    expect(parseAction({ type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount: 500 }] })).not.toBeNull();
    expect(parseAction({ type: 'bet', bets: [] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount: 0 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount: 1.5 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount: -100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ kind: 'nope', amount: 100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ kind: 'split', numbers: [1, 'x'], amount: 100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ kind: 'sixline', numbers: [1, 2, 3, 4, 5, 6, 7], amount: 100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: Array.from({ length: 41 }, () => ({ kind: 'red', amount: 500 })) })).toBeNull();
    expect(parseAction({ type: 'rebet', double: 'yes' })).toBeNull();
    expect(parseAction({ type: 'rebet' })).toEqual({ type: 'rebet', double: false });
    expect(parseAction({ type: 'ready', on: true })).toEqual({ type: 'ready', on: true });
    expect(parseAction({ type: 'ready' })).toBeNull();
    expect(parseAction({ type: 'spin' })).toEqual({ type: 'spin' });
    expect(parseAction(null)).toBeNull();
    expect(parseAction([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The engine, single player

type Sim = TableSim<RouletteState, ReturnType<typeof parseAction>, RouletteView>;

function solo(variant: Variant = 'american', stack = 1_000_000, rng: Rng = seededRng(1)): Sim {
  const cfg = engine.config(variant, 'solo');
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }], cfg) as unknown as Sim;
}

const bet = (kind: string, amount: number, numbers?: number[]) => ({ type: 'bet', bets: [{ kind, amount, ...(numbers ? { numbers } : {}) }] });

describe('roulette engine, single player', () => {
  it('pays every spot through the engine on every pocket, and moves exactly those chips', () => {
    for (const v of VARIANTS) {
      const all = [...spotsOf(v).values()];
      for (const p of pockets(v)) {
        const { rng, next } = steerable(p + 1);
        const sim = solo(v, 1_000_000, rng);
        const before = sim.stack(0);
        for (let i = 0; i < all.length; i += 40) {
          const chunk = all.slice(i, i + 40).map((s) => ({ kind: s.kind, amount: s.inside ? 100 : 500, ...(s.inside ? { numbers: [...s.numbers] } : {}) }));
          sim.act(0, { type: 'bet', bets: chunk });
        }
        const staked = all.reduce((n, s) => n + (s.inside ? 100 : 500), 0);
        expect(sim.stack(0)).toBe(before - staked);
        next(p);
        sim.act(0, { type: 'spin' });
        const view = sim.view(0);
        expect(view.spin?.pocket).toBe(p);
        const mine = view.settled[0]!;
        let expected = 0;
        for (const [key, amount, returned] of mine.bets) {
          const s = spotByKey(v, key)!;
          const covers = s.inside ? s.numbers.includes(p) : outsideCovers(s.kind, p);
          expect(returned, `${v} ${key} on ${pocketLabel(p)}`).toBe(covers ? amount * (s.pays + 1) : 0);
          expected += returned;
        }
        expect(mine.bets).toHaveLength(all.length);
        expect(mine.wagered).toBe(staked);
        expect(mine.returned).toBe(expected);
        expect(sim.stack(0)).toBe(before - staked + expected);
        expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: staked, returned: expected });
      }
    }
  });

  it('refuses illegal combinations at the table', () => {
    const sim = solo();
    for (const [kind, numbers] of [['split', [1, 5]], ['corner', [3, 4, 6, 7]], ['firstfour', [0, 1, 2, 3]], ['street', [0, 2, 3]]] as const) {
      expect(sim.act(0, bet(kind, 100, [...numbers]), { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    }
    const eu = solo('european');
    expect(eu.act(0, bet('topline', 100, [0, 1, 2, 3, DOUBLE_ZERO]), { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    expect(eu.act(0, bet('straight', 100, [DOUBLE_ZERO]), { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    expect(sim.stack(0)).toBe(1_000_000);
  });

  it('keeps each bet kind inside its limits and the table maximum', () => {
    const sim = solo('american', 5_000_000);
    expect(sim.act(0, bet('straight', 50_100, [17]), { allowRefusal: true }).refused).toBe('LIMIT');
    sim.act(0, bet('straight', 50_000, [17]));
    expect(sim.act(0, bet('straight', 100, [17]), { allowRefusal: true }).refused).toBe('LIMIT'); // $501 on one spot
    expect(sim.act(0, bet('red', 100), { allowRefusal: true }).refused).toBe('LIMIT'); // outside minimum $5
    expect(sim.act(0, bet('red', 500_100), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, bet('red', 550), { allowRefusal: true }).refused).toBe('LIMIT'); // whole dollars only
    sim.act(0, bet('red', 500_000));
    sim.act(0, bet('black', 450_000)); // $500 + $5,000 + $4,500 = $10,000
    expect(sim.act(0, bet('odd', 500), { allowRefusal: true }).refused).toBe('LIMIT'); // table maximum
    expect(sim.act(0, bet('straight', 100, [1]), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(engine.liveBets(sim.state, 0)).toBe(1_000_000);
    expect(sim.stack(0)).toBe(4_000_000);
  });

  it('refuses a bet larger than the stack, and all chips of a placement together', () => {
    const sim = solo('american', 2_000);
    expect(sim.act(0, bet('red', 2_500), { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    const r = sim.act(0, { type: 'bet', bets: [{ kind: 'red', amount: 1_500 }, { kind: 'split', numbers: [1, 5], amount: 100 }] }, { allowRefusal: true });
    expect(r.refused).toBe('BAD_REQUEST');
    expect(sim.stack(0)).toBe(2_000);
    expect(sim.view(0).bets).toEqual({});
  });

  it('undoes the last placement, clears everything, and only spins with chips down', () => {
    const sim = solo();
    expect(sim.act(0, { type: 'spin' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.act(0, bet('straight', 500, [17]));
    sim.act(0, bet('red', 1_000));
    sim.act(0, bet('straight', 500, [17]));
    expect(sim.view(0).bets[0]).toEqual({ 'straight:17': 1_000, red: 1_000 });
    sim.act(0, { type: 'undo' });
    expect(sim.view(0).bets[0]).toEqual({ 'straight:17': 500, red: 1_000 });
    expect(sim.stack(0)).toBe(1_000_000 - 1_500);
    sim.act(0, { type: 'clear' });
    expect(sim.view(0).bets[0]).toBeUndefined();
    expect(sim.stack(0)).toBe(1_000_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    sim.act(0, { type: 'undo' }); // nothing to undo is not an error
    expect(sim.act(0, { type: 'spin' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('rebets the last spin, doubles it, and doubles a layout that already has chips', () => {
    const sim = solo();
    expect(sim.act(0, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    sim.act(0, bet('straight', 500, [17]));
    sim.act(0, bet('dozen2', 1_000));
    sim.act(0, { type: 'spin' });
    expect(sim.view(0).phase).toBe('results');
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    sim.act(0, { type: 'rebet', double: false });
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).bets[0]).toEqual({ 'straight:17': 500, dozen2: 1_000 });
    sim.act(0, { type: 'rebet', double: true }); // doubles what is on the layout
    expect(sim.view(0).bets[0]).toEqual({ 'straight:17': 1_000, dozen2: 2_000 });
    sim.act(0, { type: 'undo' }); // one placement
    expect(sim.view(0).bets[0]).toEqual({ 'straight:17': 500, dozen2: 1_000 });
    sim.act(0, { type: 'clear' });
    sim.act(0, { type: 'rebet', double: true }); // empty layout: twice the last spin
    expect(sim.view(0).bets[0]).toEqual({ 'straight:17': 1_000, dozen2: 2_000 });
  });

  it('refuses a rebet the stack no longer covers', () => {
    const { rng, next } = steerable();
    const sim = solo('american', 3_000, rng);
    sim.act(0, bet('red', 2_000));
    next(2); // black
    sim.act(0, { type: 'spin' });
    expect(sim.stack(0)).toBe(1_000);
    expect(sim.act(0, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.stack(0)).toBe(1_000);
  });

  it('keeps the last 20 numbers, most recent first', () => {
    const { rng, next } = steerable();
    const sim = solo('american', 10_000_000, rng);
    const hits: number[] = [];
    for (let i = 0; i < 25; i++) {
      const p = (i * 7) % 38;
      hits.unshift(p);
      sim.act(0, bet('red', 500));
      next(p);
      sim.act(0, { type: 'spin' });
    }
    expect(sim.view(0).history).toEqual(hits.slice(0, 20));
  });

  it('times the spin from the moment it is pressed and never deadlines a single-player table', () => {
    const sim = solo();
    sim.act(0, bet('red', 500));
    sim.act(0, { type: 'spin' });
    const spin = sim.view(0).spin!;
    expect(spin.launchAt).toBe(sim.now);
    expect(spin.restAt).toBe(sim.now + SPIN_MS);
    expect(engine.deadline(sim.state)).toBeNull();
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
  });

  it('gives chips back when the player leaves before the spin', () => {
    const sim = solo();
    sim.act(0, bet('corner', 2_500, [17, 18, 20, 21]));
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(step.chips).toEqual([{ seat: 0, payout: 2_500 }]);
    sim.apply(step);
    expect(sim.stack(0)).toBe(1_000_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The engine, multiplayer

function multi(seats = [0, 1], rng: Rng = seededRng(3)): Sim {
  const cfg = engine.config('american', 'multi');
  const sim = new TableSim(engine, rng, 'multi', seats.map((seat) => ({ seat, stack: 1_000_000 })), cfg) as unknown as Sim;
  sim.started = true;
  return sim;
}

describe('roulette engine, multiplayer', () => {
  it('waits for Start, then opens a betting window with the ball going in before it closes', () => {
    const sim = multi();
    sim.started = false;
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
    sim.started = true;
    sim.advance(0);
    const v = sim.view(0);
    expect(v.phase).toBe('betting');
    expect(v.deadline).toBe(sim.now + BETTING_MS);
    expect(v.launchAt).toBe(v.deadline! - LAUNCH_LEAD_MS);
    expect(sim.act(0, { type: 'spin' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('closes at the deadline, draws the pocket then, and pays every seat', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('straight', 1_000, [17]));
    sim.act(1, bet('black', 2_000));
    sim.advance(BETTING_MS - LAUNCH_LEAD_MS + 500); // the ball is circling; bets still go down
    expect(sim.view(0).phase).toBe('betting');
    sim.act(1, bet('odd', 1_000));
    sim.advance(LAUNCH_LEAD_MS - 500);
    const v = sim.view(1);
    expect(v.phase).toBe('results');
    expect(v.spin!.launchAt).toBe(sim.now - LAUNCH_LEAD_MS);
    expect(v.spin!.restAt).toBe(sim.now + LATE_SPIN_MS);
    expect(v.deadline).toBe(v.spin!.restAt + SETTLE_MS);
    expect(Object.keys(v.settled).sort()).toEqual(['0', '1']);
    const s1 = v.settled[1] as SeatSettle;
    expect(s1.wagered).toBe(3_000);
    expect(sim.stack(1)).toBe(1_000_000 - 3_000 + s1.returned);
    expect(sim.rounds.map((r) => r.seat).sort()).toEqual([0, 1]);
    expect(sim.act(0, bet('red', 500), { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    // results stand, then the next window opens with an empty layout
    sim.advance(LATE_SPIN_MS + SETTLE_MS);
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).bets).toEqual({});
    expect(sim.view(0).round).toBe(2);
  });

  it('closes early when every connected player is ready, and launches the ball then', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('red', 500));
    sim.act(0, { type: 'ready', on: true });
    sim.advance(1_000);
    expect(sim.view(0).phase).toBe('betting'); // seat 1 hasn't said it's done
    sim.act(1, { type: 'ready', on: true });
    sim.advance(0);
    const v = sim.view(0);
    expect(v.phase).toBe('results');
    expect(v.spin!.launchAt).toBe(sim.now);
    expect(v.spin!.restAt).toBe(sim.now + SPIN_MS);
  });

  it('takes back a Ready when that player changes their chips, and resets Ready every spin', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('red', 500));
    sim.act(0, { type: 'ready', on: true });
    expect(sim.view(0).ready).toEqual([0]);
    sim.act(0, bet('black', 500));
    expect(sim.view(0).ready).toEqual([]);
    sim.act(0, { type: 'ready', on: true });
    sim.act(1, { type: 'ready', on: true });
    sim.advance(0);
    sim.advance(SPIN_MS + SETTLE_MS);
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).ready).toEqual([]);
  });

  it("doesn't wait for a disconnected player", () => {
    const sim = new TableSim(engine, seededRng(9), 'multi', [{ seat: 0, stack: 100_000 }, { seat: 1, stack: 100_000, connected: false }], engine.config('american', 'multi')) as unknown as Sim;
    sim.started = true;
    sim.advance(0);
    sim.act(0, bet('red', 500));
    sim.act(0, { type: 'ready', on: true });
    sim.advance(0);
    expect(sim.view(0).phase).toBe('results');
  });

  it('rolls the window over when nobody bets, and rests when the table empties', () => {
    const sim = multi();
    sim.advance(0);
    sim.advance(BETTING_MS);
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).round).toBe(2);
    expect(sim.view(0).spin).toBeNull();
    sim.seats.clear();
    sim.advance(BETTING_MS);
    expect(sim.view(null).phase).toBe('idle');
    expect(engine.deadline(sim.state)).toBeNull();
  });

  it('returns a leaving player’s chips before the spin and not after', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(1, bet('split', 1_000, [0, DOUBLE_ZERO]));
    const step = engine.seatLeaving(sim.state, 1, sim.ctx());
    expect(step.chips).toEqual([{ seat: 1, payout: 1_000 }]);
    sim.apply(step);
    sim.act(1, bet('red', 1_000));
    sim.act(0, bet('red', 1_000));
    sim.advance(BETTING_MS);
    const after = engine.seatLeaving(sim.state, 1, sim.ctx());
    expect(after.chips ?? []).toEqual([]);
  });

  it('shifts every deadline together after a restart', () => {
    const sim = multi();
    sim.advance(0);
    const shifted = engine.shiftDeadlines(sim.state, 30_000);
    expect(shifted.deadline).toBe(sim.state.deadline! + 30_000);
    expect(shifted.launchAt).toBe(sim.state.launchAt! + 30_000);
  });

  it("doesn't hand a new player the last player's rebet", () => {
    const sim = multi([0]);
    sim.advance(0);
    sim.act(0, bet('red', 1_000));
    sim.advance(BETTING_MS);
    sim.advance(LATE_SPIN_MS + SETTLE_MS);
    const seat = sim.seats.get(0)!;
    seat.accountId = 4242;
    sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
    expect(sim.act(0, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
  });

  it('shows every seat everyone’s chips (nothing at a roulette table is hidden)', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('straight', 500, [DOUBLE_ZERO]));
    sim.act(1, bet('column3', 1_000));
    expect(sim.view(0).bets).toEqual(sim.view(1).bets);
    expect(sim.view(null).bets).toEqual({ 0: { 'straight:37': 500 }, 1: { column3: 1_000 } });
  });
});
