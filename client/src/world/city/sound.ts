// The elevator's sounds, made on the game's audio context (so the volume and mute apply): the
// two-note chime a car gives as its doors open, the doors' soft rumble, and the ride's hum.

import type { Sfx } from '../../audio/sfx.ts';

export class LiftSounds {
  constructor(private readonly sfx: Sfx | undefined) {}

  /** The arrival chime: two bell notes, a fifth apart, going up (or down for a car going down). */
  chime(down = false): void {
    const ctx = this.ctx();
    if (!ctx) return;
    const notes = down ? [1318.5, 880] : [880, 1318.5];
    notes.forEach((f, i) => this.bell(ctx, f, ctx.currentTime + i * 0.28, 0.12));
  }

  /** The doors running on their track, quietly. */
  doors(volume = 0.05): void {
    const ctx = this.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const len = 1.0;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, len);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 220;
    band.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.15);
    g.gain.setValueAtTime(volume, t + len - 0.3);
    g.gain.linearRampToValueAtTime(0, t + len);
    src.connect(band).connect(g).connect(this.sfx!.out);
    src.start(t);
  }

  /** The ride: a low hum that swells and settles over `secs`. */
  ride(secs: number): void {
    const ctx = this.ctx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(58, t);
    o.frequency.linearRampToValueAtTime(74, t + secs * 0.5);
    o.frequency.linearRampToValueAtTime(60, t + secs);
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, secs);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 340;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.5);
    g.gain.setValueAtTime(0.07, t + secs - 0.6);
    g.gain.linearRampToValueAtTime(0, t + secs);
    o.connect(g);
    src.connect(low).connect(g);
    g.connect(this.sfx!.out);
    o.start(t);
    src.start(t);
    o.stop(t + secs + 0.05);
  }

  private ctx(): AudioContext | null {
    if (!this.sfx || this.sfx.muted) return null;
    const ctx = this.sfx.audio;
    return ctx.state === 'running' ? ctx : null;
  }

  private bell(ctx: AudioContext, f: number, at: number, vol: number): void {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, at + 1.6);
    g.connect(this.sfx!.out);
    // a bell: the note, a quieter inharmonic partial, and a touch of the octave
    for (const [k, v] of [
      [1, 1],
      [2.76, 0.18],
      [2, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * k;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(at);
      o.stop(at + 1.7);
    }
  }
}

const noises = new WeakMap<AudioContext, AudioBuffer>();

/** A few seconds of soft noise, made once per context and reused. */
function noise(ctx: AudioContext, secs: number): AudioBuffer {
  let b = noises.get(ctx);
  if (!b || b.duration < secs) {
    const n = Math.ceil(ctx.sampleRate * Math.max(secs, 4));
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      // brown-ish: each sample a small step from the last
      last = (last + (Math.random() * 2 - 1) * 0.08) * 0.985;
      d[i] = last * 3;
    }
    noises.set(ctx, b);
  }
  return b;
}
