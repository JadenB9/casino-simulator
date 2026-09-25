import { describe, it, expect } from 'vitest';
import { engine, BETTING_MS, DECISION_MS, RESULTS_MS, type LetItRideState } from '../src/games/letitride/engine.ts';
import {
  BONUS_NAMES,
  DEFAULT_PAYTABLE,
  FLUSH,
  FULL_HOUSE,
  HIGH_PAIR,
  NOTHING,
  QUADS,
  ROYAL,
  STRAIGHT,
  STRAIGHT_FLUSH,
  TRIPS,
  TWO_PAIR,
  bonusLine,
  bonusPays,
  category,
  categoryOfCodes,
  dealHands,
  handName,
  handPays,
  partialName,
  paytableOf,
  rideFirst,
  rideSecond,
  settle,
  type Category,
} from '../src/games/letitride/rules.ts';
import type { LetItRideEvent, LetItRideView } from '../src/games/letitride/protocol.ts';
import { newDeck } from '../src/cards.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { cards, stackedDeck } from './helpers/stacked.ts';

type Sim = TableSim<LetItRideState, unknown, LetItRideView>;
const solo = (rng: Rng, stack = 100_000): Sim => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]) as Sim;
const view = (sim: Sim, seat: number | null = 0) => sim.view(seat) as LetItRideView;
const events = (sim: Sim) => sim.lastEvents as LetItRideEvent[];
const cat = (s: string) => category(cards(s));

describe('let it ride hand ranks', () => {
  it('counts every category over all 2,598,960 hands', () => {
    const counts = new Array(10).fill(0);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++) for (let e = d + 1; e < 52; e++) counts[categoryOfCodes(a, b, c, d, e)]++;
    // nothing (and pairs under tens), tens or better, two pair ... royal
    expect(counts).toEqual([1_978_380, 422_400, 123_552, 54_912, 10_200, 5_108, 3_744, 624, 36, 4]);
  });

  it('classifies each category, a pair only from tens up', () => {
    expect(cat('As Ks Qs Js 10s')).toBe(ROYAL);
    expect(cat('9h 8h 7h 6h 5h')).toBe(STRAIGHT_FLUSH);
    expect(cat('5d 4d 3d 2d Ad')).toBe(STRAIGHT_FLUSH);
    expect(cat('7s 7h 7d 7c 2s')).toBe(QUADS);
    expect(cat('7s 7h 7d 2c 2s')).toBe(FULL_HOUSE);
    expect(cat('Kd 9d 7d 4d 2d')).toBe(FLUSH);
    expect(cat('Ac Kd Qh Js 10c')).toBe(STRAIGHT);
    expect(cat('5c 4d 3h 2s Ac')).toBe(STRAIGHT);
    expect(cat('Kc Ad 2h 3s 4c')).toBe(NOTHING); // never around the corner
    expect(cat('9s 9h 9d Kc 2s')).toBe(TRIPS);
    expect(cat('3s 3h 2d 2c As')).toBe(TWO_PAIR);
    expect(cat('10s 10h 4d 3c 2s')).toBe(HIGH_PAIR);
    expect(cat('As Ah 4d 3c 2s')).toBe(HIGH_PAIR);
    expect(cat('9s 9h Ad Kc Qs')).toBe(NOTHING);
    expect(cat('As Kh 9d 3c 2s')).toBe(NOTHING);
  });

  it('names hands the way a dealer calls them', () => {
    expect(handName(cards('As Ks Qs Js 10s'))).toBe('Royal flush');
    expect(handName(cards('7s 7h 7d 2c 2s'))).toBe('Sevens full of Twos');
    expect(handName(cards('Js Jh 4d 4c As'))).toBe('Two pair, Jacks and Fours');
    expect(handName(cards('Qs Qh 4d 3c 2s'))).toBe('Pair of Queens');
    expect(handName(cards('6s 6h 4d 3c 2s'))).toBe('Pair of Sixes');
    expect(handName(cards('Ks 9h 4d 3c 2s'))).toBe('King high');
    expect(handName(cards('8s 8h 8d 8c 2s'))).toBe('Four Eights');
    expect(partialName(cards('Qs Qh 4d'))).toBe('Pair of Queens');
    expect(partialName(cards('Ks 9h 4d 2c'))).toBe('King high');
    expect(partialName(cards('5s 5h 5d'))).toBe('Three Fives');
  });
});

describe('let it ride pay tables', () => {
  it('pays every cell of the standard table, and nothing below a pair of tens', () => {
    const pays = [ROYAL, STRAIGHT_FLUSH, QUADS, FULL_HOUSE, FLUSH, STRAIGHT, TRIPS, TWO_PAIR, HIGH_PAIR, NOTHING].map((c) => handPays(c as Category, DEFAULT_PAYTABLE));
    expect(pays).toEqual([1000, 200, 50, 11, 8, 5, 3, 2, 1, 0]);
  });

  it('counts the 3-Card Bonus lines over all 22,100 three-card hands and pays 50-40-30-6-3-1', () => {
    const deck = newDeck();
    const counts = new Array(6).fill(0);
    let losers = 0;
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++) {
          const line = bonusLine([deck[a]!, deck[b]!, deck[c]!]);
          if (line < 0) losers++;
          else counts[line]++;
        }
    expect(counts).toEqual([4, 44, 52, 720, 1_096, 3_744]);
    expect(losers).toBe(16_440);
    expect(BONUS_NAMES[bonusLine(cards('As Ks Qs'))]).toBe('Mini royal');
    expect(bonusPays(cards('As Ks Qs'), DEFAULT_PAYTABLE)).toBe(50);
    expect(bonusPays(cards('9d 10d Jd'), DEFAULT_PAYTABLE)).toBe(40);
    expect(bonusPays(cards('4d 4c 4s'), DEFAULT_PAYTABLE)).toBe(30);
    expect(bonusPays(cards('As 2d 3c'), DEFAULT_PAYTABLE)).toBe(6);
    expect(bonusPays(cards('Kh 9h 2h'), DEFAULT_PAYTABLE)).toBe(3);
    expect(bonusPays(cards('2h 2c 9s'), DEFAULT_PAYTABLE)).toBe(1);
    expect(bonusPays(cards('Ah Kc 9s'), DEFAULT_PAYTABLE)).toBe(0);
  });

  it('keeps the pay tables in the table config and falls back on anything malformed', () => {
    expect(paytableOf(engine.config('', 'solo').options)).toEqual(DEFAULT_PAYTABLE);
    expect(paytableOf({ hand: [1, 2], bonus: 'x' })).toEqual(DEFAULT_PAYTABLE);
    const alt = { hand: [0, 1, 2, 3, 5, 8, 11, 50, 200, 500], bonus: [40, 40, 30, 6, 3, 1] };
    expect(paytableOf(alt)).toEqual(alt);
  });
});

describe('let it ride strategy', () => {
  it('bet 1: rides a paying hand, three to a royal, and the good straight flush draws', () => {
    const ride = (s: string) => rideFirst(cards(s));
    expect(ride('10s 10h 4d')).toBe(true);
    expect(ride('As Ah 2d')).toBe(true);
    expect(ride('3s 3h 3d')).toBe(true);
    expect(ride('9s 9h Ad')).toBe(false);
    expect(ride('Js Qs As')).toBe(true); // three to a royal, gaps and all
    expect(ride('10h Jh Qh')).toBe(true);
    expect(ride('5c 6c 7c')).toBe(true); // three suited in a row
    expect(ride('2c 3c 4c')).toBe(false);
    expect(ride('Ac 2c 3c')).toBe(false);
    expect(ride('3c 4c 5c')).toBe(true);
    expect(ride('8d 9d Jd')).toBe(true); // one gap, a high card
    expect(ride('7d 8d 10d')).toBe(true);
    expect(ride('6d 7d 9d')).toBe(false); // one gap, no high card
    expect(ride('Ad 2d 4d')).toBe(false); // the ace plays low there
    expect(ride('8d 10d Qd')).toBe(true); // two gaps, two high cards
    expect(ride('7d 9d Jd')).toBe(false); // two gaps, one high card
    expect(ride('As Ks Qd')).toBe(false); // a royal needs the suit
    expect(ride('Ah Kd 9c')).toBe(false);
  });

  it('bet 2: rides a paying hand, four to a flush, four to an outside straight, four high cards inside', () => {
    const ride = (s: string) => rideSecond(cards(s));
    expect(ride('Qs Qh 4d 2c')).toBe(true);
    expect(ride('4s 4h 2d 2c')).toBe(true); // two pair already pays 2 to 1
    expect(ride('4s 4h 4d 2c')).toBe(true);
    expect(ride('9s 9h Ad Kc')).toBe(false);
    expect(ride('2s 7s 9s Ks')).toBe(true); // four to a flush
    expect(ride('9s 10h Jd Qc')).toBe(true); // open, high cards
    expect(ride('7s 8h 9d 10c')).toBe(true);
    expect(ride('4s 5h 6d 7c')).toBe(true); // outside, no high card: an exact tie, ridden
    expect(ride('Js Qh Kd Ac')).toBe(true); // one end only, but four high cards
    expect(ride('10s Jh Qd Ac')).toBe(true); // inside, four high cards: an exact tie, ridden
    expect(ride('Ah 2d 3c 4s')).toBe(false); // fills one way, no high card
    expect(ride('8s 9h Jd Qc')).toBe(false);
    expect(ride('Ah Kd 9c 2s')).toBe(false);
  });
});

describe('let it ride settlement', () => {
  const five = (s: string) => cards(s);
  it('pays each bet still riding by the table and nothing on a pulled bet', () => {
    const r = settle(1_000, [false, false], 0, five('Ks Kh 4d 3c 2s'), DEFAULT_PAYTABLE);
    expect(r).toEqual({ hand: HIGH_PAIR, pulled: [false, false], bets: [2_000, 2_000, 2_000], bonus: 0, wagered: 3_000, returned: 6_000 });
    const pulled = settle(1_000, [true, false], 0, five('7s 7h 7d 3c 2s'), DEFAULT_PAYTABLE);
    expect(pulled).toMatchObject({ bets: [0, 4_000, 4_000], wagered: 2_000, returned: 8_000 });
    const both = settle(1_000, [true, true], 0, five('As Ks Qs Js 10s'), DEFAULT_PAYTABLE);
    expect(both).toMatchObject({ hand: ROYAL, bets: [0, 0, 1_001_000], wagered: 1_000, returned: 1_001_000 });
  });

  it('takes every riding bet on a hand below a pair of tens', () => {
    const r = settle(500, [false, true], 0, five('9s 9h 4d 3c 2s'), DEFAULT_PAYTABLE);
    expect(r).toMatchObject({ hand: NOTHING, bets: [0, 0, 0], wagered: 1_000, returned: 0 });
  });

  it('settles the 3-Card Bonus on the first three cards, whatever the five make', () => {
    // three to a straight flush that the board doesn't help: the bonus still pays 40 to 1
    const r = settle(1_000, [true, true], 500, five('9d 10d Jd 2c 4s'), DEFAULT_PAYTABLE);
    expect(r).toMatchObject({ hand: NOTHING, bonus: 20_500, wagered: 1_500, returned: 20_500 });
    // the board makes a pair of the player's, the bonus sees only the three
    const s = settle(1_000, [false, false], 500, five('Kd 8c 3s Kh 2c'), DEFAULT_PAYTABLE);
    expect(s).toMatchObject({ hand: HIGH_PAIR, bonus: 0, returned: 6_000, wagered: 3_500 });
  });
});

describe('let it ride engine: solo', () => {
  /** Bets down and dealt with `hand` then the board. */
  const dealt = (hand: string, board: string, bets = { unit: 1_000, bonus: 0 }, stack = 100_000): Sim => {
    const sim = solo(stackedDeck(cards(`${hand} ${board}`)), stack);
    sim.act(0, { type: 'bet', ...bets });
    sim.act(0, { type: 'deal' });
    return sim;
  };

  it('bet, deal, ride, ride: exact chip moves at every step', () => {
    const sim = dealt('Qs Qh 4d', '9c 2s', { unit: 1_000, bonus: 500 });
    expect(sim.stack(0)).toBe(100_000 - 3_500);
    let v = view(sim);
    expect(v.phase).toBe('first');
    expect(v.seats[0]).toMatchObject({ unit: 1_000, bonus: 500, cards: cards('Qs Qh 4d'), first: 'pending', second: null });
    expect(v.board).toEqual([null, null]);
    expect(events(sim).map((e) => e.type)).toEqual(['deal', 'hand', 'decide']);
    sim.act(0, { type: 'ride' });
    v = view(sim);
    expect(v.phase).toBe('second');
    expect(v.board).toEqual([cards('9c')[0], null]);
    expect(events(sim).map((e) => e.type)).toEqual(['decision', 'board', 'decide']);
    sim.act(0, { type: 'ride' });
    v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.board).toEqual(cards('9c 2s'));
    // a pair of queens pays 1 to 1 on all three; the bonus pays the pair 1 to 1
    expect(v.seats[0]!.result).toMatchObject({ hand: HIGH_PAIR, bets: [2_000, 2_000, 2_000], bonus: 1_000, returned: 7_000, wagered: 3_500 });
    expect(sim.stack(0)).toBe(100_000 + 3_500);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 3_500, returned: 7_000 }]);
    expect(events(sim).map((e) => e.type)).toEqual(['decision', 'board', 'show', 'result']);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('a pulled bet comes back to the stack at once', () => {
    const sim = dealt('7s 2h 4d', '9c Ks');
    sim.act(0, { type: 'pull' });
    expect(sim.stack(0)).toBe(100_000 - 2_000);
    expect(events(sim)[0]).toEqual({ type: 'decision', seat: 0, bet: 1, choice: 'pull', back: 1_000 });
    expect(engine.liveBets(sim.state, 0)).toBe(2_000);
    sim.act(0, { type: 'pull' });
    expect(sim.stack(0)).toBe(100_000 - 1_000);
    expect(view(sim).seats[0]!.result).toMatchObject({ hand: NOTHING, pulled: [true, true], wagered: 1_000, returned: 0 });
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 0 }]);
  });

  it('the $ bet can never come back, and each decision is taken once', () => {
    const sim = dealt('7s 2h 4d', '9c Ks');
    sim.act(0, { type: 'pull' });
    sim.act(0, { type: 'ride' });
    expect(sim.act(0, { type: 'pull' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(view(sim).seats[0]!.result).toMatchObject({ pulled: [true, false], wagered: 2_000 });
  });

  it('bets are totals: raise, lower and clear move only the difference', () => {
    const sim = solo(seededRng(3));
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 0 });
    sim.act(0, { type: 'bet', unit: 2_500, bonus: 500 });
    expect(sim.stack(0)).toBe(100_000 - 8_000);
    expect(engine.liveBets(sim.state, 0)).toBe(8_000);
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 500 });
    expect(sim.stack(0)).toBe(100_000 - 3_500);
    sim.act(0, { type: 'bet', unit: 0, bonus: 0 });
    expect(sim.stack(0)).toBe(100_000);
    expect(view(sim).seats).toEqual({});
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('refuses bets off the limits, over the stack, or a bonus without the three bets', () => {
    const sim = solo(seededRng(4), 3_500);
    const bet = (unit: number, bonus: number) => sim.act(0, { type: 'bet', unit, bonus }, { allowRefusal: true }).refused;
    expect(bet(900, 0)).toBe('LIMIT'); // $10 minimum a circle
    expect(bet(100_100, 0)).toBe('LIMIT'); // $1,000 maximum
    expect(bet(1_050, 0)).toBe('LIMIT'); // whole dollars
    expect(bet(1_000, 400)).toBe('LIMIT'); // bonus $5 minimum
    expect(bet(1_000, 25_100)).toBe('LIMIT'); // bonus $250 maximum
    expect(bet(0, 500)).toBe('BAD_REQUEST');
    expect(bet(1_200, 0)).toBe('NOT_ENOUGH_CHIPS'); // three $12 bets are $36
    expect(bet(1_000, 500)).toBeUndefined();
    expect(sim.stack(0)).toBe(0);
    expect(engine.parseAction({ type: 'bet', unit: -5, bonus: 0 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', unit: 1_000 })).toEqual({ type: 'bet', unit: 1_000, bonus: 0 });
    expect(engine.parseAction({ type: 'bet', unit: 1_000, spot: 7 })).toBeNull();
    expect(engine.parseAction({ type: 'raise' })).toBeNull();
  });

  it('keeps betting and deciding apart', () => {
    const sim = dealt('7s 2h 4d', '9c Ks');
    expect(sim.act(0, { type: 'bet', unit: 2_000, bonus: 0 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.act(0, { type: 'ride' });
    sim.act(0, { type: 'ride' });
    expect(sim.act(0, { type: 'ride' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    // a bet after the result opens the next round
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 0 });
    expect(view(sim).phase).toBe('betting');
    expect(view(sim).round).toBe(2);
  });

  it('leaving mid-hand pulls back what can come back and settles the rest', () => {
    const sim = dealt('Ks Kh 4d', '9c 2s');
    sim.act(0, { type: 'ride' });
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(view(sim).phase).toBe('results');
    expect(view(sim).seats[0]!.result).toMatchObject({ pulled: [false, true], hand: HIGH_PAIR, wagered: 2_000, returned: 4_000 });
    expect(sim.stack(0)).toBe(100_000 + 2_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    const early = solo(seededRng(5));
    early.act(0, { type: 'bet', unit: 1_000, bonus: 500 });
    early.apply(engine.seatLeaving(early.state, 0, early.ctx()));
    expect(early.stack(0)).toBe(100_000);
  });

  it('runs no timers solo', () => {
    const sim = dealt('7s 2h 4d', '9c Ks');
    expect(engine.deadline(sim.state)).toBeNull();
    sim.advance(60_000);
    expect(view(sim).phase).toBe('first');
  });

  it('deals different cards to every hand and the board from one deck', () => {
    const rng = seededRng(9);
    for (let i = 0; i < 200; i++) {
      const { hands, board } = dealHands(rng, 3);
      const all = [...hands.flat(), ...board];
      expect(all).toHaveLength(11);
      expect(new Set(all).size).toBe(11);
    }
  });
});

describe('let it ride engine: several hands', () => {
  it('three hands against one board: each decided on its own, shown only to their player', () => {
    const sim = solo(stackedDeck(cards('Qs Qh 4d 7c 2h 9s As Ks Qc Jd 3c')), 100_000);
    sim.act(0, { type: 'spots', n: 3 });
    for (const spot of [0, 1, 2]) sim.act(0, { type: 'bet', unit: 1_000, bonus: 0, spot });
    expect(sim.stack(0)).toBe(100_000 - 9_000);
    sim.act(0, { type: 'deal' });
    expect(view(sim).mine).toEqual([0, 1, 2]);
    expect(view(sim).seats[1]!.cards).toEqual(cards('7c 2h 9s'));
    // an order without a spot goes to the first hand still deciding
    sim.act(0, { type: 'ride' });
    sim.act(0, { type: 'pull', spot: 2 });
    expect(view(sim).phase).toBe('first');
    sim.act(0, { type: 'pull' });
    expect(view(sim).phase).toBe('second');
    sim.act(0, { type: 'ride', spot: 0 });
    sim.act(0, { type: 'pull', spot: 1 });
    sim.act(0, { type: 'ride', spot: 2 });
    const v = view(sim);
    expect(v.phase).toBe('results');
    // board Jd 3c: Qs Qh 4d pays three bets; 7c 2h 9s loses its $; As Ks Qc with Jd: nothing
    expect(v.seats[0]!.result).toMatchObject({ hand: HIGH_PAIR, returned: 6_000 });
    expect(v.seats[1]!.result).toMatchObject({ pulled: [true, true], wagered: 1_000, returned: 0 });
    expect(v.seats[2]!.result).toMatchObject({ pulled: [true, false], wagered: 2_000, returned: 0 });
    expect(sim.stack(0)).toBe(100_000 - 9_000 + 3_000 + 6_000);
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 3_000, returned: 6_000 },
      { seat: 0, wagered: 1_000, returned: 0, spot: 1 },
      { seat: 0, wagered: 2_000, returned: 0, spot: 2 },
    ]);
  });

  it('fewer hands gives back the bets on the spots let go; a shared table refuses more', () => {
    const sim = solo(seededRng(2));
    sim.act(0, { type: 'spots', n: 2 });
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 500, spot: 1 });
    sim.act(0, { type: 'spots', n: 1 });
    expect(sim.stack(0)).toBe(100_000);
    const multi = new TableSim(engine, seededRng(2), 'multi', [{ seat: 0, stack: 10_000 }]) as Sim;
    expect(multi.act(0, { type: 'spots', n: 2 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });
});

describe('let it ride engine: multiplayer', () => {
  const table = (): Sim => {
    const sim = new TableSim(engine, seededRng(7), 'multi', [
      { seat: 0, stack: 100_000 },
      { seat: 3, stack: 100_000 },
    ]) as Sim;
    sim.started = true;
    sim.advance(0);
    return sim;
  };

  it('opens a timed window and deals every bettor when it closes', () => {
    const sim = table();
    expect(view(sim).phase).toBe('betting');
    expect(view(sim).deadline).toBe(sim.now + BETTING_MS);
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 0 });
    sim.act(3, { type: 'bet', unit: 2_000, bonus: 500 });
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.advance(BETTING_MS);
    const v0 = view(sim, 0);
    expect(v0.phase).toBe('first');
    expect(v0.seats[0]!.cards.every((c) => c !== null)).toBe(true);
    // nobody sees another player's cards before the end, spectators included
    expect(v0.seats[3]!.cards).toEqual([null, null, null]);
    expect(view(sim, null).seats[0]!.cards).toEqual([null, null, null]);
    expect(v0.board).toEqual([null, null]);
  });

  it('pulls back a bet the clock runs out on, decides both bets, then settles and reopens', () => {
    const sim = table();
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 0 });
    sim.act(3, { type: 'bet', unit: 1_000, bonus: 0 });
    sim.advance(BETTING_MS);
    sim.act(0, { type: 'ride' });
    expect(view(sim).phase).toBe('first');
    sim.advance(DECISION_MS);
    expect(view(sim).phase).toBe('second');
    expect(view(sim, 3).seats[3]!.first).toBe('pull');
    expect(sim.stack(3)).toBe(100_000 - 2_000);
    sim.act(0, { type: 'pull' });
    sim.act(3, { type: 'ride' });
    const v = view(sim, null);
    expect(v.phase).toBe('results');
    // everyone's cards are turned over at the end
    expect(v.seats[0]!.cards.every((c) => c !== null)).toBe(true);
    expect(v.seats[0]!.result!.pulled).toEqual([false, true]);
    expect(v.seats[3]!.result!.pulled).toEqual([true, false]);
    expect(sim.rounds).toHaveLength(2);
    sim.advance(RESULTS_MS);
    expect(view(sim).phase).toBe('betting');
  });

  it("hands a dropped bettor's chips back instead of dealing them, and rolls an empty window over", () => {
    const sim = table();
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 500 });
    sim.act(3, { type: 'bet', unit: 1_000, bonus: 0 });
    sim.seats.get(3)!.connected = false;
    sim.advance(BETTING_MS);
    expect(sim.stack(3)).toBe(100_000);
    expect(Object.keys(view(sim).seats)).toEqual(['0']);
    const empty = table();
    const round = view(empty).round;
    empty.advance(BETTING_MS);
    expect(view(empty).phase).toBe('betting');
    expect(view(empty).round).toBe(round + 1);
  });

  it('a leaver who has not decided is pulled back; the $ bet stays live until the table settles', () => {
    const sim = table();
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 0 });
    sim.act(3, { type: 'bet', unit: 1_000, bonus: 0 });
    sim.advance(BETTING_MS);
    sim.apply(engine.seatLeaving(sim.state, 3, sim.ctx()));
    expect(sim.stack(3)).toBe(100_000 - 2_000);
    expect(engine.liveBets(sim.state, 3)).toBe(2_000);
    sim.act(0, { type: 'ride' });
    // bet 2 comes up for the leaver too, and the clock pulls it back
    sim.advance(DECISION_MS);
    expect(view(sim).phase).toBe('results');
    expect(engine.liveBets(sim.state, 3)).toBe(0);
  });

  it('shifts its deadline', () => {
    const sim = table();
    const d = engine.deadline(sim.state)!;
    expect(engine.deadline(engine.shiftDeadlines(sim.state, 5_000))).toBe(d + 5_000);
  });
});

describe('let it ride and pai gow at chosen limits', () => {
  it('take a bet at the chosen maximum and refuse a dollar more, side bets scaled with them', async () => {
    const { applyLimits, clampLimits } = await import('../src/limits.ts');
    const { engine: paigow } = await import('../src/games/paigow/engine.ts');
    const L = { min: 30 * 100, max: 3_000 * 100 };
    expect(clampLimits('letitride', L)).toEqual(L);
    const cfg = applyLimits(engine.config('', 'solo'), L);
    expect(cfg.limits.bet).toEqual({ min: 3_000, max: 300_000, step: 100 });
    const sim = new TableSim(engine, seededRng(1), 'solo', [{ seat: 0, stack: 10_000_000 }], cfg) as Sim;
    expect(sim.act(0, { type: 'bet', unit: 300_100, bonus: 0 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'bet', unit: 2_900, bonus: 0 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'bet', unit: 300_000, bonus: cfg.limits.bonus!.max }, { allowRefusal: true }).refused).toBeUndefined();
    const pcfg = applyLimits(paigow.config('', 'solo'), L);
    expect(pcfg.limits.bet).toEqual({ min: 3_000, max: 300_000, step: 100 });
    expect(pcfg.limits.fortune!.max).toBe(30_000);
    const p = new TableSim(paigow, seededRng(1), 'solo', [{ seat: 0, stack: 10_000_000 }], pcfg);
    expect(p.act(0, { type: 'bet', bet: 300_100, fortune: 0 }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(p.act(0, { type: 'bet', bet: 300_000, fortune: 30_000 }, { allowRefusal: true }).refused).toBeUndefined();
  });
});

describe('let it ride tips', () => {
  it('says ride or pull with the reason, and agrees with the strategy', async () => {
    const { rideAdvice } = await import('../src/games/letitride/advice.ts');
    expect(rideAdvice(cards('Qs Qh 4d'))).toEqual({ ride: true, text: 'Let it ride: a Pair of Queens pays already' });
    expect(rideAdvice(cards('5s 5h 5d'))).toEqual({ ride: true, text: 'Let it ride: Three Fives pays already' });
    expect(rideAdvice(cards('Js Qs As')).text).toBe('Let it ride: three to a royal flush');
    expect(rideAdvice(cards('9s 9h 4d')).text).toBe('Pull it back: a Pair of Nines, not enough to ride on three cards');
    expect(rideAdvice(cards('2s 7s 9s Ks')).text).toBe('Let it ride: four to a flush');
    expect(rideAdvice(cards('Ks 9h 4d 2c'))).toEqual({ ride: false, text: 'Pull it back: King high, no draw worth the bet' });
    const rng = seededRng(21);
    for (let i = 0; i < 2_000; i++) {
      const { hands, board } = dealHands(rng, 1);
      expect(rideAdvice(hands[0]!).ride).toBe(rideFirst(hands[0]!));
      expect(rideAdvice([...hands[0]!, board[0]!]).ride).toBe(rideSecond([...hands[0]!, board[0]!]));
    }
  });
});

describe('let it ride in the big-win news', () => {
  it('names the hand from what the table turned over, never from a private deal', async () => {
    const { winWhat } = await import('../src/games/letitride/wins.ts');
    const sim = solo(stackedDeck(cards('As Ks Qs Js 10s')));
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 500 });
    sim.act(0, { type: 'deal' });
    const dealEvents = events(sim);
    sim.act(0, { type: 'ride' });
    const firstEvents = events(sim);
    sim.act(0, { type: 'ride' });
    expect(winWhat([...firstEvents, ...events(sim)], 0)).toBe('Royal flush');
    // the private hand event alone names nothing
    expect(winWhat(dealEvents, 0)).toBeNull();
  });
});
