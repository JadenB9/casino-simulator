// The new rooms' surfaces, drawn on canvases from a seed so they tile and look the same every
// visit: the online lounge's carpet tiles and acoustic wall, the yard's concrete, rusted
// corrugated sheet and raw planks, the bar's plank floor and the boutique's pale panelled wall.

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

/** Multiply every pixel by a little noise (pile, grain, grit). */
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

/** Dark carpet tiles, laid quarter-turned, each with a faint stripe and a fleck of colour. */
export function drawTiles(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  const n = 4;
  const t = size / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const shade = 22 + Math.floor(rand() * 7);
      ctx.fillStyle = `rgb(${shade},${shade + 1},${shade + 5})`;
      ctx.fillRect(i * t, j * t, t, t);
      // the tile's pile runs one way, the next tile's the other
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = Math.max(1, t / 64);
      const across = (i + j) % 2 === 0;
      for (let k = 0; k < 24; k++) {
        const o = (k + 0.5) * (t / 24);
        ctx.beginPath();
        if (across) {
          ctx.moveTo(i * t, j * t + o);
          ctx.lineTo((i + 1) * t, j * t + o);
        } else {
          ctx.moveTo(i * t + o, j * t);
          ctx.lineTo(i * t + o, (j + 1) * t);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = Math.max(1, t / 90);
      ctx.strokeRect(i * t + 0.5, j * t + 0.5, t - 1, t - 1);
    }
  }
  // flecks of the lounge's neon colours in the pile
  const flecks = ['#1fe07e', '#35a8ff', '#ff3d7f', '#b46bff'];
  for (let k = 0; k < size * 0.9; k++) {
    ctx.fillStyle = flecks[Math.floor(rand() * flecks.length)]!;
    ctx.globalAlpha = 0.18 + rand() * 0.2;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * (size / 512), 1 + rand() * (size / 512));
  }
  ctx.globalAlpha = 1;
  grain(ctx, size, size, 0.12, rand);
  return c;
}

/** Polished concrete: grey mottle, a few hairline cracks and oil stains, a saw-cut joint grid. */
export function drawConcrete(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = '#5b5752';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const r = (6 + rand() * 60) * (size / 512);
    ctx.globalAlpha = 0.04 + rand() * 0.06;
    ctx.fillStyle = rand() < 0.5 ? '#3f3b37' : '#77716a';
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // oil and rust stains
  for (let i = 0; i < 7; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = (20 + rand() * 70) * (size / 512);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() < 0.5 ? 'rgba(30,24,18,0.55)' : 'rgba(96,52,24,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // hairline cracks
  ctx.strokeStyle = 'rgba(20,18,16,0.5)';
  ctx.lineWidth = Math.max(1, size / 700);
  for (let i = 0; i < 5; i++) {
    let x = rand() * size;
    let y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 12; k++) {
      x += (rand() - 0.5) * size * 0.08;
      y += (rand() - 0.3) * size * 0.06;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // the joints, at the tile's edges so they line up across repeats
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#2a2724';
  ctx.lineWidth = Math.max(2, size / 256);
  ctx.strokeRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  grain(ctx, size, size, 0.16, rand);
  return c;
}

/** Corrugated sheet steel gone to rust: vertical ribs, streaks running down, patches of old paint. */
export function drawCorrugated(w: number, h: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const rand = rng(seed);
  const ribs = 16;
  for (let x = 0; x < w; x++) {
    // a rib's light and shade across it
    const k = Math.cos(((x / w) * ribs) * Math.PI * 2);
    const v = 96 + k * 34;
    ctx.fillStyle = `rgb(${v + 30},${v * 0.62 + 10},${v * 0.42})`;
    ctx.fillRect(x, 0, 1, h);
  }
  // old grey paint holding on in patches
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.25 + rand() * 0.35;
    ctx.fillStyle = rand() < 0.5 ? '#6f7478' : '#56606a';
    const pw = (20 + rand() * 120) * (w / 512);
    const ph = (20 + rand() * 160) * (h / 512);
    ctx.fillRect(rand() * w, rand() * h, pw, ph);
  }
  // rust running down from the laps and bolts
  for (let i = 0; i < 90; i++) {
    const x = rand() * w;
    const y = rand() * h * 0.6;
    const len = (40 + rand() * 260) * (h / 512);
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, 'rgba(110,44,14,0.55)');
    g.addColorStop(1, 'rgba(110,44,14,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(x, y, (2 + rand() * 6) * (w / 512), len);
  }
  // a lap and a row of bolts at the top and bottom
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, w, h * 0.02);
  ctx.fillRect(0, h * 0.98, w, h * 0.02);
  for (let x = w / ribs / 2; x < w; x += w / ribs) {
    for (const y of [h * 0.04, h * 0.96]) {
      ctx.fillStyle = '#3a2a20';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, w / 180), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  grain(ctx, w, h, 0.22, rand);
  return c;
}

/** Planks: a floor of long boards (the bar's), or rough-sawn boards (the yard's pallets and benches). */
export function drawPlanks(size: number, seed: number, rough: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  const rows = rough ? 5 : 8;
  const bh = size / rows;
  for (let r = 0; r < rows; r++) {
    // each row of boards, broken at staggered joints
    let x = -rand() * size * 0.5;
    while (x < size) {
      const len = size * (rough ? 0.5 + rand() * 0.5 : 0.35 + rand() * 0.4);
      const base = rough ? [120, 92, 62] : [70, 38, 22];
      const k = 0.78 + rand() * 0.35;
      ctx.fillStyle = `rgb(${base[0]! * k},${base[1]! * k},${base[2]! * k})`;
      ctx.fillRect(x, r * bh, len, bh);
      // grain: long thin streaks along the board
      for (let g = 0; g < 14; g++) {
        ctx.strokeStyle = `rgba(${rough ? '40,26,14' : '20,10,4'},${0.15 + rand() * 0.2})`;
        ctx.lineWidth = Math.max(1, size / 700);
        const y = r * bh + rand() * bh;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * bh * 0.3, x + len * 0.6, y + (rand() - 0.5) * bh * 0.3, x + len, y);
        ctx.stroke();
      }
      // the joint
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + len - 1, r * bh, Math.max(1, size / 512), bh);
      x += len;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, r * bh, size, Math.max(1, size / 400));
  }
  if (rough) {
    // nail heads at the board ends
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = '#2a2622';
      ctx.fillRect(rand() * size, rand() * size, size / 200, size / 200);
    }
  }
  grain(ctx, size, size, rough ? 0.2 : 0.1, rand);
  return c;
}

/** The online lounge's walls: charcoal acoustic panels of vertical slats over black felt. */
export function drawAcoustic(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  ctx.fillStyle = '#0b0b0e';
  ctx.fillRect(0, 0, size, size);
  const slats = 16;
  const sw = size / slats;
  for (let i = 0; i < slats; i++) {
    const v = 30 + Math.floor(rand() * 8);
    ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
    ctx.fillRect(i * sw + sw * 0.18, 0, sw * 0.64, size);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(i * sw + sw * 0.18, 0, sw * 0.06, size);
  }
  grain(ctx, size, size, 0.1, rand);
  return c;
}

/** The boutique's walls: pale champagne panels with a fine gold beading. */
export function drawPanels(size: number, seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const rand = rng(seed);
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#e9dcc6');
  g.addColorStop(1, '#dccbb1');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const m = size * 0.08;
  ctx.strokeStyle = '#b8955a';
  ctx.lineWidth = Math.max(1, size / 256);
  ctx.strokeRect(m, m, size - 2 * m, size - 2 * m);
  ctx.strokeStyle = 'rgba(120,96,60,0.35)';
  ctx.strokeRect(m * 1.5, m * 1.5, size - 3 * m, size - 3 * m);
  grain(ctx, size, size, 0.05, rand);
  return c;
}
