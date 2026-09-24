// What the wheel's chrome, steel and lacquer reflect. The room's own environment is a bright
// neutral studio, which turns polished metal into grey plastic; this is a small dim casino
// instead: a dark room with warm downlights across the ceiling, the lamp over the table, the
// felt and the bowl's own wood close round the wheel, and a few warm glows at the walls. It is
// prefiltered once, with the renderer that first draws a wheel, and shared by every wheel.

import * as THREE from 'three';

let env: THREE.Texture | null = null;
let started = false;
const users = new Map<THREE.MeshStandardMaterial, number>();

function give(m: THREE.MeshStandardMaterial, strength: number): void {
  m.envMap = env;
  m.envMapIntensity = strength;
  m.needsUpdate = true;
}

/** These materials reflect the casino, at these strengths, from the moment it exists. */
export function reflectCasino(entries: [THREE.MeshStandardMaterial, number][]): void {
  for (const [m, k] of entries) {
    users.set(m, k);
    if (env) give(m, k);
  }
}

/**
 * Build the casino the first time anything drawn in `material` is drawn (the live wheel or the
 * floor's far stand-in, which shares its materials), once that frame is done.
 */
export function buildOnFirstDraw(material: THREE.Material): void {
  material.onBeforeRender = (renderer) => {
    if (started) return;
    started = true;
    queueMicrotask(() => {
      env = casino(renderer);
      for (const [m, k] of users) give(m, k);
    });
  };
}

function basic(r: number, g: number, b: number, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side, toneMapped: false });
}

function casino(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  // the room: dark warm walls, a darker ceiling, red carpet 0.78 m below the wheel's base
  const room = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 14), basic(0.045, 0.03, 0.02, THREE.BackSide));
  room.position.y = 1.7;
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), basic(0.07, 0.012, 0.012));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = -0.77;
  scene.add(room, carpet);

  // downlights across the ceiling, not quite in rows (a perfect grid reads as a disco ball in
  // the turret), and a few chandeliers hanging lower
  const spot = new THREE.CircleGeometry(0.11, 20).rotateX(Math.PI / 2);
  const lights: THREE.Matrix4[] = [];
  let seed = 11;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let x = -6; x <= 6; x += 1.1) {
    for (let z = -6; z <= 6; z += 1.1) {
      if (rand() < 0.3) continue;
      const k = 0.6 + 0.8 * rand();
      lights.push(new THREE.Matrix4().makeScale(k, 1, k).setPosition(x + 0.6 * (rand() - 0.5), 2.35 - 0.3 * rand(), z + 0.6 * (rand() - 0.5)));
    }
  }
  const downlights = new THREE.InstancedMesh(spot, basic(6, 4.6, 3), lights.length);
  lights.forEach((m, i) => downlights.setMatrixAt(i, m));
  scene.add(downlights);
  for (const [x, z] of [
    [3.2, 2.5],
    [-3, 2.8],
    [2.6, -3.2],
    [-3.4, -2.6],
  ]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), basic(2.6, 2, 1.25));
    c.position.set(x!, 1.8, z!);
    scene.add(c);
  }
  // the glow of slot banks and signs all round at eye height
  const band = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 1.1, 48, 1, true), basic(0.3, 0.19, 0.09, THREE.BackSide));
  band.position.y = 0.7;
  scene.add(band);

  // the lamp over the table: a broad soft panel, and its brass hood's warm rim
  const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.55).rotateX(Math.PI / 2), basic(2.2, 1.7, 1.15));
  lamp.position.set(0.5, 1.75, 0.1);
  scene.add(lamp);

  // round the wheel: the bowl's own dark wood, then the table's felt
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.07, 48, 1, true), basic(0.1, 0.028, 0.012, THREE.DoubleSide));
  bowl.position.y = 0.045;
  const felt = new THREE.Mesh(new THREE.RingGeometry(0.45, 1.8, 48).rotateX(-Math.PI / 2), basic(0.012, 0.055, 0.03));
  felt.position.y = -0.005;
  scene.add(bowl, felt);

  // warm glows at the walls: slot banks, a sign, a bar
  const glows: [number, number, number, number, number, number, THREE.Color][] = [
    [6.9, 0.5, 1.5, 0.1, 0.5, 2.5, new THREE.Color(1.6, 1.0, 0.35)],
    [-6.9, 0.8, -2, 0.1, 0.35, 3, new THREE.Color(1.4, 0.25, 0.12)],
    [1.5, 0.6, 6.9, 3, 0.4, 0.1, new THREE.Color(1.3, 0.9, 0.45)],
    [-2.5, 1.4, -6.9, 2.2, 0.25, 0.1, new THREE.Color(1.8, 1.25, 0.5)],
  ];
  for (const [x, y, z, w, h, d, c] of glows) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    m.position.set(x, y, z);
    scene.add(m);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const out = pmrem.fromScene(scene, 0.015, 0.05, 30, { position: new THREE.Vector3(0, 0.06, 0) }).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return out;
}
