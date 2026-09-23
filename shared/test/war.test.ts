import { describe, it, expect } from 'vitest';
import { engine, BETTING_MS, DECISION_MS, RESULTS_MS, type WarState } from '../src/games/war/engine.ts';
import {
  DECKS,
  DEFAULT_RULES,
  SHOE_CARDS,
  CUT_FROM_BOTTOM,
  bestChoice,
  cardName,
  compare,
  dealRound,
  dealWar,
  exactOdds,
  openShoe,
  pluralName,
  rulesOf,
  settle,
  settleDeal,
  shuffleDue,
  value,
  type Hand,
  type WarRules,
} from '../src/games/war/rules.ts';
import type { WarView, WarEvent } from '../src/games/war/protocol.ts';
import { type Card, RANKS, newDeck, isCard } from '../src/cards.ts';
import type { Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

// shared/ compiles without DOM or Node types; the test runner provides console.
declare const console: { log(...args: unknown[]): void };

const card = (c: string): Card => {
  const x = c.length === 3 ? `T${c[2]}` : c;
  if (!isCard(x)) throw new Error(`bad card ${c}`);
  return x;
};
const cards = (s: string): Card[] => s.split(' ').map(card);

/**
 * An Rng that makes the engine's next shoe come out as `top` (the burn card first, then the cards
 * in the order they are dealt) followed by the rest of the six decks. newShoe() shuffles with
 * Fisher-Yates from the last position down, so each draw is answered with the position of a copy
 * of the card wanted there. Anything that draws again (a second shuffle) throws.
 */
function stackedRng(top: Card[]): Rng {
  const start: Card[] = [];
  for (let d = 0; d < DECKS; d++) start.push(...newDeck());
  const rest = start.slice();
  for (const c of top) {
    const k = rest.indexOf(c);
    if (k < 0) throw new Error(`more than ${DECKS} of ${c}`);
    rest.splice(k, 1);
  }
  const target = [...top, ...rest];
  const cur = start.slice();
  const draws: number[] = [];
  for (let i = cur.length - 1; i > 0; i--) {
    const j = cur.lastIndexOf(target[i]!, i);
    draws.push(j);
    [cur[i], cur[j]] = [cur[j]!, cur[i]!];
  }
  let k = 0;
  return {
    next32() {
      if (k >= draws.length) throw new Error('stacked shoe used up');
      return draws[k++]!;
    },
  };
}

type Sim = TableSim<WarState, unknown, WarView>;
const solo = (rng: Rng, stack = 100_000): Sim => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]) as Sim;
const view = (sim: Sim, seat: number | null = 0) => sim.view(seat) as WarView;
const events = (sim: Sim) => sim.lastEvents as WarEvent[];
const STINGY: WarRules = { tiePays: 10, warTiePays: 1 };

// ---------------------------------------------------------------------------------------------

describe('casino war ranks and payouts', () => {
  it('ranks aces high and deuces low, and ignores suits', () => {
    expect(value(card('As'))).toBe(14);
    expect(value(card('Kd'))).toBe(13);
    expect(value(card('10h'))).toBe(10);
    expect(value(card('2c'))).toBe(2);
    expect(compare(card('As'), card('Kd'))).toBe(1);
    expect(compare(card('2c'), card('As'))).toBe(-1);
    expect(compare(card('Ks'), card('Kh'))).toBe(0);
    // every rank beats every rank below it
    const order = ['2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', 'Js', 'Qs', 'Ks', 'As'].map(card);
    for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) expect(compare(order[i]!, order[j]!)).toBe(Math.sign(i - j));
  });

  it('names cards the way the dealer calls them', () => {
    expect(cardName(card('As'))).toBe('Ace');
    expect(cardName(card('10d'))).toBe('Ten');
    expect(pluralName(card('6h'))).toBe('Sixes');
    expect(pluralName(card('Qc'))).toBe('Queens');
  });

  const bets = { bet: 1_000, tie: 500 };
  const s = (hand: Hand, rules: WarRules = DEFAULT_RULES) => settle(bets, hand, rules);

  it('a higher card wins even money and the Tie bet loses', () => {
    expect(s({ player: card('Ks'), dealer: card('9d') })).toEqual({ outcome: 'win', bet: 2_000, war: 0, tie: 0, wagered: 1_500, returned: 2_000 });
  });

  it('a lower card loses the bet and the Tie bet', () => {
    expect(s({ player: card('9d'), dealer: card('Ks') })).toEqual({ outcome: 'lose', bet: 0, war: 0, tie: 0, wagered: 1_500, returned: 0 });
  });

  it('a tie pays the Tie bet 10 to 1, and surrendering gives back half the bet', () => {
    expect(s({ player: card('8s'), dealer: card('8h'), choice: 'surrender' })).toEqual({
      outcome: 'surrender',
      bet: 500,
      war: 0,
      tie: 5_500,
      wagered: 1_500,
      returned: 6_000,
    });
    // an odd dollar amount halves to the cent
    expect(settle({ bet: 1_500, tie: 0 }, { player: card('2s'), dealer: card('2d'), choice: 'surrender' }, DEFAULT_RULES)).toMatchObject({ bet: 750, returned: 750 });
  });

  it('winning the war pushes the bet and pays the raise even money', () => {
    expect(s({ player: card('8s'), dealer: card('8h'), choice: 'war', war: { player: card('Qd'), dealer: card('5c') } })).toEqual({
      outcome: 'war-win',
      bet: 1_000,
      war: 2_000,
      tie: 5_500,
      wagered: 2_500,
      returned: 8_500,
    });
  });

  it('a tie in the war pushes the bet and pays the raise 2 to 1 (1 to 1 without the bonus)', () => {
    const hand: Hand = { player: card('8s'), dealer: card('8h'), choice: 'war', war: { player: card('Jd'), dealer: card('Jc') } };
    expect(s(hand)).toEqual({ outcome: 'war-tie', bet: 1_000, war: 3_000, tie: 5_500, wagered: 2_500, returned: 9_500 });
    expect(s(hand, STINGY)).toEqual({ outcome: 'war-tie', bet: 1_000, war: 2_000, tie: 5_500, wagered: 2_500, returned: 8_500 });
  });

  it('losing the war loses the bet and the raise; the Tie bet still won at the deal', () => {
    expect(s({ player: card('8s'), dealer: card('8h'), choice: 'war', war: { player: card('3d'), dealer: card('Ac') } })).toEqual({
      outcome: 'war-lose',
      bet: 0,
      war: 0,
      tie: 5_500,
      wagered: 2_500,
      returned: 5_500,
    });
  });

  it('with no Tie bet a tie pays nothing extra, and the deal alone reports what is settled', () => {
    expect(settle({ bet: 1_000, tie: 0 }, { player: card('As'), dealer: card('Ad'), choice: 'war', war: { player: card('Ks'), dealer: card('Kd') } }, DEFAULT_RULES)).toEqual({
      outcome: 'war-tie',
      bet: 1_000,
      war: 3_000,
      tie: 0,
      wagered: 2_000,
      returned: 4_000,
    });
    expect(settleDeal(bets, card('7s'), card('7d'), DEFAULT_RULES)).toEqual({ cmp: 0, bet: null, tie: 5_500 });
    expect(settleDeal(bets, card('7s'), card('6d'), DEFAULT_RULES)).toEqual({ cmp: 1, bet: 2_000, tie: 0 });
    expect(settleDeal(bets, card('6s'), card('7d'), DEFAULT_RULES)).toEqual({ cmp: -1, bet: 0, tie: 0 });
    expect(() => s({ player: card('8s'), dealer: card('8h') })).toThrow();
    expect(() => s({ player: card('8s'), dealer: card('8h'), choice: 'war' })).toThrow();
  });

  it('reads the pays from the table options, and falls back on anything malformed', () => {
    expect(rulesOf({})).toEqual({ tiePays: 10, warTiePays: 2 });
    expect(rulesOf({ tiePays: 11, warTiePays: 1 })).toEqual({ tiePays: 11, warTiePays: 1 });
    expect(rulesOf({ tiePays: 0, warTiePays: 2.5 })).toEqual(DEFAULT_RULES);
    expect(rulesOf({ tiePays: '10', warTiePays: -1 })).toEqual(DEFAULT_RULES);
    expect(settle({ bet: 1_000, tie: 100 }, { player: card('4s'), dealer: card('4d'), choice: 'surrender' }, rulesOf({ tiePays: 11 })).tie).toBe(1_200);
  });
});

// ---------------------------------------------------------------------------------------------

describe('casino war exact odds (six decks, every rank combination through settle())', () => {
  // A card of each rank; suits never matter, so a rank's weight is how many of it are left.
  const ranks = RANKS.map((r) => `${r}s` as Card);
  const n = 4 * DECKS;
  // Every ordered deal (player, dealer) from 312 cards, and after a tie every ordered pair of war
  // cards from the 310 left. The three burned cards aren't enumerated: summing them out multiplies
  // every war pair's count by the same 308 x 307 x 306 ordered burns, so they cancel.
  const W1 = SHOE_CARDS * (SHOE_CARDS - 1);
  const W2 = (SHOE_CARDS - 2) * (SHOE_CARDS - 3);
  const TOTAL = W1 * W2;

  /** Sum of net * weight over every deal (in cents on a $1 bet), with `play` settling each hand. */
  function enumerate(play: (hand: Hand) => { net: number }): { sum: number; sumSq: number; dist: Map<number, number>; warAfterTie: number[] } {
    let sum = 0;
    let sumSq = 0;
    const dist = new Map<number, number>();
    const warAfterTie: number[] = [];
    const add = (net: number, w: number) => {
      sum += net * w;
      sumSq += net * net * w;
      dist.set(net, (dist.get(net) ?? 0) + w);
    };
    for (let i = 0; i < 13; i++) {
      for (let j = 0; j < 13; j++) {
        const w1 = n * (n - (i === j ? 1 : 0));
        if (i !== j) {
          add(play({ player: ranks[i]!, dealer: ranks[j]! }).net, w1 * W2);
          continue;
        }
        let tieSum = 0;
        for (let k = 0; k < 13; k++) {
          for (let l = 0; l < 13; l++) {
            const ck = n - (k === i ? 2 : 0);
            const cl = n - (l === i ? 2 : 0) - (l === k ? 1 : 0);
            const w2 = ck * cl;
            const net = play({ player: ranks[i]!, dealer: ranks[j]!, war: { player: ranks[k]!, dealer: ranks[l]! } }).net;
            add(net, w1 * w2);
            tieSum += net * w2;
          }
        }
        warAfterTie.push(tieSum);
      }
    }
    return { sum, sumSq, dist, warAfterTie };
  }

  const main = (rules: WarRules, choice: 'war' | 'surrender') => (hand: Hand) => {
    const h: Hand = compare(hand.player, hand.dealer) === 0 ? { ...hand, choice } : { player: hand.player, dealer: hand.dealer };
    if (choice === 'surrender') delete h.war;
    const r = settle({ bet: 100, tie: 0 }, h, rules);
    return { net: r.returned - r.wagered };
  };
  const sd = (e: { sum: number; sumSq: number }) => Math.sqrt(e.sumSq / TOTAL - (e.sum / TOTAL) ** 2) / 100;

  it('always going to war, with the raise paying 2 to 1 on a tie in the war: 2.3301% (Wizard of Odds 2.33%)', () => {
    const e = enumerate(main(DEFAULT_RULES, 'war'));
    expect(TOTAL).toBe(9_294_695_280);
    // (23 / 311) x (-30,180 / 95,790) of the bet
    expect(e.sum).toBe(-216_571_680 * 100);
    expect(((-e.sum / 100 / TOTAL) * 100).toFixed(4)).toBe('2.3301');
    // Wizard of Odds' six-deck "liberal rules" table, row by row
    const p = (net: number) => ((e.dist.get(net * 100) ?? 0) / TOTAL).toFixed(6);
    expect([p(2), p(1), p(-1), p(-2)]).toEqual(['0.005471', '0.497265', '0.463023', '0.034242']);
    expect(sd(e).toFixed(6)).toBe('1.057637');
    // the same after a tie of any rank: the tied rank never changes the war's odds
    for (const t of e.warAfterTie) expect(t / 100 / W2).toBeCloseTo(-30_180 / 95_790, 12);
    console.log(`casino war exact: go to war EV ${e.sum / 100} / ${TOTAL} = ${(e.sum / 100 / TOTAL).toFixed(6)} (house edge ${((-e.sum / 100 / TOTAL) * 100).toFixed(4)}%, sd ${sd(e).toFixed(4)})`);
  });

  it('with no bonus on a tie in the war: 2.8771% (Wizard of Odds 2.88%)', () => {
    const e = enumerate(main(STINGY, 'war'));
    expect(e.sum).toBe(-267_420_816 * 100);
    expect(((-e.sum / 100 / TOTAL) * 100).toFixed(4)).toBe('2.8771');
    const p = (net: number) => ((e.dist.get(net * 100) ?? 0) / TOTAL).toFixed(6);
    expect([p(1), p(-1), p(-2)]).toEqual(['0.502735', '0.463023', '0.034242']);
    expect(sd(e).toFixed(2)).toBe('1.05');
  });

  it('always surrendering a tie: 3.6977% (Wizard of Odds 3.70%), so going to war is always better', () => {
    const e = enumerate(main(DEFAULT_RULES, 'surrender'));
    // 23/311 of the time, half the bet
    expect(e.sum * 311 * 2).toBe(-23 * 100 * TOTAL);
    expect(((-e.sum / 100 / TOTAL) * 100).toFixed(4)).toBe('3.6977');
    expect(bestChoice(DEFAULT_RULES)).toBe('war');
    expect(bestChoice(STINGY)).toBe('war');
    console.log(`casino war exact: surrender EV ${(e.sum / 100 / TOTAL).toFixed(6)} (house edge ${((-e.sum / 100 / TOTAL) * 100).toFixed(4)}%, sd ${sd(e).toFixed(4)})`);
  });

  it('the Tie bet at 10 to 1: -58 / 311 = 18.6495% (Wizard of Odds 18.65%), and 11.25% at 11 to 1', () => {
    const tieOnly = (rules: WarRules) => (hand: Hand) => {
      const d = settleDeal({ bet: 100, tie: 100 }, hand.player, hand.dealer, rules);
      return { net: d.tie - 100 };
    };
    const e = enumerate(tieOnly(DEFAULT_RULES));
    expect(e.sum * 311).toBe(-58 * 100 * TOTAL);
    expect(((-e.sum / 100 / TOTAL) * 100).toFixed(4)).toBe('18.6495');
    const p = ((e.dist.get(1_000) ?? 0) / TOTAL).toFixed(6);
    expect(p).toBe('0.073955');
    const e11 = enumerate(tieOnly(rulesOf({ tiePays: 11 })));
    expect(((-e11.sum / 100 / TOTAL) * 100).toFixed(2)).toBe('11.25');
    console.log(`casino war exact: tie bet EV ${(e.sum / 100 / TOTAL).toFixed(6)} (house edge ${((-e.sum / 100 / TOTAL) * 100).toFixed(4)}%, sd ${sd(e).toFixed(4)})`);
  });

  it('exactOdds() gives the same numbers in closed form', () => {
    const o = exactOdds(DEFAULT_RULES);
    expect(o.pTie).toBeCloseTo(23 / 311, 14);
    expect(o.goToWar).toBeCloseTo(-216_571_680 / TOTAL, 14);
    expect(o.surrender).toBeCloseTo(-23 / 622, 14);
    expect(o.tieBet).toBeCloseTo(-58 / 311, 14);
    expect(o.warAfterTie).toBeCloseTo(-30_180 / 95_790, 14);
    expect(exactOdds(STINGY).goToWar).toBeCloseTo(-267_420_816 / TOTAL, 14);
  });
});

// ---------------------------------------------------------------------------------------------

describe('casino war shoe', () => {
  it('shuffles six decks, burns the first card, and puts the cover card a quarter from the bottom', () => {
    const shoe = openShoe(seededRng(1));
    expect(shoe.cards).toHaveLength(312);
    expect(shoe.pos).toBe(1);
    expect(shoe.cutAt).toBe(312 - CUT_FROM_BOTTOM);
    expect(CUT_FROM_BOTTOM).toBe(78);
    const counts = new Map<Card, number>();
    for (const c of shoe.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(52);
    expect([...counts.values()].every((x) => x === 6)).toBe(true);
  });

  it('deals the round, burns three before the war, and flags the cover card as it comes out', () => {
    const shoe = openShoe(stackedRng(cards('2c Ks 9d 4s 4h 4d 5h 3c Jd Qd 6s')));
    const r = dealRound(shoe, 2);
    expect(r).toEqual({ cards: cards('Ks 9d'), dealer: card('4s'), cut: false });
    const w = dealWar(shoe, 2);
    // 4h 4d 5h are burned
    expect(w).toEqual({ cards: cards('3c Jd'), dealer: card('Qd'), cut: false });
    expect(shoe.pos).toBe(10);

    shoe.pos = shoe.cutAt - 1;
    expect(shuffleDue(shoe)).toBe(false);
    expect(dealRound(shoe, 1).cut).toBe(true); // the second card of this round is behind the cover card
    expect(shuffleDue(shoe)).toBe(true);
    shoe.pos = shoe.cutAt;
    expect(shuffleDue(shoe)).toBe(false); // the cover card is the first card: this round is still dealt
    expect(dealRound(shoe, 1).cut).toBe(true);
    expect(shuffleDue(shoe)).toBe(true);
    expect(shuffleDue(null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

describe('casino war engine: solo', () => {
  /** A solo table with a stacked shoe, the bets down and the cards dealt. */
  const dealt = (shoe: string, bets: { bet: number; tie: number }, stack = 100_000): Sim => {
    const sim = solo(stackedRng(cards(shoe)), stack);
    sim.act(0, { type: 'bet', ...bets });
    sim.act(0, { type: 'deal' });
    return sim;
  };

  it('shuffles for the first deal, and pays a higher card even money', () => {
    const sim = dealt('2c Ks 9d', { bet: 1_000, tie: 500 });
    expect(events(sim).map((e) => e.type)).toEqual(['shuffle', 'deal', 'result']);
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.seats[0]).toMatchObject({ card: 'Ks', decision: null, tiePaid: 0, result: { outcome: 'win', bet: 2_000, tie: 0 } });
    expect(v.dealer).toBe('9d');
    expect(v.shoe).toEqual({ no: 1, left: 309, cutOut: false });
    expect(sim.stack(0)).toBe(100_000 + 500);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_500, returned: 2_000 }]);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.deadline(sim.state)).toBeNull();
  });

  it('a lower card loses', () => {
    const sim = dealt('2c 3s Ad', { bet: 1_000, tie: 0 });
    expect(view(sim).seats[0]!.result).toMatchObject({ outcome: 'lose', returned: 0 });
    expect(view(sim).seats[0]!.tiePaid).toBeNull();
    expect(sim.stack(0)).toBe(99_000);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_000, returned: 0 }]);
  });

  it('a tie pays the Tie bet at once and waits for War or Surrender', () => {
    const sim = dealt('2c 8s 8h', { bet: 1_000, tie: 500 });
    expect(events(sim).map((e) => e.type)).toEqual(['shuffle', 'deal', 'tie', 'decide']);
    expect(events(sim)[2]).toEqual({ type: 'tie', seat: 0, tiePaid: 5_500 });
    const v = view(sim);
    expect(v.phase).toBe('deciding');
    expect(v.deadline).toBeNull();
    expect(v.seats[0]).toMatchObject({ decision: 'pending', tiePaid: 5_500, result: null });
    expect(sim.stack(0)).toBe(100_000 - 1_500 + 5_500);
    expect(engine.liveBets(sim.state, 0)).toBe(1_000);
    expect(sim.rounds).toEqual([]);
    expect(sim.act(0, { type: 'bet', bet: 2_000, tie: 0 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('going to war raises by the bet, burns three and settles on one more card each', () => {
    // burn 2c; deal 8s to the player, 8h to the dealer; burn 4s 4h 4d; war Qd against 5c
    const sim = dealt('2c 8s 8h 4s 4h 4d Qd 5c', { bet: 1_000, tie: 500 });
    sim.act(0, { type: 'war' });
    expect(events(sim).map((e) => e.type)).toEqual(['decision', 'war', 'result']);
    expect(events(sim)[0]).toEqual({ type: 'decision', seat: 0, choice: 'war', raise: 1_000 });
    expect(events(sim)[1]).toEqual({ type: 'war', seats: [0], cards: ['Qd'], dealer: '5c' });
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.dealerWar).toBe('5c');
    expect(v.seats[0]).toMatchObject({ raise: 1_000, warCard: 'Qd', decision: 'war', result: { outcome: 'war-win', bet: 1_000, war: 2_000, tie: 5_500 } });
    // the bet pushes, the raise wins even money, the Tie bet won 10 to 1
    expect(sim.stack(0)).toBe(100_000 + 1_000 + 5_000);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 2_500, returned: 8_500 }]);
    // the burned cards never reach anyone
    expect(JSON.stringify([view(sim), view(sim, null), events(sim)])).not.toMatch(/"(4[shd]|2c)"/);
  });

  it('a tie in the war pays the raise 2 to 1', () => {
    const sim = dealt('2c As Ad 4s 4h 4d 9c 9h', { bet: 1_000, tie: 0 });
    sim.act(0, { type: 'war' });
    expect(view(sim).seats[0]!.result).toMatchObject({ outcome: 'war-tie', bet: 1_000, war: 3_000, returned: 4_000 });
    expect(sim.stack(0)).toBe(100_000 + 2_000);
  });

  it('losing the war loses the bet and the raise', () => {
    const sim = dealt('2c 5s 5d 4s 4h 4d 7c 8h', { bet: 1_000, tie: 0 });
    sim.act(0, { type: 'war' });
    expect(view(sim).seats[0]!.result).toMatchObject({ outcome: 'war-lose', returned: 0 });
    expect(sim.stack(0)).toBe(100_000 - 2_000);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 2_000, returned: 0 }]);
  });

  it('surrendering gives back half the bet without burning or dealing a war', () => {
    const sim = dealt('2c Js Jd', { bet: 1_500, tie: 100 });
    const before = (sim.state.shoe ?? { pos: -1 }).pos;
    sim.act(0, { type: 'surrender' });
    expect(events(sim).map((e) => e.type)).toEqual(['decision', 'result']);
    expect(view(sim).seats[0]!.result).toMatchObject({ outcome: 'surrender', bet: 750, tie: 1_100, returned: 1_850 });
    expect(view(sim).dealerWar).toBeNull();
    expect(sim.state.shoe!.pos).toBe(before);
    expect(sim.stack(0)).toBe(100_000 - 1_600 + 1_100 + 750);
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1_600, returned: 1_850 }]);
    expect(sim.act(0, { type: 'war' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('bets are totals: raise, lower and clear move only the difference', () => {
    const sim = solo(seededRng(3));
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(0, { type: 'bet', bet: 2_500, tie: 500 });
    expect(sim.stack(0)).toBe(100_000 - 3_000);
    expect(engine.liveBets(sim.state, 0)).toBe(3_000);
    sim.act(0, { type: 'bet', bet: 1_000, tie: 500 });
    expect(sim.stack(0)).toBe(100_000 - 1_500);
    sim.act(0, { type: 'bet', bet: 0, tie: 0 });
    expect(sim.stack(0)).toBe(100_000);
    expect(view(sim).seats).toEqual({});
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
  });

  it('refuses bets off the limits, over the stack, a Tie bet alone, or without the raise in reserve', () => {
    const sim = solo(seededRng(4), 3_000);
    const bet = (b: number, t: number) => sim.act(0, { type: 'bet', bet: b, tie: t }, { allowRefusal: true }).refused;
    expect(bet(900, 0)).toBe('LIMIT'); // $10 minimum
    expect(bet(100_100, 0)).toBe('LIMIT'); // $1,000 maximum
    expect(bet(1_050, 0)).toBe('LIMIT'); // whole dollars
    expect(bet(0, 500)).toBe('LIMIT'); // the Tie bet goes with a bet
    expect(bet(1_000, 10_100)).toBe('LIMIT'); // Tie bet $100 maximum
    expect(bet(1_000, 150)).toBe('LIMIT'); // whole dollars
    expect(bet(2_000, 0)).toBe('NOT_ENOUGH_CHIPS'); // $20 needs $20 more for a war
    expect(bet(1_500, 0)).toBeUndefined(); // $15 + $15 in reserve = $30
    expect(bet(1_500, 100)).toBe('NOT_ENOUGH_CHIPS');
    expect(bet(1_000, 1_000)).toBeUndefined(); // $10 + $10 Tie + $10 reserve
    expect(sim.stack(0)).toBe(1_000);
    expect(engine.parseAction({ type: 'bet', bet: -5, tie: 0 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', bet: 1.5, tie: 0 })).toBeNull();
    expect(engine.parseAction({ type: 'bet', bet: 1_000 })).toEqual({ type: 'bet', bet: 1_000, tie: 0 });
    expect(engine.parseAction({ type: 'war', extra: 1 })).toEqual({ type: 'war' });
    expect(engine.parseAction({ type: 'raise' })).toBeNull();
    expect(engine.parseAction('war')).toBeNull();
  });

  it('refuses a war without the chips for the raise', () => {
    const sim = dealt('2c 8s 8h', { bet: 1_000, tie: 0 }, 2_000);
    sim.seats.get(0)!.stack = 500; // as if the stack had been spent elsewhere
    expect(sim.act(0, { type: 'war' }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    sim.act(0, { type: 'surrender' });
    expect(view(sim).seats[0]!.result?.outcome).toBe('surrender');
  });

  it('the next bet opens a fresh round and clears the layout', () => {
    const sim = dealt('2c Ks 9d', { bet: 1_000, tie: 0 });
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    const v = view(sim);
    expect(v).toMatchObject({ phase: 'betting', round: 2, dealer: null, dealerWar: null });
    expect(v.seats[0]).toEqual({ bet: 1_000, tie: 0, raise: 0, card: null, warCard: null, decision: null, tiePaid: null, result: null });
  });

  it('a player leaving before the deal gets the bets back; one leaving a tie goes to war as a timeout would', () => {
    const early = solo(seededRng(5));
    early.act(0, { type: 'bet', bet: 1_000, tie: 500 });
    early.apply(engine.seatLeaving(early.state, 0, early.ctx()));
    expect(early.stack(0)).toBe(100_000);
    expect(engine.liveBets(early.state, 0)).toBe(0);

    const sim = dealt('2c 8s 8h 4s 4h 4d 3d Kc', { bet: 1_000, tie: 0 });
    expect(engine.liveBets(sim.state, 0)).toBe(1_000);
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(events(sim)[0]).toEqual({ type: 'decision', seat: 0, choice: 'war', raise: 1_000, auto: true });
    expect(view(sim).seats[0]!.result?.outcome).toBe('war-lose');
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(sim.stack(0)).toBe(98_000);
  });

  it('shuffles exactly when the cover card is out, and flags the round that reaches it', () => {
    const sim = solo(seededRng(7), 1_000_000_000);
    let shuffles = 0;
    for (let round = 0; round < 400; round++) {
      const due = round === 0 || view(sim).shoe.cutOut;
      sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
      sim.act(0, { type: 'deal' });
      const evs = [...events(sim)];
      if (view(sim).phase === 'deciding') {
        sim.act(0, { type: 'war' });
        evs.push(...events(sim));
      }
      expect(evs.some((e) => e.type === 'shuffle')).toBe(due);
      if (due) shuffles++;
      // a new shoe can't reach its cover card in one round, so after a round the flag is this round's
      expect(evs.some((e) => e.type === 'cut')).toBe(view(sim).shoe.cutOut);
      // one seat's round deals at most 7 cards, all of them behind the cover card at worst
      expect(view(sim).shoe.left).toBeGreaterThanOrEqual(CUT_FROM_BOTTOM - 7);
    }
    expect(shuffles).toBeGreaterThanOrEqual(3);
    expect(view(sim).shoe.no).toBe(shuffles);
  });
});

// ---------------------------------------------------------------------------------------------

describe('casino war engine: multiplayer', () => {
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

  it('opens a timed window, closes it early once everyone is ready, and deals every bettor and the dealer', () => {
    // seat 0 Ks wins, seat 1 3d loses, seat 2 9c ties the dealer's 9h
    const sim = table(stackedRng(cards('2c Ks 3d 9c 9h')));
    expect(view(sim, null)).toMatchObject({ phase: 'betting', deadline: sim.now + BETTING_MS });
    sim.act(0, { type: 'bet', bet: 1_000, tie: 100 });
    sim.act(1, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(2, { type: 'bet', bet: 2_000, tie: 500 });
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    ready(sim, 0);
    ready(sim, 1);
    expect(view(sim, null).phase).toBe('betting');
    ready(sim, 2);
    expect(events(sim).map((e) => e.type)).toEqual(['shuffle', 'deal', 'result', 'result', 'tie', 'decide']);
    expect(events(sim).find((e) => e.type === 'deal')).toEqual({ type: 'deal', seats: [0, 1, 2], cards: ['Ks', '3d', '9c'], dealer: '9h' });
    expect(events(sim).find((e) => e.type === 'decide')).toEqual({ type: 'decide', seats: [2], deadline: sim.now + DECISION_MS });
    const v = view(sim, 1);
    expect(v.phase).toBe('deciding');
    expect(v.seats[0]!.result).toMatchObject({ outcome: 'win', returned: 2_000, tie: 0 });
    expect(v.seats[1]!.result).toMatchObject({ outcome: 'lose' });
    expect(v.seats[2]).toMatchObject({ decision: 'pending', tiePaid: 5_500 });
    // every card is dealt face up, so every view shows every card
    expect(view(sim, null).seats).toEqual(view(sim, 0).seats);
    expect(sim.stack(0)).toBe(100_000 - 1_100 + 2_000);
    expect(sim.stack(1)).toBe(99_000);
    expect(sim.stack(2)).toBe(100_000 - 2_500 + 5_500);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.liveBets(sim.state, 2)).toBe(2_000);
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 1_100, returned: 2_000 },
      { seat: 1, wagered: 1_000, returned: 0 },
    ]);
  });

  it('decides ties at once, goes to war for a timeout, and deals the war with one dealer card for everyone', () => {
    // seats 0, 1 and 2 all tie with 7s; burn 4s 4h 4d; war cards Kd (seat 0) 2s (seat 1) Jc (seat 2); dealer's war card Jh
    const sim = table(stackedRng(cards('2c 7s 7h 7d 7c 4s 4h 4d Kd 2s Jc Jh')));
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(1, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(2, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(BETTING_MS);
    expect(view(sim, null).phase).toBe('deciding');
    sim.act(0, { type: 'war' });
    sim.act(1, { type: 'war' });
    expect(view(sim, null).phase).toBe('deciding');
    expect(engine.liveBets(sim.state, 0)).toBe(2_000);
    expect(sim.act(0, { type: 'surrender' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.advance(DECISION_MS);
    expect(events(sim).map((e) => e.type)).toEqual(['decision', 'war', 'result', 'result', 'result']);
    expect(events(sim)[0]).toEqual({ type: 'decision', seat: 2, choice: 'war', raise: 1_000, auto: true });
    expect(events(sim)[1]).toEqual({ type: 'war', seats: [0, 1, 2], cards: ['Kd', '2s', 'Jc'], dealer: 'Jh' });
    const v = view(sim, null);
    expect(v.phase).toBe('results');
    expect(v.deadline).toBe(sim.now + RESULTS_MS);
    expect(v.seats[0]!.result?.outcome).toBe('war-win');
    expect(v.seats[1]!.result?.outcome).toBe('war-lose');
    expect(v.seats[2]!.result?.outcome).toBe('war-tie');
    expect([sim.stack(0), sim.stack(1), sim.stack(2)]).toEqual([101_000, 98_000, 102_000]);
    // the results stay up, then the next window opens
    sim.advance(RESULTS_MS);
    expect(view(sim, null)).toMatchObject({ phase: 'betting', round: 2, seats: {}, dealer: null, dealerWar: null });
  });

  it('settles a surrender at once and deals the war as soon as the last tie is decided', () => {
    const sim = table(stackedRng(cards('2c 7s 7h 7d 4s 4h 4d Ad 3h')), [0, 1]);
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(1, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(BETTING_MS);
    sim.act(1, { type: 'surrender' });
    expect(view(sim, null).seats[1]!.result).toMatchObject({ outcome: 'surrender', returned: 500 });
    expect(engine.liveBets(sim.state, 1)).toBe(0);
    expect(view(sim, null).phase).toBe('deciding');
    sim.act(0, { type: 'war' });
    expect(events(sim).find((e) => e.type === 'war')).toEqual({ type: 'war', seats: [0], cards: ['Ad'], dealer: '3h' });
    expect(view(sim, null).phase).toBe('results');
    expect(sim.stack(0)).toBe(101_000);
    expect(sim.stack(1)).toBe(99_500);
  });

  it('burns nothing when every tie surrenders', () => {
    const sim = table(stackedRng(cards('2c 7s 7h')), [0]);
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(BETTING_MS);
    const pos = sim.state.shoe!.pos;
    sim.act(0, { type: 'surrender' });
    expect(sim.state.shoe!.pos).toBe(pos);
    expect(view(sim, null)).toMatchObject({ phase: 'results', dealerWar: null });
  });

  it('a timeout surrenders a tie that can no longer cover the raise', () => {
    const sim = table(stackedRng(cards('2c 7s 7h')), [0]);
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(BETTING_MS);
    sim.seats.get(0)!.stack = 400;
    sim.advance(DECISION_MS);
    expect(events(sim)[0]).toEqual({ type: 'decision', seat: 0, choice: 'surrender', raise: 0, auto: true });
    expect(sim.stack(0)).toBe(900);
  });

  it('ignores a ready flag left over from the last round', () => {
    const sim = table(seededRng(12), [0, 1]);
    ready(sim, 0);
    ready(sim, 1);
    expect(view(sim, null).phase).toBe('betting'); // everyone ready, but nobody has bet
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(1, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(0);
    expect(view(sim, null).phase).not.toBe('betting');
    sim.advance(DECISION_MS);
    sim.advance(RESULTS_MS);
    // the next window opens with both still flagged ready from the last one
    expect(view(sim, null)).toMatchObject({ phase: 'betting', round: 2 });
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(0);
    expect(view(sim, null).phase).toBe('betting'); // seat 1's flag is stale
    ready(sim, 1, false);
    expect(view(sim, null).phase).toBe('betting');
    ready(sim, 1, true);
    expect(view(sim, null).phase).not.toBe('betting');
  });

  it("doesn't wait for a disconnected player, and hands a dropped bettor's chips back instead of dealing them", () => {
    const sim = table(seededRng(13), [0, 1]);
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(1, { type: 'bet', bet: 1_000, tie: 500 });
    sim.seats.get(1)!.connected = false;
    ready(sim, 0);
    const v = view(sim, null);
    expect(v.phase).not.toBe('betting');
    expect(Object.keys(v.seats)).toEqual(['0']);
    expect(sim.stack(1)).toBe(100_000);
  });

  it('a player leaving a pending tie goes to war and the war waits for the others', () => {
    const sim = table(stackedRng(cards('2c 7s 7h 7d 4s 4h 4d Ad 3h')), [0, 1]);
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(1, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(BETTING_MS);
    sim.apply(engine.seatLeaving(sim.state, 1, sim.ctx()));
    expect(view(sim, null).seats[1]!.decision).toBe('war');
    expect(engine.liveBets(sim.state, 1)).toBe(2_000);
    expect(view(sim, null).phase).toBe('deciding');
    sim.act(0, { type: 'surrender' });
    expect(view(sim, null).seats[1]!.result?.outcome).toBe('war-win');
    expect(engine.liveBets(sim.state, 1)).toBe(0);
    // leaving after the round has settled changes nothing
    const step = engine.seatLeaving(sim.state, 1, sim.ctx());
    expect(step.state).toBe(sim.state);
  });

  it('refuses bets outside the window', () => {
    const sim = table(stackedRng(cards('2c Ks 3d 3h')), [0, 1]);
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(1, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(BETTING_MS);
    expect(view(sim, null).phase).toBe('deciding');
    expect(sim.act(0, { type: 'bet', bet: 2_000, tie: 0 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(1, { type: 'bet', bet: 2_000, tie: 0 }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    expect(sim.act(0, { type: 'war' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE'); // seat 0 won; nothing to decide
  });

  it('rolls an empty window over, and goes idle (dropping the shoe) when everyone has left', () => {
    const sim = table(seededRng(14), [0]);
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(BETTING_MS);
    sim.advance(DECISION_MS);
    sim.advance(RESULTS_MS);
    expect(view(sim, null)).toMatchObject({ phase: 'betting', round: 2 });
    sim.advance(BETTING_MS);
    expect(view(sim, null)).toMatchObject({ phase: 'betting', round: 3 });
    expect(sim.state.shoe).not.toBeNull();
    sim.seats.clear();
    sim.advance(BETTING_MS);
    expect(view(sim, null).phase).toBe('idle');
    expect(sim.state.shoe).toBeNull();
    expect(engine.deadline(sim.state)).toBeNull();
  });

  it('shifts its deadline', () => {
    const sim = table(seededRng(16), [0]);
    const d = engine.deadline(sim.state)!;
    expect(engine.deadline(engine.shiftDeadlines(sim.state, 20_000))).toBe(d + 20_000);
    const idle = engine.create(engine.config('', 'multi'), sim.ctx());
    expect(engine.shiftDeadlines(idle, 5_000)).toBe(idle);
  });

  it('never shows the shoe or a burned card: every card anyone sees was dealt', () => {
    const sim = table(seededRng(17), [0, 1, 2]);
    const seen: string[] = [];
    for (let round = 0; round < 40; round++) {
      for (const seat of [0, 1, 2]) sim.act(seat, { type: 'bet', bet: 1_000, tie: 100 });
      sim.advance(BETTING_MS);
      const shown = [JSON.stringify([view(sim, 0), view(sim, null), sim.lastEvents])];
      if (view(sim, null).phase === 'deciding') {
        sim.advance(DECISION_MS);
        shown.push(JSON.stringify([view(sim, 1), sim.lastEvents]));
      }
      const v = view(sim, null);
      const dealt = new Set<string>([v.dealer!, ...(v.dealerWar ? [v.dealerWar] : [])]);
      for (const sv of Object.values(v.seats)) for (const c of [sv.card, sv.warCard]) if (c) dealt.add(c);
      for (const text of shown) for (const m of text.match(/"[2-9TJQKA][shdc]"/g) ?? []) expect(dealt.has(m.slice(1, 3))).toBe(true);
      seen.push(...dealt);
      sim.advance(RESULTS_MS);
    }
    expect(seen.length).toBeGreaterThan(160);
    expect(JSON.stringify(view(sim, null))).not.toContain('cutAt');
    expect(Object.keys(view(sim, null).shoe).sort()).toEqual(['cutOut', 'left', 'no']);
  });
});
