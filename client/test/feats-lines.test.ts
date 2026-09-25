import { describe, it, expect } from 'vitest';
import { FEATS, featOf } from '../../shared/src/feats.ts';
import { dollars, earnedOn, featGroups, feedLines, isMoneyTally, progressOf, rewardParts, titleText, unlockKind, unlockSub } from '../src/ui/feats/lines.ts';

// How the achievements read: the sheet's groups and bars, the card when you earn one, the feed.
describe('the sheet', () => {
  it("lists today's challenges, then every feat once: the house, the tables, the machines and the online lounge", () => {
    const now = Date.UTC(2026, 8, 25, 18);
    const groups = featGroups(now);
    expect(groups[0]!.id).toBe('today');
    expect(groups[0]!.feats.map((f) => f.id)).toEqual(['daily:2026-09-25:0', 'daily:2026-09-25:1', 'daily:2026-09-25:2']);
    const listed = groups.slice(1).flatMap((g) => g.feats.map((f) => f.id));
    expect(listed.sort()).toEqual(FEATS.map((f) => f.id).sort());
    expect(groups[1]!.id).toBe('house');
    const parts = groups.map((g) => g.part);
    // each part in one run, in the building's order
    expect([...new Set(parts)]).toEqual(['The house', 'Tables', 'Machines', 'Online']);
    expect(groups.find((g) => g.id === 'videopoker')!.part).toBe('Machines');
    expect(groups.find((g) => g.id === 'crash')!.part).toBe('Online');
    expect(groups.find((g) => g.id === 'banditwheel')!.part).toBe('Tables');
    // nothing for the test game
    expect(groups.some((g) => g.id === 'highcard')).toBe(false);
  });

  it('names rewards the way the boutique does, cash first', () => {
    expect(rewardParts(featOf('vp-royal')!)).toEqual([
      { kind: 'cash', text: '$50,000' },
      { kind: 'item', text: 'Royal Flush Pendant' },
      { kind: 'title', text: 'Title: Royal' },
    ]);
    expect(rewardParts(featOf('won-1m')!)).toEqual([
      { kind: 'emote', text: 'Trophy emote' },
      { kind: 'title', text: 'Title: Millionaire' },
    ]);
    // every reward on the list reads as words, never an id
    for (const f of FEATS) for (const p of rewardParts(f)) expect(p.text).not.toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
  });

  it('shows a challenge as dollars or a count, and never past its goal', () => {
    expect(progressOf(featOf('won-1m')!, { won: 41_236_050 })).toEqual({ k: 0.4123605, text: '$412,360 of $1,000,000' });
    expect(progressOf(featOf('rounds-1000')!, { rounds: 2_571 })).toEqual({ k: 1, text: '1,000 of 1,000' });
    expect(progressOf(featOf('games-5')!, { 'wins:dice': 2, 'wins:keno': 1 })).toEqual({ k: 0.4, text: '2 of 5' });
    expect(progressOf(featOf('bj-naturals')!, {})).toEqual({ k: 0, text: '0 of 21' });
    expect(progressOf(featOf('vp-royal')!, {})).toBeNull();
    expect(isMoneyTally('won:roulette')).toBe(true);
    expect(isMoneyTally('wins:roulette')).toBe(false);
    expect(isMoneyTally('d:2026-09-25:won')).toBe(true);
    expect(isMoneyTally('d:2026-09-25:rounds')).toBe(false);
  });

  it('dates what was earned, with the year only when it is not this one', () => {
    const now = Date.UTC(2026, 8, 25, 12);
    expect(earnedOn(Date.UTC(2026, 7, 26, 12), now)).toBe('Aug 26');
    expect(earnedOn(Date.UTC(2025, 11, 31, 12), now)).toBe('Dec 31, 2025');
  });
});

describe('the card and the feed', () => {
  it('the card says where and what came with it', () => {
    expect(unlockSub(featOf('vp-royal')!)).toBe('Video Poker · +$50,000 · Royal Flush Pendant · Title: Royal');
    expect(unlockSub(featOf('round-50k')!)).toBe('Moonwalk emote');
    expect(unlockSub(featOf('won-blackjack')!)).toBe('Blackjack · +$2,500');
  });

  it("the feed names someone's feat and where it was earned", () => {
    expect(feedLines('Ace_High', 'bj-blackjack')).toEqual({ name: 'Ace_High', what: 'Twenty-One', sub: 'Blackjack' });
    expect(feedLines('Ace_High', 'won-1m')).toEqual({ name: 'Ace_High', what: 'Millionaire', sub: 'Challenge' });
    expect(feedLines('Ace_High', 'first-win')).toEqual({ name: 'Ace_High', what: "Beginner's Luck", sub: 'Achievement' });
    expect(feedLines('Ace_High', 'nope')).toBeNull();
    expect(feedLines('Ace_High', 'daily:2026-09-25:0')?.sub).toBe('Daily challenge');
    expect(unlockKind(featOf('daily:2026-09-25:1')!)).toBe('Daily challenge');
    expect(unlockKind(featOf('won-1m')!)).toBe('Challenge complete');
  });

  it('a title is a feat id on the look; anything else shows nothing', () => {
    expect(titleText('round-1m')).toBe('High Roller');
    expect(titleText('bj-blackjack')).toBeNull();
    expect(titleText(undefined)).toBeNull();
    expect(dollars(123_456)).toBe('$1,234');
  });
});
