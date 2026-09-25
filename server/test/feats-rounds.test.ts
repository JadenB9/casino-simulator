// What a round does toward the feats (server/src/feats.ts roundFacts), game by game.
//
// Two kinds of evidence. Fixtures written against each game's own event types say exactly which
// rounds count and which near misses don't. Then the real engines are played (the load bots at the
// lobby games, simple players at the machines and the online games), and the common moments must
// turn up in what they actually send: a field read under the wrong name would never fire there.

import { describe, expect, it } from 'vitest';
import type { GameEngine, GameEvent, GameId, RoundResult, Step } from '../../shared/src/engine.ts';
import { isRefusal } from '../../shared/src/engine.ts';
import { engineFor } from '../../shared/src/games/index.ts';
import { CATALOG } from '../../shared/src/games/catalog.ts';
import { DAILY_COUNT, FEATS, FEAT_GAMES, casinoDay, dailyFeats, featOf, tallyValue } from '../../shared/src/feats.ts';
import { TableSim } from '../../shared/test/helpers/table-sim.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';
import { BUY_IN, ENGINE_READY, LOBBY_GAMES, botDoneBetting, botMove, type Rand } from '../../scripts/load/bots.ts';
import { addTally, challengesMet, roundFacts, type RoundFacts } from '../src/feats.ts';
import type { Hand } from '../../shared/src/games/blackjack/rules.ts';
import type { RouletteEvent } from '../../shared/src/games/roulette/protocol.ts';
import type { BaccaratEvent } from '../../shared/src/games/baccarat/protocol.ts';
import type { SlotsEvent } from '../../shared/src/games/slots/protocol.ts';
import type { ThreeCardEvent } from '../../shared/src/games/threecard/protocol.ts';
import type { HoldemEvent } from '../../shared/src/games/holdem/protocol.ts';
import type { WarEvent } from '../../shared/src/games/war/protocol.ts';
import type { BigSixEvent } from '../../shared/src/games/bigsix/protocol.ts';
import type { SicBoEvent } from '../../shared/src/games/sicbo/protocol.ts';
import type { BanditEvent } from '../../shared/src/games/banditwheel/protocol.ts';
import type { DropEvent } from '../../shared/src/games/plinko/engine.ts';
import type { RollEvent } from '../../shared/src/games/dice/engine.ts';
import type { LimboEvent } from '../../shared/src/games/limbo/engine.ts';
import type { KenoEvent } from '../../shared/src/games/keno/engine.ts';

const round = (wagered: number, returned: number, extra: Partial<RoundResult> = {}): RoundResult => ({ seat: 0, wagered, returned, ...extra });

/** The moments (feat ids, `first-win` aside) a round with these events earns. */
function moments(game: GameId, events: readonly object[], r: RoundResult = round(1_000, 2_000), variant = '', state: unknown = null): string[] {
  return roundFacts(game, variant, { events: events as GameEvent[], state }, r).moments.filter((m) => m !== 'first-win');
}

describe('the list', () => {
  it('ids are unique, every moment a detector names is on it, and rewards are real things', () => {
    const ids = FEATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FEATS) {
      expect(f.name.length).toBeGreaterThan(2);
      expect(f.about).toMatch(/\.$/);
      if (f.kind === 'challenge') {
        expect(f.tally).toBeTruthy();
        expect(f.goal).toBeGreaterThan(0);
      }
      const r = f.reward;
      expect(r.cash !== undefined || r.item !== undefined || r.emote !== undefined || r.title !== undefined).toBe(true);
      if (r.cash !== undefined) expect(Number.isSafeInteger(r.cash) && r.cash > 0).toBe(true);
    }
  });

  it('every game on the floor has something of its own, and a challenge for what it pays', () => {
    for (const g of FEAT_GAMES) {
      const mine = FEATS.filter((f) => f.game === g);
      expect(mine.some((f) => f.kind === 'achievement'), g).toBe(true);
      expect(mine.some((f) => f.kind === 'challenge' && f.tally === `won:${g}`), g).toBe(true);
    }
    // the test fixture game is nobody's
    expect(FEATS.some((f) => f.game === 'highcard')).toBe(false);
  });

  it("the contract's reward pieces and emotes each come from exactly one feat", () => {
    const by = (k: 'item' | 'emote', v: string) => FEATS.filter((f) => f.reward[k] === v).map((f) => f.id);
    expect(by('item', 'twentyone-pendant')).toEqual(['bj-naturals']);
    expect(by('item', 'royal-pendant')).toEqual(['vp-royal']);
    expect(by('item', 'horseshoe-pendant')).toEqual(['sl-jackpot']);
    expect(by('item', 'high-roller-shades')).toEqual(['round-1m']);
    expect(by('item', 'champion-jacket')).toEqual(['games-all']);
    expect(by('item', 'golden-board')).toEqual(['won-10m']);
    expect(by('emote', 'trophy')).toEqual(['won-1m']);
    expect(by('emote', 'moonwalk')).toEqual(['round-50k']);
  });

  it('titles are unique', () => {
    const titles = FEATS.flatMap((f) => (f.reward.title ? [f.reward.title] : []));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('tallies', () => {
  it('a winning round counts its profit, a losing one only that it was played', () => {
    expect(roundFacts('roulette', 'american', { events: [], state: null }, round(1_000, 3_600)).tally).toEqual({
      rounds: 1,
      won: 2_600,
      'won:roulette': 2_600,
      'wins:roulette': 1,
      best: 2_600,
    });
    expect(roundFacts('roulette', 'american', { events: [], state: null }, round(1_000, 0)).tally).toEqual({ rounds: 1 });
    // a push is no win
    expect(roundFacts('blackjack', '', { events: [], state: null }, round(1_000, 1_000)).tally).toEqual({ rounds: 1 });
  });

  it('first-win comes with any profit, at any game', () => {
    expect(roundFacts('dice', '', { events: [], state: null }, round(100, 101)).moments).toContain('first-win');
    expect(roundFacts('dice', '', { events: [], state: null }, round(100, 100)).moments).not.toContain('first-win');
  });

  it('nothing staked, the test game, or numbers that are not money count for nothing', () => {
    const none = { tally: {}, moments: [] } satisfies RoundFacts;
    expect(roundFacts('slots', 'sevens', { events: [], state: null }, round(0, 5_000))).toEqual(none);
    expect(roundFacts('highcard', '', { events: [], state: null }, round(1_000, 2_000))).toEqual(none);
    expect(roundFacts('dice', '', { events: [], state: null }, round(-5, 100))).toEqual(none);
    expect(roundFacts('dice', '', { events: [], state: null }, round(1.5, 100))).toEqual(none);
  });

  it('best keeps the largest; everything else adds', () => {
    const t = addTally({ best: 5_000, won: 5_000 }, { best: 2_000, won: 2_000 });
    expect(t).toEqual({ best: 5_000, won: 7_000 });
    expect(addTally(t, { best: 9_000 }).best).toBe(9_000);
  });

  it('challenges are met at their goal, not a cent before, and never twice', () => {
    expect(challengesMet({ won: 999_999 }, new Set())).toEqual([]);
    expect(challengesMet({ won: 1_000_000 }, new Set())).toEqual(['won-10k']);
    expect(challengesMet({ won: 1_000_000 }, new Set(['won-10k']))).toEqual([]);
    expect(challengesMet({ best: 5_000_000, rounds: 100 }, new Set())).toEqual(['round-10k', 'round-50k', 'rounds-100']);
    const all = challengesMet({ won: 100_000_000 * 100 }, new Set());
    expect(all).toEqual(['won-10k', 'won-100k', 'won-1m', 'won-10m', 'won-100m']);
  });

  it('games counts the games with a win, for five and for all of them', () => {
    const five = Object.fromEntries(FEAT_GAMES.slice(0, 5).map((g) => [`wins:${g}`, 1]));
    expect(tallyValue(five, 'games')).toBe(5);
    expect(challengesMet(five, new Set())).toEqual(['games-5']);
    // a win at the dev fixture is no game
    expect(tallyValue({ 'wins:highcard': 3 }, 'games')).toBe(0);
    const every = Object.fromEntries(FEAT_GAMES.map((g) => [`wins:${g}`, 1]));
    expect(challengesMet(every, new Set(['games-5']))).toEqual(['games-all']);
  });
});

describe('daily challenges', () => {
  it('three a day, the same for everyone, of three different kinds, found again by id', () => {
    for (const day of ['2026-09-25', '2026-09-26', '2027-01-01', '2026-02-29']) {
      const d = dailyFeats(day);
      expect(d).toHaveLength(DAILY_COUNT);
      expect(d.map((f) => f.id)).toEqual([0, 1, 2].map((i) => `daily:${day}:${i}`));
      const kinds = d.map((f) => f.tally!.replace(/^d:[^:]+:/, '').replace(/^wins:.*/, 'wins'));
      expect(new Set(kinds).size).toBe(3);
      for (const f of d) {
        expect(f.daily).toBe(day);
        expect(f.tally!.startsWith(`d:${day}:`)).toBe(true);
        expect(f.reward.cash! > 0 && f.reward.cash! <= 150_000).toBe(true);
        expect(featOf(f.id)).toEqual(f);
      }
      expect(dailyFeats(day)).toEqual(d);
    }
    // the days differ
    const week = Array.from({ length: 14 }, (_, i) => dailyFeats(casinoDay(Date.UTC(2026, 8, 1 + i, 20))).map((f) => f.name).join('|'));
    expect(new Set(week).size).toBeGreaterThan(5);
    expect(featOf('daily:2026-09-25:3')).toBeNull();
    expect(featOf('daily:nope:0')).toBeNull();
  });

  it("a round counts toward its day's tallies", () => {
    const f = roundFacts('dice', '', { events: [], state: null }, round(100, 250), '2026-09-25');
    expect(f.tally).toMatchObject({ 'd:2026-09-25:rounds': 1, 'd:2026-09-25:won': 150, 'd:2026-09-25:wins:dice': 1, 'd:2026-09-25:best': 150 });
    const lost = roundFacts('dice', '', { events: [], state: null }, round(100, 0), '2026-09-25');
    expect(lost.tally).toEqual({ rounds: 1, 'd:2026-09-25:rounds': 1 });
  });

  it("only the day's own are met, from the day's tallies", () => {
    const day = '2026-09-25';
    const tally: Record<string, number> = {};
    for (const f of dailyFeats(day)) {
      if (/:games$/.test(f.tally!)) for (const g of FEAT_GAMES.slice(0, f.goal!)) tally[`d:${day}:wins:${g}`] = 1;
      else tally[f.tally!] = f.goal!;
    }
    expect(tallyValue(tally, `d:${day}:games`)).toBeGreaterThanOrEqual(0);
    const met = challengesMet(tally, new Set(), day).filter((id) => id.startsWith('daily:'));
    expect(met.sort()).toEqual(dailyFeats(day).map((f) => f.id).sort());
    // the next day's aren't met by today's rows
    expect(challengesMet(tally, new Set(), '2026-09-26').filter((id) => id.startsWith('daily:'))).toEqual([]);
    expect(casinoDay(Date.UTC(2026, 8, 25, 6, 59))).toBe('2026-09-24');
    expect(casinoDay(Date.UTC(2026, 8, 25, 7, 1))).toBe('2026-09-25');
  });
});

describe('blackjack', () => {
  // The round's hands as the engine leaves them in BlackjackState.deal: a blackjack or a bust is
  // settled (and its result event sent) the moment it happens, steps before the round ends.
  const dealt = (hands: Partial<Hand>[], seat = 0) => ({ deal: { spots: [{ seat, base: 1_000, hands: hands.map((h) => ({ cards: [], bet: 1_000, doubled: false, split: false, splitAce: false, done: true, outcome: null, payout: 0, ...h })) }] } });
  const bj = (state: unknown, r = round(1_000, 2_000)) => roundFacts('blackjack', '', { events: [], state }, r);

  it('a blackjack, and even money taken on one, both count as a natural', () => {
    const f = bj(dealt([{ outcome: 'blackjack', payout: 2_500 }]), round(1_000, 2_500));
    expect(f.moments).toContain('bj-blackjack');
    expect(f.tally['bj:naturals']).toBe(1);
    expect(bj(dealt([{ outcome: 'evenmoney' }])).moments).toContain('bj-blackjack');
    // a 21 made by drawing is just a win
    expect(bj(dealt([{ outcome: 'win' }])).moments).not.toContain('bj-blackjack');
  });

  it("the round's own spot, not another seat's", () => {
    expect(bj(dealt([{ outcome: 'blackjack' }], 1)).moments).not.toContain('bj-blackjack');
    // a solo player's third spot: the round names it
    expect(bj(dealt([{ outcome: 'blackjack' }], 2), round(1_000, 2_500, { spot: 2 })).moments).toContain('bj-blackjack');
  });

  it('a split pays when every hand off it wins', () => {
    expect(bj(dealt([{ outcome: 'win', split: true }, { outcome: 'win', split: true }]), round(2_000, 4_000)).moments).toContain('bj-split');
    expect(bj(dealt([{ outcome: 'win', split: true }, { outcome: 'bust', split: true }]), round(2_000, 2_000)).moments).not.toContain('bj-split');
    expect(bj(dealt([{ outcome: 'win', split: true }, { outcome: 'push', split: true }]), round(2_000, 3_000)).moments).not.toContain('bj-split');
  });

  it('a doubled hand that won', () => {
    expect(bj(dealt([{ doubled: true, outcome: 'win', bet: 2_000 }]), round(2_000, 4_000)).moments).toContain('bj-double');
    expect(bj(dealt([{ doubled: true, outcome: 'lose', bet: 2_000 }]), round(2_000, 0)).moments).not.toContain('bj-double');
    expect(bj(dealt([{ doubled: false, outcome: 'win' }])).moments).not.toContain('bj-double');
  });

  it('no deal in the state, nothing read', () => {
    expect(bj(null).moments).toEqual(['first-win']);
  });
});

describe('the wheels and the dice', () => {
  const settle = (bets: [string, number, number][]) => ({ type: 'settle', round: 1, pocket: 17, seats: { 0: { wagered: 100, returned: 3_600, bets } } }) as RouletteEvent;

  it('roulette: a straight-up number, and 0 or 00 on its own', () => {
    expect(moments('roulette', [settle([['straight:17', 100, 3_600]])])).toEqual(['rl-straight']);
    expect(moments('roulette', [settle([['straight:0', 100, 3_600]])])).toEqual(['rl-straight', 'rl-zero']);
    expect(moments('roulette', [settle([['straight:37', 100, 3_600]])])).toEqual(['rl-straight', 'rl-zero']);
    // a split on 0-00, or a straight that lost, is neither
    expect(moments('roulette', [settle([['split:0-37', 100, 1_800], ['straight:5', 100, 0]])])).toEqual([]);
    // someone else's straight
    expect(moments('roulette', [{ ...settle([]), seats: { 3: { wagered: 100, returned: 3_600, bets: [['straight:17', 100, 3_600]] } } }])).toEqual([]);
  });

  it('big six: the $20, and the Star or the Crown', () => {
    const s = (key: string, back: number) => ({ type: 'settle', round: 1, stop: 0, symbol: 'star', seats: { 0: { wagered: 100, returned: back, bets: [[key, 100, back]] } } }) as unknown as BigSixEvent;
    expect(moments('bigsix', [s('twenty', 2_100)])).toEqual(['b6-twenty']);
    expect(moments('bigsix', [s('star', 4_100)])).toEqual(['b6-star']);
    expect(moments('bigsix', [s('crown', 4_100)])).toEqual(['b6-star']);
    expect(moments('bigsix', [s('ten', 1_100), s('star', 0)])).toEqual([]);
  });

  it('sic bo: a total of 4 or 17, a triple of either kind', () => {
    const s = (key: string, back: number) => ({ type: 'settle', round: 1, dice: [2, 2, 2], seats: { 0: { wagered: 100, returned: back, bets: [[key, 100, back]] } } }) as unknown as SicBoEvent;
    expect(moments('sicbo', [s('total:4', 6_100)])).toEqual(['sb-total']);
    expect(moments('sicbo', [s('total:17', 6_100)])).toEqual(['sb-total']);
    expect(moments('sicbo', [s('total:10', 700)])).toEqual([]);
    expect(moments('sicbo', [s('triple:2', 18_100)])).toEqual(['sb-triple']);
    expect(moments('sicbo', [s('anytriple', 3_100)])).toEqual(['sb-triple']);
    expect(moments('sicbo', [s('double:2', 1_100)])).toEqual([]);
  });

  it('the Bandit Wheel: its keys are numbers', () => {
    const s = (n: number, back: number) => ({ type: 'settle', round: 1, slot: 0, number: n, seats: { 0: { wagered: 100, returned: back, bets: [[n, 100, back]] } } }) as unknown as BanditEvent;
    expect(moments('banditwheel', [s(20, 2_100)])).toEqual(['bw-20']);
    expect(moments('banditwheel', [s(10, 1_100)])).toEqual(['bw-10']);
    expect(moments('banditwheel', [s(5, 600)])).toEqual([]);
    expect(moments('banditwheel', [s(20, 0)])).toEqual([]);
  });

  it('craps: the point made on the pass line, a hardway, aces or boxcars', () => {
    const res = (id: string, flat: string) => ({ type: 'result', seat: 0, id, flat, odds: null, win: 1_000, back: 2_000 });
    const made = { type: 'puck', point: null, made: 6 };
    expect(moments('craps', [res('pass', 'win'), made])).toEqual(['cr-point']);
    // a natural on the come-out wins the pass line too, but no point was made
    expect(moments('craps', [res('pass', 'win')])).toEqual([]);
    // the point was made, but this seat was on the don't
    expect(moments('craps', [res('dontpass', 'lose'), made])).toEqual([]);
    expect(moments('craps', [res('hard8', 'win')])).toEqual(['cr-hard']);
    expect(moments('craps', [res('hard8', 'lose')])).toEqual([]);
    expect(moments('craps', [res('boxcars', 'win')])).toEqual(['cr-long']);
    expect(moments('craps', [res('aces', 'win')])).toEqual(['cr-long']);
    expect(moments('craps', [{ ...res('hard4', 'win'), seat: 2 }])).toEqual([]);
  });
});

describe('the card tables', () => {
  it('baccarat: a natural nine on the side you backed, a tie, a pair', () => {
    const outcome = (winner: 'player' | 'banker' | 'tie', player: number, banker: number, natural: boolean) =>
      ({ type: 'outcome', winner, player, banker, natural, playerPair: false, bankerPair: false }) as BaccaratEvent;
    const result = (spots: Record<string, [number, 'win' | 'lose' | 'push', number]>) =>
      ({
        type: 'result',
        seat: 0,
        spots: Object.fromEntries(Object.entries(spots).map(([k, [bet, o, back]]) => [k, { bet, outcome: o, returned: back, commission: 0 }])),
        wagered: 1_000,
        returned: 2_000,
        commission: 0,
      }) as BaccaratEvent;
    expect(moments('baccarat', [outcome('player', 9, 7, true), result({ player: [1_000, 'win', 2_000] })])).toEqual(['bc-natural']);
    expect(moments('baccarat', [outcome('banker', 6, 9, true), result({ banker: [1_000, 'win', 1_950] })])).toEqual(['bc-natural']);
    // a natural eight, a nine drawn to, or a natural nine on the side you didn't back
    expect(moments('baccarat', [outcome('player', 8, 7, true), result({ player: [1_000, 'win', 2_000] })])).toEqual([]);
    expect(moments('baccarat', [outcome('player', 9, 7, false), result({ player: [1_000, 'win', 2_000] })])).toEqual([]);
    expect(moments('baccarat', [outcome('player', 9, 7, true), result({ banker: [1_000, 'lose', 0] })])).toEqual([]);
    expect(moments('baccarat', [outcome('tie', 6, 6, false), result({ tie: [100, 'win', 900] })])).toEqual(['bc-tie']);
    expect(moments('baccarat', [outcome('banker', 3, 5, false), result({ bankerPair: [100, 'win', 1_200] })])).toEqual(['bc-pair']);
    expect(moments('baccarat', [outcome('banker', 3, 5, false), result({ playerPair: [100, 'lose', 0] })])).toEqual([]);
  });

  it("three card poker: the hand turned over, trips and straight flushes, and never a hand that wasn't shown", () => {
    const show = (cards: string[]) => ({ type: 'show', seat: 0, cards }) as ThreeCardEvent;
    expect(moments('threecard', [show(['7s', '7h', '7d'])])).toEqual(['tc-trips']);
    expect(moments('threecard', [show(['9h', 'Th', 'Jh'])])).toEqual(['tc-straight-flush']);
    expect(moments('threecard', [show(['9h', 'Th', 'Jd'])])).toEqual([]);
    // the seat's own private hand event is not the show
    expect(moments('threecard', [{ type: 'hand', to: 0, seat: 0, cards: ['7s', '7h', '7d'] }])).toEqual([]);
    expect(moments('threecard', [{ ...show(['7s', '7h', '7d']), seat: 1 }])).toEqual([]);
  });

  it("hold'em: a pot, and the hand that won it when it was shown down", () => {
    const win = (seat: number, hand: string | null, best: string[] | null) =>
      ({ type: 'win', pot: 0, label: 'main pot', amount: 4_000, winners: [{ seat, amount: 4_000 }], hand, best }) as HoldemEvent;
    expect(moments('holdem', [win(0, null, null)])).toEqual(['he-pot']);
    expect(moments('holdem', [win(0, 'Full House, Kings full of Twos', ['Ks', 'Kh', 'Kd', '2s', '2c'])])).toEqual(['he-pot', 'he-boat']);
    expect(moments('holdem', [win(0, 'Four of a Kind, Nines', ['9s', '9h', '9d', '9c', 'As'])])).toEqual(['he-pot', 'he-boat', 'he-quads']);
    expect(moments('holdem', [win(0, 'Royal Flush', ['Ts', 'Js', 'Qs', 'Ks', 'As'])])).toEqual(['he-pot', 'he-boat', 'he-quads']);
    expect(moments('holdem', [win(0, 'Flush, Ace high', ['2s', '7s', '9s', 'Js', 'As'])])).toEqual(['he-pot']);
    // someone else's pot
    expect(moments('holdem', [win(4, 'Four of a Kind, Nines', ['9s', '9h', '9d', '9c', 'As'])])).toEqual([]);
  });

  it('casino war: a war won, the tie bet', () => {
    const res = (outcome: string, tie: number) => ({ type: 'result', seat: 0, result: { outcome, bet: 2_000, war: 2_000, tie, wagered: 2_000, returned: 4_000 } }) as WarEvent;
    expect(moments('war', [res('war-win', 0)])).toEqual(['wr-war']);
    expect(moments('war', [res('war-tie', 0)])).toEqual([]);
    expect(moments('war', [res('win', 0)])).toEqual([]);
    expect(moments('war', [res('war-win', 1_100)])).toEqual(['wr-war', 'wr-tie']);
  });

  it("video poker: the result's hand rank", () => {
    const res = (rank: number) => ({ type: 'result', seat: 0, rank, name: '', coins: 5, denom: 100, credits: 0, payout: 0 });
    expect(moments('videopoker', [res(9)])).toEqual(['vp-royal']);
    expect(moments('videopoker', [res(8)])).toEqual(['vp-straight-flush']);
    expect(moments('videopoker', [res(7)])).toEqual(['vp-quads']);
    expect(moments('videopoker', [res(6)])).toEqual([]);
  });
});

describe('the slot machines', () => {
  const reels = (over: Partial<Extract<SlotsEvent, { type: 'reels' }>>) =>
    ({ type: 'reels', stops: [0, 0, 0], spin: 0, freeLeft: 0, lines: [], hits: [], combo: null, wilds: 0, scatters: 0, scatterWin: 0, win: 0, trigger: false, multiplier: 1, ...over }) as SlotsEvent;

  it("each machine's top award: the head of the pay glass, or five of its best symbol on a line", () => {
    expect(moments('slots', [reels({ combo: 'three7' })], round(300, 300_000), 'sevens')).toContain('sl-jackpot');
    expect(moments('slots', [reels({ combo: 'three3B' })], round(300, 30_000), 'sevens')).not.toContain('sl-jackpot');
    expect(moments('slots', [reels({ combo: 'threeWX' })], round(300, 300_000), 'wild')).toContain('sl-jackpot');
    // three sevens is the top on Classic Sevens, not on 5x Wild
    expect(moments('slots', [reels({ combo: 'three7' })], round(300, 30_000), 'wild')).not.toContain('sl-jackpot');
    expect(moments('slots', [reels({ combo: 'threeDI' })], round(300, 300_000), 'diamonds')).toContain('sl-jackpot');
    const line = (symbol: string, count: number) => ({ line: 3, symbol, count, win: 1_000 });
    expect(moments('slots', [reels({ lines: [line('DIAMOND', 5)] })], round(100, 100_000), 'neon')).toContain('sl-jackpot');
    expect(moments('slots', [reels({ lines: [line('DIAMOND', 4)] })], round(100, 20_000), 'neon')).not.toContain('sl-jackpot');
    expect(moments('slots', [reels({ lines: [line('SEVEN', 5)] })], round(100, 100_000), 'cherries')).toContain('sl-jackpot');
    expect(moments('slots', [reels({ lines: [line('CART', 5)] })], round(100, 100_000), 'goldrush')).toContain('sl-jackpot');
    expect(moments('slots', [reels({ lines: [line('PICK', 5)] })], round(100, 50_000), 'goldrush')).not.toContain('sl-jackpot');
    // in a free game too
    expect(moments('slots', [reels({}), reels({ spin: 3, lines: [line('DIAMOND', 5)] })], round(100, 100_000), 'neon')).toContain('sl-jackpot');
  });

  it('a bonus: free games started, or the Cherry Wheel', () => {
    expect(moments('slots', [reels({ trigger: true })], round(100, 100), 'neon')).toEqual(['sl-bonus']);
    expect(moments('slots', [reels({ wheel: { segment: 3, prize: 15, mult: 1, win: 1_500 } })], round(100, 1_600), 'cherries')).toEqual(['sl-bonus']);
    expect(moments('slots', [reels({})], round(100, 0), 'neon')).toEqual([]);
  });

  it('a hundred times the bet on a spin', () => {
    expect(moments('slots', [reels({})], round(100, 10_000), 'neon')).toEqual(['sl-hundred']);
    expect(moments('slots', [reels({})], round(100, 9_999), 'neon')).toEqual([]);
  });
});

describe('the online games', () => {
  it('plinko: an end bin, and the top of the 16-row High board', () => {
    const drop = (rows: number, risk: string, bin: number) => ({ type: 'drop', seat: 0, bet: 100, rows, risk, bin, mult: 0, payout: 0, path: [], stack: 0 }) as unknown as DropEvent;
    expect(moments('plinko', [drop(8, 'low', 0)])).toEqual(['pk-edge']);
    expect(moments('plinko', [drop(8, 'low', 8)])).toEqual(['pk-edge']);
    expect(moments('plinko', [drop(8, 'low', 7)])).toEqual([]);
    expect(moments('plinko', [drop(16, 'high', 16)])).toEqual(['pk-edge', 'pk-top']);
    expect(moments('plinko', [drop(16, 'medium', 0)])).toEqual(['pk-edge']);
  });

  it('tower, mines and hi-lo end on an `over`', () => {
    expect(moments('tower', [{ type: 'over', round: 1, outcome: 'top', level: 9, mult: 0, payout: 0, bet: 0, tower: [] }])).toEqual(['tw-top']);
    expect(moments('tower', [{ type: 'over', round: 1, outcome: 'cashout', level: 8, mult: 0, payout: 0, bet: 0, tower: [] }])).toEqual([]);
    const mines = (outcome: string, gems: number) => ({ type: 'over', round: 1, outcome, gems, mult: 0, payout: 0, bet: 0, field: [], hit: null });
    expect(moments('mines', [mines('cleared', 24)])).toEqual(['mn-clear', 'mn-gems']);
    expect(moments('mines', [mines('cleared', 3)])).toEqual(['mn-clear']);
    expect(moments('mines', [mines('cashout', 10)])).toEqual(['mn-gems']);
    expect(moments('mines', [mines('bust', 12)], round(100, 0))).toEqual([]);
    const hilo = (outcome: string, guesses: number) => ({ type: 'over', round: 1, outcome, guesses, mult: 0, payout: 0, bet: 0 });
    expect(moments('hilo', [hilo('cashout', 8)])).toEqual(['hl-streak']);
    expect(moments('hilo', [hilo('cashout', 7)])).toEqual([]);
    expect(moments('hilo', [hilo('bust', 12)], round(100, 0))).toEqual([]);
  });

  it('dice, limbo and keno read their own result', () => {
    const roll = (chance: number, win: boolean) => ({ type: 'roll', seat: 0, round: 1, bet: 100, target: chance, over: false, chance, roll: 0, win, payout: 0, stack: 0 }) as RollEvent;
    expect(moments('dice', [roll(500, true)])).toEqual(['dc-long']);
    expect(moments('dice', [roll(501, true)])).toEqual([]);
    expect(moments('dice', [roll(100, false)], round(100, 0))).toEqual([]);
    const limbo = (target: number, win: boolean) => ({ type: 'result', seat: 0, round: 1, bet: 100, target, result: target, win, payout: 0, stack: 0 }) as LimboEvent;
    expect(moments('limbo', [limbo(1_000, true)])).toEqual(['lb-10x']);
    expect(moments('limbo', [limbo(10_000, true)])).toEqual(['lb-10x', 'lb-100x']);
    expect(moments('limbo', [limbo(999, true)])).toEqual([]);
    expect(moments('limbo', [limbo(50_000, false)], round(100, 0))).toEqual([]);
    const keno = (picks: number, hits: number) => ({ type: 'draw', seat: 0, round: 1, bet: 100, risk: 'classic', picks: Array.from({ length: picks }, (_, i) => i + 1), drawn: [], hits, mult: 0, payout: 0, stack: 0 }) as unknown as KenoEvent;
    expect(moments('keno', [keno(10, 6)])).toEqual(['kn-catch']);
    expect(moments('keno', [keno(5, 5)])).toEqual(['kn-sweep']);
    expect(moments('keno', [keno(4, 4)])).toEqual([]);
    expect(moments('keno', [keno(8, 7)])).toEqual(['kn-catch']);
  });

  it('crash: the multiplier cashed out at, for this seat', () => {
    const out = (seat: number, at: number) => ({ type: 'cashout', seat, name: 'x', at, amount: 100, payout: at, how: 'manual' });
    expect(moments('crash', [out(0, 1_000)])).toEqual(['cs-10x']);
    expect(moments('crash', [out(0, 25_000)])).toEqual(['cs-10x', 'cs-100x']);
    expect(moments('crash', [out(0, 999)])).toEqual([]);
    expect(moments('crash', [out(1, 25_000)])).toEqual([]);
  });

  it('the newest games: ten times the stake, until they have moments of their own', () => {
    for (const g of ['coinflip', 'wheel', 'cases', 'diamonds', 'letitride', 'paigow', 'bingo', 'pachinko'] as const) {
      const id = `${CATALOG[g].prefix}-10x`;
      expect(featOf(id)?.game).toBe(g);
      expect(moments(g, [], round(100, 1_000))).toEqual([id]);
      expect(moments(g, [], round(100, 999))).toEqual([]);
    }
  });

  it('junk in the events costs the moment, never the tallies', () => {
    const f = roundFacts('holdem', '', { events: [{ type: 'win', winners: [{ seat: 0, amount: 5 }], hand: 'x', best: ['zz', 'yy', 1, null, {}] }] as never, state: null }, round(100, 200));
    expect(f.tally.won).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------
// The real engines

type Engine = GameEngine<any, any, any>;

function rand32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every round-bearing step a TableSim applies, with what roundFacts makes of each round. */
class Recorder<S, A, V> extends TableSim<S, A, V> {
  seen = new Map<string, number>();
  tally: Record<string, number> = {};
  expectWon = 0;
  expectRounds = 0;
  constructor(
    readonly game: GameId,
    readonly variant: string,
    ...rest: ConstructorParameters<typeof TableSim<S, A, V>>
  ) {
    super(...rest);
  }
  override apply(step: Step<S>): void {
    super.apply(step);
    for (const r of step.rounds ?? []) {
      const f = roundFacts(this.game, this.variant, step as Step<unknown>, r);
      addTally(this.tally, f.tally);
      for (const m of f.moments) this.seen.set(m, (this.seen.get(m) ?? 0) + 1);
      if (r.wagered > 0) {
        this.expectRounds++;
        this.expectWon += Math.max(0, r.returned - r.wagered);
      }
    }
  }
}

/** The lobby games, played by the load bots at a four-seat table. */
function playLobby(game: GameId, seed: number, steps: number): Recorder<any, any, any> {
  const engine = engineFor(game) as Engine;
  const sim = new Recorder(game, '', engine, seededRng(seed), 'multi', Array.from({ length: 4 }, (_, seat) => ({ seat, stack: BUY_IN[game as keyof typeof BUY_IN] * 20 })));
  sim.started = true;
  for (const seat of sim.seats.keys()) sim.apply(engine.seatJoined(sim.state, seat, sim.ctx()));
  const rand = rand32(seed * 7 + 1);
  const act = (seat: number, raw: unknown) => {
    const a = engine.parseAction(raw);
    if (a === null) return;
    const res = engine.act(sim.state, seat, a, sim.ctx());
    if (!isRefusal(res)) sim.apply(res);
  };
  for (let i = 0; i < steps; i++) {
    for (const [seat, s] of sim.seats) {
      const move = botMove(game, sim.view(seat), { seat, stack: s.stack }, rand);
      if (move) act(seat, move);
      if (botDoneBetting(game, sim.view(seat), seat)) {
        if (ENGINE_READY.has(game)) act(seat, { type: 'ready', on: true });
        else s.ready = true;
      }
    }
    sim.now += 500 + Math.floor(rand() * 1_500);
    for (let k = 0; k < 50; k++) {
      const step = engine.tick(sim.state, sim.ctx());
      if (!step) break;
      sim.apply(step);
      if (step.rounds?.length) for (const s of sim.seats.values()) s.ready = false;
      const due = engine.deadline(sim.state);
      if (due === null || due > sim.now) break;
    }
  }
  return sim;
}

/** What the load bots turn up in a long session at each lobby game. */
const LOBBY_MOMENTS: Partial<Record<GameId, string[]>> = {
  blackjack: ['bj-blackjack', 'bj-double'],
  roulette: ['rl-straight'],
  craps: ['cr-point'],
  baccarat: ['bc-natural', 'bc-tie'],
  holdem: ['he-pot'],
  war: ['wr-war', 'wr-tie'],
  bigsix: ['b6-twenty', 'b6-star'],
  sicbo: [],
  crash: [],
  banditwheel: ['bw-10', 'bw-20'],
  threecard: [],
};

describe('the real engines send what the feats read', () => {
  for (const game of LOBBY_GAMES) {
    it(`${game}: tallies add up, and the usual moments turn up in play`, () => {
      const seen = new Set<string>();
      for (const seed of [3, 17]) {
        const sim = playLobby(game, seed, 1_500);
        expect(sim.expectRounds).toBeGreaterThan(20);
        expect(sim.tally.rounds ?? 0).toBe(sim.expectRounds);
        expect(sim.tally.won ?? 0).toBe(sim.expectWon);
        expect(sim.tally[`won:${game}`] ?? 0).toBe(sim.expectWon);
        for (const m of sim.seen.keys()) seen.add(m);
        // nothing from another game's list
        for (const m of sim.seen.keys()) {
          const g = featOf(m)?.game;
          expect(g === undefined || g === game, `${m} at ${game}`).toBe(true);
        }
      }
      for (const m of LOBBY_MOMENTS[game] ?? []) expect([...seen], `${game} never showed ${m}`).toContain(m);
    }, 120_000);
  }

  it('blackjack: a natural is counted once per blackjack paid', () => {
    const sim = playLobby('blackjack', 5, 1_500);
    expect(sim.tally['bj:naturals'] ?? 0).toBeGreaterThan(0);
    expect(sim.tally['bj:naturals']).toBeGreaterThanOrEqual(sim.seen.get('bj-blackjack') ?? 0);
  }, 120_000);

  /** A solo game played by repeating one action (and `after`, for games with a second step). */
  function playSolo(game: GameId, variant: string, action: unknown, n: number, seed = 1, after?: (sim: Recorder<any, any, any>) => void): Recorder<any, any, any> {
    const engine = engineFor(game) as Engine;
    const cfg = engine.config(variant, 'solo');
    const sim = new Recorder(game, variant, engine, seededRng(seed), 'solo', [{ seat: 0, stack: 1_000_000_000 }], cfg);
    sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
    for (let i = 0; i < n; i++) {
      sim.act(0, action);
      after?.(sim);
      sim.now += 5_000;
      sim.advance(0);
    }
    return sim;
  }

  it('plinko: end bins on the small board', () => {
    const sim = playSolo('plinko', '', { type: 'drop', bet: 100, rows: 8, risk: 'low' }, 1_500);
    expect(sim.seen.get('pk-edge') ?? 0).toBeGreaterThan(0);
    expect(sim.tally.rounds).toBe(1_500);
  });

  it('dice: long odds at a 4% chance', () => {
    const sim = playSolo('dice', '', { type: 'roll', bet: 100, target: 400, over: false }, 400);
    expect(sim.seen.get('dc-long') ?? 0).toBeGreaterThan(0);
    expect(sim.seen.get('dc-long')).toBe(sim.tally['wins:dice']);
  });

  it('limbo: a 10x target', () => {
    const sim = playSolo('limbo', '', { type: 'bet', bet: 100, target: 1_000 }, 400);
    expect(sim.seen.get('lb-10x') ?? 0).toBeGreaterThan(0);
    expect(sim.seen.get('lb-10x')).toBe(sim.tally['wins:limbo']);
    expect(sim.seen.has('lb-100x')).toBe(false);
  });

  it('keno: a big catch on ten picks', () => {
    const sim = playSolo('keno', '', { type: 'bet', bet: 100, picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], risk: 'classic' }, 3_000);
    expect(sim.seen.get('kn-catch') ?? 0).toBeGreaterThan(0);
  });

  it('slots: free games on Neon Nights, and every spin a round', () => {
    const sim = playSolo('slots', 'neon', { type: 'spin', coins: 1, denom: 5 }, 1_500);
    expect(sim.seen.get('sl-bonus') ?? 0).toBeGreaterThan(0);
    expect(sim.tally.rounds).toBe(1_500);
  });

  it('video poker: the rank the machine settles on (holding everything dealt)', () => {
    const sim = playSolo('videopoker', '', { type: 'deal', coins: 5 }, 6_000, 9, (s) => s.act(0, { type: 'draw', hold: [true, true, true, true, true] }));
    // a dealt four of a kind is about 1 in 4,165: with 6,000 hands, one seed that has one
    expect(sim.tally.rounds).toBe(6_000);
    expect([...sim.seen.keys()].every((m) => m === 'first-win' || m.startsWith('vp-'))).toBe(true);
  });
});
