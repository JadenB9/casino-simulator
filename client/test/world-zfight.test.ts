import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WALL, ceilingAt, planFloor, type FloorPlan } from '../src/world/layout.ts';
import { Batch } from '../src/world/batch.ts';
import { GlowMerge } from '../src/world/lighting.ts';
import { buildRoom, trimRuns } from '../src/world/room.ts';
import { buildDecor } from '../src/world/decor.ts';
import { floorSigns } from '../src/world/signs.ts';
import type { Mats } from '../src/world/materials.ts';
import type { WorldStation } from '../src/world/stations.ts';
import { GAMES } from '../src/games/index.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { describeFight, findFights, type Surface } from '../src/world/zfight.ts';

// The rule: no two differently dressed surfaces of the building lie in one plane (within 2 mm)
// and overlap where anyone can see them. They'd z-fight: a strip of flicker down a door's jamb
// where the casing met the wall's trims, a wainscot's end showing through the next room's wall.
// scripts/e2e/world6.mjs zfight runs the same check over the whole scene as drawn (furniture,
// props, signs and the stations' models too).

/** Materials by name, plain: the check only needs to tell them apart. */
function stubMats(): Mats {
  const made = new Map<string, THREE.Material>();
  const get = (name: string) => {
    let m = made.get(name);
    if (!m) {
      m = new THREE.MeshBasicMaterial();
      m.name = name;
      made.set(name, m);
    }
    return m;
  };
  return { get, define1: () => {} } as unknown as Mats;
}

/** The building's static geometry (walls, trims, casings, ceilings, fixtures, glows, sign boxes), as the floor builds it. */
function building(): { plan: FloorPlan; surfaces: Surface[] } {
  const plan = planFloor((g: GameId) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
  const stations = plan.stations.map((p) => ({ id: p.id, game: p.game, variant: p.variant, anchor: { position: new THREE.Vector3(p.x, 0, p.z) }, footprint: p.fp, zone: p.zone, room: p.room, yaw: p.yaw }) as unknown as WorldStation);
  const b = new Batch();
  const glow = new GlowMerge();
  const m = stubMats();
  buildRoom(plan, b, m, glow);
  buildDecor(plan, stations, b, m, glow);
  floorSigns(plan, b, m);
  const glows = (glow as unknown as { batch: Batch }).batch.surfaces().map((s) => ({ ...s, mat: 'glow' }));
  return { plan, surfaces: [...b.surfaces(), ...glows] };
}

/** Faces nobody can look at: under the floor, over a ceiling, on the building's outside. */
function unseen(plan: FloorPlan) {
  return ([x, y, z]: [number, number, number], [, ny]: [number, number, number]) => {
    const R = plan.room;
    if (x < R.x0 + 0.001 || x > R.x1 - 0.001 || z < R.z0 + 0.001 || z > R.z1 - 0.001) return true;
    if (ny < -0.99 && y < 0.001) return true;
    return ny > 0.99 && y > ceilingAt(plan, x, z) - 0.001;
  };
}

const tri = (pts: number[][]) => pts.flat();
/** A unit square facing +z at depth z, as two triangles. */
const square = (x: number, y: number, z: number, s = 1) => tri([[x, y, z], [x + s, y, z], [x + s, y + s, z], [x, y, z], [x + s, y + s, z], [x, y + s, z]]);

describe('the z-fighting check (zfight.ts)', () => {
  it('finds two materials in one plane, and not a millimetre-thick gap turned the other way', () => {
    const a: Surface = { name: 'wall', mat: 'damask', pos: square(0, 0, 0) };
    const b: Surface = { name: 'trim', mat: 'brass', pos: square(0.5, 0.5, 0.0005) };
    const fights = findFights([a, b]);
    expect(fights).toHaveLength(1);
    expect(fights[0]!.area).toBeCloseTo(0.25, 5);
    // 3 mm off the wall: fine
    expect(findFights([a, { ...b, pos: square(0.5, 0.5, 0.003) }])).toHaveLength(0);
    // the same material: nothing to see
    expect(findFights([a, { ...b, mat: 'damask' }])).toHaveLength(0);
  });

  it('leaves out faces pressed against something facing the other way', () => {
    const a: Surface = { name: 'wall', mat: 'damask', pos: square(0, 0, 0) };
    const b: Surface = { name: 'trim', mat: 'brass', pos: square(0, 0, 0) };
    // a third surface facing -z in the same plane: a box set flat against the wall
    const back = square(0, 0, 0);
    const flipped: number[] = [];
    for (let i = 0; i < back.length; i += 9) flipped.push(...back.slice(i, i + 3), ...back.slice(i + 6, i + 9), ...back.slice(i + 3, i + 6));
    expect(findFights([a, b, { name: 'box', mat: 'wood', pos: flipped }])).toHaveLength(0);
  });
});

describe('the building', () => {
  it('has no two surfaces fighting in one plane', () => {
    const { plan, surfaces } = building();
    const fights = findFights(surfaces, { unseen: unseen(plan) });
    expect(fights.map(describeFight)).toEqual([]);
  });

  it('closes a wall run over the corner only where no other wall carries on past it', () => {
    const plan = planFloor((g: GameId) => GAMES[g].footprint, undefined, { seats: (g, v) => GAMES[g].seats(v) });
    const lines = new Map<string, { a0: number; a1: number; axis: string; c: number }[]>();
    for (const w of plan.wallPieces) if (w.y0 === 0) (lines.get(`${w.axis}:${w.c}`) ?? lines.set(`${w.axis}:${w.c}`, []).get(`${w.axis}:${w.c}`)!).push(w);
    for (const w of plan.wallPieces) {
      if (w.y0 > 0) continue;
      for (const end of [w.a0, w.a1]) {
        // a wall running across this end, on past it both ways: this run stops at its centre line
        const other = w.axis === 'x' ? 'z' : 'x';
        const cross = [...lines.values()].flat().filter((o) => o.axis === other && Math.abs(o.c - end) < WALL / 2 + 1e-6);
        const past = (v: number) => cross.some((o) => o.a0 <= v + 1e-6 && o.a1 >= v - 1e-6);
        if (past(w.c - 0.2) && past(w.c + 0.2)) expect(cross.some((o) => Math.abs(o.c - end) < 1e-6), `${w.axis} wall at ${w.c} ends at ${end}`).toBe(true);
      }
    }
  });

  it('runs a trim everywhere but under a casing that crosses its height', () => {
    const casing = [{ a0: 1, a1: 1.2, y0: 0, y1: 2.8 }, { a0: 1, a1: 3.6, y0: 2.8, y1: 3.0 }];
    expect(trimRuns(0, 5, 0, 0.14, casing)).toEqual([[0, 1], [1.2, 5]]);
    // the crown over the door clears its head: it runs on unbroken
    expect(trimRuns(0, 5, 3.24, 3.4, casing)).toEqual([[0, 5]]);
    // a head tall enough to reach it breaks it
    expect(trimRuns(0, 5, 2.9, 2.95, casing)).toEqual([[0, 1], [3.6, 5]]);
  });
});
