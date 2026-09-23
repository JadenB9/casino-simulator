// Small pieces the account screens share: keycaps, stat tiles, segmented choices, dates.

import { el } from '../kit.ts';
import { CATALOG, isGameId } from '../../../../shared/src/games/catalog.ts';

export function keycap(text: string): HTMLElement {
  return el('kbd', 'kc', text);
}

/** A labelled number, the unit of every summary row. Returns the value element for updates. */
export function statTile(label: string, value: string, cls = ''): { tile: HTMLElement; value: HTMLElement } {
  const tile = el('div', `stat ${cls}`.trim());
  const v = el('div', 'stat-value money', value);
  tile.append(el('div', 'stat-label', label), v);
  return { tile, value: v };
}

export interface Choice<T extends string> {
  id: T;
  label: string;
}

/**
 * A row of mutually exclusive buttons (a radio group): click, or arrow keys to move. Returns the
 * row and a setter for when the value changes from outside.
 */
export function segmented<T extends string>(
  label: string,
  choices: readonly Choice<T>[],
  value: T,
  onChange: (v: T) => void,
  cls = '',
): { root: HTMLElement; set(v: T): void } {
  const root = el('div', `seg ${cls}`.trim());
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', label);
  const buttons: HTMLButtonElement[] = [];
  let current = value;
  const paint = () => {
    for (const b of buttons) {
      const on = b.dataset.id === current;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const pick = (v: T, focus = false) => {
    const changedNow = v !== current;
    current = v;
    paint();
    if (focus) buttons.find((b) => b.dataset.id === v)?.focus();
    if (changedNow) onChange(v);
  };
  for (const c of choices) {
    const b = el('button', 'seg-btn', c.label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.id = c.id;
    b.addEventListener('click', () => pick(c.id));
    buttons.push(b);
    root.append(b);
  }
  root.addEventListener('keydown', (e) => {
    const i = choices.findIndex((c) => c.id === current);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % choices.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + choices.length) % choices.length;
    if (next >= 0) {
      e.preventDefault();
      pick(choices[next]!.id, true);
    }
  });
  paint();
  return {
    root,
    set(v: T) {
      current = v;
      paint();
    },
  };
}

/** A game's display name, or a readable fallback for a table the catalog doesn't know. */
export function gameName(id: string | null): string {
  return id && isGameId(id) ? CATALOG[id].name : 'Unknown game';
}

const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const formatDate = (ms: number): string => dateFmt.format(ms);
export const formatDateTime = (ms: number): string => dateTimeFmt.format(ms);

/** "42m", "1h 05m" */
export function formatDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** The problem an API call ran into, as one line for the screen. */
export function problemText(err: unknown): string {
  if (err && typeof err === 'object' && 'body' in err) {
    const msg = (err as { body?: { msg?: unknown } }).body?.msg;
    if (typeof msg === 'string' && msg) return msg;
  }
  if (err instanceof TypeError) return "Can't reach the casino. Check your connection and try again.";
  return 'Something went wrong. Try again.';
}
