// v7.1: the apartment tower. Every owner has a floor of their own (numbered in the order they
// bought, from floor 31 up), and anyone can ride up and visit it; only its owner changes what's
// in it. The floor keeps the tower in its own SQLite (it outlives every connection): each owner's
// name, step, the home pieces and guns they own (as the Worker read them from D1 at their last
// connect or purchase) and which piece stands in each slot.

import type { AptInfo } from '../../../shared/src/protocol.ts';
import { HOME_ITEMS, homeItem, type HomeSlot } from '../../../shared/src/estate.ts';
import { gunItem } from '../../../shared/src/arms.ts';

/** The first owner's floor; each later owner's is the next one up. */
export const FIRST_FLOOR = 31;

type Row = {
  account_id: number;
  name: string;
  tier: number;
  floor: number;
  items: string;
  picks: string;
};

export class Tower {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS apartments (account_id INTEGER PRIMARY KEY, name TEXT NOT NULL, tier INTEGER NOT NULL, floor INTEGER NOT NULL, items TEXT NOT NULL, picks TEXT NOT NULL)`);
  }

  /** An owner as they are now (connect, purchase): their floor kept, or the next one for a new owner. */
  upsert(o: { id: number; name: string; tier: number; items: readonly string[] }): void {
    if (o.tier <= 0) return;
    const items = JSON.stringify([...new Set(o.items)].filter((i) => homeItem(i) || gunItem(i)));
    const had = this.row(o.id);
    if (had) {
      this.sql.exec(`UPDATE apartments SET name = ?2, tier = ?3, items = ?4 WHERE account_id = ?1`, o.id, o.name, Math.max(had.tier, o.tier), items);
      return;
    }
    const top = this.sql.exec<{ f: number | null }>(`SELECT MAX(floor) AS f FROM apartments`).toArray()[0]?.f ?? FIRST_FLOOR - 1;
    this.sql.exec(`INSERT INTO apartments (account_id, name, tier, floor, items, picks) VALUES (?1, ?2, ?3, ?4, ?5, '{}')`, o.id, o.name, o.tier, top + 1, items);
  }

  /** More pieces or guns for an owner already in the tower (a purchase), or a higher step. */
  add(id: number, more: { items?: readonly string[]; tier?: number }): void {
    const r = this.row(id);
    if (!r) return;
    const items = [...new Set([...(JSON.parse(r.items) as string[]), ...(more.items ?? [])])].filter((i) => homeItem(i) || gunItem(i));
    this.sql.exec(`UPDATE apartments SET items = ?2, tier = ?3 WHERE account_id = ?1`, id, JSON.stringify(items), Math.max(r.tier, more.tier ?? 0));
  }

  has(id: number): boolean {
    return this.row(id) !== null;
  }

  /** One apartment as the clients draw it. */
  info(id: number): AptInfo | null {
    const r = this.row(id);
    return r ? { id: r.account_id, name: r.name, floor: r.floor, tier: r.tier, items: JSON.parse(r.items) as string[], picks: JSON.parse(r.picks) as Partial<Record<HomeSlot, string>> } : null;
  }

  /** Every apartment's owner and floor, top floor first, for the elevator's list. */
  list(): { id: number; name: string; floor: number }[] {
    return this.sql.exec<Row>(`SELECT account_id, name, floor FROM apartments ORDER BY floor DESC LIMIT 200`).toArray().map((r) => ({ id: r.account_id, name: r.name, floor: r.floor }));
  }

  /** The owner puts one of their pieces in a slot (or clears the pick: null). False when it isn't theirs or doesn't go there. */
  pick(id: number, slot: string, item: string | null): boolean {
    const r = this.row(id);
    if (!r) return false;
    if (!HOME_ITEMS.some((h) => h.slot === slot)) return false;
    const picks = JSON.parse(r.picks) as Record<string, string>;
    if (item === null) delete picks[slot];
    else {
      const h = homeItem(item);
      if (!h || h.slot !== slot || !(JSON.parse(r.items) as string[]).includes(item)) return false;
      picks[slot] = item;
    }
    this.sql.exec(`UPDATE apartments SET picks = ?2 WHERE account_id = ?1`, id, JSON.stringify(picks));
    return true;
  }

  private row(id: number): Row | null {
    return this.sql.exec<Row>(`SELECT * FROM apartments WHERE account_id = ?1`, id).toArray()[0] ?? null;
  }
}
