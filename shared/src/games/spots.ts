// Several hands at once for a solo player, at the tables that deal each player a hand of their own
// (blackjack, Three Card Poker, Casino War). A spot is a place a hand is played, numbered like the
// seats: spot s is where seat s would sit, so the table's layout, its dealing order and every
// event that names a `seat` work for spots unchanged. At a shared table each player plays their
// own seat's spot and nothing changes. A solo player can play spots 0 to n - 1 (their own and the
// places the next players would take), all from their one stack: the engine keeps a spot's bets
// and cards, and the seat that owns it is the one whose chips move.

import type { EngineCtx, RoundResult, TableConfig } from '../engine.ts';
import type { Cents } from '../money.ts';
import { isInt } from '../protocol.ts';

/** The spots a seat bets on: its own at a shared table; spots 0 to n - 1 at a solo table. */
export function spotsOf(cfg: TableConfig, count: Record<number, number>, seat: number): number[] {
  if (cfg.mode !== 'solo') return [seat];
  return Array.from({ length: count[seat] ?? 1 }, (_, i) => i);
}

/** Whether a spot's hand is this seat's: at a solo table every spot is its one player's. */
export function owns(cfg: TableConfig, seat: number, spot: number): boolean {
  return cfg.mode === 'solo' || spot === seat;
}

/** The seat whose stack a spot's chips come from and go back to. */
export function owner(ctx: EngineCtx, spot: number): number {
  return ctx.mode === 'solo' ? (ctx.seats[0]?.seat ?? spot) : spot;
}

/** A spot's finished hand for the stats: each spot is a round of its own. */
export function roundOf(ctx: EngineCtx, spot: number, wagered: Cents, returned: Cents): RoundResult {
  const seat = owner(ctx, spot);
  return spot === seat ? { seat, wagered, returned } : { seat, wagered, returned, spot };
}

/** An optional index in an action: absent is fine, anything but a whole number below `max` spoils it. */
export function optIndex(x: unknown, max: number): number | undefined | false {
  if (x === undefined) return undefined;
  return isInt(x) && x >= 0 && x < max ? x : false;
}

/** The count in a `spots` action, 1 to `max`, or null. */
export function spotCount(x: unknown, max: number): number | null {
  return isInt(x) && x >= 1 && x <= max ? x : null;
}
