import { describe, it, expect } from 'vitest';
import type { Card } from '../src/cards.ts';
import type { GameEvent } from '../src/engine.ts';
import { engine, BETTING_MS, RESULTS_MS, resultsMs, type BaccaratState } from '../src/games/baccarat/engine.ts';
import type { BaccaratView } from '../src/games/baccarat/protocol.ts';
import { CUT_FROM_BOTTOM, burnCount, handTotal, nextDraw, points, seatNumber, settleBets } from '../src/games/baccarat/rules.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<BaccaratState, unknown, BaccaratView>;

function solo(seed: number, stack = 1_000_000): Sim {
  return new TableSim(engine, seededRng(seed), 'solo', [{ seat: 0, stack }]) as Sim;
}

function multi(seed: number, seats: number[], stack = 1_000_000): Sim {
  const sim = new TableSim(engine, seededRng(seed), 'multi', seats.map((seat) => ({ seat, stack }))) as Sim;
  sim.started = true;
  sim.advance(0);
  return sim;
}

const types = (events: unknown[]) => (events as GameEvent[]).map((e) => e.type);

describe('baccarat engine: solo', () => {
  it('bet Banker, deal, settle with exact chip moves and a round result', () => {
    const sim = solo(1);
    sim.act(0, { type: 'bet', banker: 2_500 });
    expect(sim.stack(0)).toBe(997_500);
    expect(engine.liveBets(sim.state, 0)).toBe(2_500);
    sim.act(0, { type: 'deal' });
    const v = sim.view(0);
    expect(v.phase).toBe('results');
    const r = v.results[0]!;
    const expected = { player: 0, banker: 4_875, tie: 2_500 }[v.coup!.winner];
    expect(r.returned).toBe(expected);
    expect(r.commission).toBe(v.coup!.winner === 'banker' ? 125 : 0);
    expect(sim.stack(0)).toBe(997_500 + expected);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 2_500, returned: expected });
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('plays a coup out in the documented order', () => {
    const sim = solo(2);
    sim.act(0, { type: 'bet', player: 1_000 });
    sim.act(0, { type: 'deal' });
    const t = types(sim.lastEvents);
    // A new table shuffles and burns on its first coup.
    expect(t.slice(0, 3)).toEqual(['nomore', 'shuffle', 'burn']);
    const cards = (sim.lastEvents as GameEvent[]).filter((e) => e.type === 'card');
    expect(cards.slice(0, 4).map((e) => [e.hand, e.faceUp])).toEqual([['player', false], ['banker', false], ['player', false], ['banker', false]]);
    for (const e of cards.slice(4)) expect(e.faceUp).toBe(true);
    const reveal = t.indexOf('reveal');
    expect(t.slice(reveal, reveal + 2)).toEqual(['reveal', 'reveal']);
    expect(t.indexOf('outcome')).toBeGreaterThan(reveal);
    expect(t.at(-1)).toBe('result');
  });

  it('refuses bets over the stack, over a maximum or off the dollar step, and a deal with nothing down', () => {
    const sim = solo(3, 5_000);
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'bet', banker: 6_000 }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.act(0, { type: 'bet', banker: 150 }, { allowRefusal: true }).refused).toBe('LIMIT');
    const big = solo(3, 100_000_000);
    expect(big.act(0, { type: 'bet', banker: 500_100 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(big.act(0, { type: 'bet', tie: 100_100 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(big.act(0, { type: 'bet', playerPair: 50_100 }, { allowRefusal: true }).refused).toBe('LIMIT');
    big.act(0, { type: 'bet', banker: 500_000, tie: 100_000, playerPair: 50_000, bankerPair: 50_000 });
    expect(big.act(0, { type: 'bet', banker: 100 }, { allowRefusal: true }).refused).toBe('LIMIT');
  });

  it('is all or nothing: one bad spot refuses the whole bet', () => {
    const sim = solo(4);
    expect(sim.act(0, { type: 'bet', banker: 1_000, tie: 100_100 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.stack(0)).toBe(1_000_000);
    expect(sim.view(0).bets[0]).toBeUndefined();
  });

  it('lets a bet be built from small chips but deals only once it reaches the minimum', () => {
    const sim = solo(5);
    sim.act(0, { type: 'bet', banker: 500 });
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('LIMIT');
    sim.act(0, { type: 'bet', banker: 500 });
    sim.act(0, { type: 'deal' });
    expect(sim.view(0).phase).toBe('results');
  });

  it('undo takes back the last bet action, clear takes back everything', () => {
    const sim = solo(6);
    sim.act(0, { type: 'bet', banker: 2_500 });
    sim.act(0, { type: 'bet', tie: 500, playerPair: 500 });
    expect(sim.stack(0)).toBe(996_500);
    sim.act(0, { type: 'undo' });
    expect(sim.view(0).bets[0]).toEqual({ banker: 2_500 });
    expect(sim.stack(0)).toBe(997_500);
    sim.act(0, { type: 'bet', player: 1_000 });
    sim.act(0, { type: 'clear' });
    expect(sim.view(0).bets[0]).toBeUndefined();
    expect(sim.stack(0)).toBe(1_000_000);
    sim.act(0, { type: 'undo' });
    expect(sim.stack(0)).toBe(1_000_000);
  });

  it('a rebet goes down as one action and undoes as one', () => {
    const sim = solo(7);
    sim.act(0, { type: 'bet', banker: 2_500, tie: 500, bankerPair: 500 });
    expect(sim.view(0).bets[0]).toEqual({ banker: 2_500, tie: 500, bankerPair: 500 });
    sim.act(0, { type: 'undo' });
    expect(sim.stack(0)).toBe(1_000_000);
  });

  it('the first chip after a result opens the next coup and clears the felt', () => {
    const sim = solo(8);
    sim.act(0, { type: 'bet', banker: 1_000 });
    sim.act(0, { type: 'deal' });
    sim.act(0, { type: 'bet', player: 1_000 });
    const v = sim.view(0);
    expect(types(sim.lastEvents)).toEqual(['betting', 'bet']);
    expect(v.phase).toBe('betting');
    expect(v.coup).toBeNull();
    expect(v.results).toEqual({});
    expect(v.history).toHaveLength(1);
  });

  it('rejects malformed actions', () => {
    expect(engine.parseAction({ type: 'bet' })).toBeNull();
    expect(engine.parseAction({ type: 'bet', banker: -100 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', banker: 1.5 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', banker: '100' })).toBeNull();
    expect(engine.parseAction({ type: 'hit' })).toBeNull();
    expect(engine.parseAction(null)).toBeNull();
    expect(engine.parseAction({ type: 'bet', banker: 100, other: 5 })).toEqual({ type: 'bet', bets: { banker: 100 } });
  });
});

describe('baccarat engine: the shoe', () => {
  it('burns by the first card, puts the cut card 16 from the bottom, and plays the last hand before a shuffle', () => {
    const sim = solo(9, 1e12);
    let shuffles = 0;
    let cutSeenAt = -1;
    let coup = 0;
    for (; coup < 400 && shuffles < 3; coup++) {
      sim.act(0, { type: 'bet', banker: 1_000 });
      sim.act(0, { type: 'deal' });
      const ev = sim.lastEvents as GameEvent[];
      const v = sim.view(0);
      const burn = ev.find((e) => e.type === 'burn');
      if (burn) {
        shuffles++;
        // a shuffle comes exactly one coup after the coup that brought out the cut card
        if (shuffles > 1) expect(coup - cutSeenAt).toBe(2);
        expect(burn.count).toBe(burnCount(burn.card as Card));
        expect(v.shoe.burn).toEqual({ card: burn.card, count: burn.count });
        expect(v.history).toHaveLength(1);
        expect(v.shoe.coups).toBe(1);
        const dealt = v.coup!.player.length + v.coup!.banker.length;
        expect(v.shoe.used).toBe(1 + (burn.count as number) + dealt);
        expect(v.shoe.left + v.shoe.used).toBe(416);
      }
      if (ev.some((e) => e.type === 'cutcard')) {
        cutSeenAt = coup;
        expect(v.shoe.left).toBeLessThan(CUT_FROM_BOTTOM);
        expect(v.shoe.left + (ev.filter((e) => e.type === 'card').length)).toBeGreaterThanOrEqual(CUT_FROM_BOTTOM);
        expect(types(ev)).toContain('lasthand');
        expect(v.shoe.lastHand).toBe(true);
      } else if (cutSeenAt >= 0 && cutSeenAt === coup - 1) {
        // the last hand: no cut card, no "last hand" call, and a shuffle is due next
        expect(v.shoe.shuffleNext).toBe(true);
        expect(v.shoe.lastHand).toBe(false);
      }
    }
    expect(shuffles).toBe(3);
  });

  it('every coup it deals follows the tableau', () => {
    const sim = solo(10, 1e12);
    for (let i = 0; i < 1_500; i++) {
      sim.act(0, { type: 'bet', banker: 1_000 });
      sim.act(0, { type: 'deal' });
      const c = sim.view(0).coup!;
      const pv = c.player.slice(0, 2).map(points);
      const bv = c.banker.slice(0, 2).map(points);
      for (let h = nextDraw(pv, bv); h; h = nextDraw(pv, bv)) {
        const cards = h === 'player' ? c.player : c.banker;
        const vals = h === 'player' ? pv : bv;
        expect(cards.length).toBeGreaterThan(vals.length);
        vals.push(points(cards[vals.length]!));
      }
      expect(pv).toHaveLength(c.player.length);
      expect(bv).toHaveLength(c.banker.length);
      expect(c.playerTotal).toBe(handTotal(c.player));
      expect(c.bankerTotal).toBe(handTotal(c.banker));
    }
  });

  it('never shows the shoe order or the face-down burned cards', () => {
    const sim = solo(11, 1e12);
    for (let i = 0; i < 30; i++) {
      sim.act(0, { type: 'bet', banker: 1_000 });
      sim.act(0, { type: 'deal' });
      const json = JSON.stringify({ v: sim.view(0), e: sim.lastEvents, s: engine.view(sim.state, null) });
      expect(json).not.toContain('"cards"');
      expect(json).not.toContain('cutAt');
      const shoe = sim.state.track.shoe!;
      // the next card in the shoe is nowhere in the view (it could only match by coincidence of an
      // identical card already on the felt, so compare against what's actually shown)
      const shown = new Set([...sim.view(0).coup!.player, ...sim.view(0).coup!.banker, sim.view(0).shoe.burn!.card]);
      const next = shoe.cards[shoe.pos]!;
      if (!shown.has(next)) expect(json.includes(`"${next}"`)).toBe(false);
    }
  });
});

describe('baccarat engine: multiplayer', () => {
  it('opens a window on start, closes it at the deadline and deals one coup for everyone', () => {
    const sim = multi(12, [0, 1, 2]);
    expect(sim.view(null).phase).toBe('betting');
    sim.act(0, { type: 'bet', banker: 1_000 });
    sim.act(1, { type: 'bet', player: 2_000, tie: 500 });
    sim.act(2, { type: 'bet', bankerPair: 500 });
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.advance(BETTING_MS);
    const v = sim.view(null);
    expect(v.phase).toBe('results');
    expect(Object.keys(v.results).sort()).toEqual(['0', '1', '2']);
    for (const seat of [0, 1, 2]) expect(v.results[seat]).toEqual(settleBets(v.bets[seat]!, v.coup!));
    // settled from the highest seat number down (seat 2 is "5", seat 0 is "4", seat 1 is "3")
    const order = (sim.lastEvents as GameEvent[]).filter((e) => e.type === 'result').map((e) => seatNumber(e.seat as number));
    expect(order).toEqual([5, 4, 3]);
    expect(sim.rounds).toHaveLength(3);
    expect(sim.act(0, { type: 'bet', banker: 1_000 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    // the results stay up long enough to play the coup out, then the next window opens
    const d = engine.deadline(sim.state)!;
    expect(d - sim.now).toBe(resultsMs(v.coup!, true, 3));
    expect(d - sim.now).toBeGreaterThanOrEqual(RESULTS_MS);
    sim.advance(d - sim.now);
    expect(sim.view(null).phase).toBe('betting');
    expect(sim.view(null).coup).toBeNull();
  });

  it('closes early once every connected player is ready', () => {
    const sim = multi(13, [0, 1]);
    sim.act(0, { type: 'bet', banker: 1_000 });
    sim.seats.get(0)!.ready = true;
    sim.advance(1_000);
    expect(sim.view(null).phase).toBe('betting');
    sim.seats.get(1)!.ready = true;
    sim.advance(1_000);
    expect(sim.view(null).phase).toBe('results');
  });

  it('does not wait for a disconnected player', () => {
    const sim = multi(14, [0, 1]);
    sim.act(0, { type: 'bet', banker: 1_000 });
    sim.seats.get(0)!.ready = true;
    sim.seats.get(1)!.connected = false;
    sim.advance(1_000);
    expect(sim.view(null).phase).toBe('results');
  });

  it('sends back bets under the minimum at the close and deals the rest', () => {
    const sim = multi(15, [0, 1]);
    sim.act(0, { type: 'bet', banker: 500, tie: 500 });
    sim.act(1, { type: 'bet', player: 1_000 });
    sim.advance(BETTING_MS);
    const ev = sim.lastEvents as GameEvent[];
    expect(ev[0]).toMatchObject({ type: 'refund', seat: 0, spot: 'banker', amount: 500 });
    const v = sim.view(null);
    expect(v.bets[0]).toEqual({ tie: 500 });
    expect(v.results[0]!.wagered).toBe(500);
    expect(sim.stack(0)).toBe(1_000_000 - 500 + v.results[0]!.returned);
  });

  it('rolls the window over when nobody bets, and goes idle when the table empties', () => {
    const sim = multi(16, [0]);
    const w = sim.view(null).window;
    sim.advance(BETTING_MS);
    expect(sim.view(null).phase).toBe('betting');
    expect(sim.view(null).window).toBe(w + 1);
    expect(sim.view(null).history).toHaveLength(0);
    sim.act(0, { type: 'bet', player: 1_000 });
    sim.advance(BETTING_MS);
    sim.seats.delete(0);
    sim.advance(60_000);
    expect(sim.view(null).phase).toBe('idle');
  });

  it('a leaving player gets undealt bets back and has nothing live', () => {
    const sim = multi(17, [3]);
    sim.act(3, { type: 'bet', banker: 700, tie: 500 });
    expect(engine.liveBets(sim.state, 3)).toBe(1_200);
    sim.apply(engine.seatLeaving(sim.state, 3, sim.ctx()));
    expect(sim.stack(3)).toBe(1_000_000);
    expect(engine.liveBets(sim.state, 3)).toBe(0);
  });

  it('shifts its deadline and waits for the leader', () => {
    const sim = multi(18, [0]);
    const d = engine.deadline(sim.state)!;
    expect(engine.deadline(engine.shiftDeadlines(sim.state, 20_000))).toBe(d + 20_000);
    const waiting = new TableSim(engine, seededRng(19), 'multi', [{ seat: 0, stack: 10_000 }]) as Sim;
    waiting.advance(0);
    expect(waiting.view(null).phase).toBe('idle');
  });

  it('keeps every stack whole over many coups at a full table', () => {
    const seats = [0, 1, 2, 3, 4, 5, 6];
    const sim = multi(20, seats, 10_000_000);
    const rng = seededRng(21);
    for (let coup = 0; coup < 300; coup++) {
      for (const seat of seats) {
        const pick = rng.next32() % 4;
        if (pick === 0) sim.act(seat, { type: 'bet', banker: 2_500 });
        if (pick === 1) sim.act(seat, { type: 'bet', player: 1_000, playerPair: 500 });
        if (pick === 2) sim.act(seat, { type: 'bet', tie: 500, bankerPair: 500 });
      }
      sim.advance(BETTING_MS);
      sim.advance(60_000);
    }
    const net = new Map<number, number>();
    for (const r of sim.rounds) net.set(r.seat, (net.get(r.seat) ?? 0) + r.returned - r.wagered);
    for (const seat of seats) expect(sim.stack(seat)).toBe(10_000_000 + (net.get(seat) ?? 0));
  });
});
