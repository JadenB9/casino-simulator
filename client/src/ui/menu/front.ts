// The frame the login screen and the main menu share: background, title and brass rule in the
// same place on both, so going from one to the other only changes what is under the rule.

import { el } from '../kit.ts';
import { paintedBackdrop } from './backdrop.ts';

export interface FrontShell {
  root: HTMLElement;
  col: HTMLElement;
  close(): void;
}

export function frontShell(parent: HTMLElement, cls: string, backdrop?: () => (() => void) | void): FrontShell {
  const root = el('div', `front ${cls}`);
  let stop: (() => void) | void;
  let painted: ReturnType<typeof paintedBackdrop> | null = null;
  if (backdrop) {
    // The 3D floor shows through; this only darkens the side the text is on.
    root.classList.add('over-scene');
    root.append(el('div', 'front-shade'));
    stop = backdrop();
  } else {
    painted = paintedBackdrop();
    root.append(painted.root);
  }
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
      painted?.dispose();
      if (typeof stop === 'function') stop();
      setTimeout(() => root.remove(), 240);
    },
  };
}
