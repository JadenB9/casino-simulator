// The gift box on the floor: a box in wine-red lacquer paper tied with a gold ribbon and a bow,
// floating a hand above the carpet over a soft pool of gold light, turning slowly and bobbing so it
// catches the eye from across a room. Opened, the lid pops off and the box sinks away.

import * as THREE from 'three';

const SIZE = 0.4;
const FLOAT = 0.16;
/** Seconds the opening takes. */
const OPEN_S = 0.9;

export class GiftModel {
  readonly root = new THREE.Group();
  private readonly box = new THREE.Group();
  private readonly lid = new THREE.Group();
  private readonly pool: THREE.Mesh;
  private readonly owned: { dispose(): void }[] = [];
  private t = Math.random() * 10;
  private opening = -1;

  constructor() {
    this.root.name = 'gift-box';
    const paper = this.own(new THREE.MeshStandardMaterial({ color: 0x7a0f22, roughness: 0.32, metalness: 0.15 }));
    // the ribbon glows a little past the bloom's threshold, so it reads from across a room
    const ribbon = this.own(new THREE.MeshStandardMaterial({ color: 0xd9ad4a, roughness: 0.28, metalness: 0.85, emissive: 0xffc861, emissiveIntensity: 0.9 }));
    const body = this.own(new THREE.BoxGeometry(SIZE, SIZE * 0.82, SIZE));
    const lid = this.own(new THREE.BoxGeometry(SIZE * 1.06, SIZE * 0.2, SIZE * 1.06));
    const bandA = this.own(new THREE.BoxGeometry(SIZE * 0.14, SIZE * 0.83, SIZE * 1.01));
    const bandB = this.own(new THREE.BoxGeometry(SIZE * 1.01, SIZE * 0.83, SIZE * 0.14));
    const lidA = this.own(new THREE.BoxGeometry(SIZE * 0.14, SIZE * 0.21, SIZE * 1.07));
    const lidB = this.own(new THREE.BoxGeometry(SIZE * 1.07, SIZE * 0.21, SIZE * 0.14));
    const loop = this.own(new THREE.TorusGeometry(SIZE * 0.16, SIZE * 0.035, 8, 20));

    const b = new THREE.Mesh(body, paper);
    b.position.y = (SIZE * 0.82) / 2;
    const ba = new THREE.Mesh(bandA, ribbon);
    ba.position.y = b.position.y;
    const bb = new THREE.Mesh(bandB, ribbon);
    bb.position.y = b.position.y;
    this.box.add(b, ba, bb);

    const l = new THREE.Mesh(lid, paper);
    const la = new THREE.Mesh(lidA, ribbon);
    const lb = new THREE.Mesh(lidB, ribbon);
    const bow1 = new THREE.Mesh(loop, ribbon);
    bow1.position.set(-SIZE * 0.12, SIZE * 0.2, 0);
    bow1.rotation.set(0, 0, Math.PI / 5);
    const bow2 = new THREE.Mesh(loop, ribbon);
    bow2.position.set(SIZE * 0.12, SIZE * 0.2, 0);
    bow2.rotation.set(0, 0, -Math.PI / 5);
    this.lid.add(l, la, lb, bow1, bow2);
    this.lid.position.y = SIZE * 0.82 + SIZE * 0.08;
    this.box.add(this.lid);

    // a pool of gold light on the carpet under it
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,214,120,0.85)');
    grad.addColorStop(0.35, 'rgba(255,190,90,0.35)');
    grad.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = this.own(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const glow = this.own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.pool = new THREE.Mesh(this.own(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2)), glow);
    this.pool.position.y = 0.015;
    this.pool.renderOrder = 2;

    this.box.position.y = FLOAT;
    this.root.add(this.pool, this.box);
  }

  /** Pop the lid and sink away; `done` once it's gone. */
  open(done: () => void): void {
    if (this.opening >= 0) return;
    this.opening = 0;
    this.onGone = done;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.opening >= 0) {
      this.opening += dt / OPEN_S;
      const k = Math.min(1, this.opening);
      this.lid.position.y = SIZE * 0.9 + k * 0.5;
      this.lid.rotation.z = k * 1.1;
      this.box.scale.setScalar(Math.max(0.001, 1 - k * k));
      (this.pool.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (k >= 1 && this.onGone) {
        const f = this.onGone;
        this.onGone = null;
        f();
      }
      return;
    }
    this.box.position.y = FLOAT + Math.sin(this.t * 1.8) * 0.035;
    this.box.rotation.y = this.t * 0.6;
    (this.pool.material as THREE.MeshBasicMaterial).opacity = 0.8 + Math.sin(this.t * 2.4) * 0.2;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }

  private onGone: (() => void) | null = null;

  private own<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }
}
