// The shop's effects, heard: every sound made here from oscillators and noise, like the claps
// (claps.ts), through the game's master gain so mute and the volume setting apply. Each effect's
// sound comes from where it happens (a panner; the floor's ambience keeps the listener on the
// camera), or from everywhere for the casino-wide ones.
//
//   confetti   two cannon pops, then paper settling
//   spotlight  the follow spot's shutter opening with a heavy clunk
//   round      a cork, the fizz, and glasses touching
//   rain       a cash register's bell, then bills fluttering down
//   sparklers  the fountains catching with a whoosh, then their hiss and crackle
//   disco      a four-on-the-floor groove for as long as it plays (muffled outside the room)
//   marquee    a short brass fanfare
//   golden     a harp's run up, a shimmer, and coins ringing as they land

import type { Sfx } from './sfx.ts';

export type At = { x: number; y: number; z: number } | null;

/** Stops a sound that's still going (fading it out quickly). */
export type Stop = () => void;

const NONE: Stop = () => {};

export class FxSounds {
  private noiseBuf: AudioBuffer | null = null;

  constructor(private readonly sfx: Sfx) {}

  private get ready(): AudioContext | null {
    const ctx = this.sfx.audio;
    return this.sfx.muted || ctx.state !== 'running' ? null : ctx;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    return (this.noiseBuf ??= whiteNoise(ctx, 2));
  }

  /** An output for one sound: at a point, or everywhere; `level` relative to the master. */
  private out(ctx: AudioContext, at: At, level: number, ref = 2): { node: GainNode; done: () => void } {
    const g = ctx.createGain();
    g.gain.value = level;
    let pan: PannerNode | null = null;
    if (at) {
      pan = ctx.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = ref;
      pan.rolloffFactor = 1.3;
      pan.maxDistance = 40;
      place(pan, at);
      g.connect(pan).connect(this.sfx.out);
    } else {
      g.connect(this.sfx.out);
    }
    return {
      node: g,
      done: () => {
        g.disconnect();
        pan?.disconnect();
      },
    };
  }

  // --- the effects ------------------------------------------------------------------------------

  confetti(at: At): void {
    const ctx = this.ready;
    if (!ctx) return;
    const o = this.out(ctx, at, 0.55);
    const t = ctx.currentTime + 0.02;
    this.pop(ctx, o.node, t, 1);
    this.pop(ctx, o.node, t + 0.22, 0.8);
    this.rustle(ctx, o.node, t + 0.3, 3.5, 0.1);
    setTimeout(o.done, 4500);
  }

  spotlight(at: At, on: boolean): void {
    const ctx = this.ready;
    if (!ctx) return;
    const o = this.out(ctx, at, on ? 0.5 : 0.3, 3);
    const t = ctx.currentTime + 0.02;
    // the shutter's lever: a click, then the heavy body of the lamp answering it
    this.hit(ctx, o.node, t, { f: 2400, q: 1.4, decay: 0.03, level: 0.5 });
    this.thump(ctx, o.node, t + 0.015, 95, 42, 0.22, 0.9);
    this.hit(ctx, o.node, t + 0.02, { f: 600, q: 0.8, decay: 0.09, level: 0.35 });
    setTimeout(o.done, 800);
  }

  round(at: At): void {
    const ctx = this.ready;
    if (!ctx) return;
    const o = this.out(ctx, at, 0.5);
    const t = ctx.currentTime + 0.02;
    // the cork: a squeak of pressure let go, a pop
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(1500, t + 0.04);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(g).connect(o.node);
    osc.start(t);
    osc.stop(t + 0.08);
    this.hit(ctx, o.node, t, { f: 900, q: 0.7, decay: 0.05, level: 0.8 });
    // the fizz as it's poured
    this.hiss(ctx, o.node, t + 0.35, 2.2, { f: 7000, q: 0.5, level: 0.05 });
    // glasses meeting round the room
    for (let i = 0; i < 7; i++) this.clink(ctx, o.node, t + 1.1 + i * 0.16 + Math.random() * 0.2, 0.25 + Math.random() * 0.2);
    setTimeout(o.done, 4000);
  }

  rain(at: At, secs: number): Stop {
    const ctx = this.ready;
    if (!ctx) return NONE;
    const o = this.out(ctx, at, 0.5);
    const t = ctx.currentTime + 0.02;
    // the drawer's clack and the register's bell
    this.hit(ctx, o.node, t, { f: 1800, q: 2, decay: 0.04, level: 0.6 });
    this.hit(ctx, o.node, t + 0.05, { f: 700, q: 1.2, decay: 0.08, level: 0.4 });
    this.bell(ctx, o.node, t + 0.12, 1318, 0.35, 1.4);
    this.bell(ctx, o.node, t + 0.12, 2637, 0.12, 0.8);
    const stop = this.rustle(ctx, o.node, t + 0.4, secs - 0.5, 0.14);
    const timer = setTimeout(o.done, (secs + 1) * 1000);
    return () => {
      stop();
      clearTimeout(timer);
      setTimeout(o.done, 400);
    };
  }

  sparklers(at: At, secs: number): Stop {
    const ctx = this.ready;
    if (!ctx) return NONE;
    const o = this.out(ctx, at, 0.5, 2.5);
    const t = ctx.currentTime + 0.02;
    // catching: a rush of air rising in pitch, and a low push
    const src = this.source(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(3500, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(lp).connect(g).connect(o.node);
    src.start(t);
    src.stop(t + 0.75);
    this.thump(ctx, o.node, t, 70, 38, 0.35, 0.6);
    // the fountains: a hiss with crackle through it
    const stopHiss = this.hiss(ctx, o.node, t + 0.2, secs - 0.2, { f: 5200, q: 0.7, level: 0.14, crackle: true });
    const timer = setTimeout(o.done, (secs + 1) * 1000);
    return () => {
      stopHiss();
      clearTimeout(timer);
      setTimeout(o.done, 400);
    };
  }

  /**
   * The disco's groove for `secs`: from `at` (the mirror ball), heard plainly inside the room and
   * through the wall outside it (`inside` is asked as it plays).
   */
  disco(at: At, secs: number, inside: () => boolean): Stop {
    const ctx = this.ready;
    if (!ctx) return NONE;
    const o = this.out(ctx, at, 0.42, 5);
    const wall = ctx.createBiquadFilter();
    wall.type = 'lowpass';
    wall.frequency.value = 18000;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(wall).connect(o.node);
    const t0 = ctx.currentTime + 0.1;
    bus.gain.setValueAtTime(0, t0);
    bus.gain.linearRampToValueAtTime(1, t0 + 2);
    const end = t0 + secs;
    bus.gain.setValueAtTime(1, end - 2.5);
    bus.gain.linearRampToValueAtTime(0, end);
    const bpm = 118;
    const step = 60 / bpm / 4;
    // Dm7 | G7 | Cmaj7 | A7, a bar each
    const roots = [73.42, 98.0, 65.41, 110.0];
    const chords = [
      [293.66, 349.23, 440.0, 523.25],
      [196.0, 246.94, 293.66, 349.23],
      [261.63, 329.63, 392.0, 493.88],
      [220.0, 277.18, 329.63, 392.0],
    ];
    let n = 0;
    let wasInside: boolean | null = null;
    const tick = () => {
      const inRoom = inside();
      if (inRoom !== wasInside) {
        wasInside = inRoom;
        // through a wall the highs go and the beat stays
        wall.frequency.setTargetAtTime(inRoom ? 18000 : 420, ctx.currentTime, 0.2);
      }
      while (t0 + n * step < Math.min(end, ctx.currentTime + 0.35)) {
        const t = t0 + n * step;
        const s = n % 16;
        const bar = Math.floor(n / 16) % 4;
        if (s % 4 === 0) this.thump(ctx, bus, t, 150, 48, 0.32, 0.95);
        if (s % 4 === 2) this.hit(ctx, bus, t, { f: 9000, q: 0.6, decay: 0.11, level: 0.2, high: true });
        else this.hit(ctx, bus, t, { f: 10000, q: 0.8, decay: 0.025, level: 0.07, high: true });
        if (s === 4 || s === 12) this.hit(ctx, bus, t, { f: 1500, q: 0.9, decay: 0.16, level: 0.4 });
        // octave bass on the eighths
        if (s % 2 === 0) this.bass(ctx, bus, t, roots[bar]! * (s % 4 === 0 ? 1 : 2), step * 1.6);
        // stabs on the "and" of two and four
        if (s === 6 || s === 14) this.stab(ctx, bus, t, chords[bar]!, step * 1.4);
        n++;
      }
      if (t0 + n * step >= end) clearInterval(timer);
    };
    const timer = setInterval(tick, 60);
    tick();
    const cleanup = setTimeout(() => {
      clearInterval(timer);
      bus.disconnect();
      wall.disconnect();
      o.done();
    }, (secs + 1) * 1000);
    return () => {
      clearInterval(timer);
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      clearTimeout(cleanup);
      setTimeout(() => {
        bus.disconnect();
        wall.disconnect();
        o.done();
      }, 1200);
    };
  }

  /** The headline's fanfare; `level` lower the further from the sign. */
  marquee(at: At, level = 1): void {
    const ctx = this.ready;
    if (!ctx) return;
    const o = this.out(ctx, at, 0.34 * level, 8);
    const t = ctx.currentTime + 0.03;
    const notes: [number, number, number][] = [
      [392.0, 0, 0.12],
      [392.0, 0.14, 0.12],
      [392.0, 0.28, 0.12],
      [523.25, 0.42, 0.5],
      [392.0, 0.98, 0.16],
      [523.25, 1.16, 0.16],
      [659.25, 1.34, 0.9],
    ];
    for (const [f, dt, len] of notes) {
      this.brass(ctx, o.node, t + dt, f, len);
      this.brass(ctx, o.node, t + dt, f * 1.5, len, 0.35);
    }
    setTimeout(o.done, 3000);
  }

  /** Golden hour: the harp's run, a shimmer under it all, coins ringing now and then. */
  golden(secs: number): Stop {
    const ctx = this.ready;
    if (!ctx) return NONE;
    const o = this.out(ctx, null, 0.3);
    const t = ctx.currentTime + 0.03;
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0];
    for (let i = 0; i < 15; i++) this.pluck(ctx, o.node, t + i * 0.055, scale[i % 5]! * 2 ** Math.floor(i / 5), 0.3);
    // the shimmer: a soft major chord that breathes
    const pad = ctx.createGain();
    pad.gain.setValueAtTime(0, t);
    pad.gain.linearRampToValueAtTime(0.06, t + 2);
    pad.gain.setValueAtTime(0.06, t + secs - 3);
    pad.gain.linearRampToValueAtTime(0, t + secs);
    pad.connect(o.node);
    const oscs = [523.25, 659.25, 783.99, 1046.5].map((f, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const trem = ctx.createGain();
      trem.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.4 + i * 0.13;
      const depth = ctx.createGain();
      depth.gain.value = 0.3;
      lfo.connect(depth).connect(trem.gain);
      osc.connect(trem).connect(pad);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + secs + 0.1);
      lfo.stop(t + secs + 0.1);
      return osc;
    });
    // coins landing somewhere near
    const coins = setInterval(() => {
      if (!this.ready) return;
      const c = ctx.currentTime + Math.random() * 0.2;
      this.bell(ctx, o.node, c, 2600 + Math.random() * 2400, 0.05 + Math.random() * 0.05, 0.25);
    }, 280);
    const end = setTimeout(() => {
      clearInterval(coins);
      pad.disconnect();
      o.done();
    }, (secs + 1) * 1000);
    return () => {
      clearInterval(coins);
      clearTimeout(end);
      pad.gain.cancelScheduledValues(ctx.currentTime);
      pad.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      for (const osc of oscs) osc.stop(ctx.currentTime + 1);
      setTimeout(() => {
        pad.disconnect();
        o.done();
      }, 1200);
    };
  }

  // --- the instruments -------------------------------------------------------------------------

  private source(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    return src;
  }

  /** A burst of filtered noise: a hat, a clap, a click. */
  private hit(ctx: AudioContext, out: AudioNode, t: number, o: { f: number; q: number; decay: number; level: number; high?: boolean }): void {
    const src = this.source(ctx);
    const f = ctx.createBiquadFilter();
    f.type = o.high ? 'highpass' : 'bandpass';
    f.frequency.value = o.f;
    f.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + o.decay + 0.02);
    src.onended = () => g.disconnect();
  }

  /** A low body: a kick drum, a cannon's boom. */
  private thump(ctx: AudioContext, out: AudioNode, t: number, f0: number, f1: number, decay: number, level: number): void {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.02);
    osc.onended = () => g.disconnect();
  }

  private pop(ctx: AudioContext, out: AudioNode, t: number, level: number): void {
    this.thump(ctx, out, t, 110, 40, 0.3, level);
    this.hit(ctx, out, t, { f: 1100, q: 0.5, decay: 0.16, level: level * 0.9 });
    this.hit(ctx, out, t + 0.01, { f: 4000, q: 0.5, decay: 0.08, level: level * 0.4 });
  }

  /** Paper: soft high noise that comes and goes. Returns a stop. */
  private rustle(ctx: AudioContext, out: AudioNode, t: number, secs: number, level: number): Stop {
    const src = this.source(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 4200;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let k = 0; k < secs * 9; k++) g.gain.setValueAtTime(level * (0.15 + Math.random() * Math.random()) * Math.min(1, (secs - k / 9) / 1.5), t + k / 9);
    g.gain.setTargetAtTime(0.0001, t + secs, 0.2);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + secs + 1);
    src.onended = () => g.disconnect();
    return () => {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
    };
  }

  /** A steady hiss (sparklers, pouring), with crackle if asked. Returns a stop. */
  private hiss(ctx: AudioContext, out: AudioNode, t: number, secs: number, o: { f: number; q: number; level: number; crackle?: boolean }): Stop {
    const src = this.source(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = o.f;
    f.Q.value = o.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.level, t + 0.25);
    g.gain.setValueAtTime(o.level, t + Math.max(0.3, secs - 0.8));
    g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + secs + 0.1);
    src.onended = () => g.disconnect();
    let timer = 0;
    if (o.crackle) {
      const stopAt = ctx.currentTime + secs;
      timer = window.setInterval(() => {
        const now = ctx.currentTime;
        if (now > stopAt) return clearInterval(timer);
        for (let k = 0; k < 6; k++) this.hit(ctx, out, now + Math.random() * 0.1, { f: 2500 + Math.random() * 4000, q: 3, decay: 0.01 + Math.random() * 0.015, level: o.level * (1 + Math.random() * 2) });
      }, 100);
    }
    return () => {
      clearInterval(timer);
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12);
    };
  }

  /** Glass on glass: a few inharmonic partials ringing out. */
  private clink(ctx: AudioContext, out: AudioNode, t: number, level: number): void {
    const base = 2400 + Math.random() * 600;
    for (const [k, a, d] of [
      [1, 1, 0.5],
      [1.47, 0.5, 0.35],
      [2.09, 0.3, 0.22],
    ] as const) {
      this.bell(ctx, out, t, base * k, level * a, d);
    }
  }

  /** One sine partial struck and left to ring. */
  private bell(ctx: AudioContext, out: AudioNode, t: number, f: number, level: number, decay: number): void {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.02);
    osc.onended = () => g.disconnect();
  }

  /** A harp string: a bright pluck that softens as it rings. */
  private pluck(ctx: AudioContext, out: AudioNode, t: number, f: number, level: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 8, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.7);
    osc.onended = () => g.disconnect();
  }

  private bass(ctx: AudioContext, out: AudioNode, t: number, f: number, len: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + len);
    lp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + len + 0.02);
    osc.onended = () => g.disconnect();
  }

  private stab(ctx: AudioContext, out: AudioNode, t: number, notes: readonly number[], len: number): void {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    lp.connect(g).connect(out);
    for (const f of notes) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = detune;
        osc.connect(lp);
        osc.start(t);
        osc.stop(t + len + 0.02);
      }
    }
    setTimeout(() => g.disconnect(), (t - ctx.currentTime + len + 0.2) * 1000);
  }

  /** A brass note: a sawtooth whose filter opens as it's blown, and closes as it ends. */
  private brass(ctx: AudioContext, out: AudioNode, t: number, f: number, len: number, level = 1): void {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 1.2, t);
    lp.frequency.exponentialRampToValueAtTime(f * 5, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(f * 2.5, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * level, t + 0.03);
    g.gain.setValueAtTime(0.3 * level, t + Math.max(0.04, len - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.12);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + len + 0.15);
    osc.onended = () => g.disconnect();
  }
}

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function place(p: PannerNode, at: { x: number; y: number; z: number }): void {
  if (p.positionX) {
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(at.x, at.y, at.z);
  }
}
