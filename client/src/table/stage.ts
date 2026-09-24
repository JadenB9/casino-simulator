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

/** A dealer's motion at the table (world/npcs.ts): dealing a card, sweeping losing bets, paying. */
export type DealerGesture = 'deal' | 'sweep' | 'pay';
/** How long each motion runs (world/characters.ts), so the next one waits for it. */
const GESTURE_MS: Record<DealerGesture, number> = { deal: 1000, sweep: 1350, pay: 1100 };

export class TableStage {
  /** Everything a game view adds goes in here, in table-local coordinates (metres, +y up, player side +z). */
  readonly root = new THREE.Group();
  private readonly ray = new THREE.Raycaster();
  private felts: Felt[] = [];
  private rest: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  /**
   * The table's dealer, when the station has one (the app hooks it up; a dev page's table has
   * none): views call gesture() as they deal, sweep and pay.
   */
  dealer: ((g: DealerGesture) => void) | null = null;
  private gestureEnds = 0;
  private gestureNext: DealerGesture | null = null;
  private gestureTimer: ReturnType<typeof setTimeout> | undefined;

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

  /**
   * Where the camera rests at this table: the play pose of your seat, set by the app as it flies
   * you there. Views that swing the camera away (to the wheel, the dice) come back to this, not to
   * wherever the camera was when they left, which is halfway in if the round began mid-flight.
   */
  setRest(p: Pose): void {
    const w = this.worldPose(p);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(w.position, w.target, new THREE.Vector3(0, 1, 0)));
    this.rest = { position: w.position, quaternion };
  }

  /** A copy of the resting pose, or of the camera's own pose if the app hasn't set one. */
  restPose(camera: THREE.Camera): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    return this.rest ? { pos: this.rest.position.clone(), quat: this.rest.quaternion.clone() } : { pos: camera.position.clone(), quat: camera.quaternion.clone() };
  }

  /**
   * The dealer deals, sweeps or pays. Each motion runs about a second and starts from the arm at
   * rest, so one asked for while another is under way waits for it to end (a run of cards is one
   * dealing motion after another, the pay follows the sweep); only the latest waits.
   */
  gesture(g: DealerGesture): void {
    if (!this.dealer) return;
    const now = performance.now();
    if (now < this.gestureEnds) {
      this.gestureNext = g;
      return;
    }
    this.gestureEnds = now + GESTURE_MS[g];
    this.dealer(g);
    clearTimeout(this.gestureTimer);
    this.gestureTimer = setTimeout(() => {
      const next = this.gestureNext;
      this.gestureNext = null;
      if (next) this.gesture(next);
    }, GESTURE_MS[g]);
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
    clearTimeout(this.gestureTimer);
    this.dealer = null;
    this.root.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.root.removeFromParent();
  }
}
