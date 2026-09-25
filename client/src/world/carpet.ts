// Casino carpet, drawn on a canvas from a seed: a jewel-tone ground, a half-drop lattice of large
// medallions with scrolling arms, lozenges between them and a scatter of confetti shapes. The
// pattern is original (no real casino's carpet is copied) and tiles seamlessly: anything that
// crosses an edge is drawn again on the opposite side.

import * as THREE from 'three';

export interface CarpetPalette {
  ground: string;
  groundDark: string;
  groundLight: string;
  gold: string;
  goldDark: string;
  accent: string;
  accentDark: string;
  spark: string;
  cream: string;
}

export const PALETTES = {
  /** Main gaming floor: burgundy with gold and teal. */
  floor: {
    ground: '#3f0e18',
    groundDark: '#2a0810',
    groundLight: '#521522',
    gold: '#c99a3f',
    goldDark: '#8a6526',
    accent: '#1f6f6a',
    accentDark: '#11403f',
    spark: '#b9463c',
    cream: '#e3cc98',
  },
  /** The poker room: navy with gold and burgundy. */
  poker: {
    ground: '#121a33',
    groundDark: '#0a1024',
    groundLight: '#1a2544',
    gold: '#c4983e',
    goldDark: '#7d5c24',
    accent: '#6b1a2a',
    accentDark: '#3f0e18',
    spark: '#2f7f79',
    cream: '#dcc796',
  },
  /** The slots hall: deep plum with gold and a teal accent. */
  slots: {
    ground: '#2a0f2e',
    groundDark: '#1a0820',
    groundLight: '#37143c',
    gold: '#c9973c',
    goldDark: '#86602a',
    accent: '#1c6a74',
    accentDark: '#0f3c44',
    spark: '#c0406e',
    cream: '#e6cf9c',
  },
  /** The high limit salon: emerald with gold. */
  salon: {
    ground: '#0d2a1e',
    groundDark: '#071a12',
    groundLight: '#123828',
    gold: '#d0a54a',
    goldDark: '#8a6a2c',
    accent: '#3a0f1a',
    accentDark: '#240810',
    spark: '#e0c27a',
    cream: '#efe0b4',
  },
  /** The lounge: tobacco brown with amber and rust. */
  lounge: {
    ground: '#2e1a10',
    groundDark: '#1e100a',
    groundLight: '#3a2214',
    gold: '#c08a40',
    goldDark: '#7c5426',
    accent: '#6e2a18',
    accentDark: '#43180e',
    spark: '#d4a050',
    cream: '#e2c898',
  },
  /** The pachinko parlour: lacquer red on near-black, gold and a sakura pink. */
  parlour: {
    ground: '#3a0a10',
    groundDark: '#22060a',
    groundLight: '#4a0e16',
    gold: '#d6a94a',
    goldDark: '#8e6a28',
    accent: '#171a3c',
    accentDark: '#0c0e24',
    spark: '#f07ab0',
    cream: '#f2dcae',
  },
  /** The Jade Room: deep jade with gold, a lacquer-red accent. */
  jade: {
    ground: '#0b3a30',
    groundDark: '#062520',
    groundLight: '#0f4a3c',
    gold: '#d4aa50',
    goldDark: '#8c6a2a',
    accent: '#7a1418',
    accentDark: '#4a0a0e',
    spark: '#e6c46e',
    cream: '#f0e0b0',
  },
} satisfies Record<string, CarpetPalette>;

/** Small, fast, seeded PRNG (mulberry32): the same carpet on every visit. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

/** Draw `fn` at (x, y) and again wherever the shape (radius r) wraps across the tile edge. */
function wrapped(ctx: Ctx, size: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      ctx.save();
      fn(px, py);
      ctx.restore();
    }
  }
}

function petal(ctx: Ctx, len: number, wid: number): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid, len * 0.3, wid * 0.8, len * 0.8, 0, len);
  ctx.bezierCurveTo(-wid * 0.8, len * 0.8, -wid, len * 0.3, 0, 0);
  ctx.closePath();
}

function star(ctx: Ctx, points: number, outer: number, inner: number, rot = 0): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

/** The big medallion: petals, an eight-point star, a rosette and four scrolling arms. */
function medallion(ctx: Ctx, p: CarpetPalette, x: number, y: number, R: number, spin: number): void {
  ctx.translate(x, y);
  ctx.rotate(spin);
  // scrolling arms on the diagonals, drawn first so the petals sit on top
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate(Math.PI / 4 + (i * Math.PI) / 2);
    ctx.strokeStyle = p.gold;
    ctx.lineWidth = R * 0.07;
    ctx.beginPath();
    ctx.moveTo(0, R * 0.55);
    ctx.bezierCurveTo(R * 0.35, R * 0.9, -R * 0.25, R * 1.25, R * 0.12, R * 1.45);
    ctx.stroke();
    ctx.lineWidth = R * 0.035;
    ctx.beginPath();
    ctx.arc(R * 0.2, R * 1.38, R * 0.13, Math.PI * 0.9, Math.PI * 2.6);
    ctx.stroke();
    // leaves along the arm
    ctx.fillStyle = p.accent;
    for (const [lx, ly, a] of [
      [R * 0.18, R * 0.8, 0.9],
      [-R * 0.05, R * 1.08, -0.9],
    ] as const) {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(a);
      petal(ctx, R * 0.26, R * 0.09);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  // outer ring of petals
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    petal(ctx, R * 0.78, R * 0.24);
    ctx.fillStyle = p.accentDark;
    ctx.fill();
    ctx.lineWidth = R * 0.04;
    ctx.strokeStyle = p.gold;
    ctx.stroke();
    ctx.scale(0.62, 0.62);
    petal(ctx, R * 0.78, R * 0.2);
    ctx.fillStyle = p.accent;
    ctx.fill();
    ctx.restore();
  }
  // star, disc and rosette
  star(ctx, 8, R * 0.46, R * 0.3, Math.PI / 8);
  ctx.fillStyle = p.gold;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = p.groundDark;
  ctx.fill();
  ctx.lineWidth = R * 0.025;
  ctx.strokeStyle = p.goldDark;
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 3);
    petal(ctx, R * 0.22, R * 0.08);
    ctx.fillStyle = p.spark;
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = p.cream;
  ctx.fill();
}

/** A lozenge between medallions. */
function lozenge(ctx: Ctx, p: CarpetPalette, x: number, y: number, R: number, rot: number): void {
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -R);
  ctx.lineTo(R * 0.55, 0);
  ctx.lineTo(0, R);
  ctx.lineTo(-R * 0.55, 0);
  ctx.closePath();
  ctx.fillStyle = p.accentDark;
  ctx.fill();
  ctx.lineWidth = R * 0.08;
  ctx.strokeStyle = p.gold;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.55);
  ctx.lineTo(R * 0.3, 0);
  ctx.lineTo(0, R * 0.55);
  ctx.lineTo(-R * 0.3, 0);
  ctx.closePath();
  ctx.fillStyle = p.spark;
  ctx.fill();
  for (const [dx, dy] of [
    [0, -1.35],
    [0, 1.35],
    [0.85, 0],
    [-0.85, 0],
  ] as const) {
    ctx.beginPath();
    ctx.arc(dx * R, dy * R, R * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = p.gold;
    ctx.fill();
  }
}

/** Draw one carpet tile. `size` is in pixels; the caller decides how many metres it covers. */
export function drawCarpet(size: number, p: CarpetPalette, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rand = rng(seed);
  const s = size / 1024;

  // ground with a soft mottle, like pile catching the light differently
  ctx.fillStyle = p.ground;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = (8 + rand() * 40) * s;
    ctx.globalAlpha = 0.05 + rand() * 0.06;
    ctx.fillStyle = rand() < 0.5 ? p.groundDark : p.groundLight;
    wrapped(ctx, size, x, y, r, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;

  // a trellis of fine wavy lines joining the medallions (diagonals of the half-drop lattice)
  ctx.strokeStyle = p.goldDark;
  ctx.lineWidth = 3 * s;
  ctx.globalAlpha = 0.75;
  for (const dir of [1, -1]) {
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      for (let t = -0.1; t <= 1.1; t += 0.01) {
        const bx = t * size;
        const by = dir > 0 ? t * size + (k * size) / 2 : (1 - t) * size + (k * size) / 2;
        const w = Math.sin(t * Math.PI * 8) * 10 * s;
        ctx.lineTo(bx + w, by - w);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // medallions on a half-drop lattice: centre, corners (one medallion shared by four tiles)
  const R = 0.2 * size;
  const med: [number, number][] = [
    [size / 2, size / 2],
    [0, 0],
  ];
  for (const [x, y] of med) wrapped(ctx, size, x, y, R * 1.6, (px, py) => medallion(ctx, p, px, py, R, 0));

  // lozenges halfway between medallions
  const loz: [number, number, number][] = [
    [size / 2, 0, 0],
    [0, size / 2, 0],
    [size / 4, size / 4, Math.PI / 4],
    [(3 * size) / 4, (3 * size) / 4, Math.PI / 4],
    [(3 * size) / 4, size / 4, -Math.PI / 4],
    [size / 4, (3 * size) / 4, -Math.PI / 4],
  ];
  for (const [x, y, rot] of loz) {
    const r = (x % (size / 2) === 0 && y % (size / 2) === 0 ? 0.07 : 0.045) * size;
    wrapped(ctx, size, x, y, r * 1.5, (px, py) => lozenge(ctx, p, px, py, r, rot));
  }

  // confetti: little stars, dots and crescents, kept off the medallion hearts
  const clear = (x: number, y: number) => {
    for (const [mx, my] of [...med, [size, size], [size, 0], [0, size]] as [number, number][]) {
      const dx = x - mx;
      const dy = y - my;
      if (dx * dx + dy * dy < (R * 1.05) ** 2) return false;
    }
    return true;
  };
  const colors = [p.gold, p.gold, p.accent, p.spark, p.cream];
  let placed = 0;
  for (let tries = 0; placed < 260 && tries < 4000; tries++) {
    const x = rand() * size;
    const y = rand() * size;
    if (!clear(x, y)) continue;
    placed++;
    const kind = rand();
    const col = colors[Math.floor(rand() * colors.length)]!;
    const r = (5 + rand() * 9) * s;
    const rot = rand() * Math.PI;
    wrapped(ctx, size, x, y, r * 2, (px, py) => {
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.fillStyle = col;
      if (kind < 0.4) {
        star(ctx, 4, r * 1.3, r * 0.4);
        ctx.fill();
      } else if (kind < 0.75) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0.3, Math.PI - 0.3);
        ctx.arc(0, -r * 0.35, r * 0.8, Math.PI - 0.5, 0.5, true);
        ctx.fill();
      }
    });
  }

  // fine fibre noise over everything so the flat fills read as woven pile up close
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 0.9 + rand() * 0.14;
    d[i] = d[i]! * n;
    d[i + 1] = d[i + 1]! * n;
    d[i + 2] = d[i + 2]! * n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** The calmer aisle carpet: dark umber with a small bronze diamond grid. */
export function drawAisle(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rand = rng(seed);
  const s = size / 512;
  ctx.fillStyle = '#1e1311';
  ctx.fillRect(0, 0, size, size);
  const step = size / 8;
  ctx.strokeStyle = '#5a3d25';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2 * s;
  for (let k = -8; k <= 16; k++) {
    ctx.beginPath();
    ctx.moveTo(k * step, 0);
    ctx.lineTo(k * step + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(k * step, size);
    ctx.lineTo(k * step + size, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const x = (i + 0.5) * step;
      const y = (j + 0.5) * step;
      ctx.fillStyle = (i + j) % 2 ? '#7a5530' : '#3a2419';
      ctx.beginPath();
      ctx.moveTo(x, y - 7 * s);
      ctx.lineTo(x + 7 * s, y);
      ctx.lineTo(x, y + 7 * s);
      ctx.lineTo(x - 7 * s, y);
      ctx.fill();
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 0.88 + rand() * 0.18;
    d[i] = d[i]! * n;
    d[i + 1] = d[i + 1]! * n;
    d[i + 2] = d[i + 2]! * n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function canvasTexture(c: HTMLCanvasElement, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
