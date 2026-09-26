import { describe, expect, it } from 'vitest';
import { GUNS, HIT_RADIUS, gunItem, shotTarget } from '../src/arms.ts';
import { APARTMENTS, HOME_ITEMS, homeTier, pieceIn } from '../src/estate.ts';
import { INMATE_IDS, inmatePose, nearestInmate, theftAmount } from '../src/law/inmates.ts';
import { JAIL } from '../src/law/rules.ts';
import { DOLLAR } from '../src/money.ts';
import { LIFTS, liftRefusal } from '../src/lifts.ts';
import { ZONES, zoneOf } from '../src/zones.ts';
import { STORES, storeAt } from '../src/stores.ts';
import { CARS } from '../src/items.ts';

describe('guns', () => {
  it('are sold cheapest first with sane numbers', () => {
    for (let i = 1; i < GUNS.length; i++) expect(GUNS[i]!.price).toBeGreaterThanOrEqual(GUNS[i - 1]!.price);
    for (const g of GUNS) {
      expect(gunItem(g.id)).toBe(g);
      expect(g.rate).toBeGreaterThan(0);
      expect(g.mag).toBeGreaterThan(0);
      expect(CARS.some((c) => c.id === g.id)).toBe(false);
    }
  });
  it('hit the nearest person on the line, within reach, never behind', () => {
    const c = [
      { id: 'far', x: 0, z: 20 },
      { id: 'near', x: 0.2, z: 8 },
      { id: 'side', x: HIT_RADIUS + 0.2, z: 4 },
      { id: 'behind', x: 0, z: -3 },
    ];
    expect(shotTarget(0, 0, 0, 30, c)?.id).toBe('near');
    expect(shotTarget(0, 0, 0, 5, c)).toBeNull();
    expect(shotTarget(0, 0, Math.PI, 30, c)?.id).toBe('behind');
  });
});

describe('apartments', () => {
  it('count only steps bought in order', () => {
    expect(homeTier([])).toBe(0);
    expect(homeTier(['apt-residence'])).toBe(1);
    expect(homeTier(['apt-residence', 'apt-penthouse'])).toBe(1);
    expect(homeTier(APARTMENTS.map((a) => a.id))).toBe(3);
  });
  it('stand the picked piece, else the dearest that fits the step', () => {
    const owned = new Set(['sofa-linen', 'sofa-leather', 'bar-wine', 'bar-cart']);
    expect(pieceIn('sofa', owned, 1, null)?.id).toBe('sofa-leather');
    expect(pieceIn('sofa', owned, 1, 'sofa-linen')?.id).toBe('sofa-linen');
    expect(pieceIn('bar', owned, 1, null)?.id).toBe('bar-cart');
    expect(pieceIn('bar', owned, 2, null)?.id).toBe('bar-wine');
    expect(pieceIn('tv', owned, 3, null)).toBeNull();
    expect(new Set(HOME_ITEMS.map((h) => h.id)).size).toBe(HOME_ITEMS.length);
  });
  it('are reached only by owners', () => {
    const at = { x: LIFTS.casino.arrive.x, z: LIFTS.casino.arrive.z, at: null };
    expect(liftRefusal({ ...at, home: 0 }, 'home')).toBe('nohome');
    expect(liftRefusal({ ...at, home: 1 }, 'home')).toBeNull();
    expect(zoneOf(LIFTS.home.arrive.x, LIFTS.home.arrive.z)).toBe('home');
  });
});

describe('the zones and the stores', () => {
  it('never overlap, and the stores are on the ground floor', () => {
    const ids = Object.keys(ZONES) as (keyof typeof ZONES)[];
    for (const a of ids)
      for (const b of ids) {
        if (a === b) continue;
        const A = ZONES[a];
        const B = ZONES[b];
        expect(A.maxX < B.minX || B.maxX < A.minX || A.maxZ < B.minZ || B.maxZ < A.minZ, `${a} ${b}`).toBe(true);
      }
    for (const s of Object.values(STORES)) {
      expect(zoneOf(s.counter.x * 100, s.counter.z * 100)).toBe('ground');
      expect(storeAt(s.counter.x, s.counter.z)).toBe(s);
    }
  });
});

describe('the inmates', () => {
  it('stay inside the prison, and take a little, never from the broke', () => {
    for (let t = 0; t < 600_000; t += 1_000)
      for (const id of INMATE_IDS) {
        const p = inmatePose(id, t);
        expect(p.x).toBeGreaterThan(JAIL.inner.x0);
        expect(p.x).toBeLessThan(JAIL.inner.x1);
        expect(p.z).toBeGreaterThan(JAIL.inner.z0);
        expect(p.z).toBeLessThan(JAIL.inner.z1);
      }
    expect(theftAmount(10 * DOLLAR)).toBe(0);
    expect(theftAmount(1_000 * DOLLAR)).toBe(40 * DOLLAR);
    expect(theftAmount(10_000_000 * DOLLAR)).toBe(2_500 * DOLLAR);
    expect(INMATE_IDS).toContain(nearestInmate(180, -20, 5_000));
  });
});
