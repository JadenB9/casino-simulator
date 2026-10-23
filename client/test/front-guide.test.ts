import { describe, expect, it } from 'vitest';
import { pinCard } from '../src/ui/menu/pin.ts';

// The first-run tour's coach marks (ui/menu/guide.ts): pinned beside what they point at, always
// whole on the screen, the arrow over the target.

const view = { w: 1280, h: 800 };
const card = { w: 344, h: 170 };

describe('a coach mark pinned to its target', () => {
  it('stands under a target at the top of the screen, centred on it', () => {
    const p = pinCard({ left: 600, top: 14, width: 80, height: 36 }, card, view);
    expect(p.below).toBe(true);
    expect(p.y).toBe(14 + 36 + 14);
    expect(p.x).toBe(Math.round(640 - card.w / 2));
    expect(p.arrow).toBe(Math.round(card.w / 2));
  });

  it('keeps 16 px from the right edge, the arrow still over the target', () => {
    const t = { left: 1220, top: 14, width: 44, height: 36 };
    const p = pinCard(t, card, view);
    expect(p.x).toBe(view.w - 16 - card.w);
    expect(p.x + p.arrow).toBeCloseTo(t.left + t.width / 2, 0);
  });

  it('and from the left edge', () => {
    const p = pinCard({ left: 0, top: 14, width: 30, height: 30 }, card, view);
    expect(p.x).toBe(16);
    // the arrow never closer than its width to the card's corner
    expect(p.arrow).toBe(20);
  });

  it('goes over a target too low for it to fit under', () => {
    const t = { left: 600, top: 700, width: 60, height: 60 };
    const p = pinCard(t, card, view);
    expect(p.below).toBe(false);
    expect(p.y + card.h + 14).toBe(t.top);
  });

  it('never leaves the top of the screen, however tall it is', () => {
    const p = pinCard({ left: 100, top: 120, width: 60, height: 600 }, { w: 300, h: 400 }, view);
    expect(p.below).toBe(false);
    expect(p.y).toBe(16);
  });

  it('fits a phone: the card as wide as the screen less the gutters', () => {
    const phone = { w: 390, h: 844 };
    const p = pinCard({ left: 300, top: 70, width: 44, height: 44 }, { w: 358, h: 160 }, phone);
    expect(p.x).toBe(16);
    expect(p.x + 358).toBeLessThanOrEqual(phone.w - 16);
    expect(p.below).toBe(true);
  });
});
