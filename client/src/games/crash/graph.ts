// The flight on a canvas: the curve m(t) = e^(0.00006 t) drawn from the launch to now, with axes
// that stretch as it climbs (so the rocket rides at about four fifths of the width and height),
// the rocket at the tip along the tangent, and a burst where it crashes. Everything is drawn in
// the canvas's own pixels, scaled for the display, from the numbers the view passes in: the time
// since launch and the multiplier the server's rules give for it.

import { RATE } from '../../../../shared/src/games/crash/rules.ts';

export interface Frame {
  phase: 'idle' | 'betting' | 'running' | 'crashed';
  /** ms since the launch (running and crashed). */
  t: number;
  /** The multiplier on show, hundredths. */
  mult: number;
  /** Betting: how much of the window is left, 1 to 0. */
  window: number;
}

const M = { left: 58, right: 26, top: 24, bottom: 36 };
const LINE = '#ffb020';
const LINE_CRASHED = '#ff5a5f';

/** A round step for about `count` grid lines over `span`. */
function niceStep(span: number, count: number): number {
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export class CrashGraph {
  readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** When the burst started (performance.now()), and where. */
  private burst: { at: number; x: number; y: number } | null = null;

  constructor() {
    this.canvas.className = 'cs-canvas';
    this.g = this.canvas.getContext('2d')!;
  }

  /** Size the backing store to the element (design pixels) at the display's density. */
  resize(width: number, height: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width === this.w && height === this.h && dpr === this.dpr) return;
    this.w = width;
    this.h = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  /** Blow the rocket up at the tip of the curve (the next draws show the burst). */
  explode(): void {
    this.burst = { at: performance.now(), x: NaN, y: NaN };
  }

  clearBurst(): void {
    this.burst = null;
  }

  draw(f: Frame): void {
    const { g, w, h } = this;
    if (w === 0) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const pw = w - M.left - M.right;
    const ph = h - M.top - M.bottom;
    const flying = f.phase === 'running' || f.phase === 'crashed';
    const t = flying ? f.t : 0;
    const m = flying ? f.mult / 100 : 1;
    // The axes stretch so the tip stays about 80% along each.
    const xMax = Math.max(8_000, t / 0.82);
    const yMax = Math.max(1.8, 1 + (m - 1) / 0.78);
    const X = (ms: number) => M.left + (ms / xMax) * pw;
    const Y = (mult: number) => M.top + ph - ((mult - 1) / (yMax - 1)) * ph;

    // Grid and labels.
    g.font = '600 13px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.lineWidth = 1;
    const ys = niceStep(yMax - 1, 5);
    g.textAlign = 'right';
    for (let v = 1; v <= yMax + 1e-9; v += ys) {
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = v === 1 ? '#2f4553' : 'rgba(47, 69, 83, 0.55)';
      g.beginPath();
      g.moveTo(M.left, y);
      g.lineTo(M.left + pw, y);
      g.stroke();
      g.fillStyle = '#6f8196';
      g.fillText(`${v.toFixed(ys < 0.1 ? 2 : ys < 1 ? 1 : 0)}×`, M.left - 10, y);
    }
    const xs = niceStep(xMax / 1000, 6);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let s = 0; s <= xMax / 1000 + 1e-9; s += xs) {
      const x = Math.round(X(s * 1000)) + 0.5;
      g.strokeStyle = 'rgba(47, 69, 83, 0.35)';
      g.beginPath();
      g.moveTo(x, M.top);
      g.lineTo(x, M.top + ph);
      g.stroke();
      g.fillStyle = '#6f8196';
      g.fillText(`${Math.round(s)}s`, x, M.top + ph + 10);
    }

    if (!flying) {
      // on the pad, nose up and a little forward
      this.rocket(X(0) + 26, Y(1) - 34, -Math.PI / 2 + 0.45, 0);
      return;
    }

    // The curve, sampled finely enough to stay smooth at any scale.
    const color = f.phase === 'crashed' ? LINE_CRASHED : LINE;
    const n = Math.max(24, Math.min(240, Math.round(pw / 3)));
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const s = (t * i) / n;
      pts.push([X(s), Y(Math.min(m, Math.exp(RATE * s)))]);
    }
    const tip = pts[pts.length - 1]!;
    // Strongest along the baseline, where the area is wide, and gone by the tip: a steep curve
    // would otherwise leave a bright column under it.
    const fill = g.createLinearGradient(0, M.top + ph, 0, tip[1]);
    fill.addColorStop(0, f.phase === 'crashed' ? 'rgba(255, 90, 95, 0.22)' : 'rgba(255, 176, 32, 0.24)');
    fill.addColorStop(1, 'rgba(255, 176, 32, 0)');
    g.beginPath();
    g.moveTo(pts[0]![0], M.top + ph);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(tip[0], M.top + ph);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = color;
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.stroke();
    g.shadowBlur = 0;

    // The rocket along the tangent (in screen space), or the burst where it was.
    const prev = pts[Math.max(0, pts.length - 4)]!;
    const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    if (f.phase === 'crashed') {
      if (this.burst && Number.isNaN(this.burst.x)) {
        this.burst.x = tip[0];
        this.burst.y = tip[1];
      }
      this.explosion(tip[0], tip[1]);
    } else this.rocket(tip[0], tip[1], Number.isFinite(angle) ? angle : -Math.PI / 4, performance.now());
  }

  /** A small rocket pointing along `angle`, nose at (x, y), its flame flickering. */
  private rocket(x: number, y: number, angle: number, now: number): void {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    // flame
    const flick = now ? 0.75 + 0.25 * Math.sin(now / 45) : 0.6;
    const flame = g.createLinearGradient(-34, 0, -58 - 14 * flick, 0);
    flame.addColorStop(0, '#fff1a8');
    flame.addColorStop(0.4, '#ffb020');
    flame.addColorStop(1, 'rgba(255, 90, 40, 0)');
    g.fillStyle = flame;
    g.beginPath();
    g.moveTo(-32, -5.5);
    g.quadraticCurveTo(-50 - 12 * flick, 0, -32, 5.5);
    g.closePath();
    g.fill();
    // body
    const body = g.createLinearGradient(0, -8, 0, 8);
    body.addColorStop(0, '#f3f6fa');
    body.addColorStop(1, '#9fb0c2');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(-7, -8.5, -24, -7.5);
    g.lineTo(-32, -6);
    g.lineTo(-32, 6);
    g.lineTo(-24, 7.5);
    g.quadraticCurveTo(-7, 8.5, 0, 0);
    g.closePath();
    g.fill();
    // fins and window
    g.fillStyle = '#ff5a5f';
    g.beginPath();
    g.moveTo(-22, -7.5);
    g.lineTo(-33, -14);
    g.lineTo(-31, -6);
    g.closePath();
    g.moveTo(-22, 7.5);
    g.lineTo(-33, 14);
    g.lineTo(-31, 6);
    g.closePath();
    g.fill();
    g.fillStyle = '#39a0ff';
    g.beginPath();
    g.arc(-12, 0, 3.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Rings and sparks spreading from where the rocket was, fading over about a second. */
  private explosion(x: number, y: number): void {
    const g = this.g;
    const age = this.burst ? (performance.now() - this.burst.at) / 1000 : 1;
    const k = Math.min(1, age / 0.9);
    const bx = this.burst && !Number.isNaN(this.burst.x) ? this.burst.x : x;
    const by = this.burst && !Number.isNaN(this.burst.y) ? this.burst.y : y;
    if (k < 1) {
      const r = 8 + 60 * (1 - (1 - k) ** 3);
      const glow = g.createRadialGradient(bx, by, 0, bx, by, r);
      glow.addColorStop(0, `rgba(255, 241, 168, ${0.9 * (1 - k)})`);
      glow.addColorStop(0.35, `rgba(255, 140, 40, ${0.7 * (1 - k)})`);
      glow.addColorStop(1, 'rgba(255, 60, 40, 0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(bx, by, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = `rgba(255, 90, 95, ${1 - k})`;
      g.lineWidth = 3;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        const r0 = r * 0.55;
        const r1 = r * 0.95;
        g.beginPath();
        g.moveTo(bx + Math.cos(a) * r0, by + Math.sin(a) * r0);
        g.lineTo(bx + Math.cos(a) * r1, by + Math.sin(a) * r1);
        g.stroke();
      }
    }
    // the wreck stays as a dull ember
    g.fillStyle = '#ff5a5f';
    g.beginPath();
    g.arc(bx, by, 5, 0, Math.PI * 2);
    g.fill();
  }
}
