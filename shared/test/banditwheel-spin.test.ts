import { describe, it, expect } from 'vitest';
import { SLOTS } from '../src/games/banditwheel/rules.ts';
import { SPIN_MS } from '../src/games/banditwheel/engine.ts';
import {
  WheelSpin, chooseEnding, slotAt, angleFor, contactAngle, pushAngle, flapAngle, springAngle, tipAngle, mod,
  TAU, SECTOR, A_TOUCH, A_RELEASE, G_TOUCH, PHI_RELEASE, MIN_REVS, PULL_S,
} from '../../client/src/games/banditwheel/spin.ts';
import { PEG_R, PEG_RADIUS, PIVOT_R, FLAP_L } from '../../client/src/games/banditwheel/layout.ts';
import { seededRng } from './helpers/seeded.ts';
import { randUnit } from '../src/rng.ts';

// The client turns the wheel onto the slot the server chose. These plan hundreds of spins from
// random wheel positions and timings (a full spin, or what is left of one for a player who walks
// up mid-spin) and check the flapper always ends in that slot, the wheel moves continuously and
// only slows after the pull, and every peg that passes the flapper makes exactly one click.

const rng = seededRng(25);
const rand = () => randUnit(rng);
const FULL = SPIN_MS / 1000;

function plan(slot: number, duration = FULL) {
  return { theta0: rand() * 40 - 20, duration, slot, ...chooseEnding(rand) };
}

describe('bandit wheel flapper geometry', () => {
  it('touches a peg just before the top and lets it go a little after', () => {
    expect(A_TOUCH).toBeLessThan(0);
    expect(A_TOUCH).toBeGreaterThan(-0.02);
    expect(A_RELEASE).toBeGreaterThan(0);
    // a peg is on the flapper for less than one slot, so at most one touches it at a time
    expect(A_RELEASE - A_TOUCH).toBeLessThan(SECTOR);
    expect(G_TOUCH).toBeGreaterThan(0.3);
    expect(G_TOUCH).toBeLessThan(0.8);
    // the tip really reaches between the pegs, and the hinge sits outside them
    expect(PIVOT_R - FLAP_L).toBeLessThan(PEG_R - PEG_RADIUS);
    expect(PIVOT_R).toBeGreaterThan(PEG_R);
  });

  it('bends the flapper smoothly from hanging straight to the release angle', () => {
    expect(pushAngle(A_TOUCH)).toBeCloseTo(0, 9);
    let last = -1;
    for (let a = A_TOUCH; a <= A_RELEASE; a += (A_RELEASE - A_TOUCH) / 200) {
      const phi = pushAngle(a);
      expect(phi).toBeGreaterThan(last);
      last = phi;
    }
    expect(PHI_RELEASE).toBeGreaterThan(0.3);
    expect(PHI_RELEASE).toBeLessThan(0.7);
    // at the release the peg sits exactly a flapper's length from the hinge along it
    const x = PEG_R * Math.sin(A_RELEASE);
    const y = PIVOT_R - PEG_R * Math.cos(A_RELEASE);
    expect(Math.hypot(x, y) ** 2 - PEG_RADIUS ** 2).toBeCloseTo(FLAP_L ** 2, 12);
  });

  it('is pushed only while a peg is between touch and release, and springs back after', () => {
    for (let k = 0; k < 400; k++) {
      const theta = rand() * 30;
      const c = contactAngle(theta);
      const past = mod(theta - A_TOUCH, SECTOR);
      if (past < A_RELEASE - A_TOUCH) expect(c).toBeCloseTo(pushAngle(A_TOUCH + past), 12);
      else expect(c).toBeNull();
    }
    expect(springAngle(0)).toBeCloseTo(PHI_RELEASE, 12);
    expect(Math.abs(springAngle(0.35))).toBeLessThan(0.02 * PHI_RELEASE);
    expect(springAngle(1)).toBe(0);
    const theta = A_TOUCH + 0.0005;
    expect(flapAngle(theta, 0)).toBeCloseTo(PHI_RELEASE, 12);
    expect(flapAngle(theta, null)).toBeCloseTo(pushAngle(theta), 12);
  });

  it('names the slot between the peg still on the flapper and the one that has gone by', () => {
    for (let slot = 0; slot < SLOTS; slot++) {
      for (const g of [0.001, 0.2, G_TOUCH - 0.01, G_TOUCH + 0.01, 0.7, 0.999]) {
        const theta = angleFor(slot, g) + TAU * Math.round(rand() * 6 - 3);
        expect(slotAt(theta)).toBe(slot);
        // the tip lies between that slot's two pegs, pushed or hanging free
        const tip = tipAngle(flapAngle(theta, null));
        const left = slot * SECTOR + theta;
        const d = mod(tip - left, TAU);
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(SECTOR);
      }
    }
  });
});

describe('bandit wheel spin', () => {
  it('always stops on the chosen slot, a full spin or the end of one', () => {
    for (let i = 0; i < 500; i++) {
      const slot = i % SLOTS;
      const duration = i % 4 === 0 ? 1.2 + rand() * (FULL - 1.2) : FULL;
      const spin = new WheelSpin(plan(slot, duration));
      for (const t of [spin.tRest, spin.tRest + 0.5, spin.tRest + 30]) expect(slotAt(spin.angle(t))).toBe(slot);
      expect(spin.angle(spin.tRest)).toBeCloseTo(spin.thetaRest, 12);
      expect(spin.revolutions).toBeGreaterThanOrEqual(MIN_REVS);
      if (duration === FULL) expect(spin.revolutions).toBeLessThan(MIN_REVS + 2.5);
    }
  });

  it('moves continuously, only slows after the pull, and turns back only in the final rock', () => {
    for (let i = 0; i < 50; i++) {
      const spin = new WheelSpin(plan(i % SLOTS));
      for (const tb of [PULL_S, spin.tStop, spin.tRest]) {
        expect(Math.abs(spin.angle(tb - 1e-6) - spin.angle(tb + 1e-6))).toBeLessThan(1e-4);
      }
      let lastAngle = spin.angle(0);
      let lastSpeed = Infinity;
      for (let t = 0.01; t < spin.tStop; t += 0.01) {
        const a = spin.angle(t);
        expect(a).toBeGreaterThanOrEqual(lastAngle);
        expect((spin.angle(t + 1e-5) - spin.angle(t - 1e-5)) / 2e-5).toBeCloseTo(spin.speed(t), 3);
        if (t > PULL_S) {
          expect(spin.speed(t)).toBeLessThanOrEqual(lastSpeed + 1e-9);
          lastSpeed = spin.speed(t);
        }
        lastAngle = a;
      }
      if (spin.tRest > spin.tStop) {
        for (let t = spin.tStop + 0.01; t < spin.tRest; t += 0.01) expect(spin.speed(t)).toBeLessThanOrEqual(0);
        // rocking back never takes the wheel past a peg
        expect(slotAt(spin.thetaStop)).toBe(spin.plan.slot);
      }
    }
  });

  it('pulls to a believable speed for a big wheel: about a turn a second', () => {
    for (let i = 0; i < 200; i++) {
      const spin = new WheelSpin(plan(i % SLOTS));
      expect(spin.w0 / TAU).toBeGreaterThan(0.8);
      expect(spin.w0 / TAU).toBeLessThan(1.7);
    }
  });

  it('clicks once for every peg that slips past the flapper, slower and slower', () => {
    for (let i = 0; i < 30; i++) {
      const spin = new WheelSpin(plan(i % SLOTS));
      const ticks = spin.releases();
      const expected = Math.floor((spin.thetaStop - A_RELEASE) / SECTOR) - Math.floor((spin.plan.theta0 - A_RELEASE) / SECTOR);
      expect(ticks).toHaveLength(expected);
      expect(ticks.length).toBeGreaterThanOrEqual(MIN_REVS * SLOTS);
      for (let k = 0; k < ticks.length; k++) {
        const t = ticks[k]!;
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThanOrEqual(spin.tStop);
        expect(mod(spin.angle(t) - A_RELEASE + SECTOR / 2, SECTOR) - SECTOR / 2).toBeCloseTo(0, 6);
        if (k > 0) expect(t).toBeGreaterThan(ticks[k - 1]!);
      }
      const gap = (k: number) => ticks[k + 1]! - ticks[k]!;
      expect(gap(ticks.length - 2)).toBeGreaterThan(4 * gap(Math.floor(ticks.length / 3)));
    }
  });

  it('ends with the flapper hanging free between two pegs', () => {
    let rocked = 0;
    for (let i = 0; i < 1000; i++) {
      const e = chooseEnding(rand);
      expect(e.gStop).toBeGreaterThan(0);
      expect(e.gRest).toBeLessThan(1);
      expect(e.gRest).toBeGreaterThanOrEqual(e.gStop);
      expect(e.gRest).toBeGreaterThan(G_TOUCH);
      expect(contactAngle(angleFor(0, e.gRest))).toBeNull();
      if (e.gRest > e.gStop) {
        rocked++;
        expect(e.gStop).toBeLessThan(G_TOUCH);
        expect(contactAngle(angleFor(0, e.gStop))).toBeGreaterThan(0);
      }
    }
    expect(rocked).toBeGreaterThan(600);
    expect(rocked).toBeLessThan(800);
  });
});
