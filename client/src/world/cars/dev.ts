// Dev page for the cars, served by Vite in development only:
//   /casino/src/world/cars/dev.html?view=lineup            every car in a row
//   /casino/src/world/cars/dev.html?car=<id>&yaw=<rad>     one car close up (&paint=%23hex)
// &quality=low|high. A plain evening light, so the cars can be judged on their own.

import * as THREE from 'three';
import { Engine3D, type Quality } from '../../render/engine3d.ts';
import { CARS } from '../../../../shared/src/items.ts';
import { CarMaterials } from './materials.ts';
import { carKit, mergeCars, type CarMat } from './models.ts';

const q = new URLSearchParams(location.search);
const quality: Quality = q.get('quality') === 'low' ? 'low' : 'high';
const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, quality);
const scene = engine.scene;
scene.background = new THREE.Color('#1c2230');
scene.add(new THREE.HemisphereLight('#c9d6ea', '#3a3128', 1.4));
const sun = new THREE.DirectionalLight('#ffe2c0', 2.2);
sun.position.set(-6, 9, 7);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3b3d41', roughness: 0.9 }));
scene.add(ground);

const mats = new CarMaterials(quality, scene.environment);
const show = (placed: Parameters<typeof mergeCars>[0]) => {
  for (const [m, g] of mergeCars(placed)) scene.add(new THREE.Mesh(g, mats.get(m as CarMat)));
};

const cam = engine.camera;
const one = q.get('car');
if (one) {
  const yaw = Number(q.get('yaw') ?? 0.7);
  show([{ id: one, paint: q.get('paint') ?? undefined, matrix: new THREE.Matrix4().makeRotationY(yaw) }]);
  const k = carKit(one);
  const d = k.length * 1.15;
  cam.position.set(0, Number(q.get('h') ?? 1.5), d);
  cam.lookAt(0, k.height * 0.45, 0);
} else {
  const gap = 2.6;
  show(CARS.map((c, i) => ({ id: c.id, matrix: new THREE.Matrix4().makeRotationY(-Math.PI / 2 + 0.5).setPosition(((i % 6) - 2.5) * gap, 0, Math.floor(i / 6) * 6.5 - 3) })));
  cam.position.set(0, 6.5, 13);
  cam.lookAt(0, 0.5, 0);
}
(window as unknown as { dev: unknown }).dev = { engine, carKit };
