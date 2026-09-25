// The machine's printed and lit surfaces, painted on canvases: the board's face (Sakura Storm's
// artwork round the field, the spec plate, the pockets' labels), the screen in the centre piece
// (the reels, reach, jackpot and fever), the data lamp on top and the crown's name plate.
//
// Everything is drawn in board metres scaled to pixels, so the art lines up with the nails and
// pockets the physics uses (board.ts).

import {
  BOARD_W, BOARD_H, CENTRE, RAIL_R, INNER_R, LANE_FROM, LANE_TO, FRAME, HESO, TULIPS, ATTACKER, PINS,
} from './board.ts';

export const FACE_W = 1024;
export const FACE_H = Math.round((FACE_W * BOARD_H) / BOARD_W);
const S = FACE_W / BOARD_W;
/** Board metres (u from the middle, v from the bottom) to face pixels. */
const px = (u: number) => (u + BOARD_W / 2) * S;
const py = (v: number) => (BOARD_H - v) * S;

const INK = '#fff4f8';
const SAKURA = '#ff8fb8';
const SAKURA_DEEP = '#e2457e';
const GOLD = '#f2c75a';
const JP = "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif CJK JP', 'Noto Serif JP', serif";
const JP_SANS = "'Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK JP', 'Noto Sans JP', sans-serif";

/** A small deterministic generator so the art is the same on every machine and every load. */
function seq(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A five-petal blossom. */
function blossom(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, fill: string, edge: string, alpha = 1): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.globalAlpha = alpha;
  g.fillStyle = fill;
  g.strokeStyle = edge;
  g.lineWidth = Math.max(1, r * 0.06);
  for (let i = 0; i < 5; i++) {
    g.rotate((Math.PI * 2) / 5);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(r * 0.55, -r * 0.2, r * 0.95, -r * 0.35, r, -r * 0.08);
    // the notch at the tip of a cherry petal
    g.lineTo(r * 0.86, 0);
    g.lineTo(r, r * 0.08);
    g.bezierCurveTo(r * 0.95, r * 0.35, r * 0.55, r * 0.2, 0, 0);
    g.fill();
    g.stroke();
  }
  g.fillStyle = '#fff3a6';
  g.beginPath();
  g.arc(0, 0, r * 0.16, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Seigaiha: overlapping wave scales, in gold line, over a region. */
function waves(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, r: number): void {
  g.save();
  g.strokeStyle = 'rgba(242, 199, 90, 0.5)';
  g.lineWidth = 1.6;
  for (let row = 0, y = y0; y < y0 + h + r; row++, y += r * 0.5) {
    const off = row % 2 ? r : 0;
    for (let x = x0 - r + off; x < x0 + w + r; x += r * 2) {
      for (let k = 1; k <= 3; k++) {
        g.beginPath();
        g.arc(x, y, (r * k) / 3, Math.PI, 0);
        g.stroke();
      }
    }
  }
  g.restore();
}

/** Sakura Storm's board face: 1024 px wide, the board's aspect. */
export function paintFace(canvas: HTMLCanvasElement): void {
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const g = canvas.getContext('2d')!;
  const rnd = seq(19);
  const cx = px(CENTRE.u);
  const cy = py(CENTRE.v);
  const R = RAIL_R * S;

  // the plate round the field: lacquered plum with gold wave scales, a gold ring round the field
  g.fillStyle = '#240b26';
  g.fillRect(0, 0, FACE_W, FACE_H);
  waves(g, 0, 0, FACE_W, FACE_H, 26);
  const vignette = g.createRadialGradient(cx, cy, R, cx, cy, R * 1.6);
  vignette.addColorStop(0, 'rgba(36, 11, 38, 0.2)');
  vignette.addColorStop(1, 'rgba(12, 3, 14, 0.85)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, FACE_W, FACE_H);
  g.strokeStyle = GOLD;
  g.lineWidth = 7;
  g.beginPath();
  g.arc(cx, cy, R + 12, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = SAKURA_DEEP;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, R + 20, 0, Math.PI * 2);
  g.stroke();
  // blossoms in the corners, over the plate
  for (const [x, y] of [[40, 70], [FACE_W - 50, 60], [60, FACE_H - 150], [FACE_W - 70, FACE_H - 160]] as const) {
    for (let k = 0; k < 5; k++) blossom(g, x + (rnd() - 0.5) * 70, y + (rnd() - 0.5) * 60, 12 + rnd() * 10, rnd() * 6, k % 2 ? SAKURA : '#ffc4da', SAKURA_DEEP, 0.9);
  }

  // the field: night sky over a pink dusk, a sunburst behind the screen
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.clip();
  const sky = g.createLinearGradient(0, cy - R, 0, cy + R);
  sky.addColorStop(0, '#16083a');
  sky.addColorStop(0.55, '#3a0f5c');
  sky.addColorStop(1, '#8a1f5e');
  g.fillStyle = sky;
  g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  const fx = px(FRAME.u);
  const fy = py(FRAME.v);
  for (let i = 0; i < 36; i++) {
    const a0 = (i / 36) * Math.PI * 2;
    const a1 = a0 + Math.PI / 36;
    g.fillStyle = i % 2 ? 'rgba(255, 180, 220, 0.07)' : 'rgba(255, 220, 140, 0.1)';
    g.beginPath();
    g.moveTo(fx, fy);
    g.arc(fx, fy, R * 2, a0, a1);
    g.closePath();
    g.fill();
  }
  // stars
  for (let i = 0; i < 140; i++) {
    const x = cx + (rnd() - 0.5) * 2 * R;
    const y = cy - R + rnd() * R * 1.1;
    g.fillStyle = `rgba(255, 255, 255, ${0.25 + rnd() * 0.6})`;
    g.fillRect(x, y, 1.6, 1.6);
  }
  // waves along the bottom of the field
  waves(g, cx - R, cy + R * 0.62, 2 * R, R * 0.4, 22);
  // branches from the upper corners, heavy with blossom
  const branch = (x0: number, y0: number, dir: number) => {
    g.strokeStyle = '#2a0f1c';
    g.lineCap = 'round';
    const pts: [number, number][] = [];
    let x = x0;
    let y = y0;
    let w = 16;
    for (let i = 0; i < 9; i++) {
      const nx = x + dir * (34 + rnd() * 26);
      const ny = y + 14 + rnd() * 20;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo((x + nx) / 2 + dir * 6, (y + ny) / 2 - 12, nx, ny);
      g.stroke();
      pts.push([nx, ny]);
      // a twig
      if (i % 2 === 1) {
        g.lineWidth = w * 0.45;
        g.beginPath();
        g.moveTo(nx, ny);
        g.lineTo(nx + dir * (10 + rnd() * 20), ny - 30 - rnd() * 20);
        g.stroke();
        pts.push([nx + dir * 18, ny - 40]);
      }
      x = nx;
      y = ny;
      w *= 0.84;
    }
    for (const [bx, by] of pts) {
      for (let k = 0; k < 4; k++) blossom(g, bx + (rnd() - 0.5) * 44, by + (rnd() - 0.5) * 36, 9 + rnd() * 9, rnd() * 6, k % 2 ? SAKURA : '#ffc4da', SAKURA_DEEP, 0.95);
    }
  };
  branch(cx - R - 10, cy - R * 0.7, 1);
  branch(cx + R + 10, cy - R * 0.62, -1);
  // petals on the wind
  for (let i = 0; i < 70; i++) {
    const x = cx + (rnd() - 0.5) * 2 * R;
    const y = cy - R + rnd() * 2 * R;
    blossom(g, x, y, 3 + rnd() * 5, rnd() * 6, 'rgba(255, 190, 215, 0.9)', 'rgba(226, 69, 126, 0.6)', 0.5 + rnd() * 0.4);
  }
  // the big 桜 behind the lower field
  g.font = `900 ${Math.round(R * 0.62)}px ${JP}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255, 143, 184, 0.12)';
  g.fillText('桜', cx, cy + R * 0.5);
  g.restore();

  // the launch lane: dark between the rails
  g.save();
  g.lineWidth = (RAIL_R - INNER_R) * S;
  g.strokeStyle = '#1a1024';
  g.beginPath();
  g.arc(cx, cy, ((RAIL_R + INNER_R) / 2) * S, -LANE_FROM, -LANE_TO, false);
  g.stroke();
  g.restore();

  // pockets' labels and paint
  const pocketMouth = (u: number, v: number, label: string, fill: string) => {
    const x = px(u);
    const y = py(v);
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y + 14, 28, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.font = `700 13px 'Barlow Condensed', sans-serif`;
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.fillText(label, x, y + 44);
  };
  pocketMouth(HESO.u, HESO.v, 'START', 'rgba(255, 215, 90, 0.85)');
  for (const t of TULIPS) {
    // tulip petals painted round the mouth
    const x = px(t.u);
    const y = py(t.v);
    for (const s of [-1, 1]) {
      g.fillStyle = SAKURA_DEEP;
      g.beginPath();
      g.ellipse(x + s * 16, y + 4, 11, 22, s * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#2f9e5a';
    g.fillRect(x - 2, y + 18, 4, 26);
    g.font = `700 12px 'Barlow Condensed', sans-serif`;
    g.fillStyle = INK;
    g.fillText('3 BALLS', x, y + 56);
  }
  // the attacker's surround
  g.fillStyle = '#20111c';
  g.fillRect(px(ATTACKER.u - ATTACKER.hw) - 10, py(ATTACKER.v + ATTACKER.hh) - 8, (2 * ATTACKER.hw * S) + 20, 2 * ATTACKER.hh * S + 26);
  g.font = `700 12px 'Barlow Condensed', sans-serif`;
  g.fillStyle = GOLD;
  g.textAlign = 'center';
  g.fillText('ATTACKER  10R × 15', px(ATTACKER.u), py(ATTACKER.v - ATTACKER.hh) + 14);

  // the nails' holes, a touch of shadow under each (the nails themselves are 3D)
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  for (const p of PINS) {
    g.beginPath();
    g.arc(px(p.u) + 1.5, py(p.v) + 2, 2.6, 0, Math.PI * 2);
    g.fill();
  }

  // the corners: the maker's plate and the spec, as every real board prints them
  g.textAlign = 'left';
  g.fillStyle = GOLD;
  g.font = `700 22px ${JP_SANS}`;
  g.fillText('CR 桜ストーム', 22, 40);
  g.font = `600 14px 'Barlow Condensed', sans-serif`;
  g.fillText('SAKURA STORM  FPH', 24, 60);
  g.textAlign = 'right';
  g.fillStyle = '#ffd0e2';
  g.font = `600 13px ${JP_SANS}`;
  const spec = ['大当り確率 1/32', '確変突入率 1/2', '10R × 15個', '最大8連'];
  spec.forEach((line, i) => g.fillText(line, FACE_W - 22, FACE_H - 86 + i * 18));
  g.textAlign = 'left';
  g.font = `600 13px 'Barlow Condensed', sans-serif`;
  ['Jackpot 1 in 32 spins', 'Kakuhen on odd numbers', '10 rounds of 15 balls', 'Chains up to 8'].forEach((line, i) => g.fillText(line, 22, FACE_H - 86 + i * 18));
}

// ---------------------------------------------------------------------------------------------
// The screen in the centre piece

export const LCD_W = 512;
export const LCD_H = Math.round((LCD_W * FRAME.hh) / FRAME.hw);

/** Digits the reels carry: the characters' colours, by number (odd ones, the kakuhen numbers, in red and gold). */
const DIGIT_FILL = ['#6fd6ff', '#ff4d5e', '#7ce38b', '#ffb347', '#b88cff', '#ff4d5e', '#6fd6ff', '#ffd23f', '#7ce38b', '#ff7ad9'];

export interface ScreenState {
  /** ms on the screen's own clock, for the backdrop's petals and the flashing. */
  t: number;
  mode: 'idle' | 'spin' | 'reach' | 'hit' | 'fever' | 'kakuhen' | 'end';
  /** Reels as positions (a digit and a fraction of the way to the next); null for a stopped reel's settled digit. */
  reels: [number, number, number];
  /** Which reels are stopped. */
  stopped: [boolean, boolean, boolean];
  /** Spins waiting (holds), 0-4 shown. */
  holds: number;
  /** A line across the bottom: the machine talking. */
  line: string;
  round?: number;
  chain?: number;
  won?: number;
  /** 0..1 for the reach's slow middle reel and the hit's flash. */
  heat?: number;
}

function digitAt(g: CanvasRenderingContext2D, d: number, x: number, y: number, size: number, alpha: number, glow: boolean): void {
  const n = ((Math.round(d) % 10) + 10) % 10;
  g.save();
  g.globalAlpha = alpha;
  g.font = `900 ${size}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.12;
  g.strokeStyle = '#1b0726';
  g.strokeText(String(n), x, y);
  g.fillStyle = DIGIT_FILL[n]!;
  if (glow) {
    g.shadowColor = DIGIT_FILL[n]!;
    g.shadowBlur = size * 0.25;
  }
  g.fillText(String(n), x, y);
  g.restore();
}

/** The screen, painted for this moment. */
export function paintScreen(canvas: HTMLCanvasElement, st: ScreenState): void {
  if (canvas.width !== LCD_W) {
    canvas.width = LCD_W;
    canvas.height = LCD_H;
  }
  const g = canvas.getContext('2d')!;
  const W = LCD_W;
  const H = LCD_H;
  const hot = st.mode === 'hit' || st.mode === 'fever' || st.mode === 'kakuhen';
  // backdrop: a night garden, or a red-gold rush in a fever
  const bg = g.createLinearGradient(0, 0, 0, H);
  if (hot) {
    bg.addColorStop(0, '#5a0718');
    bg.addColorStop(1, '#c2410c');
  } else {
    bg.addColorStop(0, '#0d0624');
    bg.addColorStop(1, '#3b0c4a');
  }
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // drifting petals
  const r = seq(7);
  for (let i = 0; i < 26; i++) {
    const speed = 0.02 + r() * 0.04;
    const x = ((r() * W + st.t * speed * 0.6) % (W + 40)) - 20;
    const y = ((r() * H + st.t * speed) % (H + 40)) - 20;
    blossom(g, x, y, 4 + r() * 5, st.t * 0.002 + i, 'rgba(255, 190, 215, 0.85)', 'rgba(226, 69, 126, 0.5)', 0.35 + r() * 0.4);
  }
  if (st.mode === 'reach' || st.mode === 'hit') {
    // the reach's rays
    const k = st.heat ?? 0;
    g.save();
    g.translate(W / 2, H * 0.46);
    g.rotate(st.t * 0.0012);
    for (let i = 0; i < 16; i++) {
      g.rotate((Math.PI * 2) / 16);
      g.fillStyle = `rgba(255, ${st.mode === 'hit' ? 210 : 120}, 80, ${0.08 + 0.12 * k})`;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(W, -40);
      g.lineTo(W, 40);
      g.fill();
    }
    g.restore();
  }

  if (st.mode === 'fever' || st.mode === 'end' || st.mode === 'kakuhen') {
    const flash = Math.floor(st.t / 180) % 2 === 0;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (st.mode === 'kakuhen') {
      g.font = `900 112px ${JP}`;
      g.fillStyle = flash ? '#ffe36b' : '#ff4d5e';
      g.strokeStyle = '#3a0010';
      g.lineWidth = 10;
      g.strokeText('確変', W / 2, H * 0.4);
      g.fillText('確変', W / 2, H * 0.4);
      g.font = `700 34px 'Barlow Condensed', sans-serif`;
      g.fillStyle = INK;
      g.fillText('KAKUHEN · THE REELS GO AGAIN', W / 2, H * 0.72);
    } else {
      g.font = `700 30px 'Barlow Condensed', sans-serif`;
      g.fillStyle = GOLD;
      g.fillText(st.mode === 'end' ? 'FEVER OVER' : `ROUND ${st.round ?? 1} / 10`, W / 2, H * 0.17);
      g.font = `900 ${st.mode === 'end' ? 104 : 124}px 'Barlow Condensed', sans-serif`;
      g.lineWidth = 10;
      g.strokeStyle = '#3a0010';
      g.fillStyle = '#fff4d6';
      const won = `+${st.won ?? 0}`;
      g.strokeText(won, W / 2, H * 0.5);
      g.fillText(won, W / 2, H * 0.5);
      g.font = `700 26px 'Barlow Condensed', sans-serif`;
      g.fillStyle = INK;
      g.fillText('BALLS', W / 2, H * 0.72);
      if ((st.chain ?? 0) > 0) {
        g.font = `900 40px ${JP}`;
        g.fillStyle = flash ? '#ffe36b' : '#fff';
        g.fillText(`${st.chain}連`, W * 0.86, H * 0.17);
      }
    }
  } else if (st.mode === 'hit') {
    // three of a kind, and the jackpot's kanji
    const d = st.reels[0];
    const pulse = 1 + 0.06 * Math.sin(st.t / 60);
    for (let i = 0; i < 3; i++) digitAt(g, d, W * (0.24 + i * 0.26), H * 0.4, 150 * pulse, 1, true);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 64px ${JP}`;
    g.lineWidth = 8;
    g.strokeStyle = '#3a0010';
    g.fillStyle = Math.floor(st.t / 140) % 2 ? '#ffe36b' : '#fff';
    g.strokeText('大当り', W / 2, H * 0.78);
    g.fillText('大当り', W / 2, H * 0.78);
  } else {
    // the three reels: each a column scrolling down through the digits
    const cols = [W * 0.24, W * 0.5, W * 0.76];
    for (let i = 0; i < 3; i++) {
      const pos = st.reels[i]!;
      const stopped = st.stopped[i]!;
      const size = st.mode === 'reach' && i === 1 ? 150 : 128;
      const frac = pos - Math.floor(pos);
      const base = Math.floor(pos);
      for (let k = -1; k <= 1; k++) {
        const y = H * 0.44 + (k + frac) * size * 0.9;
        const a = stopped ? (k === 0 ? 1 : 0) : Math.max(0, 1 - Math.abs(k + frac) * 0.7);
        if (a > 0.02) digitAt(g, base - k, cols[i]!, y, size, a, stopped || (st.mode === 'reach' && i === 1));
      }
    }
    if (st.mode === 'reach') {
      g.textAlign = 'center';
      g.font = `900 46px 'Barlow Condensed', sans-serif`;
      g.fillStyle = Math.floor(st.t / 160) % 2 ? '#ff4d5e' : '#ffe36b';
      g.strokeStyle = '#1b0726';
      g.lineWidth = 6;
      g.strokeText('REACH', W / 2, H * 0.1 + 14);
      g.fillText('REACH', W / 2, H * 0.1 + 14);
    }
    if (st.mode === 'idle') {
      g.textAlign = 'center';
      g.font = `900 30px ${JP}`;
      g.fillStyle = SAKURA;
      g.fillText('桜ストーム', W / 2, H * 0.12 + 6);
    }
  }

  // the holds: four lamps under the reels
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i < st.holds ? '#ffe36b' : 'rgba(255, 255, 255, 0.14)';
    g.beginPath();
    g.arc(W / 2 - 42 + i * 28, H - 50, 8, 0, Math.PI * 2);
    g.fill();
  }
  // the line the machine says
  if (st.line) {
    g.fillStyle = 'rgba(8, 2, 16, 0.72)';
    g.fillRect(0, H - 34, W, 34);
    g.font = `600 22px 'Barlow Condensed', ${JP_SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = INK;
    g.fillText(st.line, W / 2, H - 17);
  }
}

// ---------------------------------------------------------------------------------------------
// The data lamp and the crown

export const DATA_W = 256;
export const DATA_H = 96;

export interface DataLamp {
  jackpots: number;
  spins: number;
  best: number;
  fever: boolean;
}

export function paintData(canvas: HTMLCanvasElement, d: DataLamp): void {
  canvas.width = DATA_W;
  canvas.height = DATA_H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#0b0710';
  g.fillRect(0, 0, DATA_W, DATA_H);
  g.textBaseline = 'middle';
  const cell = (x: number, label: string, value: number, color: string) => {
    g.font = `600 13px ${JP_SANS}`;
    g.fillStyle = '#b9a9c9';
    g.textAlign = 'center';
    g.fillText(label, x, 18);
    g.font = `700 36px DSEG7, monospace`;
    g.fillStyle = 'rgba(255, 60, 60, 0.12)';
    g.fillText('888', x, 58);
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 8;
    g.fillText(String(Math.min(999, value)), x, 58);
    g.shadowBlur = 0;
  };
  cell(46, '大当り', d.jackpots, '#ff4b4b');
  cell(128, '回転', d.spins, '#ffb347');
  cell(210, '最高', d.best, '#7ce38b');
  if (d.fever) {
    g.fillStyle = 'rgba(255, 60, 60, 0.9)';
    g.fillRect(0, DATA_H - 8, DATA_W, 8);
  }
}

export function paintCrown(canvas: HTMLCanvasElement): void {
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#ff5d98');
  grad.addColorStop(1, '#a3124c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 9; i++) blossom(g, 30 + i * 57, i % 2 ? 22 : 106, 16, i, '#ffd0e2', '#fff', 0.55);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 64px ${JP}`;
  g.lineWidth = 8;
  g.strokeStyle = '#4a0620';
  g.strokeText('桜ストーム', 256, 58);
  g.fillStyle = '#fff6fa';
  g.fillText('桜ストーム', 256, 58);
  g.font = `700 20px 'Barlow Condensed', sans-serif`;
  g.fillStyle = '#ffe36b';
  g.fillText('S A K U R A   S T O R M', 256, 108);
}

/** The LED strip round the window: one texel per lamp, painted as a pattern at time t. */
export const LED_COUNT = 96;
export type LedPattern = 'idle' | 'spin' | 'reach' | 'hit' | 'fever';

export function paintLeds(data: Uint8Array, pattern: LedPattern, t: number): void {
  for (let i = 0; i < LED_COUNT; i++) {
    let r = 0;
    let gr = 0;
    let b = 0;
    const phase = i / LED_COUNT;
    if (pattern === 'idle') {
      // a slow pink and white chase
      const k = 0.5 + 0.5 * Math.sin((phase * 6 - t / 1400) * Math.PI * 2);
      r = 255;
      gr = 90 + 120 * k;
      b = 160 + 80 * k;
      const lvl = 0.35 + 0.45 * k;
      r *= lvl;
      gr *= lvl;
      b *= lvl;
    } else if (pattern === 'spin') {
      const on = (i + Math.floor(t / 70)) % 6 < 2;
      r = on ? 255 : 60;
      gr = on ? 200 : 30;
      b = on ? 240 : 70;
    } else if (pattern === 'reach') {
      const on = Math.floor(t / 110) % 2 === 0;
      r = 255;
      gr = on ? 40 : 190;
      b = on ? 40 : 40;
    } else {
      // hit and fever: every colour, fast
      const hue = (phase * 3 + t / (pattern === 'hit' ? 300 : 600)) % 1;
      const [hr, hg, hb] = hsv(hue);
      const on = pattern === 'hit' ? Math.floor(t / 90) % 2 === 0 : true;
      r = hr * (on ? 255 : 90);
      gr = hg * (on ? 255 : 90);
      b = hb * (on ? 255 : 90);
    }
    data[i * 4] = r;
    data[i * 4 + 1] = gr;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
}

function hsv(h: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  switch (i % 6) {
    case 0:
      return [1, f, 0];
    case 1:
      return [q, 1, 0];
    case 2:
      return [0, 1, f];
    case 3:
      return [0, q, 1];
    case 4:
      return [f, 0, 1];
    default:
      return [1, 0, q];
  }
}

/** The lamp over the window: a big blossom in a ring of bulbs, lit from behind. */
export function paintTopLamp(canvas: HTMLCanvasElement): void {
  canvas.width = 512;
  canvas.height = 160;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#2a0718';
  g.fillRect(0, 0, 512, 160);
  const glow = g.createRadialGradient(256, 80, 10, 256, 80, 240);
  glow.addColorStop(0, 'rgba(255, 120, 170, 0.95)');
  glow.addColorStop(0.35, 'rgba(214, 42, 104, 0.6)');
  glow.addColorStop(1, 'rgba(42, 7, 24, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 512, 160);
  // rays
  g.save();
  g.translate(256, 80);
  for (let i = 0; i < 24; i++) {
    g.rotate((Math.PI * 2) / 24);
    g.fillStyle = i % 2 ? 'rgba(255, 230, 160, 0.16)' : 'rgba(255, 170, 210, 0.1)';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(300, -20);
    g.lineTo(300, 20);
    g.fill();
  }
  g.restore();
  blossom(g, 256, 80, 62, 0.3, '#ffd6e6', '#ff4d8d', 1);
  g.font = `900 38px ${JP}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#a3124c';
  g.fillText('桜', 256, 82);
  // the bulbs along the top and bottom edges
  for (let i = 0; i < 17; i++) {
    for (const y of [12, 148]) {
      const x = 16 + i * 30;
      const b = g.createRadialGradient(x, y, 1, x, y, 9);
      b.addColorStop(0, '#fffbe8');
      b.addColorStop(0.5, i % 2 ? '#ffd23f' : '#ff7ab0');
      b.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = b;
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fill();
    }
  }
}
