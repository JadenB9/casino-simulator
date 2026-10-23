import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The 2D layer's one z-index scale (styles/theme.css's contract): passing notices never draw over
// an open sheet or modal (the happy hour's card over the bar's menu): their layer is above the HUD
// and under every overlay you read or act in. The big wins share the toasts' column, which sits
// over sheets so an error is seen, and step out of it while a sheet or a dialog is open.

const css = (file: string): string => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const theme = css('styles/theme.css');

/** A layer token's number, from theme.css's :root. */
const token = (name: string): number => Number(new RegExp(`${name}:\\s*(\\d+);`).exec(theme)![1]);

/** The z-index of the first rule for `sel` in `file`: a number, or a layer token resolved. */
const z = (file: string, sel: string): number => {
  const s = css(file);
  const rule = s.slice(s.indexOf(`${sel} {`));
  const v = /z-index:\s*([^;}]+)/.exec(rule.slice(0, rule.indexOf('}')))![1]!.trim();
  const m = /^var\((--z-[a-z]+)\)$/.exec(v);
  return m ? token(m[1]!) : Number(v);
};

describe('notice layers', () => {
  it('the layer tokens climb in the order the contract gives', () => {
    const order = ['--z-hud', '--z-float', '--z-panel', '--z-notice', '--z-banner', '--z-popover', '--z-modal', '--z-sheet', '--z-toast', '--z-alert', '--z-away', '--z-boot', '--z-tooltip'].map(token);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
  });

  const hud = z('ui/hud/hud.css', '.hud');
  const notices = [z('world/celebs/celebs.css', '.celeb-notices'), z('ui/feats/feats.css', '.ft-cards')];
  const over = [z('styles/theme.css', '.scrim'), z('ui/menu/menu.css', '.sheet-scrim'), z('styles/controls.css', '.sheet-scrim'), z('ui/shop/shop.css', '.boutique')];

  it('sit above the HUD and under sheets, modals and the boutique', () => {
    for (const n of notices) {
      expect(n).toBeGreaterThan(hud);
      for (const o of over) expect(n).toBeLessThan(o);
    }
  });

  it("the big wins share the toasts' column over the HUD, and leave it while a sheet or a dialog is open", () => {
    expect(z('styles/theme.css', '.notice-stack')).toBeGreaterThan(hud);
    const feed = css('ui/feed/feed.css');
    const rule = feed.slice(feed.indexOf('.notice-stack.covered > .bigwin-toast'));
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/display:\s*none/);
    expect(css('ui/feed/stack.ts')).toContain("classList.toggle('covered'");
  });

  it("the HUD's More panel is over the notices and under dialogs and sheets", () => {
    const more = z('ui/hud/hud.css', '.hud-more-scrim');
    for (const n of notices) expect(more).toBeGreaterThan(n);
    for (const o of over.slice(0, 3)) expect(more).toBeLessThan(o);
  });
});
