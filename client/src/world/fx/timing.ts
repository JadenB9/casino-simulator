// When the shop's effects play. The floor sends each one as an FxEvent with the server time it
// starts (`at`, later than now when a busy room has queued it behind another) and ends (`until`),
// and again in the `fxs` list after every hello, so a page that joins late (or reconnects) comes
// in part way through. Everything here is pure: the player (index.ts) asks it every frame what to
// start, what to end and how loud each one is by now.

import { EFFECTS, effectItem, type EffectReach, type FxEvent } from '../../../../shared/src/items.ts';

/** Where an effect is in its life at server time `now` (ms): not yet, playing, or over. */
export interface FxPhase {
  state: 'wait' | 'play' | 'done';
  /** Seconds since it started (0 while waiting). */
  t: number;
  /** Seconds it has left (its whole length while waiting). */
  left: number;
}

export function phaseOf(ev: Pick<FxEvent, 'at' | 'until'>, now: number): FxPhase {
  const len = Math.max(0, ev.until - ev.at) / 1000;
  if (now < ev.at) return { state: 'wait', t: 0, left: len };
  if (now >= ev.until) return { state: 'done', t: len, left: 0 };
  return { state: 'play', t: (now - ev.at) / 1000, left: (ev.until - now) / 1000 };
}

/**
 * How far up an effect is: rising over `rise` seconds from its start, falling over the last
 * `fall` seconds before its end, eased at both ends. 0 to 1.
 */
export function envelope(t: number, left: number, rise: number, fall: number): number {
  const a = rise > 0 ? Math.min(1, Math.max(0, t / rise)) : 1;
  const b = fall > 0 ? Math.min(1, Math.max(0, left / fall)) : left > 0 ? 1 : 0;
  return smooth(a) * smooth(b);
}

export function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/** One event's identity: the same effect bought once arrives as `fx` and again in `fxs`. */
export function fxKey(ev: Pick<FxEvent, 'fx' | 'id' | 'at'>): string {
  return `${ev.fx}:${ev.id}:${ev.at}`;
}

/** Whether an event is well formed enough to play: a known effect, sane times, a point on the floor. */
export function playable(ev: unknown): ev is FxEvent {
  if (!ev || typeof ev !== 'object') return false;
  const e = ev as Record<string, unknown>;
  return (
    effectItem(e.fx) !== null &&
    Number.isSafeInteger(e.id) &&
    typeof e.name === 'string' &&
    Number.isFinite(e.at) &&
    Number.isFinite(e.until) &&
    (e.until as number) > (e.at as number) &&
    (e.until as number) - (e.at as number) <= MAX_MS &&
    Number.isFinite(e.x) &&
    Number.isFinite(e.z)
  );
}

/** The longest any effect lasts, with room for the server's rounding: longer events are refused. */
const MAX_MS = (Math.max(...EFFECTS.map((e) => e.secs)) + 5) * 1000;

export function reachOf(fx: string): EffectReach {
  return effectItem(fx)?.reach ?? 'you';
}

/**
 * The events the page knows about, keyed so a repeat is the same event. `add` takes a live `fx`
 * message; `sync` takes the `fxs` list after a hello, which is everything still playing or
 * queued: anything known that isn't in it (it ended while we were away) is let go.
 */
export class FxBook {
  private readonly events = new Map<string, FxEvent>();

  /** True if it's new. */
  add(ev: FxEvent): boolean {
    if (!playable(ev)) return false;
    const k = fxKey(ev);
    if (this.events.has(k)) return false;
    this.events.set(k, { ...ev });
    return true;
  }

  /** Replace what's known with the server's list; returns the keys that were let go. */
  sync(list: readonly FxEvent[], now: number): string[] {
    const keep = new Set<string>();
    for (const ev of list) {
      if (!playable(ev)) continue;
      keep.add(fxKey(ev));
      this.add(ev);
    }
    const gone: string[] = [];
    for (const [k, ev] of this.events) {
      // one that arrived live after the list left the server is kept
      if (!keep.has(k) && ev.at <= now) {
        this.events.delete(k);
        gone.push(k);
      }
    }
    return gone;
  }

  /** Forget events that are over. */
  prune(now: number): void {
    for (const [k, ev] of this.events) if (ev.until <= now) this.events.delete(k);
  }

  get(k: string): FxEvent | undefined {
    return this.events.get(k);
  }

  list(): FxEvent[] {
    return [...this.events.values()].sort((a, b) => a.at - b.at);
  }

  get size(): number {
    return this.events.size;
  }
}
