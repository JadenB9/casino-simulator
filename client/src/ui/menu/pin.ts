// Where a coach mark stands next to the thing it points at (guide.ts), worked out without the DOM
// so the rules are tested on their own (client/test/front-guide.test.ts): under the target when
// it fits, else over it; centred on it as far as the screen's edges allow; the arrow over the
// target's middle, never closer than its own width to the card's corners.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Pin {
  /** The card's top-left corner. */
  x: number;
  y: number;
  /** Under the target (arrow on the card's top edge), or over it (arrow on the bottom). */
  below: boolean;
  /** The arrow's distance from the card's left edge. */
  arrow: number;
}

export function pinCard(target: Box, card: { w: number; h: number }, view: { w: number; h: number }, gap = 14, edge = 16): Pin {
  const mid = target.left + target.width / 2;
  const x = Math.round(Math.max(edge, Math.min(view.w - edge - card.w, mid - card.w / 2)));
  const below = target.top + target.height + gap + card.h <= view.h - edge;
  const y = Math.round(below ? target.top + target.height + gap : Math.max(edge, target.top - gap - card.h));
  const arrow = Math.round(Math.max(20, Math.min(card.w - 20, mid - x)));
  return { x, y, below, arrow };
}
