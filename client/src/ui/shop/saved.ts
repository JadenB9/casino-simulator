// The pieces you're saving up for, kept in this browser: a wishlist needs no server (it's yours to
// look at, nobody else sees it), so it lives in localStorage and survives a reload. The boutique's
// heart adds a piece or takes it off; its Saved filter lists them with how much of each your
// balance covers. Storage can be refused (a private window): then it lasts for the visit.

const KEY = 'casino.saved';
/** Enough for every piece the boutique has, with room to spare; anything past it is dropped. */
const MAX = 200;
let ids: Set<string> | null = null;

function load(): Set<string> {
  if (ids) return ids;
  ids = new Set();
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(list)) for (const x of list.slice(0, MAX)) if (typeof x === 'string' && x.length <= 40) ids.add(x);
  } catch {
    // unreadable or refused: start empty
  }
  return ids;
}

export function isSaved(id: string): boolean {
  return load().has(id);
}

export function savedIds(): ReadonlySet<string> {
  return load();
}

/** Save it or take it off; returns whether it's saved now. */
export function toggleSaved(id: string): boolean {
  const s = load();
  const on = !s.has(id);
  if (on) s.add(id);
  else s.delete(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    // not kept, but saved for this visit
  }
  return on;
}
