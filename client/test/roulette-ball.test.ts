import { describe, it, expect } from 'vitest';
import { WHEEL } from '../../shared/src/games/roulette/rules.ts';
import { Flight, Rotor, TAU, BOUNCE_S, type FlightPlan } from '../src/games/roulette/spin.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';
import { randUnit } from '../../shared/src/rng.ts';

// The head's push and the ball's last second. shared/test/roulette-spin.test.ts flies hundreds of
// spins and checks every one lands in the drawn pocket; these check what the push and the knocks
// add on top: nothing jumps, and the ball still lies exactly where the server said.

const rng = seededRng(77);
const rand = () => randUnit(rng);

describe('the wheel head', () => {
  it('picks up the push from the speed it had: no jump in angle or speed', () => {
    const r = new Rotor();
    r.kick(1.2, 0.27 * TAU);
    expect(r.angle(0)).toBeCloseTo(1.2, 12);
    expect(r.speed(0)).toBeCloseTo(0.27 * TAU, 12);
    // the speed is the angle's rate everywhere
    for (const t of [0.01, 0.2, 0.5, 2, 6]) expect((r.angle(t + 1e-6) - r.angle(t - 1e-6)) / 2e-6).toBeCloseTo(r.speed(t), 4);
    // up to the push in a moment, then easing back toward idle
    expect(r.speed(1.5)).toBeGreaterThan(0.35 * TAU);
    expect(r.speed(40)).toBeLessThan(0.12 * TAU);
  });
  it('a first push from idle starts at the idle speed', () => {
    const r = new Rotor();
    r.kick(0);
    expect(r.speed(0)).toBeCloseTo(r.idle, 12);
  });
});

describe('the ball in the rotor', () => {
  const n = WHEEL.european.length;
  const sector = TAU / n;
  const flight = () => {
    const rotor = new Rotor();
    rotor.kick(rand() * TAU, (0.1 + 0.3 * rand()) * TAU);
    const target = Math.floor(rand() * n);
    const plan: FlightPlan = { pocketAngle: -(target + 0.5) * sector, tRest: 7.5, from: { t: 0, theta: Math.PI, w: -2.9 * TAU }, rotor, sector, jitter: rand };
    return { f: new Flight(plan), plan };
  };

  it('is knocked about as it lands on the frets, and rocks before it lies still', () => {
    // Without them its speed against the rotor only ever dies away; each knock checks it and
    // lets it run on, and the rock swings it to and fro: its speed picks up again more than once.
    for (let run = 0; run < 60; run++) {
      const { f } = flight();
      const dt = 0.004;
      const speed = (t: number) => (f.at(t + dt).rel! - f.at(t).rel!) / dt;
      let early = 0;
      let late = 0;
      let last = speed(f.tEnter);
      for (let t = f.tEnter + dt; t < f.tRest - dt; t += dt) {
        const v = speed(t);
        // rel falls toward the pocket: running on is its rate of fall growing again
        if (v < last - 1e-3) {
          if (t < f.tRest - 0.45) early++;
          else late++;
        }
        last = v;
      }
      expect(early, `run ${run}`).toBeGreaterThan(0);
      expect(late, `run ${run}`).toBeGreaterThan(0);
    }
  });

  it('lies exactly in the pocket at rest, arriving without a jump', () => {
    for (let run = 0; run < 100; run++) {
      const { f, plan } = flight();
      expect(f.at(f.tRest).rel).toBeCloseTo(plan.pocketAngle, 12);
      const before = f.at(f.tRest - 1e-6).rel!;
      expect(Math.abs(before - plan.pocketAngle)).toBeLessThan(1e-4);
      // never more than a pocket's width either way in the last stretch
      for (let t = f.tRest - 0.3; t < f.tRest; t += 0.01) expect(Math.abs(f.at(t).rel! - plan.pocketAngle)).toBeLessThan(sector);
      // still well short of the pocket a fifth of the way in (settling is the last stretch)
      expect(Math.abs(f.at(f.tEnter + 0.2 * BOUNCE_S).rel! - plan.pocketAngle)).toBeGreaterThan(sector);
    }
  });
});
