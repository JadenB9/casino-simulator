// Hand claps for the clap emote, synthesized: each clap is a burst of noise through a band-pass
// around 1-1.6 kHz (where a clap's crack sits), a millisecond or two of attack, a second smaller
// crack a few milliseconds on (two palms never meet all at once) and a tail of about a tenth of a
// second, a little different every time. Quiet, and through the game's master gain (Sfx.out), so
// mute and the volume setting apply. Someone else's come from where they stand, behind a panner
// (the floor's ambience keeps the listener on the camera); your own come from right here.

import type { Sfx } from './sfx.ts';

/** Metres from the camera past which another player's claps aren't played at all. */
export const CLAP_RANGE = 12;
/** Levels, relative to the master: your own, and someone else's a metre and a half away. */
const OWN = 0.3;
const OTHER = 0.42;

export class Claps {
  private noise: AudioBuffer | null = null;

  constructor(private readonly sfx: Sfx) {}

  /**
   * Claps at `times` seconds from now: from `at` (world metres), or your own with null. Returns a
   * function that stops the ones not yet heard (the emote was replaced).
   */
  play(times: readonly number[], at: { x: number; y: number; z: number } | null): () => void {
    const sfx = this.sfx;
    const ctx = sfx.audio;
    if (sfx.muted || ctx.state !== 'running' || times.length === 0) return () => {};
    const noise = (this.noise ??= whiteNoise(ctx, 0.4));
    const out = ctx.createGain();
    out.gain.value = at ? OTHER : OWN;
    let pan: PannerNode | null = null;
    if (at) {
      pan = ctx.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 1.5;
      pan.rolloffFactor = 1.4;
      pan.maxDistance = CLAP_RANGE * 2;
      setPosition(pan, at.x, at.y, at.z);
      out.connect(pan).connect(sfx.out);
    } else {
      out.connect(sfx.out);
    }
    const t0 = ctx.currentTime + 0.01;
    const claps = times.map((t) => clap(ctx, noise, out, t0 + t + (Math.random() - 0.5) * 0.01));
    let left = claps.length;
    for (const c of claps) {
      c.src.onended = () => {
        for (const n of c.nodes) n.disconnect();
        if (--left > 0) return;
        out.disconnect();
        pan?.disconnect();
      };
    }
    return () => {
      for (const c of claps) {
        try {
          c.src.stop();
        } catch {
          /* already over */
        }
      }
    };
  }
}

/** One clap into `out` at time `t`: its source, and every node it made (to let go of after). */
function clap(ctx: AudioContext, noise: AudioBuffer, out: AudioNode, t: number): { src: AudioBufferSourceNode; nodes: AudioNode[] } {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.92 + Math.random() * 0.16;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1050 + Math.random() * 550;
  band.Q.value = 0.9;
  const low = ctx.createBiquadFilter();
  low.type = 'highpass';
  low.frequency.value = 380;
  const env = ctx.createGain();
  const peak = 0.85 + Math.random() * 0.3;
  const g = env.gain;
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(peak, t + 0.0015);
  g.exponentialRampToValueAtTime(peak * 0.28, t + 0.006);
  g.linearRampToValueAtTime(peak * 0.62, t + 0.0085);
  g.exponentialRampToValueAtTime(0.0001, t + 0.11);
  src.connect(band).connect(low).connect(env).connect(out);
  src.start(t, Math.random() * (noise.duration - 0.15));
  src.stop(t + 0.12);
  return { src, nodes: [src, band, low, env] };
}

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function setPosition(p: PannerNode, x: number, y: number, z: number): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}
