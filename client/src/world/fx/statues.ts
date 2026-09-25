// The statues in the lobby: each buyer cast in gold as they looked when they bought it, fists up
// in a champion's V, a touch larger than life on a black marble plinth banded in brass, with their
// name engraved on a brass plaque on the front. The STATUES newest stand in the lobby's best places
// (scope.ts statueSpots, from the plan), and each one is solid: the walker and the camera go round.
//
// The figure is the player's own character, posed and skinned once on the CPU (Person.bake does
// the body; the pieces they wear are baked the same way) into one still mesh, so a statue costs
// four draw calls however detailed the outfit.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Statue } from '../../../../shared/src/items.ts';
import { STATUES } from '../../../../shared/src/items.ts';
import type { Look } from '../../../../shared/src/look.ts';
import type { Quality } from '../../render/engine3d.ts';
import type { Characters, Person } from '../characters.ts';
import type { Collider, Post } from '../collision.ts';
import type { FloorPlan } from '../layout.ts';
import type { Mats } from '../materials.ts';
import { PLINTH, STATUE_POST, statueSpots, type StatueSpot } from './scope.ts';

/** How much larger than life the figure is cast. */
const SCALE = 1.12;
/** The moment of the cheer the figure is frozen at: both fists up, feet on the ground. */
const POSE_T = 0.95;

interface Shown {
  key: string;
  group: THREE.Group;
  post: Post;
  own: THREE.BufferGeometry[];
  plaque: THREE.Material;
  texture: THREE.Texture;
}

export interface StatueDeps {
  characters: Characters;
  plan: FloorPlan;
  collider: Collider;
  mats: Mats;
  quality(): Quality;
  env(): THREE.Texture | null;
}

export class Statues {
  readonly group = new THREE.Group();
  readonly spots: StatueSpot[];
  private shown: Shown[] = [];
  private run = 0;
  private golds: Partial<Record<Quality, THREE.MeshStandardMaterial | THREE.MeshPhongMaterial>> = {};

  constructor(private readonly deps: StatueDeps) {
    this.group.name = 'statues';
    this.spots = statueSpots(deps.plan, STATUES);
  }

  /** The lobby's statues, newest first (the floor's `statues` message). Resolves when they stand. */
  async set(list: readonly Statue[]): Promise<void> {
    const run = ++this.run;
    const want = list.slice(0, Math.min(STATUES, this.spots.length));
    const keys = want.map((s) => `${s.name}|${s.at}|${JSON.stringify(s.look)}`);
    if (keys.join('\n') === this.shown.map((s) => s.key).join('\n')) return;
    // cast every figure before anything changes, so the lobby never stands half empty
    const figures = await Promise.all(want.map((s) => this.cast(s.look).catch(() => null)));
    if (run !== this.run) {
      for (const f of figures) f?.dispose();
      return;
    }
    this.clear();
    want.forEach((s, i) => {
      const spot = this.spots[i]!;
      this.shown.push(this.build(s, spot, figures[i] ?? null, keys[i]!));
    });
  }

  /** Where each statue stands now (for the checks), newest first. */
  get standing(): { name: string; x: number; z: number; yaw: number }[] {
    return this.shown.map((s, i) => ({ name: s.key.split('|')[0]!, ...this.spots[i]! }));
  }

  setQuality(q: Quality): void {
    const m = this.material(q);
    for (const s of this.shown) {
      const fig = s.group.getObjectByName('statue-figure') as THREE.Mesh | undefined;
      if (fig) fig.material = m;
    }
  }

  dispose(): void {
    this.run++;
    this.clear();
    for (const m of Object.values(this.golds)) m?.dispose();
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const s of this.shown) {
      s.group.removeFromParent();
      for (const g of s.own) g.dispose();
      s.plaque.dispose();
      s.texture.dispose();
      const i = this.deps.collider.posts.indexOf(s.post);
      if (i >= 0) this.deps.collider.posts.splice(i, 1);
    }
    this.shown = [];
  }

  /** The gold the figures are cast in, at a quality. */
  gold(q: Quality): THREE.Material {
    return this.material(q);
  }

  private material(q: Quality): THREE.Material {
    let m = this.golds[q];
    if (!m) {
      if (q === 'high') {
        const s = new THREE.MeshStandardMaterial({ color: '#f2c060', metalness: 1, roughness: 0.3 });
        const env = this.deps.env();
        if (env) {
          s.envMap = env;
          s.envMapIntensity = 1.5;
        }
        m = s;
      } else {
        // Low has no reflections to make metal of: a warm body colour and a hard highlight do it
        m = new THREE.MeshPhongMaterial({ color: '#b98a34', specular: '#ffe29a', shininess: 48, emissive: '#2a1a04' });
      }
      m.name = 'statue-gold';
      this.golds[q] = m;
    }
    return m;
  }

  private build(s: Statue, spot: StatueSpot, figure: THREE.BufferGeometry | null, key: string): Shown {
    const { mats } = this.deps;
    const g = new THREE.Group();
    g.name = `statue:${s.name}`;
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = spot.yaw;
    const own: THREE.BufferGeometry[] = [];
    const W = PLINTH.w;
    const H = PLINTH.h;
    const stone = mergeGeometries([
      new THREE.BoxGeometry(PLINTH.base, 0.12, PLINTH.base).translate(0, 0.06, 0),
      new THREE.BoxGeometry(W, H - 0.22, W).translate(0, 0.12 + (H - 0.22) / 2, 0),
      new THREE.BoxGeometry(W + 0.1, 0.1, W + 0.1).translate(0, H - 0.05, 0),
    ])!;
    // brass bands, standing a hair proud of the stone so the two never share a face
    const brass = mergeGeometries([
      new THREE.BoxGeometry(W + 0.012, 0.03, W + 0.012).translate(0, 0.155, 0),
      new THREE.BoxGeometry(W + 0.012, 0.03, W + 0.012).translate(0, H - 0.125, 0),
    ])!;
    own.push(stone, brass);
    g.add(new THREE.Mesh(stone, mats.get('marble-black')), new THREE.Mesh(brass, mats.get('brass')));
    const texture = plaqueTexture(s.name, s.at);
    const q = this.deps.quality();
    const plaque = q === 'high' ? new THREE.MeshStandardMaterial({ map: texture, metalness: 0.9, roughness: 0.35 }) : new THREE.MeshLambertMaterial({ map: texture, emissive: '#1a1206' });
    plaque.name = 'statue-plaque';
    const plate = new THREE.BoxGeometry(0.62, 0.2, 0.012).translate(0, 0.5, W / 2 + 0.006);
    own.push(plate);
    // the plate's front face carries the engraving; its edges read as brass
    const plateMesh = new THREE.Mesh(plate, [mats.get('brass'), mats.get('brass'), mats.get('brass'), mats.get('brass'), plaque, mats.get('brass')]);
    g.add(plateMesh);
    if (figure) {
      const fig = new THREE.Mesh(figure, this.material(q));
      fig.name = 'statue-figure';
      fig.position.y = H;
      fig.scale.setScalar(SCALE);
      own.push(figure);
      g.add(fig);
    }
    this.group.add(g);
    const post = this.deps.collider.post(spot.x, spot.z, STATUE_POST, H + 2.2 * SCALE);
    return { key, group: g, post, own, plaque, texture };
  }

  /** The figure in gold: the look posed in the cheer's V and baked into one still mesh. */
  private async cast(look: Look): Promise<THREE.BufferGeometry | null> {
    const plain: Look = { ...look };
    delete plain.held;
    delete plain.ride;
    const { characters } = this.deps;
    await characters.load(plain);
    // staff: left out of everyone on the floor (a round of champagne doesn't reach a statue)
    const p = characters.create(plain, '', { blob: false, staff: true });
    try {
      p.gesture('cheer');
      p.update(POSE_T);
      return bakeAll(p);
    } finally {
      p.dispose();
    }
  }
}

/**
 * Every skinned part of a character (the body and what it wears, the near level of any LOD) as it
 * is posed now, in the character's own frame: one mesh of positions and normals.
 */
export function bakeAll(p: Person): THREE.BufferGeometry | null {
  const root = p.root;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  const visit = (o: THREE.Object3D) => {
    if ((o as THREE.LOD).isLOD) {
      const near = (o as THREE.LOD).levels[0]?.object;
      if (near) visit(near);
      return;
    }
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) {
      const src = mesh.geometry;
      const n = src.getAttribute('position').count;
      const pos = new Float32Array(n * 3);
      const m = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
      for (let i = 0; i < n; i++) mesh.getVertexPosition(i, v).applyMatrix4(m).toArray(pos, i * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const index = src.getIndex();
      if (index) g.setIndex(new THREE.BufferAttribute((index.array as Uint16Array | Uint32Array).slice(), 1));
      g.computeVertexNormals();
      parts.push(g);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  if (parts.length === 0) return null;
  // indexed and not: merge wants them all one way
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = mergeGeometries(flat);
  for (const g of [...parts, ...flat]) if (g !== out) g.dispose();
  out?.computeBoundingSphere();
  return out;
}

/** The brass plaque: the name engraved large, the day it was cast under it. */
function plaqueTexture(name: string, at: number): THREE.CanvasTexture {
  const w = 512;
  const h = 166;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#d6b064');
  g.addColorStop(0.5, '#b8913e');
  g.addColorStop(1, '#8e6c2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // a bevelled border
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(9, 9, w - 18, h - 18);
  ctx.strokeStyle = 'rgba(60, 40, 10, 0.6)';
  ctx.strokeRect(13, 13, w - 26, h - 26);
  const engrave = (text: string, y: number, size: number, spacing: number) => {
    ctx.font = `600 ${size}px Cinzel, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
    let s = size;
    while (ctx.measureText(text).width > w - 60 && s > 18) {
      s -= 2;
      ctx.font = `600 ${s}px Cinzel, Georgia, serif`;
    }
    // cut into the metal: a dark groove with light catching its lower edge
    ctx.fillStyle = 'rgba(255, 236, 190, 0.5)';
    ctx.fillText(text, w / 2, y + 1.5);
    ctx.fillStyle = '#3a2708';
    ctx.fillText(text, w / 2, y);
  };
  engrave(name.toUpperCase(), h * 0.43, 54, 4);
  const d = new Date(at);
  const when = Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase() : '';
  engrave(when ? `CAST IN GOLD · ${when}` : 'CAST IN GOLD', h * 0.76, 20, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
