// The machine's own electronic voice, synthesized: coin-in blips that climb with the bet, a tick
// per card, the hold beep, the credit meter's count-up and a short C-major fanfare for real wins.
// Everything goes through the shared Sfx master gain, so the site's mute covers it.

import type { Sfx } from '../../audio/sfx.ts';

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.51;

export class MachineSounds {
  constructor(private readonly sfx: Sfx) {}

  private tone(freq: number, ms: number, opts: { type?: OscillatorType; gain?: number; at?: number; to?: number } = {}): void {
    if (this.sfx.muted) return;
    const ctx = this.sfx.audio;
    if (ctx.state !== 'running') return;
    const start = ctx.currentTime + (opts.at ?? 0) / 1000;
    const end = start + ms / 1000;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, end);
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.08;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(this.sfx.out);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  /** A coin going in: higher for each coin bet. */
  bet(coins: number): void {
    this.tone(C5 * (1 + coins * 0.12), 60, { gain: 0.06 });
  }

  /** One card landing on the screen. */
  card(i: number): void {
    this.tone(1400 + i * 60, 28, { type: 'triangle', gain: 0.1 });
  }

  hold(on: boolean): void {
    if (on) {
      this.tone(E5, 45, { gain: 0.06 });
      this.tone(C6, 60, { gain: 0.06, at: 45 });
    } else this.tone(G5, 50, { gain: 0.05, to: E5 });
  }

  /** One step of the credit meter counting up. */
  tick(k: number): void {
    this.tone(1760 + k * 400, 16, { type: 'sine', gain: 0.07 });
  }

  /** A win worth more than the bet. Bigger hands get the long arpeggio. */
  win(big: boolean): void {
    const notes = big ? [C5, E5, G5, C6, E6, G5 * 2, C6 * 2] : [C5, E5, G5, C6];
    notes.forEach((f, i) => this.tone(f, big ? 150 : 110, { type: 'triangle', gain: 0.09, at: i * (big ? 95 : 70) }));
  }

  /** A refused button: the dull buzz a machine makes when it won't take the press. */
  refuse(): void {
    this.tone(140, 120, { type: 'sawtooth', gain: 0.04 });
  }
}
