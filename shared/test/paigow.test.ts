import { describe, it, expect } from 'vitest';
import { engine, BETTING_MS, SETTING_MS, RESULTS_MS, type PaiGowState } from '../src/games/paigow/engine.ts';
import {
  DECK,
  DEFAULT_FORTUNE,
  FIVE_ACES,
  FLUSH,
  FORTUNE_NAMES,
  FULL_HOUSE,
  HIGH_CARD,
  JOKER,
  PAIR,
  QUADS,
  STRAIGHT,
  STRAIGHT_FLUSH,
  TRIPS,
  TWO_PAIR,
  category,
  dealHands,
  fortuneOf,
  fortunePaysOf,
  fouls,
  highName,
  highScore,
  houseWay,
  isPgCard,
  lowIndexes,
  lowName,
  lowScore,
  settingOf,
  settle,
  type PgCard,
  type Setting,
} from '../src/games/paigow/rules.ts';
import type { PaiGowEvent, PaiGowView } from '../src/games/paigow/protocol.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

/** "As 10d Jk" to cards (a 10 may be written 10 or T, the joker Jk). */
const cards = (s: string): PgCard[] =>
  s.split(' ').map((c) => {
    const x = c.length === 3 ? `T${c[2]}` : c;
    if (!isPgCard(x)) throw new Error(`bad card ${c}`);
    return x;
  });
const hi = (s: string) => highScore(cards(s));
const lo = (s: string) => lowScore(cards(s));
const hw = (s: string) => {
  const r = houseWay(cards(s));
  return { low: [...r.low].sort().join(' '), high: [...r.high].sort().join(' ') };
};
const as = (low: string, high: string) => ({ low: cards(low).sort().join(' '), high: cards(high).sort().join(' ') });

/** A 53-card deal (dealHands) whose top cards come out in this order: each hand's seven in spot order, then the dealer's. */
function stackedDeck(top: PgCard[]): Rng {
  const cur = DECK.slice();
  const draws: number[] = [];
  top.forEach((card, t) => {
    const i = cur.length - 1 - t;
    const j = cur.indexOf(card);
    draws.push(j);
    [cur[i], cur[j]] = [cur[j]!, cur[i]!];
  });
  let k = 0;
  return {
    next32() {
      if (k >= draws.length) throw new Error('stacked deck used up');
      return draws[k++]!;
    },
  };
}

type Sim = TableSim<PaiGowState, unknown, PaiGowView>;
const solo = (rng: Rng, stack = 100_000): Sim => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]) as Sim;
const view = (sim: Sim, seat: number | null = 0) => sim.view(seat) as PaiGowView;
const events = (sim: Sim) => sim.lastEvents as PaiGowEvent[];

describe('pai gow poker hand ranks', () => {
  it('ranks five aces over a royal flush, and the categories in order', () => {
    const ladder = ['As Ad Ah Ac Jk', 'As Ks Qs Js 10s', '9h 8h 7h 6h 5h', '7s 7h 7d 7c 2s', '7s 7h 7d 2c 2s', 'Kd 9d 7d 4d 2d', 'Ac Kd Qh Js 10c', '9s 9h 9d Kc 2s', '3s 3h 2d 2c As', 'Ks Kh 4d 3c 2s', 'As Kh 9d 3c 2s'].map(hi);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]!);
    expect(category(hi('As Ad Ah Ac Jk'))).toBe(FIVE_ACES);
    expect([STRAIGHT_FLUSH, QUADS, FULL_HOUSE, FLUSH, STRAIGHT, TRIPS, TWO_PAIR, PAIR, HIGH_CARD]).toEqual(ladder.slice(2).map(category));
  });

  it('puts A-2-3-4-5 second among straights, under A-K-Q-J-10 and over K-Q-J-10-9', () => {
    expect(hi('5c 4d 3h 2s Ac')).toBeLessThan(hi('Ac Kd Qh Js 10c'));
    expect(hi('5c 4d 3h 2s Ac')).toBeGreaterThan(hi('Kd Qh Js 10c 9c'));
    expect(hi('5c 4c 3c 2c Ac')).toBeGreaterThan(hi('Kd Qd Jd 10d 9d'));
    expect(category(hi('Kc Ad 2h 3s 4c'))).toBe(HIGH_CARD);
    expect(highName(hi('5c 4d 3h 2s Ac'))).toBe('Wheel, A-2-3-4-5');
    expect(highName(hi('As Ks Qs Js 10s'))).toBe('Royal flush');
  });

  it('plays the joker as an ace, or as the card that completes a straight or a flush', () => {
    expect(category(hi('Jk Ad 9c 5s 2h'))).toBe(PAIR);
    expect(highName(hi('Jk Ad 9c 5s 2h'))).toBe('Pair of Aces');
    expect(highName(hi('Jk Kd 9c 5s 2h'))).toBe('Ace high');
    expect(category(hi('Jk 9d 10c Js Qh'))).toBe(STRAIGHT);
    expect(highName(hi('Jk 9d 10c Js Qh'))).toBe('King-high straight');
    // in a flush it is the highest card missing: an ace, or a king beside the ace
    expect(hi('Jk Ks 9s 5s 2s')).toBe(hi('As Ks 9s 5s 2s'));
    expect(hi('Jk As 9s 5s 2s')).toBe(hi('As Ks 9s 5s 2s'));
    // a straight flush with it ties the same natural one
    expect(hi('Jk Qs Js 10s 9s')).toBe(hi('Ks Qs Js 10s 9s'));
    expect(hi('Jk Ks Qs Js 10s')).toBe(hi('As Ks Qs Js 10s'));
    expect(highName(hi('Jk Ks Qs Js 10s'))).toBe('Royal flush');
    // three aces with it are four, not a straight or anything wild
    expect(category(hi('Jk As Ad Ac 2h'))).toBe(QUADS);
    expect(category(hi('Jk 7s 7d 7c 2h'))).toBe(TRIPS);
  });

  it('two-card hands: a pair or two high cards, the joker an ace', () => {
    expect(lo('Jk Kd')).toBe(lo('As Kd'));
    expect(lowName(lo('Jk Kd'))).toBe('A-K');
    expect(category(lo('Jk Ad'))).toBe(PAIR);
    expect(lowName(lo('9s 9d'))).toBe('Pair of Nines');
    expect(lo('2s 2d')).toBeGreaterThan(lo('As Kd'));
    expect(lo('As Qd')).toBeGreaterThan(lo('Ks Qd'));
  });

  it('a hand set with the two-card hand above the five fouls', () => {
    expect(fouls({ high: cards('Ks Qh 9d 5c 2s'), low: cards('As 3d') })).toBe(true);
    expect(fouls({ high: cards('As Qh 9d 5c 2s'), low: cards('Ks 3d') })).toBe(false);
    expect(fouls({ high: cards('As Kh 9d 5c 2s'), low: cards('8s 8d') })).toBe(true);
    // the same pair with kickers behind is the higher hand
    expect(fouls({ high: cards('8h 8c 9d 5c 2s'), low: cards('8s 8d') })).toBe(false);
    expect(fouls({ high: cards('Ah Kc 9d 5c 2s'), low: cards('As Kd') })).toBe(false);
  });
});

describe('pai gow poker house way (Trump Plaza)', () => {
  it('no pair: the highest card behind and the next two in front', () => {
    expect(hw('As Kd 9c 7h 5s 3d 2c')).toEqual(as('Kd 9c', 'As 7h 5s 3d 2c'));
  });

  it('one pair: the pair behind and the next two highest in front', () => {
    expect(hw('Qs Qh 9c 7h 5s 3d 2c')).toEqual(as('9c 7h', 'Qs Qh 5s 3d 2c'));
    // the joker and an ace are a pair of aces
    expect(hw('Jk Ah 9c 7h 5s 3d 2c')).toEqual(as('9c 7h', 'Jk Ah 5s 3d 2c'));
  });

  it('two pair: split, or keep together with the right card to play in front', () => {
    // low and low, low and medium: together with a king or better
    expect(hw('5s 5h 3c 3d Kh 9s 2c')).toEqual(as('Kh 9s', '5s 5h 3c 3d 2c'));
    expect(hw('5s 5h 3c 3d Qh 9s 2c')).toEqual(as('3c 3d', '5s 5h Qh 9s 2c'));
    expect(hw('9s 9h 3c 3d Kh 8s 2c')).toEqual(as('Kh 8s', '9s 9h 3c 3d 2c'));
    // the joker is an ace, and an ace is a king or better
    expect(hw('5s 5h 3c 3d Jk 9s 2c')).toEqual(as('Jk 9s', '5s 5h 3c 3d 2c'));
    // low and high, medium and medium: together only with an ace
    expect(hw('Js Jh 4c 4d Ah 9s 2c')).toEqual(as('Ah 9s', 'Js Jh 4c 4d 2c'));
    expect(hw('Js Jh 4c 4d Kh 9s 2c')).toEqual(as('4c 4d', 'Js Jh Kh 9s 2c'));
    expect(hw('10s 10h 8c 8d Ah 9s 2c')).toEqual(as('Ah 9s', '10s 10h 8c 8d 2c'));
    expect(hw('10s 10h 8c 8d Kh 9s 2c')).toEqual(as('8c 8d', '10s 10h Kh 9s 2c'));
    // medium and high, high and high, aces with anything: always split
    expect(hw('Js Jh 8c 8d Ah 9s 2c')).toEqual(as('8c 8d', 'Js Jh Ah 9s 2c'));
    expect(hw('Ks Kh Qc Qd Ah 9s 2c')).toEqual(as('Qc Qd', 'Ks Kh Ah 9s 2c'));
    expect(hw('As Ah 4c 4d Kh 9s 2c')).toEqual(as('4c 4d', 'As Ah Kh 9s 2c'));
    // a straight or flush with two pair: still the two pair rule
    expect(hw('9s 9h 10c 10d Jh Qs Kc')).toEqual(as('9s 9h', '10c 10d Jh Qs Kc'));
  });

  it('three pair: the highest pair in front', () => {
    expect(hw('Ks Kh 8c 8d 3h 3s 2c')).toEqual(as('Ks Kh', '8c 8d 3h 3s 2c'));
  });

  it('three of a kind: behind, unless aces; the pair in front when a straight or flush can go behind', () => {
    expect(hw('7s 7h 7c Kd 9h 4s 2c')).toEqual(as('Kd 9h', '7s 7h 7c 4s 2c'));
    expect(hw('As Ah Ac Kd 9h 4s 2c')).toEqual(as('Ac Kd', 'As Ah 9h 4s 2c'));
    expect(hw('7s 7h 7c 4d 5h 6s 8c')).toEqual(as('7h 7c', '7s 4d 5h 6s 8c'));
  });

  it('full houses: split with the pair in front, but twos with an ace and a king play A-K in front', () => {
    expect(hw('10s 10h 10c 4d 4h As 2c')).toEqual(as('4d 4h', '10s 10h 10c As 2c'));
    expect(hw('10s 10h 10c 2d 2h As Kc')).toEqual(as('As Kc', '10s 10h 10c 2d 2h'));
    expect(hw('10s 10h 10c 8d 8h 4s 4c')).toEqual(as('8d 8h', '10s 10h 10c 4s 4c'));
    // three of a kind twice: a pair from the higher in front
    const two = houseWay(cards('9s 9h 9c 5d 5h 5s Kc'));
    expect(lowName(lowScore(two.low))).toBe('Pair of Nines');
    expect(category(highScore(two.high))).toBe(TRIPS);
  });

  it('four of a kind by rank, and with a pair or three of a kind', () => {
    expect(hw('5s 5h 5c 5d Ah Ks 2c')).toEqual(as('Ah Ks', '5s 5h 5c 5d 2c'));
    expect(hw('8s 8h 8c 8d Kh 9s 2c')).toEqual(as('Kh 9s', '8s 8h 8c 8d 2c'));
    expect(lowName(lowScore(houseWay(cards('8s 8h 8c 8d Qh 9s 2c')).low))).toBe('Pair of Eights');
    expect(hw('Js Jh Jc Jd Ah 9s 2c')).toEqual(as('Ah 9s', 'Js Jh Jc Jd 2c'));
    expect(lowName(lowScore(houseWay(cards('Js Jh Jc Jd Kh 9s 2c')).low))).toBe('Pair of Jacks');
    expect(lowName(lowScore(houseWay(cards('As Ah Ac Ad Kh 9s 2c')).low))).toBe('Pair of Aces');
    expect(hw('8s 8h 8c 8d 3h 3s Kc')).toEqual(as('3h 3s', '8s 8h 8c 8d Kc'));
    expect(lowName(lowScore(houseWay(cards('8s 8h 8c 8d 3h 3s 3c')).low))).toBe('Pair of Threes');
  });

  it('five aces: two in front, unless a pair of kings can go there', () => {
    const five = houseWay(cards('As Ah Ac Ad Jk 9s 2c'));
    expect(lowName(lowScore(five.low))).toBe('Pair of Aces');
    expect(category(highScore(five.high))).toBe(TRIPS);
    expect(hw('As Ah Ac Ad Jk Ks Kc')).toEqual(as('Ks Kc', 'As Ah Ac Ad Jk'));
  });

  it('straights and flushes: the one that leaves the highest two cards in front', () => {
    expect(hw('9s 10d Jh Qc Kd 3s 2c')).toEqual(as('3s 2c', '9s 10d Jh Qc Kd'));
    // six to a straight: the lower straight, so the king goes in front
    expect(hw('8s 9d 10h Jc Qd Kh 2c')).toEqual(as('Kh 2c', '8s 9d 10h Jc Qd'));
    // a flush that frees an ace beats a straight that doesn't
    expect(hw('As 9h 8h 7h 6d 5h 2h')).toEqual(as('As 6d', '9h 8h 7h 5h 2h'));
    // the joker fills a straight
    expect(category(highScore(houseWay(cards('Jk 9s 10d Jh Qc 3s 2c')).high))).toBe(STRAIGHT);
  });

  it('one pair and a straight: the pair in front if the straight stands without it; else the straight with the best two left', () => {
    expect(hw('Ks Kh 5c 6d 7h 8s 9c')).toEqual(as('Ks Kh', '5c 6d 7h 8s 9c'));
    expect(hw('5s 5h 6c 7d 8h 9s Kc')).toEqual(as('Kc 5s', '5h 6c 7d 8h 9s'));
  });

  it('never fouls, and splits every hand five and two, over 50,000 random hands', () => {
    const rng = seededRng(77);
    let bad = 0;
    for (let i = 0; i < 50_000; i++) {
      const c = dealHands(rng, 0).dealer;
      const s = houseWay(c);
      const all = [...s.high, ...s.low];
      if (s.high.length !== 5 || s.low.length !== 2 || new Set(all).size !== 7 || !all.every((x) => c.includes(x)) || fouls(s)) bad++;
    }
    expect(bad).toBe(0);
  });
});

describe('pai gow poker settlement', () => {
  const S = (low: string, high: string): Setting => ({ low: cards(low), high: cards(high) });
  const seven = cards('As Kd 9c 7h 5s 3d 2c');
  const bets = { bet: 10_000, fortune: 0 };

  it('beats both: even money less 5%, to the cent', () => {
    const r = settle(bets, S('Ks Qd', 'Ah Ad 9c 5s 2h'), S('Kc Jd', 'Kh Kd 8c 5c 2d'), seven, DEFAULT_FORTUNE);
    expect(r).toMatchObject({ outcome: 'win', highWins: true, lowWins: true, bet: 19_500, commission: 500, returned: 19_500, wagered: 10_000 });
    const odd = settle({ bet: 1_300, fortune: 0 }, S('Ks Qd', 'Ah Ad 9c 5s 2h'), S('Kc Jd', 'Kh Kd 8c 5c 2d'), seven, DEFAULT_FORTUNE);
    expect(odd).toMatchObject({ bet: 2_535, commission: 65 });
  });

  it('one each pushes; a copy goes to the dealer', () => {
    expect(settle(bets, S('Ks Qd', 'Ah Ad 9c 5s 2h'), S('As Jd', 'Kh Kd 8c 5c 2d'), seven, DEFAULT_FORTUNE)).toMatchObject({ outcome: 'push', bet: 10_000 });
    // the same low hand: a copy, the dealer's; the high hand won: a push
    expect(settle(bets, S('Ks Qd', 'Ah Ad 9c 5s 2h'), S('Kc Qh', 'Kh Kd 8c 5c 2d'), seven, DEFAULT_FORTUNE)).toMatchObject({ outcome: 'push', lowWins: false });
    // copies both ways: the dealer wins
    expect(settle(bets, S('Ks Qd', 'Ah Ad 9c 5s 2h'), S('Kc Qh', 'Ac As 9d 5d 2d'), seven, DEFAULT_FORTUNE)).toMatchObject({ outcome: 'lose', bet: 0, returned: 0 });
  });

  it('pays the Fortune on all seven cards however the hand is set', () => {
    const quads = cards('8s 8h 8c 8d Kh 9s 2c');
    const r = settle({ bet: 1_000, fortune: 500 }, S('Kh 9s', '8s 8h 8c 8d 2c'), S('As Kd', 'Ah Ad 9c 5s 2h'), quads, DEFAULT_FORTUNE);
    expect(r).toMatchObject({ fortuneLine: 6, fortune: 13_000, wagered: 1_500 });
    expect(FORTUNE_NAMES[r.fortuneLine]).toBe('Four of a kind');
  });
});

describe('pai gow poker Fortune bonus', () => {
  const line = (s: string) => fortuneOf(cards(s));
  it('names every line from its best hand in seven cards', () => {
    expect(line('As 2s 3s 4s 5s 6s 7s')).toBe(0); // seven-card straight flush, natural
    expect(line('As Ks Qs Js 10s Kd Qd')).toBe(1); // royal flush and a suited K-Q
    expect(line('Jk Ks Qs Js 10s Kd Qd')).toBe(1);
    expect(line('Jk 2h 3h 4h 5h 6h 7h')).toBe(2); // seven in a row with the joker
    expect(line('As Ah Ad Ac Jk 2h 9c')).toBe(3);
    expect(line('As Ks Qs Js 10s 2d 9c')).toBe(4);
    expect(line('Jk Ks Qs Js 10s 2d 9c')).toBe(4);
    expect(line('As Ks Qs Js 10s Kd Jd')).toBe(4); // a king and a jack are no royal match
    expect(line('9s 8s 7s 6s 5s 2d Kc')).toBe(5);
    expect(line('5h 4h 3h 2h Jk 9d Kc')).toBe(5);
    expect(line('8s 8h 8c 8d Kh 9s 2c')).toBe(6);
    expect(line('Jk As Ad Ac Kh 9s 2c')).toBe(6); // three aces and the joker
    expect(line('8s 8h 8c 3d 3h 9s 2c')).toBe(7);
    expect(line('Jk Ah 8c 8d 8h 9s 2c')).toBe(7);
    expect(line('Kd 9d 7d 4d 2d 3s 5c')).toBe(8);
    expect(line('Jk 9d 7d 4d 2d 3s Kc')).toBe(8);
    expect(line('8s 8h 8c 3d Kh 9s 2c')).toBe(9);
    expect(line('9s 10h Jc Qd Kh 3s 3c')).toBe(10);
    expect(line('Jk 10h Jc Qd Kh 3s 5c')).toBe(10);
    expect(line('9s 9h 4c 4d 2h 2s Kc')).toBe(-1); // three pair loses under pay table 2
    expect(line('As Kh 9c 7d 5h 3s 2c')).toBe(-1);
  });

  it('keeps the pay table in the table config and falls back on anything malformed', () => {
    expect(fortunePaysOf(engine.config('', 'solo').options)).toEqual(DEFAULT_FORTUNE);
    expect(fortunePaysOf({ fortune: [1, 2] })).toEqual(DEFAULT_FORTUNE);
    expect(DEFAULT_FORTUNE).toEqual([8000, 2000, 1000, 400, 150, 50, 25, 5, 4, 3, 2]);
  });
});

describe('pai gow poker engine: solo', () => {
  /** Bets down, dealt `hand` then the dealer's seven. */
  const dealt = (hand: string, dealer: string, bets = { bet: 1_000, fortune: 0 }, stack = 100_000): Sim => {
    const sim = solo(stackedDeck(cards(`${hand} ${dealer}`)), stack);
    sim.act(0, { type: 'bet', ...bets });
    sim.act(0, { type: 'deal' });
    return sim;
  };

  it('bet, deal, set, settle: exact chip moves at every step', () => {
    const sim = dealt('As Ah Kd Qc 9h 5s 2c', 'Kh Kc 8d 7s 5d 4h 3c', { bet: 1_000, fortune: 500 });
    expect(sim.stack(0)).toBe(100_000 - 1_500);
    let v = view(sim);
    expect(v.phase).toBe('setting');
    expect(v.seats[0]!.cards).toEqual(cards('As Ah Kd Qc 9h 5s 2c'));
    expect(v.dealer).toEqual(new Array(7).fill(null));
    expect(events(sim).map((e) => e.type)).toEqual(['deal', 'hand', 'setting']);
    // aces behind, K-Q in front
    sim.act(0, { type: 'set', low: [2, 3] });
    v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.dealer).toEqual(cards('Kh Kc 8d 7s 5d 4h 3c'));
    // the dealer's house way: one pair, the kings behind and 8-7 in front
    expect(v.dealerSetting).toEqual({ high: cards('Kh Kc 5d 4h 3c'), low: cards('8d 7s') });
    expect(v.seats[0]!.result).toMatchObject({ outcome: 'win', bet: 1_950, commission: 50, fortune: 0, returned: 1_950, wagered: 1_500 });
    expect(sim.stack(0)).toBe(100_000 - 1_500 + 1_950);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_500, returned: 1_950 }]);
    expect(events(sim).map((e) => e.type)).toEqual(['set', 'reveal', 'show', 'result']);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('refuses a foul, and a hand set twice', () => {
    const sim = dealt('As Ah Kd Qc 9h 5s 2c', 'Kh Kc 8d 7s 5d 4h 3c');
    expect(sim.act(0, { type: 'set', low: [0, 1] }, { allowRefusal: true }).refused).toBe('BAD_REQUEST');
    sim.act(0, { type: 'set', low: [0, 1] }, { allowRefusal: true });
    expect(view(sim).phase).toBe('setting');
    expect(engine.parseAction({ type: 'set', low: [3, 3] })).toBeNull();
    expect(engine.parseAction({ type: 'set', low: [0, 7] })).toBeNull();
    expect(engine.parseAction({ type: 'set', low: [5, 2] })).toEqual({ type: 'set', low: [2, 5] });
    sim.act(0, { type: 'set', low: [2, 3] });
    expect(sim.act(0, { type: 'set', low: [2, 3] }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('the house way a player asks for is a setting the table takes', () => {
    const hand = cards('Jk 9s 10d Jh Qc 3s 2c');
    const sim = dealt('Jk 9s 10d Jh Qc 3s 2c', 'Kh Kc 8d 7s 5d 4h 3c');
    sim.act(0, { type: 'set', low: lowIndexes(hand, houseWay(hand)) });
    expect(view(sim).seats[0]!.setting).toEqual(houseWay(hand));
  });

  it('bets are totals; the Fortune needs a bet; limits and the stack are checked', () => {
    const sim = solo(seededRng(4), 1_500);
    const bet = (b: number, fortune: number) => sim.act(0, { type: 'bet', bet: b, fortune }, { allowRefusal: true }).refused;
    expect(bet(900, 0)).toBe('LIMIT');
    expect(bet(100_100, 0)).toBe('LIMIT');
    expect(bet(1_050, 0)).toBe('LIMIT');
    expect(bet(1_000, 400)).toBe('LIMIT');
    expect(bet(1_000, 10_100)).toBe('LIMIT');
    expect(bet(0, 500)).toBe('BAD_REQUEST');
    expect(bet(1_100, 500)).toBe('NOT_ENOUGH_CHIPS');
    expect(bet(1_000, 500)).toBeUndefined();
    expect(sim.stack(0)).toBe(0);
    expect(bet(0, 0)).toBeUndefined();
    expect(sim.stack(0)).toBe(1_500);
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('leaving mid-hand sets it by the house way and settles it', () => {
    const sim = dealt('As Ah Kd Qc 9h 5s 2c', 'Kh Kc 8d 7s 5d 4h 3c');
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.seats[0]!.setting).toEqual(houseWay(cards('As Ah Kd Qc 9h 5s 2c')));
    expect(events(sim)[0]).toEqual({ type: 'set', seat: 0, auto: true });
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('several hands: each its own seven, set on its own, all against the dealer', () => {
    const sim = solo(seededRng(12));
    sim.act(0, { type: 'spots', n: 3 });
    for (const spot of [0, 1, 2]) sim.act(0, { type: 'bet', bet: 1_000, fortune: 0, spot });
    sim.act(0, { type: 'deal' });
    const v = view(sim);
    const all = [0, 1, 2].flatMap((s) => v.seats[s]!.cards);
    expect(new Set(all).size).toBe(21);
    for (const spot of [0, 1]) sim.act(0, { type: 'set', low: lowIndexes(v.seats[spot]!.cards as PgCard[], houseWay(v.seats[spot]!.cards as PgCard[])), spot });
    expect(view(sim).phase).toBe('setting');
    // no spot: the one still open
    const last = v.seats[2]!.cards as PgCard[];
    sim.act(0, { type: 'set', low: lowIndexes(last, houseWay(last)) });
    expect(view(sim).phase).toBe('results');
    expect(sim.rounds.map((r) => r.spot)).toEqual([undefined, 1, 2]);
  });
});

describe('pai gow poker engine: multiplayer', () => {
  const table = (): Sim => {
    const sim = new TableSim(engine, seededRng(8), 'multi', [
      { seat: 1, stack: 100_000 },
      { seat: 4, stack: 100_000 },
    ]) as Sim;
    sim.started = true;
    sim.advance(0);
    return sim;
  };

  it('deals every bettor seven cards that only they see, and hides settings until the reveal', () => {
    const sim = table();
    sim.act(1, { type: 'bet', bet: 1_000, fortune: 0 });
    sim.act(4, { type: 'bet', bet: 2_000, fortune: 500 });
    sim.advance(BETTING_MS);
    const v1 = view(sim, 1);
    expect(v1.phase).toBe('setting');
    expect(v1.deadline).toBe(sim.now + SETTING_MS);
    expect(v1.seats[1]!.cards.every((c) => c !== null)).toBe(true);
    expect(v1.seats[4]!.cards).toEqual(new Array(7).fill(null));
    const mine = v1.seats[1]!.cards as PgCard[];
    sim.act(1, { type: 'set', low: lowIndexes(mine, houseWay(mine)) });
    expect(view(sim, 1).seats[1]!.setting).not.toBeNull();
    // the other player sees that it's set, not how
    expect(view(sim, 4).seats[1]).toMatchObject({ set: true, setting: null });
    expect(view(sim, null).seats[1]!.cards).toEqual(new Array(7).fill(null));
    const setEvent = events(sim).find((e) => e.type === 'set');
    expect(setEvent).toEqual({ type: 'set', seat: 1 });
  });

  it('the clock sets an open hand by the house way, then everyone settles and the next window opens', () => {
    const sim = table();
    sim.act(1, { type: 'bet', bet: 1_000, fortune: 0 });
    sim.act(4, { type: 'bet', bet: 1_000, fortune: 0 });
    sim.advance(BETTING_MS);
    const mine = view(sim, 1).seats[1]!.cards as PgCard[];
    sim.act(1, { type: 'set', low: lowIndexes(mine, houseWay(mine)) });
    sim.advance(SETTING_MS);
    const v = view(sim, null);
    expect(v.phase).toBe('results');
    expect(v.seats[4]!.cards.every((c) => c !== null)).toBe(true);
    expect(v.seats[4]!.setting).toEqual(houseWay(v.seats[4]!.cards as PgCard[]));
    expect(sim.rounds).toHaveLength(2);
    sim.advance(RESULTS_MS);
    expect(view(sim).phase).toBe('betting');
  });

  it("hands a dropped bettor's chips back instead of dealing them; a leaver's open hand is set for them", () => {
    const sim = table();
    sim.act(1, { type: 'bet', bet: 1_000, fortune: 500 });
    sim.act(4, { type: 'bet', bet: 1_000, fortune: 0 });
    sim.seats.get(4)!.connected = false;
    sim.advance(BETTING_MS);
    expect(sim.stack(4)).toBe(100_000);
    expect(Object.keys(view(sim).seats)).toEqual(['1']);
    sim.apply(engine.seatLeaving(sim.state, 1, sim.ctx()));
    expect(view(sim).phase).toBe('results');
    expect(engine.liveBets(sim.state, 1)).toBe(0);
  });

  it('refuses spots at a shared table, and shifts its deadline', () => {
    const sim = table();
    expect(sim.act(1, { type: 'spots', n: 2 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    const d = engine.deadline(sim.state)!;
    expect(engine.deadline(engine.shiftDeadlines(sim.state, 5_000))).toBe(d + 5_000);
  });
});

describe('pai gow poker deck', () => {
  it('deals from 53 cards with one joker, all different', () => {
    expect(DECK).toHaveLength(53);
    expect(DECK.filter((c) => c === JOKER)).toHaveLength(1);
    const rng = seededRng(3);
    let jokers = 0;
    for (let i = 0; i < 2_000; i++) {
      const { hands, dealer } = dealHands(rng, 6);
      const all = [...hands.flat(), ...dealer];
      expect(new Set(all).size).toBe(49);
      if (all.includes(JOKER)) jokers++;
    }
    // 49 of 53 cards are dealt: the joker is out 92.5% of the time
    expect(jokers / 2_000).toBeGreaterThan(0.89);
    expect(settingOf(cards('As Ah Kd Qc 9h 5s 2c'), [2, 3])).toEqual({ high: cards('As Ah 9h 5s 2c'), low: cards('Kd Qc') });
  });
});

describe('pai gow poker tips', () => {
  it('names the house way setting', async () => {
    const { houseWayAdvice } = await import('../src/games/paigow/advice.ts');
    const a = houseWayAdvice(cards('As Ah Kd Qc 9h 5s 2c'));
    expect(a.text).toBe('House way: Pair of Aces behind, K-Q in front');
    expect(a.low).toEqual(cards('Kd Qc'));
    expect(houseWayAdvice(cards('5s 5h 3c 3d Kh 9s 2c')).text).toBe('House way: Fives and Threes behind, K-9 in front');
  });
});
