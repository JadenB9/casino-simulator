// Moments worth marking: a made hand in poker, a blackjack, a big slot line. One call puts up the
// banner (the hand's name, what it paid), lights the cards or spots that made it, and on the
// biggest wins drops a short shower of chips on the felt. Callers decide whether a moment counts:
// never for a return at or below the stake (a push, or a win that only gives the bet back).

import * as THREE from 'three';
import type { TableStage } from './stage.ts';
import type { Sfx } from '../audio/sfx.ts';
import { el } from '../ui/kit.ts';

export type Tier = 'nice' | 'big' | 'huge';

export interface Moment {
  /** What happened, in the table's words: "Full house, kings full", "Blackjack", "Big win". */
  title: string;
  /** A second line: what it paid ("Pays 9 to 1 · $450"). */
  sub?: string;
  tier: Tier;
  /** Table-local point the chips fall on (huge only). */
  at?: THREE.Vector3;
  /** Objects to ring with light: the cards of the hand, the winning spot. */
  glow?: THREE.Object3D[];
}

const HOLD_MS: Record<Tier, number> = { nice: 1800, big: 2600, huge: 3600 };

export function celebrate(ctx: { stage: TableStage; ui: HTMLElement; sfx: Sfx }, m: Moment): void {
  banner(ctx.ui, m);
  for (const o of m.glow ?? []) halo(ctx.stage, o, HOLD_MS[m.tier]);
  if (m.tier === 'huge' && m.at) shower(ctx.stage, m.at);
  chime(ctx.sfx, m.tier);
}

function banner(ui: HTMLElement, m: Moment): void {
  const b = el('div', `celebrate panel tier-${m.tier}`);
  b.append(el('div', 'celebrate-title', m.title));
  if (m.sub) b.append(el('div', 'celebrate-sub', m.sub));
  ui.append(b);
  setTimeout(() => b.classList.add('out'), HOLD_MS[m.tier]);
  setTimeout(() => b.remove(), HOLD_MS[m.tier] + 400);
}

/** A soft ring of light under an object, pulsing for `ms`. */
function halo(stage: TableStage, target: THREE.Object3D, ms: number): void {
  const box = new THREE.Box3().setFromObject(target);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const centre = stage.root.worldToLocal(box.getCenter(new THREE.Vector3()));
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(size.x, 0.05) * 1.35, Math.max(size.z, 0.05) * 1.35), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(centre.x, centre.y - size.y / 2 + 0.001, centre.z);
  stage.root.add(ring);
  const start = performance.now();
  const tick = () => {
    const t = (performance.now() - start) / ms;
    if (t >= 1 || !ring.parent) {
      ring.removeFromParent();
      ring.geometry.dispose();
      mat.dispose();
      return;
    }
    mat.opacity = Math.min(1, t * 6) * Math.min(1, (1 - t) * 4) * (0.55 + 0.25 * Math.sin(t * 18));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const CHIP_COLORS = ['#c8102e', '#1b7f3b', '#101010', '#5b2a86', '#d4a017'];

/** A handful of chips tossed up over `at` that land and settle on the felt, then fade. */
function shower(stage: TableStage, at: THREE.Vector3): void {
  const n = 28;
  const geo = new THREE.CylinderGeometry(0.019, 0.019, 0.0035, 20);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05, transparent: true });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const color = new THREE.Color();
  const parts = Array.from({ length: n }, (_, i) => {
    mesh.setColorAt(i, color.set(CHIP_COLORS[i % CHIP_COLORS.length]!));
    const a = Math.random() * Math.PI * 2;
    const r = 0.05 + Math.random() * 0.12;
    return {
      p: new THREE.Vector3(at.x, at.y + 0.35 + Math.random() * 0.25, at.z),
      v: new THREE.Vector3(Math.cos(a) * r * 2.2, 0.6 + Math.random() * 0.6, Math.sin(a) * r * 2.2),
      spin: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      w: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
      rest: false,
    };
  });
  stage.root.add(mesh);
  const floor = at.y + 0.002;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  let last = performance.now();
  const start = last;
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = (now - start) / 1000;
    if (age > 3.2 || !mesh.parent) {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
      return;
    }
    parts.forEach((c, i) => {
      if (!c.rest) {
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        c.spin.x += c.w.x * dt;
        c.spin.y += c.w.y * dt;
        c.spin.z += c.w.z * dt;
        if (c.p.y <= floor && c.v.y < 0) {
          c.p.y = floor;
          if (Math.abs(c.v.y) < 0.6) {
            c.rest = true;
            c.spin.set(0, c.spin.y, 0);
          } else {
            c.v.y *= -0.3;
            c.v.x *= 0.6;
            c.v.z *= 0.6;
          }
        }
      }
      mesh.setMatrixAt(i, m4.compose(c.p, q.setFromEuler(c.spin), one));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mat.opacity = age > 2.4 ? Math.max(0, 1 - (age - 2.4) / 0.8) : 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** A short rising chime through the shared master gain: longer and brighter for bigger wins. */
function chime(sfx: Sfx, tier: Tier): void {
  const ctx = sfx.audio;
  if (ctx.state !== 'running') return;
  const notes = tier === 'nice' ? [659.25, 987.77] : tier === 'big' ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
  const t0 = ctx.currentTime + 0.02;
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    const t = t0 + i * 0.09;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(sfx.out);
    o.start(t);
    o.stop(t + 0.75);
  });
  if (tier !== 'nice') sfx.play('chips-stack', { volume: 0.7, delay: 0.25 });
}
