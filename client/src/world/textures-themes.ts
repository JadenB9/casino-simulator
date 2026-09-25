// The north wing's surfaces, drawn on canvases from a seed so they tile and look the same every
// visit: the pachinko parlour's indigo wave-pattern walls and its drinks machines' window of cans,
// the bingo hall's loud carpet, its wood-slat walls and drop-ceiling tiles, the Jade Room's moon
// gate painting, and the hall's pattern boards.

/** Small, fast, seeded PRNG (mulberry32). */
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

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, rand: () => number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 1 - amount / 2 + rand() * amount;
    d[i] = Math.min(255, d[i]! * n);
    d[i + 1] = Math.min(255, d[i + 1]! * n);
    d[i + 2] = Math.min(255, d[i + 2]! * n);
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * The parlour's walls: seigaiha, overlapping fans of concentric arcs, in pale gold and sky blue on
 * indigo. Rows are offset by half a fan, and the tile holds whole periods so it repeats cleanly.
 */
export function drawSeigaiha(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = '#161a3e';
  ctx.fillRect(0, 0, size, size);
  const cols = 4;
  const R = size / cols / 2;
  const rows = Math.round(size / (R / 2));
  const dy = size / rows;
  // bottom rows first: each row of fans covers the lower halves of the one above
  for (let j = -1; j <= rows + 1; j++) {
    const y = j * dy;
    const off = (j & 1) * R;
    for (let i = -1; i <= cols; i++) {
      const x = i * 2 * R + off;
      for (let k = 5; k >= 0; k--) {
        const r = (R * (k + 1)) / 6;
        ctx.beginPath();
        ctx.arc(x, y, r, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = k === 5 ? '#161a3e' : k % 2 ? '#1c2150' : '#161a3e';
        ctx.fill();
        ctx.lineWidth = Math.max(1, size / 420);
        ctx.strokeStyle = k === 5 ? '#c9a45a' : k === 2 ? 'rgba(120,170,230,0.55)' : 'rgba(201,164,90,0.45)';
        ctx.beginPath();
        ctx.arc(x, y, r, Math.PI, 0);
        ctx.stroke();
      }
    }
  }
  grain(ctx, size, size, 0.08, rand);
  return c;
}

/** A drinks machine's window: four shelves of cans and bottles in their colours, a price under each. */
export function drawVendingFace(w: number, h: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const rand = rng(seed);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f4f7fb');
  g.addColorStop(1, '#d8e2ee');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const colours = ['#d8262e', '#1f5fd0', '#f2b320', '#1c9a5a', '#e8e8e8', '#6a2c90', '#f07a1a', '#101014'];
  const shelves = 4;
  const per = 7;
  const sh = h / shelves;
  const cw = w / per;
  for (let j = 0; j < shelves; j++) {
    for (let i = 0; i < per; i++) {
      const col = colours[Math.floor(rand() * colours.length)]!;
      const x = i * cw + cw * 0.18;
      const bottle = rand() < 0.3;
      const top = j * sh + sh * (bottle ? 0.12 : 0.24);
      const bw = cw * 0.64;
      // the can (or a bottle's shoulders), a band of white across it, a highlight down one side
      ctx.fillStyle = col;
      ctx.fillRect(x, top, bw, j * sh + sh * 0.72 - top);
      if (bottle) {
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(x + bw * 0.3, top - sh * 0.06, bw * 0.4, sh * 0.08);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(x, top + (j * sh + sh * 0.72 - top) * 0.45, bw, sh * 0.07);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x + bw * 0.12, top + 2, bw * 0.1, j * sh + sh * 0.7 - top);
      // the price tag and its button
      ctx.fillStyle = '#101418';
      ctx.fillRect(i * cw + cw * 0.12, j * sh + sh * 0.78, cw * 0.76, sh * 0.12);
      ctx.fillStyle = '#58f08a';
      ctx.font = `600 ${Math.round(sh * 0.09)}px "Barlow Condensed", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(100 + Math.floor(rand() * 5) * 10), i * cw + cw / 2, j * sh + sh * 0.84);
    }
    ctx.fillStyle = '#9aa6b4';
    ctx.fillRect(0, j * sh + sh * 0.93, w, sh * 0.04);
  }
  return c;
}

/** The bingo hall's carpet: a navy ground thick with confetti, rings, squiggles and stars in bright colours. */
export function drawBingoCarpet(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = '#16183a';
  ctx.fillRect(0, 0, size, size);
  const colours = ['#178a86', '#c0522a', '#962e72', '#c89a28', '#5446a8', '#2a7a3a'];
  const s = size / 1024;
  // every shape is drawn at its spot and again across any edge it crosses, so the tile repeats
  const wrap = (x: number, y: number, r: number, fn: (x: number, y: number) => void) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) if (x + ox > -r && x + ox < size + r && y + oy > -r && y + oy < size + r) fn(x + ox, y + oy);
  };
  for (let i = 0; i < 520; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const col = colours[Math.floor(rand() * colours.length)]!;
    const kind = rand();
    const r = (9 + rand() * 15) * s;
    const rot = rand() * Math.PI * 2;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 4.5 * s;
    ctx.lineCap = 'round';
    wrap(x, y, r * 2, (px, py) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      if (kind < 0.3) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind < 0.55) {
        // a squiggle
        ctx.beginPath();
        ctx.moveTo(-r * 1.4, 0);
        for (let k = 0; k <= 4; k++) ctx.quadraticCurveTo(-r * 1.4 + (k + 0.5) * r * 0.7, (k % 2 ? 1 : -1) * r * 0.6, -r * 1.4 + (k + 1) * r * 0.7, 0);
        ctx.stroke();
      } else if (kind < 0.75) {
        // a star
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const rr = k % 2 ? r * 0.42 : r;
          ctx.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        // a dash and a dot
        ctx.fillRect(-r, -r * 0.18, r * 1.3, r * 0.36);
        ctx.beginPath();
        ctx.arc(r * 0.8, 0, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }
  grain(ctx, size, size, 0.14, rand);
  return c;
}

/** The bingo hall's walls: warm wood slats with dark grooves between them. */
export function drawSlats(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  const n = 12;
  const sw = size / n;
  for (let i = 0; i < n; i++) {
    const v = rand() * 18;
    ctx.fillStyle = `rgb(${128 + v},${82 + v * 0.6},${48 + v * 0.3})`;
    ctx.fillRect(i * sw, 0, sw, size);
    // the grain along each slat
    for (let k = 0; k < 10; k++) {
      ctx.strokeStyle = `rgba(60,30,12,${0.08 + rand() * 0.1})`;
      ctx.lineWidth = Math.max(1, size / 512);
      const x = i * sw + rand() * sw;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (rand() - 0.5) * sw * 0.3, size / 3, x + (rand() - 0.5) * sw * 0.3, (2 * size) / 3, x, size);
      ctx.stroke();
    }
    ctx.fillStyle = '#2a160c';
    ctx.fillRect(i * sw, 0, Math.max(2, sw * 0.08), size);
  }
  grain(ctx, size, size, 0.08, rand);
  return c;
}

/** Drop-ceiling tiles: pale, pitted, a grey grid between them (one tile per repeat). */
export function drawCeilingTile(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = '#d8d2c6';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 3; i++) {
    ctx.fillStyle = `rgba(90,80,70,${0.1 + rand() * 0.2})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.strokeStyle = '#8c8880';
  ctx.lineWidth = size * 0.03;
  ctx.strokeRect(0, 0, size, size);
  return c;
}

/**
 * The moon gate's painting: mountains in ink washes over gold leaf, a pine on a rock, mist between
 * the ridges and a red seal in a corner. Drawn square; the gate shows the circle inside it.
 */
export function drawLandscape(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#e8cf8a');
  g.addColorStop(1, '#c49a4e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // gold leaf squares, laid slightly out of true
  const leaf = size / 8;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      ctx.fillStyle = `rgba(255,236,170,${rand() * 0.14})`;
      ctx.fillRect(i * leaf, j * leaf, leaf, leaf);
      ctx.strokeStyle = 'rgba(140,100,40,0.18)';
      ctx.strokeRect(i * leaf + 0.5, j * leaf + 0.5, leaf, leaf);
    }
  }
  // three ranges of mountains, farthest palest
  const ranges = [
    { base: 0.62, height: 0.34, ink: 'rgba(60,70,70,0.35)' },
    { base: 0.74, height: 0.3, ink: 'rgba(40,48,46,0.55)' },
    { base: 0.9, height: 0.26, ink: 'rgba(22,26,24,0.8)' },
  ];
  for (const r of ranges) {
    ctx.fillStyle = r.ink;
    ctx.beginPath();
    ctx.moveTo(0, size);
    let x = 0;
    ctx.lineTo(0, size * r.base);
    while (x < size) {
      const w = size * (0.08 + rand() * 0.14);
      const peak = size * (r.base - r.height * (0.4 + rand() * 0.6));
      ctx.quadraticCurveTo(x + w * 0.5, peak, x + w, size * (r.base - rand() * 0.05));
      x += w;
    }
    ctx.lineTo(size, size);
    ctx.closePath();
    ctx.fill();
    // mist lying in front of the range
    const mist = ctx.createLinearGradient(0, size * (r.base - 0.04), 0, size * (r.base + 0.06));
    mist.addColorStop(0, 'rgba(240,222,170,0)');
    mist.addColorStop(0.5, 'rgba(240,222,170,0.55)');
    mist.addColorStop(1, 'rgba(240,222,170,0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, size * (r.base - 0.04), size, size * 0.1);
  }
  // a pine leaning out from a rock on the left
  ctx.strokeStyle = '#1a1512';
  ctx.lineWidth = size * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.86);
  ctx.bezierCurveTo(size * 0.24, size * 0.7, size * 0.3, size * 0.58, size * 0.42, size * 0.5);
  ctx.stroke();
  ctx.fillStyle = 'rgba(24,40,30,0.85)';
  for (const [px, py, pr] of [
    [0.3, 0.6, 0.07],
    [0.38, 0.52, 0.08],
    [0.46, 0.47, 0.06],
    [0.25, 0.7, 0.05],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(size * px, size * py, size * pr * 1.6, size * pr * 0.55, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // the sun, and the red seal
  ctx.fillStyle = 'rgba(190,40,30,0.8)';
  ctx.beginPath();
  ctx.arc(size * 0.7, size * 0.26, size * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a8231c';
  ctx.fillRect(size * 0.8, size * 0.8, size * 0.07, size * 0.07);
  ctx.strokeStyle = '#f0d8a0';
  ctx.lineWidth = size * 0.006;
  ctx.strokeRect(size * 0.81, size * 0.81, size * 0.05, size * 0.05);
  grain(ctx, size, size, 0.06, rand);
  return c;
}

/** The winning patterns, as the hall's boards show them: which of the 25 squares light. */
export const BOARD_PATTERNS: { name: string; cells: (r: number, c: number) => boolean }[] = [
  { name: 'LINE', cells: (r) => r === 2 },
  { name: 'FOUR CORNERS', cells: (r, c) => (r === 0 || r === 4) && (c === 0 || c === 4) },
  { name: 'BLACKOUT', cells: () => true },
];

/**
 * The bingo hall's pattern boards, side by side in one canvas (a board a third of its width): a
 * black face, BINGO across the top, the 5 x 5 grid with the pattern's squares lit and the free
 * middle starred, the pattern's name under it.
 */
export function drawPatternBoards(bw: number, bh: number): HTMLCanvasElement {
  const n = BOARD_PATTERNS.length;
  const [c, ctx] = canvas(bw * n, bh);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  BOARD_PATTERNS.forEach((p, k) => {
    const x0 = k * bw;
    ctx.fillStyle = '#0c0b10';
    ctx.fillRect(x0, 0, bw, bh);
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = bw * 0.02;
    ctx.strokeRect(x0 + bw * 0.03, bh * 0.025, bw * 0.94, bh * 0.95);
    const cell = (bw * 0.8) / 5;
    const gx = x0 + bw * 0.1;
    const gy = bh * 0.2;
    ctx.font = `700 ${Math.round(cell * 0.62)}px "Barlow Condensed", sans-serif`;
    'BINGO'.split('').forEach((ch, i) => {
      ctx.fillStyle = ['#3aa0ff', '#ff4a4a', '#f2f2f2', '#3ad06a', '#ffcf3a'][i]!;
      ctx.fillText(ch, gx + (i + 0.5) * cell, bh * 0.12);
    });
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 5; col++) {
        const on = p.cells(r, col);
        const cx = gx + (col + 0.5) * cell;
        const cy = gy + (r + 0.5) * cell;
        ctx.fillStyle = on ? '#ffb43a' : '#2a2630';
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.36, 0, Math.PI * 2);
        ctx.fill();
        if (on) {
          ctx.fillStyle = '#fff2c8';
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
        if (r === 2 && col === 2) {
          ctx.fillStyle = on ? '#6a2a00' : '#c9a24a';
          ctx.font = `700 ${Math.round(cell * 0.3)}px "Barlow Condensed", sans-serif`;
          ctx.fillText('FREE', cx, cy);
        }
      }
    }
    ctx.fillStyle = '#ffe2a0';
    ctx.font = `700 ${Math.round(bh * 0.07)}px "Barlow Condensed", sans-serif`;
    ctx.fillText(p.name, x0 + bw / 2, bh * 0.9);
  });
  return c;
}
