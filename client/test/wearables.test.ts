// Special clothes dress the character in the outfit they're cut from, in their own colours, and
// leave the stored look (the player's own outfit) alone.

import { describe, expect, it } from 'vitest';
import { dressed } from '../src/world/wearables.ts';
import { DEFAULT_LOOK, OUTFITS, parseLook, type Look } from '../../shared/src/look.ts';
import { SHOP_ITEMS } from '../../shared/src/items.ts';

describe('dressed', () => {
  it('leaves a look without special clothes as it is', () => {
    const look: Look = { ...DEFAULT_LOOK, chain: 'rope-chain' };
    expect(dressed(look)).toBe(look);
  });

  it('puts every special clothes item on a real outfit model, for both bodies', () => {
    for (const it of SHOP_ITEMS.filter((i) => i.kind === 'clothes')) {
      for (const body of ['m', 'f'] as const) {
        const look: Look = { ...DEFAULT_LOOK, body, outfit: OUTFITS[body][0]!, clothes: it.id };
        const d = dressed(look);
        expect(OUTFITS[body], `${it.id} on ${body}`).toContain(d.outfit);
        // still a valid look (the colours are real colours), still wearing the clothes
        expect(parseLook(d), `${it.id} on ${body}`).not.toBeNull();
        expect(d.clothes).toBe(it.id);
      }
    }
  });

  it("changes only what's drawn: the look given isn't touched", () => {
    const look: Look = { ...DEFAULT_LOOK, outfit: 'hoodie', top: '#224466', clothes: 'white-tuxedo' };
    const copy = JSON.parse(JSON.stringify(look));
    const d = dressed(look);
    expect(d.outfit).toBe('suit');
    expect(d.top).not.toBe('#224466');
    expect(look).toEqual(copy);
  });

  it('ignores clothes it does not know', () => {
    const look = { ...DEFAULT_LOOK, clothes: 'mystery-cape' } as Look;
    expect(dressed(look)).toBe(look);
  });
});
