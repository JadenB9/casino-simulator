// The floor plan, as data. Everything that stands on the floor is placed from here: the table
// pit, the slot banks (one island per slots variant in the catalogue), the Big Six wheel, the
// video poker bar, the cashier, the poker room, the lounge, the aisles and the columns. Station
// spacing comes from each game module's footprint, so when a real table or machine replaces a
// stub the floor re-flows around it and the aisles stay clear.
//
// Coordinates: metres, +x east, +z south (toward the entrance), y up. Station yaw follows
// Object3D.rotation.y; a station's player side is its local +z, so yaw 0 faces the players south.

import type { GameId } from '../../../shared/src/engine.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';

export interface Footprint {
  width: number;
  depth: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type Zone = 'pit' | 'slots' | 'bar' | 'poker' | 'cashier' | 'feature';

export interface Placement {
  id: string;
  game: GameId;
  variant: string;
  x: number;
  z: number;
  yaw: number;
  zone: Zone;
  /** Footprint used for spacing and collision. */
  fp: Footprint;
}

export interface Bank {
  variant: string;
  /** Centre and long axis of the island; machines face out on both sides (or one side against a wall). */
  x: number;
  z: number;
  /** 0: long axis along x (machines face north and south); PI/2: along z (machines face east and west). */
  yaw: number;
  length: number;
  depth: number;
  ids: string[];
}

export interface Column {
  x: number;
  z: number;
  r: number;
}

export interface Rope {
  /** A run of velvet rope between stanchions, as a polyline on the floor. */
  points: [number, number][];
}

export interface FloorPlan {
  room: Rect;
  stations: Placement[];
  pit: Rect;
  /** The dealers' side between the two rows: roped off, with the pit podium. */
  staff: Rect;
  aisles: Rect[];
  entrance: Rect;
  door: { x0: number; x1: number; height: number };
  pokerRoom: Rect;
  slotsZone: Rect;
  /** Where a tall feature (the Big Six wheel) stands against a wall, with its players' room. */
  feature: Rect;
  barZone: Rect;
  banks: Bank[];
  bar: {
    /** Customer face of the counter (x), and its run along z. */
    front: number;
    depth: number;
    z0: number;
    z1: number;
    /** The back bar against the east wall. */
    back: number;
    stools: number[];
    vp: string[];
  };
  cashier: {
    counter: Rect;
    /** Where a player stands to use it, and which way they face (yaw of a character looking at the counter). */
    x: number;
    z: number;
    face: number;
  };
  lounge: Rect;
  columns: Column[];
  ropes: Rope[];
  plants: [number, number, number][];
  palms: [number, number][];
}

export const ROOM: Rect = { x0: -20, z0: -15, x1: 20, z1: 15 };
/** Friedman-low ceiling over slots, the bar and the aisles. */
export const CEILING = 3.4;
/** The grand coffered ceiling over the table pit. */
export const PIT_CEILING = 6.6;
export const WALL = 0.3;

const TABLE_GAP = 1.7;
const NORTH_AISLE = 3.4;
const STAFF_DEPTH = 2.6;
/** Standing or seated players in front of a table or machine. */
const PLAYER_ZONE = 0.95;
const CROSS_AISLE = 2.8;
const LANE = 3.4;

interface Want {
  id: string;
  game: GameId;
  variant: string;
}

// The dice games share the middle of the north row, the roulettes at its ends; Casino War sits
// mid-row in the south, facing the main aisle and the doors.
const NORTH_ROW: Want[] = [
  { id: 'rl-us', game: 'roulette', variant: 'american' },
  { id: 'cr-1', game: 'craps', variant: '' },
  { id: 'sb-1', game: 'sicbo', variant: '' },
  { id: 'rl-eu', game: 'roulette', variant: 'european' },
];

const SOUTH_ROW: Want[] = [
  { id: 'bj-1', game: 'blackjack', variant: '' },
  { id: 'bc-1', game: 'baccarat', variant: '' },
  { id: 'wr-1', game: 'war', variant: '' },
  { id: 'tc-1', game: 'threecard', variant: '' },
  { id: 'bj-2', game: 'blackjack', variant: '' },
];

/** The Big Six wheel stands about 3 m tall: against the west wall, facing the pit. */
const BIG_SIX: Want = { id: 'b6-1', game: 'bigsix', variant: '' };

const POKER: Want[] = [
  { id: 'he-1', game: 'holdem', variant: '' },
  { id: 'he-2', game: 'holdem', variant: '' },
];

/** Every slots variant in the catalogue gets an island, in catalogue order. */
export function slotVariants(): string[] {
  return CATALOG.slots.variants.map((v) => v.id);
}
const PER_SIDE = 2;
const VP_COUNT = 4;
/** Walking room between the end caps of neighbouring slot islands, and between facing players. */
const ISLAND_GAP = 1.6;
const ISLAND_LANE = 1.3;

export function planFloor(footprint: (game: GameId) => Footprint, slots: readonly string[] = slotVariants()): FloorPlan {
  const stations: Placement[] = [];
  const fp = (g: GameId) => {
    const f = footprint(g);
    return { width: Math.max(0.4, f.width), depth: Math.max(0.4, f.depth) };
  };

  // --- table pit: two rows facing out, dealers back to back across a roped staff area ----------
  const rowLen = (row: Want[]) => row.reduce((s, w) => s + fp(w.game).width, 0) + TABLE_GAP * (row.length - 1);
  const rowDepth = (row: Want[]) => Math.max(...row.map((w) => fp(w.game).depth));
  const dN = rowDepth(NORTH_ROW);
  const dS = rowDepth(SOUTH_ROW);
  const zN = ROOM.z0 + NORTH_AISLE + dN / 2;
  const zS = zN + dN / 2 + STAFF_DEPTH + dS / 2;
  const placeRow = (row: Want[], z: number, yaw: number) => {
    let x = -rowLen(row) / 2;
    for (const w of row) {
      const f = fp(w.game);
      stations.push({ ...w, x: x + f.width / 2, z, yaw, zone: 'pit', fp: f });
      x += f.width + TABLE_GAP;
    }
  };
  placeRow(NORTH_ROW, zN, Math.PI);
  placeRow(SOUTH_ROW, zS, 0);
  const half = Math.max(rowLen(NORTH_ROW), rowLen(SOUTH_ROW)) / 2;
  const pit: Rect = { x0: -half - 1.9, x1: half + 1.9, z0: zN - dN / 2 - PLAYER_ZONE - 0.8, z1: zS + dS / 2 + PLAYER_ZONE + 0.7 };
  const staffHalf = Math.min(rowLen(NORTH_ROW), rowLen(SOUTH_ROW)) / 2;
  const staff: Rect = { x0: -staffHalf, x1: staffHalf, z0: zN + dN / 2, z1: zS - dS / 2 };

  // --- aisles --------------------------------------------------------------------------------
  const crossZ0 = zS + dS / 2 + PLAYER_ZONE;
  const crossZ1 = crossZ0 + CROSS_AISLE;
  const entrance: Rect = { x0: -4.6, x1: 4.6, z0: 11.6, z1: ROOM.z1 };
  const aisles: Rect[] = [
    { x0: ROOM.x0 + WALL, x1: ROOM.x1 - WALL, z0: crossZ0, z1: crossZ1 },
    { x0: -2.1, x1: 2.1, z0: crossZ1, z1: entrance.z0 },
    { x0: pit.x0 - 0.2, x1: pit.x1 + 0.2, z0: ROOM.z0 + WALL, z1: zN - dN / 2 - PLAYER_ZONE },
  ];

  // --- cashier: a cage on the north wall in the west corner -----------------------------------
  const counter: Rect = { x0: ROOM.x0 + WALL, x1: -12.6, z0: ROOM.z0 + WALL, z1: -12.4 };
  const cashier = { counter, x: (counter.x0 + counter.x1) / 2 + 0.4, z: counter.z1 + 0.75, face: Math.PI };

  // --- poker room: north-east, two hold'em tables. Side on (dealers against the east wall) when
  // the room is long enough for both with walking room between; otherwise one behind the other.
  const pokerRoom: Rect = { x0: Math.max(pit.x1 + 1.6, 11.4), x1: ROOM.x1 - WALL, z0: ROOM.z0 + WALL, z1: crossZ0 - 0.4 };
  {
    const f = fp('holdem');
    const long = pokerRoom.z1 - pokerRoom.z0;
    const sideOn = 2 * f.width + 1.6 + 2 * 0.7 <= long;
    if (sideOn) {
      const x = ROOM.x1 - WALL - 1.6 - f.depth / 2;
      const gap = Math.min(2.6, long - 2 * f.width - 1.4);
      let z = (pokerRoom.z0 + pokerRoom.z1) / 2 - (f.width + gap / 2);
      for (const w of POKER) {
        stations.push({ ...w, x, z: z + f.width / 2, yaw: -Math.PI / 2, zone: 'poker', fp: f });
        z += f.width + gap;
      }
    } else {
      // players' side south: each table needs its depth plus standing room in front
      const x = (pokerRoom.x0 + 1.2 + pokerRoom.x1) / 2;
      const cell = f.depth + PLAYER_ZONE;
      const gap = Math.max(0.6, Math.min(1.8, (long - 0.5 - 2 * cell) / 2));
      let z = pokerRoom.z0 + 0.5;
      for (const w of POKER) {
        stations.push({ ...w, x, z: z + f.depth / 2, yaw: 0, zone: 'poker', fp: f });
        z += cell + gap;
      }
    }
  }

  // --- slots: one island per variant, in a grid on the south-west floor -----------------------
  // Islands run east-west with machines back to back facing north and south. The grid takes as
  // few rows as fit the zone's depth (squarish when there's room), spreads the islands evenly
  // and keeps a lane between every pair of facing players.
  const slotsZone: Rect = { x0: ROOM.x0 + WALL, x1: -3.1, z0: crossZ1, z1: ROOM.z1 - WALL };
  const sf = fp('slots');
  const pitch = sf.width + 0.06;
  const bankLen = PER_SIDE * pitch;
  const bankDepth = 2 * sf.depth + 0.3;
  const banks: Bank[] = [];
  const addBank = (variant: string, x: number, z: number, yaw: number) => {
    const ids: string[] = [];
    // machines along the long axis, back to back across the spine
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    // the side normal: yaw 0 -> +z, yaw PI/2 -> +x
    const nx = Math.sin(yaw);
    const nz = Math.cos(yaw);
    let n = banks.reduce((s, b) => s + (b.variant === variant ? b.ids.length : 0), 0);
    for (const side of [1, -1]) {
      for (let i = 0; i < PER_SIDE; i++) {
        const along = (i - (PER_SIDE - 1) / 2) * pitch * side;
        const off = side * (0.15 + sf.depth / 2);
        const id = `slots-${variant}-${++n}`;
        ids.push(id);
        stations.push({
          id,
          game: 'slots',
          variant,
          x: x + ax * along + nx * off,
          z: z + az * along + nz * off,
          yaw: side > 0 ? yaw : yaw + Math.PI,
          zone: 'slots',
          fp: sf,
        });
      }
    }
    banks.push({ variant, x, z, yaw, length: bankLen, depth: bankDepth, ids });
  };
  {
    // an island's size with its end caps and plinth (decor.ts)
    const islandW = bankLen + 0.62;
    const colPitch = islandW + ISLAND_GAP;
    const rowPitch = bankDepth + 2 * PLAYER_ZONE + ISLAND_LANE;
    const gx0 = slotsZone.x0 + 0.9 + islandW / 2;
    const gx1 = slotsZone.x1 - 0.9 - islandW / 2;
    const gz0 = slotsZone.z0 + PLAYER_ZONE + 0.6 + bankDepth / 2;
    const gz1 = slotsZone.z1 - PLAYER_ZONE - 1.6 - bankDepth / 2;
    const maxCols = Math.max(1, Math.floor((gx1 - gx0) / colPitch) + 1);
    const maxRows = Math.max(1, Math.floor((gz1 - gz0) / rowPitch) + 1);
    const n = slots.length;
    let rows = Math.max(1, Math.min(maxRows, Math.ceil(Math.sqrt(n))));
    let cols = Math.ceil(n / rows);
    while (cols > maxCols && rows < maxRows) cols = Math.ceil(n / ++rows);
    // spread evenly, but no further apart than looks like one slot floor
    const dx = cols > 1 ? Math.min((gx1 - gx0) / (cols - 1), colPitch * 1.6) : 0;
    const dz = rows > 1 ? Math.min((gz1 - gz0) / (rows - 1), rowPitch * 1.5) : 0;
    const cx = (gx0 + gx1) / 2;
    const cz = rows > 1 ? (gz0 + gz1) / 2 : gz0;
    slots.forEach((variant, i) => {
      const r = Math.floor(i / cols);
      // a short last row sits in the middle
      const inRow = Math.min(cols, n - r * cols);
      const c = i % cols;
      addBank(variant, cx + (c - (inRow - 1) / 2) * dx, cz + (r - (rows - 1) / 2) * dz, 0);
    });
  }

  // --- the feature spot: the Big Six against the west wall, between the cashier's queue and the
  // cross aisle, facing east toward the pit ------------------------------------------------------
  const queueEnd = counter.z1 + 3.2;
  const feature: Rect = { x0: ROOM.x0 + WALL, x1: Math.min(pit.x0, -9.5) - 0.6, z0: queueEnd, z1: crossZ0 - 0.4 };
  {
    const f = fp(BIG_SIX.game);
    const x = feature.x0 + 0.35 + f.depth / 2;
    const z = Math.max(feature.z0 + f.width / 2, (feature.z0 + feature.z1) / 2);
    stations.push({ ...BIG_SIX, x, z, yaw: Math.PI / 2, zone: 'feature', fp: f });
  }

  // --- the bar: counter along the east wall, video poker set into the north end ----------------
  const barZone: Rect = { x0: 3.1, x1: ROOM.x1 - WALL, z0: crossZ1, z1: ROOM.z1 - WALL };
  const back = ROOM.x1 - WALL - 0.75;
  const front = back - 2.9;
  const barZ0 = barZone.z0 + 1.6;
  const barZ1 = ROOM.z1 - WALL - 1.5;
  const vf = fp('videopoker');
  const vpPitch = Math.max(1.25, vf.width + 0.2);
  const vp: string[] = [];
  for (let i = 0; i < VP_COUNT; i++) {
    const id = `vp-${i + 1}`;
    vp.push(id);
    stations.push({
      id,
      game: 'videopoker',
      variant: '',
      x: front + vf.depth / 2 - 0.05,
      z: barZ0 + 0.9 + vpPitch / 2 + i * vpPitch,
      yaw: -Math.PI / 2,
      zone: 'bar',
      fp: vf,
    });
  }
  const stools: number[] = [];
  for (let z = barZ0 + 0.9 + VP_COUNT * vpPitch + 0.75; z < barZ1 - 0.5; z += 0.95) stools.push(z);

  const lounge: Rect = { x0: 4.2, x1: front - 3.2, z0: Math.max(barZone.z0 + 3.2, 4.2), z1: ROOM.z1 - WALL - 1.2 };

  // --- columns: the pit corners, the main aisle and the vestibule -----------------------------
  const columns: Column[] = [
    { x: pit.x0, z: pit.z0, r: 0.42 },
    { x: pit.x1, z: pit.z0, r: 0.42 },
    { x: pit.x0, z: pit.z1, r: 0.42 },
    { x: pit.x1, z: pit.z1, r: 0.42 },
    { x: -2.95, z: crossZ1 + 3.4, r: 0.34 },
    { x: 2.95, z: crossZ1 + 3.4, r: 0.34 },
    { x: -2.95, z: entrance.z0 - 2.6, r: 0.34 },
    { x: 2.95, z: entrance.z0 - 2.6, r: 0.34 },
  ];

  // --- velvet ropes: close the pit's staff area, front the poker room, queue for the cashier ---
  const ropes: Rope[] = [
    { points: [[-staffHalf - 0.35, zN + dN / 2 - 0.2], [-staffHalf - 0.35, zS - dS / 2 + 0.2]] },
    { points: [[staffHalf + 0.35, zN + dN / 2 - 0.2], [staffHalf + 0.35, zS - dS / 2 + 0.2]] },
    { points: [[pokerRoom.x0, pokerRoom.z0 + 1.2], [pokerRoom.x0, (pokerRoom.z0 + pokerRoom.z1) / 2 - 1.0]] },
    { points: [[pokerRoom.x0, (pokerRoom.z0 + pokerRoom.z1) / 2 + 1.0], [pokerRoom.x0, pokerRoom.z1], [pokerRoom.x1 - 0.4, pokerRoom.z1]] },
    { points: [[cashier.x - 1.5, counter.z1 + 0.25], [cashier.x - 1.5, counter.z1 + 2.2]] },
    { points: [[cashier.x + 1.5, counter.z1 + 0.25], [cashier.x + 1.5, counter.z1 + 2.2]] },
  ];

  // the west wall's corner plant keeps clear of the Big Six's south end (or goes, if it can't)
  const wheel = stations.find((p) => p.zone === 'feature');
  const cornerZ = Math.max(crossZ0 - 0.8, wheel ? wheel.z + wheel.fp.width / 2 + 0.55 : -Infinity);
  const plants: [number, number, number][] = [
    ...(cornerZ <= crossZ0 - 0.45 ? [[ROOM.x0 + 0.8, cornerZ, 1] as [number, number, number]] : []),
    [-12.2, ROOM.z0 + 1.0, 0],
    [pokerRoom.x0 + 0.7, ROOM.z0 + 0.9, 1],
    [ROOM.x1 - 0.8, crossZ1 + 0.8, 0],
    [front - 0.6, barZ1 + 0.7, 1],
    [ROOM.x0 + 0.8, ROOM.z1 - 0.8, 0],
    [-5.3, ROOM.z1 - 0.8, 1],
    [5.3, ROOM.z1 - 0.8, 1],
    [lounge.x0 + 0.4, lounge.z1 + 0.5, 0],
  ];
  const palms: [number, number][] = [
    [-3.5, 13.6],
    [3.5, 13.6],
  ];

  return {
    room: ROOM,
    stations,
    pit,
    staff,
    aisles,
    entrance,
    door: { x0: -1.3, x1: 1.3, height: 2.9 },
    pokerRoom,
    slotsZone,
    feature,
    barZone,
    banks,
    bar: { front, depth: 0.78, z0: barZ0, z1: barZ1, back, stools, vp },
    cashier,
    lounge,
    columns,
    ropes,
    plants,
    palms,
  };
}

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
}

// --- checks ----------------------------------------------------------------------------------

type Poly = [number, number][];

function corners(x: number, z: number, w: number, d: number, yaw: number): Poly {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([lx, lz]) => [x + lx! * c + lz! * s, z - lx! * s + lz! * c] as [number, number]);
}

/** Separating-axis test for two convex quads. */
function overlaps(a: Poly, b: Poly): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const ax = -(q[1] - p[1]);
      const az = q[0] - p[0];
      const proj = (pts: Poly) => pts.map(([x, z]) => x * ax + z * az);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

function rectPoly(r: Rect): Poly {
  return [
    [r.x0, r.z0],
    [r.x1, r.z0],
    [r.x1, r.z1],
    [r.x0, r.z1],
  ];
}

/**
 * Problems with a plan, as readable strings (empty when it's sound): stations overlapping each
 * other, the walls or an aisle, and players' standing room in front of a station blocked.
 */
export function checkLayout(plan: FloorPlan): string[] {
  const out: string[] = [];
  const PAD = 0.05;
  const boxes = plan.stations.map((s) => ({ s, poly: corners(s.x, s.z, s.fp.width + PAD, s.fp.depth + PAD, s.yaw) }));
  const inner: Rect = { x0: plan.room.x0 + WALL, z0: plan.room.z0 + WALL, x1: plan.room.x1 - WALL, z1: plan.room.z1 - WALL };
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    for (const [x, z] of a.poly) if (!inRect(inner, x, z, 0.01)) out.push(`${a.s.id} pokes through a wall`);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      if (overlaps(a.poly, b.poly)) out.push(`${a.s.id} overlaps ${b.s.id}`);
    }
    for (const [k, aisle] of plan.aisles.entries()) if (overlaps(a.poly, rectPoly(aisle))) out.push(`${a.s.id} stands in aisle ${k}`);
    // a strip of standing room along the player side (tables, and machines on the floor)
    if (a.s.zone !== 'bar') {
      const off = a.s.fp.depth / 2 + 0.45;
      const fx = a.s.x + Math.sin(a.s.yaw) * off;
      const fz = a.s.z + Math.cos(a.s.yaw) * off;
      const front = corners(fx, fz, a.s.fp.width * 0.8, 0.7, a.s.yaw);
      for (const b of boxes) if (b !== a && overlaps(front, b.poly)) out.push(`${b.s.id} blocks the players of ${a.s.id}`);
      for (const bank of plan.banks) {
        if (bank.ids.includes(a.s.id)) continue;
        if (overlaps(front, corners(bank.x, bank.z, bank.length + 0.6, bank.depth + 0.2, bank.yaw))) out.push(`bank ${bank.variant} blocks the players of ${a.s.id}`);
      }
      for (const [x, z] of front) if (!inRect(inner, x, z, 0.01)) out.push(`${a.s.id} has its players against a wall`);
    }
  }
  return [...new Set(out)];
}
