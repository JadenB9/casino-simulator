// Everything the client and the server say to each other, and the validators that turn untrusted
// JSON into these types. docs/PROTOCOL.md describes the same thing in prose.
//
// Rules of the road:
//   - money on the wire is integer cents;
//   - times are server epoch ms, and countdowns travel as { deadline, now };
//   - anything that fails a validator is dropped without a reply;
//   - a well-formed request the server refuses gets { t: 'err', code, msg }.

import type { Cents } from './money.ts';
import type { GameId, TableMode, TableConfig } from './engine.ts';
import type { Look } from './look.ts';
import type { FxEvent, Statue } from './items.ts';
import type { ZoneId } from './zones.ts';
import type { CarCall } from './valet.ts'; // v6 cars6
import { isSeatId } from './seats.ts';
import type { TableLimits } from './limits.ts';
// v6 law6:
import type { Detour, StaffId } from './law/patrol.ts';
import type { JailState, LawEvent } from './law/rules.ts';

export const PROTOCOL_VERSION = 1;

// Idle timeouts, one set for everyone. A player who does nothing for IDLE_MS is disconnected: the
// client does it itself (after a "Still there?" for the last IDLE_WARN_MS) and shows an away
// screen; the floor and the tables do the same for any socket they hear nothing real from, and a
// seat is stood up the way Leave does it. While the player is at the keyboard the client says
// `here` on each socket at most once every HERE_MS, so being busy at a table or in the menu isn't
// being idle to the floor.

/** No input (client) or no real message (server) for this long is idle. */
export const IDLE_MS = 15 * 60_000;
/** The client's "Still there?" comes up this long before its own disconnect. */
export const IDLE_WARN_MS = 60_000;
/** A client with input sends `here` at most this often per socket, and always after its last input. */
export const HERE_MS = 60_000;

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'LIMIT'
  | 'NOT_ENOUGH_CHIPS'
  | 'INSUFFICIENT_FUNDS'
  | 'NOT_LEADER'
  | 'TABLE_FULL'
  | 'NOT_FOUND'
  | 'BAD_PIN'
  | 'RATE_LIMITED'
  | 'BUSY'
  | 'NOT_SEATED'
  | 'NOT_ELIGIBLE'
  | 'BAD_NAME'
  | 'UNAUTHORIZED'
  | 'INTERNAL';

export const CLOSE = {
  /** Malformed traffic. Reconnect after backoff. */
  PROTOCOL_ERROR: 4000,
  /** A newer connection for this account took over. Don't reconnect. */
  REPLACED: 4001,
  /** Missing or expired token. Back to login. */
  UNAUTHORIZED: 4003,
  /** The table doesn't exist or has closed. Back to the floor. */
  NOT_FOUND: 4004,
  /** Not allowed at this table (full, private without the PIN, someone else's solo table). */
  FORBIDDEN: 4005,
  /** The socket's ticket was expired, already used or for somewhere else. Get a new one and reconnect. */
  TICKET: 4006,
  /** Kept breaking the rate limits. Back off. */
  RATE_LIMITED: 4008,
  /** Client and server speak different protocol versions. Reload the page. */
  VERSION: 4009,
  /** Nothing from this player for IDLE_MS (a seat is stood up first). Show the away screen; reconnect only when they come back. */
  IDLE: 4010,
} as const;

// ---------------------------------------------------------------------------------------------
// Shared shapes

export interface PlayerInfo {
  id: number;
  name: string;
  look: Look;
  /** Position in integer centimetres and yaw as a byte (0-255 = one full turn). */
  x: number;
  z: number;
  r: number;
  /** Which floor station the player is sitting at (never a private table's id). */
  at: { station: string } | null;
  /** The chair, stool, sofa place or bench the player sits on (seats.ts), if any. */
  seat?: string | null;
  /** v7: driving this car (items.ts CARS id): drawn in it, not on foot. */
  car?: string | null;
  /** v7: the car they last got out of, left where they parked it (cm, yaw byte). */
  parked?: Parked | null;
  /** v7: the gun they have drawn (arms.ts GUNS id), if any. */
  gun?: string | null;
}

/** v7: a car someone got out of and left: which, and where (cm, yaw byte). */
export interface Parked {
  car: string;
  x: number;
  z: number;
  r: number;
}

export interface LobbySummary {
  tableId: string;
  game: GameId;
  variant: string;
  leader: string;
  players: number;
  max: number;
  started: boolean;
  /** The table's minimum and maximum bet (Hold'em: its blinds), chosen when it was created. */
  limits?: TableLimits;
}

export interface Member {
  accountId: number;
  name: string;
  look: Look;
  seat: number | null;
  joinedAt: number;
  connected: boolean;
  ready: boolean;
  status: SeatStatus;
  stack: Cents;
}

export type SeatStatus = 'watching' | 'buying_in' | 'seated' | 'cashing_out';

export interface TableMeta {
  tableId: string;
  game: GameId;
  variant: string;
  mode: TableMode;
  visibility: 'public' | 'private';
  /** Only sent to members of the table. */
  pin?: string;
  started: boolean;
  config: TableConfig;
}

export interface GameStats {
  rounds: number;
  wagered: Cents;
  net: Cents;
  biggestWin: Cents;
}

export interface Profile {
  id: number;
  name: string;
  look: Look;
  createdAt: number;
  balance: Cents;
  inPlay: Cents;
  rev: number;
  tables: { tableId: string; game: GameId | null; escrow: Cents; stack?: Cents }[];
  loansTaken: number;
  loans: { amount: Cents; at: number }[];
  stats: { total: GameStats; games: Partial<Record<GameId, GameStats>> };
  /** v6: every worn item and emote the account has, bought or earned (ids from items.ts). */
  owned?: string[];
  /** v6: the feats earned (feats.ts), oldest first, with the cash each paid. */
  feats?: { feat: string; at: number; paid?: Cents }[];
  // v6 bank6: what's in the bank (shared/src/bank.ts), and net worth
  bank?: ProfileBank;
}

// v6 bank6: the bank on the profile. `worth` = balance + inPlay + savings + deposits + fundValue.
export interface ProfileBank {
  savings: Cents;
  /** Principal in open term deposits. */
  deposits: Cents;
  /** The Casino Index at what it cost, and at the price last written. */
  fundCost: Cents;
  fundValue: Cents;
  /** Money the bank made or took in all: interest, the fund's gains and losses, transfers in less out. */
  gain: Cents;
  worth: Cents;
}

// ---------------------------------------------------------------------------------------------
// HTTP

export interface LoginRequest {
  name: string;
  /** 4-64 characters (shared/src/password.ts); sets the password of a new or unclaimed name */
  password: string;
}
export interface LoginResponse {
  token: string;
  profile: Profile;
}
export interface MeResponse {
  profile: Profile;
}
export interface LookRequest {
  look: Look;
}
export interface LoanResponse {
  profile: Profile;
  loan: { amount: Cents; at: number };
}
export interface CreateTableRequest {
  game: GameId;
  variant?: string;
  visibility: 'public' | 'private';
  /** The table's limits (shared/src/limits.ts); the server moves them to the nearest allowed. Standard if left out. */
  limits?: TableLimits;
}
export interface CreateTableResponse {
  tableId: string;
  pin?: string;
}
export interface JoinByPinRequest {
  pin: string;
}
export interface JoinByPinResponse {
  tableId: string;
  game: GameId;
  /** The table as its list row would show it (leader, seats, limits), so the join can say what it is first. */
  lobby?: LobbySummary;
}
/**
 * A ticket for one socket: `target` is the path it opens ('floor', 'table/<tableId>',
 * 'solo/<game>'). It is good for one connection, within a minute; the 30-day token itself never
 * travels in a URL.
 */
export interface TicketRequest {
  target: string;
}
export interface TicketResponse {
  ticket: string;
  /** Server time it stops working. */
  exp: number;
}
export interface HttpError {
  error: ErrorCode;
  msg: string;
  balance?: Cents;
  inPlay?: Cents;
  /** v6 bot6: refused because the Quick check is waiting (open it: GET /api/check). */
  check?: true;
}

// v6 stats6: the leaderboards (GET /leaderboard), in the order the sheet shows them, grouped
// money, play, then today and this week. What each one counts is in shared/src/stats.ts.
export const LEADERBOARDS = [
  'richest', 'netUp', 'netDown', 'won', 'lost', 'wagered', 'biggestWin', 'biggestLoss',
  'rounds', 'winRate', 'streak', 'feats', 'celebs', 'collection',
  'today', 'todayDown', 'week', 'weekDown',
] as const;
export type LeaderboardId = (typeof LEADERBOARDS)[number];

/** The boards one game has (GET /leaderboard?game=<id>), in the order the sheet shows them. */
export const GAME_LEADERBOARDS = ['netUp', 'netDown', 'won', 'lost', 'biggestWin', 'biggestLoss', 'rounds', 'winRate'] as const satisfies readonly LeaderboardId[];
export type GameLeaderboardId = (typeof GAME_LEADERBOARDS)[number];

/** How many places each board lists. */
export const LEADERBOARD_TOP = 10;

export interface LeaderboardRow {
  /** 1 is first; players on the same value share a place (1, 2, 2, 4). */
  rank: number;
  name: string;
  /**
   * Cents on the money boards (negative on netDown, todayDown and weekDown), a count on rounds,
   * streak, feats and celebs, basis points (5234 = 52.34%) on winRate.
   */
  value: number;
  /** winRate: the rounds the rate is out of. */
  of?: number;
  /** The player who asked. */
  you?: true;
}

export interface Leaderboard {
  top: LeaderboardRow[];
  /**
   * The asker's own place when it isn't in `top` (null when it is). `rank` is null while there
   * is nothing to rank: no money, no win yet, too few rounds for a win rate...
   */
  you: { rank: number | null; name: string; value: number; of?: number } | null;
}

export interface LeaderboardResponse {
  /** Every board in LEADERBOARDS, or with `game`, every board in GAME_LEADERBOARDS. */
  boards: Partial<Record<LeaderboardId, Leaderboard>>;
  /** The game these boards are for; absent for the casino-wide boards. */
  game?: GameId;
  /** How old the boards are, in ms: the server reads them at most about once a minute. */
  age: number;
}

/** One line of a player's record (GET /stats): all games, or one. */
export interface StatLine {
  /** Lifetime, from the cash-outs (casino_stats): every round ever played. */
  rounds: number;
  wagered: Cents;
  net: Cents;
  biggestWin: Cents;
  /**
   * From the round tallies, which began with v6 (casino_tally): rounds with money on them,
   * those that made a profit, what the winning rounds won and the losing rounds lost, and the
   * worst single round.
   */
  counted: number;
  wins: number;
  won: Cents;
  lost: Cents;
  biggestLoss: Cents;
}

/** GET /stats: the asker's own record for the stats sheet. Nobody else's is ever sent. */
export interface StatsResponse {
  name: string;
  createdAt: number;
  worth: { balance: Cents; inPlay: Cents; total: Cents };
  total: StatLine;
  games: Partial<Record<GameId, StatLine>>;
  /** Net per casino day (Las Vegas), oldest first, STATS_DAYS of them ending today; 0 on a quiet day. */
  days: { day: string; net: Cents }[];
  /** Longest run of winning rounds at one table. */
  streak: number;
  feats: number;
  celebs: number;
  /** What the things you keep cost: worn pieces, rides, cars, the statue. */
  collection: Cents;
}
// v6 stats6: end

// ---------------------------------------------------------------------------------------------
// Floor socket

/**
 * Quick emotes: a gesture over your character that everyone on the floor sees. No free text. New
 * ones go on the end, so each keeps its place on the wheel. Everyone has the free six; the shop
 * sells SHOP_EMOTES and feats give REWARD_EMOTES (names and prices in items.ts EMOTE_ITEMS). The
 * floor only passes on an emote the account has (the free ones, or a casino_items / reward row).
 */
export const FREE_EMOTES = ['wave', 'cheer', 'clap', 'thumbs', 'shrug', 'sixseven'] as const;
export const SHOP_EMOTES = ['throwback', 'griddy', 'floss', 'dab', 'robot', 'backflip', 'moneyfan', 'bow'] as const;
export const REWARD_EMOTES = ['trophy', 'moonwalk'] as const;
export const EMOTES = [...FREE_EMOTES, ...SHOP_EMOTES, ...REWARD_EMOTES] as const;
export type EmoteId = (typeof EMOTES)[number];

/**
 * A round the floor announces (server/src/floor/wins.ts): it returned at least 25 times the stake
 * and $100 or more, or won $5,000 or more.
 */
export interface BigWin {
  name: string;
  game: GameId;
  /** Cents won in the round: returned minus wagered, the way the leaderboard counts a win. */
  amount: Cents;
  /** What paid, in a few words: "Straight 17", "Royal Flush", "Neon Nights, 250x". */
  what: string;
  /**
   * Server time the result shows at its table (the ball drops, the reels stop). Clients hold the
   * news until then, so nobody hears about a win before the winner sees it.
   */
  at: number;
  /** The floor station it happened at ("slots-neon-2", "rl-us"), when the table has one. */
  station?: string;
}

/** Every big win so far today, casino time (Las Vegas), announced or not. */
export interface WinsToday {
  /** YYYY-MM-DD. */
  day: string;
  total: Cents;
  count: number;
}

export type FloorClientMsg =
  | { t: 'mv'; x: number; z: number; r: number }
  | { t: 'st'; x: number; z: number; r: number }
  | { t: 'watch'; game: GameId | null }
  | { t: 'emote'; e: EmoteId }
  // sitting down on a floor seat (seats.ts): where it is, which way it faces; and getting up
  | { t: 'sit'; seat: string; x: number; z: number; r: number }
  | { t: 'stand' }
  /** The player is at the keyboard (see HERE_MS); keeps the socket from going idle. */
  | { t: 'here' }
  // v6: take the elevator to another zone (zones.ts); only from beside an elevator door
  | { t: 'lift'; to: ZoneId }
  | InviteClientMsg // v6 invite6
  // v6 law6: throw a punch, facing `r` (yaw byte); the server finds who it lands on
  | { t: 'punch'; r: number }
  // v7: get into a car you own (its id), or out of the one you're driving (null: left where you are)
  | { t: 'drive'; car: string | null }
  // v7: draw a gun you own, or put it away (null); fire the drawn one along `r` (yaw byte)
  | { t: 'draw'; gun: string | null }
  | { t: 'shoot'; r: number };

export type FloorServerMsg =
  | { t: 'hello'; v: number; you: PlayerInfo; players: PlayerInfo[]; online: number; now: number }
  /** Walkers who moved: `age` is ms since that position reached the server (it lands at ts - age). */
  | { t: 's'; ts: number; p: [id: number, x: number, z: number, r: number, moving: 0 | 1, age?: number][] }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'player'; id: number; look?: Look; at?: { station: string } | null; seat?: string | null; car?: string | null; parked?: Parked | null; gun?: string | null }
  // a seat you asked for and didn't get (someone got there first, or it's out of reach)
  | { t: 'seat.no'; seat: string; msg: string }
  | { t: 'online'; n: number }
  | { t: 'lobbies'; game: GameId; list: LobbySummary[] }
  | { t: 'lobby'; game: GameId; lobby: LobbySummary }
  | { t: 'lobby.gone'; game: GameId; tableId: string }
  | { t: 'emote'; id: number; e: EmoteId }
  // big wins: one as it happens, and the recent ones (newest first) right after hello
  | ({ t: 'bigwin'; today: WinsToday } & BigWin)
  | { t: 'bigwins'; list: BigWin[]; today: WinsToday }
  // v6: an effect bought in the shop (items.ts FxEvent); the ones still playing right after hello
  | ({ t: 'fx' } & FxEvent)
  | { t: 'fxs'; list: FxEvent[] }
  // v6: the lobby's statues, newest first (after hello, and when someone buys one)
  | { t: 'statues'; list: Statue[] }
  // v6: someone earned an achievement or finished a challenge (feats.ts); for the feed
  | { t: 'feat'; id: number; name: string; feat: string }
  // v6: you own an emote now (bought or earned while connected): the wheel adds it
  | { t: 'owned'; emotes: EmoteId[] }
  // v6: the server moved you (the elevator, jail, release): go there at once (cm, yaw byte)
  | { t: 'tp'; x: number; z: number; r: number }
  | InviteServerMsg // v6 invite6
  // v6 cars6: a car called to the valet's curb (or sent back: until has passed); the ones at the curb after hello
  | ({ t: 'car' } & CarCall)
  | { t: 'cars'; list: CarCall[] }
  // v6 cars6: end
  // v6 city6: the elevator won't go (not at its doors, at a table, held): why, in words
  | { t: 'lift.no'; to: ZoneId; msg: string }
  // v6 law6: a punch (who threw it, and who or which staff member it landed on, null for air);
  // a member of staff leaving his loop (shared/src/law/patrol.ts), and the ones under way after
  // hello; a warning, a lock-up or a release; and your own time in jail (null: you're free)
  | { t: 'punch'; id: number; hit: number | StaffId | null }
  // v7: a shot (who fired, along which way, what it hit first and how far away, or null and the gun's reach)
  | { t: 'shot'; id: number; r: number; hit: number | StaffId | null; d: number }
  // v7: you own more now (bought while connected): guns, cars and your apartment's step, for the floor's checks
  | { t: 'kit'; guns?: string[]; cars?: string[]; home?: number }
  | { t: 'detour'; d: Detour }
  | { t: 'detours'; list: Detour[] }
  | { t: 'law'; ev: LawEvent }
  | { t: 'jail'; jail: JailState | null }
  // v6 bank6: another player sent you money (shared/src/bank.ts); only to you
  | { t: 'bank.in'; id: string; from: string; amount: Cents; note: string | null; at: number }
  | { t: 'err'; code: ErrorCode; msg: string }
  | ChatServerMsg;

/**
 * Floor bounds in centimetres; positions outside are clamped. The building's outer walls
 * (client/src/world/rooms.ts): x from -31.15 m to 31.15 m, z from -43.15 m (the north wing:
 * pachinko, the Jade Room, bingo) to 15.15 m (the doors).
 */
// (v6 city6: maxZ takes in the elevator car behind the lobby's street doors, to 17 m)
export const FLOOR_BOUNDS = { minX: -3120, maxX: 3120, minZ: -4320, maxZ: 1700 } as const;

/** v7: an item id on the wire (a car's, a gun's): short, plain. */
function isShortId(x: unknown): x is string {
  return typeof x === 'string' && /^[a-z0-9-]{2,32}$/.test(x);
}

export function parseFloorMsg(raw: unknown, isGame: (g: unknown) => g is GameId): FloorClientMsg | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'mv':
    case 'st':
      if (!isInt(raw.x) || !isInt(raw.z) || !isInt(raw.r) || raw.r < 0 || raw.r > 255) return null;
      return { t: raw.t, x: raw.x, z: raw.z, r: raw.r };
    case 'watch':
      if (raw.game !== null && !isGame(raw.game)) return null;
      return { t: 'watch', game: raw.game as GameId | null };
    case 'lift':
      if (raw.to !== 'casino' && raw.to !== 'ground' && raw.to !== 'roof' && raw.to !== 'home') return null;
      return { t: 'lift', to: raw.to };
    // v7:
    case 'drive':
      if (raw.car !== null && !isShortId(raw.car)) return null;
      return { t: 'drive', car: raw.car as string | null };
    case 'draw':
      if (raw.gun !== null && !isShortId(raw.gun)) return null;
      return { t: 'draw', gun: raw.gun as string | null };
    case 'shoot':
      if (!isInt(raw.r) || raw.r < 0 || raw.r > 255) return null;
      return { t: 'shoot', r: raw.r };
    case 'emote':
      if (!isOneOf(raw.e, EMOTES)) return null;
      return { t: 'emote', e: raw.e };
    case 'sit':
      if (!isSeatId(raw.seat) || !isInt(raw.x) || !isInt(raw.z) || !isInt(raw.r) || raw.r < 0 || raw.r > 255) return null;
      return { t: 'sit', seat: raw.seat, x: raw.x, z: raw.z, r: raw.r };
    case 'stand':
      return { t: 'stand' };
    case 'here':
      return { t: 'here' };
    // v6 law6:
    case 'punch':
      if (!isInt(raw.r) || raw.r < 0 || raw.r > 255) return null;
      return { t: 'punch', r: raw.r };
    default:
      return parseInviteMsg(raw); // v6 invite6
  }
}

// v6 invite6: ----------------------------------------------------------------------------------
// Invites to a lobby table (server/src/floor/invites.ts). A player at a lobby table invites some
// of the players on the floor, or everyone; each invitee hears `invited` with what the table is
// and who asked. Joining is `invite.take`: the floor checks the invite is theirs and still good,
// that the table is open and has room, moves them next to it, and answers `invite.go` with the
// table (and a private table's current PIN, which only an invitee ever gets this way). A decline
// is saying nothing. The PIN never rides in `invited`.

/** An invite is good for this long. */
export const INVITE_MS = 2 * 60_000;
/** The most players one invite names. */
export const INVITE_MAX_TO = 10;

export interface Invite {
  id: string;
  from: { id: number; name: string };
  tableId: string;
  game: GameId;
  variant: string;
  private: boolean;
  /** "Invite everyone" rather than you by name. */
  all: boolean;
  /** Leader, seats and limits as the table said when the invite went out. */
  lobby: LobbySummary;
  /** The floor station the table stands at (the inviter's), when the floor knows it. */
  station: string | null;
  at: number;
  until: number;
}

/** Why an invite didn't reach someone it named. */
export type InviteSkip = 'offline' | 'away' | 'dnd' | 'recent' | 'busy';

export type InviteClientMsg =
  /** Invite players by id, or everyone on the floor; a private table's PIN proves you can. */
  | { t: 'invite'; table: string; pin?: string; to: number[] | 'all' }
  /** Join the table an invite is for; (x, z, r) is where to stand, beside it (cm, yaw byte). */
  | { t: 'invite.take'; id: string; x: number; z: number; r: number }
  /** Do not disturb: no invites reach you while it's on (the client says so after every hello). */
  | { t: 'invite.dnd'; on: boolean };

export type InviteServerMsg =
  | { t: 'invited'; invite: Invite }
  /** To the inviter: how many it reached, and why any it named it didn't. `again`: when "everyone" is open again. */
  | { t: 'invite.sent'; table: string; all: boolean; sent: number; skipped: { id: number; name: string; why: InviteSkip }[]; again?: number }
  /** An invite or a join refused; `id` is the invite a join was for. `again`: when to try again. */
  | { t: 'invite.no'; id?: string; table?: string; code: ErrorCode; msg: string; again?: number }
  /** Yours to join: the table, its PIN if private, and where the floor has put you (cm, yaw byte). */
  | { t: 'invite.go'; id: string; tableId: string; game: GameId; variant: string; pin?: string; station: string | null; x: number; z: number; r: number };

const INVITE_ID_RE = /^[a-z0-9]{12}$/;

export function isInviteId(x: unknown): x is string {
  return typeof x === 'string' && INVITE_ID_RE.test(x);
}

function parseInviteMsg(raw: Record<string, unknown>): InviteClientMsg | null {
  switch (raw.t) {
    case 'invite': {
      if (typeof raw.table !== 'string' || raw.table.length > 40) return null;
      if (raw.pin !== undefined && (typeof raw.pin !== 'string' || !/^\d{4}$/.test(raw.pin))) return null;
      let to: number[] | 'all';
      if (raw.to === 'all') to = 'all';
      else if (Array.isArray(raw.to) && raw.to.length >= 1 && raw.to.length <= INVITE_MAX_TO && raw.to.every((id) => isInt(id) && id > 0)) to = [...new Set(raw.to as number[])];
      else return null;
      return { t: 'invite', table: raw.table, ...(raw.pin !== undefined ? { pin: raw.pin as string } : {}), to };
    }
    case 'invite.take':
      if (!isInviteId(raw.id) || !isInt(raw.x) || !isInt(raw.z) || !isInt(raw.r) || raw.r < 0 || raw.r > 255) return null;
      return { t: 'invite.take', id: raw.id, x: raw.x, z: raw.z, r: raw.r };
    case 'invite.dnd':
      if (typeof raw.on !== 'boolean') return null;
      return { t: 'invite.dnd', on: raw.on };
    default:
      return null;
  }
}
// ---------------------------------------------------------------------------------- v6 invite6

// ---------------------------------------------------------------------------------------------
// Table socket

export type TableClientMsg =
  | { t: 'buyin'; aid: string; amount: Cents }
  | { t: 'topup'; aid: string; amount: Cents }
  | { t: 'cashout'; aid: string }
  /** v6.1: chips from your stack for the dealer (shared/src/tip.ts). */
  | { t: 'tip'; aid: string; amount: Cents }
  | { t: 'act'; aid: string; a: unknown }
  | { t: 'ready'; on: boolean }
  | { t: 'visibility'; visibility: 'public' | 'private' }
  | { t: 'start' }
  | { t: 'leave' }
  | { t: 'sync' }
  /** The player is at the keyboard (see HERE_MS); keeps the seat from going idle. */
  | { t: 'here' };

export type TableServerMsg =
  | {
      t: 'table';
      v: number;
      meta: TableMeta;
      members: Member[];
      leader: number | null;
      you: { accountId: number; seat: number | null; status: SeatStatus; stack: Cents };
      view: unknown;
      seq: number;
      now: number;
    }
  | { t: 'members'; members: Member[]; leader: number | null; visibility: 'public' | 'private'; pin?: string; started: boolean }
  | { t: 'ev'; seq: number; events: unknown[]; view: unknown; now: number }
  | { t: 'seat'; status: SeatStatus; stack: Cents; escrow: Cents; seat: number | null }
  | { t: 'balance'; balance: Cents; inPlay: Cents; rev: number }
  /**
   * v6: you earned an achievement or finished a challenge at this table (feats.ts). A cash
   * reward went to your balance (a 'grant' ledger row): `paid` is how much (it scales with the
   * round's stake, feats.ts cashFor) and `balance` is the money after it.
   */
  | { t: 'feat'; feat: string; at: number; balance?: { balance: Cents; inPlay: Cents; rev: number }; paid?: Cents }
  /** v6.1: someone at the table tipped the dealer (everyone at it hears, for the dealer's thanks). */
  | { t: 'tipped'; accountId: number; name: string; amount: Cents }
  | { t: 'closed'; reason: string }
  | { t: 'err'; ref?: string; code: ErrorCode; msg: string }
  | CheckTableMsg // v6 bot6
  | ChatServerMsg;

// v6 bot6: the Quick check (server/src/fair.ts). A table sends `check` at a natural pause (no
// chips of yours on the layout) once the check is due; until it's passed that account can't bet
// or buy in anywhere, and cashing out works as always. The check itself is GET/POST /api/check.
export type CheckTableMsg = { t: 'check' };
/** What the player sees on every refusal while a check is waiting (never "bot"). */
export const CHECK_MSG = 'Quick check to keep the tables fair.';
export type CheckState = 'ok' | 'due' | 'paused';
export type CheckChallenge =
  /** Drag the chip onto the ring the picture names; `png` is base64, `w` x `h` pixels. */
  | { kind: 'chip'; id: string; png: string; w: number; h: number; chip: { x: number; y: number }; expires: number }
  /** Cloudflare Turnstile, when the site has it set up; `chip` is the fallback if it won't load. */
  | { kind: 'turnstile'; id: string; sitekey: string; expires: number };
/** GET /api/check: where you stand, and a challenge if one is waiting (after `wait`, ms epoch). */
export interface CheckResponse {
  state: CheckState;
  wait?: number;
  challenge?: CheckChallenge;
}
/** POST /api/check {id, x, y} or {id, token}: passed, or not (and when the next try may start). */
export interface CheckAnswerResponse {
  ok: boolean;
  state: CheckState;
  wait?: number;
}
// v6 bot6: end

const AID_RE = /^[A-Za-z0-9_-]{1,24}$/;

export function parseTableMsg(raw: unknown): TableClientMsg | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case 'buyin':
    case 'topup':
      if (!isAid(raw.aid) || !isInt(raw.amount) || raw.amount <= 0) return null;
      return { t: raw.t, aid: raw.aid, amount: raw.amount };
    case 'cashout':
      if (!isAid(raw.aid)) return null;
      return { t: 'cashout', aid: raw.aid };
    case 'tip':
      if (!isAid(raw.aid) || !isInt(raw.amount) || raw.amount <= 0) return null;
      return { t: 'tip', aid: raw.aid, amount: raw.amount };
    case 'act':
      if (!isAid(raw.aid) || raw.a === undefined) return null;
      return { t: 'act', aid: raw.aid, a: raw.a };
    case 'ready':
      if (typeof raw.on !== 'boolean') return null;
      return { t: 'ready', on: raw.on };
    case 'visibility':
      if (raw.visibility !== 'public' && raw.visibility !== 'private') return null;
      return { t: 'visibility', visibility: raw.visibility };
    case 'start':
    case 'leave':
    case 'sync':
    case 'here':
      return { t: raw.t };
    default:
      return null;
  }
}

/** Inbound frame caps, checked before JSON.parse. */
export const MAX_FLOOR_FRAME = 512;
export const MAX_TABLE_FRAME = 4096;

// ---------------------------------------------------------------------------------------------
// Chat, on both sockets: the floor's room (everyone on the floor) and each lobby table's room
// (its members). Text only. The server cleans every line with cleanChat, masks a short list of
// words, and signs it with the name on the account; the client never names the speaker.

/** The longest line, in characters (code points) once cleaned. */
export const CHAT_MAX = 200;
/** Lines a room keeps for whoever arrives next. */
export const CHAT_HISTORY = 30;
/** Lines one account may say in a burst, then lines per second after it (per room). */
export const CHAT_BURST = 3;
export const CHAT_PER_S = 1;

export interface ChatLine {
  /** Counts up by one per line in its room, so a reconnect's backlog can skip lines already shown. */
  n: number;
  /** The speaker's account id and name, both from their token. */
  id: number;
  name: string;
  text: string;
  /** Server time. */
  at: number;
}

export type ChatClientMsg = { t: 'say'; text: string };

export type ChatServerMsg =
  /** New lines; `backlog` marks the room's last lines, sent once right after joining it. */
  | { t: 'chat'; lines: ChatLine[]; backlog?: true }
  /** Why your last line didn't go out. A mute ends at `until` (server time). */
  | { t: 'chat.no'; code: 'RATE_LIMITED' | 'MUTED' | 'BAD_REQUEST'; msg: string; until?: number; now: number };

export function parseSay(raw: unknown): ChatClientMsg | null {
  // Generous: an emoji is two UTF-16 units, and cleaning (not this) decides what counts.
  if (!isObj(raw) || raw.t !== 'say' || typeof raw.text !== 'string' || raw.text.length > CHAT_MAX * 4) return null;
  return { t: 'say', text: raw.text };
}

/**
 * Invisible characters that can disguise a line: lone surrogates, the soft hyphen, zero-width
 * spaces and joiners that aren't needed (ZWJ and ZWNJ stay, for emoji and scripts), and every
 * bidi control (an override would run the rest of the line, or the next name, backwards).
 */
const INVISIBLE = /[\p{Cc}\p{Cs}\u00ad\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufff9-\ufffb]/gu;

/**
 * A chat line the way a room shows it: NFC, every whitespace character a plain space and runs of
 * them one space, control and invisible characters removed, a pile of combining marks (the
 * "zalgo" trick that draws over the lines around it) cut to four, trimmed. Null when nothing is
 * left or it's over CHAT_MAX characters. The server applies it to every line; the client uses it
 * to send only what the server would take.
 */
export function cleanChat(text: string): string | null {
  const out = text
    .normalize('NFC')
    .replace(/[\s\u0085]/gu, ' ')
    .replace(INVISIBLE, '')
    .replace(/ {2,}/g, ' ')
    .replace(/(\p{M}{4})\p{M}+/gu, '$1')
    .trim();
  const n = [...out].length;
  return n >= 1 && n <= CHAT_MAX ? out : null;
}

// ---------------------------------------------------------------------------------------------
// Small validators, shared by the game modules' parseAction functions.

export function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x);
}

export function isAid(x: unknown): x is string {
  return typeof x === 'string' && AID_RE.test(x);
}

/** A positive integer number of cents. */
export function isAmount(x: unknown): x is Cents {
  return isInt(x) && x > 0;
}

export function isOneOf<T extends string>(x: unknown, options: readonly T[]): x is T {
  return typeof x === 'string' && (options as readonly string[]).includes(x);
}
