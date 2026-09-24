// What the floor's life modules share: the crew, their speech, the waiters' grid, the building's
// points, the walker, the shared clock, and the app's side of things (null on the dev floor).

import type * as THREE from 'three';
import type { Crew } from './crew.ts';
import type { Speech } from './speech.ts';
import type { NavGrid } from './nav.ts';
import type { LifePoints } from '../life-points.ts';
import type { Player } from '../player.ts';

/** The app's side: who you are, its menus, the bar's hand-over, and whether you're at a table. */
export interface LifeApp {
  /** Your name, for a greeting. */
  name(): string | null;
  /** The bar's menu (a waiter's, or the counter's). */
  openBarMenu(): void;
  /** The boutique, at a piece if given. */
  openShop(item?: string): void;
  /** A paid order goes into your hand (world.holdItem). */
  holdItem(orderId: string): void;
  /** At a game table (an order waits until you stand up). */
  atTable(): boolean;
}

export interface LifeCtx {
  crew: Crew;
  speech: Speech;
  grid: NavGrid;
  points: LifePoints;
  player: Player;
  camera: THREE.Camera;
  /** Seconds on the shared (server) clock. */
  now(): number;
  app(): LifeApp | null;
  /** Where the other people on the floor stand (players, you included while shown). */
  people(): readonly { x: number; z: number }[];
}
