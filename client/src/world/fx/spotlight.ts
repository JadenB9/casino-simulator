// Spotlight: a theatre follow spot on the ceiling of the buyer's room picks them out and stays on
// them for a minute and a half, wherever they walk (into another room, it moves to that room's
// ceiling). What everyone sees: the lamp itself, turning to follow, its lens burning past the bloom
// threshold, a beam through the haze and a hard-edged pool of light round the buyer's feet. On
// High the pool is real light too: the focus spot (lighting.ts) is borrowed while no table has it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FxEvent } from '../../../../shared/src/items.ts';
import { ceilingAt, inRect, roomAt } from '../layout.ts';
import { aimBeam } from './particles.ts';
import type { Stock } from './stock.ts';
import type { Effect, FxWorld } from './types.ts';
import { fxPoint } from './scope.ts';
import { envelope } from './timing.ts';

const POOL_R = 0.85;
const WARM = new THREE.Color('#fff0d6');

export function spotlight(w: FxWorld, stock: Stock, ev: FxEvent, late: boolean): Effect {
  const q = w.quality();
  const group = new THREE.Group();
  group.name = 'fx-spotlight';
  w.root.add(group);

  // the lamp: a mount, a yoke, the can, and its lens
  const dark = stock.dark(q);
  const mount = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 10).translate(0, 0.11, 0), dark);
  const yoke = new THREE.Group();
  const arms = new THREE.Mesh(yokeGeometry(), dark);
  const can = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.52, 20).rotateX(Math.PI / 2).translate(0, 0, -0.08), dark);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.105, 24).translate(0, 0, 0.181), stock.lens());
  can.add(body, lens);
  // the can turns on the ends of the yoke's arms
  can.position.y = -0.17;
  yoke.add(arms, can);
  mount.add(rod, yoke);
  group.add(mount);

  const beamMat = stock.beam().clone();
  beamMat.uniforms.uColor!.value = WARM.clone();
  const beam = new THREE.Mesh(stock.beamGeo, beamMat);
  beam.matrixAutoUpdate = false;
  beam.frustumCulled = false;
  const poolMat = stock.pool('crisp').clone();
  const pool = new THREE.Mesh(stock.poolGeo, poolMat);
  pool.scale.setScalar(POOL_R);
  group.add(beam, pool);

  const start = fxPoint(ev);
  const target = new THREE.Vector3(start.x, 0, start.z);
  const lensAt = new THREE.Vector3();
  const aim = new THREE.Vector3();
  let room = '';
  let heard = late;

  /** Hang the lamp in `r`'s ceiling, a little toward the doors from its middle. */
  const hang = (x: number, z: number) => {
    const r = roomAt(w.plan, x, z);
    if (!r || r.id === room) return;
    room = r.id;
    const L = r.inner;
    let fx = r.cx;
    let fz = r.cz + Math.min(2.2, (L.z1 - L.z0) / 4);
    if (!inRect(L, fx, fz, -0.6)) {
      fx = Math.min(L.x1 - 0.6, Math.max(L.x0 + 0.6, fx));
      fz = Math.min(L.z1 - 0.6, Math.max(L.z0 + 0.6, fz));
    }
    const top = ceilingAt(w.plan, fx, fz);
    mount.position.set(fx, top - 0.22, fz);
  };
  hang(target.x, target.z);

  return {
    update(dt, t, left) {
      const p = w.where(ev.id);
      // an operator's hand: close behind, never quite on the beat
      if (p) target.lerp(_v.set(p.x, 0, p.z), 1 - Math.exp(-dt * 5));
      hang(target.x, target.z);
      const k = envelope(t, left, 0.5, 0.8);
      if (!heard && t > 0) {
        heard = true;
        w.sounds?.spotlight({ x: mount.position.x, y: mount.position.y, z: mount.position.z }, true);
      }
      // turn the yoke and tilt the can toward the buyer's chest
      mount.updateMatrixWorld(true);
      aim.set(target.x, 1.1, target.z);
      const local = yoke.worldToLocal(aim.clone());
      yoke.rotation.y += Math.atan2(local.x, local.z);
      yoke.updateMatrixWorld(true);
      const l2 = yoke.worldToLocal(aim.clone());
      can.rotation.x = -Math.atan2(l2.y - can.position.y, Math.hypot(l2.x, l2.z));
      can.updateMatrixWorld(true);
      lens.getWorldPosition(lensAt);
      // the beam from the lens to the floor round the buyer, and its pool
      aimBeam(beam.matrix, lensAt, _v.set(target.x, 0, target.z), POOL_R);
      beamMat.uniforms.uK!.value = (q === 'high' ? 0.28 : 0.4) * k;
      beamMat.uniforms.uTime!.value = t;
      pool.position.set(target.x, 0.016, target.z);
      poolMat.color.copy(WARM).multiplyScalar((q === 'high' ? 0.5 : 0.85) * k);
      lens.scale.setScalar(0.3 + 0.7 * k);
      if (k > 0.05) w.lighting.follow(lensAt, target);
      else w.lighting.follow(null);
      if (left <= 0) {
        w.lighting.follow(null);
        w.sounds?.spotlight({ x: mount.position.x, y: mount.position.y, z: mount.position.z }, false);
      }
      return left > 0;
    },
    dispose() {
      w.lighting.follow(null);
      group.removeFromParent();
      for (const m of [rod, arms, body, lens]) m.geometry.dispose();
      beamMat.dispose();
      poolMat.dispose();
    },
  };
}

const _v = new THREE.Vector3();

/** The yoke: a U of flat bar from the mount down round both sides of the can. */
function yokeGeometry(): THREE.BufferGeometry {
  const parts = [new THREE.BoxGeometry(0.36, 0.03, 0.05), new THREE.BoxGeometry(0.025, 0.2, 0.05).translate(-0.17, -0.1, 0), new THREE.BoxGeometry(0.025, 0.2, 0.05).translate(0.17, -0.1, 0)];
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
}
