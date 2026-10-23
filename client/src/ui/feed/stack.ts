// The column under the HUD that every passing note shares: the kit's toasts (confirmations and
// errors) and the floor's big wins (toast.ts). One column, so two notes that come at once sit one
// under the other instead of on top of each other; newest at the bottom; never more than MAX at a
// time (the oldest leaves early to make room); each fades out on its own clock. The column takes
// no clicks and the board fit (table/fit.ts) doesn't count it, so a table never slides aside for a
// note. Its place and look are theme.css's `.notice-stack`. While a sheet or a dialog holds the
// keyboard the column is `covered`: the floor's passing notices step out of it (feed.css) and the
// kit's own toasts, an error included, stay over the sheet as they always have.

import { onOverlayChange, overlayCount } from '../keyboard.ts';

const MAX = 3;
/** The fade out, ms (theme.css `.toast.out`: --dur). */
const OUT_MS = 240;

let box: HTMLElement | null = null;
let watching = false;

/** The column, made on first use in `root` (default #ui). */
export function noticeStack(root?: HTMLElement): HTMLElement {
  if (box?.isConnected) return box;
  box = document.createElement('div');
  // (.toasts: the class it had as the kit's own box, which the checks and the board fit know)
  box.className = 'notice-stack toasts pass';
  box.dataset.fit = 'ignore';
  box.classList.toggle('covered', overlayCount() > 0);
  (root ?? document.getElementById('ui') ?? document.body).append(box);
  if (!watching) {
    watching = true;
    onOverlayChange((n) => box?.classList.toggle('covered', n > 0));
  }
  return box;
}

/** Take a note out: it fades, then goes. Safe to call twice. */
export function dismissNotice(node: HTMLElement): void {
  if (node.classList.contains('out')) return;
  node.classList.add('out');
  window.setTimeout(() => node.remove(), OUT_MS);
}

/**
 * Show `node` at the bottom of the column for `ms`, making room if the column is full. Returns a
 * function that takes it out early.
 */
export function pushNotice(node: HTMLElement, ms: number, root?: HTMLElement): () => void {
  const stack = noticeStack(root);
  stack.append(node);
  // the notes themselves (a box another module keeps here, the celebrities', isn't one), less the
  // floor's notices waiting out a sheet, which don't take a place
  const covered = stack.classList.contains('covered');
  const live = [...stack.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('out') && (c.classList.contains('toast') || (!covered && c.classList.contains('bigwin-toast'))));
  for (const old of live.slice(0, Math.max(0, live.length - MAX))) dismissNotice(old);
  const timer = window.setTimeout(() => dismissNotice(node), ms);
  return () => {
    clearTimeout(timer);
    dismissNotice(node);
  };
}
