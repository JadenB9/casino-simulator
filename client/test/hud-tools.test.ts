import { describe, it, expect } from 'vitest';
import { byPlace, splitKey, type HudTool } from '../src/ui/hud/tools.ts';
import { bestScore, fuzzy } from '../src/ui/hud/fuzzy.ts';
import { rank, type Command } from '../src/ui/hud/palette.ts';
import { ago, clearHistory, history, HISTORY_MAX, onHistory, remember } from '../src/ui/feed/history.ts';

// The HUD's tool list (ui/hud/tools.ts), the palette's matcher and ranking (fuzzy.ts, palette.ts)
// and the notes' history (ui/feed/history.ts): the pure parts, without a page.

describe("a title's key", () => {
  it('is the short parenthesis at the end, as a keycap', () => {
    expect(splitKey('Mute (N)')).toEqual({ text: 'Mute', key: 'N' });
    expect(splitKey('Map of the casino (M)')).toEqual({ text: 'Map of the casino', key: 'M' });
    expect(splitKey('Keyboard shortcuts (?)')).toEqual({ text: 'Keyboard shortcuts', key: '?' });
    expect(splitKey('$5 chip (1)')).toEqual({ text: '$5 chip', key: '1' });
    expect(splitKey('Tip twice the minimum (⇧ K)')).toEqual({ text: 'Tip twice the minimum', key: '⇧ K' });
    expect(splitKey('Max: the most this bet takes, or all your chips if that is less (A)').key).toBe('A');
  });

  it('is nothing when the parenthesis is part of the sentence', () => {
    expect(splitKey('Daily bonus: $2,500 waiting')).toEqual({ text: 'Daily bonus: $2,500 waiting', key: null });
    expect(splitKey('Leave the table (in three rounds)').key).toBeNull();
    expect(splitKey('Settings').key).toBeNull();
  });
});

describe('the order of the tools', () => {
  const t = (id: string, group: HudTool['group'], order?: number): Pick<HudTool, 'group' | 'order' | 'label'> => ({ label: id, group, order });

  it('goes by group (play, shop, social, system), then each one’s order, then its name', () => {
    const list = [t('Settings', 'system', 30), t('Boutique', 'shop', 10), t('Map', 'play', 10), t('Sound', 'system', 10), t('Emotes', 'play', 20), t('Zeta', 'play'), t('Alpha', 'play')];
    expect(list.sort(byPlace).map((x) => x.label)).toEqual(['Map', 'Emotes', 'Alpha', 'Zeta', 'Boutique', 'Sound', 'Settings']);
  });
});

describe('the palette’s matcher', () => {
  it('finds every typed letter in order, and nothing that lacks one', () => {
    expect(fuzzy('bjk', 'Classic Blackjack')).not.toBeNull();
    expect(fuzzy('kjb', 'Blackjack')).toBeNull();
    expect(fuzzy('', 'anything')).toBe(0);
  });

  it('puts a name holding the query as it stands first, at its start first of all', () => {
    const start = fuzzy('roul', 'Roulette')!;
    const word = fuzzy('roul', 'European Roulette')!;
    const scattered = fuzzy('roul', 'Room for us all')!;
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(scattered);
  });

  it('takes the words of a query in any order', () => {
    expect(fuzzy('volume sound', 'Settings: Sound volume')).toBeGreaterThan(100);
  });

  it('counts a name over its other words', () => {
    expect(bestScore('bar', 'Bar', 'drinks')!).toBeGreaterThan(bestScore('drinks', 'Bar', 'drinks')!);
    expect(bestScore('zzz', 'Bar', 'drinks')).toBeNull();
  });
});

describe('the palette’s list', () => {
  const cmd = (id: string, label: string, group: string, keywords = ''): Command => ({ id, label, group, keywords, run: () => {} });
  const all = [cmd('tool:map', 'Map', 'Action', 'rooms floor'), cmd('tool:bar', 'Bar', 'Action', 'drinks'), cmd('room:pit', 'The Pit', 'Room', 'blackjack roulette'), cmd('game:bj', 'Classic Blackjack', 'Game', 'blackjack'), cmd('settings:sound', 'Settings: Sound', 'Setting', 'volume mute')];

  it('with nothing typed: what was run last, then every action', () => {
    const r = rank(all, '', ['game:bj']);
    expect(r.map((x) => x.cmd.id)).toEqual(['game:bj', 'tool:map', 'tool:bar']);
    expect(r.map((x) => x.head)).toEqual(['Recent', 'Actions', null]);
  });

  it('typed: the best matches, a game by its name before the room it is in', () => {
    const r = rank(all, 'blackjack');
    expect(r[0]!.cmd.id).toBe('game:bj');
    expect(r.map((x) => x.cmd.id)).toContain('room:pit');
    expect(rank(all, 'volume')[0]!.cmd.id).toBe('settings:sound');
    expect(rank(all, 'qqqq')).toEqual([]);
  });
});

describe('the notes’ history', () => {
  it('keeps the newest first, one copy of a line said twice at once, and no more than it holds', () => {
    clearHistory();
    let heard = 0;
    const off = onHistory(() => heard++);
    remember({ kind: 'info', text: 'One', at: 1_000 });
    remember({ kind: 'err', text: 'Two', at: 2_000 });
    remember({ kind: 'err', text: 'Two', at: 3_000 });
    expect(history().map((n) => [n.text, n.at])).toEqual([
      ['Two', 3_000],
      ['One', 1_000],
    ]);
    for (let i = 0; i < HISTORY_MAX + 5; i++) remember({ kind: 'info', text: `n${i}`, at: 10_000 + i * 10_000 });
    expect(history()).toHaveLength(HISTORY_MAX);
    expect(history()[0]!.text).toBe(`n${HISTORY_MAX + 4}`);
    remember({ kind: 'info', text: '   ' });
    expect(history()[0]!.text).toBe(`n${HISTORY_MAX + 4}`);
    off();
    expect(heard).toBe(3 + HISTORY_MAX + 5);
    clearHistory();
    expect(history()).toHaveLength(0);
  });

  it('says how long ago in a few words', () => {
    expect(ago(0, 20_000)).toBe('just now');
    expect(ago(0, 5 * 60_000)).toBe('5 min ago');
    expect(ago(0, 3 * 3_600_000 + 60_000)).toBe('3 h ago');
  });
});
