// Achievements and challenges at the tables (the list is shared/src/feats.ts).
//
// Two halves, like floor/wins.ts:
//   roundFacts()  pure: what one finished round did toward the feats. Its tallies (amount won,
//                 rounds played...) and its moments (a blackjack, a royal flush...), read from the
//                 committed step the same way the client animates it: the step's events, and for
//                 blackjack the hands left in the engine's state.
//   FeatBook      the table's side, in the table's own SQLite: tallies waiting to go to D1, feats
//                 waiting to be paid, and the work of sending both.
//
// Tallies build up at the table and go to D1 now and then (FLUSH_MS after the first unsent one,
// when their player leaves, and before any feat is paid), not every round. Each account has at
// most one flush in flight. It is kept with a sequence number and sent again unchanged until D1
// answers, and D1 applies it only if the account's marker row for this table (`flush:<table
// incarnation>`) is below that number, in the same batch that raises it, so a flush that landed
// but whose answer was lost is never counted twice.
//
// A feat is paid in one D1 batch: the casino_feats row, and for a cash reward a 'grant' ledger
// row keyed `feat:<account>:<feat>` with the balance change. The feat row's primary key refuses a
// second payment: two tables that both see a player reach the same challenge can't both pay it.
// Items, emotes and titles need no row of their own; they come from the casino_feats row (db.ts
// ownedOf).

import type { GameEvent, GameId, RoundResult, Step } from '../../shared/src/engine.ts';
import { CATALOG, isGameId } from '../../shared/src/games/catalog.ts';
import { DAILY_KEEP_DAYS, FEATS, casinoDay, dailyFeats, featOf, isMaxTally, tallyValue } from '../../shared/src/feats.ts';
import type { EmoteId, TableServerMsg } from '../../shared/src/protocol.ts';
import { LINEUP, isSlotId } from '../../shared/src/games/slots/lineup.ts';
import { ROYAL_FLUSH, STRAIGHT_FLUSH as VP_STRAIGHT_FLUSH, FOUR_OF_A_KIND } from '../../shared/src/games/videopoker/hands.ts';
import { category as threeCardCategory, score as threeCardScore, STRAIGHT_FLUSH as TC_STRAIGHT_FLUSH, TRIPS as TC_TRIPS } from '../../shared/src/games/threecard/rules.ts';
import { FULL_HOUSE, QUADS, cardInt, categoryOf, evaluate } from '../../shared/src/games/holdem/eval.ts';
import { WHEELS, type Risk as WheelRisk, type Segments } from '../../shared/src/games/wheel/rules.ts';
import { MAX_CHAIN } from '../../shared/src/games/pachinko/rules.ts';
import { STRAIGHT_FLUSH as LR_STRAIGHT_FLUSH } from '../../shared/src/games/letitride/rules.ts';
import { FORTUNE_NAMES } from '../../shared/src/games/paigow/rules.ts';
import type { Card } from '../../shared/src/cards.ts';
import type { Cents } from '../../shared/src/money.ts';
import { moneyOf } from './transfer.ts';
import { revealAt } from './floor/wins.ts';
import { addRoundStats } from '../../shared/src/stats.ts'; // v6 stats6

/** Unsent tallies wait at most this long after the first of them before going to D1. */
export const FLUSH_MS = 120_000;
/** A failed D1 call is tried again after this, doubling up to RETRY_MAX_MS. */
const RETRY_MS = 2_000;
const RETRY_MAX_MS = 60_000;

// ---------------------------------------------------------------------------------------------
// What a round did (pure)

export interface RoundFacts {
  /** Tally changes: amounts in cents, counts, and `best` as a maximum. */
  tally: Record<string, number>;
  /** Achievements this round earned, by feat id (whether or not the player has them already). */
  moments: string[];
}

/**
 * One finished round's part in the feats. `state` is the engine's state after the step (only
 * blackjack reads it). A round with nothing staked (a free game of some kind) counts for nothing,
 * and neither does the test fixture game. With a casino `day`, the round counts toward that day's
 * challenges too (the `d:<day>:` tallies).
 */
export function roundFacts(game: GameId, variant: string, step: Pick<Step<unknown>, 'events' | 'state'>, r: RoundResult, day?: string): RoundFacts {
  const out: RoundFacts = { tally: {}, moments: [] };
  if (!isGameId(game) || CATALOG[game].dev) return out;
  if (!Number.isSafeInteger(r.wagered) || !Number.isSafeInteger(r.returned) || r.wagered <= 0 || r.returned < 0) return out;
  const profit = r.returned - r.wagered;
  const add = (k: string, n: number) => (out.tally[k] = (out.tally[k] ?? 0) + n);
  const d = day ? `d:${day}:` : null;
  add('rounds', 1);
  if (d) add(`${d}rounds`, 1);
  if (profit > 0) {
    add('won', profit);
    add(`won:${game}`, profit);
    add(`wins:${game}`, 1);
    out.tally.best = profit;
    if (d) {
      add(`${d}won`, profit);
      add(`${d}wins:${game}`, 1);
      out.tally[`${d}best`] = profit;
    }
    out.moments.push('first-win');
  }
  // v6 stats6: losses, the worst round, wins in all and rounds per game, for the leaderboards
  addRoundStats(out.tally, game, profit);
  // A solo player's extra spots are named in the events by their spot, not the seat.
  const pos = r.spot ?? r.seat;
  try {
    const m = momentsAt(game, variant, step.events, step.state, pos, r.wagered, r.returned);
    out.moments.push(...m.moments);
    for (const [k, n] of Object.entries(m.counts)) add(k, n);
  } catch (err) {
    // A shape we didn't expect costs the player a moment, never the round.
    console.error('feats: reading a round failed', game, err);
  }
  return out;
}

/** Settled bets as the wheel and dice games send them (the Bandit Wheel's keys are numbers). */
type Settled = [key: string | number, amount: number, returned: number][];

/** A seat's settled bets from a wheel or dice game's settle event. */
function settledBets(events: readonly GameEvent[], pos: number): Settled {
  const e = events.find((x) => x.type === 'settle');
  const s = (e?.seats as Record<string, { bets?: Settled }> | undefined)?.[String(pos)];
  return Array.isArray(s?.bets) ? s.bets : [];
}

/** Keys of the bets that paid (returned more than nothing). */
function paid(events: readonly GameEvent[], pos: number): string[] {
  return settledBets(events, pos)
    .filter((b) => Array.isArray(b) && (typeof b[0] === 'string' || typeof b[0] === 'number') && typeof b[2] === 'number' && b[2] > 0)
    .map((b) => String(b[0]));
}

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);

/** Each slot machine's top award: the head of a pay glass, or five of the best line symbol. */
function topAward(variant: string): { combo: string } | { symbol: string } | null {
  if (!isSlotId(variant)) return null;
  const m = LINEUP[variant] as unknown as { kind: string; pays?: { combo: string }[]; linePays?: Record<string, readonly number[]> };
  if (m.kind === 'stepper') return m.pays?.[0] ? { combo: m.pays[0].combo } : null;
  let best: [string, number] | null = null;
  for (const [sym, p] of Object.entries(m.linePays ?? {})) {
    const five = p[p.length - 1] ?? 0;
    if (!best || five > best[1]) best = [sym, five];
  }
  return best ? { symbol: best[0] } : null;
}

/** A blackjack spot's hands as the engine holds them once the round is settled (BlackjackState.deal). */
function blackjackHands(state: unknown, pos: number): { doubled?: boolean; outcome?: string | null }[] {
  const spots = (state as { deal?: { spots?: { seat?: number; hands?: unknown[] }[] } } | null)?.deal?.spots;
  const spot = Array.isArray(spots) ? spots.find((s) => s?.seat === pos) : undefined;
  return Array.isArray(spot?.hands) ? (spot.hands as { doubled?: boolean; outcome?: string | null }[]) : [];
}

function momentsAt(
  game: GameId,
  variant: string,
  events: readonly GameEvent[],
  state: unknown,
  pos: number,
  wagered: number,
  returned: number,
): { moments: string[]; counts: Record<string, number> } {
  const moments: string[] = [];
  const counts: Record<string, number> = {};
  const mine = (type: string) => events.filter((e) => e.type === type && e.seat === pos);
  const any = (type: string) => events.filter((e) => e.type === type);
  switch (game) {
    case 'blackjack': {
      // A blackjack, a bust or a surrender is settled (and its result sent) the moment it
      // happens, rounds before the round itself ends, so the hands come from the engine's state
      // as it stands at the end: every hand of the spot with its outcome.
      const hands = blackjackHands(state, pos);
      const naturals = hands.filter((h) => h?.outcome === 'blackjack' || h?.outcome === 'evenmoney').length;
      if (naturals > 0) {
        moments.push('bj-blackjack');
        counts['bj:naturals'] = naturals;
      }
      if (hands.some((h) => h?.doubled === true && h.outcome === 'win')) moments.push('bj-double');
      // two hands or more on the spot means it split; every one of them won
      if (hands.length >= 2 && hands.every((h) => h?.outcome === 'win')) moments.push('bj-split');
      break;
    }
    case 'roulette': {
      const keys = paid(events, pos);
      if (keys.some((k) => k.startsWith('straight:'))) moments.push('rl-straight');
      // 00 is pocket 37
      if (keys.includes('straight:0') || keys.includes('straight:37')) moments.push('rl-zero');
      break;
    }
    case 'craps': {
      const won = mine('result').filter((e) => e.flat === 'win');
      const made = any('puck').some((e) => typeof e.made === 'number');
      if (made && won.some((e) => e.id === 'pass')) moments.push('cr-point');
      if (won.some((e) => typeof e.id === 'string' && /^hard(4|6|8|10)$/.test(e.id))) moments.push('cr-hard');
      if (won.some((e) => e.id === 'aces' || e.id === 'boxcars')) moments.push('cr-long');
      break;
    }
    case 'baccarat': {
      const spots = (mine('result')[0]?.spots ?? {}) as Record<string, { returned?: number; outcome?: string } | undefined>;
      const won = (k: string) => spots[k]?.outcome === 'win' && (spots[k]?.returned ?? 0) > 0;
      const o = any('outcome')[0];
      if (o?.natural === true && (o.winner === 'player' || o.winner === 'banker') && num(o[o.winner]) === 9 && won(o.winner)) moments.push('bc-natural');
      if (won('tie')) moments.push('bc-tie');
      if (won('playerPair') || won('bankerPair')) moments.push('bc-pair');
      break;
    }
    case 'slots': {
      const reels = any('reels');
      if (reels.some((e) => e.trigger === true || (e.wheel !== undefined && e.wheel !== null))) moments.push('sl-bonus');
      if (returned >= 100 * wagered) moments.push('sl-hundred');
      const top = topAward(variant);
      const hit = reels.some((e) =>
        top && 'combo' in top
          ? e.combo === top.combo
          : top !== null && Array.isArray(e.lines) && e.lines.some((l: { symbol?: unknown; count?: unknown }) => l?.symbol === top.symbol && l?.count === 5),
      );
      if (hit) moments.push('sl-jackpot');
      break;
    }
    case 'videopoker': {
      const rank = num(mine('result')[0]?.rank);
      if (rank === ROYAL_FLUSH) moments.push('vp-royal');
      if (rank === VP_STRAIGHT_FLUSH) moments.push('vp-straight-flush');
      if (rank === FOUR_OF_A_KIND) moments.push('vp-quads');
      break;
    }
    case 'threecard': {
      // the hand turned over to be settled (a folded hand never is)
      const shown = events.find((e) => e.type === 'show' && e.seat === pos && Array.isArray(e.cards) && e.cards.length === 3);
      if (shown) {
        const cat = threeCardCategory(threeCardScore(shown.cards as Card[]));
        if (cat === TC_STRAIGHT_FLUSH) moments.push('tc-straight-flush');
        if (cat === TC_TRIPS) moments.push('tc-trips');
      }
      break;
    }
    case 'holdem': {
      for (const e of any('win')) {
        if (!Array.isArray(e.winners) || !e.winners.some((w: { seat?: number; amount?: number }) => w?.seat === pos && (w.amount ?? 0) > 0)) continue;
        moments.push('he-pot');
        // a pot shown down names its best five; an uncontested one has none
        if (typeof e.hand === 'string' && Array.isArray(e.best) && e.best.length === 5) {
          const cat = categoryOf(evaluate((e.best as Card[]).map(cardInt)));
          if (cat >= FULL_HOUSE) moments.push('he-boat');
          if (cat >= QUADS) moments.push('he-quads');
        }
      }
      break;
    }
    case 'war': {
      const r = mine('result')[0]?.result as { outcome?: string; tie?: number } | undefined;
      if (r?.outcome === 'war-win') moments.push('wr-war');
      if ((r?.tie ?? 0) > 0) moments.push('wr-tie');
      break;
    }
    case 'bigsix': {
      const keys = paid(events, pos);
      if (keys.includes('twenty')) moments.push('b6-twenty');
      if (keys.includes('star') || keys.includes('crown')) moments.push('b6-star');
      break;
    }
    case 'sicbo': {
      const keys = paid(events, pos);
      if (keys.includes('total:4') || keys.includes('total:17')) moments.push('sb-total');
      if (keys.some((k) => k === 'anytriple' || k.startsWith('triple:'))) moments.push('sb-triple');
      break;
    }
    case 'banditwheel': {
      const keys = paid(events, pos);
      if (keys.includes('10')) moments.push('bw-10');
      if (keys.includes('20')) moments.push('bw-20');
      break;
    }
    case 'plinko': {
      const e = mine('drop')[0];
      const rows = num(e?.rows);
      if (e && (num(e.bin) === 0 || num(e.bin) === rows)) {
        moments.push('pk-edge');
        if (rows === 16 && e.risk === 'high') moments.push('pk-top');
      }
      break;
    }
    case 'tower': {
      const e = any('over')[0];
      if (e?.outcome === 'top') moments.push('tw-top');
      break;
    }
    case 'mines': {
      const e = any('over')[0];
      if (e?.outcome === 'cleared') moments.push('mn-clear');
      if (e && e.outcome !== 'bust' && num(e.gems) >= 10) moments.push('mn-gems');
      break;
    }
    case 'dice': {
      const e = mine('roll')[0];
      if (e?.win === true && num(e.chance) <= 500) moments.push('dc-long');
      break;
    }
    case 'limbo': {
      const e = mine('result')[0];
      if (e?.win === true && num(e.target) >= 1_000) moments.push('lb-10x');
      if (e?.win === true && num(e.target) >= 10_000) moments.push('lb-100x');
      break;
    }
    case 'keno': {
      const e = mine('draw')[0];
      const hits = num(e?.hits);
      if (hits >= 6) moments.push('kn-catch');
      if (Array.isArray(e?.picks) && e.picks.length >= 5 && hits === e.picks.length) moments.push('kn-sweep');
      break;
    }
    case 'hilo': {
      const e = any('over')[0];
      if (e?.outcome === 'cashout' && num(e.guesses) >= 8) moments.push('hl-streak');
      break;
    }
    case 'crash': {
      const e = mine('cashout')[0];
      if (num(e?.at) >= 1_000) moments.push('cs-10x');
      if (num(e?.at) >= 10_000) moments.push('cs-100x');
      break;
    }
    case 'coinflip': {
      const e = any('over')[0];
      const streak = num(e?.streak);
      if (e && e.outcome !== 'bust' && streak >= 5) moments.push('cf-five');
      if (e && e.outcome !== 'bust' && streak >= 10) moments.push('cf-ten');
      break;
    }
    case 'wheel': {
      const e = mine('spin')[0];
      const mult = num(e?.mult);
      if (mult >= 1_000) moments.push('wh-big');
      const wheel = e ? WHEELS[e.risk as WheelRisk]?.[e.segments as Segments] : undefined;
      if (e?.risk === 'high' && e.segments === 50 && wheel && mult === Math.max(...wheel)) moments.push('wh-top');
      break;
    }
    case 'cases': {
      const mult = num(mine('open')[0]?.mult);
      if (mult >= 2_000) moments.push('ca-epic');
      if (mult >= 10_000) moments.push('ca-legendary');
      break;
    }
    case 'diamonds': {
      const pattern = mine('draw')[0]?.pattern;
      if (pattern === 'four') moments.push('dm-four');
      if (pattern === 'five') moments.push('dm-five');
      break;
    }
    case 'bingo': {
      // Prizes are paid ball by ball, games before the round is; the cards in the engine's state
      // hold every pattern each paid.
      const cards = (state as { seats?: Record<string, { cards?: { won?: Record<string, unknown> }[] }> } | null)?.seats?.[String(pos)]?.cards ?? [];
      if (cards.some((c) => c?.won && Object.values(c.won).some(Boolean))) moments.push('bg-bingo');
      if (cards.some((c) => c?.won?.blackout)) moments.push('bg-blackout');
      break;
    }
    case 'pachinko': {
      const e = mine('launch')[0];
      if (num(e?.jackpots) >= 1) moments.push('pa-jackpot');
      if (Array.isArray(e?.shots) && e.shots.some((b: { chain?: unknown }) => Array.isArray(b?.chain) && b.chain.length >= MAX_CHAIN)) moments.push('pa-chain');
      break;
    }
    case 'letitride': {
      const r = mine('result')[0]?.result as { hand?: number; pulled?: boolean[]; bets?: number[] } | undefined;
      if (r?.pulled?.every((p) => p === false) && (r.bets?.[0] ?? 0) > 0) moments.push('lr-ride');
      if (typeof r?.hand === 'number' && r.hand >= LR_STRAIGHT_FLUSH) moments.push('lr-straight-flush');
      break;
    }
    case 'paigow': {
      // the Fortune line hit, if any (FORTUNE_NAMES: four of a kind is line 6, five aces line 3)
      const r = mine('result')[0]?.result as { fortuneLine?: number; fortune?: number } | undefined;
      const line = typeof r?.fortuneLine === 'number' ? r.fortuneLine : -1;
      if (line >= 0 && line <= FORTUNE_NAMES.indexOf('Four of a kind') && (r?.fortune ?? 0) > 0) moments.push('pg-fortune');
      if (line === FORTUNE_NAMES.indexOf('Five aces')) moments.push('pg-aces');
      break;
    }
    default:
      break;
  }
  return { moments, counts };
}

/** Every challenge the tallies meet that isn't in `have`: the list's, and with a `day`, that day's. */
export function challengesMet(tally: Readonly<Record<string, number>>, have: ReadonlySet<string>, day?: string): string[] {
  const out: string[] = [];
  for (const f of day ? [...FEATS, ...dailyFeats(day)] : FEATS) {
    if (f.kind !== 'challenge' || !f.tally || f.goal === undefined || have.has(f.id)) continue;
    if (tallyValue(tally, f.tally) >= f.goal) out.push(f.id);
  }
  return out;
}

/** Fold tally changes into totals: sums, and `best` as the larger. */
export function addTally(into: Record<string, number>, delta: Readonly<Record<string, number>>): Record<string, number> {
  for (const [k, n] of Object.entries(delta)) into[k] = isMaxTally(k) ? Math.max(into[k] ?? 0, n) : (into[k] ?? 0) + n;
  return into;
}

// ---------------------------------------------------------------------------------------------
// D1

/** The rows of a tally that are progress, not a flush's marker. */
export function isProgressKey(key: string): boolean {
  return !key.startsWith('flush:');
}

/**
 * One flush of an account's tallies from one table: every change, then the table's marker, all
 * applied only if the marker is still below `seq`.
 */
export function flushStatements(db: D1Database, accountId: number, marker: string, seq: number, delta: Readonly<Record<string, number>>, now = Date.now()): D1PreparedStatement[] {
  // Days gone by: their rows go (any day's `d:` key sorts below the cut-off's).
  const cut = `d:${casinoDay(now - (DAILY_KEEP_DAYS - 1) * 86_400_000)}`;
  const stmts: D1PreparedStatement[] = [db.prepare(`DELETE FROM casino_tally WHERE account_id = ?1 AND key >= 'd:' AND key < ?2`).bind(accountId, cut)];
  for (const [key, n] of Object.entries(delta)) {
    if (!isProgressKey(key) || !Number.isSafeInteger(n)) continue;
    const merge = isMaxTally(key) ? 'MAX(n, excluded.n)' : 'n + excluded.n';
    stmts.push(
      db
        .prepare(
          `INSERT INTO casino_tally (account_id, key, n)
           SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM casino_tally WHERE account_id = ?1 AND key = ?4 AND n >= ?5)
           ON CONFLICT (account_id, key) DO UPDATE SET n = ${merge}`,
        )
        .bind(accountId, key, n, marker, seq),
    );
  }
  stmts.push(
    db
      .prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, ?2, ?3) ON CONFLICT (account_id, key) DO UPDATE SET n = MAX(n, excluded.n)`)
      .bind(accountId, marker, seq),
  );
  return stmts;
}

/** The unlock batch: the feat row, and for cash the ledger row and the balance, together. */
export function unlockStatements(db: D1Database, accountId: number, feat: string, at: number): D1PreparedStatement[] {
  const cash = featOf(feat)?.reward.cash ?? 0;
  const stmts = [db.prepare(`INSERT INTO casino_feats (account_id, feat, at) VALUES (?1, ?2, ?3)`).bind(accountId, feat, at)];
  if (cash > 0) {
    stmts.push(
      db
        .prepare(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?1, ?2, 'grant', ?3, NULL, ?4)`)
        .bind(featOpId(accountId, feat), accountId, cash, at),
      db.prepare(`UPDATE casino_accounts SET balance = balance + ?2, rev = rev + 1 WHERE id = ?1 RETURNING balance, in_play, rev`).bind(accountId, cash),
    );
  }
  // v6 stats6: the count the "most achievements" board reads, last so the money stays results[2]
  stmts.push(
    db.prepare(`INSERT INTO casino_tally (account_id, key, n) VALUES (?1, 'feats', 1) ON CONFLICT (account_id, key) DO UPDATE SET n = n + 1`).bind(accountId),
  );
  return stmts;
}

export function featOpId(accountId: number, feat: string): string {
  return `feat:${accountId}:${feat}`;
}

export type UnlockOutcome = { kind: 'applied'; money?: { balance: Cents; inPlay: Cents; rev: number } } | { kind: 'taken' };

/**
 * Pay a feat. 'applied' if this call paid it, or on a `retry`, if the try before (stamped with the
 * same `at`) did and its answer was lost; 'taken' if it was already earned some other way
 * (another table got there first, maybe in the same millisecond). Anything else throws, and the
 * caller tries again later.
 */
export async function unlockFeat(db: D1Database, accountId: number, feat: string, at: number, retry = false): Promise<UnlockOutcome> {
  if (!featOf(feat)) throw new Error(`unlockFeat: no feat ${feat}`);
  try {
    const results = await db.batch<{ balance: number; in_play: number; rev: number }>(unlockStatements(db, accountId, feat, at));
    const m = results[2]?.results?.[0];
    return { kind: 'applied', ...(m ? { money: { balance: m.balance, inPlay: m.in_play, rev: m.rev } } : {}) };
  } catch (err) {
    const row = await db.prepare(`SELECT at FROM casino_feats WHERE account_id = ?1 AND feat = ?2`).bind(accountId, feat).first<{ at: number }>();
    if (!row) throw err;
    if (!retry || row.at !== at) return { kind: 'taken' };
    const m = (featOf(feat)?.reward.cash ?? 0) > 0 ? await moneyOf(db, accountId) : null;
    return { kind: 'applied', ...(m ? { money: { balance: m.balance, inPlay: m.in_play, rev: m.rev } } : {}) };
  }
}

/** An account's progress and feats as D1 has them. */
export async function featsOf(db: D1Database, accountId: number): Promise<{ tally: Record<string, number>; feats: { feat: string; at: number }[] }> {
  const [t, f] = await db.batch([
    db.prepare(`SELECT key, n FROM casino_tally WHERE account_id = ?1`).bind(accountId),
    db.prepare(`SELECT feat, at FROM casino_feats WHERE account_id = ?1 ORDER BY at`).bind(accountId),
  ]);
  const tally: Record<string, number> = {};
  for (const r of t!.results as { key: string; n: number }[]) if (isProgressKey(r.key)) tally[r.key] = r.n;
  // a feat taken off the list (never done once shipped, but a row can outlive a rename in dev)
  const feats = (f!.results as { feat: string; at: number }[]).filter((r) => featOf(r.feat));
  return { tally, feats };
}

// ---------------------------------------------------------------------------------------------
// The table's side

/** What the book needs from the table around it. */
export interface FeatOut {
  /** A message to this account's sockets at the table. */
  send(accountId: number, msg: TableServerMsg): void;
  /**
   * The floor's feed line (best effort), not before `showAt` (server time): the moment the
   * player sees the round that earned it, so nobody hears of it before they do.
   */
  featEarned(accountId: number, name: string, feat: string, showAt: number): Promise<void>;
  /** The floor adds an earned emote to the player's wheel (best effort). */
  grant(accountId: number, emotes: EmoteId[]): Promise<void>;
}

interface Base {
  tally: Record<string, number>;
  have: Set<string>;
}

export class FeatBook {
  /** Progress and feats as D1 had them, per account, plus what this table has sent since. */
  private base = new Map<number, Base>();
  /** Accounts whose tallies moved since their challenges were last looked at. */
  private dirty = new Set<number>();
  private running: Promise<void> | null = null;
  private failures = 0;
  private retryAt = 0;

  constructor(
    private readonly sql: SqlStorage,
    /** The key this table's flushes are fenced by in casino_tally. */
    private readonly marker: () => string,
    /** The table's storage transaction, for changes that must land together. */
    private readonly transact: (fn: () => void) => void = (fn) => fn(),
  ) {
    // Per account: its name (for the feed, after it has left) and when its tallies are due.
    sql.exec(`CREATE TABLE IF NOT EXISTS feat_acct (account_id INTEGER PRIMARY KEY, name TEXT NOT NULL, flush_at INTEGER)`);
    // Tally changes not yet sent.
    sql.exec(`CREATE TABLE IF NOT EXISTS feat_pending (account_id INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (account_id, key)) WITHOUT ROWID`);
    // The flush in flight for an account: sent again, unchanged, until D1 has it.
    sql.exec(`CREATE TABLE IF NOT EXISTS feat_flush (account_id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, body TEXT NOT NULL)`);
    // Feats earned here and not yet paid, each stamped once with when it was earned.
    // `tries` counts the batches sent for it: only a retry can find its own earlier try landed.
    // `show_at` is when the player sees the round that earned it: the floor hears no sooner.
    sql.exec(`CREATE TABLE IF NOT EXISTS feat_todo (
      account_id INTEGER NOT NULL, feat TEXT NOT NULL, at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
      show_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, feat)) WITHOUT ROWID`);
    sql.exec(`CREATE TABLE IF NOT EXISTS feat_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL) WITHOUT ROWID`);
    // after a restart, every account with unsent progress gets its challenges looked at again
    for (const r of sql.exec<{ account_id: number }>(`SELECT DISTINCT account_id FROM feat_pending`).toArray()) this.dirty.add(r.account_id);
  }

  /**
   * Store what a committed step's rounds did. Call inside the step's storage transaction, with
   * the rounds' facts worked out beforehand (roundFacts never throws, but it runs outside so a
   * bug in it could never roll a round back). True when there's something to pay.
   */
  record(facts: StepFacts[], now: number): boolean {
    let todo = false;
    for (const { accountId, name, facts: f, showAt } of facts) {
      const keys = Object.entries(f.tally);
      if (keys.length === 0 && f.moments.length === 0) continue;
      this.sql.exec(
        `INSERT INTO feat_acct (account_id, name, flush_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (account_id) DO UPDATE SET name = excluded.name, flush_at = COALESCE(feat_acct.flush_at, excluded.flush_at)`,
        accountId, name, now + FLUSH_MS,
      );
      for (const [key, n] of keys) {
        const merge = isMaxTally(key) ? 'MAX(n, excluded.n)' : 'n + excluded.n';
        this.sql.exec(`INSERT INTO feat_pending (account_id, key, n) VALUES (?1, ?2, ?3) ON CONFLICT (account_id, key) DO UPDATE SET n = ${merge}`, accountId, key, n);
      }
      const have = this.base.get(accountId)?.have;
      for (const feat of f.moments) {
        if (have?.has(feat) || !featOf(feat)) continue;
        this.sql.exec(`INSERT OR IGNORE INTO feat_todo (account_id, feat, at, show_at) VALUES (?1, ?2, ?3, ?4)`, accountId, feat, now, showAt);
        todo = true;
      }
      if (keys.length === 0) continue;
      // A challenge reached: queued now when we know where the player stands, or looked at once
      // their progress has been read from D1.
      if (!this.base.has(accountId)) {
        this.dirty.add(accountId);
        todo = true;
        continue;
      }
      for (const feat of this.meets(accountId)) {
        this.sql.exec(`INSERT OR IGNORE INTO feat_todo (account_id, feat, at, show_at) VALUES (?1, ?2, ?3, ?4)`, accountId, feat, now, showAt);
        todo = true;
      }
    }
    return todo;
  }

  /** The player is standing up (cashing out, leaving): send their tallies without waiting. */
  flushSoon(accountId: number, now: number): void {
    this.sql.exec(`UPDATE feat_acct SET flush_at = ?2 WHERE account_id = ?1 AND flush_at IS NOT NULL`, accountId, now);
  }

  /** Read the player's progress from D1 again next time (they may have played elsewhere since). */
  forget(accountId: number): void {
    this.base.delete(accountId);
  }

  /** When the book next has work: a flush falling due, a feat to pay, a retry. Null for none. */
  due(): number | null {
    let at: number | null = null;
    const todo = this.sql.exec<{ at: number | null }>(`SELECT min(at) AS at FROM feat_todo`).one().at;
    if (todo !== null) at = todo;
    const flush = this.sql.exec<{ at: number | null }>(`SELECT min(flush_at) AS at FROM feat_acct WHERE flush_at IS NOT NULL`).one().at;
    if (flush !== null) at = at === null ? flush : Math.min(at, flush);
    if (this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM feat_flush`).one().n > 0) at = at === null ? 0 : Math.min(at, 0);
    if (at === null && this.dirty.size > 0) at = 0;
    return at === null ? null : Math.max(at, this.retryAt);
  }

  /** Nothing waiting to go to D1 (so the table's marker rows can go). */
  idle(): boolean {
    const n = (t: string) => this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${t}`).one().n;
    return n('feat_pending') === 0 && n('feat_flush') === 0 && n('feat_todo') === 0;
  }

  /** Do what's due. One run at a time; a second call joins the first. */
  run(db: D1Database, out: FeatOut, now = Date.now()): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        await this.work(db, out, now);
        this.failures = 0;
        this.retryAt = 0;
      } catch (err) {
        this.failures++;
        this.retryAt = Date.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** Math.min(this.failures - 1, 5));
        console.error('feats: D1 work failed; will retry', this.failures, err);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async work(db: D1Database, out: FeatOut, now: number): Promise<void> {
    // 1. Challenges reached: look at every account whose tallies moved.
    for (const a of [...this.dirty]) {
      await this.loadBase(db, a);
      for (const feat of this.meets(a)) this.sql.exec(`INSERT OR IGNORE INTO feat_todo (account_id, feat, at) VALUES (?1, ?2, ?3)`, a, feat, now);
      this.dirty.delete(a);
    }
    // 2. Feats to pay, oldest first; each account's tallies land first.
    const todo = this.sql
      .exec<{ account_id: number; feat: string; at: number; tries: number; show_at: number }>(`SELECT account_id, feat, at, tries, show_at FROM feat_todo ORDER BY at, feat`)
      .toArray();
    const flushed = new Set<number>();
    for (const t of todo) {
      const base = await this.loadBase(db, t.account_id);
      if (base.have.has(t.feat)) {
        this.sql.exec(`DELETE FROM feat_todo WHERE account_id = ?1 AND feat = ?2`, t.account_id, t.feat);
        continue;
      }
      if (!flushed.has(t.account_id)) {
        flushed.add(t.account_id);
        await this.flush(db, t.account_id);
      }
      this.sql.exec(`UPDATE feat_todo SET tries = tries + 1 WHERE account_id = ?1 AND feat = ?2`, t.account_id, t.feat);
      const r = await unlockFeat(db, t.account_id, t.feat, t.at, t.tries > 0);
      base.have.add(t.feat);
      this.sql.exec(`DELETE FROM feat_todo WHERE account_id = ?1 AND feat = ?2`, t.account_id, t.feat);
      if (r.kind === 'applied') await this.announce(out, t.account_id, t.feat, t.at, t.show_at, r.money);
    }
    // 3. Tallies whose time has come (a flush in flight is always due).
    const due = this.sql
      .exec<{ account_id: number }>(
        `SELECT account_id FROM feat_acct WHERE flush_at IS NOT NULL AND flush_at <= ?1 UNION SELECT account_id FROM feat_flush`,
        Math.max(now, Date.now()),
      )
      .toArray();
    for (const { account_id } of due) if (!flushed.has(account_id)) await this.flush(db, account_id);
    // Nothing left for an account: its row goes.
    this.sql.exec(
      `DELETE FROM feat_acct WHERE flush_at IS NULL
         AND account_id NOT IN (SELECT account_id FROM feat_todo) AND account_id NOT IN (SELECT account_id FROM feat_pending)`,
    );
  }

  private async announce(out: FeatOut, accountId: number, feat: string, at: number, showAt: number, money?: { balance: Cents; inPlay: Cents; rev: number }): Promise<void> {
    const name = this.sql.exec<{ name: string }>(`SELECT name FROM feat_acct WHERE account_id = ?1`, accountId).toArray()[0]?.name ?? '';
    out.send(accountId, { t: 'feat', feat, at, ...(money ? { balance: money } : {}) });
    const f = featOf(feat);
    const emote = f?.reward.emote;
    await Promise.all([
      // a daily challenge is everyone's every day: no news for the floor
      name && !f?.daily ? out.featEarned(accountId, name, feat, showAt).catch((err) => console.error('floor featEarned failed', err)) : null,
      emote ? out.grant(accountId, [emote]).catch((err) => console.error('floor grant failed', err)) : null,
    ]);
  }

  /** The account's progress: D1's, then what this table has in flight and still to send. */
  totals(accountId: number): Record<string, number> {
    const t = { ...(this.base.get(accountId)?.tally ?? {}) };
    const flight = this.sql.exec<{ body: string }>(`SELECT body FROM feat_flush WHERE account_id = ?1`, accountId).toArray()[0];
    if (flight) addTally(t, JSON.parse(flight.body) as Record<string, number>);
    for (const r of this.sql.exec<{ key: string; n: number }>(`SELECT key, n FROM feat_pending WHERE account_id = ?1`, accountId).toArray()) addTally(t, { [r.key]: r.n });
    return t;
  }

  private meets(accountId: number): string[] {
    const base = this.base.get(accountId);
    if (!base) return [];
    const queued = new Set(this.sql.exec<{ feat: string }>(`SELECT feat FROM feat_todo WHERE account_id = ?1`, accountId).toArray().map((r) => r.feat));
    return challengesMet(this.totals(accountId), base.have, casinoDay(Date.now())).filter((f) => !queued.has(f));
  }

  private async loadBase(db: D1Database, accountId: number): Promise<Base> {
    const known = this.base.get(accountId);
    if (known) return known;
    // Whatever is in flight is sent before reading, so D1's figure can't be half-way through it.
    await this.flushInFlight(db, accountId);
    const { tally, feats } = await featsOf(db, accountId);
    const base: Base = { tally, have: new Set(feats.map((f) => f.feat)) };
    this.base.set(accountId, base);
    return base;
  }

  private async flushInFlight(db: D1Database, accountId: number): Promise<void> {
    const row = this.sql.exec<{ seq: number; body: string }>(`SELECT seq, body FROM feat_flush WHERE account_id = ?1`, accountId).toArray()[0];
    if (!row) return;
    await db.batch(flushStatements(db, accountId, this.marker(), row.seq, JSON.parse(row.body) as Record<string, number>));
    this.sql.exec(`DELETE FROM feat_flush WHERE account_id = ?1`, accountId);
    const base = this.base.get(accountId);
    if (base) addTally(base.tally, JSON.parse(row.body) as Record<string, number>);
  }

  /** Send the account's tallies: the flush in flight if there is one, then what has built up since. */
  private async flush(db: D1Database, accountId: number): Promise<void> {
    await this.flushInFlight(db, accountId);
    const pending = this.sql.exec<{ key: string; n: number }>(`SELECT key, n FROM feat_pending WHERE account_id = ?1`, accountId).toArray();
    if (pending.length > 0) {
      const body: Record<string, number> = {};
      for (const r of pending) body[r.key] = r.n;
      // what builds up from here waits for the next flush
      this.transact(() => {
        const seq = (this.sql.exec<{ v: number }>(`SELECT v FROM feat_meta WHERE k = 'seq'`).toArray()[0]?.v ?? 0) + 1;
        this.sql.exec(`INSERT OR REPLACE INTO feat_meta (k, v) VALUES ('seq', ?1)`, seq);
        this.sql.exec(`INSERT INTO feat_flush (account_id, seq, body) VALUES (?1, ?2, ?3)`, accountId, seq, JSON.stringify(body));
        this.sql.exec(`DELETE FROM feat_pending WHERE account_id = ?1`, accountId);
      });
      await this.flushInFlight(db, accountId);
    }
    this.sql.exec(`UPDATE feat_acct SET flush_at = NULL WHERE account_id = ?1`, accountId);
  }

  /** A closing lobby: its marker rows in casino_tally are no longer needed. */
  async cleanup(db: D1Database): Promise<void> {
    if (!this.idle()) return;
    await db.prepare(`DELETE FROM casino_tally WHERE key = ?1`).bind(this.marker()).run();
  }
}

/** A finished round's facts, whose they are, and when its player sees it (floor/wins.ts revealAt). */
export interface StepFacts {
  accountId: number;
  name: string;
  facts: RoundFacts;
  showAt: number;
}

/** The facts of every finished round in a step that belongs to someone at the table. */
export function stepFacts(
  game: GameId,
  variant: string,
  step: Step<unknown>,
  who: (seat: number) => { accountId: number; name: string } | undefined,
  now: number,
): StepFacts[] {
  const out: StepFacts[] = [];
  const showAt = revealAt(game, step.events, now);
  const day = casinoDay(now);
  for (const r of step.rounds ?? []) {
    const w = who(r.seat);
    if (!w) continue;
    const facts = roundFacts(game, variant, step, r, day);
    if (Object.keys(facts.tally).length || facts.moments.length) out.push({ ...w, facts, showAt });
  }
  return out;
}
