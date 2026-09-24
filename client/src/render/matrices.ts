// three.js brings every object's matrices up to date before it draws a frame, hidden or not. The
// floor has thousands of objects that are hidden most of the time: every character's skeleton
// (seventy-odd bones each: dealers, waiters and other players out of view), and every table and
// machine showing its far stand-in instead of its real model. Registered subtrees are passed over
// by that frame update while they're hidden, and brought up to date the first frame they show.
//
// Only the frame's own update skips them (Engine3D wraps its render in `framePass`): an explicit
// `updateMatrixWorld(true)` (measuring a character's arms, baking a far copy, a ray against a model)
// still updates everything, hidden or not.

import * as THREE from 'three';

let inPass = false;
const base = THREE.Object3D.prototype.updateMatrixWorld;

/** Run the frame's render with hidden registered subtrees left out of its matrix update. */
export function framePass(render: () => void): void {
  inPass = true;
  try {
    render();
  } finally {
    inPass = false;
  }
}

/** Leave this object and everything under it out of the frame's matrix update while it's hidden. */
export function skipWhileHidden(o: THREE.Object3D): void {
  o.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean) {
    if (inPass && !this.visible) {
      // whatever moved meanwhile is caught up the first frame it's drawn again
      this.matrixWorldNeedsUpdate = true;
      return;
    }
    base.call(this, force);
  };
}
