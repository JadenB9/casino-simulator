// The graphics options besides Quality (which picks how the one renderer is built, so it waits for a
// reload: engine3d.ts savedQuality). These apply at once: the floor's post pass (world/bloom.ts)
// and the engine's frame loop hear every change. Kept per browser in one localStorage entry; a
// missing or unreadable one is the defaults, which are how the game drew before these existed.

export type Resolution = 'auto' | 'sharp' | 'fast';
export type FrameRate = 'full' | 'saver';

export interface GraphicsPrefs {
  /**
   * How many device pixels the floor draws per screen pixel. Auto: High up to two with the step
   * down when frames run slow, Low one. Sharp: the screen's own (up to two, a phone's 1.5), never
   * stepping down. Fast: one on High, three quarters on Low.
   */
  resolution: Resolution;
  /** High: the glow round neon, bulbs and lamps (bloom). */
  glow: boolean;
  /** High and Low: each room's colour grade and a soft vignette. */
  film: boolean;
  /** Low: smoothing the jagged edges (FXAA) where the graphics card can. */
  smooth: boolean;
  /** Full: every frame the screen shows. Saver: thirty a second, for a laptop on battery. */
  fps: FrameRate;
}

export const GRAPHICS_KEY = 'casino.graphics';

export const DEFAULT_GRAPHICS: Readonly<GraphicsPrefs> = { resolution: 'auto', glow: true, film: true, smooth: true, fps: 'full' };

/** Whatever was stored, made safe: an unknown value is the default. */
export function parseGraphics(raw: string | null): GraphicsPrefs {
  const out: GraphicsPrefs = { ...DEFAULT_GRAPHICS };
  if (!raw) return out;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!o || typeof o !== 'object') return out;
  const v = o as Record<string, unknown>;
  if (v.resolution === 'auto' || v.resolution === 'sharp' || v.resolution === 'fast') out.resolution = v.resolution;
  if (typeof v.glow === 'boolean') out.glow = v.glow;
  if (typeof v.film === 'boolean') out.film = v.film;
  if (typeof v.smooth === 'boolean') out.smooth = v.smooth;
  if (v.fps === 'full' || v.fps === 'saver') out.fps = v.fps;
  return out;
}

function load(): GraphicsPrefs {
  try {
    return parseGraphics(localStorage.getItem(GRAPHICS_KEY));
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}

let prefs = load();
const listeners = new Set<(p: Readonly<GraphicsPrefs>) => void>();

// changed in another tab: this one follows
if (typeof addEventListener === 'function') {
  addEventListener('storage', (e) => {
    if (e.key !== GRAPHICS_KEY) return;
    prefs = parseGraphics(e.newValue);
    for (const fn of listeners) fn(prefs);
  });
}

/** The options now. */
export function graphicsPrefs(): Readonly<GraphicsPrefs> {
  return prefs;
}

/** Change one option: kept, and applied at once by everything listening. */
export function setGraphicsPref<K extends keyof GraphicsPrefs>(key: K, value: GraphicsPrefs[K]): void {
  if (prefs[key] === value) return;
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(GRAPHICS_KEY, JSON.stringify(prefs));
  } catch {
    // not kept, but still applied for this visit
  }
  for (const fn of listeners) fn(prefs);
}

/** Hear changes; the returned function stops listening. */
export function onGraphicsPrefs(fn: (p: Readonly<GraphicsPrefs>) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** onGraphicsPrefs, called once now as well. */
export function followGraphicsPrefs(fn: (p: Readonly<GraphicsPrefs>) => void): () => void {
  fn(prefs);
  return onGraphicsPrefs(fn);
}
