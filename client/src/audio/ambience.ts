// The room itself: a casino floor is never quiet. Under everything a low room tone (the air
// handling); over it the murmur of people at the pit, the bar and the poker room; soft chimes from
// the slot islands; now and then chips clicking at a table somewhere; and a bell from wherever
// someone has just won big.
//
// All of it is synthesized here except the chips, which are the Kenney recordings (CC0) the tables
// already use (docs/CREDITS.md). The murmur is speech-shaped noise with the slow, shallow wobble
// of many overlapping voices, which is what a crowd becomes a few metres off; the chimes are FM
// bells on a pentatonic scale. Every source stands somewhere on the floor behind a PannerNode and
// the listener follows the camera, so the slots get louder as you walk into them and the pit falls
// away behind you. Seated at a table the whole bed ducks, so the table's own sounds lead. It all
// runs through the game's master gain (Sfx.out): mute and the volume setting apply as they do to
// every other sound.

import type * as THREE from 'three';
import type { Sfx } from './sfx.ts';

export interface AmbienceSpots {
  /** Where people talk, with how many (1 = a table's worth): the pit, the bar, the poker room. */
  crowd: { x: number; z: number; size: number }[];
  /** The slot islands. */
  slots: { x: number; z: number }[];
  /** Tables, for chips. */
  tables: { x: number; z: number }[];
}

/** The whole bed, relative to the master volume. */
const LEVEL = 0.55;
/** Seated at a table the room steps back to this. */
const SEATED = 0.35;
const CHIP_SOUNDS = ['chips-collide', 'chips-stack', 'chip-lay', 'chips-handle'];
/** C major pentatonic across two octaves, in Hz: a slot machine's favourite scale. */
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

export class Ambience {
  private readonly ctx: AudioContext;
  private readonly bus: GainNode;
  private readonly duck: GainNode;
  private readonly wet: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private chips = new Map<string, AudioBuffer[]>();
  private nextChip = 1.5;
  private readonly nextChime: number[];
  private seated = false;
  private started = false;
  private disposed = false;

  constructor(
    private readonly sfx: Sfx,
    private readonly spots: AmbienceSpots,
  ) {
    const ctx = sfx.audio;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    // A big room: a short synthetic tail on everything, mixed in under the dry sound.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = roomImpulse(ctx, 1.8);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.bus.connect(this.duck);
    this.bus.connect(this.reverb).connect(this.wet).connect(this.duck);
    this.duck.connect(sfx.out);
    this.nextChime = spots.slots.map(() => 1 + Math.random() * 6);
    void this.loadChips();
  }

  /**
   * Call every frame: follows the camera, ducks while seated, and schedules the one-shots. The
   * beds start the first time the audio context is running (after the first click or key).
   */
  update(dt: number, camera: THREE.Camera, seated: boolean): void {
    if (this.disposed || this.ctx.state !== 'running') return;
    if (!this.started) this.start();
    this.listen(camera);
    if (seated !== this.seated) {
      this.seated = seated;
      this.duck.gain.setTargetAtTime(seated ? SEATED : 1, this.ctx.currentTime, 0.6);
    }
    if (this.sfx.muted) return;
    this.nextChip -= dt;
    if (this.nextChip <= 0) {
      this.nextChip = 0.9 + Math.random() * 3.2;
      const t = pick(this.spots.tables);
      if (t) this.chipsAt(t.x + (Math.random() - 0.5) * 2, t.z + (Math.random() - 0.5) * 2);
    }
    this.spots.slots.forEach((s, i) => {
      this.nextChime[i]! -= dt;
      if (this.nextChime[i]! > 0) return;
      this.nextChime[i] = 3 + Math.random() * 7;
      this.chime(s.x + (Math.random() - 0.5) * 2.4, s.z + (Math.random() - 0.5) * 2, 2 + Math.floor(Math.random() * 4), 0.05);
    });
  }

  /** A big win somewhere: a rising run of bells from that spot (or from the room, with no spot). */
  bell(at: { x: number; z: number } | null): void {
    if (this.disposed || this.ctx.state !== 'running' || this.sfx.muted) return;
    const x = at?.x ?? 0;
    const z = at?.z ?? 0;
    this.chime(x, z, 9, 0.16, 0.085, at === null);
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* never started */
      }
    }
    for (const n of this.nodes) n.disconnect();
    this.bus.disconnect();
    this.duck.disconnect();
    this.reverb.disconnect();
    this.wet.disconnect();
  }

  // --- the beds ------------------------------------------------------------------------------

  private start(): void {
    this.started = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.bus.gain.setTargetAtTime(LEVEL, now, 1.5);

    // Room tone: brown noise under 200 Hz, everywhere at once.
    const hum = this.loop(brownNoise(ctx, 6));
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 190;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.16;
    hum.connect(low).connect(humGain).connect(this.bus);
    this.nodes.push(low, humGain);

    // The murmur: one bed per crowd, each its own stretch of noise so no two move together.
    const noise = whiteNoise(ctx, 8);
    const wobble = modulation(ctx, 12);
    for (const c of this.spots.crowd) {
      const src = this.loop(noise, Math.random() * 8);
      // speech-shaped: most of the energy between 250 Hz and 1 kHz, little above 2.5 kHz
      const hp = biquad(ctx, 'highpass', 160, 0.7);
      const body = biquad(ctx, 'peaking', 480, 0.9, 7);
      const lp = biquad(ctx, 'lowpass', 1900, 0.6);
      const lp2 = biquad(ctx, 'lowpass', 2600, 0.5);
      const amp = ctx.createGain();
      amp.gain.value = 0.8;
      // many voices overlapping: a shallow, irregular 3-6 Hz flutter on the level
      const mod = this.loop(wobble, Math.random() * 12);
      const depth = ctx.createGain();
      depth.gain.value = 0.28;
      mod.connect(depth).connect(amp.gain);
      const level = ctx.createGain();
      level.gain.value = 0.11 * Math.sqrt(c.size);
      const pan = this.panner(c.x, 1.4, c.z, 5.5);
      src.connect(hp).connect(body).connect(lp).connect(lp2).connect(amp).connect(level).connect(pan).connect(this.bus);
      this.nodes.push(hp, body, lp, lp2, amp, depth, level, pan);
    }
  }

  private loop(buffer: AudioBuffer, offset = 0): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(this.ctx.currentTime, offset % buffer.duration);
    this.sources.push(src);
    this.nodes.push(src);
    return src;
  }

  private panner(x: number, y: number, z: number, ref: number): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    p.maxDistance = 60;
    setPosition(p, x, y, z);
    return p;
  }

  private listen(camera: THREE.Camera): void {
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    // position, then the camera's forward (-z) and up (+y) in world space
    const px = e[12]!;
    const py = e[13]!;
    const pz = e[14]!;
    const fx = -e[8]!;
    const fy = -e[9]!;
    const fz = -e[10]!;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(px, t, 0.05);
      l.positionY.setTargetAtTime(py, t, 0.05);
      l.positionZ.setTargetAtTime(pz, t, 0.05);
      l.forwardX.setTargetAtTime(fx, t, 0.05);
      l.forwardY.setTargetAtTime(fy, t, 0.05);
      l.forwardZ.setTargetAtTime(fz, t, 0.05);
      l.upX.value = e[4]!;
      l.upY.value = e[5]!;
      l.upZ.value = e[6]!;
    } else {
      const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      legacy.setPosition(px, py, pz);
      legacy.setOrientation(fx, fy, fz, e[4]!, e[5]!, e[6]!);
    }
  }

  // --- one-shots -----------------------------------------------------------------------------

  /** A run of FM bells climbing the pentatonic scale, from a spot on the floor. */
  private chime(x: number, z: number, notes: number, level: number, step = 0.11, near = false): void {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.02;
    const pan = near ? null : this.panner(x, 1.6, z, 3.5);
    const out = ctx.createGain();
    out.gain.value = level;
    const tone = biquad(ctx, 'lowpass', 4200, 0.7);
    out.connect(tone);
    if (pan) tone.connect(pan).connect(this.bus);
    else tone.connect(this.bus);
    const first = Math.floor(Math.random() * 3);
    let end = t0;
    for (let i = 0; i < notes; i++) {
      const f = PENTA[Math.min(PENTA.length - 1, first + i)]!;
      const t = t0 + i * step * (0.9 + Math.random() * 0.2);
      end = Math.max(end, bell(ctx, out, f, t, i === notes - 1 ? 1.1 : 0.45));
    }
    // tidy up after the last note has rung out
    setTimeout(() => {
      out.disconnect();
      tone.disconnect();
      pan?.disconnect();
    }, (end - ctx.currentTime + 0.3) * 1000);
  }

  private chipsAt(x: number, z: number): void {
    const bufs = this.chips.get(pick(CHIP_SOUNDS)!);
    if (!bufs?.length) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = pick(bufs)!;
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const g = ctx.createGain();
    g.gain.value = 0.18 + Math.random() * 0.14;
    // far off, the clack loses its top
    const lp = biquad(ctx, 'lowpass', 3200, 0.7);
    const pan = this.panner(x, 0.95, z, 2.5);
    src.connect(lp).connect(g).connect(pan).connect(this.bus);
    src.onended = () => {
      src.disconnect();
      lp.disconnect();
      g.disconnect();
      pan.disconnect();
    };
    src.start();
  }

  /** The tables' chip recordings, decoded once more for this graph (the browser has them cached). */
  private async loadChips(): Promise<void> {
    try {
      const base = `${import.meta.env.BASE_URL}assets/sfx/`;
      const manifest = (await (await fetch(base + 'sfx.json')).json()) as Record<string, string[]>;
      await Promise.all(
        CHIP_SOUNDS.map(async (name) => {
          const files = manifest[name] ?? [];
          const bufs = await Promise.all(files.map(async (f) => this.ctx.decodeAudioData(await (await fetch(base + f)).arrayBuffer())));
          this.chips.set(name, bufs);
        }),
      );
    } catch (err) {
      console.warn('ambience: chips failed to load', err);
    }
  }
}

// --- synthesis ---------------------------------------------------------------------------------

/** One FM bell: a sine carrier, a modulator at 3.5x whose index falls away, a quick attack. */
function bell(ctx: AudioContext, out: AudioNode, f: number, t: number, ring: number): number {
  const car = ctx.createOscillator();
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.frequency.value = f * 3.5;
  const index = ctx.createGain();
  index.gain.setValueAtTime(f * 1.6, t);
  index.gain.exponentialRampToValueAtTime(f * 0.05, t + ring);
  mod.connect(index).connect(car.frequency);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(1, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
  car.connect(env).connect(out);
  const end = t + ring + 0.05;
  car.start(t);
  mod.start(t);
  car.stop(end);
  mod.stop(end);
  car.onended = () => {
    car.disconnect();
    mod.disconnect();
    index.disconnect();
    env.disconnect();
  };
  return end;
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q: number, gain = 0): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  b.gain.value = gain;
  return b;
}

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return seamless(b);
}

function brownNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return seamless(b);
}

/**
 * The level wobble of a crowd, as a signal around zero: a few slow random walks (voices coming and
 * going) plus a 3-6 Hz flutter (syllables), smoothed so it never clicks.
 */
function modulation(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = 200;
  const n = seconds * rate;
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const ctrl = new Float32Array(n);
  let slow = 0;
  let fast = 0;
  let phase = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    slow += (Math.random() - 0.5) * 0.05 - slow * 0.004;
    fast += (Math.random() - 0.5) * 0.6 - fast * 0.25;
    phase += (2 * Math.PI * (3 + 3 * Math.random())) / rate;
    ctrl[i] = Math.max(-1, Math.min(1, slow * 2 + fast * 0.35 + Math.sin(phase) * 0.3));
  }
  // resample the control curve up to audio rate with linear interpolation
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const p = (i / d.length) * n;
    const k = Math.floor(p);
    const a = ctrl[k % n]!;
    const c = ctrl[(k + 1) % n]!;
    d[i] = a + (c - a) * (p - k);
  }
  return seamless(b);
}

/** Crossfade a buffer's end into its start so it loops without a click. */
function seamless(b: AudioBuffer): AudioBuffer {
  const d = b.getChannelData(0);
  const fade = Math.min(Math.floor(b.sampleRate * 0.25), Math.floor(d.length / 4));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i]! * k + d[d.length - fade + i]! * (1 - k);
  }
  const out = new AudioBuffer({ length: d.length - fade, numberOfChannels: 1, sampleRate: b.sampleRate });
  out.copyToChannel(d.subarray(0, d.length - fade), 0);
  return out;
}

/** A large room's impulse response: decaying stereo noise, darker as it fades. */
function roomImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.round(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const k = 0.55 - 0.45 * t;
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * (1 - t) ** 3.2;
    }
  }
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

function pick<T>(list: readonly T[]): T | undefined {
  return list[Math.floor(Math.random() * list.length)];
}
