import { describe, it, expect } from 'vitest';
import { MAX_STREAK, streakMult, streakPayout, returnAt, isSide } from '../src/games/coinflip/rules.ts';
import { engine, RECENT, type CoinflipAction, type CoinflipState, type CoinflipView } from '../src/games/coinflip/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { queuedRng } from './online-rng.ts';

type Sim = TableSim<CoinflipState, CoinflipAction, CoinflipView>;

// randInt(rng, 2) returns a queued 0 as heads and 1 as tails.
const H = 0;
const T = 1;

function solo(queue: number[] = [], stack = 100_000): Sim {
  return new TableSim(engine, queuedRng(queue, 5), 'solo', [{ seat: 0, stack }]);
}

describe('coinflip rules', () => {
  it('pays 0.99 × 2^k in hundredths: 1.98×, 3.96×, 7.92×, ... 1,038,090.24× at twenty', () => {
    expect(streakMult(0)).toBe(0);
    expect(streakMult(1)).toBe(198);
    expect(streakMult(2)).toBe(396);
    expect(streakMult(3)).toBe(792);
    expect(streakMult(10)).toBe(101_376);
    expect(streakMult(MAX_STREAK)).toBe(103_809_024);
    expect(MAX_STREAK).toBe(20);
    expect(streakPayout(100, 1)).toBe(198);
    expect(Number.isSafeInteger(streakPayout(100_000_00, MAX_STREAK))).toBe(true);
    expect(isSide('heads') && isSide('tails') && !isSide('edge')).toBe(true);
  });

  it('every stop returns exactly 99% (closed form, all twenty)', () => {
    for (let k = 1; k <= MAX_STREAK; k++) {
      const r = returnAt(k);
      expect(BigInt(r.num) * 100n).toBe(BigInt(r.den) * 99n);
    }
  });

  it('any plan for when to stop returns exactly 99%: every path of eight flips, through the engine', () => {
    // Three plans: stop at a fixed streak, stop when the coin has shown tails twice, and stop
    // at a streak that depends on the first side seen. Each of the 2^8 coin sequences is equally
    // likely; the sum of what came back over all of them must be 0.99 × the sum wagered.
    const plans: ((flips: number[]) => boolean)[] = [
      (f) => f.length >= 3,
      (f) => f.filter((x) => x === T).length >= 2 || f.length >= 7,
      (f) => f.length >= (f[0] === H ? 2 : 5),
    ];
    for (const stop of plans) {
      let wagered = 0n;
      let returned = 0n;
      for (let path = 0; path < 256; path++) {
        const coins = Array.from({ length: 8 }, (_, i) => (path >> i) & 1);
        const sim = solo([...coins], 1_000_000);
        const before = sim.stack(0);
        // always call heads: a right call is a queued 0
        sim.act(0, { type: 'bet', amount: 500, side: 'heads' });
        const seen = [coins[0]!];
        while (sim.state.phase === 'playing') {
          if (stop(seen)) sim.act(0, { type: 'cashout' });
          else {
            sim.act(0, { type: 'flip', side: 'heads' });
            seen.push(coins[seen.length]!);
          }
        }
        wagered += 500n;
        returned += BigInt(sim.stack(0) - before + 500);
      }
      expect(returned * 100n).toBe(wagered * 99n);
    }
  });
});

describe('coinflip engine', () => {
  it('a wrong first call loses the bet and ends the round', () => {
    const sim = solo([T]);
    sim.act(0, { type: 'bet', amount: 1_000, side: 'heads' });
    expect(sim.state.phase).toBe('over');
    expect(sim.stack(0)).toBe(99_000);
    expect(sim.state.result).toMatchObject({ outcome: 'bust', streak: 0, mult: 0, payout: 0 });
    expect(sim.rounds.at(-1)).toMatchObject({ wagered: 1_000, returned: 0 });
    expect(sim.view(0).recent).toHaveLength(1);
  });

  it('builds a streak, then cashes out at 0.99 × 2^k', () => {
    const sim = solo([T, H, T]);
    sim.act(0, { type: 'bet', amount: 1_000, side: 'tails' });
    expect(sim.state.phase).toBe('playing');
    expect(sim.stack(0)).toBe(99_000);
    expect(engine.liveBets(sim.state, 0)).toBe(1_000);
    expect(sim.view(0)).toMatchObject({ streak: 1, mult: 198 });
    sim.act(0, { type: 'flip', side: 'heads' });
    sim.act(0, { type: 'flip', side: 'tails' });
    expect(sim.view(0)).toMatchObject({ streak: 3, mult: 792 });
    sim.act(0, { type: 'cashout' });
    expect(sim.stack(0)).toBe(99_000 + 7_920);
    expect(sim.state.result).toMatchObject({ outcome: 'cashout', streak: 3, mult: 792, payout: 7_920 });
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(sim.rounds.at(-1)).toMatchObject({ wagered: 1_000, returned: 7_920 });
  });

  it('a wrong call mid-streak loses what rode', () => {
    const sim = solo([H, H, T]);
    sim.act(0, { type: 'bet', amount: 100, side: 'heads' });
    sim.act(0, { type: 'flip', side: 'heads' });
    sim.act(0, { type: 'flip', side: 'heads' });
    expect(sim.state.result).toMatchObject({ outcome: 'bust', streak: 2, payout: 0 });
    expect(sim.stack(0)).toBe(99_900);
    expect(sim.view(0).streak).toBe(2);
  });

  it('twenty right calls cash out on their own', () => {
    const sim = solo(new Array(MAX_STREAK).fill(H), 10_000);
    sim.act(0, { type: 'bet', amount: 100, side: 'heads' });
    for (let i = 1; i < MAX_STREAK; i++) sim.act(0, { type: 'flip', side: 'heads' });
    expect(sim.state.phase).toBe('over');
    expect(sim.state.result).toMatchObject({ outcome: 'max', streak: 20, mult: 103_809_024 });
    expect(sim.stack(0)).toBe(10_000 - 100 + 103_809_024);
  });

  it('refuses what the rules do not allow', () => {
    const sim = solo([H]);
    expect(sim.act(0, { type: 'cashout' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'flip', side: 'heads' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'bet', amount: 150, side: 'heads' }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'bet', amount: 200_000, side: 'heads' }, { allowRefusal: true }).refused).toBe('LIMIT');
    const poor = solo([H], 500);
    expect(poor.act(0, { type: 'bet', amount: 600, side: 'heads' }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    sim.act(0, { type: 'bet', amount: 100, side: 'heads' });
    expect(sim.act(0, { type: 'bet', amount: 100, side: 'heads' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(engine.parseAction({ type: 'bet', amount: 100, side: 'edge' })).toBeNull();
    expect(engine.parseAction({ type: 'bet', amount: 1.5, side: 'heads' })).toBeNull();
    expect(engine.parseAction({ type: 'flip' })).toBeNull();
    expect(engine.parseAction({ type: 'cashout', extra: 1 })).toEqual({ type: 'cashout' });
  });

  it('standing up with a streak cashes it out', () => {
    const sim = solo([H, H]);
    sim.act(0, { type: 'bet', amount: 100, side: 'heads' });
    sim.act(0, { type: 'flip', side: 'heads' });
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(sim.state.result).toMatchObject({ outcome: 'cashout', streak: 2, payout: 396 });
    expect(sim.stack(0)).toBe(100_000 - 100 + 396);
  });

  it('keeps the last rounds, and a round never leaks anything: each flip is drawn when called', () => {
    const sim = new TableSim(engine, seededRng(8), 'solo', [{ seat: 0, stack: 1_000_000 }]);
    for (let i = 0; i < RECENT + 4; i++) {
      sim.act(0, { type: 'bet', amount: 100, side: i % 2 ? 'heads' : 'tails' });
      if (sim.state.phase === 'playing') sim.act(0, { type: 'cashout' });
    }
    expect(sim.view(0).recent).toHaveLength(RECENT);
    expect(sim.view(0).recent[0]!.round).toBe(RECENT + 4);
    // the state holds nothing but what has happened
    expect(Object.keys(sim.state).sort()).toEqual(['bet', 'cfg', 'flips', 'phase', 'recent', 'result', 'round', 'seat']);
  });
});
