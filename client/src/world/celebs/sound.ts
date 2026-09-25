// Two small sounds made on the spot (there are no recordings for them): a camera's shutter for a
// photo with a celebrity, and a bright two-note chime for a gift box opened. Both go through the
// game's master gain (Sfx.out), so mute and the volume setting apply.

import type { Sfx } from '../../audio/sfx.ts';

let noise: AudioBuffer | null = null;

function noiseOf(ctx: AudioContext): AudioBuffer {
  if (noise) return noise;
  const n = Math.floor(ctx.sampleRate * 0.12);
  noise = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

function ready(sfx: Sfx | null | undefined): AudioContext | null {
  if (!sfx || sfx.muted) return null;
  const ctx = sfx.audio;
  return ctx.state === 'running' ? ctx : null;
}

/** A shutter: two short clicks of filtered noise, the second a hair after the first. */
export function shutter(sfx: Sfx | null | undefined, volume = 0.5): void {
  const ctx = ready(sfx);
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.01;
  for (const [at, level, freq] of [[0, 1, 3200], [0.055, 0.7, 2400]] as const) {
    const src = ctx.createBufferSource();
    src.buffer = noiseOf(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(volume * level, t0 + at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + at + 0.045);
    src.connect(bp).connect(g).connect(sfx!.out);
    src.start(t0 + at);
    src.stop(t0 + at + 0.06);
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };
  }
}

/** A chime: a fifth, up, with a soft bell's decay. */
export function chime(sfx: Sfx | null | undefined, volume = 0.22): void {
  const ctx = ready(sfx);
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.01;
  for (const [at, f] of [[0, 1046.5], [0.12, 1568]] as const) {
    for (const [mult, level] of [[1, 1], [2.76, 0.18]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(volume * level, t0 + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + at + 1.1);
      o.connect(g).connect(sfx!.out);
      o.start(t0 + at);
      o.stop(t0 + at + 1.15);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
    }
  }
}
