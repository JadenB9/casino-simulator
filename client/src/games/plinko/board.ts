// The Plinko board: pegs and balls on a canvas, with the bins, the recent-results column and a
// bin's hover card as DOM over it. The layout is the usual one: row r of the triangle has r + 3
// pegs, a ball that has gone right R times in its first r rows lands on peg R + 1 of row r, and
// bin k sits under the gap a ball reaches after k rights.
//
// A ball never decides anything. It follows the path the server sent, row by row: it rests on a
// peg, hops off to the side the path says and falls onto the next one, so several balls can be
// in the air at once while every one of them is already paid.

import { el } from '../../ui/kit.ts';
import { SCREEN_PX } from '../online/screen.ts';
import { MULTS, type Risk, type Rows } from '../../../../shared/src/games/plinko/rules.ts';
import type { DropEvent, PlinkoDrop } from '../../../../shared/src/games/plinko/engine.ts';
import { flashAllowed } from '../../app/comfort.ts';

/** The page's main area: the page less the bet panel, the top bar and the foot (online.css). */
const W = SCREEN_PX.w - 330;
const H = SCREEN_PX.h - 64 - 34;
const COLUMN = 64;
const TOP = 80;
const BOTTOM = 30;
/** Canvas pixels per design pixel: the page is often drawn larger than 1:1 on a sharp screen. */
const DPR = 2;
const RESULTS = 5;
const FIRST_DROP_S = 0.3;
const FADE_S = 0.14;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

interface Geometry {
  rows: number;
  /** Peg spacing along a row, and the spacing of the rows. */
  s: number;
  g: number;
  cx: number;
  pegR: number;
  ballR: number;
  binTop: number;
  binH: number;
}

function geometry(rows: number): Geometry {
  const s = Math.min((W - 2 * (COLUMN + 48)) / (rows + 1), (H - TOP - BOTTOM) / ((rows - 1) * 0.9 + 1.3));
  const g = s * 0.9;
  return {
    rows,
    s,
    g,
    cx: W / 2,
    pegR: clamp(s * 0.085, 3, 5.5),
    ballR: clamp(s * 0.19, 7, 12),
    binTop: TOP + (rows - 1) * g + g * 0.58,
    binH: clamp(s * 0.74, 26, 40),
  };
}

/** Bin colours: yellow in the middle to red at the edges, each with a darker lip. */
export function binColor(bin: number, rows: number): { face: string; lip: string } {
  const t = Math.abs(bin - rows / 2) / (rows / 2);
  const mix = (a: number[], b: number[]) => `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(', ')})`;
  return { face: mix([255, 192, 0], [255, 0, 63]), lip: mix([171, 121, 0], [166, 0, 4]) };
}

/** A multiplier in hundredths as the bins print it: 1000×, 26×, 5.6×, 0.2×. */
export function multText(m: number): string {
  return `${m % 100 === 0 ? m / 100 : m / 100}×`;
}

interface Ball {
  drop: DropEvent;
  geo: Geometry;
  /** Waypoints: the drop point, the contact on each row's peg, the bin. */
  pts: { x: number; y: number }[];
  /** Which peg of each row the ball lands on. */
  pegs: number[];
  /** How hard each hop kicks up (0 for the first fall). */
  hops: number[];
  seg: number;
  t: number;
  x: number;
  y: number;
  /** Seconds since it dropped into the bin. */
  gone: number;
}

interface Flash {
  x: number;
  y: number;
  age: number;
}

export interface BoardHooks {
  /** A ball touched a peg on this row. */
  peg(row: number, rows: number): void;
  /** A ball reached its bin. */
  land(drop: DropEvent): void;
  /** What the hover card says about a bin: label and value rows. */
  describe(bin: number): [string, string][];
}

export class PlinkoBoard {
  readonly root = el('div', 'pk-board');
  private readonly canvas = el('canvas', 'pk-canvas');
  private readonly g2: CanvasRenderingContext2D;
  private readonly binRow = el('div', 'pk-bins');
  private readonly column = el('div', 'pk-column');
  private readonly card = el('dl', 'pk-card');
  private binEls: HTMLElement[] = [];
  private balls: Ball[] = [];
  private flashes: Flash[] = [];
  private geo = geometry(16);
  private risk: Risk = 'medium';
  private dirty = true;
  private hovered: number | null = null;

  constructor(private readonly hooks: BoardHooks) {
    this.canvas.width = W * DPR;
    this.canvas.height = H * DPR;
    this.g2 = this.canvas.getContext('2d')!;
    this.card.hidden = true;
    this.column.hidden = true;
    this.root.append(this.canvas, this.binRow, this.column, this.card);
    this.setBoard(16, 'medium');
  }

  get rows(): Rows {
    return this.geo.rows as Rows;
  }

  get riskLevel(): Risk {
    return this.risk;
  }

  /** Balls still falling (one that has reached its bin no longer counts). */
  get inFlight(): number {
    let n = 0;
    for (const b of this.balls) if (b.gone < 0) n++;
    return n;
  }

  setBoard(rows: Rows, risk: Risk): void {
    if (rows !== this.geo.rows) this.geo = geometry(rows);
    this.risk = risk;
    this.buildBins();
    this.dirty = true;
  }

  /** Start a ball down the path the server drew. */
  drop(d: DropEvent): void {
    if (d.rows !== this.geo.rows || d.risk !== this.risk) this.setBoard(d.rows, d.risk);
    const geo = this.geo;
    const { s, g, cx, pegR, ballR, binTop, binH } = geo;
    const rest = (pegR + ballR) * 0.92;
    const pts = [{ x: cx + (Math.random() - 0.5) * 2, y: Math.max(ballR + 6, TOP - g * 0.95) }];
    const pegs: number[] = [];
    let rights = 0;
    for (let r = 0; r < d.rows; r++) {
      pegs.push(rights + 1);
      pts.push({ x: cx + (rights - r / 2) * s, y: TOP + r * g - rest });
      rights += d.path[r]!;
    }
    pts.push({ x: cx + (d.bin - d.rows / 2) * s, y: binTop + binH * 0.25 });
    const hops = pts.map((_, i) => (i === 0 ? 0 : 0.55 + Math.random() * 0.3));
    this.balls.push({ drop: d, geo, pts, pegs, hops, seg: 0, t: 0, x: pts[0]!.x, y: pts[0]!.y, gone: -1 });
    this.dirty = true;
  }

  /** Drop every ball without paying anything out (a fresh snapshot supersedes them). */
  clear(): void {
    this.balls = [];
    this.flashes = [];
    this.dirty = true;
  }

  /** The results column from a view's recent drops (newest first), without animation. */
  showResults(recent: readonly PlinkoDrop[]): void {
    this.column.replaceChildren();
    for (const d of recent.slice(0, RESULTS)) this.column.append(this.resultTile(d, false));
    this.column.hidden = this.column.childElementCount === 0;
  }

  pushResult(d: PlinkoDrop): void {
    this.column.prepend(this.resultTile(d, true));
    while (this.column.childElementCount > RESULTS) this.column.lastElementChild!.remove();
    this.column.hidden = false;
  }

  /** Refresh the hover card (the bet changed under it). */
  refreshCard(): void {
    if (this.hovered !== null) this.hover(this.hovered);
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.1);
    for (const b of this.balls) this.advance(b, step);
    const before = this.balls.length;
    this.balls = this.balls.filter((b) => b.gone < FADE_S);
    for (const f of this.flashes) f.age += step;
    this.flashes = this.flashes.filter((f) => f.age < 0.3);
    if (this.dirty || this.balls.length || this.flashes.length || before !== this.balls.length) this.draw();
    this.dirty = false;
  }

  private segDur(b: Ball, seg: number): number {
    return seg === 0 ? FIRST_DROP_S : 0.085 + b.geo.g * 0.0012;
  }

  private advance(b: Ball, dt: number): void {
    const rows = b.drop.rows;
    if (b.gone >= 0) {
      b.gone += dt;
      return;
    }
    b.t += dt;
    let d = this.segDur(b, b.seg);
    while (b.t >= d) {
      b.t -= d;
      b.seg++;
      if (b.seg <= rows) {
        // On a peg of row seg - 1.
        const p = b.pts[b.seg]!;
        const r = b.seg - 1;
        // calm (app/comfort.ts): no flash on every peg the ball touches
        if (flashAllowed()) this.flashes.push({ x: b.geo.cx + (b.pegs[r]! - (r + 2) / 2) * b.geo.s, y: TOP + r * b.geo.g, age: 0 });
        b.x = p.x;
        b.y = p.y;
        this.hooks.peg(r, rows);
      } else {
        const p = b.pts[rows + 1]!;
        b.x = p.x;
        b.y = p.y;
        b.gone = 0;
        this.hit(b.drop.bin);
        this.hooks.land(b.drop);
        return;
      }
      d = this.segDur(b, b.seg);
    }
    const p0 = b.pts[b.seg]!;
    const p1 = b.pts[b.seg + 1]!;
    const k = b.t / d;
    const v = b.hops[b.seg]!;
    const dy = p1.y - p0.y;
    b.x = p0.x + (p1.x - p0.x) * k;
    b.y = p0.y - v * dy * k + (1 + v) * dy * k * k;
  }

  private draw(): void {
    const c = this.g2;
    const { rows, s, g, cx, pegR } = this.geo;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#ffffff';
    c.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let j = 0; j < r + 3; j++) {
        const x = cx + (j - (r + 2) / 2) * s;
        const y = TOP + r * g;
        c.moveTo(x + pegR, y);
        c.arc(x, y, pegR, 0, Math.PI * 2);
      }
    }
    c.fill();
    for (const f of this.flashes) {
      const a = f.age / 0.3;
      c.fillStyle = `rgba(255, 255, 255, ${0.42 * (1 - a)})`;
      c.beginPath();
      c.arc(f.x, f.y, pegR * (1.4 + 1.9 * a), 0, Math.PI * 2);
      c.fill();
    }
    for (const b of this.balls) {
      const R = b.geo.ballR * (b.gone >= 0 ? 1 - b.gone / FADE_S : 1);
      if (R <= 0) continue;
      const grad = c.createRadialGradient(b.x - R * 0.35, b.y - R * 0.4, R * 0.1, b.x, b.y, R);
      grad.addColorStop(0, '#ff9cb6');
      grad.addColorStop(0.45, '#ff2f62');
      grad.addColorStop(1, '#c80d3e');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(b.x, b.y, R, 0, Math.PI * 2);
      c.fill();
    }
  }

  private buildBins(): void {
    this.binRow.replaceChildren();
    this.binEls = [];
    const { rows, s, cx, binTop, binH } = this.geo;
    const mults = MULTS[rows as Rows][this.risk];
    const w = s - 5;
    for (let k = 0; k <= rows; k++) {
      const b = el('div', 'pk-bin', multText(mults[k]!));
      const { face, lip } = binColor(k, rows);
      b.style.left = `${cx + (k - rows / 2) * s - w / 2}px`;
      b.style.top = `${binTop}px`;
      b.style.width = `${w}px`;
      b.style.height = `${binH}px`;
      b.style.fontSize = `${clamp(s * 0.34, 12, 18)}px`;
      b.style.background = face;
      b.style.setProperty('--pk-lip', lip);
      b.addEventListener('pointerenter', () => this.hover(k));
      b.addEventListener('pointerleave', () => this.hover(null));
      this.binRow.append(b);
      this.binEls.push(b);
    }
    if (this.hovered !== null) this.hover(null);
  }

  /** A ball dropped into bin k: it dips and lights, even if another ball is still bouncing it. */
  private hit(k: number): void {
    const b = this.binEls[k];
    if (!b) return;
    b.classList.remove('hit');
    void b.offsetWidth;
    b.classList.add('hit');
  }

  private hover(k: number | null): void {
    this.hovered = k;
    const b = k === null ? undefined : this.binEls[k];
    if (!b || k === null) {
      this.card.hidden = true;
      return;
    }
    this.card.replaceChildren();
    for (const [label, value] of this.hooks.describe(k)) this.card.append(el('dt', '', label), el('dd', '', value));
    const { rows, s, cx, binTop } = this.geo;
    this.card.style.left = `${clamp(cx + (k - rows / 2) * s, 110, W - 110)}px`;
    this.card.style.top = `${binTop - 10}px`;
    this.card.hidden = false;
  }

  private resultTile(d: PlinkoDrop, fresh: boolean): HTMLElement {
    const t = el('div', `pk-result${fresh ? ' fresh' : ''}`, multText(d.mult));
    const { face, lip } = binColor(d.bin, d.rows);
    t.style.background = face;
    t.style.setProperty('--pk-lip', lip);
    t.title = `${d.rows} rows, ${d.risk}: bin ${d.bin + 1} of ${d.rows + 1}`;
    return t;
  }
}
