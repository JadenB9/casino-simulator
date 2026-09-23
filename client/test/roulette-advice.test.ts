import { describe, it, expect } from 'vitest';
import { spotsOf, spotKey, type Variant } from '../../shared/src/games/roulette/rules.ts';
import { spotEdge, rouletteAdvice, rouletteMoment } from '../src/games/roulette/advice.ts';

describe('roulette Tips: house edges from the spots the engine settles', () => {
  it('American: 2/38 (5.26%) on every bet, 3/38 (7.89%) on the top line', () => {
    for (const s of spotsOf('american').values()) expect(spotEdge('american', s), s.key).toEqual(s.kind === 'topline' ? [3, 38] : [2, 38]);
  });
  it('European: 1/37 (2.70%) on every bet', () => {
    for (const s of spotsOf('european').values()) expect(spotEdge('european', s), s.key).toEqual([1, 37]);
  });
  it('the line names the numbers', () => {
    expect(rouletteAdvice('american', {})).toBe('5.26% on every bet but the top line (7.89%): skip that one. A European wheel costs about half.');
    expect(rouletteAdvice('european', {})).toBe("Every bet here costs 2.70%, about half the American wheel's 5.26%.");
  });
  it('warns once a top-line bet is down', () => {
    const top = [...spotsOf('american').values()].find((s) => s.kind === 'topline')!;
    expect(rouletteAdvice('american', { [top.key]: 500, red: 1000 })).toBe('Top line: 7.89% house edge, the worst bet on the table. Every other bet costs 5.26%.');
    expect(rouletteAdvice('american', { red: 1000 })).not.toMatch(/^Top line/);
  });
  it('every line fits above the controls', () => {
    for (const v of ['american', 'european'] as Variant[]) expect(rouletteAdvice(v, {}).length).toBeLessThanOrEqual(100);
  });
});

describe('roulette celebrations', () => {
  const straight = spotKey('straight', [17]);
  const split = spotKey('split', [17, 20]);
  const street = spotKey('street', [16, 17, 18]);
  const corner = spotKey('corner', [13, 14, 16, 17]);
  it('a straight-up hit is big, a split or street nice, and the straight wins when both hit', () => {
    expect(rouletteMoment('american', { wagered: 1000, returned: 36000, bets: [[straight, 1000, 36000]] })).toEqual({ key: straight, tier: 'big', title: 'Straight up 17', sub: 'Pays 35 to 1 · +$350' });
    expect(rouletteMoment('american', { wagered: 1000, returned: 18000, bets: [[split, 1000, 18000]] })).toMatchObject({ tier: 'nice', title: 'Split 17-20' });
    expect(rouletteMoment('european', { wagered: 1000, returned: 12000, bets: [[street, 1000, 12000]] })).toMatchObject({ tier: 'nice', title: 'Street 16-17-18', sub: 'Pays 11 to 1 · +$110' });
    expect(rouletteMoment('american', { wagered: 2000, returned: 54000, bets: [[split, 1000, 18000], [straight, 1000, 36000]] })).toMatchObject({ key: straight, tier: 'big' });
  });
  it('other winners are not a moment', () => {
    expect(rouletteMoment('american', { wagered: 1000, returned: 9000, bets: [[corner, 1000, 9000]] })).toBeNull();
    expect(rouletteMoment('american', { wagered: 1000, returned: 2000, bets: [['red', 1000, 2000]] })).toBeNull();
  });
  it('never when the spin returned no more than it took', () => {
    expect(rouletteMoment('american', { wagered: 36000, returned: 36000, bets: [[straight, 1000, 36000], ['black', 35000, 0]] })).toBeNull();
    expect(rouletteMoment('american', { wagered: 40000, returned: 36000, bets: [[straight, 1000, 36000], ['black', 39000, 0]] })).toBeNull();
  });
});
