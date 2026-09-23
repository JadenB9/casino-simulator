import { describe, it, expect } from 'vitest';
import { HOUSE_EDGE, bestBet, bettingTip } from '../src/games/baccarat/advice.ts';

describe('baccarat tips', () => {
  it('point at Banker, the lowest edge, and name Tie as the highest', () => {
    expect(bestBet()).toBe('banker');
    expect(bettingTip()).toBe('Banker has the lowest house edge (1.06%), Tie the highest (14.4%)');
  });

  it('use the documented edges (docs/rules/table-games.md §4.4)', () => {
    expect((HOUSE_EDGE.banker * 100).toFixed(4)).toBe('1.0579');
    expect((HOUSE_EDGE.player * 100).toFixed(4)).toBe('1.2351');
    expect((HOUSE_EDGE.tie * 100).toFixed(4)).toBe('14.3596');
    expect((HOUSE_EDGE.playerPair * 100).toFixed(4)).toBe('10.3614');
    expect(HOUSE_EDGE.bankerPair).toBe(HOUSE_EDGE.playerPair);
  });
});
