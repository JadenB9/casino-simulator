// The frame the login screen and the main menu share: one card on the left with the title and its
// brass rule at the top, over the floor's slow camera pass (or the painted backdrop before there
// is one). The card has its own surface, so the room around it keeps its colours in either theme
// and the text on it keeps its contrast; going from login to the menu only changes what is under
// the rule. On a short, wide screen (a phone on its side) the card turns into two columns.

import { el } from '../kit.ts';
import { paintedBackdrop } from './backdrop.ts';
import { themeButton } from '../hud/theme-button.ts';

export interface FrontShell {
  root: HTMLElement;
  /** The card: the brand is in it already; the screen adds its own parts. */
  col: HTMLElement;
  close(): void;
}

/** A name's first letter on a brass disc: the remembered player, the menu's "who". */
export function monogram(name: string, cls = ''): HTMLElement {
  const m = el('span', `monogram ${cls}`.trim(), (name.trim()[0] ?? '?').toUpperCase());
  m.setAttribute('aria-hidden', 'true');
  return m;
}

export function frontShell(parent: HTMLElement, cls: string, backdrop?: () => (() => void) | void): FrontShell {
  const root = el('div', `front ${cls}`);
  let stop: (() => void) | void;
  let painted: ReturnType<typeof paintedBackdrop> | null = null;
  if (backdrop) {
    // The 3D floor shows through; only its edges are dimmed, to set the card off.
    root.classList.add('over-scene');
    stop = backdrop();
  } else {
    painted = paintedBackdrop();
    root.append(painted.root);
  }
  root.append(el('div', 'front-shade'));
  // light or dark, in the corner, before anyone has logged in (app/theme.ts)
  const theme = themeButton('front-theme');
  root.append(theme.root);
  // The card only fades in with the screen (its parts rise inside it), so the title holds still
  // from the login to the menu.
  const col = el('div', 'front-col');
  const brand = el('div', 'front-brand');
  const title = el('h1', 'front-title', 'Casino Simulator');
  const rule = el('div', 'front-rule');
  rule.append(el('i', 'front-diamond'));
  brand.append(title, rule);
  col.append(brand);
  root.append(col);
  parent.append(root);

  let closed = false;
  return {
    root,
    col,
    close() {
      if (closed) return;
      closed = true;
      root.classList.add('closing');
      theme.dispose();
      painted?.dispose();
      if (typeof stop === 'function') stop();
      setTimeout(() => root.remove(), 240);
    },
  };
}
