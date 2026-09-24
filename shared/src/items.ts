// The boutique's catalog and the bar's menu. Prices are integer cents, like every amount in the
// game. A shop item is bought once and kept for good; you wear it through your Look (look.ts),
// one per kind. A bar order is bought every time and held in your right hand for a few minutes.
//
// Ids are stored in D1 (casino_items, casino_orders) and inside saved looks, so an id never
// changes once it has shipped; an item that leaves the catalog keeps its id retired.

import { DOLLAR, type Cents } from './money.ts';
import type { Look } from './look.ts';

/** Kinds of shop item. Each kind is also the Look field that wears it (look.chain, look.grill...). */
export const ITEM_KINDS = ['chain', 'grill', 'clothes', 'watch', 'shades', 'hat'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ShopItem {
  id: string;
  kind: ItemKind;
  name: string;
  price: Cents;
  /** One line for the shop's card: what it is made of, the way a jeweller's tag says it. */
  about: string;
}

/**
 * What the boutique sells. The prices are high on purpose: a loan refills you to $50,000 at
 * most, so every piece here has to be won first.
 */
export const SHOP_ITEMS: readonly ShopItem[] = [
  // chains, lightest first
  { id: 'rope-chain', kind: 'chain', name: 'Rope Chain', price: 250_000 * DOLLAR, about: '18k yellow gold, 5 mm twisted rope, 22 inches.' },
  { id: 'figaro', kind: 'chain', name: 'Figaro', price: 400_000 * DOLLAR, about: 'Italian 18k: three short links, then one long.' },
  { id: 'cuban-link', kind: 'chain', name: 'Cuban Link', price: 750_000 * DOLLAR, about: 'Miami Cuban, 12 mm, solid 18k yellow gold.' },
  { id: 'iced-cuban', kind: 'chain', name: 'Iced Cuban', price: 2_500_000 * DOLLAR, about: 'Cuban links in 18k, every link set with pavé diamonds.' },
  { id: 'dice-pendant', kind: 'chain', name: 'Diamond Dice', price: 5_000_000 * DOLLAR, about: 'A pair of pavé diamond dice with black pips, on a Cuban link.' },
  { id: 'ace-pendant', kind: 'chain', name: 'Ace of Spades', price: 5_000_000 * DOLLAR, about: 'An 18k medallion with the ace in black enamel, ringed in diamonds.' },
  // grills
  { id: 'gold-top-six', kind: 'grill', name: 'Gold Top Six', price: 150_000 * DOLLAR, about: 'Six 14k caps across the top front teeth.' },
  { id: 'full-gold', kind: 'grill', name: 'Full Gold', price: 400_000 * DOLLAR, about: 'Top and bottom rows in solid 18k.' },
  { id: 'rose-gold', kind: 'grill', name: 'Rose Gold', price: 600_000 * DOLLAR, about: 'Top and bottom rows in 18k rose gold.' },
  { id: 'diamond-set', kind: 'grill', name: 'Diamond Set', price: 1_500_000 * DOLLAR, about: 'White gold, top and bottom, set with VVS diamonds.' },
  // special clothes
  { id: 'gold-tracksuit', kind: 'clothes', name: 'Gold Tracksuit', price: 300_000 * DOLLAR, about: 'Metallic gold lamé, jacket and trousers.' },
  { id: 'white-tuxedo', kind: 'clothes', name: 'White Tuxedo', price: 500_000 * DOLLAR, about: 'Ivory dinner jacket, black satin lapels, black trousers.' },
  { id: 'velvet-jacket', kind: 'clothes', name: 'Velvet Smoking Jacket', price: 750_000 * DOLLAR, about: 'Burgundy silk velvet with a black satin collar.' },
  { id: 'fur-coat', kind: 'clothes', name: 'Fur Coat', price: 1_250_000 * DOLLAR, about: 'Long cream fur, worn open over black.' },
  { id: 'diamond-suit', kind: 'clothes', name: 'Diamond-Studded Suit', price: 10_000_000 * DOLLAR, about: 'Black wool with thousands of diamonds sewn into it.' },
  // watches, shades and hats
  { id: 'gold-watch', kind: 'watch', name: 'Gold Dress Watch', price: 85_000 * DOLLAR, about: '18k case and bracelet, champagne dial.' },
  { id: 'iced-watch', kind: 'watch', name: 'Iced Watch', price: 450_000 * DOLLAR, about: 'Diamond bezel, diamond bracelet, white gold.' },
  { id: 'gold-aviators', kind: 'shades', name: 'Gold Aviators', price: 60_000 * DOLLAR, about: 'Gold wire frames, brown gradient lenses.' },
  { id: 'black-fedora', kind: 'hat', name: 'Black Fedora', price: 75_000 * DOLLAR, about: 'Beaver felt with a grosgrain band.' },
  { id: 'panama-hat', kind: 'hat', name: 'Panama Hat', price: 65_000 * DOLLAR, about: 'Hand-woven toquilla straw, black band.' },
];

const BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

export function shopItem(id: unknown): ShopItem | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** An item of this kind, or null (for reading a Look field). */
export function itemOfKind(id: unknown, kind: ItemKind): ShopItem | null {
  const item = shopItem(id);
  return item && item.kind === kind ? item : null;
}

/** The shop items a look wears, one per kind at most, in the order of ITEM_KINDS. */
export function wornItems(look: Look): ShopItem[] {
  return ITEM_KINDS.flatMap((k) => {
    const item = itemOfKind(look[k], k);
    return item ? [item] : [];
  });
}

/** The look wearing `id` in place of whatever it wore of that kind, or with the kind taken off (null). */
export function withItem(look: Look, kind: ItemKind, id: string | null): Look {
  const next: Look = { ...look };
  if (id) next[kind] = id;
  else delete next[kind];
  return next;
}

/** What the shop's tabs call each kind. */
export const KIND_LABELS: Record<ItemKind, string> = {
  chain: 'Chains',
  grill: 'Grills',
  clothes: 'Clothes',
  watch: 'Watches',
  shades: 'Shades',
  hat: 'Hats',
};

// ---------------------------------------------------------------------------------------------
// The bar

/** The model an order is held as: what the waiter brings and your right hand carries. */
export type BarModel = 'bottle' | 'martini' | 'flute' | 'magnum' | 'rocks' | 'wine' | 'cup' | 'plate';

export interface BarItem {
  id: string;
  kind: 'drink' | 'food';
  name: string;
  price: Cents;
  about: string;
  model: BarModel;
}

/** Casino prices: a beer costs what it costs on the Strip. */
export const BAR_MENU: readonly BarItem[] = [
  { id: 'beer', kind: 'drink', name: 'Beer', price: 9 * DOLLAR, about: 'Imported lager, by the bottle.', model: 'bottle' },
  { id: 'red-wine', kind: 'drink', name: 'Red Wine', price: 16 * DOLLAR, about: 'A glass of Napa cabernet.', model: 'wine' },
  { id: 'cocktail', kind: 'drink', name: 'Cocktail', price: 18 * DOLLAR, about: 'A dry martini, stirred, with an olive.', model: 'martini' },
  { id: 'whiskey', kind: 'drink', name: 'Whiskey', price: 22 * DOLLAR, about: 'Single malt, neat.', model: 'rocks' },
  { id: 'champagne', kind: 'drink', name: 'Champagne', price: 32 * DOLLAR, about: 'A glass of brut.', model: 'flute' },
  { id: 'espresso', kind: 'drink', name: 'Espresso', price: 7 * DOLLAR, about: 'A double, for the long nights.', model: 'cup' },
  { id: 'dom', kind: 'drink', name: 'Bottle of Dom', price: 1_200 * DOLLAR, about: 'Vintage champagne, the whole bottle.', model: 'magnum' },
  { id: 'sliders', kind: 'food', name: 'Sliders', price: 24 * DOLLAR, about: 'Three wagyu sliders, aged cheddar.', model: 'plate' },
  { id: 'truffle-fries', kind: 'food', name: 'Truffle Fries', price: 18 * DOLLAR, about: 'Parmesan and black truffle.', model: 'plate' },
  { id: 'shrimp-cocktail', kind: 'food', name: 'Shrimp Cocktail', price: 28 * DOLLAR, about: 'Five jumbo prawns on ice.', model: 'plate' },
  { id: 'lobster', kind: 'food', name: 'Lobster', price: 95 * DOLLAR, about: 'A whole Maine lobster with drawn butter.', model: 'plate' },
  { id: 'caviar', kind: 'food', name: 'Caviar', price: 350 * DOLLAR, about: 'Ossetra, with blinis and crème fraîche.', model: 'plate' },
];

const BAR_BY_ID = new Map(BAR_MENU.map((i) => [i.id, i]));

export function barItem(id: unknown): BarItem | null {
  return typeof id === 'string' ? (BAR_BY_ID.get(id) ?? null) : null;
}

/** How long an order stays in your hand after it's paid for, unless you sit down at a table first. */
export const HOLD_MS = 5 * 60_000;

/** Operation ids the client picks for a purchase, so a retry is the same purchase. */
export const OP_RE = /^[A-Za-z0-9_-]{8,40}$/;

export function isOp(x: unknown): x is string {
  return typeof x === 'string' && OP_RE.test(x);
}

// ---------------------------------------------------------------------------------------------
// HTTP (GET /shop, POST /shop/buy, POST /bar/order)

export interface ShopResponse {
  items: readonly ShopItem[];
  /** Ids you own, with what you paid and when. */
  owned: { item: string; price: Cents; at: number }[];
  balance: Cents;
}

export interface BuyRequest {
  item: string;
  op: string;
}

export interface BuyResponse {
  item: string;
  price: Cents;
  at: number;
  /** The account's money after the purchase; rev is for the session's newest-wins rule. */
  balance: Cents;
  inPlay: Cents;
  rev: number;
}

export interface OrderRequest {
  item: string;
  op: string;
}

export interface BarOrder {
  /** The op id the order was placed with; a Look's `held.order` points at it. */
  id: string;
  item: string;
  price: Cents;
  at: number;
  /** Server time the order leaves your hand (at + HOLD_MS). */
  until: number;
}

export interface OrderResponse {
  order: BarOrder;
  balance: Cents;
  inPlay: Cents;
  rev: number;
}
