// Casino War with several spots: a solo player playing two or three spots from one stack, each
// with its own bet, Tie bet and War or Surrender, dealt like a full table from the one shoe.

import { describe, it, expect } from 'vitest';
import { engine, spotsOf, MAX_SPOTS, BETTING_MS, type WarState } from '../src/games/war/engine.ts';
import { DECKS, DEFAULT_RULES, bestChoice, dealRound, dealWar, openShoe, settle, settleDeal, shuffleDue } from '../src/games/war/rules.ts';
import type { WarView, WarEvent } from '../src/games/war/protocol.ts';
import type { Shoe } from '../src/cards.ts';
import { randInt, type Rng } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { cards, stackedShoe } from './helpers/stacked.ts';

type Sim = TableSim<WarState, unknown, WarView>;
const START = 100_000;
const solo = (rng: Rng, stack = START): Sim => new TableSim(engine, rng, 'solo', [{ seat: 0, stack }]) as Sim;
const view = (sim: Sim, seat: number | null = 0) => sim.view(seat) as WarView;
const events = (sim: Sim) => sim.lastEvents as WarEvent[];
const refused = (sim: Sim, action: unknown, seat = 0) => sim.act(seat, action, { allowRefusal: true }).refused;

/** Play these bets (spot 0 first) from a shoe that deals `top` (the burn card first). */
function dealt(top: string, bets: { bet: number; tie: number }[], stack = START): Sim {
  const sim = solo(stackedShoe(cards(top), DECKS), stack);
  sim.act(0, { type: 'spots', n: bets.length });
  bets.forEach((b, spot) => sim.act(0, { type: 'bet', ...b, spot }));
  sim.act(0, { type: 'deal' });
  return sim;
}

describe('casino war spots: the deal, the ties and the war', () => {
  it('one card to each spot and one to the dealer; each tie is decided on its own; one war deal settles the rest', () => {
    // Burn 9c. Spot 0: King. Spot 1: 8. Spot 2: 8. Dealer: 8. War: burn three, spot 1's Queen, the dealer's 5.
    const sim = dealt('9c Ks 8s 8h 8d 2c 3c 4c Qd 5c', [
      { bet: 1_000, tie: 0 },
      { bet: 2_000, tie: 500 },
      { bet: 1_000, tie: 100 },
    ]);
    const deal = events(sim).find((e) => e.type === 'deal');
    expect(deal).toEqual({ type: 'deal', seats: [0, 1, 2], cards: cards('Ks 8s 8h'), dealer: '8d' });
    let v = view(sim);
    expect(v.phase).toBe('deciding');
    expect(v.mine).toEqual([0, 1, 2]);
    expect(v.seats[0]!.result).toMatchObject({ outcome: 'win', returned: 2_000 });
    expect(v.seats[1]!.decision).toBe('pending');
    expect(v.seats[2]!.decision).toBe('pending');
    // Both Tie bets were paid at the deal.
    expect(sim.stack(0)).toBe(START - 4_600 + 2_000 + 5_500 + 1_100);

    sim.act(0, { type: 'surrender', spot: 2 });
    expect(view(sim).seats[2]!.result).toMatchObject({ outcome: 'surrender', bet: 500, returned: 1_600 });
    expect(view(sim).phase).toBe('deciding');
    sim.act(0, { type: 'war', spot: 1 });
    const war = events(sim).find((e) => e.type === 'war');
    expect(war).toEqual({ type: 'war', seats: [1], cards: cards('Qd'), dealer: '5c' });
    v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.seats[1]!.result).toMatchObject({ outcome: 'war-win', bet: 2_000, war: 4_000, tie: 5_500, wagered: 4_500, returned: 11_500 });
    expect(sim.stack(0)).toBe(START + 8_500);
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 1_000, returned: 2_000 },
      { seat: 0, wagered: 1_100, returned: 1_600, spot: 2 },
      { seat: 0, wagered: 4_500, returned: 11_500, spot: 1 },
    ]);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('two spots at war share one war deal and the dealer\'s one war card, as at a full table', () => {
    // Spots 1 and 2 tie the dealer's 7; the war: burn three, Jack and 4 to the spots, 9 to the dealer.
    const sim = dealt('2d 3s 7s 7h 7d 2c 3c 4c Jd 4d 9c', [
      { bet: 1_000, tie: 0 },
      { bet: 1_000, tie: 0 },
      { bet: 1_000, tie: 0 },
    ]);
    sim.act(0, { type: 'war', spot: 2 });
    expect(events(sim).some((e) => e.type === 'war')).toBe(false);
    sim.act(0, { type: 'war', spot: 1 });
    expect(events(sim).find((e) => e.type === 'war')).toEqual({ type: 'war', seats: [1, 2], cards: cards('Jd 4d'), dealer: '9c' });
    const v = view(sim);
    expect(v.seats[1]!.result?.outcome).toBe('war-win');
    expect(v.seats[2]!.result?.outcome).toBe('war-lose');
    // Spot 0 lost its 3 against the 7; spot 1 wins its raise; spot 2 loses bet and raise.
    expect(sim.stack(0)).toBe(START - 1_000 + 1_000 - 2_000);
  });

  it('a decision without a spot goes to the first tie still waiting', () => {
    const sim = dealt('2d 7s 7h 7d 2c 3c 4c Jd 9c', [{ bet: 1_000, tie: 0 }, { bet: 1_000, tie: 0 }]);
    sim.act(0, { type: 'surrender' });
    expect(view(sim).seats[0]!.decision).toBe('surrender');
    expect(refused(sim, { type: 'war', spot: 0 })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'war' });
    expect(view(sim).seats[1]!.result?.outcome).toBe('war-win');
  });
});

describe('casino war spots: bets, refusals and leaving', () => {
  it('every bet keeps its war raise covered: the stack has to hold them all', () => {
    const sim = solo(seededRng(1), 10_000);
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', bet: 3_000, tie: 0, spot: 0 });
    // $70 left; a second $30 bet would leave $40 against $60 of raises.
    expect(refused(sim, { type: 'bet', bet: 3_000, tie: 0, spot: 1 })).toBe('NOT_ENOUGH_CHIPS');
    sim.act(0, { type: 'bet', bet: 2_000, tie: 0, spot: 1 });
    expect(refused(sim, { type: 'bet', bet: 2_000, tie: 100, spot: 1 })).toBe('NOT_ENOUGH_CHIPS');
    expect(refused(sim, { type: 'bet', bet: 1_000, tie: 0, spot: 3 })).toBe('BAD_REQUEST');
  });

  it('fewer spots gives back the bets on the spots let go; no change while a tie waits', () => {
    const sim = solo(stackedShoe(cards('2d 7s 7h 7d'), DECKS));
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0, spot: 0 });
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0, spot: 1 });
    sim.act(0, { type: 'bet', bet: 2_000, tie: 200, spot: 2 });
    sim.act(0, { type: 'spots', n: 2 });
    expect(events(sim)).toEqual([{ type: 'bets', seat: 2, bet: 0, tie: 0 }, { type: 'spots', seat: 0, n: 2 }]);
    expect(sim.stack(0)).toBe(START - 2_000);
    sim.act(0, { type: 'deal' });
    expect(view(sim).phase).toBe('deciding');
    expect(refused(sim, { type: 'spots', n: 1 })).toBe('WRONG_PHASE');
  });

  it('leaving with ties to decide sends them to war, each raise out of what the stack still holds', () => {
    const top = '2d 7s 7h 7d 2c 3c 4c Jd 4d 9c';
    const rich = dealt(top, [{ bet: 1_000, tie: 0 }, { bet: 1_000, tie: 0 }]);
    rich.apply(engine.seatLeaving(rich.state, 0, rich.ctx()));
    expect([view(rich).seats[0]!.decision, view(rich).seats[1]!.decision]).toEqual(['war', 'war']);
    expect(view(rich).phase).toBe('results');
    expect(engine.liveBets(rich.state, 0)).toBe(0);
    // With the stack short of both raises (chips moved elsewhere), the first goes to war, the second surrenders.
    const poor = dealt(top, [{ bet: 1_000, tie: 0 }, { bet: 1_000, tie: 0 }]);
    poor.seats.get(0)!.stack = 1_500;
    poor.apply(engine.seatLeaving(poor.state, 0, poor.ctx()));
    expect([view(poor).seats[0]!.decision, view(poor).seats[1]!.decision]).toEqual(['war', 'surrender']);
    expect(engine.liveBets(poor.state, 0)).toBe(0);
  });

  it('parses a spot on bets and decisions and the number of spots, and nothing out of range', () => {
    const ok = [{ type: 'bet', bet: 1_000, tie: 0, spot: 2 }, { type: 'war', spot: 1 }, { type: 'surrender' }, { type: 'spots', n: MAX_SPOTS }];
    for (const a of ok) expect(engine.parseAction(a), JSON.stringify(a)).toEqual(a);
    const bad = [{ type: 'spots', n: 0 }, { type: 'spots', n: MAX_SPOTS + 1 }, { type: 'war', spot: 6 }, { type: 'bet', bet: 1_000, tie: 0, spot: 0.5 }];
    for (const a of bad) expect(engine.parseAction(a), JSON.stringify(a)).toBeNull();
  });

  it('a shared table is untouched: one spot per seat', () => {
    const sim = new TableSim(engine, seededRng(9), 'multi', [{ seat: 0, stack: START }, { seat: 1, stack: START }]) as Sim;
    sim.started = true;
    sim.advance(0);
    expect(refused(sim, { type: 'spots', n: 2 })).toBe('WRONG_PHASE');
    expect(refused(sim, { type: 'bet', bet: 1_000, tie: 0, spot: 1 })).toBe('BAD_REQUEST');
    sim.act(0, { type: 'bet', bet: 1_000, tie: 0 });
    sim.act(1, { type: 'bet', bet: 1_000, tie: 0 });
    sim.advance(BETTING_MS);
    expect(view(sim, 1).mine).toEqual([1]);
    for (const r of sim.rounds) expect(r.spot).toBeUndefined();
  });
});

describe('casino war spots: money and odds', () => {
  it('random bets and decisions on one to three spots: every chip is accounted for', () => {
    const sim = solo(seededRng(51), 1e12);
    const rng = seededRng(52);
    for (let i = 0; i < 4000; i++) {
      sim.act(0, { type: 'spots', n: 1 + randInt(rng, MAX_SPOTS) });
      for (const spot of spotsOf(sim.state, 0)) {
        if (spot > 0 && randInt(rng, 5) === 0) continue;
        sim.act(0, { type: 'bet', bet: 1_000 + 200 * randInt(rng, 45), tie: randInt(rng, 2) === 0 ? 0 : 100 * (1 + randInt(rng, 100)), spot });
      }
      sim.act(0, { type: 'deal' });
      for (let v = view(sim); v.phase === 'deciding'; v = view(sim)) {
        const spot = v.mine.find((s) => v.seats[s]?.decision === 'pending')!;
        sim.act(0, { type: randInt(rng, 3) === 0 ? 'surrender' : 'war', spot });
      }
      expect(view(sim).phase).toBe('results');
      expect(engine.liveBets(sim.state, 0)).toBe(0);
    }
    const net = sim.rounds.reduce((a, r) => a + r.returned - r.wagered, 0);
    expect(sim.stack(0)).toBe(1e12 + net);
  });

  it('the table and the Monte Carlo loop deal the same three spots from the same shoe', () => {
    const sim = solo(seededRng(88), 1e12);
    const rng = seededRng(88);
    let shoe: Shoe | null = null;
    sim.act(0, { type: 'spots', n: 3 });
    const bets = { bet: 1_000, tie: 100 };
    for (let i = 0; i < 3000; i++) {
      for (const spot of [0, 1, 2]) sim.act(0, { type: 'bet', ...bets, spot });
      sim.act(0, { type: 'deal' });
      while (view(sim).phase === 'deciding') sim.act(0, { type: bestChoice() });
      if (shuffleDue(shoe)) shoe = openShoe(rng);
      const { cards: dealtCards, dealer } = dealRound(shoe!, 3);
      const tied = [0, 1, 2].filter((i) => settleDeal(bets, dealtCards[i]!, dealer, DEFAULT_RULES).bet === null);
      const w = tied.length ? dealWar(shoe!, tied.length) : null;
      const v = view(sim);
      expect(v.dealer).toBe(dealer);
      [0, 1, 2].forEach((spot) => {
        const k = tied.indexOf(spot);
        const hand = k < 0 ? { player: dealtCards[spot]!, dealer } : { player: dealtCards[spot]!, dealer, choice: 'war' as const, war: { player: w!.cards[k]!, dealer: w!.dealer } };
        expect(v.seats[spot]!.result).toEqual(settle(bets, hand, DEFAULT_RULES));
      });
    }
  });
});
