// What the rest of the client needs from the world: the scene with the floor in it, the
// stations people walk up to, and characters. The world module (client/src/world/) provides a
// real casino floor; dev-room.ts is the bare stand-in the dev harness uses.

import type * as THREE from 'three';
import type { GameId } from '../../../shared/src/engine.ts';
import type { Look } from '../../../shared/src/look.ts';
import type { EmoteId } from '../../../shared/src/protocol.ts';

export interface Station {
  /** Stable id, sent to the server as "who is sitting where" (e.g. "bj-1", "slots-sevens-3"). */
  id: string;
  game: GameId;
  variant: string;
  /** Where the table or machine stands; its model and table view are children of this. */
  anchor: THREE.Object3D;
}

export interface Character {
  root: THREE.Object3D;
  setLook(look: Look): void;
  /** 0 = idle, 1 = walking; blends the animations. */
  setMotion(speed: number): void;
  setName(name: string): void;
  update(dt: number): void;
  dispose(): void;
  /** Act out an emote for a moment (a wave, a hop), if the character can. */
  gesture?(e: EmoteId): void;
  /** Sit on a seat this high above the feet (metres), or stand again with null, if the character can. */
  sit?(seatTop: number | null): void;
}

export interface CharacterFactory {
  create(look: Look, name: string): Character;
}

// --- added by the world module (additive) ------------------------------------------------------

/** The cashier counter: game-less, so it isn't a Station; using it fires World.onCashier. */
export interface CashierPoint {
  id: 'cashier';
  /** A marker at the middle of the counter's front (floor level, facing the player). */
  anchor: THREE.Object3D;
  /** Where a player stands to use it (floor level). */
  position: THREE.Vector3;
}

export interface CharacterFactoryExt extends CharacterFactory {
  /** Resolves once the model for this look is loaded (create() never waits; it fills in when ready). */
  load(look: Look): Promise<void>;
}

/** What createWorld() returns; see client/src/world/README.md. */
export interface World {
  stations: (Station & { name: string; limits: string; footprint: { width: number; depth: number } })[];
  cashier: CashierPoint;
  characterFactory: CharacterFactoryExt;
  player: {
    character: Character;
    /** Live position (floor level); read it, don't write it. */
    position: THREE.Vector3;
    /** Hand the keyboard and camera to someone else (a panel, a table) and back. */
    setEnabled(on: boolean): void;
    /** For presence, every frame: floor position, facing (Object3D.rotation.y; PI faces -z) and whether walking. */
    state(): { x: number; z: number; yaw: number; moving: boolean };
    /** Put the player somewhere (the server's spawn in the first hello). The camera snaps behind. */
    teleport(x: number, z: number, yaw: number): void;
  };
  /** The player pressed E at a station; the camera is already flying to its play pose. */
  onEnter(cb: (station: Station) => void): () => void;
  /** The player pressed E at the cashier. */
  onCashier(cb: () => void): () => void;
  /** Leave the table: the camera flies back and walking resumes. */
  exitTable(): Promise<void>;
  setQuality(q: 'high' | 'low'): void;
  update(dt: number): void;
  dispose(): void;
}
