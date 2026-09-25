// The coin's two faces, as SVG elements (no markup strings): a reeded rim, a raised inner ring
// and an emblem. Heads is struck in gold with a crown; tails in silver with a five-point star.
// Gradient ids are numbered so every face has its own.

import type { Side } from '../../../../shared/src/games/coinflip/rules.ts';

const NS = 'http://www.w3.org/2000/svg';
let next = 0;

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

const METAL: Record<Side, { rim: string; hi: string; mid: string; lo: string; ink: string }> = {
  heads: { rim: '#a86a0c', hi: '#ffe7a3', mid: '#f5b93b', lo: '#b97a14', ink: '#7a4a05' },
  tails: { rim: '#56677a', hi: '#f2f7fc', mid: '#b8c6d4', lo: '#6d7f92', ink: '#3b4a5a' },
};

/** One face of the coin, 100 units across. */
export function coinFace(side: Side, cls = ''): SVGSVGElement {
  const m = METAL[side];
  const svg = node('svg', { viewBox: '0 0 100 100', class: `cf-face-svg ${cls}`.trim(), 'aria-hidden': 'true' });
  const id = `cf-g${next++}`;
  const defs = node('defs', {});
  const grad = node('radialGradient', { id, cx: '0.36', cy: '0.3', r: '0.8' });
  for (const [o, c] of [[0, m.hi], [0.45, m.mid], [1, m.lo]] as const) grad.append(node('stop', { offset: o, 'stop-color': c }));
  defs.append(grad);
  svg.append(defs, node('circle', { cx: 50, cy: 50, r: 49, fill: m.rim }));
  // the reeding round the edge
  for (let i = 0; i < 72; i++) {
    svg.append(node('rect', { x: 49.4, y: 1.5, width: 1.2, height: 4, fill: m.lo, opacity: 0.8, transform: `rotate(${i * 5} 50 50)` }));
  }
  svg.append(
    node('circle', { cx: 50, cy: 50, r: 44, fill: `url(#${id})` }),
    node('circle', { cx: 50, cy: 50, r: 37, fill: 'none', stroke: m.ink, 'stroke-width': 1.4, opacity: 0.45 }),
    node('circle', { cx: 50, cy: 50, r: 35.5, fill: 'none', stroke: m.hi, 'stroke-width': 0.8, opacity: 0.7 }),
  );
  if (side === 'heads') {
    // a crown: band, five points with pearls
    svg.append(
      node('path', { d: 'M29 62 L27 38 L38 49 L44 33 L50 45 L56 33 L62 49 L73 38 L71 62 Z', fill: m.ink, opacity: 0.85 }),
      node('rect', { x: 29, y: 62, width: 42, height: 7, rx: 1.5, fill: m.ink, opacity: 0.85 }),
      node('circle', { cx: 27, cy: 37, r: 2.6, fill: m.ink }),
      node('circle', { cx: 44, cy: 32, r: 2.6, fill: m.ink }),
      node('circle', { cx: 56, cy: 32, r: 2.6, fill: m.ink }),
      node('circle', { cx: 73, cy: 37, r: 2.6, fill: m.ink }),
      node('path', { d: 'M31 60 L30 43 L38 51 L44 37', fill: 'none', stroke: m.hi, 'stroke-width': 1.2, opacity: 0.6 }),
    );
  } else {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 ? 11 : 25;
      pts.push(`${(50 + Math.cos(a) * r).toFixed(2)},${(51 + Math.sin(a) * r).toFixed(2)}`);
    }
    svg.append(
      node('polygon', { points: pts.join(' '), fill: m.ink, opacity: 0.85 }),
      node('polyline', { points: pts.slice(0, 4).join(' '), fill: 'none', stroke: m.hi, 'stroke-width': 1.1, opacity: 0.55 }),
    );
  }
  // a soft sheen across the top left
  svg.append(node('ellipse', { cx: 36, cy: 28, rx: 22, ry: 9, fill: '#ffffff', opacity: 0.18, transform: 'rotate(-32 36 28)' }));
  return svg;
}
