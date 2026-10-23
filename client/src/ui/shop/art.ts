// The boutique's pictures, drawn in code: every piece on its card the way a jeweller's catalogue
// shows it. Chains hang in a U with their own links (rope, figaro, Cuban, a row of brilliants) and
// their pendant; grills are a smile of caps; clothes hang on a hanger in their cloth; watches,
// shades and hats face you; rides stand side on; emotes are a pictogram caught in the move;
// effects are a little night scene of what goes off; the statue is you in gold on a plinth.
//
// Each picture is drawn once into a canvas at the device's pixel ratio, on a 200 x 100 design box
// scaled to fit. Metal, cloth and light keep their own colours in both themes (gold is gold); the
// card behind it is the sheet's. The effects' scenes carry their own dark stage, since what they
// show is light.

const TAU = Math.PI * 2;
type G = CanvasRenderingContext2D;
type P = [number, number];

/** Metal finishes, light to dark: the highlight, the body, the shade, the edge. */
const METALS = {
  gold: ['#fff5d2', '#f3c965', '#c98f2e', '#7d4f12'],
  rose: ['#ffe6da', '#efac90', '#c4765a', '#7f402c'],
  white: ['#ffffff', '#e4e8ed', '#adb4bd', '#646b74'],
  steel: ['#f4f6f8', '#c3c8ce', '#8a9199', '#4b5158'],
  black: ['#6a6a70', '#2c2c31', '#151518', '#040405'],
} as const;
type Metal = keyof typeof METALS;

function sheen(g: G, kind: Metal, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const c = METALS[kind];
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, c[1]);
  gr.addColorStop(0.3, c[0]);
  gr.addColorStop(0.5, c[1]);
  gr.addColorStop(0.78, c[2]);
  gr.addColorStop(1, c[3]);
  return gr;
}

/** A four-point glint, the way a stone catches a light. */
function glint(g: G, x: number, y: number, r: number, a = 1): void {
  g.save();
  g.globalAlpha = a;
  const halo = g.createRadialGradient(x, y, 0, x, y, r);
  halo.addColorStop(0, 'rgba(255,255,255,0.85)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
  g.restore();
}

/** A round stone: a bright table, the colour round its edge, a white catch-light. */
function stone(g: G, x: number, y: number, r: number, color = '#dfe9f2'): void {
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.45, color);
  gr.addColorStop(1, shade(color, -0.45));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, TAU);
  g.fill();
}

/** A colour lightened (k > 0) or darkened (k < 0), for shading cloth and paint. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

/** A rounded rectangle's path (by hand: older Safari and Firefox have no roundRect). */
export function rrect(g: G, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

function poly(g: G, pts: readonly P[], close = true): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (close) g.closePath();
}

/** The soft shadow a thing casts on the counter. */
function floorShadow(g: G, x: number, y: number, rx: number, ry: number, a = 0.3): void {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(0,0,0,${a})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, rx, 0, TAU);
  g.fill();
  g.restore();
}

/** A spade, centred at (x, y), `s` tall. */
function spade(g: G, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x, y - s * 0.5);
  g.bezierCurveTo(x + s * 0.12, y - s * 0.28, x + s * 0.5, y - s * 0.12, x + s * 0.44, y + s * 0.12);
  g.bezierCurveTo(x + s * 0.38, y + s * 0.32, x + s * 0.12, y + s * 0.3, x + s * 0.04, y + s * 0.16);
  g.lineTo(x + s * 0.16, y + s * 0.5);
  g.lineTo(x - s * 0.16, y + s * 0.5);
  g.lineTo(x - s * 0.04, y + s * 0.16);
  g.bezierCurveTo(x - s * 0.12, y + s * 0.3, x - s * 0.38, y + s * 0.32, x - s * 0.44, y + s * 0.12);
  g.bezierCurveTo(x - s * 0.5, y - s * 0.12, x - s * 0.12, y - s * 0.28, x, y - s * 0.5);
  g.fill();
}

// ---------------------------------------------------------------------------------------------
// Chains: a U of links, sampled along a curve so every style keeps its spacing

interface Path {
  at(d: number): { p: P; a: number };
  len: number;
}

/** The chain's curve: from behind the neck at the top corners, down to `dip` at the front. */
function necklace(dip = 74): Path {
  const P0: P = [58, 2];
  const P1: P = [50, dip * 1.3];
  const P2: P = [150, dip * 1.3];
  const P3: P = [142, 2];
  const pts: P[] = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240;
    const u = 1 - t;
    pts.push([
      u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
      u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1],
    ]);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const len = cum.at(-1)!;
  return {
    len,
    at(d) {
      const x = Math.max(0, Math.min(len, d));
      let i = cum.findIndex((c) => c >= x);
      if (i <= 0) i = 1;
      const k = (x - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
      const a = pts[i - 1]!;
      const b = pts[i]!;
      return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    },
  };
}

type ChainStyle = 'rope' | 'figaro' | 'cuban' | 'tennis';

function links(g: G, path: Path, style: ChainStyle, opts: { metal?: Metal; iced?: boolean; heavy?: boolean } = {}): void {
  const metal = opts.metal ?? 'gold';
  const c = METALS[metal];
  const each = (step: number, fn: (p: P, a: number, i: number) => void) => {
    let i = 0;
    for (let d = step / 2; d < path.len; d += step, i++) {
      const { p, a } = path.at(d);
      fn(p, a, i);
    }
  };
  if (style === 'rope') {
    const w = opts.heavy ? 6 : 3.6;
    // the cord, then its twist: short strokes across it, light and dark in turn
    g.lineCap = 'round';
    g.strokeStyle = c[2];
    g.lineWidth = w;
    g.beginPath();
    for (let d = 0; d <= path.len; d += 2) {
      const { p } = path.at(d);
      g.lineTo(p[0], p[1]);
    }
    g.stroke();
    each(w * 0.62, (p, a, i) => {
      const n = a + Math.PI * 0.32;
      g.strokeStyle = i % 2 ? c[0] : c[1];
      g.lineWidth = w * 0.32;
      g.beginPath();
      g.moveTo(p[0] - Math.cos(n) * w * 0.45, p[1] - Math.sin(n) * w * 0.45);
      g.lineTo(p[0] + Math.cos(n) * w * 0.45, p[1] + Math.sin(n) * w * 0.45);
      g.stroke();
    });
  } else if (style === 'figaro') {
    // three short links, then one long
    let d = 2;
    let i = 0;
    g.lineWidth = 1.5;
    while (d < path.len) {
      const len = i % 4 === 3 ? 10 : 4.6;
      const { p, a } = path.at(d + len / 2);
      g.save();
      g.translate(p[0], p[1]);
      g.rotate(a);
      g.strokeStyle = sheen(g, metal, -len / 2, -3, len / 2, 3);
      g.beginPath();
      g.ellipse(0, 0, len / 2, 2.1, 0, 0, TAU);
      g.stroke();
      g.restore();
      d += len + 0.4;
      i++;
    }
  } else if (style === 'cuban') {
    const wide = opts.heavy ? 8.5 : 6.4;
    each(wide * 0.7, (p, a, i) => {
      g.save();
      g.translate(p[0], p[1]);
      g.rotate(a + (i % 2 ? 0.28 : -0.28));
      g.fillStyle = sheen(g, metal, 0, -wide / 2, 0, wide / 2);
      rrect(g, -wide * 0.48, -wide * 0.5, wide * 0.96, wide, wide * 0.3);
      g.fill();
      g.strokeStyle = c[3];
      g.lineWidth = 0.6;
      g.stroke();
      if (opts.iced) {
        g.fillStyle = 'rgba(255,255,255,0.92)';
        for (const [dx, dy] of [[-1.8, -1.6], [1.8, -1.6], [0, 0], [-1.8, 1.6], [1.8, 1.6]] as const) {
          g.beginPath();
          g.arc(dx * (wide / 6.4), dy * (wide / 6.4), 0.75, 0, TAU);
          g.fill();
        }
      }
      g.restore();
    });
    if (opts.iced) for (const d of [0.22, 0.4, 0.63, 0.81]) glint(g, path.at(path.len * d).p[0], path.at(path.len * d).p[1], 4.5);
  } else {
    // a row of round brilliants, each in its claw setting
    each(4.8, (p, _a, i) => {
      g.fillStyle = METALS.white[2];
      g.beginPath();
      g.arc(p[0], p[1], 2.5, 0, TAU);
      g.fill();
      stone(g, p[0], p[1], 2.05);
      if (i % 7 === 3) glint(g, p[0], p[1], 4.2, 0.9);
    });
  }
}

/** Two pavé dice with black pips, one tumbled against the other. */
function dice(g: G, x: number, y: number): void {
  const die = (cx: number, cy: number, s: number, rot: number, pips: number[][]) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    g.fillStyle = sheen(g, 'white', -s, -s, s, s);
    rrect(g, -s / 2, -s / 2, s, s, s * 0.2);
    g.fill();
    g.strokeStyle = METALS.white[3];
    g.lineWidth = 0.7;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.arc(-s * 0.32 + (i % 3) * s * 0.32, -s * 0.32 + Math.floor(i / 3) * s * 0.32, 0.6, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#0b0b0d';
    for (const [px, py] of pips) {
      g.beginPath();
      g.arc(px! * s * 0.27, py! * s * 0.27, s * 0.1, 0, TAU);
      g.fill();
    }
    g.restore();
  };
  die(x - 7, y + 2, 13, -0.25, [[-1, -1], [0, 0], [1, 1]]);
  die(x + 7, y - 1, 13, 0.32, [[-1, -1], [1, -1], [-1, 1], [1, 1]]);
  glint(g, x - 11, y - 4, 4.5);
  glint(g, x + 11, y + 4, 3.5, 0.8);
}

/** A gold medallion, the ace of spades in black enamel, ringed in diamonds. */
function medallion(g: G, x: number, y: number, r: number): void {
  g.fillStyle = sheen(g, 'gold', x - r, y - r, x + r, y + r);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    stone(g, x + Math.cos(a) * (r - 2.2), y + Math.sin(a) * (r - 2.2), 1.35);
  }
  g.fillStyle = '#f6eedd';
  g.beginPath();
  g.arc(x, y, r - 4.5, 0, TAU);
  g.fill();
  g.fillStyle = '#0c0c0e';
  spade(g, x, y, r * 1.0);
  glint(g, x - r * 0.6, y - r * 0.6, 4.5);
}

/** A playing card, gold-edged, with its corner index. */
function card(g: G, x: number, y: number, w: number, rot: number, face: string, red = false): void {
  const h = w * 1.4;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = sheen(g, 'gold', -w, -h, w, h);
  rrect(g, -w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 2.4);
  g.fill();
  g.fillStyle = '#fbf7ee';
  rrect(g, -w / 2, -h / 2, w, h, 1.8);
  g.fill();
  g.fillStyle = red ? '#b3141f' : '#121214';
  if (face === '♠') spade(g, 0, 1, w * 0.58);
  else {
    g.font = `700 ${w * 0.62}px Cinzel, Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(face, 0, 1);
  }
  g.restore();
}

function horseshoe(g: G, x: number, y: number, s: number): void {
  g.save();
  g.translate(x, y);
  g.lineCap = 'round';
  g.strokeStyle = sheen(g, 'gold', -s, -s, s, s);
  g.lineWidth = s * 0.34;
  g.beginPath();
  g.arc(0, 0, s * 0.62, Math.PI * 0.82, Math.PI * 2.18);
  g.stroke();
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.9 + (i / 6) * Math.PI * 1.2;
    stone(g, Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.62, s * 0.08, '#1fa35a');
  }
  g.restore();
}

/** The diamond B the size of a fist. */
function bigB(g: G, x: number, y: number, s: number): void {
  g.save();
  g.font = `900 ${s}px Cinzel, Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = sheen(g, 'gold', x - s, y - s, x + s, y + s);
  g.lineWidth = s * 0.16;
  g.strokeText('B', x, y);
  g.fillStyle = sheen(g, 'white', x - s / 2, y - s / 2, x + s / 2, y + s / 2);
  g.fillText('B', x, y);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 46; i++) {
    g.beginPath();
    g.arc(x - s * 0.4 + ((i * 37) % 100) / 100 * s * 0.8, y - s * 0.45 + ((i * 53) % 100) / 100 * s * 0.9, 0.9, 0, TAU);
    g.fill();
  }
  g.restore();
  glint(g, x - s * 0.22, y - s * 0.3, 6);
  glint(g, x + s * 0.18, y + s * 0.16, 4.5, 0.85);
}

/** The little ring a pendant hangs from, at the chain's lowest point. */
function bail(g: G, path: Path, drop: number): P {
  const low = path.at(path.len / 2).p;
  g.strokeStyle = sheen(g, 'gold', low[0] - 3, low[1], low[0] + 3, low[1] + drop);
  g.lineWidth = 1.6;
  g.beginPath();
  g.ellipse(low[0], low[1] + drop / 2, 2.2, drop / 2, 0, 0, TAU);
  g.stroke();
  return [low[0], low[1] + drop];
}

function chain(g: G, id: string): void {
  switch (id) {
    case 'rope-chain':
      return links(g, necklace(), 'rope');
    case 'figaro':
      return links(g, necklace(), 'figaro');
    case 'cuban-link':
      return links(g, necklace(), 'cuban');
    case 'tennis-chain':
      return links(g, necklace(), 'tennis');
    case 'iced-cuban':
      return links(g, necklace(), 'cuban', { iced: true, heavy: true });
    case 'dice-pendant': {
      const p = necklace(50);
      links(g, p, 'cuban');
      const [, y] = bail(g, p, 6);
      return dice(g, 100, y + 10);
    }
    case 'ace-pendant': {
      const p = necklace(50);
      links(g, p, 'rope');
      const [, y] = bail(g, p, 5);
      return medallion(g, 100, y + 15, 15);
    }
    case 'billionaire-chain': {
      const p = necklace(40);
      links(g, p, 'rope', { heavy: true });
      const [, y] = bail(g, p, 6);
      return bigB(g, 100, y + 23, 46);
    }
    case 'twentyone-pendant': {
      const p = necklace(50);
      links(g, p, 'rope');
      const [, y] = bail(g, p, 5);
      card(g, 93, y + 14, 15, -0.2, 'A');
      card(g, 107, y + 14, 15, 0.2, 'J', true);
      return glint(g, 115, y + 4, 4.5);
    }
    case 'royal-pendant': {
      const p = necklace(48);
      links(g, p, 'cuban');
      const [, y] = bail(g, p, 5);
      for (let i = 0; i < 5; i++) card(g, 100 + (i - 2) * 6.4, y + 15 + Math.abs(i - 2) * 1.4, 13, (i - 2) * 0.24, '♠');
      return glint(g, 116, y + 4, 4.5);
    }
    case 'horseshoe-pendant': {
      const p = necklace(50);
      links(g, p, 'figaro');
      const [, y] = bail(g, p, 5);
      return horseshoe(g, 100, y + 16, 24);
    }
    default:
      return links(g, necklace(), 'rope');
  }
}

// ---------------------------------------------------------------------------------------------
// Grills: the caps across a smile

function grill(g: G, id: string): void {
  const metal: Metal = id === 'rose-gold' ? 'rose' : id === 'diamond-set' ? 'white' : 'gold';
  const both = id !== 'gold-top-six';
  // the mouth behind the teeth
  g.fillStyle = '#2a0d10';
  g.beginPath();
  g.moveTo(42, 40);
  g.bezierCurveTo(70, 26, 130, 26, 158, 40);
  g.bezierCurveTo(140, 80, 60, 80, 42, 40);
  g.fill();
  const row = (top: boolean) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const w = 13.5 - Math.abs(t) * 7;
      const x = 100 + t * 104;
      const y = top ? 34 + t * t * 26 : 58 - t * t * 24;
      const h = (top ? 17 : 13) - Math.abs(t) * 5;
      const capped = top ? (both || Math.abs(t) < 0.4) : both;
      g.fillStyle = capped ? sheen(g, metal, x - w, y, x + w, y + h) : '#efe6d2';
      rrect(g, x - w / 2, top ? y : y - h, w - 0.8, h, 3);
      g.fill();
      g.strokeStyle = capped ? METALS[metal][3] : '#b9ac92';
      g.lineWidth = 0.6;
      g.stroke();
      if (capped && metal === 'white') {
        g.fillStyle = 'rgba(255,255,255,0.95)';
        for (let k = 0; k < 4; k++) {
          g.beginPath();
          g.arc(x - w * 0.22 + (k % 2) * w * 0.4, (top ? y + 4 : y - h + 4) + Math.floor(k / 2) * 5, 0.9, 0, TAU);
          g.fill();
        }
      }
    }
  };
  row(true);
  row(false);
  if (metal === 'white') {
    glint(g, 82, 40, 6);
    glint(g, 122, 54, 4.5, 0.85);
  } else glint(g, 88, 38, 4.5, 0.75);
}

// ---------------------------------------------------------------------------------------------
// Clothes: on a hanger, front on

interface Cloth {
  body: string;
  /** The lapels' or collar's colour, and their shape. */
  lapel?: string;
  collar: 'notch' | 'shawl' | 'zip' | 'stand' | 'open' | 'robe';
  long?: boolean;
  shirt?: boolean;
  bow?: boolean;
  pattern?: 'sequin' | 'sparkle' | 'fur' | 'ermine' | 'embroidery' | 'lame' | 'velvet';
}

const CLOTHES: Record<string, Cloth> = {
  'leather-jacket': { body: '#1d1d21', collar: 'zip', lapel: '#141417' },
  'gold-tracksuit': { body: '#d6a640', collar: 'stand', pattern: 'lame' },
  'white-tuxedo': { body: '#efe9dc', lapel: '#141416', collar: 'notch', shirt: true, bow: true },
  'velvet-jacket': { body: '#5b1324', lapel: '#121214', collar: 'shawl', shirt: true, bow: true, pattern: 'velvet' },
  'sequin-suit': { body: '#9ea3ab', lapel: '#c8ccd2', collar: 'notch', shirt: true, pattern: 'sequin' },
  'fur-coat': { body: '#ece2cd', collar: 'open', long: true, pattern: 'fur' },
  'diamond-suit': { body: '#141417', lapel: '#0b0b0d', collar: 'notch', shirt: true, pattern: 'sparkle' },
  'emperor-robe': { body: '#4a176c', collar: 'robe', long: true, pattern: 'ermine' },
  'champion-jacket': { body: '#121215', lapel: '#d4a845', collar: 'stand', pattern: 'embroidery' },
};

function garment(g: G, id: string): void {
  const c = CLOTHES[id] ?? { body: '#333338', collar: 'notch' as const };
  const hem = c.long ? 97 : 90;
  // the hanger
  g.strokeStyle = sheen(g, 'steel', 90, 0, 110, 10);
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(100, 7, 4, Math.PI * 1.05, Math.PI * 2.1);
  g.lineTo(100, 13);
  g.stroke();
  g.strokeStyle = '#6b4a2b';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(66, 24);
  g.quadraticCurveTo(100, 12, 134, 24);
  g.stroke();
  const cloth = (x0: number, x1: number) => {
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, shade(c.body, -0.35));
    gr.addColorStop(0.3, shade(c.body, 0.08));
    gr.addColorStop(0.55, c.body);
    gr.addColorStop(1, shade(c.body, -0.4));
    return gr;
  };
  // sleeves, a shade darker, behind the body
  g.fillStyle = cloth(52, 148);
  poly(g, [[66, 24], [56, 30], [50, hem - 10], [61, hem - 7], [67, 44]]);
  g.fill();
  poly(g, [[134, 24], [144, 30], [150, hem - 10], [139, hem - 7], [133, 44]]);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.18)';
  poly(g, [[50, hem - 10], [61, hem - 7], [61.6, hem - 11], [50.6, hem - 14]]);
  g.fill();
  poly(g, [[150, hem - 10], [139, hem - 7], [138.4, hem - 11], [149.4, hem - 14]]);
  g.fill();
  // the body
  const body: P[] = [[66, 24], [88, 21], [100, 26], [112, 21], [134, 24], [135, 44], [136, hem], [64, hem], [65, 44]];
  g.fillStyle = cloth(64, 136);
  poly(g, body);
  g.fill();
  g.save();
  poly(g, body);
  g.clip();
  pattern(g, c, hem);
  g.restore();
  // what's at the neck
  if (c.shirt) {
    g.fillStyle = '#f7f5ef';
    poly(g, [[90, 22], [110, 22], [100, 52]]);
    g.fill();
    if (c.bow) {
      g.fillStyle = '#0d0d0f';
      poly(g, [[93, 27], [100, 30], [107, 27], [107, 33], [100, 30], [93, 33]]);
      g.fill();
    } else {
      g.fillStyle = '#26262c';
      poly(g, [[98, 27], [102, 27], [103, 46], [100, 50], [97, 46]]);
      g.fill();
    }
  }
  const lapel = c.lapel ?? shade(c.body, -0.2);
  const satin = (x0: number, x1: number) => {
    const gr = g.createLinearGradient(x0, 20, x1, 60);
    gr.addColorStop(0, shade(lapel, 0.25));
    gr.addColorStop(0.5, lapel);
    gr.addColorStop(1, shade(lapel, -0.3));
    return gr;
  };
  if (c.collar === 'notch' || c.collar === 'shawl') {
    const notch = c.collar === 'notch';
    g.fillStyle = satin(84, 100);
    poly(g, notch ? [[88, 21], [84, 31], [88, 33], [86, 40], [100, 58], [93, 30]] : [[88, 21], [84, 34], [100, 58], [93, 28]]);
    g.fill();
    g.fillStyle = satin(116, 100);
    poly(g, notch ? [[112, 21], [116, 31], [112, 33], [114, 40], [100, 58], [107, 30]] : [[112, 21], [116, 34], [100, 58], [107, 28]]);
    g.fill();
    // two buttons and a pocket square
    g.fillStyle = shade(c.body, -0.5);
    for (const y of [64, 73]) {
      g.beginPath();
      g.arc(100, y, 1.5, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#f2efe8';
    poly(g, [[118, 41], [126, 41], [124, 37], [121, 39], [119, 37]]);
    g.fill();
  } else if (c.collar === 'zip') {
    // a biker's lapels folded open, the zip running across to the hem
    g.fillStyle = satin(84, 116);
    poly(g, [[88, 21], [80, 36], [94, 44], [100, 26]]);
    g.fill();
    poly(g, [[112, 21], [122, 33], [110, 40], [100, 26]]);
    g.fill();
    g.strokeStyle = sheen(g, 'steel', 90, 40, 120, 90);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(108, 40);
    g.lineTo(100, 58);
    g.lineTo(104, hem);
    g.stroke();
    g.fillStyle = METALS.steel[1];
    for (const [x, y] of [[70, 62], [130, 62]] as const) {
      g.fillRect(x - 4, y, 8, 1.2);
    }
  } else if (c.collar === 'stand') {
    g.fillStyle = shade(c.body, -0.25);
    poly(g, [[88, 19], [112, 19], [113, 27], [100, 29], [87, 27]]);
    g.fill();
    g.strokeStyle = sheen(g, 'steel', 95, 20, 105, 90);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(100, 27);
    g.lineTo(100, hem);
    g.stroke();
    if (id === 'gold-tracksuit') {
      g.fillStyle = '#f4efe2';
      poly(g, [[56, 30], [59, 29], [53, hem - 11], [50.8, hem - 11]]);
      g.fill();
      poly(g, [[144, 30], [141, 29], [147, hem - 11], [149.2, hem - 11]]);
      g.fill();
    }
  } else if (c.collar === 'open') {
    // worn open over black
    g.fillStyle = '#121214';
    poly(g, [[92, 22], [108, 22], [106, hem], [94, hem]]);
    g.fill();
    g.fillStyle = shade(c.body, -0.08);
    poly(g, [[84, 20], [92, 22], [95, hem], [86, hem]]);
    g.fill();
    poly(g, [[116, 20], [108, 22], [105, hem], [114, hem]]);
    g.fill();
  } else if (c.collar === 'robe') {
    // ermine down the front, gold thread, rubies
    for (const side of [-1, 1]) {
      g.fillStyle = '#f6f2ea';
      poly(g, [[100 + side * 4, 22], [100 + side * 14, 20], [100 + side * 10, hem], [100 + side * 2, hem]]);
      g.fill();
      g.fillStyle = '#111114';
      for (let y = 30; y < hem; y += 9) {
        g.beginPath();
        g.ellipse(100 + side * (8 - (y - 22) * 0.04), y, 0.9, 1.8, 0, 0, TAU);
        g.fill();
      }
    }
    for (let y = 34; y < hem - 6; y += 12) stone(g, 100, y, 2.2, '#d3192e');
    g.strokeStyle = sheen(g, 'gold', 60, 0, 140, 0);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(64, hem - 4);
    g.lineTo(136, hem - 4);
    g.stroke();
    g.fillStyle = '#f6f2ea';
    g.fillRect(64, hem - 3, 72, 3);
  }
}

/** What the cloth is: sequins, sewn-in diamonds, fur, lamé, velvet's sheen, gold embroidery. */
function pattern(g: G, c: Cloth, hem: number): void {
  switch (c.pattern) {
    case 'sequin':
      for (let y = 22; y < hem; y += 3.2) {
        for (let x = 60 + ((y * 7) % 3); x < 142; x += 3.2) {
          const k = Math.sin(x * 0.31 + y * 0.53) * 0.5 + 0.5;
          g.fillStyle = k > 0.8 ? '#ffffff' : k > 0.45 ? '#d7dbe0' : '#7c828b';
          g.beginPath();
          g.arc(x, y, 1.3, 0, TAU);
          g.fill();
        }
      }
      glint(g, 80, 40, 5);
      glint(g, 118, 70, 4, 0.8);
      break;
    case 'sparkle':
      for (let i = 0; i < 70; i++) {
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.beginPath();
        g.arc(64 + ((i * 41) % 72), 24 + ((i * 29) % (hem - 26)), 0.7, 0, TAU);
        g.fill();
      }
      glint(g, 78, 46, 4.5);
      glint(g, 122, 66, 4);
      glint(g, 96, 82, 3, 0.8);
      break;
    case 'fur':
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 0.8;
      for (let i = 0; i < 90; i++) {
        const x = 64 + ((i * 37) % 72);
        const y = 24 + ((i * 53) % (hem - 26));
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + 2, y + 3, x + 1, y + 6);
        g.stroke();
      }
      break;
    case 'lame': {
      const gr = g.createLinearGradient(64, 20, 136, hem);
      for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, i % 2 ? 'rgba(255,244,200,0.45)' : 'rgba(120,80,20,0.2)');
      g.fillStyle = gr;
      g.fillRect(60, 18, 80, hem);
      break;
    }
    case 'velvet': {
      const gr = g.createRadialGradient(84, 48, 2, 84, 48, 40);
      gr.addColorStop(0, 'rgba(255,170,190,0.32)');
      gr.addColorStop(1, 'rgba(255,170,190,0)');
      g.fillStyle = gr;
      g.fillRect(60, 18, 80, hem);
      break;
    }
    case 'embroidery':
      g.strokeStyle = sheen(g, 'gold', 64, 20, 136, 90);
      g.lineWidth = 1;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const y = 34 + i * 7;
          g.beginPath();
          g.ellipse(100 + side * (16 + i * 1.4), y, 3.4, 1.4, side * 0.6, 0, TAU);
          g.stroke();
        }
      }
      g.fillStyle = sheen(g, 'gold', 110, 30, 130, 50);
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 2.6 : 6;
        g.lineTo(122 + Math.cos(a) * r, 42 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.fillStyle = METALS.gold[1];
      g.fillRect(64, hem - 3, 72, 2);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Watches, face on, the bracelet running off the top and bottom

function watch(g: G, id: string): void {
  const metal: Metal = id === 'iced-watch' ? 'white' : id === 'rose-watch' ? 'rose' : 'gold';
  const dial = id === 'rose-watch' ? '#141416' : id === 'iced-watch' ? '#cfd5dc' : '#dcc08e';
  const iced = id === 'iced-watch';
  floorShadow(g, 104, 92, 40, 6, 0.22);
  // the bracelet: three rows of links, top and bottom
  for (const [y0, y1] of [[2, 30], [70, 98]] as const) {
    for (let y = y0; y < y1; y += 5.2) {
      const taper = y0 === 2 ? (y - y0) / 28 : 1 - (y - y0) / 28;
      const w = 30 + taper * 6;
      g.fillStyle = sheen(g, metal, 100 - w / 2, y, 100 + w / 2, y + 4);
      rrect(g, 100 - w / 2, y, w * 0.3, 4.6, 1.4);
      g.fill();
      rrect(g, 100 - w * 0.17, y, w * 0.34, 4.6, 1.4);
      g.fill();
      rrect(g, 100 + w * 0.2, y, w * 0.3, 4.6, 1.4);
      g.fill();
      if (iced) {
        g.fillStyle = 'rgba(255,255,255,0.9)';
        for (let k = 0; k < 5; k++) {
          g.beginPath();
          g.arc(100 - w * 0.36 + k * w * 0.18, y + 2.3, 0.8, 0, TAU);
          g.fill();
        }
      }
    }
  }
  // the crown, the case, the bezel, the dial
  g.fillStyle = sheen(g, metal, 126, 46, 132, 54);
  rrect(g, 124, 46, 7, 8, 2);
  g.fill();
  g.fillStyle = sheen(g, metal, 72, 22, 128, 78);
  g.beginPath();
  g.arc(100, 50, 27, 0, TAU);
  g.fill();
  if (iced) {
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * TAU;
      stone(g, 100 + Math.cos(a) * 24.5, 50 + Math.sin(a) * 24.5, 1.9);
    }
  } else {
    g.strokeStyle = METALS[metal][3];
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(100, 50, 24, 0, TAU);
    g.stroke();
  }
  const dg = g.createRadialGradient(94, 44, 2, 100, 50, 21);
  dg.addColorStop(0, shade(dial, 0.35));
  dg.addColorStop(1, shade(dial, -0.25));
  g.fillStyle = dg;
  g.beginPath();
  g.arc(100, 50, 21, 0, TAU);
  g.fill();
  const ink = id === 'rose-watch' ? METALS.rose[1] : '#2a2018';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.strokeStyle = i % 3 === 0 ? METALS[metal][1] : ink;
    g.lineWidth = i % 3 === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(100 + Math.cos(a) * 17, 50 + Math.sin(a) * 17);
    g.lineTo(100 + Math.cos(a) * (i % 3 === 0 ? 13 : 15), 50 + Math.sin(a) * (i % 3 === 0 ? 13 : 15));
    g.stroke();
  }
  // ten past ten, the way a watch is shown
  g.strokeStyle = id === 'rose-watch' ? METALS.rose[0] : '#1b140e';
  g.lineCap = 'round';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(100, 50);
  g.lineTo(100 + Math.cos(-2.6) * 10, 50 + Math.sin(-2.6) * 10);
  g.stroke();
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(100, 50);
  g.lineTo(100 + Math.cos(-0.55) * 15, 50 + Math.sin(-0.55) * 15);
  g.stroke();
  g.fillStyle = METALS[metal][1];
  g.beginPath();
  g.arc(100, 50, 1.6, 0, TAU);
  g.fill();
  // the crystal's catch-light
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.ellipse(92, 41, 12, 6, -0.6, 0, TAU);
  g.fill();
  if (iced) {
    glint(g, 80, 32, 6);
    glint(g, 121, 66, 4.5, 0.85);
  } else glint(g, 82, 34, 4, 0.7);
}

// ---------------------------------------------------------------------------------------------
// Shades, face on

function shades(g: G, id: string): void {
  floorShadow(g, 100, 86, 56, 6, 0.2);
  const lens = (x: number, flip: number, shape: 'drop' | 'round' | 'rect', fill: CanvasGradient | string) => {
    g.save();
    g.translate(x, 48);
    g.scale(flip, 1);
    g.beginPath();
    if (shape === 'round') g.arc(0, 0, 18, 0, TAU);
    else if (shape === 'drop') {
      g.moveTo(-20, -14);
      g.bezierCurveTo(-6, -18, 14, -17, 22, -12);
      g.bezierCurveTo(24, 6, 12, 22, -2, 20);
      g.bezierCurveTo(-18, 18, -24, 2, -20, -14);
    } else {
      g.moveTo(-21, -13);
      g.lineTo(21, -15);
      g.bezierCurveTo(23, 4, 14, 17, 0, 17);
      g.bezierCurveTo(-16, 17, -23, 6, -21, -13);
    }
    g.restore();
    g.fillStyle = fill;
    g.fill();
  };
  const tint = (top: string, bottom: string) => {
    const gr = g.createLinearGradient(0, 30, 0, 68);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    return gr;
  };
  const sheenLens = (x: number) => {
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.ellipse(x - 6, 41, 8, 3.2, -0.4, 0, TAU);
    g.fill();
  };
  if (id === 'round-shades') {
    const tort = (x: number) => {
      g.save();
      g.lineWidth = 5;
      g.strokeStyle = '#5a3216';
      g.beginPath();
      g.arc(x, 48, 18, 0, TAU);
      g.stroke();
      g.strokeStyle = 'rgba(214,150,62,0.8)';
      g.lineWidth = 2;
      g.setLineDash([3, 5, 1, 4]);
      g.stroke();
      g.restore();
    };
    lens(72, 1, 'round', tint('#28402a', '#6f8c58'));
    lens(128, 1, 'round', tint('#28402a', '#6f8c58'));
    tort(72);
    tort(128);
    g.strokeStyle = '#5a3216';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(90, 44);
    g.quadraticCurveTo(100, 38, 110, 44);
    g.stroke();
    sheenLens(72);
    sheenLens(128);
    return;
  }
  if (id === 'gold-aviators') {
    lens(72, 1, 'drop', tint('#2d1a0e', 'rgba(196,150,100,0.85)'));
    lens(128, -1, 'drop', tint('#2d1a0e', 'rgba(196,150,100,0.85)'));
    g.strokeStyle = sheen(g, 'gold', 50, 30, 150, 70);
    g.lineWidth = 1.7;
    for (const [x, f] of [[72, 1], [128, -1]] as const) {
      g.save();
      g.translate(x, 48);
      g.scale(f, 1);
      g.beginPath();
      g.moveTo(-20, -14);
      g.bezierCurveTo(-6, -18, 14, -17, 22, -12);
      g.bezierCurveTo(24, 6, 12, 22, -2, 20);
      g.bezierCurveTo(-18, 18, -24, 2, -20, -14);
      g.restore();
      g.stroke();
    }
    g.beginPath();
    g.moveTo(92, 37);
    g.quadraticCurveTo(100, 33, 108, 37);
    g.moveTo(93, 44);
    g.quadraticCurveTo(100, 41, 107, 44);
    g.stroke();
    g.beginPath();
    g.moveTo(52, 36);
    g.lineTo(40, 34);
    g.moveTo(148, 36);
    g.lineTo(160, 34);
    g.stroke();
    sheenLens(72);
    sheenLens(128);
    return;
  }
  if (id === 'diamond-shades') {
    lens(72, 1, 'rect', tint('rgba(40,44,52,0.95)', 'rgba(150,158,170,0.75)'));
    lens(128, -1, 'rect', tint('rgba(40,44,52,0.95)', 'rgba(150,158,170,0.75)'));
    g.strokeStyle = sheen(g, 'white', 90, 36, 110, 44);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(92, 38);
    g.quadraticCurveTo(100, 34, 108, 38);
    g.stroke();
    for (let i = 0; i < 9; i++) {
      stone(g, 54 + i * 4.6, 35.4 - i * 0.24, 1.6);
      stone(g, 146 - i * 4.6, 35.4 - i * 0.24, 1.6);
    }
    sheenLens(72);
    sheenLens(128);
    glint(g, 60, 34, 5.5);
    glint(g, 136, 34, 4.5, 0.85);
    return;
  }
  // the high roller's: gold frames, black lenses, a gold chip on each temple
  lens(72, 1, 'rect', tint('#050506', '#26262b'));
  lens(128, -1, 'rect', tint('#050506', '#26262b'));
  g.strokeStyle = sheen(g, 'gold', 50, 30, 150, 70);
  g.lineWidth = 3;
  for (const [x, f] of [[72, 1], [128, -1]] as const) {
    g.save();
    g.translate(x, 48);
    g.scale(f, 1);
    g.beginPath();
    g.moveTo(-21, -13);
    g.lineTo(21, -15);
    g.bezierCurveTo(23, 4, 14, 17, 0, 17);
    g.bezierCurveTo(-16, 17, -23, 6, -21, -13);
    g.restore();
    g.stroke();
  }
  g.beginPath();
  g.moveTo(92, 37);
  g.quadraticCurveTo(100, 33, 108, 37);
  g.stroke();
  for (const x of [44, 156]) {
    g.fillStyle = sheen(g, 'gold', x - 5, 30, x + 5, 40);
    g.beginPath();
    g.arc(x, 36, 5, 0, TAU);
    g.fill();
    g.strokeStyle = '#7d4f12';
    g.lineWidth = 0.8;
    g.setLineDash([1.6, 1.6]);
    g.beginPath();
    g.arc(x, 36, 3.6, 0, TAU);
    g.stroke();
    g.setLineDash([]);
  }
  sheenLens(72);
  sheenLens(128);
}

// ---------------------------------------------------------------------------------------------
// Hats, three-quarter on

function felt(g: G, base: string, x0: number, x1: number): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, shade(base, -0.35));
  gr.addColorStop(0.35, shade(base, 0.15));
  gr.addColorStop(0.6, base);
  gr.addColorStop(1, shade(base, -0.45));
  return gr;
}

function hat(g: G, id: string): void {
  floorShadow(g, 100, 90, 60, 7, 0.26);
  if (id === 'gold-crown' || id === 'imperial-crown') return crown(g, id === 'imperial-crown');
  const base = id === 'panama-hat' ? '#d9c18a' : id === 'cowboy-hat' ? '#cdc2ae' : '#1d1d21';
  const band = id === 'cowboy-hat' ? '#4a2e1c' : '#0b0b0d';
  if (id === 'top-hat') {
    g.fillStyle = felt(g, '#151518', 40, 160);
    g.beginPath();
    g.ellipse(100, 76, 54, 11, 0, 0, TAU);
    g.fill();
    g.fillStyle = felt(g, '#19191d', 72, 128);
    poly(g, [[74, 74], [72, 14], [128, 14], [126, 74]]);
    g.fill();
    g.fillStyle = '#26262b';
    g.beginPath();
    g.ellipse(100, 14, 28, 6, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#060607';
    g.fillRect(73.5, 58, 53, 10);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(84, 16, 5, 42);
    return;
  }
  // the brim: the cowboy's curls up at the sides
  g.fillStyle = felt(g, base, 36, 164);
  g.beginPath();
  if (id === 'cowboy-hat') {
    g.moveTo(34, 58);
    g.quadraticCurveTo(44, 74, 100, 78);
    g.quadraticCurveTo(156, 74, 166, 58);
    g.quadraticCurveTo(160, 82, 100, 86);
    g.quadraticCurveTo(40, 82, 34, 58);
  } else g.ellipse(100, 74, 58, 12, 0, 0, TAU);
  g.fill();
  // the crown, pinched at the front, a crease down the top
  g.fillStyle = felt(g, base, 68, 132);
  g.beginPath();
  g.moveTo(68, 74);
  g.bezierCurveTo(66, 50, 70, 26, 84, 24);
  g.quadraticCurveTo(100, 30, 116, 24);
  g.bezierCurveTo(130, 26, 134, 50, 132, 74);
  g.quadraticCurveTo(100, 80, 68, 74);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(100, 30);
  g.quadraticCurveTo(98, 40, 100, 50);
  g.stroke();
  if (id === 'panama-hat') {
    // the weave, inside the crown's outline
    g.save();
    g.beginPath();
    g.moveTo(68, 74);
    g.bezierCurveTo(66, 50, 70, 26, 84, 24);
    g.quadraticCurveTo(100, 30, 116, 24);
    g.bezierCurveTo(130, 26, 134, 50, 132, 74);
    g.quadraticCurveTo(100, 80, 68, 74);
    g.clip();
    g.globalAlpha = 0.25;
    g.strokeStyle = '#6b5126';
    g.lineWidth = 0.6;
    for (let x = 40; x < 165; x += 3.5) {
      g.beginPath();
      g.moveTo(x, 20);
      g.lineTo(x + 8, 90);
      g.stroke();
    }
    g.restore();
  }
  g.fillStyle = band;
  g.beginPath();
  g.moveTo(68.5, 62);
  g.quadraticCurveTo(100, 68, 131.5, 62);
  g.lineTo(132, 72);
  g.quadraticCurveTo(100, 78, 68, 72);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.ellipse(84, 42, 5, 14, 0.15, 0, TAU);
  g.fill();
}

function crown(g: G, imperial: boolean): void {
  const metal: Metal = imperial ? 'white' : 'gold';
  if (imperial) {
    // purple velvet under platinum arches, an orb on top, the sapphire at the front
    g.fillStyle = '#4b1670';
    g.beginPath();
    g.ellipse(100, 44, 34, 26, 0, Math.PI, 0);
    g.fill();
    g.strokeStyle = sheen(g, 'white', 60, 10, 140, 70);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(66, 66);
    g.bezierCurveTo(66, 20, 134, 20, 134, 66);
    g.moveTo(100, 66);
    g.lineTo(100, 22);
    g.moveTo(80, 66);
    g.bezierCurveTo(80, 30, 120, 30, 120, 66);
    g.stroke();
    g.fillStyle = sheen(g, 'white', 94, 6, 106, 18);
    g.beginPath();
    g.arc(100, 16, 6, 0, TAU);
    g.fill();
    g.fillRect(98.6, 2, 2.8, 9);
    g.fillRect(95, 5, 10, 2.6);
  }
  // the band with its points (and a ball on each)
  const top = imperial ? 54 : 30;
  g.fillStyle = sheen(g, metal, 60, top, 140, 82);
  g.beginPath();
  g.moveTo(62, 82);
  g.lineTo(60, 60);
  const pts = 8;
  for (let i = 0; i <= pts; i++) {
    const x = 60 + (i / pts) * 80;
    g.lineTo(x, i % 2 ? 60 : top);
  }
  g.lineTo(138, 82);
  g.quadraticCurveTo(100, 88, 62, 82);
  g.fill();
  if (!imperial) {
    for (let i = 0; i <= pts; i += 2) {
      g.fillStyle = sheen(g, 'gold', 60, 22, 140, 34);
      g.beginPath();
      g.arc(60 + (i / pts) * 80, top - 2, 3.2, 0, TAU);
      g.fill();
    }
  }
  g.fillStyle = sheen(g, metal, 60, 66, 140, 84);
  g.beginPath();
  g.moveTo(61, 66);
  g.quadraticCurveTo(100, 72, 139, 66);
  g.lineTo(138, 82);
  g.quadraticCurveTo(100, 88, 62, 82);
  g.fill();
  for (let i = 0; i < 5; i++) stone(g, 72 + i * 14, 75 + (i === 2 ? 1 : 0), i === 2 ? 4.4 : 2.6, imperial ? (i === 2 ? '#1f4fd6' : '#e6edf5') : '#d0182c');
  if (imperial) {
    for (let i = 0; i < 26; i++) stone(g, 63 + i * 2.9, 68.5 + Math.sin(i) * 0.4, 1.1);
    glint(g, 84, 40, 5.5);
    glint(g, 116, 30, 4.5);
    glint(g, 100, 75, 6.5);
  } else {
    glint(g, 76, 44, 5);
    glint(g, 124, 70, 4, 0.8);
  }
}

// ---------------------------------------------------------------------------------------------
// Rides, side on

function glowUnder(g: G, x: number, y: number, rx: number, color: string): void {
  g.save();
  g.translate(x, y);
  g.scale(1, 0.22);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, rx, 0, TAU);
  g.fill();
  g.restore();
}

function wheel(g: G, x: number, y: number, r: number, tyre = '#141416', hub: string = METALS.steel[1]): void {
  g.fillStyle = tyre;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = hub;
  g.beginPath();
  g.arc(x, y, r * 0.45, 0, TAU);
  g.fill();
}

function ride(g: G, id: string): void {
  switch (id) {
    case 'skateboard': {
      floorShadow(g, 100, 88, 62, 5, 0.3);
      g.fillStyle = '#c99a5b';
      g.beginPath();
      g.moveTo(40, 58);
      g.quadraticCurveTo(46, 66, 58, 66);
      g.lineTo(142, 66);
      g.quadraticCurveTo(154, 66, 160, 58);
      g.lineTo(162, 61);
      g.quadraticCurveTo(156, 71, 142, 71);
      g.lineTo(58, 71);
      g.quadraticCurveTo(44, 71, 38, 61);
      g.closePath();
      g.fill();
      g.strokeStyle = '#141416';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(41, 58);
      g.quadraticCurveTo(46, 65, 58, 65);
      g.lineTo(142, 65);
      g.quadraticCurveTo(154, 65, 159, 58);
      g.stroke();
      g.fillStyle = METALS.steel[2];
      g.fillRect(64, 71, 16, 5);
      g.fillRect(120, 71, 16, 5);
      wheel(g, 66, 80, 6, '#c8242f', '#f1d9b8');
      wheel(g, 78, 80, 6, '#c8242f', '#f1d9b8');
      wheel(g, 122, 80, 6, '#c8242f', '#f1d9b8');
      wheel(g, 134, 80, 6, '#c8242f', '#f1d9b8');
      return;
    }
    case 'e-scooter': {
      floorShadow(g, 100, 92, 58, 5, 0.3);
      wheel(g, 58, 82, 10);
      wheel(g, 142, 82, 10);
      g.fillStyle = sheen(g, 'steel', 50, 70, 50, 80);
      rrect(g, 56, 72, 74, 6, 3);
      g.fill();
      g.strokeStyle = sheen(g, 'steel', 120, 10, 145, 80);
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(142, 82);
      g.lineTo(130, 16);
      g.stroke();
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(118, 14);
      g.lineTo(142, 18);
      g.stroke();
      g.strokeStyle = '#121214';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(117, 13.8);
      g.lineTo(122, 14.6);
      g.moveTo(138, 17.4);
      g.lineTo(143, 18.2);
      g.stroke();
      g.fillStyle = '#7fd6ff';
      g.beginPath();
      g.arc(136, 40, 1.8, 0, TAU);
      g.fill();
      return;
    }
    case 'hoverboard':
    case 'golden-board': {
      const gold = id === 'golden-board';
      glowUnder(g, 100, 84, 64, gold ? 'rgba(255,196,80,0.75)' : 'rgba(61,190,255,0.75)');
      g.fillStyle = gold ? sheen(g, 'gold', 40, 52, 40, 68) : '#20242c';
      rrect(g, 40, 54, 120, 14, 7);
      g.fill();
      g.fillStyle = gold ? 'rgba(255,255,255,0.35)' : '#3a3f4a';
      rrect(g, 46, 55, 108, 4, 2);
      g.fill();
      g.fillStyle = gold ? '#ffe7a8' : '#59d3ff';
      for (const x of [56, 144]) {
        g.beginPath();
        g.ellipse(x, 68.5, 10, 2, 0, 0, TAU);
        g.fill();
      }
      g.strokeStyle = gold ? 'rgba(255,214,120,0.5)' : 'rgba(90,210,255,0.5)';
      g.lineWidth = 1;
      for (const [x, y] of [[30, 62], [24, 70], [34, 76]] as const) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 14, y);
        g.stroke();
      }
      if (gold) glint(g, 64, 57, 5);
      return;
    }
    case 'segway': {
      floorShadow(g, 100, 94, 40, 5, 0.32);
      wheel(g, 100, 74, 19, '#18181b', METALS.steel[1]);
      g.fillStyle = '#2b2e35';
      rrect(g, 76, 64, 48, 8, 3);
      g.fill();
      g.strokeStyle = sheen(g, 'steel', 95, 10, 105, 70);
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(100, 66);
      g.lineTo(104, 14);
      g.stroke();
      g.strokeStyle = '#141416';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(88, 13);
      g.lineTo(120, 15);
      g.stroke();
      return;
    }
    case 'hover-throne': {
      glowUnder(g, 100, 88, 58, 'rgba(255,190,80,0.8)');
      const gold = sheen(g, 'gold', 60, 0, 140, 90);
      // the back, the seat, the arms, the feet that never touch the floor
      g.fillStyle = gold;
      g.beginPath();
      g.moveTo(72, 70);
      g.lineTo(70, 22);
      g.quadraticCurveTo(72, 4, 92, 6);
      g.quadraticCurveTo(100, 0, 108, 6);
      g.quadraticCurveTo(128, 4, 130, 22);
      g.lineTo(128, 70);
      g.closePath();
      g.fill();
      g.fillStyle = '#a3121f';
      rrect(g, 78, 14, 44, 44, 8);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.14)';
      rrect(g, 82, 18, 10, 36, 5);
      g.fill();
      g.fillStyle = gold;
      rrect(g, 62, 54, 76, 12, 4);
      g.fill();
      g.fillStyle = '#b3141f';
      rrect(g, 66, 50, 68, 6, 3);
      g.fill();
      g.fillStyle = gold;
      rrect(g, 58, 42, 12, 16, 4);
      g.fill();
      rrect(g, 130, 42, 12, 16, 4);
      g.fill();
      for (const x of [66, 132]) {
        g.fillRect(x - 3, 66, 6, 10);
      }
      stone(g, 100, 8, 3, '#d0182c');
      glint(g, 74, 20, 5);
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Emotes: a pictogram caught in the move, in gold, with a line or two of motion

interface Pose {
  head: P;
  r?: number;
  /** Neck to hip. */
  spine: [P, P];
  /** Shoulder (the neck) to elbow to hand, twice. */
  arms: [P[], P[]];
  /** Hip to knee to foot, twice. */
  legs: [P[], P[]];
}

const POSES: Record<string, Pose> = {
  throwback: { head: [78, 40], spine: [[86, 47], [113, 52]], arms: [[[86, 47], [93, 61], [101, 70]], [[86, 47], [90, 62], [97, 72]]], legs: [[[113, 52], [104, 72], [101, 94]], [[113, 52], [120, 72], [124, 94]]] },
  twerk: { head: [92, 26], spine: [[95, 35], [104, 60]], arms: [[[95, 35], [86, 50], [84, 64]], [[95, 35], [100, 51], [116, 64]]], legs: [[[104, 60], [84, 70], [80, 94]], [[104, 60], [122, 72], [124, 94]]] },
  griddy: { head: [99, 13], spine: [[100, 23], [101, 55]], arms: [[[100, 23], [90, 24], [97, 15]], [[100, 23], [112, 36], [123, 46]]], legs: [[[101, 55], [113, 66], [106, 80]], [[101, 55], [97, 75], [94, 94]]] },
  floss: { head: [101, 13], spine: [[101, 23], [104, 55]], arms: [[[101, 23], [86, 40], [74, 54]], [[101, 23], [90, 42], [80, 58]]], legs: [[[104, 55], [100, 75], [98, 94]], [[104, 55], [111, 74], [114, 94]]] },
  dab: { head: [94, 22], spine: [[101, 26], [101, 57]], arms: [[[101, 26], [83, 21], [98, 28]], [[101, 26], [120, 15], [138, 4]]], legs: [[[101, 57], [96, 76], [93, 94]], [[101, 57], [107, 76], [110, 94]]] },
  robot: { head: [100, 13], spine: [[100, 23], [100, 55]], arms: [[[100, 23], [80, 26], [80, 44]], [[100, 23], [120, 26], [120, 8]]], legs: [[[100, 55], [92, 74], [92, 94]], [[100, 55], [114, 62], [114, 80]]] },
  backflip: { head: [100, 76], spine: [[100, 67], [100, 40]], arms: [[[100, 67], [88, 76], [84, 88]], [[100, 67], [112, 76], [116, 88]]], legs: [[[100, 40], [90, 28], [96, 16]], [[100, 40], [110, 28], [104, 16]]] },
  moneyfan: { head: [96, 14], spine: [[97, 24], [99, 56]], arms: [[[97, 24], [112, 30], [118, 16]], [[97, 24], [88, 40], [90, 54]]], legs: [[[99, 56], [94, 75], [92, 94]], [[99, 56], [106, 75], [108, 94]]] },
  bow: { head: [74, 52], spine: [[82, 48], [107, 46]], arms: [[[82, 48], [90, 60], [86, 52]], [[82, 48], [96, 40], [110, 52]]], legs: [[[107, 46], [106, 70], [104, 94]], [[107, 46], [112, 70], [114, 94]]] },
  trophy: { head: [100, 34], r: 6, spine: [[100, 42], [100, 68]], arms: [[[100, 42], [90, 32], [95, 22]], [[100, 42], [110, 32], [105, 22]]], legs: [[[100, 68], [94, 82], [92, 96]], [[100, 68], [106, 82], [108, 96]]] },
  moonwalk: { head: [94, 14], spine: [[96, 24], [102, 56]], arms: [[[96, 24], [90, 40], [92, 54]], [[96, 24], [106, 40], [110, 52]]], legs: [[[102, 56], [94, 75], [86, 94]], [[102, 56], [110, 74], [118, 90]]] },
};

function figure(g: G, pose: Pose, metal: Metal = 'gold', width = 7.4): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = sheen(g, metal, 70, 0, 130, 100);
  g.lineWidth = width;
  const line = (pts: P[]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  };
  // the far limbs a touch darker, so the figure reads in depth
  g.save();
  g.globalAlpha = 0.72;
  line(pose.arms[1]);
  line(pose.legs[1]);
  g.restore();
  line(pose.spine);
  line(pose.legs[0]);
  line(pose.arms[0]);
  g.fillStyle = sheen(g, metal, pose.head[0] - 8, pose.head[1] - 8, pose.head[0] + 8, pose.head[1] + 8);
  g.beginPath();
  g.arc(pose.head[0], pose.head[1], pose.r ?? 7.6, 0, TAU);
  g.fill();
}

function motion(g: G, lines: [P, P][]): void {
  g.strokeStyle = 'rgba(214,170,90,0.6)';
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  for (const [a, b] of lines) {
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }
}

function arc(g: G, x: number, y: number, r: number, a0: number, a1: number): void {
  g.strokeStyle = 'rgba(214,170,90,0.65)';
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, r, a0, a1);
  g.stroke();
}

function emote(g: G, id: string): void {
  const pose = POSES[id];
  if (!pose) return;
  floorShadow(g, 102, 95, 30, 3.5, 0.28);
  switch (id) {
    case 'throwback':
      arc(g, 116, 52, 14, -0.9, 0.9);
      arc(g, 116, 52, 20, -0.7, 0.7);
      break;
    case 'twerk':
      motion(g, [[[124, 56], [132, 60]], [[126, 64], [134, 64]], [[82, 56], [74, 58]]]);
      break;
    case 'griddy':
      motion(g, [[[114, 84], [120, 88]], [[108, 88], [110, 94]]]);
      break;
    case 'floss':
      arc(g, 78, 56, 16, 2.0, 3.0);
      arc(g, 118, 56, 16, 0.14, 1.1);
      break;
    case 'robot':
      motion(g, [[[86, 8], [90, 11]], [[114, 8], [110, 11]], [[100, 2], [100, 5]]]);
      break;
    case 'backflip':
      arc(g, 100, 52, 38, -2.7, 1.1);
      g.fillStyle = 'rgba(214,170,90,0.75)';
      poly(g, [[114, 86], [124, 82], [115, 79]]);
      g.fill();
      break;
    case 'moonwalk':
      motion(g, [[[128, 70], [140, 70]], [[126, 80], [144, 80]], [[130, 90], [138, 90]]]);
      break;
  }
  figure(g, pose);
  if (id === 'moneyfan') {
    for (let i = 0; i < 6; i++) {
      g.save();
      g.translate(120, 16);
      g.rotate(-0.9 + i * 0.32);
      g.fillStyle = i % 2 ? '#a9bd8f' : '#bdcea4';
      rrect(g, -2, -20, 9, 20, 1);
      g.fill();
      g.strokeStyle = '#5f7a48';
      g.lineWidth = 0.6;
      g.stroke();
      g.restore();
    }
  }
  if (id === 'trophy') {
    g.fillStyle = sheen(g, 'gold', 86, 0, 114, 24);
    g.beginPath();
    g.moveTo(88, 4);
    g.lineTo(112, 4);
    g.quadraticCurveTo(112, 18, 100, 20);
    g.quadraticCurveTo(88, 18, 88, 4);
    g.fill();
    g.fillRect(98, 19, 4, 4);
    g.lineWidth = 2;
    g.strokeStyle = METALS.gold[1];
    g.beginPath();
    g.arc(86, 9, 4, Math.PI * 0.5, Math.PI * 1.5);
    g.arc(114, 9, 4, Math.PI * 1.5, Math.PI * 0.5);
    g.stroke();
    glint(g, 94, 8, 4.5);
  }
}

// ---------------------------------------------------------------------------------------------
// Effects: a small night scene of what goes off

function stage(g: G): void {
  const gr = g.createLinearGradient(0, 0, 0, 100);
  gr.addColorStop(0, '#0c0b12');
  gr.addColorStop(1, '#1d1610');
  g.fillStyle = gr;
  rrect(g, 4, 2, 192, 96, 8);
  g.fill();
  g.save();
  rrect(g, 4, 2, 192, 96, 8);
  g.clip();
}

function confetti(g: G, n: number, x: number, y: number, spread: number, seed = 1): void {
  const colors = ['#f2c14e', '#e8a531', '#c8242f', '#f4e3b0', '#ffffff'];
  let s = seed * 9301;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * spread;
    const d = 12 + rnd() * 62;
    g.save();
    g.translate(x + Math.cos(a) * d * 1.3, y + Math.sin(a) * d);
    g.rotate(rnd() * TAU);
    g.fillStyle = colors[i % colors.length]!;
    g.fillRect(-2, -1.2, 4, 2.4);
    g.restore();
  }
}

function coin(g: G, x: number, y: number, r: number, tilt: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.fillStyle = sheen(g, 'gold', -r, -r, r, r);
  g.beginPath();
  g.ellipse(0, 0, r, r * 0.45, 0, 0, TAU);
  g.fill();
  g.strokeStyle = METALS.gold[3];
  g.lineWidth = 0.6;
  g.stroke();
  g.restore();
}

function bill(g: G, x: number, y: number, rot: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = '#b7c79d';
  g.fillRect(-9, -4, 18, 8);
  g.strokeStyle = '#5f7a48';
  g.lineWidth = 0.6;
  g.strokeRect(-7.5, -2.8, 15, 5.6);
  g.fillStyle = '#5f7a48';
  g.beginPath();
  g.arc(0, 0, 1.8, 0, TAU);
  g.fill();
  g.restore();
}

/** A pictogram in silhouette, standing, for the scenes. */
const STANDING: Pose = { head: [100, 50], r: 5, spine: [[100, 57], [100, 78]], arms: [[[100, 57], [93, 66], [91, 76]], [[100, 57], [107, 66], [109, 76]]], legs: [[[100, 78], [97, 88], [96, 97]], [[100, 78], [103, 88], [104, 97]]] };

function effect(g: G, id: string): void {
  stage(g);
  switch (id) {
    case 'fx-confetti':
      confetti(g, 80, 100, 88, 1.8, 3);
      figure(g, STANDING, 'gold', 4.2);
      break;
    case 'fx-spotlight': {
      const gr = g.createLinearGradient(0, 0, 0, 100);
      gr.addColorStop(0, 'rgba(255,246,226,0.75)');
      gr.addColorStop(1, 'rgba(255,246,226,0.12)');
      g.fillStyle = gr;
      poly(g, [[94, 0], [106, 0], [136, 96], [64, 96]]);
      g.fill();
      g.fillStyle = 'rgba(255,240,210,0.45)';
      g.beginPath();
      g.ellipse(100, 95, 36, 5, 0, 0, TAU);
      g.fill();
      figure(g, STANDING, 'black', 4.2);
      break;
    }
    case 'fx-round': {
      // two flutes touching, the champagne leaping
      for (const [x, r] of [[86, 0.28], [114, -0.28]] as const) {
        g.save();
        g.translate(x, 60);
        g.rotate(r);
        g.fillStyle = 'rgba(240,210,120,0.85)';
        poly(g, [[-6, -26], [6, -26], [4.5, 6], [0, 10], [-4.5, 6]]);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 1.2;
        poly(g, [[-7, -34], [7, -34], [5, 6], [0, 11], [-5, 6]]);
        g.stroke();
        g.beginPath();
        g.moveTo(0, 11);
        g.lineTo(0, 28);
        g.moveTo(-7, 29);
        g.lineTo(7, 29);
        g.stroke();
        g.restore();
      }
      g.fillStyle = 'rgba(255,236,170,0.9)';
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        g.arc(92 + ((i * 17) % 18), 10 + ((i * 29) % 24), 0.9 + (i % 3) * 0.4, 0, TAU);
        g.fill();
      }
      glint(g, 100, 26, 6);
      break;
    }
    case 'fx-rain':
      for (let i = 0; i < 16; i++) bill(g, 30 + ((i * 47) % 140), 8 + ((i * 31) % 70), ((i * 0.7) % 1.6) - 0.8);
      figure(g, STANDING, 'gold', 4.2);
      for (let i = 0; i < 5; i++) bill(g, 72 + i * 14, 95, (i % 2 ? 0.2 : -0.2));
      break;
    case 'fx-sparklers':
      for (const x of [40, 80, 120, 160]) {
        for (let i = 0; i < 26; i++) {
          const a = -Math.PI / 2 + ((i % 13) - 6) * 0.09;
          const d = 10 + ((i * 13) % 70);
          g.fillStyle = i % 3 ? 'rgba(255,236,180,0.9)' : '#ffffff';
          g.beginPath();
          g.arc(x + Math.cos(a) * d * 0.4, 96 + Math.sin(a) * d, 0.8 + (i % 4) * 0.3, 0, TAU);
          g.fill();
        }
        glowUnder(g, x, 96, 14, 'rgba(255,220,140,0.8)');
      }
      break;
    case 'fx-disco': {
      const colors = ['rgba(255,61,110,0.45)', 'rgba(61,220,255,0.45)', 'rgba(179,107,255,0.45)', 'rgba(255,210,61,0.45)'];
      colors.forEach((c, i) => {
        g.fillStyle = c;
        const a = 0.5 + i * 0.6;
        poly(g, [[100, 34], [100 + Math.cos(a) * 140, 34 + Math.sin(a) * 140], [100 + Math.cos(a + 0.16) * 140, 34 + Math.sin(a + 0.16) * 140]]);
        g.fill();
      });
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(100, 0);
      g.lineTo(100, 14);
      g.stroke();
      const gr = g.createRadialGradient(94, 28, 2, 100, 34, 20);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(1, '#5d6470');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(100, 34, 20, 0, TAU);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(100, 34, 20, 0, TAU);
      g.clip();
      g.strokeStyle = 'rgba(20,24,30,0.55)';
      g.lineWidth = 0.6;
      for (let k = -20; k <= 20; k += 4) {
        g.beginPath();
        g.moveTo(80, 34 + k);
        g.lineTo(120, 34 + k);
        g.moveTo(100 + k, 14);
        g.lineTo(100 + k, 54);
        g.stroke();
      }
      g.restore();
      glint(g, 92, 26, 5);
      glint(g, 108, 42, 3.5, 0.8);
      break;
    }
    case 'fx-marquee': {
      // the LED sign over the pit, bulbs round it, your name in amber dots
      g.fillStyle = '#16120c';
      rrect(g, 22, 22, 156, 56, 6);
      g.fill();
      for (let i = 0; i < 24; i++) {
        const t = i / 24;
        const [x, y] = t < 0.5 ? [26 + t * 2 * 148, i % 2 ? 26 : 74] : [26 + (t - 0.5) * 2 * 148, i % 2 ? 74 : 26];
        g.fillStyle = '#ffd28a';
        g.beginPath();
        g.arc(x, y, 1.6, 0, TAU);
        g.fill();
      }
      ledWord(g, 'YOU', 100, 50, 3.6);
      break;
    }
    case 'fx-goldenhour': {
      const sky = g.createLinearGradient(0, 0, 0, 100);
      sky.addColorStop(0, '#3a1d08');
      sky.addColorStop(1, '#b4661c');
      g.fillStyle = sky;
      g.fillRect(0, 0, 200, 100);
      const sun = g.createRadialGradient(100, 92, 4, 100, 92, 60);
      sun.addColorStop(0, 'rgba(255,236,170,1)');
      sun.addColorStop(0.3, 'rgba(255,190,80,0.7)');
      sun.addColorStop(1, 'rgba(255,150,40,0)');
      g.fillStyle = sun;
      g.fillRect(0, 0, 200, 100);
      for (let i = 0; i < 18; i++) coin(g, 24 + ((i * 53) % 152), 8 + ((i * 37) % 76), 4.5, ((i * 0.9) % 2) - 1);
      break;
    }
    case 'fx-takeover': {
      // fireworks over the skyline, every sign gold
      const burst = (x: number, y: number, r: number, c: string) => {
        g.strokeStyle = c;
        g.lineWidth = 1.2;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          g.beginPath();
          g.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35);
          g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          g.stroke();
        }
        glint(g, x, y, r * 0.45, 0.9);
      };
      burst(56, 28, 20, '#ffd25e');
      burst(140, 22, 16, '#ff6b5e');
      burst(104, 40, 13, '#fff2d2');
      g.fillStyle = '#07070a';
      poly(g, [[4, 100], [4, 78], [24, 78], [24, 66], [40, 66], [40, 82], [58, 82], [58, 60], [72, 60], [72, 84], [96, 84], [96, 70], [112, 70], [112, 56], [124, 56], [124, 80], [146, 80], [146, 68], [164, 68], [164, 84], [196, 84], [196, 100]]);
      g.fill();
      g.fillStyle = '#f3c965';
      for (let i = 0; i < 26; i++) g.fillRect(8 + ((i * 41) % 184), 62 + ((i * 23) % 30), 2, 2);
      break;
    }
  }
  g.restore();
}

const LED: Record<string, string[]> = {
  Y: ['10001', '01010', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  U: ['10001', '10001', '10001', '10001', '01110'],
};

function ledWord(g: G, word: string, cx: number, cy: number, dot: number): void {
  const w = word.length * 6 - 1;
  const x0 = cx - (w * dot) / 2;
  const y0 = cy - (5 * dot) / 2;
  [...word].forEach((ch, k) => {
    const rows = LED[ch] ?? [];
    rows.forEach((row, ry) => {
      [...row].forEach((on, rx) => {
        g.fillStyle = on === '1' ? '#ffb347' : 'rgba(255,179,71,0.12)';
        g.beginPath();
        g.arc(x0 + (k * 6 + rx) * dot + dot / 2, y0 + ry * dot + dot / 2, dot * 0.38, 0, TAU);
        g.fill();
      });
    });
  });
}

/** You, in gold, on the lobby's plinth. */
function statue(g: G): void {
  floorShadow(g, 100, 96, 46, 4, 0.3);
  g.fillStyle = '#111013';
  rrect(g, 70, 80, 60, 16, 2);
  g.fill();
  g.fillStyle = sheen(g, 'gold', 70, 78, 130, 82);
  g.fillRect(70, 79, 60, 2.4);
  g.fillStyle = sheen(g, 'gold', 92, 86, 108, 90);
  g.fillRect(92, 86, 16, 4);
  const pose: Pose = { head: [100, 12], r: 6.5, spine: [[100, 21], [100, 50]], arms: [[[100, 21], [88, 34], [96, 46]], [[100, 21], [112, 34], [110, 48]]], legs: [[[100, 50], [95, 66], [94, 80]], [[100, 50], [106, 66], [107, 80]]] };
  figure(g, pose, 'gold', 7);
  glint(g, 92, 16, 4.5);
}

// ---------------------------------------------------------------------------------------------

/** What draws a piece, by its id. */
function paint(g: G, id: string): void {
  if (id === 'statue') return statue(g);
  if (id.startsWith('fx-')) return effect(g, id);
  if (POSES[id]) return emote(g, id);
  if (CLOTHES[id]) return garment(g, id);
  if (/watch/.test(id)) return watch(g, id);
  if (/shades|aviators/.test(id)) return shades(g, id);
  if (/hat|crown|fedora/.test(id)) return hat(g, id);
  if (['gold-top-six', 'full-gold', 'rose-gold', 'diamond-set'].includes(id)) return grill(g, id);
  if (['skateboard', 'e-scooter', 'hoverboard', 'segway', 'hover-throne', 'golden-board'].includes(id)) return ride(g, id);
  return chain(g, id);
}

/** The device pixel ratio pictures are drawn at (1 to 2: more costs memory and shows nothing). */
function ratio(): number {
  return Math.min(2, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
}

/**
 * A piece's picture: a canvas `w` x `h` CSS pixels (its CSS size comes from `cls`), the design box
 * scaled to fit and centred. Drawn now; the boutique keeps its cards, so each is drawn once.
 */
export function itemPicture(id: string, w = 200, h = 100, cls = 'bq-art'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = cls;
  c.setAttribute('aria-hidden', 'true');
  drawItem(c, id, w, h);
  return c;
}

/** Draw a piece into a canvas you have (the confirm and the detail reuse theirs). */
export function drawItem(c: HTMLCanvasElement, id: string, w = 200, h = 100): void {
  const k = ratio();
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  const s = Math.min(w / 200, h / 100) * k;
  g.setTransform(s, 0, 0, s, (c.width - 200 * s) / 2, (c.height - 100 * s) / 2);
  paint(g, id);
}
