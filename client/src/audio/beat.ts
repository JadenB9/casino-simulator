// A short beat under the dances, synthesized: a kick (a sine dropping from about 130 Hz to 45), a
// snare or a clap on the two and the four (noise through a band-pass, with a little tone under the
// snare), closed hi-hats (high-passed noise, a few milliseconds long) and, for some dances, a bass
// note or a square-wave blip. Each dance has its own bar of eighth notes, played round for as
// long as the dance lasts, at its tempo, starting on its first beat. Quiet, through the game's
// master gain (Sfx.out) so mute and the volume apply; someone else's comes from where they stand,
// behind a panner, and only within earshot, like their claps (audio/claps.ts).

import type { EmoteId } from '../../../shared/src/protocol.ts';
import type { Sfx } from './sfx.ts';

/** Metres from the camera past which another player's beat isn't played at all. */
export const BEAT_RANGE = 14;
/** Levels, relative to the master: your own, and someone else's a metre and a half away. */
const OWN = 0.22;
const OTHER = 0.34;

/**
 * A bar of eight eighth notes per voice ('x' hits, '.' rests): kick, snare, clap, hat, bass,
 * blip. The bass and the blip play `note` (Hz).
 */
interface Pattern {
  k: string;
  s?: string;
  c?: string;
  h?: string;
  b?: string;
  bl?: string;
  note?: number;
}

const PATTERNS: Partial<Record<EmoteId, Pattern>> = {
  // bouncy, and a bass under the kick
  throwback: { k: 'x..x..x.', c: '..x...x.', h: 'xxxxxxxx', b: 'x..x..x.', note: 49 },
  griddy: { k: 'x...x.x.', s: '..x...x.', h: 'x.xxx.xx' },
  floss: { k: 'x.x.x.x.', c: '..x...x.', h: '.x.x.x.x' },
  robot: { k: 'x...x...', s: '..x...x.', h: 'x.x.x.x.', bl: '.x.x.xx.', note: 660 },
  moonwalk: { k: 'x...x...', s: '..x...x.', h: 'xxxxxxxx', b: 'x.xxx.x.', note: 62 },
};

/** Whether this emote has music under it. */
export function hasBeat(e: EmoteId): boolean {
  return e in PATTERNS;
}

/**
 * When each voice hits, seconds from the start, for a dance of `secs` at `beat` seconds a beat
 * (a bar is four beats, eight eighths). Pure, for the tests.
 */
export function beatTimes(e: EmoteId, beat: number, secs: number): Record<'k' | 's' | 'c' | 'h' | 'b' | 'bl', number[]> {
  const p = PATTERNS[e];
  const out = { k: [] as number[], s: [] as number[], c: [] as number[], h: [] as number[], b: [] as number[], bl: [] as number[] };
  if (!p) return out;
  const eighth = beat / 2;
  // leave the last quarter second quiet: the dance is easing out
  for (let i = 0; i * eighth < secs - 0.25; i++) {
    for (const v of ['k', 's', 'c', 'h', 'b', 'bl'] as const) {
      const bar = p[v];
      if (bar && bar[i % 8] === 'x') out[v].push(+(i * eighth).toFixed(4));
    }
  }
  return out;
}

export class Beats {
  private noise: AudioBuffer | null = null;

  constructor(private readonly sfx: Sfx) {}

  /**
   * The dance's music from now: from `at` (world metres), or your own with null. `beat` and
   * `secs` are the dance's (world/gestures.ts). Returns a function that stops what hasn't
   * played yet (the emote was replaced).
   */
  play(e: EmoteId, at: { x: number; y: number; z: number } | null, beat = 0.5, secs = 4): () => void {
    const sfx = this.sfx;
    const ctx = sfx.audio;
    const p = PATTERNS[e];
    if (!p || sfx.muted || ctx.state !== 'running') return () => {};
    const noise = (this.noise ??= whiteNoise(ctx, 0.5));
    const out = ctx.createGain();
    out.gain.value = at ? OTHER : OWN;
    let pan: PannerNode | null = null;
    if (at) {
      pan = ctx.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 1.5;
      pan.rolloffFactor = 1.3;
      pan.maxDistance = BEAT_RANGE * 2;
      setPosition(pan, at.x, at.y, at.z);
      out.connect(pan).connect(sfx.out);
    } else {
      out.connect(sfx.out);
    }
    const t0 = ctx.currentTime + 0.02;
    const times = beatTimes(e, beat, secs);
    const hits: { src: AudioScheduledSourceNode; nodes: AudioNode[] }[] = [];
    for (const t of times.k) hits.push(kick(ctx, out, t0 + t));
    for (const t of times.s) hits.push(snare(ctx, noise, out, t0 + t));
    for (const t of times.c) hits.push(clap(ctx, noise, out, t0 + t));
    for (const t of times.h) hits.push(hat(ctx, noise, out, t0 + t));
    for (const t of times.b) hits.push(tone(ctx, out, t0 + t, p.note ?? 55, 'triangle', beat * 0.45, 0.7));
    for (const t of times.bl) hits.push(tone(ctx, out, t0 + t, p.note ?? 660, 'square', 0.06, 0.12));
    let left = hits.length;
    for (const h of hits) {
      h.src.onended = () => {
        for (const n of h.nodes) n.disconnect();
        if (--left > 0) return;
        out.disconnect();
        pan?.disconnect();
      };
    }
    return () => {
      for (const h of hits) {
        try {
          h.src.stop();
        } catch {
          /* already over */
        }
      }
    };
  }
}

type Hit = { src: AudioScheduledSourceNode; nodes: AudioNode[] };

function kick(ctx: AudioContext, out: AudioNode, t: number): Hit {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(1, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(env).connect(out);
  o.start(t);
  o.stop(t + 0.32);
  return { src: o, nodes: [o, env] };
}

function noiseHit(ctx: AudioContext, noise: AudioBuffer, out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, len: number): Hit {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(env).connect(out);
  src.start(t, Math.random() * (noise.duration - len - 0.05));
  src.stop(t + len + 0.02);
  return { src, nodes: [src, f, env] };
}

function snare(ctx: AudioContext, noise: AudioBuffer, out: AudioNode, t: number): Hit {
  const body = tone(ctx, out, t, 190, 'triangle', 0.08, 0.35);
  const n = noiseHit(ctx, noise, out, t, 'bandpass', 1900, 0.7, 0.7, 0.16);
  return { src: n.src, nodes: [...n.nodes, ...body.nodes] };
}

function clap(ctx: AudioContext, noise: AudioBuffer, out: AudioNode, t: number): Hit {
  return noiseHit(ctx, noise, out, t, 'bandpass', 1300, 1.1, 0.8, 0.12);
}

function hat(ctx: AudioContext, noise: AudioBuffer, out: AudioNode, t: number): Hit {
  return noiseHit(ctx, noise, out, t, 'highpass', 7500, 0.6, 0.22, 0.035);
}

function tone(ctx: AudioContext, out: AudioNode, t: number, hz: number, type: OscillatorType, len: number, peak: number): Hit {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = hz;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(env).connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
  return { src: o, nodes: [o, env] };
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
