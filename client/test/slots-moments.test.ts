import { describe, it, expect } from 'vitest';
import { MACHINES } from '../../shared/src/games/slots/machines.ts';
import { winTier, slotsTip, rtpOf, timesBet, neonHand } from '../src/games/slots/moments.ts';

describe('slots Tips line', () => {
  it('quotes each machine at the return its exact enumeration proves', () => {
    // shared/test/slots-exact.test.ts: 94.4275%, 89.8204%, 95.374145% (free games included)
    expect(slotsTip(MACHINES.sevens)).toBe('Every spin is independent; this machine returns 94.4275% over time.');
    expect(slotsTip(MACHINES.wild)).toBe('Every spin is independent; this machine returns 89.8204% over time.');
    expect(slotsTip(MACHINES.neon)).toBe('Every spin is independent; this machine returns 95.3741% over time.');
  });
  it('a machine without a published return still gets the honest half', () => {
    expect(rtpOf({ published: [] })).toBeNull();
    expect(slotsTip({ published: [['Hit frequency', '10%']] })).toBe('Every spin is independent: a machine is never due.');
  });
});

describe('slots win tiers', () => {
  it('nothing at or below the bet, nothing under 10x', () => {
    expect(winTier(0, 100)).toBeNull();
    expect(winTier(100, 100)).toBeNull();
    expect(winTier(999, 100)).toBeNull();
  });
  it('big from 10x, huge from 50x', () => {
    expect(winTier(1000, 100)).toBe('big');
    expect(winTier(4999, 100)).toBe('big');
    expect(winTier(5000, 100)).toBe('huge');
    expect(winTier(250_000, 300)).toBe('huge');
  });
  it('counts whole bets', () => {
    expect(timesBet(4150, 100)).toBe('41x the bet');
    expect(timesBet(1000, 100)).toBe('10x the bet');
  });
});

describe('slots: what the hand was', () => {
  it('names Neon Nights lines by their best one', () => {
    expect(neonHand([])).toBeNull();
    expect(neonHand([{ symbol: 'DIAMOND', count: 5, win: 1000 }])).toBe('Five diamonds');
    expect(neonHand([{ symbol: 'Q', count: 3, win: 5 }, { symbol: 'SEVEN', count: 4, win: 100 }, { symbol: '10', count: 3, win: 5 }])).toBe('Four sevens and 2 more lines');
    expect(neonHand([{ symbol: '10', count: 3, win: 5 }, { symbol: 'J', count: 3, win: 5 }])).toBe('Three tens and 1 more line');
  });
});
