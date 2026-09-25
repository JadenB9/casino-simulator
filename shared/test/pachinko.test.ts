import { describe, it, expect } from 'vitest';
import {
  BATCH, POCKET_DEN, REEL_DEN, DIGITS, JACKPOT_BALLS, MAX_CHAIN, POCKET_PAYS, PUBLISHED_RTP, JACKPOT_ODDS,
  drawBall, dressReels, ballsFor, ballValue, payoutFor, chainChance, expectedChain, ballReturn, rtp, isKakuhen,
} from '../src/games/pachinko/rules.ts';
import { engine, RECENT, CHAINS_KEPT, type PachinkoState, type PachinkoAction, type PachinkoView, type LaunchEvent } from '../src/games/pachinko/engine.ts';
import type { EngineCtx } from '../src/engine.ts';
import { isRefusal } from '../src/engine.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

type Sim = TableSim<PachinkoState, PachinkoAction, PachinkoView>;

/** An Rng that answers with these values in turn (randInt keeps a small x as x % n), then `rest`. */
function scripted(values: number[], rest = 0): Rng {
  let i = 0;
  return { next32: () => (i < values.length ? values[i++]! : rest) };
}

/** A published percentage as an exact fraction of 1. */
function percentFraction(s: string): [bigint, bigint] {
  const [whole, frac = ''] = s.split('.');
  return [BigInt(whole! + frac), 100n * 10n ** BigInt(frac.length)];
}

/**
 * Every way one ball can go, with its exact probability: a depth-first walk over drawBall's draws,
 * answering each with every value its range allows (20 for the pocket, 32 for the reels, 10 for
 * each jackpot number): 878,955 leaves.
 */
function everyBall(visit: (balls: number, weight: bigint, den: bigint) => void): void {
  const range = (depth: number) => (depth === 0 ? POCKET_DEN : depth === 1 ? REEL_DEN : DIGITS);
  const walk = (prefix: number[]) => {
    // play the prefix; if drawBall asks for more, branch on the next draw
    let asked = 0;
    const rng: Rng = {
      next32: () => {
        if (asked < prefix.length) return prefix[asked++]!;
        asked++;
        throw new Error('more');
      },
    };
    try {
      const o = drawBall(rng);
      let den = 1n;
      prefix.forEach((_, d) => (den *= BigInt(range(d))));
      visit(ballsFor(o), 1n, den);
    } catch (e) {
      if ((e as Error).message !== 'more') throw e;
      for (let v = 0; v < range(prefix.length); v++) walk([...prefix, v]);
    }
  };
  walk([]);
}

describe('pachinko rules', () => {
  it('sends a ball to the start pocket, a tulip or out, 1, 1, 1 and 17 in 20', () => {
    const counts: Record<string, number> = {};
    for (let k = 0; k < POCKET_DEN; k++) {
      const o = drawBall(scripted([k, 5]));
      counts[o.pocket] = (counts[o.pocket] ?? 0) + 1;
    }
    expect(counts).toEqual({ start: 1, left: 1, right: 1, out: 17 });
    expect(POCKET_PAYS).toEqual({ out: 0, left: 3, right: 3, start: 4 });
  });

  it('hits the jackpot on a start pocket ball one reel spin in 32, and chains on odd numbers up to eight', () => {
    expect(drawBall(scripted([0, 1])).chain).toEqual([]);
    expect(drawBall(scripted([0, 31])).chain).toEqual([]);
    expect(drawBall(scripted([0, 0, 4]))).toEqual({ pocket: 'start', chain: [4] });
    expect(drawBall(scripted([0, 0, 7, 3, 8]))).toEqual({ pocket: 'start', chain: [7, 3, 8] });
    expect(drawBall(scripted([0, 0, 1, 3, 5, 7, 9, 1, 3, 5, 7, 9]))).toEqual({ pocket: 'start', chain: [1, 3, 5, 7, 9, 1, 3, 5] });
    // a tulip never spins the reels
    expect(drawBall(scripted([1, 0, 7])).chain).toEqual([]);
    expect([0, 2, 4, 6, 8].map(isKakuhen)).toEqual([false, false, false, false, false]);
    expect([1, 3, 5, 7, 9].map(isKakuhen)).toEqual([true, true, true, true, true]);
    expect(JACKPOT_BALLS).toBe(150);
    expect(JACKPOT_ODDS).toBe(640);
  });

  it('pays balls as whole cents on whole-dollar batches', () => {
    for (const bet of [100, 700, 12_300, 100_000]) {
      expect(Number.isInteger(ballValue(bet))).toBe(true);
      expect(payoutFor(bet, 1_200)).toBe((bet / 25) * 1_200);
    }
    expect(ballsFor({ pocket: 'start', chain: [3, 4] })).toBe(4 + 300);
    expect(ballsFor({ pocket: 'left', chain: [] })).toBe(3);
    expect(ballsFor({ pocket: 'out', chain: [] })).toBe(0);
  });

  it('dresses the reels: three of a kind only for a jackpot, and a reach for a quarter of misses', () => {
    expect(dressReels(scripted([]), [7, 2])).toEqual([7, 7, 7]);
    // a reach: [a, m, a] with m != a
    expect(dressReels(scripted([4, 0, 4]), [])).toEqual([4, 5, 4]);
    expect(dressReels(scripted([4, 0, 3]), [])).toEqual([4, 3, 4]);
    const rng = seededRng(3);
    let reach = 0;
    const n = 40_000;
    for (let i = 0; i < n; i++) {
      const [a, b, c] = dressReels(rng, []);
      expect(a === b && b === c).toBe(false);
      if (a === c) reach++;
    }
    expect(Math.abs(reach / n - 0.25)).toBeLessThan(0.01);
  });
});

describe('pachinko returns (exact)', () => {
  it('chains hold 1-7 jackpots with chance 1/2^n and 8 with 1/128', () => {
    let num = 0;
    for (let k = 1; k <= MAX_CHAIN; k++) num += chainChance(k).num * (128 / chainChance(k).den);
    expect(num).toBe(128);
    expect(expectedChain()).toEqual({ num: 255, den: 128 });
  });

  it('every ball, walked through every draw, returns 96.69189453125% as published', () => {
    let num = 0n;
    let leaves = 0;
    // a common denominator: 20 · 32 · 10^8
    const common = BigInt(POCKET_DEN * REEL_DEN) * 10n ** 8n;
    everyBall((balls, w, den) => {
      num += BigInt(balls) * w * (common / den);
      leaves++;
    });
    // 19 + 31 + (5 + 25 + ... + 5^7) chains ending even + 5^7 · 10 reaching eight
    expect(leaves).toBe(878_955);
    const [pn, pd] = percentFraction(PUBLISHED_RTP);
    expect(num * pd).toBe(pn * common);
    const r = ballReturn();
    expect(r.num * pd).toBe(pn * r.den);
    expect(rtp()).toBe(0.9669189453125);
  });

  it('matches through the engine for every pocket, every reel stop and every chain length', () => {
    // Ball one takes each path; the other 24 go out (19); the reels' faces take whatever follows.
    // A pocket and reel stop are enumerated; a chain of length n stands for all of its kind
    // (weights from chainChance, checked against the full walk above).
    const state = engine.create(engine.config('', 'solo'), ctx(scripted([])));
    const outs = new Array<number>(BATCH - 1).fill(19);
    const launch = (draws: number[]) => {
      const step = engine.act(state, 0, { type: 'launch', bet: 2_500, power: 50 }, ctx(scripted([...draws, ...outs])));
      if (isRefusal(step)) throw new Error(step.msg);
      const ev = step.events[0] as unknown as LaunchEvent;
      expect(step.chips![0]).toEqual(ev.payout > 0 ? { seat: 0, bet: 2_500, payout: ev.payout } : { seat: 0, bet: 2_500 });
      expect(ev.shots).toHaveLength(BATCH);
      return ev;
    };
    // numerator over 20 · 32 · 128 balls, in balls
    let num = 0n;
    for (let k = 1; k < POCKET_DEN; k++) num += BigInt(launch([k]).balls) * 32n * 128n;
    for (let r = 1; r < REEL_DEN; r++) num += BigInt(launch([0, r]).balls) * 128n;
    for (let n = 1; n <= MAX_CHAIN; n++) {
      const digits = Array.from({ length: n }, (_, i) => (i < n - 1 ? 7 : 2));
      const ev = launch([0, 0, ...digits]);
      expect(ev.jackpots).toBe(n);
      expect(ev.shots[0]!.chain).toEqual(digits);
      expect(ev.shots[0]!.reels).toEqual([digits[0], digits[0], digits[0]]);
      const c = chainChance(n);
      num += BigInt(ev.balls) * BigInt(128 / c.den);
    }
    // balls per ball (the other 24 paid nothing), over 20 · 32 · 128, per ball bought
    const [pn, pd] = percentFraction(PUBLISHED_RTP);
    expect(num * pd).toBe(pn * BigInt(POCKET_DEN * REEL_DEN * 128));
  });
});

function ctx(rng: Rng, stack = 1_000_000_000): EngineCtx {
  return { rng, now: 0, mode: 'solo', started: true, seats: [{ seat: 0, accountId: 1, name: 'P0', stack, connected: true, ready: false }] };
}

function solo(stack = 1_000_000, rng: Rng = seededRng(11)): Sim {
  return new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]);
}

describe('pachinko engine', () => {
  it('takes the batch and pays its balls in one step', () => {
    const sim = solo(50_000, scripted([0, 0, 7, 4, 1, 2, 3], 19));
    sim.act(0, { type: 'launch', bet: 1_000, power: 64 });
    const ev = sim.lastEvents[0] as LaunchEvent;
    // ball 1: a two-jackpot chain; 2 left tulip; 3 right tulip; 4 out; the rest out
    expect(ev.shots.slice(0, 4)).toEqual([{ pocket: 'start', reels: [7, 7, 7], chain: [7, 4] }, { pocket: 'left' }, { pocket: 'right' }, { pocket: 'out' }]);
    expect(ev.balls).toBe(4 + 300 + 3 + 3);
    expect(ev.payout).toBe(40 * 310);
    expect(ev.jackpots).toBe(2);
    expect(ev.power).toBe(64);
    expect(ev.stack).toBe(50_000 - 1_000 + 12_400);
    expect(sim.stack(0)).toBe(ev.stack);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 12_400 }]);
    expect(ev.data).toEqual({ spins: 0, jackpots: 2, best: 2, chains: [2] });
  });

  it('keeps the data lamp: spins since the last jackpot, jackpots and chains', () => {
    const sim = solo(1_000_000, seededRng(8));
    let spins = 0;
    let jackpots = 0;
    for (let i = 0; i < 400; i++) {
      sim.act(0, { type: 'launch', bet: 100, power: 50 });
      const ev = sim.lastEvents[0] as LaunchEvent;
      for (const s of ev.shots) {
        if (s.pocket !== 'start') continue;
        spins = s.chain ? 0 : spins + 1;
        jackpots += s.chain?.length ?? 0;
      }
      expect(ev.data.spins).toBe(spins);
      expect(ev.data.jackpots).toBe(jackpots);
    }
    const v = sim.view(0);
    expect(v.recent).toHaveLength(RECENT);
    expect(v.data.chains.length).toBeLessThanOrEqual(CHAINS_KEPT);
    expect(jackpots).toBeGreaterThan(0);
  });

  it('refuses batches off the limits, off the dollar, or beyond the stack', () => {
    const sim = solo(5_000);
    const refused = (a: object) => sim.act(0, { type: 'launch', power: 50, ...a }, { allowRefusal: true }).refused;
    expect(refused({ bet: 50 })).toBe('LIMIT');
    expect(refused({ bet: 150 })).toBe('LIMIT');
    expect(refused({ bet: 100_100 })).toBe('LIMIT');
    expect(refused({ bet: 5_100 })).toBe('NOT_ENOUGH_CHIPS');
    expect(refused({ bet: 5_000 })).toBeUndefined();
  });

  it('reads the table limits from the config', () => {
    const cfg = engine.config('', 'solo');
    cfg.limits.default = { min: 500, max: 2_000, step: 100 };
    const sim = new TableSim(engine, seededRng(3), 'solo', [{ seat: 0, stack: 100_000 }], cfg);
    expect(sim.act(0, { type: 'launch', bet: 400, power: 1 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'launch', bet: 2_100, power: 1 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'launch', bet: 2_000, power: 1 }, { allowRefusal: true }).refused).toBeUndefined();
  });

  it('parses only well-formed launches', () => {
    expect(engine.parseAction({ type: 'launch', bet: 100, power: 0 })).toEqual({ type: 'launch', bet: 100, power: 0 });
    expect(engine.parseAction({ type: 'launch', bet: 100, power: 100 })).toEqual({ type: 'launch', bet: 100, power: 100 });
    expect(engine.parseAction({ type: 'launch', bet: 100, power: 101 })).toBeNull();
    expect(engine.parseAction({ type: 'launch', bet: 100, power: -1 })).toBeNull();
    expect(engine.parseAction({ type: 'launch', bet: 100, power: 2.5 })).toBeNull();
    expect(engine.parseAction({ type: 'launch', bet: '100', power: 5 })).toBeNull();
    expect(engine.parseAction({ type: 'launch', bet: 100 })).toBeNull();
    expect(engine.parseAction({ type: 'spin' })).toBeNull();
    expect(engine.parseAction(null)).toBeNull();
  });

  it('refuses a player who has not bought in, never leaves chips down, never mutates its input', () => {
    const state = engine.create(engine.config('', 'solo'), ctx(scripted([])));
    const res = engine.act(state, 0, { type: 'launch', bet: 100, power: 5 }, { ...ctx(scripted([])), seats: [] });
    expect(isRefusal(res) && res.refuse).toBe('NOT_SEATED');
    const sim = solo();
    const before = structuredClone(sim.state);
    const frozen = sim.state;
    sim.act(0, { type: 'launch', bet: 100, power: 5 });
    expect(frozen).toEqual(before);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.tick(sim.state, sim.ctx())).toBeNull();
    expect(engine.deadline(sim.state)).toBeNull();
  });

  it('keeps every chip: the stack changes by payout minus bet on every launch', () => {
    const sim = solo(10_000_000, seededRng(99));
    let expected = sim.stack(0);
    for (let i = 0; i < 2_000; i++) {
      const bet = 100 * (1 + (i % 9));
      sim.act(0, { type: 'launch', bet, power: i % 101 });
      const ev = sim.lastEvents[0] as LaunchEvent;
      expected += ev.payout - bet;
      const balls = ev.shots.reduce((n, s) => n + POCKET_PAYS[s.pocket] + (s.chain?.length ?? 0) * JACKPOT_BALLS, 0);
      expect(ev.balls).toBe(balls);
      expect(ev.payout).toBe((bet / 25) * balls);
      expect(sim.stack(0)).toBe(expected);
    }
  });
});
