// What an emote puts in the hands: a fan of hundreds (moneyfan) and a gold cup (trophy). Each is
// one merged mesh, its geometry and material shared by everyone holding one at the moment and let
// go when the last of them puts it down. Person (characters.ts) places it in hand every frame.
//
// A prop is built in its own frame: the bills fan up +y from the grip at the origin, their faces
// toward +z (the palm's way); the cup stands on +y with its two handles on the x axis at the
// origin, where the hands hold it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropId } from './gestures.ts';

interface Kit {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  map: THREE.Texture | null;
  users: number;
}

const kits = new Map<PropId, Kit>();

/** A new mesh of the prop (sharing its geometry and material with any others out). */
export function propMesh(id: PropId): THREE.Mesh {
  let kit = kits.get(id);
  if (!kit) {
    kit = id === 'bills' ? bills() : trophy();
    kits.set(id, kit);
  }
  kit.users++;
  const mesh = new THREE.Mesh(kit.geometry, kit.material);
  mesh.name = `prop-${id}`;
  // it moves every frame with the hand, and is small: never cull it on its own bounds
  mesh.frustumCulled = false;
  mesh.userData.prop = id;
  return mesh;
}

/** Put a prop down: out of the scene, and its geometry and material freed when nobody holds one. */
export function disposeProp(mesh: THREE.Mesh): void {
  mesh.removeFromParent();
  const id = mesh.userData.prop as PropId | undefined;
  const kit = id ? kits.get(id) : undefined;
  if (!kit || --kit.users > 0) return;
  kit.geometry.dispose();
  kit.material.dispose();
  kit.map?.dispose();
  kits.delete(id!);
}

/** How many kinds of prop are built and held right now (for tests and the perf page). */
export function propsOut(): number {
  return kits.size;
}

// --- a fan of hundreds -------------------------------------------------------------------------

/** A bill: 15.6 by 6.6 cm, standing on its short edge. */
const BILL_W = 0.066;
const BILL_H = 0.156;
const BILLS = 9;
/** Drawn a little over life size, like everything the players hold (their hands are big too). */
const BILL_SCALE = 1.2;
/** The fan's spread, radians either side of straight up. */
const SPREAD = 0.95;

function bills(): Kit {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < BILLS; i++) {
    const g = new THREE.PlaneGeometry(BILL_W, BILL_H);
    // held a third of the way up, fanned about the grip, each a paper's thickness over the last
    // (never in the same plane: no flicker where they overlap)
    g.translate(0, BILL_H / 2 - 0.035, 0);
    g.rotateZ(SPREAD - (2 * SPREAD * i) / (BILLS - 1));
    g.translate(0, 0, i * 0.0016);
    parts.push(g);
  }
  const geometry = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  geometry.scale(BILL_SCALE, BILL_SCALE, 1);
  const map = billTexture();
  const material = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  material.name = 'prop-bills';
  return { geometry, material, map, users: 0 };
}

/**
 * A hundred, drawn upright (the plane stands on its short edge): cream-green paper, a fine
 * border, a portrait oval, the big 100 and the corner numbers. Not a copy of any real note.
 */
function billTexture(): THREE.Texture {
  const W = 128;
  const H = 304;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#d9dcc4';
  x.fillRect(0, 0, W, H);
  // a faint wash toward the ends
  const wash = x.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, 'rgba(120,150,110,0.25)');
  wash.addColorStop(0.5, 'rgba(120,150,110,0)');
  wash.addColorStop(1, 'rgba(120,150,110,0.25)');
  x.fillStyle = wash;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = '#3f5a3c';
  x.lineWidth = 5;
  x.strokeRect(6, 6, W - 12, H - 12);
  x.lineWidth = 1.5;
  x.strokeRect(13, 13, W - 26, H - 26);
  // the portrait: an oval frame with a head and shoulders in it
  x.fillStyle = '#c4c8ab';
  x.beginPath();
  x.ellipse(W / 2, H / 2, 38, 52, 0, 0, Math.PI * 2);
  x.fill();
  x.lineWidth = 3;
  x.stroke();
  x.fillStyle = '#5d735a';
  x.beginPath();
  x.ellipse(W / 2, H / 2 - 12, 16, 20, 0, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.ellipse(W / 2, H / 2 + 32, 30, 18, 0, Math.PI, 0);
  x.fill();
  // the numbers, turned to read along the note
  x.fillStyle = '#2f4a2e';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const text = (s: string, px: number, cx: number, cy: number) => {
    x.save();
    x.translate(cx, cy);
    x.rotate(-Math.PI / 2);
    x.font = `700 ${px}px Georgia, 'Times New Roman', serif`;
    x.fillText(s, 0, 0);
    x.restore();
  };
  text('100', 34, W / 2, 50);
  text('100', 34, W / 2, H - 50);
  text('100', 16, 26, H / 2 - 90);
  text('100', 16, W - 26, H / 2 + 90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// --- the cup -----------------------------------------------------------------------------------

/** Where the handles are on the cup (its origin is between them). */
const HANDLE_Y = 0.24;

function trophy(): Kit {
  // radius, height (metres), from the foot up the outside and down into the bowl
  const profile: [number, number][] = [
    [0.001, 0],
    [0.068, 0],
    [0.068, 0.022],
    [0.058, 0.03],
    [0.03, 0.046],
    [0.017, 0.07],
    [0.016, 0.1],
    [0.031, 0.112],
    [0.017, 0.124],
    [0.022, 0.142],
    [0.045, 0.156],
    [0.078, 0.192],
    [0.096, 0.25],
    [0.101, 0.302],
    [0.106, 0.312],
    [0.097, 0.313],
    [0.09, 0.295],
    [0.072, 0.205],
    [0.001, 0.172],
  ];
  const cup = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    40,
  );
  const handle = (side: 1 | -1) => {
    const g = new THREE.TorusGeometry(0.05, 0.009, 8, 20, Math.PI);
    g.rotateZ(-side * (Math.PI / 2));
    g.translate(side * 0.088, HANDLE_Y, 0);
    return g;
  };
  const parts = [cup, handle(1), handle(-1)];
  const geometry = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  geometry.translate(0, -HANDLE_Y, 0);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.74, 0.3), metalness: 1, roughness: 0.24, envMapIntensity: 2.4, emissive: new THREE.Color(0.16, 0.1, 0.02) });
  material.name = 'prop-trophy';
  return { geometry, material, map: null, users: 0 };
}
