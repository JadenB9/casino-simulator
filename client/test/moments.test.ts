import { describe, it, expect } from 'vitest';
import type { Card } from '../../shared/src/cards.ts';
import type { HandView, SpotView } from '../../shared/src/games/blackjack/protocol.ts';
import { DEFAULT_PAYTABLE, score, settle } from '../../shared/src/games/threecard/rules.ts';
import { coupOf, settleBets, type Bets } from '../../shared/src/games/baccarat/rules.ts';
import { roundMoment } from '../src/games/blackjack/moments.ts';
import { handMoment } from '../src/games/threecard/moments.ts';
import { coupMoment } from '../src/games/baccarat/moments.ts';

const cards = (s: string): Card[] => s.split(' ') as Card[];

// ---- blackjack ---------------------------------------------------------------------------------

function hand(outcome: HandView['outcome'], bet: number, payout: number, extra: Partial<HandView> = {}): HandView {
  return { cards: [], bet, doubled: false, split: false, splitAce: false, done: true, outcome, payout, ...extra };
}
function spot(hands: HandView[]): SpotView {
  const wagered = hands.reduce((t, h) => t + h.bet, 0);
  const returned = hands.reduce((t, h) => t + h.payout, 0);
  return { seat: 0, base: hands[0]!.bet, hands, insurance: 'none', insured: 0, wagered, returned };
}

describe('blackjack celebrations', () => {
  it('a blackjack paid 3 to 2 is big; even money is nice', () => {
    expect(roundMoment(spot([hand('blackjack', 2500, 6250)]))).toEqual({ m: { title: 'Blackjack', sub: 'Pays 3 to 2 · +$37.50', tier: 'big' }, hands: [0] });
    expect(roundMoment(spot([hand('evenmoney', 2500, 5000)]))?.m.tier).toBe('nice');
  });

  it('a winning double and a split that comes out ahead are nice, with the winning hands lit', () => {
    expect(roundMoment(spot([hand('win', 5000, 10000, { doubled: true })]))).toEqual({ m: { title: 'Double down', sub: 'Pays 1 to 1 · +$50', tier: 'nice' }, hands: [0] });
    const split = spot([hand('win', 2500, 5000, { split: true }), hand('push', 2500, 2500, { split: true }), hand('win', 2500, 5000, { split: true })]);
    expect(roundMoment(split)).toEqual({ m: { title: 'Split', sub: '2 of 3 hands win · +$50', tier: 'nice' }, hands: [0, 2] });
  });

  it('never for a plain win, a push, or a round that gives back no more than it took', () => {
    expect(roundMoment(spot([hand('win', 2500, 5000)]))).toBeNull();
    expect(roundMoment(spot([hand('push', 2500, 2500)]))).toBeNull();
    // one split hand won, one lost: back to even
    expect(roundMoment(spot([hand('win', 2500, 5000, { split: true }), hand('lose', 2500, 0, { split: true })]))).toBeNull();
    // a double lost next to a win: behind overall
    expect(roundMoment(spot([hand('win', 2500, 5000, { split: true }), hand('lose', 5000, 0, { split: true, doubled: true })]))).toBeNull();
  });
});

// ---- Three Card Poker ----------------------------------------------------------------------------

const ANTE = { ante: 2500, play: 2500, pairPlus: 500 };
function tc(player: string, dealer: string, bets = ANTE) {
  const p = cards(player);
  return handMoment(settle(bets, score(p), score(cards(dealer)), DEFAULT_PAYTABLE), p, DEFAULT_PAYTABLE);
}

describe('three card poker celebrations', () => {
  it('Pair Plus on a straight or three of a kind is big, with the Ante Bonus named', () => {
    expect(tc('9s Td Jc', 'Kd 7h 2s')).toEqual({ title: 'Straight', sub: 'Pair Plus 6 to 1 · Ante Bonus 1 to 1 · +$105', tier: 'big' });
    expect(tc('7s 7d 7c', 'Kd 7h 2s')?.tier).toBe('big');
  });

  it('a straight flush is huge, and the suited A-K-Q is a mini royal', () => {
    expect(tc('9s Ts Js', 'Kd 7h 2s')?.tier).toBe('huge');
    expect(tc('As Ks Qs', 'Kd 7h 2s')).toEqual({ title: 'Mini royal', sub: 'Pair Plus 40 to 1 · Ante Bonus 5 to 1 · +$375', tier: 'huge' });
  });

  it('an Ante Bonus alone: a straight is nice, three of a kind big', () => {
    const noPP = { ante: 2500, play: 2500, pairPlus: 0 };
    expect(tc('9s Td Jc', 'Kd 7h 2s', noPP)).toEqual({ title: 'Straight', sub: 'Ante Bonus 1 to 1 · +$75', tier: 'nice' });
    expect(tc('7s 7d 7c', 'Kd 7h 2s', noPP)?.tier).toBe('big');
  });

  it('never below a straight, and never when the hand gives back no more than it took', () => {
    expect(tc('Ks Kd 4c', 'Qd 7h 2s')).toBeNull(); // pair: Pair Plus pays, no celebration
    expect(tc('2s 7s Js', 'Qd 7h 2s')).toBeNull(); // flush
    // a straight that loses to a straight flush with no Pair Plus: the bonus gives back only the Ante
    expect(tc('9s Td Jc', 'Qh Kh Ah', { ante: 2500, play: 2500, pairPlus: 0 })).toBeNull();
  });
});

// ---- baccarat -------------------------------------------------------------------------------------

function bc(player: string, banker: string, bets: Bets) {
  const coup = coupOf(cards(player), cards(banker));
  return coupMoment(settleBets(bets, coup), coup);
}

describe('baccarat celebrations', () => {
  it('a pair bet that hits is big, and lights that hand', () => {
    // Player K-K-9 beats Banker 5: the Banker bet loses $25, the pair wins $55
    expect(bc('Ks Kd 9c', 'Qd 5h', { banker: 2500, playerPair: 500 })).toEqual({ m: { title: 'Player pair', sub: 'Pays 11 to 1 · +$30', tier: 'big' }, hands: ['player'] });
    expect(bc('4s 4d', '9d 9h', { playerPair: 500, bankerPair: 500 })?.m.title).toBe('Both pairs');
  });

  it('a winning bet on a natural is nice', () => {
    expect(bc('4s 5d', 'Qd 7h', { player: 2500 })).toEqual({ m: { title: 'Natural 9', sub: 'Player wins · +$25', tier: 'nice' }, hands: ['player'] });
    expect(bc('4s 3d', '6d 2h', { banker: 2500 })?.m).toEqual({ title: 'Natural 8', sub: 'Banker wins · +$23.75', tier: 'nice' });
  });

  it('never for a natural you bet against, a tie, a win without a natural, or a return at or below the stake', () => {
    expect(bc('4s 5d', 'Qd 7h', { banker: 2500 })).toBeNull();
    expect(bc('4s 4d', '9d 7h', { tie: 500 })).toBeNull(); // Player 8 over Banker 6: the Tie bet loses
    expect(bc('4s 4c', '5d 3h', { player: 2500 })).toBeNull(); // 8 each: a tie pushes the Player bet
    expect(bc('2s 3d 2c', 'Td 4h 2s', { player: 2500 })).toBeNull(); // Player 7 over Banker 6, no natural
    // the pair hits but the big Banker bet beside it loses more
    expect(bc('Ks Kd 9c', 'Qd 5h', { banker: 10000, playerPair: 500 })).toBeNull();
  });
});
