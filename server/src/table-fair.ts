// Fair play's side of a table (host.ts calls it): what this table sees of each player's play, on
// its way to D1 (fair.ts note()), and whether they may bet while a Quick check waits.
//
//   Reactions  A reaction is the time from the news that gave a player something to decide (a
//              card, a result, another player's move, a betting window opening) to their next
//              move. Their own chips going down don't count as news: the second chip of a burst
//              isn't a reaction to the first. Only games a person plays move by move count:
//              machines and online games have Auto, key-mashing and instant rounds, where a
//              person's rhythm is the button's.
//   Rounds     Each finished round's bet, as a signature (shared/src/fair.ts betSig).
//   Activity   A moment a minute at most, for the unbroken-hours signal.
//   Pause      A check that's due is asked when the player has nothing on the layout, from then
//              on (and whatever another table asked) no chip of theirs starts a new round here;
//              chips already out play out, and standing up and cashing out work as always.
//
// Memory only: a restart loses a few reactions, which only makes this looser.

import type { GameId, Step } from '../../shared/src/engine.ts';
import { CATALOG } from '../../shared/src/games/catalog.ts';
import type { CheckState } from '../../shared/src/protocol.ts';
import { betSig, type Batch } from '../../shared/src/fair.ts';
import { fairOf, note, pause } from './fair.ts';

/** A player's batch goes to D1 once it holds this many reactions or rounds. */
export const FLUSH_AT = 25;
/** A paused player's state is read again at most this often (a pass elsewhere may have cleared it). */
const RECHECK_MS = 10_000;
const ACTIVE_EVERY_MS = 60_000;

/** Games whose moves are a person's decisions, one at a time. */
export function timesReactions(game: GameId): boolean {
  const g = CATALOG[game];
  return g.multiplayer && !g.online && game !== 'bingo';
}

interface Player {
  cue: number | null;
  batch: Batch;
  lastAt: number;
  state: CheckState;
  readAt: number;
}

export interface FairDeps {
  db: () => D1Database;
  game: GameId;
  auto: boolean;
  /** Tell this player's sockets the check is waiting. */
  ask: (accountId: number) => void;
  waitUntil: (p: Promise<unknown>) => void;
}

export class TableFair {
  private readonly players = new Map<number, Player>();
  private readonly timing: boolean;

  constructor(private readonly deps: FairDeps) {
    this.timing = timesReactions(deps.game);
  }

  private of(accountId: number): Player {
    let p = this.players.get(accountId);
    if (!p) {
      p = { cue: null, batch: {}, lastAt: 0, state: 'ok', readAt: 0 };
      this.players.set(accountId, p);
    }
    return p;
  }

  /** A player sat down or came back: read where they stand, and ask if a check is waiting. */
  async load(accountId: number, now: number): Promise<void> {
    const p = this.of(accountId);
    p.state = (await fairOf(this.deps.db(), accountId)).state;
    p.readAt = now;
    if (p.state === 'paused') this.deps.ask(accountId);
  }

  /** Whether this player may not start a round here (nothing of theirs is out: `live` 0). */
  blocked(accountId: number, live: number, now: number): boolean {
    const p = this.of(accountId);
    if (p.state !== 'paused' || live > 0) return false;
    if (now - p.readAt >= RECHECK_MS) this.deps.waitUntil(this.load(accountId, now));
    return true;
  }

  /** Whether a check is due for this player, to be asked at their next pause. */
  due(accountId: number): boolean {
    return this.players.get(accountId)?.state === 'due';
  }

  /** Ask the due check now (the player is at a pause). */
  ask(accountId: number, now: number): void {
    const p = this.of(accountId);
    if (p.state !== 'due') return;
    p.state = 'paused';
    this.deps.ask(accountId);
    this.deps.waitUntil(pause(this.deps.db(), accountId, now).catch((err) => console.error('fair: pause failed', err)));
  }

  /** The check was passed (the Worker says so): play on. */
  cleared(accountId: number, now: number): void {
    const p = this.of(accountId);
    p.state = 'ok';
    p.readAt = now;
  }

  /** News reached these players: each one's next move is a reaction to it. */
  cue(accountIds: Iterable<number>, now: number): void {
    if (!this.timing) return;
    for (const id of accountIds) this.of(id).cue = now;
  }

  /**
   * A player's move was taken (call before the step's own cue). After it, the news is theirs too
   * unless all it did was put their chips down: `step` and `seat` say which.
   */
  acted(accountId: number, seat: number, step: Step<unknown>, now: number): void {
    const p = this.of(accountId);
    if (p.cue !== null) {
      (p.batch.rt ??= []).push(now - p.cue);
      p.cue = null;
    }
    this.active(p, now);
    const onlyChips = !step.rounds?.some((r) => r.seat === seat) && (step.chips ?? []).some((c) => c.seat === seat && (c.bet ?? 0) > 0);
    if (this.timing && !onlyChips) p.cue = now;
    this.maybeFlush(accountId, p, now);
  }

  /** A round finished for this player, with this much bet. */
  round(accountId: number, wagered: number, now: number): void {
    if (wagered <= 0) return;
    const p = this.of(accountId);
    (p.batch.bets ??= []).push(betSig(this.deps.game, wagered));
    this.maybeFlush(accountId, p, now);
  }

  /** Send what's waiting for this player (they're leaving, or the table is going to sleep). */
  flush(accountId: number, now: number): void {
    const p = this.players.get(accountId);
    if (!p) return;
    p.cue = null;
    this.send(accountId, p, now);
  }

  forget(accountId: number, now: number): void {
    this.flush(accountId, now);
    this.players.delete(accountId);
  }

  private active(p: Player, now: number): void {
    if (now - p.lastAt < ACTIVE_EVERY_MS) return;
    p.lastAt = now;
    (p.batch.at ??= []).push(now);
  }

  private maybeFlush(accountId: number, p: Player, now: number): void {
    if ((p.batch.rt?.length ?? 0) >= FLUSH_AT || (p.batch.bets?.length ?? 0) >= FLUSH_AT) this.send(accountId, p, now);
  }

  private send(accountId: number, p: Player, now: number): void {
    const batch = p.batch;
    if (!batch.rt?.length && !batch.bets?.length && !batch.at?.length) return;
    p.batch = {};
    this.deps.waitUntil(
      note(this.deps.db(), accountId, batch, now, this.deps.auto)
        .then((state) => {
          // A check due (or asked at another table): this table asks or holds at the next pause.
          // A pass is the Worker's news (host.ts fairRefresh).
          if (state !== 'ok' && p.state === 'ok') p.state = state;
        })
        .catch((err) => console.error('fair: note failed', err)),
    );
  }
}
