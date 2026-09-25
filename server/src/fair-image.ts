// The built-in Quick check's picture: a patch of speckled felt with six coloured rings on it and,
// written into the pixels, which ring the chip goes on ("CHIP ON THE BLUE RING"). The Worker draws
// it and keeps the answer (fair.ts); the client only ever gets the PNG, so a script has to read
// the words and find the ring in the picture, where a person just looks. Pure: the random
// numbers come in, a PNG goes out.

export const IMG_W = 360;
export const IMG_H = 220;
/** The words sit above this line; the rings below it. */
const BAND = 34;
/** Ring radius and stroke (px), and how near the ring's centre a drop counts. */
const RING_R = 17;
const RING_W = 5;
export const HIT_PX = 22;
/** The client draws the chip to drag in this corner (bottom left), so no ring goes there. */
export const CHIP_HOME = { x: 34, y: IMG_H - 30 };

export const RING_COLORS = ['GOLD', 'RED', 'BLUE', 'WHITE', 'BLACK', 'PURPLE'] as const;
export type RingColor = (typeof RING_COLORS)[number];

// The palette: felt greens 0-15, then each ring colour as a shade pair, then ink for the words.
const FELT = 16;
const PALETTE: [number, number, number][] = [];
for (let i = 0; i < FELT; i++) PALETTE.push([18 + i * 2, 70 + i * 4, 40 + i * 2]);
const RING_RGB: Record<RingColor, [number, number, number][]> = {
  GOLD: [[212, 170, 60], [240, 204, 96]],
  RED: [[178, 34, 40], [214, 64, 66]],
  BLUE: [[34, 72, 176], [72, 112, 214]],
  WHITE: [[226, 222, 212], [250, 248, 240]],
  BLACK: [[22, 22, 26], [48, 48, 54]],
  PURPLE: [[112, 44, 150], [150, 80, 190]],
};
const RING_BASE: Record<RingColor, number> = {} as Record<RingColor, number>;
for (const c of RING_COLORS) {
  RING_BASE[c] = PALETTE.length;
  PALETTE.push(...RING_RGB[c]);
}
const INK = PALETTE.length;
PALETTE.push([244, 236, 214], [30, 26, 20]);

// A 5x7 font for the letters the sentence uses; each row is five bits, left to right.
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
};

export interface ChipPuzzle {
  /** Which colour the words name, and where that ring is (px). */
  color: RingColor;
  x: number;
  y: number;
  png: Uint8Array;
}

/** Draw a new puzzle with `rand` (0 <= rand() < 1). */
export async function chipPuzzle(rand: () => number): Promise<ChipPuzzle> {
  const px = new Uint8Array(IMG_W * IMG_H);
  // Felt: blotches of shade, then speckle over everything.
  for (let y = 0; y < IMG_H; y += 3) {
    for (let x = 0; x < IMG_W; x += 3) {
      const shade = Math.floor(6 + rand() * 6);
      for (let dy = 0; dy < 3 && y + dy < IMG_H; dy++) for (let dx = 0; dx < 3 && x + dx < IMG_W; dx++) px[(y + dy) * IMG_W + x + dx] = shade;
    }
  }
  // The rings, in a shuffled order, each well clear of the others, the words and the chip.
  const colors = [...RING_COLORS].sort(() => rand() - 0.5);
  const spots: { x: number; y: number }[] = [];
  for (const c of colors) {
    let spot = { x: 0, y: 0 };
    for (let tries = 0; tries < 400; tries++) {
      spot = { x: Math.round(30 + rand() * (IMG_W - 60)), y: Math.round(BAND + 26 + rand() * (IMG_H - BAND - 52)) };
      const clear = spots.every((s) => Math.hypot(s.x - spot.x, s.y - spot.y) > 58) && Math.hypot(spot.x - CHIP_HOME.x, spot.y - CHIP_HOME.y) > 64;
      if (clear) break;
    }
    spots.push(spot);
    ring(px, spot.x, spot.y, RING_BASE[c], rand);
  }
  const pick = Math.floor(rand() * colors.length);
  const color = colors[pick]!;
  words(px, `CHIP ON THE ${color} RING`, rand);
  // Speckle last, over rings and words alike.
  for (let i = 0; i < 2600; i++) px[Math.floor(rand() * IMG_W * IMG_H)] = Math.floor(rand() * FELT);
  return { color, x: spots[pick]!.x, y: spots[pick]!.y, png: await encodePng(px) };
}

function ring(px: Uint8Array, cx: number, cy: number, base: number, rand: () => number): void {
  const r = RING_R + Math.floor(rand() * 4) - 2;
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      if (x < 0 || y < 0 || x >= IMG_W || y >= IMG_H) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r && d >= r - RING_W) px[y * IMG_W + x] = base + (d > r - RING_W / 2 ? 1 : 0);
    }
  }
}

/** The sentence, at twice size, each letter nudged up or down a little. */
function words(px: Uint8Array, text: string, rand: () => number): void {
  const scale = 2;
  const advance = 6 * scale;
  let x = Math.floor((IMG_W - text.length * advance) / 2);
  for (const ch of text) {
    const g = GLYPHS[ch];
    const y0 = 8 + Math.floor(rand() * 5) - 2;
    if (g) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (!(g[row]! & (0x10 >> col))) continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const X = x + col * scale + dx;
              const Y = y0 + row * scale + dy;
              px[Y * IMG_W + X] = INK;
              // A dark edge under and right, so the words read on any felt.
              if (X + 1 < IMG_W && Y + 1 < IMG_H && px[(Y + 1) * IMG_W + X + 1] !== INK) px[(Y + 1) * IMG_W + X + 1] = INK + 1;
            }
          }
        }
      }
    }
    x += advance;
  }
}

// --- PNG (indexed colour, one byte a pixel) -------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const name = new TextEncoder().encode(type);
  out.set(name, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([name, data]));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  // 'deflate' is the zlib format, which is what a PNG's IDAT holds.
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodePng(px: Uint8Array): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, IMG_W);
  v.setUint32(4, IMG_H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  const plte = new Uint8Array(PALETTE.length * 3);
  PALETTE.forEach(([r, g, b], i) => plte.set([r, g, b], i * 3));
  // Each row starts with its filter byte (0: none).
  const raw = new Uint8Array(IMG_H * (IMG_W + 1));
  for (let y = 0; y < IMG_H; y++) raw.set(px.subarray(y * IMG_W, (y + 1) * IMG_W), y * (IMG_W + 1) + 1);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
