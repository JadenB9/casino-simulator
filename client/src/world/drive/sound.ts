// v7: the street's sounds, made on the game's audio context (the volume and mute apply): a car's
// engine (a note that climbs with the speed, on while you drive), a crash (a thump and a crunch of
// noise, as loud as it was hard), a horn, tyres screeching, and a gunshot (each gun's own weight).
// Sounds from further away are quieter; nothing plays past a street's length.

import type { Sfx } from '../../audio/sfx.ts';

export class StreetSounds {
  private engine: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode } | null = null;

  constructor(private readonly sfx: Sfx | undefined) {}

  /** The engine, while you drive: `rpm` 0..1 of the way up its note, `load` how hard it's pulling. Null stops it. */
  engineAt(rpm: number | null, load = 0): void {
    const ctx = this.ctx();
    if (rpm === null || !ctx) {
      if (this.engine) {
        const e = this.engine;
        this.engine = null;
        const t = e.g.context.currentTime;
        e.g.gain.cancelScheduledValues(t);
        e.g.gain.setTargetAtTime(0, t, 0.08);
        e.o1.stop(t + 0.4);
        e.o2.stop(t + 0.4);
      }
      return;
    }
    if (!this.engine) {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'square';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      f.Q.value = 2;
      const g = ctx.createGain();
      g.gain.value = 0;
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      o1.connect(f);
      o2.connect(g2).connect(f);
      f.connect(g).connect(this.sfx!.out);
      o1.start();
      o2.start();
      this.engine = { o1, o2, g, f };
    }
    const e = this.engine;
    const t = ctx.currentTime;
    const hz = 38 + rpm * 120;
    e.o1.frequency.setTargetAtTime(hz, t, 0.05);
    e.o2.frequency.setTargetAtTime(hz * 0.5, t, 0.05);
    e.f.frequency.setTargetAtTime(380 + rpm * 900 + load * 500, t, 0.06);
    e.g.gain.setTargetAtTime(0.035 + load * 0.035 + rpm * 0.02, t, 0.08);
  }

  /** A crash, `hard` 0..1, `far` metres away. */
  crash(hard: number, far = 0): void {
    const ctx = this.ctx();
    const vol = this.near(far) * (0.2 + 0.5 * Math.min(1, hard));
    if (!ctx || vol <= 0.01) return;
    const t = ctx.currentTime;
    // the thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og).connect(this.sfx!.out);
    o.start(t);
    o.stop(t + 0.4);
    // the crunch: noise through a band that falls
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(2400, t);
    band.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    band.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(band).connect(ng).connect(this.sfx!.out);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.55);
  }

  /** A car's horn: two notes together, `far` metres away. */
  horn(far = 0, secs = 0.45): void {
    const ctx = this.ctx();
    const vol = this.near(far) * 0.08;
    if (!ctx || vol <= 0.005) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + secs - 0.05);
    g.gain.linearRampToValueAtTime(0, t + secs);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    f.connect(g).connect(this.sfx!.out);
    for (const hz of [349, 440]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.connect(f);
      o.start(t);
      o.stop(t + secs + 0.02);
    }
  }

  /** Tyres screeching (the handbrake, a hard stop). */
  screech(far = 0, secs = 0.6): void {
    const ctx = this.ctx();
    const vol = this.near(far) * 0.05;
    if (!ctx || vol <= 0.005) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.linearRampToValueAtTime(0, t + secs);
    src.connect(band).connect(g).connect(this.sfx!.out);
    src.start(t, Math.random() * 2);
    src.stop(t + secs + 0.05);
  }

  /** A gunshot: `weight` 0.3 (a small pistol) .. 1 (a rifle, a hand cannon), `far` metres away. */
  shot(weight: number, far = 0): void {
    const ctx = this.ctx();
    const vol = this.near(far) * (0.12 + 0.16 * weight);
    if (!ctx || vol <= 0.005) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'lowpass';
    hp.frequency.setValueAtTime(5000, t);
    hp.frequency.exponentialRampToValueAtTime(400 + 300 * (1 - weight), t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + 0.2 * weight);
    src.connect(hp).connect(g).connect(this.sfx!.out);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.4);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 - 60 * weight, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(og).connect(this.sfx!.out);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** An empty click (out of rounds), and the reload's metal. */
  click(): void {
    const ctx = this.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(g).connect(this.sfx!.out);
    o.start(t);
    o.stop(t + 0.04);
  }

  /** How loud something `far` metres away is, 0..1. */
  private near(far: number): number {
    return far <= 3 ? 1 : Math.max(0, 1 - (far - 3) / 60);
  }

  private ctx(): AudioContext | null {
    if (!this.sfx || this.sfx.muted) return null;
    const ctx = this.sfx.audio;
    return ctx.state === 'running' ? ctx : null;
  }

  dispose(): void {
    this.engineAt(null);
  }
}

const noises = new WeakMap<AudioContext, AudioBuffer>();

/** A few seconds of white noise, made once per context. */
function noise(ctx: AudioContext): AudioBuffer {
  let b = noises.get(ctx);
  if (!b) {
    const n = ctx.sampleRate * 3;
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noises.set(ctx, b);
  }
  return b;
}
