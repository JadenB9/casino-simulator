// What the passing notes said: the last few dozen toasts, big wins and notices, newest first, so a
// note that went by while you looked away can be read again (the HUD's More, Notifications). Kept
// for this page only. Pure: the store and its listeners, no DOM.

export type NoteKind = 'info' | 'err' | 'win' | 'feat' | 'celeb';

export interface Note {
  /** Date.now() when it showed. */
  at: number;
  kind: NoteKind;
  /** The line itself ("mara_v won $3,500", "Your chips are back in your balance."). */
  text: string;
  /** What it was about, under the line ("Roulette, Straight 17"). */
  sub?: string;
}

/** How many notes are kept. */
export const HISTORY_MAX = 30;

const notes: Note[] = [];
const listeners = new Set<() => void>();

/**
 * Keep a note. The same line said again within a few seconds (a refused bet pressed twice) is one
 * note, moved to now, not two.
 */
export function remember(n: Omit<Note, 'at'> & { at?: number }): void {
  const at = n.at ?? Date.now();
  const text = n.text.trim();
  if (!text) return;
  const same = notes.findIndex((o) => o.text === text && o.sub === n.sub && at - o.at < 5_000);
  if (same >= 0) notes.splice(same, 1);
  notes.unshift({ at, kind: n.kind, text, ...(n.sub ? { sub: n.sub } : {}) });
  notes.length = Math.min(notes.length, HISTORY_MAX);
  for (const fn of listeners) fn();
}

/** Every note kept, newest first. */
export function history(): readonly Note[] {
  return notes;
}

export function clearHistory(): void {
  notes.length = 0;
  for (const fn of listeners) fn();
}

/** Hear each note (and a clear); returns the unsubscribe. */
export function onHistory(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "just now", "4 min ago", "2 h ago". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ago`;
}
