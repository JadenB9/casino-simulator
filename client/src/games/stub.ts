// A placeholder table for a game whose client isn't built yet: a plain table with a sign.

import * as THREE from 'three';
import type { GameId } from '../../../shared/src/engine.ts';
import type { GameClientModule } from './contract.ts';
import { el } from '../ui/kit.ts';

export function stubModule(game: GameId): GameClientModule {
  return {
    game,
    footprint: { width: 2.2, depth: 1.4 },
    createModel() {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 40), new THREE.MeshStandardMaterial({ color: '#1f6b43', roughness: 0.9 }));
      top.position.y = 0.76;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.74, 16), new THREE.MeshStandardMaterial({ color: '#2a1d14' }));
      leg.position.y = 0.37;
      g.add(top, leg);
      return g;
    },
    seats: () => [{ position: [0, 0, 1.1], yaw: Math.PI }],
    playPose: () => ({ position: [0, 1.55, 1.25], target: [0, 0.76, 0] }),
    mount(ctx) {
      const note = el('div', 'dealer-line panel', 'This table opens soon.');
      ctx.ui.append(note);
      return {
        onTable() {},
        onEvents() {},
        onSeat() {},
        update() {},
        dispose() {
          note.remove();
        },
      };
    },
  };
}
