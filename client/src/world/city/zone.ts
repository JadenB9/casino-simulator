// What building a zone (ground.ts, roof.ts) hands back to the city (index.ts).

import type * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { ZoneId } from '../../../../shared/src/zones.ts';
import type { Seatable } from '../life-points.ts';
import type { Bank } from './bank.ts';
import type { RoadCar, Traffic } from './parking.ts';

export interface ZoneBuild {
  id: ZoneId;
  group: THREE.Group;
  bank: Bank;
  /** Places to sit (sit-anywhere). */
  seats: Seatable[];
  /** Resolves when the props (palms, sofas, chandeliers) have loaded. */
  ready: Promise<unknown>;
  /** Which light a point is in: under a roof ('inside') or the sky's ('outside'). */
  light(x: number, z: number): 'inside' | 'outside';
  /** The ceiling over a point, if something hangs over it (m), else null. */
  ceilingAt(x: number, z: number): number | null;
  /**
   * Every frame while you're in this zone: the people in it, and whether to keep things calm; v7:
   * the walker a car can knock down (null: driving, riding, held) and the driven cars on the road.
   */
  update(dt: number, people: { x: number; z: number }[], calm: boolean, me?: { x: number; z: number } | null, cars?: readonly RoadCar[]): void;
  /** v7: the ground floor's traffic (loop.ts), for the driving and the knocks. */
  traffic?: Traffic;
  setQuality(q: Quality): void;
  dispose(): void;
}
