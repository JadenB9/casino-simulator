// Sheets: the panels that open over the game (profile, cashier, settings, shortcuts). One at a
// time owns the keyboard: Esc closes the top one, Tab stays inside it, and other keys don't
// reach the floor or the table behind it, so W doesn't walk you away while you read your stats.
// M and ? stay global so mute and the shortcut list work from anywhere.

import { el } from '../kit.ts';
import { icon } from './icons.ts';

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

/** Keys that keep working while a sheet has the keyboard. */
export const GLOBAL_KEYS: ReadonlySet<string> = new Set(['m', 'M', '?']);

const stack: Sheet[] = [];
const watchers = new Set<(open: number) => void>();
let seq = 0;

/** How many sheets are open. The floor controller should stand still while this is above 0. */
export function overlayCount(): number {
  return stack.length;
}

export function onOverlayChange(fn: (open: number) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function changed(): void {
  for (const fn of watchers) fn(stack.length);
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(within: HTMLElement): HTMLElement[] {
  return [...within.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden]'));
}

export function focusFirst(within: HTMLElement): void {
  const list = focusables(within);
  const pick = list.find((e) => e.dataset.autofocus !== undefined) ?? list[0];
  (pick ?? within).focus({ preventScroll: true });
}

function trapTab(panel: HTMLElement, e: KeyboardEvent): void {
  const list = focusables(panel);
  if (list.length === 0) {
    e.preventDefault();
    return;
  }
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active = document.activeElement;
  if (!panel.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

// One capture listener for every sheet: it runs before anything else on the page sees the key.
let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  addEventListener(
    'keydown',
    (e) => {
      const top = stack[stack.length - 1];
      if (!top) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        top.close();
        return;
      }
      if (e.key === 'Tab') {
        trapTab(top.panel, e);
        return;
      }
      if (GLOBAL_KEYS.has(e.key)) return;
      if (!top.panel.contains(e.target as Node)) {
        // A key aimed at the page behind the sheet: swallow it and bring focus back.
        e.stopPropagation();
        focusFirst(top.panel);
      }
    },
    true,
  );
}

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
  install();
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
      const i = stack.indexOf(sheet);
      if (i >= 0) stack.splice(i, 1);
      scrim.classList.add('closing');
      // Removed on a timer rather than animationend: with reduced motion (or a background tab)
      // the animation event may never come, and a scrim left behind would eat every click.
      setTimeout(() => scrim.remove(), 170);
      if (before?.isConnected) before.focus({ preventScroll: true });
      else if (stack.length) focusFirst(stack[stack.length - 1]!.panel);
      changed();
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
  stack.push(sheet);
  changed();
  queueMicrotask(() => focusFirst(panel));
  return sheet;
}
