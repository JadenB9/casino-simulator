// The bingo hall's painted and lit surfaces: the flashboard on the stage wall (every number that has
// been called lit in its row, the ball count, the ball just called, and what each pattern pays on
// this call), the balls' faces, and the sign over the stage.

import { LETTERS, PRIZES, columnOf, type Pattern } from '../../../../shared/src/games/bingo/rules.ts';

/** The balls' colours by column, as the halls paint them: B blue, I red, N white, G green, O yellow. */
export const COLUMN_COLOURS = ['#1f6fd1', '#d8323c', '#e9e6df', '#2e9e4f', '#f2b41d'] as const;
export const COLUMN_INK = ['#ffffff', '#ffffff', '#1a1a1a', '#ffffff', '#1a1a1a'] as const;

export const BOARD_W = 2048;
export const BOARD_H = 680;

export interface BoardState {
  called: readonly number[];
  /** 'sale' with seconds left, 'calling', 'over', 'idle'. */
  phase: 'idle' | 'sale' | 'calling' | 'over';
  seconds?: number;
  /** Lit this frame for the newest ball's flash. */
  flash: boolean;
}

/** What `p` pays if it is completed on this call, and until which call. */
export function nowPays(p: Pattern, call: number): { mult: number; upTo: number } | null {
  for (const b of PRIZES[p]) if (call <= b.upTo) return { mult: b.mult, upTo: b.upTo };
  return null;
}

export function multText(hundredths: number): string {
  const x = hundredths / 100;
  return `${x >= 1000 ? x.toLocaleString('en-US') : x}×`;
}

function ball(g: CanvasRenderingContext2D, x: number, y: number, r: number, n: number): void {
  const col = columnOf(n);
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, COLUMN_COLOURS[col]!);
  grad.addColorStop(1, shade(COLUMN_COLOURS[col]!, 0.55));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  // the white face band with the number
  g.fillStyle = '#fbfaf6';
  g.beginPath();
  g.arc(x, y, r * 0.62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#16120e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(r * 0.34)}px 'Barlow Condensed', sans-serif`;
  g.fillText(LETTERS[col]!, x, y - r * 0.26);
  g.font = `700 ${Math.round(r * 0.62)}px 'Barlow Condensed', sans-serif`;
  g.fillText(String(n), x, y + r * 0.14);
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const gg = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r}, ${gg}, ${b})`;
}

/** A called ball's face for the ball in the display cradle (256 px square). */
export function paintBallFace(canvas: HTMLCanvasElement, n: number | null): void {
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  if (n !== null) ball(g, 128, 128, 124, n);
}

export function paintBoard(canvas: HTMLCanvasElement, st: BoardState): void {
  canvas.width = BOARD_W;
  canvas.height = BOARD_H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#0d0b10';
  g.fillRect(0, 0, BOARD_W, BOARD_H);
  const lit = new Set(st.called);
  const last = st.called.at(-1) ?? null;

  // the grid: a letter tile and fifteen bulbs a row
  const x0 = 26;
  const y0 = 30;
  const cell = 86;
  const rowH = 124;
  for (let r = 0; r < 5; r++) {
    const y = y0 + r * rowH;
    g.fillStyle = COLUMN_COLOURS[r]!;
    g.fillRect(x0, y, 104, rowH - 14);
    g.fillStyle = COLUMN_INK[r]!;
    g.font = `800 88px 'Barlow Condensed', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(LETTERS[r]!, x0 + 52, y + (rowH - 14) / 2 + 4);
    for (let i = 0; i < 15; i++) {
      const n = r * 15 + i + 1;
      const cx = x0 + 130 + i * cell + cell / 2;
      const cy = y + (rowH - 14) / 2;
      const on = lit.has(n);
      const newest = n === last && st.flash;
      g.fillStyle = on ? (newest ? '#fff8d8' : '#3a2408') : '#17141b';
      g.fillRect(cx - cell / 2 + 4, y, cell - 8, rowH - 14);
      if (on) {
        g.shadowColor = '#ffb347';
        g.shadowBlur = newest ? 38 : 20;
      }
      g.fillStyle = on ? (newest ? '#2a1800' : '#ffcf6b') : '#3a3540';
      g.font = `700 60px 'Barlow Condensed', sans-serif`;
      g.fillText(String(n), cx, cy + 3);
      g.shadowBlur = 0;
    }
  }

  // the right-hand panel
  const px0 = 1470;
  g.fillStyle = '#16121a';
  g.fillRect(px0, 18, BOARD_W - px0 - 18, BOARD_H - 36);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#9d93a8';
  g.font = `600 30px 'Barlow Condensed', sans-serif`;
  g.fillText('BALL', px0 + 30, 70);
  g.font = `700 150px DSEG7, monospace`;
  g.fillStyle = 'rgba(255, 80, 60, 0.12)';
  g.fillText('88', px0 + 26, 236);
  g.fillStyle = '#ff5a3c';
  g.shadowColor = '#ff5a3c';
  g.shadowBlur = 18;
  g.fillText(String(st.called.length).padStart(2, '!'), px0 + 26, 236);
  g.shadowBlur = 0;
  if (last !== null) ball(g, px0 + 420, 160, 118, last);

  const call = st.called.length + 1;
  const lines: [string, string, string][] = [];
  if (st.phase === 'sale') {
    lines.push(['CARDS ON SALE', st.seconds !== undefined ? `${st.seconds}s` : 'OPEN', '#ffcf6b']);
  } else if (st.phase === 'over') {
    lines.push(['GAME OVER', `${st.called.length} BALLS`, '#ff8f7a']);
  }
  for (const p of ['line', 'corners', 'blackout'] as Pattern[]) {
    const at = nowPays(p, st.phase === 'calling' ? call : 1);
    const name = p === 'line' ? 'LINE' : p === 'corners' ? 'CORNERS' : 'BLACKOUT';
    if (at) lines.push([`${name} ${multText(at.mult)}`, p === 'blackout' ? `IN ${at.upTo} BALLS` : `TO BALL ${at.upTo}`, p === 'blackout' ? '#7ce38b' : '#f4efe4']);
    else lines.push([name, 'CLOSED', '#5e5666']);
  }
  lines.slice(0, 4).forEach(([a, b, color], i) => {
    const y = 350 + i * 72;
    g.fillStyle = color;
    g.font = `700 50px 'Barlow Condensed', sans-serif`;
    g.textAlign = 'left';
    g.fillText(a, px0 + 30, y);
    g.textAlign = 'right';
    g.font = `600 38px 'Barlow Condensed', sans-serif`;
    g.fillStyle = '#b5aabf';
    g.fillText(b, BOARD_W - 44, y);
  });
}

/** The sign over the stage. */
export function paintSign(canvas: HTMLCanvasElement): void {
  canvas.width = 1024;
  canvas.height = 192;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1a0f0a';
  g.fillRect(0, 0, 1024, 192);
  // marquee bulbs round the edge
  for (let i = 0; i < 34; i++) {
    for (const y of [14, 178]) {
      const x = 16 + i * 30;
      const b = g.createRadialGradient(x, y, 1, x, y, 9);
      b.addColorStop(0, '#fffbe8');
      b.addColorStop(0.6, '#ffc24a');
      b.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = b;
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const word = 'BINGO';
  for (let i = 0; i < 5; i++) {
    const x = 512 + (i - 2) * 150;
    g.fillStyle = COLUMN_COLOURS[i]!;
    g.beginPath();
    g.arc(x, 96, 66, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fbfaf6';
    g.beginPath();
    g.arc(x, 96, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#16120e';
    g.font = `800 70px 'Barlow Condensed', sans-serif`;
    g.fillText(word[i]!, x, 100);
  }
}
