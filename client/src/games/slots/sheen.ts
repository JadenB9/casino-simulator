// The glass in front of the reels of the machine you're playing: a faint band of light along its
// top edge and a soft diagonal streak, added over the reels so the window reads as glass with
// the drums behind it. One mesh while you play (the floor's cabinets don't carry it), drawn
// additively and too faint to dim or tint a symbol; it never moves, so calm has nothing to hold.

import * as THREE from 'three';

let texture: THREE.CanvasTexture | null = null;

function sheenTexture(): THREE.CanvasTexture {
  if (texture) return texture;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  // the top edge catches the room's light
  const top = g.createLinearGradient(0, 0, 0, 128);
  top.addColorStop(0, 'rgba(255, 250, 240, 0.34)');
  top.addColorStop(0.12, 'rgba(255, 250, 240, 0.1)');
  top.addColorStop(0.3, 'rgba(255, 250, 240, 0)');
  top.addColorStop(0.9, 'rgba(255, 250, 240, 0)');
  top.addColorStop(1, 'rgba(255, 250, 240, 0.08)');
  g.fillStyle = top;
  g.fillRect(0, 0, 256, 128);
  // and a soft streak runs across it, low on the left and high on the right
  g.save();
  g.translate(128, 64);
  g.rotate(-0.5);
  const streak = g.createLinearGradient(0, -30, 0, 30);
  streak.addColorStop(0, 'rgba(255, 255, 255, 0)');
  streak.addColorStop(0.5, 'rgba(255, 255, 255, 0.07)');
  streak.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = streak;
  g.fillRect(-60, -30, 300, 60);
  g.restore();
  texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The sheen over a `w` x `h` window centred at `at` (cabinet-local); remove it with dispose(). */
export function addSheen(parent: THREE.Object3D, w: number, h: number, at: THREE.Vector3): { dispose(): void } {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: sheenTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  mesh.position.copy(at);
  mesh.renderOrder = 3;
  mesh.name = 'slots-sheen';
  parent.add(mesh);
  return {
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
  };
}
