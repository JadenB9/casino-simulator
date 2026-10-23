// Playing cards on the table: real faces from the SVG deck, rasterized once into textures, on thin
// cards the size of a poker card (63.5 x 88.9 mm) with the deck's own rounded corners, and a soft
// shadow on the felt under each. Cards come out of the shoe on a low arc and turn over with a lift.
//
// The faces come as one of two decks, a choice kept on this device: the classic two colours, or
// four (spades black, hearts red, diamonds blue, clubs green), which tells a flush or a suit at a
// glance. Switching repaints the faces in place, so every card on every table (and the faces drawn
// in the DOM: the video poker screen, the Pai Gow setter, through cardFaceUrl) follows at once.

import * as THREE from 'three';
import type { Card } from '../../../shared/src/cards.ts';
import { tween, ease } from './tween.ts';
import { calm } from '../app/comfort.ts';
import { savedQuality } from '../render/engine3d.ts';
import { GroundShadow, shadowPlane, softRect, type ShadowShape } from './shadow.ts';

export const CARD_W = 0.0635;
export const CARD_H = 0.0889;
const THICK = 0.0004;
/** The deck's own corner (12 of its 240 units across): the geometry is cut to it. */
const CORNER = CARD_W * (12 / 240);
/**
 * Pixels across a face. Low (phones, older machines) keeps the 256 it always had; High draws 400,
 * for a card seen close at twice the pixel density. Faces only reach the GPU once a table shows them.
 */
const TEX_W = savedQuality() === 'high' ? 400 : 256;
const TEX_H = Math.round((TEX_W * 336) / 240);

const base = import.meta.env.BASE_URL;
const RANKS = 'A23456789TJQK';
const SUITS = 'shdc';

// ---- the two decks ---------------------------------------------------------------------------

export type Deck = 'classic' | 'four';
const DECK_KEY = 'casino.deck';
/** The four-colour deck's diamonds and clubs (spades stay black and hearts red). */
export const FOUR_COLOUR = { d: '#1660d4', c: '#108a3c' } as const;

function savedDeck(): Deck {
  try {
    return localStorage.getItem(DECK_KEY) === 'four' ? 'four' : 'classic';
  } catch {
    return 'classic';
  }
}

let current: Deck = savedDeck();
const deckListeners = new Set<(d: Deck) => void>();

/** The deck the faces are drawn from now. */
export function deck(): Deck {
  return current;
}

/** Hear a change of deck (after the faces are repainted); the returned function stops listening. */
export function onDeck(fn: (d: Deck) => void): () => void {
  deckListeners.add(fn);
  return () => deckListeners.delete(fn);
}

/** Choose the deck: saved on this device, and every face on show repainted. */
export async function setDeck(d: Deck): Promise<void> {
  if (d === current) return;
  current = d;
  try {
    localStorage.setItem(DECK_KEY, d);
  } catch {
    // not kept, but used for this visit
  }
  // only the faces whose colours differ between the decks
  if (loading) await loading.catch(() => {});
  await Promise.all([...sources.keys()].filter((code) => code[1] === 'd' || code[1] === 'c').map((code) => paint(code)));
  for (const fn of deckListeners) fn(d);
}

/**
 * A face's SVG for `deck`: the deck's own art, with its black outline softened to the paper's
 * edge (a hard black line round every card read as a printed border on the felt), and in the
 * four-colour deck the suit's pips and indices recoloured. Only the pips and indices: the court
 * figures keep their colours. Exported for the tests.
 */
export function faceSvg(svg: string, code: string, d: Deck): string {
  let out = svg.replace(/(<rect\b[^>]*\bfill="white"[^>]*\bstroke=")black(")/, '$1#cfc8bb$2');
  const suit = code[1];
  if (d !== 'four' || (suit !== 'd' && suit !== 'c')) return out;
  const ink = suit === 'd' ? 'red' : 'black';
  const to = FOUR_COLOUR[suit];
  // the deck's pips and indices are the symbols named S<suit><rank> and V<suit><rank>
  const own = new RegExp(`(<symbol id="[SV]${suit.toUpperCase()}[^"]*"[\\s\\S]*?</symbol>)`, 'g');
  out = out.replace(own, (sym) => sym.replace(new RegExp(`(fill|stroke)="${ink}"`, 'g'), `$1="${to}"`));
  return out;
}

// ---- the faces ---------------------------------------------------------------------------------

/** Each face's SVG as the deck ships it (fetched once). */
const sources = new Map<string, string>();
/** Each face's picture for the deck in use, as a URL an <img> or the rasterizer can load. */
const urls = new Map<string, string>();
const textures = new Map<string, THREE.CanvasTexture>();
let backTex: THREE.Texture | null = null;

function newTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // as sharp as the GPU allows at a slant (three keeps it to what the hardware has)
  tex.anisotropy = 16;
  // every table's cards draw from these: a table leaving (TableStage.dispose) keeps them
  tex.userData.shared = true;
  return tex;
}

async function draw(url: string, canvas: HTMLCanvasElement): Promise<void> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
}

/** (Re)paint one face for the deck in use: its URL, then its texture in place. */
async function paint(code: string): Promise<void> {
  const src = sources.get(code);
  const old = urls.get(code);
  let url = `${base}assets/cards/${code}.svg`;
  if (src !== undefined) url = URL.createObjectURL(new Blob([faceSvg(src, code, current)], { type: 'image/svg+xml' }));
  let tex = textures.get(code);
  const canvas = (tex?.image as HTMLCanvasElement | undefined) ?? Object.assign(document.createElement('canvas'), { width: TEX_W, height: TEX_H });
  await draw(url, canvas);
  urls.set(code, url);
  if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
  if (tex) tex.needsUpdate = true;
  else {
    tex = newTexture(canvas);
    textures.set(code, tex);
  }
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
  const jobs: Promise<void>[] = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      const code = `${r}${s}`;
      jobs.push(
        fetch(`${base}assets/cards/${code}.svg`)
          .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
          .then((text) => void sources.set(code, text))
          // without the text, the deck's own file as it is (no outline softening, no four colours)
          .catch(() => {})
          .then(() => paint(code)),
      );
    }
  }
  const back = Object.assign(document.createElement('canvas'), { width: TEX_W, height: TEX_H });
  paintBack(back);
  backTex = newTexture(back);
  // the same back for the DOM's face-down cards
  back.toBlob((b) => void (b && (backUrl = URL.createObjectURL(b))));
  await Promise.all(jobs);
}

let backUrl: string | null = null;

/**
 * The suits as the deck draws them (its pips, CC0 like the rest of its art), in a 1200-unit box
 * round 0,0: for a card back, a preview of the deck in Settings.
 */
export const SUIT_PATHS: Record<'s' | 'h' | 'd' | 'c', string> = {
  s: 'M0 -500C100 -250 355 -100 355 185A150 150 0 0 1 55 185A10 10 0 0 0 35 185C35 385 85 400 130 500L-130 500C-85 400 -35 385 -35 185A10 10 0 0 0 -55 185A150 150 0 0 1 -355 185C-355 -100 -100 -250 0 -500Z',
  h: 'M0 -300C0 -400 100 -500 200 -500C300 -500 400 -400 400 -250C400 0 0 400 0 500C0 400 -400 0 -400 -250C-400 -400 -300 -500 -200 -500C-100 -500 0 -400 -0 -300Z',
  d: 'M-400 0C-350 0 0 -450 0 -500C0 -450 350 0 400 0C350 0 0 450 0 500C0 450 -350 0 -400 0Z',
  c: 'M30 150C35 385 85 400 130 500L-130 500C-85 400 -35 385 -30 150A10 10 0 0 0 -50 150A210 210 0 1 1 -124 -51A10 10 0 0 0 -110 -65A230 230 0 1 1 110 -65A10 10 0 0 0 124 -51A210 210 0 1 1 50 150A10 10 0 0 0 30 150Z',
};

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  // (Safari before 16 has no roundRect: the four arcs by hand)
  if (typeof g.roundRect === 'function') return void g.roundRect(x, y, w, h, r);
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * The back every table deals, painted here: a white border, a deep red field crossed by a fine
 * lattice, a cream keyline, and the four suits round a medallion in the middle. (The deck's own
 * back is a lattice six units across, which at a card's size on screen shimmered into moire.)
 */
function paintBack(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  const u = W / 240;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#f7f3ea';
  roundRect(g, 0, 0, W, H, 12 * u);
  g.fill();
  const inset = 10 * u;
  const fw = W - 2 * inset;
  const fh = H - 2 * inset;
  g.save();
  roundRect(g, inset, inset, fw, fh, 7 * u);
  g.clip();
  const field = g.createRadialGradient(W / 2, H / 2, 10 * u, W / 2, H / 2, H * 0.62);
  field.addColorStop(0, '#b01b28');
  field.addColorStop(1, '#7e0f19');
  g.fillStyle = field;
  g.fillRect(inset, inset, fw, fh);
  // the lattice: two sets of fine diagonals, far enough apart to stay lines on screen
  g.strokeStyle = 'rgba(255, 214, 196, 0.2)';
  g.lineWidth = Math.max(1, 1.4 * u);
  const step = 16 * u;
  for (let k = -H; k < W + H; k += step) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + H, H);
    g.moveTo(k + H, 0);
    g.lineTo(k, H);
    g.stroke();
  }
  g.restore();
  // a keyline inside the border
  g.strokeStyle = 'rgba(247, 243, 234, 0.85)';
  g.lineWidth = 2.2 * u;
  roundRect(g, inset + 5 * u, inset + 5 * u, fw - 10 * u, fh - 10 * u, 5 * u);
  g.stroke();
  // the medallion: a cream ring on a darker red, the four suits round it
  const cx = W / 2;
  const cy = H / 2;
  g.fillStyle = '#6d0c15';
  g.beginPath();
  g.ellipse(cx, cy, 48 * u, 62 * u, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f7f3ea';
  g.lineWidth = 3 * u;
  g.stroke();
  g.lineWidth = 1.2 * u;
  g.beginPath();
  g.ellipse(cx, cy, 41 * u, 55 * u, 0, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f7f3ea';
  const pips: [keyof typeof SUIT_PATHS, number, number][] = [['s', 0, -30], ['h', 22, 0], ['c', 0, 30], ['d', -22, 0]];
  for (const [suit, dx, dy] of pips) {
    g.save();
    g.translate(cx + dx * u, cy + dy * u);
    g.scale(0.034 * u, 0.034 * u);
    g.fill(new Path2D(SUIT_PATHS[suit]));
    g.restore();
  }
}

/**
 * A face as a picture for the DOM (the video poker screen, the Pai Gow setter): the deck in use,
 * once loadCards() has run, else the deck's own file. Listen with onDeck() to follow a change.
 */
export function cardFaceUrl(card: Card | null): string {
  if (!card) return backUrl ?? `${base}assets/cards/back-red.svg`;
  return urls.get(card) ?? `${base}assets/cards/${card}.svg`;
}

// ---- the card --------------------------------------------------------------------------------

/**
 * A card's shape: the face (+y) and back (-y) cut to the deck's rounded corners, and the paper's
 * edge round them, in three groups (edge, face, back: one draw each, where a box took six). The
 * groups keep the box's material slots (0 the edge, 2 the face, 3 the back), so code that reaches
 * a card's face as `material[2]` still does. UVs as the box had them: the face's top toward -z.
 */
export function cardGeometry(w = CARD_W, h = CARD_H, t = THICK, corner = CORNER, seg = 5): THREE.BufferGeometry {
  const ring: { x: number; z: number; nx: number; nz: number }[] = [];
  const cx = w / 2 - corner;
  const cz = h / 2 - corner;
  for (const [ox, oz, a0] of [[cx, cz, 0], [-cx, cz, 90], [-cx, -cz, 180], [cx, -cz, 270]] as const) {
    for (let i = 0; i <= seg; i++) {
      const a = THREE.MathUtils.degToRad(a0 + (90 * i) / seg);
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      ring.push({ x: ox + corner * nx, z: oz + corner * nz, nx, nz });
    }
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const n = ring.length;
  // the edge: a band round the outline, normals out from the corners' centres
  for (const p of ring) {
    pos.push(p.x, -t / 2, p.z, p.x, t / 2, p.z);
    nor.push(p.nx, 0, p.nz, p.nx, 0, p.nz);
    uv.push(0, 0, 0, 1);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const edgeCount = index.length;
  // the face (+y) and the back (-y): a fan round the middle
  const fan = (y: number, ny: number, v: (z: number) => number) => {
    const c = pos.length / 3;
    pos.push(0, y, 0);
    nor.push(0, ny, 0);
    uv.push(0.5, v(0));
    for (const p of ring) {
      pos.push(p.x, y, p.z);
      nor.push(0, ny, 0);
      uv.push(p.x / w + 0.5, v(p.z));
    }
    for (let i = 0; i < n; i++) {
      const a = c + 1 + i;
      const b = c + 1 + ((i + 1) % n);
      // counter-clockwise seen from the side it faces
      if (ny > 0) index.push(c, b, a);
      else index.push(c, a, b);
    }
  };
  fan(t / 2, 1, (z) => 0.5 - z / h);
  const faceCount = index.length - edgeCount;
  fan(-t / 2, -1, (z) => 0.5 + z / h);
  const backCount = index.length - edgeCount - faceCount;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.addGroup(0, edgeCount, 0);
  g.addGroup(edgeCount, faceCount, 2);
  g.addGroup(edgeCount + faceCount, backCount, 3);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const geometry = cardGeometry();
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

// ---- the shadow under a card -------------------------------------------------------------------

/** How far a card's shadow reaches past its edge, m. */
const SHADOW_REACH = 0.006;

let cardShadow: ShadowShape | null = null;
/** The soft shadow a card casts on the felt (shadow.ts), the same for every card. */
function shadowShape(): ShadowShape {
  return (cardShadow ??= {
    geometry: shadowPlane(CARD_W, CARD_H, SHADOW_REACH),
    alpha: softRect(CARD_W, CARD_H, CORNER, SHADOW_REACH),
    strength: 0.36,
    follow: 'card',
    under: THICK / 2,
  });
}

/** A card mesh. Face up means the face points +Y (toward a camera above the table). */
export class CardMesh extends THREE.Mesh {
  card: Card | null;
  constructor(card: Card | null) {
    const face = new THREE.MeshStandardMaterial({ map: card ? textures.get(card) ?? null : backTex, roughness: 0.55 });
    holdContrast(face);
    const back = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.55 });
    // material slots as a box had them (+x, -x, +y, -y, +z, -z): the edge in 0, the face in 2
    // (+y), the back in 3 (-y). rotation.x = 0 is face up and rotation.x = PI is face down.
    super(geometry, [edge, edge, face, back, edge, edge]);
    this.card = card;
    this.rotation.x = Math.PI;
    this.add(new GroundShadow(this, shadowShape()));
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

/**
 * Slide a card from `from` to `to` (local positions) along a low arc, optionally turning it over.
 * The arc rises with the distance (a flick across the table goes higher than a card pushed along),
 * and the card turns a little on the way and settles square as it lands. Calm (Reduce flashing &
 * motion): a lower arc and no turn.
 */
export async function dealCard(mesh: CardMesh, from: THREE.Vector3, to: THREE.Vector3, opts: { faceUp: boolean; ms?: number; yaw?: number }): Promise<void> {
  const ms = opts.ms ?? 320;
  const startYaw = mesh.rotation.y;
  const endYaw = opts.yaw ?? 0;
  const startFlip = mesh.rotation.x;
  const endFlip = opts.faceUp ? 0 : Math.PI;
  const still = calm();
  const reach = Math.hypot(to.x - from.x, to.z - from.z);
  const lift = still ? Math.min(0.012, 0.004 + reach * 0.01) : Math.min(0.05, 0.012 + reach * 0.045);
  // a quarter-turn's worth of flick for a long throw, none for a nudge
  const spin = still || reach < 0.08 ? 0 : Math.min(0.32, reach * 0.4) * (to.x >= from.x ? 1 : -1);
  mesh.position.copy(from);
  await tween(ms, (k) => {
    mesh.position.lerpVectors(from, to, k);
    mesh.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * lift;
    mesh.rotation.y = startYaw + (endYaw - startYaw) * k + spin * Math.sin(Math.PI * k) * (1 - k);
    turn(mesh, startFlip, endFlip, k);
  }, ease.out);
  mesh.rotation.y = endYaw;
  turn(mesh, startFlip, endFlip, 1);
}

/**
 * v7.1: a card turns over sideways, about its long edge, as a dealer turns one (not end over end).
 * The resting states stay rotation.x = 0 (face up) and PI (face down): mid-turn the turn is about
 * the card's own z (its length), and at the end it's handed back to x (a face-down back looks the
 * same either way).
 */
function turn(mesh: CardMesh, from: number, to: number, k: number): void {
  if (Math.abs(to - from) < 1e-6) {
    mesh.rotation.x = to;
    mesh.rotation.z = 0;
    return;
  }
  if (k >= 1) {
    mesh.rotation.x = to;
    mesh.rotation.z = 0;
    return;
  }
  mesh.rotation.x = 0;
  mesh.rotation.z = from + (to - from) * k;
}

/** Flip a card in place: it lifts as it turns, clear of the cards around it (less when calm). */
export async function flipCard(mesh: CardMesh, faceUp = true, ms = 220): Promise<void> {
  const y0 = mesh.position.y;
  const a = mesh.rotation.x;
  const b = faceUp ? 0 : Math.PI;
  const lift = calm() ? 0.012 : 0.032;
  await tween(ms, (k) => {
    turn(mesh, a, b, k);
    mesh.position.y = y0 + Math.sin(Math.PI * k) * lift;
  }, ease.inOut);
  turn(mesh, a, b, 1);
  mesh.position.y = y0;
}
