import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, OUTFITS, parseLook } from '../../shared/src/look.ts';
import { sameLook, startingLook } from '../src/ui/editor/palettes.ts';

describe('starting looks', () => {
  it('are valid looks the server keeps as they are', () => {
    for (let id = 1; id <= 500; id++) {
      const look = startingLook(id);
      expect(parseLook(look)).toEqual(look);
      expect(OUTFITS[look.body]).toContain(look.outfit);
    }
  });

  it('are the same every time for an account', () => {
    for (const id of [1, 7, 412, 99_999]) expect(startingLook(id)).toEqual(startingLook(id));
  });

  it('vary across accounts: not a crowd of identical suits', () => {
    const looks = Array.from({ length: 400 }, (_, i) => startingLook(i + 1));
    const distinct = new Set(looks.map((l) => JSON.stringify(l)));
    expect(distinct.size).toBeGreaterThan(390);
    const bodies = looks.filter((l) => l.body === 'f').length;
    expect(bodies).toBeGreaterThan(140);
    expect(bodies).toBeLessThan(260);
    const outfits = new Set(looks.map((l) => `${l.body}/${l.outfit}`));
    expect(outfits.size).toBe(OUTFITS.m.length + OUTFITS.f.length);
    expect(looks.filter((l) => sameLook(l, DEFAULT_LOOK))).toHaveLength(0);
    // only a suit ever comes in one colour top and bottom
    expect(looks.filter((l) => l.top === l.bottom && l.outfit !== 'suit')).toHaveLength(0);
  });

  it('compares looks by what they show, whatever the hex case', () => {
    expect(sameLook(DEFAULT_LOOK, { ...DEFAULT_LOOK, top: DEFAULT_LOOK.top.toUpperCase() })).toBe(true);
    expect(sameLook(DEFAULT_LOOK, { ...DEFAULT_LOOK, skin: 3 })).toBe(false);
  });
});
