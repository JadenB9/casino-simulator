// v6 invite6: the invites' words and lists (ui/lobby/invite-model.ts): what a card says, who the
// picker offers first, the invites waiting on screen, and what's kept per browser.

import { describe, expect, it } from 'vitest';
import { Inbox, RecentPlayers, clock, doNotDisturb, inviteDetail, inviteSentence, limitsWord, rankCandidates, seatsLeft, sentSummary, setDoNotDisturb, tableName, type Candidate } from '../src/ui/lobby/invite-model.ts';
import type { Invite } from '../../shared/src/protocol.ts';
import { limitSpec } from '../../shared/src/limits.ts';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function inv(over: Partial<Invite> = {}): Invite {
  const high = limitSpec('blackjack')!.tiers.find((t) => t.name === 'High limit')!;
  return {
    id: 'abcdefghijkl',
    from: { id: 7, name: 'Sam' },
    tableId: 'bj-abcdefghij',
    game: 'blackjack',
    variant: '',
    private: false,
    all: false,
    lobby: { tableId: 'bj-abcdefghij', game: 'blackjack', variant: '', leader: 'Sam', players: 5, max: 7, started: false, limits: { min: high.min, max: high.max } },
    station: 'bj-1',
    at: 1000,
    until: 121_000,
    ...over,
  };
}

describe('what an invite card says', () => {
  it('names the table, its tier and the seats left', () => {
    expect(tableName('blackjack', '')).toBe('Blackjack');
    expect(tableName('roulette', 'american')).toBe('American Roulette');
    expect(limitsWord('blackjack', inv().lobby)).toBe('High limit');
    expect(seatsLeft({ players: 5, max: 7 })).toBe('2 seats left');
    expect(seatsLeft({ players: 6, max: 7 })).toBe('1 seat left');
    expect(seatsLeft({ players: 7, max: 7 })).toBe('Full');
    expect(inviteDetail(inv())).toBe('High limit · 2 seats left');
    expect(inviteSentence(inv())).toBe('Sam invited you to Blackjack (High limit, 2 seats left).');
  });

  it('says so when the table is private, running, open to everyone, or at custom limits', () => {
    const custom = inv({ private: true, all: true, lobby: { ...inv().lobby, started: true, limits: { min: 3000, max: 300_000 } } });
    expect(inviteDetail(custom)).toBe('$30–$3,000 · 2 seats left · Private · In play');
    expect(inviteSentence(custom)).toBe('Sam invited everyone to Blackjack ($30–$3,000, 2 seats left).');
    const none = inv({ lobby: { ...inv().lobby, limits: undefined } });
    expect(inviteDetail(none)).toBe('2 seats left');
  });

  it('counts down in minutes and seconds', () => {
    expect(clock(120_000)).toBe('2:00');
    expect(clock(61_001)).toBe('1:02');
    expect(clock(9_000)).toBe('0:09');
    expect(clock(-5)).toBe('0:00');
  });

  it("sums up what an invite did for the one who sent it", () => {
    expect(sentSummary({ all: false, sent: 2, skipped: [] }, ['Sam', 'Alex'])).toBe('Invited Sam and Alex.');
    expect(sentSummary({ all: false, sent: 1, skipped: [{ name: 'Jo', why: 'dnd' }] }, ['Sam'])).toBe("Invited Sam. Jo isn't taking invites.");
    expect(sentSummary({ all: false, sent: 0, skipped: [{ name: 'Jo', why: 'away' }, { name: 'Lee', why: 'recent' }] }, [])).toBe('Jo is away. Lee was just invited.');
    expect(sentSummary({ all: false, sent: 4, skipped: [] }, ['A', 'B', 'C', 'D'])).toBe('Invited A, B and 2 others.');
    expect(sentSummary({ all: true, sent: 12, skipped: [] }, [])).toBe('Invited everyone on the floor (12 players).');
    expect(sentSummary({ all: true, sent: 0, skipped: [] }, [])).toBe('Nobody else is on the floor to invite.');
  });
});

describe('who the picker offers', () => {
  const at = (id: number, name: string, xm: number, zm: number, station: string | null = null): Candidate => ({ id, name, x: xm * 100, z: zm * 100, station });
  const players = [at(1, 'Me', 0, 0), at(2, 'Zed', 1, 0), at(3, 'Amy', 20, 0), at(4, 'Bo', 5, 0), at(5, 'Cy', 150, 0), at(6, 'Dee', 2, 2)];

  it('puts people you played with first (newest first), then the nearest, and leaves out you and the table', () => {
    const ranked = rankCandidates(players, { x: 0, z: 0 }, [{ id: 3 }, { id: 5 }], new Set([1, 6]));
    expect(ranked.map((r) => r.name)).toEqual(['Amy', 'Cy', 'Zed', 'Bo']);
    expect(ranked[0]!.recent).toBe(true);
    // Cy is on the ground floor (x 150 m): known, but not a distance
    expect(ranked.find((r) => r.id === 5)).toMatchObject({ recent: true, away: 'ground', metres: null });
    expect(ranked.find((r) => r.id === 4)!.metres).toBeCloseTo(5);
  });

  it('puts the ones upstairs or downstairs after everyone on the floor', () => {
    const ranked = rankCandidates(players, { x: 0, z: 0 }, [], new Set([1]));
    expect(ranked.map((r) => r.name)).toEqual(['Zed', 'Dee', 'Bo', 'Amy', 'Cy']);
  });

  it('searches names, a name starting with the search first', () => {
    const list = [at(2, 'Bobby', 1, 0), at(3, 'Rob', 30, 0), at(4, 'Cara', 2, 0)];
    expect(rankCandidates(list, { x: 0, z: 0 }, [], new Set(), 'ob').map((r) => r.name)).toEqual(['Bobby', 'Rob']);
    expect(rankCandidates(list, { x: 0, z: 0 }, [], new Set(), 'ro').map((r) => r.name)).toEqual(['Rob']);
    expect(rankCandidates(list, { x: 0, z: 0 }, [], new Set(), 'B').map((r) => r.name)).toEqual(['Bobby', 'Rob']);
    expect(rankCandidates(list, { x: 0, z: 0 }, [], new Set(), '  ')).toHaveLength(3);
  });

  it('copes with players whose position and yours are not known yet', () => {
    const ranked = rankCandidates([{ id: 2, name: 'New', x: null, z: null, station: null }, at(3, 'Old', 4, 0)], null, [], new Set());
    expect(ranked.map((r) => [r.name, r.metres])).toEqual([['New', null], ['Old', null]]);
  });
});

describe('the invites on screen', () => {
  it('keeps the newest few, one per table, and drops the ones that ran out', () => {
    const box = new Inbox(3);
    box.add(inv({ id: 'a00000000000', tableId: 'bj-1111111111', until: 100 }));
    box.add(inv({ id: 'b00000000000', tableId: 'bj-2222222222', until: 200 }));
    box.add(inv({ id: 'c00000000000', tableId: 'bj-1111111111', until: 300 }));
    expect(box.items.map((x) => x.id)).toEqual(['c00000000000', 'b00000000000']);
    box.add(inv({ id: 'd00000000000', tableId: 'bj-3333333333', until: 400 }));
    box.add(inv({ id: 'e00000000000', tableId: 'bj-4444444444', until: 500 }));
    expect(box.items.map((x) => x.id)).toEqual(['e00000000000', 'd00000000000', 'c00000000000']);
    expect(box.expire(350)).toBe(true);
    expect(box.items.map((x) => x.id)).toEqual(['e00000000000', 'd00000000000']);
    expect(box.expire(350)).toBe(false);
    expect(box.remove('d00000000000')?.id).toBe('d00000000000');
    expect(box.remove('d00000000000')).toBeNull();
    box.dropTable('bj-4444444444');
    expect(box.items).toEqual([]);
  });
});

describe('kept per browser', () => {
  it('remembers do not disturb', () => {
    const s = memory();
    expect(doNotDisturb(s)).toBe(false);
    setDoNotDisturb(true, s);
    expect(doNotDisturb(s)).toBe(true);
    setDoNotDisturb(false, s);
    expect(doNotDisturb(s)).toBe(false);
    expect(doNotDisturb(null)).toBe(false);
  });

  it('remembers the people you met, newest first, each once, and survives junk', () => {
    const s = memory();
    const r = new RecentPlayers(s);
    r.note([{ id: 2, name: 'Sam' }, { id: 3, name: 'Alex' }], 10);
    r.note([{ id: 4, name: 'Jo' }, { id: 2, name: 'Sam' }], 20);
    expect(r.items.map((m) => m.id)).toEqual([4, 2, 3]);
    expect(new RecentPlayers(s).items.map((m) => [m.id, m.at])).toEqual([[4, 20], [2, 20], [3, 10]]);
    s.data.set('casino.invites.recent', '{"nope":1}');
    expect(new RecentPlayers(s).items).toEqual([]);
    s.data.set('casino.invites.recent', '[{"id":"x"},{"id":5,"name":"Ok","at":1}]');
    expect(new RecentPlayers(s).items).toEqual([{ id: 5, name: 'Ok', at: 1 }]);
    for (let i = 0; i < 40; i++) r.note([{ id: 100 + i, name: `P${i}` }]);
    expect(r.items.length).toBe(24);
  });
});
