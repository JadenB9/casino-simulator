// The ground floor on the dev page: the whole world, the player put down out front, and a stand-in
// for the floor's messages (see dev.ts). The street's own light comes with the city; until then a
// dusk sky and light stand in here, so the cars can be looked at.

import * as THREE from 'three';
import { Engine3D, type Quality } from '../../render/engine3d.ts';
import { createWorld } from '../index.ts';
import { CARS } from '../../../../shared/src/items.ts';
import { CURB_MS, VALET_STAND, type CarCall } from '../../../../shared/src/valet.ts';
import { toast } from '../../ui/kit.ts';
import { Cars } from './index.ts';
import { GARAGE } from './layout.ts';

const SPOTS: Record<string, [number, number, number]> = {
  stand: [VALET_STAND.x - 1.6, VALET_STAND.z - 0.5, Math.PI / 2],
  lot: [134, 12, 0.6],
  garage: [GARAGE.x0 + 2, GARAGE.doorZ, Math.PI / 2],
  street: [163, GARAGE.doorZ, Math.PI / 2],
  inside: [GARAGE.x0 + 6, GARAGE.doorZ + 0.5, Math.PI / 2 + 0.2],
};

export async function runGround(q: URLSearchParams): Promise<void> {
  const quality: Quality = q.get('quality') === 'low' ? 'low' : 'high';
  const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, quality, { antialias: false });
  const world = await createWorld(engine, { quality, name: 'You' });
  // a dusk sky and light, standing in for the city's
  engine.scene.background = new THREE.Color('#2a3348');
  const hemi = new THREE.HemisphereLight('#b9c6de', '#3b3128', 1.3);
  const sun = new THREE.DirectionalLight('#ffd2a6', 1.6);
  sun.position.set(80, 40, 30);
  sun.target.position.set(150, 0, 0);
  engine.scene.add(hemi, sun, sun.target);
  let calls: CarCall[] = [];
  const me = 1;
  const cars = new Cars({
    engine,
    world,
    now: () => Date.now(),
    me: () => me,
    onValet: () => toast('Valet: the panel opens here in the game.'),
    standIns: true,
    onKeys: (c) => toast(`Your ${CARS.find((x) => x.id === c.car)?.name} is at the curb. The valet hands you the keys.`),
  });
  await cars.load();
  cars.setOwned((q.get('owned') ?? 'halden-roadster,raffica-v10,ombra-oro,solenne-cabriolet').split(',').filter(Boolean), 'Jaden');
  engine.onFrame((dt) => {
    world.update(dt);
    cars.update(dt);
  });
  const [x, z, yaw] = SPOTS[q.get('at') ?? 'stand'] ?? SPOTS.stand!;
  world.teleport(x, z, yaw);
  document.getElementById('boot')?.classList.add('done');
  const dev = {
    engine,
    world,
    cars,
    call(car = 'ombra-oro', id = me, slot?: number) {
      const now = Date.now();
      const c: CarCall = { id, name: `p${id}`, car, slot: slot ?? calls.filter((k) => k.until > now && k.id !== id).length, at: now, until: now + CURB_MS };
      calls = [...calls.filter((k) => k.id !== id), c];
      cars.hear({ t: 'car', ...c });
    },
    back(id = me) {
      const c = calls.find((k) => k.id === id);
      if (!c) return;
      c.until = Date.now();
      cars.hear({ t: 'car', ...c });
    },
    look(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
      world.player.setEnabled(false);
      engine.camera.position.set(px, py, pz);
      engine.camera.lookAt(tx, ty, tz);
    },
  };
  (window as unknown as { dev: unknown }).dev = dev;
}
