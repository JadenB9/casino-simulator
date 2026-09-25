import { describe, expect, it } from 'vitest';
import { STAFF, detourOf, lapMs, loopPose, makeDetour, parseDetour, poseAt, staffSpec, type Pose } from '../src/law/patrol.ts';
import { AWARE, sees } from '../src/law/sight.ts';
import { ROOMS, roomAt } from '../src/law/plan.ts';
import {
  BAIL_MAX,
  BAIL_MIN,
  JAIL,
  JAIL_RECT,
  PUNCH_REACH,
  bailFor,
  hotAmount,
  isJailTable,
  jailLimits,
  jailTableName,
  progressAfter,
  punchTarget,
} from '../src/law/rules.ts';
import { LOTS, inRect } from '../src/zones.ts';
import { DOLLAR } from '../src/money.ts';
import { limitsProblem } from '../src/limits.ts';

const T0 = 1_790_000_000_000;

describe('patrol loops', () => {
  it('are a pure function of the time: the same moment gives the same pose', () => {
    for (const s of STAFF) {
      for (const t of [T0, T0 + 1234, T0 + 98_765]) expect(loopPose(s, t)).toEqual(loopPose(s, t));
    }
  });

  it('come round again after one lap', () => {
    for (const s of STAFF) {
      const lap = lapMs(s);
      expect(lap).toBeGreaterThan(20_000);
      for (const t of [T0, T0 + 5_000, T0 + 17_321]) {
        const a = loopPose(s, t);
        const b = loopPose(s, t + lap);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.z).toBeCloseTo(a.z, 6);
        expect(b.yaw).toBeCloseTo(a.yaw, 6);
      }
    }
  });

  it('move continuously: never more than a stride between two frames', () => {
    for (const s of STAFF) {
      let prev = loopPose(s, T0);
      for (let t = T0 + 50; t < T0 + lapMs(s) + 1000; t += 50) {
        const p = loopPose(s, t);
        expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan((s.speed * 50) / 1000 + 1e-6);
        prev = p;
      }
    }
  });

  it('keep every stop inside the building, and the pit boss in the pit and the salon', () => {
    for (const s of STAFF) for (const p of s.route) expect(roomAt(p.x, p.z), `${s.id} ${p.x},${p.z}`).not.toBeNull();
    for (const p of staffSpec('boss').route) expect(['pit', 'salon']).toContain(roomAt(p.x, p.z));
  });

  it('stand still at a stop, facing the way it says, and look round a little', () => {
    const boss = staffSpec('boss');
    // his first stop starts the lap: at offset 0, t = a whole number of laps is its first instant
    const t = Math.ceil(T0 / lapMs(boss)) * lapMs(boss);
    const p = loopPose(boss, t + 10);
    expect(p.moving).toBe(false);
    expect(p.x).toBe(boss.route[0]!.x);
    expect(Math.abs(p.yaw - boss.route[0]!.face!)).toBeLessThanOrEqual(boss.route[0]!.sweep! + 1e-9);
  });
});

describe('detours', () => {
  const g1 = staffSpec('g1');
  const player = { x: 3, z: -5 };

  it('walk over, talk facing the player, walk back onto the loop', () => {
    const d = makeDetour(g1, T0, 42, 'warn', player, 4_000);
    expect(d.until).toBe(d.at + d.go + 4_000 + d.back);
    const start = poseAt(g1, T0, d);
    const from = loopPose(g1, T0);
    expect(start.x).toBeCloseTo(from.x, 6);
    expect(start.busy).toBe(true);
    const talking = poseAt(g1, T0 + d.go + 100, d);
    expect(Math.hypot(talking.x - player.x, talking.z - player.z)).toBeLessThanOrEqual(0.91);
    expect(talking.moving).toBe(false);
    // facing the player
    const dx = player.x - talking.x;
    const dz = player.z - talking.z;
    expect((dx * Math.sin(talking.yaw) + dz * Math.cos(talking.yaw)) / Math.hypot(dx, dz)).toBeGreaterThan(0.99);
    const end = poseAt(g1, d.until - 1, d);
    const home = loopPose(g1, d.until);
    expect(Math.hypot(end.x - home.x, end.z - home.z)).toBeLessThan(0.05);
    // and after it, his loop again
    expect(poseAt(g1, d.until, d)).toEqual(loopPose(g1, d.until));
  });

  it("only count for their own staff member and their own time", () => {
    const d = makeDetour(g1, T0, 42, 'warn', player, 4_000);
    expect(detourOf([d], 'g1', T0 + 10)).toBe(d);
    expect(detourOf([d], 'g2', T0 + 10)).toBeNull();
    expect(detourOf([d], 'g1', d.until)).toBeNull();
    expect(poseAt(staffSpec('g2'), T0 + 10, d)).toEqual(loopPose(staffSpec('g2'), T0 + 10));
  });

  it('parse from the wire only when whole', () => {
    const d = makeDetour(g1, T0, 42, 'jail', player, 1_800);
    expect(parseDetour(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(parseDetour({ ...d, staff: 'g9' })).toBeNull();
    expect(parseDetour({ ...d, until: d.at })).toBeNull();
    expect(parseDetour({ ...d, x: 'a' })).toBeNull();
    expect(parseDetour(null)).toBeNull();
  });
});

describe('sight', () => {
  const g1 = staffSpec('g1');
  const at = (x: number, z: number, yaw: number, busy = false): Pose => ({ x, z, yaw, moving: false, busy });

  it('sees in front within range, not behind, not past range', () => {
    const p = at(0, -4, Math.PI); // in the pit, facing north (-z)
    expect(sees(g1, p, 0, -9)).toBe(true);
    expect(sees(g1, p, 2, -9)).toBe(true);
    expect(sees(g1, p, 0, -1)).toBe(false); // behind, 3 m
    expect(sees(g1, p, 0, -4 - g1.range - 0.5)).toBe(false);
    expect(sees(g1, p, 9, -5)).toBe(false); // off to the side, outside the cone
  });

  it('notices anyone right beside him, whichever way he faces', () => {
    const p = at(0, -4, Math.PI);
    expect(sees(g1, p, 0, -4 + AWARE - 0.1)).toBe(true);
  });

  it('never sees through a wall into another room', () => {
    // in the lobby facing north toward the pit: the pit is another room
    const p = at(-5, 5, Math.PI);
    expect(roomAt(-5, 5)).toBe('lobby');
    expect(sees(g1, p, -5, 1)).toBe(false);
    expect(sees(g1, p, -5, 7)).toBe(false); // behind
    const q = at(-5, 12, Math.PI);
    expect(sees(g1, q, -5, 6)).toBe(true);
  });

  it('sees nobody while busy on a detour', () => {
    expect(sees(g1, at(0, -4, Math.PI, true), 0, -5)).toBe(false);
  });

  it('knows which room is which', () => {
    expect(roomAt(0, -12)).toBe('pit');
    expect(roomAt(0, -25)).toBe('salon');
    expect(roomAt(0, 40)).toBeNull();
    // the rooms tile the building without overlapping
    const list = Object.values(ROOMS);
    for (const [i, a] of list.entries()) {
      for (const b of list.slice(i + 1)) expect(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0).toBe(false);
    }
  });
});

describe('punches', () => {
  it('land on the nearest person in reach in front, and on nobody behind', () => {
    const who = [
      { id: 1, x: 0, z: 1 },
      { id: 2, x: 0, z: 0.8 },
      { id: 3, x: 0, z: -0.8 },
    ];
    expect(punchTarget(0, 0, 0, who)).toBe(2); // facing +z
    expect(punchTarget(0, 0, Math.PI, who)).toBe(3);
    expect(punchTarget(0, 0, Math.PI / 2, who)).toBeNull();
    expect(punchTarget(0, 0, 0, [{ id: 9, x: 0, z: PUNCH_REACH + 0.05 }])).toBeNull();
    expect(punchTarget<string | number>(0, 0, 0, [{ id: 'g1', x: 0.1, z: 1 }])).toBe('g1');
  });
});

describe('the rules', () => {
  it('sets bail at a fiftieth of your worth in hundreds, from $1,000 to $25,000', () => {
    expect(bailFor(0)).toBe(BAIL_MIN);
    expect(bailFor(50_000 * DOLLAR)).toBe(1_000 * DOLLAR);
    expect(bailFor(300_000 * DOLLAR)).toBe(6_000 * DOLLAR);
    expect(bailFor(312_345 * DOLLAR)).toBe(6_200 * DOLLAR);
    expect(bailFor(10_000_000 * DOLLAR)).toBe(BAIL_MAX);
    expect(bailFor(-5)).toBe(BAIL_MIN);
  });

  it('never lets progress go below zero', () => {
    expect(progressAfter(0, -500)).toBe(0);
    expect(progressAfter(300, -500)).toBe(0);
    expect(progressAfter(300, 200)).toBe(500);
  });

  it('gives the jail tables limits their games allow, the maximum a quarter of the bail', () => {
    for (const bail of [BAIL_MIN, 6_000 * DOLLAR, BAIL_MAX]) {
      for (const game of ['blackjack', 'sicbo'] as const) {
        const l = jailLimits(game, bail)!;
        expect(limitsProblem(game, l)).toBeNull();
        expect(l.min).toBe(5 * DOLLAR);
        expect(l.max).toBe(Math.max(50 * DOLLAR, bail / 4));
      }
    }
  });

  it('names jail tables as solo tables of their own', () => {
    expect(jailTableName('blackjack', 7)).toBe('solo:blackjack:jail:7');
    expect(isJailTable('solo:blackjack:jail:7')).toBe(true);
    expect(isJailTable('solo:blackjack:-:7')).toBe(false);
    expect(isJailTable('bj-abcdefghij')).toBe(false);
  });

  it('scales "winning too much" with the table', () => {
    expect(hotAmount(null)).toBe(1_000 * DOLLAR);
    expect(hotAmount({ min: 5 * DOLLAR, max: 500 * DOLLAR })).toBe(2_000 * DOLLAR);
    expect(hotAmount({ min: 25 * DOLLAR, max: 5_000 * DOLLAR })).toBe(20_000 * DOLLAR);
    expect(hotAmount({ min: 1_000 * DOLLAR, max: 10_000 * DOLLAR })).toBe(100_000 * DOLLAR);
  });

  it('keeps the jail inside its lot, and booking inside the jail', () => {
    expect(inRect(LOTS.jail, JAIL_RECT.minX, JAIL_RECT.minZ)).toBe(true);
    expect(inRect(LOTS.jail, JAIL_RECT.maxX, JAIL_RECT.maxZ)).toBe(true);
    expect(inRect(JAIL_RECT, JAIL.spawn.x * 100, JAIL.spawn.z * 100)).toBe(true);
  });
});
