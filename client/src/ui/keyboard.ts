// Who has the keyboard. Sheets (profile, cashier, settings), the character editor and the kit's
// dialogs each hold it while they're up: Esc goes to the top one, Tab stays inside it, and other
// keys don't reach the floor or the table behind it, so W doesn't walk you away while you read
// and Space doesn't deal behind a buy-in prompt. M, ? and J stay global so mute, the shortcut
// list and the achievements work from anywhere.

/** Keys that keep working while something holds the keyboard. */
export const GLOBAL_KEYS: ReadonlySet<string> = new Set(['m', 'M', '?', 'j', 'J']);

interface Layer {
  readonly panel: HTMLElement;
  readonly escape: () => void;
}

const stack: Layer[] = [];
const watchers = new Set<(open: number) => void>();

/** How many layers hold the keyboard. The floor and the table ignore keys while this is above 0. */
export function overlayCount(): number {
  return stack.length;
}

export function onOverlayChange(fn: (open: number) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** The panel on top, if any (where focus goes back to when one above it closes). */
export function topPanel(): HTMLElement | null {
  return stack[stack.length - 1]?.panel ?? null;
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

/** True when a key is going into a text field, where letters are typing, not shortcuts. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
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
  if (!panel.contains(active) || active === panel) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

// One capture listener for every layer: it runs before anything else on the page sees the key.
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
        top.escape();
        return;
      }
      if (e.key === 'Tab') {
        trapTab(top.panel, e);
        return;
      }
      if (GLOBAL_KEYS.has(e.key)) return;
      if (!top.panel.contains(e.target as Node)) {
        // A key aimed at the page behind: swallow it and bring focus back.
        e.stopPropagation();
        focusFirst(top.panel);
      }
    },
    true,
  );
}

/**
 * Give the keyboard to `panel` until the returned release is called: Esc calls `onEscape`
 * (which may decide not to close), Tab stays inside, other keys don't reach the page behind.
 */
export function holdKeyboard(panel: HTMLElement, onEscape: () => void): () => void {
  install();
  const layer: Layer = { panel, escape: onEscape };
  stack.push(layer);
  changed();
  return () => {
    const i = stack.indexOf(layer);
    if (i < 0) return;
    stack.splice(i, 1);
    changed();
  };
}
