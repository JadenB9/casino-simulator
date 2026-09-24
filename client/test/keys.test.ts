import { describe, it, expect } from 'vitest';
import { isChipKey } from '../src/table/keys.ts';

// The tray's chip keys at every table. Space must never read as one: Number(' ') is 0, and a check
// on the number once swallowed Space, so Deal and Spin did nothing.
describe('chip keys', () => {
  it('are the ten digits', () => {
    for (const k of '0123456789') expect(isChipKey(k)).toBe(true);
  });
  it('leave Space and every other key to the table', () => {
    for (const k of [' ', 'Spacebar', '', 'a', 'A', 'x', 'Backspace', 'Enter', '10', '-1', '1.5', '٣']) expect(isChipKey(k)).toBe(false);
  });
});
