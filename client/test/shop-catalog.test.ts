// The boutique's lists and the effects' start times (client/src/ui/shop/catalog.ts): every piece
// is listed once in its section, sold ones cheapest first and rewards after; and the client works
// out when an effect would start the same way the floor queues it (server/src/floor/fx.ts).

import { describe, expect, it } from 'vitest';
import { EFFECTS, EMOTE_ITEMS, FX_GAP_MS, SHOP_ITEMS, effectItem, theName, type FxEvent } from '../../shared/src/items.ts';
import { NEW_IDS, SECTIONS, VAULT_FROM, WEAR_KINDS, inVault, clockText, entries, entryOf, roomAt, roomName, secsText, waitFor } from '../src/ui/shop/catalog.ts';
import { roomAt as floorRoomAt } from '../../server/src/floor/fx.ts';

describe('the boutique lists', () => {
  it('list every worn piece and ride once, sold cheapest first, then rewards', () => {
    const all = [...WEAR_KINDS.flatMap((k) => entries('wear', k)), ...entries('ride')];
    expect(all.map((e) => e.id).sort()).toEqual(SHOP_ITEMS.map((i) => i.id).sort());
    for (const list of [...WEAR_KINDS.map((k) => entries('wear', k)), entries('ride')]) {
      const sold = list.filter((e) => !e.reward);
      expect(sold.map((e) => e.price)).toEqual([...sold.map((e) => e.price)].sort((a, b) => a - b));
      expect(list.findIndex((e) => e.reward)).toBe(list.some((e) => e.reward) ? sold.length : -1);
    }
    expect(entries('ride').map((e) => e.id)).toEqual(['skateboard', 'e-scooter', 'hoverboard', 'segway', 'hover-throne', 'golden-board']);
  });

  it('list the emotes the shop sells and the ones feats give, never the free six', () => {
    const ids = entries('emote').map((e) => e.id);
    expect(ids.slice(-2)).toEqual(['moonwalk', 'trophy']);
    expect(ids.sort()).toEqual(EMOTE_ITEMS.filter((e) => e.price > 0).map((e) => e.id).sort());
    expect(entries('fx').map((e) => e.id)).toEqual(EFFECTS.map((e) => e.id));
    expect(entries('statue').map((e) => e.id)).toEqual(['statue']);
    expect(SECTIONS.map((s) => s.id)).toEqual(['wear', 'ride', 'emote', 'fx', 'statue', 'vault']);
  });

  it('keep the private collection in the Vault, dearest last, and at the end of its own kind too', () => {
    const vault = entries('vault');
    expect(vault.map((e) => e.id)).toEqual(['billionaire-chain', 'fx-takeover', 'emperor-robe', 'hover-throne', 'imperial-crown']);
    expect(vault.every((e) => e.price >= VAULT_FROM && inVault(e))).toBe(true);
    for (const e of vault.filter((x) => x.kind)) {
      const home = e.kind === 'ride' ? entries('ride') : entries('wear', e.kind);
      const sold = home.filter((x) => !x.reward);
      expect(sold.at(-1)!.id === e.id || sold.slice(sold.findIndex((x) => inVault(x))).every(inVault)).toBe(true);
    }
    // a reward is never in the collection, whatever it would cost
    expect(inVault({ price: 25_000_000_000_00, reward: true })).toBe(false);
  });

  it('name pieces the way a sentence says them', () => {
    expect(theName('Rope Chain')).toBe('the Rope Chain');
    expect(theName('The Griddy', true)).toBe('The Griddy');
    expect(theName('The Billionaire')).toBe('the Billionaire');
    expect(theName('Your Statue')).toBe('your statue');
    expect(theName('Your Statue', true)).toBe('Your statue');
  });

  it('find the row for any id it opens at', () => {
    expect(entryOf('segway')).toMatchObject({ section: 'ride', kind: 'ride' });
    expect(entryOf('gold-crown')).toMatchObject({ section: 'wear', kind: 'hat' });
    expect(entryOf('champion-jacket')).toMatchObject({ section: 'wear', reward: true });
    expect(entryOf('throwback')).toMatchObject({ section: 'emote', price: 150_000_00 });
    expect(entryOf('fx-disco')?.fx?.reach).toBe('room');
    expect(entryOf('statue')?.section).toBe('statue');
    expect(entryOf('wave')).toBeNull();
    expect(entryOf('nope')).toBeNull();
    for (const id of NEW_IDS) expect(entryOf(id)).not.toBeNull();
  });
});

describe('when an effect would start', () => {
  const ev = (fx: string, id: number, at: number, x = 0, z = 900): FxEvent => ({ fx, id, name: `p${id}`, at, until: at + effectItem(fx)!.secs * 1000, x, z });
  const now = 1_000_000;

  it('agrees with the floor about rooms', () => {
    for (const [x, z] of [[0, 9], [22, -8], [-20, -8], [12, 9], [0, -25], [-25, 9], [24, 9], [0, 15.1]]) expect(roomAt(x!, z!).id).toBe(floorRoomAt(x! * 100, z! * 100));
  });

  it('starts now in a free slot, after the last in a busy one, and never waits on another slot', () => {
    const disco = effectItem('fx-disco')!;
    const spot = effectItem('fx-spotlight')!;
    const marquee = effectItem('fx-marquee')!;
    const list = [ev('fx-disco', 2, now - 10_000, 2200, -800), ev('fx-spotlight', 1, now - 5_000), ev('fx-marquee', 3, now + 50_000, 0, 900)];
    // in the Bar, where a disco is on
    const bar = waitFor(list, disco, 1, 22, -8, now);
    expect(bar).toMatchObject({ at: list[0]!.until + FX_GAP_MS, room: 'bar' });
    expect(bar.behind).toBe(list[0]);
    // the Lounge is free
    expect(waitFor(list, disco, 1, 24, 9, now)).toMatchObject({ at: now, behind: null, room: 'lounge' });
    // your own spotlight holds up your next own effect, not someone else's
    expect(waitFor(list, spot, 1, 0, 9, now).at).toBe(list[1]!.until + FX_GAP_MS);
    expect(waitFor(list, spot, 5, 0, 9, now).at).toBe(now);
    // the casino's slot is one for everyone, wherever they stand
    expect(waitFor(list, marquee, 9, -25, -25, now).at).toBe(list[2]!.until + FX_GAP_MS);
    // an ended one holds nothing up
    expect(waitFor(list, disco, 1, 22, -8, now + 120_000).behind).toBeNull();
  });

  it('words times the way the shop says them', () => {
    expect(secsText(8)).toBe('8 s');
    expect(secsText(90)).toBe('90 s');
    expect(secsText(120)).toBe('2 min');
    expect(clockText(40_000)).toBe('0:40');
    expect(clockText(125_001)).toBe('2:06');
    expect(roomName('pit')).toBe('the Pit');
    expect(roomName('bar')).toBe('the Bar');
  });
});
