// The law's side of a table (host.ts calls it as rounds finish): what to tell the floor.
//
//   At a jail table: every finished round's net, toward the inmate's bail.
//   Anywhere else: a player whose net winnings here over the last few minutes reach the table's
//   hot amount (rules.ts), or who just hit a big win (wins.ts), is reported, at most every
//   HOT_REPORT_GAP_MS. v7.2: only a player who is up, over those minutes and on this round: a big
//   win among bigger losses (a spot that paid beside the ones that lost, a hand after a run of
//   them) never is. Losing, however much, is never the pit boss's business. Whether the pit boss saw it is the floor's call; once he has caught it,
//   the floor says so and the streak starts again from nothing.
//
// The windows are memory only: a restart forgets a streak, which is the player's luck.

import type { RoundResult } from '../../shared/src/engine.ts';
import type { TableLimits } from '../../shared/src/limits.ts';
import { HOT_REPORT_GAP_MS, HOT_WINDOW_MS, hotAmount, isJailTable } from '../../shared/src/law/rules.ts';
import { isBigWin } from './floor/wins.ts';

export type LawNote = { kind: 'jail'; accountId: number; net: number } | { kind: 'hot'; accountId: number; name: string; amount: number };

export class TableLaw {
  private readonly jail: boolean;
  private readonly wins = new Map<number, { at: number; net: number }[]>();
  private readonly reported = new Map<number, number>();

  constructor(tableName: string) {
    this.jail = isJailTable(tableName);
  }

  /** The notes for the floor from a step's finished rounds. `who` names a seat's player (bots and empty seats: undefined). */
  rounds(rounds: readonly RoundResult[], who: (seat: number) => { accountId: number; name: string } | undefined, limits: TableLimits | null, now: number): LawNote[] {
    const notes: LawNote[] = [];
    const net = new Map<number, { name: string; wagered: number; returned: number; net: number }>();
    for (const r of rounds) {
      const w = who(r.seat);
      if (!w || !Number.isSafeInteger(r.wagered) || !Number.isSafeInteger(r.returned)) continue;
      // several spots of one player are one sum (a big win is the sum's, not one spot's)
      const n = net.get(w.accountId) ?? { name: w.name, wagered: 0, returned: 0, net: 0 };
      n.wagered += r.wagered;
      n.returned += r.returned;
      n.net += r.returned - r.wagered;
      net.set(w.accountId, n);
    }
    for (const [accountId, n] of net) {
      if (this.jail) {
        if (n.net !== 0) notes.push({ kind: 'jail', accountId, net: n.net });
        continue;
      }
      const list = (this.wins.get(accountId) ?? []).filter((w) => now - w.at < HOT_WINDOW_MS);
      list.push({ at: now, net: n.net });
      this.wins.set(accountId, list);
      const sum = list.reduce((a, w) => a + w.net, 0);
      // up on this round and over the window, or it's none of his business
      if (n.net <= 0 || sum <= 0) continue;
      if (!isBigWin(n.wagered, n.returned) && sum < hotAmount(limits)) continue;
      if (now - (this.reported.get(accountId) ?? -Infinity) < HOT_REPORT_GAP_MS) continue;
      this.reported.set(accountId, now);
      notes.push({ kind: 'hot', accountId, name: n.name, amount: Math.max(sum, n.net) });
    }
    return notes;
  }

  /** The pit boss caught this streak: it starts again. */
  caught(accountId: number): void {
    this.wins.delete(accountId);
  }

  forget(accountId: number): void {
    this.wins.delete(accountId);
    this.reported.delete(accountId);
  }
}
