// The wheel's sounds, synthesized: there is no recording of a scrap-built prize wheel in the CC0
// packs. Each peg that slips off the flapper is a click of filtered noise over a short woody knock:
// a rattle while the wheel races, heavier and slower as it winds down, until the last few land one
// at a time. The stop is a dull thunk of timber on its axle and a creak of leather. Clicks are
// scheduled on the audio clock from the spin's planned times, so they stay even whatever the frame
// rate. Everything goes through the shared master gain, so mute and volume apply.

import type { Sfx } from '../../audio/sfx.ts';

export class WheelSound {
  private noise: AudioBuffer | null = null;

  constructor(private readonly sfx: Sfx) {}

  /** The audio context, only while it is running (a suspended one would bank clicks and play them all at once). */
  private ctx(): AudioContext | null {
    try {
      const c = this.sfx.audio;
      return c.state === 'running' ? c : null;
    } catch {
      return null;
    }
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

  /** A peg slipping off the flapper `at` seconds from now; `speed` 0..1 of the wheel's top speed. */
  click(at: number, speed: number): void {
    const c = this.ctx();
    if (!c) return;
    const s = Math.max(0, Math.min(1, speed));
    const t = c.currentTime + Math.max(0, at);
    // the snap of leather off steel
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = (1900 + 1800 * s) * (0.9 + Math.random() * 0.2);
    band.Q.value = 2.8;
    const gain = c.createGain();
    const peak = 0.09 + 0.16 * (1 - s);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.018 + 0.04 * (1 - s));
    src.connect(band).connect(gain).connect(this.sfx.out);
    src.start(t, Math.random() * 1.2, 0.08);
    // the knock of the peg in the wood behind it
    this.knock(t, 520 + 240 * s, 0.05 + 0.08 * (1 - s), 0.03 + 0.03 * (1 - s));
    if (s < 0.35) this.thump(t, 0.08 * (1 - s / 0.35), 150);
  }

  /** The wheel coming to rest: a thunk through the frame and a creak of the leather. */
  stop(at = 0): void {
    const c = this.ctx();
    if (!c) return;
    const t = c.currentTime + Math.max(0, at);
    this.thump(t, 0.2, 120);
    this.knock(t + 0.004, 300, 0.1, 0.09);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 9;
    band.frequency.setValueAtTime(700, t + 0.05);
    band.frequency.exponentialRampToValueAtTime(420, t + 0.35);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t + 0.05);
    gain.gain.linearRampToValueAtTime(0.035, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.4);
    src.connect(band).connect(gain).connect(this.sfx.out);
    src.start(t + 0.05, Math.random(), 0.4);
  }

  /** The wheel hauled round: a heavy rush of air and a groan from the axle. */
  pull(): void {
    const c = this.ctx();
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(180, t);
    band.frequency.exponentialRampToValueAtTime(700, t + 0.5);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
    src.connect(band).connect(gain).connect(this.sfx.out);
    src.start(t, Math.random() * 0.5, 0.9);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.45);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.5);
    o.connect(lp).connect(g).connect(this.sfx.out);
    o.start(t);
    o.stop(t + 0.55);
  }

  /** Chips going down into the terminal's hopper. */
  drop(): void {
    const c = this.ctx();
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 3; i++) this.knock(t + i * 0.045 + Math.random() * 0.02, 1400 + Math.random() * 500, 0.03, 0.02);
    this.thump(t + 0.12, 0.05, 180);
  }

  private knock(t: number, hz: number, level: number, len: number): void {
    const c = this.ctx();
    if (!c) return;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(hz * 0.7, t + len);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0004, t + len);
    o.connect(g).connect(this.sfx.out);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  private thump(t: number, level: number, hz: number): void {
    const c = this.ctx();
    if (!c) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(hz * 0.5, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.16);
    o.connect(g).connect(this.sfx.out);
    o.start(t);
    o.stop(t + 0.18);
  }
}
