import { describe, it, expect } from 'vitest';
import type { Card } from '../src/cards.ts';
import {
  rank5,
  rankHand,
  payCredits,
  cardNumber,
  cardCode,
  PAYTABLE,
  HAND_NAMES,
  NOTHING,
  JACKS_OR_BETTER,
  TWO_PAIR,
  THREE_OF_A_KIND,
  STRAIGHT,
  FLUSH,
  FULL_HOUSE,
  FOUR_OF_A_KIND,
  STRAIGHT_FLUSH,
  ROYAL_FLUSH,
} from '../src/games/videopoker/hands.ts';
import { HOLD_LIST, FOOTNOTES, NEVER, bestHold, bestLine, holdLine } from '../src/games/videopoker/strategy.ts';
import { engine, shuffleTen, deckNumbers, DENOMS } from '../src/games/videopoker/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { chiSquareUniform } from './helpers/stats.ts';
import { isRefusal, type EngineCtx } from '../src/engine.ts';

const cards = (s: string): Card[] => s.split(' ') as Card[];
const nums = (s: string): number[] => cards(s).map(cardNumber);
const rankOf = (s: string) => rankHand(cards(s));

/** Bit i set when card i of `deal` is one of `keep`. */
function maskOf(deal: string, keep: string): number {
  const k = new Set(keep.split(' ').filter(Boolean));
  return cards(deal).reduce((m, c, i) => (k.has(c) ? m | (1 << i) : m), 0);
}

function lineOf(deal: string, keep: string): number {
  const n = nums(deal);
  const r = n.map((c) => c >> 2);
  const s = n.map((c) => c & 3);
  return holdLine(maskOf(deal, keep), r, s, rankOf(deal));
}

describe('hand evaluator', () => {
  const cases: [string, number][] = [
    ['Ts Js Qs Ks As', ROYAL_FLUSH],
    ['Ah Kh Qh Jh Th', ROYAL_FLUSH],
    ['9s Ts Js Qs Ks', STRAIGHT_FLUSH], // king-high straight flush is not a royal
    ['As 2s 3s 4s 5s', STRAIGHT_FLUSH], // ace-low straight flush
    ['5h 6h 7h 8h 9h', STRAIGHT_FLUSH],
    ['9c 9d 9h 9s 2c', FOUR_OF_A_KIND],
    ['2c 2d 2h 2s Ac', FOUR_OF_A_KIND],
    ['3c 3d 3h 8s 8c', FULL_HOUSE],
    ['Ac Ad Kh Ks Kc', FULL_HOUSE],
    ['2d 5d 8d Jd Kd', FLUSH],
    ['As 2s 3s 4s 6s', FLUSH],
    ['5c 6d 7h 8s 9c', STRAIGHT],
    ['Ac 2d 3h 4s 5c', STRAIGHT], // the wheel: A-2-3-4-5
    ['Tc Jd Qh Ks Ac', STRAIGHT], // broadway, not suited
    ['Jc Qd Kh As 2c', NOTHING], // no wrapping: J-Q-K-A-2 is not a straight
    ['Kc Ad 2h 3s 4c', NOTHING], // nor K-A-2-3-4
    ['7c 7d 7h Ks 2c', THREE_OF_A_KIND],
    ['Jc Jd 4h 4s 9c', TWO_PAIR],
    ['2c 2d 3h 3s Ac', TWO_PAIR],
    ['Jh Js Qh Kh 2c', JACKS_OR_BETTER],
    ['Ac Ad 7h 5s 2c', JACKS_OR_BETTER],
    ['Qc Qd 7h 5s 2c', JACKS_OR_BETTER],
    ['Kc Kd 7h 5s 2c', JACKS_OR_BETTER],
    ['Tc Td 7h 5s 2c', NOTHING], // a pair of 10s pays nothing
    ['2c 2d 7h 5s Ac', NOTHING],
    ['2c 4d 6h 8s Tc', NOTHING],
    ['9c Td Jh Qs 2c', NOTHING], // four to a straight is nothing
  ];
  for (const [hand, rank] of cases) {
    it(`${hand} is ${HAND_NAMES[rank]}`, () => {
      expect(rankOf(hand)).toBe(rank);
      // order doesn't matter
      expect(rankHand(cards(hand).reverse())).toBe(rank);
    });
  }

  it('card numbers round-trip for all 52 cards', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 52; i++) {
      const c = cardCode(i);
      expect(cardNumber(c)).toBe(i);
      seen.add(c);
    }
    expect(seen.size).toBe(52);
  });

  it('counts every 5-card hand exactly (2,598,960 deals)', () => {
    const counts = new Array(10).fill(0);
    for (let e = 4; e < 52; e++)
      for (let d = 3; d < e; d++)
        for (let c = 2; c < d; c++)
          for (let b = 1; b < c; b++)
            for (let a = 0; a < b; a++) counts[rank5(a, b, c, d, e)]++;
    // Standard poker counts; jacks or better is the one-pair total for J, Q, K and A (4 x 84,480).
    expect(counts).toEqual([1_302_540 + 760_320, 337_920, 123_552, 54_912, 10_200, 5_108, 3_744, 624, 36, 4]);
  });
});

describe('pay table (9/6 full pay)', () => {
  // docs/rules/cards-and-machines.md §2.2, typed out rather than derived.
  const glass: [number, number[]][] = [
    [ROYAL_FLUSH, [250, 500, 750, 1000, 4000]],
    [STRAIGHT_FLUSH, [50, 100, 150, 200, 250]],
    [FOUR_OF_A_KIND, [25, 50, 75, 100, 125]],
    [FULL_HOUSE, [9, 18, 27, 36, 45]],
    [FLUSH, [6, 12, 18, 24, 30]],
    [STRAIGHT, [4, 8, 12, 16, 20]],
    [THREE_OF_A_KIND, [3, 6, 9, 12, 15]],
    [TWO_PAIR, [2, 4, 6, 8, 10]],
    [JACKS_OR_BETTER, [1, 2, 3, 4, 5]],
  ];
  for (const [rank, pays] of glass) {
    for (let coins = 1; coins <= 5; coins++) {
      it(`${HAND_NAMES[rank]} at ${coins} coin${coins > 1 ? 's' : ''} pays ${pays[coins - 1]}`, () => {
        expect(payCredits(rank, coins)).toBe(pays[coins - 1]);
      });
    }
  }

  it('a losing hand pays nothing at any bet', () => {
    for (let coins = 1; coins <= 5; coins++) expect(payCredits(NOTHING, coins)).toBe(0);
  });

  it('the royal is 4,000 only at five coins', () => {
    expect([1, 2, 3, 4].map((c) => payCredits(ROYAL_FLUSH, c) / c)).toEqual([250, 250, 250, 250]);
    expect(payCredits(ROYAL_FLUSH, 5) / 5).toBe(800);
  });

  it('the glass the machine draws matches, row for row', () => {
    expect(PAYTABLE.map((row) => [row.rank, row.pays])).toEqual(glass);
  });
});

describe('hold list (§2.4)', () => {
  it('has 36 lines in order', () => {
    expect(HOLD_LIST.map((l) => l.line)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
  });

  for (const l of HOLD_LIST) {
    it(`line ${l.line}: ${l.hold} (${l.deal} -> hold ${l.keep || 'nothing'})`, () => {
      expect(bestHold(nums(l.deal))).toBe(maskOf(l.deal, l.keep));
      expect(bestLine(nums(l.deal))).toBe(l.line);
    });
  }

  for (const f of FOOTNOTES) {
    it(`footnote ${f.id}: ${f.deal} -> hold ${f.keep}, not ${f.not}`, () => {
      expect(bestHold(nums(f.deal))).toBe(maskOf(f.deal, f.keep));
      const keep = lineOf(f.deal, f.keep);
      const not = lineOf(f.deal, f.not);
      expect(keep).toBeLessThan(not);
      // The footnote moved one of the two holds to its half line.
      expect([keep, not]).toContain(f.to);
    });
  }

  // §2.5: tricky holds, with the tempting alternative the list must not take.
  const tricky: [string, string, string][] = [
    ['As Ks Qs Js 5s', 'As Ks Qs Js', 'As Ks Qs Js 5s'],
    ['9c Th Jh Qh Kh', 'Th Jh Qh Kh', '9c Th Jh Qh Kh'],
    ['9h Th Jh Qh Jd', '9h Th Jh Qh', 'Jh Jd'],
    ['Jc Jd 4h 4s 9c', 'Jc Jd 4h 4s', 'Jc Jd 4h 4s 9c'],
    ['Jh Js Qh Kh 2c', 'Jh Js', 'Jh Qh Kh'],
    ['Kh Qh Jh 5h 2c', 'Kh Qh Jh', 'Kh Qh Jh 5h'],
    ['5c 5d 7d Jd Qd', '5d 7d Jd Qd', '5c 5d'],
    ['Tc Jd Qh Ks 3s', 'Tc Jd Qh Ks', 'Jd Qh Ks'],
    ['5c 6d 7h 8c 8s', '8c 8s', '5c 6d 7h 8c'],
    ['Js Qh Kd Ac 3s', 'Js Qh Kd Ac', 'Js Qh Kd'],
    ['Ts Js Ah 4c 7d', 'Ts Js', 'Js Ah'],
    ['8c 9d Jh Qs 3c', 'Jh Qs', '8c 9d Jh Qs'],
    ['Qh Kd Ac 4s 7c', 'Qh Kd', 'Qh Ac'],
    ['Jc Ad 3d 5h 8s', 'Jc Ad', 'Jc'],
  ];
  for (const [deal, keep, tempting] of tricky) {
    it(`tricky: ${deal} -> hold ${keep}, not ${tempting}`, () => {
      expect(bestHold(nums(deal))).toBe(maskOf(deal, keep));
      expect(lineOf(deal, keep)).toBeLessThan(lineOf(deal, tempting));
    });
  }

  it('never holds suited 10-A, three unsuited high cards with an ace, 4 to an inside straight with 0-2 high cards, or a kicker', () => {
    expect(lineOf('Ts As 3c 6d 8h', 'Ts As')).toBe(NEVER);
    expect(bestHold(nums('Ts As 3c 6d 8h'))).toBe(maskOf('Ts As 3c 6d 8h', 'As'));
    expect(lineOf('Qh Kd Ac 4s 7c', 'Qh Kd Ac')).toBe(NEVER);
    expect(lineOf('8c 9d Jh Qs 3c', '8c 9d Jh Qs')).toBe(NEVER);
    expect(lineOf('8c 8d Ah 3s 5c', '8c 8d Ah')).toBe(NEVER);
    expect(bestHold(nums('8c 8d Ah 3s 5c'))).toBe(maskOf('8c 8d Ah 3s 5c', '8c 8d'));
  });
});

describe('deck', () => {
  it('ten distinct cards per hand, every card equally likely in every position', () => {
    const rng = seededRng(7);
    const deck = deckNumbers();
    const first = new Array(52).fill(0);
    const tenth = new Array(52).fill(0);
    const n = 104_000;
    for (let i = 0; i < n; i++) {
      shuffleTen(rng, deck);
      if (i < 1000) expect(new Set(deck.subarray(0, 10)).size).toBe(10);
      first[deck[0]!]++;
      tenth[deck[9]!]++;
    }
    // 51 degrees of freedom: the 0.1% critical value is 87.0.
    expect(chiSquareUniform(first)).toBeLessThan(87);
    expect(chiSquareUniform(tenth)).toBeLessThan(87);
    // Still a permutation of the whole deck afterwards.
    expect([...deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});

function machine(stack = 100_000, seed = 11) {
  return new TableSim(engine, seededRng(seed), 'solo', [{ seat: 0, stack }]);
}

type Sim = ReturnType<typeof machine>;

/** Put a known deck under the current hand (tests only): cards 0-4 on screen, 5-9 the draws. */
function rig(sim: Sim, ten: string): void {
  const deck = cards(ten);
  sim.state = { ...sim.state, deck, hand: deck.slice(0, 5), dealt: rankHand(deck.slice(0, 5)) };
}

describe('video poker engine', () => {
  it('deal debits coins x denomination and shows five cards; draw pays from the table', () => {
    const sim = machine();
    sim.act(0, { type: 'deal', coins: 5, denom: 500 });
    expect(sim.stack(0)).toBe(100_000 - 2_500);
    let v = sim.view(0);
    expect(v.phase).toBe('dealt');
    expect(v.hand).toHaveLength(5);
    expect(engine.liveBets(sim.state, 0)).toBe(2_500);
    const deck = sim.state.deck;
    sim.act(0, { type: 'draw', hold: [true, false, true, false, false] });
    v = sim.view(0);
    expect(v.phase).toBe('over');
    // Discards are filled from deck positions 5, 6, 7 in order.
    expect(v.hand).toEqual([deck[0], deck[5], deck[2], deck[6], deck[7]]);
    const rank = rankHand(v.hand);
    const payout = payCredits(rank, 5) * 500;
    expect(v.result).toEqual({ rank, name: HAND_NAMES[rank], credits: payCredits(rank, 5), payout });
    expect(sim.stack(0)).toBe(100_000 - 2_500 + payout);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 2_500, returned: payout });
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('pays every hand at every bet, with the royal bonus only at five coins', () => {
    const hands: [string, number][] = [
      ['Ts Js Qs Ks As 2c 3c 4c 5c 6c', ROYAL_FLUSH],
      ['9s Ts Js Qs Ks 2c 3c 4c 5c 6c', STRAIGHT_FLUSH],
      ['9c 9d 9h 9s 2c 3c 4c 5c 6c 7c', FOUR_OF_A_KIND],
      ['3c 3d 3h 8s 8c 2c 4c 5c 6c 7c', FULL_HOUSE],
      ['2d 5d 8d Jd Kd 2c 3c 4c 5c 6c', FLUSH],
      ['Ac 2d 3h 4s 5c 7c 8c 9c Tc Jc', STRAIGHT],
      ['7c 7d 7h Ks 2c 3c 4c 5c 6c 8c', THREE_OF_A_KIND],
      ['Jc Jd 4h 4s 9c 2c 3c 5c 6c 7c', TWO_PAIR],
      ['Jh Js Qh Kh 2c 3c 4c 5c 6c 7c', JACKS_OR_BETTER],
      ['Th Ts Qh Kh 2c 3c 4c 5c 6c 7c', NOTHING],
    ];
    for (const denom of DENOMS) {
      for (let coins = 1; coins <= 5; coins++) {
        for (const [ten, rank] of hands) {
          const sim = machine(1_000_000);
          sim.act(0, { type: 'deal', coins, denom });
          rig(sim, ten);
          sim.act(0, { type: 'draw', hold: [true, true, true, true, true] });
          const r = sim.view(0).result!;
          expect(r.rank).toBe(rank);
          expect(r.payout).toBe(payCredits(rank, coins) * denom);
          expect(sim.stack(0)).toBe(1_000_000 - coins * denom + r.payout);
        }
      }
    }
    // Spot checks in dollars: a $25 royal at 5 coins is $100,000; at 4 coins, $25,000.
    const sim = machine(1_000_000);
    sim.act(0, { type: 'deal', coins: 5, denom: 2500 });
    rig(sim, hands[0]![0]);
    sim.act(0, { type: 'draw', hold: [true, true, true, true, true] });
    expect(sim.view(0).result!.payout).toBe(100_000_00);
  });

  it('the draw was decided at the deal and never leaves the server', () => {
    const sim = machine(100_000, 99);
    sim.act(0, { type: 'deal', coins: 1, denom: 100 });
    const secret = sim.state.deck.slice(5);
    const shown = JSON.stringify([sim.view(0), sim.view(null), sim.lastEvents]);
    for (const c of secret) expect(shown).not.toContain(`"${c}"`);
    // Whatever is held, the replacements come off the same deck in the same order.
    const after = (hold: boolean[]) => {
      const res = engine.act(sim.state, 0, { type: 'draw', hold }, sim.ctx());
      if (isRefusal(res)) throw new Error(res.msg);
      return res.state.hand;
    };
    expect(after([false, false, false, false, false])).toEqual(secret);
    expect(after([true, true, false, true, true])[2]).toBe(secret[0]);
  });

  it('the first draw replacement is a fresh card: the ten are all different', () => {
    const sim = machine(1_000_000, 5);
    for (let i = 0; i < 200; i++) {
      sim.act(0, { type: 'deal', coins: 1, denom: 100 });
      expect(new Set(sim.state.deck).size).toBe(10);
      sim.act(0, { type: 'draw', hold: [false, false, false, false, false] });
    }
  });

  it('refuses bad bets, out-of-turn buttons and junk', () => {
    const sim = machine(300);
    const refused = (a: unknown) => sim.act(0, a, { allowRefusal: true }).refused;
    expect(refused({ type: 'deal', coins: 0, denom: 100 })).toBe('LIMIT');
    expect(refused({ type: 'deal', coins: 6, denom: 100 })).toBe('LIMIT');
    expect(refused({ type: 'deal', coins: 1, denom: 200 })).toBe('LIMIT');
    expect(refused({ type: 'deal', coins: 1, denom: 500 })).toBe('NOT_ENOUGH_CHIPS');
    expect(refused({ type: 'draw', hold: [true, true, true, true, true] })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'deal', coins: 3, denom: 100 });
    expect(sim.stack(0)).toBe(0);
    expect(refused({ type: 'deal', coins: 1, denom: 100 })).toBe('WRONG_PHASE');
    expect(engine.parseAction({ type: 'draw', hold: [true, true, true, true] })).toBeNull();
    expect(engine.parseAction({ type: 'draw', hold: [1, 0, 0, 0, 0] })).toBeNull();
    expect(engine.parseAction({ type: 'deal', coins: 2.5 })).toBeNull();
    expect(engine.parseAction({ type: 'deal', coins: 1, denom: '100' })).toBeNull();
    expect(engine.parseAction({ type: 'spin' })).toBeNull();
    // Without a denomination the machine keeps the last one.
    expect(engine.parseAction({ type: 'deal', coins: 2 })).toEqual({ type: 'deal', coins: 2 });
  });

  it('keeps the last denomination when a deal leaves it out', () => {
    const sim = machine(100_000);
    sim.act(0, { type: 'deal', coins: 2, denom: 500 });
    sim.act(0, { type: 'draw', hold: [false, false, false, false, false] });
    const before = sim.stack(0) + 0;
    sim.act(0, { type: 'deal', coins: 2 });
    expect(before - sim.stack(0)).toBe(1_000);
  });

  it('a player who walks away mid-hand stands pat and is paid on the dealt hand', () => {
    const sim = machine(10_000);
    sim.act(0, { type: 'deal', coins: 5, denom: 100 });
    rig(sim, 'Jc Jd 4h 4s 9c 2c 3c 5c 6c 7c');
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    sim.apply(step);
    const v = sim.view(0);
    expect(v.phase).toBe('over');
    expect(v.held).toEqual([true, true, true, true, true]);
    expect(v.hand).toEqual(cards('Jc Jd 4h 4s 9c'));
    expect(v.result!.rank).toBe(TWO_PAIR);
    expect(sim.stack(0)).toBe(10_000 - 500 + 1_000);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 500, returned: 1_000 });
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    // Leaving between hands changes nothing.
    const idle = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(idle.state).toBe(sim.state);
    expect(idle.events).toEqual([]);
  });

  it('never runs on a clock', () => {
    const sim = machine();
    sim.act(0, { type: 'deal', coins: 1, denom: 100 });
    expect(engine.deadline(sim.state)).toBeNull();
    expect(engine.tick(sim.state, sim.ctx() as EngineCtx)).toBeNull();
    expect(engine.shiftDeadlines(sim.state, 5_000)).toBe(sim.state);
  });

  it('config: one seat, $1 to $500 a hand in whole dollars (five of the high-limit $100 coins)', () => {
    const cfg = engine.config('', 'solo');
    expect(cfg.maxSeats).toBe(1);
    expect(cfg.limits.default).toEqual({ min: 100, max: 50_000, step: 100 });
    expect(cfg.buyIn).toEqual({ min: 2_000, max: 5_000_000 });
    expect(engine.seats.multiplayer).toBe(false);
  });
});
