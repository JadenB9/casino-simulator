// What the boutique shows, section by section, as plain data: the worn pieces by kind, the rides,
// the emotes, the effects and the statue. Each section lists what's sold, cheapest first, then the
// pieces feats give (never sold: they show what there is to win). Pure, so the order and the
// slot arithmetic below are tested without a page.

import {
  EFFECTS, EMOTE_ITEMS, FX_GAP_MS, ITEM_KINDS, SHOP_ITEMS, STATUE,
  effectItem, emoteItem, shopEmote, wornItem,
  type EffectItem, type FxEvent, type ItemKind,
} from '../../../../shared/src/items.ts';
import { FEATS, type Feat } from '../../../../shared/src/feats.ts';
import { DOLLAR, type Cents } from '../../../../shared/src/money.ts';
import { ROOMS, type RoomId } from '../../world/rooms.ts';

export type Section = 'wear' | 'ride' | 'emote' | 'fx' | 'statue' | 'vault';

export const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'wear', label: 'Wear' },
  { id: 'ride', label: 'Rides' },
  { id: 'emote', label: 'Emotes' },
  { id: 'fx', label: 'Effects' },
  { id: 'statue', label: 'Statue' },
  { id: 'vault', label: 'Vault' },
];

/**
 * The private collection: anything from a billion dollars up. It has a section of its own (the
 * Vault) and sits at the end of its kind's list under its own heading, and the showroom shows a
 * piece of it in a glass case.
 */
export const VAULT_FROM: Cents = 1_000_000_000 * DOLLAR;
export const inVault = (e: { price: Cents; reward: boolean }) => !e.reward && e.price >= VAULT_FROM;

/** The kinds worn on you (a ride has a section of its own). */
export const WEAR_KINDS: readonly ItemKind[] = ITEM_KINDS.filter((k) => k !== 'ride');

export interface Entry {
  section: Section;
  id: string;
  name: string;
  price: Cents;
  about: string;
  /** Given by a feat, never sold. */
  reward: boolean;
  /** The worn kind (wear and ride). */
  kind?: ItemKind;
  /** The effect (fx). */
  fx?: EffectItem;
}

/** New in the shop this season: marked until you own them. */
export const NEW_IDS: ReadonlySet<string> = new Set([
  'tennis-chain', 'rose-watch', 'round-shades', 'diamond-shades', 'top-hat', 'cowboy-hat', 'gold-crown', 'leather-jacket', 'sequin-suit',
  'billionaire-chain', 'emperor-robe', 'imperial-crown',
  'skateboard', 'e-scooter', 'hoverboard', 'segway', 'hover-throne',
  'throwback', 'griddy', 'floss', 'dab', 'robot', 'backflip', 'moneyfan', 'bow',
  ...EFFECTS.map((e) => e.id),
  STATUE.id,
]);

const cheapestFirst = (a: Entry, b: Entry) => Number(a.reward) - Number(b.reward) || a.price - b.price;

/** The rows a section (and, for wear, a kind) lists: sold ones cheapest first, then rewards. */
export function entries(section: Section, kind: ItemKind = 'chain'): Entry[] {
  switch (section) {
    case 'wear':
    case 'ride': {
      const k: ItemKind = section === 'ride' ? 'ride' : kind;
      return SHOP_ITEMS.filter((i) => i.kind === k)
        .map((i): Entry => ({ section, id: i.id, name: i.name, price: i.price, about: i.about, reward: i.reward === true, kind: i.kind }))
        .sort(cheapestFirst);
    }
    case 'emote':
      return EMOTE_ITEMS.filter((e) => shopEmote(e.id) || e.reward)
        .map((e): Entry => ({ section, id: e.id, name: e.name, price: e.price, about: e.about, reward: e.reward === true }))
        .sort(cheapestFirst);
    case 'fx':
      return EFFECTS.map((f): Entry => ({ section, id: f.id, name: f.name, price: f.price, about: f.about, reward: false, fx: f }));
    case 'statue':
      return [{ section, id: STATUE.id, name: STATUE.name, price: STATUE.price, about: STATUE.about, reward: false }];
    case 'vault':
      return [
        ...SHOP_ITEMS.filter((i) => !i.reward && i.price >= VAULT_FROM).map((i): Entry => ({ section, id: i.id, name: i.name, price: i.price, about: i.about, reward: false, kind: i.kind })),
        ...EFFECTS.filter((f) => f.price >= VAULT_FROM).map((f): Entry => ({ section, id: f.id, name: f.name, price: f.price, about: f.about, reward: false, fx: f })),
      ].sort(cheapestFirst);
  }
}

/** Any id the boutique knows, as its row (null for a free emote or an unknown id). */
export function entryOf(id: string | undefined | null): Entry | null {
  if (!id) return null;
  const worn = wornItem(id);
  if (worn) return entries(worn.kind === 'ride' ? 'ride' : 'wear', worn.kind).find((e) => e.id === id) ?? null;
  if (emoteItem(id)) return entries('emote').find((e) => e.id === id) ?? null;
  if (effectItem(id)) return entries('fx').find((e) => e.id === id) ?? null;
  return id === STATUE.id ? entries('statue')[0]! : null;
}

/** The feat that gives a reward piece or emote, if the list has one. */
export function rewardFeat(id: string): Feat | null {
  return FEATS.find((f) => f.reward.item === id || f.reward.emote === id) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Effects: when one would start (the floor's own rule, server/src/floor/fx.ts), for the price line

/** The room a floor position (metres) is in, or the nearest one. */
export function roomAt(x: number, z: number): (typeof ROOMS)[number] {
  let best = ROOMS[0]!;
  let bestD = Infinity;
  for (const r of ROOMS) {
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dz = Math.max(r.z0 - z, 0, z - r.z1);
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

function slotOf(reach: EffectItem['reach'], id: number, xCm: number, zCm: number): string {
  if (reach === 'casino') return 'casino';
  if (reach === 'room') return `room:${roomAt(xCm / 100, zCm / 100).id}`;
  return `you:${id}`;
}

export interface Wait {
  /** Server time it would start if bought now. */
  at: number;
  /** What holds it up (the last in its slot), if anything does. */
  behind: FxEvent | null;
  /** The room it plays in (for a room effect) or where you stand. */
  room: RoomId;
}

/** When `fx` would start if bought now by player `me` standing at (x, z) metres, given what's on. */
export function waitFor(list: readonly FxEvent[], fx: EffectItem, me: number, x: number, z: number, now: number): Wait {
  const mine = slotOf(fx.reach, me, x * 100, z * 100);
  let behind: FxEvent | null = null;
  for (const e of list) {
    const item = effectItem(e.fx);
    if (!item || e.until <= now || slotOf(item.reach, e.id, e.x, e.z) !== mine) continue;
    if (!behind || e.until > behind.until) behind = e;
  }
  return { at: behind ? behind.until + FX_GAP_MS : now, behind, room: roomAt(x, z).id };
}

/** "8 s", "90 s", "2 min" */
export function secsText(secs: number): string {
  return secs >= 120 && secs % 60 === 0 ? `${secs / 60} min` : `${secs} s`;
}

/** "0:40", "2:05" */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const REACH_TEXT: Record<EffectItem['reach'], string> = {
  you: 'Around you',
  room: 'The whole room',
  casino: 'Every room',
};

/** A room's name as a sentence says it: "the Bar", "the Pit". */
export function roomName(id: RoomId): string {
  const r = ROOMS.find((x) => x.id === id);
  if (!r) return 'the room';
  return `the ${r.name.replace(/^The /, '')}`;
}
