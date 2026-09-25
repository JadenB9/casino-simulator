// Big wins: a round that returned at least 25 times the stake (and at least $100 more than it
// cost), or won $5,000 or more, is news for the whole floor: the LED sign over the pit, a toast
// for whoever is walking about, and the winning machine's lights.
//
// Two halves:
//   bigWinsIn()  the table's side (called from the host's commit): which of a step's finished
//                rounds qualify, what paid, and when the winner will see it. Pure.
//   Wins         the floor's side: rate limits, the last HISTORY announcements, the day's total,
//                and the broadcast. Everything lives in the floor's SQLite, because the floor
//                hibernates whenever nobody moves and a limit kept in memory would reset with it.
//
// Descriptions only use what the table already showed everyone once the round was over: the bet
// that paid, the hand the dealer turned over to pay it, the machine's own display. A folded or
// unshown hand is never named.

import type { FloorServerMsg, BigWin, WinsToday } from '../../../shared/src/protocol.ts';
import type { GameEvent, GameId, Step } from '../../../shared/src/engine.ts';
import type { Cents } from '../../../shared/src/money.ts';
import { CATALOG, isGameId } from '../../../shared/src/games/catalog.ts';
import { isValidName } from '../../../shared/src/names.ts';
import { spotByKey as rouletteSpot, spotName as rouletteName, type Variant as RouletteVariant } from '../../../shared/src/games/roulette/rules.ts';
import { spotByKey as sicboSpot, spotName as sicboName } from '../../../shared/src/games/sicbo/rules.ts';
import { spotOf as bigSixSpot } from '../../../shared/src/games/bigsix/rules.ts';
import { spotOf as bandit } from '../../../shared/src/games/banditwheel/rules.ts';
import { SPOT_NAMES as BACCARAT_SPOTS, type Spot as BaccaratSpot } from '../../../shared/src/games/baccarat/rules.ts';
import { handName as threeCardHand, score as threeCardScore } from '../../../shared/src/games/threecard/rules.ts';
import type { Card } from '../../../shared/src/cards.ts';
// v6 tables6: Let It Ride's and Pai Gow's hands, from what the table turned over
import { winWhat as letItRideWin } from '../../../shared/src/games/letitride/wins.ts';
import { winWhat as paiGowWin } from '../../../shared/src/games/paigow/wins.ts';
// v6 online6: the new online games' item and hand names
import { CASE_INFO, isCase } from '../../../shared/src/games/cases/rules.ts';
import { PATTERN_NAMES, type Pattern as DiamondsPattern } from '../../../shared/src/games/diamonds/rules.ts';

/** Returned at least this many times the stake... */
export const BIG_MULTIPLE = 25;
/** ...and at least this much won (cents), so a 25x hit on a nickel isn't news. */
export const BIG_MULTIPLE_FLOOR = 10_000;
/** Or this much won in one round (cents), whatever the stake. */
export const BIG_AMOUNT = 500_000;

/** Announcements the floor keeps for newcomers. */
export const HISTORY = 20;
/** One announcement per player in this long. */
export const ACCOUNT_GAP_MS = 60_000;
/** And at most FLOOR_MAX across the floor in any FLOOR_WINDOW_MS. */
export const FLOOR_WINDOW_MS = 60_000;
export const FLOOR_MAX = 6;
/** Days of totals kept. */
const DAYS_KEPT = 7;
const WHAT_MAX = 40;
/** A reveal further out than this is a table's clock gone wrong, not a long animation. */
const REVEAL_MAX_MS = 90_000;

/** What a table tells the floor. `wagered` lets the floor check the threshold again. */
export interface BigWinReport {
  accountId: number;
  name: string;
  game: GameId;
  wagered: Cents;
  amount: Cents;
  what: string;
  at: number;
  station: string | null;
}

/** Whether a round that took `wagered` and gave back `returned` is a big win. */
export function isBigWin(wagered: number, returned: number): boolean {
  const won = returned - wagered;
  if (!Number.isSafeInteger(wagered) || !Number.isSafeInteger(returned) || wagered < 0 || won <= 0) return false;
  if (won >= BIG_AMOUNT) return true;
  return wagered > 0 && returned >= BIG_MULTIPLE * wagered && won >= BIG_MULTIPLE_FLOOR;
}

// ---------------------------------------------------------------------------------------------
// The table's side

export interface SeatWho {
  accountId: number;
  name: string;
  station: string | null;
}

/** The finished rounds in a step that paid big, ready for the floor. Bots and empty seats are skipped. */
export function bigWinsIn(game: GameId, variant: string, step: Step<unknown>, who: (seat: number) => SeatWho | undefined, now: number): BigWinReport[] {
  const out: BigWinReport[] = [];
  for (const r of step.rounds ?? []) {
    if (!isBigWin(r.wagered, r.returned)) continue;
    const w = who(r.seat);
    if (!w) continue;
    out.push({
      accountId: w.accountId,
      name: w.name,
      game,
      wagered: r.wagered,
      amount: r.returned - r.wagered,
      // A solo player's extra spots are named in the events by their spot, not the seat.
      what: describeWin(game, variant, step.events, r.spot ?? r.seat, r.wagered, r.returned),
      at: revealAt(game, step.events, now),
      station: w.station,
    });
  }
  return out;
}

/** After the ball or wheel comes to rest: time for the call and the pills. */
const REST_BEAT_MS = 1_500;
/** Otherwise, about how long each game takes to show a result it has just settled. */
const SHOW_MS: Partial<Record<GameId, number>> = {
  blackjack: 3_000,
  roulette: 2_000,
  craps: 2_500,
  baccarat: 4_000,
  slots: 3_200,
  videopoker: 1_500,
  threecard: 3_500,
  holdem: 3_000,
  war: 3_000,
  bigsix: 2_000,
  sicbo: 2_000,
  highcard: 1_500,
  // the online games: a Plinko ball falls 16 rows in about 2.5 s, Keno turns its ten numbers
  // over in 1.3 s, Limbo counts up for at most a second; the others show a result at once
  plinko: 3_000,
  keno: 2_000,
  limbo: 1_500,
  dice: 1_000,
  tower: 1_000,
  mines: 1_000,
  hilo: 1_000,
  crash: 500,
  // v6 parlor6: a bingo prize lights as its ball is called; a pachinko batch big enough for the
  // feed is a chain of fevers, about ten seconds a jackpot after the balls have flown
  bingo: 2_000,
  pachinko: 45_000,
  // v6 tables6: the second community card turns and each hand is paid; the dealer's seven turn,
  // are set, and each hand is shown and compared
  letitride: 4_000,
  paigow: 5_000,
};
/** Each free game plays out after the paid spin. */
const FREE_GAME_MS = 2_400;

/** Server time the winner sees the result: when the ball lands, or once the cards and reels are shown. */
export function revealAt(game: GameId, events: readonly GameEvent[], now: number): number {
  let rest = 0;
  let free = 0;
  for (const e of events) {
    if (typeof e.restAt === 'number' && Number.isFinite(e.restAt)) rest = Math.max(rest, e.restAt);
    if (e.type === 'reels' && typeof e.spin === 'number' && e.spin > 0) free++;
  }
  // a game not in the table (a new one) gets a middling pause
  const at = rest > 0 ? Math.max(rest, now) + REST_BEAT_MS : now + (SHOW_MS[game] ?? 2_500) + free * FREE_GAME_MS;
  return Math.min(at, now + REVEAL_MAX_MS);
}

/** What paid, in a few words, from what the table showed everyone. */
export function describeWin(game: GameId, variant: string, events: readonly GameEvent[], seat: number, wagered: number, returned: number): string {
  const times = wagered > 0 ? `${Math.floor(returned / wagered)}x` : '';
  const mine = (type: string) => events.filter((e) => e.type === type && e.seat === seat);
  try {
    switch (game) {
      case 'slots': {
        const machine = CATALOG.slots.variants.find((v) => v.id === variant)?.name ?? 'Slots';
        const free = events.some((e) => e.type === 'reels' && typeof e.spin === 'number' && e.spin > 0);
        return `${machine}, ${free ? 'free games ' : ''}${times}`;
      }
      case 'videopoker': {
        const r = mine('result')[0];
        return typeof r?.name === 'string' ? r.name : times;
      }
      case 'roulette': {
        const key = bestBet(settledBets(events, seat));
        const spot = key ? rouletteSpot(variant as RouletteVariant, key) : null;
        return spot ? rouletteName(spot) : times;
      }
      case 'sicbo': {
        const key = bestBet(settledBets(events, seat));
        const spot = key ? sicboSpot(key) : null;
        return spot ? sicboName(spot) : times;
      }
      case 'bigsix': {
        const key = bestBet(settledBets(events, seat));
        const spot = key ? bigSixSpot(key) : null;
        return spot ? `${spot.name}, ${spot.pays} to 1` : times;
      }
      case 'craps': {
        let best: { id: string; win: number } | null = null;
        for (const e of mine('result')) {
          const win = typeof e.win === 'number' ? e.win : 0;
          if (typeof e.id === 'string' && (!best || win > best.win)) best = { id: e.id, win };
        }
        return best ? crapsBetName(best.id) : times;
      }
      case 'baccarat': {
        const spots = (mine('result')[0]?.spots ?? {}) as Partial<Record<BaccaratSpot, { returned?: number }>>;
        let best: BaccaratSpot | null = null;
        for (const [k, v] of Object.entries(spots) as [BaccaratSpot, { returned?: number }][]) {
          if ((v?.returned ?? 0) > ((best && spots[best]?.returned) ?? 0)) best = k;
        }
        return best ? `${BACCARAT_SPOTS[best]} wins` : 'Baccarat';
      }
      case 'blackjack': {
        const results = mine('result');
        if (results.some((e) => e.outcome === 'blackjack')) return 'Blackjack';
        const won = results.filter((e) => e.outcome === 'win').length;
        if (won > 1) return `${won} hands won`;
        if (events.some((e) => e.type === 'dealer' && e.bust === true)) return 'Dealer busts';
        return 'Beat the dealer';
      }
      case 'threecard': {
        const r = mine('result')[0]?.result as { pairPlus?: number; bonus?: number } | undefined;
        // The winning hand is turned over to be paid (the public `show`, never the seat's own
        // `hand` event), so naming it gives nothing away.
        const hand = events.find((e) => e.type === 'show' && (e.to === undefined || e.to === 'all') && e.seat === seat && Array.isArray(e.cards) && e.cards.length === 3);
        const name = hand ? threeCardHand(threeCardScore(hand.cards as Card[])) : null;
        if (name && ((r?.pairPlus ?? 0) > 0 || (r?.bonus ?? 0) > 0)) return name;
        return name ? `${name}, beat the dealer` : 'Beat the dealer';
      }
      case 'war': {
        const r = mine('result')[0]?.result as { outcome?: string; tie?: number } | undefined;
        if ((r?.tie ?? 0) > 0) return 'Tie bet, 10 to 1';
        return r?.outcome === 'war-win' ? 'Won the war' : 'High card';
      }
      case 'banditwheel': {
        const key = bestBet(settledBets(events, seat));
        const n = key === null ? null : Number(key);
        return n !== null && bandit(n) ? `${n} to 1` : times;
      }
      case 'plinko': {
        const e = mine('drop')[0];
        return e ? `${e.rows} rows ${RISK_WORD[e.risk as string] ?? ''}, ${mult(e.mult)}`.replace(/ ,/, ',') : times;
      }
      case 'dice': {
        const e = mine('roll')[0];
        return e ? `Rolled ${hundredths(e.roll)} ${e.over ? 'over' : 'under'} ${hundredths(e.target)}` : times;
      }
      case 'limbo': {
        const e = mine('result')[0];
        return e ? `Target ${mult(e.target)}` : times;
      }
      case 'keno': {
        const e = mine('draw')[0];
        return e && Array.isArray(e.picks) ? `${e.hits} of ${e.picks.length} picks hit, ${mult(e.mult)}` : times;
      }
      case 'tower': {
        const e = events.find((x) => x.type === 'over');
        return e ? `Row ${e.level}, ${mult(e.mult)}` : times;
      }
      case 'mines': {
        const e = events.find((x) => x.type === 'over');
        const mines = Array.isArray(e?.field) ? e.field.length : 0;
        return e ? `${mines} ${mines === 1 ? 'mine' : 'mines'}, ${e.gems} ${e.gems === 1 ? 'gem' : 'gems'}, ${mult(e.mult)}` : times;
      }
      case 'hilo': {
        const e = events.find((x) => x.type === 'over');
        return e ? `${e.guesses} right guesses, ${mult(e.mult)}` : times;
      }
      case 'crash': {
        const e = mine('cashout')[0];
        return e ? `Cashed out at ${mult(e.at)}` : times;
      }
      // v6 online6: Coinflip, Wheel, Cases and Diamonds
      case 'coinflip': {
        const e = events.find((x) => x.type === 'over');
        return e ? `${e.streak} right ${e.streak === 1 ? 'call' : 'calls'}, ${mult(e.mult)}` : times;
      }
      case 'wheel': {
        const e = mine('spin')[0];
        return e ? `${e.segments} segments ${RISK_WORD[e.risk as string] ?? ''}, ${mult(e.mult)}`.replace(/ ,/, ',') : times;
      }
      case 'cases': {
        const e = mine('open')[0];
        const box = e && isCase(e.case) ? CASE_INFO[e.case] : null;
        const item = box && typeof e!.item === 'number' ? box.items[e!.item] : undefined;
        return item ? `${item.name}, ${box!.name} case, ${mult(e!.mult)}` : times;
      }
      case 'diamonds': {
        const e = mine('draw')[0];
        const name = e ? PATTERN_NAMES[e.pattern as DiamondsPattern] : undefined;
        return name ? `${name}, ${mult(e!.mult)}` : times;
      }
      // v6 parlor6: the biggest bingo prize the last ball paid, and a pachinko chain
      case 'bingo': {
        const best = mine('win').sort((a, b) => Number(b.mult) - Number(a.mult))[0];
        const name = best ? { line: 'Line', corners: 'Four corners', blackout: 'Blackout' }[best.pattern as string] : undefined;
        return name ? `${name} on ball ${best!.call}, ${mult(best!.mult)}` : `Bingo, ${times}`;
      }
      case 'pachinko': {
        const e = mine('launch')[0];
        const n = typeof e?.jackpots === 'number' ? e.jackpots : 0;
        return n > 0 ? `${n}-jackpot ${n > 1 ? 'chain' : 'fever'}, ${e!.balls} balls` : times;
      }
      // v6 tables6: the paying hand ("Royal flush", "Kings full of Fours"), the 3-Card Bonus, the
      // Fortune line ("Fortune, Five aces") or the high hand that won both
      case 'letitride':
        return letItRideWin(events, seat) ?? times;
      case 'paigow':
        return paiGowWin(events, seat) ?? times;
      case 'holdem': {
        // Only a hand shown down is named; an uncontested pot stays a pot.
        for (const e of events) {
          if (e.type !== 'win' || !Array.isArray(e.winners) || !e.winners.some((x: { seat?: number }) => x?.seat === seat)) continue;
          if (typeof e.hand === 'string') return e.hand;
        }
        return 'Took the pot';
      }
      default:
        return times;
    }
  } catch {
    return times;
  }
}

/** A multiplier in hundredths as the sign prints it: "45.12x", "1,000x". */
function mult(k: unknown): string {
  if (typeof k !== 'number' || !Number.isFinite(k)) return '';
  const whole = k % 100 === 0;
  return `${(k / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}x`;
}

/** A dice roll or target in hundredths: "49.50". */
function hundredths(k: unknown): string {
  return typeof k === 'number' && Number.isFinite(k) ? (k / 100).toFixed(2) : '';
}

const RISK_WORD: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

type Settled = [key: string, amount: number, returned: number][];

/** A seat's settled bets from a wheel or dice game's settle event. */
function settledBets(events: readonly GameEvent[], seat: number): Settled {
  const e = events.find((x) => x.type === 'settle');
  const s = (e?.seats as Record<string, { bets?: Settled }> | undefined)?.[String(seat)];
  return Array.isArray(s?.bets) ? s.bets : [];
}

/** The bet that paid the most. */
function bestBet(bets: Settled): string | null {
  let best: [string, number] | null = null;
  for (const [key, , returned] of bets) if (returned > 0 && (!best || returned > best[1])) best = [key, returned];
  return best?.[0] ?? null;
}

const CRAPS_NAMES: Record<string, string> = {
  pass: 'Pass line', dontpass: "Don't pass", come: 'Come', dontcome: "Don't come", field: 'Field',
  any7: 'Any seven', anycraps: 'Any craps', aces: 'Aces', acedeuce: 'Ace-deuce', yo: 'Yo-leven',
  boxcars: 'Boxcars', horn: 'Horn', ce: 'C and E',
  place: 'Place', buy: 'Buy', lay: 'Lay', big: 'Big', hard: 'Hard',
};

function crapsBetName(id: string): string {
  const m = /^([a-z]+?)(4|5|6|8|9|10)?$/.exec(id);
  if (!m) return 'Craps';
  const [, kind, n] = m;
  const name = CRAPS_NAMES[kind!] ?? 'Craps';
  return n ? `${name} ${n}` : name;
}

// ---------------------------------------------------------------------------------------------
// The floor's side

type Broadcast = (msg: FloorServerMsg) => void;

type Row = { name: string; game: string; amount: number; what: string; at: number; station: string | null };

export class Wins {
  private readonly sql: SqlStorage;

  constructor(
    ctx: DurableObjectState,
    private readonly broadcast: Broadcast,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS bigwins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, game TEXT NOT NULL,
      amount INTEGER NOT NULL, what TEXT NOT NULL, at INTEGER NOT NULL, station TEXT, sent_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS bigwin_days (day TEXT PRIMARY KEY, total INTEGER NOT NULL, count INTEGER NOT NULL) WITHOUT ROWID`);
  }

  /**
   * A table reports a big win. It counts toward the day's total whatever happens; it is announced
   * unless this player had one announced in the last minute or the floor has had FLOOR_MAX in the
   * last minute. 'refused' is a report that isn't a big win or doesn't look like one.
   */
  report(r: BigWinReport, now = Date.now()): 'sent' | 'limited' | 'refused' {
    const win = clean(r, now);
    if (!win) return 'refused';
    const day = casinoDay(now);
    this.sql.exec(
      `INSERT INTO bigwin_days (day, total, count) VALUES (?1, ?2, 1) ON CONFLICT(day) DO UPDATE SET total = total + excluded.total, count = count + 1`,
      day, win.amount,
    );
    this.sql.exec(`DELETE FROM bigwin_days WHERE day NOT IN (SELECT day FROM bigwin_days ORDER BY day DESC LIMIT ?1)`, DAYS_KEPT);
    // Windows are bounded on both sides: a row stamped ahead of now (a clock that jumped back)
    // must not hold every announcement off until the clock catches up with it.
    const mine = this.sql
      .exec<{ n: number }>(`SELECT count(*) AS n FROM bigwins WHERE account_id = ?1 AND sent_at > ?2 AND sent_at <= ?3`, r.accountId, now - ACCOUNT_GAP_MS, now)
      .one().n;
    const floor = this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM bigwins WHERE sent_at > ?1 AND sent_at <= ?2`, now - FLOOR_WINDOW_MS, now).one().n;
    if (mine > 0 || floor >= FLOOR_MAX) return 'limited';
    this.sql.exec(
      `INSERT INTO bigwins (account_id, name, game, amount, what, at, station, sent_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      r.accountId, win.name, win.game, win.amount, win.what, win.at, win.station ?? null, now,
    );
    // The limits look back a minute and FLOOR_MAX a minute is well under HISTORY, so trimming to
    // HISTORY rows never forgets a win the limits still need.
    this.sql.exec(`DELETE FROM bigwins WHERE id NOT IN (SELECT id FROM bigwins ORDER BY id DESC LIMIT ?1)`, HISTORY);
    this.broadcast({ t: 'bigwin', ...win, today: this.today(now) });
    return 'sent';
  }

  /** The announcements a newcomer is shown, newest first. */
  recent(): BigWin[] {
    return this.sql
      .exec<Row>(`SELECT name, game, amount, what, at, station FROM bigwins ORDER BY id DESC LIMIT ?1`, HISTORY)
      .toArray()
      .map((row) => ({
        name: row.name,
        game: row.game as GameId,
        amount: row.amount,
        what: row.what,
        at: row.at,
        ...(row.station ? { station: row.station } : {}),
      }));
  }

  today(now = Date.now()): WinsToday {
    const day = casinoDay(now);
    const row = this.sql.exec<{ total: number; count: number }>(`SELECT total, count FROM bigwin_days WHERE day = ?1`, day).toArray()[0];
    return { day, total: row?.total ?? 0, count: row?.count ?? 0 };
  }

  /** Right after hello: what the sign over the pit and the day's meter should be showing. */
  greet(ws: WebSocket, now = Date.now()): void {
    try {
      ws.send(JSON.stringify({ t: 'bigwins', list: this.recent(), today: this.today(now) } satisfies FloorServerMsg));
    } catch {
      /* closing */
    }
  }
}

/** A report's announcement, checked and tidied; null if it isn't one. */
function clean(r: BigWinReport, now: number): BigWin | null {
  if (!r || typeof r !== 'object') return null;
  if (!Number.isSafeInteger(r.accountId) || !isValidName(r.name) || !isGameId(r.game)) return null;
  if (!Number.isSafeInteger(r.amount) || !isBigWin(r.wagered, r.wagered + r.amount)) return null;
  const at = Number.isFinite(r.at) ? Math.min(Math.max(r.at, now), now + REVEAL_MAX_MS) : now;
  // Printed on an LED sign and in a toast (as text): plain words only.
  const what = String(r.what ?? '')
    .replace(/[^A-Za-z0-9 $,.'&:/+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WHAT_MAX);
  const station = typeof r.station === 'string' && /^[a-z0-9-]{1,32}$/.test(r.station) ? r.station : undefined;
  return { name: r.name, game: r.game, amount: r.amount, what: what || CATALOG[r.game].name, at, ...(station ? { station } : {}) };
}

const DAY_FORMAT = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return null;
  }
})();

/** The casino's date (Las Vegas time), YYYY-MM-DD. */
export function casinoDay(now: number): string {
  if (DAY_FORMAT) {
    const parts = DAY_FORMAT.formatToParts(new Date(now));
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  }
  return new Date(now).toISOString().slice(0, 10);
}
