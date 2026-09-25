// The law's sounds, synthesized (nothing to download): a punch's whoosh (noise swept down through
// a band-pass as the fist goes past), the thud when it lands (a low knock and a short slap of
// noise), and the jail's door buzzer and bolt. Through the game's master gain (Sfx.out), so mute
// and the volume setting apply; someone else's come from where they stand.

import type { Sfx } from '../../audio/sfx.ts';

/** Past this many metres from the camera, another player's punch isn't heard. */
const RANGE = 16;

export class LawSounds {
  private noise: AudioBuffer | null = null;

  constructor(private readonly sfx: Sfx) {}

  /** The swing, from `at` (world metres) or your own with null. */
  whoosh(at: { x: number; y: number; z: number } | null, ears: { x: number; y: number; z: number }): void {
    const o = this.open(at, ears, 0.34);
    if (!o) return;
    const { ctx, out, t, done } = o;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseOf(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.2, 0.26);
    src.onended = done;
  }

  /** The fist landing, `delay` seconds from now. */
  thud(at: { x: number; y: number; z: number } | null, ears: { x: number; y: number; z: number }, delay = 0): void {
    const o = this.open(at, ears, 0.6, delay);
    if (!o) return;
    const { ctx, out, t, done } = o;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(1, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.22);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseOf(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(lp).connect(ng).connect(out);
    src.start(t, Math.random() * 0.2, 0.08);
    osc.onended = done;
  }

  /** The jail's door: a buzz, then the bolt going back. */
  buzzer(): void {
    const o = this.open(null, { x: 0, y: 0, z: 0 }, 0.16);
    if (!o) return;
    const { ctx, out, t, done } = o;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 118;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.02);
    g.gain.setValueAtTime(1, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.78);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.8);
    osc.onended = done;
    this.thud(null, { x: 0, y: 0, z: 0 }, 0.85);
  }

  private open(at: { x: number; y: number; z: number } | null, ears: { x: number; y: number; z: number }, level: number, delay = 0): { ctx: AudioContext; out: AudioNode; t: number; done: () => void } | null {
    const sfx = this.sfx;
    if (sfx.muted) return null;
    const ctx = sfx.audio;
    if (ctx.state !== 'running') return null;
    if (at && Math.hypot(at.x - ears.x, at.z - ears.z) > RANGE) return null;
    const gain = ctx.createGain();
    gain.gain.value = level;
    let pan: PannerNode | null = null;
    if (at) {
      pan = ctx.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 1.5;
      pan.rolloffFactor = 1.3;
      pan.maxDistance = RANGE * 2;
      pan.positionX.value = at.x;
      pan.positionY.value = at.y;
      pan.positionZ.value = at.z;
      gain.connect(pan).connect(sfx.out);
    } else {
      gain.connect(sfx.out);
    }
    const done = () => {
      gain.disconnect();
      pan?.disconnect();
    };
    return { ctx, out: gain, t: ctx.currentTime + 0.01 + delay, done };
  }

  private noiseOf(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const n = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }
}
