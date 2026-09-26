import { describe, it, expect } from 'vitest';
import { CAR_DEPTH_CM, CAR_PITCH_CM, FLOORS, LIFTS, LIFT_REACH_CM, atLift, bankAxes, carCentre, floorOf, levelLabel, liftRefusal } from '../src/lifts.ts';
import { ZONES, inRect, zoneOf, type ZoneId } from '../src/zones.ts';

const zones = Object.keys(ZONES) as ZoneId[];

describe('the elevators', () => {
  it('every zone has a bank, in that zone, with its arrival inside its own first car', () => {
    for (const z of zones) {
      const b = LIFTS[z];
      expect(b.zone).toBe(z);
      expect(zoneOf(b.x, b.z)).toBe(z);
      expect(zoneOf(b.arrive.x, b.arrive.z)).toBe(z);
      // the arrival is a car's middle, facing out of its doors
      const cars = Array.from({ length: b.cars }, (_, i) => carCentre(b, i));
      expect(cars).toContainEqual({ x: b.arrive.x, z: b.arrive.z });
      expect(b.arrive.r).toBe(b.r);
      // and near enough its doors to ride again from where it leaves you
      expect(atLift(z, b.arrive.x, b.arrive.z)).toBe(true);
    }
  });

  it("a bank's cars stand behind its front, side by side at the pitch", () => {
    for (const z of zones) {
      const b = LIFTS[z];
      const { nx, nz, ax, az } = bankAxes(b);
      expect(Math.hypot(nx, nz)).toBeCloseTo(1);
      expect(nx * ax + nz * az).toBeCloseTo(0);
      for (let i = 0; i < b.cars; i++) {
        const c = carCentre(b, i);
        // behind the front by half a car
        expect((c.x - b.x) * nx + (c.z - b.z) * nz).toBeCloseTo(-CAR_DEPTH_CM / 2, 0);
        if (i > 0) {
          const p = carCentre(b, i - 1);
          expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeCloseTo(CAR_PITCH_CM, 0);
        }
      }
    }
  });

  it('calls a car only from beside the doors of the zone you are in', () => {
    const c = LIFTS.casino;
    expect(atLift('casino', c.x, c.z)).toBe(true);
    expect(atLift('casino', c.x + LIFT_REACH_CM - 1, c.z)).toBe(true);
    expect(atLift('casino', c.x + LIFT_REACH_CM + 1, c.z)).toBe(false);
    // the ground's doors are not the casino's
    expect(atLift('casino', LIFTS.ground.x, LIFTS.ground.z)).toBe(false);
    expect(atLift('ground', LIFTS.ground.x + 100, LIFTS.ground.z)).toBe(true);
  });

  it('says why a ride is refused: held, at a table, already there, too far', () => {
    const at = (z: ZoneId) => ({ x: LIFTS[z].x + 50, z: LIFTS[z].z });
    expect(liftRefusal({ ...at('casino'), at: null }, 'ground')).toBeNull();
    expect(liftRefusal({ ...at('casino'), at: null }, 'roof')).toBeNull();
    expect(liftRefusal({ ...at('roof'), at: null }, 'casino')).toBeNull();
    expect(liftRefusal({ ...at('casino'), at: null, confine: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } }, 'ground')).toBe('held');
    expect(liftRefusal({ ...at('casino'), at: { station: 'bj-1' } }, 'ground')).toBe('table');
    expect(liftRefusal({ ...at('ground'), at: null }, 'ground')).toBe('here');
    expect(liftRefusal({ x: 0, z: 400, at: null }, 'roof')).toBe('far');
    // between zones is nowhere to ride from
    expect(liftRefusal({ x: 5000, z: 0, at: null }, 'roof')).toBe('far');
    // the held check comes first: the jail is in the ground zone, beside nothing
    expect(liftRefusal({ x: 18_000, z: -2000, at: null, confine: ZONES.ground }, 'casino')).toBe('held');
  });

  it('the panel lists the floors top to bottom, and the indicator reads them', () => {
    expect(FLOORS.map((f) => f.zone)).toEqual(['roof', 'home', 'casino', 'ground']);
    expect(new Set(FLOORS.map((f) => f.key)).size).toBe(4);
    for (let i = 1; i < FLOORS.length; i++) expect(FLOORS[i]!.level).toBeLessThan(FLOORS[i - 1]!.level);
    expect(floorOf('casino').key).toBe('C');
    expect(levelLabel(0)).toBe('G');
    expect(levelLabel(-1)).toBe('G');
    expect(levelLabel(2)).toBe('2');
    expect(levelLabel(17)).toBe('17');
    expect(levelLabel(floorOf('roof').level)).toBe('R');
  });

  it('the arrival points round-trip through the wire as plain integers', () => {
    for (const z of zones) {
      const a = LIFTS[z].arrive;
      for (const v of [a.x, a.z, a.r]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(Object.is(v, -0)).toBe(false);
      }
      expect(inRect(ZONES[z], a.x, a.z)).toBe(true);
    }
  });
});
