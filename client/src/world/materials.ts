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
import { drawAcoustic, drawConcrete, drawCorrugated, drawPanels, drawPlanks, drawTiles } from './textures.ts';
import { drawBingoCarpet, drawCeilingTile, drawLandscape, drawSeigaiha, drawSlats, drawVendingFace } from './textures-themes.ts';

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
    // the new rooms' carpets, drawn only when a room asks for one (a second size down: they cover less)
    const lazy = (draw: () => HTMLCanvasElement) => {
      let tex: THREE.Texture | null = null;
      return () => (tex ??= this.canvasTex(draw()));
    };
    const small = size / 2;
    const slotsTex = lazy(() => drawCarpet(small, PALETTES.slots, 13));
    const salonTex = lazy(() => drawCarpet(small, PALETTES.salon, 17));
    const loungeTex = lazy(() => drawCarpet(small, PALETTES.lounge, 19));
    const tilesTex = lazy(() => drawTiles(512, 23));
    this.makers.set('carpet-slots', (q) => carpet(slotsTex())(q));
    this.makers.set('carpet-salon', (q) => carpet(salonTex())(q));
    this.makers.set('carpet-lounge', (q) => carpet(loungeTex())(q));
    this.makers.set('carpet-online', (q) => carpet(tilesTex())(q));
    const concreteTex = lazy(() => drawConcrete(512, 29));
    const rustTex = lazy(() => drawCorrugated(512, 512, 31));
    const plankTex = lazy(() => drawPlanks(512, 37, false));
    const roughTex = lazy(() => drawPlanks(512, 41, true));
    const acousticTex = lazy(() => drawAcoustic(256, 43));
    const panelTex = lazy(() => drawPanels(256, 47));
    const navyTex = lazy(() => drawCarpet(512, NAVY_WALL, 53));
    const emeraldTex = lazy(() => drawCarpet(512, EMERALD_WALL, 59));
    const wineTex = lazy(() => drawCarpet(512, WINE_WALL, 61));
    this.makers.set('concrete', (q) => (hi(q) ? std({ map: concreteTex(), roughness: 0.7, metalness: 0 }) : lambert({ map: concreteTex() })));
    this.makers.set('corrugated', (q) => (hi(q) ? std({ map: rustTex(), color: '#9a8a7c', roughness: 0.78, metalness: 0.2 }) : lambert({ map: rustTex(), color: '#9a8a7c' })));
    this.makers.set('floor-wood', (q) => (hi(q) ? std({ map: plankTex(), color: '#b08a70', roughness: 0.62 }) : lambert({ map: plankTex(), color: '#b08a70' })));
    this.makers.set('planks', () => lambert({ map: roughTex() }));
    this.makers.set('wall-dark', () => lambert({ map: acousticTex() }));
    this.makers.set('wall-cream', () => lambert({ map: panelTex() }));
    this.makers.set('wall-navy', () => lambert({ map: navyTex() }));
    this.makers.set('wall-salon', () => lambert({ map: emeraldTex() }));
    this.makers.set('wall-bar', () => lambert({ map: wineTex() }));
    this.makers.set('marble-light', (q) =>
      hi(q) ? std({ map: t.marbleTiles ?? null, color: '#e8e0d4', roughness: 0.2, metalness: 0 }) : lambert({ map: t.marbleTiles ?? null, color: '#e8e0d4' }),
    );
    // the north wing: the pachinko parlour, the Jade Room and the bingo hall
    const parlourTex = lazy(() => drawCarpet(small, PALETTES.parlour, 67));
    const jadeTex = lazy(() => drawCarpet(small, PALETTES.jade, 71));
    const crimsonTex = lazy(() => drawCarpet(512, CRIMSON_WALL, 73));
    const waveTex = lazy(() => drawSeigaiha(512, 79));
    const bingoTex = lazy(() => drawBingoCarpet(small, 83));
    const slatTex = lazy(() => drawSlats(512, 89));
    const tileTex = lazy(() => drawCeilingTile(128, 97));
    const cansTex = lazy(() => drawVendingFace(256, 320, 101));
    const paintingTex = lazy(() => drawLandscape(512, 103));
    this.makers.set('carpet-parlour', (q) => carpet(parlourTex())(q));
    this.makers.set('carpet-jade', (q) => carpet(jadeTex())(q));
    this.makers.set('carpet-bingo', (q) => carpet(bingoTex())(q));
    this.makers.set('wall-crimson', () => lambert({ map: crimsonTex() }));
    this.makers.set('wall-parlour', () => lambert({ map: waveTex() }));
    this.makers.set('wall-bingo', () => lambert({ map: slatTex() }));
    this.makers.set('ceiling-parlour', () => lambert({ color: '#d8d0d4', emissive: '#2a2226' }));
    this.makers.set('ceiling-bingo', () => lambert({ map: tileTex() }));
    this.makers.set('vending-face', () => new THREE.MeshBasicMaterial({ map: cansTex(), color: hdr('#ffffff', 1.1) }));
    this.makers.set('painting', () => lambert({ map: paintingTex(), emissive: '#1a1206' }));
    this.makers.set('enamel', (q) => (hi(q) ? std({ color: '#e8e4dc', roughness: 0.35 }) : lambert({ color: '#d8d4cc' })));
    this.makers.set('vinyl', (q) => (hi(q) ? std({ color: '#7a1a22', roughness: 0.5 }) : lambert({ color: '#6a161c' })));
    this.makers.set('porcelain', (q) => (hi(q) ? std({ color: '#eef0f4', roughness: 0.18 }) : lambert({ color: '#e0e4ea' })));
    this.makers.set('jade', (q) => (hi(q) ? std({ color: '#3a9a78', roughness: 0.22 }) : lambert({ color: '#2e8a6a' })));
    this.makers.set('lacquer-gold', (q) => (hi(q) ? std({ color: '#b8862e', metalness: 0.9, roughness: 0.38 }) : lambert({ color: '#8c6424', emissive: '#241806' })));
    this.makers.set('silk-red', () => lambert({ color: '#b01e1e', emissive: '#5a0c08', side: THREE.DoubleSide }));
    this.makers.set('ceiling-dark', () => lambert({ color: '#0c0c10' }));
    this.makers.set('ceiling-light', () => lambert({ color: '#c8b69a', emissive: '#1e1710' }));
    this.makers.set('steel', (q) => (hi(q) ? std({ color: '#3a3c40', metalness: 0.8, roughness: 0.45 }) : lambert({ color: '#34363a' })));
    // the earth in the planters, under the palms and plants
    this.makers.set('soil', () => lambert({ map: concreteTex(), color: '#4a3020' }));
    this.makers.set('rust', (q) => (hi(q) ? std({ map: rustTex(), color: '#b8a090', metalness: 0.4, roughness: 0.7 }) : lambert({ map: rustTex(), color: '#b8a090' })));
    this.makers.set('glass', (q) =>
      hi(q)
        ? std({ color: '#b8c8c8', metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.16, depthWrite: false })
        : new THREE.MeshBasicMaterial({ color: '#8a9a9a', transparent: true, opacity: 0.12, depthWrite: false }),
    );
    this.makers.set('upholstery', (q) => (hi(q) ? std({ map: t.velvet ?? null, color: t.velvet ? '#8a4048' : '#4a1018', roughness: 0.7 }) : lambert({ map: t.velvet ?? null, color: t.velvet ? '#8a4048' : '#4a1018' })));
    this.makers.set('velvet-green', () => lambert({ color: '#1f5a3d' }));
    this.makers.set('fabric', () => lambert({ color: '#2a2622' }));
    this.makers.set('case-light', () => new THREE.MeshBasicMaterial({ color: hdr('#fff2dc', 2.0) }));
    this.makers.set('fire', () => new THREE.MeshBasicMaterial({ color: hdr('#ff8a2a', 3.0) }));
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
    this.makers.set('leather', (q) => (hi(q) ? std({ color: '#2c1410', roughness: 0.62 }) : lambert({ color: '#2c1410' })));
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

/** The poker room's walls: navy damask. */
const NAVY_WALL = {
  ground: '#121a30',
  groundDark: '#0d1426',
  groundLight: '#172038',
  gold: '#24304c',
  goldDark: '#1c2640',
  accent: '#1f2a46',
  accentDark: '#18223a',
  spark: '#2c3856',
  cream: '#34405e',
};
/** The salon's: emerald silk damask. */
const EMERALD_WALL = {
  ground: '#0e2a1e',
  groundDark: '#0a2016',
  groundLight: '#123224',
  gold: '#1c4030',
  goldDark: '#16362a',
  accent: '#183a2c',
  accentDark: '#123024',
  spark: '#24483a',
  cream: '#2c5242',
};
/** The Jade Room's: lacquer-red silk damask. */
const CRIMSON_WALL = {
  ground: '#5a0e12',
  groundDark: '#480a0e',
  groundLight: '#661216',
  gold: '#7a2a1c',
  goldDark: '#6a2018',
  accent: '#6e1c18',
  accentDark: '#5e1414',
  spark: '#8a3a22',
  cream: '#9a4a2a',
};
/** The bar's and the lounge's: deep wine. */
const WINE_WALL = {
  ground: '#2c0f14',
  groundDark: '#220b10',
  groundLight: '#341218',
  gold: '#3e1a1e',
  goldDark: '#36161a',
  accent: '#3a161c',
  accentDark: '#301216',
  spark: '#462024',
  cream: '#4e262a',
};

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
