// Every picture the boutique and the valet draw (shop/art.ts, cars/art.ts), drawn into a stand-in
// canvas that keeps what it was asked to do: each piece for sale and each car draws something of
// its own, with no NaN in a coordinate or a colour, and without throwing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARS } from '../../shared/src/items.ts';
import { allEntries } from '../src/ui/shop/catalog.ts';
import { drawItem } from '../src/ui/shop/art.ts';
import { carPicture } from '../src/ui/cars/art.ts';

const GRADIENTS = new Set(['createLinearGradient', 'createRadialGradient', 'createConicGradient', 'createPattern']);
const MARKS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText']);

/** A canvas whose 2D context writes down every call and every style it's given. */
function standIn() {
  const log: string[] = [];
  const bad: string[] = [];
  const num = (v: unknown) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  const look = (what: string, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${what} ${v}`);
    if (typeof v === 'string' && /NaN|undefined|Infinity/.test(v)) bad.push(`${what} ${v}`);
  };
  const state: Record<string, unknown> = {
    globalAlpha: 1, lineWidth: 1, fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif',
    textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0, shadowOffsetY: 0, lineDashOffset: 0, filter: 'none', imageSmoothingEnabled: true,
  };
  const g = new Proxy(state, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        for (const a of args) look(k, a);
        log.push(`${k}(${args.map(num).join(',')})`);
        if (GRADIENTS.has(k)) return { addColorStop: (at: number, colour: string) => (look('addColorStop', colour), !(at >= 0 && at <= 1) && bad.push(`addColorStop at ${at}`), log.push(`stop(${num(at)},${colour})`)) };
        if (k === 'measureText') return { width: String(args[0]).length * 6 };
        if (k === 'getLineDash') return [];
        return undefined;
      };
    },
    set(t, k, v) {
      if (typeof k !== 'string') return false;
      look(k, v);
      t[k] = v;
      log.push(`${k}=${typeof v === 'object' ? 'gradient' : num(v)}`);
      return true;
    },
  });
  const canvas = { width: 0, height: 0, className: '', style: {}, setAttribute() {}, getContext: () => g };
  return { canvas, log, bad, marks: () => log.filter((l) => MARKS.has(l.slice(0, l.indexOf('(')))).length };
}

describe('the boutique pictures', () => {
  it('draw every piece for sale, each its own', () => {
    const seen = new Map<string, string>();
    const list = allEntries();
    expect(list.length).toBeGreaterThan(40);
    for (const e of list) {
      if (seen.has(e.id)) continue;
      const s = standIn();
      expect(() => drawItem(s.canvas as unknown as HTMLCanvasElement, e.id, 200, 100), e.id).not.toThrow();
      expect(s.bad, e.id).toEqual([]);
      expect(s.marks(), e.id).toBeGreaterThan(2);
      expect(s.canvas.width).toBe(200);
      const drawing = s.log.join(';');
      const twin = [...seen].find(([, d]) => d === drawing)?.[0];
      expect(twin, `${e.id} draws the same as ${twin}`).toBeUndefined();
      seen.set(e.id, drawing);
    }
  });

  it('fit any box they are given', () => {
    for (const [w, h] of [[84, 42], [260, 130], [168, 84]] as const) {
      const s = standIn();
      drawItem(s.canvas as unknown as HTMLCanvasElement, 'cuban-link', w, h);
      expect(s.canvas.width).toBe(w);
      expect(s.canvas.height).toBe(h);
      expect(s.bad).toEqual([]);
    }
  });
});

describe('the valet pictures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draw every car side on, each its own', () => {
    const seen = new Map<string, string>();
    for (const c of CARS) {
      const s = standIn();
      vi.stubGlobal('document', { createElement: () => s.canvas });
      expect(() => carPicture(c.id, 200, 90), c.id).not.toThrow();
      expect(s.bad, c.id).toEqual([]);
      expect(s.marks(), c.id).toBeGreaterThan(4);
      const drawing = s.log.join(';');
      const twin = [...seen].find(([, d]) => d === drawing)?.[0];
      expect(twin, `${c.id} draws the same as ${twin}`).toBeUndefined();
      seen.set(c.id, drawing);
    }
  });
});
