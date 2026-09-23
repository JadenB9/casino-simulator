// A table in the scene: a group placed at a floor station, with helpers the game views share:
// raycast picking against the felt, projecting a table point to the screen for DOM labels, and
// the camera pose to play from.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Engine3D } from '../render/engine3d.ts';
import type { Felt } from './felt.ts';

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

export class TableStage {
  /** Everything a game view adds goes in here, in table-local coordinates (metres, +y up, player side +z). */
  readonly root = new THREE.Group();
  private readonly ray = new THREE.Raycaster();
  private felts: Felt[] = [];

  constructor(readonly engine: Engine3D, readonly anchor: THREE.Object3D) {
    anchor.add(this.root);
  }

  addFelt(felt: Felt, y: number): void {
    felt.mesh.position.y = y;
    this.root.add(felt.mesh);
    this.felts.push(felt);
  }

  /** The felt region under a pointer event, with the local point. */
  pick(e: { clientX: number; clientY: number }): { felt: Felt; region: string | null; local: THREE.Vector3 } | null {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.engine.camera);
    const hits = this.ray.intersectObjects(this.felts.map((f) => f.mesh), false);
    const hit = hits[0];
    if (!hit) return null;
    const felt = this.felts.find((f) => f.mesh === hit.object)!;
    const local = this.root.worldToLocal(hit.point.clone());
    return { felt, region: felt.regionAt(local.x, local.z)?.id ?? null, local };
  }

  /** Raycast arbitrary meshes in this table (buttons on a machine, cards to hold). */
  pickObjects(e: { clientX: number; clientY: number }, objects: THREE.Object3D[]): THREE.Intersection | null {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.engine.camera);
    return this.ray.intersectObjects(objects, true)[0] ?? null;
  }

  /** A DOM element pinned to a table-local point (result pills, totals, timers). */
  label(el: HTMLElement, local: THREE.Vector3): CSS2DObject {
    const obj = new CSS2DObject(el);
    obj.position.copy(local);
    this.root.add(obj);
    return obj;
  }

  /** Local -> world, for flying the camera. */
  worldPose(p: Pose): { position: THREE.Vector3; target: THREE.Vector3 } {
    this.root.updateWorldMatrix(true, false);
    return {
      position: this.root.localToWorld(new THREE.Vector3(...p.position)),
      target: this.root.localToWorld(new THREE.Vector3(...p.target)),
    };
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.root.removeFromParent();
  }
}
