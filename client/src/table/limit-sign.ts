// The painted limits signs on the tables. On the floor every table's sign shows its game's
// Standard limits; while you sit at one, its sign shows that table's own (a $100 blackjack table
// says $100–$10,000). Only the sign at your seat changes: its face material is its own, so the
// texture swapped onto it touches no other table, and leaving puts the Standard one back.

import * as THREE from 'three';
import type { TableConfig } from '../../../shared/src/engine.ts';

export interface SignPaint {
  width: number;
  height: number;
  /** Paint the whole face for a table at these limits. */
  paint: (g: CanvasRenderingContext2D, cfg: TableConfig) => void;
}

interface SignState {
  face: THREE.MeshStandardMaterial;
  spec: SignPaint;
  standard: THREE.Texture | null;
  shown: THREE.CanvasTexture | null;
}

const KEY = 'limitSign';

/** Let this sign (`holder`, whose face is `face`) show the limits of the table played at. */
export function repaintable(holder: THREE.Object3D, face: THREE.MeshStandardMaterial, spec: SignPaint): void {
  holder.userData[KEY] = { face, spec, standard: face.map, shown: null } satisfies SignState;
}

/** Every repaintable sign under `root` shows `cfg`'s limits; null puts back the Standard face. */
export function showLimits(root: THREE.Object3D, cfg: TableConfig | null): void {
  root.traverse((o) => {
    const s = o.userData[KEY] as SignState | undefined;
    if (!s) return;
    s.shown?.dispose();
    s.shown = null;
    let tex: THREE.Texture | null = s.standard;
    if (cfg) {
      const c = document.createElement('canvas');
      c.width = s.spec.width;
      c.height = s.spec.height;
      s.spec.paint(c.getContext('2d')!, cfg);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      s.shown = t;
      tex = t;
    }
    s.face.map = tex;
    if (s.face.emissiveMap) s.face.emissiveMap = tex;
    s.face.needsUpdate = true;
  });
}
