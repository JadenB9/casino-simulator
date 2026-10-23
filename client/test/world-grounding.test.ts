import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { planFloor, roomAt } from '../src/world/layout.ts';
import { GAMES } from '../src/games/index.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { FURNITURE } from '../src/world/furniture-spec.ts';
import { FOOTPRINT as BINGO } from '../src/games/bingo/layout.ts';
import { bingoShadows, boxReach, centred, floorShadows, measureReach, outline, pieceShadow, roundReach, shadowGeometry, shadowTexture, shadowsGeometry, stripGeometry, wallStrips, type Shadow } from '../src/world/grounding.ts';
import { carKit, carShadow } from '../src/world/cars/models.ts';
import { CARS } from '../../shared/src/items.ts';

// Contact shadows (grounding.ts): a soft dark decal under everything standing on the floor and a
// strip along the foot of every wall, so nothing floats. These check that everything that stands
// on the floor has one, that each decal is a well-formed shape facing up round its piece, and
// that no wall's strip runs across a doorway.

const plan = () => planFloor((g: GameId) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });

/** Twice the signed area of a polygon in (x, z); positive when it runs from +x toward +z. */
function area2(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i]!;
    const [x1, z1] = p[(i + 1) % p.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return a;
}

/** Every corner turns the same way (or not at all): the polygon is convex. */
function convex(p: [number, number][]): boolean {
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i]!;
    const [bx, bz] = p[(i + 1) % p.length]!;
    const [cx, cz] = p[(i + 2) % p.length]!;
    if ((bx - ax) * (cz - bz) - (bz - az) * (cx - bx) < -1e-9) return false;
  }
  return true;
}

/** (x, z) inside or on a convex polygon that runs from +x toward +z. */
function inside(p: [number, number][], x: number, z: number): boolean {
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i]!;
    const [bx, bz] = p[(i + 1) % p.length]!;
    if ((bx - ax) * (z - az) - (bz - az) * (x - ax) < -1e-6) return false;
  }
  return true;
}

describe('a shadow decal', () => {
  it("traces a box's corners, and grows the same distance all round", () => {
    const pts = outline(boxReach(2, 1, 16));
    for (const [x, z] of pts) {
      expect(Math.abs(Math.abs(x) - 1)).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(z) - 0.5)).toBeLessThan(1e-9);
    }
    // grown by 0.2: every corner of the outline lies 0.2 out from the box, or on a side of it
    for (const [x, z] of outline(boxReach(2, 1, 16), 0.2)) {
      const dx = Math.max(Math.abs(x) - 1, 0);
      const dz = Math.max(Math.abs(z) - 0.5, 0);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0.199);
      expect(Math.hypot(dx, dz)).toBeLessThan(0.2 / Math.cos(Math.PI / 16) + 1e-9);
    }
  });

  it('is a fan of the core and a band out to the soft edge, facing up', () => {
    const s: Shadow = { x: 3, z: -2, yaw: 0.7, reach: boxReach(1.2, 0.6, 16), k: 0.5, spread: 0.15, core: 0.8, room: 'pit' };
    const g = shadowGeometry(s);
    const pos = g.getAttribute('position');
    const idx = g.getIndex()!;
    expect(pos.count).toBe(33);
    expect(idx.count).toBe(16 * 9);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      // a face of the band's corner can collapse to nothing (the box's corners meet there)
      if (n.length() < 1e-9) continue;
      expect(n.y, `triangle ${i / 3}`).toBeGreaterThan(0);
    }
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) expect(uv.getY(i)).toBe(0.5);
  });

  it('keeps a measured outline round its own middle', () => {
    // a table drawn off its origin, all of it on the +x side
    const reach = boxReach(1, 1, 32).map((r, i) => r + 2 * Math.cos((i / 32) * Math.PI * 2));
    const s = centred({ x: 0, z: 0, yaw: 0, reach, k: 0.5, spread: 0.1, core: 0.8, room: 'pit' });
    expect(s.x).toBeCloseTo(2, 6);
    expect(s.z).toBeCloseTo(0, 6);
    expect(Math.min(...s.reach)).toBeCloseTo(0.5, 6);
  });

  it('strips run along the wall and face up on either side of it', () => {
    for (const nz of [-1, 1]) {
      const g = stripGeometry({ x0: 0, z0: 0, x1: 4, z1: 0, nx: 0, nz, k: 0.3, spread: 0.3, room: 'pit' });
      const pos = g.getAttribute('position');
      const idx = g.getIndex()!;
      for (let i = 0; i < idx.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i));
        const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 1));
        const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 2));
        expect(new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).y).toBeGreaterThan(0);
      }
    }
  });

  it('fades from dark at the core to nothing at the edge, as dark as its row says', () => {
    const t = shadowTexture();
    const { data, width, height } = t.image as { data: Uint8Array; width: number; height: number };
    const alpha = (i: number, j: number) => data[(j * width + i) * 4 + 3]!;
    expect(alpha(0, height - 1)).toBe(255);
    expect(alpha(width - 1, height - 1)).toBe(0);
    for (let i = 0; i < width; i++) expect(alpha(i, 0)).toBe(0);
    for (let i = 1; i < width; i++) expect(alpha(i, height - 1)).toBeLessThanOrEqual(alpha(i - 1, height - 1));
  });
});

describe('measuring a model', () => {
  it("finds a table's reach from its parts between the floor and the rail, in the station's frame", () => {
    const anchor = new THREE.Group();
    anchor.position.set(5, 0, 5);
    anchor.rotation.y = 1.1;
    const model = new THREE.Group();
    anchor.add(model);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1));
    top.position.y = 0.8;
    // a sign on a pole well over the rail, out past the table's edge: not part of its outline
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 0.1));
    sign.position.set(0, 1.6, 0);
    model.add(top, sign);
    anchor.updateMatrixWorld(true);
    const r = measureReach(model, anchor, 16)!;
    expect(r[0]).toBeCloseTo(1, 5);
    expect(r[4]).toBeCloseTo(0.5, 5);
    expect(r[8]).toBeCloseTo(1, 5);
    // nothing in the band: no outline
    top.position.y = 2;
    anchor.updateMatrixWorld(true);
    expect(measureReach(model, anchor, 16)).toBeNull();
  });
});

describe('the floor', () => {
  it('grounds every solid that stands on the floor, a high-top with its three stools', () => {
    const p = plan();
    const shadows = floorShadows(p);
    const floor = p.solids.filter((s) => s.y0 <= 0.05);
    const hightops = p.furniture.filter((f) => f.kind === 'hightop').length;
    expect(hightops).toBeGreaterThan(0);
    expect(shadows.length).toBe(floor.length + hightops * FURNITURE.hightop.seats!.length);
    for (const s of floor) expect(shadows.some((x) => Math.hypot(x.x - s.x, x.z - s.z) < 1e-6), s.id).toBe(true);
    // every chair and stool at a table has one
    for (const c of p.chairs) expect(shadows.some((x) => Math.hypot(x.x - c.x, x.z - c.z) < 1e-6), `${c.station} seat ${c.slot}`).toBe(true);
  });

  it('draws each decal convex round its middle, in its own room, soft edge outside its core', () => {
    const p = plan();
    let tris = 0;
    for (const s of floorShadows(p)) {
      const inner = outline(s.reach, 0, s.core);
      const outer = outline(s.reach, s.spread);
      expect(convex(inner) && convex(outer), `${s.room} ${s.x},${s.z}`).toBe(true);
      expect(area2(inner)).toBeGreaterThan(0);
      expect(inside(inner, 0, 0)).toBe(true);
      for (const [x, z] of inner) expect(inside(outer, x, z)).toBe(true);
      expect(s.k).toBeGreaterThan(0.2);
      expect(s.k).toBeLessThan(0.75);
      expect(roomAt(p, s.x, s.z)?.id ?? s.room).toBe(s.room);
      tris += s.reach.length * 3;
    }
    // the whole floor's decals stay a light load
    expect(tris).toBeLessThan(40_000);
  });

  it('runs a strip along the foot of every wall on each room side, and none across a doorway', () => {
    const p = plan();
    const strips = wallStrips(p);
    expect(strips.length).toBeGreaterThan(40);
    for (const s of strips) {
      const r = p.rooms.find((q) => q.id === s.room)!;
      // on the room's own face, pointing into the room
      const mx = (s.x0 + s.x1) / 2 + s.nx * 0.1;
      const mz = (s.z0 + s.z1) / 2 + s.nz * 0.1;
      expect(mx >= r.inner.x0 - 1e-6 && mx <= r.inner.x1 + 1e-6 && mz >= r.inner.z0 - 1e-6 && mz <= r.inner.z1 + 1e-6, `${s.room} strip at ${mx.toFixed(2)},${mz.toFixed(2)}`).toBe(true);
      for (const d of p.doors) {
        const along = d.axis === 'x' ? s.nz !== 0 : s.nx !== 0;
        if (!along) continue;
        const line = d.axis === 'x' ? s.z0 : s.x0;
        if (Math.abs(Math.abs(line - d.c) - 0.15) > 1e-6) continue;
        const a0 = d.axis === 'x' ? Math.min(s.x0, s.x1) : Math.min(s.z0, s.z1);
        const a1 = d.axis === 'x' ? Math.max(s.x0, s.x1) : Math.max(s.z0, s.z1);
        expect(Math.min(a1, d.a1) - Math.max(a0, d.a0), `${s.room} strip over door ${d.id}`).toBeLessThan(1e-6);
      }
    }
  });

  it("grounds the bingo hall's long tables and its stage, inside the hall's station", () => {
    const shadows = bingoShadows({ x: 20, z: -37, yaw: 0, room: 'bingo' });
    expect(shadows).toHaveLength(5);
    for (const s of shadows) {
      for (const [x, z] of outline(s.reach)) {
        expect(Math.abs(s.x + x - 20)).toBeLessThanOrEqual(BINGO.width / 2 + 1e-6);
        expect(Math.abs(s.z + z + 37)).toBeLessThanOrEqual(BINGO.depth / 2 + 1e-6);
      }
    }
    expect(roundReach(0.3, 8)).toEqual(new Array(8).fill(0.3));
  });
});

describe('the zones and the cars', () => {
  it("merges a zone's shadows into one unindexed geometry, every triangle facing up", () => {
    const shadows = [pieceShadow({ x: 1, z: 2, w: 2, d: 0.8, h: 0.85, legs: true }), pieceShadow({ x: -3, z: 0, w: 1, d: 1, h: 0.6, round: true })];
    const g = shadowsGeometry(shadows, 0.03)!;
    expect(g.getIndex()).toBeNull();
    const pos = g.getAttribute('position');
    expect(pos.count).toBe(shadows.reduce((n, s) => n + s.reach.length * 9, 0));
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      expect(a.y).toBeCloseTo(0.03, 6);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      if (n.length() > 1e-9) expect(n.y).toBeGreaterThan(0);
    }
    expect(shadowsGeometry([])).toBeNull();
  });

  it('gives every car a shadow under its body, a little past it, lying on the ground', () => {
    for (const car of CARS) {
      const g = carShadow(car.id);
      expect(g.getIndex()).toBeNull();
      g.computeBoundingBox();
      const box = g.boundingBox!;
      const k = carKit(car.id);
      expect(box.max.y - box.min.y).toBeLessThan(1e-6);
      expect(box.min.y).toBeGreaterThan(0);
      expect(box.min.y).toBeLessThan(0.02);
      // about the car's own size: inside the body grown by its soft edge, and at least most of it
      expect(box.max.x - box.min.x).toBeGreaterThan(k.width * 0.9);
      expect(box.max.x - box.min.x).toBeLessThan(k.width + 0.8);
      expect(box.max.z - box.min.z).toBeGreaterThan(k.length * 0.9);
      expect(box.max.z - box.min.z).toBeLessThan(k.length + 0.8);
      // the same one shared by every car of that kind
      expect(carShadow(car.id)).toBe(g);
    }
  });
});
