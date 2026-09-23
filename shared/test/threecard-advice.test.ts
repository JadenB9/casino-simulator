import { describe, it, expect } from 'vitest';
import { newDeck, type Card } from '../src/cards.ts';
import { playAdvice } from '../src/games/threecard/advice.ts';
import { score, shouldPlay } from '../src/games/threecard/rules.ts';

const hand = (s: string): Card[] => s.split(' ') as Card[];

describe('three card poker tips', () => {
  it('advise Play exactly when the Q-6-4 rule plays, over all 22,100 hands', () => {
    const deck = newDeck();
    let hands = 0;
    let plays = 0;
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        for (let k = j + 1; k < deck.length; k++) {
          const cards = [deck[i]!, deck[j]!, deck[k]!];
          const a = playAdvice(cards);
          expect(a.play).toBe(shouldPlay(score(cards)));
          expect(a.text.startsWith(a.play ? 'Play: ' : 'Fold: ')).toBe(true);
          hands++;
          if (a.play) plays++;
        }
      }
    }
    expect(hands).toBe(22_100);
    // Q-6-4 or better: every pair and up (5,660), plus the high-card hands from Q-6-4.
    expect(plays).toBeGreaterThan(5_660);
    expect(plays).toBeLessThan(22_100);
  });

  it('gives the reason in the table words', () => {
    expect(playAdvice(hand('Qs 6d 4c'))).toEqual({ play: true, text: 'Play: Q-6-4 is the lowest hand worth playing' });
    expect(playAdvice(hand('Qs 6d 3c'))).toEqual({ play: false, text: 'Fold: Q-6-3 is below Q-6-4' });
    expect(playAdvice(hand('Qs 5d 4c'))).toEqual({ play: false, text: 'Fold: Q-5-4 is below Q-6-4' });
    expect(playAdvice(hand('Js Td 8c'))).toEqual({ play: false, text: 'Fold: J-10-8 is below Q-6-4' });
    expect(playAdvice(hand('Ks 9d 3c'))).toEqual({ play: true, text: 'Play: K-9-3 beats Q-6-4' });
    expect(playAdvice(hand('2s 2d 3c'))).toEqual({ play: true, text: 'Play: a Pair of Twos beats Q-6-4' });
    expect(playAdvice(hand('2s 7s Js'))).toEqual({ play: true, text: 'Play: a Flush beats Q-6-4' });
    expect(playAdvice(hand('7s 7d 7c'))).toEqual({ play: true, text: 'Play: Three Sevens beats Q-6-4' });
    expect(playAdvice(hand('As Ks Qs'))).toEqual({ play: true, text: 'Play: a Straight flush beats Q-6-4' });
  });
});
