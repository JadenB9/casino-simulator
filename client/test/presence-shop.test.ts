// v6 floor messages on FloorLink: effects (the list after hello, new ones merged in once, gone
// when they end), the lobby's statues, feats for the feed and emotes you now own.

import { describe, it, expect, beforeAll } from 'vitest';
import type { FloorLink as FloorLinkT, FloorTransport } from '../src/net/presence.ts';
import { DEFAULT_LOOK } from '../../shared/src/look.ts';

(globalThis as Record<string, unknown>).__API_ORIGIN__ = '';
let mod: typeof import('../src/net/presence.ts');
beforeAll(async () => {
  mod = await import('../src/net/presence.ts');
});

function rig() {
  let feed: (m: unknown) => void = () => {};
  const link: FloorLinkT = new mod.FloorLink({
    open: (onMessage): FloorTransport => {
      feed = onMessage;
      return { send: () => true, close: () => {} };
    },
  });
  return { link, recv: (m: unknown) => feed(m) };
}

const ev = (fx: string, at: number, secs: number, id = 2) => ({ fx, id, name: `p${id}`, at, until: at + secs * 1000, x: 0, z: 900 });

describe('FloorLink v6 messages', () => {
  it('keeps the effects playing or queued, once each, soonest first, and drops the ended', () => {
    const { link, recv } = rig();
    const heard: unknown[] = [];
    link.on('fx', (e) => heard.push(e));
    const disco = ev('fx-disco', 1_000, 60);
    const spot = ev('fx-spotlight', 500, 90, 3);
    recv({ t: 'fxs', list: [disco, spot] });
    expect(link.effects(0)).toEqual([spot, disco]);
    const queued = ev('fx-round', 62_000, 60);
    recv({ t: 'fx', ...queued });
    recv({ t: 'fx', ...queued });
    expect(heard).toEqual([queued, queued]);
    expect(link.effects(0)).toEqual([spot, disco, queued]);
    expect(link.effects(70_000)).toEqual([spot, queued]);
    expect(link.effects(200_000)).toEqual([]);
    // a reconnect's list replaces what we had
    recv({ t: 'fxs', list: [] });
    expect(link.effects(0)).toEqual([]);
  });

  it('passes on statues, feats and owned emotes', () => {
    const { link, recv } = rig();
    const got: unknown[] = [];
    link.on('statues', (l) => got.push(['statues', l]));
    link.on('feat', (id, name, feat) => got.push(['feat', id, name, feat]));
    link.on('owned', (e) => got.push(['owned', e]));
    const list = [{ name: 'Ace', look: DEFAULT_LOOK, at: 5 }];
    recv({ t: 'statues', list });
    recv({ t: 'feat', id: 4, name: 'Ace', feat: 'won-1m' });
    recv({ t: 'owned', emotes: ['throwback'] });
    expect(got).toEqual([['statues', list], ['feat', 4, 'Ace', 'won-1m'], ['owned', ['throwback']]]);
    expect(link.statues).toEqual(list);
  });
});
