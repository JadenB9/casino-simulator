// The selfie with a celebrity: the scene drawn once more from where their phone is, held up in
// front of the two of you, and kept as a small picture for the photo card. It's drawn to the
// canvas at the start of a frame and copied off straight away (a WebGL canvas can only be read in
// the task that drew it); the frame's own drawing replaces it before anyone sees it, and the
// screen's flash is up at that moment anyway.

import * as THREE from 'three';

export interface Snapper {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
}

const W = 480;
const H = 360;

/** Where the phone is: in front of the pair, on the side `toward` is (the room behind the view), at head height. */
export function selfieCamera(a: { x: number; z: number }, b: { x: number; z: number }, toward: { x: number; z: number }): THREE.PerspectiveCamera {
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  // the side of the pair the viewer is on
  let nx = dz;
  let nz = -dx;
  if ((toward.x - mx) * nx + (toward.z - mz) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  const back = 0.9 + len * 0.55;
  const cam = new THREE.PerspectiveCamera(52, W / H, 0.1, 60);
  cam.position.set(mx + nx * back, 1.9, mz + nz * back);
  cam.lookAt(mx, 1.45, mz);
  cam.updateMatrixWorld();
  return cam;
}

/** The scene from `cam`, as a canvas of its own; null if it can't be drawn. */
export function takeSelfie(s: Snapper, cam: THREE.PerspectiveCamera): HTMLCanvasElement | null {
  try {
    const r = s.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    cam.aspect = size.x / size.y;
    cam.updateProjectionMatrix();
    r.setRenderTarget(null);
    r.render(s.scene, cam);
    // the middle of the frame at the card's shape
    const src = r.domElement;
    const h = size.y;
    const w = Math.min(size.x, (h * W) / H);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    out.getContext('2d')!.drawImage(src, (size.x - w) / 2, 0, w, h, 0, 0, W, H);
    return out;
  } catch {
    return null;
  }
}
