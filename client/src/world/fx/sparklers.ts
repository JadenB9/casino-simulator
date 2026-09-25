// Cold Sparks: the stage machines that throw a column of cold sparks (titanium granules, harmless
// to stand beside) set in a ring on the floor round the buyer. They catch all at once, run full for
// a few seconds, then chase round the ring, rising and falling one after the other, and burn out
// together at the end. Each machine is a small black box with a warm flicker on the floor round
// it; the sparks are one streak each, hot white turning gold as they fall, bright enough to bloom.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FxEvent } from '../../../../shared/src/items.ts';
import { ceilingAt } from '../layout.ts';
import type { Collider } from '../collision.ts';
import { Sparks } from './particles.ts';
import type { Stock } from './stock.ts';
import type { Effect, FxWorld } from './types.ts';
import { fxPoint } from './scope.ts';

const RING = 8;
const RADIUS = 1.55;
/** Sparks a second from each machine. */
const RATE = { high: 120, low: 50 };
const BOX = { w: 0.24, h: 0.17, d: 0.24 };

export function sparklers(w: FxWorld, stock: Stock, ev: FxEvent, late: boolean): Effect {
  const q = w.quality();
  const secs = (ev.until - ev.at) / 1000;
  const c = w.where(ev.id)?.clone() ?? new THREE.Vector3(fxPoint(ev).x, 0, fxPoint(ev).z);
  // the ring, less any place something already stands
  const units: { x: number; z: number }[] = [];
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2 + 0.2;
    const x = c.x + Math.cos(a) * RADIUS;
    const z = c.z + Math.sin(a) * RADIUS;
    if (!blocked(w.collider, x, z, 0.2)) units.push({ x, z });
  }
  const group = new THREE.Group();
  group.name = 'fx-sparklers';
  w.root.add(group);
  const boxes = units.map((u) => machine(u.x, u.z, Math.atan2(c.x - u.x, c.z - u.z)));
  const body = new THREE.Mesh(boxes.length ? mergeGeometries(boxes)! : new THREE.BufferGeometry(), stock.dark(q));
  for (const b of boxes) b.dispose();
  const glow = poolsAt(units);
  const poolMat = stock.pool('soft').clone();
  const pools = new THREE.Mesh(glow, poolMat);
  const sparks = new Sparks(Math.ceil(units.length * RATE[q] * 1.35) + 16, { hot: '#fff8e8', cool: '#ff9a2e', gain: q === 'high' ? 4 : 1.8, width: 0.017, len: 0.034, name: 'fx-sparks' });
  group.add(body, pools, sparks.mesh);

  const top = ceilingAt(w.plan, c.x, c.z) - 0.35;
  const vmax = Math.sqrt(2 * 9.8 * Math.max(0.8, top - BOX.h));
  const owed = units.map(() => 0);
  let stopSound = late ? null : (w.sounds?.sparklers({ x: c.x, y: 0.8, z: c.z }, secs) ?? null);
  const warm = new THREE.Color('#ff9a3a');

  return {
    update(dt, t, left) {
      const burning = left > 0.9;
      const still = w.calm();
      sparks.uniforms.uGain.value = (q === 'high' ? 4 : 1.8) * (still ? 0.6 : 1);
      let heat = 0;
      units.forEach((u, i) => {
        // full for three seconds, then a chase round the ring
        // (steady, and half as many sparks, with flashing and motion turned down)
        const chase = t < 3 || still ? 1 : 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.6 - (i / units.length) * Math.PI * 2));
        heat += chase;
        if (!burning) return;
        owed[i]! += RATE[q] * dt * (0.6 + 0.4 * chase) * (still ? 0.5 : 1);
        const up = Math.min(vmax, (4.6 + 1.6 * chase) * (t < 0.3 ? t / 0.3 : 1));
        for (; owed[i]! >= 1; owed[i]!--) {
          // a tight jet, a few thrown wider: the column feathers out as it rises and falls back
          const s = Math.random() < 0.8 ? Math.random() * 0.06 : 0.06 + Math.random() * 0.12;
          const a = Math.random() * Math.PI * 2;
          sparks.spawn(u.x + (Math.random() - 0.5) * 0.03, BOX.h + 0.02, u.z + (Math.random() - 0.5) * 0.03, Math.cos(a) * s * up, up * (0.86 + Math.random() * 0.16), Math.sin(a) * s * up, 0.7 + Math.random() * 0.6);
        }
      });
      sparks.step(dt, 9.8, 0.7);
      sparks.commit();
      // the floor round each machine flickers with it
      const k = burning ? (heat / Math.max(1, units.length)) * (still ? 0.8 : 0.85 + Math.random() * 0.3) : Math.max(0, left / 0.9) * 0.6;
      poolMat.color.copy(warm).multiplyScalar(0.5 * k);
      if (left <= 0 && stopSound) {
        stopSound();
        stopSound = null;
      }
      return left > 0 || sparks.n > 0;
    },
    dispose() {
      stopSound?.();
      group.removeFromParent();
      body.geometry.dispose();
      glow.dispose();
      poolMat.dispose();
      sparks.dispose();
    },
  };
}

/** Whether a machine at (x, z) would stand in something (a table, a wall, a planter). */
export function blocked(col: Collider, x: number, z: number, r: number): boolean {
  for (const b of col.boxes) {
    if (!b.walk || b.bottom > 0.3) continue;
    const dx = x - b.cx;
    const dz = z - b.cz;
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) < b.hx + r && Math.abs(lz) < b.hz + r) return true;
  }
  for (const p of col.posts) if (p.walk && Math.hypot(x - p.cx, z - p.cz) < p.r + r) return true;
  return false;
}

/** One machine: a low black box, its vented top and the nozzle in the middle, facing the ring's middle. */
function machine(x: number, z: number, yaw: number): THREE.BufferGeometry {
  const parts = [
    new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d).translate(0, BOX.h / 2, 0),
    new THREE.CylinderGeometry(0.03, 0.04, 0.03, 12).translate(0, BOX.h + 0.015, 0),
    // the control panel's lip on the front
    new THREE.BoxGeometry(BOX.w * 0.7, 0.05, 0.015).translate(0, BOX.h * 0.45, BOX.d / 2 + 0.007),
  ];
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g.rotateY(yaw).translate(x, 0, z);
}

function poolsAt(units: readonly { x: number; z: number }[]): THREE.BufferGeometry {
  if (units.length === 0) return new THREE.BufferGeometry();
  const parts = units.map((u) => new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2).translate(u.x, 0.018, u.z));
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
}
