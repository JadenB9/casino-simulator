// What the shops say about what they sell: the bar's card names what each thing does from the
// effects themselves (shop/does.ts), the valet's bars compare the cars with each other from their
// own handling and shape (cars/specs.ts), and the boutique's wishlist is kept in this browser
// (shop/saved.ts), surviving a reload and a store that refuses.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAR_MENU, CARS } from '../../shared/src/items.ts';
import { doesWords } from '../src/ui/shop/does.ts';
import { carSpecs } from '../src/ui/cars/specs.ts';

describe("the bar's card", () => {
  it('says what each thing does in a word, with how long it lasts', () => {
    expect(doesWords('beer').map((d) => d.word)).toEqual(['A little tipsy']);
    expect(doesWords('cocktail').map((d) => d.word)).toEqual(['Tipsy']);
    expect(doesWords('champagne').map((d) => d.word)).toEqual(['A little tipsy', 'Bubbly · 4 min']);
    expect(doesWords('dom').map((d) => d.word)).toEqual(['Very tipsy', 'Bubbly · 6 min', 'Party · 5 min']);
    expect(doesWords('espresso').map((d) => d.word)).toEqual(['Quick · 3 min']);
    expect(doesWords('energy-drink')[0]!.more).toBe('A 30% quicker step for 2 min');
    expect(doesWords('ribeye').map((d) => d.word)).toEqual(['Fed · 8 min']);
    expect(doesWords('birthday-cake').map((d) => d.kind)).toEqual(['party', 'fed']);
    expect(doesWords('nothing-like-it')).toEqual([]);
  });

  it('has a word for everything on the menu', () => {
    for (const it of BAR_MENU) expect(doesWords(it.id).length, it.id).toBeGreaterThan(0);
  });
});

describe("the valet's specs", () => {
  it('rate every car against the line-up, the dearest the fastest', () => {
    for (const c of CARS) {
      const s = carSpecs(c.id)!;
      expect(s, c.id).not.toBeNull();
      for (const k of [s.speed, s.pull, s.size]) {
        expect(k).toBeGreaterThan(0);
        expect(k).toBeLessThanOrEqual(1);
      }
      expect(s.length).toBeGreaterThan(3);
    }
    const best = CARS.at(-1)!;
    expect(carSpecs(best.id)!.speed).toBe(1);
    expect(carSpecs(best.id)!.speedWord).toBe('The fastest');
    // a tall car is slower than its price alone would make it
    expect(carSpecs('kodiak-monster')!.speed).toBeLessThan(carSpecs('aurelian-stretch')!.speed);
    expect(carSpecs('halden-roadster')!.seats).toBe(2);
    expect(carSpecs('ardent-overland')!.seats).toBeNull();
    expect(carSpecs('aurelian-stretch')!.size).toBe(1);
    expect(carSpecs('no-such-car')).toBeNull();
  });
});

describe("the boutique's wishlist", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps what you save in this browser, and takes it off again', async () => {
    const saved = await import('../src/ui/shop/saved.ts');
    expect(saved.isSaved('figaro')).toBe(false);
    expect(saved.toggleSaved('figaro')).toBe(true);
    expect(saved.toggleSaved('statue')).toBe(true);
    expect(JSON.parse(store.get('casino.saved')!)).toEqual(['figaro', 'statue']);
    expect(saved.toggleSaved('figaro')).toBe(false);
    expect([...saved.savedIds()]).toEqual(['statue']);
    // a reload reads it back
    vi.resetModules();
    const again = await import('../src/ui/shop/saved.ts');
    expect(again.isSaved('statue')).toBe(true);
  });

  it("starts empty from a list it can't read, and lasts the visit when storage refuses", async () => {
    store.set('casino.saved', '{not json');
    const saved = await import('../src/ui/shop/saved.ts');
    expect(saved.savedIds().size).toBe(0);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('refused');
      },
    });
    expect(saved.toggleSaved('segway')).toBe(true);
    expect(saved.isSaved('segway')).toBe(true);
  });
});
