// The bar's small sounds, made on the spot with WebAudio (no files to fetch): a cork's pop, the
// hiss of a sprayed bottle, two glasses' clink, candles blown out. Quieter the further off they
// are from the camera, and silent until the app hands over its sound (with its volume and mute).

import type * as THREE from 'three';

export interface AudioOut {
  readonly audio: AudioContext;
  readonly out: AudioNode;
  readonly muted: boolean;
}

let sink: AudioOut | null = null;
let ears: (() => THREE.Vector3) | null = null;
let noiseBuf: AudioBuffer | null = null;

export function useSound(out: AudioOut | null, listener: (() => THREE.Vector3) | null): void {
  sink = out;
  ears = listener;
}

export type Sound = 'pop' | 'hiss' | 'clink' | 'blow';

/** Full volume within 2 m, gone past 14. */
function gainAt(at: THREE.Vector3 | null): number {
  if (!at || !ears) return 1;
  const d = ears().distanceTo(at);
  if (d > 14) return 0;
  return Math.min(1, 2 / Math.max(2, d));
}

function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (s / 0x7fffffff) * 2 - 1;
  }
  noiseBuf = b;
  return b;
}

export function play(sound: Sound, at: THREE.Vector3 | null = null, volume = 1): void {
  if (!sink || sink.muted) return;
  const g0 = gainAt(at) * volume;
  if (g0 <= 0.01) return;
  let ctx: AudioContext;
  try {
    ctx = sink.audio;
  } catch {
    return;
  }
  if (ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  const out = ctx.createGain();
  out.gain.value = g0;
  out.connect(sink.out);
  const env = (node: AudioNode, peak: number, attack: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g).connect(out);
    return g;
  };
  const hiss = (type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, delay = 0) => {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(peak, t + delay + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + attack + decay);
    f.connect(g).connect(out);
    src.start(t + delay, Math.random());
    src.stop(t + delay + attack + decay + 0.05);
  };
  const tone = (freq: number, peak: number, decay: number, type: OscillatorType = 'sine', drop = 1) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (drop !== 1) o.frequency.exponentialRampToValueAtTime(freq * drop, t + decay);
    env(o, peak, 0.004, decay);
    o.start(t);
    o.stop(t + decay + 0.05);
  };
  switch (sound) {
    case 'pop':
      // a thump and a short bright burst: the cork leaving
      tone(190, 0.5, 0.09, 'sine', 0.45);
      hiss('bandpass', 1400, 1.2, 0.5, 0.002, 0.07);
      break;
    case 'hiss':
      // the spray: bright foam hissing out, fading over a couple of seconds
      hiss('highpass', 2600, 0.7, 0.16, 0.05, 1.8, 0.02);
      hiss('bandpass', 5200, 0.8, 0.08, 0.1, 1.2, 0.05);
      break;
    case 'clink':
      // two glasses: a few high partials ringing out
      tone(2630, 0.16, 0.7);
      tone(4180, 0.1, 0.45);
      tone(5470, 0.05, 0.25);
      tone(2711, 0.08, 0.55);
      break;
    case 'blow':
      hiss('lowpass', 700, 0.5, 0.35, 0.08, 0.45);
      break;
  }
}
