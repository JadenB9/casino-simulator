// The seven gems, as SVG elements (no markup strings): each colour has its own cut, so a match
// reads by shape as well as colour. Emerald step cut, sapphire round brilliant, ruby trillion,
// amethyst shield, topaz cushion, aquamarine pear and a rose heart, on a 64 x 64 grid.

const NS = 'http://www.w3.org/2000/svg';

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** Each gem's tones, darkest to lightest, and its glow. */
export const GEM_TONES: readonly { dark: string; mid: string; light: string; glint: string; glow: string }[] = [
  { dark: '#0b7d42', mid: '#16c96d', light: '#6ff2a8', glint: '#d9ffe9', glow: '#1fd65f' },
  { dark: '#123f9a', mid: '#2b6fe0', light: '#77b0ff', glint: '#e3efff', glow: '#3b82ff' },
  { dark: '#8c0b1c', mid: '#e3263d', light: '#ff7a86', glint: '#ffe0e4', glow: '#ff3b52' },
  { dark: '#4a1d8f', mid: '#8b4bef', light: '#c09bff', glint: '#f0e6ff', glow: '#a066ff' },
  { dark: '#a55a00', mid: '#f59e0b', light: '#ffd06b', glint: '#fff3d1', glow: '#ffb020' },
  { dark: '#0a6b7d', mid: '#1ec4dc', light: '#86ecf7', glint: '#e3fbff', glow: '#2fd8f0' },
  { dark: '#9c1a5c', mid: '#ec4899', light: '#ff9ccb', glint: '#ffe3f1', glow: '#ff5caf' },
];

type Cut = (t: (typeof GEM_TONES)[number]) => SVGElement[];

const CUTS: Cut[] = [
  // emerald: an octagonal step cut
  (t) => [
    node('path', { d: 'M20 6 H44 L58 20 V44 L44 58 H20 L6 44 V20 Z', fill: t.dark }),
    node('path', { d: 'M22 11 H42 L53 22 V42 L42 53 H22 L11 42 V22 Z', fill: t.mid }),
    node('path', { d: 'M25 17 H39 L47 25 V39 L39 47 H25 L17 39 V25 Z', fill: t.light }),
    node('path', { d: 'M22 11 H42 L39 17 H25 Z', fill: t.glint, opacity: 0.7 }),
  ],
  // sapphire: a round brilliant
  (t) => {
    const out: SVGElement[] = [node('circle', { cx: 32, cy: 32, r: 27, fill: t.dark }), node('circle', { cx: 32, cy: 32, r: 23, fill: t.mid })];
    const star: string[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      const r = i % 2 ? 11 : 20;
      star.push(`${(32 + Math.cos(a) * r).toFixed(1)},${(32 + Math.sin(a) * r).toFixed(1)}`);
    }
    out.push(node('polygon', { points: star.join(' '), fill: t.light }), node('circle', { cx: 32, cy: 32, r: 8, fill: t.mid }), node('path', { d: 'M18 20 A20 20 0 0 1 32 12 L32 20 A12 12 0 0 0 24 24 Z', fill: t.glint, opacity: 0.6 }));
    return out;
  },
  // ruby: a trillion
  (t) => [
    node('path', { d: 'M32 5 C35 5 58 46 58 50 C58 55 55 57 50 57 H14 C9 57 6 55 6 50 C6 46 29 5 32 5 Z', fill: t.dark }),
    node('path', { d: 'M32 13 L52 51 H12 Z', fill: t.mid }),
    node('path', { d: 'M32 24 L43 45 H21 Z', fill: t.light }),
    node('path', { d: 'M32 13 L21 45 L12 51 Z', fill: t.glint, opacity: 0.35 }),
  ],
  // amethyst: a shield
  (t) => [
    node('path', { d: 'M10 8 H54 L56 30 C54 44 44 53 32 59 C20 53 10 44 8 30 Z', fill: t.dark }),
    node('path', { d: 'M15 13 H49 L50 30 C48 41 41 48 32 53 C23 48 16 41 14 30 Z', fill: t.mid }),
    node('path', { d: 'M22 19 H42 L42 31 C40 38 36 42 32 45 C28 42 24 38 22 31 Z', fill: t.light }),
    node('path', { d: 'M15 13 H49 L42 19 H22 Z', fill: t.glint, opacity: 0.6 }),
  ],
  // topaz: a cushion
  (t) => [
    node('rect', { x: 6, y: 6, width: 52, height: 52, rx: 16, fill: t.dark }),
    node('rect', { x: 11, y: 11, width: 42, height: 42, rx: 12, fill: t.mid }),
    node('path', { d: 'M32 15 L49 32 L32 49 L15 32 Z', fill: t.light }),
    node('path', { d: 'M20 13 H44 L32 22 Z', fill: t.glint, opacity: 0.6 }),
  ],
  // aquamarine: a pear
  (t) => [
    node('path', { d: 'M32 4 C40 16 54 28 54 40 C54 52 44 60 32 60 C20 60 10 52 10 40 C10 28 24 16 32 4 Z', fill: t.dark }),
    node('path', { d: 'M32 12 C38 21 49 31 49 41 C49 50 41 55 32 55 C23 55 15 50 15 41 C15 31 26 21 32 12 Z', fill: t.mid }),
    node('path', { d: 'M32 24 L42 41 L32 50 L22 41 Z', fill: t.light }),
    node('path', { d: 'M32 12 C29 19 22 26 19 33 L25 35 Z', fill: t.glint, opacity: 0.55 }),
  ],
  // rose: a heart
  (t) => [
    node('path', { d: 'M32 58 C20 48 5 38 5 22 C5 12 12 6 20 6 C26 6 30 9 32 13 C34 9 38 6 44 6 C52 6 59 12 59 22 C59 38 44 48 32 58 Z', fill: t.dark }),
    node('path', { d: 'M32 51 C22 43 11 35 11 23 C11 16 16 12 21 12 C26 12 29 15 32 20 C35 15 38 12 43 12 C48 12 53 16 53 23 C53 35 42 43 32 51 Z', fill: t.mid }),
    node('path', { d: 'M32 26 L42 32 L32 44 L22 32 Z', fill: t.light }),
    node('ellipse', { cx: 21, cy: 20, rx: 6, ry: 3.5, fill: t.glint, opacity: 0.6, transform: 'rotate(-30 21 20)' }),
  ],
];

/** Gem `color` (0-6). */
export function gemIcon(color: number, cls = 'dm-gem-svg'): SVGSVGElement {
  const svg = node('svg', { viewBox: '0 0 64 64', class: cls, 'aria-hidden': 'true' });
  svg.append(...CUTS[color]!(GEM_TONES[color]!));
  return svg;
}
