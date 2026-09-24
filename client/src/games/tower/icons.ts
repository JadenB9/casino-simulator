// The tower's two pictures, drawn as SVG elements (no markup strings): a golden egg for a safe
// tile and the dragon's slit eye for the one that ends the climb. Gradient ids are numbered so
// every icon on the page has its own.

const NS = 'http://www.w3.org/2000/svg';
let next = 0;

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function gradient(kind: 'linearGradient' | 'radialGradient', attrs: Record<string, string | number>, stops: [number, string][]): { el: SVGElement; ref: string } {
  const id = `tw-g${next++}`;
  const g = node(kind, { id, ...attrs });
  for (const [offset, color] of stops) g.append(node('stop', { offset, 'stop-color': color }));
  return { el: g, ref: `url(#${id})` };
}

/** A golden egg with a speckle or two and a glint. */
export function eggIcon(): SVGSVGElement {
  const svg = node('svg', { viewBox: '0 0 40 48', class: 'tw-icon tw-egg', 'aria-hidden': 'true' });
  const shell = gradient('radialGradient', { cx: '0.36', cy: '0.3', r: '0.8' }, [
    [0, '#fff5cf'],
    [0.35, '#ffd766'],
    [0.75, '#e9a322'],
    [1, '#a8640c'],
  ]);
  const defs = node('defs', {});
  defs.append(shell.el);
  svg.append(
    defs,
    node('ellipse', { cx: 20, cy: 44.5, rx: 12, ry: 2.4, fill: 'rgba(0,0,0,0.35)' }),
    node('path', { d: 'M20 2.5C29.5 2.5 36 17.5 36 28.5 36 38.5 29 45 20 45S4 38.5 4 28.5C4 17.5 10.5 2.5 20 2.5Z', fill: shell.ref }),
    node('ellipse', { cx: 24.5, cy: 30, rx: 2.2, ry: 1.6, fill: '#c98416', opacity: 0.55 }),
    node('ellipse', { cx: 15, cy: 36, rx: 1.6, ry: 1.2, fill: '#c98416', opacity: 0.45 }),
    node('ellipse', { cx: 14, cy: 15.5, rx: 3.2, ry: 5.5, fill: '#fffbe8', opacity: 0.8, transform: 'rotate(22 14 15.5)' }),
  );
  return svg;
}

/** The dragon's eye: an ember iris with a black slit, under a heavy brow. */
export function dragonIcon(): SVGSVGElement {
  const svg = node('svg', { viewBox: '0 0 48 32', class: 'tw-icon tw-dragon', 'aria-hidden': 'true' });
  const iris = gradient('radialGradient', { cx: '0.5', cy: '0.5', r: '0.55' }, [
    [0, '#fff1a8'],
    [0.35, '#ffb52e'],
    [0.75, '#e2471b'],
    [1, '#7a1208'],
  ]);
  const defs = node('defs', {});
  defs.append(iris.el);
  svg.append(
    defs,
    // scales round the eye
    node('path', { d: 'M1 17C9 3 39 3 47 17 39 29 9 29 1 17Z', fill: '#4a0d10' }),
    node('path', { d: 'M5 17C12 7 36 7 43 17 36 26 12 26 5 17Z', fill: iris.ref }),
    node('path', { d: 'M24 7.5C27.2 12 27.2 22 24 26.5 20.8 22 20.8 12 24 7.5Z', fill: '#140405' }),
    node('ellipse', { cx: 30, cy: 12.5, rx: 2.4, ry: 1.5, fill: '#fff8d8', opacity: 0.85 }),
    // the brow
    node('path', { d: 'M2 12C10 1 36 -1 46 9 37 5 13 5 2 12Z', fill: '#2a0608' }),
  );
  return svg;
}
