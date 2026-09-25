// The items' pictures, as SVG elements (no markup strings), one per kind of item in the cases:
// a clay chip, a pair of dice, the ace of spades, a horseshoe, cherries, a silver dollar, a pocket
// watch, a gold ring, a gold bar, a lucky seven, a blue diamond, a crown, a trophy and a briefcase
// of cash. Each is drawn on a 64 x 64 grid; gradient ids are numbered so every icon has its own.

import type { ItemKind } from '../../../../shared/src/games/cases/rules.ts';

const NS = 'http://www.w3.org/2000/svg';
let next = 0;

type Attrs = Record<string, string | number>;

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** A linear gradient top to bottom (or along `dir`), added to `defs`; returns its url(). */
function grad(defs: SVGDefsElement, stops: string[], dir: [number, number, number, number] = [0, 0, 0, 1]): string {
  const id = `ca-g${next++}`;
  const g = node('linearGradient', { id, x1: dir[0], y1: dir[1], x2: dir[2], y2: dir[3] });
  stops.forEach((c, i) => g.append(node('stop', { offset: i / (stops.length - 1), 'stop-color': c })));
  defs.append(g);
  return `url(#${id})`;
}

const GOLD = ['#fff0b3', '#f5c542', '#b8860b'];
const SILVER = ['#ffffff', '#c9d3dc', '#7c8a98'];

const DRAW: Record<ItemKind, (d: SVGDefsElement) => SVGElement[]> = {
  chip: () => {
    const out: SVGElement[] = [node('circle', { cx: 32, cy: 32, r: 25, fill: '#c62b36' })];
    for (let i = 0; i < 8; i++) {
      out.push(node('rect', { x: 29, y: 7, width: 6, height: 9, rx: 1, fill: '#f4efe6', transform: `rotate(${i * 45} 32 32)` }));
    }
    out.push(
      node('circle', { cx: 32, cy: 32, r: 16, fill: '#a3202b' }),
      node('circle', { cx: 32, cy: 32, r: 16, fill: 'none', stroke: '#f4efe6', 'stroke-width': 1.5, 'stroke-dasharray': '3 3' }),
      node('circle', { cx: 32, cy: 32, r: 11, fill: '#c62b36' }),
      node('ellipse', { cx: 25, cy: 20, rx: 9, ry: 4, fill: '#fff', opacity: 0.18, transform: 'rotate(-30 25 20)' }),
    );
    return out;
  },
  dice: () => {
    const die = (x: number, y: number, r: number, pips: [number, number][]) => {
      const g = node('g', { transform: `rotate(${r} ${x + 11} ${y + 11})` });
      g.append(node('rect', { x, y, width: 22, height: 22, rx: 4.5, fill: '#f7f4ee', stroke: '#c9c2b4', 'stroke-width': 1 }));
      for (const [px, py] of pips) g.append(node('circle', { cx: x + px, cy: y + py, r: 2.3, fill: px === 11 && py === 11 && pips.length === 1 ? '#d02b35' : '#1b1b1f' }));
      return g;
    };
    return [
      die(9, 22, -14, [[5.5, 5.5], [11, 11], [16.5, 16.5]]),
      die(32, 14, 12, [[5.5, 5.5], [16.5, 5.5], [11, 11], [5.5, 16.5], [16.5, 16.5]]),
    ];
  },
  card: () => [
    node('rect', { x: 15, y: 7, width: 34, height: 50, rx: 4, fill: '#fbfaf7', stroke: '#c9c2b4', 'stroke-width': 1, transform: 'rotate(8 32 32)' }),
    node('path', { d: 'M32 20 C38 27 44 30 44 36 C44 41 38 43 34 39 L36 46 L28 46 L30 39 C26 43 20 41 20 36 C20 30 26 27 32 20 Z', fill: '#1b1b1f', transform: 'rotate(8 32 32)' }),
    node('text', { x: 21, y: 19, 'font-size': 9, 'font-weight': 800, 'font-family': 'system-ui, sans-serif', fill: '#1b1b1f', transform: 'rotate(8 32 32)' }),
  ].map((n) => {
    if (n.tagName === 'text') n.textContent = 'A';
    return n;
  }),
  horseshoe: (d) => {
    const fill = grad(d, SILVER, [0, 0, 1, 1]);
    const out: SVGElement[] = [node('path', { d: 'M14 54 L12 30 C12 16 21 8 32 8 C43 8 52 16 52 30 L50 54 L40 54 L41 30 C41 23 37 18 32 18 C27 18 23 23 23 30 L24 54 Z', fill, stroke: '#5e6a76', 'stroke-width': 1.2 })];
    for (const [x, y] of [[17, 47], [16, 37], [18, 25], [47, 47], [48, 37], [46, 25]] as const) out.push(node('circle', { cx: x, cy: y, r: 1.6, fill: '#3d4852' }));
    return out;
  },
  cherry: () => [
    node('path', { d: 'M22 40 C24 28 30 18 42 10 M42 40 C40 28 40 18 42 10', fill: 'none', stroke: '#3c7a2a', 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
    node('path', { d: 'M42 10 C48 8 54 10 56 16 C50 18 45 16 42 10 Z', fill: '#4fae3a' }),
    node('circle', { cx: 21, cy: 44, r: 11, fill: '#d0142c' }),
    node('circle', { cx: 43, cy: 45, r: 11, fill: '#e3263d' }),
    node('ellipse', { cx: 17, cy: 40, rx: 3.5, ry: 2.2, fill: '#fff', opacity: 0.55, transform: 'rotate(-35 17 40)' }),
    node('ellipse', { cx: 39, cy: 41, rx: 3.5, ry: 2.2, fill: '#fff', opacity: 0.55, transform: 'rotate(-35 39 41)' }),
  ],
  coin: (d) => {
    const fill = grad(d, SILVER, [0, 0, 1, 1]);
    const t = node('text', { x: 32, y: 42, 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 800, 'font-family': 'Georgia, serif', fill: '#6b7885' });
    t.textContent = '$';
    return [
      node('circle', { cx: 32, cy: 32, r: 25, fill: '#7c8a98' }),
      node('circle', { cx: 32, cy: 32, r: 22.5, fill }),
      node('circle', { cx: 32, cy: 32, r: 18.5, fill: 'none', stroke: '#8a97a4', 'stroke-width': 1.2 }),
      t,
    ];
  },
  watch: (d) => {
    const fill = grad(d, GOLD, [0, 0, 1, 1]);
    return [
      node('path', { d: 'M32 12 C22 4 12 6 8 14', fill: 'none', stroke: '#c9a227', 'stroke-width': 2, 'stroke-dasharray': '3 2' }),
      node('rect', { x: 28.5, y: 9, width: 7, height: 6, rx: 1.5, fill }),
      node('circle', { cx: 32, cy: 37, r: 22, fill }),
      node('circle', { cx: 32, cy: 37, r: 17, fill: '#fbf7ec', stroke: '#9a7512', 'stroke-width': 1 }),
      ...Array.from({ length: 12 }, (_, i) => node('rect', { x: 31.4, y: 21.5, width: 1.2, height: i % 3 ? 2 : 3.5, fill: '#3a3122', transform: `rotate(${i * 30} 32 37)` })),
      node('path', { d: 'M32 37 L32 26 M32 37 L40 41', stroke: '#1d1a14', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
      node('circle', { cx: 32, cy: 37, r: 1.6, fill: '#1d1a14' }),
    ];
  },
  ring: (d) => {
    const band = grad(d, GOLD, [0, 0, 1, 1]);
    const gem = grad(d, ['#d6f3ff', '#39a0ff', '#123f9a']);
    return [
      node('ellipse', { cx: 32, cy: 40, rx: 19, ry: 16, fill: 'none', stroke: band, 'stroke-width': 6 }),
      node('path', { d: 'M24 22 L28 16 L36 16 L40 22 L32 30 Z', fill: gem, stroke: '#0e2f73', 'stroke-width': 0.8 }),
      node('path', { d: 'M24 22 L40 22', stroke: '#e8f8ff', 'stroke-width': 0.8, opacity: 0.8 }),
      node('rect', { x: 26, y: 23, width: 12, height: 4, rx: 1, fill: '#b8860b' }),
    ];
  },
  bar: (d) => {
    const top = grad(d, ['#fff4c2', '#f5c542']);
    const side = grad(d, ['#e0a92a', '#9c6f08']);
    const ingot = (y: number) => [
      node('path', { d: `M14 ${y} L50 ${y} L56 ${y + 12} L8 ${y + 12} Z`, fill: side }),
      node('path', { d: `M18 ${y - 6} L46 ${y - 6} L50 ${y} L14 ${y} Z`, fill: top }),
    ];
    const t = node('text', { x: 32, y: 50.5, 'text-anchor': 'middle', 'font-size': 6, 'font-weight': 800, 'font-family': 'system-ui, sans-serif', fill: '#7a5405', 'letter-spacing': 1 });
    t.textContent = '999.9';
    return [...ingot(26), ...ingot(42), t, node('path', { d: 'M20 21 L30 21', stroke: '#fff', 'stroke-width': 1.5, opacity: 0.7 })];
  },
  seven: (d) => {
    const fill = grad(d, ['#ff6b6b', '#d0142c', '#8c0b1c']);
    return [
      node('path', { d: 'M14 10 L52 10 L52 19 C42 28 36 40 34 56 L21 56 C23 41 30 29 38 21 L14 21 Z', fill: '#f5c542', transform: 'translate(0 -1)' }),
      node('path', { d: 'M17 13 L49 13 L49 18.5 C39 27 33 39 31 53 L24 53 C26 39 32 28 41 18 L17 18 Z', fill }),
    ];
  },
  gem: (d) => {
    const a = grad(d, ['#e6f7ff', '#5ab8ff']);
    return [
      node('path', { d: 'M18 14 H46 L58 28 H6 Z', fill: a }),
      node('path', { d: 'M25 14 H39 L43 28 H21 Z', fill: '#f4fbff' }),
      node('path', { d: 'M6 28 H58 L32 58 Z', fill: '#2b86e8' }),
      node('path', { d: 'M21 28 H43 L32 58 Z', fill: '#4aa3ff' }),
      node('path', { d: 'M6 28 H21 L32 58 Z', fill: '#1a63c4' }),
      node('path', { d: 'M27 17 H34 L32.5 21 H26 Z', fill: '#fff', opacity: 0.8 }),
    ];
  },
  crown: (d) => {
    const fill = grad(d, GOLD);
    return [
      node('path', { d: 'M10 46 L7 18 L21 31 L32 12 L43 31 L57 18 L54 46 Z', fill, stroke: '#9a7512', 'stroke-width': 1 }),
      node('rect', { x: 10, y: 46, width: 44, height: 8, rx: 2, fill: '#c9a227', stroke: '#9a7512', 'stroke-width': 1 }),
      node('circle', { cx: 32, cy: 50, r: 3, fill: '#e3263d' }),
      node('circle', { cx: 20, cy: 50, r: 2.4, fill: '#39a0ff' }),
      node('circle', { cx: 44, cy: 50, r: 2.4, fill: '#39a0ff' }),
      node('circle', { cx: 7, cy: 17, r: 3, fill: '#fff0b3' }),
      node('circle', { cx: 32, cy: 11, r: 3, fill: '#fff0b3' }),
      node('circle', { cx: 57, cy: 17, r: 3, fill: '#fff0b3' }),
      node('circle', { cx: 32, cy: 34, r: 4, fill: '#1fd65f' }),
    ];
  },
  trophy: (d) => {
    const fill = grad(d, GOLD, [0, 0, 1, 1]);
    return [
      node('path', { d: 'M18 14 C8 14 8 30 20 32 M46 14 C56 14 56 30 44 32', fill: 'none', stroke: '#c9a227', 'stroke-width': 3.5 }),
      node('path', { d: 'M17 9 H47 V20 C47 31 40 37 32 37 C24 37 17 31 17 20 Z', fill }),
      node('rect', { x: 29, y: 37, width: 6, height: 8, fill: '#b8860b' }),
      node('rect', { x: 21, y: 45, width: 22, height: 6, rx: 1.5, fill }),
      node('rect', { x: 17, y: 51, width: 30, height: 6, rx: 1.5, fill: '#3a2a12' }),
      node('path', { d: 'M22 13 V21 C22 26 25 30 28 32', fill: 'none', stroke: '#fff', 'stroke-width': 1.6, opacity: 0.5 }),
    ];
  },
  briefcase: (d) => {
    const bill = grad(d, ['#b9f5c8', '#3fae62']);
    return [
      node('path', { d: 'M24 16 V11 C24 9 25 8 27 8 H37 C39 8 40 9 40 11 V16', fill: 'none', stroke: '#c9a227', 'stroke-width': 3 }),
      node('rect', { x: 12, y: 13, width: 40, height: 9, rx: 1.5, fill: bill, transform: 'rotate(-6 32 17)' }),
      node('rect', { x: 14, y: 15, width: 38, height: 9, rx: 1.5, fill: bill, transform: 'rotate(4 32 19)' }),
      node('rect', { x: 6, y: 20, width: 52, height: 34, rx: 4, fill: '#1c1f24', stroke: '#c9a227', 'stroke-width': 1.5 }),
      node('rect', { x: 6, y: 32, width: 52, height: 3, fill: '#c9a227' }),
      node('rect', { x: 27, y: 29, width: 10, height: 9, rx: 1.5, fill: '#f5c542' }),
      node('circle', { cx: 32, cy: 33.5, r: 1.5, fill: '#5a4208' }),
    ];
  },
};

export function itemIcon(kind: ItemKind, cls = 'ca-icon'): SVGSVGElement {
  const svg = node('svg', { viewBox: '0 0 64 64', class: cls, 'aria-hidden': 'true' });
  const defs = node('defs', {});
  svg.append(defs, ...DRAW[kind](defs));
  return svg;
}
