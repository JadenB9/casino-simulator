import { describe, it, expect } from 'vitest';
import type { Card } from '../../shared/src/cards.ts';
import { cardNumber, payCredits, PAY_PER_COIN, ROYAL_FLUSH, MAX_COINS } from '../../shared/src/games/videopoker/hands.ts';
import { HOLD_LIST, FOOTNOTES, bestHold } from '../../shared/src/games/videopoker/strategy.ts';
import { holdAdvice, holdName, betAdvice } from '../src/games/videopoker/advice.ts';

const cards = (s: string) => s.split(' ') as Card[];
const maskOf = (deal: string, keep: string) => {
  const k = new Set(keep.split(' ').filter(Boolean));
  return cards(deal).reduce((m, c, i) => (k.has(c) ? m | (1 << i) : m), 0);
};

describe('video poker tips', () => {
  it('rings the hold the strategy list gives, on every line and footnote', () => {
    for (const l of HOLD_LIST) {
      const a = holdAdvice(cards(l.deal));
      expect(a.mask, `line ${l.line}`).toBe(maskOf(l.deal, l.keep));
      expect(a.mask).toBe(bestHold(cards(l.deal).map(cardNumber)));
      expect(a.text, `line ${l.line}`).toContain(l.hold);
    }
    for (const f of FOOTNOTES) expect(holdAdvice(cards(f.deal)).mask, `footnote ${f.id}`).toBe(maskOf(f.deal, f.keep));
  });

  it('names the hold in a short line', () => {
    expect(holdAdvice(cards('Jh Js Qh Kh 2c')).text).toBe('Best hold: J♥ J♠ · High pair (jacks or better)');
    expect(holdAdvice(cards('Kh Qh Jh 5h 2c')).text).toBe('Best hold: K♥ Q♥ J♥ · 3 to a royal flush');
    expect(holdAdvice(cards('Tc Jd Qh Ks 3s')).text).toBe('Best hold: 10♣ J♦ Q♥ K♠ · Unsuited 10-J-Q-K');
    expect(holdAdvice(cards('2c 3d 7h 8s Tc')).text).toBe('Best hold: none · Discard everything');
    expect(holdAdvice(cards('2d 5d 8d Jd Kd')).text).toBe('Best hold: all five · Dealt flush');
    // Footnote C moves a hold up to a half line; it reads as the hold it moved.
    expect(holdAdvice(cards('7h 9h Jh Qd Kc')).text).toBe('Best hold: 7♥ 9♥ J♥ · 3 to a straight flush, type 2');
    expect(holdName(21.5)).toBe('3 to a straight flush, type 2');
    expect(holdName(13)).toBe('4 to a flush');
  });

  it('suggests the fifth coin with the paytable\'s own numbers', () => {
    expect(betAdvice(MAX_COINS)).toBe(null);
    const text = betAdvice(1)!;
    expect(text).toContain(payCredits(ROYAL_FLUSH, MAX_COINS).toLocaleString('en-US'));
    expect(text).toContain((PAY_PER_COIN[ROYAL_FLUSH]! * MAX_COINS).toLocaleString('en-US'));
    expect(betAdvice(4)).toBe(text);
  });
});
