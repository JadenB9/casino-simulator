// Auto-bet on the House Originals: a number of bets (or until stopped), stop once up a profit, stop
// once down a loss. The driver only decides when the next bet goes: once the one before it has
// played out on the page and a short beat has passed, never while one is still out. It sends
// nothing itself: `play` is the game's own Bet, the same one the button sends, so the server's
// rules, limits and pace apply to every bet.
//
// It stops at once on anything that means the player isn't simply watching it run: Stop (or
// Space), the chips here short of the bet, the server refusing a bet or not answering one, a fresh
// snapshot of the table (a reconnect), the tab going to the background, a dialog over the table,
// and leaving. The view wires those up; the driver keeps the count and the clock. Time runs on the
// render loop (update), so a page in the background never sends anything.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';

/** What auto stops on besides the chips running short (always). Nulls are off. */
export interface AutoStops {
  /** How many bets; null runs until something else stops it. */
  bets: number | null;
  /** Stop once this much up since the run started. */
  profit: Cents | null;
  /** Stop once this much down since the run started. */
  loss: Cents | null;
}

export interface AutoRun {
  stops: AutoStops;
  /** Bets sent so far. */
  placed: number;
  /** Bets played out so far, and what they came to together (returns less stakes). */
  settled: number;
  net: Cents;
}

/** The bet counts on offer (null: until stopped). */
export const AUTO_BETS: readonly (number | null)[] = [10, 25, 100, 500, null];

/** Why a run should stop now that a bet has played out, or null to carry on. */
export function autoStop(run: AutoRun): string | null {
  const { stops, settled, net } = run;
  if (stops.profit !== null && net >= stops.profit) return `Profit reached · ${formatMoney(net, { sign: true })}`;
  if (stops.loss !== null && -net >= stops.loss) return `Loss limit reached · ${formatMoney(net, { sign: true })}`;
  if (stops.bets !== null && settled >= stops.bets) return `${settled} bets played · ${formatMoney(net, { sign: true })}`;
  return null;
}

/**
 * The game's Bet. `true`: it went out. `false`: the page is busy (a round still showing, the
 * Crash window not open yet), so try again on a later frame. A string: it can't (the chips are
 * short, nothing picked) and says why; the run stops there.
 */
export type PlayFn = () => boolean | string;

export interface AutoHooks {
  play: PlayFn;
  /** The run started, moved on or stopped: redraw the button and the count. */
  changed(): void;
  /** The run stopped: why ('' when the player stopped it). */
  stopped(reason: string): void;
}

export interface AutoOptions {
  /** The beat between one bet playing out and the next going, ms. */
  gapMs: number;
  /** How long an answer may take before the run gives up on the table, ms. */
  answerMs?: number;
}

export class AutoBet {
  run: AutoRun | null = null;
  /** Bets this run sent that haven't played out. */
  private out = 0;
  /** Seconds left of the beat before the next bet. */
  private beat = 0;
  /** When the last thing sent went (performance.now()), until the table answers it. */
  private askedAt: number | null = null;

  constructor(
    private readonly hooks: AutoHooks,
    private readonly opts: AutoOptions,
  ) {}

  get running(): boolean {
    return this.run !== null;
  }

  /** Bets still to go in this run, the one out included (null: no count). */
  get left(): number | null {
    const r = this.run;
    return r && r.stops.bets !== null ? Math.max(0, r.stops.bets - r.settled) : null;
  }

  start(stops: AutoStops, now = performance.now()): void {
    if (this.run) return;
    this.run = { stops, placed: 0, settled: 0, net: 0 };
    this.out = 0;
    this.beat = 0;
    this.askedAt = null;
    this.hooks.changed();
    this.next(now);
  }

  /**
   * Stop the run. A bet already out plays to the end on the page; nothing more goes. The reason
   * ('' when the player stopped it) is told; null stops quietly.
   */
  stop(reason: string | null = ''): void {
    if (!this.run) return;
    this.run = null;
    this.out = 0;
    this.askedAt = null;
    this.hooks.changed();
    if (reason !== null) this.hooks.stopped(reason);
  }

  /** The table answered what was last sent (its event arrived): the answer clock stops. */
  answered(): void {
    this.askedAt = null;
  }

  /** Something more went out within a bet (a tile, a cash-out): the answer clock starts again. */
  asked(now = performance.now()): void {
    if (this.run) this.askedAt = now;
  }

  /** A bet of this run has played out on the page: its stake and what came back. */
  settled(bet: Cents, returned: Cents): void {
    const r = this.run;
    if (!r || this.out === 0) return;
    this.out--;
    r.settled++;
    r.net += returned - bet;
    const why = autoStop(r);
    if (why) {
      this.stop(why);
      return;
    }
    this.beat = this.opts.gapMs / 1000;
    this.hooks.changed();
  }

  /** The table turned something down: the run stops and says why. */
  refused(msg: string): void {
    if (this.run) this.stop(msg || 'The table turned the bet down');
  }

  /** The table started over from a snapshot (a reconnect): whatever was out won't settle here. */
  reset(): void {
    this.stop(this.run && (this.out > 0 || this.run.placed > 0) ? 'The table reconnected' : null);
  }

  /** Each frame: the beat between bets, and an answer that never came. */
  update(dt: number, now = performance.now()): void {
    if (!this.run) return;
    if (this.askedAt !== null && now - this.askedAt > (this.opts.answerMs ?? 6_000)) {
      this.stop("The table didn't answer");
      return;
    }
    if (this.out > 0) return;
    if (this.beat > 0) {
      this.beat -= dt;
      if (this.beat > 0) return;
    }
    this.next(now);
  }

  private next(now: number): void {
    const r = this.run;
    if (!r || this.out > 0) return;
    if (r.stops.bets !== null && r.placed >= r.stops.bets) return;
    const res = this.hooks.play();
    if (res === true) {
      r.placed++;
      this.out++;
      this.askedAt = now;
      this.hooks.changed();
    } else if (typeof res === 'string') this.stop(res);
  }
}

/** The count on the button while a run goes: bets still to finish, or played so far. */
export function autoCount(run: AutoRun): string {
  return run.stops.bets === null ? `${run.settled} played` : `${Math.max(0, run.stops.bets - run.settled)} left`;
}
