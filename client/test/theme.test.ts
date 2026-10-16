import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Light and dark (app/theme.ts): what's on screen comes from the attribute theme.js set before
// paint; a choice is kept under the site's key and marks <html>; the device and other tabs are
// heard while it makes sense; and the pre-paint script agrees with the module on every rule.

class Storage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

class Root {
  attrs = new Map<string, string>();
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
}

type Handler = (e: { matches: boolean }) => void;

/** A fresh copy of the module with this storage, device setting and page. */
async function load(opts: { saved?: string; light?: boolean; storage?: Storage | 'blocked'; attr?: 'light' } = {}) {
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
    if (opts.saved !== undefined) storage.setItem('theme', opts.saved);
    vi.stubGlobal('localStorage', storage);
  }
  const media: { handlers: Handler[] } = { handlers: [] };
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('light') && !!opts.light,
    addEventListener: (_: string, fn: Handler) => media.handlers.push(fn),
  }));
  const root = new Root();
  if (opts.attr) root.setAttribute('data-theme', opts.attr);
  const metas = [{ content: '' }, { content: '' }];
  vi.stubGlobal('document', { documentElement: root, querySelectorAll: () => metas });
  const storageHandlers: ((e: { key: string | null }) => void)[] = [];
  vi.stubGlobal('addEventListener', (name: string, fn: (e: { key: string | null }) => void) => {
    if (name === 'storage') storageHandlers.push(fn);
  });
  const mod = await import('../src/app/theme.ts');
  return { mod, storage, root, metas, media, storageHandlers };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what is on screen', () => {
  it('is whatever theme.js marked before paint: light with the attribute, dark without', async () => {
    expect((await load({ attr: 'light' })).mod.theme()).toBe('light');
    expect((await load()).mod.theme()).toBe('dark');
  });

  it('the bar colour catches up with the mark as soon as the module runs', async () => {
    const light = await load({ attr: 'light' });
    expect(light.metas.map((m) => m.content)).toEqual(['#ece4d4', '#ece4d4']);
    const dark = await load();
    expect(dark.metas.map((m) => m.content)).toEqual(['#0b0908', '#0b0908']);
  });
});

describe('choosing', () => {
  it("is kept under the site's key and marks the page at once", async () => {
    const { mod, storage, root, metas } = await load();
    mod.setTheme('light');
    expect(storage.getItem('theme')).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(metas[0]!.content).toBe('#ece4d4');
    mod.setTheme('dark');
    expect(storage.getItem('theme')).toBe('dark');
    expect(root.getAttribute('data-theme')).toBeNull();
    expect(metas[0]!.content).toBe('#0b0908');
  });

  it('toggle goes to the other one and says which', async () => {
    const { mod } = await load({ attr: 'light' });
    expect(mod.toggleTheme()).toBe('dark');
    expect(mod.theme()).toBe('dark');
    expect(mod.toggleTheme()).toBe('light');
  });

  it('listeners hear each change and nothing else; followTheme hears the state now too', async () => {
    const { mod } = await load();
    const heard: string[] = [];
    const stop = mod.onTheme((t) => heard.push(t));
    mod.setTheme('light');
    mod.setTheme('light'); // no change, nothing told
    mod.setTheme('dark');
    expect(heard).toEqual(['light', 'dark']);
    stop();
    mod.setTheme('light');
    expect(heard).toEqual(['light', 'dark']);
    const now: string[] = [];
    const off = mod.followTheme((t) => now.push(t));
    mod.setTheme('dark');
    off();
    expect(now).toEqual(['light', 'dark']);
  });

  it('blocked storage still applies the choice for this visit', async () => {
    const { mod, root } = await load({ storage: 'blocked' });
    mod.setTheme('light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });
});

describe('the device and other tabs', () => {
  it('follows the device only while nothing is saved', async () => {
    const free = await load();
    free.media.handlers.forEach((h) => h({ matches: true }));
    expect(free.mod.theme()).toBe('light');
    const chosen = await load({ saved: 'dark' });
    chosen.media.handlers.forEach((h) => h({ matches: true }));
    expect(chosen.mod.theme()).toBe('dark');
  });

  it("takes another tab's choice as soon as it is made, and the device's when it is cleared", async () => {
    const { mod, storage, storageHandlers } = await load({ light: true });
    storage.setItem('theme', 'light');
    storageHandlers.forEach((h) => h({ key: 'theme' }));
    expect(mod.theme()).toBe('light');
    storage.setItem('theme', 'dark');
    storageHandlers.forEach((h) => h({ key: 'theme' }));
    expect(mod.theme()).toBe('dark');
    storage.data.delete('theme');
    storageHandlers.forEach((h) => h({ key: null }));
    expect(mod.theme()).toBe('light');
  });
});

describe('the pre-paint script', () => {
  const src = readFileSync(fileURLToPath(new URL('../public/theme.js', import.meta.url)), 'utf8');

  it("reads the site's key, marks light with the same attribute, and follows the device with nothing saved", () => {
    expect(src).toContain("localStorage.getItem('theme')");
    expect(src).toContain("setAttribute('data-theme', 'light')");
    expect(src).toContain('prefers-color-scheme: light');
    expect(src).not.toMatch(/'dark'\)/); // dark is the default and never an attribute
  });

  it('is loaded before paint, from its own file (the CSP allows no inline script)', () => {
    const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    const script = html.indexOf('theme.js');
    expect(script).toBeGreaterThan(0);
    expect(script).toBeLessThan(html.indexOf('<body'));
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('prefers-color-scheme: light');
  });
});
