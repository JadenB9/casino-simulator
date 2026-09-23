// Machine sounds, synthesised in WebAudio (the casino's sound pack has no reels or bells). Every
// voice goes through the shared Sfx master, so the site's mute covers it. Melodies stay in C major,
// the way slot banks are tuned so neighbours don't clash.

import type { Sfx } from '../../audio/sfx.ts';

const C_MAJOR = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25, 783.99, 1046.5];

export class MachineSound {
  private whir: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noise: AudioBuffer | null = null;

  constructor(
    private readonly sfx: Sfx,
    private readonly style: 'stepper' | 'video',
  ) {}

  private get ctx(): AudioContext | null {
    try {
      const c = this.sfx.audio;
      return c.state === 'closed' ? null : c;
    } catch {
      return null;
    }
  }

  private noiseBuffer(c: AudioContext): AudioBuffer {
    if (!this.noise) {
      const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
    }
    return this.noise;
  }

  /** One bell-like note: a sine with a bright inharmonic partial, struck and left to ring. */
  private bell(freq: number, when: number, gain: number, decay = 0.9): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + when;
    for (const [mult, g] of [[1, 1], [2.76, 0.28], [5.4, 0.08]] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      const e = c.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(gain * g, t + 0.006);
      e.gain.exponentialRampToValueAtTime(0.0001, t + decay / mult);
      o.connect(e).connect(this.sfx.out);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  /** The button press. */
  press(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    const e = c.createGain();
    e.gain.setValueAtTime(0.25, t);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(f).connect(e).connect(this.sfx.out);
    src.start(t, Math.random() * 0.5, 0.06);
  }

  /** Motor whir while the reels turn. */
  startWhir(): void {
    const c = this.ctx;
    if (!c || this.whir) return;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.style === 'stepper' ? 420 : 900;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(this.style === 'stepper' ? 0.1 : 0.05, c.currentTime + 0.15);
    src.connect(f).connect(gain).connect(this.sfx.out);
    src.start();
    this.whir = { src, gain };
  }

  stopWhir(): void {
    const c = this.ctx;
    if (!c || !this.whir) return;
    const { src, gain } = this.whir;
    gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.05);
    src.stop(c.currentTime + 0.3);
    this.whir = null;
  }

  /** A reel landing: a stepper's clunk, or a video reel's soft thud. */
  reelStop(i: number): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = this.style === 'stepper' ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(this.style === 'stepper' ? 150 - i * 6 : 190 - i * 8, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(this.style === 'stepper' ? 0.5 : 0.3, t + 0.004);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(e).connect(this.sfx.out);
    o.start(t);
    o.stop(t + 0.16);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1800;
    const n = c.createGain();
    n.gain.setValueAtTime(this.style === 'stepper' ? 0.16 : 0.05, t);
    n.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(f).connect(n).connect(this.sfx.out);
    src.start(t, Math.random() * 0.5, 0.05);
  }

  /** A short win phrase: rising notes of the C major scale, longer for bigger wins. */
  jingle(notes: number): void {
    const start = this.style === 'stepper' ? 4 : 7;
    for (let i = 0; i < notes; i++) this.bell(C_MAJOR[(start + i * 2) % C_MAJOR.length]!, i * 0.11, 0.22, 0.7);
  }

  /** One tick of a credit rollup. */
  tick(): void {
    if (this.style === 'stepper') this.bell(1046.5, 0, 0.07, 0.25);
    else this.bell(1567.98, 0, 0.04, 0.12);
  }

  /** The hand-pay bell: a slow two-note ring. */
  handPayBell(count: number): void {
    for (let i = 0; i < count; i++) {
      this.bell(783.99, i * 0.5, 0.3, 1.2);
      this.bell(659.25, i * 0.5 + 0.25, 0.25, 1.2);
    }
  }

  /** Free games awarded: a quick climb up the scale. */
  feature(): void {
    for (let i = 0; i < 8; i++) this.bell(C_MAJOR[i + 3]!, i * 0.07, 0.18, 0.6);
  }
}
