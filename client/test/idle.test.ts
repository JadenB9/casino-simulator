// The page's idle clock (client/src/app/idle.ts) on a fake clock: the warning a minute before the
// end, input starting it again, the end itself, `here` for the server (never older than the last
// input), and a laptop that slept through the quarter hour.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_MS, INPUT_EVENTS, IdleWatch, RETRY_MS, type IdleHooks } from '../src/app/idle.ts';
import { HERE_MS, IDLE_MS, IDLE_WARN_MS } from '../../shared/src/protocol.ts';

/** An EventTarget stand-in that says who is listening. */
function target() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener(type: string, fn: () => void) {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
    count() {
      return [...listeners.values()].reduce((n, s) => n + s.size, 0);
    },
  };
}

function setup(here: () => boolean = () => true) {
  const win = target();
  const doc = target();
  const log: string[] = [];
  const heres: number[] = [];
  const hooks: IdleHooks = {
    showWarning: (at) => log.push(`warn ${at - t0}`),
    hideWarning: () => log.push('hide'),
    idle: () => log.push(`idle ${Date.now() - t0}`),
    here: () => {
      const ok = here();
      if (ok) heres.push(Date.now() - t0);
      return ok;
    },
  };
  const watch = new IdleWatch(hooks, { win, doc });
  const t0 = Date.now();
  watch.start();
  return { watch, win, doc, log, heres, t0, input: (type = 'pointermove') => win.fire(type) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the idle clock', () => {
  it('warns a minute before the end, then lets go at IDLE_MS, once, and stops listening', () => {
    const { log, win, doc, watch } = setup();
    vi.advanceTimersByTime(IDLE_MS - IDLE_WARN_MS - 1);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual([`warn ${IDLE_MS}`]);
    vi.advanceTimersByTime(IDLE_WARN_MS - 1);
    expect(log).toHaveLength(1);
    vi.advanceTimersByTime(1);
    // The warning comes down as it ends (the away screen takes over).
    expect(log).toEqual([`warn ${IDLE_MS}`, 'hide', `idle ${IDLE_MS}`]);
    expect(watch.isRunning).toBe(false);
    expect(win.count() + doc.count()).toBe(0);
    vi.advanceTimersByTime(10 * IDLE_MS);
    expect(log).toHaveLength(3);
  });

  it('any input takes the warning down and starts the clock again', () => {
    const { log, input } = setup();
    vi.advanceTimersByTime(IDLE_MS - 10_000); // well into the warning
    input();
    expect(log).toEqual([`warn ${IDLE_MS}`, 'hide']);
    // A whole new quarter hour from that input.
    vi.advanceTimersByTime(IDLE_MS - IDLE_WARN_MS - 1);
    expect(log).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(log.at(-1)).toBe(`warn ${2 * IDLE_MS - 10_000}`);
    vi.advanceTimersByTime(IDLE_WARN_MS);
    expect(log.at(-1)).toBe(`idle ${2 * IDLE_MS - 10_000}`);
  });

  it('keys, the mouse, touch and the wheel all count', () => {
    for (const type of INPUT_EVENTS) {
      const { log, input, watch } = setup();
      vi.advanceTimersByTime(IDLE_MS - 1_000);
      input(type);
      vi.advanceTimersByTime(IDLE_MS - 1_000);
      expect(log.filter((l) => l.startsWith('idle')), type).toEqual([]);
      watch.stop();
    }
  });

  it('tells the server `here` at most once every HERE_MS, and always after the last input', () => {
    const { heres, input } = setup();
    // Connecting counts on the server, so the first minute says nothing...
    for (let t = 0; t < 30_000; t += 100) {
      vi.advanceTimersByTime(100);
      input();
    }
    expect(heres).toEqual([]);
    // ...and then one `here` covers all of it, a minute after the watch started.
    vi.advanceTimersByTime(HERE_MS);
    expect(heres).toEqual([HERE_MS]);
    // Input again after a quiet spell goes out at once; more within the minute waits for its end.
    vi.advanceTimersByTime(3 * HERE_MS);
    input();
    expect(heres).toEqual([HERE_MS, 4 * HERE_MS + 30_000]);
    vi.advanceTimersByTime(20_000);
    input();
    vi.advanceTimersByTime(HERE_MS);
    expect(heres).toEqual([HERE_MS, 4 * HERE_MS + 30_000, 5 * HERE_MS + 30_000]);
    // No input, nothing more to say; and the last `here` is newer than the last input (at 4:50).
    vi.advanceTimersByTime(5 * HERE_MS);
    expect(heres).toHaveLength(3);
    expect(heres.at(-1)!).toBeGreaterThanOrEqual(4 * HERE_MS + 50_000);
  });

  it('a `here` that could not go out (a socket reconnecting) is tried again until it does', () => {
    let up = false;
    const { heres, input } = setup(() => up);
    vi.advanceTimersByTime(HERE_MS);
    input(); // due at once, but nothing takes it
    expect(heres).toEqual([]);
    vi.advanceTimersByTime(RETRY_MS);
    expect(heres).toEqual([]);
    up = true;
    vi.advanceTimersByTime(RETRY_MS);
    expect(heres).toEqual([HERE_MS + 2 * RETRY_MS]);
    vi.advanceTimersByTime(10 * RETRY_MS);
    expect(heres).toHaveLength(1);
  });

  it('back from sleep: the first wake-up finds the time is up, with no warning first', () => {
    const { log, doc, win } = setup();
    // The laptop sleeps for two hours: the wall clock moves, the timers don't.
    vi.setSystemTime(Date.now() + 2 * 3_600_000);
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange'); // still hidden: nothing to check yet
    expect(log).toEqual([]);
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    expect(log).toEqual([`idle ${2 * 3_600_000}`]);
    win.fire('online');
    expect(log).toHaveLength(1);
  });

  it('with no wake-up event at all, the next check notices within CHECK_MS', () => {
    const { log } = setup();
    vi.advanceTimersByTime(60_000);
    vi.setSystemTime(Date.now() + IDLE_MS);
    vi.advanceTimersByTime(CHECK_MS);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^idle /);
  });

  it('stop() takes a warning down and ends it; start() again is a new quarter hour', () => {
    const { log, watch, input } = setup();
    vi.advanceTimersByTime(IDLE_MS - 30_000);
    watch.stop();
    expect(log).toEqual([`warn ${IDLE_MS}`, 'hide']);
    input();
    vi.advanceTimersByTime(IDLE_MS);
    expect(log).toHaveLength(2);
    const restart = Date.now();
    watch.start();
    vi.advanceTimersByTime(IDLE_MS);
    expect(log.slice(2)).toEqual([`warn ${restart - 1_800_000_000_000 + IDLE_MS}`, 'hide', `idle ${restart - 1_800_000_000_000 + IDLE_MS}`]);
  });
});
