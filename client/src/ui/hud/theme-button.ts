// The sun and moon button (app/theme.ts): one for the HUD's bar, one for the corner of the login
// and menu screens. It shows what a press will give you: the sun while the panels are dark, the
// moon while they're light, and says so for a screen reader.

import { onTheme, theme, toggleTheme, type Theme } from '../../app/theme.ts';
import { el } from '../kit.ts';
import { icon } from '../menu/icons.ts';

export function themeButton(cls: string): { root: HTMLButtonElement; dispose(): void } {
  const b = el('button', `theme-btn ${cls}`.trim());
  b.type = 'button';
  const paint = (t: Theme) => {
    const label = t === 'light' ? 'Dark mode' : 'Light mode';
    b.replaceChildren(icon(t === 'light' ? 'moon' : 'sun'));
    b.title = label;
    b.setAttribute('aria-label', label);
  };
  paint(theme());
  const off = onTheme(paint);
  b.addEventListener('click', () => toggleTheme());
  return { root: b, dispose: off };
}
