import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// "Reduce flashing & motion" (app/comfort.ts): where it starts (the saved choice, else the system's
// reduced-motion setting), that it's kept, that listeners hear it, what the helpers give in each
// state, and that every module known to flash or chase reads it.

class Storage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

class ClassList {
  names = new Set<string>();
  toggle(n: string, on: boolean): void {
    if (on) this.names.add(n);
    else this.names.delete(n);
  }
  contains(n: string): boolean {
    return this.names.has(n);
  }
}

/** A fresh copy of the module, with this storage, this system setting and a body to mark. */
async function load(opts: { saved?: string; reduce?: boolean; storage?: Storage | 'blocked' } = {}) {
  vi.resetModules();
  const storage = opts.storage ?? new Storage();
  if (storage === 'blocked') {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
  } else {
    if (opts.saved !== undefined) storage.setItem('casino.calm', opts.saved);
    vi.stubGlobal('localStorage', storage);
  }
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion') && !!opts.reduce }));
  const classList = new ClassList();
  vi.stubGlobal('document', { body: { classList } });
  const mod = await import('../src/app/comfort.ts');
  return { mod, storage, classList };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('where it starts', () => {
  it('follows the system when nothing is saved', async () => {
    expect((await load({ reduce: true })).mod.calm()).toBe(true);
    expect((await load({ reduce: false })).mod.calm()).toBe(false);
  });

  it('a saved choice beats the system', async () => {
    expect((await load({ saved: '0', reduce: true })).mod.calm()).toBe(false);
    expect((await load({ saved: '1', reduce: false })).mod.calm()).toBe(true);
  });

  it('blocked storage falls back to the system, and the switch still works this visit', async () => {
    const { mod } = await load({ storage: 'blocked', reduce: true });
    expect(mod.calm()).toBe(true);
    mod.setCalm(false);
    expect(mod.calm()).toBe(false);
  });

  it('the body carries `calm` from the start, and the shader uniform agrees', async () => {
    const { mod, classList } = await load({ reduce: true });
    expect(classList.contains('calm')).toBe(true);
    expect(mod.calmUniform.value).toBe(1);
    const off = await load({ reduce: false });
    expect(off.classList.contains('calm')).toBe(false);
    expect(off.mod.calmUniform.value).toBe(0);
  });
});

describe('the switch', () => {
  it('is kept per browser and read back on the next load', async () => {
    const storage = new Storage();
    const first = await load({ storage });
    first.mod.setCalm(true);
    expect(storage.getItem('casino.calm')).toBe('1');
    expect((await load({ storage })).mod.calm()).toBe(true);
    const second = await load({ storage, reduce: true });
    second.mod.setCalm(false);
    expect(storage.getItem('casino.calm')).toBe('0');
    expect((await load({ storage, reduce: true })).mod.calm()).toBe(false);
  });

  it('applies at once: the body class, the uniform and every listener', async () => {
    const { mod, classList } = await load();
    const heard: boolean[] = [];
    const stop = mod.onCalm((on) => heard.push(on));
    mod.setCalm(true);
    expect(classList.contains('calm')).toBe(true);
    expect(mod.calmUniform.value).toBe(1);
    mod.setCalm(true); // no change, nothing told
    mod.setCalm(false);
    expect(classList.contains('calm')).toBe(false);
    expect(mod.calmUniform.value).toBe(0);
    expect(heard).toEqual([true, false]);
    stop();
    mod.setCalm(true);
    expect(heard).toEqual([true, false]);
  });

  it('followCalm is told the state now as well as each change', async () => {
    const { mod } = await load({ reduce: true });
    const heard: boolean[] = [];
    const stop = mod.followCalm((on) => heard.push(on));
    mod.setCalm(false);
    stop();
    mod.setCalm(true);
    expect(heard).toEqual([true, false]);
  });
});

describe('the helpers', () => {
  it('leave everything as it is when calm is off', async () => {
    const { mod } = await load();
    expect(mod.flashAllowed()).toBe(true);
    expect(mod.blink(false)).toBe(false);
    expect(mod.blink(true)).toBe(true);
    expect(mod.calmScale(0.3)).toBe(1);
    expect(mod.fewer(28)).toBe(28);
    for (const x of [0, 0.4, 1.3, 2.9, 7.5]) expect(mod.wave(x)).toBeCloseTo(Math.sin(x), 12);
  });

  it('calm holds blinks on, thins particles and slows and shallows every pulse', async () => {
    const { mod } = await load({ reduce: true });
    expect(mod.flashAllowed()).toBe(false);
    expect(mod.blink(false)).toBe(true);
    expect(mod.calmScale(0.3)).toBe(0.3);
    expect(mod.fewer(28)).toBe(9);
    expect(mod.fewer(2)).toBe(1);
    expect(mod.fewer(1)).toBe(1);
    // a third of the swing...
    let most = 0;
    for (let x = 0; x < 40; x += 0.01) most = Math.max(most, Math.abs(mod.wave(x)));
    expect(most).toBeLessThanOrEqual(1 / 3 + 1e-9);
    expect(most).toBeGreaterThan(0.33);
    // ...and a third of the speed: a full cycle takes three times the phase
    expect(mod.wave(Math.PI * 1.5)).toBeCloseTo(1 / 3, 12);
    expect(mod.wave(Math.PI * 3)).toBeCloseTo(0, 12);
  });

  it('a pulse at a table (0.62 +- 0.3 at 260 ms a radian) swings no faster than once in four seconds when calm', async () => {
    const { mod } = await load({ reduce: true });
    // period of sin(t / 260 / 3) in ms
    const period = 2 * Math.PI * 260 * 3;
    expect(period).toBeGreaterThan(4000);
    const at = (ms: number) => 0.62 + 0.3 * mod.wave(ms / 260);
    let lo = Infinity;
    let hi = -Infinity;
    for (let ms = 0; ms < period; ms += 10) {
      lo = Math.min(lo, at(ms));
      hi = Math.max(hi, at(ms));
    }
    expect(hi - lo).toBeLessThanOrEqual(0.2 + 1e-9);
  });
});

describe("the shop's effects thin out on their own", () => {
  it('Bits and Sparks keep one piece in three while calm, every piece otherwise', async () => {
    const { mod } = await load();
    const THREE = await import('three');
    const { Bits, Sparks } = await import('../src/world/fx/particles.ts');
    const count = (on: boolean) => {
      mod.setCalm(on);
      const bits = new Bits(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 600, 'test');
      const sparks = new Sparks(600, { hot: '#fff', cool: '#f80', gain: 1, width: 0.02, len: 0.03, name: 'test' });
      for (let i = 0; i < 300; i++) {
        bits.spawn(0, 1, 0, 0, 0, 0, 0.1, new THREE.Color(1, 1, 1), 10);
        sparks.spawn(0, 1, 0, 0, 1, 0, 1);
      }
      return [bits.n, sparks.n];
    };
    expect(count(false)).toEqual([300, 300]);
    expect(count(true)).toEqual([100, 100]);
  });
});

// Every module that flashes, chases, pulses or throws particles today, and what reads calm in
// it. A new effect in one of these that forgets the switch still passes this; the point is that
// none of them can drop it without a test going red.
const root = fileURLToPath(new URL('../src', import.meta.url));
function files(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) out.push(...files(f, ext));
    else if (f.endsWith(ext)) out.push(f);
  }
  return out;
}
const cssFiles = () => files(root, '.css');

const FLASHING = [
  'world/marquee.ts',
  'world/attract.ts',
  'world/props.ts',
  'world/bloom.ts',
  'world/wearables.ts',
  'table/celebrate.ts',
  'games/slots/cabinet.ts',
  'games/slots/play.ts',
  'games/slots/view.ts',
  'games/banditwheel/index.ts',
  'games/bigsix/index.ts',
  'games/roulette/index.ts',
  'games/blackjack/view.ts',
  'games/threecard/view.ts',
  'games/war/view.ts',
  'games/craps/ring.ts',
  'games/sicbo/shaker.ts',
  'games/crash/graph.ts',
  'games/plinko/board.ts',
  'ui/shop/showroom.ts',
  'ui/hud/hud.ts',
  // v6's own: the shop's effects, the parlor's machines, the celebrities' camera flashes
  'world/fx/particles.ts',
  'world/fx/disco.ts',
  'world/fx/takeover.ts',
  'world/fx/sparklers.ts',
  'world/fx/golden.ts',
  'world/marquee.ts',
  'games/bingo/view.ts',
  'games/pachinko/view.ts',
  'world/celebs/flash.ts',
];

describe('every module known to flash reads the switch', () => {
  const src = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');

  it.each(FLASHING)('%s', (f) => {
    const s = src(f);
    const deep = f.split('/').length - 1;
    expect(s).toContain(`from '${'../'.repeat(deep)}app/comfort.ts'`);
    // and uses it, past the import and the comments
    const body = s
      .split('\n')
      .filter((l) => !l.startsWith('import '))
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(body).toMatch(/\b(calm|calmScale|calmUniform|blink|wave|fewer|flashAllowed|onCalm|followCalm|CALM_BLOOM)\b/);
  });

  it('no module strobes with a bare on/off clock that skips blink()', () => {
    // the idiom the flashing lights used: Math.floor(now / ms) % 2 picking lit or dark
    for (const f of FLASHING) {
      for (const line of src(f).split('\n')) {
        if (/Math\.floor\([^)]*\/\s*\d+\)\s*%\s*2/.test(line) && !/blink\(|calm\(\)/.test(line)) {
          // Big Six's marquee answers calm() a few lines above; anything else must go through blink()
          if (f === 'games/bigsix/index.ts') continue;
          throw new Error(`${f}: ${line.trim()}`);
        }
      }
    }
  });

  it('the stylesheets turn off every flashing and shaking animation under body.calm', () => {
    const css = cssFiles().map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const sel of ['.vp-row.win', '.vp-status.win', '.bw-slot.won', '.name-row.shake', '.mn-grid.shake', '.tw-tower.shake', '.kn-tile.full', '.map-you .map-you-halo', '.pk-bin.hit', '.emote-bubble', '.staff-say-bubble'])
      expect(css).toContain(`body.calm ${sel}`);
  });

  it('the switch is the one say: nothing but its default reads the system reduced-motion setting', () => {
    // a @media (prefers-reduced-motion) rule would still apply with the switch at Full
    const offenders: string[] = [];
    for (const f of [...cssFiles(), ...files(root, '.ts')]) {
      if (f.endsWith(`app${sep}comfort.ts`)) continue;
      if (readFileSync(f, 'utf8').includes('prefers-reduced-motion')) offenders.push(f.slice(root.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});
