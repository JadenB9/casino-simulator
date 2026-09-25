// Everything printed on a cabinet, painted on canvas: one atlas per machine (pay glass, belly
// glass, topper face, deck buttons and a few solid swatches), the DSEG7 meters, and Neon Nights'
// line markers and win lines. The pay glass is generated from the machine's own pay table.

import { NEON, SEVENS, WILD, type MachineId, type NeonSymbol } from '../../../../shared/src/games/slots/machines.ts';
import { drawNeonSymbol, drawStepperSymbol, neonColor, STRIP_CREAM } from './symbols.ts';
import { meterText } from './segments.ts';

type G = CanvasRenderingContext2D;

/** A rectangle in atlas pixels at scale 1. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;

export const REGIONS = {
  pay: { x: 0, y: 0, w: 1024, h: 640 },
  belly: { x: 1024, y: 0, w: 1024, h: 640 },
  topper: { x: 0, y: 640, w: 1024, h: 384 },
  buttons: [0, 1, 2, 3].map((i) => ({ x: 1024 + i * 240, y: 656, w: 224, h: 104 })),
  black: { x: 1040, y: 792, w: 48, h: 48 },
  dark: { x: 1104, y: 792, w: 48, h: 48 },
} as const;

export const BUTTONS = [
  { id: 'pays', label: 'PAYS' },
  { id: 'betOne', label: 'BET ONE' },
  { id: 'maxBet', label: 'MAX BET' },
  { id: 'spin', label: 'SPIN' },
] as const;
export type DeckButton = (typeof BUTTONS)[number]['id'];

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function clipTo(g: G, r: Rect, paint: () => void): void {
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.translate(r.x, r.y);
  paint();
  g.restore();
}

const fmtPay = (n: number) => n.toLocaleString('en-US');

interface Theme {
  ground: string;
  ink: string;
  accent: string;
  rule: string;
  cell: string;
}

const THEMES: Record<MachineId, Theme> = {
  sevens: { ground: '#5a0b12', ink: '#f7e9c8', accent: '#e8c56a', rule: '#c79a45', cell: STRIP_CREAM },
  wild: { ground: '#0e0c10', ink: '#f4e4b8', accent: '#e2bb5c', rule: '#9c7a2e', cell: STRIP_CREAM },
  neon: { ground: '#0b0a1c', ink: '#e9e6ff', accent: '#ff4fd8', rule: '#40d6ff', cell: '#0c0b1d' },
};

function doubleBorder(g: G, w: number, h: number, t: Theme, inset = 14): void {
  g.strokeStyle = t.rule;
  g.lineWidth = 5;
  g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  g.lineWidth = 1.5;
  g.strokeRect(inset + 9, inset + 9, w - inset * 2 - 18, h - inset * 2 - 18);
}

function disclaimers(g: G, w: number, y: number, color: string, size = 17): void {
  g.fillStyle = color;
  g.font = `600 ${size}px 'Barlow Condensed', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ONLY HIGHEST WINNER PAID  ·  MALFUNCTION VOIDS ALL PAYS AND PLAYS', w / 2, y);
}

// ---------------------------------------------------------------------------------------------
// Pay glass

/** Where the 1/2/3 COINS columns sit on the stepper pay glass (x centres in region pixels). */
export const COIN_COLUMNS = [668, 792, 916];

/** How each pay table row is pictured on the glass. */
const GLASS_CELLS: Record<string, string[]> = {
  three7: ['7', '7', '7'],
  three3B: ['3B', '3B', '3B'],
  three2B: ['2B', '2B', '2B'],
  three1B: ['1B', '1B', '1B'],
  anyBar: ['BAR', 'BAR', 'BAR'],
  threeCH: ['CH', 'CH', 'CH'],
  twoCH: ['CH', 'CH', 'ANY'],
  oneCH: ['CH', 'ANY', 'ANY'],
  threeWX: ['WX', 'WX', 'WX'],
  twoWX: ['WX', 'WX', 'BLANK'],
  oneWX: ['WX', 'ANY', 'ANY'],
};

function stepperPayGlass(g: G, machine: 'sevens' | 'wild', w: number, h: number): void {
  const t = THEMES[machine];
  const m = machine === 'sevens' ? SEVENS : WILD;
  g.fillStyle = t.ground;
  g.fillRect(0, 0, w, h);
  doubleBorder(g, w, h, t);
  g.fillStyle = t.accent;
  g.font = `600 22px Cinzel, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  ['1 COIN', '2 COINS', '3 COINS'].forEach((s, i) => g.fillText(s, COIN_COLUMNS[i]!, 52));
  // one row per pay table entry, in the machine's own order
  const rows = m.pays.map((p) => ({ cells: GLASS_CELLS[p.combo]!, pay: p.pay }));
  const top = 78;
  const rowH = machine === 'sevens' ? 58 : 54;
  rows.forEach((row, i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) {
      g.fillStyle = 'rgba(255,255,255,0.045)';
      g.fillRect(34, y, w - 68, rowH);
    }
    row.cells.forEach((c, k) => {
      const cx = 92 + k * 132;
      const cy = y + rowH / 2;
      roundRect(g, cx - 58, cy - rowH * 0.42, 116, rowH * 0.84, 6);
      g.fillStyle = t.cell;
      g.fill();
      g.save();
      g.translate(cx, cy);
      if (c === 'ANY' || c === 'BLANK') {
        g.fillStyle = '#6b5a3a';
        g.font = `600 ${rowH * 0.36}px 'Barlow Condensed', sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(c, 0, 1);
      } else drawStepperSymbol(g, c, 104, rowH * 0.8);
      g.restore();
    });
    g.fillStyle = t.ink;
    g.font = `600 ${rowH * 0.58}px 'Barlow Condensed', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    COIN_COLUMNS.forEach((x, k) => g.fillText(fmtPay(row.pay * (k + 1)), x, y + rowH / 2 + 2));
  });
  const foot = top + rows.length * rowH + 14;
  g.fillStyle = t.accent;
  g.font = `600 19px 'Barlow Condensed', sans-serif`;
  g.textAlign = 'center';
  if (machine === 'wild') {
    g.fillText('5X IS WILD FOR SEVENS AND BARS  ·  ONE 5X PAYS 5 TIMES  ·  TWO 5X PAY 25 TIMES', w / 2, foot + 6);
    disclaimers(g, w, foot + 34, t.ink, 16);
  } else {
    g.fillText('ANY MIX OF BARS PAYS ANY BAR  ·  CHERRIES COUNT FROM THE LEFT REEL', w / 2, foot + 6);
    disclaimers(g, w, foot + 34, t.ink, 16);
  }
}

function neonPayGlass(g: G, w: number, h: number): void {
  const t = THEMES.neon;
  g.fillStyle = t.ground;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(64,214,255,0.8)';
  g.shadowColor = '#40d6ff';
  g.shadowBlur = 14;
  g.lineWidth = 4;
  roundRect(g, 16, 16, w - 32, h - 32, 18);
  g.stroke();
  g.shadowBlur = 0;
  const syms: NeonSymbol[] = ['DIAMOND', 'SEVEN', 'BELL', 'HORSESHOE', 'A', 'K', 'Q', 'J', '10'];
  const colW = (w - 80) / 3;
  const rowH = 124;
  syms.forEach((sym, i) => {
    const cx = 40 + (i % 3) * colW;
    const cy = 40 + Math.floor(i / 3) * rowH;
    g.save();
    g.translate(cx + 60, cy + rowH / 2);
    drawNeonSymbol(g, sym, 104, 104);
    g.restore();
    const pays = NEON.linePays[sym]!;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    [5, 4, 3].forEach((n, k) => {
      const y = cy + 30 + k * 32;
      g.fillStyle = neonColor(sym);
      g.font = `600 22px 'Barlow Condensed', sans-serif`;
      g.fillText(String(n), cx + 128, y);
      g.fillStyle = t.ink;
      g.font = `600 26px 'Barlow Condensed', sans-serif`;
      g.fillText(fmtPay(pays[n - 3]!), cx + 152, y);
    });
  });
  const y0 = 40 + 3 * rowH + 6;
  g.save();
  g.translate(96, y0 + 58);
  drawNeonSymbol(g, 'SCATTER', 110, 110);
  g.restore();
  g.save();
  g.translate(w - 110, y0 + 58);
  drawNeonSymbol(g, 'WILD', 120, 110);
  g.restore();
  g.textAlign = 'center';
  g.fillStyle = '#ffd36b';
  g.font = `600 25px 'Barlow Condensed', sans-serif`;
  g.fillText('3 · 4 · 5 SCATTERS ANYWHERE PAY 2 · 10 · 50 x TOTAL BET', w / 2, y0 + 26);
  g.fillStyle = '#ff4fd8';
  g.fillText('3 OR MORE SCATTERS: 10 FREE GAMES, ALL WINS x3', w / 2, y0 + 58);
  g.fillStyle = t.ink;
  g.font = `600 20px 'Barlow Condensed', sans-serif`;
  g.fillText('WILD ON REELS 2-5 SUBSTITUTES FOR ALL BUT SCATTER  ·  PAYS PER CREDIT BET ON A LINE  ·  20 LINES', w / 2, y0 + 90);
  disclaimers(g, w, h - 34, 'rgba(233,230,255,0.75)', 16);
}

// ---------------------------------------------------------------------------------------------
// Belly glass

function rays(g: G, cx: number, cy: number, n: number, r: number, color: string): void {
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

function bellySevens(g: G, w: number, h: number): void {
  const t = THEMES.sevens;
  g.fillStyle = t.ground;
  g.fillRect(0, 0, w, h);
  rays(g, w / 2, h * 0.48, 36, w, 'rgba(232,197,106,0.10)');
  doubleBorder(g, w, h, t);
  [-1, 0, 1].forEach((k) => {
    g.save();
    g.translate(w / 2 + k * 250, h * 0.44);
    g.rotate(k * 0.08);
    drawStepperSymbol(g, '7', 200, 250);
    g.restore();
  });
  g.fillStyle = t.accent;
  g.font = `64px Limelight, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CLASSIC SEVENS', w / 2, h * 0.8);
  disclaimers(g, w, h - 44, t.ink, 18);
}

function bellyWild(g: G, w: number, h: number): void {
  const t = THEMES.wild;
  g.fillStyle = t.ground;
  g.fillRect(0, 0, w, h);
  rays(g, w / 2, h * 0.44, 48, w, 'rgba(226,187,92,0.09)');
  doubleBorder(g, w, h, t);
  g.save();
  g.translate(w / 2, h * 0.42);
  drawStepperSymbol(g, 'WX', 460, 330);
  g.restore();
  g.fillStyle = t.accent;
  g.font = `600 30px Cinzel, serif`;
  g.textAlign = 'center';
  g.fillText('EVERY 5X MULTIPLIES THE WIN', w / 2, h * 0.8);
  disclaimers(g, w, h - 44, t.ink, 18);
}

function bellyNeon(g: G, w: number, h: number): void {
  g.fillStyle = '#07061a';
  g.fillRect(0, 0, w, h);
  // skyline: deterministic towers with lit windows
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const horizon = h * 0.72;
  for (let x = 20; x < w - 20; ) {
    const bw = 40 + rnd() * 70;
    const bh = 90 + rnd() * 260;
    g.fillStyle = '#12102e';
    g.fillRect(x, horizon - bh, bw, bh);
    g.fillStyle = 'rgba(255,211,107,0.55)';
    for (let wy = horizon - bh + 12; wy < horizon - 10; wy += 16)
      for (let wx = x + 8; wx < x + bw - 8; wx += 13) if (rnd() > 0.62) g.fillRect(wx, wy, 5, 7);
    x += bw + 6;
  }
  g.fillStyle = '#05040f';
  g.fillRect(0, horizon, w, h - horizon);
  g.strokeStyle = '#ff4fd8';
  g.shadowColor = '#ff4fd8';
  g.shadowBlur = 18;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(30, horizon);
  g.lineTo(w - 30, horizon);
  g.stroke();
  g.shadowBlur = 0;
  g.save();
  g.translate(w / 2, h * 0.25);
  g.font = `92px 'Tilt Neon', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#40d6ff';
  g.shadowBlur = 26;
  g.fillStyle = '#9ff0ff';
  g.fillText('Neon Nights', 0, 0);
  g.restore();
  disclaimers(g, w, h - 40, 'rgba(233,230,255,0.7)', 18);
}

// ---------------------------------------------------------------------------------------------
// Topper faces

function topperSevens(g: G, w: number, h: number): void {
  const t = THEMES.sevens;
  g.fillStyle = '#6a0c14';
  g.fillRect(0, 0, w, h);
  rays(g, w / 2, h * 0.95, 30, w, 'rgba(255,220,150,0.08)');
  g.fillStyle = t.accent;
  g.font = `600 44px Cinzel, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CLASSIC', w / 2, h * 0.36);
  g.font = `118px Limelight, serif`;
  g.lineWidth = 10;
  g.strokeStyle = '#2b0708';
  g.strokeText('SEVENS', w / 2, h * 0.66);
  g.fillStyle = '#fbf0d4';
  g.fillText('SEVENS', w / 2, h * 0.66);
  for (const k of [-1, 1]) {
    g.save();
    g.translate(w / 2 + k * 400, h * 0.6);
    drawStepperSymbol(g, '7', 110, 140);
    g.restore();
  }
}

function topperNeon(g: G, w: number, h: number): void {
  g.fillStyle = '#08071a';
  g.fillRect(0, 0, w, h);
  const word = (text: string, x: number, size: number, color: string) => {
    g.save();
    g.font = `${size}px 'Tilt Neon', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 30;
    g.lineWidth = 7;
    g.strokeStyle = color;
    g.strokeText(text, x, h * 0.54);
    g.shadowBlur = 8;
    g.fillStyle = '#ffffff';
    g.fillText(text, x, h * 0.54);
    g.restore();
  };
  word('NEON', w * 0.3, 150, '#ff4fd8');
  word('NIGHTS', w * 0.7, 150, '#40d6ff');
}

function topperWild(g: G, w: number, h: number): void {
  const s = Math.min(w, h);
  g.fillStyle = '#0d0b0f';
  g.fillRect(0, 0, w, h);
  rays(g, w / 2, h / 2, 40, s, 'rgba(226,187,92,0.16)');
  g.save();
  g.translate(w / 2, h / 2);
  drawStepperSymbol(g, 'WX', s * 0.94, s * 0.8);
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Deck buttons

const BUTTON_COLORS: Record<DeckButton, [string, string]> = {
  pays: ['#e9e4d8', '#2a241c'],
  betOne: ['#f2b441', '#2a1a04'],
  maxBet: ['#d8343c', '#fff1e6'],
  spin: ['#3bb56a', '#08210f'],
};

function deckButton(g: G, r: Rect, id: DeckButton, label: string): void {
  const [face, ink] = BUTTON_COLORS[id];
  g.fillStyle = '#141212';
  g.fillRect(r.x, r.y, r.w, r.h);
  roundRect(g, r.x + 6, r.y + 6, r.w - 12, r.h - 12, 10);
  g.fillStyle = face;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 3;
  roundRect(g, r.x + 12, r.y + 12, r.w - 24, r.h - 24, 7);
  g.stroke();
  g.fillStyle = ink;
  g.font = `600 36px 'Barlow Condensed', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 2);
}

/** Paint a machine's atlas at `scale` (1 = 2048 x 1024). */
export function paintAtlas(canvas: HTMLCanvasElement, machine: MachineId, scale: number): void {
  canvas.width = Math.round(ATLAS_W * scale);
  canvas.height = Math.round(ATLAS_H * scale);
  const g = canvas.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const P = REGIONS;
  clipTo(g, P.pay, () => (machine === 'neon' ? neonPayGlass(g, P.pay.w, P.pay.h) : stepperPayGlass(g, machine, P.pay.w, P.pay.h)));
  clipTo(g, P.belly, () => (machine === 'sevens' ? bellySevens : machine === 'wild' ? bellyWild : bellyNeon)(g, P.belly.w, P.belly.h));
  clipTo(g, P.topper, () => (machine === 'sevens' ? topperSevens(g, P.topper.w, P.topper.h) : machine === 'neon' ? topperNeon(g, P.topper.w, P.topper.h) : topperWild(g, P.topper.h, P.topper.h)));
  BUTTONS.forEach((b, i) => deckButton(g, P.buttons[i]!, b.id, machine === 'neon' && b.id === 'betOne' ? 'BET +1' : b.label));
  g.fillStyle = '#050505';
  g.fillRect(P.black.x, P.black.y, P.black.w, P.black.h);
  g.fillStyle = '#17141a';
  g.fillRect(P.dark.x, P.dark.y, P.dark.w, P.dark.h);
}

// ---------------------------------------------------------------------------------------------
// Meters: CREDIT, BET and WIN in seven-segment digits over their dim "8" ghosts.

export interface MeterValues {
  credit: number;
  bet: number;
  /** null leaves the window dark (a spin in progress). */
  win: number | null;
}


export function paintMeters(canvas: HTMLCanvasElement, machine: MachineId, v: MeterValues | null, scale = 1): void {
  const W = 1024, H = 136;
  if (canvas.width !== Math.round(W * scale)) {
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  const video = machine === 'neon';
  g.fillStyle = video ? '#07061a' : '#120d0c';
  g.fillRect(0, 0, W, H);
  const digitColor = video ? '#ffb347' : '#ff3b2a';
  const labels: [keyof MeterValues, string, number, number][] = [
    ['credit', 'CREDIT', 16, 392],
    ['bet', video ? 'TOTAL BET' : 'BET', 424, 232],
    ['win', video ? 'WIN' : 'WINNER PAID', 672, 336],
  ];
  for (const [key, label, x, w] of labels) {
    g.fillStyle = video ? '#b9b2ff' : '#e8c56a';
    g.font = `600 22px 'Barlow Condensed', sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, x + 4, 20);
    roundRect(g, x, 36, w, 88, 6);
    g.fillStyle = '#030202';
    g.fill();
    g.strokeStyle = video ? 'rgba(64,214,255,0.45)' : 'rgba(232,197,106,0.45)';
    g.lineWidth = 2;
    g.stroke();
    const value = v ? v[key] : null;
    const { text, ghost } = meterText(g, value ?? 0, w - 24);
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = digitColor;
    g.globalAlpha = 0.09;
    g.fillText(ghost, x + w - 12, 108);
    g.globalAlpha = 1;
    if (value !== null) {
      g.shadowColor = digitColor;
      g.shadowBlur = 10;
      g.fillText(text, x + w - 12, 108);
      g.shadowBlur = 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Neon Nights screen overlay: line markers down both sides, and the win lines.

export const OVERLAY_W = 1024;
export const OVERLAY_H = 404;
/** Marker columns and the reels' area inside the overlay (pixels). */
const MARK_W = 64;
const LINE_COLORS = ['#ff4fd8', '#40d6ff', '#ffd36b', '#6dff9c', '#ff9a3c', '#b58cff', '#ff6fa3', '#c4ff4a', '#5ff3ff', '#ff3d6e'];

export function lineColor(line: number): string {
  return LINE_COLORS[line % LINE_COLORS.length]!;
}

/** Where line `l`'s markers sit: the row its path starts (left) and ends (right) on, stacked. */
function markerSlots(): { left: number[]; right: number[] } {
  const place = (side: 0 | 4) => {
    const byRow: number[][] = [[], [], []];
    NEON.lineRows.forEach((rows, l) => byRow[rows[side]!]!.push(l));
    const y: number[] = [];
    byRow.forEach((ls, row) => ls.forEach((l, k) => (y[l] = (row + (k + 0.5) / ls.length) * (OVERLAY_H / 3))));
    return y;
  };
  return { left: place(0), right: place(4) };
}
const SLOTS = markerSlots();

/** Centre of reel `reel`, row `row` in overlay pixels. */
function cellCentre(reel: number, row: number): [number, number] {
  const inner = OVERLAY_W - MARK_W * 2;
  return [MARK_W + (reel + 0.5) * (inner / 5), (row + 0.5) * (OVERLAY_H / 3)];
}

export function paintOverlay(canvas: HTMLCanvasElement, show: { line: number; count: number }[] | null, scale = 1, scatters: [reel: number, row: number][] = []): void {
  if (canvas.width !== Math.round(OVERLAY_W * scale)) {
    canvas.width = Math.round(OVERLAY_W * scale);
    canvas.height = Math.round(OVERLAY_H * scale);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
  // marker columns
  g.fillStyle = '#07061a';
  g.fillRect(0, 0, MARK_W, OVERLAY_H);
  g.fillRect(OVERLAY_W - MARK_W, 0, MARK_W, OVERLAY_H);
  const lit = new Set((show ?? []).map((s) => s.line));
  for (let l = 0; l < NEON.lineRows.length; l++) {
    for (const [x, y] of [[MARK_W / 2, SLOTS.left[l]!], [OVERLAY_W - MARK_W / 2, SLOTS.right[l]!]] as const) {
      const on = lit.has(l);
      roundRect(g, x - 24, y - 9, 48, 18, 5);
      g.fillStyle = on ? lineColor(l) : 'rgba(255,255,255,0.08)';
      g.fill();
      g.fillStyle = on ? '#07061a' : lineColor(l);
      g.font = `600 16px 'Barlow Condensed', sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(l + 1), x, y + 1);
    }
  }
  for (const s of show ?? []) {
    const rows = NEON.lineRows[s.line]!;
    const color = lineColor(s.line);
    const pts = rows.map((row, r) => cellCentre(r, row));
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(MARK_W - 6, SLOTS.left[s.line]!);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(OVERLAY_W - MARK_W + 6, SLOTS.right[s.line]!);
    g.shadowColor = color;
    g.shadowBlur = 16;
    g.strokeStyle = color;
    g.lineWidth = 7;
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.stroke();
    // frame the symbols that made the win
    const cw = (OVERLAY_W - MARK_W * 2) / 5;
    const ch = OVERLAY_H / 3;
    for (let r = 0; r < s.count; r++) {
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
  // scatters pay wherever they land: ring each one
  for (const [reel, row] of scatters) {
    const [x, y] = cellCentre(reel, row);
    const cw = (OVERLAY_W - MARK_W * 2) / 5;
    const ch = OVERLAY_H / 3;
    g.save();
    g.shadowColor = '#ffd36b';
    g.shadowBlur = 14;
    g.strokeStyle = '#ffd36b';
    g.lineWidth = 5;
    roundRect(g, x - cw / 2 + 5, y - ch / 2 + 5, cw - 10, ch - 10, 10);
    g.stroke();
    g.restore();
  }
}
