// v7: the guns as models, built from boxes and cylinders in the gun's finish: its grip at the
// origin, the barrel along +z (the muzzle at `userData.length`), about the size of the real thing.

import * as THREE from 'three';
import type { GunItem, GunModel } from '../../../../shared/src/arms.ts';

const mats = new Map<string, THREE.Material>();
function mat(color: string, metal = 0.7, rough = 0.4): THREE.Material {
  const key = `${color}|${metal}|${rough}`;
  let m = mats.get(key);
  if (!m) mats.set(key, (m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough })));
  return m;
}

const FINISH: Record<GunItem['finish'], { body: string; metal: number; grip: string }> = {
  black: { body: '#1a1b1e', metal: 0.5, grip: '#141414' },
  steel: { body: '#7b8088', metal: 0.85, grip: '#232323' },
  wood: { body: '#26272b', metal: 0.7, grip: '#6a3e1f' },
  gold: { body: '#d4a53c', metal: 1, grip: '#efe6d0' },
  chrome: { body: '#c9ccd2', metal: 1, grip: '#5a3218' },
};

/** Which hold a model takes: one hand out (1) or both at the shoulder (2). */
export function holdOf(model: GunModel): 1 | 2 {
  return model === 'pistol' || model === 'revolver' || model === 'cannon' ? 1 : 2;
}

/** A gun's model, a new group each time (its geometries its own; materials shared). */
export function gunModel(g: GunItem): THREE.Group {
  const f = FINISH[g.finish];
  const body = mat(f.body, f.metal, 0.35);
  const grip = mat(f.grip, g.finish === 'gold' ? 0.1 : 0.05, 0.7);
  const dark = mat('#101012', 0.6, 0.5);
  const group = new THREE.Group();
  const box = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    group.add(mesh);
  };
  const tube = (m: THREE.Material, r: number, len: number, x: number, y: number, z: number, seg = 12) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), m);
    mesh.position.set(x, y, z + len / 2);
    group.add(mesh);
  };
  let length = 0.2;
  switch (g.model) {
    case 'pistol':
    case 'cannon': {
      const big = g.model === 'cannon' ? 1.3 : 1;
      box(grip, 0.03 * big, 0.11 * big, 0.045 * big, 0, -0.03, -0.01, -0.25);
      box(body, 0.032 * big, 0.04 * big, 0.18 * big, 0, 0.035 * big, 0.06 * big);
      box(dark, 0.012, 0.03, 0.03, 0, -0.005, 0.03);
      length = 0.15 * big;
      break;
    }
    case 'revolver':
      box(grip, 0.03, 0.11, 0.045, 0, -0.03, -0.015, -0.3);
      box(body, 0.03, 0.045, 0.07, 0, 0.03, 0.03);
      tube(body, 0.022, 0.035, 0, 0.03, 0.02, 10);
      tube(body, 0.009, 0.16, 0, 0.042, 0.06);
      length = 0.22;
      break;
    case 'smg':
      box(grip, 0.03, 0.1, 0.04, 0, -0.03, 0.0, -0.2);
      box(body, 0.04, 0.06, 0.28, 0, 0.03, 0.08);
      box(dark, 0.02, 0.14, 0.03, 0, -0.06, 0.1);
      box(dark, 0.02, 0.03, 0.18, 0, 0.03, -0.12);
      tube(body, 0.01, 0.1, 0, 0.035, 0.22);
      length = 0.32;
      break;
    case 'drum':
      box(grip, 0.035, 0.1, 0.05, 0, -0.03, 0, -0.2);
      box(body, 0.04, 0.06, 0.34, 0, 0.03, 0.12);
      tube(grip, 0.025, 0.2, 0, 0.02, 0.18);
      tube(body, 0.011, 0.14, 0, 0.04, 0.29);
      box(grip, 0.04, 0.08, 0.22, 0, 0.0, -0.14);
      {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 20).rotateZ(Math.PI / 2), dark);
        d.position.set(0, -0.06, 0.12);
        group.add(d);
      }
      length = 0.43;
      break;
    case 'shotgun':
      box(grip, 0.04, 0.09, 0.3, 0, -0.01, -0.2, 0.08);
      box(body, 0.045, 0.06, 0.2, 0, 0.02, 0.05);
      tube(body, 0.014, 0.52, 0, 0.04, 0.12);
      tube(grip, 0.02, 0.2, 0, 0.01, 0.22);
      length = 0.64;
      break;
    case 'rifle':
      box(dark, 0.04, 0.08, 0.26, 0, 0.0, -0.18);
      box(body, 0.045, 0.07, 0.34, 0, 0.03, 0.08);
      box(dark, 0.025, 0.14, 0.05, 0, -0.07, 0.07);
      box(dark, 0.03, 0.04, 0.08, 0, 0.09, 0.04);
      tube(body, 0.012, 0.28, 0, 0.035, 0.24);
      length = 0.52;
      break;
    case 'marksman':
      box(grip, 0.045, 0.1, 0.36, 0, -0.01, -0.12, 0.05);
      box(body, 0.045, 0.06, 0.22, 0, 0.03, 0.12);
      tube(dark, 0.028, 0.3, 0, 0.1, -0.04);
      tube(body, 0.012, 0.44, 0, 0.04, 0.22);
      length = 0.66;
      break;
    case 'rotary':
      box(dark, 0.12, 0.12, 0.3, 0, 0.0, -0.05);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        tube(body, 0.012, 0.5, Math.cos(a) * 0.04, 0.02 + Math.sin(a) * 0.04, 0.1, 8);
      }
      box(grip, 0.03, 0.12, 0.05, 0, -0.1, -0.05, -0.2);
      box(dark, 0.02, 0.18, 0.02, 0.07, 0.07, -0.05);
      length = 0.6;
      break;
  }
  group.userData.length = length;
  group.name = `gun:${g.id}`;
  return group;
}

/** Take a gun model's geometries away (the materials are shared). */
export function disposeGun(g: THREE.Object3D): void {
  g.removeFromParent();
  g.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
}
