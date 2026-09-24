// Which rooms can be seen. The camera is in one room; through each doorway (or shop window) of it
// that is in view, the room beyond may be seen, and through that room's doorways in view the next
// one, a few rooms deep. Everything in the other rooms (their walls and ceilings, furniture,
// props, stations and staff) is left out of the frame. It errs on the side of drawing: a room
// behind a doorway in view is drawn even if something in between hides it.

import * as THREE from 'three';
import { roomAt, type FloorPlan, type PlannedRoom } from './layout.ts';

/** How many doorways deep a room can be and still be drawn. */
const DEPTH = 3;
/** Standing this close to a doorway, the room beyond is drawn whatever way you face (turning round in it). */
const NEAR_DOOR = 1.2;

interface Portal {
  rooms: [string, string];
  box: THREE.Box3;
  /** The opening's middle on the floor, for "standing in the doorway". */
  x: number;
  z: number;
}

export class RoomVisibility {
  private readonly portals: Portal[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly cam = new THREE.Vector3();
  /** The room the camera is in, and every room drawn. */
  room = '';
  visible = new Set<string>();
  private key = '';

  constructor(private readonly plan: FloorPlan) {
    for (const d of plan.doors) {
      if (d.b === 'outside') continue;
      this.portals.push(portal([d.a, d.b], d.axis, d.c, d.a0, d.a1, 0, d.height));
    }
    for (const w of plan.windows) this.portals.push(portal([w.neg, w.pos], w.axis, w.c, w.a0, w.a1, w.y0, w.y1));
    this.visible = new Set(plan.rooms.map((r) => r.id));
  }

  /** Work out what's in view; true when the set of rooms drawn changed. */
  update(camera: THREE.Camera): boolean {
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.cam);
    this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const here = roomAt(this.plan, this.cam.x, this.cam.z) ?? nearest(this.plan, this.cam.x, this.cam.z);
    this.room = here.id;
    const seen = new Set<string>([here.id]);
    let frontier: string[] = [here.id];
    for (let depth = 0; depth < DEPTH && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const p of this.portals) {
          const k = p.rooms.indexOf(id);
          if (k < 0) continue;
          const other = p.rooms[1 - k]!;
          if (seen.has(other)) continue;
          const close = depth === 0 && Math.hypot(p.x - this.cam.x, p.z - this.cam.z) < NEAR_DOOR;
          if (close || this.frustum.intersectsBox(p.box)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    const key = [...seen].sort().join(',');
    if (key === this.key) return false;
    this.key = key;
    this.visible = seen;
    return true;
  }

  /** Draw every room (a capture of the whole floor, the dev floor's overview). */
  all(): void {
    this.visible = new Set(this.plan.rooms.map((r) => r.id));
    this.key = '';
  }
}

function portal(rooms: [string, string], axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number): Portal {
  const t = 0.2;
  const box = axis === 'x' ? new THREE.Box3(new THREE.Vector3(a0, y0, c - t), new THREE.Vector3(a1, y1, c + t)) : new THREE.Box3(new THREE.Vector3(c - t, y0, a0), new THREE.Vector3(c + t, y1, a1));
  const m = (a0 + a1) / 2;
  return { rooms, box, x: axis === 'x' ? m : c, z: axis === 'x' ? c : m };
}

/** The room nearest a point outside every room (the camera pressed into a wall). */
function nearest(plan: FloorPlan, x: number, z: number): PlannedRoom {
  let best = plan.rooms[0]!;
  let bestD = Infinity;
  for (const r of plan.rooms) {
    const b = r.bounds;
    const d = Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}
