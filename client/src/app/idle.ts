// Idle: nobody at the keyboard for IDLE_MS (shared/src/protocol.ts) and the casino lets them go.
// This watches the page's own input (keys, mouse, touch, wheel). IDLE_WARN_MS before the end it
// asks "Still there?", and any input starts the clock again; at the end the app leaves any table
// the normal way, closes its sockets and shows the away screen.
//
// The floor and the tables time sockets out on their own too (for a page that can't: asleep, or a
// tab the browser has stopped running). So they always hear of the latest input first, this says
// `here` on the open sockets while there is input: at most once every HERE_MS, and once more after
// the last input, so what the server last heard is never older than the last input. The page
// therefore always goes first, with its warning, and the server's close is only the backstop.
//
// Time is the wall clock. Timers don't run while a laptop sleeps, so waking up (the tab shown,
// the network back, the window focused) checks at once, and a check runs every CHECK_MS anyway.

import { HERE_MS, IDLE_MS, IDLE_WARN_MS } from '../../../shared/src/protocol.ts';

export interface IdleHooks {
  /** Put up the "Still there?"; time runs out at `at` (Date.now() clock). */
  showWarning(at: number): void;
  /** Input came (or the watch stopped) while the warning was up: take it down. */
  hideWarning(): void;
  /** Time's up. The watch has stopped; start() it again after coming back. */
  idle(): void;
  /** Say `here` on every open socket. False if one couldn't take it (reconnecting): tried again soon. */
  here(): boolean;
}

/** Input that counts, heard on the window in the capture phase (nothing on the page can hide it). */
export const INPUT_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'mousemove', 'wheel', 'touchstart'] as const;
/** The longest a check waits, so a page back from sleep notices within this even with no event. */
export const CHECK_MS = 30_000;
/** How soon a `here` that couldn't go out is tried again. */
export const RETRY_MS = 5_000;

type Listen = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface IdleOptions {
  idleMs?: number;
  warnMs?: number;
  hereMs?: number;
  /** Where input, `online` and `focus` are heard (the window). */
  win?: Listen;
  /** Where `visibilitychange` is heard (the document). */
  doc?: Listen & { visibilityState: DocumentVisibilityState };
}

export class IdleWatch {
  private readonly idleMs: number;
  private readonly warnMs: number;
  private readonly hereMs: number;
  private readonly win: Listen;
  private readonly doc: Listen & { visibilityState: DocumentVisibilityState };
  private running = false;
  private warned = false;
  private lastInput = 0;
  /** When a `here` last went out (or the watch started: connecting counts on the server). */
  private lastHere = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hereTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly hooks: IdleHooks,
    opts: IdleOptions = {},
  ) {
    this.idleMs = opts.idleMs ?? IDLE_MS;
    this.warnMs = opts.warnMs ?? IDLE_WARN_MS;
    this.hereMs = opts.hereMs ?? HERE_MS;
    this.win = opts.win ?? window;
    this.doc = opts.doc ?? document;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Start watching, with the clock at zero (after logging in, or coming back). */
  start(): void {
    if (this.running) return;
    this.running = true;
    const now = Date.now();
    this.lastInput = now;
    this.lastHere = now;
    this.warned = false;
    for (const type of INPUT_EVENTS) this.win.addEventListener(type, this.onInput, { capture: true, passive: true });
    this.win.addEventListener('online', this.wake);
    this.win.addEventListener('focus', this.wake);
    this.doc.addEventListener('visibilitychange', this.wake);
    this.schedule(now);
  }

  /** Stop watching (logged out, gone away); a warning that was up comes down. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const type of INPUT_EVENTS) this.win.removeEventListener(type, this.onInput, { capture: true });
    this.win.removeEventListener('online', this.wake);
    this.win.removeEventListener('focus', this.wake);
    this.doc.removeEventListener('visibilitychange', this.wake);
    if (this.timer) clearTimeout(this.timer);
    if (this.hereTimer) clearTimeout(this.hereTimer);
    this.timer = this.hereTimer = null;
    if (this.warned) {
      this.warned = false;
      this.hooks.hideWarning();
    }
  }

  /** Runs on every mouse move, so it only notes the time; the timers do the rest. */
  private readonly onInput = (): void => {
    if (!this.running) return;
    const now = Date.now();
    this.lastInput = now;
    if (this.warned) {
      this.warned = false;
      this.hooks.hideWarning();
    }
    if (now - this.lastHere >= this.hereMs) this.sayHere(now);
    else this.sayHereLater(this.lastHere + this.hereMs - now);
  };

  private readonly wake = (): void => {
    if (this.doc.visibilityState !== 'hidden') this.check();
  };

  private readonly check = (): void => {
    if (!this.running) return;
    const now = Date.now();
    const left = this.lastInput + this.idleMs - now;
    if (left <= 0) {
      this.stop();
      this.hooks.idle();
      return;
    }
    if (left <= this.warnMs && !this.warned) {
      this.warned = true;
      this.hooks.showWarning(this.lastInput + this.idleMs);
    }
    this.schedule(now);
  };

  private schedule(now: number): void {
    if (this.timer) clearTimeout(this.timer);
    const due = this.lastInput + this.idleMs - (this.warned ? 0 : this.warnMs);
    this.timer = setTimeout(this.check, Math.max(0, Math.min(due - now, CHECK_MS)));
  }

  private sayHere(now: number): void {
    if (this.hooks.here()) this.lastHere = now;
    else this.sayHereLater(RETRY_MS);
  }

  /** The `here` after the last input (or a retry): one pending at a time. */
  private sayHereLater(ms: number): void {
    if (this.hereTimer) return;
    this.hereTimer = setTimeout(() => {
      this.hereTimer = null;
      if (this.running && this.lastInput > this.lastHere) this.sayHere(Date.now());
    }, ms);
  }
}
