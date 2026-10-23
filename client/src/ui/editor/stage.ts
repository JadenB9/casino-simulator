// The editor's dressing room: a leather podium with a brass edge in a pool of warm light, a dim
// room behind with the casino's lights far off and out of focus, a soft halo behind the figure to
// lift it off the dark, and a contact shadow under its feet (the renderer draws no shadow maps).
// Three lights in the photographer's way: a warm key high on the right, a cool rim from behind on
// the left that draws the silhouette, a low fill so the face never goes black, and a warm kicker
// from behind on the right. Every light has a short reach: the room is built far below the floor
// and none of it ever touches the casino above.

import * as THREE from 'three';

export const PODIUM_TOP = 0.07;

export interface DressingRoom {
  group: THREE.Group;
  /** Turns with the drag; the character stands on it. */
  pivot: THREE.Group;
  dispose(): void;
}

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A disc of `rgb` fading from `alpha` at the middle to nothing at the edge. */
function radial(size: number, rgb: string, stops: readonly [number, number][]): THREE.CanvasTexture {
  return canvasTexture(size, size, (g) => {
    const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, a] of stops) r.addColorStop(at, `rgba(${rgb},${a})`);
    g.fillStyle = r;
    g.fillRect(0, 0, size, size);
  });
}

export function dressingRoom(at: THREE.Vector3): DressingRoom {
  const group = new THREE.Group();
  group.name = 'dressing-room';
  group.position.copy(at);

  // the floor: the key light's pool on dark carpet
  const floorTex = canvasTexture(512, 512, (g) => {
    const r = g.createRadialGradient(256, 262, 0, 256, 256, 256);
    r.addColorStop(0, '#4a3324');
    r.addColorStop(0.14, '#33231a');
    r.addColorStop(0.42, '#160f0b');
    r.addColorStop(0.75, '#0a0706');
    r.addColorStop(1, '#060404');
    g.fillStyle = r;
    g.fillRect(0, 0, 512, 512);
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshBasicMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // the room: dark walls, a warm glow along the horizon, the casino's lights far off in two depths
  const wallTex = canvasTexture(1024, 512, (g) => {
    const v = g.createLinearGradient(0, 0, 0, 512);
    v.addColorStop(0, '#030202');
    v.addColorStop(0.38, '#110c09');
    v.addColorStop(0.5, '#21170f');
    v.addColorStop(0.6, '#0e0a08');
    v.addColorStop(1, '#040303');
    g.fillStyle = v;
    g.fillRect(0, 0, 1024, 512);
    g.globalCompositeOperation = 'lighter';
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // far lights small and many, nearer ones larger and fainter
    for (let i = 0; i < 110; i++) {
      const near = i >= 80;
      const x = rnd() * 1024;
      const y = near ? 150 + rnd() * 170 : 206 + rnd() * 74;
      const rad = near ? 18 + rnd() * 26 : 3 + rnd() * 12;
      const warm = rnd() < 0.78;
      const col = warm ? (rnd() < 0.5 ? '255,200,130' : '255,222,170') : rnd() < 0.5 ? '255,110,95' : '110,210,200';
      const a = near ? 0.03 + rnd() * 0.05 : 0.05 + rnd() * 0.15;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${col},${a})`);
      gr.addColorStop(0.7, `rgba(${col},${a * 0.7})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
  });
  const wall = new THREE.Mesh(new THREE.SphereGeometry(9, 48, 24), new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide }));
  wall.position.y = 1.2;
  group.add(wall);

  // a warm glow behind the figure (the camera only ever looks at it from the front)
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({ map: radial(256, '255,196,128', [[0, 0.3], [0.35, 0.16], [0.7, 0.04], [1, 0]]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  halo.position.set(0, 1.25, -1.7);
  group.add(halo);

  const leather = new THREE.MeshStandardMaterial({ color: '#1d140e', roughness: 0.5 });
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.64, PODIUM_TOP, 64), leather);
  podium.position.y = PODIUM_TOP / 2;
  // the top catches the key light: a sheen toward the front right
  const topTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#2a1c14';
    g.fillRect(0, 0, 256, 256);
    const r = g.createRadialGradient(150, 160, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(120,84,56,0.55)');
    r.addColorStop(1, 'rgba(120,84,56,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  });
  const inlay = new THREE.Mesh(new THREE.CircleGeometry(0.55, 64), new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.72 }));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = PODIUM_TOP + 0.0006;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.615, 0.008, 8, 128), new THREE.MeshStandardMaterial({ color: '#c9a24b', metalness: 0.9, roughness: 0.26 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = PODIUM_TOP;
  // the feet's contact shadow, a little longer front to back
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 48),
    new THREE.MeshBasicMaterial({ map: radial(128, '0,0,0', [[0, 0.62], [0.45, 0.34], [1, 0]]), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 1.25, 1);
  shadow.position.y = PODIUM_TOP + 0.0012;
  group.add(podium, inlay, ring, shadow);

  // Lights with a short reach: 60 m down, they never touch the floor above.
  const key = new THREE.SpotLight('#ffe8cc', 30, 9, 0.55, 0.8, 1.4);
  key.position.set(1.5, 3.0, 2.3);
  key.target.position.set(0, 1.0, 0);
  const rim = new THREE.SpotLight('#d6e4ff', 34, 8, 0.6, 0.8, 1.4);
  rim.position.set(-1.7, 2.5, -1.9);
  rim.target.position.set(0, 1.25, 0);
  const kicker = new THREE.SpotLight('#ffc98f', 16, 8, 0.6, 0.85, 1.4);
  kicker.position.set(1.9, 1.9, -1.6);
  kicker.target.position.set(0, 1.1, 0);
  const fill = new THREE.PointLight('#f3e2cf', 7, 7, 1.6);
  fill.position.set(-1.9, 1.3, 2.4);
  // the floor's warm bounce under the chin and the hands
  const bounce = new THREE.PointLight('#c48a5a', 2.2, 4, 1.8);
  bounce.position.set(0.3, 0.25, 1.4);
  group.add(key, key.target, rim, rim.target, kicker, kicker.target, fill, bounce);

  const pivot = new THREE.Group();
  pivot.position.y = PODIUM_TOP;
  group.add(pivot);

  return {
    group,
    pivot,
    dispose() {
      group.removeFromParent();
      // The character is its owner's to dispose (the world's may share geometry between players).
      group.remove(pivot);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      });
    },
  };
}
