// Tips: advice at the tables for players who want it. Where a game has a best play (basic
// strategy, the video poker hold list, Q-6-4) the table shows it; elsewhere it says which bets
// are the better ones. Off by default; the settings sheet and the HUD's bulb switch it, and the
// choice is kept for next time.

const KEY = 'casino.tips';

type Listener = (on: boolean) => void;

class Tips {
  private listeners = new Set<Listener>();
  on: boolean;

  constructor() {
    let saved = false;
    try {
      saved = localStorage.getItem(KEY) === '1';
    } catch {
      /* storage blocked */
    }
    this.on = saved;
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    for (const fn of this.listeners) fn(on);
  }

  toggle(): void {
    this.set(!this.on);
  }

  /** Hear every change; returns the unsubscribe. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const tips = new Tips();

/** What a table view sees of the setting. */
export type TipsLike = Pick<Tips, 'on' | 'subscribe'>;
