import { describe, it, expect } from 'vitest';
import { WHEEL, type Variant } from '../src/games/roulette/rules.ts';
import { Flight, OpenTrack, Rotor, TAU, DIMS, FALL_S, BOUNCE_S, wrapPi, type FlightPlan } from '../../client/src/games/roulette/spin.ts';
import { seededRng } from './helpers/seeded.ts';
import { randUnit } from '../src/rng.ts';

// The client animates the ball toward the pocket the server chose. These fly hundreds of spins
// with random wheel positions and timings and check the ball always ends in that pocket, moves
// continuously, keeps going clockwise while the wheel turns counterclockwise, and makes at least
// four revolutions (58 Pa. Code §617a.5).

const rng = seededRng(42);
const rand = () => randUnit(rng);

/** Rotor-frame centre of wheel position i (pockets are laid clockwise from angle 0). */
const pocketAngle = (i: number, n: number) => -(i + 0.5) * (TAU / n);

/** Which wheel position a rotor-frame angle falls in. */
const positionAt = (rel: number, n: number) => (((Math.floor(-rel / (TAU / n)) % n) + n) % n);

function checkFlight(f: Flight, target: number, n: number, from: number) {
  const sector = TAU / n;
  // lands in the pocket and stays there
  for (const t of [f.tRest, f.tRest + 0.5, f.tRest + 4]) {
    const s = f.at(t);
    expect(s.phase).toBe('rest');
    expect(positionAt(s.rel!, n)).toBe(target);
    expect(s.r).toBeCloseTo(DIMS.restR, 9);
  }
  // continuous in angle, radius and height across every phase change
  for (const tb of [f.tDrop, f.tEnter, f.tRest]) {
    const a = f.at(tb - 1e-6);
    const b = f.at(tb + 1e-6);
    expect(Math.abs(wrapPi(a.theta - b.theta))).toBeLessThan(1e-3);
    expect(Math.abs(a.r - b.r)).toBeLessThan(1e-4);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1e-3);
  }
  // clockwise all the way to the rotor, never speeding up
  let last = -Infinity;
  for (let t = from; t < f.tEnter; t += 0.05) {
    const w = f.at(t).w;
    expect(w).toBeLessThan(0);
    expect(w).toBeGreaterThanOrEqual(last - 1e-9);
    last = w;
  }
  // the ball stays inside the bowl and above the rotor
  for (let t = from; t <= f.tRest; t += 0.01) {
    const s = f.at(t);
    expect(s.r).toBeLessThanOrEqual(DIMS.trackR + 1e-9);
    expect(s.r).toBeGreaterThanOrEqual(DIMS.restR - 1e-9);
    expect(s.y).toBeGreaterThanOrEqual(DIMS.pocketY + DIMS.ballR - 1e-9);
  }
  // it never stops before the pocket: settling happens in the last stretch of the bounce
  const rel = (t: number) => f.at(t).rel!;
  expect(Math.abs(rel(f.tEnter + 0.2 * BOUNCE_S) - rel(f.tRest))).toBeGreaterThan(sector);
  expect(sector).toBeGreaterThan(0);
}

describe.each(['american', 'european'] as Variant[])('roulette ball flight (%s)', (variant) => {
  const n = WHEEL[variant].length;
  const sector = TAU / n;
  const deflectors = Array.from({ length: 8 }, (_, i) => (i / 8) * TAU);

  it('lands a freshly launched ball in the chosen pocket, after at least four turns', () => {
    for (let run = 0; run < 150; run++) {
      const rotor = new Rotor();
      rotor.kick(rand() * TAU * 10);
      const target = Math.floor(rand() * n);
      const plan: FlightPlan = {
        pocketAngle: pocketAngle(target, n),
        tRest: 7.5,
        from: { t: 0, theta: Math.PI + (rand() - 0.5), w: -2.9 * TAU },
        rotor,
        deflectors,
        sector,
        jitter: rand,
      };
      const f = new Flight(plan);
      expect(f.correction).toBe(0);
      expect(f.revolutions).toBeGreaterThanOrEqual(4);
      expect(f.tDrop).toBeCloseTo(7.5 - BOUNCE_S - FALL_S, 9);
      checkFlight(f, target, n, 0);
    }
  });

  it('takes over a ball already circling when the result arrives late', () => {
    for (let run = 0; run < 150; run++) {
      const rotor = new Rotor();
      rotor.kick(rand() * TAU);
      const launch = rand() * TAU;
      const open = new OpenTrack(launch, 6.7);
      const tc = 2.5 + 2 * rand(); // "No more bets" 2.5 to 4.5 s after the ball went in
      const now = open.at(tc);
      const target = Math.floor(rand() * n);
      const f = new Flight({
        pocketAngle: pocketAngle(target, n),
        tRest: tc + 4.2 + 1.3 * rand(),
        from: { t: tc, theta: now.theta, w: now.w },
        rotor,
        deflectors,
        sector,
        jitter: rand,
      });
      // picks up exactly where the circling ball is
      const s = f.at(tc);
      expect(Math.abs(wrapPi(s.theta - now.theta))).toBeLessThan(1e-9);
      expect(s.w).toBeCloseTo(now.w, 9);
      expect(Math.abs(f.at(tc).theta - open.at(0).theta) / TAU + f.revolutions).toBeGreaterThanOrEqual(4);
      checkFlight(f, target, n, tc);
    }
  });
});
