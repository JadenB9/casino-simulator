import { describe, expect, it } from 'vitest';
import { FOUNTAIN, SPAWN, checkLayout, planFloor, roomAt, setVpMode, slotVariants, type FloorPlan, type Placement } from '../src/world/layout.ts';
import { DOORS, ROOMS } from '../src/world/rooms.ts';
import { reachFrom, reached, walkGrid, type Grid } from '../src/world/reach.ts';
import { GAMES } from '../src/games/index.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { FLOOR_BOUNDS } from '../../shared/src/protocol.ts';
import { SPAWN as SERVER_SPAWN } from '../../server/src/floor/presence.ts';

// The game modules' own footprints and seats: the floor as it's built.
const footprint = (g: GameId) => GAMES[g].footprint;
const seats = (g: GameId, v: string) => GAMES[g].seats(v);
const plan = () => planFloor(footprint, undefined, { seats });

/** "Press E" reaches a station from this near its footprint (interact.ts's REACH), less a margin. */
const REACH = 1.45;

/** A reachable cell within REACH of the station's footprint, on its players' side. */
function canUse(g: Grid, seen: Uint8Array, s: Placement): boolean {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  const hx = s.fp.width / 2;
  const hz = s.fp.depth / 2;
  const x0 = Math.floor((s.x - hx - REACH - 2 - g.x0) / g.cell);
  const x1 = Math.ceil((s.x + hx + REACH + 2 - g.x0) / g.cell);
  const z0 = Math.floor((s.z - hx - REACH - 2 - g.z0) / g.cell);
  const z1 = Math.ceil((s.z + hx + REACH + 2 - g.z0) / g.cell);
  for (let j = Math.max(0, z0); j <= Math.min(g.nz - 1, z1); j++) {
    for (let i = Math.max(0, x0); i <= Math.min(g.nx - 1, x1); i++) {
      if (!seen[j * g.nx + i]) continue;
      const x = g.x0 + (i + 0.5) * g.cell - s.x;
      const z = g.z0 + (j + 0.5) * g.cell - s.z;
      const lx = x * c - z * n;
      const lz = x * n + z * c;
      // on the players' side of the station's front edge (or beside it for the machines' ends)
      if (lz < hz - 0.05) continue;
      const qx = Math.max(-hx, Math.min(hx, lx));
      const qz = Math.max(-hz, Math.min(hz, lz));
      if (Math.hypot(lx - qx, lz - qz) <= REACH) return true;
    }
  }
  return false;
}

describe('the building', () => {
  it('tiles into rooms that meet without gaps or overlaps', () => {
    for (const [i, a] of ROOMS.entries()) {
      for (const b of ROOMS.slice(i + 1)) {
        const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-6 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 1e-6;
        expect(overlap, `${a.id} and ${b.id} overlap`).toBe(false);
      }
    }
    expect(ROOMS.map((r) => r.id).sort()).toEqual(['bank', 'bar', 'bingo', 'boutique', 'cardroom', 'lobby', 'lounge', 'online', 'parlour', 'pit', 'poker', 'salon', 'slots', 'yard']);
  });

  it('puts the spawn in the lobby, just inside the entrance', () => {
    const p = plan();
    expect(roomAt(p, SPAWN.x, SPAWN.z)?.id).toBe('lobby');
    const entrance = p.doors.find((d) => d.b === 'outside')!;
    expect(Math.abs(SPAWN.x - (entrance.a0 + entrance.a1) / 2)).toBeLessThan(0.5);
    expect(entrance.c - SPAWN.z).toBeLessThan(3);
  });

  it('fits inside the floor bounds the server clamps to, and the server spawns players where the client does', () => {
    const p = plan();
    expect(p.room.x0 * 100).toBeGreaterThanOrEqual(FLOOR_BOUNDS.minX);
    expect(p.room.x1 * 100).toBeLessThanOrEqual(FLOOR_BOUNDS.maxX);
    expect(p.room.z0 * 100).toBeGreaterThanOrEqual(FLOOR_BOUNDS.minZ);
    expect(p.room.z1 * 100).toBeLessThanOrEqual(FLOOR_BOUNDS.maxZ);
    // every room's floor reaches within a metre of the bounds' edge it faces, so no walkable floor is clamped
    for (const r of p.rooms) {
      expect(r.inner.x0 * 100).toBeGreaterThanOrEqual(FLOOR_BOUNDS.minX);
      expect(r.inner.z1 * 100).toBeLessThanOrEqual(FLOOR_BOUNDS.maxZ);
    }
    // and not much more than that
    expect(FLOOR_BOUNDS.minX).toBeGreaterThan(p.room.x0 * 100 - 50);
    // (v6 city6: south of the lobby the bounds take in the elevator car behind the street doors)
    expect(FLOOR_BOUNDS.maxZ).toBeLessThan(p.room.z1 * 100 + 250);
    expect([SERVER_SPAWN.x / 100, SERVER_SPAWN.z / 100]).toEqual([SPAWN.x, SPAWN.z]);
  });

  it('has doors wide enough to walk through, each in a wall its two rooms share', () => {
    const p = plan();
    expect(p.doors).toHaveLength(DOORS.length);
    for (const d of p.doors) expect(d.a1 - d.a0, d.id).toBeGreaterThanOrEqual(1.4);
    // every room can be walked into
    for (const r of ROOMS) expect(p.doors.some((d) => d.a === r.id || d.b === r.id), r.id).toBe(true);
  });

  it('places every game: the pit, the salon, poker, twelve slot islands, twenty-four desks, the wheel, the north wing', () => {
    const p = plan();
    const count = (f: (s: Placement) => boolean) => p.stations.filter(f).length;
    expect(count((s) => s.room === 'pit')).toBe(10);
    expect(count((s) => s.room === 'salon' && s.tier === 'high')).toBe(4); // v7.4: and the nosebleed Hold'em
    expect(count((s) => s.game === 'holdem')).toBe(5);
    expect(p.banks).toHaveLength(12);
    expect(count((s) => s.game === 'slots')).toBe(48);
    expect(count((s) => s.zone === 'online')).toBe(24);
    for (const g of ['plinko', 'tower', 'mines', 'dice', 'limbo', 'keno', 'hilo', 'crash', 'coinflip', 'wheel', 'cases', 'diamonds'] as GameId[]) expect(count((s) => s.game === g), g).toBe(2);
    // the north wing: twelve pachinko machines in two islands, two of each card game, one bingo hall
    expect(count((s) => s.game === 'pachinko' && s.room === 'parlour')).toBe(12);
    expect(p.machineIslands).toHaveLength(2);
    expect(count((s) => s.game === 'letitride' && s.room === 'cardroom')).toBe(2);
    expect(count((s) => s.game === 'paigow' && s.room === 'cardroom')).toBe(2);
    expect(count((s) => s.game === 'bingo' && s.room === 'bingo')).toBe(1);
    expect(count((s) => s.game === 'banditwheel')).toBe(1);
    expect(count((s) => s.game === 'videopoker')).toBe(4);
    // ids are unique and fit the server's station pattern
    const ids = p.stations.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,24}$/);
    // stations keep the ids they had before the building grew
    for (const id of ['bj-1', 'bj-2', 'bc-1', 'wr-1', 'tc-1', 'rl-us', 'rl-eu', 'cr-1', 'sb-1', 'b6-1', 'he-1', 'he-2', 'vp-1', 'slots-sevens-1']) expect(ids).toContain(id);
    // and the online desks keep theirs: the first eight games' desks are where they were numbered
    for (const id of ['pk-1', 'pk-2', 'tw-1', 'cs-2', 'cf-1', 'wh-2', 'ca-1', 'dm-2', 'pa-1', 'pa-12', 'lr-1', 'pg-2', 'bg-1']) expect(ids).toContain(id);
  });

  it('seats every table game: a chair or stool at each seat, tops a sitter can be measured on', () => {
    const p = plan();
    for (const s of p.stations) {
      const want = ['blackjack', 'baccarat', 'threecard', 'war', 'roulette', 'sicbo', 'bigsix', 'slots', 'letitride', 'paigow', 'bingo', 'pachinko'].includes(s.game) ? GAMES[s.game].seats(s.variant).length : 0;
      expect(p.chairs.filter((c) => c.station === s.id), s.id).toHaveLength(want);
    }
    for (const c of p.chairs) {
      expect(c.top).toBeGreaterThanOrEqual(0.3);
      expect(c.top).toBeLessThanOrEqual(0.95);
    }
    // the salon's tables get the plush chairs
    expect(p.chairs.filter((c) => c.station === 'vip-bj-1').every((c) => c.kind === 'plush')).toBe(true);
  });

  it('keeps everything apart: no station, chair, piece of furniture, plant or sign clips another, a wall or a ceiling', () => {
    expect(checkLayout(plan())).toEqual([]);
  });

  it('stays sound with one slot island per machine, and with bar-top video poker', () => {
    const six = planFloor(footprint, slotVariants(), { seats });
    expect(six.banks).toHaveLength(slotVariants().length);
    expect(checkLayout(six)).toEqual([]);
    const top = plan();
    setVpMode(top, 'bartop');
    expect(top.bar.segments).toHaveLength(1);
    expect(checkLayout(top)).toEqual([]);
  });

  it("stands the fountain in the pit's open floor, two metres clear all round, off the main aisle", () => {
    const p = plan();
    expect(p.fountains).toHaveLength(1);
    const f = p.fountains[0]!;
    expect(f.room).toBe('pit');
    const clear = FOUNTAIN.r + 2;
    for (const s of p.solids) {
      if (s.group.startsWith('fountain')) continue;
      const r = s.round ? s.w / 2 : Math.hypot(s.w, s.d) / 2;
      expect(Math.hypot(s.x - f.x, s.z - f.z) - r, s.id).toBeGreaterThan(clear);
    }
    for (const s of p.stations) expect(Math.hypot(s.x - f.x, s.z - f.z) - Math.hypot(s.fp.width, s.fp.depth) / 2, s.id).toBeGreaterThan(clear);
    // not on the way in from the lobby, nor in the staff corridor between the rows
    const lobbyDoor = p.doors.find((d) => d.id === 'lobby-pit')!;
    // (the main aisle runs 2.1 m either side of the grand opening's middle: the basin keeps a metre off it)
    expect(Math.abs(f.x - (lobbyDoor.a0 + lobbyDoor.a1) / 2) - FOUNTAIN.r).toBeGreaterThan(2.1 + 1);
    expect(f.z - FOUNTAIN.r > p.staff.z1).toBe(true);
  });

  it('has no rope barriers: only real things are solid', () => {
    const p = plan();
    expect('ropes' in p).toBe(false);
    expect(p.solids.some((s) => /rope|stanchion/.test(s.id))).toBe(false);
  });

  it('fits plants into the corners and palms under the ceilings', () => {
    const p = plan();
    expect(p.plants.length).toBeGreaterThanOrEqual(16);
    expect(p.palms.length).toBeGreaterThanOrEqual(3);
    for (const palm of p.palms) expect(0.55 + palm.size).toBeLessThan(roomAt(p, palm.x, palm.z)!.style.ceiling);
  });

  it('can walk from the doors to every station, every door and every room', () => {
    const p = plan();
    const grid = walkGrid(p);
    const seen = reachFrom(grid, SPAWN.x, SPAWN.z);
    const stuck = p.stations.filter((s) => !canUse(grid, seen, s)).map((s) => s.id);
    expect(stuck).toEqual([]);
    for (const d of p.doors) {
      if (d.b === 'outside') continue;
      const m = (d.a0 + d.a1) / 2;
      const [x, z] = d.axis === 'x' ? [m, d.c] : [d.c, m];
      expect(reached(grid, seen, x, z, 0.2), `door ${d.id}`).toBe(true);
    }
    for (const r of p.rooms) expect(reached(grid, seen, r.cx, r.cz, 4), `into ${r.name}`).toBe(true);
  });

  it('catches something passing through something else', () => {
    const p: FloorPlan = plan();
    const stool = p.solids.find((s) => s.id === 'stool-1')!;
    // a stool pushed into the bar's foot rail and counter
    stool.x = p.bar.front - 0.1;
    // a sign hung too high goes through the ceiling
    const sign = p.solids.find((s) => s.id === 'sign-table-games')!;
    sign.y1 = 4.5;
    // a plant in a table
    const bj = p.stations.find((s) => s.id === 'bj-1')!;
    p.solids.push({ id: 'stray-plant', group: 'stray', x: bj.x, z: bj.z, w: 1.2, d: 1.2, yaw: 0, y0: 0.4, y1: 1.5, round: true });
    const problems = checkLayout(p);
    expect(problems.some((q) => q.includes('stool-1') && q.includes('bar-rail'))).toBe(true);
    expect(problems).toContain('sign-table-games pokes through the ceiling');
    expect(problems).toContain('stray-plant clips bj-1');
    // and only those
    expect(problems.every((q) => /stool-1|sign-table-games|stray-plant/.test(q))).toBe(true);
  });
});
