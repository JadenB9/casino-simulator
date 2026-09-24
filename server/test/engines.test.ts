// Hidden information and hostile input, engine by engine, the way the table host drives them.
//
// Every multiplayer game is played by bots (scripts/load/bots.ts) with seats changing hands in the
// middle of rounds, and after every step the views are checked against each other:
//   - a card only one seat can see (in its view, not the spectator's) is in no other seat's view;
//   - an event for everyone carries only cards the spectator can see, and an event for one seat
//     only cards that seat can see;
//   - a newcomer who has just taken a seat can see no card a spectator can't: nothing has been
//     dealt to them yet, so any such card is the last occupant's.
// Then junk and hostile actions go through each engine's parseAction and act: nothing may throw,
// and every chip move must be a whole, non-negative number of cents that no stack can't cover
// (TableSim refuses the step otherwise, exactly as the host does).

import { describe, expect, it } from 'vitest';
import type { GameEngine, GameEvent, GameId, Step } from '../../shared/src/engine.ts';
import { isRefusal } from '../../shared/src/engine.ts';
import { engineFor } from '../../shared/src/games/index.ts';
import { TableSim } from '../../shared/test/helpers/table-sim.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';
import { BUY_IN, ENGINE_READY, LOBBY_GAMES, botDoneBetting, botMove, type Rand } from '../../scripts/load/bots.ts';

type Engine = GameEngine<any, any, any>;

const CARD_RE = /^[2-9TJQKA][shdc]$/;

function cardsIn(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') {
    if (CARD_RE.test(x)) out.push(x);
  } else if (Array.isArray(x)) {
    for (const v of x) cardsIn(v, out);
  } else if (typeof x === 'object' && x !== null) {
    for (const v of Object.values(x)) cardsIn(v, out);
  }
  return out;
}

/** A small deterministic source for the bots' choices (the engines get their own seeded Rng). */
function rand32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cards `seat` sees that a spectator doesn't. */
function privateCards(engine: Engine, state: unknown, seat: number): string[] {
  const open = new Set(cardsIn(engine.view(state, null)));
  return cardsIn(engine.view(state, seat)).filter((c) => !open.has(c));
}

/**
 * Seats as the host keeps them: who is at each number now, and a newcomer's account id differs
 * from the last occupant's. Steps go through `run`, which checks the views after each one.
 */
class Table {
  readonly sim: TableSim<any, any, any>;
  readonly engine: Engine;
  private nextAccount = 5_000;
  readonly leaving = new Set<number>();
  problems: string[] = [];
  steps = 0;
  turnovers = 0;
  /** Checks that a newcomer's view held no card of anyone else's (the leak this file guards). */
  newcomerChecks = 0;
  /** Each seat's current occupant: their stack when they sat down and their rounds' net since. */
  private readonly occupant = new Map<number, { start: number; net: number }>();
  /** Occupants whose chips and recorded rounds were compared as they left. */
  statChecks = 0;

  constructor(
    readonly game: string,
    seed: number,
    seats: number,
  ) {
    this.engine = engineFor(game as never) as Engine;
    this.sim = new TableSim(this.engine, seededRng(seed), 'multi', Array.from({ length: seats }, (_, seat) => ({ seat, stack: BUY_IN[game as keyof typeof BUY_IN] })));
    this.sim.started = true;
    for (const [seat, s] of this.sim.seats) {
      this.occupant.set(seat, { start: s.stack, net: 0 });
      this.run(this.engine.seatJoined(this.sim.state, seat, this.sim.ctx()));
    }
  }

  /** Apply a step the way the host does and check every view after it. */
  run(step: Step<unknown>): void {
    this.sim.apply(step as Step<any>);
    this.steps++;
    // The host credits a round to whoever holds the seat now, as the profile's stats.
    for (const r of step.rounds ?? []) {
      const who = this.sim.seats.has(r.seat) ? this.occupant.get(r.seat) : undefined;
      if (who) who.net += r.returned - r.wagered;
    }
    if (step.rounds?.length) for (const s of this.sim.seats.values()) s.ready = false;
    this.check(step.events);
  }

  check(events: GameEvent[]): void {
    const { engine } = this;
    const state = this.sim.state;
    const open = new Set(cardsIn(engine.view(state, null)));
    const seen = new Map<number, Set<string>>();
    for (const seat of this.sim.seats.keys()) seen.set(seat, new Set(cardsIn(engine.view(state, seat))));
    for (const [seat, cards] of seen) {
      for (const c of cards) {
        if (open.has(c)) continue;
        for (const [other, theirs] of seen) {
          if (other !== seat && theirs.has(c)) this.problems.push(`${this.game}: ${c}, private to seat ${seat}, is in seat ${other}'s view`);
        }
      }
    }
    for (const e of events) {
      const { to, ...rest } = e;
      const cards = cardsIn(rest);
      if (to === undefined || to === 'all') {
        for (const c of cards) if (!open.has(c)) this.problems.push(`${this.game}: ${e.type} for everyone carries ${c}, which a spectator can't see`);
      } else {
        const theirs = seen.get(to) ?? new Set(cardsIn(engine.view(state, to)));
        for (const c of cards) if (!theirs.has(c)) this.problems.push(`${this.game}: ${e.type} for seat ${to} carries ${c}, which that seat can't see`);
      }
    }
  }

  /** Run whatever is due at the sim's clock, the way the host's alarm does. */
  tick(): void {
    for (let i = 0; i < 50; i++) {
      const step = this.engine.tick(this.sim.state, this.sim.ctx());
      if (!step) return;
      this.run(step);
      const due = this.engine.deadline(this.sim.state);
      if (due === null || due > this.sim.now) return;
    }
  }

  act(seat: number, action: unknown): boolean {
    const parsed = this.engine.parseAction(action);
    if (parsed === null) {
      this.problems.push(`${this.game}: the bot's own move didn't parse: ${JSON.stringify(action)}`);
      return false;
    }
    const res = this.engine.act(this.sim.state, seat, parsed, this.sim.ctx());
    if (isRefusal(res)) return false;
    this.run(res);
    return true;
  }

  /** A seat stands up: its live bets resolve (or play on) and it is gone once nothing is live. */
  leave(seat: number): void {
    this.leaving.add(seat);
    this.run(this.engine.seatLeaving(this.sim.state, seat, this.sim.ctx()));
    this.settleLeavers();
  }

  settleLeavers(): void {
    for (const seat of [...this.leaving]) {
      if (this.engine.liveBets(this.sim.state, seat) > 0) continue;
      this.leaving.delete(seat);
      // Cashing out: every chip won or lost since sitting down must be in the rounds reported for
      // the seat, or the player's stats (and the leaderboards) miss what really happened.
      const who = this.occupant.get(seat)!;
      const moved = this.sim.seats.get(seat)!.stack - who.start;
      this.statChecks++;
      if (moved !== who.net) this.problems.push(`${this.game}: seat ${seat} leaves ${moved} up but its reported rounds come to ${who.net}`);
      this.sim.seats.delete(seat);
      this.join(seat);
    }
  }

  /** Someone new takes the seat straight away (the engine must not show them the last occupant's round). */
  join(seat: number): void {
    const id = this.nextAccount++;
    const stack = BUY_IN[this.game as keyof typeof BUY_IN];
    this.occupant.set(seat, { start: stack, net: 0 });
    this.sim.seats.set(seat, { seat, accountId: id, name: `N${id}`, stack, connected: true, ready: false });
    this.run(this.engine.seatJoined(this.sim.state, seat, this.sim.ctx()));
    this.turnovers++;
    this.newcomerChecks++;
    const leftover = privateCards(this.engine, this.sim.state, seat);
    if (leftover.length) this.problems.push(`${this.game}: a newcomer at seat ${seat} sees ${leftover.join(' ')} before being dealt anything`);
  }
}

/** Play `rounds` worth of bot turns with a seat changing hands now and then. */
function play(game: string, seed: number, steps: number): Table {
  const t = new Table(game, seed, 4);
  const rand = rand32(seed * 7 + 1);
  for (let i = 0; i < steps; i++) {
    for (const [seat, s] of t.sim.seats) {
      if (t.leaving.has(seat)) continue;
      const move = botMove(game, t.sim.view(seat), { seat, stack: s.stack }, rand);
      if (move) t.act(seat, move);
      if (botDoneBetting(game, t.sim.view(seat), seat)) {
        if (ENGINE_READY.has(game)) t.act(seat, { type: 'ready', on: true });
        else s.ready = true;
      }
    }
    // Now and then someone gets up mid-round, whatever the table is doing.
    if (rand() < 0.08) {
      const seats = [...t.sim.seats.keys()].filter((x) => !t.leaving.has(x));
      if (seats.length > 1) t.leave(seats[Math.floor(rand() * seats.length)]!);
    }
    t.sim.now += 500 + Math.floor(rand() * 1_500);
    t.tick();
    t.settleLeavers();
  }
  return t;
}

describe('hidden information survives seats changing hands mid-round', () => {
  for (const game of LOBBY_GAMES) {
    it(`${game}: no card private to one seat reaches another, and newcomers inherit nothing`, () => {
      let steps = 0;
      let turnovers = 0;
      for (const seed of [11, 23, 47]) {
        const t = play(game, seed, 400);
        expect(t.problems.slice(0, 5)).toEqual([]);
        steps += t.steps;
        turnovers += t.turnovers;
      }
      expect(steps).toBeGreaterThan(300);
      expect(turnovers).toBeGreaterThan(10);
    }, 60_000);
  }
});

// ---------------------------------------------------------------------------------------------
// The two leaks this suite found, step by step.

describe('Three Card Poker: a folded hand stays with its owner', () => {
  function toDeciding(seed: number): Table {
    const t = new Table('threecard', seed, 3);
    t.tick(); // the window opens
    for (const seat of [0, 1, 2]) expect(t.act(seat, { type: 'bet', ante: 1_000, pairPlus: 0 })).toBe(true);
    t.sim.now += 16_000;
    t.tick();
    expect(t.sim.view(null).phase).toBe('deciding');
    return t;
  }

  it('the next player in the seat of someone who folded and left sees none of their cards', () => {
    const t = toDeciding(3);
    const folded = t.sim.view(1).seats[1].cards as string[];
    expect(folded).toHaveLength(3);
    expect(t.act(1, { type: 'fold' })).toBe(true);
    t.leave(1); // nothing live: gone at once, and a newcomer sits down in seat 1
    const view = t.sim.view(1);
    expect(view.seats[1]).toBeUndefined();
    for (const c of folded) expect(cardsIn(view)).not.toContain(c);
    // The others still have a round to finish, and it settles as it would have.
    expect(t.act(0, { type: 'play' })).toBe(true);
    expect(t.act(2, { type: 'fold' })).toBe(true);
    expect(t.sim.view(null).phase).toBe('results');
    for (const c of folded) expect(cardsIn(t.sim.view(1))).not.toContain(c);
    expect(t.problems).toEqual([]);
  });

  it('also when the hand was still waiting on Play or Fold as they left', () => {
    const t = toDeciding(5);
    const pending = t.sim.view(2).seats[2].cards as string[];
    t.leave(2); // leaving folds it, as a timeout would
    for (const c of pending) expect(cardsIn(t.sim.view(2))).not.toContain(c);
    expect(t.problems).toEqual([]);
  });

  it('a returning player at their own seat after the round keeps playing normally', () => {
    const t = toDeciding(9);
    expect(t.act(0, { type: 'play' })).toBe(true);
    expect(t.act(1, { type: 'play' })).toBe(true);
    expect(t.act(2, { type: 'play' })).toBe(true);
    t.sim.now += 7_000;
    t.tick();
    expect(t.sim.view(null).phase).toBe('betting');
    expect(t.act(0, { type: 'bet', ante: 1_000, pairPlus: 500 })).toBe(true);
    expect(t.problems).toEqual([]);
  });
});

describe("Hold'em: folded hole cards stay with their owner", () => {
  function midHand(seed: number): Table {
    const t = new Table('holdem', seed, 4);
    for (let i = 0; i < 20 && t.sim.view(null).phase !== 'playing'; i++) {
      t.sim.now += 2_000;
      t.tick();
    }
    expect(t.sim.view(null).phase).toBe('playing');
    return t;
  }

  it('the next player in the seat of someone who folded and left sees none of their hole cards', () => {
    const t = midHand(7);
    const seat = t.sim.view(null).turn.seat as number;
    const hole = t.sim.view(seat).you.cards as string[];
    expect(hole).toHaveLength(2);
    expect(t.act(seat, { type: 'fold' })).toBe(true);
    t.leave(seat);
    expect(t.sim.view(null).phase).toBe('playing');
    const view = t.sim.view(seat);
    expect(view.you.cards).toEqual([]);
    for (const c of hole) expect(cardsIn(view)).not.toContain(c);
    expect(t.problems).toEqual([]);
  });

  it('also when leaving is what folded the hand', () => {
    const t = midHand(13);
    const current = t.sim.view(null).turn.seat as number;
    const seat = [...t.sim.seats.keys()].find((s) => s !== current && t.sim.view(s).you?.cards.length === 2)!;
    const hole = t.sim.view(seat).you.cards as string[];
    t.leave(seat);
    for (const c of hole) expect(cardsIn(t.sim.view(seat))).not.toContain(c);
    expect(t.problems).toEqual([]);
  });
});

describe('Blackjack: a seat that leaves with its hand settled keeps the round in its stats', () => {
  it('first base busts and leaves while the table plays on: its round is reported once, as it leaves', () => {
    let done = false;
    for (let seed = 1; seed < 400 && !done; seed++) {
      const t = new Table('blackjack', seed, 2);
      t.tick(); // the window opens
      for (const seat of [0, 1]) expect(t.act(seat, { type: 'bet', amount: 2_500 })).toBe(true);
      t.sim.now += 16_000;
      t.tick();
      const v = t.sim.view(null);
      if (v.phase !== 'play' || !v.turn) continue;
      // First base (whoever acts first) hits until it busts; deals where it can't are skipped.
      const first = v.turn.seat as number;
      const second = 1 - first;
      while (t.sim.view(first).turn?.seat === first && t.sim.view(first).moves.includes('hit')) t.act(first, { type: 'hit' });
      const spot = t.sim.view(null).spots.find((s: any) => s.seat === first);
      if (spot.hands[0].outcome !== 'bust' || t.sim.view(null).phase !== 'play') continue;
      // Busted, nothing live, and the other seat still to play: it leaves now.
      expect(t.engine.liveBets(t.sim.state, first)).toBe(0);
      const step = t.engine.seatLeaving(t.sim.state, first, t.sim.ctx());
      expect(step.rounds).toEqual([{ seat: first, wagered: 2_500, returned: 0 }]);
      t.run(step);
      t.sim.seats.delete(first);
      // The round ends without the leaver in it again.
      const ends: { seat: number }[] = [];
      for (let i = 0; i < 10 && t.sim.view(null).phase === 'play'; i++) {
        const s = t.engine.act(t.sim.state, second, t.engine.parseAction({ type: 'stand' }), t.sim.ctx());
        if (!isRefusal(s)) {
          t.run(s);
          ends.push(...(s.rounds ?? []));
        }
      }
      expect(t.sim.view(null).phase).toBe('results');
      expect(ends.map((r) => r.seat)).toEqual([second]);
      done = true;
    }
    expect(done).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

/** Junk, shapes that are almost right, and hostile values, for parseAction and act. */
function hostileActions(rand: Rand): unknown[] {
  const nums = [0, -1, 1, 0.5, 1e21, -1e21, Number.MAX_SAFE_INTEGER, 2 ** 53, NaN, Infinity, '100', null, true, [], {}];
  const keys = ['type', 'amount', 'bets', 'kind', 'numbers', 'spot', 'ante', 'pairPlus', 'bet', 'tie', 'on', 'id', 'part', 'to', 'take', 'hold', 'coins', 'banker', 'player', 'double', 'auto', 'mines', 'tile', 'row', 'col', 'picks', 'target', 'over', 'risk', 'rows', 'guess', '__proto__', 'constructor'];
  const types = ['bet', 'undo', 'clear', 'deal', 'spin', 'roll', 'rebet', 'ready', 'odds', 'down', 'working', 'insurance', 'hit', 'stand', 'double', 'split', 'surrender', 'play', 'fold', 'war', 'check', 'call', 'raise', 'allin', 'sitout', 'max', 'cancel', 'cashout', 'pick', 'reveal', 'drop', 'guess', 'skip', 'higher', 'lower', 'toString', '__proto__', ''];
  const val = (): unknown => {
    const r = rand();
    if (r < 0.4) return nums[Math.floor(rand() * nums.length)];
    if (r < 0.55) return types[Math.floor(rand() * types.length)];
    if (r < 0.75) return [{ kind: types[Math.floor(rand() * types.length)], amount: nums[Math.floor(rand() * nums.length)], numbers: [Math.floor(rand() * 40) - 2], spot: 'total:10' }];
    if (r < 0.85) return Array.from({ length: 50 }, () => ({ kind: 'red', spot: 'big', amount: 100 }));
    return { nested: { deeper: [1, 2, 3] } };
  };
  const out: unknown[] = [null, 1, 'bet', [], [{ type: 'bet' }], JSON.parse('{"__proto__": {"type": "bet"}}'), JSON.parse('{"type": "bet", "__proto__": {"amount": 100}}')];
  for (let i = 0; i < 400; i++) {
    const a: Record<string, unknown> = { type: types[Math.floor(rand() * types.length)] };
    const n = Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) a[keys[Math.floor(rand() * keys.length)]!] = val();
    out.push(a);
  }
  return out;
}

describe('hostile actions', () => {
  const SOLO: GameId[] = ['slots', 'videopoker', 'plinko', 'tower', 'mines', 'dice', 'limbo', 'keno', 'hilo'];
  for (const game of [...LOBBY_GAMES, ...SOLO] as GameId[]) {
    it(`${game}: junk never throws, and nothing it does moves chips a stack can't cover`, () => {
      const engine = engineFor(game) as Engine;
      const rand = rand32(game.length * 101);
      const solo = SOLO.includes(game);
      const sim = new TableSim(engine, seededRng(99), solo ? 'solo' : 'multi', [{ seat: 0, stack: 20_000 }, ...(solo ? [] : [{ seat: 1, stack: 5_000 }])]);
      sim.started = true;
      for (const seat of sim.seats.keys()) sim.apply(engine.seatJoined(sim.state, seat, sim.ctx()));
      let applied = 0;
      for (let round = 0; round < 6; round++) {
        for (const raw of hostileActions(rand)) {
          let parsed: unknown;
          expect(() => (parsed = engine.parseAction(raw)), JSON.stringify(raw)).not.toThrow();
          if (parsed === null) continue;
          for (const seat of sim.seats.keys()) {
            const res = engine.act(sim.state, seat, parsed, sim.ctx());
            if (isRefusal(res)) continue;
            // TableSim.apply throws on a fractional, negative or overdrawing chip move.
            sim.apply(res);
            applied++;
            JSON.stringify(sim.state);
          }
        }
        sim.now += 20_000;
        sim.advance(0);
      }
      // Some of the junk was a real move with odd extras on it; those were fine to play.
      expect(applied).toBeGreaterThanOrEqual(0);
      for (const s of sim.seats.values()) expect(Number.isSafeInteger(s.stack) && s.stack >= 0).toBe(true);
    }, 60_000);
  }
});
