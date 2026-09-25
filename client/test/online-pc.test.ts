import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pcModel, pcScreenCorners } from '../src/games/online/pc.ts';

// The monitor's glass stands clear of its shell (zfight.ts calls anything under 2 mm a fight), and
// the corners the DOM screen is fitted to are the glass's own.

describe('the online PC', () => {
  const g = pcModel({ attract: new THREE.Texture() });
  const glass = g.getObjectByName('pc-screen') as THREE.Mesh;

  it('keeps the glass at least 2 mm in front of the shell behind it', () => {
    g.updateMatrixWorld(true);
    const others = g.children.filter((o) => o !== glass);
    // straight back through the glass at its middle and near each corner
    for (const [dx, dy] of [[0, 0], [0.2, 0.1], [-0.2, -0.1]] as const) {
      const from = new THREE.Vector3(glass.position.x + dx, glass.position.y + dy, glass.position.z + 0.5);
      const hit = new THREE.Raycaster(from, new THREE.Vector3(0, 0, -1)).intersectObjects(others, false)[0];
      expect(hit).toBeDefined();
      expect(glass.position.z - hit!.point.z).toBeGreaterThanOrEqual(0.002);
    }
  });

  it('fits the DOM screen to the glass', () => {
    for (const c of pcScreenCorners()) expect(c.z).toBeCloseTo(glass.position.z, 6);
  });
});
