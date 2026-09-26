// v7.2: the apartment's surfaces and the pieces in it that move.
//
// The surfaces are drawn on canvases from a seed, so they look the same every visit, and they tile
// (the kit projects them onto every box, a repeat every so many metres): wood grain for the oak and
// the walnut, a woven cloth for the linen, the velvet and the sheets, grained leather, plaster for
// the walls and ceiling, a veined stone and brushed metal. Each is grey, a little under white, and
// the material's colour tints it, so one canvas serves every shade of it. Drawn once, shared by
// every apartment and both graphics settings.
//
// The pieces that move: the television's picture (the casino's own channel: the wheel, the reels,
// the night's big wins), the fish in the aquarium, and a Persian rug laid as one piece, its
// medallion in the middle whatever the floor's projection would have done to it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../city/sky.ts';
import { canvas, grain } from '../textures.ts';
import { canvasTexture } from '../carpet.ts';

/**
 * Draw something again a whole canvas over wherever it crosses an edge, so it comes in at the other
 * (it tiles). `at` and `r`: where it is and how far it reaches (without them, all nine copies).
 */
function wrapped(size: number, draw: (dx: number, dy: number) => void, at?: { x: number; y: number; r: number }): void {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      if (at && (at.x + dx + at.r < 0 || at.x + dx - at.r > size || at.y + dy + at.r < 0 || at.y + dy - at.r > size)) continue;
      draw(dx, dy);
    }
  }
}

/** Wood: long grain lines that wave along the board, darker bands of latewood, a few pores. */
export function drawGrain(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = 'rgb(228,228,228)';
  ctx.fillRect(0, 0, size, size);
  // broad soft bands first, then the fine lines over them; each wave has a whole number of periods
  // across the canvas, so a line leaves one edge where it came in at the other
  const line = (y0: number, amp: number, k: number, phase: number, width: number, style: string) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      for (let x = 0; x <= size; x += size / 64) {
        const y = y0 + amp * Math.sin((x / size) * Math.PI * 2 * k + phase) + (amp / 3) * Math.sin((x / size) * Math.PI * 2 * (k + 2) + phase * 1.7);
        if (x === 0) ctx.moveTo(x + dx, y + dy);
        else ctx.lineTo(x + dx, y + dy);
      }
      ctx.stroke();
    });
  };
  for (let i = 0; i < 9; i++) line(rand() * size, size * (0.01 + rand() * 0.025), 1 + Math.floor(rand() * 2), rand() * 6.28, size * (0.02 + rand() * 0.05), `rgba(90,90,90,${0.08 + rand() * 0.1})`);
  for (let i = 0; i < 90; i++) line(rand() * size, size * (0.006 + rand() * 0.02), 1 + Math.floor(rand() * 3), rand() * 6.28, Math.max(1, size / 512) * (0.6 + rand()), `rgba(60,60,60,${0.1 + rand() * 0.22})`);
  // pores: short dark dashes along the grain
  for (let i = 0; i < size * 1.5; i++) {
    ctx.fillStyle = `rgba(40,40,40,${0.12 + rand() * 0.2})`;
    ctx.fillRect(rand() * size, rand() * size, size / 160 + rand() * (size / 80), Math.max(1, size / 700));
  }
  grain(ctx, size, size, 0.06, rand);
  return c;
}

/** Cloth: threads over and under in a plain weave, a slub here and there, a soft fibre noise. */
export function drawWeave(size: number, seed: number, threads = 64): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = 'rgb(222,222,222)';
  ctx.fillRect(0, 0, size, size);
  const t = size / threads;
  // each square a shade of its own, flat; then the threads' shading over all of them at once: a
  // tile of four squares (warp, weft, weft, warp), each darker at its thread's edges, as a pattern
  for (let i = 0; i < threads; i++) {
    for (let j = 0; j < threads; j++) {
      const k = Math.round(214 + rand() * 30);
      ctx.fillStyle = `rgb(${k},${k},${k})`;
      ctx.fillRect(i * t, j * t, t, t);
    }
  }
  const [tile, g] = canvas(Math.max(2, Math.round(2 * t)));
  const u = tile.width / 2;
  for (const [x, y, warp] of [[0, 0, true], [u, 0, false], [0, u, false], [u, u, true]] as const) {
    const sh = warp ? g.createLinearGradient(x, 0, x + u, 0) : g.createLinearGradient(0, y, 0, y + u);
    sh.addColorStop(0, 'rgb(215,215,215)');
    sh.addColorStop(0.5, 'rgb(255,255,255)');
    sh.addColorStop(1, 'rgb(215,215,215)');
    g.fillStyle = sh;
    g.fillRect(x, y, u, u);
  }
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  // slubs: a thread a shade darker for a run
  for (let i = 0; i < threads / 3; i++) {
    ctx.fillStyle = `rgba(80,80,80,${0.06 + rand() * 0.08})`;
    if (rand() < 0.5) ctx.fillRect(0, Math.floor(rand() * threads) * t, size, t);
    else ctx.fillRect(Math.floor(rand() * threads) * t, 0, t, size);
  }
  grain(ctx, size, size, 0.1, rand);
  return c;
}

/** Leather: a pebbled grain, small irregular cells with fine creases between them. */
export function drawLeather(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = 'rgb(210,210,210)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 4; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size / 260 + rand() * (size / 160);
    const k = 214 + rand() * 36;
    wrapped(
      size,
      (dx, dy) => {
        const g = ctx.createRadialGradient(x + dx - r * 0.3, y + dy - r * 0.3, 0, x + dx, y + dy, r);
        g.addColorStop(0, `rgba(${k},${k},${k},0.7)`);
        g.addColorStop(1, 'rgba(170,170,170,0.18)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      },
      { x, y, r },
    );
  }
  // creases
  ctx.strokeStyle = 'rgba(90,90,90,0.16)';
  ctx.lineWidth = Math.max(1, size / 600);
  for (let i = 0; i < 70; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI * 2;
    const l = size * (0.03 + rand() * 0.08);
    wrapped(
      size,
      (dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.quadraticCurveTo(x + dx + Math.cos(a + 0.6) * l * 0.5, y + dy + Math.sin(a + 0.6) * l * 0.5, x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
        ctx.stroke();
      },
      { x, y, r: l },
    );
  }
  grain(ctx, size, size, 0.08, rand);
  return c;
}

/** Plaster: near white with a fine grit, and the faintest unevenness where the trowel went. */
export function drawPlaster(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = 'rgb(246,246,246)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.08 + rand() * 0.16);
    wrapped(size, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  grain(ctx, size, size, 0.03, rand);
  return c;
}

/** Stone: pale, with soft grey veins that branch, and a few fine ones. */
export function drawVeined(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = 'rgb(240,240,238)';
  ctx.fillRect(0, 0, size, size);
  const vein = (x: number, y: number, a: number, len: number, w: number, alpha: number, depth: number) => {
    let px = x;
    let py = y;
    ctx.strokeStyle = `rgba(110,110,116,${alpha})`;
    ctx.lineWidth = w;
    const steps = 18;
    const pts: [number, number][] = [[px, py]];
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 0.7;
      px += Math.cos(a) * (len / steps);
      py += Math.sin(a) * (len / steps);
      pts.push([px, py]);
      if (depth > 0 && rand() < 0.08) vein(px, py, a + (rand() < 0.5 ? 0.8 : -0.8), len * 0.4, w * 0.6, alpha * 0.8, depth - 1);
    }
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      pts.forEach(([u, v], i) => (i ? ctx.lineTo(u + dx, v + dy) : ctx.moveTo(u + dx, v + dy)));
      ctx.stroke();
    });
  };
  ctx.filter = `blur(${Math.max(1, size / 256)}px)`;
  for (let i = 0; i < 5; i++) vein(rand() * size, rand() * size, rand() * 6.28, size * (0.6 + rand() * 0.5), size / 90, 0.35, 2);
  ctx.filter = 'none';
  for (let i = 0; i < 12; i++) vein(rand() * size, rand() * size, rand() * 6.28, size * 0.3, Math.max(1, size / 500), 0.3, 0);
  grain(ctx, size, size, 0.04, rand);
  return c;
}

/** Brushed metal: fine streaks all one way, a little uneven. */
export function drawBrushed(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = 'rgb(232,232,232)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 1.2; i++) {
    const k = 180 + rand() * 75;
    ctx.fillStyle = `rgba(${k},${k},${k},0.35)`;
    const y = rand() * size;
    const x = rand() * size;
    const l = size * (0.2 + rand() * 0.8);
    ctx.fillRect(x, y, l, Math.max(1, size / 512));
    ctx.fillRect(x - size, y, l, Math.max(1, size / 512));
  }
  return c;
}

const cache = new Map<string, THREE.CanvasTexture>();

/** One of the surfaces as a repeating texture (drawn the first time it's asked for). */
export function surface(kind: 'grain' | 'weave' | 'weave-fine' | 'leather' | 'plaster' | 'veined' | 'brushed' | 'felt'): THREE.CanvasTexture {
  let t = cache.get(kind);
  if (t) return t;
  const c =
    kind === 'grain' ? drawGrain(512, 7)
    : kind === 'weave' ? drawWeave(512, 11, 64)
    : kind === 'weave-fine' ? drawWeave(512, 13, 128)
    : kind === 'felt' ? drawWeave(256, 17, 128)
    : kind === 'leather' ? drawLeather(512, 19)
    : kind === 'plaster' ? drawPlaster(512, 23)
    : kind === 'veined' ? drawVeined(512, 29)
    : drawBrushed(512, 31);
  t = canvasTexture(c, 4);
  t.name = `home-${kind}`;
  cache.set(kind, t);
  return t;
}

// --- a Persian rug --------------------------------------------------------------------------------

/**
 * A Persian rug `w` by `h` px: a red field with a lattice of small flowers, a lobed medallion in
 * navy, cream and gold in the middle, quarter medallions in the corners, and a navy border between
 * cream guard stripes with rosettes along it. Wool: a little uneven (abrash) and fibrous.
 */
export function drawPersian(w: number, h: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const rand = rng(seed);
  const RED = '#7e1c1c';
  const NAVY = '#1b2744';
  const CREAM = '#e6d6b0';
  const GOLD = '#c8963e';
  const TEAL = '#2c6464';
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, w, h);
  // abrash: bands where the dye lot changed
  for (let y = 0; y < h; y += h / 24) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,220,200'},${rand() * 0.06})`;
    ctx.fillRect(0, y, w, h / 24);
  }
  const b = Math.min(w, h) * 0.12;
  // the field's lattice of small flowers
  for (let x = b + 20; x < w - b; x += 34) {
    for (let y = b + 20; y < h - b; y += 34) {
      const off = (Math.round((y - b) / 34) % 2) * 17;
      ctx.fillStyle = (x + y) % 3 === 0 ? GOLD : CREAM;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(x + off, y - 5);
      ctx.lineTo(x + off + 5, y);
      ctx.lineTo(x + off, y + 5);
      ctx.lineTo(x + off - 5, y);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  const lobed = (cx: number, cy: number, rx: number, ry: number, lobes: number, depth: number, fill: string, from = 0, to = Math.PI * 2) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const a = from + ((to - from) * i) / 160;
      const r = 1 - depth + depth * Math.abs(Math.cos((a * lobes) / 2));
      const x = cx + Math.cos(a) * rx * r;
      const y = cy + Math.sin(a) * ry * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if (to - from < Math.PI * 2) ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  };
  // the medallion: rings of lobes, each a colour, a star at its heart
  const mx = w / 2;
  const my = h / 2;
  const R = Math.min(w, h) * 0.3;
  lobed(mx, my, R * 1.35, R, 16, 0.18, NAVY);
  lobed(mx, my, R * 1.2, R * 0.88, 16, 0.18, CREAM);
  lobed(mx, my, R * 1.08, R * 0.78, 12, 0.22, RED);
  lobed(mx, my, R * 0.8, R * 0.58, 8, 0.3, TEAL);
  lobed(mx, my, R * 0.55, R * 0.4, 8, 0.35, GOLD);
  lobed(mx, my, R * 0.3, R * 0.22, 8, 0.5, NAVY);
  // pendants off the medallion's ends
  for (const s of [-1, 1]) lobed(mx + s * R * 1.55, my, R * 0.22, R * 0.3, 6, 0.3, NAVY);
  // quarter medallions in the corners
  for (const [cx, cy, from] of [
    [b, b, 0],
    [w - b, b, Math.PI / 2],
    [w - b, h - b, Math.PI],
    [b, h - b, Math.PI * 1.5],
  ] as const) {
    lobed(cx, cy, R * 0.75, R * 0.6, 8, 0.2, NAVY, from, from + Math.PI / 2);
    lobed(cx, cy, R * 0.5, R * 0.4, 8, 0.25, CREAM, from, from + Math.PI / 2);
  }
  // the border: cream guards, a navy band with rosettes
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, w, b);
  ctx.fillRect(0, h - b, w, b);
  ctx.fillRect(0, 0, b, h);
  ctx.fillRect(w - b, 0, b, h);
  const g = b * 0.14;
  ctx.fillStyle = NAVY;
  ctx.fillRect(g, g, w - 2 * g, b - 2 * g);
  ctx.fillRect(g, h - b + g, w - 2 * g, b - 2 * g);
  ctx.fillRect(g, g, b - 2 * g, h - 2 * g);
  ctx.fillRect(w - b + g, g, b - 2 * g, h - 2 * g);
  const rosette = (x: number, y: number) => {
    lobed(x, y, b * 0.28, b * 0.28, 8, 0.4, GOLD);
    lobed(x, y, b * 0.13, b * 0.13, 8, 0.4, RED);
  };
  for (let x = b * 0.5; x < w; x += b * 0.9) {
    rosette(x, b / 2);
    rosette(x, h - b / 2);
  }
  for (let y = b * 1.4; y < h - b; y += b * 0.9) {
    rosette(b / 2, y);
    rosette(w - b / 2, y);
  }
  // wool: fibres and wear
  grain(ctx, w, h, 0.2, rand);
  return c;
}

let persianTex: THREE.CanvasTexture | null = null;

/** The Persian rug laid flat, `w` by `d` metres, its middle at the origin (the caller places it). */
export function persianRug(w: number, d: number): THREE.Mesh {
  if (!persianTex) {
    persianTex = canvasTexture(drawPersian(1024, Math.round((1024 * 3) / 4.2), 37), 8);
    persianTex.wrapS = persianTex.wrapT = THREE.ClampToEdgeWrapping;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: persianTex, roughness: 1, metalness: 0 }));
  mesh.name = 'home:persian';
  mesh.receiveShadow = true;
  return mesh;
}

// --- the television's picture ------------------------------------------------------------------------

/** The reels' symbols, the night's big wins, the news along the foot. */
const REEL = ['7', 'BAR', '$', '★', '♦'];
const BIG_WINS: readonly (readonly [string, string])[] = [
  ['BLACKJACK', '$25,000'],
  ['CRAPS', '$118,400'],
  ['GOLD RUSH SLOTS', '$1,250,000'],
  ['BACCARAT', '$62,500'],
  ['ROULETTE · 17', '$350,000'],
  ['HIGH LIMIT', '$4,000,000'],
  ['VIDEO POKER · ROYAL', '$400,000'],
];
const NEWS = 'CASINO TONIGHT  ·  HAPPY HOUR AT THE BAR  ·  THE HIGH LIMIT SALON IS OPEN  ·  ACE ARMS ACROSS THE STREET  ·  ';

/** Frames a second the picture is drawn at (it's a television across the room, not the game). */
const TV_FPS = 12;
/** Seconds each programme runs before the next. */
const SHOW_S = 7;

/**
 * The casino channel: a roulette wheel spinning down to a number, three reels stopping on sevens,
 * and the night's big wins scrolling by. `draw(t)` paints the frame for `t` seconds in.
 */
export class Channel {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private t = 0;
  private since = 1;
  /** The news line's width, measured once. */
  private newsW = 0;

  constructor(
    private readonly w = 512,
    private readonly h = 288,
  ) {
    const [c, ctx] = canvas(w, h);
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw();
  }

  update(dt: number): void {
    this.t += dt;
    this.since += dt;
    if (this.since < 1 / TV_FPS) return;
    this.since = 0;
    this.draw();
    this.texture.needsUpdate = true;
  }

  private draw(): void {
    const { ctx, w, h } = this;
    const show = Math.floor(this.t / SHOW_S) % 3;
    const s = this.t % SHOW_S;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, show === 1 ? '#2a0a3a' : show === 2 ? '#0a1a2e' : '#062016');
    bg.addColorStop(1, '#050505');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (show === 0) this.wheel(s);
    else if (show === 1) this.reels(s);
    else this.wins(s);
    // the channel's bug in the corner, and a line of news along the foot
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - 30, w, 30);
    ctx.fillStyle = '#e8c068';
    ctx.font = '600 16px "Barlow Condensed", sans-serif';
    ctx.textBaseline = 'middle';
    this.newsW ||= ctx.measureText(NEWS).width || 1;
    const scroll = (this.t * 60) % this.newsW;
    ctx.fillText(NEWS + NEWS, 10 - scroll, h - 15);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '700 14px "Barlow Condensed", sans-serif';
    ctx.fillText('CASINO TV', w - 84, 20);
  }

  /** The wheel slowing to a stop, the ball on its number, and the number called. */
  private wheel(s: number): void {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2 - 12;
    const r = h * 0.38;
    const spin = s < 5 ? 3.2 * (5 - s) * (5 - s) * 0.5 : 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    const n = 38;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i === 0 || i === 19 ? '#1e8a3a' : i % 2 ? '#b01a22' : '#141414';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#6a4424';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d8b050';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // the ball
    const ba = -spin * 1.6 - 1.2;
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ba) * r * 0.86, cy + Math.sin(ba) * r * 0.86, 5, 0, Math.PI * 2);
    ctx.fill();
    if (s > 5) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 44px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('17 BLACK', cx, cy);
      ctx.textAlign = 'left';
    }
  }

  /** Three reels spinning, stopping one after another on sevens, the win flashing. */
  private reels(s: number): void {
    const { ctx, w, h } = this;
    const cw = w * 0.22;
    for (let i = 0; i < 3; i++) {
      const x = w / 2 + (i - 1) * (cw + 12) - cw / 2;
      const y = 40;
      ctx.fillStyle = '#f2ede0';
      ctx.fillRect(x, y, cw, h - 110);
      const stop = 2 + i * 0.9;
      const roll = s < stop ? s * 14 : 0;
      ctx.fillStyle = s >= stop ? '#c0141e' : '#303030';
      ctx.font = '800 64px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const sym = s >= stop ? '7' : REEL[Math.floor(roll) % REEL.length]!;
      ctx.fillText(sym, x + cw / 2, y + (h - 110) / 2 + (s < stop ? ((roll % 1) - 0.5) * 60 : 0));
    }
    if (s > 4.8 && Math.floor(s * 4) % 2 === 0) {
      ctx.fillStyle = '#ffd24a';
      ctx.font = '800 36px "Barlow Condensed", sans-serif';
      ctx.fillText('JACKPOT', w / 2, h - 52);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** The night's big wins, rolling up the screen. */
  private wins(s: number): void {
    const { ctx, w } = this;
    ctx.fillStyle = '#e8c068';
    ctx.font = '700 26px "Barlow Condensed", sans-serif';
    ctx.fillText("TONIGHT'S BIG WINS", 24, 40);
    ctx.font = '600 22px "Barlow Condensed", sans-serif';
    const off = s * 18;
    BIG_WINS.forEach(([what, amount], i) => {
      const y = 84 + i * 34 - off;
      if (y < 56 || y > 250) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(what, 24, y);
      ctx.fillStyle = '#7de0a0';
      ctx.fillText(amount, w - 24 - ctx.measureText(amount).width, y);
    });
  }

  dispose(): void {
    this.texture.dispose();
  }
}

// --- the aquarium's fish ----------------------------------------------------------------------------

/** One fish: a body tapering to a tail, flattened side to side, nose to +x, `len` long. */
function fishGeometry(len: number): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(len * 0.32, 10, 8);
  body.scale(1.5, 1, 0.45);
  const tail = new THREE.ConeGeometry(len * 0.22, len * 0.36, 4);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 1, 0.3);
  tail.translate(-len * 0.58, 0, 0);
  const g = mergeGeometries([body.toNonIndexed(), tail.toNonIndexed()], false)!;
  body.dispose();
  tail.dispose();
  return g;
}

/**
 * The aquarium's fish, swimming: each on its own slow loop through the tank (w by h by d metres,
 * its floor at the origin), turning to face where it's going, a flick of the tail as it goes; with
 * sharks, two big grey ones cruising the length of it. A stream of bubbles from the back corner.
 * One instanced mesh for the fish, one for the sharks, one for the bubbles.
 */
export class School {
  readonly group = new THREE.Group();
  private readonly fish: THREE.InstancedMesh;
  private readonly sharks: THREE.InstancedMesh | null;
  private readonly bubbles: THREE.InstancedMesh;
  private readonly paths: { a: number; b: number; c: number; speed: number; phase: number; y: number }[] = [];
  private t = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  constructor(
    private readonly w: number,
    private readonly h: number,
    private readonly d: number,
    count: number,
    sharks: boolean,
  ) {
    const rand = rng(Math.round(w * 100 + count));
    const colours = ['#ff8a2a', '#ffd23a', '#3ab8ff', '#ff4a8a', '#f4f4f4', '#7aff9a'];
    this.fish = new THREE.InstancedMesh(fishGeometry(0.14), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2, emissive: '#101820' }), count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.fish.setColorAt(i, c.set(colours[i % colours.length]!));
      this.paths.push({ a: 0.3 + rand() * 0.2, b: 0.2 + rand() * 0.25, c: 0.15 + rand() * 0.2, speed: 0.25 + rand() * 0.35, phase: rand() * 6.28, y: 0.2 + rand() * 0.6 });
    }
    this.fish.frustumCulled = false;
    this.group.add(this.fish);
    this.sharks = sharks ? new THREE.InstancedMesh(fishGeometry(0.9), new THREE.MeshStandardMaterial({ color: '#7a8490', roughness: 0.5, metalness: 0.1 }), 2) : null;
    if (this.sharks) {
      this.sharks.frustumCulled = false;
      this.group.add(this.sharks);
    }
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: '#dff4ff', transparent: true, opacity: 0.7 }), 18);
    this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);
    this.update(0);
  }

  update(dt: number): void {
    this.t += dt;
    const { w, h, d } = this;
    const t = this.t;
    for (let i = 0; i < this.paths.length; i++) {
      const f = this.paths[i]!;
      const u = t * f.speed + f.phase;
      // a lazy figure of eight through the tank
      const x = Math.sin(u) * (w / 2 - 0.25) * f.a * 2;
      const z = Math.sin(u * 2) * (d / 2 - 0.08) * f.c * 2;
      const y = h * f.y + Math.sin(u * 1.3) * h * 0.08;
      const dx = Math.cos(u) * f.a;
      const dz = Math.cos(u * 2) * f.c;
      this.e.set(0, Math.atan2(-dz, dx), Math.sin(t * 9 + i) * 0.12, 'YXZ');
      this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e), this.s.set(1, 1, 1));
      this.fish.setMatrixAt(i, this.m);
    }
    this.fish.instanceMatrix.needsUpdate = true;
    if (this.sharks) {
      for (let i = 0; i < 2; i++) {
        const u = t * 0.12 + i * Math.PI;
        const x = Math.sin(u) * (w / 2 - 0.9);
        const y = h * (0.4 + i * 0.25);
        this.e.set(0, Math.cos(u) >= 0 ? 0 : Math.PI, Math.sin(t * 2 + i) * 0.05, 'YXZ');
        this.m.compose(this.p.set(x, y, (i - 0.5) * d * 0.3), this.q.setFromEuler(this.e), this.s.set(1, 1, 1));
        this.sharks.setMatrixAt(i, this.m);
      }
      this.sharks.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < 18; i++) {
      const k = ((t * 0.35 + i / 18) % 1) * h;
      this.m.compose(this.p.set(w / 2 - 0.2 + Math.sin(t * 3 + i) * 0.02, k, -d / 2 + 0.1), this.q.identity(), this.s.set(1, 1, 1));
      this.bubbles.setMatrixAt(i, this.m);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.fish, this.sharks, this.bubbles]) {
      if (!m) continue;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
    this.group.removeFromParent();
  }
}
