import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { planFloor, roomAt, type FloorPlan, type PlannedRoom } from '../src/world/layout.ts';
import { RoomVisibility } from '../src/world/visibility.ts';
import { GAMES } from '../src/games/index.ts';
import type { GameId } from '../../shared/src/engine.ts';

// Which rooms are drawn (visibility.ts), now worked out without making anything new each frame:
// it must agree with the way it was worked out before (kept below as the reference) for cameras
// all over the building, looking every way, room by room and station by station.

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

class Reference {
  private readonly portals: Portal[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly cam = new THREE.Vector3();
  /** The room the camera is in, and every room drawn. */
  room = '';
  visible = new Set<string>();
  /** Each room's rectangle of the screen, in normalised device coordinates [x0, y0, x1, y1]. */
  private readonly rects = new Map<string, [number, number, number, number]>();
  private key = '';
  private readonly corner = new THREE.Vector4();
  private readonly body = new THREE.Box3();

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
    this.rects.clear();
    this.rects.set(here.id, [-1, -1, 1, 1]);
    let frontier: string[] = [here.id];
    for (let depth = 0; depth < DEPTH && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        const through = this.rects.get(id)!;
        for (const p of this.portals) {
          const k = p.rooms.indexOf(id);
          if (k < 0) continue;
          const other = p.rooms[1 - k]!;
          const close = depth === 0 && Math.hypot(p.x - this.cam.x, p.z - this.cam.z) < NEAR_DOOR;
          if (!close && !this.frustum.intersectsBox(p.box)) continue;
          // what of the screen the doorway covers, within what its own room is seen through
          const r = close ? through : clip(this.onScreen(p.box), through);
          if (!r) continue;
          const had = this.rects.get(other);
          if (seen.has(other) && had && r[0] >= had[0] && r[1] >= had[1] && r[2] <= had[2] && r[3] <= had[3]) continue;
          this.rects.set(other, had ? [Math.min(had[0], r[0]), Math.min(had[1], r[1]), Math.max(had[2], r[2]), Math.max(had[3], r[3])] : r);
          if (!seen.has(other)) {
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
    this.rects.clear();
    this.key = '';
  }

  /**
   * Whether something in a room, within `box`, can be seen: anywhere in the camera's own room (the
   * frustum decides), elsewhere only inside the part of the screen that room is seen through.
   */
  sees(room: string, box: THREE.Box3): boolean {
    if (room === this.room) return true;
    const through = this.rects.get(room);
    if (!through) return !this.visible.has(room) ? false : true;
    const r = this.onScreen(box);
    return !!clip(r, through);
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

  /** A box's extent on the screen (NDC), or the whole screen when part of it is behind the camera. */
  private onScreen(box: THREE.Box3): [number, number, number, number] {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const v = this.corner;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z, 1).applyMatrix4(this.viewProj);
      if (v.w <= 0.05) return [-1, -1, 1, 1];
      const x = v.x / v.w;
      const y = v.y / v.w;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1];
  }
}

/** The overlap of two screen rectangles, or null when they don't meet (or it's off the screen). */
function clip(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] | null {
  const r: [number, number, number, number] = [Math.max(a[0], b[0], -1), Math.max(a[1], b[1], -1), Math.min(a[2], b[2], 1), Math.min(a[3], b[3], 1)];
  return r[0] < r[2] && r[1] < r[3] ? r : null;
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


/** A seeded random in [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('room visibility', () => {
  it('draws the same rooms, and sees the same stations, as before', () => {
    const plan: FloorPlan = planFloor((g: GameId) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
    const now = new RoomVisibility(plan);
    const ref = new Reference(plan);
    const camera = new THREE.PerspectiveCamera(60, 1280 / 800, 0.05, 200);
    const rnd = rng(7);
    const boxes = plan.stations.map((s) => ({ room: s.room, box: new THREE.Box3(new THREE.Vector3(s.x - 1, 0, s.z - 1), new THREE.Vector3(s.x + 1, 2, s.z + 1)) }));
    let changes = 0;
    for (let i = 0; i < 600; i++) {
      const r = plan.rooms[Math.floor(rnd() * plan.rooms.length)]!;
      const x = r.inner.x0 + 0.3 + rnd() * (r.inner.x1 - r.inner.x0 - 0.6);
      const z = r.inner.z0 + 0.3 + rnd() * (r.inner.z1 - r.inner.z0 - 0.6);
      const yaw = rnd() * Math.PI * 2;
      camera.position.set(x, 1.2 + rnd() * 1.2, z);
      camera.lookAt(x + Math.sin(yaw) * 5, 0.6 + rnd() * 1.4, z + Math.cos(yaw) * 5);
      camera.updateMatrixWorld();
      const a = now.update(camera);
      const b = ref.update(camera);
      expect(a, `pose ${i}`).toBe(b);
      if (a) changes++;
      expect(now.room).toBe(ref.room);
      expect([...now.visible].sort(), `pose ${i} in ${r.id}`).toEqual([...ref.visible].sort());
      for (const { room, box } of boxes) expect(now.sees(room, box), `pose ${i}: ${room}`).toBe(ref.sees(room, box));
      for (let k = 0; k < 6; k++) {
        const px = plan.room.x0 + rnd() * (plan.room.x1 - plan.room.x0);
        const pz = plan.room.z0 + rnd() * (plan.room.z1 - plan.room.z0);
        expect(now.seesPerson(px, pz)).toBe(ref.seesPerson(px, pz));
      }
    }
    expect(changes).toBeGreaterThan(100);
    // everything drawn, then back to what's in view
    now.all();
    ref.all();
    for (const { room, box } of boxes) expect(now.sees(room, box)).toBe(ref.sees(room, box));
    expect(now.update(camera)).toBe(ref.update(camera));
    expect([...now.visible].sort()).toEqual([...ref.visible].sort());
  });
});
