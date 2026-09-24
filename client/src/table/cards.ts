// Playing cards on the table: real faces from the SVG deck, rasterized once into textures,
// on thin boxes the size of a poker card (63.5 x 88.9 mm). Cards come out of the shoe and flip.

import * as THREE from 'three';
import type { Card } from '../../../shared/src/cards.ts';
import { tween, ease } from './tween.ts';

export const CARD_W = 0.0635;
export const CARD_H = 0.0889;
const THICK = 0.0004;
const TEX_W = 256;
const TEX_H = 358;

const base = import.meta.env.BASE_URL;
const textures = new Map<string, THREE.Texture>();
let backTex: THREE.Texture | null = null;

async function raster(url: string): Promise<THREE.Texture> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const g = canvas.getContext('2d')!;
  g.drawImage(img, 0, 0, TEX_W, TEX_H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // every table's cards draw from these: a table leaving (TableStage.dispose) keeps them
  tex.userData.shared = true;
  return tex;
}

let loading: Promise<void> | null = null;

/** Rasterize all 52 faces and the back, once: a second call waits on the first (after a failure, tries again). */
export function loadCards(): Promise<void> {
  return (loading ??= rasterAll().catch((err: unknown) => {
    loading = null;
    throw err;
  }));
}

async function rasterAll(): Promise<void> {
  const ranks = 'A23456789TJQK';
  const jobs: Promise<void>[] = [];
  for (const s of 'shdc') {
    for (const r of ranks) {
      const code = `${r}${s}`;
      jobs.push(raster(`${base}assets/cards/${code}.svg`).then((t) => void textures.set(code, t)));
    }
  }
  jobs.push(raster(`${base}assets/cards/back-red.svg`).then((t) => void (backTex = t)));
  await Promise.all(jobs);
}

const geometry = new THREE.BoxGeometry(CARD_W, THICK, CARD_H);
const edge = new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.7 });
geometry.userData.shared = true;
edge.userData.shared = true;

/**
 * The most light a card's white paper gives back. The tone mapping (Neutral) starts squeezing
 * brightness at about 0.8; a spotlit table on High lifts white paper to 1.5, where the paper is
 * squeezed while the ink keeps rising with the light, and the pips and indices fade to grey.
 */
export const PAPER_PEAK = 0.8;

/**
 * A card face keeps its contrast under any light: it is lit as white paper would be, that
 * brightness is held at PAPER_PEAK, and the card's own colours go on after, so ink and paper keep
 * their ratio whatever the lights (dimming a card through its colour still works). Under dim light
 * nothing changes. One shader for every face.
 */
export function holdContrast(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
  vec3 cardInk = material.diffuseContribution;
  material.diffuseContribution = vec3( 1.0 );`,
      )
      .replace(
        'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
        `vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  float cardHold = min( 1.0, ${PAPER_PEAK.toFixed(3)} / max( max( totalDiffuse.r, max( totalDiffuse.g, totalDiffuse.b ) ), 1e-4 ) );
  totalDiffuse *= cardInk * cardHold;
  totalSpecular *= cardHold;`,
      );
  };
  m.customProgramCacheKey = () => 'card-face-hold';
}

/** A card mesh. Face up means the face points +Y (toward a camera above the table). */
export class CardMesh extends THREE.Mesh {
  card: Card | null;
  constructor(card: Card | null) {
    const face = new THREE.MeshStandardMaterial({ map: card ? textures.get(card) ?? null : backTex, roughness: 0.55 });
    holdContrast(face);
    const back = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.55 });
    // BoxGeometry groups: +x, -x, +y, -y, +z, -z. The face is on +y, so rotation.x = 0 is face
    // up and rotation.x = PI is face down.
    super(geometry, [edge, edge, face, back, edge, edge]);
    this.card = card;
    this.rotation.x = Math.PI;
  }

  /** Show `card` on the face (e.g. the hole card once the server reveals it). */
  setCard(card: Card): void {
    this.card = card;
    const mats = this.material as THREE.MeshStandardMaterial[];
    mats[2]!.map = textures.get(card) ?? null;
    mats[2]!.needsUpdate = true;
  }

  get faceUp(): boolean {
    return Math.abs(this.rotation.x) < 0.01;
  }
}

/** Slide a card from `from` to `to` (local positions) along a low arc, optionally flipping. */
export async function dealCard(mesh: CardMesh, from: THREE.Vector3, to: THREE.Vector3, opts: { faceUp: boolean; ms?: number; yaw?: number }): Promise<void> {
  const ms = opts.ms ?? 320;
  const startYaw = mesh.rotation.y;
  const endYaw = opts.yaw ?? 0;
  const startFlip = mesh.rotation.x;
  const endFlip = opts.faceUp ? 0 : Math.PI;
  mesh.position.copy(from);
  await tween(ms, (k) => {
    mesh.position.lerpVectors(from, to, k);
    mesh.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * 0.03;
    mesh.rotation.y = startYaw + (endYaw - startYaw) * k;
    mesh.rotation.x = startFlip + (endFlip - startFlip) * k;
  }, ease.out);
}

/** Flip a card in place (it lifts slightly as it turns). */
export async function flipCard(mesh: CardMesh, faceUp = true, ms = 220): Promise<void> {
  const y0 = mesh.position.y;
  const a = mesh.rotation.x;
  const b = faceUp ? 0 : Math.PI;
  await tween(ms, (k) => {
    mesh.rotation.x = a + (b - a) * k;
    mesh.position.y = y0 + Math.sin(Math.PI * k) * 0.025;
  }, ease.inOut);
  mesh.position.y = y0;
}
