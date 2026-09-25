import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Passing notices never draw over an open sheet or modal (the happy hour's card over the bar's
// menu): their layer is above the HUD and under every overlay you read or act in.

const z = (file: string, sel: string): number => {
  const css = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf(`${sel} {`));
  return Number(/z-index:\s*(\d+)/.exec(rule.slice(0, rule.indexOf('}')))![1]);
};

describe('notice layers', () => {
  const notices = [z('world/celebs/celebs.css', '.celeb-notices'), z('ui/feed/feed.css', '.bigwin-toasts'), z('ui/feats/feats.css', '.ft-cards')];
  const over = [z('styles/theme.css', '.scrim'), z('ui/menu/menu.css', '.sheet-scrim'), z('ui/shop/shop.css', '.boutique')];
  it('sit above the HUD and under sheets, modals and the boutique', () => {
    for (const n of notices) {
      expect(n).toBeGreaterThan(z('ui/hud/hud.css', '.hud'));
      for (const o of over) expect(n).toBeLessThan(o);
    }
  });
});
