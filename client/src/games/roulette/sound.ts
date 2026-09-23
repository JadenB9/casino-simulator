// The ball's sounds, synthesized: there is no recording of a roulette ball in the CC0 pack. A
// ball rolling on a wooden track is a band of noise whose pitch and level follow its speed, with
// a slight flutter at its revolution rate; hitting a deflector, dropping onto the rotor and
// clattering over frets are short bursts of filtered noise. Everything goes through the shared
// master gain, so mute applies.

import type { Sfx } from '../../audio/sfx.ts';

export class BallSound {
  private noise: AudioBuffer | null = null;
  private roll: { src: AudioBufferSourceNode; band: BiquadFilterNode; gain: GainNode; lfo: OscillatorNode; depth: GainNode } | null = null;

  constructor(private readonly sfx: Sfx) {}

  private ctx(): AudioContext | null {
    try {
      const c = this.sfx.audio;
      return c.state === 'closed' ? null : c;
    } catch {
      return null;
    }
  }

  private noiseBuffer(c: AudioContext): AudioBuffer {
    if (!this.noise) {
      const len = Math.floor(c.sampleRate * 2);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      // slightly pinked so it sounds like wood rather than hiss
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = 0.82 * last + 0.18 * white;
        d[i] = last * 2.2;
      }
      this.noise = buf;
    }
    return this.noise;
  }

  /** The rolling sound starts quietly; set() drives it from the ball's speed. */
  startRoll(): void {
    const c = this.ctx();
    if (!c || this.roll) return;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    src.loop = true;
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 1.1;
    const gain = c.createGain();
    gain.gain.value = 0;
    // flutter: the ball's revolution rate modulates the level a little
    const lfo = c.createOscillator();
    lfo.frequency.value = 2.5;
    const depth = c.createGain();
    depth.gain.value = 0;
    lfo.connect(depth).connect(gain.gain);
    src.connect(band).connect(gain).connect(this.sfx.out);
    src.start();
    lfo.start();
    this.roll = { src, band, gain, lfo, depth };
  }

  /** speed: 0..1 of launch speed; revPerSec for the flutter; onTrack false while it runs down the bowl. */
  setRoll(speed: number, revPerSec: number, onTrack: boolean): void {
    const c = this.ctx();
    if (!c || !this.roll) return;
    const t = c.currentTime;
    const s = Math.max(0, Math.min(1, speed));
    const level = (onTrack ? 0.05 : 0.035) + 0.11 * s;
    this.roll.gain.gain.setTargetAtTime(level, t, 0.06);
    this.roll.depth.gain.setTargetAtTime(level * 0.35, t, 0.06);
    this.roll.band.frequency.setTargetAtTime((onTrack ? 900 : 1300) + 2200 * s, t, 0.08);
    this.roll.lfo.frequency.setTargetAtTime(Math.max(0.5, revPerSec), t, 0.1);
  }

  stopRoll(): void {
    const c = this.ctx();
    const r = this.roll;
    this.roll = null;
    if (!c || !r) return;
    const t = c.currentTime;
    r.gain.gain.cancelScheduledValues(t);
    r.gain.gain.setTargetAtTime(0, t, 0.05);
    r.src.stop(t + 0.4);
    r.lfo.stop(t + 0.4);
  }

  /** A short hard click: the ball against a fret, a deflector, or landing in a pocket. */
  click(strength: number, pitch = 1): void {
    const c = this.ctx();
    if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600 * pitch * (0.9 + Math.random() * 0.2);
    band.Q.value = 4;
    const body = c.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 900 * pitch;
    body.gain.value = 6;
    const gain = c.createGain();
    const peak = Math.min(0.5, 0.08 + 0.4 * strength);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.05 + 0.04 * strength);
    src.connect(band).connect(body).connect(gain).connect(this.sfx.out);
    src.start(t, Math.random() * 1.5, 0.12);
  }

  dispose(): void {
    this.stopRoll();
  }
}
