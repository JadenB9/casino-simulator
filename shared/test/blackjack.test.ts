import { describe, it, expect } from 'vitest';
import type { Card } from '../src/cards.ts';
import type { GameEvent } from '../src/engine.ts';
import { engine, BETTING_MS, INSURANCE_MS, TURN_MS, RESULTS_MS, type BlackjackState, type BlackjackView } from '../src/games/blackjack/engine.ts';
import { handTotal, dealerStands, openShoe, startRound, decideInsurance, play, legalMoves, current, type Dealing, type Move } from '../src/games/blackjack/rules.ts';
import { basicStrategy } from '../src/games/blackjack/strategy.ts';
import { TableSim, type SimSeat } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { randInt } from '../src/rng.ts';

type Sim = TableSim<BlackjackState, unknown, BlackjackView>;

function solo(stack = 100_000, seed = 1): Sim {
  return new TableSim(engine, seededRng(seed), 'solo', [{ seat: 0, stack }]) as Sim;
}

function multi(seats: SimSeat[], seed = 3): Sim {
  const sim = new TableSim(engine, seededRng(seed), 'multi', seats) as Sim;
  sim.started = true;
  sim.advance(0);
  return sim;
}

/**
 * Stack the shoe: cards come out in this order. The deal goes one card to each circle from
 * first base, the dealer's up card, a second card each, the hole card; then hits and draws.
 */
function rig(sim: Sim, codes: string, cutAt = 10_000): void {
  sim.state = { ...sim.state, shoe: { cards: codes.split(' ') as Card[], pos: 0, cutAt, decks: 6 } };
}

const view = (sim: Sim, seat: number | null = 0) => sim.view(seat);
const events = (sim: Sim) => sim.lastEvents as GameEvent[];
const types = (sim: Sim) => events(sim).map((e) => e.type);
const hand = (sim: Sim, h = 0, seat = 0) => view(sim).spots.find((s) => s.seat === seat)!.hands[h]!;

function dealSolo(sim: Sim, codes: string, bet = 2500): void {
  rig(sim, codes);
  sim.act(0, { type: 'bet', amount: bet });
  sim.act(0, { type: 'deal' });
}

function refused(sim: Sim, seat: number, action: unknown): string | undefined {
  return sim.act(seat, action, { allowRefusal: true }).refused;
}

describe('blackjack payouts (docs/rules/table-games.md §1.5)', () => {
  it('player blackjack against a dealer blackjack pushes: the stake comes back', () => {
    const sim = solo();
    dealSolo(sim, 'As Kd Kh Ah');
    expect(view(sim).phase).toBe('results');
    expect(hand(sim).outcome).toBe('push');
    expect(view(sim).dealer).toEqual(['Kd', 'Ah']);
    expect(sim.stack(0)).toBe(100_000);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 2500, returned: 2500 });
  });

  it('player blackjack is paid 3:2 at once against a 2-9 up card, and the dealer does not draw', () => {
    const sim = solo();
    dealSolo(sim, 'As 9d Kh 7c');
    expect(hand(sim)).toMatchObject({ outcome: 'blackjack', payout: 6250 });
    expect(types(sim)).not.toContain('peek');
    expect(view(sim).dealer).toEqual(['9d', '7c']);
    expect(sim.stack(0)).toBe(103_750);
  });

  it('3:2 on an odd bet is exact to the cent ($27 wins $40.50)', () => {
    const sim = solo();
    dealSolo(sim, 'As 9d Kh 7c', 2700);
    expect(sim.stack(0)).toBe(100_000 + 4050);
  });

  it('blackjack against an ace: even money pays 1:1 straight away', () => {
    const sim = solo();
    dealSolo(sim, 'As Ad Kh 7c');
    expect(view(sim).phase).toBe('insurance');
    sim.act(0, { type: 'insurance', take: true });
    expect(hand(sim)).toMatchObject({ outcome: 'evenmoney', payout: 5000 });
    expect(sim.stack(0)).toBe(102_500);
    expect(view(sim).phase).toBe('results');
  });

  it('declining even money: a push against a dealer blackjack, 3:2 after the peek without one', () => {
    const a = solo();
    dealSolo(a, 'As Ad Kh Kc');
    a.act(0, { type: 'insurance', take: false });
    expect(hand(a).outcome).toBe('push');
    expect(a.stack(0)).toBe(100_000);

    const b = solo();
    dealSolo(b, 'As Ad Kh 7c');
    b.act(0, { type: 'insurance', take: false });
    expect(types(b)).toEqual(expect.arrayContaining(['peek', 'result']));
    expect(hand(b)).toMatchObject({ outcome: 'blackjack', payout: 6250 });
    expect(b.stack(0)).toBe(103_750);
  });

  it('a dealer blackjack under a ten ends the round at the peek: only the opening bet is lost', () => {
    const sim = solo();
    dealSolo(sim, '8s Kd 8h Ac');
    expect(events(sim)).toContainEqual({ type: 'peek', blackjack: true });
    expect(events(sim)).toContainEqual({ type: 'hole', card: 'Ac' });
    expect(view(sim).phase).toBe('results');
    expect(refused(sim, 0, { type: 'split' })).toBe('WRONG_PHASE');
    expect(hand(sim)).toMatchObject({ outcome: 'lose', payout: 0, bet: 2500 });
    expect(sim.stack(0)).toBe(97_500);
  });

  it('under an ace a hand that wanted to double or split still loses only its opening bet', () => {
    const sim = solo();
    dealSolo(sim, '5s Ad 6h Kc');
    expect(refused(sim, 0, { type: 'double' })).toBe('WRONG_PHASE');
    expect(refused(sim, 0, { type: 'hit' })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'insurance', take: false });
    expect(view(sim).phase).toBe('results');
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 2500, returned: 0 });
    expect(sim.stack(0)).toBe(97_500);
  });

  it('insurance pays 2:1: full insurance against a dealer blackjack nets zero', () => {
    const sim = solo();
    dealSolo(sim, 'Ts Ad 9h Kc');
    sim.act(0, { type: 'insurance', take: true });
    expect(sim.stack(0)).toBe(100_000);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 3750, returned: 3750 });
    expect(events(sim)).toContainEqual({ type: 'insurance-result', seat: 0, bet: 1250, payout: 3750 });
  });

  it('insurance loses when the peek finds no blackjack, and the hand plays on', () => {
    const sim = solo();
    dealSolo(sim, 'Ts Ad 9h 7c');
    sim.act(0, { type: 'insurance', take: true });
    expect(events(sim)).toContainEqual({ type: 'insurance-result', seat: 0, bet: 1250, payout: 0 });
    expect(view(sim).phase).toBe('play');
    sim.act(0, { type: 'stand' });
    // Dealer A-7 is a soft 18 and stands; 19 wins.
    expect(hand(sim)).toMatchObject({ outcome: 'win', payout: 5000 });
    expect(sim.stack(0)).toBe(100_000 - 2500 - 1250 + 5000);
  });

  it('insurance is only offered with an ace up, and needs the chips to cover half the bet', () => {
    const a = solo();
    dealSolo(a, 'Ts Kd 9h 7c');
    expect(events(a)).toContainEqual({ type: 'peek', blackjack: false });
    expect(refused(a, 0, { type: 'insurance', take: true })).toBe('WRONG_PHASE');

    const b = solo(3000);
    dealSolo(b, 'Ts Ad 9h 7c');
    expect(refused(b, 0, { type: 'insurance', take: true })).toBe('NOT_ENOUGH_CHIPS');
    b.act(0, { type: 'insurance', take: false });
    expect(view(b).phase).toBe('play');
  });

  it('late surrender gives back half the bet', () => {
    const sim = solo();
    dealSolo(sim, 'Ts Kd 6h 7c');
    expect(view(sim).moves).toEqual(['hit', 'stand', 'double', 'surrender']);
    sim.act(0, { type: 'surrender' });
    expect(hand(sim)).toMatchObject({ outcome: 'surrender', payout: 1250 });
    expect(sim.stack(0)).toBe(98_750);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 2500, returned: 1250 });
  });

  it('surrender is only the first decision: not before the insurance answer, after a hit, after a split or on a blackjack', () => {
    const early = solo();
    dealSolo(early, 'Ts Ad 6h 7c');
    expect(refused(early, 0, { type: 'surrender' })).toBe('WRONG_PHASE');

    const hit = solo();
    dealSolo(hit, 'Ts Kd 3h 7c 2d');
    hit.act(0, { type: 'hit' });
    expect(refused(hit, 0, { type: 'surrender' })).toBe('BAD_REQUEST');

    const split = solo();
    dealSolo(split, '8s Kd 8h 7c 3d');
    split.act(0, { type: 'split' });
    expect(view(split).moves).not.toContain('surrender');
    expect(refused(split, 0, { type: 'surrender' })).toBe('BAD_REQUEST');

    const natural = solo();
    dealSolo(natural, 'As 9d Kh 7c');
    expect(refused(natural, 0, { type: 'surrender' })).toBe('WRONG_PHASE');
  });

  it('insurance and a surrender settle separately', () => {
    const sim = solo();
    dealSolo(sim, 'Ts Ad 6h 7c');
    sim.act(0, { type: 'insurance', take: true });
    sim.act(0, { type: 'surrender' });
    expect(sim.stack(0)).toBe(97_500);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 3750, returned: 1250 });
  });

  it('split aces get one card each and stand; ace-ten there is 21, paid 1:1, not a blackjack', () => {
    const sim = solo();
    dealSolo(sim, 'As 9d Ah 7c Kd 5s Ac');
    sim.act(0, { type: 'split' });
    const v = view(sim);
    expect(v.phase).toBe('results');
    expect(v.spots[0]!.hands.map((h) => h.cards)).toEqual([['As', 'Kd'], ['Ah', '5s']]);
    expect(hand(sim, 0)).toMatchObject({ outcome: 'win', payout: 5000, splitAce: true });
    expect(hand(sim, 1)).toMatchObject({ outcome: 'lose', payout: 0 });
    expect(v.dealer).toEqual(['9d', '7c', 'Ac']);
    expect(sim.stack(0)).toBe(100_000);
  });

  it('aces split once only: an ace landing on a split ace stays a soft 12', () => {
    const sim = solo();
    dealSolo(sim, 'As 9d Ah 7c Ad 5s Tc');
    sim.act(0, { type: 'split' });
    const v = view(sim);
    expect(v.spots[0]!.hands).toHaveLength(2);
    expect(hand(sim, 0).cards).toEqual(['As', 'Ad']);
    // The dealer busts with 9-7-T, so both one-card hands win.
    expect(sim.stack(0)).toBe(105_000);
  });

  it('split aces allow nothing more (checked on the rule core directly)', () => {
    const shoe = { cards: 'As 9d Ah 7c Kd 5s Ac'.split(' ') as Card[], pos: 0, cutAt: 1000, decks: 6 };
    const d: Dealing = { shoe, rng: seededRng(1), out: null };
    const r = startRound([{ seat: 0, bet: 2500 }], d);
    const s = r.spots[0]!;
    // Before the split: a pair of aces may split.
    expect(legalMoves(r, s, s.hands[0]!).split).toBe(true);
    play(r, 0, 'split', d);
    for (const h of s.hands) expect(Object.values(legalMoves(r, s, h)).some(Boolean)).toBe(false);
  });

  it('21 after splitting tens is not a blackjack: it pushes a dealer 21', () => {
    const sim = solo();
    dealSolo(sim, 'Ts 6d Th 5c As 9s Tc');
    sim.act(0, { type: 'split' });
    // Ten-ace made 21 and stood by itself; the turn is on the second hand.
    expect(view(sim).turn).toEqual({ seat: 0, hand: 1 });
    sim.act(0, { type: 'stand' });
    expect(view(sim).dealer).toEqual(['6d', '5c', 'Tc']);
    expect(hand(sim, 0)).toMatchObject({ outcome: 'push', payout: 2500 });
    expect(hand(sim, 1)).toMatchObject({ outcome: 'lose' });
    expect(sim.stack(0)).toBe(97_500);
  });

  it('splits to four hands at most; the fourth pair plays as hard 16 with no surrender', () => {
    const sim = solo();
    dealSolo(sim, '8s Td 8h 7c 8d 8c 8s Kd Kh Kc');
    sim.act(0, { type: 'split' });
    sim.act(0, { type: 'split' });
    sim.act(0, { type: 'split' });
    expect(view(sim).spots[0]!.hands).toHaveLength(4);
    expect(hand(sim, 0).cards).toEqual(['8s', '8s']);
    expect(view(sim).moves).toEqual(['hit', 'stand', 'double']);
    expect(refused(sim, 0, { type: 'split' })).toBe('BAD_REQUEST');
    expect(refused(sim, 0, { type: 'surrender' })).toBe('BAD_REQUEST');
    for (let i = 0; i < 4; i++) sim.act(0, { type: 'stand' });
    expect(view(sim).spots[0]!.hands.map((h) => h.cards)).toEqual([['8s', '8s'], ['8c', 'Kd'], ['8d', 'Kh'], ['8h', 'Kc']]);
    // Dealer 17: the 16 loses, the three 18s win.
    expect(view(sim).spots[0]!.hands.map((h) => h.outcome)).toEqual(['lose', 'win', 'win', 'win']);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 10_000, returned: 15_000 });
  });

  it('doubles after a split, for the full bet and one card', () => {
    const sim = solo();
    dealSolo(sim, '9s 6d 9h Tc 2d Ts Kd 9c');
    sim.act(0, { type: 'split' });
    expect(view(sim).moves).toContain('double');
    sim.act(0, { type: 'double' });
    expect(hand(sim, 0)).toMatchObject({ cards: ['9s', '2d', 'Ts'], bet: 5000, doubled: true, done: true });
    sim.act(0, { type: 'stand' });
    expect(hand(sim, 0)).toMatchObject({ outcome: 'win', payout: 10_000 });
    expect(hand(sim, 1)).toMatchObject({ outcome: 'win', payout: 5000 });
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 7500, returned: 15_000 });
  });

  it('doubles only on the first two cards, and only with the chips to cover it', () => {
    const sim = solo();
    dealSolo(sim, '5s 6d 3h Tc 2d');
    sim.act(0, { type: 'hit' });
    expect(refused(sim, 0, { type: 'double' })).toBe('BAD_REQUEST');

    const short = solo(3000);
    dealSolo(short, '8s 6d 8h Tc');
    expect(refused(short, 0, { type: 'split' })).toBe('NOT_ENOUGH_CHIPS');
    expect(refused(short, 0, { type: 'double' })).toBe('NOT_ENOUGH_CHIPS');
  });

  it('a busted hand loses at once and stays lost when the dealer busts later', () => {
    const sim = solo();
    dealSolo(sim, '8s 6d 8h Tc 5d Kd Ks Qc');
    sim.act(0, { type: 'split' });
    expect(engine.liveBets(sim.state, 0)).toBe(5000);
    sim.act(0, { type: 'hit' });
    expect(events(sim)).toContainEqual({ type: 'result', seat: 0, hand: 0, outcome: 'bust', bet: 2500, payout: 0 });
    expect(engine.liveBets(sim.state, 0)).toBe(2500);
    sim.act(0, { type: 'stand' });
    expect(view(sim).dealer).toEqual(['6d', 'Tc', 'Qc']);
    expect(hand(sim, 0).outcome).toBe('bust');
    expect(hand(sim, 1).outcome).toBe('win');
    expect(sim.stack(0)).toBe(100_000);
  });

  it('with every hand busted the dealer turns the hole card and does not draw', () => {
    const sim = solo();
    dealSolo(sim, 'Ts 6d 6h 5c Kd');
    sim.act(0, { type: 'hit' });
    expect(view(sim).dealer).toEqual(['6d', '5c']);
    expect(events(sim)).toContainEqual({ type: 'dealer', total: 11, bust: false, drew: false });
  });

  it('the dealer stands on soft 17 and draws to soft 16', () => {
    const a = solo();
    dealSolo(a, 'Ts Ad 8h 6c');
    a.act(0, { type: 'insurance', take: false });
    a.act(0, { type: 'stand' });
    expect(view(a).dealer).toEqual(['Ad', '6c']);
    expect(hand(a).outcome).toBe('win');

    const b = solo();
    dealSolo(b, 'Ts Ad 8h 5c Ac');
    b.act(0, { type: 'insurance', take: false });
    b.act(0, { type: 'stand' });
    expect(view(b).dealer).toEqual(['Ad', '5c', 'Ac']);
    expect(hand(b).outcome).toBe('win');
  });

  it('a hand that reaches 21 stands by itself', () => {
    const sim = solo();
    dealSolo(sim, '5s 9d 6h 7c Ts Kd');
    sim.act(0, { type: 'hit' });
    expect(view(sim).phase).toBe('results');
    expect(hand(sim)).toMatchObject({ cards: ['5s', '6h', 'Ts'], outcome: 'win' });
  });
});

describe('blackjack totals and the dealer rule', () => {
  const c = (s: string) => s.split(' ') as Card[];
  it('soft totals count an ace as 11 only while that does not bust the hand', () => {
    expect(handTotal(c('As 6d'))).toEqual({ total: 17, soft: true });
    expect(handTotal(c('As 6d Kh'))).toEqual({ total: 17, soft: false });
    expect(handTotal(c('As Ad'))).toEqual({ total: 12, soft: true });
    expect(handTotal(c('As Ad 9h'))).toEqual({ total: 21, soft: true });
    expect(handTotal(c('Kd Qh As'))).toEqual({ total: 21, soft: false });
    expect(handTotal(c('5d As Ad Ah'))).toEqual({ total: 18, soft: true });
    expect(handTotal(c('Th 6d'))).toEqual({ total: 16, soft: false });
    expect(handTotal(c('Qs Jd 2h'))).toEqual({ total: 22, soft: false });
  });

  it('the dealer stands on every 17, soft ones included, and hits 16 or less', () => {
    for (const h of ['As 6d', 'Ts 7d', 'As 2d 4h', 'As Ad 5h', 'Ts 6d As', 'Ts 8d']) expect(dealerStands(c(h)), h).toBe(true);
    for (const h of ['As 5d', 'Ts 6d', '9s 7d', 'As Ad 4h', '2s 3d']) expect(dealerStands(c(h)), h).toBe(false);
  });
});

describe('blackjack shoe', () => {
  it('six decks shuffled, one card burned, the cut card 78 from the back', () => {
    const sim = solo();
    const shoe = sim.state.shoe;
    expect(shoe.cards).toHaveLength(312);
    expect(shoe.pos).toBe(1);
    expect(shoe.cutAt).toBe(234);
    const counts = new Map<string, number>();
    for (const card of shoe.cards) counts.set(card, (counts.get(card) ?? 0) + 1);
    expect(counts.size).toBe(52);
    expect([...counts.values()].every((n) => n === 6)).toBe(true);
  });

  it('the cut card coming out finishes the round, then the shoe is shuffled and one card burned', () => {
    const sim = solo();
    rig(sim, 'Ts 9d 8h 7c Kd', 2);
    sim.act(0, { type: 'bet', amount: 2500 });
    sim.act(0, { type: 'deal' });
    expect(types(sim)).toContain('cut');
    expect(view(sim).phase).toBe('play');
    expect(view(sim).shoe.lastHand).toBe(true);
    sim.act(0, { type: 'stand' });
    const t = types(sim);
    expect(t.indexOf('shuffle')).toBeGreaterThan(t.lastIndexOf('result'));
    expect(t).toContain('burn');
    expect(sim.state.shoe.cards).toHaveLength(312);
    expect(sim.state.shoe.pos).toBe(1);
    expect(view(sim).shoe.lastHand).toBe(false);
  });

  it('a shoe that runs dry mid-round reshuffles the discards, not the cards on the table', () => {
    // Seven circles and seven cards left: the first pass empties the shoe.
    for (let seed = 1; ; seed++) {
      const rng = seededRng(seed);
      const shoe = openShoe(rng);
      shoe.pos = 305;
      shoe.cutAt = 400;
      const out: GameEvent[] = [];
      const d: Dealing = { shoe, rng, out };
      const r = startRound([0, 1, 2, 3, 4, 5, 6].map((seat) => ({ seat, bet: 2500 })), d);
      expect(out).toContainEqual({ type: 'shuffle', discards: true });
      if (r.stage !== 'play') continue;
      // Every physical card is somewhere: the seven dealt before the reshuffle, plus the reshuffled discards.
      const counts = new Map<string, number>();
      for (const card of [...r.spots.map((s) => s.hands[0]!.cards[0]!), ...d.shoe.cards]) counts.set(card, (counts.get(card) ?? 0) + 1);
      expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(312);
      expect([...counts.values()].every((n) => n === 6)).toBe(true);
      // Play it out; afterwards a full new shoe is in (the cut card was long gone).
      for (let c = current(r); c; c = current(r)) play(r, c.spot.seat, 'stand', d);
      expect(r.stage).toBe('done');
      expect(d.shoe.cards).toHaveLength(312);
      expect(d.shoe.pos).toBe(1);
      break;
    }
  });
});

describe('blackjack table flow', () => {
  it('bets: table max, $1 steps, the stack, and the minimum checked at the deal', () => {
    const sim = solo(1_000_000);
    expect(refused(sim, 0, { type: 'bet', amount: 500_100 })).toBe('LIMIT');
    expect(refused(sim, 0, { type: 'bet', amount: 2550 })).toBe('BAD_REQUEST');
    expect(refused(sim, 0, { type: 'deal' })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'bet', amount: 1000 });
    expect(refused(sim, 0, { type: 'deal' })).toBe('LIMIT');
    const poor = solo(2000);
    expect(refused(poor, 0, { type: 'bet', amount: 2500 })).toBe('NOT_ENOUGH_CHIPS');
  });

  it('undo takes back the last chip, clear takes back everything', () => {
    const sim = solo();
    sim.act(0, { type: 'bet', amount: 2500 });
    sim.act(0, { type: 'bet', amount: 500 });
    sim.act(0, { type: 'bet', amount: 100 });
    expect(sim.stack(0)).toBe(96_900);
    sim.act(0, { type: 'undo' });
    expect(view(sim).bets[0]).toBe(3000);
    expect(sim.stack(0)).toBe(97_000);
    sim.act(0, { type: 'clear' });
    expect(view(sim).bets[0]).toBeUndefined();
    expect(sim.stack(0)).toBe(100_000);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
  });

  it('solo: a bet after the results clears the table and opens the next round', () => {
    const sim = solo();
    dealSolo(sim, 'Ts 9d 8h 7c Kd');
    sim.act(0, { type: 'stand' });
    expect(view(sim).phase).toBe('results');
    const round = view(sim).round;
    expect(refused(sim, 0, { type: 'hit' })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'bet', amount: 2500 });
    const v = view(sim);
    expect(v.phase).toBe('betting');
    expect(v.round).toBe(round + 1);
    expect(v.spots).toEqual([]);
    expect(v.last).toEqual({ 0: 2500 });
    expect(v.bets).toEqual({ 0: 2500 });
  });

  it('never shows the hole card or the shoe before the dealer turns it over', () => {
    const sim = solo();
    dealSolo(sim, 'Ts 9d 8h 7c 5s');
    expect(events(sim)).toContainEqual({ type: 'dealer-card', card: null });
    for (const viewer of [0, null]) {
      const v = view(sim, viewer);
      expect(v.dealer).toEqual(['9d', null]);
      const json = JSON.stringify(v);
      expect(json).not.toContain('7c');
      expect(json).not.toContain('5s');
    }
    expect(JSON.stringify(events(sim))).not.toContain('7c');
    sim.act(0, { type: 'stand' });
    expect(view(sim).dealer.slice(0, 2)).toEqual(['9d', '7c']);
  });

  it('parses only well-formed actions', () => {
    const ok = [{ type: 'bet', amount: 2500 }, { type: 'undo' }, { type: 'clear' }, { type: 'deal' }, { type: 'insurance', take: false }, { type: 'hit' }, { type: 'stand' }, { type: 'double' }, { type: 'split' }, { type: 'surrender' }];
    for (const a of ok) expect(engine.parseAction(a), JSON.stringify(a)).toEqual(a);
    const bad = [null, 'hit', [], {}, { type: 'bet' }, { type: 'bet', amount: -100 }, { type: 'bet', amount: 12.5 }, { type: 'insurance' }, { type: 'insurance', take: 'yes' }, { type: 'resplit' }];
    for (const a of bad) expect(engine.parseAction(a), JSON.stringify(a)).toBeNull();
  });

  it('shifts its deadline', () => {
    const sim = multi([{ seat: 0, stack: 10_000 }]);
    const d = engine.deadline(sim.state)!;
    expect(engine.deadline(engine.shiftDeadlines(sim.state, 20_000))).toBe(d + 20_000);
  });
});

describe('blackjack multiplayer', () => {
  it('betting window: closes at the deadline, bets under the minimum come back, betting after it is refused', () => {
    const sim = multi([{ seat: 0, stack: 10_000 }, { seat: 3, stack: 10_000 }]);
    expect(view(sim, null).phase).toBe('betting');
    expect(refused(sim, 0, { type: 'deal' })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'bet', amount: 2500 });
    sim.act(3, { type: 'bet', amount: 1000 });
    rig(sim, 'Ts 9d 8h 7c 5s');
    sim.advance(BETTING_MS);
    expect(events(sim)).toContainEqual({ type: 'bet', seat: 3, total: 0, reason: 'min' });
    expect(sim.stack(3)).toBe(10_000);
    expect(view(sim, null).spots.map((s) => s.seat)).toEqual([0]);
    expect(refused(sim, 3, { type: 'bet', amount: 2500 })).toBe('WRONG_PHASE');
  });

  it('closes early once everyone with a bet is ready, but not on a ready flag left over from last round', () => {
    const sim = new TableSim(engine, seededRng(4), 'multi', [{ seat: 0, stack: 10_000, ready: true }, { seat: 1, stack: 10_000 }]) as Sim;
    sim.started = true;
    sim.advance(0);
    sim.act(0, { type: 'bet', amount: 2500 });
    sim.advance(0);
    expect(view(sim, null).phase).toBe('betting');
    sim.seats.get(0)!.ready = false;
    sim.advance(0);
    expect(sim.state.staleReady).toEqual([]);
    expect(view(sim, null).phase).toBe('betting');
    // Seat 1 hasn't bet, so it doesn't hold the table up.
    sim.seats.get(0)!.ready = true;
    rig(sim, 'Ts 9d 8h 7c 5s');
    sim.advance(0);
    expect(view(sim, null).phase).toBe('play');
  });

  it('plays from first base and settles right to left', () => {
    const sim = multi([{ seat: 0, stack: 10_000 }, { seat: 2, stack: 10_000 }, { seat: 5, stack: 10_000 }]);
    for (const seat of [0, 2, 5]) sim.act(seat, { type: 'bet', amount: 2500 });
    rig(sim, 'Ts Th Tc 6d 8s 9h 7c Td 6s');
    sim.advance(BETTING_MS);
    const deal = events(sim).filter((e) => e.type === 'card' || e.type === 'dealer-card');
    expect(deal.map((e) => (e.type === 'card' ? e.seat : 'D'))).toEqual([0, 2, 5, 'D', 0, 2, 5, 'D']);
    expect(view(sim, null).turn).toEqual({ seat: 0, hand: 0 });
    expect(refused(sim, 2, { type: 'stand' })).toBe('NOT_YOUR_TURN');
    sim.act(0, { type: 'stand' });
    expect(events(sim)).toContainEqual({ type: 'turn', seat: 2, hand: 0 });
    sim.act(2, { type: 'stand' });
    sim.act(5, { type: 'stand' });
    const results = events(sim).filter((e) => e.type === 'result');
    expect(results.map((e) => e.seat)).toEqual([5, 2, 0]);
    // Dealer 6-T-6 busts: everyone standing wins.
    expect(sim.stack(0)).toBe(12_500);
    expect(sim.rounds.map((r) => r.seat).sort()).toEqual([0, 2, 5]);
  });

  it('a turn timer that runs out stands the hand', () => {
    const sim = multi([{ seat: 0, stack: 10_000 }]);
    sim.act(0, { type: 'bet', amount: 2500 });
    rig(sim, 'Ts 9d 8h 7c 5s');
    sim.advance(BETTING_MS);
    expect(view(sim, null).phase).toBe('play');
    sim.advance(TURN_MS - 1);
    expect(view(sim, null).phase).toBe('play');
    sim.advance(1);
    expect(events(sim)).toContainEqual({ type: 'stand', seat: 0, hand: 0, auto: true });
    expect(view(sim, null).phase).toBe('results');
  });

  it('insurance: one window for everyone; whoever has not answered when it closes is taken as a no', () => {
    const sim = multi([{ seat: 0, stack: 10_000 }, { seat: 2, stack: 10_000 }]);
    sim.act(0, { type: 'bet', amount: 2500 });
    sim.act(2, { type: 'bet', amount: 2500 });
    rig(sim, 'Ts 9s Ad 9h 8h 7c 5s');
    sim.advance(BETTING_MS);
    expect(view(sim, null).phase).toBe('insurance');
    const deadline = engine.deadline(sim.state)!;
    sim.act(0, { type: 'insurance', take: true });
    expect(engine.deadline(sim.state)).toBe(deadline);
    expect(view(sim, null).phase).toBe('insurance');
    sim.advance(INSURANCE_MS);
    expect(events(sim)).toContainEqual({ type: 'insured', seat: 2, take: false, amount: 0, evenMoney: false });
    expect(events(sim)).toContainEqual({ type: 'peek', blackjack: false });
    expect(view(sim, null).phase).toBe('play');
  });

  it('results show, then the next window opens; an empty table goes idle', () => {
    const sim = multi([{ seat: 0, stack: 10_000 }]);
    sim.act(0, { type: 'bet', amount: 2500 });
    rig(sim, 'As 9d Kh 7c');
    sim.advance(BETTING_MS);
    expect(view(sim, null).phase).toBe('results');
    const round = view(sim, null).round;
    sim.advance(RESULTS_MS);
    expect(view(sim, null)).toMatchObject({ phase: 'betting', round: round + 1, spots: [] });
    // Nobody bets and everyone leaves: the window rolls over into idle.
    sim.seats.clear();
    sim.advance(BETTING_MS);
    expect(view(sim, null).phase).toBe('idle');
  });

  it('a seat leaving during betting gets its bet back', () => {
    const sim = multi([{ seat: 1, stack: 5_000 }]);
    sim.act(1, { type: 'bet', amount: 2500 });
    expect(engine.liveBets(sim.state, 1)).toBe(2500);
    sim.apply(engine.seatLeaving(sim.state, 1, sim.ctx()));
    expect(sim.stack(1)).toBe(5_000);
    expect(engine.liveBets(sim.state, 1)).toBe(0);
  });

  it('a seat leaving mid-round has its hands stood; they settle when the dealer plays', () => {
    const sim = multi([{ seat: 0, stack: 10_000 }, { seat: 2, stack: 10_000 }]);
    sim.act(0, { type: 'bet', amount: 2500 });
    sim.act(2, { type: 'bet', amount: 2500 });
    rig(sim, 'Ts Th 9d 8s 9h 7c 6s');
    sim.advance(BETTING_MS);
    // Seat 2 (19) walks away while seat 0 (18) is thinking.
    sim.apply(engine.seatLeaving(sim.state, 2, sim.ctx()));
    expect(engine.liveBets(sim.state, 2)).toBe(2500);
    expect(view(sim, null).turn).toEqual({ seat: 0, hand: 0 });
    sim.act(0, { type: 'stand' });
    // Dealer 9-7-6 = 22.
    expect(view(sim, null).phase).toBe('results');
    expect(sim.stack(2)).toBe(12_500);
    expect(engine.liveBets(sim.state, 2)).toBe(0);

    // And leaving on your own turn stands you and passes the turn along.
    const b = multi([{ seat: 0, stack: 10_000 }, { seat: 2, stack: 10_000 }]);
    b.act(0, { type: 'bet', amount: 2500 });
    b.act(2, { type: 'bet', amount: 2500 });
    rig(b, 'Ts Th 9d 8s 9h 7c 6s');
    b.advance(BETTING_MS);
    b.apply(engine.seatLeaving(b.state, 0, b.ctx()));
    expect(view(b, null).turn).toEqual({ seat: 2, hand: 0 });
  });
});

describe('blackjack money', () => {
  function playOut(sim: Sim, pick: (moves: Move[]) => Move, insure: () => boolean, seat = 0): void {
    for (let guard = 0; guard < 50; guard++) {
      const v = view(sim, seat);
      if (v.phase === 'insurance') sim.act(seat, { type: 'insurance', take: insure() });
      else if (v.phase === 'play' && v.turn?.seat === seat) sim.act(seat, { type: pick(v.moves) });
      else return;
    }
    throw new Error('round never finished');
  }

  it('random legal play for thousands of rounds: every chip is accounted for', () => {
    const start = 1_000_000_000;
    const sim = solo(start, 11);
    const rng = seededRng(12);
    const amounts = [2500, 2700, 5000, 12_300, 100_000];
    for (let i = 0; i < 4000; i++) {
      const bet = amounts[randInt(rng, amounts.length)]!;
      sim.act(0, { type: 'bet', amount: bet });
      sim.act(0, { type: 'deal' });
      playOut(sim, (moves) => moves[randInt(rng, moves.length)]!, () => randInt(rng, 2) === 0);
      const v = view(sim);
      expect(v.phase).toBe('results');
      expect(engine.liveBets(sim.state, 0)).toBe(0);
      const spot = v.spots[0]!;
      const last = sim.rounds.at(-1)!;
      expect(last).toEqual({ seat: 0, wagered: spot.wagered, returned: spot.returned });
      expect(spot.wagered).toBe(spot.hands.reduce((a, h) => a + h.bet, 0) + spot.insured);
      const insurancePaid = spot.returned - spot.hands.reduce((a, h) => a + h.payout, 0);
      expect([0, 3 * spot.insured]).toContain(insurancePaid);
      for (const h of spot.hands) {
        const total = handTotal(h.cards).total;
        const expected: Record<string, number> = { blackjack: h.bet * 2.5, win: h.bet * 2, evenmoney: h.bet * 2, push: h.bet, surrender: h.bet / 2, lose: 0, bust: 0 };
        expect(h.payout).toBe(expected[h.outcome!]);
        if (h.outcome === 'bust') expect(total).toBeGreaterThan(21);
        if (h.outcome === 'blackjack') expect(h.split || h.cards.length !== 2).toBe(false);
        if (h.splitAce) expect(h.cards).toHaveLength(2);
      }
    }
    const net = sim.rounds.reduce((a, r) => a + r.returned - r.wagered, 0);
    expect(sim.stack(0)).toBe(start + net);
  });

  it('several seats with random play and timeouts: each stack moves by exactly its own results', () => {
    const seats = [0, 1, 3, 6];
    const sim = multi(seats.map((seat) => ({ seat, stack: 5_000_000 })), 21);
    const rng = seededRng(22);
    for (let round = 0; round < 400; round++) {
      for (const seat of seats) if (randInt(rng, 4) > 0) sim.act(seat, { type: 'bet', amount: 2500 + 100 * randInt(rng, 50) });
      sim.advance(BETTING_MS);
      for (let guard = 0; guard < 200 && view(sim, null).phase !== 'results' && view(sim, null).phase !== 'betting'; guard++) {
        const v = view(sim, null);
        if (v.phase === 'insurance') {
          for (const s of v.spots) if (s.insurance === 'offered' && randInt(rng, 3) > 0) sim.act(s.seat, { type: 'insurance', take: randInt(rng, 2) === 0 });
          sim.advance(INSURANCE_MS);
        } else if (v.phase === 'play' && v.turn) {
          // Now and then a player lets the clock run out.
          if (randInt(rng, 10) === 0) sim.advance(TURN_MS);
          else {
            const moves = view(sim, v.turn.seat).moves;
            sim.act(v.turn.seat, { type: moves[randInt(rng, moves.length)]! });
          }
        }
      }
      for (const seat of seats) expect(engine.liveBets(sim.state, seat)).toBe(0);
      sim.advance(RESULTS_MS);
    }
    for (const seat of seats) {
      const net = sim.rounds.filter((r) => r.seat === seat).reduce((a, r) => a + r.returned - r.wagered, 0);
      expect(sim.stack(seat)).toBe(5_000_000 + net);
    }
    expect(sim.rounds.length).toBeGreaterThan(600);
  });

  it('the table and the Monte Carlo loop play identical rounds from the same shoe', () => {
    // The engine (through the host stand-in) and the bare rule core, fed the same seed, must
    // deal the same cards and reach the same result every round, reshuffles included. This is
    // what lets the Monte Carlo test stand for the table.
    const sim = new TableSim(engine, seededRng(42), 'solo', [{ seat: 0, stack: 1e12 }]) as Sim;
    const rng = seededRng(42);
    const d: Dealing = { shoe: openShoe(rng), rng, out: null };
    for (let i = 0; i < 5000; i++) {
      sim.act(0, { type: 'bet', amount: 2500 });
      sim.act(0, { type: 'deal' });
      for (let v = view(sim); v.phase === 'insurance' || v.phase === 'play'; v = view(sim)) {
        if (v.phase === 'insurance') sim.act(0, { type: 'insurance', take: false });
        else {
          const h = v.spots[0]!.hands[v.turn!.hand]!;
          const can = { double: v.moves.includes('double'), split: v.moves.includes('split'), surrender: v.moves.includes('surrender') };
          sim.act(0, { type: basicStrategy(h.cards, v.dealer[0]!, can) });
        }
      }
      const r = startRound([{ seat: 0, bet: 2500 }], d);
      if (r.stage === 'insurance') decideInsurance(r, 0, false, d);
      for (let c = current(r); c; c = current(r)) play(r, 0, basicStrategy(c.hand.cards, r.dealer[0]!, legalMoves(r, c.spot, c.hand)), d);

      const v = view(sim);
      expect(v.spots[0]!.hands.map((h) => h.cards)).toEqual(r.spots[0]!.hands.map((h) => h.cards));
      expect(v.dealer).toEqual(r.dealer);
      expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: r.spots[0]!.wagered, returned: r.spots[0]!.returned });
    }
  });
});
