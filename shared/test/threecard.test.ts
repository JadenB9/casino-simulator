import { describe, it, expect } from 'vitest';
import { engine, BETTING_MS, DECISION_MS, RESULTS_MS, type ThreeCardState } from '../src/games/threecard/engine.ts';
import {
  score,
  rankIndex,
  category,
  settle,
  shouldPlay,
  qualifies,
  handName,
  handRanks,
  paytableOf,
  anteBonusPays,
  pairPlusPays,
  dealHands,
  DEFAULT_PAYTABLE,
  HIGH_CARD,
  PAIR,
  FLUSH,
  STRAIGHT,
  TRIPS,
  STRAIGHT_FLUSH,
  type Category,
  type Paytable,
} from '../src/games/threecard/rules.ts';
import type { ThreeCardView, ThreeCardEvent } from '../src/games/threecard/protocol.ts';
import { type Card, newDeck, isCard } from '../src/cards.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

const cards = (s: string): Card[] => {
  const out = s.split(' ').map((c) => (c.length === 3 ? `T${c[2]}` : c));
  for (const c of out) if (!isCard(c)) throw new Error(`bad card ${c}`);
  return out as Card[];
};
const sc = (s: string) => score(cards(s));

/**
 * An Rng that makes dealHands() deal `top` in that order (each seat's three cards in seat order,
 * then the dealer's), so a test can play exact hands through the real engine. It answers each
 * Fisher-Yates draw with the position of the card wanted next.
 */
function stackedRng(top: Card[]): Rng {
  const cur = newDeck();
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

type Sim = TableSim<ThreeCardState, unknown, ThreeCardView>;
const solo = (rng: Rng, stack = 100_000): Sim => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]) as Sim;
const view = (sim: Sim, seat: number | null = 0) => sim.view(seat) as ThreeCardView;
const events = (sim: Sim) => sim.lastEvents as ThreeCardEvent[];

describe('three card poker hand ranks', () => {
  it('counts every category over all 22,100 hands (WoO)', () => {
    const deck = newDeck();
    const counts = [0, 0, 0, 0, 0, 0];
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) counts[category(score([deck[a]!, deck[b]!, deck[c]!]))]!++;
    expect(counts).toEqual([16_440, 3_744, 1_096, 720, 52, 48]);
  });

  it('classifies each category', () => {
    const cat = (s: string) => category(sc(s));
    expect(cat('Qh Jh 10h')).toBe(STRAIGHT_FLUSH);
    expect(cat('7s 7h 7d')).toBe(TRIPS);
    expect(cat('Qh Jd 10c')).toBe(STRAIGHT);
    expect(cat('Kd 9d 4d')).toBe(FLUSH);
    expect(cat('Kc Kd 4s')).toBe(PAIR);
    expect(cat('As Kd 9c')).toBe(HIGH_CARD);
  });

  it('ranks straight flush > trips > straight > flush > pair > high card', () => {
    const ladder = ['2c 3c 4c', 'As Ah Ad', 'Ah Kd Qc', 'Ah Kh Jh', 'As Ad Kc', 'As Kd Jc'].map(sc);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1]!);
    // a straight beats a flush with three cards, and the lowest straight still beats the best flush
    expect(sc('As 2d 3c')).toBeGreaterThan(sc('Ah Kh Jh'));
    // and the lowest trips beat the best straight
    expect(sc('2s 2d 2c')).toBeGreaterThan(sc('Ah Kd Qc'));
  });

  it('plays the ace high or low in straights, but never around the corner', () => {
    expect(category(sc('As 2d 3c'))).toBe(STRAIGHT);
    expect(sc('As 2d 3c')).toBeLessThan(sc('2s 3d 4c')); // A-2-3 is the lowest straight
    expect(sc('As Kd Qc')).toBeGreaterThan(sc('Ks Qd Jc')); // A-K-Q the highest
    expect(category(sc('Ks As 2d'))).toBe(HIGH_CARD); // K-A-2 is just ace high
    expect(sc('Ks As 2d')).toBeLessThan(sc('As Ks 3d'));
    expect(sc('Ah 2h 3h')).toBeLessThan(sc('2c 3c 4c')); // and the lowest straight flush
    expect(sc('Ah Kh Qh')).toBeGreaterThan(sc('Kc Qc Jc'));
  });

  it('breaks ties the way 58 Pa. Code 649a.6 does, and never on suits', () => {
    expect(sc('7s 7h 7d')).toBeGreaterThan(sc('6s 6h 6d'));
    expect(sc('Kd 9d 4d')).toBeGreaterThan(sc('Kh 9h 3h')); // flush: third card
    expect(sc('Ad 5d 3d')).toBeGreaterThan(sc('Kh Qh 10h')); // flush: top card first
    expect(sc('Qs 7d 3c')).toBeGreaterThan(sc('Qh 6c 4d')); // Q-7-3 beats Q-6-4 (WoO)
    expect(sc('Ks Kd 2c')).toBeGreaterThan(sc('Qs Qd Ac')); // pair rank before kicker
    expect(sc('Ks Kd 5c')).toBeGreaterThan(sc('Kh Kc 4d')); // then the kicker
    expect(sc('As Kd 9c')).toBe(sc('Ah Kc 9d'));
    expect(sc('Ks Kd 5c')).toBe(sc('Kh Kc 5d'));
    expect(sc('9s 10d Jc')).toBe(sc('9h 10h Js'));
    expect(sc('Ad 5d 3d')).toBe(sc('As 5s 3s'));
  });

  it('names hands the way a dealer calls them', () => {
    expect(handName(sc('Kc Kd 4s'))).toBe('Pair of Kings');
    expect(handName(sc('As Kd 9c'))).toBe('Ace high');
    expect(handName(sc('Qs 7d 3c'))).toBe('Queen high');
    expect(handName(sc('7s 7h 7d'))).toBe('Three Sevens');
    expect(handName(sc('6s 6h 6d'))).toBe('Three Sixes');
    expect(handName(sc('Qh Jh 10h'))).toBe('Straight flush');
    expect(handName(sc('Qh Jd 10c'))).toBe('Straight');
    expect(handName(sc('Kd 9d 4d'))).toBe('Flush');
    expect(handRanks(sc('9c As Kd'))).toBe('A-K-9');
    expect(handRanks(sc('3c As 2d'))).toBe('3-2-A');
    expect(handRanks(sc('7c Ks Kd'))).toBe('K-K-7');
    expect(handRanks(sc('5c As 5d'))).toBe('A-5-5');
    expect(handRanks(sc('10c Js Qd'))).toBe('Q-J-10');
  });
});

describe('three card poker strategy and qualifier', () => {
  it('plays Q-6-4 or better and folds below it', () => {
    expect(shouldPlay(sc('Qs 6d 4c'))).toBe(true);
    expect(shouldPlay(sc('Qs 6d 5c'))).toBe(true);
    expect(shouldPlay(sc('Qs 6d 3c'))).toBe(false);
    expect(shouldPlay(sc('Qs 7d 2c'))).toBe(true);
    expect(shouldPlay(sc('Qs 5d 4c'))).toBe(false);
    expect(shouldPlay(sc('Js 10d 8c'))).toBe(false);
    expect(shouldPlay(sc('Ks 3d 2c'))).toBe(true);
    expect(shouldPlay(sc('2s 2d 3c'))).toBe(true);
  });

  it('qualifies the dealer with queen high or better', () => {
    expect(qualifies(sc('Qs 3d 2c'))).toBe(true);
    expect(qualifies(sc('Js 10d 8c'))).toBe(false);
    expect(qualifies(sc('Js 10d 9c'))).toBe(true); // a straight, though jack high
    expect(qualifies(sc('2s 2d 3c'))).toBe(true);
    expect(qualifies(sc('As 2d 3c'))).toBe(true);
    expect(qualifies(sc('Ks As 2d'))).toBe(true);
  });
});

describe('three card poker pay tables', () => {
  it('pays every Ante Bonus and Pair Plus cell of 1-4-5 and 40-30-6-3-1', () => {
    const cells: [Category, number, number][] = [
      [STRAIGHT_FLUSH, 5, 40],
      [TRIPS, 4, 30],
      [STRAIGHT, 1, 6],
      [FLUSH, 0, 3],
      [PAIR, 0, 1],
      [HIGH_CARD, 0, 0],
    ];
    for (const [cat, bonus, pp] of cells) {
      expect(anteBonusPays(cat, DEFAULT_PAYTABLE)).toBe(bonus);
      expect(pairPlusPays(cat, DEFAULT_PAYTABLE)).toBe(pp);
    }
  });

  it('keeps Pair Plus in the table config and falls back on anything malformed', () => {
    expect(engine.config('', 'solo').options.pairPlus).toEqual([40, 30, 6, 3, 1]);
    expect(paytableOf({ pairPlus: [40, 30, 6, 4, 1] }).pairPlus).toEqual([40, 30, 6, 4, 1]);
    expect(pairPlusPays(FLUSH, paytableOf({ pairPlus: [40, 30, 6, 4, 1] }))).toBe(4);
    expect(paytableOf({ pairPlus: [40, 30, 6] })).toEqual(DEFAULT_PAYTABLE);
    expect(paytableOf({ pairPlus: [40, 30, 6, -3, 1], anteBonus: 'x' })).toEqual(DEFAULT_PAYTABLE);
  });
});

describe('three card poker settlement', () => {
  const pay = DEFAULT_PAYTABLE;
  const net = (r: ReturnType<typeof settle>) => r.returned - r.wagered;

  it('dealer does not qualify: Ante pays 1 to 1, Play pushes', () => {
    const r = settle({ ante: 10, play: 10, pairPlus: 0 }, sc('Ks 9d 4c'), sc('Js 10d 8c'), pay);
    expect(r).toMatchObject({ outcome: 'noqualify', ante: 20, play: 10, bonus: 0, pairPlus: 0 });
    expect(net(r)).toBe(10);
    // even when the dealer's non-qualifying hand is higher than the player's
    expect(settle({ ante: 10, play: 10, pairPlus: 0 }, sc('Qs 6d 4c'), sc('Js 10d 8c'), pay).outcome).toBe('noqualify');
  });

  it('dealer qualifies: player higher wins both, a tie pushes both, lower loses both', () => {
    const win = settle({ ante: 10, play: 10, pairPlus: 0 }, sc('Ks Kd 4c'), sc('Qs 7d 3c'), pay);
    expect(win).toMatchObject({ outcome: 'win', ante: 20, play: 20, bonus: 0 });
    const tie = settle({ ante: 10, play: 10, pairPlus: 0 }, sc('As Kd 9c'), sc('Ah Kc 9d'), pay);
    expect(tie).toMatchObject({ outcome: 'push', ante: 10, play: 10, bonus: 0, returned: 20 });
    const lose = settle({ ante: 10, play: 10, pairPlus: 0 }, sc('Ks Qd 4c'), sc('As 3d 2c'), pay);
    expect(lose).toMatchObject({ outcome: 'lose', ante: 0, play: 0, bonus: 0, returned: 0 });
  });

  it('pays the Ante Bonus whatever the dealer holds, even on a losing hand', () => {
    // straight loses to a higher straight: -2 on Ante and Play, +1 bonus
    const r = settle({ ante: 10, play: 10, pairPlus: 0 }, sc('2s 3d 4c'), sc('5s 6d 7c'), pay);
    expect(r).toMatchObject({ outcome: 'lose', ante: 0, play: 0, bonus: 10 });
    expect(net(r)).toBe(-10);
    // straight flush loses to a higher straight flush: +3
    expect(net(settle({ ante: 10, play: 10, pairPlus: 0 }, sc('2h 3h 4h'), sc('5s 6s 7s'), pay))).toBe(30);
    // trips lose to higher trips: +2
    expect(net(settle({ ante: 10, play: 10, pairPlus: 0 }, sc('2h 2s 2d'), sc('9s 9h 9c'), pay))).toBe(20);
    // trips against a dealer who doesn't qualify: +1 +0 +4
    const nq = settle({ ante: 10, play: 10, pairPlus: 0 }, sc('8h 8s 8d'), sc('Js 9d 4c'), pay);
    expect(nq).toMatchObject({ outcome: 'noqualify', ante: 20, play: 10, bonus: 40 });
    // straight flush beating the dealer: +1 +1 +5
    expect(net(settle({ ante: 10, play: 10, pairPlus: 0 }, sc('Ah Kh Qh'), sc('Ks Kd 2c'), pay))).toBe(70);
    // straight that ties: 0 + 1 bonus
    expect(net(settle({ ante: 10, play: 10, pairPlus: 0 }, sc('4h 5s 6d'), sc('4c 5d 6h'), pay))).toBe(10);
    // a flush or a pair earns no bonus
    expect(settle({ ante: 10, play: 10, pairPlus: 0 }, sc('Kd 9d 4d'), sc('As 3d 2c'), pay).bonus).toBe(0);
  });

  it('settles Pair Plus on the player cards alone, independent of the dealer', () => {
    // pair loses to the dealer on Ante and Play, Pair Plus still pays 1 to 1
    const r = settle({ ante: 10, play: 10, pairPlus: 5 }, sc('2s 2d 9c'), sc('3s 3d 4c'), pay);
    expect(r).toMatchObject({ outcome: 'lose', ante: 0, play: 0, pairPlus: 10 });
    // Pair Plus alone: pays against a dealer with trips, and every cell of the table
    for (const [hand, mult] of [['Ah Kh Qh', 40], ['7s 7h 7d', 30], ['Qh Jd 10c', 6], ['Kd 9d 4d', 3], ['Kc Kd 4s', 1]] as const) {
      const alone = settle({ ante: 0, play: 0, pairPlus: 5 }, sc(hand), sc('As Ad Ac'), pay);
      expect(alone).toMatchObject({ outcome: null, pairPlus: 5 * (mult + 1), returned: 5 * (mult + 1), wagered: 5 });
    }
    expect(settle({ ante: 0, play: 0, pairPlus: 5 }, sc('As Kd 9c'), sc('2s 3d 5c'), pay)).toMatchObject({ pairPlus: 0, returned: 0 });
    // the config's table is the one paid
    const alt: Paytable = paytableOf({ pairPlus: [40, 30, 6, 4, 1] });
    expect(settle({ ante: 0, play: 0, pairPlus: 5 }, sc('Kd 9d 4d'), sc('2s 3d 5c'), alt).pairPlus).toBe(25);
  });

  it('a fold loses the Ante and forfeits Pair Plus, with no bonus', () => {
    const r = settle({ ante: 10, play: 0, pairPlus: 5 }, sc('Kc Kd 4s'), sc('Js 9d 4c'), pay);
    expect(r).toMatchObject({ outcome: 'fold', ante: 0, play: 0, bonus: 0, pairPlus: 0, wagered: 15, returned: 0 });
    const straight = settle({ ante: 10, play: 0, pairPlus: 0 }, sc('Qh Jd 10c'), sc('Js 9d 4c'), pay);
    expect(straight).toMatchObject({ outcome: 'fold', bonus: 0, returned: 0 });
  });
});

describe('three card poker engine: solo', () => {
  /** Deal `player` against `dealer` through the real engine and return the table after the deal. */
  const dealt = (player: string, dealer: string, bets: { ante: number; pairPlus: number }, stack = 100_000) => {
    const sim = solo(stackedRng([...cards(player), ...cards(dealer)]), stack);
    sim.act(0, { type: 'bet', ...bets });
    sim.act(0, { type: 'deal' });
    return sim;
  };

  it('bet, deal, play: exact chip moves at every step', () => {
    const sim = dealt('Ks Kd 4c', 'Qs 7d 3c', { ante: 2_500, pairPlus: 500 });
    expect(sim.stack(0)).toBe(100_000 - 3_000);
    const v = view(sim);
    expect(v.phase).toBe('deciding');
    expect(v.seats[0]!.cards).toEqual(cards('Ks Kd 4c'));
    expect(v.dealer).toEqual([null, null, null]);
    expect(v.seats[0]!.decision).toBe('pending');
    sim.act(0, { type: 'play' });
    expect(sim.stack(0)).toBe(100_000 - 3_000 - 2_500 + 5_000 + 5_000 + 1_000); // Ante and Play win, pair pays 1 to 1
    const after = view(sim);
    expect(after.phase).toBe('results');
    expect(after.dealer).toEqual(cards('Qs 7d 3c'));
    expect(after.seats[0]!.result).toMatchObject({ outcome: 'win', ante: 5_000, play: 5_000, bonus: 0, pairPlus: 1_000 });
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 5_500, returned: 11_000 }]);
    const types = events(sim).map((e) => e.type);
    expect(types).toEqual(['decision', 'reveal', 'show', 'result']);
  });

  it('dealer does not qualify: Ante 1 to 1, Play back, bonus on top', () => {
    const sim = dealt('8h 8s 8d', 'Js 9d 4c', { ante: 1_000, pairPlus: 0 });
    sim.act(0, { type: 'play' });
    expect(sim.stack(0)).toBe(100_000 - 2_000 + 2_000 + 1_000 + 4_000);
    expect(view(sim).seats[0]!.result?.outcome).toBe('noqualify');
    expect(events(sim).find((e) => e.type === 'reveal')).toMatchObject({ qualifies: false });
  });

  it('tie pushes, loss takes both, and the bonus still comes on a loss', () => {
    const tie = dealt('As Kd 9c', 'Ah Kc 9d', { ante: 1_000, pairPlus: 0 });
    tie.act(0, { type: 'play' });
    expect(tie.stack(0)).toBe(100_000);
    const lose = dealt('2s 3d 4c', '5s 6d 7c', { ante: 1_000, pairPlus: 0 });
    lose.act(0, { type: 'play' });
    expect(lose.stack(0)).toBe(100_000 - 2_000 + 1_000);
    expect(lose.rounds.at(-1)).toEqual({ seat: 0, wagered: 2_000, returned: 1_000 });
  });

  it('fold: Ante and Pair Plus lost, dealer shown, round recorded', () => {
    const sim = dealt('Kc Kd 4s', 'Js 9d 4c', { ante: 1_000, pairPlus: 500 });
    sim.act(0, { type: 'fold' });
    expect(sim.stack(0)).toBe(100_000 - 1_500);
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.seats[0]!.result).toMatchObject({ outcome: 'fold', returned: 0 });
    expect(v.dealer).toEqual(cards('Js 9d 4c'));
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_500, returned: 0 }]);
    expect(events(sim).map((e) => e.type)).toEqual(['decision', 'result', 'reveal']);
  });

  it('Pair Plus alone settles at the deal', () => {
    const sim = dealt('Qh Jd 10c', 'As Ad Ac', { ante: 0, pairPlus: 1_000 });
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.seats[0]!.decision).toBe('none');
    expect(sim.stack(0)).toBe(100_000 + 6_000);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 7_000 }]);
    expect(engine.act(sim.state, 0, { type: 'play' }, sim.ctx())).toMatchObject({ refuse: 'WRONG_PHASE' });
  });

  it('bets are totals: raise, lower and clear move only the difference', () => {
    const sim = solo(seededRng(3));
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.act(0, { type: 'bet', ante: 2_500, pairPlus: 500 });
    expect(sim.stack(0)).toBe(100_000 - 3_000);
    expect(engine.liveBets(sim.state, 0)).toBe(3_000);
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 500 });
    expect(sim.stack(0)).toBe(100_000 - 1_500);
    sim.act(0, { type: 'bet', ante: 0, pairPlus: 0 });
    expect(sim.stack(0)).toBe(100_000);
    expect(view(sim).seats).toEqual({});
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('refuses bets off the limits, over the stack, or without the Play bet in reserve', () => {
    const sim = solo(seededRng(4), 3_000);
    const bet = (ante: number, pairPlus: number) => sim.act(0, { type: 'bet', ante, pairPlus }, { allowRefusal: true }).refused;
    expect(bet(900, 0)).toBe('LIMIT'); // Ante min $10
    expect(bet(100_100, 0)).toBe('LIMIT'); // Ante max $1,000
    expect(bet(1_050, 0)).toBe('LIMIT'); // whole dollars
    expect(bet(0, 400)).toBe('LIMIT'); // Pair Plus min $5
    expect(bet(0, 50_100)).toBe('LIMIT'); // Pair Plus max $500
    expect(bet(2_000, 0)).toBe('NOT_ENOUGH_CHIPS'); // $20 Ante needs $40
    expect(bet(1_500, 0)).toBeUndefined(); // $15 + $15 in reserve = $30
    expect(bet(1_500, 500)).toBe('NOT_ENOUGH_CHIPS');
    expect(bet(1_000, 1_000)).toBeUndefined(); // $10 + $10 + $10 reserve
    expect(sim.stack(0)).toBe(1_000);
    expect(engine.parseAction({ type: 'bet', ante: -5, pairPlus: 0 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', ante: 1.5, pairPlus: 0 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', ante: 1_000 })).toEqual({ type: 'bet', ante: 1_000, pairPlus: 0 });
    expect(engine.parseAction({ type: 'raise' })).toBeNull();
  });

  it('keeps betting and deciding apart', () => {
    const sim = dealt('Kc Kd 4s', 'Js 9d 4c', { ante: 1_000, pairPlus: 0 });
    expect(sim.act(0, { type: 'bet', ante: 2_000, pairPlus: 0 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.act(0, { type: 'play' });
    expect(sim.act(0, { type: 'fold' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    // the next bet opens a fresh round and clears the layout
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    const v = view(sim);
    expect(v.phase).toBe('betting');
    expect(v.round).toBe(2);
    expect(v.dealer).toEqual([]);
    expect(v.seats[0]).toMatchObject({ ante: 1_000, cards: [], decision: null, result: null });
  });

  it('a player leaving mid-hand folds; before the deal their bets come back', () => {
    const sim = dealt('Kc Kd 4s', 'Js 9d 4c', { ante: 1_000, pairPlus: 500 });
    expect(engine.liveBets(sim.state, 0)).toBe(1_500);
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(view(sim).seats[0]!.result?.outcome).toBe('fold');
    expect(sim.stack(0)).toBe(100_000 - 1_500);

    const early = solo(seededRng(5));
    early.act(0, { type: 'bet', ante: 1_000, pairPlus: 500 });
    early.apply(engine.seatLeaving(early.state, 0, early.ctx()));
    expect(early.stack(0)).toBe(100_000);
    expect(engine.liveBets(early.state, 0)).toBe(0);
  });

  it('runs no timers solo, and has nothing live once the hand settles', () => {
    const sim = solo(seededRng(6));
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.act(0, { type: 'deal' });
    expect(engine.liveBets(sim.state, 0)).toBe(1_000);
    sim.act(0, { type: 'play' });
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.deadline(sim.state)).toBeNull();
  });
});

describe('three card poker engine: multiplayer', () => {
  const table = (rng: Rng, seats = [0, 1, 2]) => {
    const sim = new TableSim(engine, rng, 'multi', seats.map((seat) => ({ seat, stack: 100_000 }))) as Sim;
    sim.started = true;
    sim.advance(0);
    return sim;
  };
  const ready = (sim: Sim, seat: number, on = true) => {
    sim.seats.get(seat)!.ready = on;
    sim.advance(0);
  };

  it('opens a timed window, closes it early once everyone is ready, and deals every bettor', () => {
    const sim = table(stackedRng(cards('Ks Kd 4c 2s 7d 9h Qh Jd 10c As Ad 3c')));
    expect(view(sim, null)).toMatchObject({ phase: 'betting', deadline: sim.now + BETTING_MS });
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 500 });
    sim.act(1, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.act(2, { type: 'bet', ante: 0, pairPlus: 500 });
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    ready(sim, 0);
    ready(sim, 1);
    expect(view(sim, null).phase).toBe('betting');
    ready(sim, 2);
    const v0 = view(sim, 0);
    expect(v0.phase).toBe('deciding');
    expect(v0.deadline).toBe(sim.now + DECISION_MS);
    expect(v0.seats[0]!.cards).toEqual(cards('Ks Kd 4c'));
    expect(v0.seats[1]!.cards).toEqual([null, null, null]);
    expect(v0.seats[2]!.cards).toEqual([null, null, null]);
    expect(v0.seats[2]!.decision).toBe('none');
    expect(v0.dealer).toEqual([null, null, null]);
    expect(view(sim, null).seats[0]!.cards).toEqual([null, null, null]);
    // each seat's own cards travel only to that seat
    const hands = events(sim).filter((e) => e.type === 'hand');
    expect(hands.map((e) => [e.to, e.seat])).toEqual([[0, 0], [1, 1], [2, 2]]);
    const secret = new RegExp(`"(${cards('Ks Kd 4c 2s 7d 9h Qh Jd 10c As Ad 3c').join('|')})"`);
    expect(JSON.stringify(events(sim).filter((e) => e.type !== 'hand'))).not.toMatch(secret);
    expect(JSON.stringify(view(sim, 1))).not.toMatch(/"(Ks|Kd|4c|As|Ad|3c|Qh|Jd|Tc)"/);
  });

  it('takes decisions at once, folds a timeout, then reveals and settles everyone', () => {
    // seat 0: pair of kings, seat 1: 9-7-2 (will time out), seat 2: straight (Pair Plus only); dealer A-A-3
    const sim = table(stackedRng(cards('Ks Kd 4c 2s 7d 9h Qh Jd 10c As Ad 3c')));
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 500 });
    sim.act(1, { type: 'bet', ante: 1_000, pairPlus: 500 });
    sim.act(2, { type: 'bet', ante: 0, pairPlus: 500 });
    sim.advance(BETTING_MS);
    sim.act(0, { type: 'play' });
    expect(view(sim, null).phase).toBe('deciding');
    expect(view(sim, 1).seats[0]!.decision).toBe('play');
    sim.advance(DECISION_MS);
    const v = view(sim, null);
    expect(v.phase).toBe('results');
    expect(v.dealer).toEqual(cards('As Ad 3c'));
    expect(v.seats[0]!.result).toMatchObject({ outcome: 'lose', pairPlus: 1_000 });
    expect(v.seats[1]!.result).toMatchObject({ outcome: 'fold', returned: 0 });
    expect(v.seats[2]!.result).toMatchObject({ outcome: null, pairPlus: 3_500 });
    // played and Pair Plus hands are turned over for everyone; the folded hand never is
    expect(v.seats[0]!.cards).toEqual(cards('Ks Kd 4c'));
    expect(v.seats[2]!.cards).toEqual(cards('Qh Jd 10c'));
    expect(v.seats[1]!.cards).toEqual([null, null, null]);
    expect(view(sim, 1).seats[1]!.cards).toEqual(cards('2s 7d 9h'));
    expect(events(sim).find((e) => e.type === 'decision')).toMatchObject({ seat: 1, choice: 'fold', auto: true });
    expect(sim.stack(0)).toBe(100_000 - 2_500 + 1_000);
    expect(sim.stack(1)).toBe(100_000 - 1_500);
    expect(sim.stack(2)).toBe(100_000 + 3_000);
    expect(sim.rounds).toEqual([
      { seat: 1, wagered: 1_500, returned: 0 },
      { seat: 0, wagered: 2_500, returned: 1_000 },
      { seat: 2, wagered: 500, returned: 3_500 },
    ]);
    // results stay up, then the next window opens
    sim.advance(RESULTS_MS);
    expect(view(sim, null)).toMatchObject({ phase: 'betting', round: 2, seats: {}, dealer: [] });
  });

  it('settles as soon as the last player decides', () => {
    const sim = table(seededRng(11), [0, 3]);
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.act(3, { type: 'bet', ante: 2_000, pairPlus: 0 });
    sim.advance(BETTING_MS);
    expect(engine.liveBets(sim.state, 0)).toBe(1_000);
    sim.act(0, { type: 'play' });
    expect(engine.liveBets(sim.state, 0)).toBe(2_000); // the Play bet stays live until the dealer settles
    expect(view(sim, null).phase).toBe('deciding');
    sim.act(3, { type: 'fold' });
    expect(view(sim, null).phase).toBe('results');
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.liveBets(sim.state, 3)).toBe(0);
  });

  it('ignores a ready flag left over from the last round', () => {
    const sim = table(seededRng(12), [0, 1]);
    ready(sim, 0);
    ready(sim, 1);
    expect(view(sim, null).phase).toBe('betting'); // everyone ready, but nobody has bet
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.act(1, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.advance(0);
    expect(view(sim, null).phase).toBe('deciding');
    sim.act(0, { type: 'fold' });
    sim.act(1, { type: 'fold' });
    sim.advance(RESULTS_MS);
    // the next window opens with both still flagged ready from the last one
    expect(view(sim, null).phase).toBe('betting');
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.advance(0);
    expect(view(sim, null).phase).toBe('betting'); // seat 1's flag is stale: it hasn't bet or been seen not ready
    ready(sim, 1, false);
    expect(view(sim, null).phase).toBe('betting');
    ready(sim, 1, true);
    expect(view(sim, null).phase).toBe('deciding'); // seat 0 bet this window, seat 1 pressed Ready again
  });

  it("doesn't wait for a disconnected player, and hands a dropped bettor's chips back instead of dealing them", () => {
    const sim = table(seededRng(13), [0, 1]);
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.act(1, { type: 'bet', ante: 1_000, pairPlus: 500 });
    sim.seats.get(1)!.connected = false;
    ready(sim, 0);
    const v = view(sim, null);
    expect(v.phase).toBe('deciding');
    expect(Object.keys(v.seats)).toEqual(['0']);
    expect(sim.stack(1)).toBe(100_000);
  });

  it('rolls an empty window over, and goes idle when everyone has left', () => {
    const sim = table(seededRng(14), [0]);
    sim.advance(BETTING_MS);
    expect(view(sim, null)).toMatchObject({ phase: 'betting', round: 2 });
    sim.seats.clear();
    sim.advance(BETTING_MS);
    expect(view(sim, null).phase).toBe('idle');
    expect(engine.deadline(sim.state)).toBeNull();
  });

  it('refuses bets outside the window and folds a leaver who has not decided', () => {
    const sim = table(seededRng(15), [0, 1]);
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.act(1, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.advance(BETTING_MS);
    expect(sim.act(0, { type: 'bet', ante: 2_000, pairPlus: 0 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.act(0, { type: 'play' });
    sim.apply(engine.seatLeaving(sim.state, 1, sim.ctx()));
    expect(view(sim, null).phase).toBe('results');
    expect(view(sim, null).seats[1]!.result?.outcome).toBe('fold');
    expect(sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('shifts its deadline', () => {
    const sim = table(seededRng(16), [0]);
    const d = engine.deadline(sim.state)!;
    expect(engine.deadline(engine.shiftDeadlines(sim.state, 20_000))).toBe(d + 20_000);
  });
});

describe('three card poker exact enumeration through settle()', () => {
  // Every player hand against every dealer hand from the other 49 cards: 22,100 x 18,424 =
  // 407,170,400 deals. Outcomes don't change when the suits are relabelled, so each player hand
  // is enumerated once per suit pattern (1,755 of them) and weighted by how many hands share it.
  const deck = newDeck();
  const SUITS = 'shdc';
  const perms: number[][] = [];
  for (const a of [0, 1, 2, 3])
    for (const b of [0, 1, 2, 3])
      for (const c of [0, 1, 2, 3])
        for (const d of [0, 1, 2, 3]) if (new Set([a, b, c, d]).size === 4) perms.push([a, b, c, d]);

  interface H3 {
    s: number;
    lo: number;
    hi: number;
  }
  const hands: H3[] = [];
  const classes = new Map<number, { rep: H3; weight: number }>();
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++) {
        const hs = [deck[a]!, deck[b]!, deck[c]!];
        const bit = (i: number, lo: boolean) => (lo ? (i < 32 ? 1 << i : 0) : i >= 32 ? 1 << (i - 32) : 0);
        const h: H3 = { s: score(hs), lo: bit(a, true) | bit(b, true) | bit(c, true), hi: bit(a, false) | bit(b, false) | bit(c, false) };
        hands.push(h);
        let key = Infinity;
        for (const p of perms) {
          const ids = hs.map((card) => rankIndex(card) * 4 + p[SUITS.indexOf(card[1]!)]!).sort((x, y) => x - y);
          key = Math.min(key, ids[0]! * 2704 + ids[1]! * 52 + ids[2]!);
        }
        const k = classes.get(key);
        if (k) k.weight++;
        else classes.set(key, { rep: h, weight: 1 });
      }
  const distinct = [...new Set(hands.map((h) => h.s))].sort((x, y) => x - y);

  it('Ante and Play with the Q-6-4 rule: -13,733,780 / 407,170,400 = 3.3730% house edge', () => {
    const dist = new Map<number, number>();
    const hist = new Int32Array(6 * 2197);
    let total = 0;
    let sum = 0;
    let sumSq = 0;
    let q64Optimal = true;
    for (const { rep, weight } of classes.values()) {
      for (const d of hands) if (!((rep.lo & d.lo) | (rep.hi & d.hi))) hist[d.s]!++;
      const play = shouldPlay(rep.s);
      let evPlay = 0;
      let n = 0;
      for (const d of distinct) {
        const count = hist[d]!;
        if (count === 0) continue;
        hist[d] = 0;
        n += count;
        const r = settle({ ante: 1, play: play ? 1 : 0, pairPlus: 0 }, rep.s, d, DEFAULT_PAYTABLE);
        const x = r.returned - r.wagered;
        dist.set(x, (dist.get(x) ?? 0) + weight * count);
        sum += x * weight * count;
        sumSq += x * x * weight * count;
        const p = settle({ ante: 1, play: 1, pairPlus: 0 }, rep.s, d, DEFAULT_PAYTABLE);
        evPlay += (p.returned - p.wagered) * count;
      }
      expect(n).toBe(18_424);
      total += weight * n;
      // folding loses exactly one Ante, so playing is right when its EV beats -1
      if (evPlay > -n !== play) q64Optimal = false;
    }
    expect(classes.size).toBe(1_755);
    expect(total).toBe(407_170_400);
    expect(Object.fromEntries([...dist].sort((a, b) => a[0] - b[0]))).toEqual({
      '-2': 91_126_832,
      '-1': 132_923_304,
      '0': 249_216,
      '1': 80_955_780,
      '2': 91_100_696,
      '3': 8_976_452,
      '5': 289_104,
      '6': 931_972,
      '7': 617_044,
    });
    expect(sum).toBe(-13_733_780);
    expect(((-sum / total) * 100).toFixed(4)).toBe('3.3730');
    expect(Math.sqrt(sumSq / total - (sum / total) ** 2).toFixed(4)).toBe('1.6393');
    expect(q64Optimal).toBe(true);
    console.log(`three card poker exact: ante+play EV ${sum} / ${total} = ${(sum / total).toFixed(6)} per Ante (house edge ${((-sum / total) * 100).toFixed(4)}%)`);
  });

  it('Pair Plus 40-30-6-3-1: -1,608 / 22,100 = 7.2760%, with or without an Ante, and 40-30-6-4-1 is 2.32%', () => {
    let alone = 0;
    let withAnte = 0;
    let alt = 0;
    let sumSq = 0;
    const altPay = paytableOf({ pairPlus: [40, 30, 6, 4, 1] });
    for (const h of hands) {
      const r = settle({ ante: 0, play: 0, pairPlus: 1 }, h.s, 0, DEFAULT_PAYTABLE);
      alone += r.returned - r.wagered;
      sumSq += (r.returned - r.wagered) ** 2;
      // the Q-6-4 player folds only hands that lose Pair Plus anyway, so the forfeit costs nothing
      const q = settle({ ante: 1, play: shouldPlay(h.s) ? 1 : 0, pairPlus: 1 }, h.s, 0, DEFAULT_PAYTABLE);
      withAnte += q.pairPlus - 1;
      const a = settle({ ante: 0, play: 0, pairPlus: 1 }, h.s, 0, altPay);
      alt += a.returned - a.wagered;
    }
    expect(alone).toBe(-1_608);
    expect(withAnte).toBe(-1_608);
    expect(alt).toBe(-512);
    expect(((-alone / 22_100) * 100).toFixed(4)).toBe('7.2760');
    expect(Math.sqrt(sumSq / 22_100 - (alone / 22_100) ** 2).toFixed(4)).toBe('2.8496');
    console.log(`three card poker exact: pair plus EV ${alone} / 22100 = ${(alone / 22_100).toFixed(6)} (house edge ${((-alone / 22_100) * 100).toFixed(4)}%)`);
  });

  it('deals six different cards per seat and dealer from one deck', () => {
    const { hands: hs, dealer } = dealHands(seededRng(1), 6);
    const all = [...hs.flat(), ...dealer];
    expect(all).toHaveLength(21);
    expect(new Set(all).size).toBe(21);
  });
});
