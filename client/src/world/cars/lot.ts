// The valet lot: the two parking blocks either side of the porte-cochère, their asphalt with the
// stalls painted on, the cars parked in them tonight, and the lamp posts. The asphalt is one
// textured mesh per block; the cars and the posts are merged into the cars' materials (five or
// six draw calls for the whole lot), and every parked car stops the walker and the camera.

import * as THREE from 'three';
import type { Collider } from '../collision.ts';
import { MatBatch, carKit, type CarMat } from './models.ts';
import type { CarMaterials } from './materials.ts';
import { BLOCKS, STALL_D, STALL_W, VALET, aisleZ, parked, stalls } from './layout.ts';

/** Metres of asphalt per texture pixel's worth: the canvas maps the block 1:1 at this many px per metre. */
const PX = 24;

function asphalt(w: number, d: number, north: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = Math.round(w * PX);
  c.height = Math.round(d * PX);
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2b2d';
  g.fillRect(0, 0, c.width, c.height);
  // aggregate: a fine speckle, and the darker oil down the middle of each stall
  let seed = north ? 7 : 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < c.width * c.height * 0.06; i++) {
    const v = 30 + Math.floor(rnd() * 26);
    g.fillStyle = `rgb(${v},${v},${v + 2})`;
    g.fillRect(rnd() * c.width, rnd() * c.height, 1.5, 1.5);
  }
  return new THREE.CanvasTexture(c);
}

export interface Lot {
  group: THREE.Group;
  dispose(): void;
}

/** The lot: asphalt, painted stalls, parked cars, lamp posts; parked cars added to the collider. */
export function buildLot(mats: CarMaterials, col: Collider, aniso: number): Lot {
  const group = new THREE.Group();
  group.name = 'valet-lot';
  const all = stalls();
  const disposables: { dispose(): void }[] = [];

  for (const b of BLOCKS) {
    const w = VALET.x1 - VALET.x0 - 2;
    const x0 = VALET.x0 + 2;
    const d = b.z1 - b.z0;
    const tex = asphalt(w, d, b.north);
    const g = tex.image.getContext('2d') as CanvasRenderingContext2D;
    // canvas x = world x from x0; canvas y = world z from z0
    const px = (x: number) => (x - x0) * PX;
    const pz = (z: number) => (z - b.z0) * PX;
    g.strokeStyle = '#d9d6cc';
    g.lineWidth = 0.11 * PX;
    for (const s of all.filter((q) => (b.north ? q.z > 0 : q.z < 0))) {
      // each stall's two sides and its end; the aisle side left open
      const zA = s.z - STALL_D / 2;
      const zB = s.z + STALL_D / 2;
      for (const x of [s.x - STALL_W / 2, s.x + STALL_W / 2]) {
        g.beginPath();
        g.moveTo(px(x), pz(zA));
        g.lineTo(px(x), pz(zB));
        g.stroke();
      }
      // a wheel stop at the back of the stall
      const back = s.yaw === 0 ? zA + 0.5 : zB - 0.5;
      g.fillStyle = '#8f8a80';
      g.fillRect(px(s.x - 0.8), pz(back) - 0.08 * PX, 1.6 * PX, 0.16 * PX);
    }
    // the aisle's arrows and the painted words, as a valet lot has them
    const az = aisleZ(b.north);
    g.fillStyle = '#d9d6cc';
    g.font = `600 ${Math.round(1.1 * PX)}px "Inter", "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    g.translate(px(x0 + w - 4), pz(az));
    g.rotate(Math.PI / 2);
    g.fillText('VALET ONLY', 0, 0);
    g.restore();
    tex.anisotropy = aniso;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
    mesh.position.set(x0 + w / 2, 0.01, (b.z0 + b.z1) / 2);
    group.add(mesh);
    disposables.push(tex, mat, mesh.geometry);
  }

  // the cars in tonight, and the posts
  const batch = new MatBatch();
  for (const p of parked()) {
    const m = new THREE.Matrix4().makeRotationY(p.stall.yaw).setPosition(p.stall.x, 0, p.stall.z);
    batch.car({ id: p.id, paint: p.paint, matrix: m });
    const k = carKit(p.id);
    col.box(p.stall.x, p.stall.z, k.width, k.length, p.stall.yaw, k.height, { cam: false });
  }
  for (const b of BLOCKS) {
    const az = aisleZ(b.north);
    for (const x of [VALET.x0 + 3, VALET.x1 - 1]) {
      for (const z of [az - 3.8, az + 3.8]) lampPost(batch, x, z, x < 140 ? 1 : -1);
      col.post(x, az - 3.8, 0.12, 6);
      col.post(x, az + 3.8, 0.12, 6);
    }
  }
  for (const [m, geo] of batch.build()) {
    const mesh = new THREE.Mesh(geo, mats.get(m as CarMat));
    mesh.name = `lot-${m}`;
    group.add(mesh);
    disposables.push(geo);
  }
  return {
    group,
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}

/** A car-park lamp: a dark pole, an arm out over the aisle, a lit head. */
function lampPost(b: MatBatch, x: number, z: number, arm: 1 | -1): void {
  b.add('trim', new THREE.CylinderGeometry(0.07, 0.1, 6, 8).translate(x, 3, z), '#2d2f33');
  b.add('trim', new THREE.CylinderGeometry(0.2, 0.24, 0.3, 8).translate(x, 0.15, z), '#8b8a86');
  b.add('trim', new THREE.BoxGeometry(1.2, 0.08, 0.08).translate(x + arm * 0.6, 5.95, z), '#2d2f33');
  b.add('trim', new THREE.BoxGeometry(0.7, 0.12, 0.34).translate(x + arm * 1.15, 5.9, z), '#2d2f33');
  b.add('lamp', new THREE.BoxGeometry(0.6, 0.02, 0.26).translate(x + arm * 1.15, 5.83, z), '#fff1d6');
}
