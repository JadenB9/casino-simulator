import { describe, it, expect } from 'vitest';
import type { Profile } from '../../shared/src/protocol.ts';
import { netStart, sessionNet } from '../src/ui/hud/net.ts';
import { applyMoney } from '../src/ui/shop/bar.ts';

// The HUD's session net is what was won or lost at play: the bank's top-ups aren't winnings, and
// what went on the boutique and the bar isn't a loss.

const D = 100;

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 1, name: 'ann', look: { v: 1, body: 'f', outfit: 'a', skin: 0, hair: '#000000', top: '#000000', bottom: '#000000', shoes: '#000000' },
    createdAt: 0, balance: 50_000 * D, inPlay: 0, rev: 1, tables: [], loansTaken: 0, loans: [],
    stats: { total: { rounds: 0, wagered: 0, net: 0, biggestWin: 0 }, games: {} },
    ...over,
  } as Profile;
}

describe('the HUD session net', () => {
  it('counts a table stack at its live value and chips elsewhere at what went in', () => {
    const start = netStart(profile(), 0);
    // bought in $1,000 here and it's grown to $1,250
    expect(sessionNet(profile({ balance: 49_000 * D, inPlay: 1_000 * D }), start, { stack: 1_250 * D, escrow: 1_000 * D }, 0)).toBe(250 * D);
  });

  it("leaves an achievement's cash out, and counts only what was earned since", () => {
    const start = netStart(profile({ feats: [{ feat: 'first-win', at: 1 }] }), 0);
    // won $100 at play; Long Odds paid $1,000 beside it
    const now = profile({ balance: 51_100 * D, feats: [{ feat: 'first-win', at: 1 }, { feat: 'dc-long', at: 2 }] });
    expect(sessionNet(now, start, null, 0)).toBe(100 * D);
  });

  it("leaves the bank's top-ups out", () => {
    const start = netStart(profile({ balance: 9_000 * D }), 0);
    const now = profile({ balance: 50_000 * D, loansTaken: 1, loans: [{ amount: 41_000 * D, at: 1 }] });
    expect(sessionNet(now, start, null, 0)).toBe(0);
  });

  it('leaves purchases out: a $250,000 chain is spending, not a loss at play', () => {
    const start = netStart(profile({ balance: 300_000 * D }), 0);
    expect(sessionNet(profile({ balance: 50_000 * D }), start, null, 250_000 * D)).toBe(0);
    // and what was spent before the HUD came up doesn't count either way
    const later = netStart(profile({ balance: 50_000 * D }), 250_000 * D);
    expect(sessionNet(profile({ balance: 49_991 * D }), later, null, 250_009 * D)).toBe(0);
  });

  it('v6 bank6: moving money into the bank is not a loss, and what the bank made is not a win', () => {
    const start = netStart(profile({ bank: { savings: 0, deposits: 0, fundCost: 0, fundValue: 0, gain: 0, worth: 50_000 * D } }), 0);
    // $20,000 to savings, $10,000 in a deposit, $5,000 in the fund (now worth $4,000)
    const moved = profile({ balance: 15_000 * D, bank: { savings: 20_000 * D, deposits: 10_000 * D, fundCost: 5_000 * D, fundValue: 4_000 * D, gain: 0, worth: 49_000 * D } });
    expect(sessionNet(moved, start, null, 0)).toBe(0);
    // $300 of interest paid and $1,000 from a friend: the bank's gain, not play
    const later = profile({ balance: 16_000 * D, bank: { savings: 20_300 * D, deposits: 10_000 * D, fundCost: 5_000 * D, fundValue: 4_000 * D, gain: 1_300 * D, worth: 50_300 * D } });
    expect(sessionNet(later, start, null, 0)).toBe(0);
    // then $500 won at a table
    expect(sessionNet({ ...later, balance: 16_500 * D }, start, null, 0)).toBe(500 * D);
  });

  it('a purchase answered by the server is counted as spending once, whatever its rev', () => {
    let spent = 0;
    const s = {
      profile: profile({ rev: 5 }) as Profile | null,
      set(p: Profile) {
        this.profile = p;
      },
      on: () => () => {},
      get spent() {
        return spent;
      },
      spend(a: number) {
        spent += a;
      },
    };
    applyMoney(s, { balance: 49_991 * D, inPlay: 0, rev: 6 }, 9 * D);
    expect(s.profile!.balance).toBe(49_991 * D);
    // an answer older than what the session holds changes no numbers, but the order was still paid
    applyMoney(s, { balance: 49_982 * D, inPlay: 0, rev: 4 }, 9 * D);
    expect(s.profile!.balance).toBe(49_991 * D);
    expect(spent).toBe(18 * D);
  });
});
