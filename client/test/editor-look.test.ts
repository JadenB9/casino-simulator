import { describe, expect, it } from 'vitest';
import { BUILD, HEIGHT } from '../../shared/src/look.ts';
import { BOTTOMS, HAIR, SHOES, SKINS, TOPS, luminance, sizeWord } from '../src/ui/editor/palettes.ts';

// The look editor's words and swatches (ui/editor/editor.ts): the sliders say what they're set to,
// and every swatch's check stands out against its own colour.

describe('the Height and Build sliders in words', () => {
  it('say average round the middle, and the ends by name', () => {
    expect(sizeWord('height', 1)).toBe('Average');
    expect(sizeWord('height', HEIGHT[0])).toBe('Short');
    expect(sizeWord('height', HEIGHT[1])).toBe('Tall');
    expect(sizeWord('build', 1)).toBe('Average');
    expect(sizeWord('build', BUILD[0])).toBe('Slim');
    expect(sizeWord('build', BUILD[1])).toBe('Broad');
  });

  it('keep a third of each side of the range average', () => {
    expect(sizeWord('height', 1.04)).toBe('Average');
    expect(sizeWord('height', 1.06)).toBe('Tall');
    expect(sizeWord('build', 0.94)).toBe('Average');
    expect(sizeWord('build', 1.2)).toBe('Broad');
  });
});

describe('a swatch check', () => {
  it('measures light and dark like the sRGB spec', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#808080')).toBeCloseTo(0.2159, 3);
  });

  it('is dark on the light swatches and light on the dark ones, with contrast either way', () => {
    // the check is #1d140a on a light swatch (over 0.36) and white on a dark one
    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    for (const list of [SKINS, HAIR, TOPS, BOTTOMS, SHOES]) {
      for (const s of list) {
        const l = luminance(s.hex);
        const ink = l > 0.36 ? luminance('#1d140a') : 1;
        expect(contrast(l, ink), `${s.name} ${s.hex}`).toBeGreaterThan(2.2);
      }
    }
  });
});
