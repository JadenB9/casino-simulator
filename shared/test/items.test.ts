// The boutique's catalog, the bar's menu, and the Look fields that wear them.

import { describe, expect, it } from 'vitest';
import {
  BAR_MENU, HOLD_MS, ITEM_KINDS, KIND_LABELS, SHOP_ITEMS, barItem, isOp, itemOfKind, shopItem, withItem,
} from '../src/items.ts';
import { DEFAULT_LOOK, lookFromJson, parseLook, type Look } from '../src/look.ts';
import { DOLLAR, LOAN_AMOUNT, STARTING_BALANCE, isCents } from '../src/money.ts';

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('shop catalog', () => {
  it('has unique, well-formed ids across the shop and the bar', () => {
    const ids = [...SHOP_ITEMS, ...BAR_MENU].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(ID);
  });

  it('prices every item in whole dollars of integer cents', () => {
    for (const i of [...SHOP_ITEMS, ...BAR_MENU]) {
      expect(isCents(i.price), i.id).toBe(true);
      expect(i.price % DOLLAR, i.id).toBe(0);
      expect(i.price, i.id).toBeGreaterThan(0);
    }
  });

  it('puts every shop item out of reach of a fresh account or a loan', () => {
    const reach = Math.max(STARTING_BALANCE, LOAN_AMOUNT);
    for (const i of SHOP_ITEMS) expect(i.price, i.id).toBeGreaterThan(reach);
  });

  it('carries the prices the owner asked for', () => {
    const price = (id: string) => shopItem(id)!.price / DOLLAR;
    expect(price('rope-chain')).toBe(250_000);
    expect(price('figaro')).toBe(400_000);
    expect(price('cuban-link')).toBe(750_000);
    expect(price('iced-cuban')).toBe(2_500_000);
    expect(price('dice-pendant')).toBe(5_000_000);
    expect(price('ace-pendant')).toBe(5_000_000);
    expect(price('gold-top-six')).toBe(150_000);
    expect(price('full-gold')).toBe(400_000);
    expect(price('rose-gold')).toBe(600_000);
    expect(price('diamond-set')).toBe(1_500_000);
    expect(price('gold-tracksuit')).toBe(300_000);
    expect(price('white-tuxedo')).toBe(500_000);
    expect(price('velvet-jacket')).toBe(750_000);
    expect(price('fur-coat')).toBe(1_250_000);
    expect(price('diamond-suit')).toBe(10_000_000);
    const bar = (id: string) => barItem(id)!.price / DOLLAR;
    expect(bar('beer')).toBe(9);
    expect(bar('cocktail')).toBe(18);
    expect(bar('champagne')).toBe(32);
    expect(bar('dom')).toBe(1_200);
    expect(bar('sliders')).toBe(24);
    expect(bar('lobster')).toBe(95);
  });

  it('has something in every kind, a label for each, and chains, grills and clothes lightest first', () => {
    for (const k of ITEM_KINDS) {
      expect(SHOP_ITEMS.some((i) => i.kind === k), k).toBe(true);
      expect(KIND_LABELS[k]).toBeTruthy();
    }
    for (const k of ['chain', 'grill', 'clothes'] as const) {
      const prices = SHOP_ITEMS.filter((i) => i.kind === k).map((i) => i.price);
      expect([...prices].sort((a, b) => a - b), k).toEqual(prices);
    }
  });

  it('writes names and tags without marketing talk', () => {
    for (const i of [...SHOP_ITEMS, ...BAR_MENU]) {
      expect(i.name.length, i.id).toBeLessThanOrEqual(24);
      expect(i.about.length, i.id).toBeLessThanOrEqual(72);
      expect(i.about, i.id).toMatch(/\.$/);
      expect(`${i.name} ${i.about}`, i.id).not.toMatch(/!|win big|best|amazing|luxury/i);
    }
  });

  it('looks items up by id, and by id and kind', () => {
    expect(shopItem('iced-cuban')?.kind).toBe('chain');
    expect(shopItem('nope')).toBeNull();
    expect(shopItem(42)).toBeNull();
    expect(itemOfKind('iced-cuban', 'chain')?.name).toBe('Iced Cuban');
    expect(itemOfKind('iced-cuban', 'grill')).toBeNull();
    expect(barItem('dom')?.model).toBe('magnum');
    expect(barItem('rope-chain')).toBeNull();
  });

  it('holds a bar order for about five minutes', () => {
    expect(HOLD_MS).toBe(300_000);
  });

  it('accepts op ids a client can make and nothing else', () => {
    expect(isOp('3f2b8c1e-9d4a-4e7b-8a61-2c5d0f9e7b13')).toBe(true);
    expect(isOp('op_12345678')).toBe(true);
    for (const bad of ['short', 'has space in it', 'a'.repeat(41), 'semi;colon1', '', null, 12345678]) expect(isOp(bad), String(bad)).toBe(false);
  });
});

describe('looks with items', () => {
  const base: Look = { ...DEFAULT_LOOK };

  it('keeps worn items of the right kind', () => {
    const look = parseLook({ ...base, chain: 'iced-cuban', grill: 'diamond-set', clothes: 'white-tuxedo', watch: 'gold-watch', shades: 'gold-aviators', hat: 'black-fedora' });
    expect(look).toMatchObject({ chain: 'iced-cuban', grill: 'diamond-set', clothes: 'white-tuxedo', watch: 'gold-watch', shades: 'gold-aviators', hat: 'black-fedora' });
  });

  it('drops unknown ids and items in the wrong slot, but keeps the rest of the look', () => {
    const look = parseLook({ ...base, chain: 'diamond-set', grill: 'gold-grill-9000', hat: 7, clothes: 'white-tuxedo' });
    expect(look).not.toBeNull();
    expect(look!.chain).toBeUndefined();
    expect(look!.grill).toBeUndefined();
    expect(look!.hat).toBeUndefined();
    expect(look!.clothes).toBe('white-tuxedo');
    expect(look!.outfit).toBe(base.outfit);
  });

  it('drops unknown keys, as before', () => {
    const look = parseLook({ ...base, crown: 'gold', style: 'x' }) as unknown as Record<string, unknown>;
    expect(look.crown).toBeUndefined();
    expect(look.style).toBeUndefined();
  });

  it('keeps a held order only in its exact shape', () => {
    const held = { item: 'champagne', order: 'order-0001', until: 1_700_000_000_000 };
    expect(parseLook({ ...base, held })!.held).toEqual(held);
    for (const bad of [
      { ...held, item: 'rope-chain' },
      { ...held, order: 'no' },
      { ...held, until: -1 },
      { ...held, until: 1.5 },
      { item: 'beer' },
      'beer',
      null,
    ]) {
      expect(parseLook({ ...base, held: bad })!.held, JSON.stringify(bad)).toBeUndefined();
    }
    // extra keys inside held don't travel
    expect(parseLook({ ...base, held: { ...held, x: 1 } })!.held).toEqual(held);
  });

  it('round-trips through stored JSON', () => {
    const look = parseLook({ ...base, chain: 'rope-chain', held: { item: 'beer', order: 'order-0002', until: 123 } })!;
    expect(lookFromJson(JSON.stringify(look))).toEqual(look);
  });

  it('a look from before the shop parses exactly as it did', () => {
    expect(parseLook(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
    expect(Object.keys(parseLook(DEFAULT_LOOK)!)).toEqual(Object.keys(DEFAULT_LOOK));
  });

  it('puts an item on and takes it off without touching the rest', () => {
    const on = withItem(base, 'chain', 'figaro');
    expect(on.chain).toBe('figaro');
    expect(base.chain).toBeUndefined();
    const swapped = withItem(on, 'chain', 'cuban-link');
    expect(swapped.chain).toBe('cuban-link');
    const off = withItem(swapped, 'chain', null);
    expect('chain' in off).toBe(false);
    expect(off).toEqual(base);
  });
});
