// Three Card Poker with several hands: a solo player playing two or three hands from one stack,
// each with its own Ante and Pair Plus and its own Play or Fold, all from the round's one deck.

import { describe, it, expect } from 'vitest';
import { engine, spotsOf, MAX_SPOTS, BETTING_MS, type ThreeCardState } from '../src/games/threecard/engine.ts';
import { dealHands, score, settle, shouldPlay, DEFAULT_PAYTABLE } from '../src/games/threecard/rules.ts';
import type { ThreeCardView, ThreeCardEvent } from '../src/games/threecard/protocol.ts';
import type { Card } from '../src/cards.ts';
import { randInt, type Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { cards, stackedDeck } from './helpers/stacked.ts';

type Sim = TableSim<ThreeCardState, unknown, ThreeCardView>;
const START = 100_000;
const solo = (rng: Rng, stack = START): Sim => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]) as Sim;
const view = (sim: Sim, seat: number | null = 0) => sim.view(seat) as ThreeCardView;
const events = (sim: Sim) => sim.lastEvents as ThreeCardEvent[];
const refused = (sim: Sim, action: unknown, seat = 0) => sim.act(seat, action, { allowRefusal: true }).refused;

/** Deal these hands (spot 0 first) against `dealer` with these bets. */
function dealt(hands: string[], dealer: string, bets: { ante: number; pairPlus: number }[], stack = START): Sim {
  const sim = solo(stackedDeck([...hands.flatMap(cards), ...cards(dealer)]), stack);
  sim.act(0, { type: 'spots', n: hands.length });
  bets.forEach((b, spot) => sim.act(0, { type: 'bet', ...b, spot }));
  sim.act(0, { type: 'deal' });
  return sim;
}

describe('three card poker hands: the deal and the decisions', () => {
  it('three hands from one deck: each is dealt three cards, shown only to its player, and decided on its own', () => {
    const sim = dealt(['Ks Kd 4c', '2s 7d 9h', 'Qh Jd 10c'], 'Qs 8d 3c', [
      { ante: 2_500, pairPlus: 500 },
      { ante: 1_000, pairPlus: 0 },
      { ante: 1_000, pairPlus: 1_000 },
    ]);
    expect(sim.stack(0)).toBe(START - 6_000);
    const hands = events(sim).filter((e) => e.type === 'hand');
    expect(hands).toEqual([
      { type: 'hand', to: 0, seat: 0, cards: cards('Ks Kd 4c') },
      { type: 'hand', to: 0, seat: 1, cards: cards('2s 7d 9h') },
      { type: 'hand', to: 0, seat: 2, cards: cards('Qh Jd 10c') },
    ]);
    const v = view(sim);
    expect(v.phase).toBe('deciding');
    expect(v.mine).toEqual([0, 1, 2]);
    expect(Object.keys(v.seats)).toEqual(['0', '1', '2']);
    expect(v.dealer).toEqual([null, null, null]);

    sim.act(0, { type: 'play', spot: 0 });
    expect(view(sim).phase).toBe('deciding');
    expect(refused(sim, { type: 'fold', spot: 0 })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'fold', spot: 1 });
    // The fold settles at once: the Ante goes.
    expect(view(sim).seats[1]!.result).toMatchObject({ outcome: 'fold', returned: 0 });
    expect(view(sim).dealer).toEqual([null, null, null]);
    sim.act(0, { type: 'play', spot: 2 });
    const after = view(sim);
    expect(after.phase).toBe('results');
    expect(after.dealer).toEqual(cards('Qs 8d 3c'));
    // Kings beat queen high: Ante and Play 1 to 1, the pair 1 to 1 on Pair Plus.
    expect(after.seats[0]!.result).toMatchObject({ outcome: 'win', ante: 5_000, play: 5_000, bonus: 0, pairPlus: 1_000, returned: 11_000 });
    // The straight: Ante and Play win, the Ante Bonus 1 to 1, Pair Plus 6 to 1.
    expect(after.seats[2]!.result).toMatchObject({ outcome: 'win', ante: 2_000, play: 2_000, bonus: 1_000, pairPlus: 7_000, returned: 12_000 });
    expect(sim.stack(0)).toBe(START - 6_000 - 2_500 - 1_000 + 11_000 + 12_000);
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 1_000, returned: 0, spot: 1 },
      { seat: 0, wagered: 5_500, returned: 11_000 },
      { seat: 0, wagered: 3_000, returned: 12_000, spot: 2 },
    ]);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('a decision without a spot goes to the first hand still waiting', () => {
    const sim = dealt(['Ks Kd 4c', '2s 7d 9h'], 'Qs 8d 3c', [{ ante: 1_000, pairPlus: 0 }, { ante: 1_000, pairPlus: 0 }]);
    sim.act(0, { type: 'fold' });
    expect(view(sim).seats[0]!.decision).toBe('fold');
    sim.act(0, { type: 'play' });
    expect(view(sim).seats[1]!.decision).toBe('play');
    expect(view(sim).phase).toBe('results');
  });

  it('a Pair Plus hand without an Ante has nothing to decide; the others still do', () => {
    const sim = dealt(['Ks Kd 4c', '2s 7d 9h'], 'Qs 8d 3c', [{ ante: 0, pairPlus: 500 }, { ante: 1_000, pairPlus: 0 }]);
    expect(view(sim).seats[0]!.decision).toBe('none');
    expect(refused(sim, { type: 'play', spot: 0 })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'fold', spot: 1 });
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.seats[0]!.result).toMatchObject({ outcome: null, pairPlus: 1_000 });
    expect(sim.stack(0)).toBe(START - 1_500 + 1_000);
  });
});

describe('three card poker hands: bets, refusals and leaving', () => {
  it('every Ante keeps its Play bet covered: the stack has to hold them all', () => {
    const sim = solo(seededRng(1), 10_000);
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', ante: 3_000, pairPlus: 0, spot: 0 });
    // $70 left; another $30 Ante would leave $40 against $60 of Play bets.
    expect(refused(sim, { type: 'bet', ante: 3_000, pairPlus: 0, spot: 1 })).toBe('NOT_ENOUGH_CHIPS');
    sim.act(0, { type: 'bet', ante: 2_000, pairPlus: 0, spot: 1 });
    // $50 left holds exactly the two Play bets: even a $5 Pair Plus would eat into them.
    expect(refused(sim, { type: 'bet', ante: 0, pairPlus: 500, spot: 2 })).toBe('NOT_ENOUGH_CHIPS');
    expect(refused(sim, { type: 'bet', ante: 1_000, pairPlus: 0, spot: 3 })).toBe('BAD_REQUEST');
  });

  it('fewer hands gives back the bets on the spots let go; more hands are refused while cards are out', () => {
    const sim = solo(seededRng(2));
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0, spot: 0 });
    sim.act(0, { type: 'bet', ante: 2_000, pairPlus: 500, spot: 2 });
    sim.act(0, { type: 'spots', n: 1 });
    expect(events(sim)).toEqual([{ type: 'bets', seat: 2, ante: 0, pairPlus: 0 }, { type: 'spots', seat: 0, n: 1 }]);
    expect(sim.stack(0)).toBe(START - 1_000);
    expect(view(sim).mine).toEqual([0]);
    sim.act(0, { type: 'spots', n: 2 });
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0, spot: 1 });
    sim.act(0, { type: 'deal' });
    expect(view(sim).phase).toBe('deciding');
    expect(refused(sim, { type: 'spots', n: 3 })).toBe('WRONG_PHASE');
  });

  it('leaving with hands still to decide folds them; a hand already played is settled with the dealer', () => {
    const sim = dealt(['Ks Kd 4c', '2s 7d 9h', 'Qh Jd 10c'], 'Qs 8d 3c', [
      { ante: 1_000, pairPlus: 0 },
      { ante: 1_000, pairPlus: 0 },
      { ante: 1_000, pairPlus: 0 },
    ]);
    sim.act(0, { type: 'play', spot: 0 });
    expect(engine.liveBets(sim.state, 0)).toBe(4_000);
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect([v.seats[0]!.result?.outcome, v.seats[1]!.result?.outcome, v.seats[2]!.result?.outcome]).toEqual(['win', 'fold', 'fold']);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(sim.stack(0)).toBe(START - 4_000 + 4_000);
  });

  it('leaving before the deal brings back every hand\'s bets', () => {
    const sim = solo(seededRng(3));
    sim.act(0, { type: 'spots', n: 2 });
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 500, spot: 0 });
    sim.act(0, { type: 'bet', ante: 2_000, pairPlus: 0, spot: 1 });
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(step.chips).toEqual([{ seat: 0, payout: 3_500 }]);
    sim.apply(step);
    expect(sim.stack(0)).toBe(START);
  });

  it('parses a spot on bets and decisions and the number of hands, and nothing out of range', () => {
    const ok = [{ type: 'bet', ante: 1_000, pairPlus: 0, spot: 2 }, { type: 'play', spot: 1 }, { type: 'fold' }, { type: 'spots', n: MAX_SPOTS }];
    for (const a of ok) expect(engine.parseAction(a), JSON.stringify(a)).toEqual(a);
    const bad = [{ type: 'spots', n: 0 }, { type: 'spots', n: MAX_SPOTS + 1 }, { type: 'play', spot: 6 }, { type: 'bet', ante: 1_000, pairPlus: 0, spot: -1 }, { type: 'fold', spot: 'a' }];
    for (const a of bad) expect(engine.parseAction(a), JSON.stringify(a)).toBeNull();
  });

  it('a shared table is untouched: one hand per seat, each sees only its own cards', () => {
    const sim = new TableSim(engine, stackedDeck(cards('Ks Kd 4c 2s 7d 9h Qs 8d 3c')), 'multi', [{ seat: 0, stack: START }, { seat: 1, stack: START }]) as Sim;
    sim.started = true;
    sim.advance(0);
    expect(refused(sim, { type: 'spots', n: 2 })).toBe('WRONG_PHASE');
    expect(refused(sim, { type: 'bet', ante: 1_000, pairPlus: 0, spot: 1 })).toBe('BAD_REQUEST');
    sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.act(1, { type: 'bet', ante: 1_000, pairPlus: 0 });
    sim.advance(BETTING_MS);
    expect(view(sim, 0).mine).toEqual([0]);
    expect(view(sim, 0).seats[1]!.cards).toEqual([null, null, null]);
    expect(events(sim).filter((e) => e.type === 'hand').map((e) => (e.type === 'hand' ? e.to : -1))).toEqual([0, 1]);
    expect(refused(sim, { type: 'play', spot: 1 })).toBe('NOT_YOUR_TURN');
  });
});

describe('three card poker hands: money and odds', () => {
  it('random bets and decisions on one to three hands: every chip is accounted for', () => {
    const sim = solo(seededRng(41), 1e12);
    const rng = seededRng(42);
    for (let i = 0; i < 3000; i++) {
      sim.act(0, { type: 'spots', n: 1 + randInt(rng, MAX_SPOTS) });
      for (const spot of spotsOf(sim.state, 0)) {
        const ante = randInt(rng, 4) === 0 ? 0 : 1_000 + 100 * randInt(rng, 90);
        const pairPlus = ante === 0 || randInt(rng, 2) === 0 ? 500 + 100 * randInt(rng, 45) : 0;
        sim.act(0, { type: 'bet', ante, pairPlus, spot });
      }
      sim.act(0, { type: 'deal' });
      for (let v = view(sim); v.phase === 'deciding'; v = view(sim)) {
        const spot = v.mine.find((s) => v.seats[s]?.decision === 'pending')!;
        sim.act(0, { type: randInt(rng, 3) === 0 ? 'fold' : 'play', spot });
      }
      expect(view(sim).phase).toBe('results');
      expect(engine.liveBets(sim.state, 0)).toBe(0);
    }
    const net = sim.rounds.reduce((a, r) => a + r.returned - r.wagered, 0);
    expect(sim.stack(0)).toBe(1e12 + net);
    expect(sim.rounds.length).toBeGreaterThan(5000);
  });

  it('the table and the Monte Carlo loop deal and settle the same three hands', () => {
    const sim = solo(seededRng(77), 1e12);
    const rng = seededRng(77);
    sim.act(0, { type: 'spots', n: 3 });
    for (let i = 0; i < 2000; i++) {
      for (const spot of [0, 1, 2]) sim.act(0, { type: 'bet', ante: 1_000, pairPlus: 1_000, spot });
      sim.act(0, { type: 'deal' });
      for (const spot of [0, 1, 2]) sim.act(0, { type: shouldPlay(score(view(sim).seats[spot]!.cards as Card[])) ? 'play' : 'fold', spot });
      const { hands, dealer } = dealHands(rng, 3);
      const v = view(sim);
      expect(v.dealer).toEqual(dealer);
      hands.forEach((h, spot) => {
        expect(v.seats[spot]!.cards).toEqual(h);
        const play = shouldPlay(score(h)) ? 1_000 : 0;
        expect(v.seats[spot]!.result).toEqual(settle({ ante: 1_000, play, pairPlus: 1_000 }, score(h), score(dealer), DEFAULT_PAYTABLE));
      });
    }
  });
});
