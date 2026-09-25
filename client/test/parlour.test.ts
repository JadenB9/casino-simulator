import { describe, it, expect } from 'vitest';
import { fly, flightAt, flightSeconds, FlightPools, PINS, BALL_R, PIN_R, CENTRE, RAIL_R, HESO, TULIPS, OUT_V, bucketOf, straightDrop, type Catch } from '../src/games/pachinko/board.ts';
import { FOOTPRINT, SEATS, seatPositions, seatSpot, seatPose, ROW_Z, TABLE, STAGE_Z1 } from '../src/games/bingo/layout.ts';
import { patternCells } from '../src/games/bingo/cards.ts';
import { dealCard, drawOrder, callNumbers, completions, hasPattern, LINES, CORNERS } from '../../shared/src/games/bingo/rules.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';

describe('pachinko board', () => {
  it("leaves every gap between the field's nails wider than a ball (the pockets' own nails are their walls)", () => {
    const pockets = [HESO, ...TULIPS];
    const field = PINS.filter((p) => pockets.every((k) => Math.hypot(p.u - k.u, p.v - k.v) > 0.05));
    expect(field.length).toBeGreaterThan(200);
    for (let i = 0; i < field.length; i++) {
      for (let j = i + 1; j < field.length; j++) {
        const d = Math.hypot(field[i]!.u - field[j]!.u, field[i]!.v - field[j]!.v);
        expect(d - 2 * PIN_R).toBeGreaterThan(2 * BALL_R);
      }
    }
    for (const p of PINS) expect(Math.hypot(p.u - CENTRE.u, p.v - CENTRE.v)).toBeLessThan(RAIL_R);
  });

  it('flies the same flight from the same seed, and ends it where it says', () => {
    for (let seed = 1; seed < 40; seed++) {
      const a = fly(40, seed);
      const b = fly(40, seed);
      expect(a?.end).toBe(b?.end);
      expect(a?.frames).toBe(b?.frames);
      if (!a) continue;
      const end = flightAt(a, flightSeconds(a), { u: 0, v: 0 });
      if (a.end === 'start') expect(Math.abs(end.u - HESO.u)).toBeLessThan(HESO.w + 0.002);
      if (a.end === 'left') expect(Math.abs(end.u - TULIPS[0].u)).toBeLessThan(TULIPS[0].w + 0.002);
      if (a.end === 'right') expect(Math.abs(end.u - TULIPS[1].u)).toBeLessThan(TULIPS[1].w + 0.002);
      if (a.end === 'out') expect(end.v).toBeLessThan(OUT_V + 0.02);
      // never outside the rail
      for (let f = 0; f < a.frames; f++) expect(Math.hypot(a.pts[f * 2]! - CENTRE.u, a.pts[f * 2 + 1]! - CENTRE.v)).toBeLessThan(RAIL_R);
    }
  });

  it('finds a flight into every pocket at every power, and the attacker in a fever', () => {
    const pools = new FlightPools(7);
    for (const power of [0, 25, 50, 75, 100]) {
      for (const end of ['start', 'left', 'right', 'out'] as Catch[]) {
        const f = pools.take(power, end);
        expect(f.end).toBe(end);
        expect(f.frames).toBeGreaterThan(20);
      }
    }
    expect(pools.take(95, 'attacker').end).toBe('attacker');
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(100)).toBe(10);
  });

  it('keeps a straight drop as the last resort into any pocket', () => {
    for (const end of ['start', 'left', 'right', 'out', 'attacker'] as Catch[]) expect(straightDrop(end).end).toBe(end);
  });
});

describe('bingo hall layout', () => {
  it('seats forty at four tables, every chair inside the footprint and behind its table', () => {
    const seats = seatPositions();
    expect(seats).toHaveLength(SEATS);
    expect(SEATS).toBe(40);
    for (let i = 0; i < SEATS; i++) {
      const s = seatSpot(i);
      expect(Math.abs(s.x)).toBeLessThan(FOOTPRINT.width / 2 - 0.2);
      expect(Math.abs(s.z)).toBeLessThan(FOOTPRINT.depth / 2);
      expect(s.z).toBeGreaterThan(ROW_Z[s.row]! + TABLE.d / 2);
      expect(seats[i]!.yaw).toBe(Math.PI);
      // looking toward the stage from above the table
      const p = seatPose(i);
      expect(p.target[2]).toBeLessThan(p.position[2]);
    }
    expect(ROW_Z[0]! - TABLE.d / 2).toBeGreaterThan(STAGE_Z1);
  });

  it('rings the cells of the pattern a card completed', () => {
    const rng = seededRng(4);
    for (let g = 0; g < 200; g++) {
      const card = dealCard(rng);
      const order = drawOrder(rng);
      const done = completions(card, callNumbers(order));
      const called = new Set(order.slice(0, done.line));
      const cells = patternCells(card, called, 'line');
      expect(cells.length).toBeGreaterThanOrEqual(5);
      expect(LINES.some((l) => l.every((c) => cells.includes(c)))).toBe(true);
      expect(hasPattern(card, called, 'line')).toBe(true);
      expect(patternCells(card, called, 'corners')).toEqual([...CORNERS]);
    }
  });
});
