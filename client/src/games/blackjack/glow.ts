// Light under a hand for celebrate(). The kit's halo lies a millimetre above the lowest point of the
// objects it's given, which for cards lying flat on the felt is above their faces, so the light
// would wash the cards out. Given this flat stand-in instead (the hand's footprint, just under the
// card faces) the light lands between the felt and the cards and shows all around them. Blackjack,
// Three Card Poker and baccarat all use it.

import * as THREE from 'three';
import { CARD_H, CARD_W } from '../../table/cards.ts';

/**
 * An invisible stand-in for `cards` to pass as celebrate()'s `glow`, put so the light lands at
 * `lightY` (in the cards' parent's space: above the felt, below the card faces). Remove it once
 * celebrate() has returned: the light is placed when it's called.
 */
export function handGlow(cards: THREE.Object3D[], lightY: number): THREE.Mesh | null {
  const parent = cards[0]?.parent;
  if (!parent) return null;
  const box = new THREE.Box3();
  for (const c of cards) {
    const w = (CARD_W / 2) * c.scale.x;
    const h = (CARD_H / 2) * c.scale.x;
    const cos = Math.cos(c.rotation.y);
    const sin = Math.sin(c.rotation.y);
    for (const [dx, dz] of [[-w, -h], [w, -h], [w, h], [-w, h]] as const) {
      box.expandByPoint(new THREE.Vector3(c.position.x + dx * cos + dz * sin, lightY, c.position.z - dx * sin + dz * cos));
    }
  }
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const stand = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.0002, size.z));
  stand.visible = false;
  // the halo goes 1 mm above the stand-in's underside
  stand.position.set(centre.x, lightY - 0.0009, centre.z);
  parent.add(stand);
  stand.updateWorldMatrix(true, false);
  return stand;
}

export function dropGlow(stand: THREE.Mesh | null): void {
  if (!stand) return;
  stand.removeFromParent();
  stand.geometry.dispose();
  (stand.material as THREE.Material).dispose();
}
