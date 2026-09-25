// What every effect is given, and what it gives back to the player (index.ts).

import type * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { FxEvent } from '../../../../shared/src/items.ts';
import type { FloorPlan } from '../layout.ts';
import type { Lighting } from '../lighting.ts';
import type { Collider } from '../collision.ts';
import type { Characters } from '../characters.ts';
import type { FxSounds } from '../../audio/fx.ts';

export interface FxWorld {
  /** Where effects hang (under the floor's root). */
  root: THREE.Object3D;
  plan: FloorPlan;
  camera: THREE.Camera;
  quality(): Quality;
  lighting: Lighting;
  /** The effects' sounds; null on a page without them. */
  sounds: FxSounds | null;
  collider: Collider;
  characters: Characters;
  /** Where the player with this floor id stands now (you, or someone drawn), or null. */
  where(id: number): THREE.Vector3 | null;
  /** The characters drawn on the floor now (you and everyone else), each with its floor id if known. */
  people(): Iterable<{ id: number | null; ch: FxPerson }>;
  /** The polished metals' reflections of the casino (High), for gold that looks like gold. */
  env(): THREE.Texture | null;
}

/** The part of a character the effects touch. */
export interface FxPerson {
  readonly root: THREE.Object3D;
  readonly currentLook: import('../../../../shared/src/look.ts').Look;
  setLook(look: import('../../../../shared/src/look.ts').Look): void;
}

/** Where the camera is this frame. */
export interface FxView {
  /** The room the camera is in, and the rooms being drawn. */
  here: string;
  visible: ReadonlySet<string>;
  eye: THREE.Vector3;
}

export interface Effect {
  /**
   * One frame: `t` seconds since it started, `left` seconds until it ends (0 once it's over: fade
   * out). False when it's done and can be disposed.
   */
  update(dt: number, t: number, left: number, view: FxView): boolean;
  dispose(): void;
}

export type EffectMaker = (w: FxWorld, ev: FxEvent, late: boolean) => Effect;
