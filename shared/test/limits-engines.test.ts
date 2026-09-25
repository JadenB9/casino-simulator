// Every engine at chosen limits. A table opened at a custom minimum and maximum (not one of the
// tiers) takes a bet at its maximum and refuses a dollar more, and refuses a bet under its
// minimum, on each kind of bet it has; Hold'em deals at the blinds it was given. The engines
// only read the config they are handed, so these check that every one of them reads that config
// and nothing fixed.

import { describe, expect, it } from 'vitest';
import type { GameEngine, GameId } from '../src/engine.ts';
import { isRefusal } from '../src/engine.ts';
import { ENGINES } from '../src/games/index.ts';
import { applyLimits, clampLimits, limitsOf, type TableLimits } from '../src/limits.ts';
import type { HoldemView } from '../src/games/holdem/protocol.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

const D = 100;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sim = TableSim<any, any, any>;

/** A table of `game` at these limits, one player seated with `stack`, its first window open. */
function at(game: GameId, l: TableLimits, stack = 100_000 * D, mode: 'solo' | 'multi' = 'solo', variant = ''): Sim {
  const engine = ENGINES[game] as GameEngine<any, any, any>;
  const limits = clampLimits(game, l)!;
  expect(limits).toEqual(l);
  const cfg = applyLimits(engine.config(variant, mode), limits);
  const sim = new TableSim(engine, seededRng(11), mode, [{ seat: 0, stack }], cfg);
  if (mode === 'multi') sim.started = true;
  sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
  sim.advance(0);
  return sim;
}

/** The refusal an action would get, or null if it would go through (the table is left alone). */
function refusal(sim: Sim, raw: unknown): string | null {
  const a = sim.engine.parseAction(raw);
  if (a === null) return 'PARSE';
  const r = sim.engine.act(sim.state, 0, a, sim.ctx());
  return isRefusal(r) ? r.refuse : null;
}

/** At the maximum it goes down; a dollar over, or a dollar under the minimum, it doesn't. */
function holds(sim: Sim, min: number, max: number, act: (amount: number) => unknown): void {
  expect(refusal(sim, act(max)), `at the maximum ${max}`).toBeNull();
  expect(refusal(sim, act(max + D)), `over the maximum ${max}`).toBe('LIMIT');
  if (min > D) expect(refusal(sim, act(min - D)), `under the minimum ${min}`).toBe('LIMIT');
  expect(refusal(sim, act(min)), `at the minimum ${min}`).toBeNull();
}

const L = { min: 30 * D, max: 3_000 * D };

describe('the tables at custom limits', () => {
  it('blackjack: the bet, and the minimum at the deal', () => {
    const sim = at('blackjack', L);
    expect(refusal(sim, { type: 'bet', amount: L.max })).toBeNull();
    expect(refusal(sim, { type: 'bet', amount: L.max + D })).toBe('LIMIT');
    sim.act(0, { type: 'bet', amount: 29 * D });
    expect(refusal(sim, { type: 'deal' })).toBe('LIMIT');
  });

  it('roulette: outside bets at the limits, inside bets at a fifth and a tenth of them', () => {
    const sim = at('roulette', L, 100_000 * D, 'solo', 'american');
    holds(sim, L.min, L.max, (amount) => ({ type: 'bet', bets: [{ kind: 'red', amount }] }));
    holds(sim, 6 * D, 300 * D, (amount) => ({ type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount }] }));
    expect(sim.state.cfg.limits.default.max).toBe(6_000 * D);
  });

  it('craps: the line bet at the limits, a prop at its share of them', () => {
    const sim = at('craps', L);
    holds(sim, L.min, L.max, (amount) => ({ type: 'bet', bets: [{ kind: 'pass', amount }] }));
    // props: a tenth of the line minimum ($3) to a fifth of its maximum ($600)
    holds(sim, 3 * D, 600 * D, (amount) => ({ type: 'bet', bets: [{ kind: 'any7', amount }] }));
  });

  it('baccarat: Player and Banker at the limits, the Tie at its share; the minimum at the deal', () => {
    const sim = at('baccarat', L);
    expect(refusal(sim, { type: 'bet', banker: L.max })).toBeNull();
    expect(refusal(sim, { type: 'bet', banker: L.max + D })).toBe('LIMIT');
    expect(refusal(sim, { type: 'bet', tie: 600 * D })).toBeNull();
    expect(refusal(sim, { type: 'bet', tie: 601 * D })).toBe('LIMIT');
    sim.act(0, { type: 'bet', player: 29 * D });
    expect(refusal(sim, { type: 'deal' })).toBe('LIMIT');
  });

  it('Three Card Poker: the Ante at the limits, Pair Plus at half of them', () => {
    const sim = at('threecard', L);
    holds(sim, L.min, L.max, (ante) => ({ type: 'bet', ante, pairPlus: 0 }));
    holds(sim, 15 * D, 1_500 * D, (pairPlus) => ({ type: 'bet', ante: 0, pairPlus }));
  });

  it('Casino War: the bet at the limits, the Tie bet at a tenth of them', () => {
    const sim = at('war', L);
    holds(sim, L.min, L.max, (bet) => ({ type: 'bet', bet, tie: 0 }));
    holds(sim, 3 * D, 300 * D, (tie) => ({ type: 'bet', bet: L.min, tie }));
  });

  it('Big Six: each spot at the limits, five times the maximum a spin', () => {
    const l = { min: 3 * D, max: 300 * D };
    const sim = at('bigsix', l);
    holds(sim, l.min, l.max, (amount) => ({ type: 'bet', bets: [{ spot: 'one', amount }] }));
    expect(sim.state.cfg.limits.default.max).toBe(1_500 * D);
  });

  it('Sic Bo: Small and Big at the limits, a specific triple at its share', () => {
    const sim = at('sicbo', L);
    holds(sim, L.min, L.max, (amount) => ({ type: 'bet', bets: [{ spot: 'big', amount }] }));
    // specific triples: a fifth of the minimum ($6) to a fiftieth of the maximum ($60)
    holds(sim, 6 * D, 60 * D, (amount) => ({ type: 'bet', bets: [{ spot: 'triple:6', amount }] }));
  });

  it('the Bandit Wheel: each number at the limits, and its own Max', () => {
    const l = { min: 3 * D, max: 300 * D };
    holds(at('banditwheel', l), l.min, l.max, (amount) => ({ type: 'bet', bets: [{ spot: 5, amount }] }));
    // Max: the table maximum, or every chip when that is less
    const rich = at('banditwheel', l);
    rich.act(0, { type: 'max', spot: 5 });
    expect(rich.stack(0)).toBe(100_000 * D - l.max);
    const short = at('banditwheel', l, 250 * D);
    short.act(0, { type: 'max', spot: 5 });
    expect(short.stack(0)).toBe(0);
  });
});

describe('the online games at custom limits', () => {
  const l = { min: 7 * D, max: 700 * D };
  const cases: [GameId, (amount: number) => unknown][] = [
    ['dice', (bet) => ({ type: 'roll', bet, target: 5_000, over: true })],
    ['limbo', (bet) => ({ type: 'bet', bet, target: 200 })],
    ['plinko', (bet) => ({ type: 'drop', bet, rows: 8, risk: 'low' })],
    ['keno', (bet) => ({ type: 'bet', bet, picks: [1, 2, 3], risk: 'classic' })],
    ['mines', (amount) => ({ type: 'bet', amount, mines: 3 })],
    ['tower', (amount) => ({ type: 'bet', amount, difficulty: 'easy' })],
    ['hilo', (amount) => ({ type: 'bet', amount })],
  ];
  for (const [game, act] of cases) {
    it(game, () => {
      const sim = at(game, l);
      holds(sim, l.min, l.max, act);
      expect(sim.state.cfg.buyIn).toEqual({ min: 70 * D, max: 70_000 * D });
    });
  }

  it('crash, a shared table', () => {
    const sim = at('crash', l, 100_000 * D, 'multi');
    expect(sim.state.phase).toBe('betting');
    holds(sim, l.min, l.max, (amount) => ({ type: 'bet', amount, auto: null }));
  });
});

describe("Hold'em at custom blinds", () => {
  it('deals at the blinds it was given, with bots bought in for 60 to 250 of them', () => {
    const blinds = { min: 25 * D, max: 60 * D };
    const sim = at('holdem', blinds, 3_000 * D);
    expect(limitsOf(sim.state.cfg)).toEqual(blinds);
    expect((sim.view(0) as HoldemView).blinds).toEqual({ sb: 25 * D, bb: 60 * D });
    for (const st of Object.values(sim.state.seats) as { bot: boolean; stack: number }[]) {
      if (!st.bot) continue;
      expect(st.stack).toBeGreaterThanOrEqual(60 * 60 * D);
      expect(st.stack).toBeLessThanOrEqual(250 * 60 * D);
    }
    // the first hand posts them
    for (let i = 0; i < 20 && !sim.state.hand; i++) sim.advance(Math.max(0, (sim.engine.deadline(sim.state) ?? sim.now) - sim.now));
    const hand = sim.state.hand!;
    const posted = hand.players.map((p: { put: number }) => p.put).sort((a: number, b: number) => a - b);
    expect(posted.filter((x: number) => x > 0)).toEqual([25 * D, 60 * D]);
  });
});

describe("Hold'em at $0.50/$1", () => {
  it('bets and raises go in half dollars, and a quarter is refused', () => {
    const sim = at('holdem', { min: 50, max: D }, 250 * D);
    for (let i = 0; i < 400; i++) {
      if (sim.state.phase === 'playing' && sim.state.hand?.toAct === 0) break;
      sim.advance(Math.max(0, (sim.engine.deadline(sim.state) ?? sim.now) - sim.now));
    }
    const v = sim.view(0) as HoldemView;
    const l = v.you!.legal!;
    expect(l.step).toBe(50);
    const range = l.bet ?? l.raise!;
    expect(range.min % 50).toBe(0);
    const kind = l.bet ? 'bet' : 'raise';
    const off = range.min + 25;
    const offAction = kind === 'bet' ? { type: 'bet', amount: off } : { type: 'raise', to: off };
    expect(sim.engine.act(sim.state, 0, offAction, sim.ctx())).toMatchObject({ refuse: 'LIMIT' });
    const on = range.min + 50;
    const onAction = kind === 'bet' ? { type: 'bet', amount: on } : { type: 'raise', to: on };
    expect(sim.engine.act(sim.state, 0, onAction, sim.ctx())).not.toHaveProperty('refuse');
  });
});
