// A table in the scene: a group placed at a floor station, with helpers the game views share:
// raycast picking against the felt, projecting a table point to the screen for DOM labels, the
// camera pose to play from, and the board that must stay in view (fit.ts).

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Engine3D } from '../render/engine3d.ts';
import type { Felt } from './felt.ts';
import { BoardFit, type BoardPart } from './fit.ts';

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
  /** What the view had on the table when it was last noted (hold()), given back on dispose(). */
  private held = new Set<Resource>();
  private rest: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  /**
   * The table's dealer, when the station has one (the app hooks it up; a dev page's table has
   * none): views call gesture() as they deal, sweep and pay.
   */
  dealer: ((g: DealerGesture) => void) | null = null;
  private gestureEnds = 0;
  private gestureNext: DealerGesture | null = null;
  private gestureTimer: ReturnType<typeof setTimeout> | undefined;
  /** Keeps the board in view whatever the window's size and the controls over it (fit.ts). */
  readonly fit: BoardFit;

  constructor(readonly engine: Engine3D, readonly anchor: THREE.Object3D) {
    this.root.name = 'stage';
    anchor.add(this.root);
    this.fit = new BoardFit(this.root, engine.camera, () => this.felts, () => this.restPose(engine.camera));
    // for code that has the table's root but not its stage (the online screen, fitOf())
    this.root.userData.fit = this.fit;
  }

  /**
   * The playing surface to keep in view, in table-local parts (points, boxes, objects, felts); it
   * replaces the default, which is every felt's regions. Name the felt too to keep its regions.
   */
  board(...parts: BoardPart[]): void {
    this.fit.setBoard(parts);
  }

  /**
   * The camera is going to another shot (table-local pose) where these parts must show (the
   * wheel as the ball drops); `shot(null)` when it comes back to the resting pose.
   */
  shot(pose: Pose | null, ...parts: BoardPart[]): void {
    this.fit.setShot(pose, parts);
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

  /**
   * Note everything the view has on the table now: views take their own things off the table as
   * they're disposed, so the app calls this first and dispose() gives those back to the GPU too.
   */
  hold(): void {
    this.root.traverse((o) => resources(o, (r) => this.held.add(r)));
  }

  dispose(): void {
    clearTimeout(this.gestureTimer);
    this.fit.dispose(this.engine);
    this.dealer = null;
    this.root.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.root.removeFromParent();
    this.hold();
    release(this.held, this.engine.scene);
    this.held.clear();
  }
}

type Resource = THREE.BufferGeometry | THREE.Material | THREE.Texture;

/**
 * Give the GPU back what a table view drew once it's gone: the felt's painted texture above all (a
 * few thousand pixels a side, tens of MB with its mipmaps, every time you sat down), and the pucks,
 * buttons, dice and meshes made for that sitting. Kept: the card, chip and dice sets every table
 * shares (`userData.shared`), and anything the scene still draws. (three.js uploads a disposed
 * resource again if it's ever drawn again, so a missed share costs an upload, never a picture.)
 */
function release(gone: Set<Resource>, scene: THREE.Object3D): void {
  const inUse = new Set<Resource>();
  scene.traverse((o) => resources(o, (r) => inUse.add(r)));
  for (const r of gone) if (!inUse.has(r) && !r.userData.shared) r.dispose();
}

function resources(o: THREE.Object3D, fn: (r: Resource) => void): void {
  const mesh = o as THREE.Mesh;
  if (mesh.geometry) fn(mesh.geometry);
  const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
  for (const m of mats) {
    fn(m);
    for (const v of Object.values(m)) if ((v as THREE.Texture | null)?.isTexture) fn(v as THREE.Texture);
  }
}
