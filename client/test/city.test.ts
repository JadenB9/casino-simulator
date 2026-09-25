import { describe, expect, it } from 'vitest';
import { SPAWN, planFloor, roomAt } from '../src/world/layout.ts';
import { reachFrom, reached, walkGrid } from '../src/world/reach.ts';
import { GAMES } from '../src/games/index.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { LIFTS, bankAxes, CAR_PITCH_CM, CAR_DEPTH_CM } from '../../shared/src/lifts.ts';
import { LOTS, ZONES } from '../../shared/src/zones.ts';
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
  const { block, front } = bankArea('casino');

  it('stands in the lobby, clear of every solid and doorway, with room in front of its doors', () => {
    const lobby = plan.rooms.find((r) => r.id === 'lobby')!;
    // (its back may reach into the wall it stands against)
    expect(inside(lobby.bounds, (block.x0 + block.x1) / 2, (block.z0 + block.z1) / 2)).toBe(true);
    expect(inside(lobby.bounds, front.x0, front.z0) && inside(lobby.bounds, front.x1, front.z1)).toBe(true);
    for (const s of plan.solids) {
      const r = s.round ? s.w / 2 : Math.hypot(s.w, s.d) / 2;
      const near: Area = { x0: s.x - r, x1: s.x + r, z0: s.z - r, z1: s.z + r };
      expect(overlap(near, block), `${s.id} against the elevator`).toBe(false);
      expect(overlap(near, front), `${s.id} in front of the elevator's doors`).toBe(false);
    }
    for (const d of plan.doorways) {
      const pad: Area = { x0: d.x0 - 0.3, x1: d.x1 + 0.3, z0: d.z0 - 0.3, z1: d.z1 + 0.3 };
      expect(overlap(pad, block), 'a doorway blocked by the elevator').toBe(false);
    }
  });

  it('can be walked up to from where everyone arrives', () => {
    const g = walkGrid(plan);
    const seen = reachFrom(g, SPAWN.x, SPAWN.z);
    const b = LIFTS.casino;
    const { nx, nz } = bankAxes(b);
    const x = m(b.x) + nx * 1.0;
    const z = m(b.z) + nz * 1.0;
    expect(roomAt(plan, x, z)?.id).toBe('lobby');
    expect(reached(g, seen, x, z)).toBe(true);
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
