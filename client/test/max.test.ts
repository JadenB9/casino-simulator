// Max at every table (client/src/table/max.ts), played against the engines themselves: the amount
// Max puts down is accepted, and one step more is refused, at tables of chosen limits, with
// plenty of chips and with few, with bets already down.

import { describe, expect, it } from 'vitest';
import type { GameEngine, TableConfig } from '../../shared/src/engine.ts';
import { isRefusal } from '../../shared/src/engine.ts';
import type { Rng } from '../../shared/src/rng.ts';
import { applyLimits, type MaxBet, type TableLimits } from '../../shared/src/limits.ts';
import { engine as blackjack } from '../../shared/src/games/blackjack/engine.ts';
import { engine as roulette } from '../../shared/src/games/roulette/engine.ts';
import { spotByKey, spotKey } from '../../shared/src/games/roulette/rules.ts';
import { engine as bigsix } from '../../shared/src/games/bigsix/engine.ts';
import { engine as sicbo } from '../../shared/src/games/sicbo/engine.ts';
import { spotByKey as sicboSpot } from '../../shared/src/games/sicbo/rules.ts';
import { engine as baccarat } from '../../shared/src/games/baccarat/engine.ts';
import { engine as threecard } from '../../shared/src/games/threecard/engine.ts';
import { engine as war } from '../../shared/src/games/war/engine.ts';
import { engine as craps } from '../../shared/src/games/craps/engine.ts';
import type { CrapsView } from '../../shared/src/games/craps/protocol.ts';
import { TableSim } from '../../shared/test/helpers/table-sim.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';
import { baccaratMax, bigSixMax, blackjackMax, chipOn, crapsMax, crapsOddsMax, maxRefusal, rouletteMax, sicBoMax, threeCardMax, warMax } from '../src/table/max.ts';

const D = 100;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sim = TableSim<any, any, any>;

function table(engine: GameEngine<any, any, any>, limits: TableLimits | null, stack: number, variant = '', rng: Rng = seededRng(7), options: Record<string, unknown> = {}): { sim: Sim; cfg: TableConfig } {
  const base = engine.config(variant, 'solo');
  const withLimits = limits ? applyLimits(base, limits) : base;
  const cfg = { ...withLimits, options: { ...withLimits.options, ...options } };
  return { sim: new TableSim(engine, rng, 'solo', [{ seat: 0, stack }], cfg), cfg };
}

/** The refusal an action would get, or null if it would go down (the state is left alone). */
function wouldRefuse(sim: Sim, raw: unknown): string | null {
  const a = sim.engine.parseAction(raw);
  if (a === null) return 'PARSE';
  const r = sim.engine.act(sim.state, 0, a, sim.ctx());
  return isRefusal(r) ? r.refuse : null;
}

function amountOf(m: MaxBet): number {
  if ('none' in m) throw new Error(`no max: ${m.none}`);
  return m.amount;
}

/** Max goes down; a step more would not. */
function exact(sim: Sim, m: MaxBet, step: number, act: (amount: number) => unknown): void {
  const amount = amountOf(m);
  expect(wouldRefuse(sim, act(amount + step)), `max + ${step}`).not.toBeNull();
  expect(wouldRefuse(sim, act(amount)), `max ${amount}`).toBeNull();
  sim.act(0, act(amount));
}

describe('blackjack: the main bet', () => {
  const L = { min: 25 * D, max: 2_500 * D };
  it('up to the table maximum', () => {
    const { sim, cfg } = table(blackjack, L, 10_000 * D);
    exact(sim, blackjackMax(cfg.limits.default, 0, sim.stack(0)), D, (amount) => ({ type: 'bet', amount }));
    expect(sim.stack(0)).toBe(7_500 * D);
    expect(blackjackMax(cfg.limits.default, 2_500 * D, sim.stack(0))).toEqual({ none: 'AT_MAX' });
  });
  it('or every chip at the table, on top of what is down', () => {
    const { sim, cfg } = table(blackjack, L, 700 * D);
    sim.act(0, { type: 'bet', amount: 100 * D });
    exact(sim, blackjackMax(cfg.limits.default, 100 * D, sim.stack(0)), D, (amount) => ({ type: 'bet', amount }));
    expect(sim.stack(0)).toBe(0);
  });
  it('nothing when the chips are short of the minimum', () => {
    const { cfg } = table(blackjack, L, 20 * D);
    const m = blackjackMax(cfg.limits.default, 0, 20 * D);
    expect(m).toEqual({ none: 'SHORT' });
    expect(maxRefusal(m as { none: 'SHORT' }, cfg.limits.default)).toBe('Not enough chips for the $25 minimum there.');
  });
});

describe('roulette: the spot clicked', () => {
  const L = { min: 25 * D, max: 10_000 * D };
  const bet = (key: string, amount: number) => {
    const s = spotByKey('american', key)!;
    return { type: 'bet', bets: [{ kind: s.kind, ...(s.inside ? { numbers: [...s.numbers] } : {}), amount }] };
  };
  it('an inside number and an outside bet, each to its own maximum', () => {
    const { sim, cfg } = table(roulette, L, 50_000 * D, 'american');
    const seventeen = spotByKey('american', spotKey('straight', [17]))!;
    exact(sim, rouletteMax(cfg, seventeen, {}, sim.stack(0)), D, (a) => bet(seventeen.key, a));
    expect(sim.stack(0)).toBe(49_000 * D);
    const red = spotByKey('american', 'red')!;
    exact(sim, rouletteMax(cfg, red, { [seventeen.key]: 1_000 * D }, sim.stack(0)), D, (a) => bet('red', a));
  });
  it('and the table maximum a spin caps the rest', () => {
    const { sim, cfg } = table(roulette, L, 50_000 * D, 'american');
    sim.act(0, bet('red', 10_000 * D));
    sim.act(0, bet('black', 9_500 * D));
    const odd = spotByKey('american', 'odd')!;
    const m = rouletteMax(cfg, odd, { red: 10_000 * D, black: 9_500 * D }, sim.stack(0));
    expect(m).toEqual({ amount: 500 * D });
    exact(sim, m, D, (a) => bet('odd', a));
  });
});

describe('Big Six and Sic Bo: the spot clicked', () => {
  it('Big Six: the spot maximum, then the table maximum a spin', () => {
    const { sim, cfg } = table(bigsix, { min: 5 * D, max: 1_000 * D }, 20_000 * D);
    const act = (spot: string) => (amount: number) => ({ type: 'bet', bets: [{ spot, amount }] });
    exact(sim, bigSixMax(cfg, 'one', {}, sim.stack(0)), D, act('one'));
    const down: Record<string, number> = { one: 1_000 * D };
    for (const s of ['two', 'five', 'ten']) {
      exact(sim, bigSixMax(cfg, s, down, sim.stack(0)), D, act(s));
      down[s] = 1_000 * D;
    }
    // $4,000 down of $5,000 a spin
    const m = bigSixMax(cfg, 'twenty', down, sim.stack(0));
    expect(m).toEqual({ amount: 1_000 * D });
    exact(sim, m, D, act('twenty'));
    expect(bigSixMax(cfg, 'star', { ...down, twenty: 1_000 * D }, sim.stack(0))).toEqual({ none: 'AT_MAX' });
  });
  it('Sic Bo: each class of bet to its own maximum, and your chips', () => {
    const { sim, cfg } = table(sicbo, { min: 25 * D, max: 10_000 * D }, 3_000 * D);
    const act = (spot: string) => (amount: number) => ({ type: 'bet', bets: [{ spot, amount }] });
    const triple = sicboSpot('triple:6')!;
    exact(sim, sicBoMax(cfg, triple, {}, sim.stack(0)), D, act('triple:6'));
    expect(sim.stack(0)).toBe(2_800 * D);
    const big = sicboSpot('big')!;
    exact(sim, sicBoMax(cfg, big, { 'triple:6': 200 * D }, sim.stack(0)), D, act('big'));
    expect(sim.stack(0)).toBe(0);
  });
});

describe('baccarat: the side clicked', () => {
  it('Banker to its maximum, Tie to its own', () => {
    const { sim, cfg } = table(baccarat, { min: 100 * D, max: 25_000 * D }, 40_000 * D);
    exact(sim, baccaratMax(cfg, 'banker', {}, sim.stack(0)), D, (banker) => ({ type: 'bet', banker }));
    exact(sim, baccaratMax(cfg, 'tie', { banker: 25_000 * D }, sim.stack(0)), D, (tie) => ({ type: 'bet', tie }));
    expect(sim.stack(0)).toBe(10_000 * D);
    exact(sim, baccaratMax(cfg, 'playerPair', { banker: 25_000 * D, tie: 5_000 * D }, sim.stack(0)), D, (playerPair) => ({ type: 'bet', playerPair }));
  });
});

describe('Three Card Poker: the Ante keeps its Play back; Pair Plus on its own', () => {
  const L = { min: 25 * D, max: 2_500 * D };
  it('with plenty of chips, each to its maximum', () => {
    const { sim, cfg } = table(threecard, L, 20_000 * D);
    const ante = amountOf(threeCardMax(cfg, 'ante', { ante: 0, pairPlus: 0 }, sim.stack(0)));
    expect(ante).toBe(2_500 * D);
    exact(sim, { amount: ante }, D, (a) => ({ type: 'bet', ante: a, pairPlus: 0 }));
    const pp = amountOf(threeCardMax(cfg, 'pairPlus', { ante, pairPlus: 0 }, sim.stack(0)));
    expect(pp).toBe(1_250 * D);
    exact(sim, { amount: pp }, D, (p) => ({ type: 'bet', ante, pairPlus: p }));
  });
  it('with few, the Ante is half of them and Pair Plus what the Play leaves', () => {
    const { sim, cfg } = table(threecard, L, 901 * D);
    const ante = amountOf(threeCardMax(cfg, 'ante', { ante: 0, pairPlus: 0 }, sim.stack(0)));
    expect(ante).toBe(450 * D);
    exact(sim, { amount: ante }, D, (a) => ({ type: 'bet', ante: a, pairPlus: 0 }));
    // $451 left, $450 of it the Play's
    const pp = threeCardMax(cfg, 'pairPlus', { ante, pairPlus: 0 }, sim.stack(0));
    expect(pp).toEqual({ none: 'SHORT' });
    expect(wouldRefuse(sim, { type: 'bet', ante, pairPlus: 13 * D })).not.toBeNull();
  });
  it('an Ante already down goes up by half of what is left over it', () => {
    const { sim, cfg } = table(threecard, L, 1_000 * D);
    sim.act(0, { type: 'bet', ante: 100 * D, pairPlus: 50 * D });
    const m = threeCardMax(cfg, 'ante', { ante: 100 * D, pairPlus: 50 * D }, sim.stack(0));
    // $850 left: $375 more on the Ante makes it $475, and $475 stays back for the Play
    expect(m).toEqual({ amount: 375 * D });
    exact(sim, m, D, (x) => ({ type: 'bet', ante: 100 * D + x, pairPlus: 50 * D }));
  });
});

describe('War: the bet keeps a war raise back', () => {
  it('half the chips, or the table maximum', () => {
    const { sim, cfg } = table(war, { min: 10 * D, max: 1_000 * D }, 1_201 * D);
    const m = warMax(cfg, { bet: 0, tie: 0 }, sim.stack(0));
    expect(m).toEqual({ amount: 600 * D });
    exact(sim, m, D, (bet) => ({ type: 'bet', bet, tie: 0 }));
    const rich = table(war, { min: 10 * D, max: 1_000 * D }, 5_000 * D);
    exact(rich.sim, warMax(rich.cfg, { bet: 0, tie: 0 }, 5_000 * D), D, (bet) => ({ type: 'bet', bet, tie: 0 }));
    expect(rich.sim.stack(0)).toBe(4_000 * D);
  });
});

/** Loaded dice: each roll takes the next two queued faces. */
class Dice implements Rng {
  private q: number[] = [];
  set(d1: number, d2: number): void {
    this.q.push(d1 - 1, d2 - 1);
  }
  next32(): number {
    const x = this.q.shift();
    if (x === undefined) throw new Error('no dice queued');
    return x;
  }
}

describe('craps: the line, lay bets and max odds', () => {
  const L = { min: 25 * D, max: 10_000 * D };
  it('the pass line, then max odds behind it: 3-4-5x the bet, in the odds step', () => {
    const dice = new Dice();
    const { sim, cfg } = table(craps, L, 100_000 * D, '', dice);
    exact(sim, crapsMax(cfg, 'pass', undefined, undefined, sim.stack(0)), D, (amount) => ({ type: 'bet', bets: [{ kind: 'pass', amount }] }));
    dice.set(3, 3);
    sim.act(0, { type: 'roll' });
    const v = sim.view(0) as CrapsView;
    expect(v.point).toBe(6);
    const flat = v.bets[0]!.pass!;
    const m = crapsOddsMax(cfg, 'pass', flat, 6, sim.stack(0));
    expect(m).toEqual({ amount: 50_000 * D });
    exact(sim, m, D, (amount) => ({ type: 'odds', on: 'pass', amount }));
  });
  it('odds with few chips: what is left, in $1 steps behind the line', () => {
    const dice = new Dice();
    const { sim, cfg } = table(craps, L, 1_234 * D, '', dice);
    sim.act(0, { type: 'bet', bets: [{ kind: 'pass', amount: 1_000 * D }] });
    dice.set(2, 2);
    sim.act(0, { type: 'roll' });
    const flat = (sim.view(0) as CrapsView).bets[0]!.pass!;
    exact(sim, crapsOddsMax(cfg, 'pass', flat, 4, sim.stack(0)), D, (amount) => ({ type: 'odds', on: 'pass', amount }));
    expect(sim.stack(0)).toBe(0);
  });
  it("don't pass laid odds up to 6x, in the $6 steps of a 6", () => {
    const dice = new Dice();
    const { sim, cfg } = table(craps, L, 5_000 * D, '', dice);
    sim.act(0, { type: 'bet', bets: [{ kind: 'dontpass', amount: 500 * D }] });
    dice.set(4, 4);
    sim.act(0, { type: 'roll' });
    const flat = (sim.view(0) as CrapsView).bets[0]!.dontpass!;
    const m = crapsOddsMax(cfg, 'dontpass', flat, 8, sim.stack(0));
    // 6x the $500 is $3,000, which is $6 steps exactly, and $4,500 is left to cover it
    expect(m).toEqual({ amount: 3_000 * D });
    exact(sim, m, 6 * D, (amount) => ({ type: 'odds', on: 'dontpass', amount }));
  });
  it('a lay bet with its commission paid up front', () => {
    const { sim, cfg } = table(craps, L, 700 * D, '', seededRng(3), { lay: true });
    const m = crapsMax(cfg, 'lay', 4, undefined, sim.stack(0));
    // lay 4 in $2 steps wins half the bet, and 5% of that win is paid now: $682 costs $682 + $17.05
    expect(m).toEqual({ amount: 682 * D });
    exact(sim, m, 2 * D, (amount) => ({ type: 'bet', bets: [{ kind: 'lay', number: 4, amount }] }));
    expect(sim.stack(0)).toBeLessThan(2 * D);
  });
  it('lay 5/9 and 6/8 in their steps, from a big stack and onto a lay already down', () => {
    for (const [n, step, stack] of [[5, 3, 12_345], [9, 3, 777], [6, 6, 9_999], [8, 6, 20_000]] as const) {
      const { sim, cfg } = table(craps, L, stack * D, '', seededRng(n), { lay: true });
      const lay = (amount: number) => ({ type: 'bet', bets: [{ kind: 'lay', number: n, amount }] });
      // from nothing, with every chip
      const first = crapsMax(cfg, 'lay', n, undefined, sim.stack(0));
      expect(wouldRefuse(sim, lay(amountOf(first) + step * D))).not.toBeNull();
      expect(wouldRefuse(sim, lay(amountOf(first)))).toBeNull();
      // then onto a lay made with about half of them
      sim.act(0, lay(amountOf(crapsMax(cfg, 'lay', n, undefined, (stack * D) / 2))));
      const down = (sim.view(0) as CrapsView).bets[0]![`lay${n}`]!;
      const m = crapsMax(cfg, 'lay', n, down, sim.stack(0));
      if ('amount' in m) exact(sim, m, step * D, (amount) => ({ type: 'bet', bets: [{ kind: 'lay', number: n, amount }] }));
      else expect(m.none).toBe('AT_MAX');
    }
  });
  it('place 6 in its $6 steps', () => {
    const dice = new Dice();
    const { sim, cfg } = table(craps, L, 1_000 * D, '', dice);
    sim.act(0, { type: 'bet', bets: [{ kind: 'pass', amount: 25 * D }] });
    exact(sim, crapsMax(cfg, 'place', 6, undefined, sim.stack(0)), 6 * D, (amount) => ({ type: 'bet', bets: [{ kind: 'place', number: 6, amount }] }));
    expect(sim.stack(0)).toBeLessThan(6 * D);
  });
});

describe('Max per hand when one player plays several (solo multi-hand)', () => {
  it('Three Card: each Ante keeps its own Play back and every other hand\'s', () => {
    const { sim, cfg } = table(threecard, { min: 25 * D, max: 2_500 * D }, 1_200 * D);
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', spot: 0, ante: 100 * D, pairPlus: 0 });
    sim.act(0, { type: 'bet', spot: 1, ante: 100 * D, pairPlus: 0 });
    // $1,000 left: $200 of it the first two hands' Plays, the third hand's Ante half the rest
    const m = threeCardMax(cfg, 'ante', { ante: 0, pairPlus: 0 }, sim.stack(0), 200 * D);
    expect(m).toEqual({ amount: 400 * D });
    exact(sim, m, D, (ante) => ({ type: 'bet', spot: 2, ante, pairPlus: 0 }));
    const pp = threeCardMax(cfg, 'pairPlus', { ante: 100 * D, pairPlus: 0 }, sim.stack(0), 500 * D);
    expect(pp).toEqual({ none: 'SHORT' });
  });

  it("War: each bet keeps its own raise back and every other hand's", () => {
    const { sim, cfg } = table(war, { min: 10 * D, max: 1_000 * D }, 900 * D);
    sim.act(0, { type: 'spots', n: 2 });
    sim.act(0, { type: 'bet', spot: 0, bet: 100 * D, tie: 0 });
    // $800 left, $100 of it the first hand's raise: the second hand's bet is half the rest
    const m = warMax(cfg, { bet: 0, tie: 0 }, sim.stack(0), 100 * D);
    expect(m).toEqual({ amount: 350 * D });
    exact(sim, m, D, (bet) => ({ type: 'bet', spot: 1, bet, tie: 0 }));
  });

  it('Blackjack: each circle to its own maximum, from what the others left', () => {
    const { sim, cfg } = table(blackjack, { min: 25 * D, max: 2_500 * D }, 4_000 * D);
    sim.act(0, { type: 'spots', n: 2 });
    sim.act(0, { type: 'bet', spot: 0, amount: 2_500 * D });
    const m = blackjackMax(cfg.limits.default, 0, sim.stack(0));
    expect(m).toEqual({ amount: 1_500 * D });
    exact(sim, m, D, (amount) => ({ type: 'bet', spot: 1, amount }));
  });
});

describe('a chip short of a spot minimum', () => {
  it('puts the minimum down, in the step', () => {
    expect(chipOn(5 * D, 0, { min: 10 * D, max: 1_000 * D, step: D })).toBe(10 * D);
    expect(chipOn(5 * D, 7 * D, { min: 10 * D, max: 1_000 * D, step: D })).toBe(5 * D);
    expect(chipOn(D, 0, { min: 25 * D, max: 5_000 * D, step: 6 * D })).toBe(30 * D);
    expect(chipOn(100 * D, 0, { min: 25 * D, max: 5_000 * D, step: D })).toBe(100 * D);
  });
});
