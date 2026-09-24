import { describe, it, expect } from 'vitest';
import { PASSWORD_MAX, PASSWORD_MIN, isValidPassword, normalizePassword, passwordProblem } from '../src/password.ts';

describe('password rule', () => {
  it('takes 4 to 64 characters of anything, spaces included', () => {
    expect([PASSWORD_MIN, PASSWORD_MAX]).toEqual([4, 64]);
    for (const ok of ['abcd', '1234', 'a b ', '    ', 'x'.repeat(64), 'pässwörd', 'パスワード', '🂡🂱🃁🃑']) {
      expect(passwordProblem(ok), ok).toBeNull();
      expect(isValidPassword(ok), ok).toBe(true);
    }
  });

  it('says why a password is refused', () => {
    expect(passwordProblem('')).toBe('At least 4 characters.');
    expect(passwordProblem('abc')).toBe('At least 4 characters.');
    expect(passwordProblem('x'.repeat(65))).toBe('At most 64 characters.');
  });

  it('refuses anything that is not a string', () => {
    for (const bad of [undefined, null, 1234, ['abcd'], { p: 'abcd' }, true]) expect(isValidPassword(bad)).toBe(false);
  });

  it('counts characters, not UTF-16 units: four playing cards are four, 64 of them fit', () => {
    const card = '🂡'; // two UTF-16 units
    expect(card.length).toBe(2);
    expect(passwordProblem(card.repeat(3))).toBe('At least 4 characters.');
    expect(passwordProblem(card.repeat(64))).toBeNull();
    expect(passwordProblem(card.repeat(65))).toBe('At most 64 characters.');
  });

  it('treats an accent typed as one character or two as the same password', () => {
    const composed = 'café';
    const decomposed = 'café';
    expect(composed).not.toBe(decomposed);
    expect(normalizePassword(decomposed)).toBe(composed);
    // Five code units, but four characters once normalized: valid, and not "too short" either way.
    expect(passwordProblem(decomposed)).toBeNull();
    expect(passwordProblem('éé')).toBe('At least 4 characters.');
  });
});
