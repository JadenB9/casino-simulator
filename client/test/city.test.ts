import { describe, expect, it } from 'vitest';
import { SPAWN, planFloor, roomAt } from '../src/world/layout.ts';
import { reachFrom, reached, walkGrid } from '../src/world/reach.ts';
import { GAMES } from '../src/games/index.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { LIFTS, bankAxes, CAR_PITCH_CM, CAR_DEPTH_CM } from '../../shared/src/lifts.ts';
import { FLOOR_BOUNDS } from '../../shared/src/protocol.ts';
import { LOTS, ZONES } from '../../shared/src/zones.ts';
import * as THREE from 'three';
import { Collider } from '../src/world/collision.ts';
import { collide } from '../src/world/collide.ts';
import { EntranceLift, doorwayBox } from '../src/world/city/entrance.ts';
import type { Batch } from '../src/world/batch.ts';
import type { GlowMerge } from '../src/world/lighting.ts';
import type { Mats } from '../src/world/materials.ts';
import { ENTRANCES, GROUND, PICKUP, ROOF, STALL, VALET_STAND, stalls, type Area } from '../src/world/city/plan.ts';

// The city's plan against the casino's and against itself: the casino's elevator stands in the
// lobby clear of everything and can be walked up to from the doors; the ground floor's stalls,
// stand and doors sit where they should; the roof's deck is the roof zone's.

const footprint = (g: GameId) => GAMES[g].footprint;
const seats = (g: GameId, v: string) => GAMES[g].seats(v);
const m = (cm: number) => cm / 100;
const inside = (a: Area, x: number, z: number, pad = 0) => x >= a.x0 - pad && x <= a.x1 + pad && z >= a.z0 - pad && z <= a.z1 + pad;
const overlap = (a: Area, b: Area) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const lot = (r: { minX: number; maxX: number; minZ: number; maxZ: number }): Area => ({ x0: m(r.minX), x1: m(r.maxX), z0: m(r.minZ), z1: m(r.maxZ) });

/** A bank's block on the floor (m), and the strip in front of its doors people walk in. */
function bankArea(zone: keyof typeof LIFTS): { block: Area; front: Area } {
  const b = LIFTS[zone];
  const { nx, nz, ax, az } = bankAxes(b);
  const half = (b.cars * CAR_PITCH_CM) / 200 + 0.4;
  const depth = m(CAR_DEPTH_CM) + 0.1;
  const pts = (out0: number, out1: number) =>
    [-half, half].flatMap((s) => [out0, out1].map((o) => ({ x: m(b.x) + ax * s + nx * o, z: m(b.z) + az * s + nz * o })));
  const box = (p: { x: number; z: number }[]): Area => ({ x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), z0: Math.min(...p.map((q) => q.z)), z1: Math.max(...p.map((q) => q.z)) });
  return { block: box(pts(-depth, 0)), front: box(pts(0, 1.5)) };
}

describe('the casino elevator', () => {
  const plan = planFloor(footprint, undefined, { seats });
  const b = LIFTS.casino;
  const door = plan.door;

  it('is the lobby street doors: its car stands right behind them, inside the casino bounds', () => {
    // the doors' middle, and facing north into the lobby
    expect(m(b.x)).toBeCloseTo((door.x0 + door.x1) / 2);
    expect(m(b.z)).toBeCloseTo(door.z);
    expect(b.r).toBe(128);
    // the car (where a ride arrives) behind the wall, within the doorway's width, inside the bounds
    expect(m(b.arrive.z)).toBeGreaterThan(door.z + 0.3);
    expect(m(b.arrive.x)).toBeGreaterThan(door.x0);
    expect(m(b.arrive.x)).toBeLessThan(door.x1);
    expect(b.arrive.z + CAR_DEPTH_CM / 2).toBeLessThanOrEqual(FLOOR_BOUNDS.maxZ);
    expect(roomAt(plan, m(b.arrive.x), m(b.arrive.z))).toBeNull();
  });

  it('can be walked up to from where everyone arrives, which is no nearer than the doors sense', () => {
    const g = walkGrid(plan);
    const seen = reachFrom(g, SPAWN.x, SPAWN.z);
    const { nx, nz } = bankAxes(b);
    const x = m(b.x) + nx * 1.0;
    const z = m(b.z) + nz * 1.0;
    expect(roomAt(plan, x, z)?.id).toBe('lobby');
    expect(reached(g, seen, x, z)).toBe(true);
    // (the doors open for someone within 1.3 m of their lobby side: a new arrival stands further off)
    expect(Math.hypot(SPAWN.x - m(b.x), SPAWN.z - (m(b.z) - 0.25))).toBeGreaterThan(1.6);
  });
});

describe('walking into the casino elevator', () => {
  // The lobby's doors are the car's: the plan's box in the doorway keeps them shut, and the lift
  // opens it with the leaves. Over the doors the wall's lintel has the same footprint (and comes
  // first); the doors once opened that instead, and nobody could walk in (v6 live).
  const plan = planFloor(footprint, undefined, { seats });
  const door = { x: (plan.door.x0 + plan.door.x1) / 2, z: plan.door.z, width: plan.door.x1 - plan.door.x0, height: plan.door.height };
  const build = () => {
    const col = new Collider();
    collide(plan, col);
    const none = () => undefined;
    const lift = new EntranceLift(LIFTS.casino, door, { box: none } as unknown as Batch, { add: none } as unknown as GlowMerge, { get: none } as unknown as Mats, col, new THREE.Texture(), 'high');
    return { col, lift };
  };
  /** Walk straight from where everyone arrives to the middle of the car, the doors sensing you; where you end up. */
  const walkIn = (col: Collider, lift: EntranceLift) => {
    const to = lift.centre();
    const p = { x: SPAWN.x, z: SPAWN.z };
    for (let i = 0; i < 400; i++) {
      lift.update(1 / 30, [p]);
      const dx = to.x - p.x;
      const dz = to.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.02) break;
      const s = Math.min(d, 0.05);
      p.x += (dx / d) * s;
      p.z += (dz / d) * s;
      col.resolve(p, 0.3);
    }
    return p;
  };

  it('finds the box standing in the doorway, not the lintel over it', () => {
    const { col } = build();
    const lintel = col.boxes.find((b) => Math.abs(b.cx - door.x) < 0.05 && Math.abs(b.cz - door.z) < 0.25 && b.bottom > 0);
    expect(lintel).toBeTruthy();
    const box = doorwayBox(col, door)!;
    expect(box).toBeTruthy();
    expect(box).not.toBe(lintel);
    expect(box.bottom).toBe(0);
    expect(box.top).toBeGreaterThanOrEqual(door.height - 0.05);
    expect(box.walk).toBe(true);
  });

  it('lets someone walk from the spawn through the open doors to the middle of the car', () => {
    const { col, lift } = build();
    const p = walkIn(col, lift);
    expect(lift.isOpen()).toBe(true);
    expect(lift.carAt(p.x, p.z)).toBe(0);
    expect(Math.hypot(p.x - lift.centre().x, p.z - lift.centre().z)).toBeLessThan(0.05);
  });

  it('keeps the doors solid while they are shut', () => {
    const { col, lift } = build();
    lift.held = 0;
    const p = walkIn(col, lift);
    expect(lift.isShut()).toBe(true);
    expect(p.z).toBeLessThan(door.z - 0.2);
  });
});

describe('the ground floor', () => {
  const list = stalls();
  const G = GROUND;
  const carBox = (s: { x: number; z: number; yaw: number }): Area => {
    const along = Math.abs(Math.sin(s.yaw)) > 0.5;
    const hw = (along ? STALL.d : STALL.w) / 2 - 0.05;
    const hd = (along ? STALL.w : STALL.d) / 2 - 0.05;
    return { x0: s.x - hw, x1: s.x + hw, z0: s.z - hd, z1: s.z + hd };
  };

  it('has well over a hundred stalls, none overlapping another', () => {
    expect(list.length).toBeGreaterThan(100);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(carBox(list[i]!), carBox(list[j]!)), `stalls ${i} and ${j}`).toBe(false);
  });

  it('keeps every stall on the valet side: not in the lobby, the drive, the plaza, the street or the lots across it', () => {
    const keepOut: [string, Area][] = [
      ['the building', G.building],
      ['the drive', { ...G.drive, z0: -9.6, z1: 9.6 }],
      ['the plaza', G.plaza],
      ['the street', { x0: G.walkWest.x0, x1: G.walkEast.x1, z0: G.zone.z0, z1: G.zone.z1 }],
      ['the jail', lot(LOTS.jail)],
      ['the garage', lot(LOTS.garage)],
    ];
    for (const s of list) {
      const box = carBox(s);
      expect(inside(G.walk, box.x0, box.z0) && inside(G.walk, box.x1, box.z1)).toBe(true);
      for (const [name, a] of keepOut) expect(overlap(box, a), `a stall at (${s.x}, ${s.z}) in ${name}`).toBe(false);
    }
  });

  it('puts the valet stand under the porte-cochere, the pickup in the drive, the lots’ doors on the far sidewalk', () => {
    expect(inside(lot(LOTS.valet), VALET_STAND.x, VALET_STAND.z)).toBe(true);
    expect(inside(G.canopy, VALET_STAND.x, VALET_STAND.z)).toBe(true);
    expect(inside({ ...G.drive }, PICKUP.x, PICKUP.z)).toBe(true);
    for (const [id, e] of Object.entries(ENTRANCES)) {
      const l = lot(LOTS[id as 'jail' | 'garage']);
      expect(Math.abs(e.x - l.x0)).toBeLessThan(1);
      expect(e.z > l.z0 && e.z < l.z1).toBe(true);
      expect(e.x).toBeGreaterThanOrEqual(G.walkEast.x1 - 0.01);
    }
  });

  it('lands the elevator in the valet lobby, its doors in the hall’s back wall', () => {
    const b = LIFTS.ground;
    expect(inside(lot(LOTS.lobby), m(b.arrive.x), m(b.arrive.z))).toBe(true);
    expect(m(b.x)).toBeCloseTo(G.hall.x0);
    const { block } = bankArea('ground');
    expect(block.x0).toBeGreaterThanOrEqual(G.building.x0);
  });
});

describe('the roof', () => {
  it('is a deck in the roof zone with the elevators at its east end', () => {
    const z = ZONES.roof;
    const D = ROOF.deck;
    expect(D.x0 * 100 >= z.minX && D.x1 * 100 <= z.maxX && D.z0 * 100 >= z.minZ && D.z1 * 100 <= z.maxZ).toBe(true);
    expect(m(LIFTS.roof.x)).toBeCloseTo(D.x1);
    const { block } = bankArea('roof');
    expect(inside(ROOF.pavilion, (block.x0 + block.x1) / 2, (block.z0 + block.z1) / 2)).toBe(true);
    expect(ROOF.pavilion.x1 * 100).toBeLessThanOrEqual(z.maxX);
  });
});
