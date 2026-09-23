// A bare room with warm light and one station, for developing a table view without the floor.

import * as THREE from 'three';
import type { Engine3D } from '../render/engine3d.ts';
import type { GameClientModule } from '../games/contract.ts';
import type { Station } from './contract.ts';

export function devRoom(engine: Engine3D, module: GameClientModule, variant: string): Station {
  const scene = engine.scene;
  scene.add(new THREE.HemisphereLight('#ffe2b8', '#2a1a10', 0.55));
  const key = new THREE.SpotLight('#ffd9a3', 60, 12, Math.PI / 5, 0.5, 1.6);
  key.position.set(0.4, 3.2, 1.2);
  key.target.position.set(0, 0.7, 0);
  scene.add(key, key.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshLambertMaterial({ color: '#3a1418' }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const anchor = new THREE.Group();
  anchor.add(module.createModel({ variant, quality: engine.quality }));
  scene.add(anchor);
  return { id: `dev-${module.game}`, game: module.game, variant, anchor };
}
