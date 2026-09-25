// The wheel on the page: a ring of coloured segments on a canvas, turned with a CSS rotation so the
// canvas is drawn once per layout, a pointer fixed at the top, and the result in the hub. The wheel
// never decides anything: spin() turns it onto the segment the server drew, a few whole turns
// first, landing somewhere inside the segment rather than dead on its middle.

import { el } from '../../ui/kit.ts';
import { tween } from '../../table/tween.ts';
import { WHEELS, type Risk, type Segments } from '../../../../shared/src/games/wheel/rules.ts';

/** Canvas pixels per design pixel: the page is often drawn larger than 1:1 on a sharp screen. */
const DPR = 2;
export const SIZE = 480;
const R_OUT = 232;
const R_IN = 186;

/** A multiplier's colour, the same on the wheel, the legend and the results strip. */
export function multColor(m: number): { face: string; ink: string } {
  if (m === 0) return { face: '#34505f', ink: '#a7b4c6' };
  if (m <= 120) return { face: '#d5e1ea', ink: '#14212b' };
  if (m <= 150) return { face: '#1fd65f', ink: '#06210f' };
  if (m < 200) return { face: '#5ad0f0', ink: '#062530' };
  if (m < 300) return { face: '#fde047', ink: '#2a2200' };
  if (m < 400) return { face: '#a855f7', ink: '#fff' };
  if (m < 500) return { face: '#fb923c', ink: '#2a1200' };
  if (m < 990) return { face: '#ff3d7f', ink: '#fff' };
  return { face: '#ff4d4f', ink: '#fff' };
}

export class WheelBoard {
  readonly root = el('div', 'wh-wheel');
  private readonly canvas = el('canvas', 'wh-canvas');
  private readonly hub = el('div', 'wh-hub');
  private readonly hubMult = el('div', 'wh-hub-mult', '');
  private readonly hubNote = el('div', 'wh-hub-note', '');
  private readonly pointer = el('div', 'wh-pointer');
  private rot = 0;
  private risk: Risk = 'medium';
  private segs: Segments = 30;
  private lit: number | null = null;
  spinning = false;

  constructor() {
    this.canvas.width = SIZE * DPR;
    this.canvas.height = SIZE * DPR;
    this.hub.append(this.hubMult, this.hubNote);
    this.root.append(this.canvas, this.pointer, this.hub);
  }

  /** Show a wheel (no animation); the rotation carries over, so it doesn't jump. */
  setWheel(risk: Risk, segs: Segments): void {
    this.risk = risk;
    this.segs = segs;
    this.lit = null;
    this.draw();
    this.setHub(null);
  }

  /** The hub: the result's multiplier in its colour, or the wheel's name at rest. */
  setHub(mult: number | null, note = ''): void {
    if (mult === null) {
      this.hubMult.textContent = '';
      this.hubMult.style.color = '';
      this.hub.classList.remove('shown');
    } else {
      this.hubMult.textContent = `${(mult / 100).toFixed(2)}×`;
      this.hubMult.style.color = mult === 0 ? '#a7b4c6' : multColor(mult).face;
      this.hub.classList.remove('shown');
      void this.hub.offsetWidth;
      this.hub.classList.add('shown');
    }
    this.hubNote.textContent = note;
  }

  /** Rest on a segment without animating (a reconnect). */
  restOn(segment: number): void {
    this.rot = this.restAngle(segment, 0.5);
    this.canvas.style.transform = `rotate(${this.rot}deg)`;
    this.lit = segment;
    this.draw();
  }

  /** The rotation (degrees clockwise) that puts `at` (0-1 across the segment) under the pointer. */
  private restAngle(segment: number, at: number): number {
    const step = 360 / this.segs;
    return -((segment + at) * step);
  }

  /** Turn onto `segment` over `ms`, calling `tick` as each segment boundary passes the pointer. */
  async spin(segment: number, ms: number, tick: () => void): Promise<void> {
    this.spinning = true;
    this.lit = null;
    this.draw();
    const step = 360 / this.segs;
    const from = this.rot;
    // clockwise, four to five whole turns, landing somewhere in the middle 70% of the segment
    const at = 0.15 + Math.random() * 0.7;
    let to = this.restAngle(segment, at);
    const turns = 4 + Math.floor(Math.random() * 2);
    while (to < from + turns * 360) to += 360;
    let passed = Math.floor(from / step);
    await tween(
      ms,
      (k) => {
        const a = from + (to - from) * k;
        this.canvas.style.transform = `rotate(${a}deg)`;
        const b = Math.floor(a / step);
        if (b !== passed) {
          passed = b;
          tick();
          this.pointer.classList.remove('flick');
          void this.pointer.offsetWidth;
          this.pointer.classList.add('flick');
        }
      },
      (t) => 1 - (1 - t) ** 4,
    );
    // keep the angle small so it never grows without bound
    this.rot = ((to % 360) + 360) % 360;
    this.canvas.style.transform = `rotate(${this.rot}deg)`;
    this.lit = segment;
    this.draw();
    this.spinning = false;
  }

  private draw(): void {
    const g = this.canvas.getContext('2d')!;
    const mults = WHEELS[this.risk][this.segs];
    const n = mults.length;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    const cx = SIZE / 2;
    // the rim
    g.fillStyle = '#0b1720';
    g.beginPath();
    g.arc(cx, cx, R_OUT + 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#132632';
    g.beginPath();
    g.arc(cx, cx, R_OUT + 6, 0, Math.PI * 2);
    g.fill();
    const step = (Math.PI * 2) / n;
    const gap = n >= 40 ? 0.004 : 0.006;
    for (let i = 0; i < n; i++) {
      // segment i runs clockwise from the top: canvas angles start at 3 o'clock
      const a0 = -Math.PI / 2 + i * step + gap;
      const a1 = -Math.PI / 2 + (i + 1) * step - gap;
      const { face } = multColor(mults[i]!);
      g.fillStyle = face;
      g.globalAlpha = this.lit === null || this.lit === i ? 1 : 0.62;
      g.beginPath();
      g.arc(cx, cx, R_OUT, a0, a1);
      g.arc(cx, cx, R_IN, a1, a0, true);
      g.closePath();
      g.fill();
      // a darker inner lip gives each segment some depth
      g.fillStyle = 'rgba(0, 0, 0, 0.22)';
      g.beginPath();
      g.arc(cx, cx, R_IN + 9, a0, a1);
      g.arc(cx, cx, R_IN, a1, a0, true);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
    if (this.lit !== null) {
      const a0 = -Math.PI / 2 + this.lit * step;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cx, R_OUT + 1, a0, a0 + step);
      g.arc(cx, cx, R_IN - 1, a0 + step, a0, true);
      g.closePath();
      g.stroke();
    }
    // the hub's dark face and ring
    g.fillStyle = '#0f1e29';
    g.beginPath();
    g.arc(cx, cx, R_IN - 8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2f4553';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cx, R_IN - 8, 0, Math.PI * 2);
    g.stroke();
  }
}
