import { describe, it, expect } from 'vitest';
import { parseFloorMsg, parseTableMsg } from '../src/protocol.ts';
import { isGameId, variantOf, TABLE_ID_RE, soloTableName } from '../src/games/catalog.ts';
import { isValidName, nameProblem } from '../src/names.ts';
import { parseLook, DEFAULT_LOOK, lookFromJson } from '../src/look.ts';

describe('floor messages', () => {
  it('accepts well-formed movement and rejects the rest', () => {
    expect(parseFloorMsg({ t: 'mv', x: 10, z: -20, r: 255 }, isGameId)).toEqual({ t: 'mv', x: 10, z: -20, r: 255 });
    expect(parseFloorMsg({ t: 'mv', x: 1.5, z: 0, r: 0 }, isGameId)).toBeNull();
    expect(parseFloorMsg({ t: 'mv', x: 0, z: 0, r: 256 }, isGameId)).toBeNull();
    expect(parseFloorMsg({ t: 'watch', game: 'blackjack' }, isGameId)).toEqual({ t: 'watch', game: 'blackjack' });
    expect(parseFloorMsg({ t: 'watch', game: 'poker' }, isGameId)).toBeNull();
    expect(parseFloorMsg({ t: 'nope' }, isGameId)).toBeNull();
    expect(parseFloorMsg([1, 2], isGameId)).toBeNull();
  });
});

describe('table messages', () => {
  it('parses each type', () => {
    expect(parseTableMsg({ t: 'buyin', aid: 'a1', amount: 10000 })).toEqual({ t: 'buyin', aid: 'a1', amount: 10000 });
    expect(parseTableMsg({ t: 'buyin', aid: 'a1', amount: -5 })).toBeNull();
    expect(parseTableMsg({ t: 'buyin', aid: 'bad aid!', amount: 5 })).toBeNull();
    expect(parseTableMsg({ t: 'act', aid: 'x', a: { type: 'hit' } })).toEqual({ t: 'act', aid: 'x', a: { type: 'hit' } });
    expect(parseTableMsg({ t: 'act', aid: 'x' })).toBeNull();
    expect(parseTableMsg({ t: 'visibility', visibility: 'secret' })).toBeNull();
    expect(parseTableMsg({ t: 'start' })).toEqual({ t: 'start' });
  });
});

describe('catalog and names', () => {
  it('ids', () => {
    expect(TABLE_ID_RE.test('bj-k3x9d0q2mz')).toBe(true);
    expect(TABLE_ID_RE.test('bj-K3X9D0Q2MZ')).toBe(false);
    expect(TABLE_ID_RE.test('xx-k3x9d0q2mz')).toBe(false);
    expect(soloTableName('roulette', 'european', 7)).toBe('solo:roulette:european:7');
    expect(variantOf('roulette', 'nope')).toBe('american');
    expect(variantOf('blackjack', 'x')).toBe('');
  });

  it('names', () => {
    expect(isValidName('Ace_1')).toBe(true);
    expect(isValidName('ab')).toBe(false);
    expect(isValidName('a'.repeat(17))).toBe(false);
    expect(isValidName('héllo')).toBe(false);
    expect(nameProblem('a b c')).toBe('Letters, numbers and _ only.');
  });

  it('looks', () => {
    expect(parseLook(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
    expect(parseLook({ ...DEFAULT_LOOK, outfit: 'dress' })).toBeNull(); // dress is a women's outfit
    expect(parseLook({ ...DEFAULT_LOOK, top: 'red' })).toBeNull();
    expect(parseLook({ ...DEFAULT_LOOK, skin: 99 })).toBeNull();
    expect(lookFromJson('{broken')).toEqual(DEFAULT_LOOK);
  });
});
