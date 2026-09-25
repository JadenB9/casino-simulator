// The Casino Index's chart: the price over the range as one line, a dotted rule at where the range
// opened, the high and low marked on the right, and the price and time under the pointer.

import { el } from '../kit.ts';
import { FUND_STEP_MS, formatPrice } from '../../../../shared/src/bank.ts';

const LINE = '#e2be76';
const RULE = 'rgba(214, 178, 110, 0.35)';
const GRID = 'rgba(214, 178, 110, 0.09)';
const INK = 'rgba(244, 239, 228, 0.55)';
const FONT = '12px "Barlow Condensed", "Arial Narrow", sans-serif';
/** Room on the right for the price labels. */
const LABELS = 64;

const timeFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export class PriceChart {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly tip: HTMLElement;
  private points: [number, number][] = [];
  private hover: number | null = null;
  private readonly ro: ResizeObserver;

  constructor() {
    this.root = el('div', 'bank-chart');
    this.canvas = el('canvas', 'bank-chart-canvas');
    this.canvas.setAttribute('role', 'img');
    this.tip = el('div', 'bank-chart-tip money');
    this.tip.hidden = true;
    this.root.append(this.canvas, this.tip);
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const w = r.width - LABELS;
      if (this.points.length < 2 || w <= 0) return;
      this.hover = Math.max(0, Math.min(this.points.length - 1, Math.round(((e.clientX - r.left) / w) * (this.points.length - 1))));
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.root);
  }

  set(points: [number, number][]): void {
    this.points = points;
    const first = points[0]?.[1];
    const last = points.at(-1)?.[1];
    this.canvas.setAttribute('aria-label', first && last ? `Price from ${formatPrice(first)} to ${formatPrice(last)}` : 'No prices yet');
    this.draw();
  }

  destroy(): void {
    this.ro.disconnect();
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
    const pts = this.points;
    if (pts.length < 2) {
      g.fillStyle = INK;
      g.font = FONT;
      g.fillText('The first prices appear in a few minutes.', 8, h / 2);
      this.tip.hidden = true;
      return;
    }
    const prices = pts.map((p) => p[1]);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    const pad = Math.max(1, (hi - lo) * 0.12);
    lo -= pad;
    hi += pad;
    const top = 10;
    const bottom = h - 10;
    const plotW = w - LABELS;
    const x = (i: number) => (i / (pts.length - 1)) * plotW;
    const y = (p: number) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);

    // quiet grid: four rules with their prices
    g.font = FONT;
    g.textBaseline = 'middle';
    for (let k = 0; k <= 3; k++) {
      const p = lo + ((hi - lo) * k) / 3;
      const yy = Math.round(y(p)) + 0.5;
      g.strokeStyle = GRID;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(plotW, yy);
      g.stroke();
      g.fillStyle = INK;
      g.fillText(formatPrice(Math.round(p)).replace(/(\.\d{2})\d+$/, '$1'), plotW + 8, yy);
    }
    // where the range opened
    const open = y(prices[0]!);
    g.strokeStyle = RULE;
    g.setLineDash([2, 4]);
    g.beginPath();
    g.moveTo(0, open);
    g.lineTo(plotW, open);
    g.stroke();
    g.setLineDash([]);
    // the price
    g.strokeStyle = LINE;
    g.lineWidth = 1.6;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([, p], i) => (i === 0 ? g.moveTo(x(i), y(p)) : g.lineTo(x(i), y(p))));
    g.stroke();
    // now
    const last = pts.length - 1;
    g.fillStyle = LINE;
    g.beginPath();
    g.arc(x(last), y(prices[last]!), 3, 0, Math.PI * 2);
    g.fill();

    if (this.hover === null) {
      this.tip.hidden = true;
      return;
    }
    const i = this.hover;
    g.strokeStyle = RULE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(x(i)) + 0.5, top);
    g.lineTo(Math.round(x(i)) + 0.5, bottom);
    g.stroke();
    g.fillStyle = LINE;
    g.beginPath();
    g.arc(x(i), y(prices[i]!), 3.5, 0, Math.PI * 2);
    g.fill();
    this.tip.hidden = false;
    this.tip.textContent = `${timeFmt.format(pts[i]![0] * FUND_STEP_MS)} · ${formatPrice(prices[i]!)}`;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${Math.max(0, Math.min(plotW - tw, x(i) - tw / 2))}px`;
  }
}
