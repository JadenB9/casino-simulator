import { describe, it, expect } from 'vitest';
import { STOPS } from '../src/games/bigsix/rules.ts';
import {
  WheelSpin, chooseEnding, stopAt, angleFor, contactAngle, pushAngle, flapAngle, springAngle, tipAngle, mod,
  TAU, SECTOR, GEO, A_TOUCH, A_RELEASE, G_TOUCH, PHI_RELEASE, MIN_REVS, PULL_S, ROCK_S,
} from '../../client/src/games/bigsix/spin.ts';
import { seededRng } from './helpers/seeded.ts';
import { randUnit } from '../src/rng.ts';

// The client turns the wheel onto the stop the server chose. These plan hundreds of spins from
// random wheel positions and timings and check the clapper always ends on that stop, the wheel
// moves continuously, only ever slows after the pull, turns at least three times, and that every
// peg that passes the clapper makes exactly one tick.

const rng = seededRng(6);
const rand = () => randUnit(rng);

function plan(stop: number, duration = 10.5) {
  return { theta0: rand() * 40 - 20, duration, stop, ...chooseEnding(rand) };
}

describe('big six clapper geometry', () => {
  it('touches a peg just before the top and lets it go a little after', () => {
    expect(A_TOUCH).toBeLessThan(0);
    expect(A_TOUCH).toBeGreaterThan(-0.01);
    expect(A_RELEASE).toBeGreaterThan(0);
    // a peg is on the flap for less than one stop, so at most one touches it at a time
    expect(A_RELEASE - A_TOUCH).toBeLessThan(SECTOR);
    expect(G_TOUCH).toBeGreaterThan(0.4);
    expect(G_TOUCH).toBeLessThan(0.8);
    // the tip really reaches between the pegs, and the hinge sits outside them
    expect(GEO.pivotR - GEO.flapL).toBeLessThan(GEO.pegR - GEO.pegRadius);
    expect(GEO.pivotR).toBeGreaterThan(GEO.pegR);
  });

  it('pushes the flap smoothly from hanging straight to the release angle', () => {
    expect(pushAngle(A_TOUCH)).toBeCloseTo(0, 9);
    let last = -1;
    for (let a = A_TOUCH; a <= A_RELEASE; a += (A_RELEASE - A_TOUCH) / 200) {
      const phi = pushAngle(a);
      expect(phi).toBeGreaterThan(last);
      last = phi;
    }
    expect(PHI_RELEASE).toBeGreaterThan(0.3);
    expect(PHI_RELEASE).toBeLessThan(0.6);
    // at the release the peg sits exactly a flap's length from the hinge along the flap
    const x = GEO.pegR * Math.sin(A_RELEASE);
    const y = GEO.pivotR - GEO.pegR * Math.cos(A_RELEASE);
    expect(Math.hypot(x, y) ** 2 - GEO.pegRadius ** 2).toBeCloseTo(GEO.flapL ** 2, 12);
  });

  it('is pushed only while a peg is between touch and release', () => {
    for (let k = 0; k < 400; k++) {
      const theta = rand() * 30;
      const c = contactAngle(theta);
      // the peg nearest to having passed the touch point
      const past = mod(theta - A_TOUCH, SECTOR);
      if (past < A_RELEASE - A_TOUCH) expect(c).toBeCloseTo(pushAngle(A_TOUCH + past), 12);
      else expect(c).toBeNull();
    }
  });

  it('springs back after a release and settles', () => {
    expect(springAngle(0)).toBeCloseTo(PHI_RELEASE, 12);
    expect(Math.abs(springAngle(0.3))).toBeLessThan(0.02 * PHI_RELEASE);
    expect(springAngle(1)).toBe(0);
    // a spring still swinging wide holds the flap ahead of a peg that has only just touched it
    const theta = A_TOUCH + 0.0005;
    expect(flapAngle(theta, 0)).toBeCloseTo(PHI_RELEASE, 12);
    expect(flapAngle(theta, null)).toBeCloseTo(pushAngle(theta), 12);
  });

  it('names the stop between the peg still on the flap and the one that has gone by', () => {
    for (let stop = 0; stop < STOPS; stop++) {
      for (const g of [0.001, 0.2, G_TOUCH - 0.01, G_TOUCH + 0.01, 0.5, 0.999]) {
        const theta = angleFor(stop, g) + TAU * Math.round(rand() * 6 - 3);
        expect(stopAt(theta)).toBe(stop);
        // the flap's tip lies between that stop's two pegs, pushed or hanging free
        const tip = tipAngle(flapAngle(theta, null));
        const left = stop * SECTOR + theta;
        const d = mod(tip - left, TAU);
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(SECTOR);
      }
    }
  });
});

describe('big six spin', () => {
  it('always stops on the chosen stop, whatever the start and the timing', () => {
    for (let i = 0; i < 324; i++) {
      const stop = i % STOPS;
      const duration = i % 5 === 0 ? 4 + rand() * 3 : 10.5;
      const spin = new WheelSpin(plan(stop, duration));
      for (const t of [spin.tRest, spin.tRest + 0.5, spin.tRest + 30]) expect(stopAt(spin.angle(t))).toBe(stop);
      expect(spin.angle(spin.tRest)).toBeCloseTo(spin.thetaRest, 12);
      // it passed through every stop at least three times on the way
      expect(spin.revolutions).toBeGreaterThanOrEqual(MIN_REVS);
      expect(spin.revolutions).toBeLessThan(MIN_REVS + 2.2);
    }
  });

  it('moves continuously, only slows after the pull, and turns back only in the final rock', () => {
    for (let i = 0; i < 54; i++) {
      const spin = new WheelSpin(plan(i % STOPS));
      for (const tb of [PULL_S, spin.tStop, spin.tRest]) {
        expect(Math.abs(spin.angle(tb - 1e-6) - spin.angle(tb + 1e-6))).toBeLessThan(1e-4);
        expect(Math.abs(spin.speed(tb - 1e-6) - spin.speed(tb + 1e-6))).toBeLessThan(1e-2);
      }
      let lastAngle = spin.angle(0);
      let lastSpeed = Infinity;
      for (let t = 0.01; t < spin.tStop; t += 0.01) {
        const a = spin.angle(t);
        expect(a).toBeGreaterThanOrEqual(lastAngle);
        // the numeric slope matches the closed-form speed
        expect((spin.angle(t + 1e-5) - spin.angle(t - 1e-5)) / 2e-5).toBeCloseTo(spin.speed(t), 3);
        if (t > PULL_S) {
          expect(spin.speed(t)).toBeLessThanOrEqual(lastSpeed + 1e-9);
          lastSpeed = spin.speed(t);
        }
        lastAngle = a;
      }
      expect(spin.speed(spin.tStop - 1e-6)).toBeLessThan(0.01);
      if (spin.tRest > spin.tStop) {
        expect(spin.tRest - spin.tStop).toBeCloseTo(ROCK_S, 12);
        for (let t = spin.tStop + 0.01; t < spin.tRest; t += 0.01) expect(spin.speed(t)).toBeLessThanOrEqual(0);
        // rocking back never takes the wheel past a peg
        expect(stopAt(spin.thetaStop)).toBe(spin.plan.stop);
      }
    }
  });

  it('pulls to a believable speed: one turn every 0.8 to 1.6 seconds', () => {
    for (let i = 0; i < 200; i++) {
      const spin = new WheelSpin(plan(i % STOPS));
      expect(spin.w0 / TAU).toBeGreaterThan(0.6);
      expect(spin.w0 / TAU).toBeLessThan(1.3);
    }
  });

  it('ticks once for every peg that slips past the clapper, slower and slower', () => {
    for (let i = 0; i < 30; i++) {
      const spin = new WheelSpin(plan(i % STOPS));
      const ticks = spin.releases();
      const expected = Math.floor((spin.thetaStop - A_RELEASE) / SECTOR) - Math.floor((spin.plan.theta0 - A_RELEASE) / SECTOR);
      expect(ticks).toHaveLength(expected);
      expect(ticks.length).toBeGreaterThanOrEqual(MIN_REVS * STOPS);
      for (let k = 0; k < ticks.length; k++) {
        const t = ticks[k]!;
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThanOrEqual(spin.tStop);
        // at each tick a peg is exactly at the release angle
        expect(mod(spin.angle(t) - A_RELEASE + SECTOR / 2, SECTOR) - SECTOR / 2).toBeCloseTo(0, 6);
        if (k > 0) expect(t).toBeGreaterThan(ticks[k - 1]!);
      }
      // the gaps grow through the slow-down: the last few ticks are far apart
      const gap = (k: number) => ticks[k + 1]! - ticks[k]!;
      expect(gap(ticks.length - 2)).toBeGreaterThan(5 * gap(Math.floor(ticks.length / 3)));
      // touches come in the same number, each a little before its release
      const touches = spin.touches();
      expect(Math.abs(touches.length - ticks.length)).toBeLessThanOrEqual(1);
    }
  });

  it('chooses endings that die against a peg and roll back, or run out between pegs, always with the flap hanging free', () => {
    let rocked = 0;
    for (let i = 0; i < 1000; i++) {
      const e = chooseEnding(rand);
      expect(e.gStop).toBeGreaterThan(0);
      expect(e.gRest).toBeLessThan(1);
      expect(e.gRest).toBeGreaterThanOrEqual(e.gStop);
      // at rest no peg touches the flap: the last one has gone by and the next hasn't reached it
      expect(e.gRest).toBeGreaterThan(G_TOUCH);
      expect(contactAngle(angleFor(0, e.gRest))).toBeNull();
      if (e.gRest > e.gStop) {
        rocked++;
        // it stopped with a peg bending the leather
        expect(e.gStop).toBeLessThan(G_TOUCH);
        expect(contactAngle(angleFor(0, e.gStop))).toBeGreaterThan(0);
      }
    }
    expect(rocked).toBeGreaterThan(600);
    expect(rocked).toBeLessThan(850);
  });
});
