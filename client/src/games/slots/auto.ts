// Hold to spin and Auto on the slot machines. The driver decides when the next spin goes: only
// once the one before it has settled (the reels stopped and whatever it paid shown), and never
// while a spin is still out. It sends nothing itself: `spin` is the machine's own Spin, the same
// action a single press sends, so the server's rules, limits and pace apply to every spin.
//
// Holding (Space or the Spin button) spins again each time the last spin settles until it's let
// go. Auto spins at the bet on the deck until one of its stops says enough, the credits can't
// cover the bet, the server refuses a spin, or the player does anything at all at the machine.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';

/** What Auto stops on besides running out of credits (always). Nulls are off. */
export interface AutoStops {
  /** How many spins; null runs until something else stops it. */
  spins: number | null;
  /** Stop once the credits are under this. */
  below: Cents | null;
  /** Stop on any one spin that pays more than this. */
  winOver: Cents | null;
  /** Stop when free games or a bonus play. */
  feature: boolean;
}

export const AUTO_SPINS: readonly (number | null)[] = [10, 25, 50, 100, null];

/** What one settled spin came to, as the machine showed it. */
export interface SpinOutcome {
  bet: Cents;
  win: Cents;
  /** Credits on the machine after the spin. */
  credit: Cents;
  /** Free games or a bonus (the Cherry Wheel) played. */
  feature: boolean;
  /** The machine's top award (its jackpot): Auto always stops there. */
  jackpot: boolean;
}

/** Why Auto should stop after this spin, or null to carry on. */
export function autoStop(stops: AutoStops, left: number | null, o: SpinOutcome): string | null {
  if (o.jackpot) return `Jackpot ${formatMoney(o.win)}`;
  if (stops.feature && o.feature) return 'Feature played';
  if (stops.winOver !== null && o.win > stops.winOver) return `Won ${formatMoney(o.win)}`;
  if (left !== null && left <= 0) return 'Spins done';
  if (o.credit < o.bet) return 'Out of credits';
  if (stops.below !== null && o.credit < stops.below) return `Credits under ${formatMoney(stops.below)}`;
  return null;
}

/**
 * The machine's Spin. `true`: the spin went out. `false`: the machine is busy (a spin is still
 * playing), so wait for it to settle. A string: it can't spin (no credits, not seated) and says
 * why; holding and Auto stop there.
 */
export type SpinFn = () => true | false | string;

export interface DriverHooks {
  spin: SpinFn;
  /** Holding, Auto or the count changed: redraw the deck. */
  changed(): void;
  /** Auto stopped: why ('' when the player stopped it). */
  stopped(reason: string): void;
}

export class SpinDriver {
  holding = false;
  auto: { stops: AutoStops; left: number | null; spun: number } | null = null;
  /** A spin the driver sent that hasn't settled yet. */
  inFlight = false;

  constructor(private readonly hooks: DriverHooks) {}

  /** Holding or on Auto: the machine keeps going on its own. */
  get running(): boolean {
    return this.holding || this.auto !== null;
  }

  /** Space or the Spin button went down (true) or came up (false). */
  hold(on: boolean): void {
    if (on === this.holding) return;
    this.holding = on;
    this.hooks.changed();
    if (on) this.next();
  }

  start(stops: AutoStops): void {
    this.auto = { stops, left: stops.spins, spun: 0 };
    this.hooks.changed();
    this.next();
  }

  /**
   * Stop Auto and any hold. The spin already out plays to the end; nothing more goes. A reason
   * ('' when the player stopped it) is said if Auto was on; null stops quietly.
   */
  stop(reason: string | null = null): void {
    if (!this.running) return;
    const wasAuto = this.auto !== null;
    this.auto = null;
    this.holding = false;
    this.hooks.changed();
    if (reason !== null && wasAuto) this.hooks.stopped(reason);
  }

  /** A spin has played out on the machine (any spin: Auto's, a hold's or a single press). */
  settled(o: SpinOutcome | null): void {
    this.inFlight = false;
    if (this.auto && o) {
      const why = autoStop(this.auto.stops, this.auto.left, o);
      if (why) {
        this.stop(why);
        return;
      }
    }
    this.next();
  }

  /** The server refused the spin: stop, and say why. */
  refused(msg: string): void {
    this.inFlight = false;
    const wasAuto = this.auto !== null;
    this.auto = null;
    this.holding = false;
    this.hooks.changed();
    if (wasAuto) this.hooks.stopped(msg);
  }

  /** Forget a spin that won't settle here (the table reconnected, say): stop to be safe. */
  reset(): void {
    this.inFlight = false;
    this.stop(null);
  }

  private next(): void {
    if (this.inFlight || !this.running) return;
    const r = this.hooks.spin();
    if (r === true) {
      this.inFlight = true;
      if (this.auto) {
        this.auto.spun++;
        if (this.auto.left !== null) this.auto.left--;
      }
      this.hooks.changed();
    } else if (typeof r === 'string') this.stop(r);
  }
}

/** The count on the Auto button while it runs: spins still to finish (the one playing too), or spun so far. */
export function autoCount(auto: { left: number | null; spun: number }, inFlight: boolean): string {
  return auto.left === null ? `${auto.spun} spun` : `${auto.left + (inFlight ? 1 : 0)} left`;
}
