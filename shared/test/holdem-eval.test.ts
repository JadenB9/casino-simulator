import { describe, it, expect } from 'vitest';
import {
  evaluate,
  cardInt,
  intCard,
  handName,
  bestFive,
  categoryOf,
  HIGH_CARD,
  PAIR,
  TWO_PAIR,
  TRIPS,
  STRAIGHT,
  FLUSH,
  FULL_HOUSE,
  QUADS,
  STRAIGHT_FLUSH,
} from '../src/games/holdem/eval.ts';
import type { Card } from '../src/cards.ts';
import { seededRng } from './helpers/seeded.ts';
import { randInt } from '../src/rng.ts';

const v = (...cards: string[]) => evaluate(cards.map((c) => cardInt(c as Card)));

describe('holdem evaluator', () => {
  it('converts cards both ways', () => {
    for (let n = 0; n < 52; n++) expect(cardInt(intCard(n))).toBe(n);
    expect(intCard(cardInt('As'))).toBe('As');
    expect(cardInt('2s') >> 2).toBe(0);
    expect(cardInt('Ac') >> 2).toBe(12);
  });

  it('counts every 5-card hand by category, and finds exactly 7,462 distinct values', () => {
    // Wikipedia's poker probability table; royal flushes are straight flushes topped by an ace.
    const counts = new Array(9).fill(0);
    let royals = 0;
    const seen = new Set<number>();
    const hand = new Int32Array(5);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              hand[0] = a;
              hand[1] = b;
              hand[2] = c;
              hand[3] = d;
              hand[4] = e;
              const x = evaluate(hand, 5);
              counts[categoryOf(x)]++;
              if (categoryOf(x) === STRAIGHT_FLUSH && ((x >> 16) & 15) === 12) royals++;
              seen.add(x);
            }
    expect(royals).toBe(4);
    expect(counts[STRAIGHT_FLUSH] - royals).toBe(36);
    expect(counts[QUADS]).toBe(624);
    expect(counts[FULL_HOUSE]).toBe(3_744);
    expect(counts[FLUSH]).toBe(5_108);
    expect(counts[STRAIGHT]).toBe(10_200);
    expect(counts[TRIPS]).toBe(54_912);
    expect(counts[TWO_PAIR]).toBe(123_552);
    expect(counts[PAIR]).toBe(1_098_240);
    expect(counts[HIGH_CARD]).toBe(1_302_540);
    expect(seen.size).toBe(7_462);
  });

  it('matches the 7-card category probabilities on a large random sample (3 SE)', () => {
    // Best five of seven, from the rules doc (Wikipedia). The full 133,784,560-hand enumeration
    // runs in the Monte Carlo suite; this keeps the everyday suite honest in a second.
    const p = [0.1741192, 0.43822546, 0.23495536, 0.0482987, 0.04619382, 0.03025494, 0.02596102, 0.00168067, 0.00031083];
    const rng = seededRng(7);
    const n = 400_000;
    const counts = new Array(9).fill(0);
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const seven = new Int32Array(7);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 7; k++) {
        const j = k + randInt(rng, 52 - k);
        const t = deck[k]!;
        deck[k] = deck[j]!;
        deck[j] = t;
        seven[k] = deck[k]!;
      }
      counts[categoryOf(evaluate(seven, 7))]++;
    }
    for (let c = 0; c < 9; c++) {
      const se = Math.sqrt((p[c]! * (1 - p[c]!)) / n);
      expect(Math.abs(counts[c]! / n - p[c]!)).toBeLessThanOrEqual(3 * se + 1e-9);
    }
  });

  it('ranks categories in order', () => {
    const hands = [
      ['As', 'Kd', '9c', '7h', '3s'],
      ['As', 'Ad', '9c', '7h', '3s'],
      ['As', 'Ad', '9c', '9h', '3s'],
      ['As', 'Ad', 'Ac', '9h', '3s'],
      ['5s', '4d', '3c', '2h', 'As'],
      ['As', 'Js', '9s', '7s', '3s'],
      ['As', 'Ad', 'Ac', '3h', '3s'],
      ['As', 'Ad', 'Ac', 'Ah', '3s'],
      ['5h', '4h', '3h', '2h', 'Ah'],
    ];
    const vals = hands.map((h) => v(...h));
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]!);
  });

  it('treats the wheel as the lowest straight and never wraps around', () => {
    expect(categoryOf(v('As', '2d', '3c', '4h', '5s'))).toBe(STRAIGHT);
    expect(v('As', '2d', '3c', '4h', '5s')).toBeLessThan(v('2d', '3c', '4h', '5s', '6d'));
    expect(categoryOf(v('Qs', 'Kd', 'Ac', '2h', '3s'))).toBe(HIGH_CARD);
    expect(handName(v('As', '2d', '3c', '4h', '5s'))).toBe('Straight, Five high');
    // steel wheel: a five-high straight flush, which beats the ace-high flush in the same cards
    expect(handName(v('Ah', '2h', '3h', '4h', '5h', 'Kh', 'Qh'))).toBe('Straight Flush, Five high');
    expect(handName(v('Ah', '2h', '3h', '4h', '5h', 'Kd', 'Qc'))).toBe('Straight Flush, Five high');
    expect(handName(v('Ah', '2h', '3h', '4h', '5d', 'Kh', 'Qc'))).toBe('Flush, Ace high');
    // six to the ten beats the wheel when both are there
    expect(handName(v('As', '2d', '3c', '4h', '5s', '6d', 'Kc'))).toBe('Straight, Six high');
  });

  it('decides ties by kickers, and only the best five cards count', () => {
    // pair of aces: king kicker beats queen kicker
    expect(v('As', 'Ad', 'Kc', '7h', '4s', '3d', '2c')).toBeGreaterThan(v('Ah', 'Ac', 'Qc', 'Jh', '9s', '3d', '2c'));
    // the sixth and seventh cards never break a tie: both play A-K-Q-J-9 high
    expect(v('As', 'Kd', 'Qc', 'Jh', '9s', '3d', '2c')).toBe(v('Ah', 'Kc', 'Qd', 'Js', '9h', '4d', '3c'));
    // board plays: both players play the same straight on the board and split
    const board = ['Ts', 'Jd', 'Qc', 'Kh', 'Ac'];
    expect(v(...board, '2s', '3d')).toBe(v(...board, '4c', '7h'));
    // two pair: the kicker decides; a third pair can be the kicker
    expect(v('Ks', 'Kd', '9c', '9h', '4s', '4d', 'Ac')).toBeGreaterThan(v('Kh', 'Kc', '9s', '9d', 'Qs', '4h', '2c'));
    expect(v('Ks', 'Kd', '9c', '9h', '8s', '8d', '2c')).toBe(v('Kh', 'Kc', '9s', '9d', '8c', '3h', '2d'));
    // full house: trips first, then the pair; two sets make trips full of the lower set
    expect(v('9s', '9d', '9c', 'Kh', 'Ks')).toBeGreaterThan(v('8s', '8d', '8c', 'Ah', 'As'));
    expect(handName(v('9s', '9d', '9c', '4h', '4s', '4d', '2c'))).toBe('Full House, Nines full of Fours');
    // quads: the kicker counts
    expect(v('7s', '7d', '7c', '7h', 'Ks')).toBeGreaterThan(v('7s', '7d', '7c', '7h', 'Qs'));
    // flush: all five cards, top down
    expect(v('As', 'Js', '9s', '7s', '4s')).toBeGreaterThan(v('Ad', 'Jd', '9d', '7d', '3d'));
    // straight: highest card only; suits never matter
    expect(v('9s', 'Td', 'Jc', 'Qh', 'Ks')).toBe(v('9h', 'Tc', 'Jd', 'Qs', 'Kc'));
  });

  it('names hands the way a dealer calls them', () => {
    expect(handName(v('Ts', 'Js', 'Qs', 'Ks', 'As'))).toBe('Royal Flush');
    expect(handName(v('5s', '6s', '7s', '8s', '9s'))).toBe('Straight Flush, Nine high');
    expect(handName(v('Ks', 'Kd', 'Kc', 'Kh', '2s'))).toBe('Four of a Kind, Kings');
    expect(handName(v('Ks', 'Kd', '9c', '9h', '4s'))).toBe('Two Pair, Kings and Nines');
    expect(handName(v('Ks', 'Kd', '9c', '7h', '4s'))).toBe('Pair of Kings');
    expect(handName(v('Ks', 'Jd', '9c', '7h', '4s'))).toBe('King High');
    expect(handName(v('6s', '6d', '6c', '7h', '4s'))).toBe('Three of a Kind, Sixes');
  });

  it('picks the five cards that make the hand', () => {
    const cards = ['As', 'Ad', 'Kc', 'Kh', '4s', '4d', '2c'].map((c) => cardInt(c as Card));
    const five = bestFive(cards).map(intCard);
    expect(five).toHaveLength(5);
    expect(five.filter((c) => ['As', 'Ad', 'Kc', 'Kh'].includes(c))).toHaveLength(4);
    expect(five.some((c) => c === '4s' || c === '4d')).toBe(true);
    expect(evaluate(bestFive(cards), 5)).toBe(evaluate(cards));
    expect(bestFive(cards)).not.toContain(cardInt('2c'));
  });
});
