// Who of the other players gets drawn: out of view means hidden and not animated (but still there
// for the staff), a crowd bigger than MAX_DRAWN shows its nearest without flickering at the edge,
// and everyone drawn shares one instanced shadow.

import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Character, CharacterFactory } from '../src/world/contract.ts';
import type { FloorLink } from '../src/net/presence.ts';
import { DEFAULT_LOOK } from '../../shared/src/look.ts';

// net/api.ts (under net/presence.ts) reads a constant Vite defines at build time.
(globalThis as Record<string, unknown>).__API_ORIGIN__ = '';
let MAX_DRAWN = 0;
let RemotePlayers: typeof import('../src/world/remote-players.ts').RemotePlayers;
beforeAll(async () => {
  ({ MAX_DRAWN, RemotePlayers } = await import('../src/world/remote-players.ts'));
});

class Figure implements Character {
  root = new THREE.Group();
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  updates = 0;
  constructor() {
    this.root.add(this.shadow);
  }
  setLook(): void {}
  setMotion(): void {}
  setName(): void {}
  update(): void {
    this.updates++;
  }
  dispose(): void {}
}

const factory: CharacterFactory & { made: Figure[] } = {
  made: [],
  create() {
    const f = new Figure();
    this.made.push(f);
    return f;
  },
};

/** A floor link with players standing still at the given spots (metres). */
function link(spots: [number, number][]): FloorLink {
  const players = new Map(
    spots.map(([x, z], i) => [
      i + 1,
      { info: { id: i + 1, name: `p${i + 1}`, look: DEFAULT_LOOK, at: null }, track: { at: () => ({ x: x * 100, z: z * 100, r: 0, moving: false }) } },
    ]),
  );
  return { players, on: () => () => {} } as unknown as FloorLink;
}

function crowd(spots: [number, number][], inView: (x: number, z: number) => boolean = () => true) {
  factory.made.length = 0;
  const scene = new THREE.Scene();
  const shadow = { geometry: new THREE.PlaneGeometry(1, 1), material: new THREE.MeshBasicMaterial() };
  const eye = { x: 0, z: 0 };
  const remotes = new RemotePlayers(link(spots), scene, { factory, inView, eye: () => eye, shadow });
  const shadows = () => remotes.group.children.find((o) => o.name === 'remote-shadows') as THREE.InstancedMesh | undefined;
  return { remotes, figures: [...factory.made], eye, shadows };
}

describe('RemotePlayers', () => {
  it('leaves out anyone the camera cannot see, but keeps them there for the staff', () => {
    const { remotes, figures } = crowd([[2, 0], [-2, 0]], (x) => x > 0);
    remotes.update(1 / 60);
    const [seen, unseen] = figures;
    expect(seen!.root.visible).toBe(true);
    expect(seen!.updates).toBe(1);
    expect(unseen!.root.visible).toBe(false);
    expect(unseen!.updates).toBe(0);
    expect(unseen!.root.userData.offscreen).toBe(true);
    expect(seen!.root.userData.offscreen).toBe(false);
  });

  it('draws the nearest MAX_DRAWN of a bigger crowd in view', () => {
    const spots: [number, number][] = Array.from({ length: MAX_DRAWN + 10 }, (_, i) => [i + 1, 0]);
    const { remotes, figures } = crowd(spots);
    remotes.update(1 / 60);
    const drawn = figures.filter((f) => f.root.visible);
    expect(drawn.length).toBe(MAX_DRAWN);
    // the nearest (x = 1 .. MAX_DRAWN) are the ones drawn; the rest are there but not drawn
    expect(figures.slice(0, MAX_DRAWN).every((f) => f.root.visible)).toBe(true);
    expect(figures.slice(MAX_DRAWN).every((f) => !f.root.visible && f.root.userData.offscreen === true)).toBe(true);
  });

  it('keeps drawing someone at the edge of the crowd until another is clearly nearer', () => {
    // MAX_DRAWN - 1 people by the camera, then A 5 m east and B 5.4 m west: A is the last one drawn
    const spots: [number, number][] = Array.from({ length: MAX_DRAWN - 1 }, (_, i) => [0, 0.1 + i * 0.01]);
    spots.push([5, 0], [-5.4, 0]);
    const { remotes, figures, eye } = crowd(spots);
    const a = figures[MAX_DRAWN - 1]!;
    const b = figures[MAX_DRAWN]!;
    remotes.update(1 / 60);
    expect([a.root.visible, b.root.visible]).toEqual([true, false]);
    // B a fifth of a metre nearer than A now: A stays
    eye.x = -0.3;
    remotes.update(1 / 60);
    expect([a.root.visible, b.root.visible]).toEqual([true, false]);
    // B clearly nearer: they swap
    eye.x = -1.5;
    remotes.update(1 / 60);
    expect([a.root.visible, b.root.visible]).toEqual([false, true]);
  });

  it('draws everyone shown with one instanced shadow and hides their own', () => {
    const { remotes, figures, shadows } = crowd([[1, 0], [2, 0], [-3, 0]], (x) => x > 0);
    remotes.update(1 / 60);
    const inst = shadows();
    expect(inst).toBeDefined();
    expect(inst!.count).toBe(2);
    expect(figures.every((f) => !f.shadow.visible || !f.root.visible)).toBe(true);
    const m = new THREE.Matrix4();
    inst!.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(2);
  });

  it('grows the shadows for a crowd without losing the ones already written', () => {
    const spots: [number, number][] = Array.from({ length: 30 }, (_, i) => [i + 1, 0]);
    const { remotes, shadows } = crowd(spots);
    remotes.update(1 / 60);
    const inst = shadows()!;
    expect(inst.count).toBe(30);
    const m = new THREE.Matrix4();
    for (const k of [0, 15, 29]) {
      inst.getMatrixAt(k, m);
      expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(k + 1);
    }
  });
});
