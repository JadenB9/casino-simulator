import { describe, it, expect } from 'vitest';
import type { Card } from '../../shared/src/cards.ts';
import { cardInt, evaluate } from '../../shared/src/games/holdem/eval.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';
import { advise, bannerOf, distOf, drawsOf, estimateEquity, madeName, onBoard, positionOf, potOdds, readHand, startName, type Spot } from '../src/games/holdem/advice.ts';

const cards = (s: string) => (s ? s.split(' ') : []) as Card[];
const ints = (s: string) => cards(s).map(cardInt);

describe('holdem tips: reading the hand', () => {
  it('names starting hands the way players say them', () => {
    expect(startName('Kh', 'Kd')).toBe('Pocket kings');
    expect(startName('As', 'Ks')).toBe('Ace-king suited');
    expect(startName('7c', '2d')).toBe('Seven-two offsuit');
    expect(startName('2c', 'Ad')).toBe('Ace-two offsuit');
    expect(startName('Ts', '9s')).toBe('Ten-nine suited');
  });

  it('names made hands in sentence case', () => {
    const name = (h: string, b: string) => readHand(cards(h), cards(b));
    expect(name('Kh Kd', '7c 2s 9h')).toBe('Pair of kings');
    expect(name('Kh 9c', 'Kd 9s 2h')).toBe('Two pair, kings and nines');
    expect(name('7h 7c', '7d Ks 2h')).toBe('Three of a kind, sevens');
    expect(name('Ah 2c', '3d 4s 5h')).toBe('Straight, five high');
    expect(name('Ah 5h', 'Kh 9h 2h')).toBe('Flush, ace high');
    expect(name('Kh Kc', 'Kd 9s 9h')).toBe('Full house, kings full of nines');
    expect(name('Qh Qc', 'Qd Qs 2h')).toBe('Four of a kind, queens');
    expect(name('9h 8h', '7h 6h 5h')).toBe('Straight flush, nine high');
    expect(name('Ah Kh', 'Qh Jh Th')).toBe('Royal flush');
    expect(name('Ah 3c', '9d 7s 2h Jc Tc')).toBe('Ace high');
  });

  it('says when the hand is all on the board', () => {
    expect(readHand(cards('Ah 3c'), cards('Kd Ks 7h'))).toBe('Pair of kings on the board');
    expect(readHand(cards('2c 3d'), cards('5h 6s 7d 8c 9h'))).toBe('Straight, nine high on the board');
    expect(readHand(cards('Kc 3d'), cards('Kd Ks 7h'))).toBe('Three of a kind, kings');
    const h = ints('Ah 3c');
    const b = ints('Kd Ks 7h 7c');
    expect(onBoard(h, b, evaluate([...h, ...b]))).toBe(true);
  });

  it('finds draws that use a hole card', () => {
    expect(readHand(cards('Ah 5h'), cards('Kh 9h 2c'))).toBe('Flush draw');
    expect(readHand(cards('Kh Qh'), cards('Kd 9h 2h'))).toBe('Pair of kings, flush draw');
    expect(readHand(cards('8c 9d'), cards('Ts Jh 2c'))).toBe('Open-ended straight draw');
    expect(readHand(cards('9c 7d'), cards('Jh Ts 2c'))).toBe('Gutshot straight draw');
    expect(readHand(cards('7c 9d'), cards('Tc Jh Ks'))).toBe('Double gutshot straight draw');
    expect(readHand(cards('8h 9h'), cards('Th Jc 2h'))).toBe('Flush and straight draw');
    // Four to a flush all on the board, or a straight the board makes alone, is nobody's draw.
    expect(drawsOf(ints('Ac 2d'), ints('Kh 9h 5h 3h'))).toEqual({ flush: false, straight: 'gutshot' });
    expect(drawsOf(ints('2c 2d'), ints('9h Ts Jd Qc')).straight).toBe(null);
    // A finished board and a made straight have no draws.
    expect(drawsOf(ints('8c 9d'), ints('Ts Jh 2c 4d 5s'))).toEqual({ flush: false, straight: null });
    expect(drawsOf(ints('8c 9d'), ints('Ts Jh Qc'))).toEqual({ flush: false, straight: null });
  });

  it('splits a made hand for the banner', () => {
    expect(bannerOf(evaluate(ints('Kh Kc Kd 9s 9h')))).toEqual({ title: 'Full house', sub: 'Kings full of nines' });
    expect(bannerOf(evaluate(ints('Ah Kh Qh Jh Th')))).toEqual({ title: 'Royal flush', sub: null });
    expect(madeName(evaluate(ints('7h 7c 7d Ks 2h')))).toBe('Three of a kind, sevens');
  });
});

describe('holdem tips: equity', () => {
  // Exact all-in equities (a tie counts half) from full enumeration: PokerStove / ProPokerTools.
  const check = (hole: string, board: string, opponents: number, published: number, seed: number) => {
    const n = 40_000;
    const eq = estimateEquity(cards(hole), cards(board), Array.from({ length: opponents }, () => ({ strong: false })), seededRng(seed), { min: n, max: n });
    const se = Math.sqrt((published * (1 - published)) / n);
    const z = (eq - published) / se;
    console.log(`${hole} vs ${opponents} random${board ? ` on ${board}` : ''}: measured ${(eq * 100).toFixed(2)}%, published ${(published * 100).toFixed(2)}%, SE ${(se * 100).toFixed(3)}, z ${z.toFixed(2)}, N ${n}`);
    expect(Math.abs(z)).toBeLessThanOrEqual(3);
  };

  it('pocket aces win about 85% against one random hand', () => check('As Ah', '', 1, 0.8520, 1));
  it('ace-king suited wins about 67% against one random hand', () => check('As Ks', '', 1, 0.6704, 2));
  it('seven-two offsuit wins about 35% against one random hand', () => check('7s 2h', '', 1, 0.3458, 3));
  it('pocket aces win about 73% against two random hands', () => check('As Ah', '', 2, 0.7339, 4));

  it('is certain with the nuts on the river and answers quickly', () => {
    const t0 = performance.now();
    const eq = estimateEquity(cards('Ah Kh'), cards('Qh Jh Th 2c 3d'), [{ strong: false }, { strong: false }], seededRng(5));
    expect(eq).toBe(1);
    expect(estimateEquity(cards('Ah Kh'), cards(''), [], seededRng(6))).toBe(1);
    // The default run (400 deals and up to 2,000 while there's time) stays well inside a frame budget.
    const opp = Array.from({ length: 5 }, () => ({ strong: false }));
    const t1 = performance.now();
    estimateEquity(cards('9s 9h'), cards('Kd 7c 2h'), opp, seededRng(7));
    expect(performance.now() - t1).toBeLessThan(40);
    expect(performance.now() - t0).toBeLessThan(80);
  });
});

describe('holdem tips: the play', () => {
  const spot = (o: Partial<Spot>): Spot => ({
    hole: cards('Kh Qh'),
    board: cards('Kd 9h 2h'),
    opponents: 2,
    call: 25_00,
    total: 75_00,
    behind: 900_00,
    canRaise: true,
    opening: false,
    position: 'middle',
    raises: 0,
    ...o,
  });

  it('works out the pot odds', () => {
    expect(potOdds(25, 75)).toBe(0.25);
    expect(potOdds(0, 75)).toBe(0);
    expect(potOdds(50, 50)).toBe(0.5);
  });

  it('calls when the chance beats the price, folds when it does not, raises when far ahead', () => {
    expect(advise(spot({}), 0.41)).toEqual({ text: 'Pair of kings, flush draw. Calling needs 25%, you have about 41% against 2 players: call.', pick: 'call' });
    expect(advise(spot({ opponents: 1 }), 0.2)).toEqual({ text: 'Pair of kings, flush draw. Calling needs 25%, you have about 20%: fold.', pick: 'fold' });
    expect(advise(spot({}), 0.8).pick).toBe('raise');
    expect(advise(spot({ canRaise: false }), 0.8).pick).toBe('call');
    // Rounded numbers decide, so the line never contradicts itself.
    expect(advise(spot({ call: 33_00, total: 67_00 }), 0.3349).pick).toBe('call');
    expect(advise(spot({ call: 33_00, total: 67_00 }), 0.3249).pick).toBe('fold');
  });

  it('bets or checks when there is nothing to call', () => {
    const free = spot({ call: 0, opening: true, opponents: 1 });
    expect(advise(free, 0.7)).toEqual({ text: 'Pair of kings, flush draw. Nothing to call, you have about 70%: bet.', pick: 'raise' });
    expect(advise(free, 0.5)).toEqual({ text: 'Pair of kings, flush draw. Nothing to call, you have about 50%: check.', pick: 'check' });
    expect(advise({ ...free, canRaise: false }, 0.9).pick).toBe('check');
  });

  it('plays the opening charts by seat before the flop', () => {
    const pre = (hole: string, o: Partial<Spot> = {}) => advise(spot({ hole: cards(hole), board: [], call: 10_00, total: 15_00, opponents: 5, position: 'early', ...o }), 0.3);
    expect(pre('As Ah')).toEqual({ text: 'Pocket aces, a premium hand. You have about 30% against 5 players: raise.', pick: 'raise' });
    expect(pre('7c 2d').pick).toBe('fold');
    expect(pre('7c 2d', { position: 'bb', call: 0 }).pick).toBe('check');
    expect(pre('Kc Td', { position: 'late' }).pick).toBe('raise');
    expect(pre('Kc Td', { position: 'early' }).pick).toBe('fold');
    // Facing a raise: the top of the raiser's range re-raises, the next slice calls a normal price, the rest fold.
    expect(pre('Qs Qh', { raises: 1, call: 30_00, total: 45_00 }).pick).toBe('raise');
    expect(pre('Js Ts', { raises: 1, call: 30_00, total: 45_00 }).pick).toBe('call');
    expect(pre('Js Ts', { raises: 1, call: 800_00, total: 815_00, behind: 900_00 }).pick).toBe('fold');
    expect(pre('8s 6s', { raises: 1, call: 30_00, total: 45_00 }).pick).toBe('fold');
    expect(pre('8s 6s', { raises: 1, call: 20_00, total: 55_00, position: 'bb' }).pick).toBe('call');
    expect(pre('8s 6s', { raises: 1, call: 40_00, total: 55_00, position: 'bb' }).pick).toBe('fold');
    // the charts by seat: the button opens suited kings, under the gun nine handed doesn't
    expect(pre('Ks 6s', { dist: 0, position: 'late' }).pick).toBe('raise');
    expect(pre('Ks 6s', { dist: 6, players: 9 }).pick).toBe('fold');
    expect(pre('2s 2h', { dist: 3 }).pick).toBe('raise');
    // A re-raise that can't be made becomes a call.
    expect(pre('Ks Kh', { raises: 2, call: 900_00, total: 1_000_00, behind: 900_00, canRaise: false }).pick).toBe('call');
  });

  it('places seats the way the engine places its bots', () => {
    const dealt = [0, 1, 2, 3, 4, 5];
    expect(positionOf(0, dealt, 0, 1, 2)).toBe('late');
    expect(positionOf(1, dealt, 0, 1, 2)).toBe('sb');
    expect(positionOf(2, dealt, 0, 1, 2)).toBe('bb');
    expect(positionOf(3, dealt, 0, 1, 2)).toBe('early');
    expect(positionOf(4, dealt, 0, 1, 2)).toBe('middle');
    expect(positionOf(5, dealt, 0, 1, 2)).toBe('late');
    // Wrapping past the last seat.
    expect(positionOf(0, [0, 2, 4, 6], 4, 6, 0)).toBe('bb');
    expect(positionOf(2, [0, 2, 4, 6], 4, 6, 0)).toBe('late');
    // and counts seats to the button for the charts
    expect(distOf(0, dealt, 0, 1, 2)).toBe(0);
    expect(distOf(5, dealt, 0, 1, 2)).toBe(1);
    expect(distOf(3, dealt, 0, 1, 2)).toBe(3);
    expect(distOf(1, dealt, 0, 1, 2)).toBe(-1);
    expect(distOf(4, [4, 6], 4, 4, 6)).toBe(0);
  });
});
