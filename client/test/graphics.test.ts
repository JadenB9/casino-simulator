import { afterEach, describe, expect, it, vi } from 'vitest';

// The graphics options that apply at once (render/graphics.ts): what's kept and how a bad entry
// reads; the floor's adaptive pixel ratio holding where the Resolution and Frame rate options say
// (world/bloom.ts PixelRatio); Low's smoothing pass built from three's FXAA.

class Storage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

async function load(saved?: string | 'blocked') {
  vi.resetModules();
  if (saved === 'blocked') {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
  } else {
    const s = new Storage();
    if (saved !== undefined) s.setItem('casino.graphics', saved);
    vi.stubGlobal('localStorage', s);
  }
  return import('../src/render/graphics.ts');
}

afterEach(() => vi.unstubAllGlobals());

describe('graphics options', () => {
  it('start at the way the game drew before them', async () => {
    const g = await load();
    expect(g.graphicsPrefs()).toEqual({ resolution: 'auto', glow: true, film: true, smooth: true, fps: 'full' });
  });

  it('read a kept entry, and take the default for anything unknown or broken', async () => {
    expect((await load(JSON.stringify({ resolution: 'fast', glow: false, fps: 'saver' }))).graphicsPrefs()).toMatchObject({ resolution: 'fast', glow: false, film: true, fps: 'saver' });
    expect((await load(JSON.stringify({ resolution: 'huge', glow: 'yes', film: 0 }))).graphicsPrefs()).toEqual({ resolution: 'auto', glow: true, film: true, smooth: true, fps: 'full' });
    expect((await load('{not json')).graphicsPrefs().resolution).toBe('auto');
    expect((await load('null')).graphicsPrefs().glow).toBe(true);
    expect((await load('blocked')).graphicsPrefs().film).toBe(true);
  });

  it('keep a change, tell everyone listening, and still apply when storage is blocked', async () => {
    const g = await load();
    const heard: string[] = [];
    const off = g.onGraphicsPrefs((p) => heard.push(`${p.resolution}/${p.glow}`));
    g.setGraphicsPref('resolution', 'sharp');
    g.setGraphicsPref('resolution', 'sharp');
    g.setGraphicsPref('glow', false);
    expect(heard).toEqual(['sharp/true', 'sharp/false']);
    expect(JSON.parse(localStorage.getItem('casino.graphics')!)).toMatchObject({ resolution: 'sharp', glow: false });
    off();
    g.setGraphicsPref('film', false);
    expect(heard).toHaveLength(2);
    const blocked = await load('blocked');
    blocked.setGraphicsPref('fps', 'saver');
    expect(blocked.graphicsPrefs().fps).toBe('saver');
  });
});

describe("the floor's pixel ratio", () => {
  async function ratio(saved: object, dpr: number) {
    await load(JSON.stringify(saved));
    vi.stubGlobal('window', { devicePixelRatio: dpr });
    const { PixelRatio } = await import('../src/world/bloom.ts');
    let set = 0;
    const renderer = { getPixelRatio: () => set, setPixelRatio: (v: number) => (set = v) };
    const pr = new PixelRatio(renderer as never, 2);
    return { pr, get: () => set };
  }

  it('on Auto starts at the screen (up to two) and steps down when frames run slow', async () => {
    const { pr, get } = await ratio({}, 2);
    pr.set(true);
    expect(get()).toBe(2);
    // a step about every three slow seconds (a second of frames to judge by, two over the line)
    for (let i = 0; i < 120; i++) pr.update(0.03);
    expect(get()).toBe(1.75);
    for (let i = 0; i < 400; i++) pr.update(0.03);
    expect(get()).toBe(1.25);
    pr.set(false);
    expect(get()).toBe(1);
  });

  it('holds still on Sharp, on Fast and with the battery saver', async () => {
    const sharp = await ratio({ resolution: 'sharp' }, 2);
    sharp.pr.set(true);
    for (let i = 0; i < 200; i++) sharp.pr.update(0.03);
    expect(sharp.get()).toBe(2);
    // Sharp on Low: the screen's own pixels too
    sharp.pr.set(false);
    expect(sharp.get()).toBe(2);
    const fast = await ratio({ resolution: 'fast' }, 2);
    fast.pr.set(true);
    expect(fast.get()).toBe(1);
    fast.pr.set(false);
    expect(fast.get()).toBe(0.75);
    const saver = await ratio({ fps: 'saver' }, 2);
    saver.pr.set(true);
    for (let i = 0; i < 200; i++) saver.pr.update(1 / 30);
    expect(saver.get()).toBe(2);
  });
});

describe("Low's smoothing pass", () => {
  it("tone-maps each of FXAA's taps and grades what it gives", async () => {
    const { fxaaFragment } = await import('../src/world/bloom.ts');
    const src = fxaaFragment();
    expect(src).not.toBeNull();
    expect(src).toContain('NeutralToneMapping( c.rgb * uBalance )');
    expect(src).toContain('gradeFinish( ApplyFXAA(');
    expect(src).toContain('#include <tonemapping_pars_fragment>');
    // only clear edges, and a lone bright pixel half blended: the carpet's fine pattern stays
    expect(src).toContain('_RelativeThreshold = 0.125;');
    expect(src).toContain('_SubpixelBlending = 0.5;');
  });
});

describe('the room grades', () => {
  it('give every room and zone a gentle lean of its own, never a strong cast', async () => {
    const { GRADES, NEUTRAL_GRADE } = await import('../src/world/bloom.ts');
    const { ROOMS } = await import('../src/world/rooms.ts');
    for (const id of [...ROOMS.map((r) => r.id), 'ground', 'roof', 'home', 'studio']) {
      const g = GRADES[id];
      expect(g, id).toBeDefined();
      for (const c of g!.balance) expect(Math.abs(c - 1), `${id} balance`).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(g!.saturation).toBeGreaterThanOrEqual(0.9);
      expect(g!.saturation).toBeLessThanOrEqual(1.12);
      expect(g!.contrast).toBeGreaterThanOrEqual(0);
      expect(g!.contrast).toBeLessThanOrEqual(0.12);
      expect(g!.vignette).toBeGreaterThanOrEqual(0);
      expect(g!.vignette).toBeLessThanOrEqual(0.22);
    }
    expect(NEUTRAL_GRADE).toEqual({ balance: [1, 1, 1], saturation: 1, contrast: 0, vignette: 0 });
  });
});
