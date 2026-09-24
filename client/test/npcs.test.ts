// The floor staff's pure parts: who they are (never two alike, the same every visit), where a
// dealer stands behind a table's edge, turning toward someone, and which seats have a chair.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bodyFront, measureSeats, staffLooks, standBehind, turnToward, type StaffPost } from '../src/world/npcs.ts';
import type { WorldStation } from '../src/world/stations.ts';

const post = (role: StaffPost['role'], i: number): StaffPost => ({ role, station: role === 'bartender' || role === 'cashier' ? null : `t-${i}`, x: i, z: 0, yaw: 0 });

describe('staff looks', () => {
  const floor = [...Array.from({ length: 11 }, (_, i) => post('dealer', i)), post('stickman', 11), post('bartender', 12), post('cashier', 13)];

  it('never dresses two staff alike, up to 56 of them', () => {
    const many = Array.from({ length: 56 }, (_, i) => post('dealer', i));
    const keys = staffLooks(many).map(({ look, scale }) => `${look.skin}|${scale.toFixed(4)}`);
    expect(new Set(keys).size).toBe(many.length);
  });

  it('is the same crew on every visit', () => {
    expect(staffLooks(floor)).toEqual(staffLooks(floor));
  });

  it('puts each role in its uniform', () => {
    const looks = staffLooks(floor).map((x) => x.look);
    for (const [i, p] of floor.entries()) {
      const l = looks[i]!;
      if (p.role === 'cashier') expect(l.outfit).toBe('staff:blazer');
      else expect(l.outfit).toBe('staff:vest');
      if (p.role === 'dealer' || p.role === 'stickman') expect(l.top).toBe('#16171b');
    }
    expect(looks[12]!.top).not.toBe(looks[0]!.top);
  });

  it('keeps skin tones and heights in range', () => {
    for (const { look, scale } of staffLooks(floor)) {
      expect(look.skin).toBeGreaterThanOrEqual(0);
      expect(look.skin).toBeLessThan(8);
      expect(scale).toBeGreaterThan(0.9);
      expect(scale).toBeLessThan(1.1);
      expect(look.hair).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('where a dealer stands', () => {
  // A table 2 m wide whose dealer-side edge is at z = -0.5.
  const slab = (x: number, y: number) => (Math.abs(x) < 1 && y > 0.7 && y < 0.79 ? -0.5 : null);
  const cabinet = (x: number, y: number) => (Math.abs(x) < 1 && y < 0.79 ? -0.5 : null);
  const highRail = (x: number, y: number) => (Math.abs(x) < 1 && y < 1.07 ? -0.5 : null);

  it('clears a table top at thigh height', () => {
    expect(standBehind(slab, 0)).toBeCloseTo(-0.5 - bodyFront(0.75) - 0.04, 5);
  });

  it('leaves room for the toes against a solid cabinet', () => {
    expect(standBehind(cabinet, 0)).toBeCloseTo(-0.5 - bodyFront(0.05) - 0.04, 5);
  });

  it('stands further back from a rail at belly height (craps)', () => {
    expect(standBehind(highRail, 0)).toBeLessThan(standBehind(slab, 0));
  });

  it('only minds the table across the body, not beside it', () => {
    const narrow = (x: number, y: number) => (Math.abs(x - 2) < 0.2 && y < 1 ? 0.3 : null);
    expect(standBehind(narrow, 0)).toBe(-0.9);
  });
});

describe('turning toward someone', () => {
  it('measures the turn from the way they face', () => {
    expect(turnToward(0, 0, 0, 0, 5)).toBeCloseTo(0, 6);
    expect(turnToward(0, 0, 0, 5, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(turnToward(Math.PI, 0, 0, 5, 0)).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.abs(turnToward(Math.PI / 2, 1, 1, 1 - 3, 1))).toBeCloseTo(Math.PI, 6);
  });
});

describe('which seats have a chair', () => {
  function station(withChair: boolean, at: THREE.Vector3, yaw: number): WorldStation {
    const anchor = new THREE.Group();
    anchor.position.copy(at);
    anchor.rotation.y = yaw;
    const model = new THREE.Group();
    anchor.add(model);
    // a table top in the middle, and a chair (cushion top 0.48 m) at the one seat
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 1), new THREE.MeshBasicMaterial());
    top.position.y = 0.76;
    model.add(top);
    if (withChair) {
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.45), new THREE.MeshBasicMaterial());
      cushion.position.set(0, 0.44, 1.1);
      model.add(cushion);
    }
    return { id: 's', game: 'holdem', variant: '', anchor, model, footprint: { width: 2, depth: 1 }, zone: 'poker', name: '', limits: '', yaw } as WorldStation;
  }
  const seats = () => [{ position: [0, 0, 1.1] as [number, number, number] }];

  it('reads the cushion top where a chair stands', () => {
    const s = station(true, new THREE.Vector3(4, 0, -3), 0.7);
    measureSeats([s], seats);
    expect(s.seatTops).toHaveLength(1);
    expect(s.seatTops![0]).toBeCloseTo(0.48, 3);
  });

  it('leaves standing room standing', () => {
    const s = station(false, new THREE.Vector3(-2, 0, 5), Math.PI);
    measureSeats([s], seats);
    expect(s.seatTops).toEqual([null]);
  });
});
