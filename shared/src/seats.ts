// Floor seats: who sits on which chair, stool, sofa place or bench (table seats are the tables'
// own business, not these). The floor object keeps the real book and arbitrates: first come, one
// seat per player, and the seat is free again when its sitter stands, walks away or leaves the
// floor (server/src/floor/presence.ts). Every client keeps the same book from what the floor
// tells it, to draw sitters on their seats and to offer only free ones.

/** A seat id: stable and short ("bar-stool-3", "lounge-1-sofa-2-b"). It travels and is stored as is. */
export const SEAT_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,39}$/;

export function isSeatId(x: unknown): x is string {
  return typeof x === 'string' && SEAT_ID_RE.test(x);
}

/**
 * How far from where the floor last saw a player (cm) a seat they claim may be: the reach of the
 * E prompt plus a stride of lag. Nobody sits down across the room.
 */
export const SEAT_REACH_CM = 250;

/** A sitter whose position goes further than this from their seat (cm) has stood up and walked off. */
export const SEAT_KEEP_CM = 60;

export type TakeResult = { ok: true; left: string | null } | { ok: false; holder: number };

/** Seat ids to the account sitting there, and back. */
export class SeatBook {
  private readonly bySeat = new Map<string, number>();
  private readonly byWho = new Map<number, string>();

  /** Who sits on `seat`, if anyone. */
  holder(seat: string): number | null {
    return this.bySeat.get(seat) ?? null;
  }

  /** The seat `who` sits on, if any. */
  seatOf(who: number): string | null {
    return this.byWho.get(who) ?? null;
  }

  /**
   * Sit `who` on `seat`. Refused while someone else sits there; moving to another seat gives up
   * the one they had (`left`). Sitting down again where you already sit changes nothing.
   */
  take(seat: string, who: number): TakeResult {
    const holder = this.bySeat.get(seat);
    if (holder !== undefined && holder !== who) return { ok: false, holder };
    const had = this.byWho.get(who) ?? null;
    if (had === seat) return { ok: true, left: null };
    if (had !== null) this.bySeat.delete(had);
    this.bySeat.set(seat, who);
    this.byWho.set(who, seat);
    return { ok: true, left: had };
  }

  /**
   * What the floor says: `who` sits on `seat` now (null: stands). A client's copy takes the
   * floor's word over its own, so whoever it had on that seat is moved off it.
   */
  set(who: number, seat: string | null): void {
    this.free(who);
    if (seat === null) return;
    const before = this.bySeat.get(seat);
    if (before !== undefined) this.byWho.delete(before);
    this.bySeat.set(seat, who);
    this.byWho.set(who, seat);
  }

  /** `who` stands up; the seat they had, or null. */
  free(who: number): string | null {
    const seat = this.byWho.get(who);
    if (seat === undefined) return null;
    this.byWho.delete(who);
    this.bySeat.delete(seat);
    return seat;
  }

  clear(): void {
    this.bySeat.clear();
    this.byWho.clear();
  }

  get size(): number {
    return this.bySeat.size;
  }

  /** Every taken seat and its sitter. */
  entries(): IterableIterator<[seat: string, who: number]> {
    return this.bySeat.entries();
  }
}
