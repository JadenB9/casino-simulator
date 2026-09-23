import { describe, it, expect } from 'vitest';
import type { Card } from '../src/cards.ts';
import { advise, insuranceAdvice, upCardWords, type Can } from '../src/games/blackjack/advice.ts';
import { basicStrategy } from '../src/games/blackjack/strategy.ts';
import { handTotal } from '../src/games/blackjack/rules.ts';

const cards = (s: string): Card[] => s.split(' ') as Card[];
const ALL: Can = { double: true, split: true, surrender: true };
const UPS: Card[] = ['2c', '3c', '4c', '5c', '6c', '7c', '8c', '9c', 'Tc', 'Jc', 'Qc', 'Kc', 'Ac'];
const RANKS = 'A23456789TJQK';

describe('blackjack tips', () => {
  it('always advise the chart move, for every two- and three-card hand, up card and allowed move set', () => {
    const cans: Can[] = [];
    for (const double of [true, false]) for (const split of [true, false]) for (const surrender of [true, false]) cans.push({ double, split, surrender });
    let checked = 0;
    const hands: Card[][] = [];
    for (const a of RANKS) for (const b of RANKS) hands.push([`${a}s`, `${b}d`] as Card[]);
    for (const a of RANKS) for (const b of RANKS) for (const c of RANKS) hands.push([`${a}s`, `${b}d`, `${c}h`] as Card[]);
    for (const hand of hands) {
      if (handTotal(hand).total >= 21) continue; // 21 stands itself; over 21 is already settled
      for (const up of UPS) {
        for (const can of cans) {
          const a = advise(hand, up, can);
          expect(a.move, `${hand.join(' ')} vs ${up}`).toBe(basicStrategy(hand, up, can));
          expect(a.text.startsWith('Basic strategy: ')).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100_000);
  });

  it('says the move, the hand and the up card', () => {
    expect(advise(cards('5d 6h'), '6c', ALL).text).toBe('Basic strategy: double 11 against a 6');
    expect(advise(cards('8s 8d'), 'Tc', ALL).text).toBe('Basic strategy: split 8s against a 10');
    expect(advise(cards('As Ad'), 'Kc', ALL).text).toBe('Basic strategy: split aces against a 10');
    expect(advise(cards('9s 7d'), 'Ac', ALL).text).toBe('Basic strategy: surrender 16 against an ace');
    expect(advise(cards('Ts 6d'), '8c', ALL).text).toBe('Basic strategy: hit 16 against an 8');
    expect(advise(cards('As 6d'), '3c', ALL).text).toBe('Basic strategy: double soft 17 against a 3');
    expect(advise(cards('As 7d'), '2c', ALL).text).toBe('Basic strategy: stand on soft 18 against a 2');
    expect(advise(cards('Ts Kd'), '6c', ALL).text).toBe('Basic strategy: stand on 20 against a 6');
    // 5-5 is never split: it plays as a hard 10, with no note.
    expect(advise(cards('5s 5d'), '6c', ALL).text).toBe('Basic strategy: double 10 against a 6');
  });

  it('names the fallback when the chart move is not open', () => {
    const noDouble = { double: false, split: false, surrender: false };
    expect(advise(cards('4d 3h 4c'), '6c', noDouble)).toEqual({ move: 'hit', text: "Basic strategy: hit 11 against a 6 (can't double now)" });
    expect(advise(cards('As 3d 4h'), '4c', noDouble)).toEqual({ move: 'stand', text: "Basic strategy: stand on soft 18 against a 4 (can't double now)" });
    expect(advise(cards('6d 4h 6c'), 'Tc', noDouble)).toEqual({ move: 'hit', text: "Basic strategy: hit 16 against a 10 (can't surrender now)" });
    // Four hands already, or not the chips to split: 8-8 plays as a hard 16.
    expect(advise(cards('8s 8d'), 'Tc', { double: true, split: false, surrender: false })).toEqual({ move: 'hit', text: "Basic strategy: hit 16 against a 10 (can't split now)" });
    expect(advise(cards('8s 8d'), '6c', { double: true, split: false, surrender: false })).toEqual({ move: 'stand', text: "Basic strategy: stand on 16 against a 6 (can't split now)" });
    // Not enough chips to double, on two cards.
    expect(advise(cards('6d 5h'), '5c', { double: false, split: false, surrender: true }).text).toBe("Basic strategy: hit 11 against a 5 (can't double now)");
  });

  it('reads the up card the way a dealer says it', () => {
    expect(UPS.map(upCardWords)).toEqual(['a 2', 'a 3', 'a 4', 'a 5', 'a 6', 'a 7', 'an 8', 'a 9', 'a 10', 'a 10', 'a 10', 'a 10', 'an ace']);
  });

  it('never takes insurance or even money', () => {
    expect(insuranceAdvice(false)).toBe('Basic strategy never takes insurance');
    expect(insuranceAdvice(true)).toBe('Basic strategy never takes even money');
  });
});
