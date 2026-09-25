// One setting: whether a few drinks sway the view and warm its edges (on by default, and mild).
// Kept in localStorage like the mouse settings; the bar's menu has the switch.

const KEY = 'casino.drinkfx';
const fns = new Set<(on: boolean) => void>();
/** This visit's choice, when storage can't keep it. */
let mem: boolean | null = null;

export function drinkFx(): boolean {
  if (mem !== null) return mem;
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setDrinkFx(on: boolean): void {
  mem = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: for this visit only */
  }
  for (const fn of fns) fn(on);
}

export function onDrinkFx(fn: (on: boolean) => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}
