// Celebrations at the card tables (blackjack, Three Card Poker, baccarat), fitted to how they lie.
//
// Light under a hand: the kit's halo lies a millimetre above the lowest point of the objects it's
// given, which for cards lying flat on the felt is above their faces, so the light would wash the
// cards out. Given a flat stand-in instead (the hand's footprint, just under the card faces) the
// light lands between the felt and the cards and shows all around them.
//
// The banner: the kit puts it 30% down the screen, which at these tables is where the dealer's
// cards lie, so the cards being celebrated would sit under it. While one of these tables is up the
// banner goes higher, into the band between the dealer's line and the chip rack.

import * as THREE from 'three';
import { CARD_H, CARD_W } from '../../table/cards.ts';
import './celebration.css';

const raised = new WeakMap<HTMLElement, number>();

/**
 * Lift the celebration banner over this table's dealer area while it's up; returns the undo.
 * Counted per element, so a view mounted before the last one is disposed keeps the lift.
 */
export function raiseBanner(ui: HTMLElement): () => void {
  raised.set(ui, (raised.get(ui) ?? 0) + 1);
  ui.classList.add('card-table');
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (raised.get(ui) ?? 1) - 1;
    raised.set(ui, left);
    if (left <= 0) ui.classList.remove('card-table');
  };
}

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
