// What each game's client module provides. The floor builds every station's model from
// createModel(); walking up and pressing E mounts the view on that station.

import type * as THREE from 'three';
import type { GameId } from '../../../shared/src/engine.ts';
import type { GameEvent } from '../../../shared/src/engine.ts';
import type { TableServerMsg } from '../../../shared/src/protocol.ts';
import type { Quality } from '../render/engine3d.ts';
import type { TableStage, Pose } from '../table/stage.ts';
import type { UiKit } from '../ui/kit.ts';
import type { Sfx } from '../audio/sfx.ts';

export type TableSnapshot = Extract<TableServerMsg, { t: 'table' }>;
export type SeatMsg = Extract<TableServerMsg, { t: 'seat' }>;
export type TimerMsg = Extract<TableServerMsg, { t: 'timer' }>;
export type MembersMsg = Extract<TableServerMsg, { t: 'members' }>;

/** Sends to this table. Actions get a fresh aid automatically. */
export interface TableLink {
  act(action: unknown): void;
  buyIn(amount: number): void;
  topUp(amount: number): void;
  cashOut(): void;
  ready(on: boolean): void;
}

export interface TableViewCtx {
  stage: TableStage;
  /** A container over the canvas for this game's DOM controls. */
  ui: HTMLElement;
  link: TableLink;
  kit: UiKit;
  sfx: Sfx;
  me: { accountId: number; name: string };
  variant: string;
}

export interface TableView {
  /** Full state: on joining and after any reconnect. Draw everything from `snap.view`. */
  onTable(snap: TableSnapshot): void;
  /** Animate these events (the server already decided them), then settle on `view`. */
  onEvents(events: GameEvent[], view: unknown): Promise<void> | void;
  onSeat(msg: SeatMsg): void;
  onMembers?(msg: MembersMsg): void;
  onTimer?(msg: TimerMsg, receivedAt: number): void;
  onError?(code: string, msg: string): void;
  /** Keyboard shortcuts at the table; return true when handled. */
  keydown?(e: KeyboardEvent): boolean;
  update(dt: number): void;
  dispose(): void;
}

export interface GameClientModule {
  game: GameId;
  /** The table or machine as it stands on the floor, in local coordinates (centre at origin, dealer at -z). */
  createModel(opts: { variant: string; quality: Quality }): THREE.Object3D;
  /** Footprint for floor layout and collision, metres. */
  footprint: { width: number; depth: number };
  /** Where seated players sit or stand, local coordinates; yaw faces the table. */
  seats(variant: string): { position: [number, number, number]; yaw: number }[];
  /** Where the camera goes to play. */
  playPose(variant: string, seat: number | null): Pose;
  mount(ctx: TableViewCtx): TableView;
  /** Loaded once behind the loading screen (textures, sounds). */
  preload?(): Promise<void>;
}
