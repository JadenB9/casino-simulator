// Blackjack with several spots: a solo player betting two to five circles from one stack. The
// round must be the round a full table gets (one card to each circle from first base, the dealer's,
// a second each, the hole card; then each hand in circle order), with insurance, splits and
// doubles per spot and every spot settled on its own.

import { describe, it, expect } from 'vitest';
import type { Card } from '../src/cards.ts';
import type { GameEvent } from '../src/engine.ts';
import { engine, spotsOf, BETTING_MS, type BlackjackState, type BlackjackView } from '../src/games/blackjack/engine.ts';
import { MAX_SPOTS, spotOf, handTotal, openShoe, startRound, decideInsurance, play, legalMoves, current, type Dealing, type Move } from '../src/games/blackjack/rules.ts';
import { basicStrategy } from '../src/games/blackjack/strategy.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { randInt } from '../src/rng.ts';

type Sim = TableSim<BlackjackState, unknown, BlackjackView>;

const START = 1_000_000;

function solo(stack = START, seed = 1): Sim {
  return new TableSim(engine, seededRng(seed), 'solo', [{ seat: 0, stack }]) as Sim;
}

function rig(sim: Sim, codes: string): void {
  sim.state = { ...sim.state, shoe: { cards: codes.split(' ') as Card[], pos: 0, cutAt: 10_000, decks: 6 } };
}

const view = (sim: Sim, seat: number | null = 0) => sim.view(seat);
const events = (sim: Sim) => sim.lastEvents as GameEvent[];
const refused = (sim: Sim, action: unknown, seat = 0) => sim.act(seat, action, { allowRefusal: true }).refused;
const spot = (sim: Sim, s: number) => view(sim).spots.find((x) => x.seat === s)!;

/** Play `bets.length` spots (spot 0's bet first), stack the shoe and deal. */
function dealSpots(sim: Sim, bets: number[], codes: string): GameEvent[] {
  sim.act(0, { type: 'spots', n: bets.length });
  bets.forEach((amount, s) => sim.act(0, { type: 'bet', amount, spot: s }));
  rig(sim, codes);
  sim.act(0, { type: 'deal' });
  return events(sim);
}

describe('blackjack spots: the deal and the order of play', () => {
  it('a solo player plays spots 0 to n - 1: the middle circle and the ones beside it', () => {
    const sim = solo();
    expect(view(sim).mine).toEqual([0]);
    sim.act(0, { type: 'spots', n: 3 });
    expect(view(sim).mine).toEqual([0, 1, 2]);
    expect(view(sim).mine.map(spotOf).sort()).toEqual([2, 3, 4]);
    sim.act(0, { type: 'spots', n: MAX_SPOTS });
    expect(view(sim).mine.map(spotOf).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(view(sim, null).mine).toEqual([]);
  });

  it('deals round the table like a real dealer: a card to each circle from first base, the up card, a second each, the hole card', () => {
    const sim = solo();
    // Circles: spot 1 is circle 2, spot 0 circle 3, spot 2 circle 4, so spot 1 is dealt first.
    const evs = dealSpots(sim, [2500, 2500, 2500], '2s 3s 4s 9d 5s 6s 7s Td');
    const deal = evs.filter((e) => e.type === 'card' || e.type === 'dealer-card').map((e) => (e.type === 'card' ? `${e.seat}:${e.card}` : `d:${e.card}`));
    expect(deal).toEqual(['1:2s', '0:3s', '2:4s', 'd:9d', '1:5s', '0:6s', '2:7s', 'd:null']);
    expect(view(sim).spots.map((s) => s.seat)).toEqual([1, 0, 2]);
    expect(view(sim).turn).toEqual({ seat: 1, hand: 0 });
    expect(view(sim).moves).toContain('double');
  });

  it('decisions go spot by spot in circle order, each hand settled on its own', () => {
    const sim = solo();
    // Spot 1: A-K, a blackjack paid at once. Spot 0: T-T. Spot 2: T-6. Dealer 9 under an 8.
    dealSpots(sim, [3000, 2500, 5000], 'As Ts Td 9d Kh Tc 6s 8h');
    expect(spot(sim, 1).hands[0]).toMatchObject({ outcome: 'blackjack', payout: 6250 });
    expect(view(sim).turn).toEqual({ seat: 0, hand: 0 });
    sim.act(0, { type: 'stand', spot: 0, hand: 0 });
    expect(view(sim).turn).toEqual({ seat: 2, hand: 0 });
    sim.act(0, { type: 'stand', spot: 2, hand: 0 });
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.dealer).toEqual(['9d', '8h']);
    expect(spot(sim, 0).hands[0]).toMatchObject({ outcome: 'win', payout: 6000 });
    expect(spot(sim, 2).hands[0]).toMatchObject({ outcome: 'lose', payout: 0 });
    expect(sim.stack(0)).toBe(START - 10_500 + 6250 + 6000);
    // One round per spot for the stats, in circle order; the extra spots say which they were.
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 2500, returned: 6250, spot: 1 },
      { seat: 0, wagered: 3000, returned: 6000 },
      { seat: 0, wagered: 5000, returned: 0, spot: 2 },
    ]);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('a split on one spot while the others stand: both split hands play before the next circle', () => {
    const sim = solo();
    // Spot 1: 8-8. Spot 0: T-9. Spot 2: T-7. Dealer 6 under a ten, then draws a 9 and busts.
    dealSpots(sim, [3000, 2500, 4000], '8s Ts Td 6d 8h 9s 7s Th 3c 2c 9h');
    expect(view(sim).turn).toEqual({ seat: 1, hand: 0 });
    expect(view(sim).moves).toContain('split');
    sim.act(0, { type: 'split', spot: 1, hand: 0 });
    expect(spot(sim, 1).hands.map((h) => h.cards)).toEqual([['8s', '3c'], ['8h']]);
    expect(view(sim).turn).toEqual({ seat: 1, hand: 0 });
    sim.act(0, { type: 'stand', spot: 1, hand: 0 });
    // The second split hand takes its second card when its turn comes.
    expect(spot(sim, 1).hands[1]!.cards).toEqual(['8h', '2c']);
    expect(view(sim).turn).toEqual({ seat: 1, hand: 1 });
    sim.act(0, { type: 'stand', spot: 1, hand: 1 });
    expect(view(sim).turn).toEqual({ seat: 0, hand: 0 });
    // Spots 0 and 2 never split, double or draw: their hands stay as dealt.
    expect(spot(sim, 0).hands).toHaveLength(1);
    sim.act(0, { type: 'stand', spot: 0, hand: 0 });
    sim.act(0, { type: 'stand', spot: 2, hand: 0 });
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.dealer).toEqual(['6d', 'Th', '9h']);
    expect(spot(sim, 1).hands.map((h) => [h.outcome, h.bet, h.payout])).toEqual([['win', 2500, 5000], ['win', 2500, 5000]]);
    expect(spot(sim, 1)).toMatchObject({ wagered: 5000, returned: 10_000 });
    expect(spot(sim, 0).hands[0]).toMatchObject({ outcome: 'win', bet: 3000, payout: 6000 });
    expect(spot(sim, 2).hands[0]).toMatchObject({ outcome: 'win', bet: 4000, payout: 8000 });
    expect(sim.stack(0)).toBe(START + 5000 + 3000 + 4000);
    expect(sim.rounds).toEqual([
      { seat: 0, wagered: 5000, returned: 10_000, spot: 1 },
      { seat: 0, wagered: 3000, returned: 6000 },
      { seat: 0, wagered: 4000, returned: 8000, spot: 2 },
    ]);
  });

  it('a double on the last spot pays with the others in one step: the stack moves once, by the net', () => {
    const sim = solo();
    // Spot 1: T-T stands. Spot 0: 5-4. Spot 2: 6-5 doubles. Dealer 7 under a ten.
    dealSpots(sim, [2500, 2500, 2500], 'Ts 5s 6s 7d Tc 4s 5h Th 2c 9c');
    sim.act(0, { type: 'stand', spot: 1, hand: 0 });
    sim.act(0, { type: 'hit', spot: 0, hand: 0 });
    sim.act(0, { type: 'stand', spot: 0, hand: 0 });
    const before = sim.stack(0);
    sim.act(0, { type: 'double', spot: 2, hand: 0 });
    // 6-5 doubled takes the 9: 20. Dealer 17. Spot 1 (20) wins, spot 0 (11) loses, spot 2 wins double.
    expect(spot(sim, 2).hands[0]).toMatchObject({ doubled: true, bet: 5000, outcome: 'win', payout: 10_000 });
    expect(sim.stack(0)).toBe(before - 2500 + 5000 + 10_000);
    expect(sim.stack(0)).toBe(START - 7500 - 2500 + 5000 + 10_000);
  });
});

describe('blackjack spots: insurance per spot', () => {
  it('each spot is asked on its own; an insured spot is paid 2 to 1 on a dealer blackjack, a natural pushes', () => {
    const sim = solo();
    // Spot 1: T-7. Spot 0: 9-9. Spot 2: A-K (a natural). Dealer: ace up, king in the hole.
    dealSpots(sim, [3000, 2500, 4000], 'Ts 9s As Ad 7s 9h Kh Kd');
    expect(view(sim).phase).toBe('insurance');
    expect(view(sim).spots.map((s) => s.insurance)).toEqual(['offered', 'offered', 'offered']);
    // Without a spot named, the first circle still asked answers.
    sim.act(0, { type: 'insurance', take: false });
    expect(spot(sim, 1).insurance).toBe('declined');
    expect(refused(sim, { type: 'insurance', take: true, spot: 1 })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'insurance', take: true, spot: 0 });
    expect(spot(sim, 0)).toMatchObject({ insurance: 'taken', insured: 1500 });
    expect(view(sim).phase).toBe('insurance');
    expect(events(sim).some((e) => e.type === 'peek')).toBe(false);
    // Spot 2 holds a blackjack: its question is even money. Declined, it pushes the dealer's.
    sim.act(0, { type: 'insurance', take: false, spot: 2 });
    expect(events(sim)).toContainEqual({ type: 'peek', blackjack: true });
    expect(view(sim).phase).toBe('results');
    expect(spot(sim, 1).hands[0]).toMatchObject({ outcome: 'lose', payout: 0 });
    expect(spot(sim, 0).hands[0]).toMatchObject({ outcome: 'lose', payout: 0 });
    expect(spot(sim, 0).returned).toBe(4500);
    expect(spot(sim, 2).hands[0]).toMatchObject({ outcome: 'push', payout: 4000 });
    expect(sim.stack(0)).toBe(START - 2500);
    expect(sim.rounds.map((r) => r.returned - r.wagered)).toEqual([-2500, 0, 0]);
  });

  it('even money on one spot settles that spot at once; the others play on after the peek', () => {
    const sim = solo();
    // Spot 1: A-K. Spot 0: T-8. Spot 2: T-9. Dealer: ace up, 6 in the hole (no blackjack).
    dealSpots(sim, [2500, 2500, 2500], 'As Ts Tc Ad Kh 8s 9c 6h');
    sim.act(0, { type: 'insurance', take: true, spot: 1 });
    expect(spot(sim, 1).hands[0]).toMatchObject({ outcome: 'evenmoney', payout: 5000 });
    sim.act(0, { type: 'insurance', take: false, spot: 0 });
    sim.act(0, { type: 'insurance', take: false, spot: 2 });
    expect(events(sim)).toContainEqual({ type: 'peek', blackjack: false });
    expect(view(sim).turn).toEqual({ seat: 0, hand: 0 });
  });
});

describe('blackjack spots: bets, refusals and leaving', () => {
  it('limits are per circle, the stack covers them all, and every spot with a bet needs the minimum', () => {
    const sim = solo(12_000);
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', amount: 5000, spot: 0 });
    sim.act(0, { type: 'bet', amount: 5000, spot: 1 });
    expect(refused(sim, { type: 'bet', amount: 5000, spot: 2 })).toBe('NOT_ENOUGH_CHIPS');
    sim.act(0, { type: 'bet', amount: 1000, spot: 2 });
    expect(refused(sim, { type: 'deal' })).toBe('LIMIT');
    expect(refused(sim, { type: 'bet', amount: 2500, spot: 3 })).toBe('BAD_REQUEST');
    const big = solo(10_000_000);
    big.act(0, { type: 'spots', n: 2 });
    big.act(0, { type: 'bet', amount: 500_000, spot: 0 });
    big.act(0, { type: 'bet', amount: 500_000, spot: 1 });
    expect(refused(big, { type: 'bet', amount: 100, spot: 1 })).toBe('LIMIT');
  });

  it('a circle left empty sits the round out', () => {
    const sim = solo();
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', amount: 2500, spot: 0 });
    sim.act(0, { type: 'bet', amount: 2500, spot: 2 });
    rig(sim, 'Ts Tc 9d 9s 9c 7h');
    sim.act(0, { type: 'deal' });
    expect(view(sim).spots.map((s) => s.seat)).toEqual([0, 2]);
  });

  it('undo takes back the last chip wherever it went; clear takes back every spot', () => {
    const sim = solo();
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', amount: 2500, spot: 0 });
    sim.act(0, { type: 'bet', amount: 3000, spot: 2 });
    sim.act(0, { type: 'bet', amount: 500, spot: 0 });
    sim.act(0, { type: 'undo' });
    expect(view(sim).bets).toEqual({ 0: 2500, 2: 3000 });
    sim.act(0, { type: 'undo' });
    expect(view(sim).bets).toEqual({ 0: 2500 });
    sim.act(0, { type: 'bet', amount: 2500, spot: 1 });
    sim.act(0, { type: 'clear' });
    expect(view(sim).bets).toEqual({});
    expect(sim.stack(0)).toBe(START);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('fewer spots gives back the bets on the circles let go; the choice sticks from round to round', () => {
    const sim = solo();
    sim.act(0, { type: 'spots', n: 3 });
    sim.act(0, { type: 'bet', amount: 2500, spot: 0 });
    sim.act(0, { type: 'bet', amount: 3000, spot: 2 });
    sim.act(0, { type: 'bet', amount: 2600, spot: 1 });
    sim.act(0, { type: 'spots', n: 2 });
    expect(events(sim)).toEqual([{ type: 'bet', seat: 2, total: 0 }, { type: 'spots', seat: 0, n: 2 }]);
    expect(view(sim).bets).toEqual({ 0: 2500, 1: 2600 });
    expect(sim.stack(0)).toBe(START - 5100);
    expect(engine.liveBets(sim.state, 0)).toBe(5100);
    // The chip that went to the dropped spot is gone from the undo list too.
    sim.act(0, { type: 'undo' });
    expect(view(sim).bets).toEqual({ 0: 2500 });
    sim.act(0, { type: 'bet', amount: 2600, spot: 1 });
    rig(sim, 'Ts Tc 9d 9s 9c 7h 2h');
    sim.act(0, { type: 'deal' });
    sim.act(0, { type: 'stand', spot: 1, hand: 0 });
    sim.act(0, { type: 'stand', spot: 0, hand: 0 });
    expect(view(sim).phase).toBe('results');
    expect(view(sim).last).toEqual({ 0: 2500, 1: 2600 });
    expect(view(sim).mine).toEqual([0, 1]);
    sim.act(0, { type: 'bet', amount: 2500, spot: 1 });
    expect(view(sim).mine).toEqual([0, 1]);
  });

  it('refuses a change of spots while cards are out, and at a shared table', () => {
    const sim = solo();
    dealSpots(sim, [2500, 2500], 'Ts 9s 5d 8s 8c 6h');
    expect(view(sim).phase).toBe('play');
    expect(refused(sim, { type: 'spots', n: 1 })).toBe('WRONG_PHASE');
    const shared = new TableSim(engine, seededRng(3), 'multi', [{ seat: 0, stack: 100_000 }, { seat: 1, stack: 100_000 }]) as Sim;
    shared.started = true;
    shared.advance(0);
    expect(refused(shared, { type: 'spots', n: 2 })).toBe('WRONG_PHASE');
    expect(refused(shared, { type: 'bet', amount: 2500, spot: 0 }, 1)).toBe('BAD_REQUEST');
    expect(view(shared, 1).mine).toEqual([1]);
  });

  it('a move meant for a hand that has finished is refused, not played on the next spot', () => {
    const sim = solo();
    dealSpots(sim, [2500, 2500], 'Ts 9s 5d 8s 8c 6h');
    // Spot 1 (circle 2) plays first.
    sim.act(0, { type: 'stand', spot: 1, hand: 0 });
    expect(refused(sim, { type: 'stand', spot: 1, hand: 0 })).toBe('NOT_YOUR_TURN');
    expect(refused(sim, { type: 'hit', spot: 0, hand: 1 })).toBe('NOT_YOUR_TURN');
    expect(view(sim).turn).toEqual({ seat: 0, hand: 0 });
  });

  it('parses spot and hand targets and the number of spots, and nothing out of range', () => {
    const ok = [{ type: 'bet', amount: 2500, spot: 4 }, { type: 'spots', n: 1 }, { type: 'spots', n: MAX_SPOTS }, { type: 'insurance', take: true, spot: 2 }, { type: 'hit', spot: 0, hand: 3 }, { type: 'stand', hand: 1 }];
    for (const a of ok) expect(engine.parseAction(a), JSON.stringify(a)).toEqual(a);
    const bad = [{ type: 'spots' }, { type: 'spots', n: 0 }, { type: 'spots', n: MAX_SPOTS + 1 }, { type: 'spots', n: 2.5 }, { type: 'bet', amount: 2500, spot: 7 }, { type: 'bet', amount: 2500, spot: -1 }, { type: 'bet', amount: 2500, spot: '1' }, { type: 'hit', hand: 4 }, { type: 'insurance', take: true, spot: 1.5 }];
    for (const a of bad) expect(engine.parseAction(a), JSON.stringify(a)).toBeNull();
  });

  it('leaving mid-round stands every spot; the dealer finishes and every chip comes home', () => {
    const sim = solo();
    // Spot 1: T-9, spot 0: 8-8, spot 2: T-6. Dealer 7 under a ten. The split hand still waiting
    // for its second card gets it (the 2) as it stands.
    dealSpots(sim, [2500, 2500, 2500], 'Ts 8s Td 7d 9s 8h 6c Tc 5h 2c');
    sim.act(0, { type: 'stand', spot: 1, hand: 0 });
    sim.act(0, { type: 'split', spot: 0, hand: 0 });
    expect(engine.liveBets(sim.state, 0)).toBe(10_000);
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    for (const s of v.spots) for (const h of s.hands) expect(h.outcome).not.toBeNull();
    const net = sim.rounds.reduce((a, r) => a + r.returned - r.wagered, 0);
    expect(sim.rounds).toHaveLength(3);
    expect(sim.stack(0)).toBe(START + net);
  });

  it('leaving while betting brings back the bets on every spot', () => {
    const sim = solo();
    sim.act(0, { type: 'spots', n: 3 });
    for (const s of [0, 1, 2]) sim.act(0, { type: 'bet', amount: 2500 + s * 100, spot: s });
    expect(engine.liveBets(sim.state, 0)).toBe(7800);
    const step = engine.seatLeaving(sim.state, 0, sim.ctx());
    expect(step.chips).toEqual([{ seat: 0, payout: 7800 }]);
    sim.apply(step);
    expect(sim.stack(0)).toBe(START);
    expect(view(sim).bets).toEqual({});
  });
});

describe('blackjack spots: money and odds', () => {
  it('random legal play on one to five spots for thousands of rounds: every chip is accounted for', () => {
    const sim = solo(1_000_000_000, 31);
    const rng = seededRng(32);
    for (let i = 0; i < 3000; i++) {
      const n = 1 + randInt(rng, MAX_SPOTS);
      sim.act(0, { type: 'spots', n });
      for (const s of spotsOf(sim.state, 0)) if (s === 0 || randInt(rng, 5) > 0) sim.act(0, { type: 'bet', amount: 2500 + 100 * randInt(rng, 400), spot: s });
      sim.act(0, { type: 'deal' });
      for (let guard = 0; guard < 80; guard++) {
        const v = view(sim);
        if (v.phase === 'insurance') {
          const asked = v.spots.find((s) => s.insurance === 'offered')!;
          sim.act(0, { type: 'insurance', take: randInt(rng, 2) === 0, spot: asked.seat });
        } else if (v.phase === 'play') {
          sim.act(0, { type: v.moves[randInt(rng, v.moves.length)]!, spot: v.turn!.seat, hand: v.turn!.hand });
        } else break;
      }
      const v = view(sim);
      expect(v.phase).toBe('results');
      expect(engine.liveBets(sim.state, 0)).toBe(0);
      for (const s of v.spots) {
        expect(s.wagered).toBe(s.hands.reduce((a, h) => a + h.bet, 0) + s.insured);
        for (const h of s.hands) {
          const expected: Record<string, number> = { blackjack: h.bet * 2.5, win: h.bet * 2, evenmoney: h.bet * 2, push: h.bet, surrender: h.bet / 2, lose: 0, bust: 0 };
          expect(h.payout).toBe(expected[h.outcome!]);
          if (h.outcome === 'bust') expect(handTotal(h.cards).total).toBeGreaterThan(21);
        }
      }
    }
    const net = sim.rounds.reduce((a, r) => a + r.returned - r.wagered, 0);
    expect(sim.stack(0)).toBe(1_000_000_000 + net);
    expect(sim.rounds.length).toBeGreaterThan(6000);
  });

  it('the table and the Monte Carlo loop play identical three-spot rounds from the same shoe', () => {
    // As for one spot (blackjack.test.ts): the engine and the bare rule core, fed the same seed,
    // deal the same cards to the same circles and reach the same results, reshuffles included.
    const sim = new TableSim(engine, seededRng(43), 'solo', [{ seat: 0, stack: 1e12 }]) as Sim;
    const rng = seededRng(43);
    const d: Dealing = { shoe: openShoe(rng), rng, out: null };
    sim.act(0, { type: 'spots', n: 3 });
    const bets = [0, 1, 2].map((seat) => ({ seat, bet: 2500 }));
    for (let i = 0; i < 3000; i++) {
      for (const b of bets) sim.act(0, { type: 'bet', amount: b.bet, spot: b.seat });
      sim.act(0, { type: 'deal' });
      for (let v = view(sim); v.phase === 'insurance' || v.phase === 'play'; v = view(sim)) {
        if (v.phase === 'insurance') sim.act(0, { type: 'insurance', take: false, spot: v.spots.find((s) => s.insurance === 'offered')!.seat });
        else {
          const h = v.spots.find((s) => s.seat === v.turn!.seat)!.hands[v.turn!.hand]!;
          const can = { double: v.moves.includes('double'), split: v.moves.includes('split'), surrender: v.moves.includes('surrender') };
          sim.act(0, { type: basicStrategy(h.cards, v.dealer[0]!, can), spot: v.turn!.seat, hand: v.turn!.hand });
        }
      }
      const r = startRound(bets, d);
      if (r.stage === 'insurance') for (const s of r.spots) if (r.stage === 'insurance') decideInsurance(r, s.seat, false, d);
      for (let c = current(r); c; c = current(r)) play(r, c.spot.seat, basicStrategy(c.hand.cards, r.dealer[0]!, legalMoves(r, c.spot, c.hand)) as Move, d);

      const v = view(sim);
      expect(v.spots.map((s) => s.hands.map((h) => h.cards))).toEqual(r.spots.map((s) => s.hands.map((h) => h.cards)));
      expect(v.dealer).toEqual(r.dealer);
      expect(sim.rounds.slice(-3).map((x) => x.returned - x.wagered)).toEqual(r.spots.map((s) => s.returned - s.wagered));
    }
  });

  it('a shared table is untouched: one circle per seat, rounds without a spot field', () => {
    const sim = new TableSim(engine, seededRng(5), 'multi', [{ seat: 0, stack: 100_000 }, { seat: 2, stack: 100_000 }]) as Sim;
    sim.started = true;
    sim.advance(0);
    sim.act(0, { type: 'bet', amount: 2500 });
    sim.act(2, { type: 'bet', amount: 2500 });
    rig(sim, 'Ts 9s 5d 8s 8c 6h 7h');
    sim.advance(BETTING_MS);
    // Seat 0 sits at circle 3, seat 2 at circle 4: seat 0 is dealt and plays first.
    expect(view(sim, null).spots.map((s) => s.seat)).toEqual([0, 2]);
    for (let guard = 0; guard < 10 && view(sim, null).phase === 'play'; guard++) sim.act(view(sim, null).turn!.seat, { type: 'stand' });
    expect(view(sim, null).phase).toBe('results');
    for (const r of sim.rounds) expect(Object.keys(r).sort()).toEqual(['returned', 'seat', 'wagered']);
  });
});
