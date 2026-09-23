// What the casino offers: names, seats, variants. Server and client read the same list.

import type { GameId } from '../engine.ts';

export interface Variant {
  id: string;
  name: string;
}

export interface GameInfo {
  id: GameId;
  name: string;
  /** Two letters, used in lobby table ids ("bj-k3x9d0q2mz"). */
  prefix: string;
  seats: { min: number; max: number };
  /** Machines are one player each; tables offer Single player and Multiplayer. */
  multiplayer: boolean;
  variants: Variant[];
  /** Hidden from the floor and the lobby list (test fixture). */
  dev?: true;
}

export const CATALOG: Record<GameId, GameInfo> = {
  blackjack: { id: 'blackjack', name: 'Blackjack', prefix: 'bj', seats: { min: 1, max: 7 }, multiplayer: true, variants: [] },
  roulette: {
    id: 'roulette',
    name: 'Roulette',
    prefix: 'rl',
    seats: { min: 1, max: 8 },
    multiplayer: true,
    variants: [
      { id: 'american', name: 'American' },
      { id: 'european', name: 'European' },
    ],
  },
  craps: { id: 'craps', name: 'Craps', prefix: 'cr', seats: { min: 1, max: 8 }, multiplayer: true, variants: [] },
  baccarat: { id: 'baccarat', name: 'Baccarat', prefix: 'bc', seats: { min: 1, max: 7 }, multiplayer: true, variants: [] },
  slots: {
    id: 'slots',
    name: 'Slots',
    prefix: 'sl',
    seats: { min: 1, max: 1 },
    multiplayer: false,
    variants: [
      { id: 'sevens', name: 'Classic Sevens' },
      { id: 'neon', name: 'Neon Nights' },
      { id: 'wild', name: '5x Wild' },
    ],
  },
  videopoker: { id: 'videopoker', name: 'Video Poker', prefix: 'vp', seats: { min: 1, max: 1 }, multiplayer: false, variants: [] },
  threecard: { id: 'threecard', name: 'Three Card Poker', prefix: 'tc', seats: { min: 1, max: 6 }, multiplayer: true, variants: [] },
  holdem: { id: 'holdem', name: "Texas Hold'em", prefix: 'he', seats: { min: 2, max: 9 }, multiplayer: true, variants: [] },
  highcard: { id: 'highcard', name: 'High Card', prefix: 'hc', seats: { min: 1, max: 6 }, multiplayer: true, variants: [], dev: true },
};

export function gameInfo(id: GameId): GameInfo {
  return CATALOG[id];
}

export function isGameId(x: unknown): x is GameId {
  return typeof x === 'string' && Object.hasOwn(CATALOG, x);
}

/** The variant to use when none (or an unknown one) is asked for. */
export function variantOf(id: GameId, asked: unknown): string {
  const vs = CATALOG[id].variants;
  if (vs.length === 0) return '';
  return vs.find((v) => v.id === asked)?.id ?? vs[0]!.id;
}

/** Lobby tables: game prefix + 10 base-36 characters (about 52 bits), so they can't be guessed. */
export const TABLE_ID_RE = /^(bj|rl|cr|bc|sl|vp|tc|he|hc)-[a-z0-9]{10}$/;

/** Solo sessions are named by the server from the player's token, never by the client. */
export function soloTableName(game: GameId, variant: string, accountId: number): string {
  return `solo:${game}:${variant || '-'}:${accountId}`;
}
