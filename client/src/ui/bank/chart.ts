// The Casino Index's chart: the price over the range as one line with the ground under it tinted,
// a dotted rule at where the range opened, the price scale on the right with the price now tagged
// on it, the range's change in the corner, and the price and time under the pointer. The arrow
// keys walk the same marker along the line when the chart has focus (Home and End for the ends).

import { el } from '../kit.ts';
import { FUND_STEP_MS, formatPrice } from '../../../../shared/src/bank.ts';
import { onTheme } from '../../app/theme.ts';

type Range = '1d' | '7d' | '30d';

/** The chart's colours come from the theme's tokens (styles/theme.css), read when it draws. */
function palette(root: HTMLElement): { line: string; brass: string; ink: string; sheet: string; onGold: string } {
  const css = getComputedStyle(root);
  const get = (name: string, or: string) => css.getPropertyValue(name).trim() || or;
  return { line: get('--brass', '#d8b06a'), brass: get('--brass-rgb', '226, 190, 118'), ink: get('--ink-rgb', '244, 239, 228'), sheet: get('--sheet-rgb', '17, 14, 11'), onGold: get('--on-gold', '#1d140a') };
}
const FONT = '12px "Barlow Condensed", "Arial Narrow", sans-serif';
const BOLD = '600 12px "Barlow Condensed", "Arial Narrow", sans-serif';
/** Room on the right for the price labels. */
const LABELS = 66;
const RANGE_WORDS: Record<Range, string> = { '1d': 'today', '7d': 'over 7 days', '30d': 'over 30 days' };

const timeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A price to the cent, for the scale ("$85.17"). */
const cents = (ticks: number) => formatPrice(Math.round(ticks)).replace(/(\.\d{2})\d+$/, '$1');

export class PriceChart {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly tip: HTMLElement;
  private readonly change: HTMLElement;
  private points: [number, number][] = [];
  private range: Range = '1d';
  private hover: number | null = null;
  private readonly ro: ResizeObserver;
  private readonly offTheme: () => void;

  constructor() {
    this.root = el('div', 'bank-chart');
    this.canvas = el('canvas', 'bank-chart-canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.tabIndex = 0;
    this.tip = el('div', 'bank-chart-tip money');
    this.tip.hidden = true;
    this.change = el('div', 'bank-chart-change money');
    this.root.append(this.canvas, this.change, this.tip);
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const w = r.width - LABELS;
      if (this.points.length < 2 || w <= 0) return;
      this.at(Math.round(((e.clientX - r.left) / w) * (this.points.length - 1)));
    });
    this.canvas.addEventListener('pointerleave', () => this.at(null));
    this.canvas.addEventListener('keydown', (e) => {
      const n = this.points.length;
      if (n < 2) return;
      const i = this.hover ?? n - 1;
      const step = Math.max(1, Math.round(n / 48));
      if (e.key === 'ArrowLeft') this.at(i - step);
      else if (e.key === 'ArrowRight') this.at(i + step);
      else if (e.key === 'Home') this.at(0);
      else if (e.key === 'End') this.at(n - 1);
      else return;
      e.preventDefault();
    });
    this.canvas.addEventListener('blur', () => this.at(null));
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.root);
    this.offTheme = onTheme(() => this.draw());
  }

  set(points: [number, number][], range: Range = this.range): void {
    this.points = points;
    this.range = range;
    this.hover = null;
    const first = points[0]?.[1];
    const last = points.at(-1)?.[1];
    if (first && last && points.length > 1) {
      const pct = ((last - first) / first) * 100;
      this.change.textContent = `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}% ${RANGE_WORDS[range]}`;
      this.change.className = `bank-chart-change money ${pct > 0 ? 'win' : pct < 0 ? 'lose' : ''}`.trim();
      this.change.hidden = false;
      this.canvas.setAttribute('aria-label', `${points.length} prices ${RANGE_WORDS[range]}, from ${formatPrice(first)} to ${formatPrice(last)}. Arrow keys read the prices along the line.`);
    } else {
      this.change.hidden = true;
      this.canvas.setAttribute('aria-label', 'No prices yet');
    }
    this.draw();
  }

  destroy(): void {
    this.ro.disconnect();
    this.offTheme();
  }

  /** Put the marker on a point (null takes it away); nothing is drawn if it didn't move. */
  private at(i: number | null): void {
    const n = this.points.length;
    const next = i === null || n < 2 ? null : Math.max(0, Math.min(n - 1, i));
    if (next === this.hover) return;
    this.hover = next;
    this.draw();
  }

  private draw(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const c = palette(this.root);
    const ink = (a: number) => `rgba(${c.ink}, ${a})`;
    const brass = (a: number) => `rgba(${c.brass}, ${a})`;
    const pts = this.points;
    if (pts.length < 2) {
      g.save();
      g.fillStyle = ink(0.55);
      g.font = FONT;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('The first prices appear in a few minutes.', w / 2, h / 2);
      g.restore();
      this.tip.hidden = true;
      return;
    }
    const prices = pts.map((p) => p[1]);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    const pad = Math.max(1, (hi - lo) * 0.14);
    lo -= pad;
    hi += pad;
    const top = 28;
    const bottom = h - 10;
    const plotW = w - LABELS;
    const x = (i: number) => (i / (pts.length - 1)) * plotW;
    const y = (p: number) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);

    // a quiet grid: four rules with their prices
    g.font = FONT;
    g.textBaseline = 'middle';
    for (let k = 0; k <= 3; k++) {
      const p = lo + ((hi - lo) * k) / 3;
      const yy = Math.round(y(p)) + 0.5;
      g.strokeStyle = brass(0.1);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(plotW, yy);
      g.stroke();
      g.fillStyle = ink(0.5);
      g.fillText(cents(p), plotW + 9, yy);
    }
    // the ground under the line, fading down
    const area = g.createLinearGradient(0, top, 0, bottom);
    area.addColorStop(0, brass(0.24));
    area.addColorStop(1, brass(0));
    g.fillStyle = area;
    g.beginPath();
    g.moveTo(0, bottom);
    pts.forEach(([, p], i) => g.lineTo(x(i), y(p)));
    g.lineTo(plotW, bottom);
    g.closePath();
    g.fill();
    // where the range opened
    const open = Math.round(y(prices[0]!)) + 0.5;
    g.strokeStyle = brass(0.4);
    g.setLineDash([2, 4]);
    g.beginPath();
    g.moveTo(0, open);
    g.lineTo(plotW, open);
    g.stroke();
    g.setLineDash([]);
    // the price
    g.strokeStyle = c.line;
    g.lineWidth = 1.7;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([, p], i) => (i === 0 ? g.moveTo(x(i), y(p)) : g.lineTo(x(i), y(p))));
    g.stroke();
    // now: a dot on the line, and its price tagged on the scale
    const last = pts.length - 1;
    const ly = y(prices[last]!);
    g.fillStyle = brass(0.25);
    g.beginPath();
    g.arc(x(last), ly, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.line;
    g.beginPath();
    g.arc(x(last), ly, 3, 0, Math.PI * 2);
    g.fill();
    const tag = cents(prices[last]!);
    g.font = BOLD;
    const tw = g.measureText(tag).width + 10;
    const ty = Math.max(top - 8, Math.min(bottom - 9, ly - 9));
    g.fillStyle = c.line;
    g.beginPath();
    g.moveTo(plotW + 3, ly);
    g.lineTo(plotW + 8, ty);
    g.lineTo(plotW + 8 + tw, ty);
    g.lineTo(plotW + 8 + tw, ty + 18);
    g.lineTo(plotW + 8, ty + 18);
    g.closePath();
    g.fill();
    g.fillStyle = c.onGold;
    g.fillText(tag, plotW + 13, ty + 9.5);

    if (this.hover === null) {
      this.tip.hidden = true;
      return;
    }
    const i = this.hover;
    const hx = Math.round(x(i)) + 0.5;
    g.strokeStyle = brass(0.45);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(hx, top - 6);
    g.lineTo(hx, bottom);
    g.stroke();
    g.fillStyle = `rgba(${c.sheet}, 1)`;
    g.beginPath();
    g.arc(x(i), y(prices[i]!), 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.line;
    g.beginPath();
    g.arc(x(i), y(prices[i]!), 3.5, 0, Math.PI * 2);
    g.fill();
    const vs = ((prices[i]! - prices[0]!) / prices[0]!) * 100;
    this.tip.hidden = false;
    this.tip.textContent = `${timeFmt.format(pts[i]![0] * FUND_STEP_MS)} · ${formatPrice(prices[i]!)} · ${vs >= 0 ? '+' : '−'}${Math.abs(vs).toFixed(2)}%`;
    // centred on the marker, kept inside the plot (a transform: no layout read per move)
    this.tip.style.transform = `translateX(${Math.max(0, Math.min(plotW - 210, x(i) - 105)).toFixed(1)}px)`;
  }
}
