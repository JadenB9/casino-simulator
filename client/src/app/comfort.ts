// "Reduce flashing & motion": one switch in Settings that every effect reads. On, the game keeps
// its light but loses the strobing: no flashing or chasing lights (LED sign chases, disco spots,
// pachinko fever, win flashes), gentler particles, no camera shake or tipsy wobble, softer bloom.
// It defaults to on when the system asks for reduced motion. Kept per browser.

const KEY = 'casino.calm';
const listeners = new Set<(on: boolean) => void>();

function initial(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    // storage blocked: fall through to the system setting
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let on = initial();

/** Whether flashing and motion should be toned down right now. */
export function calm(): boolean {
  return on;
}

export function setCalm(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // not kept, but still applied for this visit
  }
  for (const fn of listeners) fn(on);
}

/** Hear changes; the returned function stops listening. */
export function onCalm(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
