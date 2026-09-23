// What the rest of the client needs from the world: the scene with the floor in it, the
// stations people walk up to, and characters. The world module (client/src/world/) provides a
// real casino floor; dev-room.ts is the bare stand-in the dev harness uses.

import type * as THREE from 'three';
import type { GameId } from '../../../shared/src/engine.ts';
import type { Look } from '../../../shared/src/look.ts';

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
}

export interface CharacterFactory {
  create(look: Look, name: string): Character;
}
