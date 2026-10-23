// A longer memory of a table's results than the server's last twenty, for the hot and cold
// numbers and the tallies under each history strip (roulette's here; Sic Bo, Big Six and the
// Bandit Wheel use it too). The server's own list is the truth: every snapshot and every result
// is merged into the log by lining the two up where they overlap, and a log that doesn't line up
// (the table started over, or too much happened while away to tell) starts again from the
// server's list, so it never claims spins that weren't. A solo table's log is kept in this
// browser between visits; a lobby's lasts while you sit at it. Storage can be blocked: then the
// log just lasts the visit.

/** The most results a log keeps. */
export const LOG_CAP = 200;
/**
 * How many results must line up before an older log is trusted to continue from the server's
 * (four roulette numbers in a row by chance is about one in two million).
 */
export const MIN_OVERLAP = 4;

/**
 * `had` (newest first) brought up to date by `latest` (newest first, the server's last few):
 * the new results in front of the log, wherever `latest` continues it. `same` compares results.
 */
export function mergeLog<T>(had: readonly T[], latest: readonly T[], same: (a: T, b: T) => boolean = (a, b) => a === b, cap = LOG_CAP): T[] {
  if (had.length === 0) return latest.slice(0, cap);
  if (latest.length === 0) return had.slice(0, cap);
  // the fewest new results (k) after which the rest of `latest` is the front of `had`
  for (let k = 0; k < latest.length; k++) {
    const overlap = Math.min(latest.length - k, had.length);
    if (overlap < Math.min(MIN_OVERLAP, had.length, latest.length)) break;
    let ok = true;
    for (let i = 0; i < overlap && ok; i++) ok = same(latest[k + i]!, had[i]!);
    if (ok) return [...latest.slice(0, k), ...had].slice(0, cap);
  }
  return latest.slice(0, cap);
}

/** A table's log, merged from its views and results, kept under `storeKey` when there is one. */
export class SpinLog<T> {
  private list: T[] = [];

  constructor(
    private readonly storeKey: string | null,
    private readonly valid: (x: unknown) => x is T,
    private readonly same: (a: T, b: T) => boolean = (a, b) => a === b,
  ) {
    if (!storeKey) return;
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) ?? '[]') as unknown;
      if (Array.isArray(raw) && raw.every((x) => valid(x))) this.list = raw.slice(0, LOG_CAP);
    } catch {
      // blocked or corrupt: start empty
    }
  }

  /** Newest first. */
  get results(): readonly T[] {
    return this.list;
  }

  /** Bring the log up to date with the server's latest list (newest first). */
  merge(latest: readonly T[]): readonly T[] {
    const next = mergeLog(this.list, latest.filter((x) => this.valid(x)), this.same);
    if (next.length !== this.list.length || next.some((x, i) => !this.same(x, this.list[i]!))) {
      this.list = next;
      this.save();
    }
    return this.list;
  }

  private save(): void {
    if (!this.storeKey) return;
    try {
      localStorage.setItem(this.storeKey, JSON.stringify(this.list));
    } catch {
      // kept for this visit only
    }
  }
}

/** Where a table's log is kept: solo tables only (a lobby's id is new every time). */
export function logKey(game: string, tableId: string, mode: 'solo' | 'multi', variant = ''): string | null {
  return mode === 'solo' ? `casino.log.${game}${variant ? `.${variant}` : ''}.${tableId}` : null;
}
