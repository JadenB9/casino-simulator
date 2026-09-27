// v1.1: the apartment's Poker Table is a real Hold'em table: the game's own model, standing where
// the games piece does (moved or not) whenever the Poker Table is the piece there. E sits you down
// like any table in the casino: a table of your own, one with others, or a private one with a PIN
// to give your friends. Built once and kept; in any other apartment, or out of the apartments,
// it's put far out of reach and hidden (the jail's tables are stations the same way: law/jail.ts).

import type * as THREE from 'three';
import { variantOf } from '../../../../shared/src/games/catalog.ts';
import type { Quality } from '../../render/engine3d.ts';
import type { Box, Collider } from '../collision.ts';
import { looseStation, type WorldStation } from '../stations.ts';
import type { SlotPlace } from './plan.ts';

/** The station's id: the floor hears you're sitting at it like any other. */
export const HOME_POKER = 'apt-poker';

/** Where it waits when it isn't in the apartment you're in: nowhere anyone walks. */
const AWAY = 1e5;

export class HomePoker {
  readonly station: WorldStation;
  private solid: Box | null = null;
  private at: SlotPlace | null = null;

  constructor(
    parent: THREE.Object3D,
    quality: Quality,
    private readonly col: Collider,
  ) {
    this.station = looseStation({ id: HOME_POKER, game: 'holdem', variant: variantOf('holdem', null), name: 'Poker Table', limits: 'Your own table, or a private one for friends', x: AWAY, z: AWAY, parent, quality });
    this.station.anchor.visible = false;
  }

  /** Stand it at `at` (the games piece's place), or take it out of sight and out of reach (null). */
  set(at: SlotPlace | null): void {
    if (at === this.at || (at && this.at && at.x === this.at.x && at.z === this.at.z && at.yaw === this.at.yaw)) return;
    this.at = at;
    if (this.solid) this.col.remove(this.solid);
    this.solid = null;
    const s = this.station;
    s.anchor.visible = !!at;
    if (!at) {
      s.anchor.position.set(AWAY, 0, AWAY);
      return;
    }
    s.anchor.position.set(at.x, 0, at.z);
    s.anchor.rotation.y = at.yaw;
    s.yaw = at.yaw;
    s.anchor.updateMatrixWorld(true);
    this.solid = this.col.box(at.x, at.z, s.footprint.width, s.footprint.depth, at.yaw, 1.0, { cam: false });
  }
}
