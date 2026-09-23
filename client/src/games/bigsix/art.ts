// The Big Six pictures, drawn in code so the wheel, the felt and the HUD share them: a note for
// each bill (pale paper, an engraved border, an oval with the value, corner numerals), a Star
// and a Crown in gold. Each symbol also has a colour, used for its stops on the wheel and its
// panel on the layout, so a glance at either tells the denominations apart.

import type { SymbolId } from '../../../../shared/src/games/bigsix/rules.ts';

export const SYMBOL_COLOR: Record<SymbolId, string> = {
  one: '#c29a35',
  two: '#2b5c98',
  five: '#a3262e',
  ten: '#1f6f47',
  twenty: '#5a3789',
  star: '#121116',
  crown: '#6c1223',
};

/** The number printed on a bill, or null for the two pictures. */
export function billValue(key: SymbolId): number | null {
  switch (key) {
    case 'one':
      return 1;
    case 'two':
      return 2;
    case 'five':
      return 5;
    case 'ten':
      return 10;
    case 'twenty':
      return 20;
    default:
      return null;
  }
}

const WORDS: Record<number, string> = { 1: 'ONE', 2: 'TWO', 5: 'FIVE', 10: 'TEN', 20: 'TWENTY' };

const PAPER = '#e4e5cc';
const PAPER_2 = '#d3d8b8';
const INK = '#26432f';
const INK_SOFT = 'rgba(38, 67, 47, 0.55)';
const SERIF = 'Cinzel, Georgia, serif';
const CONDENSED = '"Barlow Condensed", "Arial Narrow", sans-serif';

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/**
 * A note centred on (0, 0), `long` by `short` pixels. Upright (`portrait`) it stands on the wheel
 * with its top toward the rim; lying down it sits on the felt.
 */
export function drawNote(g: CanvasRenderingContext2D, value: number, long: number, short: number, portrait: boolean): void {
  const w = portrait ? short : long;
  const h = portrait ? long : short;
  const s = short; // every detail scales with the short side
  g.save();
  // paper and a faint shadow edge
  g.fillStyle = PAPER;
  roundRect(g, -w / 2, -h / 2, w, h, s * 0.04);
  g.fill();
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = Math.max(1, s * 0.012);
  g.stroke();
  // engraved border: a solid frame and a fine inner line
  const b = s * 0.07;
  g.strokeStyle = INK;
  g.lineWidth = s * 0.035;
  g.strokeRect(-w / 2 + b, -h / 2 + b, w - 2 * b, h - 2 * b);
  g.lineWidth = Math.max(1, s * 0.01);
  g.strokeStyle = INK_SOFT;
  g.strokeRect(-w / 2 + b * 1.7, -h / 2 + b * 1.7, w - 3.4 * b, h - 3.4 * b);
  // guilloche: fine arcs across the paper, the look of engraving without copying any real note
  g.save();
  roundRect(g, -w / 2 + b * 1.7, -h / 2 + b * 1.7, w - 3.4 * b, h - 3.4 * b, 0);
  g.clip();
  g.strokeStyle = 'rgba(38, 67, 47, 0.16)';
  g.lineWidth = Math.max(0.6, s * 0.006);
  for (let i = -6; i <= 6; i++) {
    g.beginPath();
    g.ellipse(0, 0, w * (0.28 + 0.045 * Math.abs(i)), h * (0.28 + 0.045 * Math.abs(i)), (i * Math.PI) / 13, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  // the oval with the value
  const ow = portrait ? w * 0.36 : w * 0.17;
  const oh = portrait ? h * 0.17 : h * 0.34;
  g.fillStyle = PAPER_2;
  g.beginPath();
  g.ellipse(0, 0, ow, oh, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = s * 0.028;
  g.stroke();
  g.lineWidth = Math.max(1, s * 0.01);
  g.beginPath();
  g.ellipse(0, 0, ow * 0.84, oh * 0.84, 0, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const digits = String(value);
  const big = Math.min(oh * (portrait ? 1.1 : 1.35), (ow * 2 * 0.95) / (digits.length * 0.62));
  g.font = `700 ${big}px ${SERIF}`;
  g.fillText(digits, 0, big * 0.06);
  // corner numerals
  const small = s * 0.2;
  g.font = `700 ${small}px ${SERIF}`;
  const cx = w / 2 - b - small * 0.55 * Math.max(1, digits.length * 0.8);
  const cy = h / 2 - b - small * 0.62;
  for (const [x, y] of [[-cx, -cy], [cx, -cy], [-cx, cy], [cx, cy]] as const) g.fillText(digits, x, y);
  if (portrait) {
    // on the wheel: the value again, large, toward the rim, where the clapper reads it
    const top = s * 0.42;
    g.font = `700 ${top}px ${SERIF}`;
    g.fillText(digits, 0, -h * 0.3);
    g.fillText(digits, 0, h * 0.3);
  } else {
    g.font = `600 ${s * 0.15}px ${CONDENSED}`;
    g.fillText(WORDS[value] ?? '', -w * 0.3, 0);
    g.fillText(value === 1 ? 'DOLLAR' : 'DOLLARS', w * 0.3, 0);
  }
  g.restore();
}

/** A five-pointed star, outer radius r, in polished gold. */
export function drawStar(g: CanvasRenderingContext2D, r: number, rotation = 0): void {
  g.save();
  g.rotate(rotation);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.43;
    const a = (i * Math.PI) / 5;
    const x = rr * Math.sin(a);
    const y = -rr * Math.cos(a);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  const grad = g.createLinearGradient(-r, -r, r, r);
  grad.addColorStop(0, '#fbe6a6');
  grad.addColorStop(0.45, '#e2b654');
  grad.addColorStop(1, '#9c6f22');
  g.fillStyle = grad;
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1, r * 0.05);
  g.strokeStyle = '#5e3f10';
  g.stroke();
  // the bevel: a line from each point to the centre
  g.lineWidth = Math.max(0.6, r * 0.022);
  g.strokeStyle = 'rgba(94, 63, 16, 0.55)';
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.43;
    const a = (i * Math.PI) / 5;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(rr * Math.sin(a), -rr * Math.cos(a));
    g.stroke();
  }
  g.restore();
}

/** A crown `w` wide, centred on (0, 0): a jewelled band and five points with pearls. */
export function drawCrown(g: CanvasRenderingContext2D, w: number): void {
  const h = w * 0.78;
  const x0 = -w / 2;
  const top = -h / 2;
  const bandTop = h * 0.16;
  const bandBottom = h / 2;
  g.save();
  const grad = g.createLinearGradient(0, top, 0, bandBottom);
  grad.addColorStop(0, '#fbe6a6');
  grad.addColorStop(0.55, '#dcae4c');
  grad.addColorStop(1, '#8f6420');
  g.fillStyle = grad;
  g.strokeStyle = '#5e3f10';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1, w * 0.025);
  // the points
  g.beginPath();
  g.moveTo(x0, bandTop);
  const peaks = [0, 0.25, 0.5, 0.75, 1];
  const valleys = [0.125, 0.375, 0.625, 0.875];
  g.lineTo(x0 + w * 0.02, top + h * 0.2);
  for (let i = 0; i < 4; i++) {
    g.lineTo(x0 + w * valleys[i]!, top + h * 0.5);
    const px = peaks[i + 1]!;
    g.lineTo(x0 + w * (px === 1 ? 0.98 : px), top + (px === 0.5 ? 0 : h * 0.14));
  }
  g.lineTo(x0 + w, bandTop);
  g.closePath();
  g.fill();
  g.stroke();
  // the band
  roundRect(g, x0, bandTop, w, bandBottom - bandTop, w * 0.03);
  g.fill();
  g.stroke();
  // pearls on the points, jewels on the band
  g.fillStyle = '#f6efe0';
  for (const px of peaks) {
    const x = x0 + w * (px === 0 ? 0.02 : px === 1 ? 0.98 : px);
    const y = top + (px === 0.5 ? 0 : px === 0 || px === 1 ? h * 0.2 : h * 0.14);
    g.beginPath();
    g.arc(x, y, w * 0.045, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  const jewels = ['#b0182c', '#1d5fae', '#b0182c'];
  jewels.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(x0 + w * (0.25 + i * 0.25), (bandTop + bandBottom) / 2, w * 0.055, h * 0.08, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = Math.max(0.6, w * 0.012);
    g.stroke();
  });
  g.restore();
}

/** A symbol's picture filling a box `size` pixels tall (the note, the star or the crown), centred on (0, 0). */
export function drawSymbol(g: CanvasRenderingContext2D, key: SymbolId, size: number, portraitNote = false): void {
  const v = billValue(key);
  if (v !== null) {
    if (portraitNote) drawNote(g, v, size, size / 2.35, true);
    else drawNote(g, v, size * 2.35, size, false);
  } else if (key === 'star') {
    drawStar(g, size * 0.5);
  } else {
    drawCrown(g, size * 1.05);
  }
}

/** A small badge for the HUD (history, result plaque): the symbol's colour with its value or picture. */
export function badgeCanvas(key: SymbolId, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  c.width = c.height = Math.round(px * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.translate(px / 2, px / 2);
  g.fillStyle = SYMBOL_COLOR[key];
  g.beginPath();
  g.arc(0, 0, px / 2 - 1, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(1, px * 0.06);
  g.strokeStyle = '#e2c27a';
  g.stroke();
  const v = billValue(key);
  if (v !== null) {
    g.fillStyle = '#f6efe0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const digits = String(v);
    g.font = `700 ${px * (digits.length > 1 ? 0.42 : 0.52)}px ${SERIF}`;
    g.fillText(digits, 0, px * 0.04);
  } else if (key === 'star') {
    drawStar(g, px * 0.34);
  } else {
    drawCrown(g, px * 0.56);
  }
  c.className = 'bs-badge';
  c.style.width = c.style.height = `${px}px`;
  return c;
}
