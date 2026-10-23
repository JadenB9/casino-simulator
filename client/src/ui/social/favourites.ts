// The emotes you like best, kept in this browser: the ones you've starred on the wheel (F), shown
// as quick picks in the chat box, and the last one you made, which Space on the wheel makes again.
// One limit for every way an emote goes out (the wheel, the chat's picks): the floor lets three
// through in a burst, then one every two seconds (server/src/floor/index.ts), and this keeps the
// same count a little slower, so nothing is sent that the server would drop.

import { EMOTES, FREE_EMOTES, type EmoteId } from '../../../../shared/src/protocol.ts';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const FAV_KEY = 'casino.emotes.favs';
const LAST_KEY = 'casino.emotes.last';
/** As many favourites as the chat's row has room for. */
export const FAV_MAX = 6;
/** Until you star any: the first four everyone has. */
export const FAV_DEFAULT: readonly EmoteId[] = FREE_EMOTES.slice(0, 4);

const listeners = new Set<() => void>();

function store(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

const isEmote = (x: unknown): x is EmoteId => typeof x === 'string' && (EMOTES as readonly string[]).includes(x);

/** Your starred emotes, in the order starred; the default four until you star one. */
export function favourites(s: Store | null = store()): EmoteId[] {
  try {
    const raw: unknown = JSON.parse(s?.getItem(FAV_KEY) ?? 'null');
    if (Array.isArray(raw)) return [...new Set(raw.filter(isEmote))].slice(0, FAV_MAX);
  } catch {
    /* corrupt or blocked: the default */
  }
  return [...FAV_DEFAULT];
}

/** Star or unstar one; past FAV_MAX the oldest star goes. Returns whether it's starred now. */
export function toggleFavourite(e: EmoteId, s: Store | null = store()): boolean {
  const now = favourites(s);
  const on = !now.includes(e);
  const next = on ? [...now, e].slice(-FAV_MAX) : now.filter((x) => x !== e);
  try {
    s?.setItem(FAV_KEY, JSON.stringify(next));
  } catch {
    /* blocked: kept for this visit only, through the listeners */
  }
  for (const fn of listeners) fn();
  return on;
}

export function onFavourites(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The last emote you made, if any. */
export function lastEmote(s: Store | null = store()): EmoteId | null {
  try {
    const v = s?.getItem(LAST_KEY);
    return isEmote(v) ? v : null;
  } catch {
    return null;
  }
}

export function noteEmote(e: EmoteId, s: Store | null = store()): void {
  try {
    s?.setItem(LAST_KEY, e);
  } catch {
    /* not kept */
  }
}

const BURST = 3;
/** The server refills at 0.5 a second; a tenth slower here absorbs network jitter. */
const REFILL_PER_S = 0.45;

/** The send limit every emote goes through. */
export class EmoteGate {
  private tokens = BURST;

  constructor(private at = performance.now()) {}

  take(now = performance.now()): boolean {
    this.tokens = Math.min(BURST, this.tokens + (Math.max(0, now - this.at) / 1000) * REFILL_PER_S);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** The one gate for this page: the wheel and the chat's picks share it. */
export const emoteGate = new EmoteGate();
