import { describe, it, expect } from 'vitest';
import {
  engine,
  botStats,
  START_MS,
  ACT_MS,
  BANK_START_MS,
  BIG_BLIND,
  SMALL_BLIND,
  type HoldemState,
  type HoldemView,
  type HoldemAction,
} from '../src/games/holdem/engine.ts';
import { potTotal } from '../src/games/holdem/rules.ts';
import { intCard } from '../src/games/holdem/eval.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { type Rng, randInt, randUnit } from '../src/rng.ts';
import type { Cents } from '../src/money.ts';

type Sim = TableSim<HoldemState, HoldemAction, HoldemView>;

function solo(seed: number, stack = 100_000): Sim {
  return new TableSim(engine, seededRng(seed), 'solo', [{ seat: 0, stack }]);
}

function multi(seed: number, seats: { seat: number; stack: number }[]): Sim {
  const sim = new TableSim(engine, seededRng(seed), 'multi', seats);
  sim.started = true;
  return sim;
}

/** Advance the clock to the table's next deadline, once. */
function step(sim: Sim): boolean {
  const d = engine.deadline(sim.state);
  if (d === null) {
    sim.advance(0);
    return engine.deadline(sim.state) !== null;
  }
  sim.advance(Math.max(0, d - sim.now));
  return true;
}

/** Run the table until `pred` holds (or give up). */
function until(sim: Sim, pred: () => boolean, max = 500): boolean {
  for (let i = 0; i < max; i++) {
    if (pred()) return true;
    if (!step(sim)) return pred();
  }
  return pred();
}

/** Play people's turns with a passive strategy (check, else call) until `pred` holds. */
function playUntil(sim: Sim, pred: () => boolean, max = 5_000, skip: number[] = []): boolean {
  for (let i = 0; i < max; i++) {
    if (pred()) return true;
    const t = turnOf(sim);
    if (t !== null && !skip.includes(t)) {
      const l = (sim.view(t) as HoldemView).you!.legal!;
      sim.act(t, l.check ? { type: 'check' } : { type: 'call' });
    } else if (!step(sim)) return pred();
  }
  return pred();
}

const turnOf = (sim: Sim) => (sim.state.phase === 'playing' ? (sim.state.hand?.toAct ?? null) : null);
const seatView = (sim: Sim, viewer: number) => sim.view(viewer) as HoldemView;

/** In the pot right now (0 once a hand is paid out). */
function inPot(s: HoldemState): Cents {
  return s.hand && (s.phase === 'playing' || s.phase === 'runout') ? potTotal(s.hand) : 0;
}

function botStacks(s: HoldemState): Cents {
  return Object.values(s.seats)
    .filter((st) => st.bot)
    .reduce((a, st) => a + st.stack, 0);
}

function randomAction(v: HoldemView, rng: Rng): HoldemAction {
  const l = v.you!.legal!;
  const u = randUnit(rng);
  const pickTo = (r: { min: number; max: number }) => {
    if (randUnit(rng) < 0.15) return r.max;
    const steps = Math.floor((r.max - r.min) / l.step);
    return Math.min(r.max, r.min + randInt(rng, Math.min(steps, 30) + 1) * l.step);
  };
  if (u < 0.06) return { type: 'allin' };
  if (u < 0.3 && l.bet) return { type: 'bet', amount: pickTo(l.bet) };
  if (u < 0.3 && l.raise) return { type: 'raise', to: pickTo(l.raise) };
  if (u < 0.55 && l.fold) return { type: 'fold' };
  if (l.check) return { type: 'check' };
  return { type: 'call' };
}

describe('holdem engine: single player against bots', () => {
  it('seats five bots with house chips around the player, and deals once the player is seated', () => {
    const sim = solo(1);
    const v = seatView(sim, 0);
    expect(v.maxSeats).toBe(6);
    expect(v.seats[0]?.bot).toBe(false);
    for (let s = 1; s < 6; s++) {
      expect(v.seats[s]?.bot).toBe(true);
      expect(v.seats[s]!.stack).toBeGreaterThanOrEqual(60 * BIG_BLIND);
    }
    expect(new Set(v.seats.map((x) => x?.name)).size).toBe(6);
    expect(sim.state.house).toBe(botStacks(sim.state));
    sim.advance(0);
    expect(engine.deadline(sim.state)).toBe(sim.now + START_MS);
    sim.advance(START_MS);
    expect(sim.state.phase).toBe('playing');
    expect(sim.state.hand!.players).toHaveLength(6);
  });

  it('shows the player only their own hole cards, and never a bot’s or the deck', () => {
    const sim = solo(2);
    until(sim, () => sim.state.phase === 'playing');
    const v = seatView(sim, 0);
    const h = sim.state.hand!;
    expect(v.you!.cards).toEqual(h.players.find((p) => p.seat === 0)!.hole.map(intCard));
    const json = JSON.stringify(v);
    for (const p of h.players) {
      if (p.seat === 0) continue;
      expect(v.seats[p.seat]!.cards).toEqual([null, null]);
      for (const c of p.hole) expect(json.includes(`"${intCard(c)}"`)).toBe(false);
    }
    // nothing of the undealt deck either
    for (const c of h.deck.slice(h.pos)) expect(json.includes(`"${intCard(c)}"`)).toBe(false);
    // a spectator sees no hole cards at all
    const spec = sim.view(null) as HoldemView;
    expect(spec.you).toBeNull();
    for (const p of h.players) expect(spec.seats[p.seat]!.cards).toEqual([null, null]);
  });

  it('bots act on their own clock and only ever make legal moves, over hundreds of hands', () => {
    const sim = solo(3, 100_000);
    const rng = seededRng(33);
    const before = { ...botStats };
    let buyIns = 100_000;
    let hands = 0;
    for (let guard = 0; guard < 80_000 && hands < 300; guard++) {
      if (turnOf(sim) === 0) sim.act(0, randomAction(seatView(sim, 0), rng));
      else if (!step(sim)) break;
      if (sim.state.phase === 'results') hands = Math.max(hands, sim.state.hand!.id);
      // Nothing is made or lost: the player, the bots and the pot hold what the player and the
      // house brought.
      expect(sim.stack(0) + botStacks(sim.state) + inPot(sim.state)).toBe(buyIns + sim.state.house);
      if (sim.stack(0) === 0 && engine.liveBets(sim.state, 0) === 0) {
        // busted: the host cashes the player out, and they buy back in
        sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
        sim.seats.get(0)!.stack = 100_000;
        buyIns += 100_000;
        sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
      }
    }
    expect(hands).toBeGreaterThanOrEqual(300);
    expect(botStats.decisions - before.decisions).toBeGreaterThan(1_000);
    expect(botStats.refused - before.refused).toBe(0);
  });

  it('bots rebuy with house chips when they bust', () => {
    const sim = solo(4);
    const bot = sim.state.seats[1]!;
    bot.stack = 1 * BIG_BLIND; // one blind left
    sim.state.house = botStacks(sim.state);
    let rebought = false;
    for (let i = 0; i < 4_000 && !rebought; i++) {
      if (turnOf(sim) === 0) sim.act(0, seatView(sim, 0).you!.legal!.check ? { type: 'check' } : { type: 'call' });
      else step(sim);
      rebought = (sim.lastEvents as { type: string; seat?: number }[]).some((e) => e.type === 'rebuy' && e.seat === 1);
    }
    expect(rebought).toBe(true);
    expect(sim.state.seats[1]!.stack).toBeGreaterThanOrEqual(60 * BIG_BLIND);
  });

  it('pauses when the player sits out, and deals again when they come back', () => {
    const sim = solo(5);
    until(sim, () => sim.state.phase === 'playing');
    sim.act(0, { type: 'sitout', on: true });
    // the current hand plays out, then nothing more is dealt
    until(sim, () => sim.state.phase === 'waiting' && engine.deadline(sim.state) === null, 2_000);
    expect(sim.state.phase).toBe('waiting');
    const id = sim.state.handNo;
    sim.advance(60_000);
    expect(sim.state.handNo).toBe(id);
    sim.act(0, { type: 'sitout', on: false });
    until(sim, () => sim.state.phase === 'playing');
    expect(sim.state.handNo).toBe(id + 1);
    expect(sim.state.hand!.players.map((p) => p.seat)).toContain(0);
  });
});

describe('holdem engine: multiplayer', () => {
  it('deals only once the table is started and two players are ready', () => {
    const sim = new TableSim(engine, seededRng(10), 'multi', [{ seat: 0, stack: 50_000 }]);
    sim.advance(60_000);
    expect(sim.state.phase).toBe('waiting');
    sim.seats.set(4, { seat: 4, accountId: 1004, name: 'P4', stack: 50_000, connected: true, ready: false });
    sim.apply(engine.seatJoined(sim.state, 4, sim.ctx()));
    sim.advance(60_000);
    expect(sim.state.phase).toBe('waiting'); // not started yet
    sim.started = true;
    sim.advance(0);
    sim.advance(START_MS);
    expect(sim.state.phase).toBe('playing');
    // heads-up: the button posts the small blind and acts first
    const h = sim.state.hand!;
    expect(h.sbSeat).toBe(h.button);
    expect(h.toAct).toBe(h.button);
    expect(h.players.find((p) => p.seat === h.button)!.put).toBe(SMALL_BLIND);
  });

  it('moves the button every hand and never lets the big blind land twice in a row', () => {
    const sim = multi(11, [0, 2, 3, 5].map((seat) => ({ seat, stack: 100_000 })));
    const buttons: number[] = [];
    const bbs: number[] = [];
    for (let i = 0; i < 4_000 && buttons.length < 12; i++) {
      const t = turnOf(sim);
      if (t !== null) {
        const l = seatView(sim, t).you!.legal!;
        sim.act(t, l.check ? { type: 'check' } : { type: 'fold' });
      } else step(sim);
      const h = sim.state.hand;
      if (h && sim.state.phase === 'playing' && buttons.at(-1) !== h.button + 100 * h.id) {
        if (!buttons.includes(h.button + 100 * h.id)) {
          buttons.push(h.button + 100 * h.id);
          bbs.push(h.bbSeat);
        }
      }
    }
    const order = buttons.map((b) => b % 100);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBe([0, 2, 3, 5][([0, 2, 3, 5].indexOf(order[i - 1]!) + 1) % 4]);
    for (let i = 1; i < bbs.length; i++) expect(bbs[i]).not.toBe(bbs[i - 1]);
  });

  it('times out to a check when free, otherwise a fold, and sits the player out', () => {
    const sim = multi(12, [0, 1, 2, 3].map((seat) => ({ seat, stack: 100_000 })));
    until(sim, () => turnOf(sim) !== null);
    const first = turnOf(sim)!;
    // preflop the first player faces the big blind: the clock (and then the time bank) runs out
    const t = sim.state.turn!;
    expect(t.bankFrom).toBe(t.deadline - BANK_START_MS);
    expect(t.bankFrom! - sim.now).toBeGreaterThanOrEqual(ACT_MS);
    sim.advance(t.deadline - sim.now);
    const p = sim.state.hand!.players.find((x) => x.seat === first)!;
    expect(p.folded).toBe(true);
    expect(sim.state.seats[first]!.sittingOut).toBe(true);
    expect(sim.state.seats[first]!.bank).toBe(0);
    // everyone else limps; the big blind's option times out to a check, not a fold
    const bb = sim.state.hand!.bbSeat;
    playUntil(sim, () => turnOf(sim) === bb, 50, [bb]);
    expect(seatView(sim, bb).you!.legal!.check).toBe(true);
    sim.advance(sim.state.turn!.deadline - sim.now);
    expect(sim.state.hand!.players.find((x) => x.seat === bb)!.folded).toBe(false);
    expect(sim.state.hand!.players.find((x) => x.seat === bb)!.last).toBe(null); // the flop is out: a new street
    expect(sim.state.hand!.board).toHaveLength(3);
    // from now on this hand the table acts for the away player after a short beat
    playUntil(sim, () => sim.state.phase === 'playing' && sim.state.hand!.id === 2, 5_000, [bb]);
    // players sitting out are skipped: not dealt in, no blinds
    const h2 = sim.state.hand!;
    expect(h2.id).toBe(2);
    expect(h2.players.map((x) => x.seat)).not.toContain(first);
    expect(h2.players.map((x) => x.seat)).not.toContain(bb);
    // coming back deals them in again
    sim.act(first, { type: 'sitout', on: false });
    playUntil(sim, () => sim.state.phase === 'playing' && sim.state.hand!.id === 3);
    expect(sim.state.hand!.players.map((x) => x.seat)).toContain(first);
  });

  it('a player who leaves mid-hand is folded, and never paid afterwards', () => {
    const sim = multi(13, [0, 1, 2, 3].map((seat) => ({ seat, stack: 100_000 })));
    until(sim, () => turnOf(sim) !== null);
    const h = sim.state.hand!;
    const leaver = h.bbSeat; // not the one to act, and has chips in
    const toAct = turnOf(sim)!;
    expect(leaver).not.toBe(toAct);
    sim.apply(engine.seatLeaving(sim.state, leaver, sim.ctx()));
    expect(sim.state.hand!.players.find((p) => p.seat === leaver)!.folded).toBe(true);
    expect(engine.liveBets(sim.state, leaver)).toBe(0);
    expect(sim.state.seats[leaver]).toBeUndefined();
    const paid = sim.rounds.filter((r) => r.seat === leaver);
    expect(paid).toEqual([{ seat: leaver, wagered: BIG_BLIND, returned: 0 }]);
    sim.seats.delete(leaver); // cashed out: any chip move to this seat now throws
    expect(playUntil(sim, () => sim.state.phase === 'playing' && sim.state.hand!.id === 2)).toBe(true);
    expect(sim.state.hand!.players.map((p) => p.seat)).not.toContain(leaver);
  });

  it('a player who leaves while all-in stays in the hand until it is decided', () => {
    const sim = multi(14, [
      { seat: 0, stack: 100_000 },
      { seat: 1, stack: 100_000 },
    ]);
    until(sim, () => turnOf(sim) !== null);
    const a = turnOf(sim)!;
    sim.act(a, { type: 'allin' });
    const b = turnOf(sim)!;
    sim.act(b, { type: 'call' });
    expect(sim.state.phase).toBe('runout');
    sim.apply(engine.seatLeaving(sim.state, a, sim.ctx()));
    expect(engine.liveBets(sim.state, a)).toBe(100_000);
    until(sim, () => sim.state.phase === 'results');
    expect(engine.liveBets(sim.state, a)).toBe(0);
    expect(sim.stack(a) + sim.stack(b)).toBe(200_000);
    expect(sim.state.seats[a]).toBeUndefined();
  });

  it('an all-in turns every hand face up and runs the board out a street at a time', () => {
    const sim = multi(15, [
      { seat: 0, stack: 30_000 },
      { seat: 1, stack: 80_000 },
      { seat: 2, stack: 50_000 },
    ]);
    until(sim, () => turnOf(sim) !== null);
    for (let i = 0; i < 3 && sim.state.phase === 'playing'; i++) {
      const t = turnOf(sim)!;
      sim.act(t, { type: i === 0 ? 'allin' : 'call' });
    }
    expect(sim.state.phase).toBe('runout');
    // everyone sees everyone's cards now (TDA 17)
    const spec = sim.view(null) as HoldemView;
    for (const p of sim.state.hand!.players) expect(spec.seats[p.seat]!.cards).toEqual(p.hole.map(intCard));
    const boards: number[] = [];
    until(sim, () => {
      boards.push(sim.state.hand!.board.length);
      return sim.state.phase === 'results';
    });
    expect([...new Set(boards)]).toEqual([0, 3, 4, 5]);
    expect(sim.stack(0) + sim.stack(1) + sim.stack(2)).toBe(160_000);
    const wins = (sim.lastEvents as { type: string; label?: string }[]).filter((e) => e.type === 'win');
    expect(wins.length).toBeGreaterThanOrEqual(1);
    expect(wins.at(-1)!.label).toBe('main pot');
  });

  it('returns the uncalled part of a raise when everyone folds', () => {
    const sim = multi(16, [0, 1, 2].map((seat) => ({ seat, stack: 100_000 })));
    until(sim, () => turnOf(sim) !== null);
    const raiser = turnOf(sim)!;
    sim.act(raiser, { type: 'raise', to: 3_000 });
    while (sim.state.phase === 'playing') sim.act(turnOf(sim)!, { type: 'fold' });
    const ev = sim.lastEvents as { type: string; seat?: number; amount?: number }[];
    expect(ev.find((e) => e.type === 'uncalled')).toEqual({ type: 'uncalled', seat: raiser, amount: 3_000 - BIG_BLIND });
    expect(sim.stack(raiser)).toBe(100_000 + SMALL_BLIND + BIG_BLIND - (raiser === sim.state.hand!.sbSeat ? SMALL_BLIND : 0) - (raiser === sim.state.hand!.bbSeat ? BIG_BLIND : 0));
  });

  it('a busted player is cashed out, and on buying back in waits for the big blind', () => {
    const sim = multi(17, [
      { seat: 0, stack: 20_000 },
      { seat: 3, stack: 100_000 },
      { seat: 6, stack: 100_000 },
    ]);
    let busted = false;
    for (let i = 0; i < 5_000 && !busted; i++) {
      const t = turnOf(sim);
      if (t === 0) sim.act(0, { type: 'allin' });
      else if (t !== null) sim.act(t, seatView(sim, t).you!.legal!.call > 0 ? { type: 'call' } : { type: 'check' });
      else step(sim);
      if (sim.stack(0) === 0 && engine.liveBets(sim.state, 0) === 0) busted = true;
    }
    expect(busted).toBe(true);
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    sim.seats.delete(0);
    expect(sim.state.seats[0]).toBeUndefined();
    sim.seats.set(0, { seat: 0, accountId: 1000, name: 'P0', stack: 20_000, connected: true, ready: false });
    sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
    // two others are playing, so the newcomer is dealt in with everyone (a new game begins)
    until(sim, () => sim.state.phase === 'playing' && sim.state.hand!.players.some((p) => p.seat === 0), 3_000);
    expect(sim.state.hand!.players.some((p) => p.seat === 0)).toBe(true);
  });

  it('with three or more already playing, a newcomer waits for the big blind', () => {
    const sim = multi(18, [0, 2, 4].map((seat) => ({ seat, stack: 100_000 })));
    until(sim, () => sim.state.phase === 'playing');
    sim.seats.set(5, { seat: 5, accountId: 1005, name: 'P5', stack: 100_000, connected: true, ready: false });
    sim.apply(engine.seatJoined(sim.state, 5, sim.ctx()));
    expect(seatView(sim, 5).seats[5]!.waiting).toBe(true);
    let dealt = -1;
    for (let i = 0; i < 20_000 && dealt < 0; i++) {
      const t = turnOf(sim);
      if (t !== null) sim.act(t, seatView(sim, t).you!.legal!.check ? { type: 'check' } : { type: 'fold' });
      else step(sim);
      const h = sim.state.hand;
      if (h && sim.state.phase === 'playing' && h.players.some((p) => p.seat === 5)) dealt = h.bbSeat;
    }
    expect(dealt).toBe(5);
  });

  it('refuses moves out of turn, out of phase and off the step', () => {
    const sim = multi(19, [0, 1, 2].map((seat) => ({ seat, stack: 100_000 })));
    expect(sim.act(0, { type: 'check' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    until(sim, () => turnOf(sim) !== null);
    const t = turnOf(sim)!;
    const other = [0, 1, 2].find((x) => x !== t)!;
    expect(sim.act(other, { type: 'call' }, { allowRefusal: true }).refused).toBe('NOT_YOUR_TURN');
    expect(sim.act(t, { type: 'raise', to: 2_050 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(t, { type: 'raise', to: 1_500 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(t, { type: 'raise', to: 200_000 }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.act(t, { type: 'bet', amount: 2_000 }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    expect(engine.parseAction({ type: 'raise', to: -5 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', amount: 1.5 })).toBeNull();
    expect(engine.parseAction({ type: 'sitout' })).toBeNull();
    expect(engine.parseAction({ type: 'shove' })).toBeNull();
    sim.act(t, { type: 'raise', to: 2_000 });
  });

  it('records one round per player per hand, and what came back matches the stack', () => {
    const sim = multi(20, [0, 1, 2, 3].map((seat) => ({ seat, stack: 100_000 })));
    const rng = seededRng(2020);
    const topped = new Map<number, number>();
    const dealtIn = new Map<number, number>();
    let seen = 0;
    for (let i = 0; i < 40_000 && sim.state.handNo < 60; i++) {
      const t = turnOf(sim);
      if (t !== null) sim.act(t, randomAction(seatView(sim, t), rng));
      else step(sim);
      const h = sim.state.hand;
      if (h && h.id > seen) {
        seen = h.id;
        for (const p of h.players) dealtIn.set(p.seat, (dealtIn.get(p.seat) ?? 0) + 1);
      }
      // a busted player tops back up between hands
      for (const [seat, sc] of sim.seats) {
        if (sc.stack === 0 && engine.liveBets(sim.state, seat) === 0) {
          sc.stack = 100_000;
          topped.set(seat, (topped.get(seat) ?? 0) + 100_000);
        }
      }
    }
    playUntil(sim, () => sim.state.phase === 'results');
    for (const seat of [0, 1, 2, 3]) {
      const rs = sim.rounds.filter((r) => r.seat === seat);
      expect(rs).toHaveLength(dealtIn.get(seat) ?? 0);
      const net = rs.reduce((a, r) => a + r.returned - r.wagered, 0);
      expect(sim.stack(seat) - 100_000 - (topped.get(seat) ?? 0)).toBe(net);
    }
    expect(sim.state.handNo).toBeGreaterThanOrEqual(60);
  });

  it('shifts every deadline', () => {
    const sim = multi(21, [0, 1].map((seat) => ({ seat, stack: 100_000 })));
    until(sim, () => turnOf(sim) !== null);
    const s = engine.shiftDeadlines(sim.state, 20_000);
    expect(engine.deadline(s)).toBe(engine.deadline(sim.state)! + 20_000);
    expect(s.turn!.bankFrom).toBe(sim.state.turn!.bankFrom! + 20_000);
  });
});

describe('holdem engine: chip conservation over thousands of random multiplayer hands', () => {
  it('stacks plus the pot never change, whatever people do', () => {
    const rng = seededRng(4242);
    const sim = multi(4243, [0, 1, 2, 3, 4, 5].map((seat) => ({ seat, stack: 20_000 + randInt(rng, 80) * 1_000 })));
    let brought = [...sim.seats.values()].reduce((a, s) => a + s.stack, 0);
    let taken = 0;
    const away = new Map<number, number>(); // seats stepped out to buy chips (host status buying_in)
    const leaving = new Set<number>();
    let hands = 0;
    let showdowns = 0;
    let allIns = 0;
    const check = () => {
      let total = inPot(sim.state);
      for (const sc of sim.seats.values()) total += sc.stack;
      for (const st of away.values()) total += st;
      expect(total).toBe(brought - taken);
      for (const sc of sim.seats.values()) expect(sc.stack).toBeGreaterThanOrEqual(0);
    };
    const cashOut = (seat: number) => {
      taken += sim.stack(seat);
      sim.seats.delete(seat);
      leaving.delete(seat);
    };
    for (let i = 0; i < 400_000 && hands < 3_000; i++) {
      const t = turnOf(sim);
      const r = randUnit(rng);
      if (r < 0.004 && sim.seats.size > 0) {
        // someone leaves (the host folds them first, then cashes out once nothing is live)
        const seats = [...sim.seats.keys()];
        const seat = seats[randInt(rng, seats.length)]!;
        sim.apply(engine.seatLeaving(sim.state, seat, sim.ctx()));
        if (engine.liveBets(sim.state, seat) === 0) cashOut(seat);
        else leaving.add(seat);
      } else if (r < 0.012) {
        // someone sits down in an empty seat
        const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((x) => !sim.seats.has(x) && !away.has(x) && !leaving.has(x));
        if (free.length) {
          const seat = free[randInt(rng, free.length)]!;
          const stack = (20 + randInt(rng, 81)) * 1_000;
          brought += stack;
          sim.seats.set(seat, { seat, accountId: 2000 + seat, name: `N${seat}`, stack, connected: true, ready: false });
          sim.apply(engine.seatJoined(sim.state, seat, sim.ctx()));
        }
      } else if (r < 0.016) {
        // someone with nothing live tops up: out of the seat while the chips are fetched...
        const seats = [...sim.seats.keys()].filter((x) => engine.liveBets(sim.state, x) === 0 && !leaving.has(x));
        if (seats.length) {
          const seat = seats[randInt(rng, seats.length)]!;
          away.set(seat, sim.stack(seat));
          sim.seats.delete(seat);
        }
      } else if (r < 0.024 && away.size) {
        // ...and back with more
        const [seat, stack] = [...away.entries()][0]!;
        away.delete(seat);
        brought += 5_000;
        sim.seats.set(seat, { seat, accountId: 2000 + seat, name: `N${seat}`, stack: stack + 5_000, connected: true, ready: false });
      } else if (r < 0.027 && sim.seats.size) {
        const seats = [...sim.seats.keys()];
        const seat = seats[randInt(rng, seats.length)]!;
        sim.act(seat, { type: 'sitout', on: randUnit(rng) < 0.3 });
      } else if (t !== null && sim.seats.has(t)) {
        const a = randomAction(seatView(sim, t), rng);
        if (a.type === 'allin') allIns++;
        sim.act(t, a);
      } else step(sim);
      // the host's sweep: leavers and busted players are cashed out once nothing is live
      for (const seat of [...sim.seats.keys()]) {
        if (engine.liveBets(sim.state, seat) > 0) continue;
        if (leaving.has(seat)) cashOut(seat);
        else if (sim.stack(seat) === 0) {
          sim.apply(engine.seatLeaving(sim.state, seat, sim.ctx()));
          cashOut(seat);
        }
      }
      // keep the table going
      if (sim.seats.size < 2 && away.size === 0) {
        for (const seat of [7, 8]) {
          if (sim.seats.has(seat)) continue;
          brought += 50_000;
          sim.seats.set(seat, { seat, accountId: 3000 + seat, name: `R${seat}`, stack: 50_000, connected: true, ready: false });
          sim.apply(engine.seatJoined(sim.state, seat, sim.ctx()));
        }
      }
      // people who sat out come back now and then
      for (const st of Object.values(sim.state.seats)) {
        if (st.sittingOut && sim.seats.has(st.seat) && randUnit(rng) < 0.02) sim.act(st.seat, { type: 'sitout', on: false });
      }
      check();
      if (sim.state.phase === 'results' && sim.state.hand!.id > hands) {
        hands = sim.state.hand!.id;
        if ((sim.lastEvents as { type: string }[]).some((e) => e.type === 'reveal')) showdowns++;
      }
    }
    expect(hands).toBeGreaterThanOrEqual(3_000);
    expect(showdowns).toBeGreaterThan(100);
    expect(allIns).toBeGreaterThan(100);
  });
});
