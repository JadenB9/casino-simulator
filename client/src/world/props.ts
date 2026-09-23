// Loose props from GLB files (palms, plants, stools, couches, bottles, glasses, lamps, doors,
// chandeliers), scaled to a real size and drawn instanced: one draw call per mesh part of each
// prop, however many stand on the floor. Chandeliers are the Quaternius piece on Low and a Poly
// Haven hero chandelier on High (loaded only when High is on).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Quality } from '../render/engine3d.ts';
import type { PropKind, PropPlace } from './decor.ts';
import { hdr } from './materials.ts';
import { MODEL_BASE } from './characters.ts';

const FILES: Record<Exclude<PropKind, 'chandelier'>, { file: string; fit: 'height' | 'length' }> = {
  stool: { file: 'stool.glb', fit: 'height' },
  couch: { file: 'couch.glb', fit: 'length' },
  palm: { file: 'palm.glb', fit: 'height' },
  'plant-a': { file: 'plant-a.glb', fit: 'height' },
  'plant-b': { file: 'plant-b.glb', fit: 'height' },
  'lamp-floor': { file: 'lamp-floor.glb', fit: 'height' },
  'bottle-tall': { file: 'bottle-tall.glb', fit: 'height' },
  'bottle-red': { file: 'bottle-red.glb', fit: 'height' },
  'bottle-white': { file: 'bottle-white.glb', fit: 'height' },
  'glass-cocktail': { file: 'glass-cocktail.glb', fit: 'height' },
  door: { file: 'door.glb', fit: 'height' },
};

/** Materials that should glow: lamp shades and bulbs. */
const GLOWS: Record<string, THREE.Color> = {
  Light: hdr('#ffe2b0', 2.4),
  Chandelier_02_bulb: hdr('#ffe6c0', 3.2),
};

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

export class Props {
  readonly group = new THREE.Group();
  private loader = new GLTFLoader();
  private highChandeliers: THREE.Object3D | null = null;
  private lowChandeliers: THREE.Object3D | null = null;
  private lambert = new Map<THREE.Material, THREE.Material>();
  private standard = new Map<THREE.Material, THREE.Material>();
  private quality: Quality;

  constructor(quality: Quality) {
    this.group.name = 'props';
    this.quality = quality;
  }

  async build(places: PropPlace[], chandeliers: THREE.Vector3[]): Promise<void> {
    const byKind = new Map<PropKind, PropPlace[]>();
    for (const p of places) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
    await Promise.all(
      [...byKind].map(async ([kind, list]) => {
        if (kind === 'chandelier') return;
        const spec = FILES[kind];
        try {
          const { parts, size, min } = await this.load(spec.file);
          const len = spec.fit === 'height' ? size.y : Math.max(size.x, size.z);
          const mats = list.map((p) => {
            const s = p.size / len;
            // stand the model on its base, centred on the spot
            return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(_up, p.ry), new THREE.Vector3(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-(min.x + size.x / 2), -min.y, -(min.z + size.z / 2)));
          });
          this.group.add(this.instance(kind, parts, mats));
        } catch (err) {
          console.warn(`prop ${kind} failed to load`, err);
        }
      }),
    );
    this.chandelierSpots = chandeliers;
    await this.chandeliers(this.quality);
  }

  private chandelierSpots: THREE.Vector3[] = [];

  /** Hang chandeliers (top at each spot) for this quality, loading the High piece on first use. */
  private async chandeliers(q: Quality): Promise<void> {
    const spots = this.chandelierSpots;
    if (spots.length === 0) return;
    const make = async (file: string, height: number) => {
      const { parts, size, min } = await this.load(file);
      const s = height / size.y;
      const mats = spots.map((p) => new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-(min.x + size.x / 2), -(min.y + size.y), -(min.z + size.z / 2))));
      return this.instance(`chandelier:${file}`, parts, mats);
    };
    try {
      if (q === 'high' && !this.highChandeliers) {
        this.highChandeliers = await make('chandelier-high.glb', 1.5);
        this.group.add(this.highChandeliers);
      }
      if (q === 'low' && !this.lowChandeliers) {
        this.lowChandeliers = await make('chandelier-low.glb', 0.95);
        this.group.add(this.lowChandeliers);
      }
    } catch (err) {
      console.warn('chandelier failed to load', err);
    }
    if (this.highChandeliers) this.highChandeliers.visible = q === 'high';
    if (this.lowChandeliers) this.lowChandeliers.visible = q === 'low' || !this.highChandeliers;
  }

  async setQuality(q: Quality): Promise<void> {
    if (q === this.quality) return;
    this.quality = q;
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.materialFor(mesh.userData.source as THREE.Material, q);
    });
    await this.chandeliers(q);
  }

  private instance(name: string, parts: Part[], at: THREE.Matrix4[]): THREE.Group {
    const g = new THREE.Group();
    g.name = `prop:${name}`;
    const m = new THREE.Matrix4();
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, this.materialFor(part.material, this.quality), at.length);
      mesh.userData.source = part.material;
      at.forEach((a, i) => mesh.setMatrixAt(i, m.multiplyMatrices(a, part.matrix)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    return g;
  }

  private cache = new Map<string, Promise<{ parts: Part[]; size: THREE.Vector3; min: THREE.Vector3 }>>();

  private load(file: string): Promise<{ parts: Part[]; size: THREE.Vector3; min: THREE.Vector3 }> {
    let p = this.cache.get(file);
    if (!p) {
      p = this.loader.loadAsync(MODEL_BASE + file).then((gltf) => {
        const parts: Part[] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const src = mesh.material as THREE.MeshStandardMaterial;
          const glow = GLOWS[src.name];
          const material = glow ? new THREE.MeshBasicMaterial({ color: glow, map: src.map }) : src;
          material.name = src.name;
          parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone() });
        });
        const box = new THREE.Box3().setFromObject(gltf.scene);
        return { parts, size: box.getSize(new THREE.Vector3()), min: box.min.clone() };
      });
      this.cache.set(file, p);
    }
    return p;
  }

  /** Standard materials on High; the same colours and maps in Lambert on Low. */
  private materialFor(src: THREE.Material, q: Quality): THREE.Material {
    const std = src as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return src;
    if (q === 'high') {
      let m = this.standard.get(src);
      if (!m) {
        // GLB props come in shiny; cloth, plants and wood want a matte finish
        const c = std.clone();
        c.metalness = Math.min(c.metalness, 0.2);
        c.roughness = Math.max(c.roughness, 0.55);
        m = c;
        this.standard.set(src, m);
      }
      return m;
    }
    let m = this.lambert.get(src);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: std.color, map: std.map, transparent: std.transparent, opacity: std.opacity, alphaTest: std.alphaTest, side: std.side });
      m.name = src.name;
      this.lambert.set(src, m);
    }
    return m;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
