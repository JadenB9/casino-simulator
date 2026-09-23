// Every material the floor uses, by name, in a High and a Low version. High uses
// MeshStandardMaterial where it shows (brass, marble, lacquer, mirrors) and Lambert for the big
// matte surfaces, which cover most pixels (carpet, walls, ceilings). Low is Lambert and Basic
// throughout. Lit signs, LED strips and lamps are Basic materials pushed past 1.0 so the bloom
// pass picks them up; on Low they just read as bright.
//
// Switching quality swaps each mesh's material for its counterpart; nothing is rebuilt.

import * as THREE from 'three';
import type { Quality } from '../render/engine3d.ts';
import { canvasTexture, drawAisle, drawCarpet, PALETTES } from './carpet.ts';

export type Tex = Partial<Record<'marbleTiles' | 'marbleBlack' | 'woodDark' | 'woodPanel' | 'velvet' | 'carpetNormal', THREE.Texture>>;

const TEXTURES: Record<keyof Tex, string> = {
  marbleTiles: 'marble-tiles.webp',
  marbleBlack: 'marble-black.webp',
  woodDark: 'wood-dark.webp',
  woodPanel: 'wood-panel.webp',
  velvet: 'velvet.webp',
  carpetNormal: 'carpet-normal.webp',
};

export const TEXTURE_BASE = `${import.meta.env.BASE_URL}assets/textures/`;

/** Load the floor's texture maps. A missing map leaves that material on its flat colour. */
export async function loadTextures(anisotropy: number): Promise<Tex> {
  const loader = new THREE.TextureLoader();
  const out: Tex = {};
  await Promise.all(
    (Object.keys(TEXTURES) as (keyof Tex)[]).map(async (k) => {
      try {
        const t = await loader.loadAsync(TEXTURE_BASE + TEXTURES[k]);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = anisotropy;
        if (k !== 'carpetNormal') t.colorSpace = THREE.SRGBColorSpace;
        out[k] = t;
      } catch {
        /* keep the flat colour */
      }
    }),
  );
  return out;
}

type Make = (q: Quality) => THREE.Material;

/** A colour pushed into HDR so it blooms (and still reads bright without bloom). */
export function hdr(hex: string, k: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

export class Mats {
  private makers = new Map<string, Make>();
  private made = new Map<string, Partial<Record<Quality, THREE.Material>>>();
  private owner = new Map<THREE.Material, string>();
  readonly textures: Tex;
  readonly canvases: THREE.Texture[] = [];

  constructor(
    public quality: Quality,
    tex: Tex,
    private anisotropy: number,
  ) {
    this.textures = tex;
    this.define();
  }

  /** The material called `name` at the current quality. */
  get(name: string): THREE.Material {
    let per = this.made.get(name);
    if (!per) {
      per = {};
      this.made.set(name, per);
    }
    let m = per[this.quality];
    if (!m) {
      const make = this.makers.get(name);
      if (!make) throw new Error(`no material "${name}"`);
      m = make(this.quality);
      m.name = name;
      per[this.quality] = m;
      this.owner.set(m, name);
    }
    return m;
  }

  /** Register an extra material (signs, LED colours) built by other parts of the world. */
  define1(name: string, make: Make): void {
    if (!this.makers.has(name)) this.makers.set(name, make);
  }

  /** Switch every mesh under `root` that uses one of these materials to the other quality. */
  swap(root: THREE.Object3D, q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = this.owner.get(mesh.material as THREE.Material);
      if (name) mesh.material = this.get(name);
    });
  }

  dispose(): void {
    for (const per of this.made.values()) for (const m of Object.values(per)) m?.dispose();
    for (const t of this.canvases) t.dispose();
    for (const t of Object.values(this.textures)) t?.dispose();
  }

  private canvasTex(c: HTMLCanvasElement): THREE.CanvasTexture {
    const t = canvasTexture(c, this.anisotropy);
    this.canvases.push(t);
    return t;
  }

  private define(): void {
    const t = this.textures;
    const hi = (q: Quality) => q === 'high';
    const lambert = (p: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(p);
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
    const size = this.quality === 'high' ? 2048 : 1024;

    // carpets: canvases drawn once, shared by both qualities
    const floorTex = this.canvasTex(drawCarpet(size, PALETTES.floor, 7));
    const pokerTex = this.canvasTex(drawCarpet(size / 2, PALETTES.poker, 11));
    const aisleTex = this.canvasTex(drawAisle(512, 3));
    const wallTex = this.canvasTex(drawCarpet(512, WALL_PALETTE, 5));
    const cofferTex = this.canvasTex(drawCoffer(256));
    const washTex = this.canvasTex(drawWash(64, 256));
    const ceilTex = this.canvasTex(drawCeiling(256));
    const poolTex = this.canvasTex(drawRadial(128, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]));
    poolTex.wrapS = poolTex.wrapT = THREE.ClampToEdgeWrapping;
    const blobTex = this.canvasTex(drawRadial(64, [[0, 'rgba(0,0,0,0.62)'], [0.55, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]));
    blobTex.wrapS = blobTex.wrapT = THREE.ClampToEdgeWrapping;

    const carpet = (map: THREE.Texture) => (q: Quality) =>
      lambert({ map, normalMap: hi(q) ? t.carpetNormal ?? null : null, normalScale: new THREE.Vector2(0.6, 0.6) });
    this.makers.set('carpet', carpet(floorTex));
    this.makers.set('carpet-poker', carpet(pokerTex));
    this.makers.set('carpet-aisle', carpet(aisleTex));
    this.makers.set('marble-floor', (q) =>
      hi(q) ? std({ map: t.marbleTiles ?? null, color: t.marbleTiles ? '#a89c8c' : '#a89c8c', roughness: 0.28, metalness: 0 }) : lambert({ map: t.marbleTiles ?? null, color: t.marbleTiles ? '#a89c8c' : '#a89c8c' }),
    );
    this.makers.set('wall', () => lambert({ map: wallTex }));
    this.makers.set('wainscot', (q) =>
      hi(q) ? std({ map: t.woodPanel ?? null, color: t.woodPanel ? '#b89a8a' : '#3a2016', roughness: 0.55 }) : lambert({ map: t.woodPanel ?? null, color: t.woodPanel ? '#b89a8a' : '#3a2016' }),
    );
    this.makers.set('ceiling', () => lambert({ map: ceilTex }));
    this.makers.set('ceiling-pit', () => new THREE.MeshBasicMaterial({ map: cofferTex }));
    this.makers.set('fascia', () => new THREE.MeshBasicMaterial({ map: washTex }));
    this.makers.set('wood', (q) =>
      hi(q) ? std({ map: t.woodDark ?? null, color: t.woodDark ? '#c9a58f' : '#4a2616', roughness: 0.42 }) : lambert({ map: t.woodDark ?? null, color: t.woodDark ? '#c9a58f' : '#4a2616' }),
    );
    this.makers.set('beam', (q) => (hi(q) ? std({ map: t.woodDark ?? null, color: '#8a6a5a', roughness: 0.5 }) : lambert({ map: t.woodDark ?? null, color: '#8a6a5a' })));
    this.makers.set('brass', (q) => (hi(q) ? std({ color: '#c9a24a', metalness: 1, roughness: 0.3 }) : lambert({ color: '#9c7632', emissive: '#2b1c07' })));
    this.makers.set('chrome', (q) => (hi(q) ? std({ color: '#cfd0d6', metalness: 1, roughness: 0.18 }) : lambert({ color: '#8e8f96', emissive: '#1a1a1c' })));
    this.makers.set('marble-black', (q) =>
      hi(q) ? std({ map: t.marbleBlack ?? null, color: t.marbleBlack ? '#9a9a9a' : '#141213', roughness: 0.16 }) : lambert({ map: t.marbleBlack ?? null, color: t.marbleBlack ? '#9a9a9a' : '#141213' }),
    );
    this.makers.set('lacquer', (q) => (hi(q) ? std({ color: '#0d0b0b', roughness: 0.14 }) : lambert({ color: '#100d0c' })));
    this.makers.set('lacquer-red', (q) => (hi(q) ? std({ color: '#5a0d16', roughness: 0.2 }) : lambert({ color: '#4a0c13' })));
    this.makers.set('leather', (q) => (hi(q) ? std({ color: '#241010', roughness: 0.5 }) : lambert({ color: '#241010' })));
    this.makers.set('velvet', () => lambert({ map: t.velvet ?? null, color: t.velvet ? '#d04050' : '#7a1020' }));
    this.makers.set('mirror', (q) => (hi(q) ? std({ color: '#40383a', metalness: 1, roughness: 0.06 }) : new THREE.MeshBasicMaterial({ color: '#2a2224' })));
    this.makers.set('cage', (q) => (hi(q) ? std({ color: '#b38b3c', metalness: 1, roughness: 0.35 }) : lambert({ color: '#8c6a2c', emissive: '#1e1405' })));
    this.makers.set('shade', () => lambert({ color: '#e8d2a8', emissive: '#6a4a22', side: THREE.DoubleSide }));
    this.makers.set('glow-warm', () => new THREE.MeshBasicMaterial({ color: hdr('#ffd39a', 2.6) }));
    this.makers.set('glow-soft', () => new THREE.MeshBasicMaterial({ color: hdr('#ffc98a', 1.25) }));
    this.makers.set('glow-bulb', () => new THREE.MeshBasicMaterial({ color: hdr('#fff0d0', 1.12) }));
    this.makers.set('glow-shelf', () => new THREE.MeshBasicMaterial({ color: hdr('#ffb266', 2.2) }));
    this.makers.set('pool', () =>
      new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color('#ffb46a').multiplyScalar(0.15), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.makers.set('blob', () => new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  }
}

const WALL_PALETTE = {
  ground: '#3a1418',
  groundDark: '#2e0f13',
  groundLight: '#44181d',
  gold: '#58222a',
  goldDark: '#4a1c22',
  accent: '#4f1d24',
  accentDark: '#43181e',
  spark: '#5c2830',
  cream: '#6a3036',
};

/** One coffer, seen from below: dark panel, warm light spilling from the cove round its edge. */
function drawCoffer(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a1412';
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.72);
  g.addColorStop(0, '#3a1c18');
  g.addColorStop(0.62, '#5a2a1c');
  g.addColorStop(0.86, '#b87a42');
  g.addColorStop(1, '#f0c080');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // a gilt rosette in the middle of each coffer
  ctx.strokeStyle = '#c8a050';
  ctx.lineWidth = size * 0.012;
  for (const r of [0.1, 0.16]) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(size / 2 + Math.cos(a) * size * 0.16, size / 2 + Math.sin(a) * size * 0.16);
    ctx.lineTo(size / 2 + Math.cos(a) * size * 0.24, size / 2 + Math.sin(a) * size * 0.24);
    ctx.stroke();
  }
  return c;
}

/** Low ceiling panels: dark, with a faint bronze reveal between them (one 1.2 m panel per tile). */
function drawCeiling(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1c1512';
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.7);
  g.addColorStop(0, '#231a16');
  g.addColorStop(1, '#17110f');
  ctx.fillStyle = g;
  ctx.fillRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92);
  ctx.strokeStyle = '#4a3522';
  ctx.lineWidth = size * 0.012;
  ctx.strokeRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92);
  return c;
}

/** The fascia under a cove: bright where the hidden LED strip washes it, fading upward. */
function drawWash(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#d9a060');
  g.addColorStop(0.1, '#8a5530');
  g.addColorStop(0.35, '#3a1c14');
  g.addColorStop(1, '#1a0e0c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c;
}

function drawRadial(size: number, stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [k, col] of stops) g.addColorStop(k, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
