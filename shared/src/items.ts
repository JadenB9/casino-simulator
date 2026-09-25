// The boutique's catalog and the bar's menu. Prices are integer cents, like every amount in the
// game. A shop item is bought once and kept for good; you wear it through your Look (look.ts),
// one per kind (a ride is worn the same way: you ride it). An emote is bought once and kept too;
// it goes on your emote wheel. An effect is bought every time, like a bar order, and plays out on
// the floor for everyone. A bar order is held in your right hand for a few minutes.
//
// Some pieces are never sold: achievements and challenges give them (feats.ts). They're in the
// same lists, marked `reward`, so a look can wear them and the wheel can hold them.
//
// Ids are stored in D1 (casino_items, casino_orders, casino_feats) and inside saved looks, so an
// id never changes once it has shipped; an item that leaves the catalog keeps its id retired.

import { DOLLAR, type Cents } from './money.ts';
import type { Look } from './look.ts';
import { FREE_EMOTES, REWARD_EMOTES, SHOP_EMOTES, type EmoteId } from './protocol.ts';

/** Kinds of worn item. Each kind is also the Look field that wears it (look.chain, look.ride...). */
export const ITEM_KINDS = ['chain', 'grill', 'clothes', 'watch', 'shades', 'hat', 'ride'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ShopItem {
  id: string;
  kind: ItemKind;
  name: string;
  /** What it costs; for a reward, what it would cost (shown, never charged). */
  price: Cents;
  /** One line for the shop's card: what it is made of, the way a jeweller's tag says it. */
  about: string;
  /** Not sold: an achievement or a challenge gives it (feats.ts). */
  reward?: true;
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
  { id: 'tennis-chain', kind: 'chain', name: 'Tennis Chain', price: 1_200_000 * DOLLAR, about: 'One row of 180 round brilliants in white gold.' },
  { id: 'iced-cuban', kind: 'chain', name: 'Iced Cuban', price: 2_500_000 * DOLLAR, about: 'Cuban links in 18k, every link set with pavé diamonds.' },
  { id: 'dice-pendant', kind: 'chain', name: 'Diamond Dice', price: 5_000_000 * DOLLAR, about: 'A pair of pavé diamond dice with black pips, on a Cuban link.' },
  { id: 'ace-pendant', kind: 'chain', name: 'Ace of Spades', price: 5_000_000 * DOLLAR, about: 'An 18k medallion with the ace in black enamel, ringed in diamonds.' },
  { id: 'billionaire-chain', kind: 'chain', name: 'The Billionaire', price: 1_000_000_000 * DOLLAR, about: 'Solid gold rope as thick as a thumb, a diamond B the size of a fist.' },
  // grills
  { id: 'gold-top-six', kind: 'grill', name: 'Gold Top Six', price: 150_000 * DOLLAR, about: 'Six 14k caps across the top front teeth.' },
  { id: 'full-gold', kind: 'grill', name: 'Full Gold', price: 400_000 * DOLLAR, about: 'Top and bottom rows in solid 18k.' },
  { id: 'rose-gold', kind: 'grill', name: 'Rose Gold', price: 600_000 * DOLLAR, about: 'Top and bottom rows in 18k rose gold.' },
  { id: 'diamond-set', kind: 'grill', name: 'Diamond Set', price: 1_500_000 * DOLLAR, about: 'White gold, top and bottom, set with VVS diamonds.' },
  // special clothes
  { id: 'leather-jacket', kind: 'clothes', name: 'Leather Jacket', price: 180_000 * DOLLAR, about: 'Black lambskin biker jacket, silver zips.' },
  { id: 'gold-tracksuit', kind: 'clothes', name: 'Gold Tracksuit', price: 300_000 * DOLLAR, about: 'Metallic gold lamé, jacket and trousers.' },
  { id: 'white-tuxedo', kind: 'clothes', name: 'White Tuxedo', price: 500_000 * DOLLAR, about: 'Ivory dinner jacket, black satin lapels, black trousers.' },
  { id: 'velvet-jacket', kind: 'clothes', name: 'Velvet Smoking Jacket', price: 750_000 * DOLLAR, about: 'Burgundy silk velvet with a black satin collar.' },
  { id: 'sequin-suit', kind: 'clothes', name: 'Sequin Suit', price: 900_000 * DOLLAR, about: 'Silver sequins from lapel to cuff. A stage suit.' },
  { id: 'fur-coat', kind: 'clothes', name: 'Fur Coat', price: 1_250_000 * DOLLAR, about: 'Long cream fur, worn open over black.' },
  { id: 'diamond-suit', kind: 'clothes', name: 'Diamond-Studded Suit', price: 10_000_000 * DOLLAR, about: 'Black wool with thousands of diamonds sewn into it.' },
  { id: 'emperor-robe', kind: 'clothes', name: "Emperor's Robe", price: 1_500_000_000 * DOLLAR, about: 'Purple velvet, ermine trim, gold thread, rubies down the front.' },
  // watches, shades and hats
  { id: 'gold-watch', kind: 'watch', name: 'Gold Dress Watch', price: 85_000 * DOLLAR, about: '18k case and bracelet, champagne dial.' },
  { id: 'iced-watch', kind: 'watch', name: 'Iced Watch', price: 450_000 * DOLLAR, about: 'Diamond bezel, diamond bracelet, white gold.' },
  { id: 'gold-aviators', kind: 'shades', name: 'Gold Aviators', price: 60_000 * DOLLAR, about: 'Gold wire frames, brown gradient lenses.' },
  { id: 'black-fedora', kind: 'hat', name: 'Black Fedora', price: 75_000 * DOLLAR, about: 'Beaver felt with a grosgrain band.' },
  { id: 'panama-hat', kind: 'hat', name: 'Panama Hat', price: 65_000 * DOLLAR, about: 'Hand-woven toquilla straw, black band.' },
  // v6: more of everything
  { id: 'rose-watch', kind: 'watch', name: 'Rose Gold Watch', price: 220_000 * DOLLAR, about: '18k rose gold case and bracelet, black dial.' },
  { id: 'round-shades', kind: 'shades', name: 'Round Shades', price: 65_000 * DOLLAR, about: 'Tortoiseshell acetate, green lenses.' },
  { id: 'diamond-shades', kind: 'shades', name: 'Diamond Shades', price: 350_000 * DOLLAR, about: 'Rimless, with a row of diamonds along the brow.' },
  { id: 'top-hat', kind: 'hat', name: 'Top Hat', price: 90_000 * DOLLAR, about: 'Black silk plush, a satin band.' },
  { id: 'cowboy-hat', kind: 'hat', name: 'Cowboy Hat', price: 70_000 * DOLLAR, about: 'Silverbelly felt, a cattleman crease.' },
  { id: 'gold-crown', kind: 'hat', name: 'Gold Crown', price: 3_000_000 * DOLLAR, about: 'Solid 22k gold, eight points, set with rubies.' },
  { id: 'imperial-crown', kind: 'hat', name: 'Imperial Crown', price: 5_000_000_000 * DOLLAR, about: 'Platinum arches, 2,868 diamonds, a sapphire the size of an egg.' },
  // rides: worn like the rest, and you ride it about the floor (faster than walking)
  { id: 'skateboard', kind: 'ride', name: 'Skateboard', price: 60_000 * DOLLAR, about: 'Maple deck, black grip, red wheels.' },
  { id: 'e-scooter', kind: 'ride', name: 'Electric Scooter', price: 120_000 * DOLLAR, about: 'Folding aluminium frame, a quiet hub motor.' },
  { id: 'hoverboard', kind: 'ride', name: 'Hoverboard', price: 250_000 * DOLLAR, about: 'Floats a hand above the carpet on a blue glow.' },
  { id: 'segway', kind: 'ride', name: 'Segway', price: 400_000 * DOLLAR, about: 'Two wheels, a handlebar, and perfect balance.' },
  { id: 'hover-throne', kind: 'ride', name: 'Hover Throne', price: 2_500_000_000 * DOLLAR, about: 'A gold throne on red velvet that floats you about the floor.' },
  // rewards: never sold (feats.ts gives them)
  { id: 'twentyone-pendant', kind: 'chain', name: 'Twenty-One Pendant', price: 1_000_000 * DOLLAR, about: 'An ace and a jack in enamel on gold, for a blackjack hand.', reward: true },
  { id: 'royal-pendant', kind: 'chain', name: 'Royal Flush Pendant', price: 4_000_000 * DOLLAR, about: 'Five spades fanned in gold, for a royal flush.', reward: true },
  { id: 'horseshoe-pendant', kind: 'chain', name: 'Lucky Horseshoe', price: 2_000_000 * DOLLAR, about: 'A gold horseshoe set with emeralds, for a jackpot.', reward: true },
  { id: 'high-roller-shades', kind: 'shades', name: 'High Roller Shades', price: 5_000_000 * DOLLAR, about: 'Gold frames, black lenses with a gold chip on each temple.', reward: true },
  { id: 'champion-jacket', kind: 'clothes', name: "Champion's Jacket", price: 8_000_000 * DOLLAR, about: 'Black satin, gold embroidery, won at every game in the house.', reward: true },
  { id: 'golden-board', kind: 'ride', name: 'Golden Hoverboard', price: 25_000_000 * DOLLAR, about: 'A hoverboard in polished gold, for ten million won.', reward: true },
];

const BY_ID = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

/** An item the boutique sells (never a reward), or null. */
export function shopItem(id: unknown): ShopItem | null {
  const item = typeof id === 'string' ? BY_ID.get(id) : undefined;
  return item && !item.reward ? item : null;
}

/** Any worn item, sold or given, or null. */
export function wornItem(id: unknown): ShopItem | null {
  return typeof id === 'string' ? (BY_ID.get(id) ?? null) : null;
}

/** An item of this kind, sold or given, or null (for reading a Look field). */
export function itemOfKind(id: unknown, kind: ItemKind): ShopItem | null {
  const item = wornItem(id);
  return item && item.kind === kind ? item : null;
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
  ride: 'Rides',
};

/** One of a kind, for a label under a piece ("Chain · $250,000"). */
export const KIND_ONE: Record<ItemKind, string> = {
  chain: 'Chain',
  grill: 'Grill',
  clothes: 'Clothes',
  watch: 'Watch',
  shades: 'Shades',
  hat: 'Hat',
  ride: 'Ride',
};

// ---------------------------------------------------------------------------------------------
// Emotes

export interface EmoteItem {
  id: EmoteId;
  name: string;
  /** What it costs; 0 for the six everyone has; for a reward, what it would cost. */
  price: Cents;
  about: string;
  reward?: true;
}

/**
 * Every emote with its name. The six free ones come with every account; the shop sells the rest
 * but the rewards, which feats.ts gives.
 */
export const EMOTE_ITEMS: readonly EmoteItem[] = [
  { id: 'wave', name: 'Wave', price: 0, about: 'A hand up, rocking side to side.' },
  { id: 'cheer', name: 'Cheer', price: 0, about: 'Both fists up and a couple of hops.' },
  { id: 'clap', name: 'Clap', price: 0, about: 'Three claps a second.' },
  { id: 'thumbs', name: 'Thumbs Up', price: 0, about: 'A thumb up and a nod.' },
  { id: 'shrug', name: 'Shrug', price: 0, about: 'Palms up, head to one side.' },
  { id: 'sixseven', name: 'Six Seven', price: 0, about: 'Both hands weighed up and down.' },
  { id: 'throwback', name: 'Throw It Back', price: 150_000 * DOLLAR, about: 'Hands on the knees and the hips bouncing to the beat.' },
  { id: 'griddy', name: 'The Griddy', price: 120_000 * DOLLAR, about: 'Heels tapping, arms swinging, hands over the eyes.' },
  { id: 'floss', name: 'The Floss', price: 80_000 * DOLLAR, about: 'Straight arms swung past the hips, side to side.' },
  { id: 'dab', name: 'Dab', price: 60_000 * DOLLAR, about: 'Head down into one elbow, the other arm flung out.' },
  { id: 'robot', name: 'The Robot', price: 100_000 * DOLLAR, about: 'Stiff arms, sharp stops, a head that ticks.' },
  { id: 'backflip', name: 'Backflip', price: 500_000 * DOLLAR, about: 'A standing backflip, landed clean.' },
  { id: 'moneyfan', name: 'Money Fan', price: 250_000 * DOLLAR, about: 'A fan of hundreds held up to cool yourself with.' },
  { id: 'bow', name: 'Bow', price: 60_000 * DOLLAR, about: 'One hand to the chest, a deep bow.' },
  { id: 'trophy', name: 'Trophy', price: 2_000_000 * DOLLAR, about: 'A gold cup lifted over your head, for a million won.', reward: true },
  { id: 'moonwalk', name: 'Moonwalk', price: 1_000_000 * DOLLAR, about: 'Gliding backwards, for $50,000 won in a round.', reward: true },
];

const EMOTE_BY_ID = new Map(EMOTE_ITEMS.map((i) => [i.id as string, i]));

export function emoteItem(id: unknown): EmoteItem | null {
  return typeof id === 'string' ? (EMOTE_BY_ID.get(id) ?? null) : null;
}

/** An emote the shop sells (not free, not a reward), or null. */
export function shopEmote(id: unknown): EmoteItem | null {
  const e = emoteItem(id);
  return e && e.price > 0 && !e.reward ? e : null;
}

/** Whether everyone has this emote without buying or earning it. */
export function isFreeEmote(id: unknown): boolean {
  return (FREE_EMOTES as readonly unknown[]).includes(id);
}

// every emote the protocol knows has a name here, and nothing else
void (SHOP_EMOTES satisfies readonly EmoteId[]);
void (REWARD_EMOTES satisfies readonly EmoteId[]);

// ---------------------------------------------------------------------------------------------
// Effects: bought every time, played out on the floor for everyone to see

/** Who sees an effect: around the buyer, the whole room the buyer is in, or every room. */
export type EffectReach = 'you' | 'room' | 'casino';

export interface EffectItem {
  id: string;
  name: string;
  price: Cents;
  about: string;
  /** How long it plays, seconds. */
  secs: number;
  reach: EffectReach;
}

export const EFFECTS: readonly EffectItem[] = [
  { id: 'fx-confetti', name: 'Confetti Cannon', price: 5_000 * DOLLAR, about: 'A burst of gold and red confetti over everyone near you.', secs: 8, reach: 'you' },
  { id: 'fx-spotlight', name: 'Spotlight', price: 10_000 * DOLLAR, about: 'A follow spot from the ceiling that stays on you.', secs: 90, reach: 'you' },
  { id: 'fx-round', name: 'Round on the House', price: 20_000 * DOLLAR, about: 'Champagne in the hand of everyone in the room.', secs: 60, reach: 'room' },
  { id: 'fx-rain', name: 'Make It Rain', price: 25_000 * DOLLAR, about: 'Hundred-dollar bills fluttering down around you.', secs: 12, reach: 'you' },
  { id: 'fx-sparklers', name: 'Cold Sparks', price: 50_000 * DOLLAR, about: 'Stage spark fountains in a ring around you.', secs: 15, reach: 'you' },
  { id: 'fx-disco', name: 'Disco Night', price: 100_000 * DOLLAR, about: 'A mirror ball comes down and the room goes disco.', secs: 60, reach: 'room' },
  { id: 'fx-marquee', name: 'Headline', price: 250_000 * DOLLAR, about: 'Your name up on the LED sign over the pit.', secs: 120, reach: 'casino' },
  { id: 'fx-goldenhour', name: 'Golden Hour', price: 1_000_000 * DOLLAR, about: 'Gold light and falling gold coins in every room.', secs: 30, reach: 'casino' },
  { id: 'fx-takeover', name: 'Own the Night', price: 1_000_000_000 * DOLLAR, about: 'Your name on every sign and screen, fireworks and gold in every room.', secs: 60, reach: 'casino' },
];

const FX_BY_ID = new Map(EFFECTS.map((i) => [i.id, i]));

/**
 * The floor plays one effect at a time per player ('you'), per room ('room') and for the casino
 * ('casino'); a busy one queues the next behind it, this long after it ends. Nothing is sold that
 * would start further out than FX_MAX_WAIT_MS.
 */
export const FX_GAP_MS = 1_000;
export const FX_MAX_WAIT_MS = 5 * 60_000;

export function effectItem(id: unknown): EffectItem | null {
  return typeof id === 'string' ? (FX_BY_ID.get(id) ?? null) : null;
}

/**
 * A lasting mark on the building: a gold statue of your character on a plinth in the lobby. Bought
 * once and kept (a casino_items row); the lobby shows the STATUES most recent buyers.
 */
export interface StatueItem {
  id: 'statue';
  name: string;
  price: Cents;
  about: string;
}

export const STATUE: StatueItem = {
  id: 'statue',
  name: 'Your Statue',
  price: 10_000_000 * DOLLAR,
  about: 'A gold statue of you, as you look now, on a plinth in the lobby.',
};
export const STATUES = 3;


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
const OP_RE = /^[A-Za-z0-9_-]{8,40}$/;

export function isOp(x: unknown): x is string {
  return typeof x === 'string' && OP_RE.test(x);
}

// ---------------------------------------------------------------------------------------------
// HTTP (GET /shop, POST /shop/buy, POST /bar/order)

export interface ShopResponse {
  /** The worn items and rides the boutique sells (never a reward). */
  items: readonly ShopItem[];
  /**
   * Ids you own (worn items, rides, emotes, the statue), with what you paid and when. A reward
   * you earned is here too, with price 0 and the feat that gave it.
   */
  owned: { item: string; price: Cents; at: number; feat?: string }[];
  balance: Cents;
  /** v6: the emotes it sells (not the free six, not rewards), the effects, and the statue. */
  emotes: readonly EmoteItem[];
  effects: readonly EffectItem[];
  statue: StatueItem;
  /** v6: the statues in the lobby now, newest first. */
  statues: Statue[];
}

/** POST /shop/buy: a worn item or ride, an emote, or the statue (by id). */
export interface BuyRequest {
  item: string;
  op: string;
}

/** POST /shop/fx: play an effect. */
export interface EffectRequest {
  item: string;
  op: string;
}

/** An effect playing on the floor (also the floor's `fx` message). */
export interface FxEvent {
  fx: string;
  /** The buyer's account id and name. */
  id: number;
  name: string;
  /** Server time it starts and ends (ms). A busy room queues it: `at` can be in the future. */
  at: number;
  until: number;
  /** Where the buyer stood, integer cm (the room is the one this point is in). */
  x: number;
  z: number;
}

export interface EffectResponse {
  fx: FxEvent;
  balance: Cents;
  inPlay: Cents;
  rev: number;
}

/** A statue in the lobby (the floor's `statues` message), newest first. */
export interface Statue {
  name: string;
  look: Look;
  at: number;
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
