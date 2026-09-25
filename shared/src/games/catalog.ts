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
  /** Played on a computer in the online lounge rather than at a table or a machine. */
  online?: true;
  /**
   * A multiplayer table that runs on its own clock from the first seat (the wheel spins, the
   * rocket flies) instead of waiting for the leader to press Start.
   */
  autoStart?: true;
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
      { id: 'diamonds', name: 'Diamond Line' },
      { id: 'cherries', name: 'Lucky Cherries' },
      { id: 'goldrush', name: 'Gold Rush' },
    ],
  },
  videopoker: { id: 'videopoker', name: 'Video Poker', prefix: 'vp', seats: { min: 1, max: 1 }, multiplayer: false, variants: [] },
  threecard: { id: 'threecard', name: 'Three Card Poker', prefix: 'tc', seats: { min: 1, max: 6 }, multiplayer: true, variants: [] },
  holdem: { id: 'holdem', name: "Texas Hold'em", prefix: 'he', seats: { min: 2, max: 9 }, multiplayer: true, variants: [] },
  war: { id: 'war', name: 'Casino War', prefix: 'wr', seats: { min: 1, max: 6 }, multiplayer: true, variants: [] },
  bigsix: { id: 'bigsix', name: 'Big Six Wheel', prefix: 'b6', seats: { min: 1, max: 8 }, multiplayer: true, variants: [] },
  sicbo: { id: 'sicbo', name: 'Sic Bo', prefix: 'sb', seats: { min: 1, max: 8 }, multiplayer: true, variants: [] },
  plinko: { id: 'plinko', name: 'Plinko', prefix: 'pk', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  tower: { id: 'tower', name: 'Tower', prefix: 'tw', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  mines: { id: 'mines', name: 'Mines', prefix: 'mn', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  dice: { id: 'dice', name: 'Dice', prefix: 'dc', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  limbo: { id: 'limbo', name: 'Limbo', prefix: 'lb', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  keno: { id: 'keno', name: 'Keno', prefix: 'kn', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  hilo: { id: 'hilo', name: 'Hi-Lo', prefix: 'hl', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  crash: { id: 'crash', name: 'Crash', prefix: 'cs', seats: { min: 1, max: 12 }, multiplayer: true, variants: [], online: true, autoStart: true },
  banditwheel: { id: 'banditwheel', name: 'Bandit Wheel', prefix: 'bw', seats: { min: 1, max: 10 }, multiplayer: true, variants: [], autoStart: true },
  coinflip: { id: 'coinflip', name: 'Coinflip', prefix: 'cf', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  wheel: { id: 'wheel', name: 'Wheel', prefix: 'wh', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  cases: { id: 'cases', name: 'Cases', prefix: 'ca', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  diamonds: { id: 'diamonds', name: 'Diamonds', prefix: 'dm', seats: { min: 1, max: 1 }, multiplayer: false, variants: [], online: true },
  letitride: { id: 'letitride', name: 'Let It Ride', prefix: 'lr', seats: { min: 1, max: 7 }, multiplayer: true, variants: [] },
  paigow: { id: 'paigow', name: 'Pai Gow Poker', prefix: 'pg', seats: { min: 1, max: 6 }, multiplayer: true, variants: [] },
  bingo: { id: 'bingo', name: 'Bingo', prefix: 'bg', seats: { min: 1, max: 40 }, multiplayer: true, variants: [], autoStart: true },
  pachinko: { id: 'pachinko', name: 'Pachinko', prefix: 'pa', seats: { min: 1, max: 1 }, multiplayer: false, variants: [] },
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
export const TABLE_ID_RE = /^(bj|rl|cr|bc|sl|vp|tc|he|hc|wr|b6|sb|pk|tw|mn|dc|lb|kn|hl|cs|bw)-[a-z0-9]{10}$/;

/** Solo sessions are named by the server from the player's token, never by the client. */
export function soloTableName(game: GameId, variant: string, accountId: number): string {
  return `solo:${game}:${variant || '-'}:${accountId}`;
}
