// The clapper, synthesized: there is no recording of a money wheel in the CC0 pack. Each peg
// that slips off the leather is a short click of filtered noise with a woody knock under it: light
// and bright while the wheel races (dozens a second, a ratchet), heavier and duller as it slows,
// until the last few land one at a time. Ticks are scheduled on the audio clock from the spin's
// planned times, so they stay even whatever the frame rate. Everything goes through the shared
// master gain, so mute and volume apply.

import type { Sfx } from '../../audio/sfx.ts';

export class ClapperSound {
  private noise: AudioBuffer | null = null;

  constructor(private readonly sfx: Sfx) {}

  /** The audio context, only while it is running (a suspended one would bank ticks and play them all at once). */
  private ctx(): AudioContext | null {
    try {
      const c = this.sfx.audio;
      return c.state === 'running' ? c : null;
    } catch {
      return null;
    }
  }

  /** Seconds on the audio clock right now, or null when sound is off. */
  now(): number | null {
    return this.ctx()?.currentTime ?? null;
  }

  private noiseBuffer(c: AudioContext): AudioBuffer {
    if (!this.noise) {
      const len = Math.floor(c.sampleRate * 1.5);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  }

  /** A peg slipping off the leather `at` seconds from now; `speed` 0..1 of the wheel's top speed. */
  tick(at: number, speed: number): void {
    const c = this.ctx();
    if (!c) return;
    const s = Math.max(0, Math.min(1, speed));
    const t = c.currentTime + Math.max(0, at);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = (1500 + 2300 * s) * (0.92 + Math.random() * 0.16);
    band.Q.value = 2.2;
    const knock = c.createBiquadFilter();
    knock.type = 'peaking';
    knock.frequency.value = 480 + 260 * s;
    knock.Q.value = 2.5;
    knock.gain.value = 10;
    const gain = c.createGain();
    const peak = 0.1 + 0.2 * (1 - s);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.025 + 0.055 * (1 - s));
    src.connect(band).connect(knock).connect(gain).connect(this.sfx.out);
    src.start(t, Math.random() * 1.2, 0.1);
    if (s < 0.3) this.thump(t, 0.09 * (1 - s / 0.3), 200);
  }

  /** The wheel coming to rest against a peg: a dull knock and a creak of leather. */
  settle(at = 0): void {
    const c = this.ctx();
    if (!c) return;
    const t = c.currentTime + Math.max(0, at);
    this.thump(t, 0.12, 150);
  }

  /** The dealer's hand hauling the wheel round: a short rising rush of air and bearing. */
  pull(): void {
    const c = this.ctx();
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(260, t);
    band.frequency.exponentialRampToValueAtTime(900, t + 0.45);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.07, t + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.7);
    src.connect(band).connect(gain).connect(this.sfx.out);
    src.start(t, Math.random() * 0.5, 0.8);
  }

  private thump(t: number, level: number, hz: number): void {
    const c = this.ctx();
    if (!c) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(hz * 0.55, t + 0.07);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.09);
    o.connect(g).connect(this.sfx.out);
    o.start(t);
    o.stop(t + 0.11);
  }
}
