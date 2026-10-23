// Sound effects: decoded once into WebAudio buffers, a random variant per play, and the mix every
// sound goes through:
//
//   game sounds (out) ─┐
//   the room (room) ───┼─▶ master: the volume and mute ─▶ limiter ─▶ speakers
//   music (music) ─────┘
//
// Each kind has its own level under the volume (Settings, Sound), and every change of level ramps
// rather than jumps. The limiter holds the sum under full scale, so a burst of chips, a bell and a
// fanfare at once never clip.
//
// Browsers only start audio after a gesture. A touch's pointerdown isn't one (its pointerup and
// touchend are), so the context is tried at every kind of gesture until it runs, and again after
// the system takes the sound away (a call, another app).

import type { SoundKind } from '../ui/menu/deps.ts';

export type { SoundKind } from '../ui/menu/deps.ts';

const MUTE_KEY = 'casino.muted';
const VOLUME_KEY = 'casino.volume';
const KINDS: readonly SoundKind[] = ['game', 'room', 'music'];
const levelKey = (k: SoundKind) => `casino.volume.${k}`;
/** The master level at full volume; the volume setting scales it. */
const BASE = 0.8;
/** How quickly a level follows a change (setTargetAtTime's time constant, seconds). */
const RAMP = 0.06;
/** The gestures that may start audio. */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<SoundKind, GainNode>();
  private buffers = new Map<string, AudioBuffer[]>();
  muted: boolean;
  /** 0 to 1, kept across reloads. Unmuting comes back to this level. */
  volume: number;
  private readonly levels: Record<SoundKind, number> = { game: 1, room: 1, music: 1 };
  private armed = false;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.muted = stored(MUTE_KEY) === '1';
    this.volume = clamp01(Number(stored(VOLUME_KEY) ?? 1));
    for (const k of KINDS) this.levels[k] = clamp01(Number(stored(levelKey(k)) ?? 1));
    this.arm();
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      // a limiter: only the peaks near full scale are held down
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 3;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.2;
      limiter.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.masterLevel();
      this.master.connect(limiter);
      for (const k of KINDS) {
        const g = ctx.createGain();
        g.gain.value = this.levels[k];
        g.connect(this.master);
        this.buses.set(k, g);
      }
      // the system took the sound away (a call, another app): start it again at the next gesture
      ctx.addEventListener?.('statechange', () => {
        if (ctx.state !== 'running') this.arm();
      });
    }
    return this.ctx;
  }

  /** Try to start audio at each gesture until it runs. */
  private arm(): void {
    if (this.armed || typeof addEventListener !== 'function') return;
    this.armed = true;
    const tryStart = () => {
      const ctx = this.ensure();
      if (ctx.state === 'running') return disarm();
      void ctx.resume().then(
        () => ctx.state === 'running' && disarm(),
        () => {},
      );
    };
    const disarm = () => {
      if (!this.armed) return;
      this.armed = false;
      for (const e of GESTURES) removeEventListener(e, tryStart, true);
    };
    for (const e of GESTURES) addEventListener(e, tryStart, true);
  }

  get audio(): AudioContext {
    return this.ensure();
  }

  /** Where game sounds go: cards, chips, wheels, machines, the effects, the buttons. */
  get out(): GainNode {
    this.ensure();
    return this.buses.get('game')!;
  }

  /** Where the room's own sound goes (audio/ambience.ts). */
  get room(): GainNode {
    this.ensure();
    return this.buses.get('room')!;
  }

  /** Where music goes: the beat under a dance (audio/beat.ts), the disco. */
  get music(): GainNode {
    this.ensure();
    return this.buses.get('music')!;
  }

  private loading: Promise<void> | null = null;

  /** Fetch and decode every sound, once: a second call waits on the first. */
  load(): Promise<void> {
    return (this.loading ??= this.fetchAll());
  }

  /** A sound's decoded variants, once load() has them (the ambience plays the chips' on this context too). */
  variants(name: string): readonly AudioBuffer[] {
    return this.buffers.get(name) ?? [];
  }

  private async fetchAll(): Promise<void> {
    const base = `${import.meta.env.BASE_URL}assets/sfx/`;
    const manifest = (await (await fetch(base + 'sfx.json')).json()) as Record<string, string[]>;
    const ctx = this.ensure();
    await Promise.all(
      Object.entries(manifest).map(async ([name, files]) => {
        const bufs = await Promise.all(files.map(async (f) => ctx.decodeAudioData(await (await fetch(base + f)).arrayBuffer())));
        this.buffers.set(name, bufs);
      }),
    );
  }

  play(name: string, opts: { volume?: number; rate?: number; delay?: number } = {}): void {
    const bufs = this.buffers.get(name);
    // (nothing is made for a sound nobody would hear)
    if (!bufs?.length || !this.ctx || !this.audible('game')) return;
    const src = this.ctx.createBufferSource();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)]!;
    src.playbackRate.value = (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g).connect(this.buses.get('game')!);
    src.onended = () => g.disconnect();
    src.start(this.ctx.currentTime + (opts.delay ?? 0));
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.ramp();
    store(MUTE_KEY, m ? '1' : '0');
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    this.ramp();
    store(VOLUME_KEY, String(this.volume));
  }

  /** A kind's own level, 0 to 1. */
  level(kind: SoundKind): number {
    return this.levels[kind];
  }

  setLevel(kind: SoundKind, v: number): void {
    this.levels[kind] = clamp01(v);
    const bus = this.buses.get(kind);
    if (bus && this.ctx) bus.gain.setTargetAtTime(this.levels[kind], this.ctx.currentTime, RAMP);
    store(levelKey(kind), String(this.levels[kind]));
    for (const fn of this.listeners) fn();
  }

  /** Whether `kind` can be heard at all now (not muted, neither its level nor the volume at nothing). */
  audible(kind: SoundKind = 'game'): boolean {
    return !this.silent() && this.levels[kind] > 0;
  }

  /** Hear mute, volume and level changes (the room's beds sleep while they can't be heard). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Muted, or the volume at nothing. */
  private silent(): boolean {
    return this.muted || this.volume === 0;
  }

  private masterLevel(): number {
    return this.silent() ? 0 : BASE * this.volume;
  }

  private ramp(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, RAMP);
    for (const fn of this.listeners) fn();
  }
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked */
  }
}
