import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { footprintOf, landing, spotPrint, type Footprint } from '../src/table/celebrate.ts';

// The celebration light's placement: where the ring goes for cards, hands, chips and an upright
// sector, and where the chip shower may land. Cards here are the kit's size (63.5 x 88.9 mm,
// 0.4 mm thick) as plain boxes, face up at rotation.x 0.

const W = 0.0635;
const H = 0.0889;
const T = 0.0004;
const FELT = 0.76;

function table(): { root: THREE.Group; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const camera = new THREE.PerspectiveCamera(55, 1.6, 0.05, 200);
  camera.position.set(0, 1.6, 1.2);
  camera.lookAt(0, FELT, 0);
  scene.add(camera);
  scene.updateMatrixWorld(true);
  return { root, camera };
}

function card(root: THREE.Object3D, x: number, z: number, opts: { yaw?: number; down?: boolean; scale?: number } = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(W, T, H));
  m.scale.setScalar(opts.scale ?? 1);
  m.position.set(x, FELT + 0.001, z);
  m.rotation.set(opts.down ? Math.PI : 0, opts.yaw ?? 0, 0, 'YXZ');
  root.add(m);
  return m;
}

const close = (a: number, b: number, eps = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('celebration rings', () => {
  it('ring a card lying flat in the felt plane, the card size, between its two faces', () => {
    for (const down of [false, true]) {
      const { root, camera } = table();
      card(root, 0.1, -0.2, { down });
      const f = footprintOf(root, camera, [root.children[0]!])!;
      close(f.n.y, 1);
      close(f.centre.x, 0.1);
      close(f.centre.z, -0.2);
      close(f.a, W / 2);
      close(f.b, H / 2);
      expect(f.solid).toBe(true);
      expect(f.round).toBe(false);
      // under the card's top face (what the camera sees), above its bottom one
      expect(f.centre.y).toBeLessThan(FELT + 0.001 + T / 2);
      expect(f.centre.y).toBeGreaterThan(FELT + 0.001 - T / 2);
    }
  });

  it('square the ring to a card dealt at an angle, not to its box on the table', () => {
    const { root, camera } = table();
    card(root, 0, 0, { yaw: 0.5 });
    const f = footprintOf(root, camera, [root.children[0]!])!;
    close(Math.abs(f.u.x * Math.cos(0.5) - f.u.z * Math.sin(0.5)), 1);
    close(f.a, W / 2);
    close(f.b, H / 2);
  });

  it('measure in the table’s own space, so a station turned on the floor rings the same', () => {
    const { root, camera } = table();
    root.position.set(12, 0, -7);
    root.rotation.y = 1.1;
    root.updateMatrixWorld(true);
    card(root, 0.05, 0.1);
    const f = footprintOf(root, camera, [root.children[0]!])!;
    close(f.a, W / 2);
    close(f.b, H / 2);
    close(f.centre.x, 0.05);
    close(f.centre.z, 0.1);
  });

  it('one ring round a hand passed together, sized to cover both cards', () => {
    const { root, camera } = table();
    const a = card(root, -0.035, 0);
    const b = card(root, 0.035, 0);
    const f = footprintOf(root, camera, [a, b])!;
    close(f.a, 0.035 + W / 2);
    close(f.b, H / 2);
    close(f.centre.x, 0);
  });

  it('a scaled card (the Hold’em board) rings at its drawn size', () => {
    const { root, camera } = table();
    card(root, 0, 0, { scale: 1.6 });
    const f = footprintOf(root, camera, [root.children[0]!])!;
    close(f.a, (W * 1.6) / 2);
    close(f.b, (H * 1.6) / 2);
  });

  it('a chip pile gets a round ring just above the felt', () => {
    const { root, camera } = table();
    const pile = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.0197, 0.0197, 0.0033, 24));
      chip.position.y = 0.00165 + i * 0.0033;
      pile.add(chip);
    }
    pile.position.set(0.2, FELT, 0.1);
    root.add(pile);
    const f = footprintOf(root, camera, [pile])!;
    expect(f.round).toBe(true);
    close(f.a, 0.0197);
    expect(f.centre.y).toBeGreaterThan(FELT);
    expect(f.centre.y).toBeLessThan(FELT + 0.001);
  });

  it('a flat thing standing up (a lit sector on a wheel) is ringed in its own plane, behind it', () => {
    const { root, camera } = table();
    camera.position.set(0, 1.5, 2.5);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld(true);
    const sector = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.2));
    sector.position.set(0, 1.6, 0.3);
    root.add(sector);
    const f = footprintOf(root, camera, [sector])!;
    close(Math.abs(f.n.z), 1);
    // on the wheel side of it, away from the camera
    expect(f.centre.z).toBeLessThan(0.3);
    expect(f.centre.z).toBeGreaterThan(0.299);
    close(Math.max(f.a, f.b), 0.1);
  });

  it('a printed spot is an outline on the felt at its own size', () => {
    const f = spotPrint({ x: 0.3, y: FELT, z: -0.1, w: 0.12, d: 0.08 });
    expect(f.solid).toBe(false);
    close(f.a, 0.06);
    close(f.b, 0.04);
    expect(f.centre.y).toBeGreaterThan(FELT);
    const round = spotPrint({ x: 0, y: FELT, z: 0, w: 0.1, d: 0.3, round: true });
    expect(round.round).toBe(true);
    close(round.b, 0.05);
  });

  it('the chip shower never lands on the lit cards', () => {
    const { root, camera } = table();
    const hand = [card(root, -0.035, 0.3), card(root, 0.035, 0.3), card(root, 0, 0.36)];
    const lit = [footprintOf(root, camera, hand)!];
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // aimed at the middle of the hand, the worst case, and beside it
    for (const at of [new THREE.Vector3(0, FELT, 0.32), new THREE.Vector3(0.2, FELT, 0.3)]) {
      for (let i = 0; i < 500; i++) {
        const [x, z] = landing(at, lit, random);
        const f: Footprint = lit[0]!;
        const dx = x - f.centre.x;
        const dz = z - f.centre.z;
        const inside = Math.abs(dx * f.u.x + dz * f.u.z) < f.a + 0.0197 && Math.abs(dx * f.v.x + dz * f.v.z) < f.b + 0.0197;
        expect(inside).toBe(false);
        // and still round the point it was thrown at
        expect(Math.hypot(x - at.x, z - at.z)).toBeLessThan(0.6);
      }
    }
  });
});
