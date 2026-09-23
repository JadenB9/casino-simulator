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

export const PROTOCOL_VERSION = 1;

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
  /** Kept breaking the rate limits. Back off. */
  RATE_LIMITED: 4008,
  /** Client and server speak different protocol versions. Reload the page. */
  VERSION: 4009,
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
}

export interface LobbySummary {
  tableId: string;
  game: GameId;
  variant: string;
  leader: string;
  players: number;
  max: number;
  started: boolean;
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
}

// ---------------------------------------------------------------------------------------------
// HTTP

export interface LoginRequest {
  name: string;
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
}
export interface HttpError {
  error: ErrorCode;
  msg: string;
  balance?: Cents;
  inPlay?: Cents;
}

// ---------------------------------------------------------------------------------------------
// Floor socket

export type FloorClientMsg =
  | { t: 'mv'; x: number; z: number; r: number }
  | { t: 'st'; x: number; z: number; r: number }
  | { t: 'watch'; game: GameId | null };

export type FloorServerMsg =
  | { t: 'hello'; v: number; you: PlayerInfo; players: PlayerInfo[]; online: number; now: number }
  | { t: 's'; ts: number; p: [id: number, x: number, z: number, r: number, moving: 0 | 1][] }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'player'; id: number; look?: Look; at?: { station: string } | null }
  | { t: 'online'; n: number }
  | { t: 'lobbies'; game: GameId; list: LobbySummary[] }
  | { t: 'lobby'; game: GameId; lobby: LobbySummary }
  | { t: 'lobby.gone'; game: GameId; tableId: string }
  | { t: 'err'; code: ErrorCode; msg: string };

/** Floor bounds in centimetres; positions outside are clamped. */
export const FLOOR_BOUNDS = { minX: -2000, maxX: 2000, minZ: -1500, maxZ: 1500 } as const;

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
  | { t: 'sync' };

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
  | { t: 'closed'; reason: string }
  | { t: 'err'; ref?: string; code: ErrorCode; msg: string };

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
      return { t: raw.t };
    default:
      return null;
  }
}

/** Inbound frame caps, checked before JSON.parse. */
export const MAX_FLOOR_FRAME = 512;
export const MAX_TABLE_FRAME = 4096;

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
