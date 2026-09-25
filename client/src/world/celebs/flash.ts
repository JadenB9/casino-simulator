// Camera flashes: phones going off in a celebrity's crowd (a few small white bursts at head height,
// bright enough for the bloom to catch), and the screen's own flash when your photo is taken.

import * as THREE from 'three';

const POOL = 8;
/** Seconds a burst lasts. */
const LIFE = 0.14;

export class Flashes {
  readonly group = new THREE.Group();
  private readonly sprites: { s: THREE.Sprite; left: number }[] = [];
  private readonly tex: THREE.CanvasTexture;
  private readonly mat: THREE.SpriteMaterial;

  constructor() {
    this.group.name = 'celeb-flashes';
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,250,0.95)');
    grad.addColorStop(0.45, 'rgba(210,225,255,0.3)');
    grad.addColorStop(1, 'rgba(200,220,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    // brighter than white on purpose: the floor's bloom (threshold 1.65) catches it
    this.mat = new THREE.SpriteMaterial({ map: this.tex, color: new THREE.Color(3.2, 3.2, 3.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    for (let i = 0; i < POOL; i++) {
      const s = new THREE.Sprite(this.mat.clone());
      s.visible = false;
      s.renderOrder = 5;
      this.group.add(s);
      this.sprites.push({ s, left: 0 });
    }
  }

  /** A burst at a point in world space. */
  pop(x: number, y: number, z: number, size = 0.42): void {
    let slot = this.sprites.find((f) => f.left <= 0);
    slot ??= this.sprites.reduce((a, b) => (a.left < b.left ? a : b));
    slot.left = LIFE;
    slot.s.position.set(x, y, z);
    slot.s.scale.setScalar(size);
    slot.s.visible = true;
  }

  update(dt: number): void {
    for (const f of this.sprites) {
      if (f.left <= 0) continue;
      f.left -= dt;
      if (f.left <= 0) {
        f.s.visible = false;
        continue;
      }
      const k = f.left / LIFE;
      (f.s.material as THREE.SpriteMaterial).opacity = k * k;
    }
  }

  dispose(): void {
    for (const f of this.sprites) (f.s.material as THREE.Material).dispose();
    this.mat.dispose();
    this.tex.dispose();
    this.group.removeFromParent();
  }
}

/** The whole screen flashes white for a moment (much softer when motion is reduced). */
export function screenFlash(root: HTMLElement): void {
  const f = document.createElement('div');
  f.className = 'celeb-flash';
  f.setAttribute('aria-hidden', 'true');
  root.append(f);
  setTimeout(() => f.remove(), 700);
}
