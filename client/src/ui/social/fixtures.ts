// Canned boards for the dev page (?fixture=1), seen by the menu fixtures' player, Ace_High:
// 23rd richest (below the ten), on the rounds board (a tie at fifth), and no win yet.

import type { LeaderboardResponse } from '../../../../shared/src/protocol.ts';
import type { LeaderboardApi } from './leaderboard.ts';

const $ = (dollars: number) => Math.round(dollars * 100);

export function boards(age = 14_000): LeaderboardResponse {
  return {
    age,
    boards: {
      richest: {
        top: [
          { rank: 1, name: 'MarisolV', value: $(1_284_350) },
          { rank: 2, name: 'tkono', value: $(906_125) },
          { rank: 3, name: 'DoubleDown_Dee', value: $(740_000) },
          { rank: 4, name: 'Hollis', value: $(512_880) },
          { rank: 5, name: 'big_nick', value: $(498_300) },
          { rank: 6, name: 'vegas_jen', value: $(377_415) },
          { rank: 7, name: 'Rourke', value: $(301_050) },
          { rank: 8, name: 'snake_eyes', value: $(254_600) },
          { rank: 9, name: 'paigeturner', value: $(219_975) },
          { rank: 10, name: 'OldFaithful', value: $(203_110) },
        ],
        you: { rank: 23, name: 'Ace_High', value: $(118_420) },
      },
      biggestWin: {
        top: [
          { rank: 1, name: 'tkono', value: $(92_500) },
          { rank: 2, name: 'MarisolV', value: $(60_000) },
          { rank: 3, name: 'snake_eyes', value: $(48_000) },
          { rank: 4, name: 'Hollis', value: $(35_750) },
          { rank: 5, name: 'Rourke', value: $(30_000) },
          { rank: 5, name: 'vegas_jen', value: $(30_000) },
          { rank: 7, name: 'big_nick', value: $(22_400) },
          { rank: 8, name: 'lucky_lou', value: $(18_000) },
          { rank: 9, name: 'DoubleDown_Dee', value: $(15_625) },
          { rank: 10, name: 'OldFaithful', value: $(12_000) },
        ],
        you: { rank: null, name: 'Ace_High', value: 0 },
      },
      rounds: {
        top: [
          { rank: 1, name: 'OldFaithful', value: 14_902 },
          { rank: 2, name: 'Hollis', value: 9_871 },
          { rank: 3, name: 'paigeturner', value: 6_340 },
          { rank: 4, name: 'big_nick', value: 5_118 },
          { rank: 5, name: 'Ace_High', value: 4_775, you: true },
          { rank: 5, name: 'MarisolV', value: 4_775 },
          { rank: 7, name: 'tkono', value: 3_990 },
          { rank: 8, name: 'snake_eyes', value: 2_806 },
          { rank: 9, name: 'Rourke', value: 2_441 },
          { rank: 10, name: 'lucky_lou', value: 1_902 },
        ],
        you: null,
      },
    },
  };
}

/** The API stand-in: answers after `latency` ms, or fails with `fail` set. */
export function fixtureApi(opts: { latency?: number; fail?: boolean } = {}): LeaderboardApi {
  return {
    leaderboard: () =>
      new Promise((resolve, reject) =>
        setTimeout(() => (opts.fail ? reject(new TypeError('Failed to fetch')) : resolve(boards())), opts.latency ?? 250),
      ),
  };
}
