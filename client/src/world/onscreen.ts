// Bubbles hung over people (the staff's words, players' chat lines) are placed by CSS2DRenderer at a
// point over the head and grow upward from it. Up close that point is near or past the top of the
// screen and the bubble is cut off (a waiter handing you a drink while the camera is pulled in); at
// the sides it hangs off the edge. fitOnScreen() nudges the bubble through two custom properties its
// CSS adds to its own `translate` (--fit-x, --fit-y), so it stays whole: under the HUD's top bar and
// inside the sides. A bubble pushed down past its anchor loses its tail (`.pinned`).

import * as THREE from 'three';

/** Clear of the HUD's top bar (px). */
const TOP = 76;
/** From the sides (px). */
const SIDE = 8;

const _v = new THREE.Vector3();
const last = new WeakMap<HTMLElement, string>();

/**
 * Keep `bubble` on screen. `anchor` is the CSS2DObject it hangs from; `lift` is how far above the
 * anchor its bottom sits in its CSS (px). The page's viewport is the label layer's size.
 */
export function fitOnScreen(anchor: THREE.Object3D, bubble: HTMLElement, camera: THREE.Camera, lift: number): void {
  let dx = 0;
  let dy = 0;
  anchor.getWorldPosition(_v).project(camera);
  // behind the camera the renderer hides it anyway
  if (_v.z < 1) {
    const w = innerWidth;
    const h = innerHeight;
    const x = ((_v.x + 1) / 2) * w;
    const y = ((1 - _v.y) / 2) * h;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    dy = Math.max(0, Math.round(TOP - (y - lift - bh)));
    const left = x - bw / 2;
    if (left < SIDE) dx = Math.round(SIDE - left);
    else if (left + bw > w - SIDE) dx = Math.round(w - SIDE - (left + bw));
  }
  const key = `${dx},${dy}`;
  if (last.get(bubble) === key) return;
  last.set(bubble, key);
  bubble.style.setProperty('--fit-x', `${dx}px`);
  bubble.style.setProperty('--fit-y', `${dy}px`);
  bubble.classList.toggle('pinned', dy > lift);
}
