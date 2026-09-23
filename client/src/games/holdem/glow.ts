// Light for the cards that make a hand: a warm glow spreading on the felt under each card,
// pulsing while the moment lasts. It sits on the felt rather than under the card's own box (a
// card is thinner than any offset from its box), so it stays under cards that are lifted, tilted
// toward their owner or redrawn from the next view while it plays.

import * as THREE from 'three';
import type { TableStage } from '../../table/stage.ts';

const geometry = new THREE.PlaneGeometry(1, 1);
const box = new THREE.Box3();
const size = new THREE.Vector3();
const centre = new THREE.Vector3();

/** Glow under `objects` for `ms` (Infinity: until stopped). Returns the stop. */
export function feltGlow(stage: TableStage, objects: THREE.Object3D[], feltY: number, ms: number): () => void {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.15, 0.55), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const spots: THREE.Mesh[] = [];
  for (const o of objects) {
    // Measured in the table's own space (the cards are its children), so a station turned on
    // the floor doesn't widen the box.
    if (!(o instanceof THREE.Mesh) || o.parent !== stage.root) continue;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    o.updateMatrix();
    box.copy(o.geometry.boundingBox!).applyMatrix4(o.matrix);
    box.getSize(size);
    box.getCenter(centre);
    const spot = new THREE.Mesh(geometry, mat);
    spot.rotation.x = -Math.PI / 2;
    spot.scale.set(size.x * 1.34 + 0.012, size.z * 1.26 + 0.012, 1);
    spot.position.set(centre.x, feltY + 0.0005, centre.z);
    spot.renderOrder = 1;
    stage.root.add(spot);
    spots.push(spot);
  }
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    for (const s of spots) s.removeFromParent();
    mat.dispose();
  };
  const start = performance.now();
  const tick = () => {
    if (done) return;
    const t = performance.now() - start;
    if (t >= ms || !spots.some((s) => s.parent)) return stop();
    // In over a fifth of a second, a slow breath, out over the last half second.
    const fadeIn = Math.min(1, t / 200);
    const fadeOut = Number.isFinite(ms) ? Math.min(1, (ms - t) / 500) : 1;
    mat.opacity = fadeIn * fadeOut * (0.62 + 0.2 * Math.sin(t / 190));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return stop;
}
