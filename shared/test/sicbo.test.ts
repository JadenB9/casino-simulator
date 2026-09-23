import { describe, it, expect } from 'vitest';
import {
  type Dice, type Spot, type BetKind,
  spots, spotByKey, rollDice, returnFor, winPays, allRolls, returnOver216, houseEdge, diceTotal, isTriple, countOf,
  spotName, paysLabel, callRoll, describeRoll, sorted, TOTAL_PAYS,
} from '../src/games/sicbo/rules.ts';
import { engine, BETTING_MS, ROLL_MS, SETTLE_MS, HISTORY_LEN, type SicBoState } from '../src/games/sicbo/engine.ts';
import { parseAction, type SicBoView, type SeatSettle } from '../src/games/sicbo/protocol.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

const ALL = [...spots().values()];

/** A generator whose next draws can be queued (a face f comes out of randInt(rng, 6) for f − 1). */
function steerable(seed = 7) {
  const base = seededRng(seed);
  const queue: number[] = [];
  const rng: Rng = { next32: () => (queue.length ? queue.shift()! : base.next32()) };
  return { rng, next: (d: Dice) => queue.push(d[0] - 1, d[1] - 1, d[2] - 1) };
}

// ---------------------------------------------------------------------------------------------
// What every bet should pay, written out from the rules (58 Pa. Code §625a.3, the Wizard of Odds
// Atlantic City table) independently of rules.ts: the k of "k to 1", or null for a loss.

const PAYS_TOTAL: Record<number, number> = { 4: 60, 5: 30, 6: 17, 7: 12, 8: 8, 9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12, 15: 17, 16: 30, 17: 60 };

function expectedPays(key: string, d: Dice): number | null {
  const [a, b, c] = d;
  const sum = a + b + c;
  const trips = a === b && b === c;
  const has = (f: number) => a === f || b === f || c === f;
  const count = (f: number) => [a, b, c].filter((x) => x === f).length;
  const [kind, arg] = key.split(':') as [string, string | undefined];
  const n = Number(arg?.split('-')[0]);
  const m = Number(arg?.split('-')[1]);
  switch (kind) {
    case 'small': return sum >= 4 && sum <= 10 && !trips ? 1 : null;
    case 'big': return sum >= 11 && sum <= 17 && !trips ? 1 : null;
    case 'odd': return sum % 2 === 1 && !trips ? 1 : null;
    case 'even': return sum % 2 === 0 && !trips ? 1 : null;
    case 'total': return sum === n ? PAYS_TOTAL[n]! : null;
    case 'triple': return trips && a === n ? 180 : null;
    case 'anytriple': return trips ? 30 : null;
    case 'double': return count(n) >= 2 ? 10 : null;
    case 'combo': return has(n) && has(m) ? 5 : null;
    case 'single': return count(n) === 0 ? null : count(n);
  }
  throw new Error(key);
}

describe('sic bo spot table', () => {
  it('has the 52 bets of the classic layout, and nothing else', () => {
    const byKind = new Map<BetKind, Spot[]>();
    for (const s of ALL) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
    expect(byKind.get('small')).toHaveLength(1);
    expect(byKind.get('big')).toHaveLength(1);
    expect(byKind.get('odd')).toHaveLength(1);
    expect(byKind.get('even')).toHaveLength(1);
    expect(byKind.get('total')!.map((s) => s.numbers[0])).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(byKind.get('triple')!.map((s) => s.numbers[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(byKind.get('anytriple')).toHaveLength(1);
    expect(byKind.get('double')!.map((s) => s.numbers[0])).toEqual([1, 2, 3, 4, 5, 6]);
    // the 15 pairs of different faces, low face first
    expect(byKind.get('combo')!.map((s) => s.numbers.join('-'))).toEqual(
      ['1-2', '1-3', '1-4', '1-5', '1-6', '2-3', '2-4', '2-5', '2-6', '3-4', '3-5', '3-6', '4-5', '4-6', '5-6'],
    );
    expect(byKind.get('single')!.map((s) => s.numbers[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(spots().size).toBe(52);
    for (const s of ALL) expect(spotByKey(s.key)).toBe(s);
    for (const bad of ['total:3', 'total:18', 'triple:7', 'double:0', 'combo:2-2', 'combo:5-2', 'single:', 'Small', 'any', '', 7, null]) expect(spotByKey(bad)).toBeNull();
  });

  it('prints the standard pays', () => {
    const pays = Object.fromEntries(ALL.map((s) => [s.key, paysLabel(s)]));
    expect(pays).toMatchObject({
      small: '1 to 1', big: '1 to 1', odd: '1 to 1', even: '1 to 1',
      'total:4': '60 to 1', 'total:5': '30 to 1', 'total:6': '17 to 1', 'total:7': '12 to 1', 'total:8': '8 to 1', 'total:9': '6 to 1', 'total:10': '6 to 1',
      'total:11': '6 to 1', 'total:12': '6 to 1', 'total:13': '8 to 1', 'total:14': '12 to 1', 'total:15': '17 to 1', 'total:16': '30 to 1', 'total:17': '60 to 1',
      'triple:6': '180 to 1', anytriple: '30 to 1', 'double:3': '10 to 1', 'combo:2-5': '5 to 1', 'single:4': '1, 2 or 3 to 1',
    });
    expect(TOTAL_PAYS).toEqual(PAYS_TOTAL);
  });

  it('names every bet by what it covers', () => {
    const names = ALL.map(spotName);
    expect(new Set(names).size).toBe(52);
    expect(names).toContain('Small 4-10');
    expect(names).toContain('Total 10');
    expect(names).toContain('Triple 6-6-6');
    expect(names).toContain('Double 5-5');
    expect(names).toContain('Two dice 2-5');
    expect(names).toContain('Single 4');
    expect(names).toContain('Any triple');
  });
});

// ---------------------------------------------------------------------------------------------
// Settlement, exhaustively

describe('sic bo settlement', () => {
  it('pays every bet correctly on every one of the 216 rolls', () => {
    const rolls = allRolls();
    expect(rolls).toHaveLength(216);
    expect(new Set(rolls.map((d) => d.join(''))).size).toBe(216);
    for (const spot of ALL) {
      for (const d of rolls) {
        const k = expectedPays(spot.key, d);
        expect(winPays(spot, d), `${spot.key} on ${d.join('-')}`).toBe(k);
        expect(returnFor(spot, d, 700), `${spot.key} on ${d.join('-')}`).toBe(k === null ? 0 : 700 * (k + 1));
      }
    }
  });

  it('loses Small, Big, Odd and Even to every triple, and pays the totals triples make', () => {
    for (let f = 1; f <= 6; f++) {
      const d: Dice = [f, f, f];
      for (const key of ['small', 'big', 'odd', 'even']) expect(returnFor(spotByKey(key)!, d, 100), `${key} on ${f}s`).toBe(0);
      if (3 * f >= 4 && 3 * f <= 17) expect(returnFor(spotByKey(`total:${3 * f}`)!, d, 100)).toBe(100 * (PAYS_TOTAL[3 * f]! + 1));
      // a triple is also a double of its face, and three of a single number pays 3 to 1
      expect(returnFor(spotByKey(`double:${f}`)!, d, 100)).toBe(1_100);
      expect(returnFor(spotByKey(`single:${f}`)!, d, 100)).toBe(400);
      expect(returnFor(spotByKey(`triple:${f}`)!, d, 100)).toBe(18_100);
      expect(returnFor(spotByKey('anytriple')!, d, 100)).toBe(3_100);
    }
  });

  it('pays a single number by how many dice show it, and a two-dice combination once', () => {
    const single = spotByKey('single:4')!;
    expect(returnFor(single, [4, 1, 2], 100)).toBe(200);
    expect(returnFor(single, [4, 4, 2], 100)).toBe(300);
    expect(returnFor(single, [4, 4, 4], 100)).toBe(400);
    expect(returnFor(single, [1, 2, 3], 100)).toBe(0);
    const combo = spotByKey('combo:2-5')!;
    expect(returnFor(combo, [2, 5, 1], 100)).toBe(600);
    expect(returnFor(combo, [2, 2, 5], 100)).toBe(600);
    expect(returnFor(combo, [5, 2, 5], 100)).toBe(600);
    expect(returnFor(combo, [2, 2, 2], 100)).toBe(0);
    const double = spotByKey('double:3')!;
    expect(returnFor(double, [3, 1, 3], 100)).toBe(1_100);
    expect(returnFor(double, [3, 1, 2], 100)).toBe(0);
  });

  it('wins each bet on the published number of the 216 rolls', () => {
    const wins = (key: string) => allRolls().filter((d) => winPays(spotByKey(key)!, d) !== null).length;
    for (const key of ['small', 'big', 'odd', 'even']) expect(wins(key), key).toBe(105);
    const ways: Record<number, number> = { 4: 3, 5: 6, 6: 10, 7: 15, 8: 21, 9: 25, 10: 27, 11: 27, 12: 25, 13: 21, 14: 15, 15: 10, 16: 6, 17: 3 };
    for (let t = 4; t <= 17; t++) expect(wins(`total:${t}`), `total ${t}`).toBe(ways[t]);
    for (let f = 1; f <= 6; f++) {
      expect(wins(`triple:${f}`)).toBe(1);
      expect(wins(`double:${f}`)).toBe(16);
      // one die 75 ways, two dice 15, all three 1
      const counts = [0, 0, 0, 0];
      for (const d of allRolls()) counts[countOf(d, f)]!++;
      expect(counts).toEqual([125, 75, 15, 1]);
    }
    expect(wins('anytriple')).toBe(6);
    for (const s of ALL.filter((x) => x.kind === 'combo')) expect(wins(s.key), s.key).toBe(30);
  });

  it('has the published house edge for every bet, by exact enumeration of the 216 rolls', () => {
    // units lost per 216 one-unit bets: the house edge is this over 216
    const lost: Record<string, number> = {
      small: 6, big: 6, odd: 6, even: 6,
      'total:4': 33, 'total:5': 30, 'total:6': 36, 'total:7': 21, 'total:8': 27, 'total:9': 41, 'total:10': 27,
      'total:11': 27, 'total:12': 41, 'total:13': 27, 'total:14': 21, 'total:15': 36, 'total:16': 30, 'total:17': 33,
      anytriple: 30,
    };
    for (let f = 1; f <= 6; f++) {
      lost[`triple:${f}`] = 35;
      lost[`double:${f}`] = 40;
      lost[`single:${f}`] = 17;
    }
    for (const s of ALL.filter((x) => x.kind === 'combo')) lost[s.key] = 36;
    expect(Object.keys(lost)).toHaveLength(52);
    for (const s of ALL) {
      expect(216 - returnOver216(s), s.key).toBe(lost[s.key]);
      expect(houseEdge(s)).toBeCloseTo(lost[s.key]! / 216, 12);
    }
    // the Wizard of Odds figures, to the two decimals it prints them
    const pct = (key: string) => (houseEdge(spotByKey(key)!) * 100).toFixed(2);
    expect([pct('small'), pct('big'), pct('odd'), pct('even')]).toEqual(['2.78', '2.78', '2.78', '2.78']);
    expect(['total:4', 'total:5', 'total:6', 'total:7', 'total:8', 'total:9', 'total:10'].map(pct)).toEqual(['15.28', '13.89', '16.67', '9.72', '12.50', '18.98', '12.50']);
    expect(['total:17', 'total:16', 'total:15', 'total:14', 'total:13', 'total:12', 'total:11'].map(pct)).toEqual(['15.28', '13.89', '16.67', '9.72', '12.50', '18.98', '12.50']);
    expect([pct('triple:4'), pct('anytriple'), pct('double:2'), pct('combo:1-6'), pct('single:3')]).toEqual(['16.20', '13.89', '18.52', '16.67', '7.87']);
    const lines = ALL.filter((s) => ['small', 'odd', 'total:4', 'total:7', 'total:9', 'total:10', 'triple:1', 'anytriple', 'double:1', 'combo:1-2', 'single:1'].includes(s.key))
      .map((s) => `${spotName(s).padEnd(14)} ${paysLabel(s).padEnd(15)} ${String(216 - returnOver216(s)).padStart(2)}/216 = ${(houseEdge(s) * 100).toFixed(3)}%`);
    console.log(`sic bo exact house edges\n${lines.join('\n')}`);
  });

  it('draws each die from randInt over all six faces', () => {
    for (const d of allRolls()) {
      const { rng, next } = steerable();
      next(d);
      expect(rollDice(rng)).toEqual(d);
    }
  });

  it('calls the dice lowest first, and names small, big and triples', () => {
    expect(callRoll([5, 2, 3])).toBe('Two, three, five. Ten, small.');
    expect(callRoll([6, 4, 4])).toBe('Four, four, six. Fourteen, big.');
    expect(callRoll([3, 3, 3])).toBe('Three, three, three. Triple threes.');
    expect(callRoll([1, 1, 2])).toBe('One, one, two. Four, small.');
    expect(describeRoll([6, 4, 4])).toEqual({ total: 14, tag: 'BIG', detail: 'BIG · EVEN' });
    expect(describeRoll([1, 2, 4])).toEqual({ total: 7, tag: 'SMALL', detail: 'SMALL · ODD' });
    expect(describeRoll([6, 6, 6])).toMatchObject({ total: 18, tag: 'TRIPLE 6s' });
    expect(sorted([6, 1, 3])).toEqual([1, 3, 6]);
    expect(diceTotal([6, 1, 3])).toBe(10);
    expect(isTriple([2, 2, 2])).toBe(true);
    expect(isTriple([2, 2, 3])).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Parsing

describe('sic bo actions', () => {
  it('parses only well-formed actions', () => {
    expect(parseAction({ type: 'bet', bets: [{ spot: 'total:10', amount: 500 }] })).toEqual({ type: 'bet', bets: [{ spot: 'total:10', amount: 500 }] });
    expect(parseAction({ type: 'bet', bets: [{ spot: 'combo:2-5', amount: 100 }, { spot: 'small', amount: 500 }] })).not.toBeNull();
    expect(parseAction({ type: 'bet', bets: [] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: 'small', amount: 0 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: 'small', amount: 2.5 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: 'small', amount: -100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: 7, amount: 100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: 'x'.repeat(200), amount: 100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: '<b>', amount: 100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: Array.from({ length: 41 }, () => ({ spot: 'big', amount: 500 })) })).toBeNull();
    expect(parseAction({ type: 'rebet', double: 'yes' })).toBeNull();
    expect(parseAction({ type: 'rebet' })).toEqual({ type: 'rebet', double: false });
    expect(parseAction({ type: 'ready', on: true })).toEqual({ type: 'ready', on: true });
    expect(parseAction({ type: 'ready' })).toBeNull();
    expect(parseAction({ type: 'roll' })).toEqual({ type: 'roll' });
    expect(parseAction({ type: 'undo' })).toEqual({ type: 'undo' });
    expect(parseAction({ type: 'clear' })).toEqual({ type: 'clear' });
    expect(parseAction({ type: 'spin' })).toBeNull();
    expect(parseAction(null)).toBeNull();
    expect(parseAction([])).toBeNull();
    // every real spot key gets through the shape check
    for (const s of ALL) expect(parseAction({ type: 'bet', bets: [{ spot: s.key, amount: 100 }] }), s.key).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The engine, single player

type Sim = TableSim<SicBoState, ReturnType<typeof parseAction>, SicBoView>;

function solo(stack = 1_000_000, rng: Rng = seededRng(1)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }], engine.config('', 'solo')) as unknown as Sim;
}

const bet = (spot: string, amount: number) => ({ type: 'bet', bets: [{ spot, amount }] });
/** The smallest legal chip on each spot. */
const minOf = (s: Spot) => (s.limit === 'even' ? 500 : 100);

describe('sic bo engine, single player', () => {
  it('pays every spot through the engine on every roll, and moves exactly those chips', () => {
    for (const d of allRolls()) {
      const { rng, next } = steerable(d[0] * 36 + d[1] * 6 + d[2]);
      const sim = solo(1_000_000, rng);
      const before = sim.stack(0);
      for (let i = 0; i < ALL.length; i += 40) sim.act(0, { type: 'bet', bets: ALL.slice(i, i + 40).map((s) => ({ spot: s.key, amount: minOf(s) })) });
      const staked = ALL.reduce((n, s) => n + minOf(s), 0);
      expect(sim.stack(0)).toBe(before - staked);
      expect(engine.liveBets(sim.state, 0)).toBe(staked);
      next(d);
      sim.act(0, { type: 'roll' });
      const view = sim.view(0);
      expect(view.roll?.dice).toEqual(d);
      const mine = view.settled[0]!;
      let expected = 0;
      for (const [key, amount, returned] of mine.bets) {
        const k = expectedPays(key, d);
        expect(returned, `${key} on ${d.join('-')}`).toBe(k === null ? 0 : amount * (k + 1));
        expected += returned;
      }
      expect(mine.bets).toHaveLength(52);
      expect(mine.wagered).toBe(staked);
      expect(mine.returned).toBe(expected);
      expect(sim.stack(0)).toBe(before - staked + expected);
      expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: staked, returned: expected });
      expect(engine.liveBets(sim.state, 0)).toBe(0);
    }
  });

  it('refuses bets that are not on the layout, and takes none of a placement with one in it', () => {
    const sim = solo(100_000);
    for (const spot of ['total:3', 'total:18', 'triple:0', 'combo:3-3', 'combo:4-2', 'double:7', 'single:9', 'lucky']) {
      expect(sim.act(0, bet(spot, 100), { allowRefusal: true }).refused, spot).toBe('BAD_REQUEST');
    }
    const r = sim.act(0, { type: 'bet', bets: [{ spot: 'small', amount: 1_000 }, { spot: 'combo:3-3', amount: 100 }] }, { allowRefusal: true });
    expect(r.refused).toBe('BAD_REQUEST');
    expect(sim.stack(0)).toBe(100_000);
    expect(sim.view(0).bets).toEqual({});
  });

  it('keeps each kind of bet inside its limits and the table maximum', () => {
    const sim = solo(5_000_000);
    expect(sim.act(0, bet('small', 400), { allowRefusal: true }).refused).toBe('LIMIT'); // even-money minimum $5
    expect(sim.act(0, bet('small', 500_100), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, bet('single:4', 100_100), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, bet('total:4', 50_100), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, bet('combo:1-2', 50_100), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, bet('anytriple', 50_100), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, bet('triple:6', 10_100), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, bet('total:10', 150), { allowRefusal: true }).refused).toBe('LIMIT'); // whole dollars
    sim.act(0, bet('triple:6', 10_000));
    expect(sim.act(0, bet('triple:6', 100), { allowRefusal: true }).refused).toBe('LIMIT'); // $101 on one triple
    sim.act(0, bet('total:4', 50_000));
    sim.act(0, bet('single:4', 100));
    sim.act(0, bet('big', 500_000));
    sim.act(0, bet('small', 439_900)); // $100 + $500 + $1 + $5,000 + $4,399 = $10,000
    expect(sim.act(0, bet('odd', 500), { allowRefusal: true }).refused).toBe('LIMIT'); // table maximum
    expect(sim.act(0, bet('total:10', 100), { allowRefusal: true }).refused).toBe('LIMIT');
    expect(engine.liveBets(sim.state, 0)).toBe(1_000_000);
    expect(sim.stack(0)).toBe(4_000_000);
  });

  it('refuses a bet larger than the stack', () => {
    const sim = solo(2_000);
    expect(sim.act(0, bet('big', 2_500), { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    sim.act(0, bet('big', 2_000));
    expect(sim.act(0, bet('total:9', 100), { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.stack(0)).toBe(0);
  });

  it('undoes the last placement, clears everything, and only shakes with chips down', () => {
    const sim = solo();
    expect(sim.act(0, { type: 'roll' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.act(0, bet('total:10', 500));
    sim.act(0, bet('small', 1_000));
    sim.act(0, bet('total:10', 500));
    expect(sim.view(0).bets[0]).toEqual({ 'total:10': 1_000, small: 1_000 });
    sim.act(0, { type: 'undo' });
    expect(sim.view(0).bets[0]).toEqual({ 'total:10': 500, small: 1_000 });
    expect(sim.stack(0)).toBe(1_000_000 - 1_500);
    sim.act(0, { type: 'clear' });
    expect(sim.view(0).bets[0]).toBeUndefined();
    expect(sim.stack(0)).toBe(1_000_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    sim.act(0, { type: 'undo' }); // nothing to undo is not an error
    expect(sim.act(0, { type: 'roll' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'ready', on: true }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
  });

  it('rebets the last roll, doubles it, and doubles a layout that already has chips', () => {
    const sim = solo();
    expect(sim.act(0, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    sim.act(0, bet('single:4', 500));
    sim.act(0, bet('big', 1_000));
    sim.act(0, { type: 'roll' });
    expect(sim.view(0).phase).toBe('results');
    expect(sim.act(0, { type: 'roll' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.act(0, { type: 'rebet', double: false });
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).round).toBe(2);
    expect(sim.view(0).bets[0]).toEqual({ 'single:4': 500, big: 1_000 });
    sim.act(0, { type: 'rebet', double: true }); // doubles what is on the layout
    expect(sim.view(0).bets[0]).toEqual({ 'single:4': 1_000, big: 2_000 });
    sim.act(0, { type: 'undo' }); // one placement
    expect(sim.view(0).bets[0]).toEqual({ 'single:4': 500, big: 1_000 });
    sim.act(0, { type: 'clear' });
    sim.act(0, { type: 'rebet', double: true }); // empty layout: twice the last roll
    expect(sim.view(0).bets[0]).toEqual({ 'single:4': 1_000, big: 2_000 });
  });

  it('refuses a rebet the stack no longer covers', () => {
    const { rng, next } = steerable();
    const sim = solo(3_000, rng);
    sim.act(0, bet('big', 2_000));
    next([1, 2, 3]);
    sim.act(0, { type: 'roll' });
    expect(sim.stack(0)).toBe(1_000);
    expect(sim.act(0, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.stack(0)).toBe(1_000);
  });

  it('keeps the last 20 rolls, most recent first', () => {
    const { rng, next } = steerable();
    const sim = solo(10_000_000, rng);
    const seen: Dice[] = [];
    for (let i = 0; i < 25; i++) {
      const d: Dice = [(i % 6) + 1, ((i * 5) % 6) + 1, ((i * 7 + 3) % 6) + 1];
      seen.unshift(d);
      sim.act(0, bet('small', 500));
      next(d);
      sim.act(0, { type: 'roll' });
    }
    expect(sim.view(0).history).toEqual(seen.slice(0, HISTORY_LEN));
  });

  it('times the roll from the moment Shake is pressed and never deadlines a single-player table', () => {
    const sim = solo();
    sim.act(0, bet('small', 500));
    sim.act(0, { type: 'roll' });
    const roll = sim.view(0).roll!;
    expect(roll.shakeAt).toBe(sim.now);
    expect(roll.restAt).toBe(sim.now + ROLL_MS);
    expect(engine.deadline(sim.state)).toBeNull();
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
    expect(sim.lastEvents.map((e) => (e as { type: string }).type)).toEqual(['roll', 'settle']);
  });

  it('gives chips back when the player leaves before the shake, and has nothing live after it', () => {
    const sim = solo();
    sim.act(0, bet('combo:2-5', 2_500));
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(step.chips).toEqual([{ seat: 0, payout: 2_500 }]);
    sim.apply(step);
    expect(sim.stack(0)).toBe(1_000_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    sim.act(0, bet('small', 500));
    sim.act(0, { type: 'roll' });
    const after = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(after.chips ?? []).toEqual([]);
    expect(engine.liveBets(after.state, 0)).toBe(0);
  });

  it('never changes the state it is given', () => {
    const sim = solo();
    sim.act(0, bet('small', 500));
    const frozen = JSON.stringify(sim.state);
    engine.act(sim.state, 0, { type: 'bet', bets: [{ spot: 'big', amount: 500 }] }, sim.ctx());
    engine.act(sim.state, 0, { type: 'undo' }, sim.ctx());
    engine.act(sim.state, 0, { type: 'roll' }, sim.ctx());
    engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(JSON.stringify(sim.state)).toBe(frozen);
  });
});

// ---------------------------------------------------------------------------------------------
// The engine, multiplayer

function multi(seats = [0, 1], rng: Rng = seededRng(3)): Sim {
  const sim = new TableSim(engine, rng, 'multi', seats.map((seat) => ({ seat, stack: 1_000_000 })), engine.config('', 'multi')) as unknown as Sim;
  sim.started = true;
  return sim;
}

describe('sic bo engine, multiplayer', () => {
  it('waits for Start, then opens a betting window', () => {
    const sim = multi();
    sim.started = false;
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
    expect(sim.view(0).phase).toBe('idle');
    sim.started = true;
    sim.advance(0);
    const v = sim.view(0);
    expect(v.phase).toBe('betting');
    expect(v.round).toBe(1);
    expect(v.deadline).toBe(sim.now + BETTING_MS);
    expect(engine.deadline(sim.state)).toBe(v.deadline);
    expect(sim.act(0, { type: 'roll' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('closes at the deadline, rolls then, pays every seat, and opens the next window after the results', () => {
    const { rng, next } = steerable(11);
    const sim = multi([0, 1], rng);
    sim.advance(0);
    sim.act(0, bet('total:10', 1_000));
    sim.act(0, bet('small', 2_000));
    sim.act(1, bet('big', 2_000));
    sim.act(1, bet('single:5', 500));
    sim.advance(BETTING_MS - 1);
    expect(sim.view(0).phase).toBe('betting');
    next([5, 2, 3]);
    sim.advance(1);
    const v = sim.view(1);
    expect(v.phase).toBe('results');
    expect(v.roll).toEqual({ round: 1, dice: [5, 2, 3], shakeAt: sim.now, restAt: sim.now + ROLL_MS });
    expect(v.deadline).toBe(sim.now + ROLL_MS + SETTLE_MS);
    const s0 = v.settled[0] as SeatSettle;
    const s1 = v.settled[1] as SeatSettle;
    expect(s0).toEqual({ wagered: 3_000, returned: 7_000 + 4_000, bets: [['total:10', 1_000, 7_000], ['small', 2_000, 4_000]] });
    expect(s1).toEqual({ wagered: 2_500, returned: 1_000, bets: [['big', 2_000, 0], ['single:5', 500, 1_000]] });
    expect(sim.stack(0)).toBe(1_000_000 - 3_000 + 11_000);
    expect(sim.stack(1)).toBe(1_000_000 - 2_500 + 1_000);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 3_000, returned: 11_000 }, { seat: 1, wagered: 2_500, returned: 1_000 }]);
    expect(v.bets).toEqual({});
    // no more bets until the next window
    expect(sim.act(0, bet('small', 500), { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'ready', on: true }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    sim.advance(ROLL_MS + SETTLE_MS - 1);
    expect(sim.view(0).phase).toBe('results');
    sim.advance(1);
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).round).toBe(2);
    expect(sim.view(0).settled).toEqual({});
    expect(sim.view(0).roll?.round).toBe(1); // the last roll stays up for the board
  });

  it('closes early once everyone connected is ready with chips down', () => {
    const sim = multi([0, 1, 2]);
    sim.advance(0);
    sim.act(0, bet('small', 500));
    sim.act(0, { type: 'ready', on: true });
    sim.act(1, { type: 'ready', on: true });
    sim.advance(10);
    expect(sim.view(0).phase).toBe('betting'); // seat 2 hasn't pressed Ready
    sim.seats.get(2)!.connected = false;
    sim.advance(10);
    expect(sim.view(0).phase).toBe('results'); // a dropped player doesn't hold the table up
  });

  it('does not close early on Ready with no chips down, and a bet takes a Ready back', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, { type: 'ready', on: true });
    sim.act(1, { type: 'ready', on: true });
    sim.advance(10);
    expect(sim.view(0).phase).toBe('betting');
    sim.act(0, bet('big', 500));
    expect(sim.view(0).ready).toEqual([1]);
    expect(sim.lastEvents).toEqual([{ type: 'ready', seat: 0, on: false }, { type: 'bet', seat: 0, bets: { big: 500 } }]);
    sim.act(0, { type: 'ready', on: true });
    sim.act(0, { type: 'ready', on: true }); // pressing it twice changes nothing
    sim.advance(10);
    expect(sim.view(0).phase).toBe('results');
  });

  it('opens a fresh window when nobody bet, and rests when the table empties', () => {
    const sim = multi();
    sim.advance(0);
    sim.advance(BETTING_MS);
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).round).toBe(2);
    expect(sim.view(0).roll).toBeNull();
    sim.seats.clear();
    sim.advance(BETTING_MS);
    expect(sim.view(null).phase).toBe('idle');
    expect(engine.deadline(sim.state)).toBeNull();
  });

  it('gives a leaving player their chips back before the close, and keeps the others in play', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('triple:6', 1_000));
    sim.act(1, bet('small', 500));
    sim.act(0, { type: 'ready', on: true });
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(step.chips).toEqual([{ seat: 0, payout: 1_000 }]);
    sim.apply(step);
    expect(sim.view(1).bets).toEqual({ 1: { small: 500 } });
    expect(sim.view(1).ready).toEqual([]);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(sim.stack(0)).toBe(1_000_000);
  });

  it('moves every deadline when the host restarts', () => {
    const sim = multi();
    sim.advance(0);
    const d = engine.deadline(sim.state)!;
    expect(engine.deadline(engine.shiftDeadlines(sim.state, 30_000))).toBe(d + 30_000);
    const idle = engine.create(engine.config('', 'multi'), sim.ctx());
    expect(engine.shiftDeadlines(idle, 30_000)).toBe(idle);
  });

  it("doesn't hand a new player the seat's old Rebet", () => {
    const sim = multi();
    sim.advance(0);
    sim.act(1, bet('big', 500));
    sim.advance(BETTING_MS);
    sim.advance(ROLL_MS + SETTLE_MS);
    expect(sim.view(1).canRebet).toEqual([1]);
    sim.seats.get(1)!.accountId = 4242;
    sim.apply(engine.seatJoined(sim.state, 1, sim.ctx()));
    expect(sim.view(1).canRebet).toEqual([]);
    expect(sim.act(1, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
  });

  it('shows every seat the same public view', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('total:9', 300));
    sim.act(1, bet('combo:1-6', 200));
    expect(sim.view(0)).toEqual(sim.view(1));
    expect(sim.view(null)).toEqual(sim.view(0));
    expect(sim.view(0).bets).toEqual({ 0: { 'total:9': 300 }, 1: { 'combo:1-6': 200 } });
  });
});
