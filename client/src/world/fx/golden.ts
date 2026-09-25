// Golden Hour: for half a minute the whole casino goes gold. Every room's light warms and lifts,
// long shafts of low gold light slant down through it as if the sun had found a way in, gold
// coins fall from the ceiling wherever you are, ringing as they land, bouncing once or twice and
// lying where they stop; a haze of gold glitter hangs in the air round you. Everyone sees it,
// in whatever room they're in (the coins fall round the camera, so there is always some in view).

import * as THREE from 'three';
import type { FxEvent } from '../../../../shared/src/items.ts';
import { ceilingAt, inRect, roomAt } from '../layout.ts';
import { Bits, FLOOR_TOP, Sparks, aimBeam } from './particles.ts';
import { COIN, type Stock } from './stock.ts';
import type { Effect, FxWorld } from './types.ts';
import { envelope } from './timing.ts';

const RATE = { high: 46, low: 20 };
const GLITTER = { high: 90, low: 40 };
const AROUND = 5;

export function golden(w: FxWorld, stock: Stock, ev: FxEvent, late: boolean): Effect {
  const q = w.quality();
  const secs = (ev.until - ev.at) / 1000;
  const coins = new Bits(stock.coinGeo, stock.coin(q), q === 'high' ? 360 : 180, 'fx-coins');
  const glitter = new Sparks(GLITTER[q] * 3, { hot: '#fff1c0', cool: '#ffb43a', gain: q === 'high' ? 2.6 : 1.3, width: 0.01, len: 0.05, name: 'fx-glitter' });
  // the shafts: four parallel beams of low sun across the room you're in
  const shaftMat = stock.beam().clone();
  shaftMat.uniforms.uColor!.value = new THREE.Color('#ffc766');
  const shafts = new THREE.InstancedMesh(stock.shaftGeo, shaftMat, 4);
  shafts.frustumCulled = false;
  let shaftRoom = '';
  w.root.add(coins.mesh, glitter.mesh, shafts);
  const white = new THREE.Color(1, 1, 1);
  let owed = 0;
  let owedG = 0;
  let stopSound = late ? null : (w.sounds?.golden(secs) ?? null);
  const id = `golden:${ev.id}:${ev.at}`;

  /** A point on the floor near the camera (not right in front of the lens), inside the room it's in. */
  const near = (r: number): { x: number; z: number } | null => {
    const e = w.camera.position;
    const room = roomAt(w.plan, e.x, e.z);
    if (!room) return null;
    for (let tries = 0; tries < 4; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 1.4 + Math.sqrt(Math.random()) * (r - 1.4);
      const x = e.x + Math.cos(a) * d;
      const z = e.z + Math.sin(a) * d;
      if (inRect(room.inner, x, z, -0.2)) return { x, z };
    }
    return null;
  };

  return {
    update(dt, t, left, view) {
      const k = envelope(t, left, 1.5, 2.5);
      w.lighting.setTint(id, k > 0.001 ? { color: '#ffae3c', k: 0.8 * k, dim: 1 + 0.4 * k } : null);
      if (view.here !== shaftRoom) {
        shaftRoom = view.here;
        placeShafts(w, shafts, shaftRoom);
      }
      shaftMat.uniforms.uK!.value = (q === 'high' ? 0.2 : 0.28) * k * (0.85 + 0.15 * Math.sin(t * 0.7));
      shaftMat.uniforms.uTime!.value = t;
      if (left > 1.5) {
        owed += RATE[q] * dt * Math.min(1, t / 1.5 + 0.2);
        for (; owed >= 1; owed--) {
          const p = near(AROUND);
          if (!p) continue;
          const top = Math.min(4.6, ceilingAt(w.plan, p.x, p.z) - 0.1);
          white.setScalar(0.85 + Math.random() * 0.15);
          coins.spawn(p.x, top, p.z, (Math.random() - 0.5) * 0.4, -0.5 - Math.random(), (Math.random() - 0.5) * 0.4, 1, white, 6 + Math.random() * 12);
        }
        owedG += GLITTER[q] * dt;
        for (; owedG >= 1; owedG--) {
          const p = near(AROUND * 0.8);
          if (!p) continue;
          glitter.spawn(p.x, 0.6 + Math.random() * 2.6, p.z, (Math.random() - 0.5) * 0.15, -0.05 - Math.random() * 0.1, (Math.random() - 0.5) * 0.15, 1.5 + Math.random() * 2);
        }
      }
      stepCoins(coins, dt);
      coins.commit(Math.min(1, left / 1.2));
      glitter.step(dt, 0.02, 0.2);
      glitter.commit();
      if (left <= 0 && stopSound) {
        stopSound();
        stopSound = null;
      }
      return left > 0;
    },
    dispose() {
      stopSound?.();
      w.lighting.setTint(id, null);
      coins.dispose();
      glitter.dispose();
      shafts.dispose();
      shaftMat.dispose();
    },
  };
}

/** The sun's way in: every shaft slants the same way, down from high on the room's south-west. */
const SUN = new THREE.Vector3(-0.55, 1, -0.4).normalize();

function placeShafts(w: FxWorld, shafts: THREE.InstancedMesh, roomId: string): void {
  const room = w.plan.rooms.find((r) => r.id === roomId);
  if (!room) {
    shafts.count = 0;
    return;
  }
  const L = room.inner;
  const m = new THREE.Matrix4();
  const spots: [number, number][] = [
    [0.3, 0.3],
    [0.62, 0.42],
    [0.4, 0.7],
    [0.75, 0.78],
  ];
  shafts.count = spots.length;
  spots.forEach(([fx, fz], i) => {
    const x = L.x0 + (L.x1 - L.x0) * fx;
    const z = L.z0 + (L.z1 - L.z0) * fz;
    const top = ceilingAt(w.plan, x, z) - 0.05;
    const to = new THREE.Vector3(x, 0, z);
    const from = to.clone().addScaledVector(SUN, top / SUN.y);
    shafts.setMatrixAt(i, aimBeam(m, from, to, 0.7 + 0.25 * (i % 2)));
  });
  shafts.instanceMatrix.needsUpdate = true;
}

/**
 * Coins: they fall, bounce once or twice on landing and lie flat, piled on any already there; after
 * `linger` seconds on the floor one sinks away (shrinks to nothing), making room for more.
 */
export function stepCoins(b: Bits, dt: number, linger = 7): void {
  const drag = Math.exp(-dt * 0.35);
  const rest = FLOOR_TOP + COIN.h / 2;
  for (let i = 0; i < b.n; i++) {
    b.age[i]! += dt;
    if (b.landed[i]) {
      // once it's down, its age counts from when it landed
      if (b.age[i]! > linger) {
        b.size[i]! -= dt * 1.5;
        if (b.size[i]! <= 0) {
          b.kill(i);
          i--;
        }
      }
      continue;
    }
    const k = i * 3;
    const v = b.v;
    const p = b.p;
    v[k + 1]! -= 9.8 * dt;
    v[k]! *= drag;
    v[k + 1]! *= drag;
    v[k + 2]! *= drag;
    p[k]! += v[k]! * dt;
    p[k + 1]! += v[k + 1]! * dt;
    p[k + 2]! += v[k + 2]! * dt;
    b.spin(i, dt);
    if (p[k + 1]! > rest) continue;
    if (v[k + 1]! < -1.4) {
      // a bounce: most of its fall is lost, it skips sideways and spins slower
      p[k + 1] = rest;
      v[k + 1] = -v[k + 1]! * 0.28;
      v[k] = v[k]! * 0.5 + (Math.random() - 0.5) * 0.5;
      v[k + 2] = v[k + 2]! * 0.5 + (Math.random() - 0.5) * 0.5;
      b.w[i * 4 + 3]! *= 0.6;
    } else {
      b.land(i, b.pile(i, rest, COIN.r * 1.7, COIN.h * 1.05), false);
      b.age[i] = 0;
    }
  }
}
