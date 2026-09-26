import { beforeEach, describe, expect, it, vi } from 'vitest';

// ui/keys.ts reads the saved keys when it loads: each test gets a fresh module over a fresh store
function store(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

async function fresh(init?: Record<string, string>) {
  const s = store(init);
  vi.stubGlobal('localStorage', s);
  vi.resetModules();
  return { keys: await import('../src/ui/keys.ts'), s };
}

describe('rebindable keys', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('starts on the defaults, the arrows walking too and Shift either side running', async () => {
    const { keys } = await fresh();
    expect(keys.keyFor('forward')).toBe('KeyW');
    expect(keys.isKey({ code: 'ArrowUp' }, 'forward')).toBe(true);
    expect(keys.isKey({ code: 'ShiftRight' }, 'run')).toBe(true);
    expect(keys.held(new Set(['ArrowLeft']), 'left')).toBe(true);
    expect(keys.keyLabel('jump')).toBe('Space');
    expect(keys.customised()).toBe(false);
  });

  it('swaps a key with the control that had it, where the two could clash', async () => {
    const { keys, s } = await fresh();
    // E (interact) onto V (the gun): the gun gets E
    expect(keys.bindKey('interact', 'KeyV')).toEqual(['gun']);
    expect(keys.keyFor('interact')).toBe('KeyV');
    expect(keys.keyFor('gun')).toBe('KeyE');
    expect(JSON.parse(s.data.get('casino.keys')!)).toEqual({ interact: 'KeyV', gun: 'KeyE' });
    // no two controls that work together ever share one
    for (const a of keys.KEY_SPECS) for (const b of keys.KEY_SPECS) {
      if (a.action === b.action || keys.keyFor(a.action) !== keys.keyFor(b.action)) continue;
      expect([a.where, b.where].sort()).toEqual(['car', 'foot']);
    }
  });

  it("lets a foot control and a car control share a key (C crouches, and turns the car's camera)", async () => {
    const { keys } = await fresh();
    expect(keys.bindKey('horn', 'KeyC')).toEqual(['carView']);
    expect(keys.keyFor('crouch')).toBe('KeyC');
    expect(keys.keyFor('carView')).toBe('KeyH');
  });

  it('moves every control a swap would double up, in a chain (crouch onto E: interact to C, the car camera off C)', async () => {
    const { keys } = await fresh();
    const moved = keys.bindKey('crouch', 'KeyE') as string[];
    expect(keys.keyFor('crouch')).toBe('KeyE');
    expect(moved).toContain('interact');
    expect(keys.keyFor('interact')).toBe('KeyC');
    expect(moved).toContain('carView');
    expect(keys.keyFor('carView')).not.toBe('KeyC');
    for (const a of keys.KEY_SPECS) for (const b of keys.KEY_SPECS) {
      if (a.action === b.action || keys.keyFor(a.action) !== keys.keyFor(b.action)) continue;
      expect([a.where, b.where].sort()).toEqual(['car', 'foot']);
    }
  });

  it("refuses the game's own keys, and ignores them in a saved list", async () => {
    const { keys } = await fresh({ 'casino.keys': JSON.stringify({ jump: 'Escape', crouch: 'KeyX', nope: 'KeyZ' }) });
    expect(keys.keyFor('jump')).toBe('Space');
    expect(keys.keyFor('crouch')).toBe('KeyX');
    for (const code of ['Escape', 'Enter', 'Tab', 'Digit1', 'Slash', 'ArrowUp', 'ControlLeft']) expect(keys.bindKey('jump', code)).toBe(false);
    expect(keys.keyFor('jump')).toBe('Space');
  });

  it('tells the labels when anything changes, and resets to the defaults', async () => {
    const { keys, s } = await fresh();
    const heard: string[] = [];
    const off = keys.keyed(() => heard.push(keys.keyLabel('ride')));
    keys.bindKey('ride', 'BracketRight');
    keys.resetKeys();
    off();
    keys.bindKey('ride', 'KeyZ');
    expect(heard).toEqual(['B', ']', 'B']);
    keys.resetKeys();
    expect(s.data.has('casino.keys')).toBe(false);
    expect(keys.customised()).toBe(false);
  });
});
