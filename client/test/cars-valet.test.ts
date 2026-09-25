// The curb as a client sees it: a called car comes in on the server's clock, stands in the way
// while it waits, and leaves; a second car of yours takes the first one's place and the first
// drives off; the list after hello replaces what was there.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ARRIVE_MS, CURB_MS, type CarCall } from '../../shared/src/valet.ts';
import { Collider } from '../src/world/collision.ts';
import { CarMaterials } from '../src/world/cars/materials.ts';
import { Valet } from '../src/world/cars/valet.ts';

function fakeCharacter() {
  return { root: new THREE.Group(), setLook() {}, setMotion() {}, setName() {}, update() {}, dispose() {}, gesture() {} };
}

function curb(me = 1) {
  let now = 1_000_000;
  const col = new Collider();
  const keys: CarCall[] = [];
  const valet = new Valet({
    mats: new CarMaterials('low', null),
    characters: { create: fakeCharacter, load: async () => {} },
    col,
    now: () => now,
    me: () => me,
    player: new THREE.Vector3(128.2, 0, 4.4),
    onUse() {},
    onKeys: (c) => keys.push(c),
  });
  const at = (t: number) => (now = t);
  const run = (to: number, step = 100) => {
    while (now < to) {
      now += step;
      valet.update(step / 1000, true);
    }
  };
  return { valet, col, keys, at, run, get now() {
    return now;
  } };
}

const call = (id: number, car: string, at: number, slot = 0): CarCall => ({ id, name: `p${id}`, car, slot, at, until: at + CURB_MS });

describe('the curb, client side', () => {
  it('brings a car in, hands you the keys, holds the walker off it at the curb, and lets it go', () => {
    const c = curb();
    const boxes = c.col.boxes.length;
    const mine = call(1, 'stallard-440', c.now);
    c.valet.hear(mine);
    expect(c.valet.mine()).toEqual(mine);
    c.run(mine.at + ARRIVE_MS + 4000);
    expect(c.keys).toEqual([mine]);
    expect(c.col.boxes.length).toBe(boxes + 1);
    // sent back: it drives off, the curb is clear again, and it's gone for good after a while
    c.valet.hear({ ...mine, until: c.now });
    expect(c.valet.mine()).toBeNull();
    c.run(c.now + 500);
    expect(c.col.boxes.length).toBe(boxes);
    c.run(c.now + 15_000);
    expect(c.valet.group.children.filter((o) => o.type === 'Group' && o.children.length > 3)).toHaveLength(0);
  });

  it('swaps your car: the new one comes, the old one drives off; a repeat is the same call', () => {
    const c = curb();
    const first = call(1, 'stallard-440', c.now);
    c.valet.hear(first);
    c.run(first.at + 20_000);
    const second = call(1, 'ombra-oro', c.now);
    c.valet.hear(second);
    c.valet.hear(second);
    expect(c.valet.mine()).toEqual(second);
    // (a car is a group of meshes and wheels; the valets are characters)
    const rigs = () => c.valet.group.children.filter((o) => o.children.length > 3).length;
    expect(rigs()).toBe(2);
    c.run(c.now + 13_000);
    expect(rigs()).toBe(1);
  });

  it("takes the floor's list after hello as what's at the curb", () => {
    const c = curb();
    c.valet.hear(call(2, 'brenner-rally', c.now, 1));
    c.valet.all([call(3, 'halden-roadster', c.now, 2)]);
    expect(c.valet.mine()).toBeNull();
    // someone else's car: no keys for you
    c.run(c.now + ARRIVE_MS + 6000);
    expect(c.keys).toEqual([]);
    // a send-back for a car never seen is nothing
    const before = c.valet.group.children.length;
    c.valet.hear({ ...call(4, 'ombra-hyper', c.now - 5000), until: c.now - 1 });
    expect(c.valet.group.children.length).toBe(before);
  });
});
