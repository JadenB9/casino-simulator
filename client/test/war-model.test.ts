import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// the model paints its felt and signs on canvases: a canvas that takes every call and draws nothing
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => noop, set: () => true });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
const { FLOOR_FELT, tableModel } = await import('../src/games/war/model.ts');

// The printed felt lies on the table's wood with a clear gap (zfight.ts calls under 2 mm a fight):
// straight down through the felt, the first thing under it is at least 2 mm below.

describe('the War table', () => {
  it('keeps the wood at least 2 mm under the felt', () => {
    const g = tableModel('low');
    g.updateMatrixWorld(true);
    const felt = g.getObjectByName(FLOOR_FELT) as THREE.Mesh;
    const y = new THREE.Vector3().setFromMatrixPosition(felt.matrixWorld).y;
    const under = g.children.filter((o) => o !== felt);
    for (const [x, z] of [[0, 0], [0.4, 0.2], [-0.4, 0.2]] as const) {
      const hits = new THREE.Raycaster(new THREE.Vector3(x, y + 0.5, z), new THREE.Vector3(0, -1, 0)).intersectObjects(under, true);
      const below = hits.find((h) => h.point.y < y + 0.0001);
      if (below) expect(y - below.point.y).toBeGreaterThanOrEqual(0.002);
    }
  });
});
