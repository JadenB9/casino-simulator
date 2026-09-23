import { describe, it, expect } from 'vitest';
import { WHEEL, SPOTS, STOPS, SYMBOLS, type SymbolId, spotOf, isSymbol, drawStop, symbolAt, returnFor, edgeOf, edgePercent, paysLabel, callFor } from '../src/games/bigsix/rules.ts';
import { engine, BETTING_MS, SPIN_MS, SETTLE_MS, HISTORY_LEN, type BigSixState } from '../src/games/bigsix/engine.ts';
import { parseAction, type BigSixAction, type BigSixView, type SeatSettle } from '../src/games/bigsix/protocol.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim, type SimSeat } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<BigSixState, BigSixAction, BigSixView>;

const stops = Array.from({ length: STOPS }, (_, i) => i);

/** An Rng whose next draw lands on `stop` (randInt keeps x % n for any x below its rejection limit). */
function forced(stop: number): Rng {
  return { next32: () => stop };
}

/** A generator whose next results can be queued, falling back to a seeded stream. */
function steerable(seed = 7) {
  const base = seededRng(seed);
  const queue: number[] = [];
  const rng: Rng = { next32: () => (queue.length ? queue.shift()! : base.next32()) };
  return { rng, next: (stop: number) => queue.push(stop) };
}

/** The first stop carrying `key`. */
const stopOf = (key: SymbolId) => WHEEL.indexOf(key);

function solo(stack = 1_000_000, rng: Rng = seededRng(3)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]);
}

function multi(seats: number[] = [0, 1], rng: Rng = seededRng(5)): Sim {
  const list: SimSeat[] = seats.map((seat) => ({ seat, stack: 1_000_000 }));
  const sim = new TableSim(engine, rng, 'multi', list);
  sim.started = true;
  return sim;
}

const bet = (spot: string, amount: number) => ({ type: 'bet', bets: [{ spot, amount }] });

// ---------------------------------------------------------------------------------------------
// The wheel

describe('big six wheel', () => {
  it('has 54 stops with the Las Vegas counts: 24 × $1, 15 × $2, 7 × $5, 4 × $10, 2 × $20, a Star and a Crown', () => {
    expect(WHEEL).toHaveLength(54);
    expect(STOPS).toBe(54);
    const count = (k: SymbolId) => WHEEL.filter((x) => x === k).length;
    expect(SYMBOLS.map(count)).toEqual([24, 15, 7, 4, 2, 1, 1]);
    for (const spot of SPOTS) expect(count(spot.key)).toBe(spot.stops);
  });

  it('is the 58 Pa. Code §619a.1 order with its one $5 between two $2s printed as a $1', () => {
    const pa = [
      'star', 'one', 'two', 'one', 'five', 'two', 'one', 'ten', 'one', 'five', 'one', 'two', 'one', 'twenty',
      'one', 'two', 'one', 'five', 'two', 'one', 'ten', 'one', 'two', 'five', 'one', 'two', 'one', 'crown',
      'two', 'five', 'two', 'one', 'two', 'one', 'ten', 'one', 'five', 'one', 'two', 'one', 'twenty', 'one',
      'two', 'one', 'five', 'two', 'one', 'ten', 'one', 'two', 'five', 'one', 'two', 'one',
    ];
    expect(pa).toHaveLength(54);
    // Pennsylvania's wheel carries 23 × $1 and 8 × $5; one $5 printed as a $1 gives the Las Vegas counts
    expect(pa.filter((x) => x === 'one')).toHaveLength(23);
    expect(pa.filter((x) => x === 'five')).toHaveLength(8);
    const changed = stops.filter((i) => WHEEL[i] !== pa[i]);
    expect(changed).toEqual([29]);
    expect(pa[28]).toBe('two');
    expect(pa[29]).toBe('five');
    expect(pa[30]).toBe('two');
    expect(WHEEL[29]).toBe('one');
  });

  it('never puts two $1 stops side by side, and sets the pictures and the $20s opposite each other', () => {
    for (const i of stops) expect(WHEEL[i] === 'one' && WHEEL[(i + 1) % STOPS] === 'one').toBe(false);
    expect(stopOf('crown') - stopOf('star')).toBe(27);
    const twenties = stops.filter((i) => WHEEL[i] === 'twenty');
    expect(twenties[1]! - twenties[0]!).toBe(27);
    const tens = stops.filter((i) => WHEEL[i] === 'ten');
    expect([tens[2]! - tens[0]!, tens[3]! - tens[1]!]).toEqual([27, 27]);
  });

  it('reads the symbol at any stop, wrapping round', () => {
    expect(symbolAt(0)).toBe('star');
    expect(symbolAt(27)).toBe('crown');
    expect(symbolAt(54)).toBe('star');
    expect(symbolAt(-1)).toBe('one');
  });

  it('draws stops from randInt over the whole wheel', () => {
    for (const i of stops) expect(drawStop(forced(i))).toBe(i);
    // a draw at or above the rejection limit is thrown away
    const limit = 2 ** 32 - (2 ** 32 % 54);
    let calls = 0;
    const rng: Rng = { next32: () => (calls++ === 0 ? limit : 13) };
    expect(drawStop(rng)).toBe(13);
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// The paytable

describe('big six paytable', () => {
  it('lays out the seven spots in order and pays the number to 1, 40 to 1 on the pictures', () => {
    expect(SPOTS.map((s) => [s.key, s.name, s.pays])).toEqual([
      ['one', '$1', 1],
      ['two', '$2', 2],
      ['five', '$5', 5],
      ['ten', '$10', 10],
      ['twenty', '$20', 20],
      ['star', 'Star', 40],
      ['crown', 'Crown', 40],
    ]);
    expect(SPOTS.map(paysLabel)).toEqual(['1 to 1', '2 to 1', '5 to 1', '10 to 1', '20 to 1', '40 to 1', '40 to 1']);
  });

  it('pays every spot correctly on every stop (exhaustive)', () => {
    for (const spot of SPOTS) {
      for (const i of stops) {
        const back = returnFor(spot.key, i, 700);
        expect(back).toBe(WHEEL[i] === spot.key ? 700 * (spot.pays + 1) : 0);
      }
    }
  });

  it('pays the Star only on the Star and the Crown only on the Crown', () => {
    expect(returnFor('star', stopOf('star'), 100)).toBe(4_100);
    expect(returnFor('star', stopOf('crown'), 100)).toBe(0);
    expect(returnFor('crown', stopOf('crown'), 100)).toBe(4_100);
    expect(returnFor('crown', stopOf('star'), 100)).toBe(0);
    // the $20 bet pays on both $20 stops and nothing else
    expect(stops.filter((i) => returnFor('twenty', i, 1) > 0).map((i) => WHEEL[i])).toEqual(['twenty', 'twenty']);
  });

  it('has the published edge for every spot, by exact enumeration of the 54 stops', () => {
    const published: Record<SymbolId, [number, string]> = {
      one: [6, '11.111'],
      two: [9, '16.667'],
      five: [12, '22.222'],
      ten: [10, '18.519'],
      twenty: [12, '22.222'],
      star: [13, '24.074'],
      crown: [13, '24.074'],
    };
    for (const spot of SPOTS) {
      // total net over one of each stop, on a 1-unit bet: exactly −(edge × 54)
      const net = stops.reduce((n, i) => n + returnFor(spot.key, i, 1) - 1, 0);
      expect(-net).toBe(published[spot.key][0]);
      expect(edgeOf(spot)).toEqual({ num: published[spot.key][0], den: 54 });
      expect(edgePercent(spot).toFixed(3)).toBe(published[spot.key][1]);
    }
  });

  it('ranks the $1 lowest and the Star and Crown highest (what the tips say)', () => {
    const byEdge = [...SPOTS].sort((a, b) => edgePercent(a) - edgePercent(b)).map((s) => s.key);
    expect(byEdge[0]).toBe('one');
    expect(byEdge.slice(-2).sort()).toEqual(['crown', 'star']);
    for (const s of SPOTS) if (s.key !== 'star' && s.key !== 'crown') expect(edgePercent(s)).toBeLessThan(edgePercent(spotOf('star')!));
  });

  it('calls the stop the way a dealer does', () => {
    expect(SYMBOLS.map(callFor)).toEqual(['One dollar', 'Two dollars', 'Five dollars', 'Ten dollars', 'Twenty dollars', 'The Star', 'The Crown']);
  });

  it('parses only well-formed actions', () => {
    expect(parseAction({ type: 'bet', bets: [{ spot: 'twenty', amount: 500 }] })).toEqual({ type: 'bet', bets: [{ spot: 'twenty', amount: 500 }] });
    expect(parseAction({ type: 'bet', bets: [{ spot: 'joker', amount: 500 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: 'one', amount: 0 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: 'one', amount: 1.5 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [{ spot: 'one', amount: -100 }] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: [] })).toBeNull();
    expect(parseAction({ type: 'bet', bets: Array.from({ length: 15 }, () => ({ spot: 'one', amount: 100 })) })).toBeNull();
    expect(parseAction({ type: 'bet', bets: 'one' })).toBeNull();
    expect(parseAction({ type: 'rebet' })).toEqual({ type: 'rebet', double: false });
    expect(parseAction({ type: 'rebet', double: true })).toEqual({ type: 'rebet', double: true });
    expect(parseAction({ type: 'rebet', double: 'yes' })).toBeNull();
    expect(parseAction({ type: 'ready', on: true })).toEqual({ type: 'ready', on: true });
    expect(parseAction({ type: 'ready' })).toBeNull();
    for (const t of ['undo', 'clear', 'spin']) expect(parseAction({ type: t })).toEqual({ type: t });
    expect(parseAction({ type: 'deal' })).toBeNull();
    expect(parseAction(null)).toBeNull();
    expect(parseAction([{ type: 'spin' }])).toBeNull();
    expect(isSymbol('__proto__')).toBe(false);
    expect(isSymbol('constructor')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The engine, single player

describe('big six engine, single player', () => {
  it('pays every spot through the engine on every stop, and moves exactly those chips', () => {
    for (const i of stops) {
      const sim = solo(1_000_000, forced(i));
      sim.act(0, { type: 'bet', bets: SPOTS.map((s) => ({ spot: s.key, amount: 1_000 })) });
      expect(sim.stack(0)).toBe(1_000_000 - 7_000);
      sim.act(0, { type: 'spin' });
      const v = sim.view(0);
      expect(v.spin!.stop).toBe(i);
      expect(v.spin!.symbol).toBe(WHEEL[i]);
      const settled = v.settled[0] as SeatSettle;
      const hit = spotOf(WHEEL[i]!)!;
      expect(settled.wagered).toBe(7_000);
      expect(settled.returned).toBe(1_000 * (hit.pays + 1));
      for (const [key, amount, back] of settled.bets) expect(back).toBe(key === hit.key ? amount * (hit.pays + 1) : 0);
      expect(sim.stack(0)).toBe(1_000_000 - 7_000 + 1_000 * (hit.pays + 1));
      expect(sim.rounds).toEqual([{ seat: 0, wagered: 7_000, returned: 1_000 * (hit.pays + 1) }]);
      expect(sim.lastEvents.map((e) => (e as { type: string }).type)).toEqual(['spin', 'settle']);
    }
  });

  it('adds up chips on a spot and lists them in layout order', () => {
    const sim = solo();
    sim.act(0, bet('crown', 100));
    sim.act(0, bet('one', 500));
    sim.act(0, { type: 'bet', bets: [{ spot: 'one', amount: 100 }, { spot: 'ten', amount: 2_500 }, { spot: 'one', amount: 100 }] });
    expect(sim.view(0).bets[0]).toEqual({ one: 700, ten: 2_500, crown: 100 });
    expect(Object.keys(sim.view(0).bets[0]!)).toEqual(['one', 'ten', 'crown']);
    expect(engine.liveBets(sim.state, 0)).toBe(3_300);
  });

  it('keeps each spot between $1 and $500 and a player under the $2,500 table maximum', () => {
    const sim = solo(10_000_000);
    expect(sim.act(0, bet('one', 50), { allowRefusal: true }).refused).toBe('LIMIT'); // below $1 and off the $1 step
    expect(sim.act(0, bet('one', 150), { allowRefusal: true }).refused).toBe('LIMIT'); // off step
    sim.act(0, bet('one', 50_000));
    expect(sim.act(0, bet('one', 100), { allowRefusal: true }).refused).toBe('LIMIT'); // spot maximum
    sim.act(0, bet('two', 50_000));
    sim.act(0, bet('five', 50_000));
    sim.act(0, bet('ten', 50_000));
    sim.act(0, bet('twenty', 50_000));
    expect(engine.liveBets(sim.state, 0)).toBe(250_000);
    expect(sim.act(0, bet('star', 100), { allowRefusal: true }).refused).toBe('LIMIT'); // table maximum
    expect(sim.stack(0)).toBe(10_000_000 - 250_000);
  });

  it('refuses a bet larger than the stack, and all chips of a placement together', () => {
    const sim = solo(2_000);
    expect(sim.act(0, bet('one', 2_500), { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    const r = sim.act(0, { type: 'bet', bets: [{ spot: 'one', amount: 1_500 }, { spot: 'two', amount: 60_000 }] }, { allowRefusal: true });
    expect(r.refused).toBe('LIMIT');
    expect(sim.stack(0)).toBe(2_000);
    expect(sim.view(0).bets).toEqual({});
  });

  it('undoes the last placement, clears everything, and only spins with chips down', () => {
    const sim = solo();
    expect(sim.act(0, { type: 'spin' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.act(0, bet('twenty', 500));
    sim.act(0, bet('one', 1_000));
    sim.act(0, bet('twenty', 500));
    expect(sim.view(0).bets[0]).toEqual({ one: 1_000, twenty: 1_000 });
    sim.act(0, { type: 'undo' });
    expect(sim.view(0).bets[0]).toEqual({ one: 1_000, twenty: 500 });
    expect(sim.stack(0)).toBe(1_000_000 - 1_500);
    sim.act(0, { type: 'clear' });
    expect(sim.view(0).bets[0]).toBeUndefined();
    expect(sim.stack(0)).toBe(1_000_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    sim.act(0, { type: 'undo' }); // nothing to undo is not an error
    expect(sim.act(0, { type: 'spin' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'ready', on: true }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
  });

  it('rebets the last spin, doubles it, and doubles a layout that already has chips', () => {
    const sim = solo();
    expect(sim.act(0, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    sim.act(0, bet('five', 500));
    sim.act(0, bet('star', 100));
    sim.act(0, { type: 'spin' });
    expect(sim.view(0).phase).toBe('results');
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    sim.act(0, { type: 'rebet', double: false });
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).round).toBe(2);
    expect(sim.view(0).bets[0]).toEqual({ five: 500, star: 100 });
    sim.act(0, { type: 'rebet', double: true }); // doubles what is on the layout
    expect(sim.view(0).bets[0]).toEqual({ five: 1_000, star: 200 });
    sim.act(0, { type: 'undo' }); // one placement
    expect(sim.view(0).bets[0]).toEqual({ five: 500, star: 100 });
    sim.act(0, { type: 'clear' });
    sim.act(0, { type: 'rebet', double: true }); // empty layout: twice the last spin
    expect(sim.view(0).bets[0]).toEqual({ five: 1_000, star: 200 });
  });

  it('refuses a rebet the stack no longer covers', () => {
    const { rng, next } = steerable();
    const sim = solo(3_000, rng);
    sim.act(0, bet('ten', 2_000));
    next(stopOf('one'));
    sim.act(0, { type: 'spin' });
    expect(sim.stack(0)).toBe(1_000);
    expect(sim.act(0, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.stack(0)).toBe(1_000);
  });

  it('keeps the last 20 stops, most recent first', () => {
    const { rng, next } = steerable();
    const sim = solo(10_000_000, rng);
    const hits: number[] = [];
    for (let i = 0; i < 25; i++) {
      const stop = (i * 11) % STOPS;
      hits.unshift(stop);
      sim.act(0, bet('one', 500));
      next(stop);
      sim.act(0, { type: 'spin' });
    }
    expect(HISTORY_LEN).toBe(20);
    expect(sim.view(0).history).toEqual(hits.slice(0, 20));
  });

  it('times the spin from the moment it is pressed and never deadlines a single-player table', () => {
    const sim = solo();
    sim.act(0, bet('one', 500));
    sim.act(0, { type: 'spin' });
    const spin = sim.view(0).spin!;
    expect(spin.startAt).toBe(sim.now);
    expect(spin.restAt).toBe(sim.now + SPIN_MS);
    expect(engine.deadline(sim.state)).toBeNull();
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
  });

  it('gives chips back when the player leaves before the spin', () => {
    const sim = solo();
    sim.act(0, bet('two', 2_000));
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(step.chips).toEqual([{ seat: 0, payout: 2_000 }]);
    sim.apply(step);
    expect(sim.stack(0)).toBe(1_000_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(sim.view(0).bets).toEqual({});
  });

  it('refuses a player who is not seated', () => {
    const sim = solo();
    const r = engine.act(sim.state, 3, { type: 'bet', bets: [{ spot: 'one', amount: 100 }] }, sim.ctx());
    expect(r).toMatchObject({ refuse: 'NOT_SEATED' });
  });

  it('never changes the state it was given', () => {
    const sim = solo();
    sim.act(0, bet('one', 500));
    const before = structuredClone(sim.state);
    engine.act(sim.state, 0, { type: 'spin' }, sim.ctx());
    engine.act(sim.state, 0, { type: 'bet', bets: [{ spot: 'star', amount: 100 }] }, sim.ctx());
    engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(sim.state).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// The engine, multiplayer

describe('big six engine, multiplayer', () => {
  it('waits for Start, then opens a 20 second betting window', () => {
    const sim = multi();
    sim.started = false;
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
    expect(sim.view(0).phase).toBe('idle');
    sim.started = true;
    sim.advance(0);
    const v = sim.view(0);
    expect(v.phase).toBe('betting');
    expect(v.deadline).toBe(sim.now + BETTING_MS);
    expect(sim.lastEvents).toEqual([{ type: 'betting', round: 1, deadline: sim.now + BETTING_MS }]);
    expect(sim.act(0, { type: 'spin' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('closes at the deadline, draws the stop then, and pays every seat', () => {
    const { rng, next } = steerable();
    const sim = multi([0, 1], rng);
    sim.advance(0);
    sim.act(0, bet('twenty', 1_000));
    sim.act(1, bet('one', 2_000));
    sim.act(1, bet('twenty', 500));
    sim.advance(BETTING_MS - 1);
    expect(sim.view(0).phase).toBe('betting');
    next(stopOf('twenty'));
    sim.advance(1);
    const v = sim.view(1);
    expect(v.phase).toBe('results');
    expect(v.spin).toEqual({ round: 1, stop: stopOf('twenty'), symbol: 'twenty', startAt: sim.now, restAt: sim.now + SPIN_MS });
    expect(v.deadline).toBe(v.spin!.restAt + SETTLE_MS);
    expect(v.settled[0]).toEqual({ wagered: 1_000, returned: 21_000, bets: [['twenty', 1_000, 21_000]] });
    expect(v.settled[1]).toEqual({ wagered: 2_500, returned: 10_500, bets: [['one', 2_000, 0], ['twenty', 500, 10_500]] });
    expect(sim.stack(0)).toBe(1_000_000 + 20_000);
    expect(sim.stack(1)).toBe(1_000_000 + 8_000);
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 1_000, returned: 21_000 },
      { seat: 1, wagered: 2_500, returned: 10_500 },
    ]);
    expect(sim.act(0, bet('one', 500), { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'ready', on: true }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    // results stand while the wheel slows and the table is paid, then the next window opens
    sim.advance(SPIN_MS + SETTLE_MS - 1);
    expect(sim.view(0).phase).toBe('results');
    sim.advance(1);
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).bets).toEqual({});
    expect(sim.view(0).round).toBe(2);
    expect(sim.view(0).history).toEqual([stopOf('twenty')]);
  });

  it('closes early when every connected player is ready', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('one', 500));
    sim.act(0, { type: 'ready', on: true });
    sim.advance(1_000);
    expect(sim.view(0).phase).toBe('betting'); // seat 1 hasn't said it's done
    sim.act(1, { type: 'ready', on: true }); // sitting this one out is fine
    sim.advance(0);
    const v = sim.view(0);
    expect(v.phase).toBe('results');
    expect(v.spin!.startAt).toBe(sim.now);
    expect(v.spin!.restAt).toBe(sim.now + SPIN_MS);
    expect(Object.keys(v.settled)).toEqual(['0']);
  });

  it("doesn't close early when everyone is ready but nobody has a bet down", () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, { type: 'ready', on: true });
    sim.act(1, { type: 'ready', on: true });
    sim.advance(1_000);
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).round).toBe(1);
  });

  it('takes back a Ready when that player changes their chips, and resets Ready every spin', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('one', 500));
    sim.act(0, { type: 'ready', on: true });
    expect(sim.view(0).ready).toEqual([0]);
    sim.act(0, bet('two', 500));
    expect(sim.view(0).ready).toEqual([]);
    expect(sim.lastEvents).toContainEqual({ type: 'ready', seat: 0, on: false });
    sim.act(0, { type: 'ready', on: true });
    sim.act(0, { type: 'ready', on: true }); // pressing it twice changes nothing
    sim.act(1, { type: 'ready', on: true });
    sim.advance(0);
    expect(sim.view(0).phase).toBe('results');
    sim.advance(SPIN_MS + SETTLE_MS);
    expect(sim.view(0).phase).toBe('betting');
    expect(sim.view(0).ready).toEqual([]);
  });

  it("doesn't wait for a disconnected player", () => {
    const sim = new TableSim(engine, seededRng(9), 'multi', [{ seat: 0, stack: 100_000 }, { seat: 1, stack: 100_000, connected: false }]);
    sim.started = true;
    sim.advance(0);
    sim.act(0, bet('one', 500));
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
    expect(sim.lastEvents).toEqual([{ type: 'idle' }]);
  });

  it('rests after the results when everyone has gone', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('one', 500));
    sim.advance(BETTING_MS);
    expect(sim.view(0).phase).toBe('results');
    sim.seats.clear();
    sim.advance(SPIN_MS + SETTLE_MS);
    expect(sim.view(null).phase).toBe('idle');
  });

  it('returns a leaving player’s chips before the spin and not after', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(1, bet('star', 1_000));
    sim.act(1, { type: 'ready', on: true });
    const step = engine.seatLeaving(sim.state, 1, sim.ctx());
    expect(step.chips).toEqual([{ seat: 1, payout: 1_000 }]);
    sim.apply(step);
    expect(sim.view(0).ready).toEqual([]);
    expect(engine.liveBets(sim.state, 1)).toBe(0);
    sim.act(1, bet('one', 1_000));
    sim.act(0, bet('one', 1_000));
    sim.advance(BETTING_MS);
    const after = engine.seatLeaving(sim.state, 1, sim.ctx());
    expect(after.chips ?? []).toEqual([]);
  });

  it('shifts the deadline after a restart', () => {
    const sim = multi();
    sim.advance(0);
    const shifted = engine.shiftDeadlines(sim.state, 30_000);
    expect(shifted.deadline).toBe(sim.state.deadline! + 30_000);
    const idle = engine.create(engine.config('', 'multi'), sim.ctx());
    expect(engine.shiftDeadlines(idle, 30_000)).toBe(idle);
  });

  it("doesn't hand a new player the last player's rebet", () => {
    const sim = multi([0]);
    sim.advance(0);
    sim.act(0, bet('one', 1_000));
    sim.advance(BETTING_MS);
    sim.advance(SPIN_MS + SETTLE_MS);
    expect(sim.view(0).canRebet).toEqual([0]);
    const seat = sim.seats.get(0)!;
    seat.accountId = 4242;
    sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
    expect(sim.view(0).canRebet).toEqual([]);
    expect(sim.act(0, { type: 'rebet', double: false }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
  });

  it('shows every seat everyone’s chips (nothing at a Big Six table is hidden)', () => {
    const sim = multi();
    sim.advance(0);
    sim.act(0, bet('crown', 500));
    sim.act(1, bet('five', 1_000));
    expect(sim.view(0)).toEqual(sim.view(1));
    expect(sim.view(null).bets).toEqual({ 0: { crown: 500 }, 1: { five: 1_000 } });
    // and no result exists until betting closes
    expect(sim.view(null).spin).toBeNull();
  });

  it('seats eight players and uses the table defaults', () => {
    const cfg = engine.config('', 'multi');
    expect(cfg.maxSeats).toBe(8);
    expect(engine.config('', 'solo').maxSeats).toBe(1);
    expect(cfg.limits.spot).toEqual({ min: 100, max: 50_000, step: 100 });
    expect(cfg.limits.default.max).toBe(250_000);
    expect(engine.seats).toEqual({ min: 1, max: 8, multiplayer: true });
  });
});
