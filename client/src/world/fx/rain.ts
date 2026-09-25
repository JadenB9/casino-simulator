// Make It Rain: hundred-dollar bills flutter down round the buyer, following them if they walk,
// tumbling and sliding sideways the way paper falls, and pile up on the floor where they land
// until the effect ends and they're swept away.

import * as THREE from 'three';
import type { FxEvent } from '../../../../shared/src/items.ts';
import { ceilingAt } from '../layout.ts';
import { Bits, stepPaper } from './particles.ts';
import type { Stock } from './stock.ts';
import type { Effect, FxWorld } from './types.ts';
import { fxPoint } from './scope.ts';

/** Bills a second while it rains, and for how long of the effect it rains (the rest is settling). */
const RATE = { high: 24, low: 12 };
const RAINS = 0.75;
const RADIUS = 1.7;

export function rain(w: FxWorld, stock: Stock, ev: FxEvent, late: boolean): Effect {
  const q = w.quality();
  const secs = (ev.until - ev.at) / 1000;
  const bits = new Bits(stock.billGeo, stock.money(q), Math.ceil(RATE[q] * secs * RAINS) + 8, 'fx-rain');
  w.root.add(bits.mesh);
  const start = fxPoint(ev);
  const at = new THREE.Vector3(start.x, 0, start.z);
  const white = new THREE.Color(1, 1, 1);
  let owed = 0;
  let stopSound: (() => void) | null = late ? null : (w.sounds?.rain({ x: at.x, y: 2, z: at.z }, secs) ?? null);

  return {
    update(dt, t, left) {
      const p = w.where(ev.id);
      if (p) at.lerp(p, 1 - Math.exp(-dt * 3));
      if (t < secs * RAINS && left > 0) {
        owed += RATE[q] * dt;
        const top = Math.min(3.4, ceilingAt(w.plan, at.x, at.z) - 0.15);
        for (; owed >= 1; owed--) {
          const r = Math.sqrt(Math.random()) * RADIUS;
          const a = Math.random() * Math.PI * 2;
          // a light shade in each bill, as if some are older than others
          white.setScalar(0.86 + Math.random() * 0.14);
          bits.spawn(at.x + Math.cos(a) * r, top - Math.random() * 0.3, at.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.3, -0.2, (Math.random() - 0.5) * 0.3, 1, white, 3 + Math.random() * 4);
        }
      }
      stepPaper(bits, dt, { fall: 0.85, sway: 0.6, drag: 1.4, size: 0.15 });
      bits.commit(Math.min(1, left / 1.0));
      if (left <= 0 && stopSound) {
        stopSound();
        stopSound = null;
      }
      return left > 0;
    },
    dispose() {
      stopSound?.();
      bits.dispose();
    },
  };
}
