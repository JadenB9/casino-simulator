// Auto-bet on the page: the Manual / Auto choice at the top of a game's bet panel, the settings
// block that Auto shows (how many bets, stop on a profit, stop on a loss, and how the run is
// going), and the stops the driver can't see for itself: the tab going to the background, a dialog
// coming up over the table (leaving's "Leave the table?", a buy-in, Settings), the network going.
// While Auto is chosen the game's main button reads Start autobet or Stop autobet (site.ts paints
// it), and Space presses it.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import { el } from '../../ui/kit.ts';
import { onOverlayChange, overlayCount } from '../../ui/keyboard.ts';
import { AUTO_BETS, AutoBet, autoCount, type AutoStops, type PlayFn } from './auto.ts';
import { SegChoice, labelled } from './screen.ts';

/** The stops last chosen at each game, for the next sitting this visit. */
const remembered = new Map<string, AutoStops>();

export interface AutoControlOpts {
  /** Which game (its stops are remembered apart). */
  game: string;
  /** The beat between one bet playing out and the next going, ms. */
  gapMs: number;
  answerMs?: number;
  play: PlayFn;
  /** The bet a run would place now (the settings' summary). */
  bet(): Cents;
  /** Auto chosen or left, a run started, moved on or stopped: the view redraws. */
  changed(): void;
  /** Tell the player why a run stopped. */
  say(text: string): void;
}

/** A dollar field that can be left empty (off): stop on profit, stop on loss. */
class MoneyInput {
  readonly root: HTMLElement;
  readonly input = el('input', 'os-num-input os-auto-input');

  constructor(label: string, value: Cents | null, onChange: () => void) {
    this.input.type = 'text';
    this.input.inputMode = 'decimal';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'Off';
    this.input.setAttribute('aria-label', `${label} (dollars, empty for off)`);
    this.set(value);
    this.input.addEventListener('change', () => {
      this.set(this.value);
      onChange();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.input.blur();
    });
    const field = el('div', 'os-field');
    field.append(el('span', 'os-bet-sign', '$'), this.input);
    this.root = labelled(label, field);
  }

  /** Whole cents, or null when empty, zero or not a number. */
  get value(): Cents | null {
    const n = Number(this.input.value.replace(/[$,\s]/g, ''));
    return this.input.value.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  }

  set(v: Cents | null): void {
    this.input.value = v === null ? '' : (v / 100).toFixed(2).replace(/\.00$/, '');
  }

  setEnabled(on: boolean): void {
    this.input.disabled = !on;
  }
}

export class AutoControl {
  readonly driver: AutoBet;
  /** Manual or Auto, at the top of the panel. */
  readonly modes: SegChoice<'manual' | 'auto'>;
  /** The settings, shown while Auto is chosen. */
  readonly block = el('div', 'os-auto');
  private readonly count: SegChoice<string>;
  private readonly profit: MoneyInput;
  private readonly loss: MoneyInput;
  private readonly status = el('div', 'os-auto-status');
  private stops: AutoStops;
  /** Why the last run stopped, shown until the next starts or the settings change. */
  private why = '';
  private readonly offs: (() => void)[] = [];

  constructor(private readonly o: AutoControlOpts) {
    this.stops = remembered.get(o.game) ?? { bets: 25, profit: null, loss: null };
    this.driver = new AutoBet(
      {
        play: o.play,
        changed: () => this.changed(),
        stopped: (why) => {
          this.why = why ? `Auto stopped · ${why}` : 'Auto stopped';
          this.paint();
          if (why) o.say(this.why);
        },
      },
      { gapMs: o.gapMs, answerMs: o.answerMs },
    );
    this.modes = new SegChoice<'manual' | 'auto'>(
      [
        { value: 'manual', label: 'Manual', title: 'Bet one round at a time' },
        { value: 'auto', label: 'Auto', title: 'Bet round after round until a stop' },
      ],
      'manual',
      () => this.changed(),
    ).label('Betting');
    this.modes.root.classList.add('os-modes');

    const key = (n: number | null) => (n === null ? '∞' : String(n));
    this.count = new SegChoice<string>(
      AUTO_BETS.map((n) => ({ value: key(n), label: key(n), title: n === null ? 'Until something stops it' : `${n} bets` })),
      key(this.stops.bets),
      (v) => {
        this.stops = { ...this.stops, bets: v === '∞' ? null : Number(v) };
        this.keep();
      },
    );
    this.count.root.classList.add('os-auto-count');
    this.profit = new MoneyInput('Stop on profit', this.stops.profit, () => {
      this.stops = { ...this.stops, profit: this.profit.value };
      this.keep();
    });
    this.loss = new MoneyInput('Stop on loss', this.stops.loss, () => {
      this.stops = { ...this.stops, loss: this.loss.value };
      this.keep();
    });
    const pair = el('div', 'os-auto-stops');
    pair.append(this.profit.root, this.loss.root);
    this.block.append(labelled('Number of bets', this.count.root), pair, this.status);
    this.block.hidden = true;

    // What the driver can't see: the page in the background, a dialog over the table, no network.
    const hidden = () => {
      if (document.visibilityState === 'hidden') this.driver.stop('');
    };
    document.addEventListener('visibilitychange', hidden);
    this.offs.push(() => document.removeEventListener('visibilitychange', hidden));
    this.offs.push(onOverlayChange((open) => open > 0 && this.driver.stop('')));
    const offline = () => this.driver.stop('The connection dropped');
    addEventListener('offline', offline);
    this.offs.push(() => removeEventListener('offline', offline));
    this.paint();
  }

  /** Auto is chosen (the panel shows its settings, the main button starts and stops runs). */
  get on(): boolean {
    return this.modes.value === 'auto';
  }

  get running(): boolean {
    return this.driver.running;
  }

  /** The main button (or Space) while Auto is chosen: start a run, or stop the one going. */
  toggle(): void {
    if (this.driver.running) {
      this.driver.stop('');
      return;
    }
    // a dialog is up (it holds the keyboard): nothing starts behind it
    if (overlayCount() > 0) return;
    this.why = '';
    this.driver.start({ ...this.stops, profit: this.profit.value, loss: this.loss.value });
  }

  /** The main button's words and look while Auto is chosen. */
  label(): { text: string; kind: 'go' | 'plain' } {
    const r = this.driver.run;
    return r ? { text: `Stop autobet · ${autoCount(r)}`, kind: 'plain' } : { text: 'Start autobet', kind: 'go' };
  }

  /** Leave Auto (a game that can't run it now); a run going stops. */
  manual(): void {
    this.driver.stop(null);
    if (this.on) {
      this.modes.set('manual');
      this.changed();
    }
  }

  /** The settings can change only between runs, and Manual/Auto only when `free` (no round showing). */
  setEnabled(free: boolean): void {
    const idle = !this.driver.running;
    this.modes.setEnabled(idle && free);
    this.count.setEnabled(idle);
    this.profit.setEnabled(idle);
    this.loss.setEnabled(idle);
  }

  update(dt: number): void {
    this.driver.update(dt);
  }

  dispose(): void {
    this.driver.stop(null);
    for (const off of this.offs.splice(0)) off();
  }

  private keep(): void {
    remembered.set(this.o.game, { ...this.stops });
    this.why = '';
    this.paint();
  }

  private changed(): void {
    this.block.hidden = !this.on;
    this.paint();
    this.o.changed();
  }

  /** The line under the settings: what a run would do, how it's going, or why it stopped. */
  private paint(): void {
    const r = this.driver.run;
    let text: string;
    let tone = '';
    if (r) {
      const left = r.stops.bets === null ? `${r.settled} played` : `${r.settled} of ${r.stops.bets}`;
      text = `Running · ${left} · ${formatMoney(r.net, { sign: true })}`;
      tone = r.net > 0 ? 'win' : r.net < 0 ? 'lose' : '';
    } else if (this.why) {
      text = this.why;
    } else {
      const n = this.stops.bets === null ? 'Bets until stopped' : `${this.stops.bets} bets`;
      const stops = [this.profit.value !== null ? `up ${formatMoney(this.profit.value)}` : '', this.loss.value !== null ? `down ${formatMoney(this.loss.value)}` : ''].filter(Boolean);
      text = `${n} at ${formatMoney(this.o.bet())}${stops.length ? `, stopping ${stops.join(' or ')}` : ''}. Stops when the chips run short.`;
    }
    if (this.status.textContent !== text) this.status.textContent = text;
    this.status.className = `os-auto-status${tone ? ` ${tone}` : ''}`;
  }

  /** The bet changed: the summary says the new amount. */
  refresh(): void {
    this.paint();
  }
}
