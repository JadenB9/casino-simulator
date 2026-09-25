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
import { isSeatId } from './seats.ts';
import type { TableLimits } from './limits.ts';

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
  /** v6: the feats earned (feats.ts), oldest first. */
  feats?: { feat: string; at: number }[];
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
}

/** The leaderboards (GET /leaderboard), in the order the sheet shows them. */
export const LEADERBOARDS = ['richest', 'biggestWin', 'rounds'] as const;
export type LeaderboardId = (typeof LEADERBOARDS)[number];

/** How many places each board lists. */
export const LEADERBOARD_TOP = 10;

export interface LeaderboardRow {
  /** 1 is first; players on the same value share a place (1, 2, 2, 4). */
  rank: number;
  name: string;
  /** Cents on richest (balance plus chips on tables) and biggestWin; a count on rounds. */
  value: number;
  /** The player who asked. */
  you?: true;
}

export interface Leaderboard {
  top: LeaderboardRow[];
  /**
   * The asker's own place when it isn't in `top` (null when it is). `rank` is null while there
   * is nothing to rank: no money, no win yet, no rounds yet.
   */
  you: { rank: number | null; name: string; value: number } | null;
}

export interface LeaderboardResponse {
  boards: Record<LeaderboardId, Leaderboard>;
  /** How old the boards are, in ms: the server reads them at most about once a minute. */
  age: number;
}

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
  | { t: 'lift'; to: ZoneId };

export type FloorServerMsg =
  | { t: 'hello'; v: number; you: PlayerInfo; players: PlayerInfo[]; online: number; now: number }
  /** Walkers who moved: `age` is ms since that position reached the server (it lands at ts - age). */
  | { t: 's'; ts: number; p: [id: number, x: number, z: number, r: number, moving: 0 | 1, age?: number][] }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'player'; id: number; look?: Look; at?: { station: string } | null; seat?: string | null }
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
  | { t: 'err'; code: ErrorCode; msg: string }
  | ChatServerMsg;

/**
 * Floor bounds in centimetres; positions outside are clamped. The building's outer walls
 * (client/src/world/rooms.ts): x from -31.15 m to 31.15 m, z from -31.15 m (the back rooms) to
 * 15.15 m (the doors).
 */
export const FLOOR_BOUNDS = { minX: -3120, maxX: 3120, minZ: -3120, maxZ: 1520 } as const;

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
      if (raw.to !== 'casino' && raw.to !== 'ground' && raw.to !== 'roof') return null;
      return { t: 'lift', to: raw.to };
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
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Table socket

export type TableClientMsg =
  | { t: 'buyin'; aid: string; amount: Cents }
  | { t: 'topup'; aid: string; amount: Cents }
  | { t: 'cashout'; aid: string }
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
   * reward went to your balance (a 'grant' ledger row) and `balance` is the money after it.
   */
  | { t: 'feat'; feat: string; at: number; balance?: { balance: Cents; inPlay: Cents; rev: number } }
  | { t: 'closed'; reason: string }
  | { t: 'err'; ref?: string; code: ErrorCode; msg: string }
  | ChatServerMsg;

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
