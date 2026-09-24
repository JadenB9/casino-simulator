// The board's two pictures, as SVG elements (no markup strings): a cut emerald for a gem and a
// spiked sea mine with its red lamp. Gradient ids are numbered so every icon has its own.

const NS = 'http://www.w3.org/2000/svg';
let next = 0;

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function gradient(kind: 'linearGradient' | 'radialGradient', attrs: Record<string, string | number>, stops: [number, string][]): { el: SVGElement; ref: string } {
  const id = `mn-g${next++}`;
  const g = node(kind, { id, ...attrs });
  for (const [offset, color] of stops) g.append(node('stop', { offset, 'stop-color': color }));
  return { el: g, ref: `url(#${id})` };
}

/** A step-cut emerald: table, crown and pavilion facets in four greens. */
export function gemIcon(): SVGSVGElement {
  const svg = node('svg', { viewBox: '0 0 48 44', class: 'mn-icon mn-gem', 'aria-hidden': 'true' });
  svg.append(
    // crown
    node('path', { d: 'M12 4H36L46 15H2Z', fill: '#34f58f' }),
    node('path', { d: 'M17 4H31L34 15H14Z', fill: '#9dffc9' }),
    node('path', { d: 'M12 4 17 4 14 15 2 15Z', fill: '#1fd67a' }),
    node('path', { d: 'M36 4 31 4 34 15 46 15Z', fill: '#15b865' }),
    // pavilion
    node('path', { d: 'M2 15H46L24 42Z', fill: '#0ea85a' }),
    node('path', { d: 'M14 15H34L24 42Z', fill: '#16c96d' }),
    node('path', { d: 'M2 15H14L24 42Z', fill: '#0b8f4c' }),
    // a glint on the table
    node('path', { d: 'M19 6.5H25L23.5 9.5H18Z', fill: '#ffffff', opacity: 0.75 }),
  );
  return svg;
}

/** A sea mine: a dark sphere with eight horns and a red lamp. */
export function mineIcon(): SVGSVGElement {
  const svg = node('svg', { viewBox: '0 0 48 48', class: 'mn-icon mn-mine', 'aria-hidden': 'true' });
  const body = gradient('radialGradient', { cx: '0.38', cy: '0.34', r: '0.7' }, [
    [0, '#6a7280'],
    [0.45, '#2a2f38'],
    [1, '#0b0d11'],
  ]);
  const defs = node('defs', {});
  defs.append(body.el);
  svg.append(defs);
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180;
    const x = 24 + Math.sin(a) * 18.5;
    const y = 24 - Math.cos(a) * 18.5;
    svg.append(node('rect', { x: -2.6, y: -4.5, width: 5.2, height: 9, rx: 1.6, fill: '#242830', transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${i * 45})` }));
  }
  svg.append(
    node('circle', { cx: 24, cy: 24, r: 15, fill: body.ref }),
    node('circle', { cx: 24, cy: 24, r: 5, fill: '#ff3b3f' }),
    node('circle', { cx: 24, cy: 24, r: 2.2, fill: '#ffd0d0' }),
    node('ellipse', { cx: 18.5, cy: 17, rx: 4, ry: 2.4, fill: '#ffffff', opacity: 0.22, transform: 'rotate(-35 18.5 17)' }),
  );
  return svg;
}
