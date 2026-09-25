// What makes one of the later machines look like itself: its cabinet's measurements and palette,
// its symbols and printed glass, its meters and (on the 5-reel machines) its screen overlay. Each
// machine file (diamonds.ts, cherries.ts, goldrush.ts) exports a Skin; build.ts turns one into a
// cabinet and play.ts plays it. The painters shared by all three live here.

import type * as THREE from 'three';
import type { ReelLook } from './reels.ts';
import { REGIONS, BUTTONS, type DeckButton, type Rect } from './glass.ts';
import { segText } from './segments.ts';

export type SkinId = 'diamonds' | 'cherries' | 'goldrush';
export type ZY = [z: number, y: number];
type G = CanvasRenderingContext2D;

export interface SkinLayout {
  width: number;
  /** Side profile as (z, y), extruded across the width. */
  profile: ZY[];
  bevel: number;
  body: { color: string; metalness: number; roughness: number };
  trim: { color: string; metalness: number; roughness: number };
  /** The bezel plate that frames the reels and meters; the window is cut through it. */
  plate: { w: number; h: number; cy: number; zBack: number; depth: number };
  window: { w: number; h: number; cy: number };
  reels: { count: number; pitch: number; look: ReelLook; zFront: number; rows: number };
  meters: { w: number; h: number; cy: number };
  /** The top box's front face: bottom and top edge as (z, y). */
  pay: { bottom: ZY; top: ZY; w: number; h: number };
  belly: { w: number; h: number; cy: number; z: number };
  deck: { front: ZY; back: ZY; xs: number[]; bw: number; bh: number };
  /** Height of the cabinet's top, where the topper sits. */
  top: number;
  candle: [x: number, y: number, z: number];
  lever: boolean;
}

/** Geometry a skin adds for its topper, in cabinet coordinates. */
export interface TopperParts {
  body: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  /** uvs point into the atlas (REGIONS.topper and the swatches). */
  printed: THREE.BufferGeometry[];
  bulbs: { spots: THREE.Vector3[]; colors: THREE.Color[]; radius: number };
  /** Vertex-coloured glow strips, if any. */
  leds?: THREE.BufferGeometry;
}

export interface MeterTheme {
  ground: string;
  label: string;
  digit: string;
  frame: string;
  labels: [credit: string, bet: string, win: string];
}

export interface Skin {
  id: SkinId;
  layout: SkinLayout;
  meter: MeterTheme;
  /** A reel stop's cell on the strip texture, px at scale 1. */
  cell: { w: number; h: number };
  /** Symbol height as a share of the cell (a stepper symbol spills over the blanks beside it). */
  symbolScale: number;
  stripGround: string;
  /** What the reels' shader multiplies the strip by (a warm or cool light behind the glass). */
  tint: string;
  /** Deck buttons: face and ink for PAYS, BET ONE, MAX BET and SPIN. */
  buttons: Record<DeckButton, [face: string, ink: string]>;
  drawSymbol(g: G, sym: string, w: number, h: number): void;
  paintPay(g: G, w: number, h: number): void;
  paintBelly(g: G, w: number, h: number): void;
  paintTopper(g: G, w: number, h: number): void;
  topper(l: SkinLayout): TopperParts;
}

// ---------------------------------------------------------------------------------------------
// small canvas helpers

export function roundRect(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function rays(g: G, cx: number, cy: number, n: number, r: number, color: string): void {
  g.save();
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + Math.PI / n;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    g.closePath();
    g.fill();
  }
  g.restore();
}

export function text(g: G, s: string, x: number, y: number, font: string, fill: string | CanvasGradient, opts: { align?: CanvasTextAlign; stroke?: string; strokeWidth?: number; glow?: string } = {}): void {
  g.save();
  g.font = font;
  g.textAlign = opts.align ?? 'center';
  g.textBaseline = 'middle';
  if (opts.glow) {
    g.shadowColor = opts.glow;
    g.shadowBlur = 14;
  }
  if (opts.stroke) {
    g.lineJoin = 'round';
    g.lineWidth = opts.strokeWidth ?? 6;
    g.strokeStyle = opts.stroke;
    g.strokeText(s, x, y);
  }
  g.fillStyle = fill;
  g.fillText(s, x, y);
  g.restore();
}

export function disclaimers(g: G, w: number, y: number, color: string, size = 16): void {
  text(g, 'MALFUNCTION VOIDS ALL PAYS AND PLAYS', w / 2, y, `600 ${size}px 'Barlow Condensed', sans-serif`, color);
}

// ---------------------------------------------------------------------------------------------
// the atlas: pay glass, belly glass, topper face, deck buttons and two swatches, in the same
// regions as the first three machines (glass.ts), so buttonAtUv() reads the deck of any of them

function clipTo(g: G, r: Rect, paint: () => void): void {
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.translate(r.x, r.y);
  paint();
  g.restore();
}

function deckButton(g: G, r: Rect, colors: [string, string], label: string): void {
  const [face, ink] = colors;
  g.fillStyle = '#121112';
  g.fillRect(r.x, r.y, r.w, r.h);
  roundRect(g, r.x + 6, r.y + 6, r.w - 12, r.h - 12, 10);
  g.fillStyle = face;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 3;
  roundRect(g, r.x + 12, r.y + 12, r.w - 24, r.h - 24, 7);
  g.stroke();
  text(g, label, r.x + r.w / 2, r.y + r.h / 2 + 2, `600 36px 'Barlow Condensed', sans-serif`, ink);
}

export const ATLAS = { w: 2048, h: 1024 };

export function paintSkinAtlas(canvas: HTMLCanvasElement, skin: Skin, scale: number): void {
  canvas.width = Math.round(ATLAS.w * scale);
  canvas.height = Math.round(ATLAS.h * scale);
  const g = canvas.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, ATLAS.w, ATLAS.h);
  const P = REGIONS;
  clipTo(g, P.pay, () => skin.paintPay(g, P.pay.w, P.pay.h));
  clipTo(g, P.belly, () => skin.paintBelly(g, P.belly.w, P.belly.h));
  clipTo(g, P.topper, () => skin.paintTopper(g, P.topper.w, P.topper.h));
  const video = skin.layout.reels.count > 3;
  BUTTONS.forEach((b, i) => deckButton(g, P.buttons[i]!, skin.buttons[b.id], video && b.id === 'betOne' ? 'BET +1' : b.label));
  g.fillStyle = '#050505';
  g.fillRect(P.black.x, P.black.y, P.black.w, P.black.h);
  g.fillStyle = skin.stripGround;
  g.fillRect(P.dark.x, P.dark.y, P.dark.w, P.dark.h);
}

// ---------------------------------------------------------------------------------------------
// reel strips: every reel of the machine side by side on one canvas (bank.ts reads its column)

export interface StripSource {
  /** Symbols per stop, per reel. */
  strips: readonly (readonly string[])[];
  /** Symbols not to draw (a stepper's blanks). */
  skip?: string;
}

export function paintStrips(skin: Skin, src: StripSource, scale: number): HTMLCanvasElement {
  const w = Math.round(skin.cell.w * scale);
  const h = Math.round(skin.cell.h * scale);
  const stops = src.strips[0]!.length;
  const canvas = document.createElement('canvas');
  canvas.width = w * src.strips.length;
  canvas.height = h * stops;
  const g = canvas.getContext('2d')!;
  g.fillStyle = skin.stripGround;
  g.fillRect(0, 0, canvas.width, canvas.height);
  src.strips.forEach((strip, r) => {
    g.save();
    g.beginPath();
    g.rect(r * w, 0, w, canvas.height);
    g.clip();
    // a symbol taller than its cell spills into the next ones; draw it a strip-length above and
    // below too so the wrap at stop 0 is seamless
    strip.forEach((sym, k) => {
      if (sym === src.skip) return;
      for (const wrap of [-1, 0, 1]) {
        g.save();
        g.translate(r * w + w / 2, (k + 0.5) * h + wrap * canvas.height);
        skin.drawSymbol(g, sym, w * 0.84, h * skin.symbolScale);
        g.restore();
      }
    });
    g.restore();
  });
  return canvas;
}

/** A vertically smeared copy at half size: the running average of shifted draws, wrapping. */
export function blurStrips(src: HTMLCanvasElement, spanPx: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, src.width >> 1);
  c.height = Math.max(1, src.height >> 1);
  const g = c.getContext('2d')!;
  const n = 14;
  for (let i = 0; i < n; i++) {
    const off = ((i / (n - 1) - 0.5) * spanPx) / 2;
    g.globalAlpha = 1 / (i + 1);
    for (const wrap of [-c.height, 0, c.height]) g.drawImage(src, 0, off + wrap, c.width, c.height);
  }
  g.globalAlpha = 1;
  return c;
}

// ---------------------------------------------------------------------------------------------
// meters: CREDIT, BET and WIN in seven-segment digits over their dim "8" ghosts

export interface MeterValues {
  credit: number;
  bet: number;
  /** null leaves the window dark (a spin in progress). */
  win: number | null;
}

const METER_DIGITS = { credit: 9, bet: 6, win: 9 };

export function paintSkinMeters(canvas: HTMLCanvasElement, theme: MeterTheme, v: MeterValues | null, scale = 1): void {
  const W = 1024, H = 136;
  if (canvas.width !== Math.round(W * scale)) {
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.fillStyle = theme.ground;
  g.fillRect(0, 0, W, H);
  const slots: [keyof MeterValues, string, number, number][] = [
    ['credit', theme.labels[0], 16, 392],
    ['bet', theme.labels[1], 424, 232],
    ['win', theme.labels[2], 672, 336],
  ];
  for (const [key, label, x, w] of slots) {
    text(g, label, x + 4, 20, `600 22px 'Barlow Condensed', sans-serif`, theme.label, { align: 'left' });
    roundRect(g, x, 36, w, 88, 6);
    g.fillStyle = '#030202';
    g.fill();
    g.strokeStyle = theme.frame;
    g.lineWidth = 2;
    g.stroke();
    const value = v ? v[key] : null;
    const { text: t, ghost } = segText(value ?? 0, METER_DIGITS[key]);
    g.font = `700 58px DSEG7, monospace`;
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = theme.digit;
    g.globalAlpha = 0.09;
    g.fillText(ghost, x + w - 12, 108);
    g.globalAlpha = 1;
    if (value !== null) {
      g.shadowColor = theme.digit;
      g.shadowBlur = 10;
      g.fillText(t, x + w - 12, 108);
      g.shadowBlur = 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// the 5-reel screen overlay: line markers (or a lines plaque), win lines, framed symbols, ringed
// scatters and, on Gold Rush, the wilds held in place

export interface OverlaySpec {
  rows: number;
  lineRows: readonly (readonly number[])[];
  /** Canvas px: the overlay is OVERLAY_W wide and this tall. */
  height: number;
  /** Width of the marker column on each side. */
  side: number;
  /** Numbered markers for every line (10 lines), or a plaque that names the line count (40). */
  markers: boolean;
  colors: readonly string[];
  ground: string;
  ink: string;
  ringColor: string;
  /** Paints a held symbol (Gold Rush's sticky WILD) into a cell. */
  drawHeld?: (g: G, w: number, h: number) => void;
}

export const OVERLAY_W = 1024;

export interface OverlayState {
  lines: { line: number; count: number }[];
  /** Cells to ring (scatters that paid or triggered), as reel * rows + row. */
  rings: number[];
  /** Cells held wild. */
  held: number[];
  /** Cells to flash (a wild that just stuck). */
  flash: number[];
}

export const EMPTY_OVERLAY: OverlayState = { lines: [], rings: [], held: [], flash: [] };

export function lineColorOf(spec: OverlaySpec, line: number): string {
  return spec.colors[line % spec.colors.length]!;
}

function markerSlots(spec: OverlaySpec): { left: number[]; right: number[] } {
  const place = (side: 0 | 4) => {
    const byRow: number[][] = Array.from({ length: spec.rows }, () => []);
    spec.lineRows.forEach((rows, l) => byRow[rows[side]!]!.push(l));
    const y: number[] = [];
    byRow.forEach((ls, row) => ls.forEach((l, k) => (y[l] = (row + (k + 0.5) / ls.length) * (spec.height / spec.rows))));
    return y;
  };
  return { left: place(0), right: place(4) };
}

export function cellCentre(spec: OverlaySpec, reel: number, row: number): [number, number] {
  const inner = OVERLAY_W - spec.side * 2;
  return [spec.side + (reel + 0.5) * (inner / 5), (row + 0.5) * (spec.height / spec.rows)];
}

export function paintLineOverlay(canvas: HTMLCanvasElement, spec: OverlaySpec, s: OverlayState, scale = 1, flashOn = true): void {
  if (canvas.width !== Math.round(OVERLAY_W * scale)) {
    canvas.width = Math.round(OVERLAY_W * scale);
    canvas.height = Math.round(spec.height * scale);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.clearRect(0, 0, OVERLAY_W, spec.height);
  const H = spec.height;
  const cw = (OVERLAY_W - spec.side * 2) / 5;
  const ch = H / spec.rows;
  // side columns
  g.fillStyle = spec.ground;
  g.fillRect(0, 0, spec.side, H);
  g.fillRect(OVERLAY_W - spec.side, 0, spec.side, H);
  const slots = spec.markers ? markerSlots(spec) : null;
  const lit = new Set(s.lines.map((x) => x.line));
  if (slots) {
    for (let l = 0; l < spec.lineRows.length; l++) {
      for (const [x, y] of [[spec.side / 2, slots.left[l]!], [OVERLAY_W - spec.side / 2, slots.right[l]!]] as const) {
        const on = lit.has(l);
        roundRect(g, x - 24, y - 10, 48, 20, 5);
        g.fillStyle = on ? lineColorOf(spec, l) : 'rgba(255,255,255,0.1)';
        g.fill();
        text(g, String(l + 1), x, y + 1, `600 17px 'Barlow Condensed', sans-serif`, on ? spec.ground : lineColorOf(spec, l));
      }
    }
  } else {
    for (const x of [spec.side / 2, OVERLAY_W - spec.side / 2]) {
      g.save();
      g.translate(x, H / 2);
      g.rotate(-Math.PI / 2);
      text(g, `${spec.lineRows.length} LINES`, 0, 0, `600 26px 'Barlow Condensed', sans-serif`, spec.ink);
      g.restore();
    }
  }
  // held wilds sit in front of the spinning reel
  for (const c of s.held) {
    const [x, y] = cellCentre(spec, Math.floor(c / spec.rows), c % spec.rows);
    g.save();
    g.translate(x, y);
    spec.drawHeld?.(g, cw, ch);
    g.restore();
  }
  for (const w of s.lines) {
    const rows = spec.lineRows[w.line]!;
    const color = lineColorOf(spec, w.line);
    const pts = rows.map((row, r) => cellCentre(spec, r, row));
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(spec.side - 6, slots ? slots.left[w.line]! : pts[0]![1]);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(OVERLAY_W - spec.side + 6, slots ? slots.right[w.line]! : pts[4]![1]);
    g.shadowColor = color;
    g.shadowBlur = 16;
    g.strokeStyle = color;
    g.lineWidth = 7;
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.stroke();
    for (let r = 0; r < w.count; r++) {
      const [x, y] = pts[r]!;
      g.shadowColor = color;
      g.shadowBlur = 12;
      g.strokeStyle = color;
      g.lineWidth = 5;
      roundRect(g, x - cw / 2 + 5, y - ch / 2 + 5, cw - 10, ch - 10, 10);
      g.stroke();
    }
    g.restore();
  }
  const ring = (c: number, color: string) => {
    const [x, y] = cellCentre(spec, Math.floor(c / spec.rows), c % spec.rows);
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.strokeStyle = color;
    g.lineWidth = 5;
    roundRect(g, x - cw / 2 + 5, y - ch / 2 + 5, cw - 10, ch - 10, 10);
    g.stroke();
    g.restore();
  };
  for (const c of s.rings) ring(c, spec.ringColor);
  if (flashOn) for (const c of s.flash) ring(c, '#ffffff');
}
