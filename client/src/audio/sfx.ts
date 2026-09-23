// Sound effects: decoded once into WebAudio buffers, a random variant per play, a master gain
// for volume and mute. Browsers only start audio after a gesture, so the context unlocks on the
// first click or key press.

const MUTE_KEY = 'casino.muted';
const VOLUME_KEY = 'casino.volume';
/** The master level at full volume; the volume setting scales it. */
const BASE = 0.8;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer[]>();
  muted: boolean;
  /** 0 to 1, kept across reloads. Unmuting comes back to this level. */
  volume: number;

  constructor() {
    this.muted = stored(MUTE_KEY) === '1';
    const v = Number(stored(VOLUME_KEY) ?? 1);
    this.volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  get audio(): AudioContext {
    return this.ensure();
  }

  get out(): GainNode {
    this.ensure();
    return this.master!;
  }

  async load(): Promise<void> {
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
    if (!bufs?.length || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)]!;
    src.playbackRate.value = (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g).connect(this.master!);
    src.start(this.ctx.currentTime + (opts.delay ?? 0));
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.ramp();
    store(MUTE_KEY, m ? '1' : '0');
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.ramp();
    store(VOLUME_KEY, String(this.volume));
  }

  private level(): number {
    return this.muted ? 0 : BASE * this.volume;
  }

  private ramp(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
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
