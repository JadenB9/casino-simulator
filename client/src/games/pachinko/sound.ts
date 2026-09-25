// The parlour's noise, synthesized: steel balls ticking off brass nails, the launcher's snap, the
// start pocket's chime, the reels' beeps, the rising reach, the jackpot fanfare and the fever's
// bassline. Everything goes through the shared master gain, so mute and volume apply, and nothing
// plays while the audio context is suspended (it would bank the sounds and play them at once).

import type { Sfx } from '../../audio/sfx.ts';

/** C major, a pentatonic run for the fanfares. */
const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];

export class PachinkoSound {
  private noise: AudioBuffer | null = null;
  private lastTick = 0;
  private loop: { stop(): void } | null = null;

  constructor(private readonly sfx: Sfx) {}

  private ctx(): AudioContext | null {
    if (this.sfx.muted) return null;
    try {
      const c = this.sfx.audio;
      return c.state === 'running' ? c : null;
    } catch {
      return null;
    }
  }

  private noiseBuffer(c: AudioContext): AudioBuffer {
    if (!this.noise) {
      const len = Math.floor(c.sampleRate * 0.6);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  }

  private tone(freq: number, at: number, len: number, level: number, type: OscillatorType = 'square', to?: number): void {
    const c = this.ctx();
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + len);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.sfx.out);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  private hiss(at: number, hz: number, q: number, level: number, len: number): void {
    const c = this.ctx();
    if (!c) return;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = hz;
    band.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0004, t + len);
    src.connect(band).connect(g).connect(this.sfx.out);
    src.start(t, Math.random() * 0.4, len + 0.05);
  }

  /** The launcher's hammer: a snap and the ball whirring up the rail. */
  launch(): void {
    this.hiss(0, 2600, 3, 0.05, 0.03);
    this.hiss(0.01, 5200, 1.5, 0.018, 0.25);
  }

  /** Balls on nails: a bright tick, at most one every 22 ms however many balls are falling. */
  tick(strength = 1): void {
    const now = performance.now();
    if (now - this.lastTick < 22) return;
    this.lastTick = now;
    this.hiss(0, 5200 + Math.random() * 2600, 9, 0.022 * strength, 0.02);
  }

  /** Into the start pocket: the chime. */
  start(): void {
    this.tone(1318.51, 0, 0.12, 0.05, 'triangle');
    this.tone(1567.98, 0.08, 0.2, 0.05, 'triangle');
  }

  /** Into a tulip: two quick notes. */
  tulip(): void {
    this.tone(987.77, 0, 0.08, 0.04, 'square');
    this.tone(1318.51, 0.07, 0.12, 0.035, 'square');
  }

  /** A ball paid out into the tray. */
  payout(n: number): void {
    for (let i = 0; i < Math.min(8, n); i++) this.hiss(i * 0.035 + Math.random() * 0.02, 3800 + Math.random() * 1600, 6, 0.03, 0.04);
  }

  /** A reel passing a number, and a reel stopping. */
  reelTick(): void {
    this.tone(1760, 0, 0.025, 0.012, 'square');
  }

  reelStop(): void {
    this.tone(392, 0, 0.09, 0.05, 'square', 330);
  }

  /** The reach: a rising sweep and a heartbeat under it. */
  reach(): void {
    this.tone(220, 0, 1.1, 0.04, 'sawtooth', 880);
    for (let i = 0; i < 6; i++) this.tone(70, 0.4 + i * 0.5, 0.18, 0.08, 'sine', 50);
  }

  /** Three of a kind: the fanfare. */
  fanfare(): void {
    const run = [0, 2, 4, 5, 7, 8];
    run.forEach((n, i) => this.tone(NOTES[n]!, i * 0.09, 0.16, 0.05, 'square'));
    [0, 2, 4].forEach((n) => this.tone(NOTES[n]! / 2, 0.6, 0.9, 0.04, 'sawtooth'));
    [4, 6, 8].forEach((n) => this.tone(NOTES[n]!, 0.62, 0.9, 0.035, 'square'));
  }

  /** Kakuhen: a bell, twice. */
  kakuhen(): void {
    for (const at of [0, 0.35]) {
      this.tone(1567.98, at, 0.5, 0.05, 'triangle');
      this.tone(2093, at + 0.04, 0.4, 0.03, 'sine');
    }
  }

  /** The fever's bassline, looping until stopped. */
  feverOn(): void {
    if (this.loop) return;
    const c = this.ctx();
    if (!c) return;
    let beat = 0;
    const bass = [130.81, 130.81, 196, 164.81, 174.61, 174.61, 196, 220];
    const timer = setInterval(() => {
      this.tone(bass[beat % bass.length]!, 0, 0.16, 0.05, 'sawtooth');
      if (beat % 2 === 0) this.hiss(0, 7000, 1, 0.02, 0.05);
      if (beat % 4 === 2) this.hiss(0, 1800, 0.8, 0.04, 0.09);
      beat++;
    }, 180);
    this.loop = { stop: () => clearInterval(timer) };
  }

  feverOff(): void {
    this.loop?.stop();
    this.loop = null;
  }

  dispose(): void {
    this.feverOff();
  }
}
