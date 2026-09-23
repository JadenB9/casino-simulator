import { describe, it, expect } from 'vitest';
import { newDeck, newShoe, draw, cutCardOut, cardsLeft, isCard, rankHigh, rankNumber } from '../src/cards.ts';
import { seededRng } from './helpers/seeded.ts';

describe('cards', () => {
  it('a deck has 52 distinct valid cards', () => {
    const d = newDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
    expect(d.every(isCard)).toBe(true);
  });

  it('ranks', () => {
    expect(rankNumber('As')).toBe(1);
    expect(rankHigh('As')).toBe(14);
    expect(rankNumber('Kd')).toBe(13);
    expect(rankNumber('Th')).toBe(10);
    expect(isCard('1s')).toBe(false);
    expect(isCard('Ax')).toBe(false);
  });

  it('a 6-deck shoe holds 6 of every card, with the cut card at 75%', () => {
    const shoe = newShoe(seededRng(5), 6, 0.75);
    expect(shoe.cards).toHaveLength(312);
    const counts = new Map<string, number>();
    for (const c of shoe.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 6)).toBe(true);
    expect(shoe.cutAt).toBe(234);
  });

  it('deals in order and reports the cut card', () => {
    const shoe = newShoe(seededRng(9), 1, 0.5);
    const first = shoe.cards[0];
    expect(draw(shoe)).toBe(first);
    while (!cutCardOut(shoe)) draw(shoe);
    expect(shoe.pos).toBe(26);
    expect(cardsLeft(shoe)).toBe(26);
  });

  it('jitters the cut card within bounds', () => {
    for (let s = 0; s < 50; s++) {
      const shoe = newShoe(seededRng(s), 8, 0.75, 8);
      expect(shoe.cutAt).toBeGreaterThanOrEqual(312 - 8);
      expect(shoe.cutAt).toBeLessThanOrEqual(312 + 8);
    }
  });
});
