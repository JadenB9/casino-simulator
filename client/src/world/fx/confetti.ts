// Confetti Cannon: two cannons fire over the buyer's head, one a beat after the other, and a cloud
// of gold, red and white paper hangs in the air, drifts down over everyone near and lies on the
// floor until the end, when it's swept away (it shrinks to nothing over the last second).

import * as THREE from 'three';
import type { FxEvent } from '../../../../shared/src/items.ts';
import { ceilingAt } from '../layout.ts';
import { Bits, stepPaper } from './particles.ts';
import type { Stock } from './stock.ts';
import type { Effect, FxWorld } from './types.ts';
import { fxPoint } from './scope.ts';

/** Gold foil, two reds, white and champagne, by share. */
const COLORS: [string, number][] = [
  ['#f0c14e', 0.3],
  ['#d11a2e', 0.26],
  ['#8e0c20', 0.12],
  ['#f6f1e6', 0.2],
  ['#f7dc95', 0.12],
];

const PER_SHOT = { high: 260, low: 130 };

export function confetti(w: FxWorld, stock: Stock, ev: FxEvent, late: boolean): Effect {
  const q = w.quality();
  const per = PER_SHOT[q];
  const bits = new Bits(stock.paperGeo, stock.paper(q), per * 2, 'fx-confetti');
  w.root.add(bits.mesh);
  const at = w.where(ev.id)?.clone() ?? new THREE.Vector3(fxPoint(ev).x, 0, fxPoint(ev).z);
  const ceiling = ceilingAt(w.plan, at.x, at.z) - 0.08;
  const color = new THREE.Color();
  const pick = () => {
    let r = Math.random();
    for (const [c, share] of COLORS) if ((r -= share) <= 0) return color.set(c);
    return color.set(COLORS[0]![0]);
  };
  let shots = 0;

  const fire = (side: number) => {
    // from a little over the buyer's shoulder, up and out in a wide cone
    const ox = at.x + side * 0.35;
    const oz = at.z + (Math.random() - 0.5) * 0.3;
    for (let i = 0; i < per; i++) {
      const a = Math.random() * Math.PI * 2;
      const spread = Math.pow(Math.random(), 0.7) * 0.75;
      const speed = 8.5 + Math.random() * 4;
      const vx = Math.sin(spread) * Math.cos(a) * speed + side * 0.9;
      const vz = Math.sin(spread) * Math.sin(a) * speed;
      const vy = Math.cos(spread) * speed;
      bits.spawn(ox, 1.5, oz, vx, vy, vz, 0.75 + Math.random() * 0.6, pick(), 8 + Math.random() * 14);
    }
  };

  if (late) {
    // joined part way through: the cloud is already coming down
    for (let i = 0; i < per * 2; i++) {
      const r = Math.sqrt(Math.random()) * 3.2;
      const a = Math.random() * Math.PI * 2;
      bits.spawn(at.x + Math.cos(a) * r, 0.2 + Math.random() * (ceiling - 0.4), at.z + Math.sin(a) * r, 0, -0.5, 0, 0.75 + Math.random() * 0.6, pick(), 8 + Math.random() * 14);
    }
    shots = 2;
  } else {
    w.sounds?.confetti({ x: at.x, y: 1.6, z: at.z });
  }

  return {
    update(dt, t, left) {
      if (shots === 0) {
        fire(-1);
        shots++;
      }
      if (shots === 1 && t >= 0.22) {
        fire(1);
        shots++;
      }
      stepPaper(bits, dt, { fall: 0.55, sway: 0.4, drag: 2.1, size: 0.03 });
      // the ceiling stops the fastest ones
      for (let i = 0; i < bits.n; i++) {
        const k = i * 3 + 1;
        if (bits.p[k]! > ceiling) {
          bits.p[k] = ceiling;
          bits.v[k] = -Math.abs(bits.v[k]!) * 0.1;
        }
      }
      const k = Math.min(1, left / 1.0);
      bits.commit(k);
      return left > 0;
    },
    dispose() {
      bits.dispose();
    },
  };
}
