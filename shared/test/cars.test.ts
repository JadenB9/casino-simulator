// The valet's cars: the catalog's rules (ids that never collide with anything else a casino_items
// row can hold, whole-dollar prices out of reach of a fresh account, plain names).

import { describe, expect, it } from 'vitest';
import { BAR_MENU, CARS, EFFECTS, EMOTE_ITEMS, SHOP_ITEMS, STATUE, carItem, shopItem } from '../src/items.ts';
import { DOLLAR, LOAN_AMOUNT, STARTING_BALANCE, isCents } from '../src/money.ts';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('cars', () => {
  it('sells ten to fourteen cars, cheapest first, from $250,000 to over a billion', () => {
    expect(CARS.length).toBeGreaterThanOrEqual(10);
    expect(CARS.length).toBeLessThanOrEqual(14);
    const prices = CARS.map((c) => c.price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(prices[0]).toBe(250_000 * DOLLAR);
    expect(prices.at(-1)!).toBeGreaterThan(1_000_000_000 * DOLLAR);
  });

  it('has ids of its own: no worn item, emote, effect, bar order or the statue shares one', () => {
    const others = new Set<string>([...SHOP_ITEMS, ...EMOTE_ITEMS, ...EFFECTS, ...BAR_MENU].map((i) => i.id));
    others.add(STATUE.id);
    const ids = CARS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(ID);
      expect(others.has(id), id).toBe(false);
    }
  });

  it('prices every car in whole dollars, out of reach of a fresh account or a loan', () => {
    const reach = Math.max(STARTING_BALANCE, LOAN_AMOUNT);
    for (const c of CARS) {
      expect(isCents(c.price), c.id).toBe(true);
      expect(c.price % DOLLAR, c.id).toBe(0);
      expect(c.price, c.id).toBeGreaterThan(reach);
      expect(Number.isSafeInteger(c.price), c.id).toBe(true);
    }
  });

  it('writes names and tags without marketing talk', () => {
    for (const c of CARS) {
      expect(c.kind).toBe('car');
      expect(c.name.length, c.id).toBeLessThanOrEqual(24);
      expect(c.about.length, c.id).toBeLessThanOrEqual(72);
      expect(c.about, c.id).toMatch(/\.$/);
      expect(`${c.name} ${c.about}`, c.id).not.toMatch(/!|win big|best|amazing|luxury/i);
    }
  });

  it('looks cars up by id, and never as something the boutique sells', () => {
    expect(carItem('ombra-oro')?.name).toBe('Ombra Oro');
    expect(carItem('rope-chain')).toBeNull();
    expect(carItem(7)).toBeNull();
    for (const c of CARS) expect(shopItem(c.id), c.id).toBeNull();
  });
});
