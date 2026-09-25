// What the table has seen each player do: the numbers a regular keeps on everyone they play with
// (how often they put money in before the flop, how often they raise it, how often they bet and
// raise after the flop rather than call, and how often they fold to a bet). Built only from the
// public actions of hands the bots were dealt into, never from cards nobody showed.
//
// A read starts at the population's averages and moves toward what the player actually does as
// hands go by, so one hand says little and fifty say a lot. Old hands fade (the counts are halved
// past a cap), so a player who changes gear is read again.

export type ActKind = 'f' | 'x' | 'c' | 'b' | 'r';

/** One public action in the current hand. */
export interface Act {
  seat: number;
  street: 0 | 1 | 2 | 3;
  kind: ActKind;
  /** The seat's street total after the action. */
  to: number;
  /** A bet or raise: how much it added over the bet it faced, as a share of the pot before it. */
  size: number;
  /** An all-in. */
  allIn: boolean;
}

export interface Read {
  /** Hands dealt. */
  n: number;
  /** Hands where they put money in before the flop by choice (a blind alone doesn't count). */
  vpip: number;
  /** Hands where they raised before the flop. */
  pfr: number;
  /** Bets and raises after the flop. */
  agg: number;
  /** Calls after the flop. */
  pas: number;
  /** Times they faced a bet after the flop, and folded to it. */
  faced: number;
  folded: number;
}

export type Reads = Record<string, Read>;

/** A player as the population plays, before any hands are seen. */
export const PRIOR = { vpip: 0.3, pfr: 0.17, agg: 0.45, fold: 0.45 } as const;

/** Hands before the counts are halved. */
const CAP = 160;
/** Names kept at most (the table's seats and a few who left). */
const KEEP = 14;

export interface Tendency {
  vpip: number;
  pfr: number;
  /** Bets and raises as a share of their bets, raises and calls after the flop. */
  agg: number;
  /** How often they fold facing a bet after the flop. */
  fold: number;
  /** Hands seen. */
  n: number;
}

/** A read shrunk toward the population: the fewer hands, the closer to PRIOR. */
export function tendency(r: Read | undefined): Tendency {
  if (!r) return { ...PRIOR, n: 0 };
  const w = 12;
  const act = r.agg + r.pas;
  return {
    vpip: (r.vpip + PRIOR.vpip * w) / (r.n + w),
    pfr: (r.pfr + PRIOR.pfr * w) / (r.n + w),
    agg: (r.agg + PRIOR.agg * 8) / (act + 8),
    fold: (r.folded + PRIOR.fold * 8) / (r.faced + 8),
    n: r.n,
  };
}

/**
 * Add one finished hand to the reads: `names` maps each seat dealt in to its player's name.
 * Returns the reads (changed in place, trimmed to the players still seated first).
 */
export function observe(reads: Reads, names: Record<number, string>, acts: readonly Act[], seated: ReadonlySet<string>): Reads {
  for (const [seatText, name] of Object.entries(names)) {
    const seat = Number(seatText);
    const r = (reads[name] ??= { n: 0, vpip: 0, pfr: 0, agg: 0, pas: 0, faced: 0, folded: 0 });
    r.n++;
    let vp = false;
    let pr = false;
    for (const a of acts) {
      if (a.seat !== seat) continue;
      if (a.street === 0) {
        if (a.kind === 'c' || a.kind === 'b' || a.kind === 'r') vp = true;
        if (a.kind === 'b' || a.kind === 'r') pr = true;
      } else {
        if (a.kind === 'b' || a.kind === 'r') r.agg++;
        else if (a.kind === 'c') r.pas++;
        // a fold, a call or a raise always faces a bet
        if (a.kind === 'f' || a.kind === 'c' || a.kind === 'r') {
          r.faced++;
          if (a.kind === 'f') r.folded++;
        }
      }
    }
    if (vp) r.vpip++;
    if (pr) r.pfr++;
    if (r.n > CAP) for (const k of Object.keys(r) as (keyof Read)[]) r[k] = Math.round(r[k] / 2);
  }
  const names2 = Object.keys(reads);
  if (names2.length > KEEP) {
    for (const n of names2) if (!seated.has(n) && Object.keys(reads).length > KEEP) delete reads[n];
  }
  return reads;
}
