import { describe, it, expect } from 'vitest';
import { RANKS, MAX_MULT, MAX_SKIPS, winCount, wins, guessLabel, exact, payMult, guessAllowed, singleReturn, bestFirstGuess, drawCard, type Guess } from '../src/games/hilo/rules.ts';
import { engine, type HiloAction, type HiloState, type HiloView } from '../src/games/hilo/engine.ts';
import { newDeck, rankNumber } from '../src/cards.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';

type Sim = TableSim<HiloState, HiloAction, HiloView>;
const DECK = newDeck();
const ranks = Array.from({ length: RANKS }, (_, i) => i + 1);

/** A generator whose next draws can be queued (a card is DECK[x % 52]), then a seeded stream. */
function steerable(seed = 4) {
  const base = seededRng(seed);
  const queue: number[] = [];
  const rng: Rng = { next32: () => (queue.length ? queue.shift()! : base.next32()) };
  return { rng, next: (...cards: string[]) => queue.push(...cards.map((c) => DECK.indexOf(c as never))) };
}

function solo(first: string, stack = 100_000): { sim: Sim; next: (...cards: string[]) => void } {
  const { rng, next } = steerable();
  next(first);
  return { sim: new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]), next };
}

describe('hi-lo rules', () => {
  it("offers Stake's buttons: higher or same / lower or same, strictly higher and same on an ace, same and strictly lower on a king", () => {
    expect([guessLabel(1, 'hi'), guessLabel(1, 'lo')]).toEqual(['Higher', 'Same']);
    expect([guessLabel(13, 'hi'), guessLabel(13, 'lo')]).toEqual(['Same', 'Lower']);
    for (let r = 2; r <= 12; r++) expect([guessLabel(r, 'hi'), guessLabel(r, 'lo')]).toEqual(['Higher or same', 'Lower or same']);
  });

  it('counts the winning ranks of every guess on every card, and neither button is ever certain', () => {
    for (const r of ranks) {
      for (const g of ['hi', 'lo'] as Guess[]) {
        const n = ranks.filter((next) => wins(r, g, next)).length;
        expect(n).toBe(winCount(r, g));
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(12);
      }
    }
    // Stake's percentages: an ace is 12/13 higher and 1/13 same, a 7 is 7/13 either way
    expect([winCount(1, 'hi'), winCount(1, 'lo')]).toEqual([12, 1]);
    expect([winCount(7, 'hi'), winCount(7, 'lo')]).toEqual([7, 7]);
    expect([winCount(2, 'hi'), winCount(2, 'lo')]).toEqual([12, 2]);
    expect([winCount(13, 'hi'), winCount(13, 'lo')]).toEqual([1, 12]);
    expect(wins(1, 'hi', 1)).toBe(false);
    expect(wins(13, 'lo', 13)).toBe(false);
    expect(wins(13, 'hi', 13)).toBe(true);
  });

  it('multiplies by 12.87 / count per win and floors only the product, when paid', () => {
    expect(payMult([])).toBe(0);
    expect([1, 2, 3, 7, 12].map((c) => payMult([c]))).toEqual([1_287, 643, 429, 183, 107]);
    // 1.0725 × 1.0725 = 1.15025625 -> 1.15
    expect(payMult([12, 12])).toBe(115);
    // 1.83857... × 1.287 = 2.36624... -> 2.36 (flooring each step, 1.83 × 1.28, would pay 2.34)
    expect(payMult([7, 10])).toBe(236);
    const { num, den } = exact([7, 10]);
    expect(num).toBe(1_287n * 1_287n);
    expect(den).toBe(100n * 100n * 70n);
  });

  it('one guess and cash out returns floor(1287/count) × count / 1300: 98.46% to 99.00%', () => {
    const table = ranks.slice(0, 12).map((c) => singleReturn(c).num);
    expect(table).toEqual([1287, 1286, 1287, 1284, 1285, 1284, 1281, 1280, 1287, 1280, 1287, 1284]);
    for (let c = 1; c <= 12; c++) expect(singleReturn(c).den).toBe(1300);
  });

  it('every guess is worth 0.99 of what rides before the floor, whatever the card (exact)', () => {
    // E[factor × win] = (count / 13) × 1287 / (100 × count) = 0.99 for every rank and guess
    for (const r of ranks) {
      for (const g of ['hi', 'lo'] as Guess[]) {
        const c = BigInt(winCount(r, g));
        expect(c * 1287n * 100n).toBe(99n * 13n * 100n * c);
      }
    }
    // Two guesses on the likelier side, then cash out, enumerated over all 13^3 rank paths:
    // unfloored exactly 0.99^2, floored below it.
    let floored = 0n;
    let unfloored = { num: 0n, den: 1n };
    for (const r0 of ranks) {
      const g0: Guess = winCount(r0, 'hi') >= winCount(r0, 'lo') ? 'hi' : 'lo';
      for (const r1 of ranks) {
        if (!wins(r0, g0, r1)) continue;
        const g1: Guess = winCount(r1, 'hi') >= winCount(r1, 'lo') ? 'hi' : 'lo';
        for (const r2 of ranks) {
          if (!wins(r1, g1, r2)) continue;
          const counts = [winCount(r0, g0), winCount(r1, g1)];
          floored += BigInt(payMult(counts));
          const e = exact(counts);
          unfloored = { num: unfloored.num * e.den + e.num * unfloored.den, den: unfloored.den * e.den };
        }
      }
    }
    // each path has probability 1/13^3
    expect(unfloored.num * 10_000n).toBe(unfloored.den * 9_801n * 2_197n);
    expect(floored * 10_000n < 9_801n * 2_197n * 100n).toBe(true);
  });

  it('refuses a guess that would take the multiplier past 1,000,000×', () => {
    expect(MAX_MULT).toBe(100_000_000);
    // five "same" wins: 12.87^5 = 352,457×; a sixth same would be 4.5 million×
    expect(guessAllowed([1, 1, 1, 1, 1], 1)).toBe(false);
    expect(guessAllowed([1, 1, 1, 1, 1], 12)).toBe(true);
    expect(guessAllowed([], 1)).toBe(true);
  });

  it('points Tips at the guess whose one-guess round returns the most', () => {
    // on a 2: lower or same (2/13) returns 98.92%, higher or same (12/13) 98.77%
    expect(bestFirstGuess(2)).toBe('lo');
    // on an ace: higher (12/13) 98.77% against same (1/13) 99.00%
    expect(bestFirstGuess(1)).toBe('lo');
    // on a 7 both are 7/13: the tie goes to higher
    expect(bestFirstGuess(7)).toBe('hi');
    // on a 4: higher or same is 10/13 (98.46%), lower or same 4/13 (98.77%)
    expect(bestFirstGuess(4)).toBe('lo');
    expect(bestFirstGuess(11)).toBe('lo');
  });

  it('draws every card of the deck equally often', () => {
    const rng = seededRng(12);
    const counts = new Array<number>(52).fill(0);
    for (let i = 0; i < 52_000; i++) counts[DECK.indexOf(drawCard(rng))]!++;
    // chi-square at p = 0.001 for 51 df
    expect(chiSquareUniform(counts)).toBeLessThan(87.97);
  });
});

describe('hi-lo engine', () => {
  it('starts on the face-up card, pays right guesses and cashes out at the floored product', () => {
    const { sim, next } = solo('7s');
    expect(sim.view(0).card).toBe('7s');
    sim.act(0, { type: 'bet', amount: 1_000 });
    expect(sim.stack(0)).toBe(99_000);
    expect(sim.view(0)).toMatchObject({ phase: 'playing', mult: 0, hi: { label: 'Higher or same', count: 7, mult: 183 }, lo: { count: 7 } });
    expect(sim.act(0, { type: 'cashout' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    next('Td');
    sim.act(0, { type: 'guess', dir: 'hi' });
    expect(sim.lastEvents).toEqual([{ type: 'guess', dir: 'hi', count: 7, card: 'Td', win: true, mult: 183 }]);
    next('4h');
    sim.act(0, { type: 'guess', dir: 'lo' });
    expect(sim.view(0).mult).toBe(236);
    sim.act(0, { type: 'cashout' });
    expect(sim.stack(0)).toBe(99_000 + 2_360);
    expect(sim.view(0).result).toEqual({ outcome: 'cashout', guesses: 2, mult: 236, payout: 2_360 });
    expect(sim.view(0).trail.map((t) => [t.card, t.how, t.win, t.mult])).toEqual([
      ['7s', 'start', true, 0],
      ['Td', 'hi', true, 183],
      ['4h', 'lo', true, 236],
    ]);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 2_360 }]);
  });

  it('a wrong guess loses the bet; the card it lost on starts the next round', () => {
    const { sim, next } = solo('As');
    sim.act(0, { type: 'bet', amount: 500 });
    expect(sim.view(0).hi).toMatchObject({ label: 'Higher', count: 12 });
    next('Ac');
    sim.act(0, { type: 'guess', dir: 'hi' });
    expect(sim.view(0)).toMatchObject({ phase: 'over', card: 'Ac', result: { outcome: 'bust', guesses: 0, mult: 0, payout: 0 } });
    expect(sim.stack(0)).toBe(99_500);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 500, returned: 0 }]);
    sim.act(0, { type: 'bet', amount: 500 });
    expect(sim.view(0).trail[0]!.card).toBe('Ac');
  });

  it('skips for free between rounds and during one, keeping the multiplier', () => {
    const { sim, next } = solo('7s');
    next('Kh');
    sim.act(0, { type: 'skip' });
    expect(sim.view(0)).toMatchObject({ phase: 'idle', card: 'Kh', hi: { label: 'Same', count: 1 }, lo: { label: 'Lower', count: 12 } });
    expect(sim.stack(0)).toBe(100_000);
    sim.act(0, { type: 'bet', amount: 1_000 });
    next('2c');
    sim.act(0, { type: 'guess', dir: 'lo' });
    next('9d');
    sim.act(0, { type: 'skip' });
    expect(sim.view(0)).toMatchObject({ card: '9d', mult: 107, skipsLeft: MAX_SKIPS - 1 });
    expect(sim.view(0).trail.at(-1)).toEqual({ card: '9d', how: 'skip', win: true, mult: 107 });
  });

  it('allows 52 skips in a round', () => {
    const { sim } = solo('7s');
    sim.act(0, { type: 'bet', amount: 100 });
    for (let i = 0; i < MAX_SKIPS; i++) sim.act(0, { type: 'skip' });
    expect(sim.act(0, { type: 'skip' }, { allowRefusal: true }).refused).toBe('LIMIT');
  });

  it('keeps no next card anywhere: it is drawn when the guess is made', () => {
    const { sim } = solo('7s');
    sim.act(0, { type: 'bet', amount: 100 });
    const before = JSON.stringify(sim.state);
    // the state holds the face-up card and the trail, nothing ahead of them
    expect(Object.keys(sim.state).sort()).toEqual(['bet', 'card', 'cfg', 'counts', 'phase', 'result', 'round', 'seat', 'skips', 'trail']);
    expect(before).toContain('"card":"7s"');
    expect(sim.view(null).card).toBe('7s');
  });

  it('refuses what the rules do not allow', () => {
    const { sim } = solo('7s', 5_000);
    const refused = (a: unknown) => sim.act(0, a, { allowRefusal: true }).refused;
    expect(refused({ type: 'guess', dir: 'hi' })).toBe('WRONG_PHASE');
    expect(refused({ type: 'bet', amount: 50 })).toBe('LIMIT');
    expect(refused({ type: 'bet', amount: 10_000 })).toBe('NOT_ENOUGH_CHIPS');
    expect(engine.parseAction({ type: 'guess', dir: 'same' })).toBeNull();
    sim.act(0, { type: 'bet', amount: 100 });
    expect(refused({ type: 'bet', amount: 100 })).toBe('WRONG_PHASE');
  });

  it('standing up cashes out a right guess, or hands back an untouched bet', () => {
    const { sim, next } = solo('7s');
    sim.act(0, { type: 'bet', amount: 1_000 });
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(sim.stack(0)).toBe(100_000);
    expect(sim.rounds).toEqual([]);
    sim.act(0, { type: 'bet', amount: 1_000 });
    next('Qs');
    sim.act(0, { type: 'guess', dir: 'hi' });
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(sim.stack(0)).toBe(99_000 + 1_830);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('reads ranks ace low', () => {
    expect(rankNumber('As')).toBe(1);
    expect(rankNumber('Kd')).toBe(13);
  });
});
