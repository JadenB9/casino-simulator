// Sheets: the panels that open over the game (profile, cashier, settings, shortcuts). One at a
// time owns the keyboard: Esc closes the top one, Tab stays inside it, and other keys don't
// reach the floor or the table behind it, so W doesn't walk you away while you read your stats.
// M and ? stay global so mute and the shortcut list work from anywhere.

import './menu.css';
import { el } from '../kit.ts';
import { icon } from './icons.ts';
import { GLOBAL_KEYS, focusFirst, holdKeyboard, topPanel } from '../keyboard.ts';

// The keyboard stack itself lives in ui/keyboard.ts (kit dialogs hold it too); these stay
// exported from here for the screens that already import them.
export { GLOBAL_KEYS, focusFirst, focusables, holdKeyboard, onOverlayChange, overlayCount } from '../keyboard.ts';

export interface SheetOpts {
  title: string;
  subtitle?: string;
  /** Layout class for the panel ("profile-sheet", "bank-sheet", ...). */
  cls?: string;
  onClose?: () => void;
}

export interface Sheet {
  readonly root: HTMLElement;
  readonly panel: HTMLElement;
  readonly sub: HTMLElement;
  readonly body: HTMLElement;
  close(): void;
  readonly closed: boolean;
}

let seq = 0;

let closeLabelId = 0;

/** The round close button with its Esc keycap, shared by sheets and the editor. */
export function closeButton(onClick: () => void, label = 'Close'): HTMLButtonElement {
  const b = el('button', 'x-btn');
  b.type = 'button';
  b.setAttribute('aria-label', `${label} (Esc)`);
  b.id = `x-btn-${++closeLabelId}`;
  b.append(el('span', 'kc', 'Esc'), icon('close'));
  b.addEventListener('click', onClick);
  return b;
}

export function openSheet(root: HTMLElement, opts: SheetOpts): Sheet {
  const scrim = el('div', 'sheet-scrim');
  const panel = el('section', `sheet ${opts.cls ?? ''}`.trim());
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;
  const head = el('header', 'sheet-head');
  const titles = el('div', 'sheet-titles');
  const title = el('h2', 'sheet-title', opts.title);
  title.id = `sheet-title-${++seq}`;
  panel.setAttribute('aria-labelledby', title.id);
  const sub = el('p', 'sheet-sub', opts.subtitle ?? '');
  sub.hidden = !opts.subtitle;
  titles.append(title, sub);
  const body = el('div', 'sheet-body');

  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;
  const sheet: Sheet = {
    root: scrim,
    panel,
    sub,
    body,
    get closed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      release();
      scrim.classList.add('closing');
      // Removed on a timer rather than animationend: with reduced motion (or a background tab)
      // the animation event may never come, and a scrim left behind would eat every click.
      setTimeout(() => scrim.remove(), 170);
      const top = topPanel();
      if (before?.isConnected) before.focus({ preventScroll: true });
      else if (top) focusFirst(top);
      opts.onClose?.();
    },
  };

  head.append(titles, closeButton(() => sheet.close()));
  panel.append(head, body);
  scrim.append(panel);
  // A click on the dimmed page closes the sheet, like stepping back from a counter.
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) sheet.close();
  });
  // Keys typed inside the sheet stop here instead of bubbling to the floor or table handlers.
  scrim.addEventListener('keydown', (e) => {
    if (!GLOBAL_KEYS.has(e.key)) e.stopPropagation();
  });
  root.append(scrim);
  const release = holdKeyboard(panel, () => sheet.close());
  // The panel itself takes focus (no ring on the close button); Tab goes to its first control.
  queueMicrotask(() => {
    const auto = panel.querySelector<HTMLElement>('[data-autofocus]');
    (auto ?? panel).focus({ preventScroll: true });
  });
  return sheet;
}
