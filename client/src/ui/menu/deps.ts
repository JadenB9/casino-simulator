// What the account screens need from the rest of the client, as narrow shapes. The real
// objects satisfy them directly (`import * as api from '../../net/api.ts'`, the `session`
// singleton, an Engine3D, an Sfx); the dev page passes stand-ins with canned data instead.

import type * as THREE from 'three';
import type { LoanResponse, Profile } from '../../../../shared/src/protocol.ts';
import type { Look } from '../../../../shared/src/look.ts';

export interface SessionLike {
  profile: Profile | null;
  set(p: Profile): void;
  on(fn: (p: Profile) => void): () => void;
}

/** The slice of net/api.ts these screens call. */
export interface AccountApi {
  login(name: string): Promise<Profile>;
  lastName(): string | null;
  me(): Promise<Profile>;
  saveLook(look: Look): Promise<Look>;
  takeLoan(): Promise<LoanResponse>;
  forgetToken(): void;
}

/** Enough of Engine3D to put a character in the scene and point the camera at it. */
export interface EngineLike {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  onFrame(fn: (dt: number, time: number) => void): () => void;
}

/** Enough of Sfx for menu clicks, the mute toggle and the volume setting. */
export interface SfxLike {
  muted: boolean;
  volume: number;
  setMuted(m: boolean): void;
  setVolume(v: number): void;
  play(name: string, opts?: { volume?: number; rate?: number; delay?: number }): void;
  readonly out: GainNode;
}

/** Something that can be closed; every mount and open returns at least this. */
export interface Closable {
  readonly root: HTMLElement;
  close(): void;
}
