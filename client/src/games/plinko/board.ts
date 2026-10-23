// The Plinko board: pegs and balls on a canvas, with the bins and a bin's hover card as DOM over
// it. The layout is the usual one: row r of the triangle has r + 3 pegs, a ball that has gone right
// R times in its first r rows lands on peg R + 1 of row r, and bin k sits under the gap a ball
// reaches after k rights.
//
// A ball never decides anything. It follows the path the server sent, row by row: it rests on a
// peg, hops off to the side the path says and falls onto the next one, so several balls can be
// in the air at once while every one of them is already paid.
//
// The pegs are painted once per board onto a canvas of their own and the ball once onto a sprite,
// so a frame with balls in the air is a copy of the pegs and a sprite per ball (and its short
// trail), with nothing allocated: the balls and the peg glints live in pools that are reused.

import { el } from '../../ui/kit.ts';
import { BOARD_PX, HEAD_PX } from '../online/screen.ts';
import { MULTS, type Risk, type Rows } from '../../../../shared/src/games/plinko/rules.ts';
import type { DropEvent } from '../../../../shared/src/games/plinko/engine.ts';
import { flashAllowed } from '../../app/comfort.ts';

/** The board's design size (the page's main area). */
const W = BOARD_PX.w;
const H = BOARD_PX.h;
/** Clear of the page's top row (the result and the recent results) and the ball's drop. */
const TOP = HEAD_PX + 40;
const BOTTOM = 30;
const SIDE = 48;
/** Canvas pixels per design pixel: the page is often drawn larger than 1:1 on a sharp screen. */
const DPR = 2;
const FIRST_DROP_S = 0.3;
const FADE_S = 0.14;
/** Positions a ball's trail keeps (one per frame). */
const TRAIL = 6;
const GLINT_S = 0.3;

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
  const s = Math.min((W - 2 * SIDE) / (rows + 1), (H - TOP - BOTTOM) / ((rows - 1) * 0.9 + 1.3));
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
  return `${m / 100}×`;
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
  /** Seconds since it dropped into the bin (negative while it falls). */
  gone: number;
  /** The last few positions, x and y in turn, newest first; `trailN` of them are filled. */
  trail: Float32Array;
  trailN: number;
}

interface Glint {
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
  /** The pegs, painted once per board. */
  private readonly pegCanvas = document.createElement('canvas');
  /** The ball, painted once at the board's ball size (and its trail's ghost). */
  private readonly ballCanvas = document.createElement('canvas');
  private ballFor = 0;
  private readonly binRow = el('div', 'pk-bins');
  private readonly card = el('dl', 'pk-card');
  private binEls: HTMLElement[] = [];
  private balls: Ball[] = [];
  private glints: Glint[] = [];
  private glintsN = 0;
  private geo = geometry(16);
  private risk: Risk = 'medium';
  private dirty = true;
  private hovered: number | null = null;

  constructor(private readonly hooks: BoardHooks) {
    this.canvas.width = W * DPR;
    this.canvas.height = H * DPR;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g2 = this.canvas.getContext('2d')!;
    this.pegCanvas.width = W * DPR;
    this.pegCanvas.height = H * DPR;
    this.card.hidden = true;
    this.root.append(this.canvas, this.binRow, this.card);
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
    this.paintPegs();
    this.dirty = true;
  }

  /** Start a ball down the path the server drew. */
  drop(d: DropEvent): void {
    if (d.rows !== this.geo.rows || d.risk !== this.risk) this.setBoard(d.rows, d.risk);
    const geo = this.geo;
    const { s, g, cx, pegR, ballR, binTop, binH } = geo;
    const rest = (pegR + ballR) * 0.92;
    // dropped from just under the page's top row, a little way above the first peg
    const pts = [{ x: cx + (Math.random() - 0.5) * 2, y: TOP - Math.min(g * 0.95, 42) }];
    const pegs: number[] = [];
    let rights = 0;
    for (let r = 0; r < d.rows; r++) {
      pegs.push(rights + 1);
      pts.push({ x: cx + (rights - r / 2) * s, y: TOP + r * g - rest });
      rights += d.path[r]!;
    }
    pts.push({ x: cx + (d.bin - d.rows / 2) * s, y: binTop + binH * 0.25 });
    const hops = pts.map((_, i) => (i === 0 ? 0 : 0.55 + Math.random() * 0.3));
    this.balls.push({ drop: d, geo, pts, pegs, hops, seg: 0, t: 0, x: pts[0]!.x, y: pts[0]!.y, gone: -1, trail: new Float32Array(TRAIL * 2), trailN: 0 });
    this.dirty = true;
  }

  /** Drop every ball without paying anything out (a fresh snapshot supersedes them). */
  clear(): void {
    this.balls.length = 0;
    this.glintsN = 0;
    this.dirty = true;
  }

  /** Refresh the hover card (the bet changed under it). */
  refreshCard(): void {
    if (this.hovered !== null) this.hover(this.hovered);
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.1);
    const had = this.balls.length > 0 || this.glintsN > 0;
    for (const b of this.balls) this.advance(b, step);
    // compact in place: no new arrays each frame
    let n = 0;
    for (const b of this.balls) if (b.gone < FADE_S) this.balls[n++] = b;
    this.balls.length = n;
    let m = 0;
    for (let i = 0; i < this.glintsN; i++) {
      const f = this.glints[i]!;
      f.age += step;
      if (f.age < GLINT_S) {
        this.glints[i] = this.glints[m]!;
        this.glints[m++] = f;
      }
    }
    this.glintsN = m;
    if (this.dirty || had) this.draw();
    this.dirty = false;
  }

  private segDur(b: Ball, seg: number): number {
    return seg === 0 ? FIRST_DROP_S : 0.085 + b.geo.g * 0.0012;
  }

  private glint(x: number, y: number): void {
    let f = this.glints[this.glintsN];
    if (!f) {
      f = { x, y, age: 0 };
      this.glints.push(f);
    }
    f.x = x;
    f.y = y;
    f.age = 0;
    this.glintsN++;
  }

  private advance(b: Ball, dt: number): void {
    const rows = b.drop.rows;
    if (b.gone >= 0) {
      b.gone += dt;
      return;
    }
    // the trail: the position the ball leaves this frame, newest first
    b.trail.copyWithin(2, 0, TRAIL * 2 - 2);
    b.trail[0] = b.x;
    b.trail[1] = b.y;
    b.trailN = Math.min(TRAIL, b.trailN + 1);
    b.t += dt;
    let d = this.segDur(b, b.seg);
    while (b.t >= d) {
      b.t -= d;
      b.seg++;
      if (b.seg <= rows) {
        // On a peg of row seg - 1.
        const p = b.pts[b.seg]!;
        const r = b.seg - 1;
        // calm (app/comfort.ts): no glint on every peg the ball touches
        if (flashAllowed()) this.glint(b.geo.cx + (b.pegs[r]! - (r + 2) / 2) * b.geo.s, TOP + r * b.geo.g);
        b.x = p.x;
        b.y = p.y;
        this.hooks.peg(r, rows);
      } else {
        const p = b.pts[rows + 1]!;
        b.x = p.x;
        b.y = p.y;
        b.gone = 0;
        b.trailN = 0;
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

  /** The pegs, once per board: a soft shadow, a lit face and a highlight on each. */
  private paintPegs(): void {
    const c = this.pegCanvas.getContext('2d')!;
    const { rows, s, g, cx, pegR } = this.geo;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    const each = (fn: (x: number, y: number) => void) => {
      for (let r = 0; r < rows; r++) for (let j = 0; j < r + 3; j++) fn(cx + (j - (r + 2) / 2) * s, TOP + r * g);
    };
    c.fillStyle = 'rgba(0, 0, 0, 0.35)';
    c.beginPath();
    each((x, y) => {
      c.moveTo(x + pegR, y + 1.5);
      c.arc(x, y + 1.5, pegR, 0, Math.PI * 2);
    });
    c.fill();
    c.fillStyle = '#e8eef4';
    c.beginPath();
    each((x, y) => {
      c.moveTo(x + pegR, y);
      c.arc(x, y, pegR, 0, Math.PI * 2);
    });
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    const hi = pegR * 0.42;
    each((x, y) => {
      c.moveTo(x - pegR * 0.3 + hi, y - pegR * 0.3);
      c.arc(x - pegR * 0.3, y - pegR * 0.3, hi, 0, Math.PI * 2);
    });
    c.fill();
  }

  /** The ball's sprite at this board's size: a lit pink sphere (drawn again only when the size changes). */
  private ballSprite(R: number): HTMLCanvasElement {
    if (this.ballFor === R) return this.ballCanvas;
    this.ballFor = R;
    const size = Math.ceil(R * 2 + 4) * DPR;
    this.ballCanvas.width = size;
    this.ballCanvas.height = size;
    const c = this.ballCanvas.getContext('2d')!;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const o = R + 2;
    const grad = c.createRadialGradient(o - R * 0.35, o - R * 0.4, R * 0.1, o, o, R);
    grad.addColorStop(0, '#ffb3c8');
    grad.addColorStop(0.45, '#ff2f62');
    grad.addColorStop(1, '#b80b38');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(o, o, R, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255, 255, 255, 0.75)';
    c.beginPath();
    c.ellipse(o - R * 0.38, o - R * 0.42, R * 0.26, R * 0.16, -0.6, 0, Math.PI * 2);
    c.fill();
    return this.ballCanvas;
  }

  private draw(): void {
    const c = this.g2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W * DPR, H * DPR);
    c.drawImage(this.pegCanvas, 0, 0);
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const pegR = this.geo.pegR;
    for (let i = 0; i < this.glintsN; i++) {
      const f = this.glints[i]!;
      const a = f.age / GLINT_S;
      c.globalAlpha = 0.5 * (1 - a);
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(f.x, f.y, pegR * (1.4 + 1.9 * a), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    const trails = flashAllowed();
    for (const b of this.balls) {
      const R0 = b.geo.ballR;
      const sprite = this.ballSprite(R0);
      const half = sprite.width / DPR / 2;
      // a short fading trail behind a falling ball (none while calm)
      if (trails && b.gone < 0) {
        for (let i = b.trailN - 1; i >= 1; i--) {
          const k = 1 - i / TRAIL;
          c.globalAlpha = 0.22 * k;
          const r = half * (0.55 + 0.4 * k);
          c.drawImage(sprite, b.trail[i * 2]! - r, b.trail[i * 2 + 1]! - r, r * 2, r * 2);
        }
        c.globalAlpha = 1;
      }
      const R = b.gone >= 0 ? 1 - b.gone / FADE_S : 1;
      if (R <= 0) continue;
      const r = half * R;
      c.drawImage(sprite, b.x - r, b.y - r, r * 2, r * 2);
    }
    c.globalAlpha = 1;
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
}
