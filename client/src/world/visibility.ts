// Which rooms can be seen, and through what part of the screen. The camera is in one room; through
// each doorway (or shop window) of it that is in view, the room beyond may be seen, and through
// that room's doorways in view the next one, a few rooms deep. Each room seen through a doorway
// keeps the screen rectangle it is seen through (the doorway's, cut down by every doorway on the
// way to it), and a station or a dealer in that room is drawn only if it falls inside it. Rooms
// not reached aren't drawn at all (their walls and ceilings, furniture, props, stations and
// staff). It errs on the side of drawing: a doorway's box stands in for its opening.

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
  /**
   * Each room's rectangle of the screen this frame, in normalised device coordinates [x0, y0, x1,
   * y1] (`seen`: the rooms that have one). Kept from frame to frame, so working out what's in view
   * makes nothing new; `visible` is a new set only when it changes.
   */
  private readonly rects = new Map<string, Float64Array>();
  private readonly seen = new Set<string>();
  /** Each room's bit, and the rooms drawn as bits (-1: work it out afresh). */
  private readonly bits = new Map<string, number>();
  private mask = -1;
  private frontier: string[] = [];
  private next: string[] = [];
  private readonly box4 = new Float64Array(4);
  private readonly cut4 = new Float64Array(4);
  private readonly corner = new THREE.Vector4();
  private readonly body = new THREE.Box3();

  constructor(private readonly plan: FloorPlan) {
    for (const d of plan.doors) {
      if (d.b === 'outside') continue;
      this.portals.push(portal([d.a, d.b], d.axis, d.c, d.a0, d.a1, 0, d.height));
    }
    for (const w of plan.windows) this.portals.push(portal([w.neg, w.pos], w.axis, w.c, w.a0, w.a1, w.y0, w.y1));
    plan.rooms.forEach((r, i) => {
      this.bits.set(r.id, 2 ** i);
      this.rects.set(r.id, new Float64Array(4));
    });
    this.visible = new Set(plan.rooms.map((r) => r.id));
  }

  /** Work out what's in view; true when the set of rooms drawn changed. */
  update(camera: THREE.Camera): boolean {
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.cam);
    this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const here = roomAt(this.plan, this.cam.x, this.cam.z) ?? nearest(this.plan, this.cam.x, this.cam.z);
    this.room = here.id;
    const seen = this.seen;
    seen.clear();
    seen.add(here.id);
    this.setRect(here.id, -1, -1, 1, 1);
    let frontier = this.frontier;
    let next = this.next;
    frontier.length = 0;
    frontier.push(here.id);
    for (let depth = 0; depth < DEPTH && frontier.length; depth++) {
      next.length = 0;
      for (const id of frontier) {
        const through = this.rects.get(id)!;
        for (const p of this.portals) {
          const k = p.rooms.indexOf(id);
          if (k < 0) continue;
          const other = p.rooms[1 - k]!;
          const close = depth === 0 && Math.hypot(p.x - this.cam.x, p.z - this.cam.z) < NEAR_DOOR;
          if (!close && !this.frustum.intersectsBox(p.box)) continue;
          // what of the screen the doorway covers, within what its own room is seen through
          const r = this.cut4;
          if (close) r.set(through);
          else if (!clip(this.onScreen(p.box, this.box4), through, r)) continue;
          const had = seen.has(other) ? this.rects.get(other)! : null;
          if (had && r[0]! >= had[0]! && r[1]! >= had[1]! && r[2]! <= had[2]! && r[3]! <= had[3]!) continue;
          if (had) this.setRect(other, Math.min(had[0]!, r[0]!), Math.min(had[1]!, r[1]!), Math.max(had[2]!, r[2]!), Math.max(had[3]!, r[3]!));
          else {
            this.setRect(other, r[0]!, r[1]!, r[2]!, r[3]!);
            seen.add(other);
            next.push(other);
          }
        }
      }
      const t = frontier;
      frontier = next;
      next = t;
    }
    this.frontier = frontier;
    this.next = next;
    let mask = 0;
    for (const id of seen) mask += this.bits.get(id) ?? 0;
    if (mask === this.mask) return false;
    this.mask = mask;
    this.visible = new Set(seen);
    return true;
  }

  private setRect(room: string, x0: number, y0: number, x1: number, y1: number): void {
    const r = this.rects.get(room);
    if (!r) return;
    r[0] = x0;
    r[1] = y0;
    r[2] = x1;
    r[3] = y1;
  }

  /** Draw every room (a capture of the whole floor, the dev floor's overview). */
  all(): void {
    this.visible = new Set(this.plan.rooms.map((r) => r.id));
    this.seen.clear();
    this.mask = -1;
  }

  /**
   * Whether something in a room, within `box`, can be seen: anywhere in the camera's own room (the
   * frustum decides), elsewhere only inside the part of the screen that room is seen through.
   */
  sees(room: string, box: THREE.Box3): boolean {
    if (room === this.room) return true;
    if (!this.seen.has(room)) return this.visible.has(room);
    return clip(this.onScreen(box, this.box4), this.rects.get(room)!, this.cut4);
  }

  /**
   * Whether someone standing at (x, z) can be seen (a box a person's size, with the name tag and a
   * bubble over the head): in the camera's view, in a room that's drawn, and inside the part of the
   * screen that room is seen through. In a doorway, between rooms, the view alone decides.
   */
  seesPerson(x: number, z: number): boolean {
    const b = this.body;
    b.min.set(x - 0.45, 0, z - 0.45);
    b.max.set(x + 0.45, 2.7, z + 0.45);
    if (!this.frustum.intersectsBox(b)) return false;
    const room = roomAt(this.plan, x, z);
    return !room || (this.visible.has(room.id) && this.sees(room.id, b));
  }

  /** A box's extent on the screen (NDC) into `out`, or the whole screen when part of it is behind the camera. */
  private onScreen(box: THREE.Box3, out: Float64Array): Float64Array {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const v = this.corner;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z, 1).applyMatrix4(this.viewProj);
      if (v.w <= 0.05) {
        out[0] = -1;
        out[1] = -1;
        out[2] = 1;
        out[3] = 1;
        return out;
      }
      const x = v.x / v.w;
      const y = v.y / v.w;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    out[0] = x0;
    out[1] = y0;
    out[2] = x1;
    out[3] = y1;
    return out;
  }
}

/** The overlap of two screen rectangles into `out` (it may be either of them): false when they don't meet (or it's off the screen). */
function clip(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array): boolean {
  const x0 = Math.max(a[0]!, b[0]!, -1);
  const y0 = Math.max(a[1]!, b[1]!, -1);
  const x1 = Math.min(a[2]!, b[2]!, 1);
  const y1 = Math.min(a[3]!, b[3]!, 1);
  out[0] = x0;
  out[1] = y0;
  out[2] = x1;
  out[3] = y1;
  return x0 < x1 && y0 < y1;
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
