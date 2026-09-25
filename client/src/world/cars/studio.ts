// The valet's showroom: the car you're looking at on a turntable in a room of its own, drawn by the
// game's one renderer the way the boutique's showroom is. The room is built far below the floor,
// out of every other view; the camera is borrowed while the valet's panel is open and put back when
// it closes. The car turns slowly (a drag turns it by hand), and the camera frames the whole car in
// the part of the screen the panel leaves free.

import * as THREE from 'three';
import { MatBatch, carKit } from './models.ts';
import type { CarMaterials } from './materials.ts';

export interface StudioOpts {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  onFrame(fn: (dt: number) => void): () => void;
  mats: CarMaterials;
  /** Where the room is built. Default: 60 m below the floor, clear of the boutique's. */
  at?: THREE.Vector3;
  /** The part of the screen the car should sit in. */
  area(): { x0: number; y0: number; x1: number; y1: number };
}

const DISC_R = 3.6;

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CarStudio {
  private readonly group = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly car = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly own: { dispose(): void }[] = [];
  private readonly camBefore: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  private readonly offFrame: () => void;
  private yaw = -0.6;
  private held = 0;
  private shown = '';
  private length = 4.5;
  private height = 1.3;
  private placed = false;
  private readonly camAt = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();

  constructor(private readonly opts: StudioOpts) {
    this.camBefore = { position: opts.camera.position.clone(), quaternion: opts.camera.quaternion.clone() };
    this.group.name = 'car-studio';
    this.group.position.copy(opts.at ?? new THREE.Vector3(40, -60, 0));
    this.build();
    this.pivot.add(this.car);
    this.group.add(this.pivot);
    opts.scene.add(this.group);
    this.offFrame = opts.onFrame((dt) => this.update(dt));
  }

  /** A dealer's floor: polished dark stone, a turntable ringed in brass, a curved grey backdrop, soft boxes overhead. */
  private build(): void {
    const floorTex = canvasTexture(512, 512, (g) => {
      const r = g.createRadialGradient(256, 256, 0, 256, 256, 256);
      r.addColorStop(0, '#26282b');
      r.addColorStop(0.35, '#1a1b1e');
      r.addColorStop(0.75, '#0c0d0e');
      r.addColorStop(1, '#060607');
      g.fillStyle = r;
      g.fillRect(0, 0, 512, 512);
    });
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.25, metalness: 0, envMap: this.opts.scene.environment, envMapIntensity: 0.25 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64).rotateX(-Math.PI / 2), floorMat);
    this.group.add(floor);
    const wallTex = canvasTexture(1024, 512, (g) => {
      const v = g.createLinearGradient(0, 0, 0, 512);
      v.addColorStop(0, '#050506');
      v.addColorStop(0.45, '#1b1d21');
      v.addColorStop(0.62, '#23262b');
      v.addColorStop(1, '#0b0c0d');
      g.fillStyle = v;
      g.fillRect(0, 0, 1024, 512);
    });
    const wallMat = new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 12, 64, 1, true), wallMat);
    wall.position.y = 5;
    this.group.add(wall);
    // the turntable's base (it stays still) and its ring
    const base = new MatBatch()
      .add('trim', new THREE.CylinderGeometry(DISC_R + 0.3, DISC_R + 0.35, 0.05, 72).translate(0, 0.025, 0), '#101113')
      .add('metal', new THREE.TorusGeometry(DISC_R + 0.31, 0.02, 6, 96).rotateX(Math.PI / 2).translate(0, 0.05, 0), '#8f7032')
      .build();
    for (const [m, g] of base) {
      this.geos.push(g);
      this.group.add(new THREE.Mesh(g, this.opts.mats.get(m)));
    }
    const disc = new MatBatch().add('trim', new THREE.CylinderGeometry(DISC_R, DISC_R, 0.05, 72).translate(0, 0.075, 0), '#1c1d21');
    for (let i = 0; i < 36; i++) disc.add('metal', new THREE.BoxGeometry(0.015, 0.004, DISC_R * 0.92).translate(0, 0.102, DISC_R * 0.46).applyMatrix4(new THREE.Matrix4().makeRotationY((i / 36) * Math.PI * 2)), '#5b5955');
    for (const [m, g] of disc.build()) {
      this.geos.push(g);
      this.pivot.add(new THREE.Mesh(g, this.opts.mats.get(m)));
    }
    // light: a big soft key above, a rim from behind, a low fill; short reach, so nothing up on the floor
    const key = new THREE.SpotLight('#fff3e4', 90, 16, 0.75, 0.8, 1.2);
    key.position.set(2.5, 7.5, 4.5);
    key.target.position.set(0, 0.5, 0);
    const rim = new THREE.SpotLight('#dfe8ff', 70, 16, 0.7, 0.8, 1.2);
    rim.position.set(-4, 5, -6);
    rim.target.position.set(0, 0.6, 0);
    const fill = new THREE.PointLight('#f0e2cf', 10, 12, 1.4);
    fill.position.set(-4.5, 1.6, 4);
    this.group.add(key, key.target, rim, rim.target, fill);
    // the soft boxes, seen in the paint as long bright bars
    const box = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.4), new THREE.MeshBasicMaterial({ color: '#fdf6ea', side: THREE.DoubleSide }));
    box.position.set(0, 6.5, 0.5);
    box.rotation.x = Math.PI / 2;
    this.group.add(box);
    this.own.push(floorTex, floorMat, floor.geometry, wallTex, wallMat, wall.geometry, box.geometry, box.material as THREE.Material);
  }

  /** Put this car on the turntable (in its own paint). */
  show(id: string): void {
    if (id === this.shown) return;
    this.shown = id;
    for (const c of [...this.car.children]) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
    }
    this.car.clear();
    const b = new MatBatch().car({ id, matrix: new THREE.Matrix4().makeTranslation(0, 0.1, 0) });
    for (const [m, g] of b.build()) this.car.add(new THREE.Mesh(g, this.opts.mats.get(m)));
    const k = carKit(id);
    this.length = k.length;
    this.height = k.height;
  }

  /** Turn by hand; the slow turn takes over again after a moment. */
  turn(by: number): void {
    this.yaw += by;
    this.held = 2.5;
  }

  reframe(): void {
    this.placed = false;
  }

  private update(dt: number): void {
    if (this.held > 0) this.held -= dt;
    else this.yaw += dt * 0.22;
    this.pivot.rotation.y = this.yaw;
    this.place(dt);
  }

  /** The camera: the car's middle centred in the free part of the screen, its length filling most of it. */
  private place(dt: number): void {
    const cam = this.opts.camera;
    const a = this.opts.area();
    const vw = innerWidth;
    const vh = innerHeight;
    const half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const fracW = Math.max(0.2, (a.x1 - a.x0) / vw);
    const fracH = Math.max(0.2, (a.y1 - a.y0) / vh);
    // fit the car's longest extent (it turns) across the free width, and its height up the free height
    const needW = this.length * 1.05;
    const dW = needW / (2 * half * (vw / vh) * fracW);
    const dH = (this.height * 2.2) / (2 * half * fracH);
    const d = Math.max(dW, dH, 4);
    const cx = ((a.x0 + a.x1) / 2 / vw) * 2 - 1;
    const cy = -(((a.y0 + a.y1) / 2 / vh) * 2 - 1);
    const focus = this.group.position.clone().add(new THREE.Vector3(0, this.height * 0.42, 0));
    const halfH = d * half;
    const halfW = halfH * (vw / vh);
    // a little above, looking down at the car the way you'd stand beside it
    const pos = focus.clone().add(new THREE.Vector3(0, d * 0.28, d));
    const look = new THREE.Vector3(focus.x - cx * halfW, focus.y - cy * halfH, focus.z);
    const k = this.placed ? 1 - Math.exp(-dt * 5) : 1;
    this.camAt.lerp(pos, k);
    this.camLook.lerp(look, k);
    if (!this.placed) {
      this.camAt.copy(pos);
      this.camLook.copy(look);
      this.placed = true;
    }
    cam.position.copy(this.camAt);
    cam.lookAt(this.camLook);
  }

  dispose(): void {
    this.offFrame();
    for (const c of this.car.children) (c as THREE.Mesh).geometry.dispose();
    for (const g of this.geos) g.dispose();
    for (const o of this.own) o.dispose();
    this.group.removeFromParent();
    this.opts.camera.position.copy(this.camBefore.position);
    this.opts.camera.quaternion.copy(this.camBefore.quaternion);
  }
}
