// The cars' materials: one of each for every car there is (the colour is in the vertices), so the
// car park, the curb and the garage share them and a car costs no new shaders. Paint has a clear
// coat on High; everything shiny reflects the scene's environment (the renderer's studio room)
// more strongly than the casino's floor does, which is what makes paint and chrome read.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { CarMat } from './models.ts';

export class CarMaterials {
  private readonly mats = new Map<CarMat, THREE.Material>();

  constructor(
    private quality: Quality,
    private env: THREE.Texture | null,
  ) {
    this.build();
  }

  get(m: CarMat): THREE.Material {
    return this.mats.get(m)!;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    // the paint changes kind (clear coat or not); the meshes that use it are told by their owners
    const old = this.mats.get('paint')!;
    this.mats.set('paint', this.paint());
    old.dispose();
  }

  private paint(): THREE.Material {
    const common = { color: '#ffffff', vertexColors: true, roughness: 0.34, metalness: 0.42, envMap: this.env, envMapIntensity: 1.1 };
    return this.quality === 'high'
      ? new THREE.MeshPhysicalMaterial({ ...common, clearcoat: 1, clearcoatRoughness: 0.08 })
      : new THREE.MeshStandardMaterial(common);
  }

  private build(): void {
    const env = this.env;
    this.mats.set('paint', this.paint());
    this.mats.set('trim', new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.72, metalness: 0.05, envMap: env, envMapIntensity: 0.5 }));
    this.mats.set('metal', new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.22, metalness: 1, envMap: env, envMapIntensity: 0.75 }));
    this.mats.set('glass', new THREE.MeshStandardMaterial({ color: '#0b1016', roughness: 0.05, metalness: 0.9, envMap: env, envMapIntensity: 1.2 }));
    // lamps: parked, the lenses glow softly (under the glow's threshold); driven, they're on (bright
    // enough to bloom)
    this.mats.set('lamp', new THREE.MeshBasicMaterial({ color: '#d2cdc2', vertexColors: true }));
    // and switched on: a car being driven, the lamp posts, the garage's light strips
    this.mats.set('glow', new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), vertexColors: true }));
    this.mats.set('gold', new THREE.MeshStandardMaterial({ color: '#c99a36', vertexColors: true, roughness: 0.3, metalness: 1, envMap: env, envMapIntensity: 0.85 }));
  }

  /** The environment the shiny ones reflect (the scene's, once there is one). */
  setEnv(env: THREE.Texture | null): void {
    for (const m of this.mats.values()) {
      const s = m as THREE.MeshStandardMaterial;
      if (!s.isMeshStandardMaterial || s.envMap === env) continue;
      s.envMap = env;
      s.needsUpdate = true;
    }
    this.env = env;
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}

let shared: CarMaterials | null = null;

/**
 * The one set of car materials the whole game shares: the city's parked cars and traffic (built
 * with the floor), the curb, the garage and the valet's showroom.
 */
export function carMaterials(quality: Quality): CarMaterials {
  return (shared ??= new CarMaterials(quality, null));
}
