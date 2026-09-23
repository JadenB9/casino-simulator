// The light rig. Every lit fragment pays for every light, and changing the number of lights
// recompiles every material, so the count is fixed: a warm hemisphere and one directional light
// always, plus (High only) four spots: two wide pools over the pit rows, one over the poker room,
// and a focus spot that glides to whichever table the player is nearest or playing. Warm pools
// on the carpet under tables, banks and lamps are additive decals, not lights.

import * as THREE from 'three';
import type { Quality } from '../render/engine3d.ts';
import type { Batch } from './batch.ts';
import type { Mats } from './materials.ts';
import { PIT_CEILING, type FloorPlan } from './layout.ts';

export class Lighting {
  readonly group = new THREE.Group();
  readonly hemi = new THREE.HemisphereLight('#ffd6a6', '#3a1810', 1.35);
  readonly sun = new THREE.DirectionalLight('#ffe2bc', 0.55);
  private spots: THREE.SpotLight[] = [];
  readonly focus: THREE.SpotLight;
  private focusTo = new THREE.Vector3();
  private focusFrom = new THREE.Vector3();
  private focusOn = false;

  constructor(plan: FloorPlan, quality: Quality) {
    this.group.name = 'lights';
    this.sun.position.set(-6, 10, 8);
    this.sun.target.position.set(0, 0, 0);
    this.group.add(this.hemi, this.sun, this.sun.target);

    const P = plan.pit;
    const pitZ = (plan.staff.z0 + plan.staff.z1) / 2;
    const rowN = plan.stations.find((s) => s.zone === 'pit' && s.yaw !== 0)?.z ?? pitZ - 2;
    const rowS = plan.stations.find((s) => s.zone === 'pit' && s.yaw === 0)?.z ?? pitZ + 2;
    const wide = (x: number, z: number, tx: number, tz: number, intensity: number, angle: number) => {
      const s = new THREE.SpotLight('#ffcf94', intensity, 16, angle, 0.7, 1.6);
      s.position.set(x, PIT_CEILING - 0.4, z);
      s.target.position.set(tx, 0.8, tz);
      return s;
    };
    this.spots.push(wide((P.x0 + P.x1) / 2, rowN + 0.6, (P.x0 + P.x1) / 2, rowN, 80, 1.05));
    this.spots.push(wide((P.x0 + P.x1) / 2, rowS - 0.6, (P.x0 + P.x1) / 2, rowS, 80, 1.05));
    const pk = plan.pokerRoom;
    const poker = new THREE.SpotLight('#ffcf94', 40, 12, 0.95, 0.7, 1.6);
    poker.position.set((pk.x0 + pk.x1) / 2 + 0.8, 3.3, (pk.z0 + pk.z1) / 2);
    poker.target.position.set((pk.x0 + pk.x1) / 2 + 1.2, 0.8, (pk.z0 + pk.z1) / 2);
    this.spots.push(poker);
    this.focus = new THREE.SpotLight('#ffd9a3', 0, 9, 0.62, 0.55, 1.5);
    this.focus.position.set(0, 3.2, 0);
    this.spots.push(this.focus);
    this.setQuality(quality);
  }

  setQuality(q: Quality): void {
    for (const s of this.spots) {
      if (q === 'high') this.group.add(s, s.target);
      else this.group.remove(s, s.target);
    }
    this.hemi.intensity = q === 'high' ? 1.35 : 1.9;
    this.sun.intensity = q === 'high' ? 0.55 : 0.8;
  }

  /** Aim the focus spot at a table (null lets it fade out). */
  setFocus(p: THREE.Vector3 | null): void {
    if (!p) {
      this.focusOn = false;
      return;
    }
    if (!this.focusOn && this.focus.intensity < 1) {
      this.focusFrom.copy(p);
      this.focus.target.position.copy(p);
    }
    this.focusOn = true;
    this.focusTo.copy(p);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 3);
    this.focusFrom.lerp(this.focusTo, k);
    this.focus.target.position.set(this.focusFrom.x, 0.78, this.focusFrom.z);
    this.focus.position.set(this.focusFrom.x + 0.3, 3.2, this.focusFrom.z + 0.9);
    const want = this.focusOn ? 32 : 0;
    this.focus.intensity += (want - this.focus.intensity) * (1 - Math.exp(-dt * 4));
  }
}

/** Warm pools on the carpet: one additive decal mesh for all of them. */
export function buildPools(pools: { x: number; z: number; r: number }[], b: Batch, m: Mats): void {
  const mat = m.get('pool');
  for (const p of pools) {
    const g = new THREE.PlaneGeometry(p.r * 2, p.r * 2);
    b.add(g, mat, new THREE.Matrix4().makeRotationX(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(p.x, 0.014, p.z)));
  }
}
