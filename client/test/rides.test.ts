// Rides and the v6 pieces: every piece in the catalog has a model, the rides go faster than
// walking but well inside what the floor allows, and the stance math (the lean into a turn, the
// leg reaching the deck, the wheels) does what it says.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAX_LEAN, RIDES, hasRideModel, hoverBob, kneeFor, leanFor, ridePace, rideSpec, segwayPitch, stanceYaw, toggledRide, wheelTurn } from '../src/world/rides.ts';
import { hasWearModel } from '../src/world/wearables.ts';
import { SHOP_ITEMS } from '../../shared/src/items.ts';
import { DEFAULT_LOOK, parseLook, type Look } from '../../shared/src/look.ts';

/** The floor's own limit (server/src/floor/presence.ts MAX_SPEED, cm/s) and the walker's pace. */
const SERVER_MAX = 9;
const WALK = 2.6;
const RUN = 4.8;

describe('the catalog has a model for everything worn', () => {
  it('every ride, sold or given, has a spec and a model', () => {
    const rides = SHOP_ITEMS.filter((i) => i.kind === 'ride');
    expect(rides.map((r) => r.id).sort()).toEqual(['e-scooter', 'golden-board', 'hover-throne', 'hoverboard', 'segway', 'skateboard']);
    for (const r of rides) {
      expect(rideSpec(r.id), r.id).not.toBeNull();
      expect(hasRideModel(r.id), r.id).toBe(true);
    }
  });

  it('every other piece, sold or given, has a model (both bodies are fitted from the same builders)', () => {
    for (const it of SHOP_ITEMS.filter((i) => i.kind !== 'ride')) expect(hasWearModel(it.id), it.id).toBe(true);
  });

  it('a ride is only a ride in the ride slot', () => {
    expect(rideSpec('skateboard')).toBe(RIDES.skateboard);
    expect(rideSpec('cuban-link')).toBeNull();
    expect(rideSpec('rocket')).toBeNull();
    expect(rideSpec(undefined)).toBeNull();
  });

  it('a look can wear a ride and keeps it through parsing', () => {
    const look = parseLook({ ...DEFAULT_LOOK, ride: 'hoverboard' });
    expect(look?.ride).toBe('hoverboard');
    expect(parseLook({ ...DEFAULT_LOOK, ride: 'gold-watch' })?.ride).toBeUndefined();
  });
});

describe('ride speeds', () => {
  it('beat walking and running, and stay well under the server limit', () => {
    for (const [id, r] of Object.entries(RIDES)) {
      expect(r.walk, id).toBeGreaterThan(WALK);
      expect(r.run, id).toBeGreaterThan(RUN);
      expect(r.run, id).toBeGreaterThan(r.walk);
      // room for a late frame and the smoothing on top
      expect(r.run, id).toBeLessThanOrEqual(SERVER_MAX * 0.9);
      expect(r.radius, id).toBeGreaterThanOrEqual(0.3);
      expect(r.radius, id).toBeLessThanOrEqual(0.45);
      expect(r.coast, id).toBeLessThan(r.accel);
    }
  });

  it('the reward board is the quickest of the boards', () => {
    expect(RIDES['golden-board']!.run).toBeGreaterThan(RIDES.hoverboard!.run);
  });

  it('ridePace reads what a character is riding now, and nothing on foot', () => {
    expect(ridePace({ riding: 'segway' })?.walk).toBe(RIDES.segway!.walk);
    expect(ridePace({ riding: null })).toBeNull();
    expect(ridePace({})).toBeNull();
    expect(ridePace(null)).toBeNull();
  });
});

describe('riding', () => {
  it('leans into a turn, harder the faster, never past the limit', () => {
    expect(leanFor(5, 0)).toBeCloseTo(0);
    // turning left (yaw increasing) leans left: a negative roll
    expect(leanFor(5, 1)).toBeLessThan(0);
    expect(leanFor(5, -1)).toBeGreaterThan(0);
    expect(Math.abs(leanFor(6, 1))).toBeGreaterThan(Math.abs(leanFor(3, 1)));
    expect(Math.abs(leanFor(9, 10))).toBeCloseTo(MAX_LEAN);
    expect(leanFor(0, 3)).toBeCloseTo(0);
  });

  it('turns the wheels by the distance rolled', () => {
    expect(wheelTurn(2, 0.5, 0.1)).toBeCloseTo(10);
    expect(wheelTurn(2, 0.5, 0)).toBe(0);
  });

  it('floats a hoverboard within a couple of centimetres', () => {
    for (let t = 0; t < 20; t += 0.05) expect(Math.abs(hoverBob(t))).toBeLessThanOrEqual(0.014);
  });

  it('tips a Segway forward as it goes, a little', () => {
    expect(segwayPitch(0)).toBe(0);
    expect(segwayPitch(3)).toBeGreaterThan(0);
    expect(segwayPitch(100)).toBeLessThanOrEqual(0.14);
  });

  it('stands across a board, faces ahead on a bar, sits on a throne', () => {
    for (const r of Object.values(RIDES)) {
      expect(stanceYaw(r)).toBe(r.stance === 'side' ? -Math.PI / 2 : 0);
      // a seat has a height over its footrest, nothing else does
      expect(r.seat !== undefined).toBe(r.stance === 'seat');
      // a bar to hold means a front stance, and the other way round
      expect(!!r.grip).toBe(r.stance === 'front');
      // the left foot is on the left
      expect(r.feet[0][0]).toBeGreaterThan(r.feet[1][0]);
    }
  });

  it('solves a leg: the knee is a thigh from the hip and a shin from the ankle, bent toward the pole', () => {
    const hip = new THREE.Vector3(0.1, 0.9, 0);
    const ankle = new THREE.Vector3(0.2, 0.12, 0.05);
    const knee = new THREE.Vector3();
    const reached = kneeFor(hip, ankle, 0.43, 0.44, new THREE.Vector3(0, 0, 1), knee);
    expect(reached.distanceTo(ankle)).toBeLessThan(1e-9);
    expect(knee.distanceTo(hip)).toBeCloseTo(0.43, 6);
    expect(knee.distanceTo(ankle)).toBeCloseTo(0.44, 6);
    // forward of the hip-ankle line
    const mid = hip.clone().lerp(ankle, 0.43 / 0.87);
    expect(knee.z).toBeGreaterThan(mid.z);
  });

  it('pulls an ankle out of reach in along the line, the leg straight', () => {
    const hip = new THREE.Vector3(0, 1, 0);
    const knee = new THREE.Vector3();
    const reached = kneeFor(hip, new THREE.Vector3(0, -1, 0), 0.4, 0.4, new THREE.Vector3(0, 0, 1), knee);
    expect(reached.distanceTo(hip)).toBeCloseTo(0.8, 3);
    expect(knee.distanceTo(hip)).toBeCloseTo(0.4, 6);
    expect(knee.distanceTo(reached)).toBeCloseTo(0.4, 6);
  });
});

describe('B: stepping off and back on', () => {
  const on: Look = { ...DEFAULT_LOOK, ride: 'skateboard' };
  const off: Look = { ...DEFAULT_LOOK };

  it('steps off whatever you ride', () => {
    expect(toggledRide(on, ['skateboard'], null)?.ride).toBeUndefined();
  });

  it('steps back onto the last ride, if it is still yours', () => {
    expect(toggledRide(off, ['skateboard', 'segway'], 'segway')?.ride).toBe('segway');
    expect(toggledRide(off, ['skateboard'], 'segway')?.ride).toBe('skateboard');
  });

  it('takes the first ride you own when none is remembered, and nothing when you own none', () => {
    expect(toggledRide(off, ['gold-watch', 'hoverboard'], null)?.ride).toBe('hoverboard');
    expect(toggledRide(off, ['gold-watch'], null)).toBeNull();
    expect(toggledRide(off, [], 'skateboard')).toBeNull();
  });

  it('trusts the remembered ride when the profile does not list what you own (the server checks)', () => {
    expect(toggledRide(off, undefined, 'e-scooter')?.ride).toBe('e-scooter');
    expect(toggledRide(off, undefined, 'cuban-link')).toBeNull();
  });

  it('leaves everything else in the look alone', () => {
    const dressed: Look = { ...on, chain: 'cuban-link', hat: 'top-hat' };
    const next = toggledRide(dressed, ['skateboard'], null)!;
    expect(next.chain).toBe('cuban-link');
    expect(next.hat).toBe('top-hat');
    expect(dressed.ride).toBe('skateboard');
  });
});
