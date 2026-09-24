// Canned accounts for the dev page (?fixture=1): a regular with a few weeks of play across every
// game, and the same player down to their last few thousand for the cashier. The API stand-in
// behaves like the real one, including the bank's 409 with the numbers.

import type { LoanResponse, Profile } from '../../../../shared/src/protocol.ts';
import type { GameStats } from '../../../../shared/src/protocol.ts';
import type { GameId } from '../../../../shared/src/engine.ts';
import { LOAN_AMOUNT } from '../../../../shared/src/money.ts';
import { notYet, refillFor } from '../../../../shared/src/bank.ts';
import type { Look } from '../../../../shared/src/look.ts';
import { ApiError } from '../../net/api.ts';
import type { AccountApi } from './deps.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

function withTotals(games: Partial<Record<GameId, GameStats>>): Profile['stats'] {
  const total: GameStats = { rounds: 0, wagered: 0, net: 0, biggestWin: 0 };
  for (const s of Object.values(games)) {
    total.rounds += s.rounds;
    total.wagered += s.wagered;
    total.net += s.net;
    total.biggestWin = Math.max(total.biggestWin, s.biggestWin);
  }
  return { total, games };
}

export function regular(now = Date.now()): Profile {
  return {
    id: 7,
    name: 'Ace_High',
    look: { v: 1, body: 'm', outfit: 'suit', skin: 3, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#111111' },
    createdAt: now - 39 * DAY,
    balance: 3_182_450,
    inPlay: 150_000,
    rev: 88,
    tables: [
      { tableId: 'bj-k3x9d0q2mz', game: 'blackjack', escrow: 100_000, stack: 132_500 },
      { tableId: 'solo:roulette:american:7', game: 'roulette', escrow: 50_000 },
    ],
    loansTaken: 2,
    loans: [
      { amount: 4_612_300, at: now - 3 * DAY - 5 * HOUR },
      { amount: LOAN_AMOUNT, at: now - 17 * DAY - 2 * HOUR },
    ],
    stats: withTotals({
      blackjack: { rounds: 412, wagered: 1_236_000, net: -18_450, biggestWin: 30_000 },
      roulette: { rounds: 188, wagered: 942_000, net: -51_300, biggestWin: 175_000 },
      craps: { rounds: 96, wagered: 518_000, net: 22_400, biggestWin: 60_000 },
      baccarat: { rounds: 140, wagered: 700_000, net: -9_750, biggestWin: 47_500 },
      slots: { rounds: 1_204, wagered: 602_000, net: -61_880, biggestWin: 250_000 },
      videopoker: { rounds: 530, wagered: 265_000, net: -1_225, biggestWin: 100_000 },
      threecard: { rounds: 61, wagered: 244_000, net: 13_500, biggestWin: 40_000 },
    }),
  };
}

/** The same player down to $3,250, nothing on any table: under the bank's line. */
export function broke(now = Date.now()): Profile {
  return { ...regular(now), balance: 325_000, inPlay: 0, tables: [], rev: 97 };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The canned player's password on the dev page. Any other name is new there and takes any. */
export const FIXTURE_PASSWORD = 'ace-high';

export function fixtureApi(start: Profile, opts: { lastName?: string | null; latency?: number } = {}): AccountApi {
  let p = structuredClone(start);
  const ms = opts.latency ?? 220;
  return {
    async login(name: string, password: string) {
      await wait(ms);
      if (name.toLowerCase() === start.name.toLowerCase() && password !== FIXTURE_PASSWORD) {
        throw new ApiError(401, { error: 'UNAUTHORIZED', msg: 'Wrong name or password.' });
      }
      p = { ...p, name };
      return structuredClone(p);
    },
    lastName: () => (opts.lastName === undefined ? start.name : opts.lastName),
    async me() {
      await wait(ms);
      return structuredClone(p);
    },
    async saveLook(look: Look) {
      await wait(ms);
      p = { ...p, look };
      return look;
    },
    async takeLoan(): Promise<LoanResponse> {
      await wait(ms * 2);
      const chips = p.tables.reduce((sum, t) => sum + (t.stack ?? t.escrow), 0);
      const amount = refillFor(p.balance + chips);
      if (amount === 0) {
        throw new ApiError(409, { error: 'NOT_ELIGIBLE', msg: notYet(p.balance + chips, chips), balance: p.balance, inPlay: p.inPlay });
      }
      const at = Date.now();
      p = { ...p, balance: p.balance + amount, loansTaken: p.loansTaken + 1, loans: [{ amount, at }, ...p.loans], rev: p.rev + 1 };
      return { profile: structuredClone(p), loan: { amount, at } };
    },
    forgetToken() {},
  };
}
